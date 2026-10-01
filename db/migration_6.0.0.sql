-- =====================================================================
--  Werkstatt RSZ MV — Migration 5.x → 6.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen (vorher alles im Editor löschen). Vorhandene Daten bleiben
--  erhalten. Danach: Data API → "Refresh schema cache".
--  Voraussetzung: migration_5.2.0.sql ist gelaufen.
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Tickets auch für Einzelstücke (z. B. ein Laufrad in der Werkstatt):
--  ein Ticket gehört zu einem Rad, zu einem Einzelstück oder zu beidem.
-- ---------------------------------------------------------------------
alter table ticket alter column rad_id drop not null;
alter table ticket add column stueck_nummer text references stueck (nummer);
alter table ticket add constraint ticket_rad_oder_stueck check (rad_id is not null or stueck_nummer is not null);
create index ticket_stueck on ticket (stueck_nummer);

-- ---------------------------------------------------------------------
--  Räder: die Marke fehlte in der Sicht v_rad (seit 5.0.0) — dadurch
--  wurde sie in der App nicht angezeigt und beim Bearbeiten geleert.
-- ---------------------------------------------------------------------
create or replace view v_rad with (security_invoker = true) as
select r.id, r.bezeichnung, r.typ, r.rahmennummer, r.groesse, r.eigentuemer_id, r.aktiv, r.notiz,
       z.sportler_id as fahrer_id,
       s.name        as fahrer,
       z.gueltig_ab  as fahrer_seit,
       r.marke
from rad r
left join zuordnung z on z.rad_id = r.id and z.gueltig_bis is null
left join sportler s  on s.id = z.sportler_id;

-- ---------------------------------------------------------------------
--  Ticket anlegen — für ein Rad und/oder ein Einzelstück.
--  Steckt das Einzelstück an einem Rad, gilt das Rad automatisch mit.
-- ---------------------------------------------------------------------
drop function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid);
create function ticket_anlegen(
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

  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Abschließen: auch das Einzelstück des Tickets muss geprüft sein.
-- ---------------------------------------------------------------------
create or replace function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t        ticket;
  p        record;
  v_summe  numeric := 0;
  v_offen  text;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  select string_agg(nummer, ', ') into v_offen
    from stueck where (rad_id = t.rad_id or nummer = t.stueck_nummer) and zustand = 'zu prüfen';
  if v_offen is not null then raise exception 'Erst prüfen und freigeben: %', v_offen; end if;

  for p in select * from ticket_position
            where ticket_id = p_ticket and status = 'reserviert' for update loop
    v_summe := v_summe + material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, p_ticket, null, p_bearbeiter);
    update ticket_position set status = 'gebucht' where id = p.id;
  end loop;

  update ticket set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p_ticket;
  return v_summe;
end $$;

revoke execute on function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text) from public;
grant execute on function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text) to authenticated, anonymous;

commit;
