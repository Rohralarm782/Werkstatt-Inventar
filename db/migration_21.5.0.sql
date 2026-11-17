-- =====================================================================
--  Werkstatt — Migration auf 21.5.0
--  Einzelstücke fest einem Sportler zuordnen
--
--  Vorher muss gelaufen sein: db/migration_21.4.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - stueck bekommt die Spalte sportler_id: fest zugeordneter Sportler
--    (z. B. Laufräder in der Laufradtasche). Leer = niemand.
--  - Ein Trigger lässt nur Sportler desselben Standorts zu, keine
--    Kostenträger.
--  - Sportler-Konten sehen zusätzlich die Stücke, die ihnen fest
--    zugeordnet sind.
--  - stueck_anlegen (und damit stueck_serie_anlegen) übernimmt sportler_id.
--  - Vorhandene Daten bleiben unverändert. Die App 21.4.0 läuft mit der
--    Migration weiter.
-- =====================================================================

begin;

-- ---------- 1. Spalte ----------

alter table stueck add column sportler_id bigint references sportler (id);
create index stueck_sportler on stueck (sportler_id) where sportler_id is not null;

-- ---------- 2. Prüfung ----------

create or replace function stueck_sportler_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sportler_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.sportler_id is not distinct from old.sportler_id and new.standort_id = old.standort_id then return new; end if;
  if not exists (select 1 from sportler where id = new.sportler_id and standort_id = new.standort_id and art = 'sportler') then
    raise exception 'Fest zuordnen geht nur an einen Sportler dieses Standorts (kein Kostenträger)';
  end if;
  return new;
end $$;

create trigger stueck_sportler before insert or update of sportler_id, standort_id on stueck
  for each row execute function stueck_sportler_pruefen();
revoke execute on function stueck_sportler_pruefen() from public, anonymous;

-- ---------- 3. Anlegen ----------

create or replace function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz, standort_id, merkmale, sportler_id)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''),
          v_st,
          coalesce(p_daten -> 'merkmale', '{}'::jsonb),
          nullif(p_daten ->> 'sportler_id', '')::bigint);
  insert into stueck_tag (nummer, tag_id)
    select v_nr, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_nr;
end $$;

-- ---------- 4. Lesen für Sportler ----------

drop policy lesen on stueck;
create policy lesen on stueck for select to anonymous
  using (standort_id = (select akt_standort())
         and ((select rolle_in('admin', 'manager', 'trainer', 'geschaeftsstelle'))
              or (rad_id is not null and mein_rad(rad_id))
              or (sportler_id is not null and sportler_id = (select mein_sportler()))));

commit;
