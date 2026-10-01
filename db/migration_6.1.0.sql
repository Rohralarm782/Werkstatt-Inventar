-- =====================================================================
--  Werkstatt RSZ MV — Migration 6.0.0 → 6.1.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_6.0.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Ticket anlegen: ein Einzelstück mit Ticket wird automatisch auf
--  „zu prüfen“ gesetzt (aus „frei“; „defekt“ bleibt „defekt“).
-- ---------------------------------------------------------------------
create or replace function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      bigint;
  v_rad     text := nullif(trim(coalesce(p_rad, '')), '');
  v_fahrer  bigint;
  v_kt      bigint;
  v_pos     jsonb;
begin
  if p_client_id is not null then
    select id into v_id from ticket where client_id = p_client_id;
    if found then return v_id; end if;
  end if;

  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  if p_stueck is not null then
    if not exists (select 1 from stueck where nummer = p_stueck) then raise exception 'Unbekanntes Einzelstück: %', p_stueck; end if;
    if v_rad is null then select rad_id into v_rad from stueck where nummer = p_stueck; end if;
  end if;
  if v_rad is null and p_stueck is null then raise exception 'Rad oder Einzelstück fehlt'; end if;

  if v_rad is not null then
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
    select eigentuemer_id into v_kt from rad where id = v_rad;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
  end if;

  insert into ticket (rad_id, stueck_nummer, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id)
  values (v_rad, p_stueck, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- Gleichzeitig angekommen: das andere hat gewonnen, dessen Ticket gilt.
  if v_id is null then
    select id into v_id from ticket where client_id = p_client_id;
    return v_id;
  end if;

  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    insert into ticket_position (ticket_id, code, menge)
    values (v_id, v_pos ->> 'code', coalesce((v_pos ->> 'menge')::numeric, 1));
  end loop;

  -- Einzelstück mit Ticket muss geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  if p_stueck is not null then
    update stueck set zustand = 'zu prüfen' where nummer = p_stueck and zustand = 'frei';
  end if;

  return v_id;
end $$;

commit;
