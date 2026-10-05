-- =====================================================================
--  Werkstatt RSZ MV — Migration auf 11.0.0: Tags statt Unterkategorien
--
--  Vorher muss gelaufen sein: db/migration_10.0.0.sql (Unterkategorien).
--  (10.1.0 hatte keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen, danach:
--  Data API → "Refresh schema cache". Vorher am besten auf einem
--  Neon-Branch testen.
--
--  Was passiert:
--  - Die Tabelle unterkategorie wird zur Tabelle tag (gleiche Zeilen,
--    gleiche ids, weiterhin je Kategorie-Buchstabe).
--  - Ein Artikel / Einzelstück kann jetzt mehrere Tags seiner Kategorie
--    haben (neue Tabellen artikel_tag, stueck_tag).
--  - Jede bisherige Zuordnung (unterkategorie_id) wird als Tag übernommen,
--    danach werden die Spalten unterkategorie_id entfernt.
--  Es geht nichts verloren; Codes, Nummern und Etiketten bleiben gleich.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  unterkategorie → tag (Zeilen, ids, Rechte und Zugriffsregeln bleiben)
-- ---------------------------------------------------------------------
alter table unterkategorie rename to tag;
alter sequence unterkategorie_id_seq rename to tag_id_seq;
alter table tag rename constraint unterkategorie_pkey to tag_pkey;
alter table tag rename constraint unterkategorie_buchstabe_name_key to tag_buchstabe_name_key;
alter table tag rename constraint unterkategorie_buchstabe_check to tag_buchstabe_check;
alter table tag rename constraint unterkategorie_name_check to tag_name_check;

-- ---------------------------------------------------------------------
--  Zuordnungen: mehrere Tags je Artikel / Einzelstück
-- ---------------------------------------------------------------------
create table artikel_tag (
  code    text   not null references artikel (code) on update cascade on delete cascade,
  tag_id  bigint not null references tag (id) on delete cascade,
  primary key (code, tag_id)
);
create index artikel_tag_tag on artikel_tag (tag_id);

create table stueck_tag (
  nummer  text   not null references stueck (nummer) on update cascade on delete cascade,
  tag_id  bigint not null references tag (id) on delete cascade,
  primary key (nummer, tag_id)
);
create index stueck_tag_tag on stueck_tag (tag_id);

-- Bisherige Unterkategorien übernehmen
insert into artikel_tag (code, tag_id)
  select code, unterkategorie_id from artikel where unterkategorie_id is not null;
insert into stueck_tag (nummer, tag_id)
  select nummer, unterkategorie_id from stueck where unterkategorie_id is not null;

-- Alte Spalten entfernen (die Indizes fallen mit weg)
alter table artikel drop column unterkategorie_id;
alter table stueck  drop column unterkategorie_id;

-- ---------------------------------------------------------------------
--  Anlegen mit automatischer Nummer: Tags gleich mit speichern
--  (p_daten -> 'tags' = Liste von Tag-ids; gleiche Signatur wie bisher)
-- ---------------------------------------------------------------------
create or replace function artikel_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_code := naechster_code(p_buchstabe, p_gruppe);
  insert into artikel (code, name, einheit, preis, mindestbestand, lieferzeit_tage, art,
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min)
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
          (p_daten ->> 'dauer_min')::integer);
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where t.buchstabe = p_buchstabe
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

create or replace function stueck_anlegen(p_buchstabe text, p_gruppe integer, p_daten jsonb)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nr text;
begin
  perform pg_advisory_xact_lock(hashtext('nummernvergabe'));
  v_nr := naechster_code(p_buchstabe, p_gruppe);
  insert into stueck (nummer, typ, marke, detail, seriennummer, kaufdatum, wert, notiz)
  values (v_nr,
          p_daten ->> 'typ',
          nullif(p_daten ->> 'marke', ''),
          nullif(p_daten ->> 'detail', ''),
          nullif(p_daten ->> 'seriennummer', ''),
          nullif(p_daten ->> 'kaufdatum', '')::date,
          (p_daten ->> 'wert')::numeric,
          nullif(p_daten ->> 'notiz', ''));
  insert into stueck_tag (nummer, tag_id)
    select v_nr, t.id from tag t
     where t.buchstabe = p_buchstabe
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_nr;
end $$;

-- ---------------------------------------------------------------------
--  Tags setzen (ganz oder gar nicht)
-- ---------------------------------------------------------------------
-- Tags eines oder mehrerer Artikel bzw. Einzelstücke (Serie) ersetzen.
-- Es zählen nur Tags der eigenen Kategorie (Buchstabe im Code).
create function tags_setzen(p_art text, p_schluessel text[], p_tags bigint[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_art = 'artikel' then
    delete from artikel_tag where code = any (p_schluessel);
    insert into artikel_tag (code, tag_id)
      select a.code, t.id from artikel a join tag t
        on t.buchstabe = substring(a.code from '^([A-Z]{1,3})-')
       where a.code = any (p_schluessel) and t.id = any (coalesce(p_tags, '{}'));
  elsif p_art = 'stueck' then
    delete from stueck_tag where nummer = any (p_schluessel);
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, t.id from stueck s join tag t
        on t.buchstabe = substring(s.nummer from '^([A-Z]{1,3})-')
       where s.nummer = any (p_schluessel) and t.id = any (coalesce(p_tags, '{}'));
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
end $$;

-- Einen Tag vielen auf einmal geben (p_mit) bzw. wegnehmen (p_ohne).
create function tag_zuordnen(p_tag bigint, p_art text, p_mit text[], p_ohne text[])
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t tag;
begin
  select * into t from tag where id = p_tag;
  if not found then raise exception 'Unbekannter Tag: %', p_tag; end if;
  if p_art = 'artikel' then
    delete from artikel_tag where tag_id = p_tag and code = any (coalesce(p_ohne, '{}'));
    insert into artikel_tag (code, tag_id)
      select a.code, p_tag from artikel a
       where a.code = any (coalesce(p_mit, '{}')) and substring(a.code from '^([A-Z]{1,3})-') = t.buchstabe
      on conflict do nothing;
  elsif p_art = 'stueck' then
    delete from stueck_tag where tag_id = p_tag and nummer = any (coalesce(p_ohne, '{}'));
    insert into stueck_tag (nummer, tag_id)
      select s.nummer, p_tag from stueck s
       where s.nummer = any (coalesce(p_mit, '{}')) and substring(s.nummer from '^([A-Z]{1,3})-') = t.buchstabe
      on conflict do nothing;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Zugriff: Zuordnungen lesen; geändert werden sie nur über die
--  Funktionen oben. Die Tabelle tag behält ihre Rechte.
-- ---------------------------------------------------------------------
alter table artikel_tag enable row level security;
alter table stueck_tag  enable row level security;
create policy nur_trainer on artikel_tag for all to authenticated using (ist_trainer()) with check (ist_trainer());
create policy nur_trainer on stueck_tag  for all to authenticated using (ist_trainer()) with check (ist_trainer());
create policy offen_lesen on artikel_tag for select to anonymous using (true);
create policy offen_lesen on stueck_tag  for select to anonymous using (true);

grant select, insert, update, delete on artikel_tag, stueck_tag to authenticated;
grant select on artikel_tag, stueck_tag to anonymous;

revoke execute on function tags_setzen(text, text[], bigint[]), tag_zuordnen(bigint, text, text[], text[]) from public;
grant execute on function tags_setzen(text, text[], bigint[]), tag_zuordnen(bigint, text, text[], text[]) to authenticated, anonymous;

commit;
