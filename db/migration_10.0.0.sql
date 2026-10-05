-- =====================================================================
--  Werkstatt RSZ MV — Migration auf 10.0.0: Unterkategorien
--
--  Für eine bestehende Datenbank ab Stand 9.x. Einmal komplett im
--  SQL-Editor von Neon ausführen, danach: Data API → "Refresh schema cache".
--
--  Die Kategorie bleibt der Buchstabe im Code (L-512 → L). Eine
--  Unterkategorie ist nur eine Zuordnung — Codes, Nummern und Etiketten
--  ändern sich dadurch nicht. Bestehende Artikel und Einzelstücke haben
--  danach erst einmal keine Unterkategorie.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Tabelle: je Kategorie-Buchstabe eine eigene Liste
-- ---------------------------------------------------------------------
create table unterkategorie (
  id          bigint generated always as identity primary key,
  buchstabe   text not null check (buchstabe ~ '^[A-Z]{1,3}$'),
  name        text not null check (trim(name) <> ''),
  sortierung  integer not null default 0,
  unique (buchstabe, name)
);

-- Löschen einer Unterkategorie nimmt nur die Zuordnung weg.
alter table artikel add column unterkategorie_id bigint references unterkategorie (id) on delete set null;
alter table stueck  add column unterkategorie_id bigint references unterkategorie (id) on delete set null;
create index artikel_unterkategorie on artikel (unterkategorie_id);
create index stueck_unterkategorie  on stueck  (unterkategorie_id);

-- ---------------------------------------------------------------------
--  Anlegen mit automatischer Nummer: Unterkategorie gleich mit speichern
--  (gleiche Signatur wie bisher, Rechte bleiben erhalten)
-- ---------------------------------------------------------------------
create or replace function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_code := naechster_code(p_buchstabe, p_gruppe);
  insert into artikel (code, name, einheit, preis, mindestbestand, lieferzeit_tage, art,
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min,
                       unterkategorie_id)
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
          (p_daten ->> 'unterkategorie_id')::bigint);
  return v_code;
end $$;

create or replace function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz, unterkategorie_id)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''),
          (p_daten ->> 'unterkategorie_id')::bigint);
  return v_nr;
end $$;

-- ---------------------------------------------------------------------
--  Zugriff: wie die übrigen Stammdaten (lesen, anlegen, ändern) —
--  zusätzlich löschen, weil dabei nur Zuordnungen wegfallen.
-- ---------------------------------------------------------------------
alter table unterkategorie enable row level security;
create policy nur_trainer on unterkategorie for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
create policy offen on unterkategorie for all to anonymous using (true) with check (true);

grant select, insert, update, delete on unterkategorie to authenticated;
grant select, insert, update, delete on unterkategorie to anonymous;
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to anonymous;

commit;
