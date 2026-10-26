-- =====================================================================
--  Werkstatt — Migration auf 21.1.1
--  Kettenbreite: Wert „schmal 3/32″“ heißt nur noch „schmal“
--
--  Vorher muss gelaufen sein: db/migration_21.1.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Nur der Text des Vorgabe-Werts wird geändert. Räder speichern die id
--    des Werts, Zuordnungen bleiben also erhalten.
--  - Gibt es „schmal“ schon, bleibt alles unverändert.
-- =====================================================================

begin;

update merkmal_wert w
   set wert = 'schmal'
  from merkmal m
 where w.merkmal_id = m.id
   and m.name = 'Kettenbreite' and m.standort_id is null
   and w.wert = 'schmal 3/32″'
   and not exists (select 1 from merkmal_wert x
                    where x.merkmal_id = w.merkmal_id
                      and coalesce(x.standort_id, 0) = coalesce(w.standort_id, 0)
                      and coalesce(x.radtyp_id, 0) = coalesce(w.radtyp_id, 0)
                      and lower(x.wert) = 'schmal');

commit;
