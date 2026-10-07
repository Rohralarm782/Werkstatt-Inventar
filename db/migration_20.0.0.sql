-- =====================================================================
--  Werkstatt — Migration auf 20.0.0: Zeitpunkt der letzten Änderung
--  für Artikel, Räder und Einzelstücke (zum Sortieren der Übersichten)
--
--  Vorher muss gelaufen sein: db/migration_19.0.0.sql
--  (19.1.0 hatte keine Migration.)
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--  Empfehlung: vorher auf einem Neon-Branch testen.
--
--  Was passiert:
--  - artikel, rad, stueck: neue Spalte geaendert_am (Zeitpunkt).
--    Vorhandene Zeilen bekommen den Zeitpunkt dieser Migration — eine
--    ältere Änderungszeit gibt es nicht.
--  - Trigger geaendert_setzen: setzt geaendert_am beim Anlegen und bei
--    jeder echten Änderung (auch Ort/Zustand eines Einzelstücks und neue
--    Nummer). Ein Update ohne geänderten Wert lässt die Zeit stehen.
--    Von außen lässt sich die Zeit nicht setzen.
--  - rad_zuordnen: ein Fahrerwechsel zählt als Änderung des Rads.
--  - v_rad: liefert geaendert_am mit.
--  Vorhandene Daten bleiben unverändert.
-- =====================================================================

begin;

alter table artikel add column geaendert_am timestamptz not null default now();
alter table rad     add column geaendert_am timestamptz not null default now();
alter table stueck  add column geaendert_am timestamptz not null default now();

-- Zeit der letzten Änderung setzen (Anlegen und jede echte Änderung).
create or replace function geaendert_setzen() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- Update ohne geänderten Wert: Zeit bleibt stehen
  if tg_op = 'UPDATE' and new.geaendert_am is not distinct from old.geaendert_am
     and (to_jsonb(new) - 'geaendert_am') = (to_jsonb(old) - 'geaendert_am') then
    return new;
  end if;
  new.geaendert_am := now();
  return new;
end $$;

create trigger zz_artikel_geaendert before insert or update on artikel for each row execute function geaendert_setzen();
create trigger zz_rad_geaendert     before insert or update on rad     for each row execute function geaendert_setzen();
create trigger zz_stueck_geaendert  before insert or update on stueck  for each row execute function geaendert_setzen();

-- Fahrer eines Rads wechseln: alte Zuordnung schließen, neue öffnen.
-- p_sportler = null nimmt das Rad nur aus der Zuordnung.
-- Ab 20.0.0: zählt als Änderung des Rads (geaendert_am).
create or replace function rad_zuordnen(p_rad text, p_sportler bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_arbeiten();
begin
  if not exists (select 1 from rad where id = p_rad and standort_id = v_st) then raise exception 'Unbekanntes Rad: %', p_rad; end if;
  if p_sportler is not null and not exists (select 1 from sportler where id = p_sportler and standort_id = v_st) then
    raise exception 'Unbekannter Sportler';
  end if;
  update zuordnung set gueltig_bis = current_date
   where rad_id = p_rad and gueltig_bis is null;
  if p_sportler is not null then
    insert into zuordnung (rad_id, sportler_id) values (p_rad, p_sportler);
  end if;
  update rad set geaendert_am = now() where id = p_rad and standort_id = v_st;
end $$;

-- v_rad mit Änderungszeit (neue Spalte hinten, daher create or replace)
create or replace view v_rad with (security_invoker = true) as
select r.id, r.bezeichnung, r.typ, r.rahmennummer, r.groesse, r.eigentuemer_id, r.aktiv, r.notiz,
       z.sportler_id as fahrer_id,
       s.name        as fahrer,
       z.gueltig_ab  as fahrer_seit,
       r.marke,
       r.geaendert_am
from rad r
left join zuordnung z on z.rad_id = r.id and z.gueltig_bis is null
left join sportler s  on s.id = z.sportler_id;

revoke execute on function geaendert_setzen() from public;

commit;
