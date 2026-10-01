-- =====================================================================
--  Werkstatt RSZ MV — Migration 4.0.2 → 5.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen. Vorhandene Daten bleiben erhalten.
--  Danach: Data API → "Refresh schema cache".
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Marke an Rädern und Einzelstücken
-- ---------------------------------------------------------------------
alter table rad    add column marke text;
alter table stueck add column marke text;

-- ---------------------------------------------------------------------
--  Storno-Buchungen: eine Gegenbuchung verweist auf die stornierte Zeile.
-- ---------------------------------------------------------------------
alter table buchung drop constraint buchung_art_check;
alter table buchung add constraint buchung_art_check
  check (art in ('zugang', 'entnahme', 'umbuchung', 'korrektur', 'storno'));
alter table buchung add column storno_von bigint unique references buchung (id);

-- ---------------------------------------------------------------------
--  Rechnungen können storniert werden
-- ---------------------------------------------------------------------
alter table rechnung drop constraint rechnung_status_check;
alter table rechnung add constraint rechnung_status_check
  check (status in ('offen', 'bezahlt', 'storniert'));
alter table rechnung add column storniert_am  timestamptz,
                     add column storniert_von text,
                     add column storno_grund  text;

-- ---------------------------------------------------------------------
--  Inventur: wann wurde was wo zuletzt gezählt
-- ---------------------------------------------------------------------
create table zaehlung (
  code         text not null references artikel (code),
  ort          lagerort not null,
  gezaehlt_am  timestamptz not null default now(),
  bearbeiter   text,
  primary key (code, ort)
);
-- Jede übernommene Inventur einmal — die Kennung kommt vom Gerät, damit
-- ein erneutes Senden nach Funkloch nicht doppelt bucht.
create table inventur_lauf (
  id           uuid primary key,
  ort          lagerort not null,
  gebucht      timestamptz not null default now(),
  bearbeiter   text,
  gezaehlt     integer not null,
  korrekturen  integer not null
);
alter table zaehlung enable row level security;
alter table inventur_lauf enable row level security;
create policy nur_trainer on inventur_lauf for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen on inventur_lauf for select to anonymous using (true);
create policy nur_trainer on zaehlung for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen on zaehlung for select to anonymous using (true);

-- ---------------------------------------------------------------------
--  Fotos am Ticket (verkleinert, als Base64-Text)
-- ---------------------------------------------------------------------
create table foto (
  id           bigint generated always as identity primary key,
  ticket_id    bigint not null references ticket (id),
  client_id    uuid unique,
  aufgenommen  timestamptz not null default now(),
  bearbeiter   text,
  mime         text not null default 'image/jpeg' check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  thumb        text not null check (length(thumb) <= 150000),
  bild         text not null check (length(bild) <= 2500000)
);
create index foto_ticket on foto (ticket_id);
alter table foto enable row level security;
create policy nur_trainer on foto for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen    on foto for select to anonymous using (true);
create policy offen_loeschen on foto for delete to anonymous
  using (exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));

-- ---------------------------------------------------------------------
--  Offene Posten: abzurechnende Entnahmen ohne Rechnung, nicht storniert
-- ---------------------------------------------------------------------
create view v_offene_posten with (security_invoker = true) as
select b.id, b.zeit, b.code, b.menge, b.einzelpreis, b.sportler_id, b.ticket_id, b.notiz, b.bearbeiter
from buchung b
where b.art = 'entnahme' and b.abrechnen and b.rechnung_id is null
  and not exists (select 1 from buchung s where s.storno_von = b.id);

-- ---------------------------------------------------------------------
--  Material ausgeben: Pauschale und ihr Verbrauch bekommen eine
--  gemeinsame Gruppe, damit ein Storno beide erfasst.
-- ---------------------------------------------------------------------
create or replace function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a      artikel;
  v_abr  boolean := false;
  v_grp  uuid;
begin
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select * into a from artikel where code = p_code;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  if p_sportler is not null then
    select abrechnen into v_abr from sportler where id = p_sportler;
  end if;
  if a.art = 'Pauschale' and a.verbraucht_code is not null and a.verbrauch_menge is not null then
    v_grp := gen_random_uuid();
  end if;

  insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe)
  values ('entnahme', p_code, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter, v_grp);

  if v_grp is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter, v_grp);
  end if;

  return a.preis * p_menge;
end $$;

-- ---------------------------------------------------------------------
--  Einzel-Inventur merkt sich jetzt auch, wann gezählt wurde.
-- ---------------------------------------------------------------------
create or replace function inventur(p_code text, p_ort text, p_gezaehlt numeric, p_bearbeiter text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ist   numeric;
  v_diff  numeric;
begin
  if p_gezaehlt is null or p_gezaehlt < 0 then raise exception 'Gezählte Menge fehlt'; end if;
  select coalesce(sum(menge), 0) into v_ist from buchung where code = p_code and ort = p_ort;
  v_diff := p_gezaehlt - v_ist;
  if v_diff <> 0 then
    insert into buchung (art, code, menge, ort, notiz, bearbeiter)
    values ('korrektur', p_code, v_diff, p_ort, 'Inventur: gezählt ' || p_gezaehlt || ', vorher ' || v_ist, p_bearbeiter);
  end if;
  insert into zaehlung (code, ort, bearbeiter) values (p_code, p_ort, p_bearbeiter)
  on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  return v_diff;
end $$;

-- ---------------------------------------------------------------------
--  Inventur-Modus: eine ganze Zählung in einem Schritt buchen.
--  Gebucht wird je Artikel die Differenz zum Systembestand IM MOMENT
--  DES ZÄHLENS (basis). Buchungen, die während der Inventur passieren,
--  bleiben dadurch erhalten.
--  p_zaehlung: [{"code":"B-120","gezaehlt":4,"basis":5}, …]
-- ---------------------------------------------------------------------
create function inventur_buchen(p_ort text, p_zaehlung jsonb, p_bearbeiter text default null,
                                p_lauf uuid default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_z      jsonb;
  v_code   text;
  v_g      numeric;
  v_b      numeric;
  v_ort    lagerort := p_ort;
  v_anzahl integer := 0;
begin
  if p_lauf is not null then
    perform pg_advisory_xact_lock(hashtext(p_lauf::text));
    select korrekturen into v_anzahl from inventur_lauf where id = p_lauf;
    if found then return v_anzahl; end if;     -- schon gebucht
    v_anzahl := 0;
  end if;

  for v_z in select * from jsonb_array_elements(coalesce(p_zaehlung, '[]'::jsonb)) loop
    v_code := v_z ->> 'code';
    v_g    := (v_z ->> 'gezaehlt')::numeric;
    v_b    := coalesce((v_z ->> 'basis')::numeric, 0);
    if v_g is null or v_g < 0 then raise exception 'Ungültige Zählung für %', v_code; end if;
    if not exists (select 1 from artikel where code = v_code) then raise exception 'Unbekannter Artikel: %', v_code; end if;

    if v_g <> v_b then
      insert into buchung (art, code, menge, ort, notiz, bearbeiter)
      values ('korrektur', v_code, v_g - v_b, v_ort,
              'Inventur: gezählt ' || v_g || ', System beim Zählen ' || v_b, p_bearbeiter);
      v_anzahl := v_anzahl + 1;
    end if;
    insert into zaehlung (code, ort, bearbeiter) values (v_code, v_ort, p_bearbeiter)
    on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  end loop;

  if p_lauf is not null then
    insert into inventur_lauf (id, ort, bearbeiter, gezaehlt, korrekturen)
    values (p_lauf, v_ort, p_bearbeiter, jsonb_array_length(coalesce(p_zaehlung, '[]'::jsonb)), v_anzahl);
  end if;
  return v_anzahl;
end $$;

-- ---------------------------------------------------------------------
--  Fehlbuchung stornieren: Gegenbuchung mit Grund. Umbuchungen und
--  Pauschalen mit Verbrauch werden als Ganzes storniert.
-- ---------------------------------------------------------------------
create function buchung_stornieren(p_buchung bigint, p_grund text, p_bearbeiter text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b        buchung;
  z        buchung;
  v_anzahl integer := 0;
begin
  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben'; end if;
  select * into b from buchung where id = p_buchung for update;
  if not found then raise exception 'Buchung % nicht gefunden', p_buchung; end if;
  if b.art = 'storno' then raise exception 'Eine Storno-Buchung kann nicht storniert werden'; end if;

  for z in
    select * from buchung
     where id = b.id
        or (b.gruppe is not null and gruppe = b.gruppe)
        -- Pauschalen aus der Zeit vor 5.0.0: Verbrauch hat keine Gruppe,
        -- entstand aber in derselben Buchung (gleiche Zeit, gleicher Sportler/Ticket)
        or (b.gruppe is null and b.art = 'entnahme' and art = 'entnahme' and zeit = b.zeit
            and sportler_id is not distinct from b.sportler_id and ticket_id is not distinct from b.ticket_id
            and notiz = 'Verbrauch aus ' || b.code)
     order by id
     for update
  loop
    if z.rechnung_id is not null then
      raise exception 'Steht auf einer Rechnung — erst die Rechnung stornieren';
    end if;
    if exists (select 1 from buchung where storno_von = z.id) then
      raise exception 'Bereits storniert';
    end if;
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen,
                         gruppe, notiz, bearbeiter, storno_von)
    values ('storno', z.code, -z.menge, z.ort, z.sportler_id, z.ticket_id, z.einzelpreis, false,
            z.gruppe, 'Storno: ' || trim(p_grund), p_bearbeiter, z.id);
    v_anzahl := v_anzahl + 1;
  end loop;
  return v_anzahl;
end $$;

-- ---------------------------------------------------------------------
--  Rechnung festschreiben — stornierte Entnahmen bleiben draußen.
-- ---------------------------------------------------------------------
create or replace function rechnung_erstellen(p_sportler bigint, p_von date default null, p_bis date default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_heute  date := (now() at time zone 'Europe/Berlin')::date;
  v_von    date := coalesce(p_von, date '2000-01-01');
  v_bis    date := coalesce(p_bis, (now() at time zone 'Europe/Berlin')::date);
  v_jahr   text := to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY');
  v_id     bigint;
  v_nr     text;
  v_summe  numeric;
begin
  -- Immer nur eine Rechnung gleichzeitig, damit keine Nummer doppelt vergeben wird.
  perform pg_advisory_xact_lock(hashtext('rechnung_nummer'));

  select 'R-' || v_jahr || '-' || lpad((count(*) + 1)::text, 3, '0') into v_nr
    from rechnung where nummer like 'R-' || v_jahr || '-%';

  insert into rechnung (nummer, datum, sportler_id, von, bis, summe)
  values (v_nr, v_heute, p_sportler, v_von, v_bis, 0)
  returning id into v_id;

  with markiert as (
    update buchung b set rechnung_id = v_id
     where b.sportler_id = p_sportler and b.art = 'entnahme' and b.abrechnen and b.rechnung_id is null
       and (b.zeit at time zone 'Europe/Berlin')::date between v_von and v_bis
       and not exists (select 1 from buchung s where s.storno_von = b.id)
    returning -b.menge * b.einzelpreis as betrag
  )
  select coalesce(sum(betrag), 0) into v_summe from markiert;

  if v_summe = 0 then raise exception 'Keine offenen Posten im Zeitraum'; end if;

  update rechnung set summe = v_summe where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Rechnung stornieren: Nummer und Betrag bleiben stehen, die Posten
--  werden wieder offen und erscheinen in der nächsten Rechnung.
-- ---------------------------------------------------------------------
create function rechnung_stornieren(p_rechnung bigint, p_grund text, p_bearbeiter text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r rechnung;
begin
  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben'; end if;
  select * into r from rechnung where id = p_rechnung for update;
  if not found then raise exception 'Rechnung % nicht gefunden', p_rechnung; end if;
  if r.status = 'storniert' then raise exception 'Rechnung ist bereits storniert'; end if;
  if r.status = 'bezahlt' then raise exception 'Rechnung ist als bezahlt markiert — erst auf „offen“ setzen'; end if;

  update buchung set rechnung_id = null where rechnung_id = p_rechnung;
  update rechnung set status = 'storniert', storniert_am = now(), storniert_von = p_bearbeiter,
                      storno_grund = trim(p_grund)
   where id = p_rechnung;
end $$;

-- ---------------------------------------------------------------------
--  Automatische Nummern
--  Artikel und Einzelstücke teilen sich einen Nummernraum (ein Scan muss
--  eindeutig sein): Buchstabe + Gruppe 1–9 → B-1xx. Vergeben wird immer
--  die höchste vorhandene Nummer + 1; Lücken werden nicht aufgefüllt.
--  Räder: Kürzel nach Typ + laufende Nummer → BR-01.
-- ---------------------------------------------------------------------
create function naechster_code(p_buchstabe text, p_gruppe integer)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_b    text := upper(trim(coalesce(p_buchstabe, '')));
  v_max  integer;
  v_n    integer;
begin
  if v_b !~ '^[A-Z]{1,3}$' then raise exception 'Buchstabe: 1 bis 3 Buchstaben A–Z'; end if;
  if p_gruppe is null or p_gruppe < 1 or p_gruppe > 9 then raise exception 'Gruppe: Ziffer 1 bis 9'; end if;

  select max(substring(c from '-([0-9]{3})$')::integer) into v_max
    from (select code as c from artikel union all select nummer from stueck) x
   where c ~ ('^' || v_b || '-' || p_gruppe || '[0-9]{2}$');

  v_n := coalesce(v_max + 1, p_gruppe * 100 + 1);
  if v_n > p_gruppe * 100 + 99 then
    raise exception 'Nummernkreis %-%xx ist voll', v_b, p_gruppe;
  end if;
  return v_b || '-' || v_n;
end $$;

create function rad_kuerzel(p_typ text) returns text
language sql immutable as $$
  select case p_typ when 'Bahn' then 'BR' when 'Straße' then 'SR' when 'Zeitfahren' then 'ZF'
                    when 'Cross' then 'CX' else 'SO' end;
$$;

create function naechste_rad_id(p_typ text)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_k    text := rad_kuerzel(p_typ);
  v_max  integer;
begin
  select max(substring(id from '-([0-9]+)$')::integer) into v_max
    from rad where id ~ ('^' || v_k || '-[0-9]+$');
  return v_k || '-' || lpad((coalesce(v_max, 0) + 1)::text, 2, '0');
end $$;

create function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_code := naechster_code(p_buchstabe, p_gruppe);
  insert into artikel (code, name, einheit, preis, mindestbestand, lieferzeit_tage, art,
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv)
  values (v_code,
          p_daten ->> 'name',
          coalesce(nullif(p_daten ->> 'einheit', ''), 'Stück'),
          coalesce((p_daten ->> 'preis')::numeric, 0),
          coalesce((p_daten ->> 'mindestbestand')::numeric, 0),
          coalesce((p_daten ->> 'lieferzeit_tage')::integer, 0),
          coalesce(p_daten ->> 'art', 'Stück'),
          nullif(p_daten ->> 'verbraucht_code', ''),
          (p_daten ->> 'verbrauch_menge')::numeric,
          nullif(p_daten ->> 'lieferant', ''),
          nullif(p_daten ->> 'bestellnummer', ''),
          nullif(p_daten ->> 'shop_link', ''),
          coalesce((p_daten ->> 'aktiv')::boolean, true));
  return v_code;
end $$;

create function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''));
  return v_nr;
end $$;

create function rad_anlegen(p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  text;
  v_typ text := coalesce(nullif(p_daten ->> 'typ', ''), 'Bahn');
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_id := naechste_rad_id(v_typ);
  insert into rad (id, bezeichnung, typ, marke, rahmennummer, groesse, eigentuemer_id, aktiv, notiz)
  values (v_id,
          p_daten ->> 'bezeichnung',
          v_typ,
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'rahmennummer', ''),
          nullif(p_daten ->> 'groesse', ''),
          (p_daten ->> 'eigentuemer_id')::bigint,
          coalesce((p_daten ->> 'aktiv')::boolean, true),
          nullif(p_daten ->> 'notiz', ''));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Foto hochladen — mit Kennung vom Gerät, kommt nur einmal an.
-- ---------------------------------------------------------------------
create function foto_hochladen(p_ticket bigint, p_thumb text, p_bild text, p_mime text default 'image/jpeg',
                               p_bearbeiter text default null, p_client_id uuid default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
begin
  if p_client_id is not null then
    select id into v_id from foto where client_id = p_client_id;
    if found then return v_id; end if;
  end if;
  if not exists (select 1 from ticket where id = p_ticket and status <> 'storniert') then
    raise exception 'Ticket % nicht gefunden oder storniert', p_ticket;
  end if;
  insert into foto (ticket_id, client_id, bearbeiter, mime, thumb, bild)
  values (p_ticket, p_client_id, p_bearbeiter, coalesce(p_mime, 'image/jpeg'), p_thumb, p_bild)
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from foto where client_id = p_client_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Zugriffsregeln: Rechnungen nur zwischen offen und bezahlt wechseln,
--  stornieren nur über die Funktion.
-- ---------------------------------------------------------------------
drop policy offen on rechnung;
create policy offen_lesen   on rechnung for select to anonymous using (true);
create policy offen_aendern on rechnung for update to anonymous
  using (status in ('offen', 'bezahlt'))
  with check (status in ('offen', 'bezahlt'));

-- Rechte für anonyme Anfragen neu setzen (gleicher Stand wie schema.sql 5.0.0)
revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on all tables in schema public to anonymous;
revoke select on trainer from anonymous;
grant insert on stueck, termin, koffer_soll, sportler, rad, artikel, person to anonymous;
grant insert (art, code, menge, ort, notiz, bearbeiter) on buchung to anonymous;
grant insert (ticket_id, code, menge) on ticket_position to anonymous;
grant update on stueck, koffer_soll, sportler, rad, artikel, person to anonymous;
grant update (soll_fertig, naechstmoeglich, anlass, aufwand, fahrbereit, arbeitsort,
              kostentraeger_id, status, uebernommen_von) on ticket to anonymous;
grant update (menge, status) on ticket_position to anonymous;
grant update (status) on rechnung to anonymous;
grant delete on termin, koffer_soll, foto to anonymous;
grant usage, select on all sequences in schema public to anonymous;

grant select, insert, update, delete on zaehlung, inventur_lauf, foto to authenticated;
grant select, insert, update, delete on v_offene_posten to authenticated;
grant usage, select on sequence foto_id_seq to authenticated;

-- Funktionen
revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  inventur_buchen(text, jsonb, text, uuid),
  buchung_stornieren(bigint, text, text),
  rechnung_stornieren(bigint, text, text),
  naechster_code(text, integer),
  rad_kuerzel(text),
  naechste_rad_id(text),
  artikel_anlegen(text, integer, jsonb),
  stueck_anlegen(text, integer, jsonb),
  rad_anlegen(jsonb),
  foto_hochladen(bigint, text, text, text, text, uuid)
to authenticated;
grant execute on function
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  inventur_buchen(text, jsonb, text, uuid),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid),
  ticket_abschliessen(bigint, text),
  ticket_stornieren(bigint, text),
  rechnung_erstellen(bigint, date, date),
  rechnung_stornieren(bigint, text, text),
  buchung_stornieren(bigint, text, text),
  naechster_code(text, integer),
  rad_kuerzel(text),
  naechste_rad_id(text),
  artikel_anlegen(text, integer, jsonb),
  stueck_anlegen(text, integer, jsonb),
  rad_anlegen(jsonb),
  foto_hochladen(bigint, text, text, text, text, uuid)
to anonymous;

commit;
