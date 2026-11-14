-- =====================================================================
--  Werkstatt — Migration auf 21.3.0
--  Sportler und Kostenträger getrennt, eigene Rad-Nummern je Verein
--
--  Vorher muss gelaufen sein: db/migration_21.2.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - sportler bekommt die Spalte art: 'sportler' (Person, fährt, kann einen
--    Zugang haben) oder 'kostentraeger' (Verein, Verband, BSP …). Alle
--    vorhandenen Einträge werden zu 'sportler' — LV, BSP und Vereine danach
--    in der App unter Mehr → Sportler & Kostenträger umstellen.
--  - sportler bekommt die Spalte kuerzel (nur Kostenträger, 2–4 Buchstaben,
--    setzt nur der Werkstatt-Manager). Neue Räder dieses Eigentümers
--    bekommen eine eigene Nummernreihe: SN-DAS-BR-01 statt SN-BR-01.
--    Vorhandene Räder behalten ihre Nummer.
--  - Kostenträger können kein Rad fahren und keinen Sportler-Zugang haben
--    (rad_zuordnen, Trigger an sportler und konto).
--  - naechste_rad_id bekommt den Eigentümer als zweiten Wert (p_eigentuemer,
--    darf fehlen); rad_anlegen gibt ihn weiter.
--  - rad bekommt eigentuemer_fahrer: Eigentümer „Fahrer selbst“ — Tickets
--    gehen dann an den Sportler, der das Rad beim Anlegen des Tickets fährt
--    (ticket_anlegen, v_rad). Vorhandene Räder bleiben, wie sie sind.
--  - Tabellen und Daten bleiben sonst unverändert. Die bisherige App
--    (21.2.0) läuft mit der Migration weiter.
-- =====================================================================

begin;

-- ---------- 1. Spalten ----------

alter table sportler
  add column art text not null default 'sportler' check (art in ('sportler', 'kostentraeger')),
  add column kuerzel text check (kuerzel is null or kuerzel ~ '^[A-Z]{2,4}$');
alter table sportler
  add constraint sportler_kuerzel_nur_kt check (kuerzel is null or art = 'kostentraeger');
create unique index sportler_kuerzel_eindeutig on sportler (standort_id, kuerzel) where kuerzel is not null;

-- ---------- 2. Prüfungen ----------

-- Sportler / Kostenträger (ab 21.3.0): Kürzel nur für Kostenträger und nur
-- vom Werkstatt-Manager; wer fährt oder einen Zugang hat, bleibt Sportler.
create or replace function sportler_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alt text := case when tg_op = 'UPDATE' then old.kuerzel end;
begin
  new.kuerzel := nullif(upper(regexp_replace(coalesce(new.kuerzel, ''), '\s+', '', 'g')), '');
  if new.kuerzel is distinct from v_alt then
    if ich_id() is not null and not rolle_in('admin', 'manager') then
      raise exception 'Das Kürzel für die Rad-Nummern setzt nur der Werkstatt-Manager';
    end if;
    if new.kuerzel is not null then
      if new.art <> 'kostentraeger' then raise exception 'Ein Kürzel für Rad-Nummern gibt es nur bei Kostenträgern'; end if;
      if new.kuerzel !~ '^[A-Z]{2,4}$' then raise exception 'Kürzel: 2 bis 4 Buchstaben, z. B. DAS'; end if;
      if exists (select 1 from sportler where standort_id = new.standort_id and kuerzel = new.kuerzel and id is distinct from new.id) then
        raise exception 'Das Kürzel % hat schon ein anderer Kostenträger', new.kuerzel;
      end if;
      if exists (select 1 from standort where id = new.standort_id and rad_vorlage = new.kuerzel) then
        raise exception 'Das Kürzel % ist schon der feste Teil eurer eigenen Rad-Nummern', new.kuerzel;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.art = 'kostentraeger' and old.art <> 'kostentraeger' then
    if exists (select 1 from zuordnung where sportler_id = new.id and gueltig_bis is null) then
      raise exception '% fährt gerade ein Rad – erst dort den Fahrer ändern', new.name;
    end if;
    if exists (select 1 from konto where sportler_id = new.id) then
      raise exception '% hat einen Sportler-Zugang und bleibt deshalb Sportler', new.name;
    end if;
  end if;
  if new.art = 'sportler' and new.kuerzel is not null then
    raise exception 'Erst das Kürzel für die Rad-Nummern entfernen';
  end if;
  return new;
end $$;

create trigger sportler_pruefen before insert or update on sportler
  for each row execute function sportler_pruefen();

-- Ein Sportler-Zugang gehört zu einem Sportler, nicht zu einem Kostenträger.
create or replace function konto_sportler_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sportler_id is not null and exists (select 1 from sportler where id = new.sportler_id and art = 'kostentraeger') then
    raise exception 'Kostenträger bekommen keinen Sportler-Zugang';
  end if;
  return new;
end $$;

create trigger konto_sportler before insert or update of sportler_id on konto
  for each row execute function konto_sportler_pruefen();

-- ---------- 3. Fahrer ----------

-- Fahrer eines Rads wechseln: alte Zuordnung schließen, neue öffnen.
-- p_sportler = null nimmt das Rad nur aus der Zuordnung.
create or replace function rad_zuordnen(p_rad text, p_sportler bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
begin
  if not exists (select 1 from rad where id = p_rad and standort_id = v_st) then raise exception 'Unbekanntes Rad: %', p_rad; end if;
  if p_sportler is not null and not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then
    raise exception 'Unbekannter Sportler';
  end if;
  if p_sportler is not null and exists (select 1 from sportler where id = p_sportler and art = 'kostentraeger') then
    raise exception 'Ein Kostenträger kann kein Rad fahren – bitte einen Sportler wählen';
  end if;
  update zuordnung set gueltig_bis = current_date
   where rad_id = p_rad and gueltig_bis is null;
  if p_sportler is not null then
    insert into zuordnung (rad_id, sportler_id) values (p_rad, p_sportler);
  end if;
  update rad set geaendert_am = now() where id = p_rad and standort_id = v_st;
end $$;

-- ---------- 4. Rad-Nummern ----------

-- Nächste Rad-Nummer. Gehört das Rad einem Kostenträger mit Kürzel, eigene
-- Reihe <Standort>-<Kürzel>-<Typ>-<Zahl> (SN-DAS-BR-01, ab 21.3.0); sonst
-- wie bisher mit der Vorlage des Standorts (SN-HSG-TR-BR-0042) oder ohne (SN-BR-01).
drop function naechste_rad_id(text);
create function naechste_rad_id(p_typ text, p_eigentuemer bigint default null)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  st     standort;
  v_kt   text;
  v_k    text;
  v_max  integer;
begin
  select * into st from standort where id = akt_standort();
  if st.id is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  if p_eigentuemer is not null then
    select kuerzel into v_kt from sportler
     where id = p_eigentuemer and standort_id = st.id and art = 'kostentraeger';
  end if;
  v_k := st.kuerzel || coalesce('-' || coalesce(v_kt, st.rad_vorlage), '') || '-' || rad_kuerzel(p_typ);
  select max(substring(id from '-([0-9]+)$')::integer) into v_max
    from rad where id ~ ('^' || v_k || '-[0-9]+$');
  return v_k || '-' || lpad((coalesce(v_max, 0) + 1)::text, st.rad_stellen, '0');
end $$;

create or replace function rad_anlegen(p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_arbeiten();
  v_id  text;
  v_typ text := coalesce(nullif(p_daten ->> 'typ', ''), 'Bahn');
  v_ei  bigint := (p_daten ->> 'eigentuemer_id')::bigint;
begin
  if v_ei is not null and not exists (select 1 from sportler where id = v_ei and standort_id = v_st) then
    raise exception 'Unbekannter Kostenträger';
  end if;
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_id := naechste_rad_id(v_typ, v_ei);
  insert into rad (id, bezeichnung, typ, marke, rahmennummer, groesse, eigentuemer_id, eigentuemer_fahrer, aktiv, notiz, standort_id, ort, merkmale)
  values (v_id,
          p_daten ->> 'bezeichnung',
          v_typ,
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'rahmennummer', ''),
          nullif(p_daten ->> 'groesse', ''),
          v_ei,
          v_ei is null and coalesce((p_daten ->> 'eigentuemer_fahrer')::boolean, false),
          coalesce((p_daten ->> 'aktiv')::boolean, true),
          nullif(p_daten ->> 'notiz', ''),
          v_st,
          nullif(p_daten ->> 'ort', ''),
          coalesce(p_daten -> 'merkmale', '{}'::jsonb));
  return v_id;
end $$;

-- Vorlage und Stellen für Rad-Nummern setzen (Werkstatt-Manager).
create or replace function rad_nummern_setzen(p_vorlage text, p_stellen integer)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
  v_v  text   := nullif(upper(regexp_replace(coalesce(p_vorlage, ''), '\s+', '', 'g')), '');
begin
  if v_v is not null and (v_v !~ '^[A-Z0-9]+(-[A-Z0-9]+){0,3}$' or length(v_v) > 20) then
    raise exception 'Vorlage: Buchstaben und Ziffern, Teile mit Bindestrich, z. B. HSG-TR';
  end if;
  if p_stellen is null or p_stellen < 2 or p_stellen > 6 then
    raise exception 'Stellen: 2 bis 6';
  end if;
  if v_v is not null and exists (select 1 from sportler where standort_id = v_st and kuerzel = v_v) then
    raise exception '% ist schon das Kürzel eines Kostenträgers', v_v;
  end if;
  update standort set rad_vorlage = v_v, rad_stellen = p_stellen where id = v_st;
end $$;

-- ---------- 5. Eigentümer „Fahrer selbst“ ----------

-- Rad gehört dem Sportler, der es fährt: Tickets gehen an den jeweiligen
-- Fahrer. Entweder ein Kostenträger (eigentuemer_id) oder Fahrer selbst.
alter table rad
  add column eigentuemer_fahrer boolean not null default false,
  add constraint rad_eigentuemer_eins check (not (eigentuemer_fahrer and eigentuemer_id is not null));

create or replace view v_rad with (security_invoker = true) as
select r.id, r.bezeichnung, r.typ, r.rahmennummer, r.groesse, r.eigentuemer_id, r.aktiv, r.notiz,
       z.sportler_id as fahrer_id,
       s.name        as fahrer,
       z.gueltig_ab  as fahrer_seit,
       r.marke,
       r.geaendert_am,
       r.ort,
       r.merkmale,
       r.eigentuemer_fahrer
from rad r
left join zuordnung z on z.rad_id = r.id and z.gueltig_bis is null
left join sportler s  on s.id = z.sportler_id;

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
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
    -- Kostenträger: Eigentümer des Rads; „Fahrer selbst“ = wer es gerade fährt (ab 21.3.0)
    select case when eigentuemer_fahrer then v_fahrer else eigentuemer_id end into v_kt
      from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
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

-- ---------- 6. Rechte ----------

revoke execute on function sportler_pruefen(), konto_sportler_pruefen() from public, anonymous;
revoke execute on function naechste_rad_id(text, bigint) from public;
grant execute on function naechste_rad_id(text, bigint) to anonymous;

commit;
