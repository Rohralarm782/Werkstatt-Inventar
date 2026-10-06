-- =====================================================================
--  Werkstatt — Migration auf 14.1.0: Gesamt-Admin ohne Zugriff auf fremde
--  Standorte
--
--  Vorher muss gelaufen sein: db/migration_14.0.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Der Gesamt-Admin sieht und ändert nur noch Daten der Standorte, an
--    denen er eine Rolle hat (Schwerin: Werkstatt-Manager). Andere
--    Standorte kann er weder öffnen noch sich dort anmelden.
--  - Neu: standorte_verwaltung (Liste aller Standorte mit ihren Managern,
--    ohne deren Daten), standort_manager_einladen, manager_neuer_code,
--    manager_aktiv — damit verwaltet der Gesamt-Admin die Manager anderer
--    Standorte von außen.
--  Keine Tabellen- oder Datenänderung; nur Funktionen und Rechte.
-- =====================================================================

begin;

-- Der Standort aus X-Standort — nur, wenn das Konto dort eine Rolle hat.
-- Auch der Gesamt-Admin kommt nur in Standorte, in denen er eine Rolle hat;
-- die anderen verwaltet er über standorte_verwaltung, ohne ihre Daten zu sehen.
create or replace function akt_standort() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select st.id
    from standort st
   where st.aktiv
     and st.id = (select case when kopfzeile('x-standort') ~ '^[0-9]{1,18}$' then kopfzeile('x-standort')::bigint end)
     and exists (select 1 from konto_rolle r where r.konto_id = ich_id() and r.standort_id = st.id);
$$;

-- manager | trainer | geschaeftsstelle | sportler | null (Rolle am gewählten Standort)
create or replace function meine_rolle() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when akt_standort() is null then null
           else (select r.rolle from konto_rolle r where r.konto_id = ich_id() and r.standort_id = akt_standort())
         end;
$$;

-- Was die App über ein Konto wissen muss
create or replace function konto_info(p_konto bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'konto_id', k.id, 'name', k.name, 'gesamt_admin', k.gesamt_admin, 'sportler_id', k.sportler_id,
           'pin_laenge', pin_laenge(k.id),
           'standorte', coalesce((
             select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'kuerzel', st.kuerzel,
                                                 'rolle', r.rolle) order by st.name)
               from standort st
               join konto_rolle r on r.standort_id = st.id and r.konto_id = k.id
              where st.aktiv and r.konto_id is not null), '[]'::jsonb))
    from konto k where k.id = p_konto;
$$;

-- Fehler kommen als {ok:false, fehler:…} zurück (nicht als Abbruch),
-- damit gezählte Fehlversuche gespeichert bleiben.
create or replace function anmelden(p_standort bigint, p_pin text, p_konto bigint default null, p_name text default null,
                                    p_geraet text default 'handy', p_bleiben boolean default true)
returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  k       konto;
  n       integer;
  v_s     jsonb;
begin
  if p_konto is not null then
    select * into k from konto where id = p_konto and aktiv;
  else
    select count(*) into n
      from konto x
     where x.aktiv and lower(trim(x.name)) = lower(trim(coalesce(p_name, '')))
       and exists (select 1 from konto_rolle r where r.konto_id = x.id and r.standort_id = p_standort);
    if n > 1 then
      return jsonb_build_object('ok', false, 'fehler', 'Den Namen gibt es mehrfach – bitte den Werkstatt-Manager fragen.');
    end if;
    select * into k
      from konto x
     where x.aktiv and lower(trim(x.name)) = lower(trim(coalesce(p_name, '')))
       and exists (select 1 from konto_rolle r where r.konto_id = x.id and r.standort_id = p_standort);
  end if;

  if k.id is null
     or not exists (select 1 from konto_rolle r where r.konto_id = k.id and r.standort_id = p_standort) then
    return jsonb_build_object('ok', false, 'fehler', 'Name oder PIN falsch.');
  end if;
  if k.gesperrt_bis is not null and k.gesperrt_bis > now() then
    return jsonb_build_object('ok', false, 'fehler',
      'Zu viele Fehlversuche – wieder möglich ab ' || to_char(k.gesperrt_bis at time zone 'Europe/Berlin', 'HH24:MI') || ' Uhr.');
  end if;
  if k.pin_hash is null then
    return jsonb_build_object('ok', false, 'fehler', 'Noch keine PIN gesetzt – bitte mit dem Einladungscode anmelden.');
  end if;
  if crypt(coalesce(p_pin, ''), k.pin_hash) <> k.pin_hash then
    update konto set fehlversuche = fehlversuche + 1 where id = k.id returning fehlversuche into n;
    if n >= 5 then
      update konto set fehlversuche = 0, gesperrt_bis = now() + interval '15 minutes' where id = k.id;
      return jsonb_build_object('ok', false, 'fehler', 'PIN falsch – das Konto ist jetzt 15 Minuten gesperrt.');
    end if;
    return jsonb_build_object('ok', false, 'fehler', 'Name oder PIN falsch (noch ' || (5 - n) || ' Versuche).');
  end if;

  v_s := sitzung_erzeugen(k.id, p_geraet, p_bleiben);
  return jsonb_build_object('ok', true) || v_s || jsonb_build_object('konto', konto_info(k.id));
end $$;

-- Übersicht aller Standorte für den Gesamt-Admin: nur Name, Kürzel und die
-- Werkstatt-Manager — keine Daten der Standorte.
create or replace function standorte_verwaltung() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if not ist_admin() then raise exception 'Nur für den Gesamt-Admin'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', st.id, 'name', st.name, 'kuerzel', st.kuerzel, 'angelegt', st.angelegt,
             'meine_rolle', (select r.rolle from konto_rolle r where r.konto_id = ich_id() and r.standort_id = st.id),
             'manager', coalesce((
               select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'aktiv', k.aktiv,
                                                   'pin_gesetzt', k.pin_hash is not null, 'einladung_bis', e.gueltig_bis,
                                                   'zuletzt', k.zuletzt, 'gesperrt', coalesce(k.gesperrt_bis > now(), false))
                                order by lower(k.name))
                 from konto k
                 join konto_rolle r on r.konto_id = k.id and r.standort_id = st.id and r.rolle = 'manager'
                 left join einladung e on e.konto_id = k.id
                where not k.gesamt_admin), '[]'::jsonb))
           order by st.name)
      from standort st where st.aktiv), '[]'::jsonb);
end $$;

-- Gesamt-Admin lädt einen Werkstatt-Manager für einen Standort ein,
-- ohne selbst Zugriff auf den Standort zu haben.
create or replace function standort_manager_einladen(p_standort bigint, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_name  text := trim(coalesce(p_name, ''));
  v_id    bigint;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if not ist_admin() then raise exception 'Nur für den Gesamt-Admin'; end if;
  if not exists (select 1 from standort where id = p_standort and aktiv) then raise exception 'Unbekannter Standort'; end if;
  if v_name = '' then raise exception 'Name fehlt'; end if;
  if name_vergeben(p_standort, v_name) then raise exception 'Den Namen gibt es an diesem Standort schon'; end if;
  insert into konto (name) values (v_name) returning id into v_id;
  insert into konto_rolle (konto_id, standort_id, rolle) values (v_id, p_standort, 'manager');
  return jsonb_build_object('konto_id', v_id, 'name', v_name) || einladung_erzeugen(v_id);
end $$;

-- Werkstatt-Manager eines beliebigen Standorts: neuer Code (PIN vergessen)
-- oder (de)aktivieren — nur Gesamt-Admin.
create or replace function manager_pruefen(p_konto bigint) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  if not ist_admin() then raise exception 'Nur für den Gesamt-Admin'; end if;
  if not exists (select 1 from konto k join konto_rolle r on r.konto_id = k.id
                  where k.id = p_konto and r.rolle = 'manager' and not k.gesamt_admin) then
    raise exception 'Kein Werkstatt-Manager';
  end if;
end $$;

create or replace function manager_neuer_code(p_konto bigint) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform manager_pruefen(p_konto);
  update konto set pin_hash = null, fehlversuche = 0, gesperrt_bis = null, aktiv = true where id = p_konto;
  delete from sitzung where konto_id = p_konto;
  return jsonb_build_object('konto_id', p_konto, 'name', (select name from konto where id = p_konto)) || einladung_erzeugen(p_konto);
end $$;

create or replace function manager_aktiv(p_konto bigint, p_aktiv boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform manager_pruefen(p_konto);
  update konto set aktiv = coalesce(p_aktiv, true) where id = p_konto;
  if not coalesce(p_aktiv, true) then delete from sitzung where konto_id = p_konto; end if;
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
