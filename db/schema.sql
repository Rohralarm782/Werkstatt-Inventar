-- =====================================================================
--  Werkstatt RSZ MV — Datenbankschema für Neon (Data API + Neon Auth)
--
--  Stand 12.0.0 — für eine NEUE, leere Datenbank.
--  (Bestehende Datenbank: die Migrationen in db/ der Reihe nach verwenden,
--   von 11.x aus nur db/migration_12.0.0.sql.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen.
--  Danach: Data API → "Refresh schema cache".
--
--  Zugriff: ohne Anmeldung über den anonymen Schlüssel von Neon Auth.
--  Lesen, anlegen, ändern ja — löschen nein (siehe Abschnitt Zugriff).
--  Abschließen, Stornieren und alle Buchungen außer Zugängen nur über die
--  Datenbankfunktionen.
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

-- Tags je Kategorie-Buchstabe (L → Schlauchreifen, Schläuche, …).
-- Die Kategorie selbst ist der Buchstabe im Code; Tags sind nur eine
-- Zuordnung (mehrere je Artikel/Einzelstück möglich, siehe artikel_tag und
-- stueck_tag) — Codes und Etiketten bleiben dabei unverändert.
create table tag (
  id          bigint generated always as identity primary key,
  buchstabe   text not null check (buchstabe ~ '^[A-Z]{1,3}$'),
  name        text not null check (trim(name) <> ''),
  sortierung  integer not null default 0,
  unique (buchstabe, name)
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
  aktiv            boolean not null default true,
  dauer_min        integer check (dauer_min is null or dauer_min >= 0)  -- Arbeitszeit je Stück bzw. Leistung
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
  notiz           text,
  marke           text
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
  marke         text,
  check ((ort = 'am Rad') = (rad_id is not null))
);

-- Tags der Artikel und Einzelstücke (nur Tags der eigenen Kategorie;
-- geändert wird über tags_setzen / tag_zuordnen bzw. beim Anlegen).
create table artikel_tag (
  code    text   not null references artikel (code) on update cascade on delete cascade,
  tag_id  bigint not null references tag (id) on delete cascade,
  primary key (code, tag_id)
);
create index artikel_tag_tag on artikel_tag (tag_id);

create table stueck_tag (
  nummer  text   not null references stueck (nummer) on update cascade on delete cascade,
  tag_id  bigint not null references tag (id) on delete cascade,
  primary key (nummer, tag_id)
);
create index stueck_tag_tag on stueck_tag (tag_id);

-- ---------------------------------------------------------------------
--  Tickets
-- ---------------------------------------------------------------------
create table ticket (
  id                bigint generated always as identity primary key,
  angelegt          timestamptz not null default now(),
  rad_id            text references rad (id),       -- Rad und/oder Einzelstücke (ticket_stueck); geprüft in den Funktionen
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
  erledigt_von      text,
  client_id         uuid unique,      -- Kennung vom Gerät, verhindert doppelte Tickets
  storniert_am      timestamptz,
  storniert_von     text
);

-- Einzelstücke eines Tickets (beliebig viele, z. B. Rad + Laufräder nach
-- einem Sturz). Geändert wird über ticket_anlegen / ticket_stuecke_aendern.
create table ticket_stueck (
  ticket_id  bigint not null references ticket (id) on delete cascade,
  nummer     text   not null references stueck (nummer) on update cascade,
  primary key (ticket_id, nummer)
);
create index ticket_stueck_nummer on ticket_stueck (nummer);

-- Arbeitsschritte eines Tickets: mit Material (code) oder als reiner Text (titel).
-- Jeder Schritt lässt sich einzeln abhaken (position_erledigen).
create table ticket_position (
  id            bigint generated always as identity primary key,
  ticket_id     bigint not null references ticket (id) on delete cascade,
  code          text references artikel (code),
  menge         numeric not null check (menge > 0),
  status        text not null default 'reserviert',
  titel         text,
  dauer_min     integer check (dauer_min is null or dauer_min >= 0),   -- nur für Schritte ohne Material
  erledigt_am   timestamptz,
  erledigt_von  text,
  buchung_id    bigint,                                                -- Entnahme beim Abhaken (Fremdschlüssel unten)
  constraint ticket_position_status_check check (status in ('reserviert', 'gebucht', 'erledigt', 'storniert')),
  constraint ticket_position_material_oder_text check (code is not null or coalesce(trim(titel), '') <> '')
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
  status       text not null default 'offen' check (status in ('offen', 'bezahlt', 'storniert')),
  storniert_am   timestamptz,
  storniert_von  text,
  storno_grund   text
);

create table buchung (
  id           bigint generated always as identity primary key,
  zeit         timestamptz not null default now(),
  art          text not null check (art in ('zugang', 'entnahme', 'umbuchung', 'korrektur', 'storno')),
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
  bearbeiter   text,
  storno_von   bigint unique references buchung (id)   -- Gegenbuchung zu dieser Zeile
);
create index buchung_code_ort on buchung (code, ort);
create index buchung_offen on buchung (sportler_id) where abrechnen and rechnung_id is null;
alter table ticket_position add constraint ticket_position_buchung_id_fkey foreign key (buchung_id) references buchung (id);

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

-- Inventur: wann wurde was wo zuletzt gezählt
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
-- Bestellungen: was wurde wann bestellt; ein Zugang schließt offene Bestellungen ab
create table bestellung (
  id           bigint generated always as identity primary key,
  code         text not null references artikel (code),
  menge        numeric not null check (menge > 0),
  bestellt_am  timestamptz not null default now(),
  bearbeiter   text,
  erhalten_am  timestamptz
);
create index bestellung_offen on bestellung (code) where erhalten_am is null;

-- Fotos am Ticket (verkleinert, als Base64-Text)
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
       z.gueltig_ab  as fahrer_seit,
       r.marke
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


-- Offene Posten: abzurechnende Entnahmen ohne Rechnung, nicht storniert
create view v_offene_posten with (security_invoker = true) as
select b.id, b.zeit, b.code, b.menge, b.einzelpreis, b.sportler_id, b.ticket_id, b.notiz, b.bearbeiter
from buchung b
where b.art = 'entnahme' and b.abrechnen and b.rechnung_id is null
  and not exists (select 1 from buchung s where s.storno_von = b.id);

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

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt. Kommt dieselbe
-- Kennung vom Gerät ein zweites Mal (Nachsenden nach Funkloch), gibt es kein
-- zweites Ticket. Einzelstücke: p_stuecke (Liste) und/oder p_stueck (eines,
-- für ältere App-Stände).
create function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id       bigint;
  v_rad      text := nullif(trim(coalesce(p_rad, '')), '');
  v_fahrer   bigint;
  v_kt       bigint;
  v_pos      jsonb;
  v_stuecke  text[];
  v_fehlt    text;
  v_raeder   text[];
begin
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
    from unnest(v_stuecke) as n where not exists (select 1 from stueck where nummer = n);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  -- Ohne Rad: stecken die Teile an genau einem Rad, gilt das Ticket für dieses Rad
  if v_rad is null and cardinality(v_stuecke) > 0 then
    select array_agg(distinct rad_id) into v_raeder from stueck where nummer = any (v_stuecke) and rad_id is not null;
    if cardinality(v_raeder) = 1 then v_rad := v_raeder[1]; end if;
  end if;
  if v_rad is null and cardinality(v_stuecke) = 0 then raise exception 'Rad oder Einzelstück fehlt'; end if;

  if v_rad is not null then
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
    select eigentuemer_id into v_kt from rad where id = v_rad;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id)
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
    insert into ticket_position (ticket_id, code, titel, menge, dauer_min)
    values (v_id, nullif(v_pos ->> 'code', ''), nullif(trim(v_pos ->> 'titel'), ''),
            coalesce((v_pos ->> 'menge')::numeric, 1), (v_pos ->> 'dauer_min')::integer);
  end loop;

  -- Einzelstücke mit Ticket müssen geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  update stueck set zustand = 'zu prüfen' where nummer = any (v_stuecke) and zustand = 'frei';

  return v_id;
end $$;

-- Ticket abschließen: alle noch offenen Schritte auf einmal (Material wird zur
-- Entnahme am Arbeitsort). Blockiert, solange ein Teil am Rad oder ein
-- Einzelstück des Tickets "zu prüfen" ist.
create function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t          ticket;
  p          record;
  v_summe    numeric := 0;
  v_offen    text;
  v_buchung  bigint;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(nummer, ', ' order by nummer) into v_offen
    from stueck
   where (rad_id = t.rad_id or nummer in (select nummer from ticket_stueck where ticket_id = p_ticket))
     and zustand = 'zu prüfen';
  if v_offen is not null then raise exception 'Erst prüfen und freigeben: %', v_offen; end if;

  for p in select * from ticket_position
            where ticket_id = p_ticket and status = 'reserviert' order by id for update loop
    if p.code is null then
      update ticket_position set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p.id;
    else
      v_summe := v_summe + material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, p_ticket, null, p_bearbeiter);
      select max(id) into v_buchung from buchung where ticket_id = p_ticket and code = p.code and art = 'entnahme';
      update ticket_position set status = 'gebucht', erledigt_am = now(), erledigt_von = p_bearbeiter, buchung_id = v_buchung
       where id = p.id;
    end if;
  end loop;

  update ticket set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p_ticket;
  return v_summe;
end $$;

-- Ticket stornieren: Ticket und alle Reservierungen in einem Schritt.
create function ticket_stornieren(p_ticket bigint, p_bearbeiter text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t ticket;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  update ticket_position set status = 'storniert' where ticket_id = p_ticket and status = 'reserviert';
  update ticket set status = 'storniert', storniert_am = now(), storniert_von = p_bearbeiter where id = p_ticket;
end $$;

-- ---------------------------------------------------------------------
--  Einzelstücke eines offenen Tickets nachtragen (p_mit) oder
--  herausnehmen (p_ohne). Nachgetragene „freie“ Teile werden „zu prüfen“;
--  ein herausgenommenes Teil, das auf „zu prüfen“ steht und an keinem
--  anderen offenen Ticket hängt, wird wieder „frei“. Ein Ticket ohne Rad
--  behält mindestens ein Einzelstück.
-- ---------------------------------------------------------------------
create function ticket_stuecke_aendern(p_ticket bigint, p_mit text[] default null, p_ohne text[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t        ticket;
  v_fehlt  text;
  v_neu    text[];
  v_weg    text[];
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(n, ', ') into v_fehlt
    from unnest(coalesce(p_mit, '{}')) as n where not exists (select 1 from stueck where nummer = n);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  with neu as (
    insert into ticket_stueck (ticket_id, nummer)
      select p_ticket, n from unnest(coalesce(p_mit, '{}')) as n
       where not (n = any (coalesce(p_ohne, '{}')))
      on conflict do nothing
      returning nummer
  ) select coalesce(array_agg(nummer), '{}') into v_neu from neu;
  update stueck set zustand = 'zu prüfen' where nummer = any (v_neu) and zustand = 'frei';

  with weg as (
    delete from ticket_stueck where ticket_id = p_ticket and nummer = any (coalesce(p_ohne, '{}'))
      returning nummer
  ) select coalesce(array_agg(nummer), '{}') into v_weg from weg;
  update stueck s set zustand = 'frei'
   where s.nummer = any (v_weg) and s.zustand = 'zu prüfen'
     and not exists (select 1 from ticket_stueck ts join ticket x on x.id = ts.ticket_id
                      where ts.nummer = s.nummer and x.status in ('offen', 'angenommen'))
     and not exists (select 1 from ticket x where x.rad_id = s.rad_id and x.status in ('offen', 'angenommen'));

  if t.rad_id is null and not exists (select 1 from ticket_stueck where ticket_id = p_ticket) then
    raise exception 'Ein Ticket ohne Rad braucht mindestens ein Einzelstück';
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Einen Schritt abhaken. Material wird sofort am Arbeitsort an den
--  Kostenträger gebucht; das Ticket bleibt offen. Gibt den Betrag zurück.
-- ---------------------------------------------------------------------
create function position_erledigen(p_position bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tid      bigint;
  t          ticket;
  p          ticket_position;
  v_betrag   numeric := 0;
  v_buchung  bigint;
begin
  select ticket_id into v_tid from ticket_position where id = p_position;
  if not found then raise exception 'Schritt % nicht gefunden', p_position; end if;
  select * into t from ticket where id = v_tid for update;          -- erst das Ticket, dann der Schritt (wie beim Abschließen)
  select * into p from ticket_position where id = p_position for update;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;
  if p.status <> 'reserviert' then raise exception 'Schritt ist schon erledigt oder freigegeben'; end if;

  if p.code is not null then
    v_betrag := material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, t.id, null, p_bearbeiter);
    select max(id) into v_buchung from buchung where ticket_id = t.id and code = p.code and art = 'entnahme';
    update ticket_position set status = 'gebucht', erledigt_am = now(), erledigt_von = p_bearbeiter, buchung_id = v_buchung
     where id = p.id;
  else
    update ticket_position set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter
     where id = p.id;
  end if;
  return v_betrag;
end $$;

-- ---------------------------------------------------------------------
--  Abgehakten Schritt zurücknehmen (vertippt). Die Buchung wird
--  storniert — nicht möglich, wenn sie schon auf einer Rechnung steht.
-- ---------------------------------------------------------------------
create function position_zuruecknehmen(p_position bigint, p_bearbeiter text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tid  bigint;
  t      ticket;
  p      ticket_position;
begin
  select ticket_id into v_tid from ticket_position where id = p_position;
  if not found then raise exception 'Schritt % nicht gefunden', p_position; end if;
  select * into t from ticket where id = v_tid for update;
  select * into p from ticket_position where id = p_position for update;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;
  if p.status not in ('gebucht', 'erledigt') then raise exception 'Schritt ist nicht abgehakt'; end if;
  if p.status = 'gebucht' and p.buchung_id is null then
    raise exception 'Buchung nicht zuzuordnen — bitte unter Material → Buchungen stornieren';
  end if;

  if p.buchung_id is not null and not exists (select 1 from buchung where storno_von = p.buchung_id) then
    perform buchung_stornieren(p.buchung_id, 'Schritt an T-' || lpad(t.id::text, 4, '0') || ' zurückgenommen', p_bearbeiter);
  end if;
  update ticket_position set status = 'reserviert', erledigt_am = null, erledigt_von = null, buchung_id = null
   where id = p.id;
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

-- Rechnung festschreiben: offene, abzurechnende Entnahmen eines Sportlers
-- im Zeitraum bekommen eine Rechnungsnummer. Datum und Jahr nach deutscher
-- Zeit, Nummer ohne Doppelvergabe, Summe genau aus den markierten Posten.
create function rechnung_erstellen(p_sportler bigint, p_von date default null, p_bis date default null)
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
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min)
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
          coalesce((p_daten ->> 'aktiv')::boolean, true),
          (p_daten ->> 'dauer_min')::integer);
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where t.buchstabe = p_buchstabe
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
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
  insert into stueck_tag (nummer, tag_id)
    select v_nr, t.id from tag t
     where t.buchstabe = p_buchstabe
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_nr;
end $$;

-- ---------------------------------------------------------------------
--  Serie von Einzelstücken anlegen: mehrere gleiche Teile in einem
--  Schritt, mit aufeinanderfolgenden Nummern. Alles oder nichts.
-- ---------------------------------------------------------------------
create function stueck_serie_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb, p_anzahl integer)
returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nummern text[] := '{}';
begin
  if p_anzahl is null or p_anzahl < 1 or p_anzahl > 50 then
    raise exception 'Anzahl: 1 bis 50';
  end if;
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  for i in 1 .. p_anzahl loop
    v_nummern := v_nummern || stueck_anlegen(p_buchstabe, p_gruppe, p_daten);
  end loop;
  return v_nummern;
end $$;

-- Tags setzen (ganz oder gar nicht)
create function tags_setzen(p_art text, p_schluessel text[], p_tags bigint[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_art = 'artikel' then
    delete from artikel_tag where code = any (p_schluessel);
    insert into artikel_tag (code, tag_id)
      select a.code, t.id from artikel a join tag t
        on t.buchstabe = substring(a.code from '^([A-Z]{1,3})-')
       where a.code = any (p_schluessel) and t.id = any (coalesce(p_tags, '{}'));
  elsif p_art = 'stueck' then
    delete from stueck_tag where nummer = any (p_schluessel);
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, t.id from stueck s join tag t
        on t.buchstabe = substring(s.nummer from '^([A-Z]{1,3})-')
       where s.nummer = any (p_schluessel) and t.id = any (coalesce(p_tags, '{}'));
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
end $$;

create function tag_zuordnen(p_tag bigint, p_art text, p_mit text[], p_ohne text[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t tag;
begin
  select * into t from tag where id = p_tag;
  if not found then raise exception 'Unbekannter Tag: %', p_tag; end if;
  if p_art = 'artikel' then
    delete from artikel_tag where tag_id = p_tag and code = any (coalesce(p_ohne, '{}'));
    insert into artikel_tag (code, tag_id)
      select a.code, p_tag from artikel a
       where a.code = any (coalesce(p_mit, '{}')) and substring(a.code from '^([A-Z]{1,3})-') = t.buchstabe
      on conflict do nothing;
  elsif p_art = 'stueck' then
    delete from stueck_tag where tag_id = p_tag and nummer = any (coalesce(p_ohne, '{}'));
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, p_tag from stueck s
       where s.nummer = any (coalesce(p_mit, '{}')) and substring(s.nummer from '^([A-Z]{1,3})-') = t.buchstabe
      on conflict do nothing;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
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

-- Ein Zugang schließt offene Bestellungen des Artikels ab.
create function bestellung_erhalten() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bestellung set erhalten_am = now() where code = new.code and erhalten_am is null;
  return null;
end $$;

create trigger zugang_schliesst_bestellung
  after insert on buchung
  for each row when (new.art = 'zugang')
  execute function bestellung_erhalten();


-- ---------------------------------------------------------------------
--  Zugriffsregeln
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['person', 'sportler', 'tag', 'artikel', 'artikel_tag', 'rad', 'zuordnung', 'stueck', 'stueck_tag', 'ticket',
                           'ticket_stueck', 'ticket_position', 'buchung', 'rechnung', 'koffer_soll', 'termin',
                           'zaehlung', 'inventur_lauf', 'foto', 'bestellung'] loop
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
--  lesen, anlegen und ändern — aber nichts löschen (außer Renntermine,
--  Packlisten-Zeilen, Fotos offener Tickets, Einzelstücke und Tags).
--  Ins Buchungsjournal kommen von außen nur Zugänge;
--  alle anderen Buchungen laufen über die Funktionen oben.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['person', 'sportler', 'tag', 'artikel', 'rad', 'zuordnung', 'stueck',
                           'koffer_soll', 'termin'] loop
    execute format('drop policy if exists offen on %I', t);
    execute format('create policy offen on %I for all to anonymous using (true) with check (true)', t);
  end loop;
end $$;

-- Tickets: nur offene/angenommene ändern; abschließen und stornieren gehen
-- ausschließlich über die Funktionen.
create policy offen_lesen   on ticket for select to anonymous using (true);
create policy offen_aendern on ticket for update to anonymous
  using (status in ('offen', 'angenommen'))
  with check (status in ('offen', 'angenommen'));

-- Reservierungen: nur an offenen Tickets, nur Menge ändern und freigeben.
create policy offen_lesen     on ticket_position for select to anonymous using (true);
create policy offen_vormerken on ticket_position for insert to anonymous
  with check (status = 'reserviert'
              and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));
create policy offen_aendern   on ticket_position for update to anonymous
  using (status = 'reserviert'
         and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')))
  with check (status in ('reserviert', 'storniert')
              and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));

-- Rechnungen: nur zwischen offen und bezahlt wechseln; stornieren nur über die Funktion.
create policy offen_lesen   on rechnung for select to anonymous using (true);
create policy offen_aendern on rechnung for update to anonymous
  using (status in ('offen', 'bezahlt'))
  with check (status in ('offen', 'bezahlt'));

-- Zählstand lesen; geschrieben wird er nur von den Inventur-Funktionen.
create policy offen_lesen on zaehlung for select to anonymous using (true);
create policy offen_lesen on inventur_lauf for select to anonymous using (true);

-- Bestellungen: lesen, als bestellt markieren, offene zurücknehmen.
create policy offen_lesen     on bestellung for select to anonymous using (true);
create policy offen_bestellen on bestellung for insert to anonymous with check (erhalten_am is null);
create policy offen_loeschen  on bestellung for delete to anonymous using (erhalten_am is null);

-- Fotos: lesen; hochladen über foto_hochladen; löschen nur an offenen Tickets.
create policy offen_lesen    on foto for select to anonymous using (true);
create policy offen_loeschen on foto for delete to anonymous
  using (exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));

-- Tag-Zuordnungen: lesen; geändert wird über tags_setzen / tag_zuordnen.
create policy offen_lesen on artikel_tag for select to anonymous using (true);
create policy offen_lesen on stueck_tag  for select to anonymous using (true);

-- Einzelstücke eines Tickets: lesen; geändert über ticket_anlegen / ticket_stuecke_aendern.
create policy offen_lesen on ticket_stueck for select to anonymous using (true);

-- Journal: lesen; von außen nur Zugänge mit positiver Menge.
create policy offen_lesen  on buchung for select to anonymous using (true);
create policy offen_zugang on buchung for insert to anonymous
  with check (art = 'zugang' and menge > 0);

revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on all tables in schema public to anonymous;
revoke select on trainer from anonymous;
grant insert on stueck, termin, koffer_soll, sportler, rad, artikel, person, tag to anonymous;
grant insert (art, code, menge, ort, notiz, bearbeiter) on buchung to anonymous;
grant insert (ticket_id, code, menge, titel, dauer_min) on ticket_position to anonymous;
grant insert (code, menge, bearbeiter) on bestellung to anonymous;
grant update on stueck, koffer_soll, sportler, rad, artikel, person, tag to anonymous;
grant update (soll_fertig, naechstmoeglich, anlass, aufwand, fahrbereit, arbeitsort,
              kostentraeger_id, status, uebernommen_von) on ticket to anonymous;
grant update (menge, status, titel, dauer_min) on ticket_position to anonymous;
grant update (status) on rechnung to anonymous;
grant delete on termin, koffer_soll, foto, stueck, bestellung, tag to anonymous;
grant usage, select on all sequences in schema public to anonymous;

revoke execute on all functions in schema public from public, anonymous;
grant execute on function
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
  foto_hochladen(bigint, text, text, text, text, uuid)
to anonymous;

commit;
