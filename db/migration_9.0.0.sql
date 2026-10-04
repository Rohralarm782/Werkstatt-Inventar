-- =====================================================================
--  Werkstatt RSZ MV — Migration 8.x → 9.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_8.0.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
--
--  Neu: Arbeitsschritte. Eine Ticket-Position ist jetzt ein Schritt —
--  mit Material (code) oder als reiner Text (titel). Jeder Schritt lässt
--  sich einzeln abhaken: Material wird dabei sofort gebucht, das Ticket
--  bleibt offen. Ein versehentlich abgehakter Schritt lässt sich
--  zurücknehmen (die Buchung wird storniert).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Schritte: Material oder Text, mit Erledigt-Vermerk
-- ---------------------------------------------------------------------
alter table ticket_position alter column code drop not null;
alter table ticket_position
  add column titel        text,
  add column dauer_min    integer check (dauer_min is null or dauer_min >= 0),   -- nur für Schritte ohne Material
  add column erledigt_am  timestamptz,
  add column erledigt_von text,
  add column buchung_id   bigint references buchung (id);

alter table ticket_position drop constraint ticket_position_status_check;
alter table ticket_position add constraint ticket_position_status_check
  check (status in ('reserviert', 'gebucht', 'erledigt', 'storniert'));
alter table ticket_position add constraint ticket_position_material_oder_text
  check (code is not null or coalesce(trim(titel), '') <> '');

-- Bisher gebuchte Positionen bekommen Datum und Namen ihres Tickets.
update ticket_position p
   set erledigt_am = t.erledigt_am, erledigt_von = t.erledigt_von
  from ticket t
 where t.id = p.ticket_id and p.status = 'gebucht' and p.erledigt_am is null;

-- ---------------------------------------------------------------------
--  Ticket anlegen: Schritte dürfen auch reiner Text sein
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

  -- Schritte: {"code":"A-104","menge":1} oder {"titel":"Laufrad zentrieren","dauer_min":20}
  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    insert into ticket_position (ticket_id, code, titel, menge, dauer_min)
    values (v_id, nullif(v_pos ->> 'code', ''), nullif(trim(v_pos ->> 'titel'), ''),
            coalesce((v_pos ->> 'menge')::numeric, 1), (v_pos ->> 'dauer_min')::integer);
  end loop;

  -- Einzelstück mit Ticket muss geprüft werden: „frei“ wird zu „zu prüfen“
  -- („defekt“ bleibt „defekt“).
  if p_stueck is not null then
    update stueck set zustand = 'zu prüfen' where nummer = p_stueck and zustand = 'frei';
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Einen Schritt abhaken. Material wird sofort am Arbeitsort an den
--  Kostenträger gebucht; das Ticket bleibt offen. Gibt den Betrag zurück.
-- ---------------------------------------------------------------------
create function position_erledigen(p_position bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tid      bigint;
  t          ticket;
  p          ticket_position;
  v_betrag   numeric := 0;
  v_buchung  bigint;
begin
  select ticket_id into v_tid from ticket_position where id = p_position;
  if not found then raise exception 'Schritt % nicht gefunden', p_position; end if;
  select * into t from ticket where id = v_tid for update;          -- erst das Ticket, dann der Schritt (wie beim Abschließen)
  select * into p from ticket_position where id = p_position for update;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;
  if p.status <> 'reserviert' then raise exception 'Schritt ist schon erledigt oder freigegeben'; end if;

  if p.code is not null then
    v_betrag := material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, t.id, null, p_bearbeiter);
    select max(id) into v_buchung from buchung where ticket_id = t.id and code = p.code and art = 'entnahme';
    update ticket_position set status = 'gebucht', erledigt_am = now(), erledigt_von = p_bearbeiter, buchung_id = v_buchung
     where id = p.id;
  else
    update ticket_position set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter
     where id = p.id;
  end if;
  return v_betrag;
end $$;

-- ---------------------------------------------------------------------
--  Abgehakten Schritt zurücknehmen (vertippt). Die Buchung wird
--  storniert — nicht möglich, wenn sie schon auf einer Rechnung steht.
-- ---------------------------------------------------------------------
create function position_zuruecknehmen(p_position bigint, p_bearbeiter text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tid  bigint;
  t      ticket;
  p      ticket_position;
begin
  select ticket_id into v_tid from ticket_position where id = p_position;
  if not found then raise exception 'Schritt % nicht gefunden', p_position; end if;
  select * into t from ticket where id = v_tid for update;
  select * into p from ticket_position where id = p_position for update;
  if t.status not in ('offen', 'angenommen') then raise exception 'Ticket ist bereits abgeschlossen'; end if;
  if p.status not in ('gebucht', 'erledigt') then raise exception 'Schritt ist nicht abgehakt'; end if;
  if p.status = 'gebucht' and p.buchung_id is null then
    raise exception 'Buchung nicht zuzuordnen — bitte unter Material → Buchungen stornieren';
  end if;

  if p.buchung_id is not null and not exists (select 1 from buchung where storno_von = p.buchung_id) then
    perform buchung_stornieren(p.buchung_id, 'Schritt an T-' || lpad(t.id::text, 4, '0') || ' zurückgenommen', p_bearbeiter);
  end if;
  update ticket_position set status = 'reserviert', erledigt_am = null, erledigt_von = null, buchung_id = null
   where id = p.id;
end $$;

-- ---------------------------------------------------------------------
--  Ticket abschließen: alle noch offenen Schritte auf einmal.
--  Blockiert, solange ein Einzelstück am Rad "zu prüfen" ist.
--  Gibt den Betrag zurück, der JETZT gebucht wurde.
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

  select string_agg(nummer, ', ') into v_offen
    from stueck where (rad_id = t.rad_id or nummer = t.stueck_nummer) and zustand = 'zu prüfen';
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
--  Rechte
-- ---------------------------------------------------------------------
revoke execute on function position_erledigen(bigint, text), position_zuruecknehmen(bigint, text) from public;
grant execute on function position_erledigen(bigint, text), position_zuruecknehmen(bigint, text) to authenticated, anonymous;

-- Anonym: Schritte anlegen (Material oder Text) und offene ändern/freigeben.
-- Abhaken nur über position_erledigen (die Zugriffsregel erlaubt von außen
-- weiterhin nur 'reserviert' und 'storniert').
grant insert (titel, dauer_min) on ticket_position to anonymous;
grant update (titel, dauer_min) on ticket_position to anonymous;

commit;
