-- =====================================================================
--  Werkstatt — Migration auf 19.0.0: Nummernvorlage für Räder je
--  Standort, Nummern nachträglich ändern
--
--  Vorher muss gelaufen sein: db/migration_18.0.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Empfehlung: vorher auf einem Neon-Branch testen.
--
--  Was passiert:
--  - standort: neue Spalten rad_vorlage (z. B. HSG-TR) und rad_stellen
--    (Anzahl Ziffern, Standard 2). Mit Vorlage heißen Räder
--    <Kürzel>-<Vorlage>-<BR|SR|ZF|CX|SO>-<Zahl>, z. B. XX-HSG-TR-BR-0042.
--    Ohne Vorlage bleibt alles wie bisher (SN-BR-01). Gesetzt wird die
--    Vorlage nur vom Werkstatt-Manager über rad_nummern_setzen.
--  - naechste_rad_id beachtet Vorlage und Stellen.
--  - Neue Funktion nummer_aendern: Artikel, Einzelstück oder Rad bekommt
--    eine neue Nummer; Buchungen, Tickets, Tags, Zuordnungen ziehen über
--    die vorhandenen Fremdschlüssel (on update cascade) mit. Trainer/
--    Mechaniker dürfen das, solange es keine Buchung (Artikel) bzw. kein
--    abgeschlossenes oder storniertes Ticket (Einzelstück, Rad) gibt,
--    sonst nur der Werkstatt-Manager.
--  - Trigger nummer_schutz: Nummern lassen sich nur noch über
--    nummer_aendern ändern, nicht mehr per direktem Update.
--  Vorhandene Daten bleiben unverändert.
-- =====================================================================

begin;

alter table standort
  add column rad_vorlage text check (rad_vorlage is null or (rad_vorlage ~ '^[A-Z0-9]+(-[A-Z0-9]+){0,3}$' and length(rad_vorlage) <= 20)),
  add column rad_stellen integer not null default 2 check (rad_stellen between 2 and 6);

-- ---------------------------------------------------------------------
--  Nächste Rad-ID: <Kürzel>[-<Vorlage>]-<Typ>-<Zahl>, Zahl mit
--  rad_stellen Ziffern (höchste vorhandene + 1).
-- ---------------------------------------------------------------------
create or replace function naechste_rad_id(p_typ text)
returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  st     standort;
  v_k    text;
  v_max  integer;
begin
  select * into st from standort where id = akt_standort();
  if st.id is null then raise exception 'Kein Zugriff auf diesen Standort'; end if;
  v_k := st.kuerzel || coalesce('-' || st.rad_vorlage, '') || '-' || rad_kuerzel(p_typ);
  select max(substring(id from '-([0-9]+)$')::integer) into v_max
    from rad where id ~ ('^' || v_k || '-[0-9]+$');
  return v_k || '-' || lpad((coalesce(v_max, 0) + 1)::text, st.rad_stellen, '0');
end $$;

-- Vorlage und Stellen für Rad-Nummern setzen (Werkstatt-Manager).
create or replace function rad_nummern_setzen(p_vorlage text, p_stellen integer)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
  v_v  text   := nullif(upper(regexp_replace(coalesce(p_vorlage, ''), '\s+', '', 'g')), '');
begin
  if v_v is not null and (v_v !~ '^[A-Z0-9]+(-[A-Z0-9]+){0,3}$' or length(v_v) > 20) then
    raise exception 'Vorlage: Buchstaben und Ziffern, Teile mit Bindestrich, z. B. HSG-TR';
  end if;
  if p_stellen is null or p_stellen < 2 or p_stellen > 6 then
    raise exception 'Stellen: 2 bis 6';
  end if;
  update standort set rad_vorlage = v_v, rad_stellen = p_stellen where id = v_st;
end $$;

-- ---------------------------------------------------------------------
--  Nummern ändern — nur über nummer_aendern (setzt die Freigabe für
--  diese eine Transaktion).
-- ---------------------------------------------------------------------
create or replace function nummer_schutz() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('werkstatt.nummer_aendern', true), '') <> 'ja' then
    raise exception 'Nummern lassen sich nur über „Nummer ändern“ ändern';
  end if;
  return new;
end $$;

create trigger artikel_nummer before update of code on artikel
  for each row when (new.code is distinct from old.code) execute function nummer_schutz();
create trigger stueck_nummer before update of nummer on stueck
  for each row when (new.nummer is distinct from old.nummer) execute function nummer_schutz();
create trigger rad_nummer before update of id on rad
  for each row when (new.id is distinct from old.id) execute function nummer_schutz();

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
    -- Tags gehören zur Kategorie (Buchstabe im Code); bei neuem Buchstaben fallen sie weg
    delete from artikel_tag x using tag t
     where x.code = v_neu and t.id = x.tag_id and t.buchstabe is distinct from code_buchstabe(v_neu);
  elsif p_art = 'stueck' then
    if not exists (select 1 from stueck where nummer = p_alt and standort_id = v_st) then raise exception 'Unbekanntes Einzelstück: %', p_alt; end if;
    if not v_mgr and exists (select 1 from ticket_stueck ts join ticket t on t.id = ts.ticket_id
                              where ts.nummer = p_alt and t.status not in ('offen', 'angenommen')) then
      raise exception '% steht schon in abgeschlossenen Tickets – die Nummer ändert dann nur der Werkstatt-Manager', p_alt;
    end if;
    update stueck set nummer = v_neu where nummer = p_alt and standort_id = v_st;
    delete from stueck_tag x using tag t
     where x.nummer = v_neu and t.id = x.tag_id and t.buchstabe is distinct from code_buchstabe(v_neu);
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

revoke execute on function rad_nummern_setzen(text, integer), nummer_aendern(text, text, text), nummer_schutz() from public;
grant execute on function rad_nummern_setzen(text, integer), nummer_aendern(text, text, text) to anonymous;

commit;
