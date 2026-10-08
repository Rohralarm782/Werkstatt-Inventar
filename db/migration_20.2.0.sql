-- =====================================================================
--  Werkstatt — Migration auf 20.2.0: Morgen-Benachrichtigungen (Push)
--
--  Vorher muss gelaufen sein: db/migration_20.1.0.sql
--  (20.0.1 hatte keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Die Migration fügt nur hinzu; die alte App läuft unverändert weiter.
--
--  Was passiert:
--  - push_geraet: Geräte, die Push-Nachrichten bekommen (je Konto
--    beliebig viele; Adresse und Schlüssel liefert der Browser).
--  - push_einstellung: je Konto und Standort Uhrzeit (07:00–12:00 im
--    Viertelstunden-Takt), Wochentage und Kategorien (dringend, bald,
--    bestellen) sowie „alle Tickets“ oder nur meine + nicht übernommene.
--  - sitzung.geraet kennt zusätzlich 'push': kurze Sitzungen (15 Minuten)
--    für den Morgenlauf, damit er genau sieht, was die Person sieht.
--  - Funktionen für die App (über die Sitzung, wie alles andere):
--    push_meine, push_geraet_anmelden, push_geraet_entfernen,
--    push_einstellung_setzen.
--  - Funktionen für den Morgenlauf (nur mit der Neon-Verbindung, nicht
--    über die Data API aufrufbar): push_faellig, push_sitzung,
--    push_erledigt, push_zugestellt, push_aufraeumen.
--  Vorhandene Daten bleiben unverändert.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
--  Tabellen
-- ---------------------------------------------------------------------
create table push_geraet (
  id          bigint generated always as identity primary key,
  konto_id    bigint not null references konto (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) between 20 and 200),
  auth        text not null check (length(auth) between 8 and 100),
  name        text not null default 'Gerät' check (trim(name) <> '' and length(name) <= 60),
  angelegt    timestamptz not null default now(),
  zugestellt  timestamptz,                       -- letzte erfolgreiche Zustellung
  fehler      integer not null default 0         -- Fehlschläge in Folge
);
create index push_geraet_konto on push_geraet (konto_id);

create table push_einstellung (
  konto_id      bigint not null references konto (id) on delete cascade,
  standort_id   bigint not null references standort (id),
  uhrzeit       time not null default '07:30'
                check (uhrzeit between time '07:00' and time '12:00'
                       and extract(minute from uhrzeit)::int % 15 = 0 and extract(second from uhrzeit) = 0),
  tage          integer[] not null default '{1,2,3,4,5}'      -- ISO-Wochentage: 1 = Mo … 7 = So
                check (tage <@ array[1, 2, 3, 4, 5, 6, 7] and cardinality(tage) <= 7),
  dringend      boolean not null default true,     -- „sofort“ und Puffer ≤ 0 Tage
  bald          boolean not null default true,     -- Puffer 1–2 Tage
  bestellen     boolean not null default false,    -- Bestellliste nicht leer (nur Werkstatt-Manager)
  alle_tickets  boolean not null default false,    -- false = meine + noch nicht übernommene
  gesendet_am   date,                              -- Tag (Berlin), für den der Morgenlauf schon gelaufen ist
  geaendert     timestamptz not null default now(),
  primary key (konto_id, standort_id)
);

alter table sitzung drop constraint sitzung_geraet_check;
alter table sitzung add constraint sitzung_geraet_check check (geraet in ('handy', 'werkstatt', 'push'));

alter table push_geraet enable row level security;
alter table push_einstellung enable row level security;

-- ---------------------------------------------------------------------
--  Funktionen für die App
-- ---------------------------------------------------------------------
-- Darf das Konto an diesem Standort Ticket- bzw. Bestell-Nachrichten bekommen?
create or replace function push_darf(p_konto bigint, p_standort bigint, p_was text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_was
           when 'tickets'   then rollen_von(p_konto, p_standort) && array['manager', 'trainer']
           when 'bestellen' then rollen_von(p_konto, p_standort) && array['manager']
           else false end;
$$;

-- Meine Einstellung am gewählten Standort und meine Geräte
create or replace function push_meine() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint := ich_id();
  v_st bigint := akt_standort();
begin
  if v_k is null then
    raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'darf_tickets',   coalesce(push_darf(v_k, v_st, 'tickets'), false),
    'darf_bestellen', coalesce(push_darf(v_k, v_st, 'bestellen'), false),
    'einstellung', (select jsonb_build_object('uhrzeit', to_char(e.uhrzeit, 'HH24:MI'), 'tage', to_jsonb(e.tage),
                                              'dringend', e.dringend, 'bald', e.bald, 'bestellen', e.bestellen,
                                              'alle_tickets', e.alle_tickets, 'gesendet_am', e.gesendet_am)
                      from push_einstellung e where e.konto_id = v_k and e.standort_id = v_st),
    'geraete', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'endpoint', g.endpoint,
                                                             'angelegt', g.angelegt, 'zugestellt', g.zugestellt, 'fehler', g.fehler)
                                          order by g.angelegt)
                           from push_geraet g where g.konto_id = v_k), '[]'::jsonb));
end $$;

-- Dieses Gerät für Push anmelden (oder Schlüssel erneuern). Gehörte die
-- Adresse vorher einem anderen Konto (gemeinsames Gerät), wechselt sie.
-- Gibt es am Standort noch keine Einstellung, wird die Vorgabe angelegt.
create or replace function push_geraet_anmelden(p_endpoint text, p_p256dh text, p_auth text, p_name text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint := ich_id();
  v_st bigint := akt_standort();
  v_id bigint;
begin
  if v_k is null then
    raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000';
  end if;
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  if not push_darf(v_k, v_st, 'tickets') then
    raise exception 'Benachrichtigungen gibt es für Werkstatt-Manager und Trainer/Mechaniker.';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' then raise exception 'Ungültige Push-Adresse vom Browser'; end if;
  insert into push_geraet (konto_id, endpoint, p256dh, auth, name)
  values (v_k, p_endpoint, p_p256dh, p_auth, coalesce(nullif(left(trim(p_name), 60), ''), 'Gerät'))
  on conflict (endpoint) do update
    set konto_id = excluded.konto_id, p256dh = excluded.p256dh, auth = excluded.auth,
        name = excluded.name, fehler = 0
  returning id into v_id;
  -- höchstens 10 Geräte je Konto: die ältesten fallen heraus
  delete from push_geraet where konto_id = v_k and id in (
    select id from push_geraet where konto_id = v_k order by angelegt desc offset 10);
  insert into push_einstellung (konto_id, standort_id, bestellen)
  values (v_k, v_st, push_darf(v_k, v_st, 'bestellen'))
  on conflict do nothing;
  return jsonb_build_object('id', v_id);
end $$;

-- Ein eigenes Gerät abmelden: über die ID (Liste) oder die Adresse (dieses Gerät)
create or replace function push_geraet_entfernen(p_id bigint default null, p_endpoint text default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_k bigint := ich_id();
begin
  if v_k is null then
    raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000';
  end if;
  delete from push_geraet
   where konto_id = v_k and (id = p_id or endpoint = p_endpoint);
end $$;

-- Einstellung am gewählten Standort speichern
create or replace function push_einstellung_setzen(p_uhrzeit text, p_tage integer[], p_dringend boolean, p_bald boolean,
                                                   p_bestellen boolean, p_alle_tickets boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint := ich_id();
  v_st bigint := akt_standort();
  v_t  time;
  v_tage integer[];
begin
  if v_k is null then
    raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000';
  end if;
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  if not push_darf(v_k, v_st, 'tickets') then
    raise exception 'Benachrichtigungen gibt es für Werkstatt-Manager und Trainer/Mechaniker.';
  end if;
  if coalesce(p_bestellen, false) and not push_darf(v_k, v_st, 'bestellen') then
    raise exception '„Bestellen“ können nur Werkstatt-Manager abonnieren.';
  end if;
  if coalesce(p_uhrzeit, '') !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$' then
    raise exception 'Uhrzeit bitte im Viertelstunden-Takt (z. B. 07:30).';
  end if;
  v_t := p_uhrzeit::time;
  if v_t < time '07:00' or v_t > time '12:00' then
    raise exception 'Uhrzeit bitte zwischen 07:00 und 12:00.';
  end if;
  if exists (select 1 from unnest(coalesce(p_tage, '{}')) d where d is null or d not between 1 and 7) then
    raise exception 'Ungültiger Wochentag';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into v_tage from unnest(coalesce(p_tage, '{}')) d;
  insert into push_einstellung (konto_id, standort_id, uhrzeit, tage, dringend, bald, bestellen, alle_tickets)
  values (v_k, v_st, v_t, v_tage, coalesce(p_dringend, false), coalesce(p_bald, false),
          coalesce(p_bestellen, false), coalesce(p_alle_tickets, false))
  on conflict (konto_id, standort_id) do update
    set uhrzeit = excluded.uhrzeit, tage = excluded.tage, dringend = excluded.dringend, bald = excluded.bald,
        bestellen = excluded.bestellen, alle_tickets = excluded.alle_tickets, geaendert = now();
end $$;

-- ---------------------------------------------------------------------
--  Funktionen für den Morgenlauf (.github/workflows/push-morgen.yml)
--  Nur für den Besitzer der Datenbank (Neon-Verbindung), nicht für die App.
-- ---------------------------------------------------------------------
-- Wer ist jetzt dran? Uhrzeit erreicht, heute ein gewählter Tag, heute
-- noch nicht gelaufen, mindestens ein Gerät und eine erlaubte Kategorie.
-- p_jetzt nur zum Testen; sonst gilt die aktuelle Zeit in Berlin.
create or replace function push_faellig(p_jetzt timestamp default null)
returns table (konto_id bigint, konto_name text, standort_id bigint, standort_name text, mehrere boolean,
               dringend boolean, bald boolean, bestellen boolean, alle_tickets boolean, tag date, geraete jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with jetzt as (select coalesce(p_jetzt, (now() at time zone 'Europe/Berlin')::timestamp(0)) as t),
  e as (
    select e.*, k.name as k_name, st.name as st_name,
           e.dringend and push_darf(e.konto_id, e.standort_id, 'tickets')   as d_ok,
           e.bald and push_darf(e.konto_id, e.standort_id, 'tickets')       as b_ok,
           e.bestellen and push_darf(e.konto_id, e.standort_id, 'bestellen') as be_ok
      from push_einstellung e
      join konto k on k.id = e.konto_id and k.aktiv
      join standort st on st.id = e.standort_id and st.aktiv
  ),
  aktiv as (select * from e where (d_ok or b_ok or be_ok)
                              and exists (select 1 from push_geraet g where g.konto_id = e.konto_id))
  select a.konto_id, a.k_name, a.standort_id, a.st_name,
         (select count(*) from aktiv x where x.konto_id = a.konto_id) > 1,
         a.d_ok, a.b_ok, a.be_ok, a.alle_tickets, j.t::date,
         (select jsonb_agg(jsonb_build_object('id', g.id, 'endpoint', g.endpoint, 'p256dh', g.p256dh, 'auth', g.auth))
            from push_geraet g where g.konto_id = a.konto_id)
    from aktiv a, jetzt j
   where extract(isodow from j.t)::int = any (a.tage)
     and a.uhrzeit <= j.t::time
     and (a.gesendet_am is null or a.gesendet_am < j.t::date)
   order by a.konto_id, a.standort_id;
$$;

-- Kurze Sitzung (15 Minuten) für den Morgenlauf; gibt den Schlüssel zurück.
create or replace function push_sitzung(p_konto bigint) returns text
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into sitzung (token_hash, konto_id, gueltig_bis, geraet)
  values (token_hash(t), p_konto, now() + interval '15 minutes', 'push');
  return t;
end $$;

-- Für diesen Tag erledigt (auch wenn nichts anstand: dann kommt heute nichts mehr)
create or replace function push_erledigt(p_konto bigint, p_standort bigint, p_tag date) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update push_einstellung set gesendet_am = p_tag where konto_id = p_konto and standort_id = p_standort;
$$;

-- Ergebnis einer Zustellung: ok, oder Gerät abgemeldet (weg) → löschen,
-- sonst Fehler zählen (nach 10 Fehlschlägen in Folge wird das Gerät gelöscht).
create or replace function push_zugestellt(p_geraet bigint, p_ok boolean, p_weg boolean default false) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if p_ok then
    update push_geraet set zugestellt = now(), fehler = 0 where id = p_geraet;
  elsif p_weg then
    delete from push_geraet where id = p_geraet;
  else
    update push_geraet set fehler = fehler + 1 where id = p_geraet;
    delete from push_geraet where id = p_geraet and fehler >= 10;
  end if;
end $$;

-- Sitzungen des Morgenlaufs wieder entfernen
create or replace function push_aufraeumen() returns integer
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  delete from sitzung where geraet = 'push';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
--  Rechte
-- ---------------------------------------------------------------------
revoke all on push_geraet, push_einstellung from anonymous;
revoke execute on function push_darf(bigint, bigint, text), push_meine(), push_geraet_anmelden(text, text, text, text),
                           push_geraet_entfernen(bigint, text), push_einstellung_setzen(text, integer[], boolean, boolean, boolean, boolean),
                           push_faellig(timestamp), push_sitzung(bigint), push_erledigt(bigint, bigint, date),
                           push_zugestellt(bigint, boolean, boolean), push_aufraeumen()
  from public, anonymous;
grant execute on function push_meine(), push_geraet_anmelden(text, text, text, text), push_geraet_entfernen(bigint, text),
                          push_einstellung_setzen(text, integer[], boolean, boolean, boolean, boolean)
  to anonymous;

commit;
