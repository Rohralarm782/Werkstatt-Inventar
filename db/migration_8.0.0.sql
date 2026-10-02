-- =====================================================================
--  Werkstatt RSZ MV — Migration 7.0.0 → 8.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_7.0.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Bestellungen: was wurde wann bestellt. Ein Zugang des Artikels
--  schließt offene Bestellungen automatisch ab.
-- ---------------------------------------------------------------------
create table bestellung (
  id           bigint generated always as identity primary key,
  code         text not null references artikel (code),
  menge        numeric not null check (menge > 0),
  bestellt_am  timestamptz not null default now(),
  bearbeiter   text,
  erhalten_am  timestamptz
);
create index bestellung_offen on bestellung (code) where erhalten_am is null;

alter table bestellung enable row level security;
create policy nur_trainer on bestellung for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen     on bestellung for select to anonymous using (true);
create policy offen_bestellen on bestellung for insert to anonymous with check (erhalten_am is null);
create policy offen_loeschen  on bestellung for delete to anonymous using (erhalten_am is null);

create function bestellung_erhalten() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bestellung set erhalten_am = now() where code = new.code and erhalten_am is null;
  return null;
end $$;
revoke execute on function bestellung_erhalten() from public;

create trigger zugang_schliesst_bestellung
  after insert on buchung
  for each row when (new.art = 'zugang')
  execute function bestellung_erhalten();

grant select on bestellung to anonymous;
grant insert (code, menge, bearbeiter) on bestellung to anonymous;
grant delete on bestellung to anonymous;
grant usage, select on sequence bestellung_id_seq to anonymous;
grant select, insert, update, delete on bestellung to authenticated;
grant usage, select on sequence bestellung_id_seq to authenticated;
grant execute on function bestellung_erhalten() to authenticated;

commit;
