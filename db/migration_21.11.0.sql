-- =====================================================================
--  Werkstatt — Migration auf 21.11.0
--  Eine Zuordnung je Einzelstück: am Rad ODER direkt an einen Sportler
--
--  Vorher muss gelaufen sein: db/migration_21.8.0.sql
--  (21.8.1 bis 21.10.3 hatten keine Migration)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Bisher gab es „am Rad“ (rad_id) und „fest zugeordnet an“ (sportler_id)
--    getrennt. Ab jetzt ist ein Stück entweder einem Rad zugeordnet (dann
--    gilt dessen Fahrer) oder direkt einem Sportler (z. B. Laufradtasche).
--  - Stücke, die beides hatten, behalten das Rad; die direkte Zuordnung
--    wird gelöscht (der Fahrer des Rads gilt). Die Liste dieser Stücke
--    gibt die Migration vorher als Hinweis aus (NOTICE).
--  - Neuer Trigger stueck_zuordnung: Wird ein Stück an ein Rad gehängt,
--    leert die Datenbank die direkte Zuordnung selbst.
--  - Neue Prüfung stueck_zuordnung_eins: nie beides gleichzeitig.
--  Sonst bleiben alle Daten erhalten.
-- =====================================================================
begin;

do $$
declare v text;
begin
  select string_agg(nummer, ', ' order by nummer) into v
    from stueck where rad_id is not null and sportler_id is not null;
  if v is not null then
    raise notice 'Direkte Zuordnung entfernt (Stück bleibt am Rad): %', v;
  end if;
end $$;

update stueck set sportler_id = null where rad_id is not null and sportler_id is not null;

create or replace function stueck_zuordnung_eins() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.rad_id is not null and (tg_op = 'INSERT' or new.rad_id is distinct from old.rad_id) then
    new.sportler_id := null;
  end if;
  return new;
end $$;
revoke all on function stueck_zuordnung_eins() from public;

drop trigger if exists stueck_zuordnung on stueck;
create trigger stueck_zuordnung before insert or update of rad_id on stueck
  for each row execute function stueck_zuordnung_eins();   -- ab 21.11.0

alter table stueck add constraint stueck_zuordnung_eins check (rad_id is null or sportler_id is null);

commit;
