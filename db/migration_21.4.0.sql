-- =====================================================================
--  Werkstatt — Migration auf 21.4.0
--  Größen auch für Werkstattmaterial, Mindestbestand je Größe
--
--  Vorher muss gelaufen sein: db/migration_21.3.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - artikel bekommt die Spalte mindest_groesse: Mindestbestand je Größe,
--    z. B. {"1 L": 2, "3 L": 2}. Fehlt eine Größe, gilt wie bisher
--    mindestbestand (für alle Größen).
--  - material_ausgeben und umbuchen bekommen am Ende p_groesse (darf fehlen).
--    Bei Artikeln mit Größen ist sie Pflicht. Die alten Fassungen werden
--    ersetzt; Aufrufe ohne p_groesse (App 21.3.0, Tickets) laufen weiter.
--  - inventur lehnt Artikel mit Größen ab (die werden je Größe gezählt,
--    kleidung_zaehlen).
--  - artikel_anlegen übernimmt mindest_groesse.
--  - Vorhandene Daten bleiben unverändert. Die App 21.3.0 läuft mit der
--    Migration weiter.
-- =====================================================================

begin;

-- ---------- 1. Spalte ----------

alter table artikel add column mindest_groesse jsonb
  check (mindest_groesse is null or jsonb_typeof(mindest_groesse) = 'object');

-- ---------- 2. Funktionen ----------

drop function material_ausgeben(text, numeric, text, bigint, bigint, text, text);
drop function umbuchen(text, numeric, text, text, text, text);

create or replace function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null, p_groesse text default null
) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_arbeiten();
  a      artikel;
  v_abr  boolean := false;
  v_grp  uuid;
begin
  p_bearbeiter := ich_name();
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select * into a from artikel where code = p_code and standort_id = v_st;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  perform ort_pruefen(v_st, p_ort);
  -- Größen (ab 21.4.0): bei Artikeln mit Größen muss die Größe dabei sein; die prüft der Trigger groesse_pruefen
  p_groesse := nullif(btrim(p_groesse), '');
  if a.groessen is not null and p_groesse is null then raise exception 'Bitte eine Größe angeben (%)', a.name; end if;
  if p_sportler is not null then
    select abrechnen into v_abr from sportler where id = p_sportler and standort_id = v_st;
    if not found then raise exception 'Unbekannter Sportler'; end if;
  end if;
  if p_ticket is not null and not exists (select 1 from ticket where id = p_ticket and standort_id = v_st) then
    raise exception 'Ticket % nicht gefunden', p_ticket;
  end if;
  if a.art = 'Pauschale' and a.verbraucht_code is not null and a.verbrauch_menge is not null then
    if not exists (select 1 from artikel v where v.code = a.verbraucht_code and v.standort_id = v_st) then
      raise exception 'Der Verbrauch von % (%) gehört nicht zu diesem Standort – bitte am Artikel korrigieren', p_code, a.verbraucht_code;
    end if;
    v_grp := gen_random_uuid();
  end if;

  insert into buchung (art, code, groesse, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
  values ('entnahme', p_code, p_groesse, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter, v_grp, v_st);

  if v_grp is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter, v_grp, v_st);
  end if;

  return a.preis * p_menge;
end $$;

create or replace function umbuchen(p_code text, p_menge numeric, p_von text, p_nach text,
                                    p_notiz text default null, p_bearbeiter text default null, p_groesse text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  g    uuid   := gen_random_uuid();
  v_gr text[];
begin
  p_bearbeiter := ich_name();
  if p_von = p_nach then raise exception 'Von und nach sind gleich'; end if;
  if p_menge is null or p_menge <= 0 then raise exception 'Menge muss größer als 0 sein'; end if;
  select groessen into v_gr from artikel where code = p_code and standort_id = v_st;
  if not found then raise exception 'Unbekannter Artikel: %', p_code; end if;
  -- Größen (ab 21.4.0): bei Artikeln mit Größen wird je Größe umgebucht
  p_groesse := nullif(btrim(p_groesse), '');
  if v_gr is not null and p_groesse is null then raise exception 'Bitte eine Größe angeben (%)', p_code; end if;
  perform ort_pruefen(v_st, p_von);
  perform ort_pruefen(v_st, p_nach);
  insert into buchung (art, code, groesse, menge, ort, gruppe, notiz, bearbeiter, standort_id) values
    ('umbuchung', p_code, p_groesse, -p_menge, p_von,  g, p_notiz, p_bearbeiter, v_st),
    ('umbuchung', p_code, p_groesse,  p_menge, p_nach, g, p_notiz, p_bearbeiter, v_st);
end $$;

create or replace function inventur(p_code text, p_ort text, p_gezaehlt numeric, p_bearbeiter text default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st    bigint := recht_arbeiten();
  v_ist   numeric;
  v_diff  numeric;
begin
  p_bearbeiter := ich_name();
  if p_gezaehlt is null or p_gezaehlt < 0 then raise exception 'Gezählte Menge fehlt'; end if;
  if not exists (select 1 from artikel where code = p_code and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', p_code; end if;
  if exists (select 1 from artikel where code = p_code and groessen is not null) then   -- ab 21.4.0
    raise exception 'Artikel mit Größen bitte je Größe zählen (Artikel antippen → Inventur)';
  end if;
  perform ort_pruefen(v_st, p_ort);
  select coalesce(sum(menge), 0) into v_ist from buchung where code = p_code and ort = p_ort and standort_id = v_st;
  v_diff := p_gezaehlt - v_ist;
  if v_diff <> 0 then
    insert into buchung (art, code, menge, ort, notiz, bearbeiter, standort_id)
    values ('korrektur', p_code, v_diff, p_ort, 'Inventur: gezählt ' || p_gezaehlt || ', vorher ' || v_ist, p_bearbeiter, v_st);
  end if;
  insert into zaehlung (code, ort, bearbeiter, standort_id) values (p_code, p_ort, p_bearbeiter, v_st)
  on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  return v_diff;
end $$;

create or replace function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_arbeiten();
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_code := naechster_code(p_buchstabe, p_gruppe);
  insert into artikel (code, name, einheit, preis, mindestbestand, lieferzeit_tage, art,
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min, standort_id, groessen,
                       packungsinhalt, marke, merkmale, mindest_groesse)
  values (v_code,
          p_daten ->> 'name',
          coalesce(nullif(p_daten ->> 'einheit', ''), 'Stück'),
          coalesce((p_daten ->> 'preis')::numeric, 0),
          coalesce((p_daten ->> 'mindestbestand')::numeric, 0),
          coalesce((p_daten ->> 'lieferzeit_tage')::integer, 0),
          coalesce(p_daten ->> 'art', 'Stück'),
          nullif(p_daten ->> 'verbraucht_code', ''),
          (p_daten ->> 'verbrauch_menge')::numeric,
          nullif(p_daten ->> 'lieferant', ''),
          nullif(p_daten ->> 'bestellnummer', ''),
          nullif(p_daten ->> 'shop_link', ''),
          coalesce((p_daten ->> 'aktiv')::boolean, true),
          (p_daten ->> 'dauer_min')::integer,
          v_st,
          case when jsonb_typeof(p_daten -> 'groessen') = 'array' and jsonb_array_length(p_daten -> 'groessen') > 0
               then array(select jsonb_array_elements_text(p_daten -> 'groessen')) end,
          (p_daten ->> 'packungsinhalt')::numeric,
          nullif(btrim(p_daten ->> 'marke'), ''),
          coalesce(p_daten -> 'merkmale', '{}'::jsonb),
          case when jsonb_typeof(p_daten -> 'mindest_groesse') = 'object' then p_daten -> 'mindest_groesse' end);
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

-- ---------- 3. Rechte ----------

revoke execute on function material_ausgeben(text, numeric, text, bigint, bigint, text, text, text),
                           umbuchen(text, numeric, text, text, text, text, text) from public;
grant execute on function material_ausgeben(text, numeric, text, bigint, bigint, text, text, text),
                          umbuchen(text, numeric, text, text, text, text, text) to anonymous;

commit;
