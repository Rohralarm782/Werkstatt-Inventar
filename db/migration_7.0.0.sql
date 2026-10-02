-- =====================================================================
--  Werkstatt RSZ MV — Migration 6.1.0 → 7.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_6.1.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- Arbeitszeit je Artikel in Minuten (je Stück bzw. je Leistung) — daraus
-- schätzt die App den Arbeitsaufwand eines Tickets.
alter table artikel add column dauer_min integer check (dauer_min is null or dauer_min >= 0);

-- Artikel anlegen: Arbeitszeit mit übernehmen
create or replace function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
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
  return v_code;
end $$;

commit;
