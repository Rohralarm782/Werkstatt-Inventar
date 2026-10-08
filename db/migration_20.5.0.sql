-- =====================================================================
--  Werkstatt — Migration auf 20.5.0
--  1. Ticket beim Anlegen gleich zuweisen („Wer macht es?“)
--  2. Benachrichtigungen 07:00–18:00 im Halbstunden-Takt
--     (bisher 07:00–12:00 im Viertelstunden-Takt)
--
--  Vorher muss gelaufen sein: db/migration_20.2.0.sql
--  (20.2.1 bis 20.4.0 hatten keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - ticket_anlegen bekommt zwei zusätzliche, optionale Angaben:
--    p_zuweisen (Name einer Person mit Rolle Manager oder Trainer an diesem
--    Standort) und p_aufwand. Mit p_zuweisen ist das Ticket gleich „in
--    Arbeit“ bei dieser Person. Ohne die Angaben wie bisher (auch Tickets,
--    die eine ältere App offline gespeichert hat). Die alte Fassung wird
--    entfernt, damit es keine zwei gleichnamigen Funktionen gibt.
--  - Neue Funktion werkstatt_personen(): Namen der Werkstatt-Personen am
--    Standort für die Auswahl „Wer macht es?“.
--  - push_einstellung: gespeicherte Uhrzeiten auf :15 oder :45 werden auf
--    die nächste halbe Stunde gesetzt (07:15 → 07:30, 08:45 → 09:00), die
--    Prüfung lautet 07:00–18:00, nur volle und halbe Stunden;
--    push_einstellung_setzen prüft dasselbe.
--  Tabellen und Spalten bleiben, vorhandene Daten bleiben erhalten (außer
--  der Rundung der Uhrzeiten).
-- =====================================================================

begin;

-- ---------- 1. Ticket beim Anlegen zuweisen ----------

drop function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[]);

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt. Kommt dieselbe
-- Kennung vom Gerät ein zweites Mal (Nachsenden nach Funkloch), gibt es kein
-- zweites Ticket. Einzelstücke: p_stuecke (Liste) und/oder p_stueck (eines).
-- Sportler dürfen Tickets für ihre eigenen Räder anlegen — ohne Material und
-- Arbeitsschritte, nur in der Werkstatt, und pro Rad nur, solange dort kein
-- Ticket offen ist.
-- Ab 20.5.0: p_zuweisen = Name einer Person mit Werkstatt-Rolle (Manager oder
-- Trainer) an diesem Standort — das Ticket ist dann gleich übernommen, mit
-- p_aufwand (klein | mittel | groß). Sportler können nicht zuweisen.
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
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  -- Werkstatt-Rolle geht vor; sonst nur als Sportler (eigene Räder)
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
    select eigentuemer_id into v_kt from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
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

-- Werkstatt-Personen am gewählten Standort (aktive Konten mit Rolle Manager
-- oder Trainer), nach Name — für „Wer macht es?“ beim neuen Ticket (ab 20.5.0).
-- Nur Namen, für alle mit Werkstatt-Rolle.
create or replace function werkstatt_personen() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := akt_standort();
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if v_st is null or not rolle_in('admin', 'manager', 'trainer') then raise exception 'Keine Berechtigung'; end if;
  return coalesce((
    select jsonb_agg(k.name order by lower(k.name))
      from konto k
     where k.aktiv
       and exists (select 1 from konto_rolle r where r.konto_id = k.id and r.standort_id = v_st
                                               and r.rolle in ('manager', 'trainer'))), '[]'::jsonb);
end $$;

revoke execute on function
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[], text, text),
  werkstatt_personen()
from public, anonymous;
grant execute on function
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[], text, text),
  werkstatt_personen()
to anonymous;

-- ---------- 2. Benachrichtigungen 07:00–18:00, halbstündlich ----------

alter table push_einstellung drop constraint push_einstellung_uhrzeit_check;

update push_einstellung
   set uhrzeit = date_trunc('hour', timestamp '2000-01-01' + uhrzeit)::time
                 + case when extract(minute from uhrzeit) = 0 then interval '0'
                        when extract(minute from uhrzeit) <= 30 then interval '30 minutes'
                        else interval '60 minutes' end
 where extract(minute from uhrzeit)::int not in (0, 30) or extract(second from uhrzeit) <> 0;

alter table push_einstellung add constraint push_einstellung_uhrzeit_check
  check (uhrzeit between time '07:00' and time '18:00'
         and extract(minute from uhrzeit)::int % 30 = 0 and extract(second from uhrzeit) = 0);

create or replace function push_einstellung_setzen(p_uhrzeit text, p_tage integer[], p_dringend boolean, p_bald boolean,
                                                   p_bestellen boolean, p_alle_tickets boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint := ich_id();
  v_st bigint := akt_standort();
  v_t  time;
  v_tage integer[];
begin
  if v_k is null then
    raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000';
  end if;
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  if not push_darf(v_k, v_st, 'tickets') then
    raise exception 'Benachrichtigungen gibt es für Werkstatt-Manager und Trainer/Mechaniker.';
  end if;
  if coalesce(p_bestellen, false) and not push_darf(v_k, v_st, 'bestellen') then
    raise exception '„Bestellen“ können nur Werkstatt-Manager abonnieren.';
  end if;
  if coalesce(p_uhrzeit, '') !~ '^([01][0-9]|2[0-3]):(00|30)$' then
    raise exception 'Uhrzeit bitte zur vollen oder halben Stunde (z. B. 07:30). Bitte die App neu laden.';
  end if;
  v_t := p_uhrzeit::time;
  if v_t < time '07:00' or v_t > time '18:00' then
    raise exception 'Uhrzeit bitte zwischen 07:00 und 18:00.';
  end if;
  if exists (select 1 from unnest(coalesce(p_tage, '{}')) d where d is null or d not between 1 and 7) then
    raise exception 'Ungültiger Wochentag';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_tage from unnest(coalesce(p_tage, '{}')) d;
  insert into push_einstellung (konto_id, standort_id, uhrzeit, tage, dringend, bald, bestellen, alle_tickets)
  values (v_k, v_st, v_t, v_tage, coalesce(p_dringend, false), coalesce(p_bald, false),
          coalesce(p_bestellen, false), coalesce(p_alle_tickets, false))
  on conflict (konto_id, standort_id) do update
    set uhrzeit = excluded.uhrzeit, tage = excluded.tage, dringend = excluded.dringend, bald = excluded.bald,
        bestellen = excluded.bestellen, alle_tickets = excluded.alle_tickets, geaendert = now();
end $$;

commit;
