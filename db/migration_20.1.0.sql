-- =====================================================================
--  Werkstatt — Migration auf 20.1.0: Standard-Lieferzeit 3 Werktage
--  für die bestehenden Artikel in Schwerin
--
--  Vorher muss gelaufen sein: db/migration_20.0.0.sql
--  (20.0.1 hatte keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Nur Standort mit Kürzel SN (RSZ Schwerin). Andere Standorte bleiben
--    unverändert.
--  - Artikel mit Lieferzeit 0 bekommen 3 (Werktage). Ausgenommen sind
--    Pauschalen (Leistungen, kein Bestand). Wo schon eine Lieferzeit
--    eingetragen ist, bleibt sie stehen.
--  - Der Zeitpunkt der letzten Änderung (geaendert_am) bleibt stehen,
--    damit die Sortierung "letzte Änderung" nicht durcheinanderkommt:
--    der Trigger zz_artikel_geaendert ist dafür nur während dieser
--    Migration abgeschaltet.
--  - Keine Änderung an Tabellen, Spalten oder Funktionen.
--  Bricht ab, wenn es keinen Standort mit Kürzel SN gibt.
-- =====================================================================

begin;

do $$
declare
  v_standort bigint;
  v_anzahl   integer;
begin
  select id into v_standort from standort where kuerzel = 'SN';
  if v_standort is null then
    raise exception 'Standort mit Kürzel SN (Schwerin) nicht gefunden — nichts geändert';
  end if;

  alter table artikel disable trigger zz_artikel_geaendert;

  update artikel
     set lieferzeit_tage = 3
   where standort_id = v_standort
     and lieferzeit_tage = 0
     and art <> 'Pauschale';
  get diagnostics v_anzahl = row_count;

  alter table artikel enable trigger zz_artikel_geaendert;

  raise notice 'Schwerin: % Artikel auf 3 Werktage Lieferzeit gesetzt', v_anzahl;
end $$;

commit;
