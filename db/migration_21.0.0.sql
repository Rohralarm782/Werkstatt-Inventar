-- =====================================================================
--  Werkstatt — Migration auf 21.0.0
--  Vorgaben des Landesverbands und eigene Einträge der Standorte:
--  Radtypen, Kategorien, Tag-Gruppen und (neu) Merkmale; Lagerort am Rad
--
--  Vorher muss gelaufen sein: db/migration_20.8.0.sql
--  (20.9.0 hatte keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Neu: Radtypen (radtyp), Tag-Gruppen (tag_gruppe), Merkmale (merkmal)
--    mit Werten (merkmal_wert) und Zuordnung zu Radtypen bzw. Kategorien
--    (merkmal_ziel), Pflicht je Standort (merkmal_pflicht) und
--    Ausblendungen je Standort (ausblendung). standort_id leer = Vorgabe
--    für alle Standorte, sonst eigener Eintrag eines Standorts.
--  - Kategorien: Vorgaben stehen in vorgabe_kategorie; die Kategorien der
--    Standorte bekommen die Spalten vorgabe und aktiv. Vorgabe-Kategorien
--    benennt nur der Gesamt-Admin um.
--  - Die bisher festen Listen (Radtypen Bahn … Sonstiges, Tag-Gruppen
--    Marke, Baugruppe, Disziplin, Kategorien A, B, C, L, R, W) werden zu
--    Vorgaben. Vorhandene Daten bleiben gültig.
--  - rad, artikel, stueck bekommen die Spalte merkmale (jsonb:
--    Merkmal-Nummer → Wert). rad bekommt die Spalte ort (Raum des Standorts
--    oder 'beim Sportler'; leer = noch nicht erfasst).
--  - Das Feld „Größe“ am Rad wird übernommen: 40–65 → Rahmengröße in cm,
--    10–29 → Laufraddimension in Zoll (als eigener Wert des Standorts).
--    Übernommene Größen werden im alten Feld geleert, andere bleiben stehen.
--  - Neue Datenbankfunktionen für die Verwaltung (Werkstatt-Manager) und
--    die Vorgaben (Gesamt-Admin).
-- =====================================================================

begin;

-- ---------- 1. Tabellen ----------

alter table lagerort drop constraint lagerort_name_check;
alter table lagerort add constraint lagerort_name_check check (name = trim(name) and name <> '' and length(name) <= 40
                                    and name not in ('am Rad', 'ausgemustert', 'alle', 'beim Sportler') and position('|' in name) = 0);

alter table kategorie add column vorgabe boolean not null default false;   -- Vorgabe des Landesverbands (ab 21.0.0)
alter table kategorie add column aktiv boolean not null default true;      -- false = am Standort ausgeblendet

alter table tag drop constraint tag_gruppe_check;   -- Gruppen stehen ab 21.0.0 in tag_gruppe

alter table artikel add column merkmale jsonb not null default '{}'::jsonb check (jsonb_typeof(merkmale) = 'object');
alter table rad drop constraint rad_typ_check;      -- Radtypen stehen ab 21.0.0 in radtyp
alter table rad add column ort text;   -- Raum des Standorts oder 'beim Sportler'; leer = nicht erfasst (ab 21.0.0)
alter table rad add column merkmale jsonb not null default '{}'::jsonb check (jsonb_typeof(merkmale) = 'object');
alter table stueck add column merkmale jsonb not null default '{}'::jsonb check (jsonb_typeof(merkmale) = 'object');

-- ---------------------------------------------------------------------
--  Vorgaben und eigene Einträge (ab 21.0.0). In radtyp, tag_gruppe,
--  merkmal, merkmal_wert und merkmal_ziel heißt standort_id leer:
--  Vorgabe des Landesverbands, gilt an allen Standorten, ändert nur der
--  Gesamt-Admin. Sonst: eigener Eintrag dieses Standorts (Werkstatt-Manager).
--  Ein Standort kann Vorgaben ausblenden (ausblendung), aber nicht ändern.
--  Kategorien bleiben je Standort (Buchstabe im Code); die Vorgaben dazu
--  stehen in vorgabe_kategorie und werden in jeden Standort übernommen.
-- ---------------------------------------------------------------------
create table vorgabe_kategorie (
  buchstabe  text primary key check (buchstabe ~ '^[A-Z]{1,3}$'),
  name       text not null check (name = btrim(name) and name <> '')
);
create unique index vorgabe_kategorie_name_eindeutig on vorgabe_kategorie (lower(name));

-- Radtypen: Name steht in rad.typ, das Kürzel in der Rad-Nummer (SN-BR-01).
create table radtyp (
  id           bigint generated always as identity primary key,
  standort_id  bigint references standort (id),
  name         text not null check (name = btrim(name) and name <> '' and length(name) <= 30 and position('|' in name) = 0),
  kuerzel      text not null check (kuerzel ~ '^[A-Z]{2,3}$'),
  reihenfolge  integer not null default 0
);
create unique index radtyp_name_eindeutig on radtyp (coalesce(standort_id, 0), lower(name));

-- Gruppen übergreifender Tags (Marke, Baugruppe, Disziplin, eigene); tag.gruppe = Name.
create table tag_gruppe (
  id           bigint generated always as identity primary key,
  standort_id  bigint references standort (id),
  name         text not null check (name = btrim(name) and name <> '' and length(name) <= 30 and position('|' in name) = 0),
  reihenfolge  integer not null default 0
);
create unique index tag_gruppe_name_eindeutig on tag_gruppe (coalesce(standort_id, 0), lower(name));

-- Merkmale: Eigenschaften mit genau einem Wert (Rahmengröße 52 cm).
-- Gespeichert in rad/artikel/stueck.merkmale: {"<merkmal.id>": Wert};
-- bei Auswahl ist der Wert die id aus merkmal_wert.
create table merkmal (
  id           bigint generated always as identity primary key,
  standort_id  bigint references standort (id),
  name         text not null check (name = btrim(name) and name <> '' and length(name) <= 40),
  typ          text not null check (typ in ('auswahl', 'zahl', 'text', 'janein')),
  einheit      text check (einheit is null or (einheit = btrim(einheit) and einheit <> '' and length(einheit) <= 10)),
  reihenfolge  integer not null default 0
);
create unique index merkmal_name_eindeutig on merkmal (coalesce(standort_id, 0), lower(name));

-- Werte zur Auswahl; radtyp_id gesetzt = nur bei Rädern dieses Typs (Übersetzung Bahn ≠ Straße).
create table merkmal_wert (
  id           bigint generated always as identity primary key,
  merkmal_id   bigint not null references merkmal (id) on delete cascade,
  standort_id  bigint references standort (id),
  radtyp_id    bigint references radtyp (id) on delete cascade,
  wert         text not null check (wert = btrim(wert) and wert <> '' and length(wert) <= 40),
  reihenfolge  integer not null default 0
);
create unique index merkmal_wert_eindeutig on merkmal_wert (merkmal_id, coalesce(standort_id, 0), coalesce(radtyp_id, 0), lower(wert));

-- Wo ein Merkmal abgefragt wird: bei einem Radtyp oder einer Kategorie (Buchstabe).
create table merkmal_ziel (
  id           bigint generated always as identity primary key,
  merkmal_id   bigint not null references merkmal (id) on delete cascade,
  standort_id  bigint references standort (id),
  radtyp_id    bigint references radtyp (id) on delete cascade,
  buchstabe    text check (buchstabe ~ '^[A-Z]{1,3}$'),
  reihenfolge  integer not null default 0,
  constraint merkmal_ziel_art_check check ((radtyp_id is null) <> (buchstabe is null))
);
create unique index merkmal_ziel_eindeutig on merkmal_ziel (merkmal_id, coalesce(standort_id, 0), coalesce(radtyp_id, 0), coalesce(buchstabe, ''));

-- Pflichtangaben legt jeder Standort selbst fest — auch bei Vorgaben.
create table merkmal_pflicht (
  standort_id  bigint not null references standort (id),
  ziel_id      bigint not null references merkmal_ziel (id) on delete cascade,
  primary key (standort_id, ziel_id)
);

-- Am Standort ausgeblendete Vorgaben (oder eigene Einträge).
create table ausblendung (
  standort_id  bigint not null references standort (id),
  art          text not null check (art in ('radtyp', 'tag_gruppe', 'merkmal_ziel', 'merkmal_wert')),
  objekt_id    bigint not null,
  primary key (standort_id, art, objekt_id)
);

-- ---------- 2. Vorgaben (bisher feste Listen) ----------

insert into vorgabe_kategorie (buchstabe, name) values
  ('A', 'Antrieb'), ('B', 'Bremse'), ('C', 'Cockpit & Vorbau'), ('L', 'Laufrad & Reifen'), ('R', 'Rahmen'), ('W', 'Werkstattmaterial');
update kategorie k set vorgabe = true, name = v.name
  from vorgabe_kategorie v
 where v.buchstabe = k.buchstabe
   and not exists (select 1 from kategorie x where x.standort_id = k.standort_id and x.buchstabe <> k.buchstabe and lower(x.name) = lower(v.name));
-- Fehlende Vorgabe-Kategorien an den Standorten ergänzen
insert into kategorie (standort_id, buchstabe, name, vorgabe)
  select s.id, v.buchstabe, v.name, true from standort s cross join vorgabe_kategorie v
   where not exists (select 1 from kategorie k where k.standort_id = s.id and k.buchstabe = v.buchstabe)
     and not exists (select 1 from kategorie k where k.standort_id = s.id and lower(k.name) = lower(v.name));

insert into radtyp (name, kuerzel, reihenfolge) values
  ('Bahn', 'BR', 1), ('Straße', 'SR', 2), ('Zeitfahren', 'ZF', 3), ('Cross', 'CX', 4), ('Sonstiges', 'SO', 5);
-- Typen, die es an Rädern gibt, aber nicht als Vorgabe (sollte nicht vorkommen): eigener Radtyp
insert into radtyp (standort_id, name, kuerzel, reihenfolge)
  select distinct r.standort_id, r.typ, 'SO', 9 from rad r
   where not exists (select 1 from radtyp t where t.name = r.typ);

insert into tag_gruppe (name, reihenfolge) values ('Marke', 1), ('Baugruppe', 2), ('Disziplin', 3);

insert into merkmal (name, typ, reihenfolge) values
  ('Rahmengröße', 'auswahl', 1), ('Laufraddimension', 'auswahl', 2), ('Schaltungshersteller', 'auswahl', 3),
  ('Fachzahl', 'auswahl', 4), ('Kettenbreite', 'auswahl', 5), ('Übersetzung', 'auswahl', 6);

insert into merkmal_wert (merkmal_id, wert, reihenfolge)
  select m.id, g || ' cm', g from merkmal m, generate_series(44, 58) g where m.name = 'Rahmengröße' and m.standort_id is null;
insert into merkmal_wert (merkmal_id, wert, reihenfolge)
  select m.id, x.w, x.i from merkmal m, (values ('Shimano', 1), ('SRAM', 2), ('Campagnolo', 3)) x(w, i)
   where m.name = 'Schaltungshersteller' and m.standort_id is null;
insert into merkmal_wert (merkmal_id, wert, reihenfolge)
  select m.id, x.w, x.i from merkmal m, (values ('9-fach', 1), ('10-fach', 2), ('11-fach', 3), ('12-fach', 4)) x(w, i)
   where m.name = 'Fachzahl' and m.standort_id is null;
insert into merkmal_wert (merkmal_id, wert, reihenfolge)
  select m.id, x.w, x.i from merkmal m, (values ('breit 1/8″', 1), ('schmal 3/32″', 2)) x(w, i)
   where m.name = 'Kettenbreite' and m.standort_id is null;
insert into merkmal_wert (merkmal_id, radtyp_id, wert, reihenfolge)
  select m.id, t.id, x.w, x.i from merkmal m, radtyp t,
         (values ('Bahn', 'U11/U13', 1), ('Bahn', 'U15w', 2), ('Bahn', 'U15m', 3), ('Bahn', 'U17w', 4), ('Bahn', 'U17m', 5),
                 ('Straße', 'U11/U13', 1), ('Straße', 'U15', 2), ('Straße', 'U17', 3)) x(typ, w, i)
   where m.name = 'Übersetzung' and m.standort_id is null and t.name = x.typ and t.standort_id is null;

insert into merkmal_ziel (merkmal_id, radtyp_id, reihenfolge)
  select m.id, t.id, m.reihenfolge from merkmal m, radtyp t,
         (values ('Rahmengröße', 'Bahn'), ('Rahmengröße', 'Straße'), ('Rahmengröße', 'Zeitfahren'), ('Rahmengröße', 'Cross'), ('Rahmengröße', 'Sonstiges'),
                 ('Laufraddimension', 'Bahn'), ('Laufraddimension', 'Straße'), ('Laufraddimension', 'Zeitfahren'), ('Laufraddimension', 'Cross'), ('Laufraddimension', 'Sonstiges'),
                 ('Schaltungshersteller', 'Straße'), ('Schaltungshersteller', 'Zeitfahren'), ('Schaltungshersteller', 'Cross'),
                 ('Fachzahl', 'Straße'), ('Fachzahl', 'Zeitfahren'), ('Fachzahl', 'Cross'),
                 ('Kettenbreite', 'Bahn'),
                 ('Übersetzung', 'Bahn'), ('Übersetzung', 'Straße')) x(m, t)
   where m.name = x.m and m.standort_id is null and t.name = x.t and t.standort_id is null;
insert into merkmal_ziel (merkmal_id, buchstabe, reihenfolge)
  select m.id, x.b, m.reihenfolge from merkmal m,
         (values ('Laufraddimension', 'L'), ('Schaltungshersteller', 'A'), ('Fachzahl', 'A'), ('Kettenbreite', 'A')) x(m, b)
   where m.name = x.m and m.standort_id is null;

-- ---------- 3. Größe am Rad übernehmen ----------
-- 40–65 → Rahmengröße („52 cm“), 10–29 → Laufraddimension („28″“). Werte,
-- die es nicht als Vorgabe gibt, werden eigene Werte des Standorts.
create temp table groesse_neu on commit drop as
select r.id as rad_id, r.standort_id,
       case when n >= 40 and n <= 65 then 'Rahmengröße' else 'Laufraddimension' end as merkmal,
       replace(trim(to_char(n, 'FM990.9'), '.'), '.', ',') || case when n >= 40 then ' cm' else '″' end as wert,
       n
  from (select id, standort_id, replace(btrim(groesse), ',', '.')::numeric as n
          from rad where btrim(coalesce(groesse, '')) ~ '^[0-9]{1,2}([,.][0-9])?$') r
 where (n >= 40 and n <= 65) or (n >= 10 and n < 30);

insert into merkmal_wert (merkmal_id, standort_id, wert, reihenfolge)
  select distinct m.id, g.standort_id, g.wert, (g.n * 10)::integer
    from groesse_neu g join merkmal m on m.name = g.merkmal and m.standort_id is null
   where not exists (select 1 from merkmal_wert w where w.merkmal_id = m.id and w.standort_id is null and w.radtyp_id is null and w.wert = g.wert)
  on conflict do nothing;

update rad r set merkmale = r.merkmale || jsonb_build_object(m.id::text, w.id), groesse = null
  from groesse_neu g
  join merkmal m on m.name = g.merkmal and m.standort_id is null
  join merkmal_wert w on w.merkmal_id = m.id and w.wert = g.wert and w.radtyp_id is null and (w.standort_id is null or w.standort_id = g.standort_id)
 where r.id = g.rad_id;

-- ---------- 4. Funktionen ----------

-- Wer darf hier ändern? Vorgabe: nur der Gesamt-Admin (Ergebnis leer);
-- sonst Werkstatt-Manager des gewählten Standorts (Ergebnis = Standort).
create or replace function vorgabe_bereich(p_vorgabe boolean) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(p_vorgabe, false) then
    if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
    if not ist_admin() then raise exception 'Vorgaben ändert nur der Gesamt-Admin'; end if;
    return null;
  end if;
  return recht_manager();
end $$;

-- Läuft gerade eine Änderung an den Vorgaben (Umbenennen, Zusammenführen)?
-- Dann prüfen die Trigger an rad, tag und kategorie nicht nach.
create or replace function vorgabe_laeuft() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('werkstatt.vorgabe', true), '') = 'ja';
$$;

-- Kürzel des Radtyps für die Rad-Nummer (SN-BR-01); unbekannt = SO.
create or replace function rad_kuerzel(p_typ text) returns text
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select kuerzel from radtyp
                    where name = p_typ and (standort_id is null or standort_id = akt_standort())
                    order by standort_id nulls first limit 1), 'SO');
$$;

-- Neuer Standort: Vorgabe-Kategorien übernehmen.
create or replace function standard_kategorien(p_standort bigint) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into kategorie (standort_id, buchstabe, name, vorgabe)
    select p_standort, buchstabe, name, true from vorgabe_kategorie
  on conflict do nothing;
$$;

create or replace function rad_anlegen(p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_arbeiten();
  v_id  text;
  v_typ text := coalesce(nullif(p_daten ->> 'typ', ''), 'Bahn');
  v_ei  bigint := (p_daten ->> 'eigentuemer_id')::bigint;
begin
  if v_ei is not null and not exists (select 1 from sportler where id = v_ei and standort_id = v_st) then
    raise exception 'Unbekannter Kostenträger';
  end if;
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_id := naechste_rad_id(v_typ);
  insert into rad (id, bezeichnung, typ, marke, rahmennummer, groesse, eigentuemer_id, aktiv, notiz, standort_id, ort, merkmale)
  values (v_id,
          p_daten ->> 'bezeichnung',
          v_typ,
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'rahmennummer', ''),
          nullif(p_daten ->> 'groesse', ''),
          v_ei,
          coalesce((p_daten ->> 'aktiv')::boolean, true),
          nullif(p_daten ->> 'notiz', ''),
          v_st,
          nullif(p_daten ->> 'ort', ''),
          coalesce(p_daten -> 'merkmale', '{}'::jsonb));
  return v_id;
end $$;

create or replace function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_arbeiten();
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_code := naechster_code(p_buchstabe, p_gruppe);
  insert into artikel (code, name, einheit, preis, mindestbestand, lieferzeit_tage, art,
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min, standort_id, groessen,
                       packungsinhalt, marke, merkmale)
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
          (p_daten ->> 'dauer_min')::integer,
          v_st,
          case when jsonb_typeof(p_daten -> 'groessen') = 'array' and jsonb_array_length(p_daten -> 'groessen') > 0
               then array(select jsonb_array_elements_text(p_daten -> 'groessen')) end,
          (p_daten ->> 'packungsinhalt')::numeric,
          nullif(btrim(p_daten ->> 'marke'), ''),
          coalesce(p_daten -> 'merkmale', '{}'::jsonb));
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

create or replace function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz, standort_id, merkmale)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''),
          v_st,
          coalesce(p_daten -> 'merkmale', '{}'::jsonb));
  insert into stueck_tag (nummer, tag_id)
    select v_nr, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_nr;
end $$;

create or replace function lagerort_name_pruefen(p_st bigint, p_name text, p_ohne bigint) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v text := trim(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'Name fehlt'; end if;
  if length(v) > 40 then raise exception 'Name zu lang (höchstens 40 Zeichen)'; end if;
  if v in ('am Rad', 'ausgemustert', 'alle', 'beim Sportler') or position('|' in v) > 0 then
    raise exception 'Diesen Namen bitte nicht verwenden: %', v;
  end if;
  if exists (select 1 from lagerort where standort_id = p_st and lower(name) = lower(v) and id is distinct from p_ohne) then
    raise exception 'Den Lagerort % gibt es schon', v;
  end if;
  return v;
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
    if p_art not in ('raum', 'koffer', 'bekleidung') then raise exception 'Art: Raum, Koffer oder Bekleidung'; end if;
    if l.art = 'koffer' and (exists (select 1 from koffer_soll where standort_id = v_st and ort = l.name)
                           or exists (select 1 from termin where standort_id = v_st and koffer = l.name)) then
      raise exception 'Erst Packliste und Termine von % entfernen, dann umstellen', l.name;
    end if;
    if l.art = 'raum' and exists (select 1 from rad where standort_id = v_st and ort = l.name) then
      raise exception 'In % stehen noch Räder – erst einen anderen Ort wählen', l.name;
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
    if exists (select 1 from rad where standort_id = v_st and ort = l.name) then
      raise exception 'In % stehen noch Räder – erst einen anderen Ort wählen', l.name;
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
    update rad set ort = v_name where standort_id = v_st and ort = l.name;
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
  if exists (select 1 from rad where standort_id = v_st and ort = l.name) then
    raise exception 'In % stehen noch Räder – erst einen anderen Ort wählen', l.name;
  end if;
  begin
    delete from koffer_soll where standort_id = v_st and ort = l.name;
    update termin set koffer = null where standort_id = v_st and koffer = l.name;
    delete from lagerort where id = l.id;
  exception when foreign_key_violation then
    raise exception '% wurde schon benutzt (Buchungen, Tickets oder Inventur) – bitte deaktivieren statt löschen', l.name;
  end;
end $$;

-- Räder stehen in einem Raum des Standorts oder beim Sportler (leer = nicht erfasst).
create or replace function rad_ort_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ort is null or new.ort = 'beim Sportler' then return new; end if;
  if tg_op = 'UPDATE' and new.ort is not distinct from old.ort and new.standort_id = old.standort_id then return new; end if;
  if not exists (select 1 from lagerort where standort_id = new.standort_id and name = new.ort and art = 'raum' and aktiv) then
    raise exception 'Räder stehen in einem Raum des Standorts oder beim Sportler – unbekannt: %', new.ort;
  end if;
  return new;
end $$;

-- Radtyp muss es am Standort geben (Vorgabe oder eigener) und nicht ausgeblendet sein.
create or replace function rad_typ_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if vorgabe_laeuft() then return new; end if;
  if tg_op = 'UPDATE' and new.typ = old.typ and new.standort_id = old.standort_id then return new; end if;
  if not exists (select 1 from radtyp t
                  where t.name = new.typ and (t.standort_id is null or t.standort_id = new.standort_id)
                    and not exists (select 1 from ausblendung a where a.standort_id = new.standort_id and a.art = 'radtyp' and a.objekt_id = t.id)) then
    raise exception 'Unbekannter oder ausgeblendeter Radtyp: %', new.typ;
  end if;
  return new;
end $$;

-- Übergreifende Tags gehören zu einer Tag-Gruppe des Standorts (Vorgabe oder eigene).
create or replace function tag_gruppe_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.gruppe is null or vorgabe_laeuft() then return new; end if;
  if tg_op = 'UPDATE' and new.gruppe is not distinct from old.gruppe and new.standort_id = old.standort_id then return new; end if;
  if not exists (select 1 from tag_gruppe g where g.name = new.gruppe and (g.standort_id is null or g.standort_id = new.standort_id)) then
    raise exception 'Unbekannte Tag-Gruppe: %', new.gruppe;
  end if;
  return new;
end $$;

-- Vorgabe-Kategorien: Name und Buchstabe ändert nur der Gesamt-Admin
-- (über vorgabe_kategorie_speichern). Ausblenden (aktiv) darf der Standort.
create or replace function kategorie_vorgabe_schutz() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if vorgabe_laeuft() then return new; end if;
  if tg_op = 'INSERT' then
    new.vorgabe := exists (select 1 from vorgabe_kategorie v where v.buchstabe = new.buchstabe);
    if new.vorgabe then select v.name into new.name from vorgabe_kategorie v where v.buchstabe = new.buchstabe; end if;
    return new;
  end if;
  if old.vorgabe and (new.name is distinct from old.name or new.buchstabe is distinct from old.buchstabe or not new.vorgabe) then
    raise exception 'Kategorie % ist eine Vorgabe des Landesverbands – den Namen ändert nur der Gesamt-Admin', old.buchstabe;
  end if;
  if new.vorgabe and not old.vorgabe then raise exception 'Keine Berechtigung'; end if;
  return new;
end $$;

-- Merkmale an Rad, Artikel und Einzelstück prüfen: nur Merkmale, die zum
-- Radtyp bzw. zur Kategorie passen, nur gültige Werte; Pflichtangaben des
-- Standorts müssen da sein. Geprüft wird nur, was sich ändert.
create or replace function merkmale_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_neu  jsonb := to_jsonb(new);
  v_alt  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) -> 'merkmale' else '{}'::jsonb end;
  v_st   bigint := new.standort_id;
  v_typ  bigint;
  v_b    text;
  v_wo   text;
  v_k    text;
  v_v    jsonb;
  m      merkmal;
  v_name text;
begin
  if vorgabe_laeuft() then return new; end if;
  new.merkmale := jsonb_strip_nulls(coalesce(new.merkmale, '{}'::jsonb));
  if jsonb_typeof(new.merkmale) <> 'object' then raise exception 'Merkmale: ungültige Angabe'; end if;
  if tg_table_name = 'rad' then
    if tg_op = 'UPDATE' and new.merkmale = v_alt and v_neu ->> 'typ' = to_jsonb(old) ->> 'typ' then return new; end if;
    select id into v_typ from radtyp where name = v_neu ->> 'typ' and (standort_id is null or standort_id = v_st);
    v_wo := 'Radtyp ' || (v_neu ->> 'typ');
  else
    if tg_op = 'UPDATE' and new.merkmale = v_alt then return new; end if;
    v_b := code_buchstabe(coalesce(v_neu ->> 'code', v_neu ->> 'nummer'));
    v_wo := 'Kategorie ' || coalesce(v_b, '–');
  end if;

  for v_k, v_v in select key, value from jsonb_each(new.merkmale) loop
    if v_alt -> v_k is not distinct from v_v then continue; end if;   -- unverändert
    if v_k !~ '^[0-9]{1,18}$' then raise exception 'Merkmale: ungültiger Schlüssel %', v_k; end if;
    select * into m from merkmal where id = v_k::bigint and (standort_id is null or standort_id = v_st);
    if not found then raise exception 'Unbekanntes Merkmal: %', v_k; end if;
    if not exists (select 1 from merkmal_ziel z
                    where z.merkmal_id = m.id and (z.standort_id is null or z.standort_id = v_st)
                      and (z.radtyp_id = v_typ or z.buchstabe = v_b)) then
      raise exception 'Das Merkmal „%“ gehört nicht zu %', m.name, v_wo;
    end if;
    if m.typ = 'auswahl' then
      if jsonb_typeof(v_v) <> 'number' or (v_v #>> '{}') !~ '^[0-9]{1,18}$'
         or not exists (select 1 from merkmal_wert w
                         where w.id = (v_v #>> '{}')::bigint and w.merkmal_id = m.id
                           and (w.standort_id is null or w.standort_id = v_st)
                           and (w.radtyp_id is null or w.radtyp_id = v_typ)
                           and not exists (select 1 from ausblendung a where a.standort_id = v_st and a.art = 'merkmal_wert' and a.objekt_id = w.id)) then
        raise exception 'Ungültiger Wert für „%“', m.name;
      end if;
    elsif m.typ = 'zahl' then
      if jsonb_typeof(v_v) <> 'number' then raise exception '„%“: bitte eine Zahl', m.name; end if;
    elsif m.typ = 'janein' then
      if jsonb_typeof(v_v) <> 'boolean' then raise exception '„%“: ja oder nein', m.name; end if;
    else
      if jsonb_typeof(v_v) <> 'string' or btrim(v_v #>> '{}') = '' or length(v_v #>> '{}') > 200 then
        raise exception '„%“: Text mit 1 bis 200 Zeichen', m.name;
      end if;
    end if;
  end loop;

  select string_agg(mm.name, ', ' order by mm.name) into v_name
    from merkmal_pflicht p
    join merkmal_ziel z on z.id = p.ziel_id
    join merkmal mm on mm.id = z.merkmal_id
   where p.standort_id = v_st
     and (z.radtyp_id = v_typ or z.buchstabe = v_b)
     and not exists (select 1 from ausblendung a where a.standort_id = v_st and a.art = 'merkmal_ziel' and a.objekt_id = z.id)
     and not new.merkmale ? z.merkmal_id::text;
  if v_name is not null then raise exception 'Pflichtangabe fehlt: %', v_name; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
--  Zusammenführen: Eigene Einträge eines Standorts, die wie eine Vorgabe
--  heißen, gehen in der Vorgabe auf. Angaben an Rädern, Artikeln und
--  Einzelstücken ziehen mit. Nur intern (vorgabe_laeuft ist gesetzt).
-- ---------------------------------------------------------------------
-- Angaben mit Wert p_alt (eigener Wert eines Standorts) auf p_neu umhängen, p_alt löschen.
create or replace function wert_ersetzen(p_alt bigint, p_neu bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  w merkmal_wert;
  k text;
begin
  select * into w from merkmal_wert where id = p_alt;
  if not found or w.standort_id is null then return; end if;
  k := w.merkmal_id::text;
  update rad     set merkmale = jsonb_set(merkmale, array[k], to_jsonb(p_neu)) where standort_id = w.standort_id and merkmale -> k = to_jsonb(w.id);
  update artikel set merkmale = jsonb_set(merkmale, array[k], to_jsonb(p_neu)) where standort_id = w.standort_id and merkmale -> k = to_jsonb(w.id);
  update stueck  set merkmale = jsonb_set(merkmale, array[k], to_jsonb(p_neu)) where standort_id = w.standort_id and merkmale -> k = to_jsonb(w.id);
  delete from ausblendung where art = 'merkmal_wert' and objekt_id = w.id;
  delete from merkmal_wert where id = w.id;
end $$;

-- Eigener Wert w wird durch einen gleichnamigen Wert y ersetzt (Vorgabe oder
-- schon vorhandener eigener Wert desselben Standorts), falls es den gibt.
create or replace function wert_doppelt_aufloesen(p_wert bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  w merkmal_wert;
  v_y bigint;
begin
  select * into w from merkmal_wert where id = p_wert;
  if not found or w.standort_id is null then return; end if;
  select x.id into v_y from merkmal_wert x
   where x.id <> w.id and x.merkmal_id = w.merkmal_id and x.radtyp_id is not distinct from w.radtyp_id
     and lower(x.wert) = lower(w.wert) and (x.standort_id is null or x.standort_id = w.standort_id)
   order by x.standort_id nulls first, x.id limit 1;
  if v_y is not null then perform wert_ersetzen(w.id, v_y); end if;
end $$;

-- Eigene Zuordnung z entfällt, wenn es dieselbe schon gibt (Vorgabe oder
-- eigene); die Pflicht-Einstellung geht auf die verbleibende über.
create or replace function ziel_doppelt_aufloesen(p_ziel bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  z merkmal_ziel;
  y merkmal_ziel;
begin
  select * into z from merkmal_ziel where id = p_ziel;
  if not found or z.standort_id is null then return; end if;
  select * into y from merkmal_ziel x
   where x.id <> z.id and x.merkmal_id = z.merkmal_id and x.radtyp_id is not distinct from z.radtyp_id
     and x.buchstabe is not distinct from z.buchstabe and (x.standort_id is null or x.standort_id = z.standort_id)
   order by x.standort_id nulls first, x.id limit 1;
  if not found then return; end if;
  insert into merkmal_pflicht (standort_id, ziel_id)
    select p.standort_id, y.id from merkmal_pflicht p where p.ziel_id = z.id
  on conflict do nothing;
  delete from ausblendung where art = 'merkmal_ziel' and objekt_id = z.id;
  delete from merkmal_ziel where id = z.id;
end $$;

create or replace function vorgabe_zusammenfuehren(p_art text, p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  r  record;
  z  record;
  rt radtyp;
  tg tag_gruppe;
  m  merkmal;
  w  merkmal_wert;
  zz merkmal_ziel;
begin
  perform set_config('werkstatt.vorgabe', 'ja', true);
  if p_art = 'radtyp' then
    select * into rt from radtyp where id = p_id and standort_id is null;
    for r in select * from radtyp where standort_id is not null and lower(name) = lower(rt.name) loop
      update rad set typ = rt.name where standort_id = r.standort_id and typ = r.name;
      -- Zuordnungen: auf die Vorgabe umhängen; gibt es sie dort schon, entfällt die eigene
      for zz in select * from merkmal_ziel where radtyp_id = r.id loop
        if exists (select 1 from merkmal_ziel x where x.merkmal_id = zz.merkmal_id and x.radtyp_id = rt.id and x.standort_id = zz.standort_id) then
          insert into merkmal_pflicht (standort_id, ziel_id)
            select p.standort_id, x.id from merkmal_pflicht p, merkmal_ziel x
             where p.ziel_id = zz.id and x.merkmal_id = zz.merkmal_id and x.radtyp_id = rt.id and x.standort_id = zz.standort_id
          on conflict do nothing;
          delete from ausblendung where art = 'merkmal_ziel' and objekt_id = zz.id;
          delete from merkmal_ziel where id = zz.id;
        else
          update merkmal_ziel set radtyp_id = rt.id where id = zz.id;
          perform ziel_doppelt_aufloesen(zz.id);
        end if;
      end loop;
      -- Werte, die nur bei diesem Radtyp gelten
      for w in select * from merkmal_wert where radtyp_id = r.id loop
        select x.id into z from merkmal_wert x
         where x.merkmal_id = w.merkmal_id and x.radtyp_id = rt.id and x.standort_id = w.standort_id and lower(x.wert) = lower(w.wert);
        if found then
          perform wert_ersetzen(w.id, z.id);
        else
          update merkmal_wert set radtyp_id = rt.id where id = w.id;
          perform wert_doppelt_aufloesen(w.id);
        end if;
      end loop;
      delete from ausblendung where art = 'radtyp' and objekt_id = r.id;
      delete from radtyp where id = r.id;
    end loop;

  elsif p_art = 'tag_gruppe' then
    select * into tg from tag_gruppe where id = p_id and standort_id is null;
    for r in select * from tag_gruppe where standort_id is not null and lower(name) = lower(tg.name) loop
      update tag set gruppe = tg.name where standort_id = r.standort_id and gruppe = r.name;
      delete from ausblendung where art = 'tag_gruppe' and objekt_id = r.id;
      delete from tag_gruppe where id = r.id;
    end loop;

  elsif p_art = 'merkmal' then
    select * into m from merkmal where id = p_id and standort_id is null;
    for r in select * from merkmal where standort_id is not null and lower(name) = lower(m.name) loop
      if r.typ <> m.typ then
        raise exception 'Das Merkmal „%“ ist in % vom Typ %, die Vorgabe vom Typ % – erst angleichen',
          r.name, (select name from standort where id = r.standort_id), r.typ, m.typ;
      end if;
      update rad    set merkmale = (merkmale - r.id::text) || jsonb_build_object(m.id::text, merkmale -> r.id::text)
       where standort_id = r.standort_id and merkmale ? r.id::text;
      update artikel set merkmale = (merkmale - r.id::text) || jsonb_build_object(m.id::text, merkmale -> r.id::text)
       where standort_id = r.standort_id and merkmale ? r.id::text;
      update stueck set merkmale = (merkmale - r.id::text) || jsonb_build_object(m.id::text, merkmale -> r.id::text)
       where standort_id = r.standort_id and merkmale ? r.id::text;
      update merkmal_wert set merkmal_id = m.id where merkmal_id = r.id;
      for z in select id from merkmal_wert where merkmal_id = m.id and standort_id = r.standort_id loop
        perform wert_doppelt_aufloesen(z.id);
      end loop;
      for z in select * from merkmal_ziel where merkmal_id = r.id loop
        if exists (select 1 from merkmal_ziel x
                    where x.merkmal_id = m.id and x.radtyp_id is not distinct from z.radtyp_id and x.buchstabe is not distinct from z.buchstabe
                      and (x.standort_id is null or x.standort_id = z.standort_id)) then
          insert into merkmal_pflicht (standort_id, ziel_id)
            select p.standort_id, x.id from merkmal_pflicht p, merkmal_ziel x
             where p.ziel_id = z.id and x.merkmal_id = m.id and x.radtyp_id is not distinct from z.radtyp_id
               and x.buchstabe is not distinct from z.buchstabe and (x.standort_id is null or x.standort_id = z.standort_id)
          on conflict do nothing;
          delete from ausblendung where art = 'merkmal_ziel' and objekt_id = z.id;
          delete from merkmal_ziel where id = z.id;
        else
          update merkmal_ziel set merkmal_id = m.id where id = z.id;
        end if;
      end loop;
      delete from merkmal where id = r.id;
    end loop;

  elsif p_art = 'merkmal_wert' then
    select * into w from merkmal_wert where id = p_id and standort_id is null;
    for z in select id from merkmal_wert
              where standort_id is not null and merkmal_id = w.merkmal_id and radtyp_id is not distinct from w.radtyp_id
                and lower(wert) = lower(w.wert) loop
      perform wert_doppelt_aufloesen(z.id);
    end loop;

  elsif p_art = 'merkmal_ziel' then
    select * into zz from merkmal_ziel where id = p_id and standort_id is null;
    for z in select id from merkmal_ziel
              where standort_id is not null and merkmal_id = zz.merkmal_id and radtyp_id is not distinct from zz.radtyp_id
                and buchstabe is not distinct from zz.buchstabe loop
      perform ziel_doppelt_aufloesen(z.id);
    end loop;
  end if;
  perform set_config('werkstatt.vorgabe', '', true);
end $$;

-- ---------------------------------------------------------------------
--  Verwaltung: Radtypen, Tag-Gruppen, Merkmale, Werte, Zuordnungen.
--  p_vorgabe = true: Vorgabe für alle Standorte (nur Gesamt-Admin);
--  sonst eigener Eintrag des gewählten Standorts (Werkstatt-Manager).
--  Geändert werden nur Einträge der eigenen Ebene. Heißt eine neue oder
--  umbenannte Vorgabe wie ein eigener Eintrag eines Standorts, gehen die
--  eigenen Einträge in ihr auf (vorgabe_zusammenfuehren).
-- ---------------------------------------------------------------------
create or replace function radtyp_speichern(p_id bigint, p_name text, p_kuerzel text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_name text := btrim(coalesce(p_name, ''));
  v_k    text := upper(btrim(coalesce(p_kuerzel, '')));
  t      radtyp;
  v_id   bigint;
begin
  if v_name = '' or length(v_name) > 30 or position('|' in v_name) > 0 then raise exception 'Name: 1 bis 30 Zeichen, ohne |'; end if;
  if v_k !~ '^[A-Z]{2,3}$' then raise exception 'Kürzel: 2 bis 3 Buchstaben A–Z'; end if;
  if exists (select 1 from radtyp where lower(name) = lower(v_name) and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Den Radtyp % gibt es schon', v_name;
  end if;
  if exists (select 1 from radtyp where kuerzel = v_k and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st
                    or (v_st is null and lower(name) <> lower(v_name)))) then
    raise exception 'Das Kürzel % ist schon vergeben', v_k;
  end if;
  if p_id is null then
    insert into radtyp (standort_id, name, kuerzel, reihenfolge)
    values (v_st, v_name, v_k, coalesce((select max(reihenfolge) from radtyp where standort_id is not distinct from v_st), 0) + 1)
    returning id into v_id;
  else
    select * into t from radtyp where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Radtyp nicht gefunden oder nicht änderbar'; end if;
    update radtyp set name = v_name, kuerzel = v_k where id = t.id;
    if v_name <> t.name then
      perform set_config('werkstatt.vorgabe', 'ja', true);
      update rad set typ = v_name where typ = t.name and (v_st is null or standort_id = v_st);
      perform set_config('werkstatt.vorgabe', '', true);
    end if;
    v_id := t.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('radtyp', v_id); end if;
  return v_id;
end $$;

create or replace function tag_gruppe_speichern(p_id bigint, p_name text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_name text := btrim(coalesce(p_name, ''));
  g      tag_gruppe;
  v_id   bigint;
begin
  if v_name = '' or length(v_name) > 30 or position('|' in v_name) > 0 then raise exception 'Name: 1 bis 30 Zeichen, ohne |'; end if;
  if exists (select 1 from tag_gruppe where lower(name) = lower(v_name) and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Die Tag-Gruppe % gibt es schon', v_name;
  end if;
  if p_id is null then
    insert into tag_gruppe (standort_id, name, reihenfolge)
    values (v_st, v_name, coalesce((select max(reihenfolge) from tag_gruppe where standort_id is not distinct from v_st), 0) + 1)
    returning id into v_id;
  else
    select * into g from tag_gruppe where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Tag-Gruppe nicht gefunden oder nicht änderbar'; end if;
    if g.name = 'Marke' and g.standort_id is null and v_name <> g.name then
      raise exception 'Die Gruppe Marke gehört zum Feld „Marke“ und behält ihren Namen';
    end if;
    update tag_gruppe set name = v_name where id = g.id;
    if v_name <> g.name then
      perform set_config('werkstatt.vorgabe', 'ja', true);
      update tag set gruppe = v_name where gruppe = g.name and (v_st is null or standort_id = v_st);
      perform set_config('werkstatt.vorgabe', '', true);
    end if;
    v_id := g.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('tag_gruppe', v_id); end if;
  return v_id;
end $$;

create or replace function merkmal_speichern(p_id bigint, p_name text, p_typ text, p_einheit text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_name text := btrim(coalesce(p_name, ''));
  v_e    text := nullif(btrim(coalesce(p_einheit, '')), '');
  m      merkmal;
  v_id   bigint;
begin
  if v_name = '' or length(v_name) > 40 then raise exception 'Name: 1 bis 40 Zeichen'; end if;
  if p_typ is null or p_typ not in ('auswahl', 'zahl', 'text', 'janein') then raise exception 'Typ: Auswahl, Zahl, Text oder Ja/Nein'; end if;
  if v_e is not null and length(v_e) > 10 then raise exception 'Einheit: höchstens 10 Zeichen'; end if;
  if exists (select 1 from merkmal where lower(name) = lower(v_name) and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Das Merkmal % gibt es schon', v_name;
  end if;
  if p_id is null then
    insert into merkmal (standort_id, name, typ, einheit, reihenfolge)
    values (v_st, v_name, p_typ, v_e, coalesce((select max(reihenfolge) from merkmal where standort_id is not distinct from v_st), 0) + 1)
    returning id into v_id;
  else
    select * into m from merkmal where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Merkmal nicht gefunden oder nicht änderbar'; end if;
    if p_typ <> m.typ then
      if exists (select 1 from rad where merkmale ? m.id::text) or exists (select 1 from artikel where merkmale ? m.id::text)
         or exists (select 1 from stueck where merkmale ? m.id::text) then
        raise exception 'Der Typ lässt sich nicht mehr ändern – „%“ ist schon eingetragen', m.name;
      end if;
      delete from merkmal_wert where merkmal_id = m.id;
    end if;
    update merkmal set name = v_name, typ = p_typ, einheit = v_e where id = m.id;
    v_id := m.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('merkmal', v_id); end if;
  return v_id;
end $$;

create or replace function merkmal_wert_speichern(p_id bigint, p_merkmal bigint, p_radtyp bigint, p_wert text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_w    text := btrim(coalesce(p_wert, ''));
  w      merkmal_wert;
  m      merkmal;
  v_id   bigint;
begin
  if v_w = '' or length(v_w) > 40 then raise exception 'Wert: 1 bis 40 Zeichen'; end if;
  if p_id is not null then
    select * into w from merkmal_wert where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Wert nicht gefunden oder nicht änderbar'; end if;
  end if;
  select * into m from merkmal
   where id = coalesce(w.merkmal_id, p_merkmal) and (standort_id is null or standort_id is not distinct from v_st);
  if not found then raise exception 'Unbekanntes Merkmal'; end if;
  if m.typ <> 'auswahl' then raise exception '„%“ hat keine Werte zur Auswahl', m.name; end if;
  if v_st is null and m.standort_id is not null then raise exception 'Vorgabe-Werte nur bei Vorgabe-Merkmalen'; end if;
  if p_id is null and p_radtyp is not null
     and not exists (select 1 from radtyp where id = p_radtyp and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Unbekannter Radtyp';
  end if;
  if exists (select 1 from merkmal_wert x
              where x.merkmal_id = m.id and x.id is distinct from p_id
                and x.radtyp_id is not distinct from (case when p_id is null then p_radtyp else w.radtyp_id end)
                and lower(x.wert) = lower(v_w) and (x.standort_id is null or x.standort_id is not distinct from v_st)) then
    raise exception 'Den Wert % gibt es schon', v_w;
  end if;
  if p_id is null then
    insert into merkmal_wert (merkmal_id, standort_id, radtyp_id, wert, reihenfolge)
    values (m.id, v_st, p_radtyp, v_w, coalesce((select max(reihenfolge) from merkmal_wert where merkmal_id = m.id), 0) + 1)
    returning id into v_id;
  else
    update merkmal_wert set wert = v_w where id = w.id;
    v_id := w.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('merkmal_wert', v_id); end if;
  return v_id;
end $$;

-- Merkmal bei einem Radtyp bzw. einer Kategorie abfragen (p_an) oder nicht mehr.
-- Angaben, die schon eingetragen sind, bleiben beim Entfernen erhalten.
create or replace function merkmal_ziel_setzen(p_merkmal bigint, p_radtyp bigint, p_buchstabe text, p_an boolean, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := vorgabe_bereich(p_vorgabe);
  v_b  text := nullif(upper(btrim(coalesce(p_buchstabe, ''))), '');
  v_id bigint;
begin
  if (p_radtyp is null) = (v_b is null) then raise exception 'Radtyp oder Kategorie angeben'; end if;
  if not exists (select 1 from merkmal where id = p_merkmal and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Unbekanntes Merkmal';
  end if;
  if p_radtyp is not null and not exists (select 1 from radtyp where id = p_radtyp and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Unbekannter Radtyp';
  end if;
  if v_b is not null and v_st is null and not exists (select 1 from vorgabe_kategorie where buchstabe = v_b) then
    raise exception 'Kategorie % ist keine Vorgabe', v_b;
  end if;
  if v_b is not null and v_st is not null and not exists (select 1 from kategorie where standort_id = v_st and buchstabe = v_b) then
    raise exception 'Unbekannte Kategorie: %', v_b;
  end if;
  if coalesce(p_an, true) then
    select id into v_id from merkmal_ziel
     where merkmal_id = p_merkmal and radtyp_id is not distinct from p_radtyp and buchstabe is not distinct from v_b
       and (standort_id is null or standort_id is not distinct from v_st)
     order by standort_id nulls first limit 1;
    if v_id is not null then return v_id; end if;
    insert into merkmal_ziel (merkmal_id, standort_id, radtyp_id, buchstabe, reihenfolge)
    values (p_merkmal, v_st, p_radtyp, v_b,
            coalesce((select max(reihenfolge) from merkmal_ziel where radtyp_id is not distinct from p_radtyp and buchstabe is not distinct from v_b), 0) + 1)
    returning id into v_id;
    if v_st is null then perform vorgabe_zusammenfuehren('merkmal_ziel', v_id); end if;
    return v_id;
  end if;
  delete from merkmal_ziel
   where merkmal_id = p_merkmal and radtyp_id is not distinct from p_radtyp and buchstabe is not distinct from v_b
     and standort_id is not distinct from v_st
  returning id into v_id;
  if v_id is null then raise exception 'Zuordnung nicht gefunden oder nicht änderbar'; end if;
  delete from ausblendung where art = 'merkmal_ziel' and objekt_id = v_id;
  return v_id;
end $$;

-- Pflichtangabe am Standort an/aus (auch bei Vorgaben).
create or replace function merkmal_pflicht_setzen(p_ziel bigint, p_an boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
begin
  if not exists (select 1 from merkmal_ziel where id = p_ziel and (standort_id is null or standort_id = v_st)) then
    raise exception 'Zuordnung nicht gefunden';
  end if;
  if coalesce(p_an, false) then
    insert into merkmal_pflicht (standort_id, ziel_id) values (v_st, p_ziel) on conflict do nothing;
  else
    delete from merkmal_pflicht where standort_id = v_st and ziel_id = p_ziel;
  end if;
end $$;

-- Am Standort aus- bzw. wieder einblenden: Radtyp, Tag-Gruppe, Merkmal bei
-- einem Radtyp/einer Kategorie (merkmal_ziel) oder Wert.
create or replace function ausblenden(p_art text, p_id bigint, p_aus boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
  v_ok boolean;
begin
  v_ok := case p_art
    when 'radtyp'       then exists (select 1 from radtyp where id = p_id and (standort_id is null or standort_id = v_st))
    when 'tag_gruppe'   then exists (select 1 from tag_gruppe where id = p_id and (standort_id is null or standort_id = v_st))
    when 'merkmal_ziel' then exists (select 1 from merkmal_ziel where id = p_id and (standort_id is null or standort_id = v_st))
    when 'merkmal_wert' then exists (select 1 from merkmal_wert where id = p_id and (standort_id is null or standort_id = v_st))
    else false end;
  if not v_ok then raise exception 'Nicht gefunden'; end if;
  if p_art = 'tag_gruppe' and exists (select 1 from tag_gruppe where id = p_id and name = 'Marke' and standort_id is null) then
    raise exception 'Die Gruppe Marke lässt sich nicht ausblenden';
  end if;
  if coalesce(p_aus, true) then
    insert into ausblendung (standort_id, art, objekt_id) values (v_st, p_art, p_id) on conflict do nothing;
  else
    delete from ausblendung where standort_id = v_st and art = p_art and objekt_id = p_id;
  end if;
end $$;

-- Löschen, solange nichts mehr daran hängt; sonst ausblenden.
create or replace function eintrag_loeschen(p_art text, p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint;
  v_von bigint;
  v_n   integer;
  v_name text;
begin
  if p_art = 'radtyp' then select standort_id, name into v_von, v_name from radtyp where id = p_id;
  elsif p_art = 'tag_gruppe' then select standort_id, name into v_von, v_name from tag_gruppe where id = p_id;
  elsif p_art = 'merkmal' then select standort_id, name into v_von, v_name from merkmal where id = p_id;
  elsif p_art = 'merkmal_wert' then select standort_id, wert into v_von, v_name from merkmal_wert where id = p_id;
  else raise exception 'Unbekannte Art: %', p_art;
  end if;
  if v_name is null then raise exception 'Nicht gefunden'; end if;
  v_st := vorgabe_bereich(v_von is null);
  if v_von is distinct from v_st then raise exception 'Nicht gefunden oder nicht änderbar'; end if;

  if p_art = 'radtyp' then
    select count(*) into v_n from rad where typ = v_name and (v_st is null or standort_id = v_st);
    if v_n > 0 then raise exception 'Radtyp % hat noch % Räder – ausblenden statt löschen', v_name, v_n; end if;
    delete from ausblendung a using merkmal_ziel z where a.art = 'merkmal_ziel' and a.objekt_id = z.id and z.radtyp_id = p_id;
    delete from ausblendung a using merkmal_wert w where a.art = 'merkmal_wert' and a.objekt_id = w.id and w.radtyp_id = p_id;
    delete from ausblendung where art = 'radtyp' and objekt_id = p_id;
    delete from radtyp where id = p_id;
  elsif p_art = 'tag_gruppe' then
    if v_st is null and v_name = 'Marke' then raise exception 'Die Gruppe Marke gehört zum Feld „Marke“'; end if;
    select count(*) into v_n from tag where gruppe = v_name and (v_st is null or standort_id = v_st);
    if v_n > 0 then raise exception 'In der Gruppe % stehen noch % Tags – erst die Tags löschen', v_name, v_n; end if;
    delete from ausblendung where art = 'tag_gruppe' and objekt_id = p_id;
    delete from tag_gruppe where id = p_id;
  elsif p_art = 'merkmal' then
    select (select count(*) from rad where merkmale ? p_id::text) + (select count(*) from artikel where merkmale ? p_id::text)
         + (select count(*) from stueck where merkmale ? p_id::text) into v_n;
    if v_n > 0 then raise exception '„%“ ist noch % mal eingetragen – erst dort entfernen oder ausblenden', v_name, v_n; end if;
    delete from ausblendung a using merkmal_ziel z where a.art = 'merkmal_ziel' and a.objekt_id = z.id and z.merkmal_id = p_id;
    delete from ausblendung a using merkmal_wert w where a.art = 'merkmal_wert' and a.objekt_id = w.id and w.merkmal_id = p_id;
    delete from merkmal where id = p_id;
  else
    select (select count(*) from rad r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id))
         + (select count(*) from artikel r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id))
         + (select count(*) from stueck r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id)) into v_n;
    if v_n > 0 then raise exception '„%“ ist noch % mal eingetragen – ausblenden statt löschen', v_name, v_n; end if;
    delete from ausblendung where art = 'merkmal_wert' and objekt_id = p_id;
    delete from merkmal_wert where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Gesamt-Admin: Vorgabe-Kategorien, Übersicht und Übernahme
-- ---------------------------------------------------------------------
-- Vorgabe-Kategorie anlegen oder umbenennen — gilt sofort an allen
-- Standorten. Ein Standort, an dem der Buchstabe schon eine andere eigene
-- Kategorie ist, muss erst klären (sonst stünden seine Codes plötzlich
-- unter einem anderen Namen).
create or replace function vorgabe_kategorie_speichern(p_buchstabe text, p_name text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_b    text := upper(btrim(coalesce(p_buchstabe, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_alt  text;
  s      record;
begin
  perform vorgabe_bereich(true);
  if v_b !~ '^[A-Z]{1,3}$' then raise exception 'Buchstabe: 1 bis 3 Buchstaben A–Z'; end if;
  if v_name = '' then raise exception 'Name fehlt'; end if;
  if exists (select 1 from vorgabe_kategorie where lower(name) = lower(v_name) and buchstabe <> v_b) then
    raise exception 'Die Kategorie % gibt es schon', v_name;
  end if;
  select name into v_alt from vorgabe_kategorie where buchstabe = v_b;
  for s in select st.name as standort, k.name as kat from kategorie k join standort st on st.id = k.standort_id
            where (k.buchstabe = v_b and not k.vorgabe and lower(k.name) <> lower(v_name))
               or (k.buchstabe <> v_b and lower(k.name) = lower(v_name)) loop
    raise exception 'In % gibt es schon die Kategorie „%“ – dort erst klären', s.standort, s.kat;
  end loop;
  insert into vorgabe_kategorie (buchstabe, name) values (v_b, v_name)
  on conflict (buchstabe) do update set name = excluded.name;
  perform set_config('werkstatt.vorgabe', 'ja', true);
  insert into kategorie (standort_id, buchstabe, name, vorgabe)
    select st.id, v_b, v_name, true from standort st
  on conflict (standort_id, buchstabe) do update set name = excluded.name, vorgabe = true;
  perform set_config('werkstatt.vorgabe', '', true);
end $$;

-- Vorgabe-Kategorie aufheben: an den Standorten bleibt sie als eigene stehen.
create or replace function vorgabe_kategorie_loeschen(p_buchstabe text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform vorgabe_bereich(true);
  if not exists (select 1 from vorgabe_kategorie where buchstabe = p_buchstabe) then raise exception 'Nicht gefunden'; end if;
  if exists (select 1 from merkmal_ziel where buchstabe = p_buchstabe and standort_id is null) then
    raise exception 'Erst die Vorgabe-Merkmale dieser Kategorie entfernen';
  end if;
  delete from vorgabe_kategorie where buchstabe = p_buchstabe;
  perform set_config('werkstatt.vorgabe', 'ja', true);
  update kategorie set vorgabe = false where buchstabe = p_buchstabe;
  perform set_config('werkstatt.vorgabe', '', true);
end $$;

-- Eigenen Eintrag eines Standorts zur Vorgabe machen; gleichnamige eigene
-- Einträge aller Standorte gehen darin auf. p_art: radtyp, tag_gruppe,
-- merkmal, merkmal_wert, kategorie (dann p_id leer und p_buchstabe gesetzt).
create or replace function als_vorgabe_uebernehmen(p_art text, p_id bigint, p_buchstabe text default null) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
  rt   radtyp;
  tg   tag_gruppe;
  m    merkmal;
  w    merkmal_wert;
  k    kategorie;
begin
  perform vorgabe_bereich(true);
  if p_art = 'kategorie' then
    select * into k from kategorie where buchstabe = upper(p_buchstabe) and not vorgabe order by standort_id limit 1;
    if not found then raise exception 'Nicht gefunden'; end if;
    perform vorgabe_kategorie_speichern(k.buchstabe, k.name);
    return null;
  elsif p_art = 'radtyp' then
    select * into rt from radtyp where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from radtyp where standort_id is null and lower(name) = lower(rt.name);
    if v_id is null then
      if exists (select 1 from radtyp where standort_id is null and kuerzel = rt.kuerzel) then
        raise exception 'Das Kürzel % hat schon ein anderer Vorgabe-Radtyp – erst am Standort ändern', rt.kuerzel;
      end if;
      insert into radtyp (name, kuerzel, reihenfolge)
      values (rt.name, rt.kuerzel, coalesce((select max(reihenfolge) from radtyp where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'tag_gruppe' then
    select * into tg from tag_gruppe where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from tag_gruppe where standort_id is null and lower(name) = lower(tg.name);
    if v_id is null then
      insert into tag_gruppe (name, reihenfolge)
      values (tg.name, coalesce((select max(reihenfolge) from tag_gruppe where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'merkmal' then
    select * into m from merkmal where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from merkmal where standort_id is null and lower(name) = lower(m.name);
    if v_id is null then
      insert into merkmal (name, typ, einheit, reihenfolge)
      values (m.name, m.typ, m.einheit, coalesce((select max(reihenfolge) from merkmal where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'merkmal_wert' then
    select * into w from merkmal_wert where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    if exists (select 1 from merkmal where id = w.merkmal_id and standort_id is not null) then
      raise exception 'Erst das Merkmal als Vorgabe übernehmen';
    end if;
    if w.radtyp_id is not null and exists (select 1 from radtyp where id = w.radtyp_id and standort_id is not null) then
      raise exception 'Erst den Radtyp als Vorgabe übernehmen';
    end if;
    select id into v_id from merkmal_wert
     where standort_id is null and merkmal_id = w.merkmal_id and radtyp_id is not distinct from w.radtyp_id and lower(wert) = lower(w.wert);
    if v_id is null then
      insert into merkmal_wert (merkmal_id, radtyp_id, wert, reihenfolge)
      values (w.merkmal_id, w.radtyp_id, w.wert, coalesce((select max(reihenfolge) from merkmal_wert where merkmal_id = w.merkmal_id), 0) + 1)
      returning id into v_id;
    end if;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
  perform vorgabe_zusammenfuehren(p_art, v_id);
  return v_id;
end $$;

-- Übersicht für den Gesamt-Admin: alle Vorgaben, wie viele Standorte sie
-- nutzen bzw. ausgeblendet haben, und Vorschläge (eigene Einträge der
-- Standorte). Keine Daten der Standorte außer Namen und Anzahlen.
create or replace function vorgaben() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
begin
  perform vorgabe_bereich(true);
  with nutzung as (
    select standort_id, key::bigint as merkmal_id, value from rad, jsonb_each(merkmale)
    union all select standort_id, key::bigint, value from artikel, jsonb_each(merkmale)
    union all select standort_id, key::bigint, value from stueck, jsonb_each(merkmale)
  )
  select jsonb_build_object(
    'standorte', (select count(*) from standort where aktiv),
    'radtypen', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kuerzel', t.kuerzel,
                   'genutzt', (select count(distinct r.standort_id) from rad r where r.typ = t.name),
                   'aus', (select count(*) from ausblendung a where a.art = 'radtyp' and a.objekt_id = t.id))
                 order by t.reihenfolge, t.name) from radtyp t where t.standort_id is null), '[]'),
    'kategorien', coalesce((select jsonb_agg(jsonb_build_object('buchstabe', k.buchstabe, 'name', k.name,
                   'aus', (select count(*) from kategorie x where x.buchstabe = k.buchstabe and x.vorgabe and not x.aktiv))
                 order by k.buchstabe) from vorgabe_kategorie k), '[]'),
    'gruppen', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name,
                   'genutzt', (select count(distinct x.standort_id) from tag x where x.gruppe = g.name),
                   'aus', (select count(*) from ausblendung a where a.art = 'tag_gruppe' and a.objekt_id = g.id))
                 order by g.reihenfolge, g.name) from tag_gruppe g where g.standort_id is null), '[]'),
    'merkmale', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'typ', m.typ, 'einheit', m.einheit,
                   'genutzt', (select count(distinct n.standort_id) from nutzung n where n.merkmal_id = m.id))
                 order by m.reihenfolge, m.name) from merkmal m where m.standort_id is null), '[]'),
    'werte', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'merkmal_id', w.merkmal_id, 'radtyp_id', w.radtyp_id, 'wert', w.wert,
                   'genutzt', (select count(distinct n.standort_id) from nutzung n where n.merkmal_id = w.merkmal_id and n.value = to_jsonb(w.id)),
                   'aus', (select count(*) from ausblendung a where a.art = 'merkmal_wert' and a.objekt_id = w.id))
                 order by w.reihenfolge, w.id) from merkmal_wert w where w.standort_id is null), '[]'),
    'ziele', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'merkmal_id', z.merkmal_id, 'radtyp_id', z.radtyp_id, 'buchstabe', z.buchstabe,
                   'pflicht', (select count(*) from merkmal_pflicht p where p.ziel_id = z.id),
                   'aus', (select count(*) from ausblendung a where a.art = 'merkmal_ziel' and a.objekt_id = z.id))
                 order by z.reihenfolge, z.id) from merkmal_ziel z where z.standort_id is null), '[]'),
    'vorschlaege', coalesce((select jsonb_agg(x order by x ->> 'art', x ->> 'name') from (
        select jsonb_build_object('art', 'radtyp', 'id', min(t.id), 'name', min(t.name), 'zusatz', min(t.kuerzel),
                                  'standorte', jsonb_agg(distinct s.name)) as x
          from radtyp t join standort s on s.id = t.standort_id group by lower(t.name)
        union all
        select jsonb_build_object('art', 'kategorie', 'buchstabe', k.buchstabe, 'name', min(k.name), 'zusatz', k.buchstabe,
                                  'standorte', jsonb_agg(distinct s.name))
          from kategorie k join standort s on s.id = k.standort_id where not k.vorgabe group by k.buchstabe, lower(k.name)
        union all
        select jsonb_build_object('art', 'tag_gruppe', 'id', min(g.id), 'name', min(g.name), 'standorte', jsonb_agg(distinct s.name))
          from tag_gruppe g join standort s on s.id = g.standort_id group by lower(g.name)
        union all
        select jsonb_build_object('art', 'merkmal', 'id', min(m.id), 'name', min(m.name), 'zusatz', min(m.typ), 'standorte', jsonb_agg(distinct s.name))
          from merkmal m join standort s on s.id = m.standort_id group by lower(m.name)
        union all
        select jsonb_build_object('art', 'merkmal_wert', 'id', min(w.id), 'name', min(w.wert),
                                  'zusatz', min(m.name) || coalesce(' · ' || min(t.name), ''), 'standorte', jsonb_agg(distinct s.name))
          from merkmal_wert w join merkmal m on m.id = w.merkmal_id and m.standort_id is null
          join standort s on s.id = w.standort_id left join radtyp t on t.id = w.radtyp_id
         group by w.merkmal_id, w.radtyp_id, lower(w.wert)
      ) q), '[]')
  ) into v;
  return v;
end $$;

-- ---------- 5. Sicht ----------

create or replace view v_rad with (security_invoker = true) as
select r.id, r.bezeichnung, r.typ, r.rahmennummer, r.groesse, r.eigentuemer_id, r.aktiv, r.notiz,
       z.sportler_id as fahrer_id,
       s.name        as fahrer,
       z.gueltig_ab  as fahrer_seit,
       r.marke,
       r.geaendert_am,
       r.ort,
       r.merkmale
from rad r
left join zuordnung z on z.rad_id = r.id and z.gueltig_bis is null
left join sportler s  on s.id = z.sportler_id;

-- ---------- 6. Trigger ----------

create trigger rad_ort before insert or update of ort, standort_id on rad
  for each row execute function rad_ort_pruefen();
create trigger rad_typ before insert or update of typ, standort_id on rad
  for each row execute function rad_typ_pruefen();
create trigger rad_merkmale before insert or update of merkmale, typ on rad
  for each row execute function merkmale_pruefen();
create trigger artikel_merkmale before insert or update of merkmale on artikel
  for each row execute function merkmale_pruefen();
create trigger stueck_merkmale before insert or update of merkmale on stueck
  for each row execute function merkmale_pruefen();
create trigger tag_gruppe before insert or update of gruppe, standort_id on tag
  for each row execute function tag_gruppe_pruefen();
create trigger kategorie_vorgabe before insert or update on kategorie
  for each row execute function kategorie_vorgabe_schutz();

-- ---------- 7. Zugriffsregeln und Rechte ----------

alter table vorgabe_kategorie enable row level security;
alter table radtyp enable row level security;
alter table tag_gruppe enable row level security;
alter table merkmal enable row level security;
alter table merkmal_wert enable row level security;
alter table merkmal_ziel enable row level security;
alter table merkmal_pflicht enable row level security;
alter table ausblendung enable row level security;

-- Vorgaben (standort_id leer) und eigene Einträge des gewählten Standorts.
-- Geändert wird nur über die Datenbankfunktionen.
create policy lesen on radtyp for select to anonymous
  using (standort_id = (select akt_standort()) or (standort_id is null and (select akt_standort()) is not null));
create policy lesen on tag_gruppe for select to anonymous
  using (standort_id = (select akt_standort()) or (standort_id is null and (select akt_standort()) is not null));
create policy lesen on merkmal for select to anonymous
  using (standort_id = (select akt_standort()) or (standort_id is null and (select akt_standort()) is not null));
create policy lesen on merkmal_wert for select to anonymous
  using (standort_id = (select akt_standort()) or (standort_id is null and (select akt_standort()) is not null));
create policy lesen on merkmal_ziel for select to anonymous
  using (standort_id = (select akt_standort()) or (standort_id is null and (select akt_standort()) is not null));
create policy lesen on merkmal_pflicht for select to anonymous
  using (standort_id = (select akt_standort()));
create policy lesen on ausblendung for select to anonymous
  using (standort_id = (select akt_standort()));

grant select on radtyp, tag_gruppe, merkmal, merkmal_wert, merkmal_ziel, merkmal_pflicht, ausblendung to anonymous;
grant usage, select on sequence radtyp_id_seq, tag_gruppe_id_seq, merkmal_id_seq, merkmal_wert_id_seq, merkmal_ziel_id_seq to anonymous;

revoke execute on function
  vorgabe_bereich(boolean), vorgabe_laeuft(), rad_ort_pruefen(), rad_typ_pruefen(), tag_gruppe_pruefen(),
  kategorie_vorgabe_schutz(), merkmale_pruefen(), wert_ersetzen(bigint, bigint), wert_doppelt_aufloesen(bigint),
  ziel_doppelt_aufloesen(bigint), vorgabe_zusammenfuehren(text, bigint),
  radtyp_speichern(bigint, text, text, boolean), tag_gruppe_speichern(bigint, text, boolean),
  merkmal_speichern(bigint, text, text, text, boolean), merkmal_wert_speichern(bigint, bigint, bigint, text, boolean),
  merkmal_ziel_setzen(bigint, bigint, text, boolean, boolean), merkmal_pflicht_setzen(bigint, boolean),
  ausblenden(text, bigint, boolean), eintrag_loeschen(text, bigint),
  vorgabe_kategorie_speichern(text, text), vorgabe_kategorie_loeschen(text),
  als_vorgabe_uebernehmen(text, bigint, text), vorgaben()
from public, anonymous;
grant execute on function
  radtyp_speichern(bigint, text, text, boolean), tag_gruppe_speichern(bigint, text, boolean),
  merkmal_speichern(bigint, text, text, text, boolean), merkmal_wert_speichern(bigint, bigint, bigint, text, boolean),
  merkmal_ziel_setzen(bigint, bigint, text, boolean, boolean), merkmal_pflicht_setzen(bigint, boolean),
  ausblenden(text, bigint, boolean), eintrag_loeschen(text, bigint),
  vorgabe_kategorie_speichern(text, text), vorgabe_kategorie_loeschen(text),
  als_vorgabe_uebernehmen(text, bigint, text), vorgaben()
to anonymous;

commit;
