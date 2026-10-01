-- =====================================================================
--  Werkstatt RSZ MV — Migration 3.0.0 → 4.0.0
--
--  Für die BESTEHENDE Datenbank: einmal komplett im SQL-Editor von Neon
--  ausführen. Vorhandene Daten bleiben erhalten.
--  Danach: Data API → "Refresh schema cache".
--  (Neuinstallation stattdessen mit db/schema.sql.)
-- =====================================================================

begin;

-- Namen für "wer hat was gemacht". Jedes Gerät wählt selbst aus, unter
-- welchem Namen es bucht.
create table person (
  id     bigint generated always as identity primary key,
  name   text not null unique,
  aktiv  boolean not null default true
);
alter table person enable row level security;

alter table buchung add column bearbeiter text;
alter table ticket  add column angelegt_von    text,
                    add column uebernommen_von text,
                    add column erledigt_von    text;

-- Funktionen bekommen einen Parameter für den Namen und laufen ohne Anmeldung.
drop function ticket_abschliessen(bigint);
drop function material_ausgeben(text, numeric, text, bigint, bigint, text);
drop function umbuchen(text, numeric, text, text, text);
drop function inventur(text, text, numeric);
drop function ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb);

-- Material ausgeben — mit oder ohne Ticket. Preis wird festgeschrieben;
-- Pauschalen ziehen zusätzlich ihren hinterlegten Verbrauch ab.
create function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a      artikel;
  v_abr  boolean := false;
begin
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select * into a from artikel where code = p_code;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  if p_sportler is not null then
    select abrechnen into v_abr from sportler where id = p_sportler;
  end if;

  insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter)
  values ('entnahme', p_code, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter);

  if a.art = 'Pauschale' and a.verbraucht_code is not null and a.verbrauch_menge is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter);
  end if;

  return a.preis * p_menge;
end $$;

-- Material zwischen Werkstatt und Koffern verschieben (zwei Buchungen).
create function umbuchen(p_code text, p_menge numeric, p_von text, p_nach text,
                         p_notiz text default null, p_bearbeiter text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g uuid := gen_random_uuid();
begin
  if p_von = p_nach then raise exception 'Von und nach sind gleich'; end if;
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  insert into buchung (art, code, menge, ort, gruppe, notiz, bearbeiter) values
    ('umbuchung', p_code, -p_menge, p_von,  g, p_notiz, p_bearbeiter),
    ('umbuchung', p_code,  p_menge, p_nach, g, p_notiz, p_bearbeiter);
end $$;

-- Inventur: gezählten Bestand eintragen, die Differenz wird gebucht.
create function inventur(p_code text, p_ort text, p_gezaehlt numeric, p_bearbeiter text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ist   numeric;
  v_diff  numeric;
begin
  select coalesce(sum(menge), 0) into v_ist from buchung where code = p_code and ort = p_ort;
  v_diff := p_gezaehlt - v_ist;
  if v_diff <> 0 then
    insert into buchung (art, code, menge, ort, notiz, bearbeiter)
    values ('korrektur', p_code, v_diff, p_ort, 'Inventur: gezählt ' || p_gezaehlt || ', vorher ' || v_ist, p_bearbeiter);
  end if;
  return v_diff;
end $$;

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt.
create function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id      bigint;
  v_fahrer  bigint;
  v_kt      bigint;
  v_pos     jsonb;
begin
  if coalesce(trim(p_problem), '') = '' then raise exception 'Problem fehlt'; end if;

  select sportler_id into v_fahrer from zuordnung where rad_id = p_rad and gueltig_bis is null;
  select eigentuemer_id into v_kt from rad where id = p_rad;
  if not found then raise exception 'Unbekanntes Rad: %', p_rad; end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von)
  values (p_rad, v_fahrer, trim(p_problem), p_fahrbereit, p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter)
  returning id into v_id;

  for v_pos in select * from jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) loop
    insert into ticket_position (ticket_id, code, menge)
    values (v_id, v_pos ->> 'code', coalesce((v_pos ->> 'menge')::numeric, 1));
  end loop;

  return v_id;
end $$;

-- Ticket abschließen: jede reservierte Position wird zur Entnahme am
-- Arbeitsort. Blockiert, solange ein Einzelstück am Rad "zu prüfen" ist.
create function ticket_abschliessen(p_ticket bigint, p_bearbeiter text default null) returns numeric
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
    from stueck where rad_id = t.rad_id and zustand = 'zu prüfen';
  if v_offen is not null then raise exception 'Erst prüfen und freigeben: %', v_offen; end if;

  for p in select * from ticket_position
            where ticket_id = p_ticket and status = 'reserviert' for update loop
    v_summe := v_summe + material_ausgeben(p.code, p.menge, t.arbeitsort, t.kostentraeger_id, p_ticket, null, p_bearbeiter);
    update ticket_position set status = 'gebucht' where id = p.id;
  end loop;

  update ticket set status = 'erledigt', erledigt_am = now(), erledigt_von = p_bearbeiter where id = p_ticket;
  return v_summe;
end $$;

-- Fahrer eines Rads wechseln: alte Zuordnung schließen, neue öffnen.
-- p_sportler = null nimmt das Rad nur aus der Zuordnung.
create or replace function rad_zuordnen(p_rad text, p_sportler bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update zuordnung set gueltig_bis = current_date
   where rad_id = p_rad and gueltig_bis is null;
  if p_sportler is not null then
    insert into zuordnung (rad_id, sportler_id) values (p_rad, p_sportler);
  end if;
end $$;

-- Rechnung festschreiben: offene, abzurechnende Entnahmen eines
-- Sportlers im Zeitraum bekommen eine Rechnungsnummer.
create or replace function rechnung_erstellen(p_sportler bigint, p_von date, p_bis date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     bigint;
  v_nr     text;
  v_summe  numeric;
  v_jahr   text := to_char(current_date, 'YYYY');
begin
  select coalesce(sum(-menge * einzelpreis), 0) into v_summe
    from buchung
   where sportler_id = p_sportler and art = 'entnahme' and abrechnen and rechnung_id is null
     and (zeit at time zone 'Europe/Berlin')::date between p_von and p_bis;
  if v_summe = 0 then raise exception 'Keine offenen Posten im Zeitraum'; end if;

  select 'R-' || v_jahr || '-' || lpad((count(*) + 1)::text, 3, '0') into v_nr
    from rechnung where nummer like 'R-' || v_jahr || '-%';

  insert into rechnung (nummer, sportler_id, von, bis, summe)
  values (v_nr, p_sportler, p_von, p_bis, v_summe)
  returning id into v_id;

  update buchung set rechnung_id = v_id
   where sportler_id = p_sportler and art = 'entnahme' and abrechnen and rechnung_id is null
     and (zeit at time zone 'Europe/Berlin')::date between p_von and p_bis;
  return v_id;
end $$;

-- Gleichstand mit einer Neuinstallation (Rolle für angemeldete Konten, derzeit ungenutzt)
create policy nur_trainer on person for all to authenticated
  using (ist_trainer()) with check (ist_trainer());
grant select, insert, update, delete on person to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
--  Zugriff ohne Anmeldung
--  Die App holt sich einen anonymen Schlüssel von Neon Auth. Damit darf sie
--  lesen, anlegen und ändern — aber nichts löschen (außer Renntermine und
--  Packlisten-Zeilen). Ins Buchungsjournal kommen von außen nur Zugänge;
--  alle anderen Buchungen laufen über die Funktionen oben.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['person', 'sportler', 'artikel', 'rad', 'zuordnung', 'stueck', 'ticket',
                           'ticket_position', 'rechnung', 'koffer_soll', 'termin'] loop
    execute format('drop policy if exists offen on %I', t);
    execute format('create policy offen on %I for all to anonymous using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists offen_lesen  on buchung;
drop policy if exists offen_zugang on buchung;
create policy offen_lesen  on buchung for select to anonymous using (true);
create policy offen_zugang on buchung for insert to anonymous with check (art = 'zugang');

revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on all tables in schema public to anonymous;
revoke select on trainer from anonymous;
grant insert on ticket_position, stueck, buchung, termin, koffer_soll, sportler, rad, artikel, person to anonymous;
grant update on ticket, ticket_position, stueck, koffer_soll, sportler, rad, artikel, person, rechnung to anonymous;
grant delete on termin, koffer_soll to anonymous;
grant usage, select on all sequences in schema public to anonymous;

revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  rad_zuordnen(text, bigint),
  material_ausgeben(text, numeric, text, bigint, bigint, text, text),
  umbuchen(text, numeric, text, text, text, text),
  inventur(text, text, numeric, text),
  ticket_anlegen(text, text, boolean, date, boolean, text, text, jsonb, text),
  ticket_abschliessen(bigint, text),
  rechnung_erstellen(bigint, date, date)
to anonymous;

commit;
