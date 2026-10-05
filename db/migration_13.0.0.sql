-- =====================================================================
--  Werkstatt RSZ MV — Migration auf 13.0.0: Kategorie-Namen in der Datenbank
--
--  Vorher muss gelaufen sein: db/migration_12.0.0.sql (mehrere
--  Einzelstücke je Ticket).
--
--  Einmal komplett im SQL-Editor von Neon ausführen, danach:
--  Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Neue Tabelle kategorie (Buchstabe → Name). Bisher standen die Namen
--    fest in der App; neue Buchstaben hießen nur „Kategorie X“.
--  - Die sechs bisherigen Kategorien (A, B, C, L, R, W) werden mit ihren
--    bisherigen Namen eingetragen.
--  - Ohne Anmeldung: lesen, anlegen, umbenennen — nicht löschen.
--  Codes, Etiketten, Tags und Bestände bleiben unverändert.
-- =====================================================================

begin;

create table kategorie (
  buchstabe  text primary key check (buchstabe ~ '^[A-Z]{1,3}$'),
  name       text not null unique check (trim(name) <> '')
);

insert into kategorie (buchstabe, name) values
  ('A', 'Antrieb'),
  ('B', 'Bremse'),
  ('C', 'Cockpit & Vorbau'),
  ('L', 'Laufrad & Reifen'),
  ('R', 'Rahmen'),
  ('W', 'Werkstattmaterial');

alter table kategorie enable row level security;
create policy nur_trainer on kategorie for all to authenticated using (ist_trainer()) with check (ist_trainer());
create policy offen on kategorie for all to anonymous using (true) with check (true);

grant select, insert, update, delete on kategorie to authenticated;
grant select, insert, update on kategorie to anonymous;

commit;
