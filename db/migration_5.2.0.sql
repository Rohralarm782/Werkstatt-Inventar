-- =====================================================================
--  Werkstatt RSZ MV — Migration 5.1.0 → 5.2.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_5.1.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- Einzelstücke dürfen aus der App gelöscht werden (für Fehleingaben).
-- Auf Einzelstücke verweist keine andere Tabelle; Buchungen und Tickets
-- sind davon nicht betroffen.
grant delete on stueck to anonymous;

commit;
