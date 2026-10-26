-- =====================================================================
--  Werkstatt — Migration auf 21.2.0
--  App lädt alles in einer Anfrage (app_daten)
--
--  Vorher muss gelaufen sein: db/migration_21.1.1.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Neue Funktion app_daten(): liefert in einer Antwort, was die App bisher
--    mit rund 33 einzelnen Abfragen geholt hat. Sie läuft mit den Rechten
--    des Aufrufers, es gelten also genau dieselben Zeilenrechte wie vorher.
--  - Es wird nur etwas hinzugefügt; Tabellen und Daten bleiben unverändert.
--    Die Migration kann tagsüber vorab laufen, die bisherige App läuft weiter.
--    Die App ab 21.2.0 braucht die Funktion.
-- =====================================================================

begin;

-- Alles, was die App nach dem Start und nach jeder Änderung braucht, in einer
-- Anfrage (ab 21.2.0; vorher ~33 einzelne Abfragen). Läuft mit den Rechten
-- des Aufrufers (security invoker): Es gelten dieselben Zeilenrechte wie bei
-- den einzelnen Abfragen. „daten“ nur für Werkstatt-Manager, Trainer und
-- Geschäftsstelle; sonst null (Sportler lädt die App wie bisher einzeln).
create or replace function app_daten() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_ich  jsonb := ich();
  v_t    bigint[];
  v_a    jsonb;
  v_b    jsonb;
begin
  if v_ich is null or coalesce(v_ich ->> 'rolle', '') not in ('manager', 'trainer', 'geschaeftsstelle') then
    return jsonb_build_object('ich', v_ich, 'daten', null);
  end if;
  select coalesce(array_agg(t.id), '{}') into v_t from ticket t where t.status in ('offen', 'angenommen');
  v_a := jsonb_build_object(
    'bestand',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.code), '[]') from v_bestand x),
    'artikel',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.code), '[]') from artikel x),
    'raeder',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from v_rad x),
    'sportler',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from sportler x),
    'stueck',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.nummer), '[]') from stueck x),
    'tickets',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from ticket x where x.id = any (v_t)),
    'positionen',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from ticket_position x
                      where x.ticket_id = any (v_t) and x.status <> 'storniert'),
    'ticket_stueck',(select coalesce(jsonb_agg(to_jsonb(x)), '[]') from ticket_stueck x where x.ticket_id = any (v_t)),
    'koffer',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.ort, x.code), '[]') from v_koffer x),
    'termine',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.datum), '[]') from termin x
                      where x.datum >= (now() at time zone 'Europe/Berlin')::date),
    'standort',     (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', x.id, 'name', x.name, 'kuerzel', x.kuerzel, 'aktiv', x.aktiv, 'rg_empfaenger', x.rg_empfaenger,
                       'rg_absender', x.rg_absender, 'rg_kopf', x.rg_kopf, 'rg_fuss', x.rg_fuss, 'rg_text', x.rg_text,
                       'iban', x.iban, 'bic', x.bic, 'bank', x.bank, 'zahlungsziel_tage', x.zahlungsziel_tage,
                       'rad_vorlage', x.rad_vorlage, 'rad_stellen', x.rad_stellen)), '[]') from standort x),
    'rechnungen',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]')
                       from (select * from rechnung order by id desc limit 100) x),
    'offene_posten',(select coalesce(jsonb_agg(to_jsonb(x) order by x.zeit), '[]') from v_offene_posten x),
    'zaehlung',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from zaehlung x),
    'bestellungen', (select coalesce(jsonb_agg(to_jsonb(x) order by x.bestellt_am), '[]') from bestellung x where x.erhalten_am is null)
  );
  v_b := jsonb_build_object(
    'tags',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.buchstabe, x.sortierung, x.name), '[]') from tag x),
    'artikel_tag',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from artikel_tag x),
    'stueck_tag',   (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from stueck_tag x),
    'kategorien',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.buchstabe), '[]') from kategorie x),
    'lagerorte',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from lagerort x),
    'bestand_ort',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from v_bestand_ort x),
    'bestand_groesse', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from v_bestand_groesse x),
    'ausgeliehen',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.seit desc), '[]') from v_ausgeliehen x),
    'personen',     case when rolle_in('manager', 'trainer') then werkstatt_personen() end,
    'radtypen',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from radtyp x),
    'gruppen',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from tag_gruppe x),
    'merkmale',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from merkmal x),
    'werte',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.id), '[]') from merkmal_wert x),
    'ziele',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.id), '[]') from merkmal_ziel x),
    'pflicht',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from merkmal_pflicht x),
    'aus',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from ausblendung x)
  );
  return jsonb_build_object('ich', v_ich, 'daten', v_a || v_b);
end $$;

revoke execute on function app_daten() from public;
grant execute on function app_daten() to anonymous;

commit;
