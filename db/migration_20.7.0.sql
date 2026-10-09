-- =====================================================================
--  Werkstatt — Migration auf 20.7.0
--  Packungsinhalt für die Bestellung (Sammel-Warenkorb, Bestellliste)
--
--  Vorher muss gelaufen sein: db/migration_20.5.0.sql
--  (20.6.0 und 20.6.1 hatten keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - artikel bekommt die optionale Spalte packungsinhalt: wie viel (in der
--    Einheit des Artikels) in einer Shop-Packung steckt, z. B. 500 bei
--    Bremsöl in ml. Leer = wie bisher (1 Einheit = 1 Stück im Shop).
--    Bestand, Buchungen und Pauschalen rechnen weiter in der Einheit.
--  - artikel_anlegen übernimmt packungsinhalt beim Anlegen.
--  Vorhandene Daten bleiben unverändert erhalten.
-- =====================================================================

begin;

alter table artikel
  add column packungsinhalt numeric check (packungsinhalt is null or packungsinhalt > 0);

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
                       packungsinhalt)
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
          (p_daten ->> 'packungsinhalt')::numeric);
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where t.buchstabe = p_buchstabe and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

commit;
