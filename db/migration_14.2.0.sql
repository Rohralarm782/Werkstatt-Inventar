-- =====================================================================
--  Werkstatt — Migration auf 14.2.0: Foto-Grenzen, ein offenes
--  Sportler-Ticket pro Rad
--
--  Vorher muss gelaufen sein: db/migration_14.1.1.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Höchstens 5 Fotos pro Ticket (foto_hochladen lehnt das sechste ab;
--    vorhandene Tickets mit mehr Fotos behalten sie).
--  - Fotos von Tickets, die seit mehr als 30 Tagen erledigt oder storniert
--    sind, werden gelöscht — nebenbei bei jeder Anmeldung und beim
--    Abschließen/Stornieren (neue Funktion fotos_aufraeumen). Die Migration
--    räumt einmal sofort auf und meldet die Anzahl.
--  - Sportler können für ein Rad kein zweites Ticket anlegen, solange dort
--    eins offen ist (Trainer und Manager weiterhin schon).
--  Keine Tabellen oder Spalten. Hinweise wie „No privileges could be
--  revoked for pgp_…“ sind harmlos (Funktionen der Erweiterung pgcrypto).
--  Lässt sich gefahrlos ein zweites Mal ausführen.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Fotos von Tickets, die seit mehr als 30 Tagen erledigt oder storniert
--  sind, löschen. Läuft nebenbei bei jeder Anmeldung und beim Abschließen
--  oder Stornieren eines Tickets (kein Zeitplaner nötig). Nur intern.
-- ---------------------------------------------------------------------
create or replace function fotos_aufraeumen() returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  delete from foto f
   using ticket t
   where t.id = f.ticket_id
     and ((t.status = 'erledigt'  and coalesce(t.erledigt_am, t.angelegt) < now() - interval '30 days')
       or (t.status = 'storniert' and coalesce(t.storniert_am, t.erledigt_am, t.angelegt) < now() - interval '30 days'));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function sitzung_erzeugen(p_konto bigint, p_geraet text, p_bleiben boolean) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  t      text := encode(gen_random_bytes(32), 'hex');
  v_bis  timestamptz;
  v_g    text := case when p_geraet = 'werkstatt' then 'werkstatt' else 'handy' end;
begin
  delete from sitzung where gueltig_bis < now();
  if v_g = 'werkstatt' then
    -- Werkstatt-Laptop: alle werden um 23 Uhr ausgetragen
    v_bis := ((now() at time zone 'Europe/Berlin')::date + time '23:00') at time zone 'Europe/Berlin';
    if v_bis <= now() + interval '10 minutes' then v_bis := v_bis + interval '1 day'; end if;
  elsif coalesce(p_bleiben, true) then
    v_bis := now() + interval '90 days';
  else
    v_bis := now() + interval '12 hours';
  end if;
  insert into sitzung (token_hash, konto_id, gueltig_bis, geraet) values (token_hash(t), p_konto, v_bis, v_g);
  update konto set zuletzt = now(), fehlversuche = 0, gesperrt_bis = null where id = p_konto;
  -- Erfolgreich angemeldet: frühere Sperren zählen nicht mehr
  delete from fehlversuch where art = 'sperre:' || p_konto;
  perform fotos_aufraeumen();
  return jsonb_build_object('token', t, 'gueltig_bis', v_bis);
end $$;

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt. Kommt dieselbe
-- Kennung vom Gerät ein zweites Mal (Nachsenden nach Funkloch), gibt es kein
-- zweites Ticket. Einzelstücke: p_stuecke (Liste) und/oder p_stueck (eines).
-- Sportler dürfen Tickets für ihre eigenen Räder anlegen — ohne Material und
-- Arbeitsschritte, nur in der Werkstatt.
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
  if v_rad is null and cardinality(v_stuecke) = 0 then raise exception 'Rad oder Einzelstück fehlt'; end if;

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

-- Ticket abschließen: alle noch offenen Schritte auf einmal (Material wird zur
-- Entnahme am Arbeitsort). Blockiert, solange ein Teil am Rad oder ein
-- Einzelstück des Tickets "zu prüfen" ist.
create or replace function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st       bigint := recht_arbeiten();
  t          ticket;
  p          record;
  v_summe    numeric := 0;
  v_offen    text;
  v_buchung  bigint;
begin
  p_bearbeiter := ich_name();
  select * into t from ticket where id = p_ticket and standort_id = v_st for update;
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
  perform fotos_aufraeumen();
  return v_summe;
end $$;

-- Ticket stornieren: Ticket und alle Reservierungen in einem Schritt.
create or replace function ticket_stornieren(p_ticket bigint, p_bearbeiter text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  t    ticket;
begin
  p_bearbeiter := ich_name();
  select * into t from ticket where id = p_ticket and standort_id = v_st for update;
  if not found then raise exception 'Ticket % nicht gefunden', p_ticket; end if;
  if t.status in ('erledigt', 'storniert') then raise exception 'Ticket ist bereits abgeschlossen'; end if;

  update ticket_position set status = 'storniert' where ticket_id = p_ticket and status = 'reserviert';
  update ticket set status = 'storniert', storniert_am = now(), storniert_von = p_bearbeiter where id = p_ticket;
  perform fotos_aufraeumen();
end $$;

-- ---------------------------------------------------------------------
--  Foto hochladen — mit Kennung vom Gerät, kommt nur einmal an.
--  Sportler: nur an Tickets für ihre Räder. Höchstens 5 Fotos pro Ticket.
-- ---------------------------------------------------------------------
create or replace function foto_hochladen(p_ticket bigint, p_thumb text, p_bild text, p_mime text default 'image/jpeg',
                                          p_bearbeiter text default null, p_client_id uuid default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint;
  v_id  bigint;
  t     ticket;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  p_bearbeiter := ich_name();
  if p_client_id is not null then
    select id into v_id from foto where client_id = p_client_id;
    if found then return v_id; end if;
  end if;
  select * into t from ticket where id = p_ticket and standort_id = v_st and status <> 'storniert' for update;
  if not found then raise exception 'Ticket % nicht gefunden oder storniert', p_ticket; end if;
  if not rolle_in('admin', 'manager', 'trainer')
     and not (meine_rolle() = 'sportler' and (t.fahrer_id = mein_sportler() or t.kostentraeger_id = mein_sportler()
                                              or (t.rad_id is not null and mein_rad(t.rad_id)))) then
    raise exception 'Keine Berechtigung';
  end if;
  if (select count(*) from foto where ticket_id = p_ticket) >= 5 then
    raise exception 'Höchstens 5 Fotos pro Ticket – erst ein Foto löschen';
  end if;
  insert into foto (ticket_id, client_id, bearbeiter, mime, thumb, bild)
  values (p_ticket, p_client_id, p_bearbeiter, coalesce(p_mime, 'image/jpeg'), p_thumb, p_bild)
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from foto where client_id = p_client_id;
  end if;
  return v_id;
end $$;

-- Einmal sofort aufräumen
do $$
declare n integer;
begin
  n := fotos_aufraeumen();
  raise notice 'Fotos alter erledigter/stornierter Tickets gelöscht: %', n;
end $$;

revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  -- Hilfen, die die Zugriffsregeln und Spaltenvorgaben aufrufen
  kopfzeile(text), token_hash(text), ich_id(), ich_name(), ist_admin(), akt_standort(), meine_rolle(),
  rolle_in(text[]), mein_sportler(), mein_rad(text), standort_kuerzel(), eigener_code(text), code_buchstabe(text),
  -- Anmelden und Konto
  standorte_liste(), anmelde_liste(bigint),
  anmelden(bigint, text, bigint, text, text, boolean),
  einladung_pruefen(text), einladung_einloesen(text, text, text, boolean),
  ich(), abmelden(), pin_aendern(text, text),
  konten_liste(), konto_anlegen(text, text, bigint), konto_neuer_code(bigint),
  konto_aendern(bigint, text, text, boolean), sportler_zugang(bigint), standort_anlegen(text, text),
  standorte_verwaltung(), standort_manager_einladen(bigint, text), manager_neuer_code(bigint), manager_aktiv(bigint, boolean),
  -- Werkstatt
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  inventur_buchen(text, jsonb, text, uuid),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text, uuid, text, text[]),
  ticket_abschliessen(bigint, text),
  ticket_stuecke_aendern(bigint, text[], text[]),
  ticket_stornieren(bigint, text),
  position_erledigen(bigint, text),
  position_zuruecknehmen(bigint, text),
  rechnung_erstellen(bigint, date, date),
  rechnung_stornieren(bigint, text, text),
  buchung_stornieren(bigint, text, text),
  naechster_code(text, integer),
  rad_kuerzel(text),
  naechste_rad_id(text),
  artikel_anlegen(text, integer, jsonb),
  stueck_anlegen(text, integer, jsonb),
  stueck_serie_anlegen(text, integer, jsonb, integer),
  tags_setzen(text, text[], bigint[]),
  tag_zuordnen(bigint, text, text[], text[]),
  rad_anlegen(jsonb),
  foto_hochladen(bigint, text, text, text, text, uuid)
to anonymous;

commit;
