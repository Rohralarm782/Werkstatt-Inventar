-- =====================================================================
--  Werkstatt — Migration auf 21.8.0
--  Sitzpositionen je Rad (Sattel, Lenker, Zeitfahraufsatz) und
--  UCI-Größenkategorie beim Sportler
--
--  Vorher muss gelaufen sein: db/migration_21.7.2.sql
--  (21.7.3 hatte keine Migration)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache" (neue Tabelle, Sicht und Funktion!).
--
--  Was passiert:
--  - Neue Tabelle sitzposition: jedes Speichern einer Sitzposition ist eine
--    neue Zeile (Verlauf). Sattel (SH, S) und die Werte des Lenkers, um den
--    es ging: normaler Lenker (L, V; ohne Einzelstück = Standard-Lenker des
--    Rads, sonst Stück mit Tag „Lenker“) oder Zeitfahraufsatz (SP, V, E, H;
--    Stück mit Tag „TT-Lenker“). Dazu Laserjig-Bestätigung, Notiz, wer, wann.
--  - Neue Sicht v_sitzposition: der aktuelle Stand je Rad, Art und Lenker.
--  - Neue Funktion sitzposition_speichern (Trainer/Mechaniker, Werkstatt-
--    Manager, Gesamt-Admin). Lesen dürfen alle Werkstatt-Rollen und die
--    Geschäftsstelle; Sportler sehen nur ihre eigenen Räder.
--  - app_daten liefert zusätzlich den aktuellen Stand (sitzpos) mit.
--  - Neue Spalte sportler.uci_kategorie (1–3), nur zur Info.
--  - Vorhandene Daten bleiben unverändert.
-- =====================================================================

begin;

alter table sportler add column if not exists uci_kategorie smallint check (uci_kategorie between 1 and 3);   -- UCI-Größenkategorie (ab 21.8.0)

-- Sitzpositionen (ab 21.8.0): Journal je Rad — jedes Speichern ist eine neue
-- Zeile, nichts wird überschrieben. Eine Zeile hält den Sattel (gilt fürs Rad)
-- und die Werte des Lenkers, um den es ging:
--   art 'bahn' = normaler Lenker. stueck_nummer leer = Standard-Lenker des Rads;
--                ein montiertes Stück mit Tag „Lenker“ ersetzt ihn.
--   art 'tt'   = Zeitfahraufsatz, immer ein montiertes Stück mit Tag „TT-Lenker“.
-- Maße in mm. Buchstaben in der App: SH, S (UCI), L, V, SP, E (UCI), H (UCI).
-- jig_am/jig_von: am Laserjig bestätigt (gilt für Rad + Lenker).
create table sitzposition (
  id             bigint generated always as identity primary key,
  standort_id    bigint not null references standort (id),
  rad_id         text not null references rad (id) on update cascade,
  art            text not null check (art in ('bahn', 'tt')),
  stueck_nummer  text references stueck (nummer) on update cascade on delete cascade,
  sattelhoehe    integer check (sattelhoehe between 400 and 1000),      -- SH: Tretlagermitte bis Satteloberkante
  sattelversatz  integer check (sattelversatz between 0 and 70),        -- S: Sattelspitze hinter dem Lot durchs Tretlager
  lenker_vorne   integer check (lenker_vorne between 300 and 800),      -- L: Tretlagermitte bis Lenkermitte (nur bahn)
  vorbau         integer check (vorbau between 0 and 200),              -- V: Länge
  spacer         integer check (spacer between 0 and 250),              -- SP: Spacer unter den Armschalen (nur tt)
  reichweite     integer check (reichweite between 500 and 1000),       -- E: Tretlagerachse bis Aufsatzspitze (nur tt)
  erhoehung      integer check (erhoehung between -100 and 250),        -- H: Mitte Armschale bis höchster Punkt (nur tt)
  jig_am         timestamptz,
  jig_von        text,
  notiz          text,
  angelegt       timestamptz not null default now(),
  angelegt_von   text,
  check (art = 'bahn' or stueck_nummer is not null),
  check (art = 'tt' or (spacer is null and reichweite is null and erhoehung is null)),
  check (art = 'bahn' or lenker_vorne is null),
  check ((jig_am is null) = (jig_von is null))
);
create index sitzposition_rad_idx on sitzposition (rad_id, id desc);

-- Aktueller Stand je Rad, Art und Lenker (ab 21.8.0): die jeweils letzte Zeile.
-- Der Sattel gilt fürs Rad: aktuell ist er in der neuesten Zeile des Rads.
create view v_sitzposition with (security_invoker = true) as
select distinct on (p.rad_id, p.art, coalesce(p.stueck_nummer, '')) p.*
from sitzposition p
order by p.rad_id, p.art, coalesce(p.stueck_nummer, ''), p.id desc;

-- Sitzposition speichern (ab 21.8.0): legt eine neue Zeile an, ganz oder gar nicht.
-- p_werte: { sattelhoehe, sattelversatz, lenker_vorne, vorbau, spacer, reichweite, erhoehung } in mm (leer = null).
-- p_stueck: montiertes Lenker-Stück (Tag „Lenker“ bzw. „TT-Lenker“); bei bahn leer = Standard-Lenker.
-- p_jig: am Laserjig bestätigt. Bleiben die Lenkerwerte gleich, bleibt Datum und Name
-- der bisherigen Bestätigung stehen; sonst gilt sie ab jetzt.
create or replace function sitzposition_speichern(p_rad text, p_art text, p_stueck text, p_werte jsonb,
                                                  p_jig boolean default false, p_notiz text default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st   bigint := recht_arbeiten();
  v_w    jsonb  := coalesce(p_werte, '{}'::jsonb);
  v_stk  text   := nullif(btrim(coalesce(p_stueck, '')), '');
  v_alt  sitzposition;
  v_neu  sitzposition;
  k      text;
begin
  if jsonb_typeof(v_w) <> 'object' then raise exception 'Werte fehlen'; end if;
  if not exists (select 1 from rad where id = p_rad and standort_id = v_st) then
    raise exception 'Unbekanntes Rad: %', p_rad;
  end if;
  if p_art is null or p_art not in ('bahn', 'tt') then raise exception 'Unbekannte Lenkerart: %', p_art; end if;
  for k in select jsonb_object_keys(v_w) loop
    if k not in ('sattelhoehe', 'sattelversatz', 'lenker_vorne', 'vorbau', 'spacer', 'reichweite', 'erhoehung') then
      raise exception 'Unbekannter Wert: %', k;
    end if;
    if jsonb_typeof(v_w -> k) not in ('number', 'null') then raise exception '%: bitte eine Zahl in mm', k; end if;
  end loop;

  if v_stk is not null then
    if not exists (select 1 from stueck s where s.nummer = v_stk and s.standort_id = v_st and s.rad_id = p_rad) then
      raise exception '% ist nicht an diesem Rad montiert', v_stk;
    end if;
    if not exists (select 1 from stueck_tag x join tag t on t.id = x.tag_id
                    where x.nummer = v_stk and lower(btrim(t.name)) = case p_art when 'tt' then 'tt-lenker' else 'lenker' end) then
      raise exception '% hat nicht den Tag „%“', v_stk, case p_art when 'tt' then 'TT-Lenker' else 'Lenker' end;
    end if;
  elsif p_art = 'tt' then
    raise exception 'Zeitfahrwerte nur mit montiertem TT-Lenker (Einzelstück mit Tag „TT-Lenker“)';
  end if;

  v_neu.standort_id   := v_st;
  v_neu.rad_id        := p_rad;
  v_neu.art           := p_art;
  v_neu.stueck_nummer := v_stk;
  v_neu.sattelhoehe   := round((v_w ->> 'sattelhoehe')::numeric);
  v_neu.sattelversatz := round((v_w ->> 'sattelversatz')::numeric);
  v_neu.vorbau        := round((v_w ->> 'vorbau')::numeric);
  if p_art = 'bahn' then
    v_neu.lenker_vorne := round((v_w ->> 'lenker_vorne')::numeric);
  else
    v_neu.spacer     := round((v_w ->> 'spacer')::numeric);
    v_neu.reichweite := round((v_w ->> 'reichweite')::numeric);
    v_neu.erhoehung  := round((v_w ->> 'erhoehung')::numeric);
  end if;
  -- Verständliche Meldungen statt der Tabellenprüfung
  if v_neu.sattelhoehe not between 400 and 1000 then raise exception 'Sattelhöhe SH: 400–1000 mm'; end if;
  if v_neu.sattelversatz not between 0 and 70 then raise exception 'Sattelversatz S: 0–70 mm'; end if;
  if v_neu.lenker_vorne not between 300 and 800 then raise exception 'Lenker vorne L: 300–800 mm'; end if;
  if v_neu.vorbau not between 0 and 200 then raise exception 'Vorbau V: 0–200 mm'; end if;
  if v_neu.spacer not between 0 and 250 then raise exception 'Spacer SP: 0–250 mm'; end if;
  if v_neu.reichweite not between 500 and 1000 then raise exception 'Reichweite E: 500–1000 mm'; end if;
  if v_neu.erhoehung not between -100 and 250 then raise exception 'Erhöhung H: −100–250 mm'; end if;
  v_neu.notiz         := nullif(btrim(coalesce(p_notiz, '')), '');
  v_neu.angelegt_von  := ich_name();

  if coalesce(p_jig, false) then
    select * into v_alt from sitzposition
     where rad_id = p_rad and art = p_art and stueck_nummer is not distinct from v_stk
     order by id desc limit 1;
    if v_alt.jig_am is not null
       and v_alt.lenker_vorne is not distinct from v_neu.lenker_vorne and v_alt.vorbau is not distinct from v_neu.vorbau
       and v_alt.spacer is not distinct from v_neu.spacer and v_alt.reichweite is not distinct from v_neu.reichweite
       and v_alt.erhoehung is not distinct from v_neu.erhoehung then
      v_neu.jig_am := v_alt.jig_am; v_neu.jig_von := v_alt.jig_von;
    else
      v_neu.jig_am := now(); v_neu.jig_von := coalesce(ich_name(), '?');
    end if;
  end if;

  insert into sitzposition (standort_id, rad_id, art, stueck_nummer, sattelhoehe, sattelversatz, lenker_vorne, vorbau,
                            spacer, reichweite, erhoehung, jig_am, jig_von, notiz, angelegt_von)
  values (v_neu.standort_id, v_neu.rad_id, v_neu.art, v_neu.stueck_nummer, v_neu.sattelhoehe, v_neu.sattelversatz,
          v_neu.lenker_vorne, v_neu.vorbau, v_neu.spacer, v_neu.reichweite, v_neu.erhoehung, v_neu.jig_am, v_neu.jig_von,
          v_neu.notiz, v_neu.angelegt_von)
  returning id into v_neu.id;
  return v_neu.id;
end $$;

create or replace function app_daten() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_ich  jsonb := ich();
  v_t    bigint[];
  v_a    jsonb;
  v_b    jsonb;
begin
  if v_ich is null or coalesce(v_ich ->> 'rolle', '') not in ('manager', 'trainer', 'geschaeftsstelle') then
    return jsonb_build_object('ich', v_ich, 'daten', null);
  end if;
  select coalesce(array_agg(t.id), '{}') into v_t from ticket t where t.status in ('offen', 'angenommen');
  v_a := jsonb_build_object(
    'bestand',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.code), '[]') from v_bestand x),
    'artikel',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.code), '[]') from artikel x),
    'raeder',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from v_rad x),
    'sportler',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from sportler x),
    'stueck',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.nummer), '[]') from stueck x),
    'tickets',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from ticket x where x.id = any (v_t)),
    'positionen',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]') from ticket_position x
                      where x.ticket_id = any (v_t) and x.status <> 'storniert'),
    'ticket_stueck',(select coalesce(jsonb_agg(to_jsonb(x)), '[]') from ticket_stueck x where x.ticket_id = any (v_t)),
    'koffer',       (select coalesce(jsonb_agg(to_jsonb(x) order by x.ort, x.code), '[]') from v_koffer x),
    'termine',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.datum), '[]') from termin x
                      where x.datum >= (now() at time zone 'Europe/Berlin')::date),
    'standort',     (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', x.id, 'name', x.name, 'kuerzel', x.kuerzel, 'aktiv', x.aktiv, 'rg_empfaenger', x.rg_empfaenger,
                       'rg_absender', x.rg_absender, 'rg_kopf', x.rg_kopf, 'rg_fuss', x.rg_fuss, 'rg_text', x.rg_text,
                       'iban', x.iban, 'bic', x.bic, 'bank', x.bank, 'zahlungsziel_tage', x.zahlungsziel_tage,
                       'rad_vorlage', x.rad_vorlage, 'rad_stellen', x.rad_stellen)), '[]') from standort x),
    'rechnungen',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]')
                       from (select * from rechnung order by id desc limit 100) x),
    'offene_posten',(select coalesce(jsonb_agg(to_jsonb(x) order by x.zeit), '[]') from v_offene_posten x),
    'zaehlung',     (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from zaehlung x),
    'bestellungen', (select coalesce(jsonb_agg(to_jsonb(x) order by x.bestellt_am), '[]') from bestellung x where x.erhalten_am is null)
  );
  v_b := jsonb_build_object(
    'tags',         (select coalesce(jsonb_agg(to_jsonb(x) order by x.buchstabe, x.sortierung, x.name), '[]') from tag x),
    'artikel_tag',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from artikel_tag x),
    'stueck_tag',   (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from stueck_tag x),
    'kategorien',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.buchstabe), '[]') from kategorie x),
    'lagerorte',    (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from lagerort x),
    'bestand_ort',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from v_bestand_ort x),
    'bestand_groesse', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from v_bestand_groesse x),
    'ausgeliehen',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.seit desc), '[]') from v_ausgeliehen x),
    'personen',     case when rolle_in('manager', 'trainer') then werkstatt_personen() end,
    'radtypen',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from radtyp x),
    'gruppen',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from tag_gruppe x),
    'merkmale',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.name), '[]') from merkmal x),
    'werte',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.id), '[]') from merkmal_wert x),
    'ziele',        (select coalesce(jsonb_agg(to_jsonb(x) order by x.reihenfolge, x.id), '[]') from merkmal_ziel x),
    'pflicht',      (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from merkmal_pflicht x),
    'aus',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from ausblendung x),
    'sitzpos',      (select coalesce(jsonb_agg(to_jsonb(x) order by x.rad_id, x.id), '[]') from v_sitzposition x)
  );
  return jsonb_build_object('ich', v_ich, 'daten', v_a || v_b);
end $$;

alter table sitzposition enable row level security;
-- Sitzpositionen (ab 21.8.0): lesen wie das Rad (Sportler nur ihr eigenes),
-- schreiben nur über sitzposition_speichern.
create policy lesen on sitzposition for select to anonymous
  using (standort_id = (select akt_standort())
         and ((select rolle_in('admin', 'manager', 'trainer', 'geschaeftsstelle')) or mein_rad(rad_id)));

grant select on sitzposition, v_sitzposition to anonymous;
grant usage, select on sequence sitzposition_id_seq to anonymous;
revoke execute on function sitzposition_speichern(text, text, text, jsonb, boolean, text) from public;
grant execute on function sitzposition_speichern(text, text, text, jsonb, boolean, text) to anonymous;

commit;
