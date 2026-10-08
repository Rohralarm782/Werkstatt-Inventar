/* js/tickets.js — Tickets: Board, Ticket-Detail, Neues Ticket, Auswahl Rad/Einzelstück, Fotos.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Tickets — Board
   ===============================================================*/
function boardView(){
  if(view.filter === "verlauf") return verlaufView();
  let liste = offeneTickets();
  const q = view.suche.toLowerCase();
  const meins = t => t.status === "angenommen" && !!bearbeiter && t.uebernommen_von === bearbeiter;
  if(q) liste = liste.filter(t => (wer(t) + " " + ticketObjekt(t) + " " + tStuecke(t).join(" ") + " " + t.problem + " " + schritte(t.id).map(schrittName).join(" ")).toLowerCase().indexOf(q) >= 0);
  if(view.filter === "steht") liste = liste.filter(t => !t.fahrbereit);
  if(view.filter === "material") liste = liste.filter(t => fehlend(t).length > 0);
  if(view.filter === "ich") liste = liste.filter(meins);
  const alle = offeneTickets();

  let h = '<div class="row" style="gap:8px;margin-bottom:12px"><button class="btn primary" style="flex:1" data-a="tab" data-x="neu">+ Neues Ticket</button>' +
          '<button class="btn" data-a="filter" data-x="verlauf">Verlauf</button></div>';
  h += '<div class="seg" style="margin-bottom:10px">';
  h += segBtn("filter", "offen",    "Offen · " + alle.length, view.filter);
  h += segBtn("filter", "steht",    "Steht · " + alle.filter(t => !t.fahrbereit).length, view.filter);
  h += segBtn("filter", "material", "Material · " + alle.filter(t => fehlend(t).length > 0).length, view.filter);
  h += segBtn("filter", "ich",      "Ich · " + alle.filter(meins).length, view.filter);
  h += '</div><div class="feld"><input type="search" data-c="suche" placeholder="Fahrer, Rad, Problem, Schritt" value="' + esc(view.suche) + '"></div>';

  const summe = liste.reduce((m, t) => { const x = schaetzung(positionen(t.id)); return m + (x ? x.min : 0); }, 0);
  if(summe) h += '<p class="sub" style="margin:0 0 4px">Noch offene Arbeit in dieser Auswahl: <strong>' + dauerText(summe) + '</strong> (nur Schritte mit Arbeitszeit)</p>';
  const steht = sortiert(liste.filter(t => !t.fahrbereit));
  const faehrt = sortiert(liste.filter(t => t.fahrbereit && !istAllgemein(t)));
  const allg = sortiert(liste.filter(t => t.fahrbereit && istAllgemein(t)));
  h += '<h2 class="sec alarm">Rad steht</h2>';
  h += steht.length ? steht.map(t => ticketKarte(t, true)).join("") : '<div class="leer">Kein Rad steht.</div>';
  h += '<h2 class="sec">Fahrbereit</h2>';
  h += faehrt.length ? faehrt.map(t => ticketKarte(t, false)).join("") : '<div class="leer">' + (view.filter === "ich" ? "Du hast nichts übernommen." : "Nichts offen.") + '</div>';
  if(allg.length) h += '<h2 class="sec">Allgemein</h2>' + allg.map(t => ticketKarte(t, false)).join("");
  h += '<p class="sub" style="margin-top:14px">Puffer = Tage bis „soll fertig“ − Arbeitsaufwand − Beschaffungszeit. „Sofort“ steht immer oben.</p>';
  return h;
}
/* ---------------------------------------------------------------
   Ticket-Verlauf: abgeschlossene und stornierte Tickets, neueste
   zuerst, je 50 nachladbar. Nur mit Netz (steht nicht im Offline-Stand).
----------------------------------------------------------------*/
const VERLAUF_SEITE = 50;
let ticketVerlauf;            // undefined | "laedt" | "fehler" | { liste:[…], ende:bool }
let verlaufArt = "alle";      // alle | erledigt | storniert
async function ladeTicketVerlauf(mehr){
  const alt = mehr && ticketVerlauf && ticketVerlauf.liste ? ticketVerlauf : null;
  if(ticketVerlauf === "laedt" || (alt && alt.laedt)) return;
  if(alt){ alt.laedt = true; render(); } else ticketVerlauf = "laedt";
  try{
    const t = await rest("/ticket?status=in.(erledigt,storniert)&order=id.desc&limit=" + VERLAUF_SEITE + "&offset=" + (alt ? alt.liste.length : 0));
    const pos = t.length ? await rest("/ticket_position?ticket_id=in.(" + t.map(x => x.id).join(",") + ")&status=in.(gebucht,erledigt)&select=ticket_id,code,titel,menge,dauer_min,erledigt_am,erledigt_von,status&order=id") : [];
    t.forEach(x => x.schritte = pos.filter(p => p.ticket_id === x.id));
    await stueckeAnTickets(t);
    ticketVerlauf = { liste:(alt ? alt.liste : []).concat(t), ende:t.length < VERLAUF_SEITE };
  }catch(e){ ticketVerlauf = alt ? Object.assign(alt, { laedt:false }) : "fehler"; toast(e.message, true); }
  if(view.tab === "tickets" && view.filter === "verlauf") render();
}
function verlaufSchritt(p){ return p.code ? zahl(p.menge) + "× " + ((artikel(p.code) || {}).name || p.code) : p.titel; }
function verlaufAbschluss(t){
  return t.status === "erledigt"
    ? 'erledigt ' + (t.erledigt_am ? deLang(t.erledigt_am) : '') + (t.erledigt_von ? ' · ' + esc(t.erledigt_von) : '')
    : 'storniert ' + (t.storniert_am ? deLang(t.storniert_am) : '') + (t.storniert_von ? ' · ' + esc(t.storniert_von) : '');
}
function verlaufView(){
  let h = '<div class="row" style="gap:8px;margin-bottom:12px"><button class="btn small zurueck" data-a="filter" data-x="offen">← Offene Tickets</button><span class="sp"></span>' +
          (!offline ? '<button class="btn small" data-a="verlaufNeu">aktualisieren</button>' : '') + '</div>';
  h += '<h2 class="sec" style="margin-top:0">Verlauf · abgeschlossene Tickets</h2>';
  if(offline) return h + '<div class="leer">Der Verlauf ist nur mit Netz abrufbar.</div>';
  const v = ticketVerlauf;
  if(v === undefined) setTimeout(() => ladeTicketVerlauf(false), 0);
  if(v === undefined || v === "laedt") return h + '<div class="leer">lädt…</div>';
  if(v === "fehler") return h + '<div class="leer">Verlauf konnte nicht geladen werden. <button class="btn small" data-a="verlaufNeu">nochmal</button></div>';

  const anz = a => v.liste.filter(t => a === "alle" || t.status === a).length;
  h += '<div class="seg drei" style="margin-bottom:10px">';
  h += segBtn("verlaufArt", "alle", "Alle · " + anz("alle"), verlaufArt);
  h += segBtn("verlaufArt", "erledigt", "Erledigt · " + anz("erledigt"), verlaufArt);
  h += segBtn("verlaufArt", "storniert", "Storniert · " + anz("storniert"), verlaufArt);
  h += '</div><div class="feld"><input type="search" data-c="suche" placeholder="Fahrer, Rad, Problem, Schritt, T-Nummer" value="' + esc(view.suche) + '"></div>';

  const q = view.suche.toLowerCase();
  let liste = v.liste.filter(t => verlaufArt === "alle" || t.status === verlaufArt);
  if(q) liste = liste.filter(t => (tnr(t.id) + " " + wer(t) + " " + ticketObjekt(t) + " " + tStuecke(t).join(" ") + " " + t.problem + " " +
                                   (t.erledigt_von || "") + " " + (t.storniert_von || "") + " " + t.schritte.map(verlaufSchritt).join(" ")).toLowerCase().indexOf(q) >= 0);
  if(!liste.length) h += '<div class="leer">' + (v.liste.length ? 'Nichts gefunden.' : 'Noch keine abgeschlossenen Tickets.') + '</div>';
  liste.forEach(t => {
    const gem = t.schritte.map(verlaufSchritt);
    h += '<button class="ticket" data-a="verlaufTicket" data-x="' + t.id + '">';
    h += '<span class="kopf"><span class="big">' + esc(wer(t)) + '</span><span class="sub">' + esc(ticketObjekt(t)) + '</span>' +
         '<span class="sub mono" style="margin-left:auto">' + tnr(t.id) + '</span></span>';
    h += '<p class="prob">' + esc(t.problem) + '</p>';
    if(gem.length) h += '<p class="sub" style="margin:2px 0 0">gemacht: ' + esc(gem.join(", ")) + '</p>';
    h += '<span class="chips">' + (t.status === "erledigt" ? '<span class="chip ok">' : '<span class="chip grau">') + verlaufAbschluss(t) + '</span>' +
         '<span class="chip grau">angelegt ' + deLang(t.angelegt) + '</span></span></button>';
  });
  if(!v.ende) h += '<button class="btn voll" data-a="verlaufMehr"' + (v.laedt ? ' disabled' : '') + '>' + (v.laedt ? 'lädt…' : 'Ältere laden') + '</button>';
  else if(v.liste.length) h += '<p class="sub" style="text-align:center">Das waren alle ' + v.liste.length + ' abgeschlossenen Tickets.</p>';
  return h;
}
/** Abgeschlossenes Ticket ansehen (nur lesen). */
async function verlaufTicket(id){
  const t = ((ticketVerlauf && ticketVerlauf.liste) || []).find(x => x.id === id); if(!t) return;
  let h = '<h3>' + esc(wer(t)) + ' <span class="sub">' + tnr(t.id) + '</span></h3>';
  h += '<p class="sub" style="margin-top:-6px">' + esc(ticketObjekt(t)) + '</p>';
  h += '<p style="margin:0 0 8px">' + esc(t.problem) + '</p>';
  h += '<div class="card" style="margin:0 0 10px">';
  h += zeile("Angelegt", deLang(t.angelegt) + (t.angelegt_von ? " · " + esc(t.angelegt_von) : ""));
  if(t.uebernommen_von) h += zeile("Übernommen", esc(t.uebernommen_von));
  h += zeile(t.status === "erledigt" ? "Erledigt" : "Storniert", (t.status === "erledigt" ? deLang(t.erledigt_am) + (t.erledigt_von ? " · " + esc(t.erledigt_von) : "")
                                                                                   : deLang(t.storniert_am) + (t.storniert_von ? " · " + esc(t.storniert_von) : "")));
  if(t.kostentraeger_id) h += zeile("Kostenträger", esc(sportlerName(t.kostentraeger_id)));
  h += zeile("Arbeitsort", esc(t.arbeitsort));
  if(t.anlass) h += zeile("Anlass", esc(t.anlass));
  h += '</div><span class="lbl">Gemacht</span>';
  if(!t.schritte.length) h += '<p class="sub" style="margin:0 0 10px">Keine erledigten Schritte.</p>';
  else {
    h += '<div class="liste" style="margin-bottom:10px">';
    t.schritte.forEach(p => {
      h += '<div class="eintrag"><div class="txt">' + esc(verlaufSchritt(p)) + '<br><span class="sub">' +
           (p.erledigt_am ? de(p.erledigt_am) : '') + (p.erledigt_von ? ' · ' + esc(p.erledigt_von) : '') + (p.status === "gebucht" ? ' · gebucht' : '') + '</span></div></div>';
    });
    h += '</div>';
  }
  h += '<span class="lbl">Fotos</span><div id="vFotos"><p class="sub" style="margin:0">lädt…</p></div>';
  h += '<div class="row" style="gap:8px;margin-top:12px"><button class="btn" data-a="modalZu">Schließen</button><span class="sp"></span>' +
       (t.rad_id && rad(t.rad_id) ? '<button class="btn small" data-a="verlaufRad" data-x="' + esc(t.rad_id) + '">Zur Rad-Seite</button>' : '') + '</div>';
  modal(h);
  try{
    const f = await rest("/foto?ticket_id=eq." + id + "&select=id,thumb,aufgenommen&order=id");
    const el = $("vFotos"); if(!el) return;
    const zu = t.storniert_am || t.erledigt_am, alt = zu && (Date.now() - new Date(zu)) > 30 * 86400000;
    el.innerHTML = !f.length ? '<p class="sub" style="margin:0">' + (alt ? 'Keine Fotos mehr — sie werden 30 Tage nach dem Abschluss gelöscht.' : 'Keine Fotos.') + '</p>' :
      '<div class="fotos">' + f.map(x => '<button class="foto" data-a="fotoZeigen" data-x="' + x.id + '"><img src="data:image/jpeg;base64,' + x.thumb + '" alt="Foto vom ' + esc(zeitKurz(x.aufgenommen)) + '"></button>').join("") + '</div>';
  }catch(e){ const el = $("vFotos"); if(el) el.innerHTML = '<p class="sub" style="margin:0">Fotos konnten nicht geladen werden.</p>'; }
}
function segBtn(aktion, wert, label, aktuell, extraKlasse){
  return '<button data-a="' + aktion + '" data-x="' + esc(wert) + '" aria-pressed="' + (aktuell === wert) + '"' +
         (extraKlasse ? ' class="' + extraKlasse + '"' : '') + '>' + esc(label) + '</button>';
}
/* ---------------------------------------------------------------
   Arbeitszeit-Schätzung aus dem vorgemerkten Material: je Artikel eine
   Arbeitszeit (Minuten je Stück bzw. je Leistung), zwischen den einzelnen
   Arbeitsschritten jeweils WECHSEL_MIN dazu.
----------------------------------------------------------------*/
const WECHSEL_MIN = 5;
function schaetzung(pos){
  let min = 0, schritte = 0;
  pos.forEach(p => { const a = p.code ? artikel(p.code) : null, d = a ? num(a.dauer_min) * num(p.menge || 1) : num(p.dauer_min); if(d > 0){ min += d; schritte++; } });
  if(!schritte) return null;
  return { min: Math.round(min + WECHSEL_MIN * (schritte - 1)), schritte, arbeit: Math.round(min) };
}
function dauerText(min){ if(min < 60) return min + " min"; const h = Math.floor(min / 60), m = min % 60; return h + " h" + (m ? " " + m + " min" : ""); }
/** Vorschlag für die Aufwand-Stufe: bis 45 min klein, bis 1:30 h mittel, darüber groß. */
function aufwandVorschlag(min){ return min == null ? null : min <= 45 ? "klein" : min <= 90 ? "mittel" : "groß"; }
function schaetzText(sch){
  return "≈ " + dauerText(sch.min) + (sch.schritte > 1 ? " (" + dauerText(sch.arbeit) + " Arbeit + " + (sch.schritte - 1) + " × " + WECHSEL_MIN + " min Wechsel)" : "");
}
/** Vormerkbar sind Stück-Artikel und Leistungen — Vorrat (Bremsöl, Fett …) zieht die Leistung selbst ab. */
function vormerkbar(a){ return a.aktiv && a.art !== "Vorrat" && !istWMat(a.code) && !(Array.isArray(a.groessen) && a.groessen.length); }
/** Werkstattmaterial (Kategorie W: Klebeband, Kabelbinder, Stifte …) — nur zum Überblick,
    wird nicht an Tickets, Räder oder Sportler gebucht und nicht berechnet. */
const W_MAT = "W";
function istWMat(code){ return stueckKategorie(code) === W_MAT; }

function ticketKarte(t, steht){
  const p = pufferText(t), pos = positionen(t.id), alle = schritte(t.id), fertig = alle.filter(schrittFertig).length;
  const mat = pos.filter(x => x.code), f = fehlend(t), b = beschaffungWerktage(t), pr = pruefOffen(t).length;
  let h = '<button class="ticket' + (steht ? " steht" : "") + '" data-a="oeffnen" data-x="' + t.id + '">';
  h += '<span class="kopf"><span class="big">' + esc(wer(t)) + '</span><span class="sub">' + esc(ticketObjekt(t)) + '</span>';
  h += '<span class="puffer mono" style="color:' + p.farbe + '">' + p.txt + '</span></span>';
  h += '<p class="prob">' + esc(t.problem) + '</p><span class="chips">';
  if(!alle.length) h += '<span class="chip grau">keine Schritte</span>';
  else if(fertig) h += '<span class="chip blau">' + fertig + ' von ' + alle.length + ' erledigt</span>';
  if(f.length) h += '<span class="chip warn">' + (b > 0 ? 'Bestellen · ' + werktageText(b) : 'Fehlt · ' + f.length) + '</span>';
  else if(mat.length) h += '<span class="chip ok">Reserviert · ' + mat.length + '</span>';
  const sch = schaetzung(pos);
  h += '<span class="chip grau">' + esc(t.aufwand) + (sch ? ' · ≈ ' + dauerText(sch.min) + (fertig ? ' offen' : '') : '') + '</span>';
  h += '<span class="chip grau">' + (t.naechstmoeglich ? "nächstmöglich" : t.soll_fertig ? de(t.soll_fertig) + (t.anlass ? " · " + esc(t.anlass) : "") : "kein Termin") + '</span>';
  if(t.arbeitsort !== "Werkstatt") h += '<span class="chip warn">' + esc(t.arbeitsort) + '</span>';
  if(t.status === "angenommen") h += '<span class="chip ok">in Arbeit' + (t.uebernommen_von ? ' · ' + esc(t.uebernommen_von) : '') + '</span>';
  if(pr) h += '<span class="chip alarm">' + pr + ' zu prüfen</span>';
  h += '</span></button>';
  return h;
}

/* ---------------------------------------------------------------
   Termin-Auswahl (Neu und Detail)
----------------------------------------------------------------*/
function terminWahl(praefix, soll, sofort){
  const fr = iso(naechsterFreitag()), woche = iso(plusTage(7));
  const akt = sofort ? "sofort" : !soll ? "keiner" : soll === fr ? "we" : soll === woche ? "woche" : "datum";
  let h = '<div class="seg zwei" style="margin-bottom:8px">';
  h += segBtn(praefix + "Termin", "sofort", "Nächstmöglich", akt, "rotwahl");
  h += segBtn(praefix + "Termin", "we",     "WE · Fr " + de(fr), akt);
  h += segBtn(praefix + "Termin", "woche",  "in 1 Woche", akt);
  h += segBtn(praefix + "Termin", "keiner", "kein Termin", akt);
  h += '</div><input type="date" data-c="' + praefix + 'Datum" value="' + esc(sofort ? "" : (soll || "")) + '">';
  return h;
}
function terminWert(x){
  if(x === "sofort") return { soll_fertig:null, naechstmoeglich:true };
  if(x === "we")     return { soll_fertig:iso(naechsterFreitag()), naechstmoeglich:false };
  if(x === "woche")  return { soll_fertig:iso(plusTage(7)), naechstmoeglich:false };
  return { soll_fertig:null, naechstmoeglich:false };
}

/* ===============================================================
   Ticket-Detail
   ===============================================================*/
function detailView(id){
  const t = ticket(id);
  if(!t){ view.ticket = null; return boardView(); }
  const p = pufferText(t), b = beschaffung(t), bw = beschaffungWerktage(t), pr = pruefOffen(t);
  const gesperrt = offline ? " disabled" : "";

  let h = '<button class="btn small" data-a="zurueck" style="margin-bottom:10px">← Alle Tickets</button>';
  h += '<div class="card"><div class="row wrapr"><span class="big" style="font-size:26px">' + esc(wer(t)) + '</span>';
  h += '<span class="sub">' + esc(ticketObjekt(t)) + ' · ' + tnr(t.id) + '</span><span class="sp"></span>';
  h += (!t.rad_id ? '' : t.fahrbereit ? '<span class="chip ok">fahrbereit</span>' : '<span class="chip alarm">Rad steht</span>') + '</div>';
  h += '<p style="margin:10px 0 0">' + esc(t.problem) + '</p>';
  h += '<p class="sub" style="margin:6px 0 0">Angelegt ' + deLang(t.angelegt) + (t.angelegt_von ? ' von ' + esc(t.angelegt_von) : '') +
       (t.uebernommen_von ? ' · übernommen von ' + esc(t.uebernommen_von) : '') + (t.anlass ? ' · ' + esc(t.anlass) : '') + '</p></div>';

  h += schritteKarte(t, gesperrt);
  h += '<div class="card"><span class="lbl">Priorität</span>';
  if(t.naechstmoeglich){
    h += '<p style="margin:0"><strong style="color:var(--sprint)">Nächstmöglich</strong> — steht ganz oben in seiner Gruppe.</p>';
  } else if(t.soll_fertig){
    h += zeile("Soll fertig " + de(t.soll_fertig), tageBis(t.soll_fertig) + " T");
    h += zeile("− Arbeitsaufwand (" + esc(t.aufwand) + ")", (AUFWAND[t.aufwand] || 0) + " T");
    h += zeile("− Beschaffung fehlender Teile" + (bw ? " (" + werktageText(bw) + ")" : ""), b + " T");
    h += '<div class="row trenn"><strong>Puffer</strong><span class="sp"></span><span class="big" style="color:' + p.farbe + '">' + p.txt.replace(" T"," Tage") + '</span></div>';
  } else {
    h += '<p class="sub" style="margin:0">Kein Termin — läuft am Ende der Liste mit.</p>';
  }
  h += '</div>';

  h += '<div class="card"><span class="lbl">Soll fertig</span>' + terminWahl("t", t.soll_fertig, t.naechstmoeglich);
  h += '<div class="feld" style="margin-top:12px"><span class="lbl">Anlass</span><input type="text" data-c="tAnlass" value="' + esc(t.anlass || "") + '" placeholder="Wettkampf, Training…"></div>';
  h += '<span class="lbl">Arbeitsaufwand</span><div class="seg" style="margin-bottom:12px">';
  ["klein","mittel","groß"].forEach(k => h += segBtn("tAufwand", k, k + " · " + AUFWAND[k] + " T", t.aufwand));
  h += '</div>';
  if(t.rad_id){
    h += '<span class="lbl">Rad fährt?</span><div class="seg" style="margin-bottom:12px">';
    h += segBtn("tFahrbereit", "ja", "Ja, fährt", t.fahrbereit ? "ja" : "nein");
    h += segBtn("tFahrbereit", "nein", "Nein, steht", t.fahrbereit ? "ja" : "nein", "rotwahl");
    h += '</div>';
  }
  h += '<div class="grid2"><div><span class="lbl">Arbeitsort</span><select data-c="tOrt">';
  h += ortOptionen(t.arbeitsort);
  h += '</select></div><div><span class="lbl">Kostenträger</span><select data-c="tKosten"><option value="">—</option>';
  (DB.sportler||[]).forEach(s => h += '<option value="' + s.id + '"' + (t.kostentraeger_id === s.id ? " selected" : "") + '>' + esc(s.name) + (s.abrechnen ? " (wird berechnet)" : "") + '</option>');
  h += '</select></div></div></div>';

  h += fotoKarte(t);

  const sa = ticketStuecke(t), eigen = tStuecke(t);
  h += '<div class="card"><div class="row"><span class="lbl" style="margin:0;flex:1">Einzelstücke' + (t.rad_id ? ' · am Rad und am Ticket' : '') + '</span>' +
       (DB.tsDa !== false ? '<button class="btn small" data-a="tsDazu"' + gesperrt + '>+ dazu</button>' : '') + '</div>';
  if(!sa.length) h += '<p class="sub" style="margin:6px 0 0">' + (istAllgemein(t) ? 'Allgemeines Ticket — bei Bedarf Einzelstücke dazunehmen.' : 'Kein nummeriertes Teil zugeordnet.') + '</p>';
  else {
    h += '<div class="liste" style="margin-top:6px">';
    sa.forEach(s => {
      const amTicket = eigen.indexOf(s.nummer) >= 0, amRad = !!t.rad_id && s.rad_id === t.rad_id;
      const info = [amRad ? "am Rad" : "", s.detail || ""].filter(Boolean).join(" · ");
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(s.nummer) + '</strong> ' + esc(s.typ) + (s.marke ? ' · ' + esc(s.marke) : '') + '<br><span class="sub">' + esc(info) + '</span></div>';
      h += s.zustand === "frei" ? '<span class="chip ok">frei</span>' : '<span class="chip alarm">' + esc(s.zustand) + '</span>';
      h += '<div class="knoepfe"><button class="btn small" data-a="pruefen" data-x="' + esc(s.nummer) + '"' + gesperrt + '>' + (s.zustand === "frei" ? "prüfen" : "freigeben") + '</button>';
      // Herausnehmen nur, was direkt am Ticket hängt (ab 14.3.0 auch das letzte — dann allgemeines Ticket)
      if(amTicket && DB.tsDa !== false)
        h += '<button class="btn small" data-a="tsWeg" data-x="' + esc(s.nummer) + '" aria-label="' + esc(s.nummer) + ' aus dem Ticket nehmen"' + gesperrt + '>✕</button>';
      h += '</div></div>';
    });
    h += '</div>';
    if(pr.length) h += '<p class="sub" style="margin:10px 0 0;color:var(--sprint)">Solange ein Teil auf „zu prüfen“ steht, lässt sich das Ticket nicht abschließen.</p>';
  }
  h += '</div>';

  const offen = positionen(t.id).length, fertigMat = schritte(t.id).some(x => x.status === "gebucht");
  h += '<div class="card"><span class="lbl">Abschluss</span><div style="display:grid;gap:8px">';
  h += '<button class="btn primary" data-a="erledigt"' + gesperrt + '>' + (offen ? "Rest erledigt &amp; Ticket schließen" : "Ticket schließen") + '</button>';
  h += '<div class="row" style="gap:8px">' + (t.status !== "angenommen" ? '<button class="btn" style="flex:1" data-a="annehmen"' + gesperrt + '>Übernehmen</button>' : '<span class="sp"></span>') +
       '<button class="btn small" data-a="stornieren"' + gesperrt + '>Stornieren</button></div></div>';
  if(offen) h += '<p class="sub" style="margin:8px 0 0">Schließen bucht alle noch offenen Schritte auf einmal.</p>';
  if(fertigMat) h += '<p class="sub" style="margin:4px 0 0">Stornieren gibt nur die offenen Schritte frei — abgehaktes Material bleibt gebucht.</p>';
  h += '</div>';
  return h;
}
/** Einzelstücke an ein offenes Ticket nachtragen: Suche + Liste, Serien als eine Zeile. */
let tsSuche = "";
function tsDazuForm(){
  const t = ticket(view.ticket); if(!t) return;
  modal('<h3>Einzelstück dazunehmen</h3><p class="sub" style="margin-top:-6px">' + esc(tnr(t.id) + " · " + wer(t)) + ' — antippen nimmt es ins Ticket, es wird „zu prüfen“.</p>' +
        '<input type="search" data-c="tsSuche" placeholder="Nummer, Typ oder Marke" value="' + esc(tsSuche) + '">' +
        '<div id="tsListe" class="wahl-liste" style="margin-top:8px">' + tsListe(t) + '</div>' +
        '<button class="btn voll" style="margin-top:12px" data-a="modalZu">Fertig</button>');
}
function tsListe(t){
  const q = tsSuche.trim().toLowerCase(), eigen = tStuecke(t);
  // nicht: schon dabei, am eigenen Rad (gehört ohnehin dazu), an einem anderen Rad, ausgemustert
  const frei = (DB.stueck||[]).filter(s => s.ort !== "ausgemustert" && eigen.indexOf(s.nummer) < 0 && !s.rad_id &&
                                         (!q || [s.nummer, s.typ, s.marke, s.detail].join(" ").toLowerCase().indexOf(q) >= 0))
    .sort((a, b) => a.nummer.localeCompare(b.nummer, "de", { numeric:true }));
  if(!frei.length) return '<p class="sub" style="margin:8px 10px">' + (q ? "Nichts gefunden." : "Keine weiteren Einzelstücke ohne Rad.") + '</p>';
  const gruppen = {}, reihe = [];
  frei.forEach(s => { const k = serienSchluessel(s); if(!gruppen[k]){ gruppen[k] = []; reihe.push(k); } gruppen[k].push(s); });
  return reihe.map(k => { const g = gruppen[k], s0 = g[0];
    return '<div class="wahl-zeile serie"><span class="txt">' + (g.length > 1 ? '<strong>' + g.length + '×</strong> ' : '') + esc(s0.typ) + (s0.marke ? ' · ' + esc(s0.marke) : '') + '</span><span class="nummern">' +
      g.map(s => '<button class="btn small' + (s.zustand !== "frei" ? " warnwahl" : "") + '" data-a="tsNimm" data-x="' + esc(s.nummer) + '" title="' + esc(s.zustand + " · " + s.ort) + '">' + esc(s.nummer) + (s.zustand !== "frei" ? " !" : "") + '</button>').join("") +
      (g.length > 1 ? '<button class="btn small" data-a="tsNimm" data-x="' + esc(g.map(s => s.nummer).join(",")) + '">alle</button>' : '') + '</span></div>';
  }).join("");
}
/** Karte „Arbeitsschritte“: Material oder Text, einzeln abhaken. */
function schritteKarte(t, gesperrt){
  const alle = schritte(t.id), fertig = alle.filter(schrittFertig), fehltCodes = fehlend(t);
  let h = '<div class="card"><div class="row"><span class="lbl" style="margin:0;flex:1">Arbeitsschritte · Material aus ' + esc(t.arbeitsort) + '</span>' +
          (alle.length ? '<strong style="font-size:14px">' + fertig.length + ' von ' + alle.length + '</strong>' : '') + '</div>';
  if(alle.length) h += '<div class="fortschritt"><div style="width:' + Math.round(100 * fertig.length / alle.length) + '%"></div></div>';
  else h += '<p class="sub" style="margin:6px 0 8px">Noch keine Schritte. Teil wählen oder einen Schritt ohne Material eintragen.</p>';
  alle.forEach(p => {
    const a = p.code ? artikel(p.code) : null, ok = schrittFertig(p);
    const dauer = a ? num(a.dauer_min) * num(p.menge) : num(p.dauer_min);
    let info = p.code ? esc(p.code) + (istLeistung(p.code) ? ' · Leistung' : ' · ' + zahl(p.menge) + ' ' + esc(a ? a.einheit : '')) : 'ohne Material';
    if(dauer) info += ' · ' + dauerText(dauer);
    h += '<div class="schritt' + (ok ? ' fertig' : '') + '">';
    if(ok){
      h += '<button class="haken ja" data-a="schrittZurueck" data-x="' + p.id + '" aria-label="' + esc(schrittName(p)) + ' wieder öffnen"' + gesperrt + '>' + SVG_HAKEN + '</button>';
      h += '<div class="txt"><div class="name">' + esc(schrittName(p)) + '</div><div class="sub">' + info + '</div>' +
           '<div class="sub" style="color:var(--ok)">erledigt ' + (p.erledigt_am ? de(p.erledigt_am) : '') + (p.erledigt_von ? ' · ' + esc(p.erledigt_von) : '') + (p.status === 'gebucht' ? ' · gebucht' : '') + '</div></div>';
    } else {
      const fehlt = p.code && fehltCodes.indexOf(p.code) >= 0, lz = a ? num(a.lieferzeit_tage) : 0;
      h += '<button class="haken" data-a="schrittAb" data-x="' + p.id + '" aria-label="' + esc(schrittName(p)) + ' abhaken"' + gesperrt + '></button>';
      h += '<div class="txt"><div class="name">' + esc(schrittName(p)) + '</div><div class="sub">' + info +
           (fehlt ? ' · <span style="color:var(--warn)">fehlt' + (lz ? ', Lieferzeit ' + werktageText(lz) : '') + '</span>' : (p.code && !istLeistung(p.code) ? ' · vorhanden' : '')) + '</div></div>';
      if(p.code && !istLeistung(p.code)) h += '<input type="number" class="menge" min="0" step="any" inputmode="decimal" value="' + num(p.menge) + '" data-c="posMenge" data-x="' + p.id + '" aria-label="Menge ' + esc(schrittName(p)) + ' — 0 gibt frei"' + gesperrt + ' style="width:62px;min-height:38px;padding:4px 6px;text-align:right">';
      h += '<button class="btn small" data-a="posWeg" data-x="' + p.id + '" aria-label="' + esc(schrittName(p)) + ' entfernen"' + gesperrt + '>✕</button>';
    }
    h += '</div>';
  });
  h += '<div class="trenn" style="display:grid;gap:8px"><div class="row" style="gap:8px"><button class="btn small" data-a="scan" data-x="ticketMaterial"' + gesperrt + '>Scannen</button>';
  h += '<select data-c="tMatWahl" style="flex:1"' + gesperrt + '><option value="">Teil oder Leistung hinzufügen…</option>';
  (DB.artikel||[]).filter(a => vormerkbar(a) && a.art !== "Pauschale").forEach(a => {
    h += '<option value="' + esc(a.code) + '">' + esc(a.name) + ' — ' + zahl(greifbar(a.code, t.arbeitsort, t.id)) + ' da' + (num(a.dauer_min) ? ' · ' + a.dauer_min + ' min' : '') + '</option>';
  });
  (DB.artikel||[]).filter(a => a.aktiv && a.art === "Pauschale").forEach(a => {
    h += '<option value="' + esc(a.code) + '">' + esc(a.name) + ' (Leistung' + (num(a.dauer_min) ? ' · ' + a.dauer_min + ' min' : '') + ')</option>';
  });
  h += '</select></div>';
  h += '<div class="row" style="gap:8px"><input type="text" id="tSchritt" placeholder="Schritt ohne Material, z. B. Laufrad zentrieren" style="flex:1"' + gesperrt + '>' +
       '<input type="number" id="tSchrittMin" min="0" step="1" inputmode="numeric" placeholder="min" aria-label="Minuten (optional)" style="width:70px"' + gesperrt + '>' +
       '<button class="btn small" data-a="schrittText"' + gesperrt + '>+</button></div></div>';
  const sch = schaetzung(positionen(t.id));
  if(sch) h += '<p class="sub" style="margin:8px 0 0">Noch offen: <strong>' + schaetzText(sch) + '</strong></p>';
  if(alle.length) h += '<p class="sub" style="margin:4px 0 0">Abhaken bucht das Material sofort — das Ticket bleibt offen. Grüner Haken antippen = wieder öffnen.</p>';
  return h + '</div>';
}
const SVG_HAKEN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
function zeile(l, r){ return '<div class="row" style="padding:4px 0"><span>' + l + '</span><span class="sp"></span><span class="mono">' + r + '</span></div>'; }

/* ===============================================================
   Neues Ticket
   ===============================================================*/
function neuStart(){ neu = { art:"rad", rad:"", stuecke:[], problem:"", fahrbereit:false, soll_fertig:null, naechstmoeglich:false, anlass:"", arbeitsort:"Werkstatt", pos:[], fotos:[], zuweisen:"", aufwand:null }; }
function neuView(){
  if(!neu) neuStart();
  if(!neu.art) neu.art = "rad";
  const allg = neu.art === "allgemein";
  let h = '<button class="btn small" data-a="tab" data-x="tickets" style="margin-bottom:10px">← Alle Tickets</button>';
  h += '<h2 class="sec" style="margin-top:0">Neues Ticket</h2><div class="card">';
  if(!Array.isArray(neu.stuecke)) neu.stuecke = [];
  if(neu.wahlSuche === undefined) neu.wahlSuche = "";
  // 1. Worum geht es: Rad/Material oder allgemein (ohne Rad, z. B. Werkstatt aufräumen)
  h += '<div class="feld"><span class="lbl">Worum geht es?</span><div class="seg">' +
       segBtn("nArt", "rad", "Rad / Einzelstück", neu.art) + segBtn("nArt", "allgemein", "Allgemein", neu.art) + '</div></div>';
  if(allg) h += '<p class="sub" style="margin:-4px 0 12px">Für Aufgaben ohne Rad oder Einzelstück — z. B. Werkstatt aufräumen, Koffer packen, Bestellung einräumen.</p>';
  else h += '<div class="feld">' + wahlFeld() + '</div>';
  // 2. Was ist los
  h += '<div class="feld"><span class="lbl">' + (allg ? 'Was ist zu tun?' : 'Was ist passiert?') + '</span><textarea data-c="nProblem" placeholder="' +
       (allg ? 'Werkstatt aufräumen, Kompressor entkalken' : 'Sturz, Lenker verbogen, Rahmen prüfen') + '">' + esc(neu.problem) + '</textarea></div>';
  if(!allg && neu.rad){
    h += '<div class="feld"><span class="lbl">Rad noch fahrbereit?</span><div class="seg">';
    h += segBtn("nFahrbereit", "ja", "Ja, fährt", neu.fahrbereit ? "ja" : "nein");
    h += segBtn("nFahrbereit", "nein", "Nein, steht", neu.fahrbereit ? "ja" : "nein", "rotwahl") + '</div></div>';
  }
  // 3. Wann
  h += '<div class="feld"><span class="lbl">Soll fertig</span>' + terminWahl("n", neu.soll_fertig, neu.naechstmoeglich) + '</div>';
  h += '<div class="feld"><span class="lbl">Anlass (optional)</span><input type="text" data-c="nAnlass" value="' + esc(neu.anlass) + '" placeholder="Wettkampf, Training…"></div>';
  // 4. Wo und womit
  // Bis drei Orte als Knöpfe, sonst als Auswahlliste (ab 15.0.0 legen Manager weitere Orte an)
  h += '<div class="feld"><span class="lbl">Wo wird gearbeitet?</span>';
  if(orte().length <= 3) h += '<div class="seg">' + orte().map(o => segBtn("nOrt", o, o, neu.arbeitsort)).join("") + '</div>';
  else h += '<select data-c="nOrtWahl">' + ortOptionen(neu.arbeitsort) + '</select>';
  h += '</div>';
  h += '<div class="feld"><span class="lbl">Arbeitsschritte (optional)</span><div class="row" style="gap:8px">';
  h += '<button class="btn small" data-a="scan" data-x="neuMaterial"' + (offline ? " disabled" : "") + '>Scannen</button><select data-c="nMat" style="flex:1"><option value="">Teil wählen…</option>';
  (DB.artikel||[]).filter(vormerkbar).forEach(a => {
    const dm = num(a.dauer_min) ? a.dauer_min + " min" : "";
    h += '<option value="' + esc(a.code) + '">' + esc(a.name) + (a.art === "Pauschale" ? " (Leistung" + (dm ? " · " + dm : "") + ")" : " — " + zahl(greifbar(a.code, neu.arbeitsort)) + " da" + (dm ? " · " + dm : "")) + '</option>';
  });
  h += '</select></div>';
  if(neu.pos.length){
    h += '<div class="liste" style="margin-top:6px">';
    neu.pos.forEach((p, i) => {
      h += '<div class="eintrag">' + (p.code ? '<input type="number" class="menge" min="0" step="any" inputmode="decimal" value="' + num(p.menge) + '" data-c="nMenge" data-x="' + i + '" title="Menge">' : '') +
           '<div class="txt">' + esc(schrittName(p)) + (p.code ? '' : ' <span class="sub">· ohne Material' + (p.dauer_min ? ' · ' + p.dauer_min + ' min' : '') + '</span>') + '</div>' +
           '<button class="btn small" data-a="nMatWeg" data-x="' + i + '">entfernen</button></div>';
    });
    h += '</div>';
  }
  h += '<div class="row" style="gap:8px;margin-top:8px"><input type="text" id="nSchritt" placeholder="Schritt ohne Material, z. B. Laufrad zentrieren" style="flex:1">' +
       '<input type="number" id="nSchrittMin" min="0" step="1" inputmode="numeric" placeholder="min" aria-label="Minuten (optional)" style="width:70px">' +
       '<button class="btn small" data-a="nSchrittText">+</button></div>';
  const schN = schaetzung(neu.pos);
  if(schN) h += '<p class="sub" style="margin:8px 0 0">Geschätzter Arbeitsaufwand: <strong>' + schaetzText(schN) + '</strong></p>';
  h += '</div>';
  if(!neu.fotos) neu.fotos = [];
  h += '<div class="feld"><span class="lbl">Fotos (optional)</span>';
  if(neu.fotos.length){
    h += '<div class="fotos" style="margin-bottom:8px">';
    neu.fotos.forEach(f => h += '<div class="foto"><img src="data:image/jpeg;base64,' + f.thumb + '" alt="Foto"><button class="weg" data-a="nFotoWeg" data-x="' + f.client_id + '" aria-label="Foto entfernen">×</button></div>');
    h += '</div>';
  }
  if(neu.fotos.length < FOTOS_PRO_TICKET) h += '<label class="btn small">+ Foto<input type="file" accept="image/*" multiple hidden data-c="nFoto"></label>';
  else h += '<p class="sub" style="margin:0">Höchstens ' + FOTOS_PRO_TICKET + ' Fotos pro Ticket.</p>';
  if(offline) h += '<p class="sub" style="margin:6px 0 0">Offline: höchstens ' + FOTOS_OFFLINE + ' Fotos, sie werden mit dem Ticket nachgesendet.</p>';
  h += '</div>' + zuweisenFeld(schN);
  h += '<button class="btn primary voll" data-a="anlegen">Ticket anlegen</button></div>';
  return h;
}

/* ---------------------------------------------------------------
   „Wer macht es?“ im neuen Ticket (ab 20.5.0): gleich jemandem aus der
   Werkstatt zuweisen — dann ist das Ticket sofort in Arbeit, mit Aufwand.
   Ohne Datenbank-Update (DB.personen fehlt) bleibt alles wie bisher.
----------------------------------------------------------------*/
function zuweisenPersonen(){
  if(!Array.isArray(DB.personen)) return null;
  const l = DB.personen.slice();
  if(bearbeiter && l.indexOf(bearbeiter) < 0) l.unshift(bearbeiter);   // Gesamt-Admin u. ä.
  return l;
}
function zuweisenFeld(sch){
  const l = zuweisenPersonen();
  if(!l) return '<p class="sub">Den Arbeitsaufwand schätzt die Werkstatt beim Übernehmen.</p>';
  if(neu.zuweisen && l.indexOf(neu.zuweisen) < 0) neu.zuweisen = "";
  let h = '<div class="feld"><span class="lbl">Wer macht es?</span><select data-c="nZuweisen">' +
          '<option value=""' + (neu.zuweisen ? '' : ' selected') + '>Noch offen — übernimmt später jemand</option>';
  if(bearbeiter) h += '<option value="' + esc(bearbeiter) + '"' + (neu.zuweisen === bearbeiter ? ' selected' : '') + '>Ich (' + esc(bearbeiter) + ')</option>';
  l.filter(n => n !== bearbeiter).forEach(n => h += '<option value="' + esc(n) + '"' + (neu.zuweisen === n ? ' selected' : '') + '>' + esc(n) + '</option>');
  h += '</select></div>';
  if(!neu.zuweisen) return h + '<p class="sub">Den Arbeitsaufwand schätzt die Werkstatt beim Übernehmen.</p>';
  const vorschlag = sch ? aufwandVorschlag(sch.min) : null, akt = neu.aufwand || vorschlag || "klein";
  h += '<div class="feld"><span class="lbl">Arbeitsaufwand' + (vorschlag && !neu.aufwand ? ' <span class="sub">· Vorschlag laut Schritten</span>' : '') + '</span><div class="seg">' +
       ["klein","mittel","groß"].map(k => segBtn("nAufwand", k, k + " · " + AUFWAND[k] + " T", akt)).join("") + '</div></div>';
  return h + '<p class="sub">Das Ticket ist dann gleich in Arbeit bei ' + (neu.zuweisen === bearbeiter ? 'dir' : esc(neu.zuweisen)) + '.</p>';
}

/* ---------------------------------------------------------------
   Auswahl „Rad oder Einzelstück“ im neuen Ticket: eine Liste mit Suche.
   Räder nach Fahrer, Einzelstücke kompakt — eine Serie ist eine Zeile,
   die Nummern stehen als Knöpfe darin.
----------------------------------------------------------------*/
function wahlFeld(){
  const r = neu.rad ? rad(neu.rad) : null, st = neu.stuecke;
  let h = "";
  if(r || st.length){
    const am = r ? stueckAm(r.id) : [];
    h += '<div class="wahl-gewaehlt-liste">';
    if(r) h += '<div class="wahl-gewaehlt"><div class="txt"><strong>' + esc(r.fahrer || r.bezeichnung) + '</strong>' + (r.fahrer ? ' <span class="sub">' + esc(r.bezeichnung) + '</span>' : '') +
               '</div><button class="btn small" data-a="nRadWeg" aria-label="Rad entfernen">✕</button></div>';
    st.filter(nr => !am.some(x => x.nummer === nr)).forEach(nr => {
      const x = stueckNr(nr);
      h += '<div class="wahl-gewaehlt"><div class="txt"><strong>' + esc(nr) + '</strong> ' + esc(x ? x.typ + (x.marke ? " · " + x.marke : "") : "") + '</div>' +
           '<button class="btn small" data-a="nWahlStueck" data-x="' + esc(nr) + '" aria-label="' + esc(nr) + ' entfernen">✕</button></div>';
    });
    h += '</div>';
    // Teile am gewählten Rad: einzeln als betroffen markieren
    if(am.length){
      h += '<div class="row wrapr" style="gap:6px;margin-top:8px"><span class="sub">Teile am Rad betroffen?</span>';
      am.forEach(x => h += '<button class="btn small' + (st.indexOf(x.nummer) >= 0 ? " primary" : "") + '" data-a="nTeil" data-x="' + esc(x.nummer) + '" aria-pressed="' + (st.indexOf(x.nummer) >= 0) + '">' + esc(x.nummer) + ' ' + esc(x.typ) + '</button>');
      h += '</div>';
    }
    if(st.length){
      const schon = st.map(nr => { const tk = stueckTicket(nr); return tk ? nr + " → " + tnr(tk.id) : ""; }).filter(Boolean);
      h += '<p class="sub" style="margin:6px 0 0">' + esc(st.join(", ")) + (st.length === 1 ? ' wird' : ' werden') + ' beim Anlegen auf „zu prüfen“ gesetzt.' +
           (schon.length ? ' <strong style="color:var(--warn)">Schon in einem offenen Ticket: ' + esc(schon.join(", ")) + '.</strong>' : '') + '</p>';
    }
    if(!neu.pickerOffen) return h + '<button class="btn small" style="margin-top:8px" data-a="nPickerAuf">+ ' + (r ? 'Laufrad / Einzelstück dazu' : 'weiteres Einzelstück') + '</button>';
    h += '<div class="row" style="margin:12px 0 6px"><span class="sub" style="flex:1">Weitere dazu — Nummer antippen wählt sie an oder ab.</span><button class="btn small" data-a="nPickerZu">Liste zu</button></div>';
  }
  return h + '<div class="row" style="gap:8px"><button class="btn small" data-a="scan" data-x="neuRad">Scannen</button>' +
         '<input type="search" data-c="nWahlSuche" placeholder="' + (r ? 'Nummer oder Typ (z. B. L-209)' : 'Fahrer, Rad oder Nummer (z. B. L-203)') + '" value="' + esc(neu.wahlSuche) + '" style="flex:1"></div>' +
         '<div id="wahlListe" class="wahl-liste frei">' + wahlListe() + '</div>';
}
const RAD_TYPEN = ["Bahn", "Straße", "Zeitfahren", "Cross", "Sonstiges"];
function wahlListe(){
  const q = (neu.wahlSuche || "").trim().toLowerCase();
  const passt = t => !q || t.toLowerCase().indexOf(q) >= 0;
  const radZeile = (r, unter) => '<button class="wahl-zeile' + (unter ? ' unter' : '') + '" data-a="nWahlRad" data-x="' + esc(r.id) + '"><strong>' + esc(r.fahrer || r.bezeichnung) + '</strong>' +
    (r.fahrer ? ' <span class="sub">' + esc(r.bezeichnung) + '</span>' : '') + (unter ? '' : ' <span class="sub">· ' + esc(r.typ || "") + '</span>') + '</button>';
  let h = "";
  // Räder — ohne Suche nach Typ (Bahn, Straße …) gegliedert und zugeklappt
  const raeder = neu.rad ? [] : (DB.raeder||[]).filter(r => r.aktiv && passt([r.fahrer, r.bezeichnung, r.id, r.marke, r.typ].join(" ")))
    .sort((a,b) => (a.fahrer ? 0 : 1) - (b.fahrer ? 0 : 1) || (a.fahrer || a.bezeichnung).localeCompare(b.fahrer || b.bezeichnung, "de"));
  if(raeder.length){
    h += '<div class="wahl-kopf">Räder · ' + raeder.length + '</div>';
    if(q) raeder.forEach(r => h += radZeile(r, false));
    else {
      const gr = {};
      raeder.forEach(r => { const k = RAD_TYPEN.indexOf(r.typ) >= 0 ? r.typ : "Sonstiges"; (gr[k] = gr[k] || []).push(r); });
      const typen = RAD_TYPEN.filter(k => gr[k]), einzig = typen.length === 1;
      typen.forEach(k => {
        const offen = einzig || !!(neu.radTypOffen || {})[k];
        h += '<button class="wahl-zeile gruppe" data-a="nRadTypAuf" data-x="' + esc(k) + '" aria-expanded="' + offen + '">' + (offen ? "▾" : "▸") + ' ' + esc(k) + '<span class="anz sub">' + gr[k].length + '</span></button>';
        if(offen) gr[k].forEach(r => h += radZeile(r, true));
      });
    }
  }
  const aktiv = (DB.stueck||[]).filter(s => s.ort !== "ausgemustert").sort((a,b) => a.nummer.localeCompare(b.nummer, "de", { numeric:true }));

  if(q){
    // Suche: alle passenden Einzelstücke, auch die an einem Rad
    const treffer = aktiv.filter(s => passt([s.nummer, s.typ, s.marke, s.detail, s.rad_id ? ((rad(s.rad_id)||{}).fahrer || "") : ""].join(" ")));
    if(treffer.length) h += '<div class="wahl-kopf">Einzelstücke · ' + treffer.length + '</div>' + wahlSerien(treffer);
    return h || '<p class="sub" style="margin:8px 10px">Nichts gefunden.</p>';
  }

  // Ohne Suche: Teile an einem Rad erreicht man über das Rad. Lose Teile
  // stehen zugeklappt nach Kategorie, damit die Liste kurz bleibt.
  const lose = aktiv.filter(s => !s.rad_id);
  if(lose.length){
    h += '<div class="wahl-kopf">Einzelstücke ohne Rad · ' + lose.length + (neu.stuecke.length ? ' · ' + neu.stuecke.length + ' gewählt' : '') + '</div>';
    const kats = {};
    lose.forEach(s => (kats[stueckKategorie(s.nummer)] = kats[stueckKategorie(s.nummer)] || []).push(s));
    Object.keys(kats).sort().forEach(k => {
      const offen = !!(neu.katOffen || {})[k];
      h += '<button class="wahl-zeile gruppe" data-a="nKatAuf" data-x="' + esc(k) + '" aria-expanded="' + offen + '">' + (offen ? "▾" : "▸") + ' ' + esc(kategorieName(k)) + '<span class="anz sub">' + kats[k].length + '</span></button>';
      if(offen) h += wahlSerien(kats[k]);
    });
  }
  if(!neu.rad) h += '<p class="sub wahl-tipp">Teile an einem Rad: erst das Rad wählen. Nummer tippen oder scannen findet jedes Teil.</p>';
  return h;
}
/** Einzelstücke nach Serie gebündelt: eine Zeile je Serie, Nummern als Knöpfe. */
function wahlSerien(teile){
  const gruppen = {}, reihe = [];
  teile.forEach(s => { const k = serienSchluessel(s); if(!gruppen[k]){ gruppen[k] = []; reihe.push(k); } gruppen[k].push(s); });
  let h = "";
  reihe.forEach(k => {
    const g = gruppen[k], s0 = g[0];
    const alleGew = g.every(s => neu.stuecke.indexOf(s.nummer) >= 0);
    h += '<div class="wahl-zeile serie"><span class="txt">' + (g.length > 1 ? '<strong>' + g.length + '×</strong> ' : '') + esc(s0.typ) + (s0.marke ? ' · ' + esc(s0.marke) : '') + '</span><span class="nummern">';
    g.forEach(s => {
      const r = s.rad_id ? rad(s.rad_id) : null, gew = neu.stuecke.indexOf(s.nummer) >= 0;
      h += '<button class="btn small' + (gew ? " primary" : s.zustand !== "frei" ? " warnwahl" : "") + '" data-a="nWahlStueck" data-x="' + esc(s.nummer) + '" aria-pressed="' + gew + '" title="' +
           esc(s.zustand + (r ? " · an " + (r.fahrer || r.bezeichnung) : " · " + s.ort)) + '">' + esc(s.nummer) + (s.zustand !== "frei" ? " !" : "") +
           (r ? ' <span class="sub">· ' + esc(r.fahrer || r.bezeichnung) + '</span>' : '') + '</button>';
    });
    if(g.length > 1) h += '<button class="btn small" data-a="nWahlSerie" data-x="' + esc(g.map(s => s.nummer).join(",")) + '">' + (alleGew ? "keins" : "alle") + '</button>';
    h += '</span></div>';
  });
  return h;
}

/** Rad im neuen Ticket wählen: Teile, die an einem anderen Rad stecken, fallen raus. Die Liste klappt zu. */
function radImNeuen(id){
  neu.art = "rad";
  neu.rad = id;
  neu.stuecke = neu.stuecke.filter(n => { const x = stueckNr(n); return !x || !x.rad_id || x.rad_id === id; });
  neu.pickerOffen = false;
}
/** Einzelstück im neuen Ticket dazunehmen; steckt es an einem Rad, wird das Rad mit übernommen.
    Gibt false zurück, wenn es nicht dazu passt. */
function neuStueckWaehlen(nr, ohneRender){
  const s = stueckNr(nr); if(!s) return false;
  neu.art = "rad";
  if(s.rad_id && neu.rad && neu.rad !== s.rad_id){
    const r = rad(s.rad_id);
    toast(nr + " steckt am Rad von " + (r ? (r.fahrer || r.bezeichnung) : s.rad_id) + " — passt nicht zu diesem Ticket.", true);
    return false;
  }
  if(neu.stuecke.indexOf(nr) < 0){
    if(neu.stuecke.length && DB.tsDa === false){ toast("Mehrere Einzelstücke je Ticket gehen erst nach dem Datenbank-Update 12.0.0.", true); return false; }
    neu.stuecke.push(nr);
  }
  if(s.rad_id && !neu.rad){
    neu.rad = s.rad_id;
    const r = rad(s.rad_id);
    toast("Rad übernommen: " + (r ? (r.fahrer || r.bezeichnung) : s.rad_id));
  }
  if(!ohneRender) render();
  return true;
}
/** Antippen in der Liste: an- oder abwählen. */
function neuStueckUmschalten(nr){
  const i = neu.stuecke.indexOf(nr);
  if(i >= 0){ neu.stuecke.splice(i, 1); render(); }
  else neuStueckWaehlen(nr);
}
async function ticketAnlegen(){
  const allg = neu.art === "allgemein";
  if(!allg && !neu.rad && !neu.stuecke.length){ toast("Erst ein Rad oder Einzelstück wählen — oder oben „Allgemein“.", true); return; }
  if(!neu.problem.trim()){ toast(allg ? "Bitte kurz beschreiben, was zu tun ist." : "Bitte kurz beschreiben, was ist.", true); return; }
  const op = { p_rad:(!allg && neu.rad) || null, p_problem:neu.problem.trim(), p_fahrbereit:neu.fahrbereit,
    p_soll_fertig:neu.soll_fertig, p_naechstmoeglich:neu.naechstmoeglich, p_anlass:neu.anlass || null,
    p_arbeitsort:neu.arbeitsort, p_positionen:neu.pos, p_bearbeiter:bearbeiter || null, p_client_id:neueId(), _konto:aktivKonto };
  // Ein Teil: p_stueck (geht mit und ohne Migration 12.0.0); mehrere: p_stuecke.
  if(!allg && neu.stuecke.length === 1) op.p_stueck = neu.stuecke[0];
  else if(!allg && neu.stuecke.length > 1) op.p_stuecke = neu.stuecke.slice();
  if(neu.fotos && neu.fotos.length) op._fotos = neu.fotos;
  // Gleich zuweisen (nur mitschicken, wenn gewählt — ältere Datenbank kennt die Angaben nicht)
  if(neu.zuweisen && zuweisenPersonen()){
    const schZ = schaetzung(neu.pos);
    op.p_zuweisen = neu.zuweisen;
    op.p_aufwand = neu.aufwand || (schZ ? aufwandVorschlag(schZ.min) : null) || "klein";
  }
  const r = op.p_rad ? rad(op.p_rad) : null, name = r ? (r.fahrer || r.bezeichnung) : (op.p_stueck || op.p_stuecke ? stueckeKurz(neu.stuecke) : "");
  if(!op.p_rad) op.p_fahrbereit = true;   // ohne Rad gibt es kein „Rad steht“
  if(offline){
    const mitFotos = inWarteschlange(op);
    neu = null; view.tab = "tickets"; render();
    if(mitFotos) toast("Offline gespeichert — wird mit Netz angelegt");
    else toast("Offline gespeichert, aber ohne Fotos — der Gerätespeicher ist voll.", true);
    return;
  }
  // Reißt die Verbindung beim Senden ab, kommt das Ticket in die Warteschlange.
  // Dank Kennung entsteht kein zweites, falls es doch schon angekommen war.
  let mitFotos = true;
  const erg = await aktion(async () => {
    try{ return await ticketSenden(op); }
    catch(e){ if(e instanceof NetzFehler){ mitFotos = inWarteschlange(op); return "wartet"; } throw e; }
  }, x => x !== "wartet" ? (name ? "Ticket für " + name : "Allgemeines Ticket") + " angelegt" +
        (op.p_zuweisen ? " · " + (op.p_zuweisen === bearbeiter ? "bei dir in Arbeit" : "zugewiesen an " + op.p_zuweisen) : "") + (op._fotos ? " · " + op._fotos.length + " Foto" + (op._fotos.length === 1 ? "" : "s") : "")
        : mitFotos ? "Verbindung weg — Ticket gespeichert, wird nachgesendet" : "Verbindung weg — Ticket wird nachgesendet, Fotos passten nicht in den Gerätespeicher");
  if(erg !== undefined){ neu = null; view.tab = "tickets"; view.ticket = null; render(); }
}
function csv(zeilen, spalten){
  const zelle = v => {
    if(v == null) return "";
    if(typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "\uFEFF" + [spalten.join(";")].concat(zeilen.map(z => spalten.map(s => zelle(z[s])).join(";"))).join("\r\n");
}
function download(name, inhalt){
  const url = URL.createObjectURL(new Blob([inhalt], { type:"text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
async function exportiere(was){
  const d = iso(heute());
  try{
    // Kategorie und Tags als lesbare Spalten dazu
    const mitKat = (zeilen, nr, art) => zeilen.map(z => { const k = stueckKategorie(nr(z));
      return Object.assign({}, z, { kategorie:kategorieName(k), tags:tagsVon(art, nr(z)).map(id => (tagNachId(id) || {}).name).join(", ") }); });
    if(was === "bestand"){
      // je Lagerort eine Spalte (auch deaktivierte, falls dort noch etwas gebucht ist)
      const ortSp = lagerorte(true).map(o => o.name);
      const zeilen = mitKat(DB.bestand, z => z.code, "artikel").map(z => { const o = {}; ortSp.forEach(n => o[n] = amOrt(z, n)); return Object.assign(o, z); });
      download("bestand_" + d + ".csv", csv(zeilen, ["code","name","kategorie","tags","einheit","art"].concat(ortSp, ["lager","koffer","gesamt","reserviert","frei","mindestbestand","status","preis"])));
    }
    if(was === "stueck")  download("einzelstuecke_" + d + ".csv", csv(mitKat(DB.stueck, z => z.nummer, "stueck"),
      ["nummer","kategorie","tags","typ","marke","detail","seriennummer","kaufdatum","wert","ort","rad_id","zustand","notiz"]));
    if(was === "buchungen"){
      const b = await rest("/buchung?order=zeit");
      b.forEach(x => { x.artikel = (artikel(x.code)||{}).name || ""; x.sportler = x.sportler_id ? sportlerName(x.sportler_id) : ""; x.zeit = new Date(x.zeit).toLocaleString("de-DE"); });
      download("buchungen_" + d + ".csv", csv(b, ["id","zeit","art","code","artikel","menge","ort","sportler","ticket_id","einzelpreis","abrechnen","rechnung_id","storno_von","bearbeiter","notiz"]));
    }
    if(was === "tickets"){
      const t = await rest("/ticket?order=id");
      await stueckeAnTickets(t);
      t.forEach(x => { x.einzelstuecke = tStuecke(x).join(", "); x.nr = tnr(x.id); x.fahrer = x.fahrer_id ? sportlerName(x.fahrer_id) : ""; x.kostentraeger = x.kostentraeger_id ? sportlerName(x.kostentraeger_id) : ""; });
      download("tickets_" + d + ".csv", csv(t, ["nr","angelegt","rad_id","einzelstuecke","fahrer","problem","fahrbereit","aufwand","soll_fertig","naechstmoeglich","anlass","kostentraeger","arbeitsort","status","angelegt_von","uebernommen_von","erledigt_von","erledigt_am","storniert_von","storniert_am"]));
    }
  }catch(e){ toast(e.message, true); }
}

/* ---------------------------------------------------------------
   Fotos am Ticket. Auf dem Gerät verkleinert (lange Seite 1280 px,
   JPEG) plus Vorschaubild, gespeichert in der Datenbank. Jedes Foto
   trägt eine Kennung und kommt auch beim Nachsenden nur einmal an.
----------------------------------------------------------------*/
const FOTO_MAX = 1280, FOTO_Q = 0.7, VORSCHAU_MAX = 320, VORSCHAU_Q = 0.6, FOTOS_OFFLINE = 3,
      FOTOS_PRO_TICKET = 5;   // so prüft es auch die Datenbank (foto_hochladen)
let fotoCache = {};      // Ticket-ID → [{ id, thumb, aufgenommen, bearbeiter }] | "laedt" | "fehler"

function bildLaden(datei){
  return new Promise((ok, nein) => {
    const url = URL.createObjectURL(datei), img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); nein(new Error("Bild nicht lesbar: " + (datei.name || "Foto"))); };
    img.src = url;
  });
}
function verkleinern(img, max, q){
  const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q).split(",")[1];
}
async function fotoAufbereiten(datei){
  const img = await bildLaden(datei);
  return { client_id:neueId(), thumb:verkleinern(img, VORSCHAU_MAX, VORSCHAU_Q), bild:verkleinern(img, FOTO_MAX, FOTO_Q) };
}
function fotoHochladen(ticketId, f, wer){
  return rpc("foto_hochladen", { p_ticket:ticketId, p_thumb:f.thumb, p_bild:f.bild, p_mime:"image/jpeg", p_bearbeiter:wer || null, p_client_id:f.client_id });
}
/** Ticket samt Fotos senden. Kennungen sorgen dafür, dass Wiederholungen nichts doppelt anlegen. */
async function ticketSenden(op){
  const daten = Object.assign({}, op); delete daten._fotos; delete daten._konto;
  const sz = (op._konto && sitzungFuer(op._konto)) || undefined;
  const id = await rpc("ticket_anlegen", daten, sz);
  for(const f of (op._fotos || [])) await rpc("foto_hochladen", { p_ticket:id, p_thumb:f.thumb, p_bild:f.bild, p_mime:"image/jpeg", p_client_id:f.client_id }, sz);
  return id;
}
async function ladeFotos(tid){
  if(fotoCache[tid] === "laedt") return;
  fotoCache[tid] = "laedt";
  try{ fotoCache[tid] = await rest("/foto?ticket_id=eq." + tid + "&select=id,thumb,aufgenommen,bearbeiter&order=id"); }
  catch(e){ fotoCache[tid] = "fehler"; }
  if(view.tab === "tickets" && view.ticket === tid) render();
}
function fotoKarte(t){
  const f = fotoCache[t.id];
  if(f === undefined && !offline) setTimeout(() => ladeFotos(t.id), 0);
  const n = Array.isArray(f) ? f.length : 0, voll = n >= FOTOS_PRO_TICKET;
  let h = '<div class="card"><span class="lbl">Fotos' + (Array.isArray(f) ? ' (' + n + '/' + FOTOS_PRO_TICKET + ')' : '') + '</span>';
  if(offline) h += '<p class="sub" style="margin:0 0 8px">Fotos erst wieder mit Netz.</p>';
  else if(f === undefined || f === "laedt") h += '<p class="sub" style="margin:0 0 8px">lädt…</p>';
  else if(f === "fehler") h += '<p class="sub" style="margin:0 0 8px">Fotos konnten nicht geladen werden.</p>';
  else if(!f.length) h += '<p class="sub" style="margin:0 0 8px">Noch keine Fotos.</p>';
  else {
    h += '<div class="fotos">';
    f.forEach(x => h += '<button class="foto" data-a="fotoZeigen" data-x="' + x.id + '"><img src="data:image/jpeg;base64,' + x.thumb + '" alt="Foto vom ' + esc(zeitKurz(x.aufgenommen)) + '"></button>');
    h += '</div>';
  }
  if(!offline && voll) h += '<p class="sub" style="margin:8px 0 0">Höchstens ' + FOTOS_PRO_TICKET + ' Fotos pro Ticket — für ein neues erst eins löschen (Werkstatt-Manager).</p>';
  else if(!offline) h += '<label class="btn small" style="margin-top:8px">+ Foto<input type="file" accept="image/*" multiple hidden data-c="fotoDatei" data-x="' + t.id + '"></label>';
  return h + '</div>';
}
async function fotoZeigen(id){
  const t = ticket(view.ticket);   // nur offene Tickets stehen in DB.tickets — nur dort darf gelöscht werden
  modal('<div id="fotoGross"><p class="sub">lädt…</p></div><div class="row" style="gap:8px;margin-top:10px"><button class="btn" data-a="modalZu">Schließen</button><span class="sp"></span>' +
        (t ? '<button class="btn small" data-a="fotoLoeschen" data-x="' + id + '">Foto löschen</button>' : '') + '</div>');
  try{
    const r = (await rest("/foto?id=eq." + id + "&select=bild,mime,aufgenommen,bearbeiter"))[0];
    const el = $("fotoGross"); if(!el || !r) return;
    el.innerHTML = '<img class="fotogross" src="data:' + esc(r.mime) + ';base64,' + r.bild + '" alt="Foto">' +
                   '<p class="sub" style="margin:6px 0 0">' + zeitKurz(r.aufgenommen) + (r.bearbeiter ? ' · ' + esc(r.bearbeiter) : '') + '</p>';
  }catch(e){ modalZu(); toast(e.message, true); }
}
