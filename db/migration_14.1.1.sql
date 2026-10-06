-- =====================================================================
--  Werkstatt — Migration auf 14.1.1: Anmeldung absichern, Fehlerkorrekturen
--
--  Vorher muss gelaufen sein: db/migration_14.1.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - Anmeldung: Die dritte Sperre innerhalb von 24 Stunden sperrt das
--    Konto 24 Stunden (bisher immer nur 15 Minuten). „Neuer Code“ des
--    Managers hebt jede Sperre auf.
--  - Deaktivierte Sportler kommen nicht mehr hinein; beim Deaktivieren
--    werden ihre Geräte abgemeldet.
--  - Umbenannte Sportler: der Anmeldename des Kontos folgt dem Sportler.
--  - Trainer → Manager/Geschäftsstelle: die alte (kürzere) PIN gilt nicht
--    mehr, konto_aendern gibt dann einen neuen Einladungscode zurück.
--  - Pauschalen können nur noch Verbrauch vom eigenen Standort abziehen.
--  Keine Tabellen oder Spalten. Daten: Anmeldenamen der Sportler-Konten
--  werden an die Sportlernamen angeglichen, Sitzungen deaktivierter
--  Sportler gelöscht. Hinweise erscheinen als NOTICE im Ergebnis.
--  Lässt sich gefahrlos ein zweites Mal ausführen.
-- =====================================================================

begin;

-- konto_aendern gibt jetzt einen Wert zurück (neuer Code oder null)
drop function if exists konto_aendern(bigint, text, text, boolean);

create or replace function sitzung_erzeugen(p_konto bigint, p_geraet text, p_bleiben boolean) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  t      text := encode(gen_random_bytes(32), 'hex');
  v_bis  timestamptz;
  v_g    text := case when p_geraet = 'werkstatt' then 'werkstatt' else 'handy' end;
begin
  delete from sitzung where gueltig_bis < now();
  if v_g = 'werkstatt' then
    -- Werkstatt-Laptop: alle werden um 23 Uhr ausgetragen
    v_bis := ((now() at time zone 'Europe/Berlin')::date + time '23:00') at time zone 'Europe/Berlin';
    if v_bis <= now() + interval '10 minutes' then v_bis := v_bis + interval '1 day'; end if;
  elsif coalesce(p_bleiben, true) then
    v_bis := now() + interval '90 days';
  else
    v_bis := now() + interval '12 hours';
  end if;
  insert into sitzung (token_hash, konto_id, gueltig_bis, geraet) values (token_hash(t), p_konto, v_bis, v_g);
  update konto set zuletzt = now(), fehlversuche = 0, gesperrt_bis = null where id = p_konto;
  -- Erfolgreich angemeldet: frühere Sperren zählen nicht mehr
  delete from fehlversuch where art = 'sperre:' || p_konto;
  return jsonb_build_object('token', t, 'gueltig_bis', v_bis);
end $$;

-- Fehler kommen als {ok:false, fehler:…} zurück (nicht als Abbruch),
-- damit gezählte Fehlversuche gespeichert bleiben.
-- Sperre: 5 falsche PINs → 15 Minuten; die dritte Sperre innerhalb von
-- 24 Stunden → 24 Stunden (Werkstatt-Manager hebt sie mit „neuer Code“ auf).
-- Sportler-Konten, deren Sportler deaktiviert ist, kommen nicht hinein.
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
      'Zu viele Fehlversuche – wieder möglich ab '
      || to_char(k.gesperrt_bis at time zone 'Europe/Berlin',
                 case when k.gesperrt_bis > now() + interval '1 hour' then 'DD.MM. HH24:MI' else 'HH24:MI' end)
      || ' Uhr. Der Werkstatt-Manager kann mit „neuer Code“ sofort entsperren.');
  end if;
  if k.pin_hash is null then
    return jsonb_build_object('ok', false, 'fehler', 'Noch keine PIN gesetzt – bitte mit dem Einladungscode anmelden.');
  end if;
  if crypt(coalesce(p_pin, ''), k.pin_hash) <> k.pin_hash then
    update konto set fehlversuche = fehlversuche + 1 where id = k.id returning fehlversuche into n;
    if n >= 5 then
      delete from fehlversuch where zeit < now() - interval '1 day';
      insert into fehlversuch (art) values ('sperre:' || k.id);
      select count(*) into n from fehlversuch where art = 'sperre:' || k.id and zeit > now() - interval '24 hours';
      if n >= 3 then
        update konto set fehlversuche = 0, gesperrt_bis = now() + interval '24 hours' where id = k.id;
        return jsonb_build_object('ok', false, 'fehler',
          'PIN falsch – das Konto ist jetzt 24 Stunden gesperrt. Der Werkstatt-Manager kann mit „neuer Code“ sofort entsperren.');
      end if;
      update konto set fehlversuche = 0, gesperrt_bis = now() + interval '15 minutes' where id = k.id;
      return jsonb_build_object('ok', false, 'fehler', 'PIN falsch – das Konto ist jetzt 15 Minuten gesperrt.');
    end if;
    return jsonb_build_object('ok', false, 'fehler',
      'Name oder PIN falsch (noch ' || (5 - n) || case when 5 - n = 1 then ' Versuch).' else ' Versuche).' end);
  end if;
  if k.sportler_id is not null and not exists (select 1 from sportler sp where sp.id = k.sportler_id and sp.aktiv) then
    return jsonb_build_object('ok', false, 'fehler', 'Der Zugang ist deaktiviert – bitte den Werkstatt-Manager fragen.');
  end if;

  v_s := sitzung_erzeugen(k.id, p_geraet, p_bleiben);
  return jsonb_build_object('ok', true) || v_s || jsonb_build_object('konto', konto_info(k.id));
end $$;

-- Vor dem PIN-Setzen: zu wem gehört der Code?
create or replace function einladung_pruefen(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint;
begin
  if zu_viele_versuche() then
    return jsonb_build_object('ok', false, 'fehler', 'Zu viele Versuche – bitte in ein paar Minuten noch einmal.');
  end if;
  select e.konto_id into v_k
    from einladung e join konto k on k.id = e.konto_id
   where e.code_hash = code_hash(p_code) and e.gueltig_bis > now() and k.aktiv
     and (k.sportler_id is null or exists (select 1 from sportler sp where sp.id = k.sportler_id and sp.aktiv));
  if v_k is null then
    perform fehlversuch_merken('code');
    return jsonb_build_object('ok', false, 'fehler', 'Code ungültig oder abgelaufen.');
  end if;
  return jsonb_build_object('ok', true, 'name', (select name from konto where id = v_k), 'pin_laenge', pin_laenge(v_k));
end $$;

create or replace function einladung_einloesen(p_code text, p_pin text, p_geraet text default 'handy', p_bleiben boolean default true)
returns jsonb
language plpgsql volatile security definer set search_path = public, extensions, pg_temp as $$
declare
  v_k  bigint;
  v_f  text;
  v_s  jsonb;
begin
  if zu_viele_versuche() then
    return jsonb_build_object('ok', false, 'fehler', 'Zu viele Versuche – bitte in ein paar Minuten noch einmal.');
  end if;
  select e.konto_id into v_k
    from einladung e join konto k on k.id = e.konto_id
   where e.code_hash = code_hash(p_code) and e.gueltig_bis > now() and k.aktiv
     and (k.sportler_id is null or exists (select 1 from sportler sp where sp.id = k.sportler_id and sp.aktiv));
  if v_k is null then
    perform fehlversuch_merken('code');
    return jsonb_build_object('ok', false, 'fehler', 'Code ungültig oder abgelaufen.');
  end if;
  v_f := pin_fehler(v_k, p_pin);
  if v_f is not null then return jsonb_build_object('ok', false, 'fehler', v_f); end if;

  update konto set pin_hash = crypt(p_pin, gen_salt('bf', 8)), fehlversuche = 0, gesperrt_bis = null where id = v_k;
  delete from einladung where konto_id = v_k;
  delete from sitzung where konto_id = v_k;
  v_s := sitzung_erzeugen(v_k, p_geraet, p_bleiben);
  return jsonb_build_object('ok', true) || v_s || jsonb_build_object('konto', konto_info(v_k));
end $$;

-- Name, Rolle, aktiv ändern. Wird jemand mit gesetzter PIN vom Trainer zum
-- Manager oder zur Geschäftsstelle (dort 6 Ziffern), gilt die alte PIN nicht
-- mehr: Rückgabe ist dann ein neuer Einladungscode, sonst null.
create or replace function konto_aendern(p_konto bigint, p_name text default null, p_rolle text default null, p_aktiv boolean default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_manager();
  v_r   text   := konto_verwaltbar(p_konto);
  v_neu jsonb;
begin
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'Name fehlt'; end if;
    if name_vergeben(v_st, p_name, p_konto) then raise exception 'Den Namen gibt es an diesem Standort schon'; end if;
    update konto set name = trim(p_name) where id = p_konto;
  end if;
  if p_rolle is not null and p_rolle <> v_r then
    if p_rolle not in ('manager', 'trainer', 'geschaeftsstelle') or v_r = 'sportler' then
      raise exception 'Diese Rolle lässt sich nicht ändern';
    end if;
    if p_rolle = 'manager' and not ist_admin() then raise exception 'Werkstatt-Manager ernennt nur der Gesamt-Admin'; end if;
    update konto_rolle set rolle = p_rolle where konto_id = p_konto and standort_id = v_st;
    if v_r = 'trainer' and p_rolle in ('manager', 'geschaeftsstelle')
       and exists (select 1 from konto where id = p_konto and pin_hash is not null) then
      update konto set pin_hash = null, fehlversuche = 0, gesperrt_bis = null where id = p_konto;
      delete from sitzung where konto_id = p_konto;
      v_neu := jsonb_build_object('konto_id', p_konto, 'name', (select name from konto where id = p_konto)) || einladung_erzeugen(p_konto);
    end if;
  end if;
  if p_aktiv is not null then
    update konto set aktiv = p_aktiv where id = p_konto;
    if not p_aktiv then delete from sitzung where konto_id = p_konto; end if;
  end if;
  return v_neu;
end $$;

-- „Zugang einladen“ auf der Sportler-Seite: neues Konto oder neuer Code.
create or replace function sportler_zugang(p_sportler bigint) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_manager();
  v_k   bigint;
begin
  if not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then raise exception 'Unbekannter Sportler'; end if;
  if not exists (select 1 from sportler where id = p_sportler and aktiv) then
    raise exception 'Der Sportler ist deaktiviert – erst wieder aktivieren';
  end if;
  select id into v_k from konto where sportler_id = p_sportler;
  if v_k is null then return konto_anlegen(null, 'sportler', p_sportler); end if;
  update konto set aktiv = true where id = v_k;
  return konto_neuer_code(v_k);
end $$;

-- Material ausgeben — mit oder ohne Ticket. Preis wird festgeschrieben;
-- Pauschalen ziehen zusätzlich ihren hinterlegten Verbrauch ab (nur einen
-- Artikel desselben Standorts).
create or replace function material_ausgeben(
  p_code text, p_menge numeric, p_ort text default 'Werkstatt',
  p_sportler bigint default null, p_ticket bigint default null, p_notiz text default null,
  p_bearbeiter text default null
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

  insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
  values ('entnahme', p_code, -p_menge, p_ort, p_sportler, p_ticket, a.preis, coalesce(v_abr, false), p_notiz, p_bearbeiter, v_grp, v_st);

  if v_grp is not null then
    insert into buchung (art, code, menge, ort, sportler_id, ticket_id, einzelpreis, abrechnen, notiz, bearbeiter, gruppe, standort_id)
    values ('entnahme', a.verbraucht_code, -(a.verbrauch_menge * p_menge), p_ort,
            p_sportler, p_ticket, 0, false, 'Verbrauch aus ' || p_code, p_bearbeiter, v_grp, v_st);
  end if;

  return a.preis * p_menge;
end $$;

-- Verbrauch einer Pauschale: nur ein Artikel desselben Standorts.
create or replace function verbrauch_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.verbraucht_code is not null
     and (tg_op = 'INSERT' or new.verbraucht_code is distinct from old.verbraucht_code
          or new.standort_id is distinct from old.standort_id)
     and not exists (select 1 from artikel v where v.code = new.verbraucht_code and v.standort_id = new.standort_id) then
    raise exception 'Unbekannter Verbrauchsartikel: %', new.verbraucht_code;
  end if;
  return new;
end $$;

-- Sportler umbenannt → Anmeldename seines Kontos folgt.
-- Sportler deaktiviert → seine Geräte werden abgemeldet.
create or replace function sportler_konto_abgleich() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_k  bigint;
begin
  select id into v_k from konto where sportler_id = new.id;
  if v_k is null then return null; end if;
  if new.name is distinct from old.name then
    if name_vergeben(new.standort_id, new.name, v_k) then
      raise exception 'Den Namen % hat schon ein Konto an diesem Standort – bitte etwas anders schreiben', new.name;
    end if;
    update konto set name = trim(new.name) where id = v_k;
  end if;
  if old.aktiv and not new.aktiv then
    delete from sitzung where konto_id = v_k;
  end if;
  return null;
end $$;

drop trigger if exists artikel_verbrauch on artikel;
drop trigger if exists sportler_konto on sportler;
create trigger artikel_verbrauch     before insert or update on artikel for each row execute function verbrauch_pruefen();
create trigger sportler_konto        after update on sportler    for each row execute function sportler_konto_abgleich();

-- Bestehende Daten angleichen
do $$
declare
  r record;
begin
  -- Anmeldenamen der Sportler-Konten = Sportlername (wo das ohne Doppelung geht)
  for r in select k.id, k.name as alt, s.name as neu, s.standort_id
             from konto k join sportler s on s.id = k.sportler_id
            where k.name is distinct from trim(s.name) loop
    if name_vergeben(r.standort_id, r.neu, r.id) then
      raise notice 'Sportler-Konto „%“ nicht umbenannt: den Namen „%“ gibt es schon.', r.alt, r.neu;
    else
      update konto set name = trim(r.neu) where id = r.id;
      raise notice 'Sportler-Konto „%“ heißt jetzt „%“.', r.alt, r.neu;
    end if;
  end loop;
  -- Deaktivierte Sportler abmelden
  delete from sitzung where konto_id in (select k.id from konto k join sportler s on s.id = k.sportler_id where not s.aktiv);
  -- Pauschalen mit Verbrauch eines anderen Standorts nur melden (bitte in der App korrigieren)
  for r in select a.code, a.verbraucht_code from artikel a
            where a.verbraucht_code is not null
              and not exists (select 1 from artikel v where v.code = a.verbraucht_code and v.standort_id = a.standort_id) loop
    raise notice 'Artikel % zieht Verbrauch von % ab (anderer Standort) – bitte korrigieren.', r.code, r.verbraucht_code;
  end loop;
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
