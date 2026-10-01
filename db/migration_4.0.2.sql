-- =====================================================================
--  Werkstatt RSZ MV — Migration 4.0.1 → 4.0.2
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen. Vorhandene Daten bleiben erhalten.
--  Danach: Data API → "Refresh schema cache".
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Tickets: Kennung für "nur einmal anlegen" und wer storniert hat
-- ---------------------------------------------------------------------
alter table ticket add column client_id     uuid unique,
                   add column storniert_am  timestamptz,
                   add column storniert_von text;

-- Bisher blieben Positionen stornierter Tickets auf "reserviert" stehen.
update ticket_position p set status = 'storniert'
  from ticket t
 where t.id = p.ticket_id and t.status = 'storniert' and p.status = 'reserviert';

-- ---------------------------------------------------------------------
--  Ticket anlegen — mit Kennung vom Gerät. Kommt dieselbe Kennung ein
--  zweites Mal (Nachsenden nach Funkloch), gibt es kein zweites Ticket.
-- ---------------------------------------------------------------------
drop function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text);
create function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      bigint;
  v_fahrer  bigint;
  v_kt      bigint;
  v_pos     jsonb;
begin
  if p_client_id is not null then
    select id into v_id from ticket where client_id = p_client_id;
    if found then return v_id; end if;
  end if;

  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  select sportler_id into v_fahrer from zuordnung where rad_id = p_rad and gueltig_bis is null;
  select eigentuemer_id into v_kt from rad where id = p_rad;
  if not found then raise exception 'Unbekanntes Rad: %', p_rad; end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id)
  values (p_rad, v_fahrer, trim(p_problem), p_fahrbereit, p_soll_fertig, coalesce(p_naechstmoeglich, false),
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
--  Ticket stornieren: Ticket und alle Reservierungen in einem Schritt.
-- ---------------------------------------------------------------------
create function ticket_stornieren(p_ticket bigint, p_bearbeiter text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t ticket;
begin
  select * into t from ticket where id = p_ticket for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  update ticket_position set status = 'storniert' where ticket_id = p_ticket and status = 'reserviert';
  update ticket set status = 'storniert', storniert_am = now(), storniert_von = p_bearbeiter where id = p_ticket;
end $$;

-- ---------------------------------------------------------------------
--  Rechnung festschreiben — Datum und Jahr nach deutscher Zeit, Nummer
--  ohne Doppelvergabe, Summe genau aus den markierten Posten.
-- ---------------------------------------------------------------------
drop function rechnung_erstellen(bigint, date, date);
create function rechnung_erstellen(p_sportler bigint, p_von date default null, p_bis date default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_heute  date := (now() at time zone 'Europe/Berlin')::date;
  v_von    date := coalesce(p_von, date '2000-01-01');
  v_bis    date := coalesce(p_bis, (now() at time zone 'Europe/Berlin')::date);
  v_jahr   text := to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY');
  v_id     bigint;
  v_nr     text;
  v_summe  numeric;
begin
  -- Immer nur eine Rechnung gleichzeitig, damit keine Nummer doppelt vergeben wird.
  perform pg_advisory_xact_lock(hashtext('rechnung_nummer'));

  select 'R-' || v_jahr || '-' || lpad((count(*) + 1)::text, 3, '0') into v_nr
    from rechnung where nummer like 'R-' || v_jahr || '-%';

  insert into rechnung (nummer, datum, sportler_id, von, bis, summe)
  values (v_nr, v_heute, p_sportler, v_von, v_bis, 0)
  returning id into v_id;

  with markiert as (
    update buchung set rechnung_id = v_id
     where sportler_id = p_sportler and art = 'entnahme' and abrechnen and rechnung_id is null
       and (zeit at time zone 'Europe/Berlin')::date between v_von and v_bis
    returning -menge * einzelpreis as betrag
  )
  select coalesce(sum(betrag), 0) into v_summe from markiert;

  if v_summe = 0 then raise exception 'Keine offenen Posten im Zeitraum'; end if;

  update rechnung set summe = v_summe where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
--  Zugriff ohne Anmeldung enger fassen
--  - Tickets: nur offene/angenommene ändern; abschließen und stornieren
--    gehen ausschließlich über die Funktionen.
--  - Reservierungen: nur an offenen Tickets, nur Menge und freigeben.
--  - Journal: nur Zugänge mit positiver Menge, ohne Rechnung/Sportler.
--  - Rechnungen: nur den Status offen/bezahlt.
-- ---------------------------------------------------------------------
drop policy offen on ticket;
create policy offen_lesen   on ticket for select to anonymous using (true);
create policy offen_aendern on ticket for update to anonymous
  using (status in ('offen', 'angenommen'))
  with check (status in ('offen', 'angenommen'));

drop policy offen on ticket_position;
create policy offen_lesen     on ticket_position for select to anonymous using (true);
create policy offen_vormerken on ticket_position for insert to anonymous
  with check (status = 'reserviert'
              and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));
create policy offen_aendern   on ticket_position for update to anonymous
  using (status = 'reserviert'
         and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')))
  with check (status in ('reserviert', 'storniert')
              and exists (select 1 from ticket t where t.id = ticket_id and t.status in ('offen', 'angenommen')));

drop policy offen_zugang on buchung;
create policy offen_zugang on buchung for insert to anonymous
  with check (art = 'zugang' and menge > 0);

-- Rechte für anonyme Anfragen neu setzen (gleicher Stand wie schema.sql 4.0.2)
revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on all tables in schema public to anonymous;
revoke select on trainer from anonymous;
grant insert on stueck, termin, koffer_soll, sportler, rad, artikel, person to anonymous;
grant insert (art, code, menge, ort, notiz, bearbeiter) on buchung to anonymous;
grant insert (ticket_id, code, menge) on ticket_position to anonymous;
grant update on stueck, koffer_soll, sportler, rad, artikel, person to anonymous;
grant update (soll_fertig, naechstmoeglich, anlass, aufwand, fahrbereit, arbeitsort,
              kostentraeger_id, status, uebernommen_von) on ticket to anonymous;
grant update (menge, status) on ticket_position to anonymous;
grant update (status) on rechnung to anonymous;
grant delete on termin, koffer_soll to anonymous;
grant usage, select on all sequences in schema public to anonymous;

-- Funktionen
revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid),
  ticket_stornieren(bigint, text),
  rechnung_erstellen(bigint, date, date)
to authenticated;
grant execute on function
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid),
  ticket_abschliessen(bigint, text),
  ticket_stornieren(bigint, text),
  rechnung_erstellen(bigint, date, date)
to anonymous;

commit;
