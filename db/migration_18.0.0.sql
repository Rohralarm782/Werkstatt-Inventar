-- =====================================================================
--  Werkstatt — Migration auf 18.0.0: mehrere Rollen je Konto,
--  Trainer/Mechaniker dürfen neue Kategorien und Tags anlegen
--
--  Vorher muss gelaufen sein: db/migration_16.0.0.sql
--  (17.x hatte keine Datenbankänderung.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Empfehlung: vorher auf einem Neon-Branch testen.
--
--  Was passiert:
--  - konto_rolle: Primärschlüssel jetzt (Konto, Standort, Rolle) — ein
--    Konto kann an einem Standort mehrere Rollen haben, z. B.
--    Trainer/Mechaniker + Sportler. Rechte = Summe aller Rollen.
--    Vorhandene Rollen bleiben unverändert (je Konto und Standort eine).
--  - Neue Funktionen rollen_von, meine_rollen, rollen_normal,
--    nur_sportler_deaktiviert und konto_rollen (Rollen eines Kontos setzen).
--  - meine_rolle liefert die Hauptrolle (die stärkste), rolle_in prüft
--    alle Rollen, mein_sportler gilt für jedes Konto mit Rolle Sportler.
--  - konto_info, ich, anmelde_liste, konten_liste liefern zusätzlich
--    „rollen“ (Liste); „rolle“ bleibt die Hauptrolle.
--  - konto_anlegen nimmt zusätzlich p_rollen (Liste). Die alte Fassung
--    mit drei Angaben wird entfernt.
--  - Anmelden: ein deaktivierter Sportler sperrt das Konto nur noch, wenn
--    es keine andere Rolle hat.
--  - ticket_anlegen, foto_hochladen, standorte_verwaltung, konto_aendern,
--    konto_verwaltbar an mehrere Rollen angepasst.
--  - Zugriffsregeln: Trainer/Mechaniker dürfen neue Kategorien und Tags
--    anlegen (umbenennen, löschen weiter nur Werkstatt-Manager).
--  Hinweise wie „… does not exist, skipping“ sind harmlos.
--  Lässt sich gefahrlos ein zweites Mal ausführen.
-- =====================================================================

begin;

-- 1. Mehrere Rollen je Konto und Standort
do $$
begin
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'konto_rolle'::regclass and c.contype = 'p'
                and array_length(c.conkey, 1) = 2) then
    alter table konto_rolle drop constraint konto_rolle_pkey;
    alter table konto_rolle add constraint konto_rolle_pkey primary key (konto_id, standort_id, rolle);
  end if;
end $$;

-- 2. Alte Fassung von konto_anlegen entfernen (neue hat p_rollen)
drop function if exists konto_anlegen(text, text, bigint);

-- 3. Funktionen
-- Rollen eines Kontos an einem Standort, die stärkste zuerst
-- (manager, trainer, geschaeftsstelle, sportler); leer = keine.
create or replace function rollen_von(p_konto bigint, p_standort bigint) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(r.rolle order by array_position(array['manager', 'trainer', 'geschaeftsstelle', 'sportler'], r.rolle)),
                  '{}'::text[])
    from konto_rolle r where r.konto_id = p_konto and r.standort_id = p_standort;
$$;

-- Meine Rollen am gewählten Standort (leer, wenn kein Standort).
create or replace function meine_rollen() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when akt_standort() is null then '{}'::text[] else rollen_von(ich_id(), akt_standort()) end;
$$;

-- Hauptrolle (die stärkste) am gewählten Standort:
-- manager | trainer | geschaeftsstelle | sportler | null
create or replace function meine_rolle() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select (meine_rollen())[1];
$$;

-- Hat das Konto hier mindestens eine dieser Rollen? (Rechte = Summe aller Rollen)
create or replace function rolle_in(variadic p_rollen text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(meine_rollen() && p_rollen, false);
$$;

-- Der Sportler hinter dem Konto, wenn es hier die Rolle Sportler hat (sonst null).
create or replace function mein_sportler() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select k.sportler_id from konto k where k.id = ich_id() and 'sportler' = any (meine_rollen());
$$;

-- Was die App über ein Konto wissen muss
create or replace function konto_info(p_konto bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'konto_id', k.id, 'name', k.name, 'gesamt_admin', k.gesamt_admin, 'sportler_id', k.sportler_id,
           'pin_laenge', pin_laenge(k.id),
           'standorte', coalesce((
             select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'kuerzel', st.kuerzel,
                                                 'rolle', x.rollen[1], 'rollen', to_jsonb(x.rollen)) order by st.name)
               from standort st
               cross join lateral (select rollen_von(k.id, st.id) as rollen) x
              where st.aktiv and cardinality(x.rollen) > 0), '[]'::jsonb))
    from konto k where k.id = p_konto;
$$;

-- Sportler-Konto ohne andere Rolle, dessen Sportler deaktiviert ist:
-- kommt nicht hinein. (Hat es noch eine andere Rolle, darf es weiter.)
create or replace function nur_sportler_deaktiviert(p_konto bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from konto k join sportler sp on sp.id = k.sportler_id
                  where k.id = p_konto and not sp.aktiv)
     and not exists (select 1 from konto_rolle r where r.konto_id = p_konto and r.rolle <> 'sportler');
$$;

-- Kacheln am Anmeldebildschirm: Manager, Trainer, Geschäftsstelle mit PIN.
-- Sportler stehen nicht in der Liste, sie tippen ihren Namen ein.
create or replace function anmelde_liste(p_standort bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'rolle', x.rollen[1], 'rollen', to_jsonb(x.rollen))
                            order by array_position(array['manager', 'trainer', 'geschaeftsstelle'], x.rollen[1]), lower(k.name)), '[]'::jsonb)
    from konto k
    cross join lateral (select rollen_von(k.id, p_standort) as rollen) x
   where k.aktiv and k.pin_hash is not null and x.rollen && array['manager', 'trainer', 'geschaeftsstelle'];
$$;

-- Fehler kommen als {ok:false, fehler:…} zurück (nicht als Abbruch),
-- damit gezählte Fehlversuche gespeichert bleiben.
-- Sperre: 5 falsche PINs → 15 Minuten; die dritte Sperre innerhalb von
-- 24 Stunden → 24 Stunden (Werkstatt-Manager hebt sie mit „neuer Code“ auf).
-- Sportler-Konten, deren Sportler deaktiviert ist, kommen nicht hinein
-- (außer sie haben noch eine andere Rolle).
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
  if nur_sportler_deaktiviert(k.id) then
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
     and not nur_sportler_deaktiviert(k.id);
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
     and not nur_sportler_deaktiviert(k.id);
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

-- Mit Sitzung: wer bin ich, wo bin ich?
create or replace function ich() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when ich_id() is null then null
              else konto_info(ich_id()) || jsonb_build_object('rolle', meine_rolle(), 'rollen', to_jsonb(meine_rollen()),
                                                              'standort_id', akt_standort()) end;
$$;

-- ---------------------------------------------------------------------
--  Konten verwalten (Werkstatt-Manager, Gesamt-Admin)
-- ---------------------------------------------------------------------
create or replace function konten_liste() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_manager();
begin
  return coalesce((
    select jsonb_agg(z order by array_position(array['admin', 'manager', 'trainer', 'geschaeftsstelle', 'sportler'], z ->> 'rolle'),
                                lower(z ->> 'name'))
      from (
        select jsonb_build_object('id', k.id, 'name', k.name, 'rolle', x.rollen[1], 'rollen', to_jsonb(x.rollen), 'aktiv', k.aktiv,
                                  'pin_gesetzt', k.pin_hash is not null, 'einladung_bis', e.gueltig_bis,
                                  'zuletzt', k.zuletzt, 'sportler_id', k.sportler_id,
                                  'gesperrt', coalesce(k.gesperrt_bis > now(), false)) as z
          from konto k
          cross join lateral (select rollen_von(k.id, v_st) as rollen) x
          left join einladung e on e.konto_id = k.id
         where not k.gesamt_admin and cardinality(x.rollen) > 0
        union all
        select jsonb_build_object('id', k.id, 'name', k.name, 'rolle', 'admin', 'rollen', '["admin"]'::jsonb, 'aktiv', k.aktiv,
                                  'pin_gesetzt', k.pin_hash is not null, 'einladung_bis', e.gueltig_bis,
                                  'zuletzt', k.zuletzt, 'sportler_id', null, 'gesperrt', coalesce(k.gesperrt_bis > now(), false))
          from konto k
          left join einladung e on e.konto_id = k.id
         where k.gesamt_admin
      ) x), '[]'::jsonb);
end $$;

-- Rollenliste bereinigen: ohne Leere und Doppelte, stärkste zuerst; unbekannte → Abbruch.
create or replace function rollen_normal(p_rollen text[]) returns text[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v  text[];
  x  text;
begin
  select coalesce(array_agg(r order by array_position(array['manager', 'trainer', 'geschaeftsstelle', 'sportler'], r)), '{}')
    into v
    from (select distinct trim(y) as r from unnest(coalesce(p_rollen, '{}')) y where nullif(trim(y), '') is not null) z;
  foreach x in array v loop
    if x not in ('manager', 'trainer', 'geschaeftsstelle', 'sportler') then raise exception 'Unbekannte Rolle: %', x; end if;
  end loop;
  if cardinality(v) = 0 then raise exception 'Mindestens eine Rolle wählen'; end if;
  return v;
end $$;

-- Neues Konto mit einer Rolle (p_rolle) oder mehreren (p_rollen, ab 18.0.0).
-- Mit Rolle Sportler braucht es den Sportler (p_sportler).
create or replace function konto_anlegen(p_name text, p_rolle text, p_sportler bigint default null, p_rollen text[] default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st     bigint := recht_manager();
  v_name   text   := trim(coalesce(p_name, ''));
  v_rollen text[] := rollen_normal(coalesce(p_rollen, array[p_rolle]));
  v_id     bigint;
begin
  if 'manager' = any (v_rollen) and not ist_admin() then
    raise exception 'Werkstatt-Manager lädt nur der Gesamt-Admin ein';
  end if;
  if 'sportler' = any (v_rollen) then
    if p_sportler is null then raise exception 'Sportler fehlt'; end if;
    if not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then raise exception 'Unbekannter Sportler'; end if;
    if v_name = '' then select name into v_name from sportler where id = p_sportler and standort_id = v_st; end if;
    if exists (select 1 from konto where sportler_id = p_sportler) then
      raise exception 'Hat schon einen Zugang – dort „neuer Code“ wählen';
    end if;
  else
    p_sportler := null;
  end if;
  if v_name = '' then raise exception 'Name fehlt'; end if;
  if name_vergeben(v_st, v_name) then raise exception 'Den Namen gibt es an diesem Standort schon'; end if;

  insert into konto (name, sportler_id) values (v_name, p_sportler) returning id into v_id;
  insert into konto_rolle (konto_id, standort_id, rolle) select v_id, v_st, unnest(v_rollen);
  return jsonb_build_object('konto_id', v_id, 'name', v_name) || einladung_erzeugen(v_id);
end $$;

-- Prüft, ob der Aufrufer das Konto verwalten darf; gibt dessen Hauptrolle hier zurück.
create or replace function konto_verwaltbar(p_konto bigint) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_manager();
  k     konto;
  v_r   text[];
begin
  select * into k from konto where id = p_konto;
  if k.id is null then raise exception 'Unbekanntes Konto'; end if;
  if k.gesamt_admin then raise exception 'Den Gesamt-Admin nur über den Neon SQL-Editor (notfall_code)'; end if;
  v_r := rollen_von(p_konto, v_st);
  if cardinality(v_r) = 0 then raise exception 'Das Konto gehört nicht zu diesem Standort'; end if;
  if 'manager' = any (v_r) and not ist_admin() then raise exception 'Einen Werkstatt-Manager verwaltet nur der Gesamt-Admin'; end if;
  return v_r[1];
end $$;

-- Rollen eines Kontos an diesem Standort setzen (ab 18.0.0), z. B.
-- {trainer,sportler}. Werkstatt-Manager vergibt und entzieht nur der
-- Gesamt-Admin. Für die Rolle Sportler muss das Konto mit einem Sportler
-- dieses Standorts verknüpft sein (oder p_sportler angeben); ohne die
-- Rolle wird die Verknüpfung gelöst, wenn sie nirgends mehr gebraucht wird.
-- Hat der Sportler schon einen eigenen, deaktivierten Zugang, verliert der
-- die Sportler-Rolle (so lassen sich zwei Konten zusammenführen).
-- Braucht das Konto danach eine längere PIN (Manager, Geschäftsstelle:
-- 6 Ziffern), gilt die alte nicht mehr: Rückgabe ist dann ein neuer
-- Einladungscode, sonst null.
create or replace function konto_rollen(p_konto bigint, p_rollen text[], p_sportler bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st     bigint := recht_manager();
  v_alt    text[];
  v_neu    text[] := rollen_normal(p_rollen);
  v_sp     bigint;
  v_pin    integer;
begin
  perform konto_verwaltbar(p_konto);
  v_alt := rollen_von(p_konto, v_st);
  if ('manager' = any (v_alt)) <> ('manager' = any (v_neu)) and not ist_admin() then
    raise exception 'Werkstatt-Manager ernennt nur der Gesamt-Admin';
  end if;
  select sportler_id into v_sp from konto where id = p_konto;

  if 'sportler' = any (v_neu) then
    if p_sportler is not null and p_sportler is distinct from v_sp then
      if not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then raise exception 'Unbekannter Sportler'; end if;
      if exists (select 1 from konto where sportler_id = p_sportler and id <> p_konto and aktiv) then
        raise exception 'Der Sportler hat schon einen eigenen Zugang – den erst deaktivieren';
      end if;
      -- ein deaktivierter eigener Zugang gibt den Sportler ab (Konten zusammenführen)
      delete from konto_rolle r using konto k
       where k.sportler_id = p_sportler and k.id <> p_konto and r.konto_id = k.id and r.rolle = 'sportler';
      update konto set sportler_id = null where sportler_id = p_sportler and id <> p_konto;
      if v_sp is not null and exists (select 1 from konto_rolle where konto_id = p_konto and standort_id <> v_st and rolle = 'sportler') then
        raise exception 'Das Konto ist an einem anderen Standort schon mit einem Sportler verknüpft';
      end if;
      v_sp := p_sportler;
    end if;
    if v_sp is null then raise exception 'Für die Rolle Sportler bitte den Sportler wählen'; end if;
    if not exists (select 1 from sportler where id = v_sp and standort_id = v_st) then
      raise exception 'Der verknüpfte Sportler gehört nicht zu diesem Standort';
    end if;
  elsif not exists (select 1 from konto_rolle where konto_id = p_konto and standort_id <> v_st and rolle = 'sportler') then
    v_sp := null;
  end if;

  v_pin := pin_laenge(p_konto);
  update konto set sportler_id = v_sp where id = p_konto and sportler_id is distinct from v_sp;
  delete from konto_rolle where konto_id = p_konto and standort_id = v_st and rolle <> all (v_neu);
  insert into konto_rolle (konto_id, standort_id, rolle) select p_konto, v_st, unnest(v_neu) on conflict do nothing;

  if pin_laenge(p_konto) > v_pin and exists (select 1 from konto where id = p_konto and pin_hash is not null) then
    update konto set pin_hash = null, fehlversuche = 0, gesperrt_bis = null where id = p_konto;
    delete from sitzung where konto_id = p_konto;
    return jsonb_build_object('konto_id', p_konto, 'name', (select name from konto where id = p_konto)) || einladung_erzeugen(p_konto);
  end if;
  return null;
end $$;

-- Name, aktiv ändern. p_rolle (bis 17.x): ersetzt die Werkstatt-Rolle
-- (Manager/Trainer/Geschäftsstelle), eine Sportler-Rolle bleibt; neue
-- App-Stände nehmen konto_rollen. Rückgabe wie konto_rollen.
create or replace function konto_aendern(p_konto bigint, p_name text default null, p_rolle text default null, p_aktiv boolean default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint := recht_manager();
  v_r   text   := konto_verwaltbar(p_konto);
  v_alt text[] := rollen_von(p_konto, v_st);
  v_neu jsonb;
begin
  if p_name is not null then
    if trim(p_name) = '' then raise exception 'Name fehlt'; end if;
    if name_vergeben(v_st, p_name, p_konto) then raise exception 'Den Namen gibt es an diesem Standort schon'; end if;
    update konto set name = trim(p_name) where id = p_konto;
  end if;
  if p_rolle is not null and p_rolle <> v_r then
    if p_rolle not in ('manager', 'trainer', 'geschaeftsstelle') then
      raise exception 'Diese Rolle lässt sich nicht ändern';
    end if;
    v_neu := konto_rollen(p_konto, array[p_rolle] || case when 'sportler' = any (v_alt) then array['sportler'] else '{}'::text[] end);
  end if;
  if p_aktiv is not null then
    update konto set aktiv = p_aktiv where id = p_konto;
    if not p_aktiv then delete from sitzung where konto_id = p_konto; end if;
  end if;
  return v_neu;
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
             'meine_rolle', (rollen_von(ich_id(), st.id))[1],
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

-- Ticket anlegen samt vorgemerktem Material, in einem Schritt. Kommt dieselbe
-- Kennung vom Gerät ein zweites Mal (Nachsenden nach Funkloch), gibt es kein
-- zweites Ticket. Einzelstücke: p_stuecke (Liste) und/oder p_stueck (eines).
-- Sportler dürfen Tickets für ihre eigenen Räder anlegen — ohne Material und
-- Arbeitsschritte, nur in der Werkstatt, und pro Rad nur, solange dort kein
-- Ticket offen ist.
create or replace function ticket_anlegen(
  p_rad text, p_problem text, p_fahrbereit boolean,
  p_soll_fertig date default null, p_naechstmoeglich boolean default false,
  p_anlass text default null, p_arbeitsort text default 'Werkstatt',
  p_positionen jsonb default '[]'::jsonb, p_bearbeiter text default null,
  p_client_id uuid default null, p_stueck text default null, p_stuecke text[] default null
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

  if v_rad is not null then
    select eigentuemer_id into v_kt from rad where id = v_rad and standort_id = v_st;
    if not found then raise exception 'Unbekanntes Rad: %', v_rad; end if;
    select sportler_id into v_fahrer from zuordnung where rad_id = v_rad and gueltig_bis is null;
  end if;

  insert into ticket (rad_id, fahrer_id, problem, fahrbereit, soll_fertig, naechstmoeglich,
                      anlass, kostentraeger_id, arbeitsort, angelegt_von, client_id, standort_id)
  values (v_rad, v_fahrer, trim(p_problem), coalesce(p_fahrbereit, true), p_soll_fertig, coalesce(p_naechstmoeglich, false),
          nullif(trim(p_anlass), ''), v_kt, p_arbeitsort, p_bearbeiter, p_client_id, v_st)
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

-- ---------------------------------------------------------------------
--  Foto hochladen — mit Kennung vom Gerät, kommt nur einmal an.
--  Sportler: nur an Tickets für ihre Räder. Höchstens 5 Fotos pro Ticket.
-- ---------------------------------------------------------------------
create or replace function foto_hochladen(p_ticket bigint, p_thumb text, p_bild text, p_mime text default 'image/jpeg',
                                          p_bearbeiter text default null, p_client_id uuid default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st  bigint;
  v_id  bigint;
  t     ticket;
begin
  if ich_id() is null then raise exception 'Nicht angemeldet – bitte neu anmelden' using errcode = '28000'; end if;
  v_st := akt_standort();
  if v_st is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  p_bearbeiter := ich_name();
  if p_client_id is not null then
    select id into v_id from foto where client_id = p_client_id;
    if found then return v_id; end if;
  end if;
  select * into t from ticket where id = p_ticket and standort_id = v_st and status <> 'storniert' for update;
  if not found then raise exception 'Ticket % nicht gefunden oder storniert', p_ticket; end if;
  if not rolle_in('admin', 'manager', 'trainer')
     and not (mein_sportler() is not null and (t.fahrer_id = mein_sportler() or t.kostentraeger_id = mein_sportler()
                                               or (t.rad_id is not null and mein_rad(t.rad_id)))) then
    raise exception 'Keine Berechtigung';
  end if;
  if (select count(*) from foto where ticket_id = p_ticket) >= 5 then
    raise exception 'Höchstens 5 Fotos pro Ticket – erst ein Foto löschen';
  end if;
  insert into foto (ticket_id, client_id, bearbeiter, mime, thumb, bild)
  values (p_ticket, p_client_id, p_bearbeiter, coalesce(p_mime, 'image/jpeg'), p_thumb, p_bild)
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from foto where client_id = p_client_id;
  end if;
  return v_id;
end $$;


-- 4. Zugriffsregeln: neue Kategorien und Tags auch für Trainer/Mechaniker
drop policy if exists anlegen on kategorie;
create policy anlegen on kategorie for insert to anonymous
  with check (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer')));
drop policy if exists anlegen on tag;
create policy anlegen on tag for insert to anonymous
  with check (standort_id = (select akt_standort()) and (select rolle_in('admin', 'manager', 'trainer')));

-- 5. Rechte der Rolle anonymous (vollständig, wie in schema.sql)
revoke all on all tables in schema public from anonymous;
grant usage on schema public to anonymous;
grant select on standort, sportler, kategorie, tag, artikel, artikel_tag, rad, zuordnung, stueck, stueck_tag,
                ticket, ticket_stueck, ticket_position, rechnung, buchung, koffer_soll, termin, zaehlung,
                inventur_lauf, bestellung, foto, lagerort, v_bestand, v_bestand_ort, v_bestand_groesse, v_ausgeliehen, v_rad, v_koffer, v_offene_posten to anonymous;
grant update (name, rg_empfaenger, rg_absender, rg_kopf, rg_fuss, rg_text, iban, bic, bank,
              zahlungsziel_tage, logo, fuss_logo) on standort to anonymous;
grant insert on stueck, termin, koffer_soll, sportler, rad, artikel, tag, kategorie to anonymous;
grant insert (art, code, menge, ort, notiz, bearbeiter, groesse) on buchung to anonymous;
grant insert (ticket_id, code, menge, titel, dauer_min) on ticket_position to anonymous;
grant insert (code, menge, bearbeiter) on bestellung to anonymous;
grant update on stueck, koffer_soll, sportler, rad, artikel, tag, kategorie to anonymous;
grant update (soll_fertig, naechstmoeglich, anlass, aufwand, fahrbereit, arbeitsort,
              kostentraeger_id, status, uebernommen_von) on ticket to anonymous;
grant update (menge, status, titel, dauer_min) on ticket_position to anonymous;
grant update (status) on rechnung to anonymous;
grant delete on termin, koffer_soll, foto, stueck, bestellung, tag to anonymous;
revoke all on all sequences in schema public from anonymous;
grant usage, select on all sequences in schema public to anonymous;

revoke execute on all functions in schema public from public, anonymous;
grant execute on function
  -- Hilfen, die die Zugriffsregeln und Spaltenvorgaben aufrufen
  kopfzeile(text), token_hash(text), ich_id(), ich_name(), ist_admin(), akt_standort(), meine_rolle(), meine_rollen(),
  rolle_in(text[]), mein_sportler(), mein_rad(text), standort_kuerzel(), eigener_code(text), code_buchstabe(text),
  -- Anmelden und Konto
  standorte_liste(), anmelde_liste(bigint),
  anmelden(bigint, text, bigint, text, text, boolean),
  einladung_pruefen(text), einladung_einloesen(text, text, text, boolean),
  ich(), abmelden(), pin_aendern(text, text),
  konten_liste(), konto_anlegen(text, text, bigint, text[]), konto_neuer_code(bigint),
  konto_aendern(bigint, text, text, boolean), konto_rollen(bigint, text[], bigint), sportler_zugang(bigint), standort_anlegen(text, text),
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
