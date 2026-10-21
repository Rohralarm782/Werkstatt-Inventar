-- =====================================================================
--  Werkstatt — Migration auf 20.8.0
--  Übergreifende Tags (Marke, Baugruppe, Disziplin) und Feld „Marke“ am Artikel
--
--  Vorher muss gelaufen sein: db/migration_20.7.0.sql
--  (20.7.1 und 20.7.2 hatten keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - tag: Tags ohne Kategorie-Buchstaben sind übergreifend und gehören zu
--    einer Gruppe (Marke, Baugruppe, Disziplin). Sie passen zu jeder
--    Kategorie. Die bisherigen Tags bleiben Kategorie-Tags.
--  - artikel bekommt die Spalte marke (wie Einzelstücke sie schon haben).
--  - Das Feld „Marke“ an Artikel und Einzelstück setzt automatisch den
--    Marke-Tag gleichen Namens (legt ihn bei Bedarf an). Umbenennen eines
--    Marke-Tags ändert die Felder mit; neue Funktion marke_umbenennen führt
--    zwei Marken zusammen.
--  - tags_setzen, tag_zuordnen, artikel_anlegen, stueck_anlegen nehmen auch
--    übergreifende Tags; nummer_aendern behält sie bei neuem Buchstaben.
--  - Vorhandene Marken der Einzelstücke werden einmalig als Marke-Tags
--    übernommen. Sonst bleiben alle Daten unverändert.
-- =====================================================================

begin;

-- ---------- 1. Tabellen ----------

alter table tag alter column buchstabe drop not null;
alter table tag add column gruppe text check (gruppe in ('Marke', 'Baugruppe', 'Disziplin'));
alter table tag add constraint tag_art_check check ((buchstabe is null) <> (gruppe is null));
create unique index tag_gruppe_name_key on tag (standort_id, gruppe, lower(name)) where gruppe is not null;

alter table artikel add column marke text;

-- ---------- 2. Funktionen ----------

-- ---------------------------------------------------------------------
--  Marke ↔ Tag (ab 20.8.0). Das Feld „Marke“ an Artikel und Einzelstück
--  setzt den übergreifenden Tag der Gruppe „Marke“ mit gleichem Namen
--  (Groß-/Kleinschreibung und Leerzeichen am Rand egal; fehlt er, wird er
--  angelegt). Ein anderer Marke-Tag fällt dabei weg, leeres Feld = keiner.
-- ---------------------------------------------------------------------
create or replace function marke_tag_abgleich() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := nullif(btrim(new.marke), '');
  v_tag  bigint;
begin
  if v_name is not null then
    select id into v_tag from tag
     where standort_id = new.standort_id and gruppe = 'Marke' and lower(name) = lower(v_name);
    if v_tag is null then
      insert into tag (gruppe, name, standort_id) values ('Marke', v_name, new.standort_id)
      on conflict (standort_id, gruppe, lower(name)) where gruppe is not null do nothing
      returning id into v_tag;
      if v_tag is null then
        select id into v_tag from tag
         where standort_id = new.standort_id and gruppe = 'Marke' and lower(name) = lower(v_name);
      end if;
    end if;
  end if;
  if tg_table_name = 'artikel' then
    delete from artikel_tag x using tag t
     where x.code = new.code and t.id = x.tag_id and t.gruppe = 'Marke' and t.id is distinct from v_tag;
    if v_tag is not null then
      insert into artikel_tag (code, tag_id) values (new.code, v_tag) on conflict do nothing;
    end if;
  else
    delete from stueck_tag x using tag t
     where x.nummer = new.nummer and t.id = x.tag_id and t.gruppe = 'Marke' and t.id is distinct from v_tag;
    if v_tag is not null then
      insert into stueck_tag (nummer, tag_id) values (new.nummer, v_tag) on conflict do nothing;
    end if;
  end if;
  return null;
end $$;

-- Marke-Tag umbenannt: das Feld „Marke“ der Artikel und Einzelstücke zieht mit.
create or replace function marke_tag_umbenannt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update artikel set marke = new.name
   where standort_id = new.standort_id and lower(btrim(marke)) = lower(old.name);
  update stueck set marke = new.name
   where standort_id = new.standort_id and lower(btrim(marke)) = lower(old.name);
  return null;
end $$;

-- Ein Marke-Tag, der noch an Artikeln oder Einzelstücken steht, lässt sich
-- nicht löschen (sonst passten Feld und Tag nicht mehr zusammen).
create or replace function marke_tag_loeschen_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from artikel_tag where tag_id = old.id)
     or exists (select 1 from stueck_tag where tag_id = old.id) then
    raise exception 'Die Marke „%“ ist noch eingetragen – erst dort ändern oder mit einer anderen Marke zusammenführen', old.name;
  end if;
  return old;
end $$;

-- Marke umbenennen oder mit einer vorhandenen zusammenführen (Werkstatt-Manager).
-- Gibt es den neuen Namen schon als Marke, wandern alle Artikel und
-- Einzelstücke dorthin und der alte Tag verschwindet.
create or replace function marke_umbenennen(p_tag bigint, p_name text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_manager();
  v_name text   := nullif(btrim(p_name), '');
  t      tag;
  v_ziel tag;
begin
  select * into t from tag where id = p_tag and standort_id = v_st and gruppe = 'Marke';
  if not found then raise exception 'Unbekannte Marke: %', p_tag; end if;
  if v_name is null then raise exception 'Name fehlt'; end if;
  select * into v_ziel from tag
   where standort_id = v_st and gruppe = 'Marke' and lower(name) = lower(v_name) and id <> p_tag;
  if not found then
    update tag set name = v_name where id = p_tag;   -- Trigger zieht die Felder nach
    return p_tag;
  end if;
  update artikel set marke = v_ziel.name where standort_id = v_st and lower(btrim(marke)) = lower(t.name);
  update stueck  set marke = v_ziel.name where standort_id = v_st and lower(btrim(marke)) = lower(t.name);
  delete from artikel_tag where tag_id = p_tag;
  delete from stueck_tag where tag_id = p_tag;
  delete from tag where id = p_tag;
  return v_ziel.id;
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
                       packungsinhalt, marke)
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
          nullif(btrim(p_daten ->> 'marke'), ''));
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

create or replace function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz, standort_id)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''),
          v_st);
  insert into stueck_tag (nummer, tag_id)
    select v_nr, t.id from tag t
     where (t.buchstabe = p_buchstabe or t.gruppe <> 'Marke') and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_nr;
end $$;

-- Tags setzen (ganz oder gar nicht): Tags der eigenen Kategorie und
-- übergreifende Tags (Baugruppe, Disziplin). Marke-Tags bleiben, wie sie sind —
-- die setzt das Feld „Marke“ (marke_tag_abgleich).
create or replace function tags_setzen(p_art text, p_schluessel text[], p_tags bigint[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
begin
  if p_art = 'artikel' then
    delete from artikel_tag x using tag t
     where x.code = any (p_schluessel) and t.id = x.tag_id and t.gruppe is distinct from 'Marke'
       and x.code in (select code from artikel where standort_id = v_st);
    insert into artikel_tag (code, tag_id)
      select a.code, t.id from artikel a join tag t
        on (t.buchstabe = code_buchstabe(a.code) or t.gruppe <> 'Marke') and t.standort_id = v_st
       where a.code = any (p_schluessel) and a.standort_id = v_st and t.id = any (coalesce(p_tags, '{}'))
      on conflict do nothing;
  elsif p_art = 'stueck' then
    delete from stueck_tag x using tag t
     where x.nummer = any (p_schluessel) and t.id = x.tag_id and t.gruppe is distinct from 'Marke'
       and x.nummer in (select nummer from stueck where standort_id = v_st);
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, t.id from stueck s join tag t
        on (t.buchstabe = code_buchstabe(s.nummer) or t.gruppe <> 'Marke') and t.standort_id = v_st
       where s.nummer = any (p_schluessel) and s.standort_id = v_st and t.id = any (coalesce(p_tags, '{}'))
      on conflict do nothing;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
end $$;

create or replace function tag_zuordnen(p_tag bigint, p_art text, p_mit text[], p_ohne text[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
  t    tag;
begin
  select * into t from tag where id = p_tag and standort_id = v_st;
  if not found then raise exception 'Unbekannter Tag: %', p_tag; end if;
  if t.gruppe = 'Marke' then raise exception 'Marken werden über das Feld „Marke“ gesetzt'; end if;
  if p_art = 'artikel' then
    delete from artikel_tag where tag_id = p_tag and code = any (coalesce(p_ohne, '{}'));
    insert into artikel_tag (code, tag_id)
      select a.code, p_tag from artikel a
       where a.code = any (coalesce(p_mit, '{}')) and a.standort_id = v_st
         and (t.gruppe is not null or code_buchstabe(a.code) = t.buchstabe)
      on conflict do nothing;
  elsif p_art = 'stueck' then
    delete from stueck_tag where tag_id = p_tag and nummer = any (coalesce(p_ohne, '{}'));
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, p_tag from stueck s
       where s.nummer = any (coalesce(p_mit, '{}')) and s.standort_id = v_st
         and (t.gruppe is not null or code_buchstabe(s.nummer) = t.buchstabe)
      on conflict do nothing;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
end $$;

-- p_art: 'artikel' | 'stueck' | 'rad'. Gibt die neue Nummer zurück.
create or replace function nummer_aendern(p_art text, p_alt text, p_neu text)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint  := recht_arbeiten();
  v_mgr boolean := rolle_in('admin', 'manager');
  v_neu text    := upper(regexp_replace(coalesce(p_neu, ''), '\s+', '', 'g'));
begin
  if v_neu = '' then raise exception 'Neue Nummer fehlt'; end if;
  if v_neu = p_alt then return v_neu; end if;
  if v_neu !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' or length(v_neu) > 40 then
    raise exception 'Nummer: nur Buchstaben, Ziffern und Bindestriche';
  end if;
  if not eigener_code(v_neu) then
    raise exception 'Die Nummer muss mit dem Kürzel des Standorts beginnen (%-…)', standort_kuerzel();
  end if;
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  -- Ein Scan muss eindeutig bleiben: Nummer über alle Arten und Standorte frei
  if exists (select 1 from artikel where code = v_neu) or exists (select 1 from stueck where nummer = v_neu)
     or exists (select 1 from rad where id = v_neu) then
    raise exception '% ist schon vergeben', v_neu;
  end if;
  perform set_config('werkstatt.nummer_aendern', 'ja', true);

  if p_art = 'artikel' then
    if not exists (select 1 from artikel where code = p_alt and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', p_alt; end if;
    if v_neu !~ '^[A-Z]{2,3}-[A-Z]+-[0-9]+$' then raise exception 'Artikel-Code im Format %-B-120', standort_kuerzel(); end if;
    if not v_mgr and exists (select 1 from buchung where code = p_alt) then
      raise exception '% hat schon Buchungen – die Nummer ändert dann nur der Werkstatt-Manager', p_alt;
    end if;
    update artikel set code = v_neu where code = p_alt and standort_id = v_st;
    -- Tags gehören zur Kategorie (Buchstabe im Code); bei neuem Buchstaben fallen sie weg.
    -- Übergreifende Tags (ohne Buchstaben) bleiben.
    delete from artikel_tag x using tag t
     where x.code = v_neu and t.id = x.tag_id and t.buchstabe is not null and t.buchstabe is distinct from code_buchstabe(v_neu);
  elsif p_art = 'stueck' then
    if not exists (select 1 from stueck where nummer = p_alt and standort_id = v_st) then raise exception 'Unbekanntes Einzelstück: %', p_alt; end if;
    if not v_mgr and exists (select 1 from ticket_stueck ts join ticket t on t.id = ts.ticket_id
                              where ts.nummer = p_alt and t.status not in ('offen', 'angenommen')) then
      raise exception '% steht schon in abgeschlossenen Tickets – die Nummer ändert dann nur der Werkstatt-Manager', p_alt;
    end if;
    update stueck set nummer = v_neu where nummer = p_alt and standort_id = v_st;
    delete from stueck_tag x using tag t
     where x.nummer = v_neu and t.id = x.tag_id and t.buchstabe is not null and t.buchstabe is distinct from code_buchstabe(v_neu);
  elsif p_art = 'rad' then
    if not exists (select 1 from rad where id = p_alt and standort_id = v_st) then raise exception 'Unbekanntes Rad: %', p_alt; end if;
    if not v_mgr and exists (select 1 from ticket where rad_id = p_alt and status not in ('offen', 'angenommen')) then
      raise exception '% steht schon in abgeschlossenen Tickets – die Nummer ändert dann nur der Werkstatt-Manager', p_alt;
    end if;
    update rad set id = v_neu where id = p_alt and standort_id = v_st;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;

  perform set_config('werkstatt.nummer_aendern', '', true);
  return v_neu;
end $$;

-- ---------- 3. Trigger ----------

create trigger artikel_marke after insert or update of marke on artikel
  for each row execute function marke_tag_abgleich();
create trigger stueck_marke after insert or update of marke, standort_id on stueck
  for each row execute function marke_tag_abgleich();
create trigger tag_marke_umbenannt after update of name on tag
  for each row when (old.gruppe = 'Marke' and new.name is distinct from old.name)
  execute function marke_tag_umbenannt();
create trigger tag_marke_loeschen before delete on tag
  for each row when (old.gruppe = 'Marke') execute function marke_tag_loeschen_pruefen();

-- ---------- 4. Rechte ----------

revoke execute on function
  marke_tag_abgleich(), marke_tag_umbenannt(), marke_tag_loeschen_pruefen(),
  marke_umbenennen(bigint, text)
from public, anonymous;
grant execute on function marke_umbenennen(bigint, text) to anonymous;

-- ---------- 5. Vorhandene Marken der Einzelstücke als Marke-Tags ----------
-- Gleiche Marke in anderer Schreibweise ergibt einen Tag (die erste Schreibweise).

update stueck set marke = marke where nullif(btrim(marke), '') is not null;

commit;
