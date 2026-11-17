-- =====================================================================
--  Werkstatt — Migration auf 21.6.1
--  Sportler mit fest zugeordnetem Material nicht zum Kostenträger machen
--
--  Vorher muss gelaufen sein: db/migration_21.6.0.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache".
--
--  Was passiert:
--  - sportler_pruefen: Wird ein Sportler zum Kostenträger, darf ihm kein
--    Einzelstück mehr fest zugeordnet sein (stueck.sportler_id). Bisher ging
--    das durch, und das Teil hing danach an einem Kostenträger.
--  - Daten werden nicht verändert. Teile, die schon an einem Kostenträger
--    hängen, listet die Abfrage am Ende auf (meist keine).
-- =====================================================================

begin;

create or replace function sportler_pruefen() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alt text := case when tg_op = 'UPDATE' then old.kuerzel end;
  v_fest text;
begin
  new.kuerzel := nullif(upper(regexp_replace(coalesce(new.kuerzel, ''), '\s+', '', 'g')), '');
  if new.kuerzel is distinct from v_alt then
    if ich_id() is not null and not rolle_in('admin', 'manager') then
      raise exception 'Das Kürzel für die Rad-Nummern setzt nur der Werkstatt-Manager';
    end if;
    if new.kuerzel is not null then
      if new.art <> 'kostentraeger' then raise exception 'Ein Kürzel für Rad-Nummern gibt es nur bei Kostenträgern'; end if;
      if new.kuerzel !~ '^[A-Z]{2,4}$' then raise exception 'Kürzel: 2 bis 4 Buchstaben, z. B. DAS'; end if;
      if exists (select 1 from sportler where standort_id = new.standort_id and kuerzel = new.kuerzel and id is distinct from new.id) then
        raise exception 'Das Kürzel % hat schon ein anderer Kostenträger', new.kuerzel;
      end if;
      if exists (select 1 from standort where id = new.standort_id and rad_vorlage = new.kuerzel) then
        raise exception 'Das Kürzel % ist schon der feste Teil eurer eigenen Rad-Nummern', new.kuerzel;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.art = 'kostentraeger' and old.art <> 'kostentraeger' then
    if exists (select 1 from zuordnung where sportler_id = new.id and gueltig_bis is null) then
      raise exception '% fährt gerade ein Rad – erst dort den Fahrer ändern', new.name;
    end if;
    if exists (select 1 from konto where sportler_id = new.id) then
      raise exception '% hat einen Sportler-Zugang und bleibt deshalb Sportler', new.name;
    end if;
    -- Fest zugeordnetes Material (ab 21.6.1): erst dort die Zuordnung ändern
    select string_agg(nummer, ', ' order by nummer) into v_fest from stueck where sportler_id = new.id;
    if v_fest is not null then
      raise exception '% hat fest zugeordnetes Material (%) – erst dort „Fest zugeordnet an“ ändern', new.name, v_fest;
    end if;
  end if;
  if new.art = 'sportler' and new.kuerzel is not null then
    raise exception 'Erst das Kürzel für die Rad-Nummern entfernen';
  end if;
  return new;
end $$;

commit;

-- Prüfung: Einzelstücke, die schon fest an einem Kostenträger hängen
-- (leer = alles in Ordnung). Falls etwas erscheint: das Teil in der App
-- öffnen und bei „Fest zugeordnet an“ den richtigen Sportler wählen.
select s.nummer, s.typ, p.name as kostentraeger
  from stueck s join sportler p on p.id = s.sportler_id
 where p.art = 'kostentraeger'
 order by s.nummer;
