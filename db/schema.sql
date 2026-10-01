-- =====================================================================
--  Werkstatt RSZ MV — Datenbankschema für Neon (Data API + Neon Auth)
--
--  Stand 4.0.0 — für eine NEUE, leere Datenbank.
--  (Bestehende Datenbank von 3.0.0: db/migration_4.0.0.sql verwenden.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen.
--  Danach: Data API → "Refresh schema cache".
--
--  Zugriff: ohne Anmeldung über den anonymen Schlüssel von Neon Auth.
--  Lesen, anlegen, ändern ja — löschen nein (siehe Abschnitt Zugriff).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Grundtypen
-- ---------------------------------------------------------------------
create domain lagerort as text
  check (value in ('Werkstatt', 'Koffer Bahn', 'Koffer Straße'));

-- ---------------------------------------------------------------------
--  Trainer und Berechtigung
-- ---------------------------------------------------------------------
create table trainer (
  user_id    text primary key default (auth.user_id()),
  name       text not null,
  aktiv      boolean not null default false,
  angefragt  timestamptz not null default now()
);

-- Läuft mit den Rechten des Besitzers, damit die Prüfung nicht selbst
-- an der Zugriffsregel der Tabelle trainer hängen bleibt.
create function ist_trainer() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from trainer where user_id = auth.user_id() and aktiv);
$$;

-- Zugang anfragen. Wer sich zum ersten Mal anmeldet, legt damit seine
-- Zeile an (inaktiv). Gibt es noch gar keinen aktiven Trainer, wird
-- diese erste Person sofort freigeschaltet — das ist die Einrichtung.
create function zugang_anfragen(p_name text) returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare
  v_erster boolean;
begin
  if auth.user_id() is null then
    raise exception 'Nicht angemeldet';
  end if;
  select not exists (select 1 from trainer where aktiv) into v_erster;
  insert into trainer (user_id, name, aktiv)
  values (auth.user_id(), trim(p_name), v_erster)
  on conflict (user_id) do update set name = excluded.name;
  return exists (select 1 from trainer where user_id = auth.user_id() and aktiv);
end $$;

-- ---------------------------------------------------------------------
--  Stammdaten
-- ---------------------------------------------------------------------
-- Namen für "wer hat was gemacht". Jedes Gerät wählt selbst aus, unter
-- welchem Namen es bucht.
create table person (
  id     bigint generated always as identity primary key,
  name   text not null unique,
  aktiv  boolean not null default true
);

create table sportler (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  abrechnen  boolean not null default true,   -- LV / BSP: false
  aktiv      boolean not null default true
);

create table artikel (
  code             text primary key check (code ~ '^[A-Z]+-[0-9]+$'),
  name             text not null,
  einheit          text not null default 'Stück',
  preis            numeric(10,2) not null default 0 check (preis >= 0),
  mindestbestand   numeric not null default 0 check (mindestbestand >= 0),
  lieferzeit_tage  integer not null default 0 check (lieferzeit_tage >= 0),
  art              text not null default 'Stück' check (art in ('Stück', 'Vorrat', 'Pauschale')),
  verbraucht_code  text references artikel (code),
  verbrauch_menge  numeric check (verbrauch_menge is null or verbrauch_menge > 0),
  lieferant        text,
  bestellnummer    text,
  shop_link        text,
  aktiv            boolean not null default true
);

create table rad (
  id              text primary key,
  bezeichnung     text not null,
  typ             text not null default 'Bahn'
                  check (typ in ('Bahn', 'Straße', 'Zeitfahren', 'Cross', 'Sonstiges')),
  rahmennummer    text,
  groesse         text,
  eigentuemer_id  bigint references sportler (id),   -- zugleich Kostenträger für Tickets
  aktiv           boolean not null default true,
  notiz           text
);

-- Wer fährt welches Rad — mit Verlauf. Pro Rad gibt es höchstens einen
-- aktuellen Fahrer (gueltig_bis leer); das erzwingt der Index darunter.
create table zuordnung (
  id           bigint generated always as identity primary key,
  rad_id       text not null references rad (id),
  sportler_id  bigint not null references sportler (id),
  gueltig_ab   date not null default current_date,
  gueltig_bis  date,
  check (gueltig_bis is null or gueltig_bis >= gueltig_ab)
);
create unique index zuordnung_ein_aktueller_fahrer on zuordnung (rad_id) where gueltig_bis is null;

-- Nummerierte Einzelstücke: Laufräder, Rahmen, Vorbauten, Werkzeug.
create table stueck (
  nummer        text primary key,
  typ           text not null,
  detail        text,
  seriennummer  text,
  kaufdatum     date,
  wert          numeric(10,2),
  ort           text not null default 'Werkstatt'
                check (ort in ('Werkstatt', 'Koffer Bahn', 'Koffer Straße', 'am Rad', 'ausgemustert')),
  rad_id        text references rad (id),
  zustand       text not null default 'frei' check (zustand in ('frei', 'zu prüfen', 'defekt')),
  notiz         text,
  check ((ort = 'am Rad') = (rad_id is not null))
);

-- ---------------------------------------------------------------------
--  Tickets
-- ---------------------------------------------------------------------
create table ticket (
  id                bigint generated always as identity primary key,
  angelegt          timestamptz not null default now(),
  rad_id            text not null references rad (id),
  fahrer_id         bigint references sportler (id),   -- Stand beim Anlegen, bleibt stehen
  problem           text not null,
  fahrbereit        boolean not null default true,
  aufwand           text not null default 'klein' check (aufwand in ('klein', 'mittel', 'groß')),
  soll_fertig       date,
  naechstmoeglich   boolean not null default false,
  anlass            text,
  kostentraeger_id  bigint references sportler (id),
  arbeitsort        lagerort not null default 'Werkstatt',
  status            text not null default 'offen'
                    check (status in ('offen', 'angenommen', 'erledigt', 'storniert')),
  trainer_id        text default (auth.user_id()),
  erledigt_am       timestamptz,
  angelegt_von      text,
  uebernommen_von   text,
  erledigt_von      text
);

create table ticket_position (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references ticket (id) on delete cascade,
  code       text not null references artikel (code),
  menge      numeric not null check (menge > 0),
  status     text not null default 'reserviert' check (status in ('reserviert', 'gebucht', 'storniert'))
);
create index ticket_position_offen on ticket_position (code) where status = 'reserviert';

-- ---------------------------------------------------------------------
--  Buchungen — das eine Journal, aus dem sich jeder Bestand ergibt.
--  Zugang positiv, Entnahme negativ. Eine Umbuchung sind zwei Zeilen
--  mit derselben "gruppe".
-- ---------------------------------------------------------------------
create table rechnung (
  id           bigint generated always as identity primary key,
  nummer       text not null unique,
  datum        date not null default current_date,
  sportler_id  bigint not null references sportler (id),
  von          date not null,
  bis          date not null,
  summe        numeric(10,2) not null default 0,
  status       text not null default 'offen' check (status in ('offen', 'bezahlt'))
);

create table buchung (
  id           bigint generated always as identity primary key,
  zeit         timestamptz not null default now(),
  art          text not null check (art in ('zugang', 'entnahme', 'umbuchung', 'korrektur')),
  code         text not null references artikel (code),
  menge        numeric not null check (menge <> 0),
  ort          lagerort not null,
  sportler_id  bigint references sportler (id),
  ticket_id    bigint references ticket (id),
  einzelpreis  numeric(10,2),                -- beim Buchen festgeschrieben, nie verlinkt
  abrechnen    boolean not null default false,
  rechnung_id  bigint references rechnung (id),
  gruppe       uuid,
  trainer_id   text default (auth.user_id()),
  notiz        text,
  bearbeiter   text
);
create index buchung_code_ort on buchung (code, ort);
create index buchung_offen on buchung (sportler_id) where abrechnen and rechnung_id is null;

-- ---------------------------------------------------------------------
--  Koffer und Termine — nur zur Übersicht und Warnung
-- ---------------------------------------------------------------------
create table koffer_soll (
  code  text not null references artikel (code),
  ort   lagerort not null check (ort <> 'Werkstatt'),
  soll  numeric not null check (soll >= 0),
  primary key (code, ort)
);

create table termin (
  id      bigint generated always as identity primary key,
  datum   date not null,
  name    text not null,
  koffer  lagerort check (koffer <> 'Werkstatt'),
  notiz   text
);

-- ---------------------------------------------------------------------
--  Sichten (laufen mit den Rechten des Aufrufers → Zugriffsregeln gelten)
-- ---------------------------------------------------------------------
create view v_bestand with (security_invoker = true) as
with b as (
  select code,
         sum(menge) filter (where ort = 'Werkstatt')     as werkstatt,
         sum(menge) filter (where ort = 'Koffer Bahn')   as koffer_bahn,
         sum(menge) filter (where ort = 'Koffer Straße') as koffer_strasse
  from buchung
  group by code
), r as (
  -- Reservierungen blockieren nur den Werkstattbestand
  select p.code, sum(p.menge) as reserviert
  from ticket_position p
  join ticket t on t.id = p.ticket_id
  where p.status = 'reserviert'
    and t.status in ('offen', 'angenommen')
    and t.arbeitsort = 'Werkstatt'
  group by p.code
)
select a.code, a.name, a.einheit, a.art, a.preis, a.mindestbestand, a.lieferzeit_tage, a.aktiv,
       coalesce(b.werkstatt, 0)      as werkstatt,
       coalesce(b.koffer_bahn, 0)    as koffer_bahn,
       coalesce(b.koffer_strasse, 0) as koffer_strasse,
       coalesce(b.werkstatt, 0) + coalesce(b.koffer_bahn, 0) + coalesce(b.koffer_strasse, 0) as gesamt,
       coalesce(r.reserviert, 0)     as reserviert,
       coalesce(b.werkstatt, 0) - coalesce(r.reserviert, 0) as frei,
       case
         when a.art = 'Pauschale' then 'leistung'
         when coalesce(b.werkstatt, 0) - coalesce(r.reserviert, 0) <= 0 then 'leer'
         when coalesce(b.werkstatt, 0) - coalesce(r.reserviert, 0) < a.mindestbestand then 'nachbestellen'
         else 'ok'
       end as status
from artikel a
left join b using (code)
left join r using (code);

create view v_rad with (security_invoker = true) as
select r.id, r.bezeichnung, r.typ, r.rahmennummer, r.groesse, r.eigentuemer_id, r.aktiv, r.notiz,
       z.sportler_id as fahrer_id,
       s.name        as fahrer,
       z.gueltig_ab  as fahrer_seit
from rad r
left join zuordnung z on z.rad_id = r.id and z.gueltig_bis is null
left join sportler s  on s.id = z.sportler_id;

create view v_koffer with (security_invoker = true) as
select k.ort, k.code, a.name, a.einheit, k.soll,
       coalesce(i.ist, 0) as ist,
       greatest(k.soll - coalesce(i.ist, 0), 0) as fehlt
from koffer_soll k
join artikel a using (code)
left join lateral (
  select sum(b.menge) as ist from buchung b where b.code = k.code and b.ort = k.ort
) i on true;

-- ---------------------------------------------------------------------
--  Funktionen für alles, was in einem Schritt passieren muss
-- ---------------------------------------------------------------------

-- Material ausgeben — mit oder ohne Ticket. Preis wird festgeschrieben;
-- Pauschalen ziehen zusätzlich ihren hinterlegten Verbrauch ab.
create function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a      artikel;
  v_abr  boolean := false;
begin
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select * into a from artikel where code = p_code;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  if p_sportler is not null then
    select abrechnen into v_abr from sportler where id = p_sportler;
  end if;

  insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter)
  values ('entnahme', p_code, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter);

  if a.art = 'Pauschale' and a.verbraucht_code is not null and a.verbrauch_menge is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter);
  end if;

  return a.preis * p_menge;
end $$;

-- Material zwischen Werkstatt und Koffern verschieben (zwei Buchungen).
create function umbuchen(p_code text, p_menge numeric, p_von text, p_nach text,
                         p_notiz text default null, p_bearbeiter text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g uuid := gen_random_uuid();
begin
  if p_von = p_nach then raise exception 'Von und nach sind gleich'; end if;
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  insert into buchung (art, code, menge, ort, gruppe, notiz, bearbeiter) values
    ('umbuchung', p_code, -p_menge, p_von,  g, p_notiz, p_bearbeiter),
    ('umbuchung', p_code,  p_menge, p_nach, g, p_notiz, p_bearbeiter);
end $$;

-- Inventur: gezählten Bestand eintragen, die Differenz wird gebucht.
create function inventur(p_code text, p_ort text, p_gezaehlt numeric, p_bearbeiter text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ist   numeric;
  v_diff  numeric;
begin
  select coalesce(sum(menge), 0) into v_ist from buchung where code = p_code and ort = p_ort;
  v_diff := p_gezaehlt - v_ist;
  if v_diff <> 0 then
    insert into buchung (art, code, menge, ort, notiz, bearbeiter)
    values ('korrektur', p_code, v_diff, p_ort, 'Inventur: gezählt ' || p_gezaehlt || ', vorher ' || v_ist, p_bearbeiter);
  end if;
  return v_diff;
end $$;

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt.
create function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      bigint;
  v_fahrer  bigint;
  v_kt      bigint;
  v_pos     jsonb;
begin
  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  select sportler_id into v_fahrer from zuordnung where rad_id = p_rad and gueltig_bis is null;
  select eigentuemer_id into v_kt from rad where id = p_rad;
  if not found then raise exception 'Unbekanntes Rad: %', p_rad; end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von)
  values (p_rad, v_fahrer, trim(p_problem), p_fahrbereit, p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter)
  returning id into v_id;

  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    insert into ticket_position (ticket_id, code, menge)
    values (v_id, v_pos ->> 'code', coalesce((v_pos ->> 'menge')::numeric, 1));
  end loop;

  return v_id;
end $$;

-- Ticket abschließen: jede reservierte Position wird zur Entnahme am
-- Arbeitsort. Blockiert, solange ein Einzelstück am Rad "zu prüfen" ist.
create function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t        ticket;
  p        record;
  v_summe  numeric := 0;
  v_offen  text;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(nummer, ', ') into v_offen
    from stueck where rad_id = t.rad_id and zustand = 'zu prüfen';
  if v_offen is not null then raise exception 'Erst prüfen und freigeben: %', v_offen; end if;

  for p in select * from ticket_position
            where ticket_id = p_ticket and status = 'reserviert' for update loop
    v_summe := v_summe + material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, p_ticket, null, p_bearbeiter);
    update ticket_position set status = 'gebucht' where id = p.id;
  end loop;

  update ticket set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p_ticket;
  return v_summe;
end $$;

-- Fahrer eines Rads wechseln: alte Zuordnung schließen, neue öffnen.
-- p_sportler = null nimmt das Rad nur aus der Zuordnung.
create function rad_zuordnen(p_rad text, p_sportler bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update zuordnung set gueltig_bis = current_date
   where rad_id = p_rad and gueltig_bis is null;
  if p_sportler is not null then
    insert into zuordnung (rad_id, sportler_id) values (p_rad, p_sportler);
  end if;
end $$;

-- Rechnung festschreiben: offene, abzurechnende Entnahmen eines
-- Sportlers im Zeitraum bekommen eine Rechnungsnummer.
create function rechnung_erstellen(p_sportler bigint, p_von date, p_bis date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     bigint;
  v_nr     text;
  v_summe  numeric;
  v_jahr   text := to_char(current_date, 'YYYY');
begin
  select coalesce(sum(-menge * einzelpreis), 0) into v_summe
    from buchung
   where sportler_id = p_sportler and art = 'entnahme' and abrechnen and rechnung_id is null
     and (zeit at time zone 'Europe/Berlin')::date between p_von and p_bis;
  if v_summe = 0 then raise exception 'Keine offenen Posten im Zeitraum'; end if;

  select 'R-' || v_jahr || '-' || lpad((count(*) + 1)::text, 3, '0') into v_nr
    from rechnung where nummer like 'R-' || v_jahr || '-%';

  insert into rechnung (nummer, sportler_id, von, bis, summe)
  values (v_nr, p_sportler, p_von, p_bis, v_summe)
  returning id into v_id;

  update buchung set rechnung_id = v_id
   where sportler_id = p_sportler and art = 'entnahme' and abrechnen and rechnung_id is null
     and (zeit at time zone 'Europe/Berlin')::date between p_von and p_bis;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Zugriffsregeln
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['person', 'sportler', 'artikel', 'rad', 'zuordnung', 'stueck', 'ticket',
                           'ticket_position', 'buchung', 'rechnung', 'koffer_soll', 'termin'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy nur_trainer on %I for all to authenticated
                    using (ist_trainer()) with check (ist_trainer())', t);
  end loop;
end $$;

alter table trainer enable row level security;
create policy trainer_lesen     on trainer for select to authenticated using (ist_trainer() or user_id = auth.user_id());
create policy trainer_aendern   on trainer for update to authenticated using (ist_trainer()) with check (ist_trainer());
create policy trainer_entfernen on trainer for delete to authenticated using (ist_trainer());

-- Rechte: angemeldete Nutzer dürfen grundsätzlich, die Zeilen filtert RLS.
-- Anonyme Anfragen bekommen gar nichts.
revoke execute on all functions in schema public from public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
--  Zugriff ohne Anmeldung
--  Die App holt sich einen anonymen Schlüssel von Neon Auth. Damit darf sie
--  lesen, anlegen und ändern — aber nichts löschen (außer Renntermine und
--  Packlisten-Zeilen). Ins Buchungsjournal kommen von außen nur Zugänge;
--  alle anderen Buchungen laufen über die Funktionen oben.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['person', 'sportler', 'artikel', 'rad', 'zuordnung', 'stueck', 'ticket',
                           'ticket_position', 'rechnung', 'koffer_soll', 'termin'] loop
    execute format('drop policy if exists offen on %I', t);
    execute format('create policy offen on %I for all to anonymous using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists offen_lesen  on buchung;
drop policy if exists offen_zugang on buchung;
create policy offen_lesen  on buchung for select to anonymous using (true);
create policy offen_zugang on buchung for insert to anonymous with check (art = 'zugang');

revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on all tables in schema public to anonymous;
revoke select on trainer from anonymous;
grant insert on ticket_position, stueck, buchung, termin, koffer_soll, sportler, rad, artikel, person to anonymous;
grant update on ticket, ticket_position, stueck, koffer_soll, sportler, rad, artikel, person, rechnung to anonymous;
grant delete on termin, koffer_soll to anonymous;
grant usage, select on all sequences in schema public to anonymous;

revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text),
  ticket_abschliessen(bigint, text),
  rechnung_erstellen(bigint, date, date)
to anonymous;

commit;
