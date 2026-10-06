-- =====================================================================
--  Werkstatt — Migration auf 16.0.0: Bekleidung (Größen, Ausleihe an
--  Sportler, Rückgabe) und Lagerort-Art „Bekleidung“
--
--  Vorher muss gelaufen sein: db/migration_15.0.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Empfehlung: vorher auf einem Neon-Branch testen.
--
--  Was passiert:
--  - artikel bekommt die Spalte groessen (Liste, z. B. {S,M,L}; leer =
--    Artikel ohne Größen wie bisher).
--  - buchung bekommt die Spalte groesse und die Arten 'ausleihe' und
--    'rueckgabe' (immer mit Sportler, nie abgerechnet).
--  - lagerort.art erlaubt zusätzlich 'bekleidung' (zählt wie ein Raum
--    zum Lager).
--  - Neue Sichten v_bestand_groesse und v_ausgeliehen; v_bestand zählt
--    Bekleidungslager zum Lager.
--  - Neue Funktionen kleidung_ausleihen, kleidung_rueckgabe,
--    kleidung_zaehlen; Trigger groesse_pruefen; Storno übernimmt die Größe;
--    artikel_anlegen nimmt Größen an; Lagerort-Funktionen kennen
--    „Bekleidung“.
--  Vorhandene Daten bleiben unverändert (alle bisherigen Buchungen ohne
--  Größe). Hinweise wie „No privileges could be revoked for pgp_…“ oder
--  „… does not exist, skipping“ sind harmlos.
--  Lässt sich gefahrlos ein zweites Mal ausführen.
-- =====================================================================

begin;

-- 1. Neue Spalten
alter table artikel add column if not exists groessen  text[] check (groessen is null or cardinality(groessen) between 1 and 40);
alter table buchung add column if not exists groesse  text check (groesse is null or (groesse = trim(groesse) and groesse <> '' and length(groesse) <= 20));

-- 2. Neue Buchungsarten und Lagerort-Art
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint
            where contype = 'c' and conrelid = 'buchung'::regclass and pg_get_constraintdef(oid) like '%umbuchung%' loop
    execute format('alter table buchung drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint
            where contype = 'c' and conrelid = 'lagerort'::regclass and pg_get_constraintdef(oid) like '%koffer%'
              and pg_get_constraintdef(oid) not like '%haupt%' loop
    execute format('alter table lagerort drop constraint %I', c.conname);
  end loop;
end $$;
alter table buchung add constraint buchung_art_check check (art in ('zugang', 'entnahme', 'umbuchung', 'korrektur', 'storno', 'ausleihe', 'rueckgabe'));
alter table lagerort add constraint lagerort_art_check check (art in ('raum', 'koffer', 'bekleidung'));

-- 3. Sichten
create or replace view v_bestand with (security_invoker = true) as
with b as (
  -- Räume und Bekleidungslager zusammen = Lager („frei“ kommt daraus); Koffer zählen zum Bestand, aber nicht als frei
  select bu.code,
         sum(bu.menge) filter (where l.art in ('raum', 'bekleidung')) as lager,
         sum(bu.menge) filter (where l.art = 'koffer') as koffer
  from buchung bu
  join lagerort l on l.standort_id = bu.standort_id and l.name = bu.ort
  group by bu.code
), r as (
  -- Reservierungen blockieren nur Bestand in Räumen
  select p.code, sum(p.menge) as reserviert
  from ticket_position p
  join ticket t on t.id = p.ticket_id
  join lagerort l on l.standort_id = t.standort_id and l.name = t.arbeitsort
  where p.status = 'reserviert'
    and t.status in ('offen', 'angenommen')
    and l.art = 'raum'
  group by p.code
)
select a.code, a.name, a.einheit, a.art, a.preis, a.mindestbestand, a.lieferzeit_tage, a.aktiv,
       coalesce(b.lager, 0)          as lager,
       coalesce(b.koffer, 0)         as koffer,
       coalesce(b.lager, 0) + coalesce(b.koffer, 0) as gesamt,
       coalesce(r.reserviert, 0)     as reserviert,
       coalesce(b.lager, 0) - coalesce(r.reserviert, 0) as frei,
       case
         when a.art = 'Pauschale' then 'leistung'
         when coalesce(b.lager, 0) - coalesce(r.reserviert, 0) <= 0 then 'leer'
         when coalesce(b.lager, 0) - coalesce(r.reserviert, 0) < a.mindestbestand then 'nachbestellen'
         else 'ok'
       end as status
from artikel a
left join b using (code)
left join r using (code);

drop view if exists v_bestand_groesse;
drop view if exists v_ausgeliehen;
-- Bestand je Artikel, Größe und Ort (ab 16.0.0; groesse null = ohne Größe)
create view v_bestand_groesse with (security_invoker = true) as
select code, groesse, ort, sum(menge) as menge
from buchung
group by code, groesse, ort
having sum(menge) <> 0;

-- Ausgeliehene Bekleidung je Sportler: Ausleihen minus Rückgaben, Stornos eingerechnet
create view v_ausgeliehen with (security_invoker = true) as
select b.sportler_id, b.code, b.groesse, -sum(b.menge) as menge,
       max(b.zeit) filter (where b.art = 'ausleihe') as seit
from buchung b
left join buchung o on o.id = b.storno_von
where coalesce(o.art, b.art) in ('ausleihe', 'rueckgabe') and b.sportler_id is not null
group by b.sportler_id, b.code, b.groesse
having sum(b.menge) <> 0;

-- 4. Funktionen
create or replace function lagerort_anlegen(p_name text, p_art text) returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_manager();
  v_name text;
  v_id   bigint;
begin
  if p_art is null or p_art not in ('raum', 'koffer', 'bekleidung') then raise exception 'Art fehlt: Raum, Koffer oder Bekleidung'; end if;
  v_name := lagerort_name_pruefen(v_st, p_name, null);
  insert into lagerort (standort_id, name, art, reihenfolge)
  values (v_st, v_name, p_art, coalesce((select max(reihenfolge) from lagerort where standort_id = v_st), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;

create or replace function lagerort_aendern(p_id bigint, p_name text default null, p_art text default null,
                                            p_aktiv boolean default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_manager();
  l      lagerort;
  v_name text;
begin
  select * into l from lagerort where id = p_id and standort_id = v_st for update;
  if not found then raise exception 'Lagerort nicht gefunden'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is not null then v_name := lagerort_name_pruefen(v_st, p_name, l.id); end if;

  if l.haupt and ((v_name is not null and v_name <> l.name) or (p_art is not null and p_art <> l.art) or p_aktiv is false) then
    raise exception '% ist der Hauptraum und lässt sich nicht umbenennen, umstellen oder deaktivieren', l.name;
  end if;

  if p_art is not null and p_art <> l.art then
    if p_art not in ('raum', 'koffer', 'bekleidung') then raise exception 'Art: Raum, Koffer oder Bekleidung'; end if;
    if l.art = 'koffer' and (exists (select 1 from koffer_soll where standort_id = v_st and ort = l.name)
                           or exists (select 1 from termin where standort_id = v_st and koffer = l.name)) then
      raise exception 'Erst Packliste und Termine von % entfernen, dann umstellen', l.name;
    end if;
    update lagerort set art = p_art where id = l.id;
  end if;

  if p_aktiv is false and l.aktiv then
    if exists (select 1 from buchung where standort_id = v_st and ort = l.name group by code having sum(menge) <> 0) then
      raise exception 'In % liegt noch Material – erst umbuchen oder per Inventur auf 0 setzen', l.name;
    end if;
    if exists (select 1 from stueck where standort_id = v_st and ort = l.name) then
      raise exception 'In % liegen noch Einzelstücke – erst einen anderen Ort wählen', l.name;
    end if;
    if exists (select 1 from ticket where standort_id = v_st and arbeitsort = l.name and status in ('offen', 'angenommen')) then
      raise exception 'Offene Tickets werden in % bearbeitet – erst abschließen oder Arbeitsort ändern', l.name;
    end if;
    update lagerort set aktiv = false where id = l.id;
  elsif p_aktiv is true and not l.aktiv then
    update lagerort set aktiv = true where id = l.id;
  end if;

  if v_name is not null and v_name <> l.name then
    update lagerort set name = v_name where id = l.id;          -- Buchungen, Tickets, Packlisten … ziehen nach
    update stueck set ort = v_name where standort_id = v_st and ort = l.name;
  end if;
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
                       verbraucht_code, verbrauch_menge, lieferant, bestellnummer, shop_link, aktiv, dauer_min, standort_id, groessen)
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
               then array(select jsonb_array_elements_text(p_daten -> 'groessen')) end);
  insert into artikel_tag (code, tag_id)
    select v_code, t.id from tag t
     where t.buchstabe = p_buchstabe and t.standort_id = v_st
       and t.id in (select (x #>> '{}')::bigint from jsonb_array_elements(coalesce(p_daten -> 'tags', '[]'::jsonb)) x);
  return v_code;
end $$;

create or replace function buchung_stornieren(p_buchung bigint, p_grund text, p_bearbeiter text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st     bigint := recht_arbeiten();
  b        buchung;
  z        buchung;
  v_anzahl integer := 0;
begin
  p_bearbeiter := ich_name();
  if coalesce(trim(p_grund), '') = '' then raise exception 'Bitte einen Grund angeben'; end if;
  select * into b from buchung where id = p_buchung and standort_id = v_st for update;
  if not found then raise exception 'Buchung % nicht gefunden', p_buchung; end if;
  if b.art = 'storno' then raise exception 'Eine Storno-Buchung kann nicht storniert werden'; end if;

  for z in
    select * from buchung
     where standort_id = v_st
       and (id = b.id
        or (b.gruppe is not null and gruppe = b.gruppe)
        -- Pauschalen aus der Zeit vor 5.0.0: Verbrauch hat keine Gruppe,
        -- entstand aber in derselben Buchung (gleiche Zeit, gleicher Sportler/Ticket)
        or (b.gruppe is null and b.art = 'entnahme' and art = 'entnahme' and zeit = b.zeit
            and sportler_id is not distinct from b.sportler_id and ticket_id is not distinct from b.ticket_id
            and notiz = 'Verbrauch aus ' || b.code))
     order by id
     for update
  loop
    if z.rechnung_id is not null then
      raise exception 'Steht auf einer Rechnung — erst die Rechnung stornieren';
    end if;
    if exists (select 1 from buchung where storno_von = z.id) then
      raise exception 'Bereits storniert';
    end if;
    if z.art = 'ausleihe' and coalesce((select sum(menge) from v_ausgeliehen
                                         where sportler_id = z.sportler_id and code = z.code
                                           and groesse is not distinct from z.groesse), 0) < -z.menge then
      raise exception 'Von dieser Ausleihe wurde schon etwas zurückgegeben – erst die Rückgabe stornieren';
    end if;
    insert into buchung (art, code, groesse, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen,
                         gruppe, notiz, bearbeiter, storno_von, standort_id)
    values ('storno', z.code, z.groesse, -z.menge, z.ort, z.sportler_id, z.ticket_id, z.einzelpreis, false,
            z.gruppe, 'Storno: ' || trim(p_grund), p_bearbeiter, z.id, v_st);
    v_anzahl := v_anzahl + 1;
  end loop;
  return v_anzahl;
end $$;

-- Größe beim Buchen prüfen: nur Größen des Artikels; bei Artikeln mit
-- Größen brauchen Zugang, Ausleihe und Rückgabe eine Größe.
create or replace function groesse_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_gr text[];
begin
  select groessen into v_gr from artikel where code = new.code;
  if new.groesse is not null and new.art not in ('storno', 'korrektur')
     and (v_gr is null or not (new.groesse = any (v_gr))) then
    raise exception 'Größe % gibt es bei % nicht', new.groesse, new.code;
  end if;
  if new.groesse is null and v_gr is not null and new.art in ('zugang', 'ausleihe', 'rueckgabe') then
    raise exception 'Bitte eine Größe angeben (%)', new.code;
  end if;
  if new.art in ('ausleihe', 'rueckgabe') and new.sportler_id is null then
    raise exception 'Sportler fehlt';
  end if;
  return new;
end $$;

-- Mehrere Teile an einen Sportler ausleihen (eine Gruppe → zusammen stornierbar).
-- p_posten: [{"code": "...", "groesse": "M", "menge": 1}, …]
create or replace function kleidung_ausleihen(p_sportler bigint, p_ort text, p_posten jsonb, p_notiz text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_arbeiten();
  v_grp uuid   := gen_random_uuid();
  v_p   jsonb;
  v_m   numeric;
  v_n   integer := 0;
begin
  perform ort_pruefen(v_st, p_ort);
  if not exists (select 1 from sportler where id = p_sportler and standort_id = v_st and aktiv) then
    raise exception 'Unbekannter Sportler';
  end if;
  for v_p in select * from jsonb_array_elements(coalesce(p_posten, '[]'::jsonb)) loop
    v_m := (v_p ->> 'menge')::numeric;
    if v_m is null or v_m <= 0 then raise exception 'Menge fehlt'; end if;
    if not exists (select 1 from artikel where code = v_p ->> 'code' and standort_id = v_st) then
      raise exception 'Unbekannter Artikel: %', v_p ->> 'code';
    end if;
    insert into buchung (art, code, groesse, menge, ort, sportler_id, abrechnen, gruppe, notiz, bearbeiter, standort_id)
    values ('ausleihe', v_p ->> 'code', nullif(v_p ->> 'groesse', ''), -v_m, p_ort, p_sportler, false, v_grp,
            nullif(trim(p_notiz), ''), ich_name(), v_st);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Keine Teile gewählt'; end if;
  return v_n;
end $$;

-- Rückgabe in einen Lagerort; höchstens so viel, wie der Sportler hat.
create or replace function kleidung_rueckgabe(p_sportler bigint, p_ort text, p_posten jsonb, p_notiz text default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_arbeiten();
  v_grp uuid   := gen_random_uuid();
  v_p   jsonb;
  v_m   numeric;
  v_hat numeric;
  v_gr  text;
  v_n   integer := 0;
begin
  perform ort_pruefen(v_st, p_ort);
  if not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then raise exception 'Unbekannter Sportler'; end if;
  for v_p in select * from jsonb_array_elements(coalesce(p_posten, '[]'::jsonb)) loop
    v_m  := (v_p ->> 'menge')::numeric;
    v_gr := nullif(v_p ->> 'groesse', '');
    if v_m is null or v_m <= 0 then raise exception 'Menge fehlt'; end if;
    select coalesce(sum(menge), 0) into v_hat from v_ausgeliehen
     where sportler_id = p_sportler and code = v_p ->> 'code' and groesse is not distinct from v_gr;
    if v_m > v_hat then
      raise exception 'Zurück % % %, ausgeliehen sind nur %', v_m, v_p ->> 'code', coalesce(v_gr, ''), v_hat;
    end if;
    insert into buchung (art, code, groesse, menge, ort, sportler_id, abrechnen, gruppe, notiz, bearbeiter, standort_id)
    values ('rueckgabe', v_p ->> 'code', v_gr, v_m, p_ort, p_sportler, false, v_grp, nullif(trim(p_notiz), ''), ich_name(), v_st);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Keine Teile gewählt'; end if;
  return v_n;
end $$;

-- Zählen je Größe an einem Ort; die Differenz wird je Größe korrigiert.
-- p_zaehlung: [{"groesse": "M", "gezaehlt": 3}, …] (groesse null = ohne Größe)
create or replace function kleidung_zaehlen(p_code text, p_ort text, p_zaehlung jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_arbeiten();
  v_z   jsonb;
  v_gr  text;
  v_g   numeric;
  v_ist numeric;
  v_n   integer := 0;
begin
  if not exists (select 1 from artikel where code = p_code and standort_id = v_st) then raise exception 'Unbekannter Artikel: %', p_code; end if;
  perform ort_pruefen(v_st, p_ort);
  for v_z in select * from jsonb_array_elements(coalesce(p_zaehlung, '[]'::jsonb)) loop
    v_gr := nullif(v_z ->> 'groesse', '');
    v_g  := (v_z ->> 'gezaehlt')::numeric;
    if v_g is null or v_g < 0 then raise exception 'Ungültige Zählung für Größe %', coalesce(v_gr, '–'); end if;
    select coalesce(sum(menge), 0) into v_ist from buchung
     where code = p_code and ort = p_ort and groesse is not distinct from v_gr and standort_id = v_st;
    if v_g <> v_ist then
      insert into buchung (art, code, groesse, menge, ort, notiz, bearbeiter, standort_id)
      values ('korrektur', p_code, v_gr, v_g - v_ist, p_ort,
              'Inventur' || coalesce(' ' || v_gr, '') || ': gezählt ' || v_g || ', vorher ' || v_ist, ich_name(), v_st);
      v_n := v_n + 1;
    end if;
  end loop;
  insert into zaehlung (code, ort, bearbeiter, standort_id) values (p_code, p_ort, ich_name(), v_st)
  on conflict (code, ort) do update set gezaehlt_am = now(), bearbeiter = excluded.bearbeiter;
  return v_n;
end $$;

drop trigger if exists buchung_groesse on buchung;
create trigger buchung_groesse       before insert on buchung    for each row execute function groesse_pruefen();

-- 5. Rechte
grant select on v_bestand, v_bestand_groesse, v_ausgeliehen to anonymous;
grant insert (art, code, menge, ort, notiz, bearbeiter, groesse) on buchung to anonymous;
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
  foto_hochladen(bigint, text, text, text, text, uuid),
  lagerort_anlegen(text, text),
  lagerort_aendern(bigint, text, text, boolean),
  lagerort_loeschen(bigint),
  lagerorte_sortieren(bigint[]),
  kleidung_ausleihen(bigint, text, jsonb, text),
  kleidung_rueckgabe(bigint, text, jsonb, text),
  kleidung_zaehlen(text, text, jsonb)
to anonymous;

commit;
