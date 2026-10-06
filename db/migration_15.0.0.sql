-- =====================================================================
--  Werkstatt — Migration auf 15.0.0: Lagerorte selbst anlegen
--  (Räume und Koffer/Werkzeugkästen je Standort)
--
--  Vorher muss gelaufen sein: db/migration_14.3.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Empfehlung: vorher auf einem Neon-Branch testen.
--
--  Was passiert:
--  - Neue Tabelle lagerort (Name, Art raum/koffer, aktiv, Reihenfolge).
--    Jeder vorhandene Standort bekommt „Werkstatt“ (Hauptraum) sowie
--    „Koffer Bahn“ und „Koffer Straße“ (Koffer) — die bisherigen festen
--    Orte. Nicht gebrauchte Koffer lassen sich danach in der App löschen.
--  - Der feste Typ lagerort (nur diese drei Namen) entfällt. Die Spalten
--    buchung.ort, ticket.arbeitsort, koffer_soll.ort, termin.koffer,
--    zaehlung.ort und inventur_lauf.ort werden text und verweisen über
--    (Standort, Name) auf lagerort; ein Umbenennen zieht überall nach.
--    Einzelstücke (stueck.ort) prüft ein Trigger.
--  - Sicht v_bestand: statt werkstatt/koffer_bahn/koffer_strasse jetzt
--    lager (alle Räume) und koffer (alle Koffer); frei = lager minus
--    Reservierungen in Räumen. Neue Sicht v_bestand_ort (je Artikel und Ort).
--  - Neue Funktionen lagerort_anlegen, lagerort_aendern, lagerort_loeschen,
--    lagerorte_sortieren (nur Werkstatt-Manager); Buchungsfunktionen
--    prüfen, dass der Ort existiert und aktiv ist.
--  Vorhandene Buchungen, Tickets, Packlisten, Termine und Einzelstücke
--  bleiben unverändert. Hinweise wie „No privileges could be revoked for
--  pgp_…“ sind harmlos (Funktionen der Erweiterung pgcrypto).
--  Lässt sich gefahrlos ein zweites Mal ausführen.
-- =====================================================================

begin;

-- 1. Sichten, die die Spalten benutzen, vorübergehend entfernen
drop view if exists v_bestand;
drop view if exists v_bestand_ort;
drop view if exists v_koffer;

-- Zugriffsregeln, die die Spalten benutzen, werden unten neu angelegt
drop policy if exists zugang on buchung;
drop policy if exists aendern on ticket;

-- 2. Alte Prüfungen auf die festen Namen entfernen
do $$
declare
  c record;
begin
  for c in select conrelid::regclass as tab, conname from pg_constraint
            where contype = 'c' and conrelid in ('stueck'::regclass, 'koffer_soll'::regclass, 'termin'::regclass)
              and pg_get_constraintdef(oid) like '%Werkstatt%' loop
    execute format('alter table %s drop constraint %I', c.tab, c.conname);
  end loop;
end $$;

-- 3. Spalten auf text, fester Typ weg
alter table ticket alter column arbeitsort drop default;
alter table ticket alter column arbeitsort type text;
alter table ticket alter column arbeitsort set default 'Werkstatt';
alter table buchung alter column ort type text;
alter table koffer_soll alter column ort type text;
alter table termin alter column koffer type text;
alter table zaehlung alter column ort type text;
alter table inventur_lauf alter column ort type text;

create or replace function inventur_buchen(p_ort text, p_zaehlung jsonb, p_bearbeiter text default null,
                                           p_lauf uuid default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st     bigint := recht_arbeiten();
  v_z      jsonb;
  v_code   text;
  v_g      numeric;
  v_b      numeric;
  v_ort    text := p_ort;
  v_anzahl integer := 0;
begin
  p_bearbeiter := ich_name();
  if p_lauf is not null then
    perform pg_advisory_xact_lock(hashtext(p_lauf::text));
    select korrekturen into v_anzahl from inventur_lauf where id = p_lauf;
    if found then return v_anzahl; end if;     -- schon gebucht
    v_anzahl := 0;
  end if;
  perform ort_pruefen(v_st, v_ort);

  for v_z in select * from jsonb_array_elements(coalesce(p_zaehlung, '[]'::jsonb)) loop
    v_code := v_z ->> 'code';
    v_g    := (v_z ->> 'gezaehlt')::numeric;
    v_b    := coalesce((v_z ->> 'basis')::numeric, 0);
    if v_g is null or v_g < 0 then raise exception 'Ungültige Zählung für %', v_code; end if;
    if not exists (select 1 from artikel where code = v_code and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', v_code; end if;

    if v_g <> v_b then
      insert into buchung (art, code, menge, ort, notiz, bearbeiter, standort_id)
      values ('korrektur', v_code, v_g - v_b, v_ort,
              'Inventur: gezählt ' || v_g || ', System beim Zählen ' || v_b, p_bearbeiter, v_st);
      v_anzahl := v_anzahl + 1;
    end if;
    insert into zaehlung (code, ort, bearbeiter, standort_id) values (v_code, v_ort, p_bearbeiter, v_st)
    on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  end loop;

  if p_lauf is not null then
    insert into inventur_lauf (id, ort, bearbeiter, gezaehlt, korrekturen, standort_id)
    values (p_lauf, v_ort, p_bearbeiter, jsonb_array_length(coalesce(p_zaehlung, '[]'::jsonb)), v_anzahl, v_st);
  end if;
  return v_anzahl;
end $$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'lagerort' and typtype = 'd') then drop domain lagerort; end if;
end $$;

-- 4. Tabelle lagerort
-- Lagerorte je Standort (ab 15.0.0): Räume und Koffer/Werkzeugkästen.
-- Der Hauptraum „Werkstatt“ gibt es an jedem Standort genau einmal; er
-- lässt sich nicht umbenennen, deaktivieren oder löschen. Buchungen,
-- Tickets, Packlisten, Termine und Inventur verweisen über (Standort, Name)
-- auf den Ort — ein Umbenennen zieht dadurch überall nach.
create table if not exists lagerort (
  id           bigint generated always as identity primary key,
  standort_id  bigint not null references standort (id),
  name         text not null check (name = trim(name) and name <> '' and length(name) <= 40
                                    and name not in ('am Rad', 'ausgemustert', 'alle') and position('|' in name) = 0),
  art          text not null check (art in ('raum', 'koffer')),
  haupt        boolean not null default false,
  aktiv        boolean not null default true,
  reihenfolge  integer not null default 0,
  constraint lagerort_standort_name_key unique (standort_id, name),
  constraint lagerort_haupt_check check (not haupt or (art = 'raum' and aktiv))
);
create unique index if not exists lagerort_ein_haupt on lagerort (standort_id) where haupt;

alter table lagerort enable row level security;
drop policy if exists lesen on lagerort;
create policy lesen on lagerort for select to anonymous
  using (standort_id = (select akt_standort()));
grant select on lagerort to anonymous;

-- 5. Die bisherigen festen Orte für jeden Standort
insert into lagerort (standort_id, name, art, haupt, reihenfolge)
select s.id, x.name, x.art, x.haupt, x.r
from standort s
cross join (values ('Werkstatt', 'raum', true, 0), ('Koffer Bahn', 'koffer', false, 1), ('Koffer Straße', 'koffer', false, 2))
           as x(name, art, haupt, r)
on conflict do nothing;

-- 6. Verweise auf lagerort
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'buchung_ort_fkey') then
    alter table buchung add constraint buchung_ort_fkey foreign key (standort_id, ort) references lagerort (standort_id, name) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ticket_arbeitsort_fkey') then
    alter table ticket add constraint ticket_arbeitsort_fkey foreign key (standort_id, arbeitsort) references lagerort (standort_id, name) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'koffer_soll_ort_fkey') then
    alter table koffer_soll add constraint koffer_soll_ort_fkey foreign key (standort_id, ort) references lagerort (standort_id, name) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'termin_koffer_fkey') then
    alter table termin add constraint termin_koffer_fkey foreign key (standort_id, koffer) references lagerort (standort_id, name) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'zaehlung_ort_fkey') then
    alter table zaehlung add constraint zaehlung_ort_fkey foreign key (standort_id, ort) references lagerort (standort_id, name) on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventur_lauf_ort_fkey') then
    alter table inventur_lauf add constraint inventur_lauf_ort_fkey foreign key (standort_id, ort) references lagerort (standort_id, name) on update cascade;
  end if;
end $$;

-- 7. Funktionen
create or replace function standard_lagerorte(p_standort bigint) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into lagerort (standort_id, name, art, haupt, reihenfolge)
  values (p_standort, 'Werkstatt', 'raum', true, 0)
  on conflict do nothing;
$$;

create or replace function standort_anlegen(p_name text, p_kuerzel text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if not ist_admin() then raise exception 'Standorte legt nur der Gesamt-Admin an'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Name fehlt'; end if;
  if upper(trim(coalesce(p_kuerzel, ''))) !~ '^[A-Z]{2,3}$' then raise exception 'Kürzel: 2 bis 3 Buchstaben A–Z'; end if;
  if exists (select 1 from standort where kuerzel = upper(trim(p_kuerzel))) then raise exception 'Das Kürzel ist schon vergeben'; end if;
  insert into standort (name, kuerzel) values (trim(p_name), upper(trim(p_kuerzel))) returning id into v_id;
  perform standard_kategorien(v_id);
  perform standard_lagerorte(v_id);
  return v_id;
end $$;

create or replace function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_arbeiten();
  a      artikel;
  v_abr  boolean := false;
  v_grp  uuid;
begin
  p_bearbeiter := ich_name();
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select * into a from artikel where code = p_code and standort_id = v_st;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  perform ort_pruefen(v_st, p_ort);
  if p_sportler is not null then
    select abrechnen into v_abr from sportler where id = p_sportler and standort_id = v_st;
    if not found then raise exception 'Unbekannter Sportler'; end if;
  end if;
  if p_ticket is not null and not exists (select 1 from ticket where id = p_ticket and standort_id = v_st) then
    raise exception 'Ticket % nicht gefunden', p_ticket;
  end if;
  if a.art = 'Pauschale' and a.verbraucht_code is not null and a.verbrauch_menge is not null then
    if not exists (select 1 from artikel v where v.code = a.verbraucht_code and v.standort_id = v_st) then
      raise exception 'Der Verbrauch von % (%) gehört nicht zu diesem Standort – bitte am Artikel korrigieren', p_code, a.verbraucht_code;
    end if;
    v_grp := gen_random_uuid();
  end if;

  insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
  values ('entnahme', p_code, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter, v_grp, v_st);

  if v_grp is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter, v_grp, v_st);
  end if;

  return a.preis * p_menge;
end $$;

create or replace function umbuchen(p_code text, p_menge numeric, p_von text, p_nach text,
                                    p_notiz text default null, p_bearbeiter text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  g    uuid   := gen_random_uuid();
begin
  p_bearbeiter := ich_name();
  if p_von = p_nach then raise exception 'Von und nach sind gleich'; end if;
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  if not exists (select 1 from artikel where code = p_code and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', p_code; end if;
  perform ort_pruefen(v_st, p_von);
  perform ort_pruefen(v_st, p_nach);
  insert into buchung (art, code, menge, ort, gruppe, notiz, bearbeiter, standort_id) values
    ('umbuchung', p_code, -p_menge, p_von,  g, p_notiz, p_bearbeiter, v_st),
    ('umbuchung', p_code,  p_menge, p_nach, g, p_notiz, p_bearbeiter, v_st);
end $$;

create or replace function inventur(p_code text, p_ort text, p_gezaehlt numeric, p_bearbeiter text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st    bigint := recht_arbeiten();
  v_ist   numeric;
  v_diff  numeric;
begin
  p_bearbeiter := ich_name();
  if p_gezaehlt is null or p_gezaehlt < 0 then raise exception 'Gezählte Menge fehlt'; end if;
  if not exists (select 1 from artikel where code = p_code and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', p_code; end if;
  perform ort_pruefen(v_st, p_ort);
  select coalesce(sum(menge), 0) into v_ist from buchung where code = p_code and ort = p_ort and standort_id = v_st;
  v_diff := p_gezaehlt - v_ist;
  if v_diff <> 0 then
    insert into buchung (art, code, menge, ort, notiz, bearbeiter, standort_id)
    values ('korrektur', p_code, v_diff, p_ort, 'Inventur: gezählt ' || p_gezaehlt || ', vorher ' || v_ist, p_bearbeiter, v_st);
  end if;
  insert into zaehlung (code, ort, bearbeiter, standort_id) values (p_code, p_ort, p_bearbeiter, v_st)
  on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  return v_diff;
end $$;

create or replace function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st       bigint;
  v_rolle    text;
  v_id       bigint;
  v_rad      text := nullif(trim(coalesce(p_rad, '')), '');
  v_fahrer   bigint;
  v_kt       bigint;
  v_pos      jsonb;
  v_stuecke  text[];
  v_fehlt    text;
  v_raeder   text[];
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  v_rolle := meine_rolle();
  if v_rolle not in ('admin', 'manager', 'trainer', 'sportler') then raise exception 'Keine Berechtigung'; end if;
  p_bearbeiter := ich_name();

  if p_client_id is not null then
    select id into v_id from ticket where client_id = p_client_id;
    if found then return v_id; end if;
  end if;

  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  -- Einzelstücke: beide Angaben zusammen, ohne Leere und Doppelte, Reihenfolge bleibt
  select coalesce(array_agg(n order by i), '{}') into v_stuecke
    from (select n, min(i) as i
            from unnest(coalesce(p_stuecke, '{}') || array[p_stueck]) with ordinality as x(n, i)
           where nullif(trim(n), '') is not null
           group by n) y;

  select string_agg(n, ', ') into v_fehlt
    from unnest(v_stuecke) as n where not exists (select 1 from stueck where nummer = n and standort_id = v_st);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  -- Ohne Rad: stecken die Teile an genau einem Rad, gilt das Ticket für dieses Rad
  if v_rad is null and cardinality(v_stuecke) > 0 then
    select array_agg(distinct rad_id) into v_raeder from stueck where nummer = any (v_stuecke) and rad_id is not null;
    if cardinality(v_raeder) = 1 then v_rad := v_raeder[1]; end if;
  end if;
  -- Ohne Rad und ohne Einzelstück: allgemeines Ticket (z. B. Werkstatt aufräumen), nicht für Sportler

  if v_rolle = 'sportler' then
    if v_rad is null or not mein_rad(v_rad) then raise exception 'Tickets nur für die eigenen Räder'; end if;
    if exists (select 1 from stueck where nummer = any (v_stuecke) and rad_id is distinct from v_rad) then
      raise exception 'Nur Teile, die an deinem Rad sind';
    end if;
    p_positionen := '[]'::jsonb;
    p_arbeitsort := 'Werkstatt';
    -- Pro Rad höchstens ein offenes Ticket, wenn ein Sportler meldet
    perform pg_advisory_xact_lock(hashtext('ticket_rad_' || v_rad));
    select id into v_id from ticket where rad_id = v_rad and status in ('offen', 'angenommen') order by id limit 1;
    if v_id is not null then
      raise exception 'Für dieses Rad ist schon ein Ticket offen (T-%) – ergänze dort Fotos oder sprich die Werkstatt an', lpad(v_id::text, 4, '0');
    end if;
  end if;

  p_arbeitsort := coalesce(nullif(trim(p_arbeitsort), ''), 'Werkstatt');
  perform ort_pruefen(v_st, p_arbeitsort);

  if v_rad is not null then
    select eigentuemer_id into v_kt from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id, standort_id)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id, v_st)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- Gleichzeitig angekommen: das andere hat gewonnen, dessen Ticket gilt.
  if v_id is null then
    select id into v_id from ticket where client_id = p_client_id;
    return v_id;
  end if;

  insert into ticket_stueck (ticket_id, nummer) select v_id, n from unnest(v_stuecke) as n;

  -- Schritte: {"code":"A-104","menge":1} oder {"titel":"Laufrad zentrieren","dauer_min":20}
  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    if nullif(v_pos ->> 'code', '') is not null
       and not exists (select 1 from artikel where code = v_pos ->> 'code' and standort_id = v_st) then
      raise exception 'Unbekannter Artikel: %', v_pos ->> 'code';
    end if;
    insert into ticket_position (ticket_id, code, titel, menge, dauer_min)
    values (v_id, nullif(v_pos ->> 'code', ''), nullif(trim(v_pos ->> 'titel'), ''),
            coalesce((v_pos ->> 'menge')::numeric, 1), (v_pos ->> 'dauer_min')::integer);
  end loop;

  -- Einzelstücke mit Ticket müssen geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  update stueck set zustand = 'zu prüfen' where nummer = any (v_stuecke) and zustand = 'frei';

  return v_id;
end $$;

create or replace function ort_pruefen(p_st bigint, p_ort text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_aktiv boolean;
begin
  select aktiv into v_aktiv from lagerort where standort_id = p_st and name = p_ort;
  if not found then raise exception 'Unbekannter Lagerort: %', coalesce(p_ort, '–'); end if;
  if not v_aktiv then raise exception 'Der Lagerort % ist deaktiviert', p_ort; end if;
end $$;

create or replace function lagerort_name_pruefen(p_st bigint, p_name text, p_ohne bigint) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text := trim(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'Name fehlt'; end if;
  if length(v) > 40 then raise exception 'Name zu lang (höchstens 40 Zeichen)'; end if;
  if v in ('am Rad', 'ausgemustert', 'alle') or position('|' in v) > 0 then
    raise exception 'Diesen Namen bitte nicht verwenden: %', v;
  end if;
  if exists (select 1 from lagerort where standort_id = p_st and lower(name) = lower(v) and id is distinct from p_ohne) then
    raise exception 'Den Lagerort % gibt es schon', v;
  end if;
  return v;
end $$;

create or replace function lagerort_anlegen(p_name text, p_art text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_manager();
  v_name text;
  v_id   bigint;
begin
  if p_art is null or p_art not in ('raum', 'koffer') then raise exception 'Art fehlt: Raum oder Koffer'; end if;
  v_name := lagerort_name_pruefen(v_st, p_name, null);
  insert into lagerort (standort_id, name, art, reihenfolge)
  values (v_st, v_name, p_art, coalesce((select max(reihenfolge) from lagerort where standort_id = v_st), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;

-- Name, Art und aktiv ändern (leere Angaben bleiben, wie sie sind).
create or replace function lagerort_aendern(p_id bigint, p_name text default null, p_art text default null,
                                            p_aktiv boolean default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_manager();
  l      lagerort;
  v_name text;
begin
  select * into l from lagerort where id = p_id and standort_id = v_st for update;
  if not found then raise exception 'Lagerort nicht gefunden'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is not null then v_name := lagerort_name_pruefen(v_st, p_name, l.id); end if;

  if l.haupt and ((v_name is not null and v_name <> l.name) or (p_art is not null and p_art <> l.art) or p_aktiv is false) then
    raise exception '% ist der Hauptraum und lässt sich nicht umbenennen, umstellen oder deaktivieren', l.name;
  end if;

  if p_art is not null and p_art <> l.art then
    if p_art not in ('raum', 'koffer') then raise exception 'Art: Raum oder Koffer'; end if;
    if p_art = 'raum' and (exists (select 1 from koffer_soll where standort_id = v_st and ort = l.name)
                           or exists (select 1 from termin where standort_id = v_st and koffer = l.name)) then
      raise exception 'Erst Packliste und Termine von % entfernen, dann zum Raum machen', l.name;
    end if;
    update lagerort set art = p_art where id = l.id;
  end if;

  if p_aktiv is false and l.aktiv then
    if exists (select 1 from buchung where standort_id = v_st and ort = l.name group by code having sum(menge) <> 0) then
      raise exception 'In % liegt noch Material – erst umbuchen oder per Inventur auf 0 setzen', l.name;
    end if;
    if exists (select 1 from stueck where standort_id = v_st and ort = l.name) then
      raise exception 'In % liegen noch Einzelstücke – erst einen anderen Ort wählen', l.name;
    end if;
    if exists (select 1 from ticket where standort_id = v_st and arbeitsort = l.name and status in ('offen', 'angenommen')) then
      raise exception 'Offene Tickets werden in % bearbeitet – erst abschließen oder Arbeitsort ändern', l.name;
    end if;
    update lagerort set aktiv = false where id = l.id;
  elsif p_aktiv is true and not l.aktiv then
    update lagerort set aktiv = true where id = l.id;
  end if;

  if v_name is not null and v_name <> l.name then
    update lagerort set name = v_name where id = l.id;          -- Buchungen, Tickets, Packlisten … ziehen nach
    update stueck set ort = v_name where standort_id = v_st and ort = l.name;
  end if;
end $$;

-- Löschen nur, solange der Ort nie benutzt wurde; sonst deaktivieren.
create or replace function lagerort_loeschen(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
  l    lagerort;
begin
  select * into l from lagerort where id = p_id and standort_id = v_st for update;
  if not found then raise exception 'Lagerort nicht gefunden'; end if;
  if l.haupt then raise exception '% ist der Hauptraum und lässt sich nicht löschen', l.name; end if;
  if exists (select 1 from stueck where standort_id = v_st and ort = l.name) then
    raise exception 'In % liegen noch Einzelstücke – erst einen anderen Ort wählen', l.name;
  end if;
  begin
    delete from koffer_soll where standort_id = v_st and ort = l.name;
    update termin set koffer = null where standort_id = v_st and koffer = l.name;
    delete from lagerort where id = l.id;
  exception when foreign_key_violation then
    raise exception '% wurde schon benutzt (Buchungen, Tickets oder Inventur) – bitte deaktivieren statt löschen', l.name;
  end;
end $$;

-- Reihenfolge der Anzeige: Liste der Kennungen von oben nach unten.
create or replace function lagerorte_sortieren(p_ids bigint[]) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
begin
  update lagerort l set reihenfolge = x.i
    from unnest(coalesce(p_ids, '{}')) with ordinality as x(id, i)
   where l.id = x.id and l.standort_id = v_st;
end $$;

-- Packlisten und Termine nur für Koffer.
create or replace function koffer_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ort text;
begin
  if tg_table_name = 'termin' then v_ort := new.koffer; else v_ort := new.ort; end if;
  if v_ort is not null
     and not exists (select 1 from lagerort where standort_id = new.standort_id and name = v_ort and art = 'koffer') then
    raise exception '% ist kein Koffer', v_ort;
  end if;
  return new;
end $$;

-- Einzelstücke liegen an einem Lagerort des Standorts, am Rad oder sind ausgemustert.
create or replace function stueck_ort_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ort in ('am Rad', 'ausgemustert') then return new; end if;
  if tg_op = 'UPDATE' and new.ort = old.ort and new.standort_id = old.standort_id then return new; end if;
  if not exists (select 1 from lagerort where standort_id = new.standort_id and name = new.ort and aktiv) then
    raise exception 'Unbekannter oder deaktivierter Lagerort: %', new.ort;
  end if;
  return new;
end $$;

drop trigger if exists koffer_soll_ort on koffer_soll;
drop trigger if exists termin_koffer on termin;
drop trigger if exists stueck_ort on stueck;
create trigger koffer_soll_ort       before insert or update on koffer_soll for each row execute function koffer_pruefen();
create trigger termin_koffer         before insert or update on termin      for each row execute function koffer_pruefen();
create trigger stueck_ort            before insert or update of ort, standort_id on stueck for each row execute function stueck_ort_pruefen();

-- 8. Sichten neu
create view v_bestand with (security_invoker = true) as
with b as (
  -- Räume zusammen = Lager („frei“ kommt daraus); Koffer zählen zum Bestand, aber nicht als frei
  select bu.code,
         sum(bu.menge) filter (where l.art = 'raum')   as lager,
         sum(bu.menge) filter (where l.art = 'koffer') as koffer
  from buchung bu
  join lagerort l on l.standort_id = bu.standort_id and l.name = bu.ort
  group by bu.code
), r as (
  -- Reservierungen blockieren nur Bestand in Räumen
  select p.code, sum(p.menge) as reserviert
  from ticket_position p
  join ticket t on t.id = p.ticket_id
  join lagerort l on l.standort_id = t.standort_id and l.name = t.arbeitsort
  where p.status = 'reserviert'
    and t.status in ('offen', 'angenommen')
    and l.art = 'raum'
  group by p.code
)
select a.code, a.name, a.einheit, a.art, a.preis, a.mindestbestand, a.lieferzeit_tage, a.aktiv,
       coalesce(b.lager, 0)          as lager,
       coalesce(b.koffer, 0)         as koffer,
       coalesce(b.lager, 0) + coalesce(b.koffer, 0) as gesamt,
       coalesce(r.reserviert, 0)     as reserviert,
       coalesce(b.lager, 0) - coalesce(r.reserviert, 0) as frei,
       case
         when a.art = 'Pauschale' then 'leistung'
         when coalesce(b.lager, 0) - coalesce(r.reserviert, 0) <= 0 then 'leer'
         when coalesce(b.lager, 0) - coalesce(r.reserviert, 0) < a.mindestbestand then 'nachbestellen'
         else 'ok'
       end as status
from artikel a
left join b using (code)
left join r using (code);

-- Bestand je Artikel und Ort (nur Orte, an denen etwas liegt)
create view v_bestand_ort with (security_invoker = true) as
select code, ort, sum(menge) as menge
from buchung
group by code, ort
having sum(menge) <> 0;

create view v_koffer with (security_invoker = true) as
select k.ort, k.code, a.name, a.einheit, k.soll,
       coalesce(i.ist, 0) as ist,
       greatest(k.soll - coalesce(i.ist, 0), 0) as fehlt
from koffer_soll k
join artikel a using (code)
left join lateral (
  select sum(b.menge) as ist from buchung b where b.code = k.code and b.ort = k.ort
) i on true;

-- 9. Zugriffsregeln: Zugang und Ticket-Arbeitsort nur auf aktive Orte
create policy zugang on buchung for insert to anonymous
  with check (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer'))
              and art = 'zugang' and menge > 0
              and exists (select 1 from artikel a where a.code = buchung.code)
              and exists (select 1 from lagerort l where l.standort_id = buchung.standort_id and l.name = buchung.ort and l.aktiv));
create policy aendern on ticket for update to anonymous
  using (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer'))
         and status in ('offen', 'angenommen'))
  with check (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer'))
              and status in ('offen', 'angenommen')
              and (kostentraeger_id is null or exists (select 1 from sportler s where s.id = ticket.kostentraeger_id))
              and exists (select 1 from lagerort l where l.standort_id = ticket.standort_id and l.name = ticket.arbeitsort and l.aktiv));

-- 10. Rechte
grant select on v_bestand, v_bestand_ort, v_koffer to anonymous;
grant usage, select on all sequences in schema public to anonymous;
revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  -- Hilfen, die die Zugriffsregeln und Spaltenvorgaben aufrufen
  kopfzeile(text), token_hash(text), ich_id(), ich_name(), ist_admin(), akt_standort(), meine_rolle(),
  rolle_in(text[]), mein_sportler(), mein_rad(text), standort_kuerzel(), eigener_code(text), code_buchstabe(text),
  -- Anmelden und Konto
  standorte_liste(), anmelde_liste(bigint),
  anmelden(bigint, text, bigint, text, text, boolean),
  einladung_pruefen(text), einladung_einloesen(text, text, text, boolean),
  ich(), abmelden(), pin_aendern(text, text),
  konten_liste(), konto_anlegen(text, text, bigint), konto_neuer_code(bigint),
  konto_aendern(bigint, text, text, boolean), sportler_zugang(bigint), standort_anlegen(text, text),
  standorte_verwaltung(), standort_manager_einladen(bigint, text), manager_neuer_code(bigint), manager_aktiv(bigint, boolean),
  -- Werkstatt
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  inventur_buchen(text, jsonb, text, uuid),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[]),
  ticket_abschliessen(bigint, text),
  ticket_stuecke_aendern(bigint, text[], text[]),
  ticket_stornieren(bigint, text),
  position_erledigen(bigint, text),
  position_zuruecknehmen(bigint, text),
  rechnung_erstellen(bigint, date, date),
  rechnung_stornieren(bigint, text, text),
  buchung_stornieren(bigint, text, text),
  naechster_code(text, integer),
  rad_kuerzel(text),
  naechste_rad_id(text),
  artikel_anlegen(text, integer, jsonb),
  stueck_anlegen(text, integer, jsonb),
  stueck_serie_anlegen(text, integer, jsonb, integer),
  tags_setzen(text, text[], bigint[]),
  tag_zuordnen(bigint, text, text[], text[]),
  rad_anlegen(jsonb),
  foto_hochladen(bigint, text, text, text, text, uuid),
  lagerort_anlegen(text, text),
  lagerort_aendern(bigint, text, text, boolean),
  lagerort_loeschen(bigint),
  lagerorte_sortieren(bigint[])
to anonymous;

commit;
