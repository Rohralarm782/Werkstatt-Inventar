-- =====================================================================
--  Werkstatt RSZ MV — Migration auf 12.0.0: mehrere Einzelstücke je Ticket
--
--  Vorher muss gelaufen sein: db/migration_11.0.0.sql (Tags).
--
--  Einmal komplett im SQL-Editor von Neon ausführen, danach:
--  Data API → "Refresh schema cache". Vorher am besten auf einem
--  Neon-Branch testen.
--
--  Was passiert:
--  - Neue Tabelle ticket_stueck: ein Ticket kann beliebig viele
--    Einzelstücke haben (z. B. drei Laufräder, oder Rad + Laufräder nach
--    einem Sturz). Ein Rad je Ticket bleibt wie bisher (Fahrer,
--    Kostenträger).
--  - Jedes bisherige ticket.stueck_nummer wird übernommen, danach wird die
--    Spalte entfernt (samt Index und Prüfung „Rad oder Einzelstück“ —
--    das prüfen jetzt die Funktionen).
--  - ticket_anlegen nimmt zusätzlich p_stuecke (Liste). p_stueck bleibt,
--    damit offline gespeicherte Tickets älterer App-Stände ankommen.
--  - ticket_abschliessen prüft alle Einzelstücke des Tickets.
--  - Neu: ticket_stuecke_aendern — Teile an offenen Tickets nachtragen
--    oder herausnehmen.
--  Es geht nichts verloren.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Zuordnung Ticket ↔ Einzelstücke
-- ---------------------------------------------------------------------
-- Index und Fremdschlüssel der alten Spalte ticket.stueck_nummer tragen
-- die Namen, die die neue Tabelle bekommt — daher zuerst weg damit
-- (die Werte bleiben bis zur Übernahme in der Spalte).
drop index ticket_stueck;
alter table ticket drop constraint ticket_stueck_nummer_fkey;

create table ticket_stueck (
  ticket_id  bigint not null references ticket (id) on delete cascade,
  nummer     text   not null references stueck (nummer) on update cascade,
  primary key (ticket_id, nummer)
);

insert into ticket_stueck (ticket_id, nummer)
  select id, stueck_nummer from ticket where stueck_nummer is not null;

alter table ticket drop constraint ticket_rad_oder_stueck;
alter table ticket drop column stueck_nummer;

create index ticket_stueck_nummer on ticket_stueck (nummer);

-- ---------------------------------------------------------------------
--  Ticket anlegen: Rad und/oder beliebig viele Einzelstücke
-- ---------------------------------------------------------------------
drop function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text);

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt. Kommt dieselbe
-- Kennung vom Gerät ein zweites Mal (Nachsenden nach Funkloch), gibt es kein
-- zweites Ticket. Einzelstücke: p_stuecke (Liste) und/oder p_stueck (eines,
-- für ältere App-Stände).
create function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id       bigint;
  v_rad      text := nullif(trim(coalesce(p_rad, '')), '');
  v_fahrer   bigint;
  v_kt       bigint;
  v_pos      jsonb;
  v_stuecke  text[];
  v_fehlt    text;
  v_raeder   text[];
begin
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
    from unnest(v_stuecke) as n where not exists (select 1 from stueck where nummer = n);
  if v_fehlt is not null then raise exception 'Unbekanntes Einzelstück: %', v_fehlt; end if;

  -- Ohne Rad: stecken die Teile an genau einem Rad, gilt das Ticket für dieses Rad
  if v_rad is null and cardinality(v_stuecke) > 0 then
    select array_agg(distinct rad_id) into v_raeder from stueck where nummer = any (v_stuecke) and rad_id is not null;
    if cardinality(v_raeder) = 1 then v_rad := v_raeder[1]; end if;
  end if;
  if v_rad is null and cardinality(v_stuecke) = 0 then raise exception 'Rad oder Einzelstück fehlt'; end if;

  if v_rad is not null then
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
    select eigentuemer_id into v_kt from rad where id = v_rad;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id)
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
    insert into ticket_position (ticket_id, code, titel, menge, dauer_min)
    values (v_id, nullif(v_pos ->> 'code', ''), nullif(trim(v_pos ->> 'titel'), ''),
            coalesce((v_pos ->> 'menge')::numeric, 1), (v_pos ->> 'dauer_min')::integer);
  end loop;

  -- Einzelstücke mit Ticket müssen geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  update stueck set zustand = 'zu prüfen' where nummer = any (v_stuecke) and zustand = 'frei';

  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Abschließen: alle Teile am Rad und alle Einzelstücke des Tickets
--  müssen freigegeben sein.
-- ---------------------------------------------------------------------
create or replace function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t          ticket;
  p          record;
  v_summe    numeric := 0;
  v_offen    text;
  v_buchung  bigint;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(nummer, ', ' order by nummer) into v_offen
    from stueck
   where (rad_id = t.rad_id or nummer in (select nummer from ticket_stueck where ticket_id = p_ticket))
     and zustand = 'zu prüfen';
  if v_offen is not null then raise exception 'Erst prüfen und freigeben: %', v_offen; end if;

  for p in select * from ticket_position
            where ticket_id = p_ticket and status = 'reserviert' order by id for update loop
    if p.code is null then
      update ticket_position set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p.id;
    else
      v_summe := v_summe + material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, p_ticket, null, p_bearbeiter);
      select max(id) into v_buchung from buchung where ticket_id = p_ticket and code = p.code and art = 'entnahme';
      update ticket_position set status = 'gebucht', erledigt_am = now(), erledigt_von = p_bearbeiter, buchung_id = v_buchung
       where id = p.id;
    end if;
  end loop;

  update ticket set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p_ticket;
  return v_summe;
end $$;

-- ---------------------------------------------------------------------
--  Einzelstücke eines offenen Tickets nachtragen (p_mit) oder
--  herausnehmen (p_ohne). Nachgetragene „freie“ Teile werden „zu prüfen“;
--  ein herausgenommenes Teil, das auf „zu prüfen“ steht und an keinem
--  anderen offenen Ticket hängt, wird wieder „frei“. Ein Ticket ohne Rad
--  behält mindestens ein Einzelstück.
-- ---------------------------------------------------------------------
create function ticket_stuecke_aendern(p_ticket bigint, p_mit text[] default null, p_ohne text[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t        ticket;
  v_fehlt  text;
  v_neu    text[];
  v_weg    text[];
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(n, ', ') into v_fehlt
    from unnest(coalesce(p_mit, '{}')) as n where not exists (select 1 from stueck where nummer = n);
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

  if t.rad_id is null and not exists (select 1 from ticket_stueck where ticket_id = p_ticket) then
    raise exception 'Ein Ticket ohne Rad braucht mindestens ein Einzelstück';
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Zugriff: Zuordnung lesen; geändert wird sie nur über die Funktionen.
-- ---------------------------------------------------------------------
alter table ticket_stueck enable row level security;
create policy nur_trainer on ticket_stueck for all to authenticated using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen on ticket_stueck for select to anonymous using (true);

grant select, insert, update, delete on ticket_stueck to authenticated;
grant select on ticket_stueck to anonymous;

revoke execute on function
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[]),
  ticket_stuecke_aendern(bigint, text[], text[])
from public;
grant execute on function
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[]),
  ticket_stuecke_aendern(bigint, text[], text[])
to authenticated, anonymous;

commit;
