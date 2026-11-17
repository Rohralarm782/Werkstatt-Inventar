-- =====================================================================
--  Werkstatt — Migration auf 21.6.0
--  Sportler melden Probleme für ihr Material, Koffer-Packliste aufräumen
--
--  Vorher muss gelaufen sein: db/migration_21.5.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - ticket_anlegen: Sportler dürfen auch für Einzelstücke melden, die ihnen
--    fest zugeordnet sind (pro Teil höchstens ein offenes Ticket). Ein Ticket
--    nur mit Einzelstücken, die alle fest bei einem Sportler sind, bekommt
--    diesen Sportler als Fahrer (gilt auch, wenn die Werkstatt es anlegt).
--    Aufruf und Parameter bleiben gleich.
--  - Positionen der Koffer-Packliste dürfen jetzt auch Trainer/Mechaniker
--    entfernen (bisher nur der Werkstatt-Manager).
--  - Vorhandene Daten bleiben unverändert. Die App 21.5.0 läuft mit der
--    Migration weiter.
-- =====================================================================

begin;

-- ---------- 1. Tickets ----------

create or replace function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null,
  p_zuweisen text default null, p_aufwand text default null
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
  v_wer      text;
  v_aufwand  text;
  v_fest     boolean;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  -- Werkstatt-Rolle geht vor; sonst nur als Sportler (eigene Räder und fest zugeordnetes Material)
  v_rolle := case when rolle_in('admin', 'manager', 'trainer') then 'werkstatt'
                  when mein_sportler() is not null then 'sportler' end;
  if v_rolle is null then raise exception 'Keine Berechtigung'; end if;
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

  -- Sportler meldet für eigenes Material (ab 21.6.0): alle Teile fest ihm zugeordnet
  v_fest := v_rolle = 'sportler' and cardinality(v_stuecke) > 0
            and not exists (select 1 from stueck where nummer = any (v_stuecke) and sportler_id is distinct from mein_sportler());

  -- Ohne Rad: stecken die Teile an genau einem Rad, gilt das Ticket für dieses Rad
  -- (nicht bei eigenem Material eines Sportlers: dann gilt es für die Teile)
  if v_rad is null and cardinality(v_stuecke) > 0 and not v_fest then
    select array_agg(distinct rad_id) into v_raeder from stueck where nummer = any (v_stuecke) and rad_id is not null;
    if cardinality(v_raeder) = 1 then v_rad := v_raeder[1]; end if;
  end if;
  -- Ohne Rad und ohne Einzelstück: allgemeines Ticket (z. B. Werkstatt aufräumen), nicht für Sportler

  if v_rolle = 'sportler' then
    p_positionen := '[]'::jsonb;
    p_arbeitsort := 'Werkstatt';
    if v_rad is null and v_fest then
      -- Eigenes Material: pro Teil höchstens ein offenes Ticket
      perform pg_advisory_xact_lock(hashtext('ticket_sportler_' || mein_sportler()));
      select t.id into v_id from ticket t join ticket_stueck ts on ts.ticket_id = t.id
       where ts.nummer = any (v_stuecke) and t.status in ('offen', 'angenommen') order by t.id limit 1;
      if v_id is not null then
        raise exception 'Für dieses Teil ist schon ein Ticket offen (T-%) – ergänze dort Fotos oder sprich die Werkstatt an', lpad(v_id::text, 4, '0');
      end if;
    else
      if v_rad is null or not mein_rad(v_rad) then raise exception 'Tickets nur für die eigenen Räder und das eigene Material'; end if;
      if exists (select 1 from stueck where nummer = any (v_stuecke) and rad_id is distinct from v_rad) then
        raise exception 'Nur Teile, die an deinem Rad sind';
      end if;
      -- Pro Rad höchstens ein offenes Ticket, wenn ein Sportler meldet
      perform pg_advisory_xact_lock(hashtext('ticket_rad_' || v_rad));
      select id into v_id from ticket where rad_id = v_rad and status in ('offen', 'angenommen') order by id limit 1;
      if v_id is not null then
        raise exception 'Für dieses Rad ist schon ein Ticket offen (T-%) – ergänze dort Fotos oder sprich die Werkstatt an', lpad(v_id::text, 4, '0');
      end if;
    end if;
  end if;

  p_arbeitsort := coalesce(nullif(trim(p_arbeitsort), ''), 'Werkstatt');
  perform ort_pruefen(v_st, p_arbeitsort);

  -- Gleich jemandem zuweisen (nur Werkstatt-Rolle, nur an Manager/Trainer hier)
  if v_rolle = 'werkstatt' and nullif(trim(coalesce(p_zuweisen, '')), '') is not null then
    select k.name into v_wer
      from konto k
     where k.aktiv and lower(trim(k.name)) = lower(trim(p_zuweisen))
       and exists (select 1 from konto_rolle r where r.konto_id = k.id and r.standort_id = v_st
                                               and r.rolle in ('manager', 'trainer'))
     order by k.id limit 1;
    if v_wer is null then raise exception 'Zuweisen geht nur an Werkstatt-Personen dieses Standorts: %', p_zuweisen; end if;
    v_aufwand := coalesce(nullif(trim(coalesce(p_aufwand, '')), ''), 'klein');
    if v_aufwand not in ('klein', 'mittel', 'groß') then raise exception 'Unbekannter Aufwand: %', p_aufwand; end if;
  end if;

  if v_rad is not null then
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
    -- Kostenträger: Eigentümer des Rads; „Fahrer selbst“ = wer es gerade fährt (ab 21.3.0)
    select case when eigentuemer_fahrer then v_fahrer else eigentuemer_id end into v_kt
      from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
  elsif cardinality(v_stuecke) > 0 then
    -- Nur Einzelstücke, alle fest bei einem Sportler (ab 21.6.0): er ist der Fahrer des Tickets
    select min(sportler_id) into v_fahrer from stueck where nummer = any (v_stuecke)
    having count(distinct sportler_id) = 1 and count(*) = count(sportler_id);
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id, standort_id,
                      status, uebernommen_von, aufwand)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id, v_st,
          case when v_wer is null then 'offen' else 'angenommen' end, v_wer, coalesce(v_aufwand, 'klein'))
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

-- ---------- 2. Koffer-Packliste ----------

drop policy loeschen on koffer_soll;
create policy loeschen on koffer_soll for delete to anonymous
  using (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer')));

commit;
