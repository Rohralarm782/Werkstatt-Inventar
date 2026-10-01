-- =====================================================================
--  Werkstatt RSZ MV — Migration 5.0.x → 5.1.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_5.0.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

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

revoke execute on function stueck_serie_anlegen(text, integer, jsonb, integer) from public;
grant execute on function stueck_serie_anlegen(text, integer, jsonb, integer) to authenticated, anonymous;

commit;
