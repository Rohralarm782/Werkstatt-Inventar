-- =====================================================================
--  Werkstatt — Migration auf 21.7.0
--  Artikel löschen (für Fehleingaben)
--
--  Vorher muss gelaufen sein: db/migration_21.6.1.sql
--
--  Einmal komplett im SQL-Editor von Neon ausführen (Run, nicht Explain),
--  danach: Data API → "Refresh schema cache" (neue Funktion!).
--
--  Was passiert:
--  - Neue Funktion artikel_loeschen(code), nur Werkstatt-Manager und
--    Gesamt-Admin. Abgelehnt, wenn der Artikel in einem Ticket steht, an
--    Sportler ausgegeben/verliehen oder abgerechnet wurde oder von einer
--    Pauschale verbraucht wird. Sonst gehen seine Lagerbuchungen,
--    Zählungen, Bestellungen, Packlisten-Zeilen und Tags mit.
--  - Tabellen und vorhandene Daten bleiben unverändert.
-- =====================================================================

begin;

-- Artikel endgültig löschen (ab 21.7.0) — für Fehleingaben, nur Manager.
-- Geht nur, solange der Artikel nichts mit Sportlern, Tickets oder
-- Rechnungen zu tun hatte und keine Pauschale ihn verbraucht. Seine reinen
-- Lagerbuchungen (Zugang, Umbuchung, Inventur, Storno), Zählungen,
-- Bestellungen, Packlisten-Zeilen und Tags gehen mit.
create or replace function artikel_loeschen(p_code text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_st bigint := recht_manager();
  a    artikel;
  v_n  integer;
  v_x  text;
begin
  select * into a from artikel where code = p_code and standort_id = v_st for update;
  if not found then raise exception 'Artikel nicht gefunden'; end if;
  select count(*) into v_n from ticket_position where code = a.code;
  if v_n > 0 then
    raise exception '% steht in % Ticket-Schritt(en) – bitte auf inaktiv setzen statt löschen', a.code, v_n;
  end if;
  select count(*) into v_n from buchung
   where code = a.code and (sportler_id is not null or ticket_id is not null or rechnung_id is not null or abrechnen);
  if v_n > 0 then
    raise exception '% wurde schon an Sportler ausgegeben, verliehen oder abgerechnet (% Buchungen) – bitte auf inaktiv setzen statt löschen', a.code, v_n;
  end if;
  select string_agg(code, ', ' order by code) into v_x from artikel where verbraucht_code = a.code and code <> a.code;
  if v_x is not null then
    raise exception '% wird von der Pauschale % verbraucht – dort erst „Verbraucht dabei“ leeren', a.code, v_x;
  end if;
  delete from koffer_soll where code = a.code;
  delete from zaehlung    where code = a.code;
  delete from bestellung  where code = a.code;
  delete from buchung     where code = a.code;   -- Storno-Paare in einem Schritt, damit storno_von nicht stört
  delete from artikel     where code = a.code;   -- artikel_tag geht per on delete cascade mit
end $$;

revoke execute on function artikel_loeschen(text) from public;
grant execute on function artikel_loeschen(text) to anonymous;

commit;
