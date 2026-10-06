-- =====================================================================
--  Werkstatt — Migration auf 14.3.0: allgemeine Tickets ohne Rad und
--  ohne Einzelstück (z. B. „Werkstatt aufräumen“)
--
--  Vorher muss gelaufen sein: db/migration_14.2.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - ticket_anlegen: Trainer und Manager dürfen ein Ticket ohne Rad und
--    ohne Einzelstück anlegen. Sportler weiterhin nur für eigene Räder.
--  - ticket_stuecke_aendern: Bei einem Ticket ohne Rad darf auch das
--    letzte Einzelstück herausgenommen werden.
--  Keine Tabellen oder Spalten, Rechte bleiben (gleiche Signaturen).
--  Vorhandene Daten bleiben unverändert. Lässt sich gefahrlos ein zweites
--  Mal ausführen.
-- =====================================================================

begin;

create or replace function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st       bigint;
  v_rolle    text;
  v_id       bigint;
  v_rad      text := nullif(trim(coalesce(p_rad, '')), '');
  v_fahrer   bigint;
  v_kt       bigint;
  v_pos      jsonb;
  v_stuecke  text[];
  v_fehlt    text;
  v_raeder   text[];
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  v_rolle := meine_rolle();
  if v_rolle not in ('admin', 'manager', 'trainer', 'sportler') then raise exception 'Keine Berechtigung'; end if;
  p_bearbeiter := ich_name();

  if p_client_id is not null then
    select id into v_id from ticket where client_id = p_client_id;
    if found then return v_id; end if;
  end if;

  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  -- Einzelstücke: beide Angaben zusammen, ohne Leere und Doppelte, Reihenfolge bleibt
  select coalesce(array_agg(n order by i), '{}') into v_stuecke
    from (select n, min(i) as i
            from unnest(coalesce(p_stuecke, '{}') || array[p_stueck]) with ordinality as x(n, i)
           where nullif(trim(n), '') is not null
           group by n) y;

  select string_agg(n, ', ') into v_fehlt
    from unnest(v_stuecke) as n where not exists (select 1 from stueck where nummer = n and standort_id = v_st);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  -- Ohne Rad: stecken die Teile an genau einem Rad, gilt das Ticket für dieses Rad
  if v_rad is null and cardinality(v_stuecke) > 0 then
    select array_agg(distinct rad_id) into v_raeder from stueck where nummer = any (v_stuecke) and rad_id is not null;
    if cardinality(v_raeder) = 1 then v_rad := v_raeder[1]; end if;
  end if;
  -- Ohne Rad und ohne Einzelstück: allgemeines Ticket (z. B. Werkstatt aufräumen), nicht für Sportler

  if v_rolle = 'sportler' then
    if v_rad is null or not mein_rad(v_rad) then raise exception 'Tickets nur für die eigenen Räder'; end if;
    if exists (select 1 from stueck where nummer = any (v_stuecke) and rad_id is distinct from v_rad) then
      raise exception 'Nur Teile, die an deinem Rad sind';
    end if;
    p_positionen := '[]'::jsonb;
    p_arbeitsort := 'Werkstatt';
    -- Pro Rad höchstens ein offenes Ticket, wenn ein Sportler meldet
    perform pg_advisory_xact_lock(hashtext('ticket_rad_' || v_rad));
    select id into v_id from ticket where rad_id = v_rad and status in ('offen', 'angenommen') order by id limit 1;
    if v_id is not null then
      raise exception 'Für dieses Rad ist schon ein Ticket offen (T-%) – ergänze dort Fotos oder sprich die Werkstatt an', lpad(v_id::text, 4, '0');
    end if;
  end if;

  if v_rad is not null then
    select eigentuemer_id into v_kt from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id, standort_id)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id, v_st)
  on conflict (client_id) do nothing
  returning id into v_id;

  -- Gleichzeitig angekommen: das andere hat gewonnen, dessen Ticket gilt.
  if v_id is null then
    select id into v_id from ticket where client_id = p_client_id;
    return v_id;
  end if;

  insert into ticket_stueck (ticket_id, nummer) select v_id, n from unnest(v_stuecke) as n;

  -- Schritte: {"code":"A-104","menge":1} oder {"titel":"Laufrad zentrieren","dauer_min":20}
  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    if nullif(v_pos ->> 'code', '') is not null
       and not exists (select 1 from artikel where code = v_pos ->> 'code' and standort_id = v_st) then
      raise exception 'Unbekannter Artikel: %', v_pos ->> 'code';
    end if;
    insert into ticket_position (ticket_id, code, titel, menge, dauer_min)
    values (v_id, nullif(v_pos ->> 'code', ''), nullif(trim(v_pos ->> 'titel'), ''),
            coalesce((v_pos ->> 'menge')::numeric, 1), (v_pos ->> 'dauer_min')::integer);
  end loop;

  -- Einzelstücke mit Ticket müssen geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  update stueck set zustand = 'zu prüfen' where nummer = any (v_stuecke) and zustand = 'frei';

  return v_id;
end $$;

create or replace function ticket_stuecke_aendern(p_ticket bigint, p_mit text[] default null, p_ohne text[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st     bigint := recht_arbeiten();
  t        ticket;
  v_fehlt  text;
  v_neu    text[];
  v_weg    text[];
begin
  select * into t from ticket where id = p_ticket and standort_id = v_st for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(n, ', ') into v_fehlt
    from unnest(coalesce(p_mit, '{}')) as n where not exists (select 1 from stueck where nummer = n and standort_id = v_st);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  with neu as (
    insert into ticket_stueck (ticket_id, nummer)
      select p_ticket, n from unnest(coalesce(p_mit, '{}')) as n
       where not (n = any (coalesce(p_ohne, '{}')))
      on conflict do nothing
      returning nummer
  ) select coalesce(array_agg(nummer), '{}') into v_neu from neu;
  update stueck set zustand = 'zu prüfen' where nummer = any (v_neu) and zustand = 'frei';

  with weg as (
    delete from ticket_stueck where ticket_id = p_ticket and nummer = any (coalesce(p_ohne, '{}'))
      returning nummer
  ) select coalesce(array_agg(nummer), '{}') into v_weg from weg;
  update stueck s set zustand = 'frei'
   where s.nummer = any (v_weg) and s.zustand = 'zu prüfen'
     and not exists (select 1 from ticket_stueck ts join ticket x on x.id = ts.ticket_id
                      where ts.nummer = s.nummer and x.status in ('offen', 'angenommen'))
     and not exists (select 1 from ticket x where x.rad_id = s.rad_id and x.status in ('offen', 'angenommen'));

  -- Ab 14.3.0 darf ein Ticket ohne Rad auch ohne Einzelstück bleiben (allgemeines Ticket).
end $$;

commit;
