-- =====================================================================
--  Werkstatt — Migration auf 21.1.0
--  Kategorien, Tags und Merkmale aufräumen
--
--  Vorher muss gelaufen sein: db/migration_21.0.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Die Vorgabe-Tag-Gruppe „Baugruppe“ entfällt (die Kategorie ist die
--    Baugruppe). Unbenutzte Baugruppe-Tags werden gelöscht. Hat ein Standort
--    noch benutzte, bleiben sie in einer eigenen Gruppe „Baugruppe“ dieses
--    Standorts.
--  - Disziplin = Radtyp: Die Datenbank legt je Standort einen Disziplin-Tag
--    je Radtyp an (außer „Sonstiges“) und hält sie gleich (umbenennen,
--    löschen, neuer Standort, Übernahme als Vorgabe). Disziplin-Tags lassen
--    sich nicht mehr von Hand anlegen, umbenennen oder löschen. Vorhandene
--    Disziplin-Tags, die zu keinem Radtyp passen, wandern in eine eigene
--    Gruppe „Weitere Disziplinen“ des Standorts. Zuordnungen bleiben.
--  - Das Vorgabe-Merkmal „Schaltungshersteller“ wird nicht mehr bei der
--    Kategorie Antrieb (A) abgefragt — dort reicht das Feld „Marke“. Bei
--    den Radtypen bleibt es. Eingetragene Werte an Artikeln und
--    Einzelstücken der Kategorie A fallen weg.
--  Vorhandene Daten bleiben sonst erhalten.
-- =====================================================================

begin;

-- ---------- 1. Funktionen ----------

create or replace function standort_anlegen(p_name text, p_kuerzel text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if not ist_admin() then raise exception 'Standorte legt nur der Gesamt-Admin an'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Name fehlt'; end if;
  if upper(trim(coalesce(p_kuerzel, ''))) !~ '^[A-Z]{2,3}$' then raise exception 'Kürzel: 2 bis 3 Buchstaben A–Z'; end if;
  if exists (select 1 from standort where kuerzel = upper(trim(p_kuerzel))) then raise exception 'Das Kürzel ist schon vergeben'; end if;
  insert into standort (name, kuerzel) values (trim(p_name), upper(trim(p_kuerzel))) returning id into v_id;
  perform standard_kategorien(v_id);
  perform standard_lagerorte(v_id);
  perform disziplin_abgleich(v_id);
  return v_id;
end $$;

create or replace function tag_gruppe_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.gruppe is null or vorgabe_laeuft() then return new; end if;
  if tg_op = 'UPDATE' and new.gruppe is not distinct from old.gruppe and new.standort_id = old.standort_id
     and new.name = old.name then return new; end if;
  if not exists (select 1 from tag_gruppe g where g.name = new.gruppe and (g.standort_id is null or g.standort_id = new.standort_id)) then
    raise exception 'Unbekannte Tag-Gruppe: %', new.gruppe;
  end if;
  -- Disziplinen sind die Radtypen (ab 21.1.0): anlegen und umbenennen nur dort
  if new.gruppe = 'Disziplin' then
    if tg_op = 'UPDATE' and old.gruppe = 'Disziplin' and new.name <> old.name then
      raise exception 'Disziplinen heißen wie die Radtypen – bitte den Radtyp umbenennen';
    end if;
    if not exists (select 1 from radtyp t
                    where lower(t.name) = lower(new.name) and lower(t.name) <> 'sonstiges'
                      and (t.standort_id is null or t.standort_id = new.standort_id)) then
      raise exception 'Disziplinen sind die Radtypen – „%“ ist keiner. Neue Disziplin: eigenen Radtyp anlegen', new.name;
    end if;
  end if;
  return new;
end $$;

create or replace function disziplin_abgleich(p_standort bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_vorher text := coalesce(current_setting('werkstatt.vorgabe', true), '');
begin
  perform set_config('werkstatt.vorgabe', 'ja', true);
  insert into tag (standort_id, gruppe, name)
    select distinct on (s.id, lower(t.name)) s.id, 'Disziplin', t.name
      from standort s join radtyp t on t.standort_id is null or t.standort_id = s.id
     where (p_standort is null or s.id = p_standort) and lower(t.name) <> 'sonstiges'
     order by s.id, lower(t.name), t.standort_id nulls first
  on conflict (standort_id, gruppe, lower(name)) where gruppe is not null
  do update set name = excluded.name where tag.name <> excluded.name;
  perform set_config('werkstatt.vorgabe', v_vorher, true);
end $$;

create or replace function disziplin_umbenennen(p_standort bigint, p_alt text, p_neu text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_vorher text := coalesce(current_setting('werkstatt.vorgabe', true), '');
  r      tag;
  v_ziel bigint;
begin
  perform set_config('werkstatt.vorgabe', 'ja', true);
  for r in select * from tag where gruppe = 'Disziplin' and lower(name) = lower(p_alt)
            and (p_standort is null or standort_id = p_standort) loop
    select id into v_ziel from tag where gruppe = 'Disziplin' and standort_id = r.standort_id and lower(name) = lower(p_neu) and id <> r.id;
    if v_ziel is null then
      update tag set name = p_neu where id = r.id;
    else
      insert into artikel_tag (code, tag_id) select code, v_ziel from artikel_tag where tag_id = r.id on conflict do nothing;
      insert into stueck_tag (nummer, tag_id) select nummer, v_ziel from stueck_tag where tag_id = r.id on conflict do nothing;
      delete from tag where id = r.id;
    end if;
  end loop;
  perform set_config('werkstatt.vorgabe', v_vorher, true);
end $$;

create or replace function disziplin_loeschen_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if vorgabe_laeuft() then return old; end if;
  raise exception 'Disziplinen sind die Radtypen – „%“ verschwindet mit dem Radtyp', old.name;
end $$;

create or replace function radtyp_speichern(p_id bigint, p_name text, p_kuerzel text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_name text := btrim(coalesce(p_name, ''));
  v_k    text := upper(btrim(coalesce(p_kuerzel, '')));
  t      radtyp;
  v_id   bigint;
begin
  if v_name = '' or length(v_name) > 30 or position('|' in v_name) > 0 then raise exception 'Name: 1 bis 30 Zeichen, ohne |'; end if;
  if v_k !~ '^[A-Z]{2,3}$' then raise exception 'Kürzel: 2 bis 3 Buchstaben A–Z'; end if;
  if exists (select 1 from radtyp where lower(name) = lower(v_name) and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Den Radtyp % gibt es schon', v_name;
  end if;
  if exists (select 1 from radtyp where kuerzel = v_k and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st
                    or (v_st is null and lower(name) <> lower(v_name)))) then
    raise exception 'Das Kürzel % ist schon vergeben', v_k;
  end if;
  if p_id is null then
    insert into radtyp (standort_id, name, kuerzel, reihenfolge)
    values (v_st, v_name, v_k, coalesce((select max(reihenfolge) from radtyp where standort_id is not distinct from v_st), 0) + 1)
    returning id into v_id;
  else
    select * into t from radtyp where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Radtyp nicht gefunden oder nicht änderbar'; end if;
    update radtyp set name = v_name, kuerzel = v_k where id = t.id;
    if v_name <> t.name then
      perform set_config('werkstatt.vorgabe', 'ja', true);
      update rad set typ = v_name where typ = t.name and (v_st is null or standort_id = v_st);
      perform set_config('werkstatt.vorgabe', '', true);
      perform disziplin_umbenennen(v_st, t.name, v_name);
    end if;
    v_id := t.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('radtyp', v_id); end if;
  perform disziplin_abgleich(v_st);
  return v_id;
end $$;

create or replace function tag_gruppe_speichern(p_id bigint, p_name text, p_vorgabe boolean default false)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := vorgabe_bereich(p_vorgabe);
  v_name text := btrim(coalesce(p_name, ''));
  g      tag_gruppe;
  v_id   bigint;
begin
  if v_name = '' or length(v_name) > 30 or position('|' in v_name) > 0 then raise exception 'Name: 1 bis 30 Zeichen, ohne |'; end if;
  if exists (select 1 from tag_gruppe where lower(name) = lower(v_name) and id is distinct from p_id
               and (standort_id is null or standort_id is not distinct from v_st)) then
    raise exception 'Die Tag-Gruppe % gibt es schon', v_name;
  end if;
  if p_id is null then
    insert into tag_gruppe (standort_id, name, reihenfolge)
    values (v_st, v_name, coalesce((select max(reihenfolge) from tag_gruppe where standort_id is not distinct from v_st), 0) + 1)
    returning id into v_id;
  else
    select * into g from tag_gruppe where id = p_id and standort_id is not distinct from v_st for update;
    if not found then raise exception 'Tag-Gruppe nicht gefunden oder nicht änderbar'; end if;
    if g.name = 'Marke' and g.standort_id is null and v_name <> g.name then
      raise exception 'Die Gruppe Marke gehört zum Feld „Marke“ und behält ihren Namen';
    end if;
    if g.name = 'Disziplin' and g.standort_id is null and v_name <> g.name then
      raise exception 'Die Gruppe Disziplin gehört zu den Radtypen und behält ihren Namen';
    end if;
    update tag_gruppe set name = v_name where id = g.id;
    if v_name <> g.name then
      perform set_config('werkstatt.vorgabe', 'ja', true);
      update tag set gruppe = v_name where gruppe = g.name and (v_st is null or standort_id = v_st);
      perform set_config('werkstatt.vorgabe', '', true);
    end if;
    v_id := g.id;
  end if;
  if v_st is null then perform vorgabe_zusammenfuehren('tag_gruppe', v_id); end if;
  return v_id;
end $$;

create or replace function eintrag_loeschen(p_art text, p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint;
  v_von bigint;
  v_n   integer;
  v_name text;
begin
  if p_art = 'radtyp' then select standort_id, name into v_von, v_name from radtyp where id = p_id;
  elsif p_art = 'tag_gruppe' then select standort_id, name into v_von, v_name from tag_gruppe where id = p_id;
  elsif p_art = 'merkmal' then select standort_id, name into v_von, v_name from merkmal where id = p_id;
  elsif p_art = 'merkmal_wert' then select standort_id, wert into v_von, v_name from merkmal_wert where id = p_id;
  else raise exception 'Unbekannte Art: %', p_art;
  end if;
  if v_name is null then raise exception 'Nicht gefunden'; end if;
  v_st := vorgabe_bereich(v_von is null);
  if v_von is distinct from v_st then raise exception 'Nicht gefunden oder nicht änderbar'; end if;

  if p_art = 'radtyp' then
    select count(*) into v_n from rad where typ = v_name and (v_st is null or standort_id = v_st);
    if v_n > 0 then raise exception 'Radtyp % hat noch % Räder – ausblenden statt löschen', v_name, v_n; end if;
    delete from ausblendung a using merkmal_ziel z where a.art = 'merkmal_ziel' and a.objekt_id = z.id and z.radtyp_id = p_id;
    delete from ausblendung a using merkmal_wert w where a.art = 'merkmal_wert' and a.objekt_id = w.id and w.radtyp_id = p_id;
    delete from ausblendung where art = 'radtyp' and objekt_id = p_id;
    delete from radtyp where id = p_id;
    -- Disziplin-Tag fällt mit weg (Teile verlieren nur diesen Tag)
    perform set_config('werkstatt.vorgabe', 'ja', true);
    delete from tag where gruppe = 'Disziplin' and lower(name) = lower(v_name) and (v_st is null or standort_id = v_st);
    perform set_config('werkstatt.vorgabe', '', true);
  elsif p_art = 'tag_gruppe' then
    if v_st is null and v_name = 'Marke' then raise exception 'Die Gruppe Marke gehört zum Feld „Marke“'; end if;
    if v_st is null and v_name = 'Disziplin' then raise exception 'Die Gruppe Disziplin gehört zu den Radtypen'; end if;
    select count(*) into v_n from tag where gruppe = v_name and (v_st is null or standort_id = v_st);
    if v_n > 0 then raise exception 'In der Gruppe % stehen noch % Tags – erst die Tags löschen', v_name, v_n; end if;
    delete from ausblendung where art = 'tag_gruppe' and objekt_id = p_id;
    delete from tag_gruppe where id = p_id;
  elsif p_art = 'merkmal' then
    select (select count(*) from rad where merkmale ? p_id::text) + (select count(*) from artikel where merkmale ? p_id::text)
         + (select count(*) from stueck where merkmale ? p_id::text) into v_n;
    if v_n > 0 then raise exception '„%“ ist noch % mal eingetragen – erst dort entfernen oder ausblenden', v_name, v_n; end if;
    delete from ausblendung a using merkmal_ziel z where a.art = 'merkmal_ziel' and a.objekt_id = z.id and z.merkmal_id = p_id;
    delete from ausblendung a using merkmal_wert w where a.art = 'merkmal_wert' and a.objekt_id = w.id and w.merkmal_id = p_id;
    delete from merkmal where id = p_id;
  else
    select (select count(*) from rad r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id))
         + (select count(*) from artikel r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id))
         + (select count(*) from stueck r, merkmal_wert w where w.id = p_id and r.merkmale -> w.merkmal_id::text = to_jsonb(p_id)) into v_n;
    if v_n > 0 then raise exception '„%“ ist noch % mal eingetragen – ausblenden statt löschen', v_name, v_n; end if;
    delete from ausblendung where art = 'merkmal_wert' and objekt_id = p_id;
    delete from merkmal_wert where id = p_id;
  end if;
end $$;

create or replace function als_vorgabe_uebernehmen(p_art text, p_id bigint, p_buchstabe text default null) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id bigint;
  rt   radtyp;
  tg   tag_gruppe;
  m    merkmal;
  w    merkmal_wert;
  k    kategorie;
begin
  perform vorgabe_bereich(true);
  if p_art = 'kategorie' then
    select * into k from kategorie where buchstabe = upper(p_buchstabe) and not vorgabe order by standort_id limit 1;
    if not found then raise exception 'Nicht gefunden'; end if;
    perform vorgabe_kategorie_speichern(k.buchstabe, k.name);
    return null;
  elsif p_art = 'radtyp' then
    select * into rt from radtyp where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from radtyp where standort_id is null and lower(name) = lower(rt.name);
    if v_id is null then
      if exists (select 1 from radtyp where standort_id is null and kuerzel = rt.kuerzel) then
        raise exception 'Das Kürzel % hat schon ein anderer Vorgabe-Radtyp – erst am Standort ändern', rt.kuerzel;
      end if;
      insert into radtyp (name, kuerzel, reihenfolge)
      values (rt.name, rt.kuerzel, coalesce((select max(reihenfolge) from radtyp where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'tag_gruppe' then
    select * into tg from tag_gruppe where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from tag_gruppe where standort_id is null and lower(name) = lower(tg.name);
    if v_id is null then
      insert into tag_gruppe (name, reihenfolge)
      values (tg.name, coalesce((select max(reihenfolge) from tag_gruppe where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'merkmal' then
    select * into m from merkmal where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    select id into v_id from merkmal where standort_id is null and lower(name) = lower(m.name);
    if v_id is null then
      insert into merkmal (name, typ, einheit, reihenfolge)
      values (m.name, m.typ, m.einheit, coalesce((select max(reihenfolge) from merkmal where standort_id is null), 0) + 1)
      returning id into v_id;
    end if;
  elsif p_art = 'merkmal_wert' then
    select * into w from merkmal_wert where id = p_id and standort_id is not null;
    if not found then raise exception 'Nicht gefunden'; end if;
    if exists (select 1 from merkmal where id = w.merkmal_id and standort_id is not null) then
      raise exception 'Erst das Merkmal als Vorgabe übernehmen';
    end if;
    if w.radtyp_id is not null and exists (select 1 from radtyp where id = w.radtyp_id and standort_id is not null) then
      raise exception 'Erst den Radtyp als Vorgabe übernehmen';
    end if;
    select id into v_id from merkmal_wert
     where standort_id is null and merkmal_id = w.merkmal_id and radtyp_id is not distinct from w.radtyp_id and lower(wert) = lower(w.wert);
    if v_id is null then
      insert into merkmal_wert (merkmal_id, radtyp_id, wert, reihenfolge)
      values (w.merkmal_id, w.radtyp_id, w.wert, coalesce((select max(reihenfolge) from merkmal_wert where merkmal_id = w.merkmal_id), 0) + 1)
      returning id into v_id;
    end if;
  else
    raise exception 'Unbekannte Art: %', p_art;
  end if;
  perform vorgabe_zusammenfuehren(p_art, v_id);
  if p_art = 'radtyp' then perform disziplin_abgleich(null); end if;
  return v_id;
end $$;

-- ---------- 2. Trigger ----------

drop trigger tag_gruppe on tag;
create trigger tag_gruppe before insert or update of gruppe, standort_id, name on tag
  for each row execute function tag_gruppe_pruefen();
create trigger tag_disziplin_loeschen before delete on tag
  for each row when (old.gruppe = 'Disziplin') execute function disziplin_loeschen_pruefen();

-- ---------- 3. Daten ----------

set local werkstatt.vorgabe = 'ja';

-- 3a. Baugruppe: unbenutzte Tags weg, benutzte in eine eigene Gruppe des Standorts
delete from tag t
 where t.gruppe = 'Baugruppe'
   and not exists (select 1 from artikel_tag x where x.tag_id = t.id)
   and not exists (select 1 from stueck_tag x where x.tag_id = t.id);
insert into tag_gruppe (standort_id, name, reihenfolge)
  select distinct t.standort_id, 'Baugruppe', 10 from tag t
   where t.gruppe = 'Baugruppe'
     and not exists (select 1 from tag_gruppe g where g.standort_id = t.standort_id and lower(g.name) = 'baugruppe');
delete from ausblendung a using tag_gruppe g
 where a.art = 'tag_gruppe' and a.objekt_id = g.id and g.standort_id is null and g.name = 'Baugruppe';
delete from tag_gruppe where standort_id is null and name = 'Baugruppe';

-- 3b. Disziplin = Radtyp
update tag_gruppe set reihenfolge = 2 where standort_id is null and name = 'Disziplin';
insert into tag_gruppe (standort_id, name, reihenfolge)
  select distinct t.standort_id, 'Weitere Disziplinen', 11 from tag t
   where t.gruppe = 'Disziplin'
     and not exists (select 1 from radtyp r where lower(r.name) = lower(t.name) and lower(r.name) <> 'sonstiges'
                                             and (r.standort_id is null or r.standort_id = t.standort_id))
     and not exists (select 1 from tag_gruppe g where g.standort_id = t.standort_id and lower(g.name) = 'weitere disziplinen');
update tag t set gruppe = 'Weitere Disziplinen'
 where t.gruppe = 'Disziplin'
   and not exists (select 1 from radtyp r where lower(r.name) = lower(t.name) and lower(r.name) <> 'sonstiges'
                                           and (r.standort_id is null or r.standort_id = t.standort_id));
select disziplin_abgleich(null);

-- 3c. Schaltungshersteller nicht mehr bei Antrieb (A)
update artikel a set merkmale = a.merkmale - m.id::text
  from merkmal m
 where m.standort_id is null and m.name = 'Schaltungshersteller' and code_buchstabe(a.code) = 'A' and a.merkmale ? m.id::text
   and not exists (select 1 from merkmal_ziel z where z.merkmal_id = m.id and z.buchstabe = 'A' and z.standort_id = a.standort_id);
update stueck s set merkmale = s.merkmale - m.id::text
  from merkmal m
 where m.standort_id is null and m.name = 'Schaltungshersteller' and code_buchstabe(s.nummer) = 'A' and s.merkmale ? m.id::text
   and not exists (select 1 from merkmal_ziel z where z.merkmal_id = m.id and z.buchstabe = 'A' and z.standort_id = s.standort_id);
delete from ausblendung a using merkmal_ziel z, merkmal m
 where a.art = 'merkmal_ziel' and a.objekt_id = z.id and z.merkmal_id = m.id
   and m.standort_id is null and m.name = 'Schaltungshersteller' and z.standort_id is null and z.buchstabe = 'A';
delete from merkmal_ziel z using merkmal m
 where z.merkmal_id = m.id and m.standort_id is null and m.name = 'Schaltungshersteller'
   and z.standort_id is null and z.buchstabe = 'A';

set local werkstatt.vorgabe = '';

-- ---------- 4. Rechte ----------

revoke execute on function
  disziplin_abgleich(bigint), disziplin_umbenennen(bigint, text, text), disziplin_loeschen_pruefen()
from public, anonymous;

commit;
