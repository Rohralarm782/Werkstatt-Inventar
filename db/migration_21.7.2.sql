-- =====================================================================
--  Werkstatt — Migration auf 21.7.2
--  „Was ist neu?“ je Konto statt je Gerät
--
--  Vorher muss gelaufen sein: db/migration_21.7.0.sql
--  (21.7.1 hatte keine Migration)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache" (neue Funktion!).
--
--  Was passiert:
--  - Neue Spalte konto.neu_gesehen: bis zu welcher Version das Konto
--    „Was ist neu?“ gesehen hat. Vorher stand das nur im Browser, darum kam
--    das Fenster auf jedem Gerät noch einmal.
--  - konto_info (und damit ich() / app_daten) liefert neu_gesehen mit.
--  - Neue Funktion neu_gesehen_setzen(version) für die angemeldete Person;
--    der Stand wird nur nach vorne gesetzt, nie zurück.
--  - Vorhandene Daten bleiben unverändert (neu_gesehen ist anfangs leer;
--    die App übernimmt beim ersten Laden den Stand aus dem Browser).
-- =====================================================================

begin;

alter table konto add column if not exists neu_gesehen text;

create or replace function konto_info(p_konto bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'konto_id', k.id, 'name', k.name, 'gesamt_admin', k.gesamt_admin, 'sportler_id', k.sportler_id,
           'pin_laenge', pin_laenge(k.id), 'neu_gesehen', k.neu_gesehen,
           'standorte', coalesce((
             select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'kuerzel', st.kuerzel,
                                                 'rolle', x.rollen[1], 'rollen', to_jsonb(x.rollen)) order by st.name)
               from standort st
               cross join lateral (select rollen_von(k.id, st.id) as rollen) x
              where st.aktiv and cardinality(x.rollen) > 0), '[]'::jsonb))
    from konto k where k.id = p_konto;
$$;

-- „Was ist neu?“ gesehen (ab 21.7.2): je Konto, auf allen Geräten gleich.
-- Nur vorwärts: ein Gerät mit älterer App setzt den Stand nicht zurück.
create or replace function neu_gesehen_setzen(p_version text) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update konto set neu_gesehen = p_version
   where id = ich_id()
     and p_version ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'
     and (neu_gesehen is null
          or string_to_array(neu_gesehen, '.')::int[] < string_to_array(p_version, '.')::int[]);
$$;

revoke execute on function neu_gesehen_setzen(text) from public;
grant execute on function neu_gesehen_setzen(text) to anonymous;

commit;
