/* js/verwaltung.js — Verwaltung und Mehr: Stammdaten, Abrechnung, Lagerorte, Formulare,
   automatische Nummern, Rechnung drucken.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Verwaltung — Stammdaten, Trainer, Rechnungen, Export
   ===============================================================*/
/** Verwaltung → Etiketten: Druckliste und Sammel-Auswahl (z. B. zum Start alles auf einmal). */
function etikettenVerw(){
  const dl = druckliste(), anz = drucklisteAnzahl();
  let h = '<div class="card"><div class="row wrapr" style="gap:8px"><strong>Druckliste · ' + anz + ' Etikett' + (anz === 1 ? '' : 'en') + '</strong><span class="sp"></span>' +
          (dl.length ? '<button class="btn small" data-a="dlLeeren">leeren</button><button class="btn small primary" data-a="dlDrucken">Drucken …</button>' : '') + '</div>';
  if(dl.length){
    h += '<div class="liste" style="margin-top:8px">';
    dl.forEach(e => {
      const it = etikettAus(e);
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(it ? it.titel : e.id) + '</strong> <span class="sub">' + esc(it ? it.zeile : "gibt es nicht mehr") + '</span></div>' +
           ((e.n || 1) > 1 ? '<span class="chip grau">× ' + e.n + '</span>' : '') +
           '<button class="btn small link" data-a="dlEntfernen" data-x="' + esc(e.typ + "|" + e.id) + '">entfernen</button></div>';
    });
    h += '</div>';
  } else h += '<p class="sub" style="margin:6px 0 0">Leer. Etiketten sammeln mit „auf Druckliste“ im Druck-Dialog oder unten auswählen.</p>';
  h += '</div>';

  // Sammel-Auswahl
  const block = (key, titel, zeilen) => {
    if(!zeilen.length) return "";
    let b = '<div class="card"><div class="row wrapr" style="gap:8px"><strong>' + titel + '</strong><span class="sp"></span>' +
            '<button class="btn small link" data-a="dlAlle" data-x="' + key + '">alle</button><button class="btn small link" data-a="dlKeine" data-x="' + key + '">keine</button></div><div class="liste" style="margin-top:6px">';
    zeilen.forEach(z => b += '<label class="eintrag" style="cursor:pointer"><input type="checkbox" data-dl="' + key + '" value="' + esc(z.wert) + '" style="width:20px;height:20px">' +
                            '<div class="txt">' + z.html + '</div></label>');
    return b + '</div></div>';
  };
  h += '<h2 class="sec">Etiketten auswählen</h2>';
  h += block("rad", "Räder (QR → neues Ticket)", (DB.raeder||[]).filter(r => r.aktiv).map(r => ({ wert:"rad|" + r.id, html:'<strong>' + esc(r.id) + '</strong> ' + esc(r.bezeichnung) + (r.fahrer ? ' <span class="sub">· ' + esc(r.fahrer) + '</span>' : '') })));
  const teile = (DB.stueck||[]).filter(s => s.ort !== "ausgemustert").sort((a, b) => a.nummer.localeCompare(b.nummer, "de", { numeric:true }));
  const gruppen = {}, reihe = [];
  teile.forEach(s => { const k = serienSchluessel(s); if(!gruppen[k]){ gruppen[k] = []; reihe.push(k); } gruppen[k].push(s); });
  h += block("stueck", "Einzelstücke", reihe.map(k => { const g = gruppen[k];
    return { wert:g.map(s => "stueck|" + s.nummer).join(","), html:(g.length > 1 ? '<strong>' + g.length + '×</strong> ' : '<strong>' + esc(g[0].nummer) + '</strong> ') + esc(g[0].typ) + (g[0].marke ? ' · ' + esc(g[0].marke) : '') +
             (g.length > 1 ? ' <span class="sub">· ' + esc(nummernText(g.map(s => s.nummer))) + '</span>' : '') }; }));
  h += block("artikel", "Lager-Artikel (Regal-Etiketten)", (DB.artikel||[]).filter(a => a.aktiv && a.art !== "Pauschale").map(a => ({ wert:"artikel|" + a.code, html:'<strong>' + esc(a.code) + '</strong> ' + esc(a.name) })));
  h += '<button class="btn primary voll" data-a="dlAuswahl">Auswahl zur Druckliste</button>';
  h += '<p class="sub">Die Druckliste liegt auf diesem Gerät. Drucken füllt die Bögen der Reihe nach — beim angefangenen Bogen das erste freie Feld angeben.</p>';
  return h;
}


function sportlerVerw(){
  let h = '<div class="card"><span class="lbl">Neuer Sportler</span><div class="row" style="gap:8px"><input type="text" id="sName" placeholder="Name">' +
          '<button class="btn primary" data-a="sportlerNeu">Anlegen</button></div>' +
          '<p class="sub" style="margin:8px 0 0">Kostenträger wie LV oder BSP ebenfalls hier anlegen und „nicht abrechnen“ setzen.</p></div>';
  h += '<div class="card liste">';
  if(!(DB.sportler||[]).length) h += '<div class="sub">Noch niemand angelegt.</div>';
  (DB.sportler||[]).forEach(s => {
    const leih = ausgeliehenVon(s.id);
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(s.name) + '</strong>' + (s.aktiv ? "" : ' <span class="chip grau">inaktiv</span>') +
         (leih.length ? '<br><span class="sub">hat ausgeliehen: ' + esc(leihText(leih)) + '</span>' : '') + '</div>';
    h += '<div class="knoepfe"><button class="btn small" data-a="sportlerAbr" data-x="' + s.id + '">' + (s.abrechnen ? "wird berechnet" : "nicht abrechnen") + '</button>';
    h += '<button class="btn small" data-a="sportlerAktiv" data-x="' + s.id + '">' + (s.aktiv ? "ausblenden" : "einblenden") + '</button>';
    if(darf("manager") && s.abrechnen && s.aktiv) h += '<button class="btn small" data-a="sportlerZugang" data-x="' + s.id + '">Zugang</button>';
    h += '</div></div>';
  });
  return h + '</div>';
}
/** Räder & Teile: Liste der Räder oder der Einzelstücke; ein Rad antippen öffnet die Rad-Seite. */
function raederView(){
  if(view.rad && rad(view.rad)) return radSeite(view.rad);
  view.rad = null;
  const nTeile = (DB.stueck||[]).filter(s => s.ort !== "ausgemustert").length;
  let h = '<div class="seg" style="margin-bottom:12px">' + segBtn("rt", "raeder", "Räder · " + (DB.raeder||[]).filter(r => r.aktiv).length, view.rt) +
          segBtn("rt", "teile", "Einzelstücke · " + nTeile, view.rt) + '</div>';
  if(view.rt === "teile") return h + inventarView();
  const gesperrt = offline ? " disabled" : "";
  h += '<div class="feld"><input type="search" data-c="suche" placeholder="Fahrer, Rad-ID, Marke" value="' + esc(view.suche) + '"></div>';
  const q = view.suche.toLowerCase();
  // Sortierung: Standard = aktive zuerst, mit Fahrer zuerst, nach Name; sonst nach Nummer bzw. letzter Änderung (aktive bleiben vorn)
  const sArt = sortArt("rad"), zeit = r => geaendertZeit(r);
  h += sortZeile("rad", "Fahrer");
  const gefunden = (DB.raeder||[]).filter(r => !q || [r.fahrer, r.bezeichnung, r.id, r.marke, r.typ].join(" ").toLowerCase().indexOf(q) >= 0);
  if(sArt === "geaendert") h += geaendertFehlt(gefunden, zeit);
  const liste = sArt === "standard"
    ? gefunden.sort((a, b) => (b.aktiv ? 1 : 0) - (a.aktiv ? 1 : 0) || (a.fahrer ? 0 : 1) - (b.fahrer ? 0 : 1) || (a.fahrer || a.bezeichnung).localeCompare(b.fahrer || b.bezeichnung, "de"))
    : nachArt(gefunden, sArt, r => r.id, zeit).sort((a, b) => (b.aktiv ? 1 : 0) - (a.aktiv ? 1 : 0));
  if(!liste.length) h += '<div class="leer">' + ((DB.raeder||[]).length ? "Nichts gefunden." : "Noch keine Räder angelegt.") + '</div>';
  else {
    h += '<div class="card" style="padding-top:2px;padding-bottom:2px">';
    liste.forEach(r => {
      const tk = (DB.tickets||[]).filter(t => t.rad_id === r.id), steht = tk.some(t => !t.fahrbereit);
      h += '<button class="zeile-btn" data-a="radAuf" data-x="' + esc(r.id) + '"><span class="txt"><span class="titel">' + esc(r.fahrer || "ohne Fahrer") +
           ' <span class="sub" style="font-weight:400">' + esc(r.id) + ' · ' + esc(r.bezeichnung) + '</span></span><span class="chips" style="margin-top:4px">' +
           (!r.aktiv ? '<span class="chip grau">inaktiv</span>' : steht ? '<span class="chip alarm">steht</span>' : '<span class="chip ok">fährt</span>') +
           (tk.length ? '<span class="chip warn">' + tk.length + ' Ticket' + (tk.length === 1 ? '' : 's') + '</span>' : '') +
           (stueckAm(r.id).length ? '<span class="chip grau">' + stueckAm(r.id).length + (stueckAm(r.id).length === 1 ? ' Teil' : ' Teile') + '</span>' : '') +
           (sArt === "geaendert" && geaendertText(r) ? '<span class="sub" style="font-size:12px;align-self:center">' + esc(geaendertText(r)) + '</span>' : '') + '</span></span>' + SVG_PFEIL + '</button>';
    });
    h += '</div>';
  }
  h += '<div class="row wrapr" style="gap:8px;margin-top:10px"><button class="btn" data-a="radNeu"' + gesperrt + '>+ Neues Rad</button>' +
       '<button class="btn" data-a="radEtikettenAlle">QR-Etiketten aller Räder</button></div>';
  return h;
}
const SVG_PFEIL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#545B64" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/* ---------------------------------------------------------------
   Rad-Seite: Fahrer, Teile am Rad (tauschen), offene Tickets, Verlauf
----------------------------------------------------------------*/
let verlaufCache = {};   // Rad-ID → [{ ticket…, schritte:[…] }] | "laedt" | "fehler"
async function ladeVerlauf(id){
  if(verlaufCache[id] === "laedt") return;
  verlaufCache[id] = "laedt";
  try{
    const t = await rest("/ticket?rad_id=eq." + encodeURIComponent(id) + "&status=in.(erledigt,storniert)&order=id.desc&limit=15&select=id,problem,status,angelegt,erledigt_am,erledigt_von,storniert_am");
    const pos = t.length ? await rest("/ticket_position?ticket_id=in.(" + t.map(x => x.id).join(",") + ")&status=in.(gebucht,erledigt)&select=ticket_id,code,titel,menge&order=id") : [];
    t.forEach(x => x.schritte = pos.filter(p => p.ticket_id === x.id));
    verlaufCache[id] = t;
  }catch(e){ verlaufCache[id] = "fehler"; }
  if(view.tab === "raeder" && view.rad === id) render();
}
function radSeite(id){
  const r = rad(id), gesperrt = offline ? " disabled" : "";
  const tk = sortiert((DB.tickets||[]).filter(t => t.rad_id === id)), steht = tk.some(t => !t.fahrbereit);
  let h = '<button class="btn small zurueck" data-a="radZu">← Räder &amp; Teile</button>';
  h += '<div class="card"><div class="row wrapr"><span class="big" style="font-size:26px">' + esc(r.bezeichnung) + '</span><span class="sp"></span>' +
       (!r.aktiv ? '<span class="chip grau">inaktiv</span>' : steht ? '<span class="chip alarm">steht</span>' : '<span class="chip ok">fährt</span>') + '</div>';
  h += '<p class="sub" style="margin:2px 0 10px">' + esc([r.id, r.typ, r.marke, r.groesse ? "Größe " + r.groesse : "", r.rahmennummer ? "Rahmen " + r.rahmennummer : "", r.eigentuemer_id ? "gehört " + sportlerName(r.eigentuemer_id) : ""].filter(Boolean).join(" · ")) + '</p>';
  h += '<div class="row" style="gap:8px"><span class="lbl" style="margin:0">Fahrer</span><select data-c="radFahrer" data-x="' + esc(r.id) + '" style="flex:1"' + gesperrt + '><option value="">— kein Fahrer —</option>';
  (DB.sportler||[]).filter(s => s.aktiv || s.id === r.fahrer_id).forEach(s => h += '<option value="' + s.id + '"' + (r.fahrer_id === s.id ? " selected" : "") + '>' + esc(s.name) + (s.aktiv ? "" : " (ausgeblendet)") + '</option>');
  h += '</select></div>';
  if(r.fahrer_seit) h += '<p class="sub" style="margin:4px 0 0">fährt es seit ' + deLang(r.fahrer_seit) + '</p>';
  h += '<button class="btn rot voll" style="margin-top:12px" data-a="ticketRad" data-x="' + esc(r.id) + '">Problem melden · neues Ticket</button>';
  h += '<div class="row wrapr" style="gap:8px;margin-top:8px"><button class="btn small" data-a="radBearbeiten" data-x="' + esc(r.id) + '"' + gesperrt + '>bearbeiten</button>' +
       '<button class="btn small" data-a="radEtikett" data-x="' + esc(r.id) + '">QR-Etikett</button></div></div>';

  if(tk.length){
    h += '<h2 class="sec">Offene Tickets</h2>' + tk.map(t => ticketKarte(t, !t.fahrbereit)).join("");
  }

  const teile = stueckAm(id);
  h += '<div class="card"><span class="lbl">Teile am Rad</span>';
  if(!teile.length) h += '<p class="sub" style="margin:0 0 8px">Keine nummerierten Teile am Rad.</p>';
  else {
    h += '<div class="liste">';
    teile.forEach(s => {
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(s.nummer) + '</strong> ' + esc(s.typ) + (s.marke ? ' · ' + esc(s.marke) : '') + '<br>' +
           (s.zustand === "frei" ? '<span class="chip ok">frei</span>' : '<span class="chip alarm">' + esc(s.zustand) + '</span>') + '</div>' +
           '<div class="knoepfe"><button class="btn small" data-a="teilTausch" data-x="' + esc(s.nummer) + '"' + gesperrt + '>tauschen</button>' +
           '<button class="btn small" data-a="teilAb" data-x="' + esc(s.nummer) + '"' + gesperrt + '>abnehmen</button></div></div>';
    });
    h += '</div>';
  }
  h += '<button class="btn small" style="margin-top:8px" data-a="teilTausch" data-x=""' + gesperrt + '>+ Teil anbauen</button></div>';

  const v = verlaufCache[id];
  if(v === undefined && !offline) setTimeout(() => ladeVerlauf(id), 0);
  h += '<div class="card"><span class="lbl">Verlauf · erledigte Tickets</span>';
  if(offline) h += '<p class="sub" style="margin:0">Verlauf erst wieder mit Netz.</p>';
  else if(v === undefined || v === "laedt") h += '<p class="sub" style="margin:0">lädt…</p>';
  else if(v === "fehler") h += '<p class="sub" style="margin:0">Verlauf konnte nicht geladen werden.</p>';
  else if(!v.length) h += '<p class="sub" style="margin:0">Noch keine abgeschlossenen Tickets.</p>';
  else {
    h += '<div class="liste">';
    v.forEach(t => {
      const gem = (t.schritte || []).map(p => p.code ? (zahl(p.menge) + "× " + ((artikel(p.code) || {}).name || p.code)) : p.titel);
      h += '<div class="eintrag"><div class="txt"><strong>' + tnr(t.id) + '</strong> ' + esc(t.problem) +
           (gem.length ? '<br><span class="sub">gemacht: ' + esc(gem.join(", ")) + '</span>' : '') +
           '<br><span class="sub">' + (t.status === "erledigt" ? 'erledigt ' + deLang(t.erledigt_am) + (t.erledigt_von ? ' · ' + esc(t.erledigt_von) : '') : 'storniert ' + deLang(t.storniert_am)) + '</span></div></div>';
    });
    h += '</div>';
  }
  return h + '</div>';
}
/** Auswahl beim Tauschen/Anbauen: freie Teile (nicht am Rad, nicht ausgemustert), gleiche Kategorie zuerst. */
function teilWahl(alt){
  const r = rad(view.rad); if(!r) return;
  const kat = alt ? stueckKategorie(alt) : "";
  const frei = (DB.stueck||[]).filter(s => !s.rad_id && s.ort !== "ausgemustert")
    .sort((a, b) => (stueckKategorie(a.nummer) === kat ? 0 : 1) - (stueckKategorie(b.nummer) === kat ? 0 : 1) || a.nummer.localeCompare(b.nummer, "de", { numeric:true }));
  let h = '<h3>' + (alt ? esc(stueckText(alt)) + ' tauschen' : 'Teil anbauen') + '</h3><p class="sub" style="margin-top:-6px">' +
          (alt ? 'Neues Teil wählen — ' + esc(alt) + ' geht zurück in die Werkstatt.' : 'Freies Teil an ' + esc(r.fahrer || r.bezeichnung) + ' anbauen.') + '</p>';
  if(!frei.length) h += '<div class="leer">Kein freies Einzelstück vorhanden.</div>';
  else {
    h += '<div class="wahl-liste" style="margin-bottom:12px">';
    frei.forEach(s => h += '<button class="wahl-zeile" data-a="teilTauschOk" data-x="' + esc((alt || "") + "|" + s.nummer) + '"><strong>' + esc(s.nummer) + '</strong> ' + esc(s.typ) +
                          (s.marke ? ' · ' + esc(s.marke) : '') + ' <span class="sub">· ' + esc(s.ort) + (s.zustand !== "frei" ? ' · ' + esc(s.zustand) : '') + '</span></button>');
    h += '</div>';
  }
  modal(h + '<button class="btn voll" data-a="modalZu">Abbrechen</button>');
}

/* ===============================================================
   Mehr — Abrechnung, Stammdaten, Werkzeuge
   ===============================================================*/
function mehrGruppen(){
  const g = [
    ["Abrechnung", [["rechnungen", "Rechnungen", () => { const n = new Set((DB.offenePosten||[]).map(p => p.sportler_id)).size, o = (DB.rechnungen||[]).filter(r => r.status === "offen").length; return (n ? n + " mit offenen Posten" : "keine offenen Posten") + (o ? " · " + o + " Rechnung" + (o === 1 ? "" : "en") + " unbezahlt" : ""); }]]],
    ["Stammdaten", [["sportler", "Sportler &amp; Kostenträger", () => darf("manager") ? "Wer wird berechnet · Zugänge für Sportler" : "Wer wird berechnet, wer nicht"],
                    ["artikel", "Artikel", () => "Preise, Mindestbestand, Lieferant, Arbeitszeit"],
                    ["tags", "Tags", () => !tagDa() ? "Datenbank noch nicht aktualisiert" : (DB.tags.length ? DB.tags.length + " angelegt" : "z. B. Laufrad &amp; Reifen → Schläuche")]]],
    ["Standort", []],
    ["Werkzeuge", [["etiketten", "Etiketten &amp; Druckliste", () => { const n = drucklisteAnzahl(); return n ? "Druckliste · " + n + " Etikett" + (n === 1 ? "" : "en") : "QR-Codes für Räder, Teile, Regale"; }],
                   ["termine", "Rennen &amp; Termine", () => { const t = (DB.termine||[])[0]; return t ? t.name + " · " + deLang(t.datum) : "Koffer-Warnung vor Rennen"; }],
                   ["export", "Export", () => "CSV für Excel und Sicherung"]]]
  ];
  if(darf("manager")) g[2][1].push(["lagerorte", "Lagerorte", () => { const r = raumOrte().length, k = kofferOrte().length; return r + (r === 1 ? " Raum" : " Räume") + " · " + k + " Koffer/Werkzeugkästen"; }]);
  if(darf("manager")) g[2][1].push(["konten", "Konten &amp; Rollen", () => "Personen einladen, PIN zurücksetzen"]);
  if(darf("manager")) g[2][1].push(["radnummern", "Rad-Nummern", () => radVorlage() ? "Vorlage " + radPraefix("Bahn") + "1".padStart(radStellen(), "0") + " …" : "Standard (" + radPraefix("Bahn") + "01) · eigene Vorlage möglich"]);
  if(darf("rechnen")) g[2][1].push(["briefkopf", "Briefkopf &amp; Bank", () => (STANDORT && STANDORT.iban) ? "für die Rechnungen" : "IBAN noch nicht eingetragen"]);
  if(darf("admin")) g[2][1].push(["standorte", "Standorte", () => "Übersicht, Werkstatt-Manager einladen · Gesamt-Admin"]);
  return g.filter(x => x[1].length);
}
function mehrView(){
  if(view.mehr){
    const titel = mehrGruppen().flatMap(g => g[1]).find(x => x[0] === view.mehr);
    let h = '<button class="btn small zurueck" data-a="mehrZu">← Mehr</button><h2 class="sec" style="margin-top:0">' + (titel ? titel[1] : "") + '</h2>';
    if(offline) return h + '<div class="leer">Offline — erst wieder mit Netz.</div>';
    const v = view.mehr;
    return h + (v === "rechnungen" ? rechnungenVerw() : v === "sportler" ? sportlerVerw() : v === "artikel" ? artikelVerw() : v === "tags" ? ukVerw() : v === "konten" ? kontenVerw() : v === "briefkopf" ? briefkopfVerw() : v === "radnummern" ? radNummernVerw() : v === "standorte" ? standorteVerw() : v === "lagerorte" ? lagerorteVerw() :
                v === "etiketten" ? etikettenVerw() : v === "termine" ? termineView() : exportVerw());
  }
  let h = "";
  mehrGruppen().forEach(g => {
    h += '<h2 class="sec" style="margin-top:6px">' + g[0] + '</h2><div class="card" style="padding-top:0;padding-bottom:0">';
    g[1].forEach(x => h += '<button class="zeile-btn" data-a="geheMehr" data-x="' + x[0] + '"><span class="txt"><span class="titel">' + x[1] + '</span><span class="sub">' + esc(x[2]()) + '</span></span>' + SVG_PFEIL + '</button>');
    h += '</div>';
  });
  return h;
}

/* ===============================================================
   Mehr → Lagerorte (ab 15.0.0, nur Werkstatt-Manager)
   ===============================================================*/
function lagerorteVerw(){
  const g = offline ? " disabled" : "";
  const alle = lagerorte(true);
  let h = "";
  [["raum", "Räume", "Lagerbestand: daraus kommt „frei“, Reservierungen und Nachbestellen."],
   ["bekleidung", "Bekleidung", "Wie ein Raum, dazu Ausleihe an Sportler mit Größen (Material → Bekleidung)."],
   ["koffer", "Koffer &amp; Werkzeugkästen", "Zum Mitnehmen: Packliste mit Soll/Ist, Warnung vor Rennen."]].forEach(([art, titel, text]) => {
    const l = alle.filter(o => o.art === art && o.aktiv);
    h += '<h2 class="sec">' + titel + '</h2><p class="sub" style="margin-top:-6px">' + text + '</p><div class="card liste">';
    if(!l.length) h += '<div class="sub">' + (art === "bekleidung" ? 'Noch kein Bekleidungslager — „Neuer Lagerort“, Art „Bekleidung“.' : 'Noch keine angelegt.') + '</div>';
    l.forEach((o, i) => {
      const n = (DB.bestand||[]).filter(b => amOrt(b, o.name) !== 0).length;
      const st = (DB.stueck||[]).filter(s => s.ort === o.name).length;
      const pl = (DB.koffer||[]).filter(k => k.ort === o.name).length;
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(o.name) + '</strong>' +
           (o.haupt ? ' <span class="chip grau">Hauptraum</span>' : '') + (o.aktiv ? '' : ' <span class="chip grau">deaktiviert</span>') +
           '<br><span class="sub">' + n + ' Artikel' + (st ? ' · ' + st + ' Einzelstück' + (st === 1 ? '' : 'e') : '') + (art === "koffer" ? ' · Packliste ' + pl : '') + '</span></div>';
      if(!o.haupt){
        h += '<div class="knoepfe">';
        if(i > 0 && !l[i - 1].haupt) h += '<button class="btn small" data-a="ortHoch" data-x="' + o.id + '" aria-label="Nach oben: ' + esc(o.name) + '"' + g + '>↑</button>';
        h += '<button class="btn small" data-a="ortBearbeiten" data-x="' + o.id + '"' + g + '>bearbeiten</button></div>';
      }
      h += '</div>';
    });
    h += '</div>';
  });
  // Deaktivierte Orte: zugeklappt unten (bleiben für alte Buchungen erhalten)
  const aus = alle.filter(o => !o.aktiv);
  if(aus.length){
    h += '<button class="btn small link" data-a="ortAusZeigen" style="margin-top:10px">' + (view.ortAus ? 'Deaktivierte ausblenden' : 'Deaktivierte zeigen · ' + aus.length) + '</button>';
    if(view.ortAus){
      h += '<div class="card liste" style="margin-top:8px">';
      aus.forEach(o => h += '<div class="eintrag"><div class="txt"><strong>' + esc(o.name) + '</strong> <span class="chip grau">deaktiviert</span><br><span class="sub">' +
                            (o.art === "koffer" ? "Koffer / Werkzeugkasten" : o.art === "bekleidung" ? "Bekleidung" : "Raum") + '</span></div><div class="knoepfe">' +
                            '<button class="btn small" data-a="ortBearbeiten" data-x="' + o.id + '"' + g + '>bearbeiten</button></div></div>');
      h += '</div>';
    }
  }
  h += '<button class="btn primary" data-a="ortBearbeiten" data-x=""' + g + ' style="margin-top:12px;display:block">Neuer Lagerort</button>';
  h += '<p class="sub">Die Werkstatt ist an jedem Standort der Hauptraum und bleibt fest. Umbenennen zieht in allen Buchungen, Tickets und Packlisten nach. ' +
       'Löschen geht nur, solange an einem Ort nie gebucht wurde (auch eine Buchung, die später zurückgebucht wurde, zählt) — sonst deaktivieren: vorher leer räumen, dann verschwindet der Ort aus allen Listen.</p>';
  return h;
}
let ortArtWahl = "raum";
function formLagerort(id){
  const o = id ? (DB.lagerorte||[]).find(x => x.id === id) : { name:"", art:"raum", aktiv:true };
  if(!o) return;
  ortArtWahl = o.art;
  const benutzt = id && ((DB.bestand||[]).some(b => amOrt(b, o.name) !== 0) || (DB.stueck||[]).some(s => s.ort === o.name));
  modal('<h3>' + (id ? 'Lagerort bearbeiten' : 'Neuer Lagerort') + '</h3>' +
    '<div class="feld"><span class="lbl">Name</span><input type="text" id="oName" maxlength="40" value="' + esc(o.name) + '" placeholder="z. B. Kleiderkammer, Werkzeugkasten Bahn"></div>' +
    '<div class="feld"><span class="lbl">Art</span><div class="seg">' + segBtn("ortArt", "raum", "Raum", o.art) + segBtn("ortArt", "bekleidung", "Bekleidung", o.art) + segBtn("ortArt", "koffer", "Koffer", o.art) + '</div>' +
    '<p class="sub" style="margin:6px 0 0">Raum: zählt zum Lager („frei“). Bekleidung: wie ein Raum, mit Größen und Ausleihe an Sportler. Koffer/Werkzeugkasten: zum Mitnehmen, mit Packliste und Soll/Ist.</p></div>' +
    (id ? '<label class="row" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="oAktiv"' + (o.aktiv ? ' checked' : '') + ' style="width:20px;height:20px"> aktiv (in Auswahllisten)</label>' +
          (benutzt ? '<p class="sub" style="margin-top:-6px">Hier liegt noch etwas — zum Deaktivieren erst umbuchen oder per Inventur auf 0 setzen.</p>' : '') : '') +
    '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-a="modalZu">Abbrechen</button>' +
    (id ? '<button class="btn" data-a="ortLoeschen" data-x="' + id + '">Löschen</button>' : '') +
    '<span class="sp"></span><button class="btn primary" data-a="ortSpeichern" data-x="' + (id || "") + '">' + (id ? 'Speichern' : 'Anlegen') + '</button></div>');
  setTimeout(() => { const e = $("oName"); if(e && !id) e.focus(); }, 50);
}

function termineView(){
  const gesperrt = offline ? " disabled" : "";
  let h = "";
  h += '<div class="card">';
  if(!(DB.termine||[]).length) h += '<p class="sub" style="margin:0 0 10px">Keine Termine eingetragen. Mit Termin warnt die App zehn Tage vorher, wenn im Koffer etwas fehlt.</p>';
  else {
    h += '<div class="liste">';
    DB.termine.forEach(t => h += '<div class="eintrag"><div class="txt"><strong>' + deLang(t.datum) + '</strong> ' + esc(t.name) + '<br><span class="sub">' + esc(t.koffer || "kein Koffer") + '</span></div>' +
      '<button class="btn small" data-a="terminWeg" data-x="' + t.id + '"' + gesperrt + '>löschen</button></div>');
    h += '</div>';
  }
  h += '<div class="trenn"><div class="grid2"><div class="feld"><span class="lbl">Datum</span><input type="date" id="tDatum"></div>' +
       '<div class="feld"><span class="lbl">Koffer</span><select id="tKoffer">' + kofferOrte().map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join("") + '<option value="">keiner</option></select></div></div>' +
       '<div class="feld"><span class="lbl">Rennen</span><input type="text" id="tName" placeholder="z. B. LM Bahn Cottbus"></div>' +
       '<button class="btn" data-a="terminNeu"' + gesperrt + '>Termin eintragen</button></div></div>';
  return h;
}
function artikelVerw(){
  let h = '<button class="btn primary" data-a="artikelNeu" style="margin-bottom:10px">Neuer Artikel</button><div class="card liste">';
  if(!(DB.artikel||[]).length) h += '<div class="sub">Noch keine Artikel angelegt.</div>';
  (DB.artikel||[]).forEach(a => {
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(a.name) + '</strong> <span class="sub">' + esc(a.code) + ' · ' + esc(a.art) + ' · ' + eur(a.preis) +
         (a.lieferzeit_tage ? ' · Lieferzeit ' + werktageText(num(a.lieferzeit_tage)) : '') + '</span>' + (a.aktiv ? "" : ' <span class="chip grau">inaktiv</span>') + '</div>';
    h += '<button class="btn small" data-a="artikelBearbeiten" data-x="' + esc(a.code) + '">bearbeiten</button></div>';
  });
  return h + '</div>';
}
/** Mehr → Tags: erst die Kategorien, antippen öffnet deren Tag-Liste. */
function tagAnzahl(id){
  return { a:(DB.artikelTags||[]).filter(z => z.tag_id === id).length, s:(DB.stueckTags||[]).filter(z => z.tag_id === id).length };
}
function ukVerw(){
  if(!tagDa()) return '<div class="card"><p style="margin:0">Für Tags muss die Datenbank einmal aktualisiert werden: <span class="mono">db/migration_11.0.0.sql</span> im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.</p></div>';
  const k = view.ukKat;
  if(!k){
    let h = '<div class="card" style="padding-top:0;padding-bottom:0">';
    kategorien("artikel").forEach(([b, name]) => {
      const l = tagListe(b);
      h += '<button class="zeile-btn" data-a="ukKatAuf" data-x="' + esc(b) + '"><span class="txt"><span class="titel">' + esc(name || "Kategorie " + b) + ' <span class="sub">· ' + esc(b) + '</span></span>' +
           '<span class="sub">' + (l.length ? esc(l.map(t => t.name).join(", ")) : "keine Tags") + '</span></span>' + SVG_PFEIL + '</button>';
    });
    return h + '</div><p class="sub">Tags gehören zu einer Kategorie (dem Buchstaben im Code). Ein Artikel oder Teil kann mehrere Tags seiner Kategorie haben, z. B. Kettenblattschrauben unter „Kurbel“ und „Kleinteile“. Codes und Etiketten bleiben gleich.</p>';
  }
  const l = tagListe(k);
  let h = '<button class="btn small zurueck" data-a="ukKatZu">← alle Kategorien</button>' +
          '<div class="row" style="gap:8px;align-items:center;margin:4px 0 10px"><h3 style="margin:0">' + esc(kategorieName(k)) + ' <span class="sub">· ' + esc(k) + '</span></h3>' +
          (katDa() ? '<span class="sp"></span><button class="btn small" data-a="katUmbenennen" data-x="' + esc(k) + '">Name ändern</button>' : '') +
          '</div><div class="card"><div class="liste">';
  if(!l.length) h += '<div class="sub">Noch keine Tags.</div>';
  l.forEach((t, i) => {
    const n = tagAnzahl(t.id);
    const txt = [n.a ? n.a + " Artikel" : "", n.s ? n.s + " Teile" : ""].filter(Boolean).join(" · ") || "leer";
    // Umbenennen, Löschen und Reihenfolge: nur Werkstatt-Manager; Trainer sehen die Tags als Liste
    h += '<div class="eintrag">' + (darf("manager")
           ? '<button class="lzeile" data-a="ukUmbenennen" data-x="' + t.id + '"><strong>' + esc(t.name) + '</strong><br><span class="sub">' + txt + '</span></button>'
           : '<div class="txt"><strong>' + esc(t.name) + '</strong><br><span class="sub">' + txt + '</span></div>') +
         (i ? '<button class="btn small" data-a="ukHoch" data-x="' + t.id + '" aria-label="' + esc(t.name) + ' nach oben">↑</button>' : '') + '</div>';
  });
  h += '</div>' + (darf("manager") ? '<p class="sub" style="margin:8px 0 0">Name antippen: umbenennen oder löschen. ↑ ändert die Reihenfolge der Filter und Überschriften.</p>' : '') +
       '<div class="row" style="gap:8px;margin-top:10px"><input type="text" id="ukNeuName" placeholder="Neuer Tag, z. B. Schläuche" style="flex:1">' +
       '<button class="btn primary" data-a="ukNeu" data-x="' + esc(k) + '">Hinzufügen</button></div></div>';
  if(l.length){
    const ohneA = (DB.artikel||[]).filter(a => a.aktiv && stueckKategorie(a.code) === k && !tagsVon("artikel", a.code).length).length;
    const ohneS = (DB.stueck||[]).filter(s => s.ort !== "ausgemustert" && stueckKategorie(s.nummer) === k && !tagsVon("stueck", s.nummer).length).length;
    h += '<h2 class="sec">Zuordnen</h2><div class="card" style="padding-top:0;padding-bottom:0">' +
         '<button class="zeile-btn" data-a="ukZuordnen" data-x="artikel|' + esc(k) + '"><span class="txt"><span class="titel">Lager-Artikel</span><span class="sub">' + (ohneA ? ohneA + " ohne Tag" : "alle haben Tags") + '</span></span>' + SVG_PFEIL + '</button>' +
         '<button class="zeile-btn" data-a="ukZuordnen" data-x="stueck|' + esc(k) + '"><span class="txt"><span class="titel">Einzelstücke</span><span class="sub">' + (ohneS ? ohneS + " ohne Tag" : "alle haben Tags") + '</span></span>' + SVG_PFEIL + '</button></div>';
  }
  return h;
}
/** Einen Tag vielen Artikeln/Einzelstücken einer Kategorie auf einmal geben oder wegnehmen:
    Tag wählen — angehakt ist, wer ihn schon hat. */
let uzZeilen = [];
function ukZuordnenDialog(x){
  const [tab, k] = x.split("|"), l = tagListe(k);
  if(!l.length) return;
  if(tab === "artikel"){
    uzZeilen = katSortieren("l", (DB.bestand||[]).filter(b => b.aktiv && stueckKategorie(b.code) === k), b => b.code).map(b => {
      const ids = tagsVon("artikel", b.code);
      return { werte:[b.code], ids, html:'<strong>' + esc(b.name) + '</strong> <span class="sub">' + esc(b.code) + '</span>' };
    });
  } else {
    // Serien als eine Zeile
    const gruppen = {}, reihe = [];
    katSortieren("inv", (DB.stueck||[]).filter(s => s.ort !== "ausgemustert" && stueckKategorie(s.nummer) === k), s => s.nummer).forEach(s => {
      const key = serienSchluessel(s); if(!gruppen[key]){ gruppen[key] = []; reihe.push(key); } gruppen[key].push(s);
    });
    uzZeilen = reihe.map(key => {
      const g = gruppen[key];
      return { werte:g.map(s => s.nummer), ids:tagsVon("stueck", g[0].nummer),
               html:(g.length > 1 ? '<strong>' + g.length + '×</strong> ' : '<strong>' + esc(g[0].nummer) + '</strong> ') + esc(g[0].typ) + (g[0].marke ? ' · ' + esc(g[0].marke) : '') +
                    (g.length > 1 ? ' <span class="sub">' + esc(nummernText(g.map(s => s.nummer))) + '</span>' : '') };
    });
  }
  if(!uzZeilen.length){ toast("In " + kategorieName(k) + " gibt es keine " + (tab === "artikel" ? "Artikel." : "Einzelstücke."), true); return; }
  let h = '<h3>Zuordnen · ' + esc(kategorieName(k)) + '</h3><p class="sub" style="margin-top:-6px">Tag wählen, dann ' + (tab === "artikel" ? "Lager-Artikel" : "Einzelstücke") + ' an- oder abhaken. Angehakt = hat den Tag.</p>' +
          '<div class="feld"><span class="lbl">Tag</span><select id="uzZiel" data-c="uzTag">' + l.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join("") + '</select></div>' +
          '<div class="row" style="gap:4px;justify-content:flex-end"><button class="btn small link" data-a="uzOhne">nur ohne Tag</button><button class="btn small link" data-a="uzAlle">alle</button><button class="btn small link" data-a="uzKeine">keine</button></div>' +
          '<div class="liste" id="uzListe" style="max-height:50vh;overflow:auto;margin-bottom:10px">' + uzListe(l[0].id) + '</div>' +
          '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="ukZuordnenSpeichern" data-x="' + esc(x) + '">Speichern</button></div>';
  modal(h);
}
function uzListe(tagId){
  return uzZeilen.map((z, i) => '<label class="eintrag" style="cursor:pointer"><input type="checkbox" data-uz="' + i + '" data-ohne="' + (z.ids.length ? 0 : 1) + '"' + (z.ids.indexOf(tagId) >= 0 ? " checked" : "") + ' style="width:20px;height:20px">' +
                               '<div class="txt">' + z.html + (z.ids.length ? '<br><span class="sub">' + esc(tagNamen(z.ids)) + '</span>' : '<br><span class="sub">ohne Tag</span>') + '</div></label>').join("");
}
function rechnungenVerw(){
  const summen = {};
  (DB.offenePosten||[]).forEach(p => { summen[p.sportler_id] = (summen[p.sportler_id] || 0) + (-num(p.menge) * num(p.einzelpreis)); });
  let h = '<h2 class="sec" style="margin-top:0">Offen, noch nicht berechnet</h2><div class="card liste">';
  const ids = Object.keys(summen).filter(id => summen[id] > 0);
  if(!ids.length) h += '<div class="sub">Keine offenen Posten.</div>';
  ids.forEach(id => {
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(sportlerName(Number(id))) + '</strong><br><span class="sub">' + eur(summen[id]) + '</span></div>' +
         '<div class="knoepfe"><button class="btn small" data-a="postenZeigen" data-x="' + id + '">Posten</button>' +
         '<button class="btn small primary" data-a="rechnungErstellen" data-x="' + id + '">Rechnung erstellen</button></div></div>';
  });
  h += '</div><h2 class="sec">Rechnungen</h2><div class="card liste">';
  if(!(DB.rechnungen||[]).length) h += '<div class="sub">Noch keine Rechnungen.</div>';
  (DB.rechnungen||[]).forEach(r => {
    const st = r.status === "storniert";
    h += '<div class="eintrag"><div class="txt"><strong' + (st ? ' style="text-decoration:line-through;color:var(--ink-2)"' : '') + '>' + esc(r.nummer) + '</strong> · ' + esc(sportlerName(r.sportler_id)) + '<br><span class="sub">' + deLang(r.datum) + ' · ' + eur(r.summe) + '</span></div>';
    h += '<div class="knoepfe"><button class="btn small" data-a="rechnungZeigen" data-x="' + r.id + '">anzeigen</button>';
    h += st ? '<span class="chip grau">storniert</span></div></div>'
            : '<button class="btn small' + (r.status === "offen" ? "" : " primary") + '" data-a="rechnungStatus" data-x="' + r.id + '">' + (r.status === "offen" ? "offen" : "bezahlt ✓") + '</button></div></div>';
  });
  return h + '</div>';
}
function exportVerw(){
  return '<div class="card"><p style="margin-top:0">Tabellen zum Weiterverarbeiten in Excel oder als Sicherung. Getrennt mit Semikolon, Dezimalkomma.</p>' +
    '<div style="display:grid;gap:8px"><button class="btn" data-a="export" data-x="bestand">Bestand</button>' +
    '<button class="btn" data-a="export" data-x="buchungen">Alle Buchungen</button>' +
    '<button class="btn" data-a="export" data-x="tickets">Alle Tickets</button>' +
    '<button class="btn" data-a="export" data-x="stueck">Einzelstücke</button></div></div>';
}

/* ---------------------------------------------------------------
   Formulare für Stammdaten
----------------------------------------------------------------*/
function feld(label, id, wert, typ, extra){
  return '<div class="feld"><span class="lbl">' + label + '</span><input type="' + (typ || "text") + '" id="' + id + '" value="' + esc(wert == null ? "" : wert) + '"' + (extra || "") + '></div>';
}
function auswahl(label, id, optionen, wert){
  let h = '<div class="feld"><span class="lbl">' + label + '</span><select id="' + id + '">';
  optionen.forEach(o => { const v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; h += '<option value="' + esc(v) + '"' + (String(v) === String(wert == null ? "" : wert) ? " selected" : "") + '>' + esc(t) + '</option>'; });
  return h + '</select></div>';
}
/* ---------------------------------------------------------------
   Automatische Nummern: Kategorie wählen (= Buchstabe), die Zifferngruppe
   folgt aus der Art (Stück 1xx, Vorrat 5xx, Pauschale 9xx, Einzelstück 2xx).
   Die Datenbank vergibt beim Speichern die nächste freie Nummer
   (höchste + 1). Die Vorschau zeigt, was es voraussichtlich wird.
----------------------------------------------------------------*/
const BUCHSTABEN = [["A","Antrieb"],["B","Bremse"],["C","Cockpit & Vorbau"],["L","Laufrad & Reifen"],["R","Rahmen"],["W","Werkstattmaterial"]];
const GRUPPE_FUER_ART = { "Stück":1, "Vorrat":5, "Pauschale":9 };
let nrForm = null;      // { typ:"artikel"|"stueck"|"rad", modus:"auto"|"eigen" }
let nrLauf = 0;

/** Gibt es die Tabelle kategorie (Migration 13.0.0)? */
function katDa(){ return Array.isArray(DB.kategorien); }
/** Buchstabe → Name: aus der Datenbank, sonst die festen Namen im Code. */
function katNamen(){
  const m = {};
  if(katDa()) DB.kategorien.forEach(k => m[k.buchstabe] = k.name);
  else BUCHSTABEN.forEach(b => m[b[0]] = b[1]);
  return m;
}
/** Ist der Buchstabe schon belegt — mit Namen oder in einem Code? */
function katBelegt(b){
  if(katNamen()[b]) return true;
  const re = new RegExp("^" + b + "-");
  return (DB.artikel||[]).some(a => re.test(a.code)) || (DB.stueck||[]).some(x => re.test(x.nummer));
}
/** Kategorien: alle mit Namen plus alle Buchstaben, die in Codes schon vorkommen. */
/** Kategorien, die es bei Einzelstücken nicht gibt (solange keins davon existiert). */
const NICHT_BEI_EINZELSTUECK = ["B"];
function kategorien(typ){
  const da = {}, namen = katNamen();
  Object.keys(namen).forEach(k => { if(typ !== "stueck" || NICHT_BEI_EINZELSTUECK.indexOf(k) < 0) da[k] = namen[k]; });
  const codes = typ === "stueck" ? (DB.stueck||[]).map(x => x.nummer) : (DB.artikel||[]).map(a => a.code).concat((DB.stueck||[]).map(x => x.nummer));
  codes.forEach(c => {
    const b = codeBuchstabe(c); if(b && !da[b]) da[b] = "";
  });
  return Object.keys(da).sort().map(k => [k, da[k]]);
}
function kategorieOptionen(gruppe){
  let h = '<option value="">— bitte wählen —</option>';
  kategorien(nrForm && nrForm.typ).forEach(([k, name]) => h += '<option value="' + k + '">' + esc(name || "Kategorie " + k) + ' · ' + esc(kuerzel()) + '-' + k + '-' + gruppe + 'xx</option>');
  return h + (darf("arbeiten") ? '<option value="_neu">＋ neue Kategorie …</option>' : '');
}
/** Gewählter Buchstabe — aus der Liste oder bei „neue Kategorie“ aus dem Eingabefeld. */
function nrBuchstabe(){
  const k = wert("nrKat");
  return (k === "_neu" ? wert("nrBuch") : k).toUpperCase();
}
/* Feld „Tags“ in den Formularen: Chips zum An-/Austippen. Es zeigt nur die Tags der
   gewählten Kategorie; „+ neuer Tag“ legt direkt einen in dieser Kategorie an. */
/** Kategorie-Buchstabe im offenen Formular: beim Bearbeiten fest (aus dem Code),
    beim Anlegen aus der Kategorie-Auswahl bzw. der eigenen Nummer. */
function formKat(){
  const box = $("ukBox"); if(!box) return "";
  if(box.dataset.kat) return box.dataset.kat;
  if(!nrForm) return "";
  if(nrForm.modus === "auto"){ const b = nrBuchstabe(); return /^[A-Z]{1,3}$/.test(b) ? b : ""; }
  return codeBuchstabe(mitKuerzel(wert("nrEigenWert")));
}
function tagAuswahl(kat, aktuell){
  if(!kat) return '<span class="lbl">Tags</span><p class="sub" style="margin:0">Erst Kategorie wählen.</p>';
  let h = '<span class="lbl">Tags (antippen = an/aus)</span><div class="tagwahl">';
  tagListe(kat).forEach(t => h += '<button type="button" class="btn small" data-a="tagUmschalten" data-t="' + t.id + '" aria-pressed="' + (aktuell.indexOf(t.id) >= 0) + '">' + esc(t.name) + '</button>');
  return h + '<button type="button" class="btn small link" data-a="tagNeuImFormular">+ neuer Tag</button></div>';
}
/** kat: fester Buchstabe (Bearbeiten) oder leer (folgt der Nummernwahl). */
function ukBox(kat, aktuell){
  if(!tagDa()) return "";
  return '<div class="feld" id="ukBox" data-kat="' + esc(kat || "") + '">' + tagAuswahl(kat, aktuell || []) + '</div>';
}
function tagsImFormular(){ return Array.from(document.querySelectorAll('#ukBox [data-t][aria-pressed="true"]')).map(b => Number(b.dataset.t)); }
function ukBoxAktualisieren(){
  const box = $("ukBox"); if(!box || box.dataset.kat) return;
  box.innerHTML = tagAuswahl(formKat(), tagsImFormular());
}
/** Für Speichern: undefined = kein Feld (Tags nicht anfassen), sonst die gewählten ids der Kategorie. */
function ukFormWert(){
  if(!$("ukBox")) return undefined;
  const k = formKat();
  return tagsImFormular().filter(id => { const t = tagNachId(id); return t && t.buchstabe === k; });
}
/* ---------------------------------------------------------------
   Rad-Nummern (ab 19.0.0): Jeder Standort kann eine Vorlage festlegen
   (Mehr → Rad-Nummern), z. B. HSG-TR. Dann heißen Räder
   <Kürzel>-HSG-TR-BR-0042; eingetippt wird nur die Zahl, das Kürzel
   und der feste Teil kommen automatisch davor.
----------------------------------------------------------------*/
const RAD_KUERZEL = { "Bahn":"BR", "Straße":"SR", "Zeitfahren":"ZF", "Cross":"CX", "Sonstiges":"SO" };
function radVorlage(){ return (STANDORT && STANDORT.rad_vorlage) || ""; }
function radStellen(){ return Number(STANDORT && STANDORT.rad_stellen) || 2; }
/** Fester Teil der Rad-ID ohne Kürzel, z. B. „HSG-TR-BR-“ (ohne Vorlage „BR-“). */
function radPraefix(typ){ return (radVorlage() ? radVorlage() + "-" : "") + (RAD_KUERZEL[typ] || "SO") + "-"; }
/** Rad-ID ohne Standort-Kürzel (für Anzeige und Eingabe). */
function ohneKuerzel(id){ const k = kuerzel() + "-"; return id && kuerzel() && String(id).indexOf(k) === 0 ? String(id).slice(k.length) : String(id || ""); }
/** Eingabe → volle Rad-ID. Nur Ziffern (mit Vorlage): fester Teil davor, mit Nullen aufgefüllt.
    Sonst wie eingetippt, das Kürzel kommt davor. */
function radIdAusEingabe(eingabe, typ){
  const t = String(eingabe || "").trim().toUpperCase().replace(/\s+/g, "");
  if(!t) return "";
  if(radVorlage() && /^[0-9]+$/.test(t)) return kuerzel() + "-" + radPraefix(typ) + t.padStart(radStellen(), "0");
  return mitKuerzel(t);
}
const NUMMER_FORMAT = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
/** Eingabefeld für die Rad-Nummer mit Vorlage: fester Teil davor, nur die Zahl eintippen. */
function radNummerFeld(typ, wertZahl){
  return '<div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap"><span class="mono" id="nrPraefix" style="white-space:nowrap">' + esc(radPraefix(typ)) + '</span>' +
         '<input type="text" id="nrEigenWert" data-c="nrEigen" inputmode="numeric" autocomplete="off" value="' + esc(wertZahl || "") + '" placeholder="' + "0".repeat(Math.max(radStellen() - 1, 0)) + '1" style="flex:1;min-width:0"></div>';
}
/** Nummernfeld für neue Artikel/Einzelstücke/Räder: automatisch (Standard) oder eigene Nummer.
    Räder mit Vorlage: „eigene Nummer“ ist vorgewählt (die Räder haben schon Nummern). */
function nummernWahl(typ, gruppe, radTyp){
  const vorlage = typ === "rad" && !!radVorlage(), modus = vorlage ? "eigen" : "auto";
  nrForm = { typ, modus };
  let h = '<div class="feld"><span class="lbl">' + (typ === "rad" ? "Rad-ID" : typ === "stueck" ? "Nummer" : "Code") + '</span>';
  h += '<div class="seg" style="margin-bottom:8px">' + segBtn("nrModus", "auto", "automatisch", modus) + segBtn("nrModus", "eigen", "eigene Nummer", modus) + '</div>';
  h += '<div id="nrAuto"' + (modus === "auto" ? '' : ' hidden') + '>';
  if(typ !== "rad"){
    h += '<span class="lbl">Kategorie</span><select id="nrKat" data-c="nrKat">' + kategorieOptionen(gruppe) + '</select>';
    h += '<input type="hidden" id="nrGruppe" value="' + gruppe + '">';
    h += '<div id="nrNeu" hidden style="margin-top:8px">' +
         (katDa() ? '<span class="lbl">Name der neuen Kategorie</span>' +
                    '<input type="text" id="nrKatName" maxlength="40" placeholder="z. B. Orga" data-c="nrKatName" style="margin-bottom:8px">' : '') +
         '<span class="lbl">Buchstabe im Code</span>' +
         '<input type="text" id="nrBuch" maxlength="3" autocapitalize="characters" placeholder="1–3 Buchstaben, z. B. O" data-c="nrBuch"></div>';
  }
  h += '<p class="sub" style="margin:6px 0 0" id="nrVorschau">' + (typ === "rad" ? "" : "Kategorie wählen …") + '</p></div>';
  h += '<div id="nrEigen"' + (modus === "eigen" ? '' : ' hidden') + '>';
  if(vorlage) h += radNummerFeld(radTyp || "Bahn") + '<p class="sub" style="margin:6px 0 0">Nur die Zahl eintragen, z. B. 42 → ' + esc("42".padStart(radStellen(), "0")) + '. Der Teil davor folgt aus dem Typ.</p>';
  else h += '<input type="text" id="nrEigenWert" data-c="nrEigen" autocapitalize="characters" placeholder="' + (typ === "rad" ? "z. B. BR-01" : typ === "stueck" ? "z. B. L-201 oder eigene Nummer" : "z. B. B-120") + ' — ' + esc(kuerzel()) + '- wird ergänzt">';
  return h + '</div></div>';
}
/** Anzahl im Einzelstück-Formular (1, wenn es das Feld nicht gibt). Bei mehreren Stück gilt die Seriennummer nicht. */
function serienAnzahl(){
  const e = $("eAnzahl"); if(!e) return 1;
  const n = Math.floor(Number(e.value));
  const ser = $("eSer");
  if(ser){ ser.disabled = n > 1; ser.placeholder = n > 1 ? "später je Stück eintragen" : ""; if(n > 1) ser.value = ""; }
  return n >= 1 ? n : 1;
}
async function vorschauNummer(){
  const el = $("nrVorschau"); if(!el || !nrForm || nrForm.modus !== "auto") return;
  const lauf = ++nrLauf;
  let fn, args;
  if(nrForm.typ === "rad"){ fn = "naechste_rad_id"; args = { p_typ:wert("rTyp") || "Bahn" }; }
  else {
    const b = nrBuchstabe();
    if(!b){ el.textContent = wert("nrKat") === "_neu" ? "Buchstabe eingeben …" : "Kategorie wählen …"; el.style.color = ""; return; }
    if(wert("nrKat") === "_neu"){
      if(!/^[A-Z]{1,3}$/.test(b)){ el.style.color = "var(--sprint)"; el.textContent = "Nur 1–3 Buchstaben A–Z."; return; }
      if(katBelegt(b)){ el.style.color = "var(--sprint)"; el.textContent = b + " ist schon vergeben (" + kategorieName(b) + ") — bitte oben aus der Liste wählen."; return; }
    }
    fn = "naechster_code"; args = { p_buchstabe:b, p_gruppe:Number(wert("nrGruppe")) };
  }
  el.textContent = "…";
  try{
    const nr = await rpc(fn, args);
    if(lauf !== nrLauf) return;
    const n = serienAnzahl(), m = /^(.*-)(\d+)$/.exec(nr);
    const text = n > 1 && m ? esc(nr) + '</strong> bis <strong class="mono">' + esc(m[1] + (Number(m[2]) + n - 1)) : esc(nr);
    el.style.color = ""; el.innerHTML = 'wird voraussichtlich <strong class="mono">' + text + '</strong> — endgültig beim Speichern';
  }catch(e){
    if(lauf !== nrLauf) return;
    el.style.color = "var(--sprint)"; el.textContent = e instanceof NetzFehler ? "Vorschau braucht Netz" : e.message;
  }
}
/** Neue Kategorie im Formular prüfen. Gibt null zurück (Fehler gemeldet) oder
    { b, anlegen } — anlegen() legt die Kategorie mit Namen an (nur bei „neue Kategorie“). */
function nrKategoriePruefen(){
  const b = nrBuchstabe(), neuK = wert("nrKat") === "_neu";
  if(!/^[A-Z]{1,3}$/.test(b)){ toast(b ? "Buchstabe: 1–3 Buchstaben A–Z." : "Bitte eine Kategorie wählen.", true); return null; }
  if(!neuK || !katDa()) return { b, anlegen:async () => {} };
  const name = wert("nrKatName").trim();
  if(!name){ toast("Name der neuen Kategorie fehlt.", true); return null; }
  if(katBelegt(b)){ toast(b + " ist schon vergeben (" + kategorieName(b) + ").", true); return null; }
  const namen = katNamen();
  const gleich = Object.keys(namen).find(k => namen[k].toLowerCase() === name.toLowerCase());
  if(gleich){ toast("„" + name + "“ gibt es schon (Buchstabe " + gleich + ").", true); return null; }
  return { b, anlegen:() => neuIn("kategorie", { buchstabe:b, name }) };
}
/** Gibt es die Nummer schon — als Artikel ODER als Einzelstück? (Ein Scan muss eindeutig sein.) */
function nummerVergeben(nr){ return !!artikel(nr) || (DB.stueck||[]).some(x => x.nummer === nr); }

/** Marken: Vorschläge aus dem Bestand; gleiche Marke in anderer Schreibweise wird vereinheitlicht. */
function markenListe(){
  const m = {};
  (DB.raeder||[]).concat(DB.stueck||[]).forEach(x => { if(x.marke && !m[x.marke.toLowerCase()]) m[x.marke.toLowerCase()] = x.marke; });
  return Object.values(m).sort((a,b) => a.localeCompare(b, "de"));
}
function markenDL(){ return '<datalist id="markenDL">' + markenListe().map(x => '<option value="' + esc(x) + '"></option>').join("") + '</datalist>'; }
function marke(v){
  v = (v || "").trim(); if(!v) return null;
  return markenListe().find(x => x.toLowerCase() === v.toLowerCase()) || v;
}

/** Einheiten zur Auswahl: Stück, Paar, ml – plus Einheiten, die bei Artikeln schon vorkommen (gehen beim Bearbeiten nicht verloren). */
const EINHEITEN = ["Stück","Paar","ml"];
function einheitenListe(aktuell){
  const l = EINHEITEN.slice();
  (DB.artikel||[]).map(x => x.einheit).concat([aktuell]).forEach(e => { if(e && !l.includes(e)) l.push(e); });
  return l;
}
/* Artikelformular (ab 17.1.0) in zwei Varianten: „Werkstatt“ (Teile, Vorräte,
   Leistungen) und „Bekleidung“ (Artikel mit Größen). Gezeigt wird nur, was zur
   Variante und zur Art passt; ausgeblendete Felder behalten ihren Wert.
   Steuerung über data-zeig="W K L P A" (eines davon muss zutreffen):
   W = Werkstatt, K = Bekleidung, L = mit Bestand (Bekleidung oder kein Pauschale),
   P = Pauschale (Werkstatt), A = Arbeitszeit (Werkstatt, Stück oder Pauschale). */
let artZweck = "werkstatt";
function artikelSichtbar(){
  const k = artZweck === "kleidung", art = wert("aArt") || "Stück";
  const an = { W:!k, K:k, L:k || art !== "Pauschale", P:!k && art === "Pauschale", A:!k && art !== "Vorrat" };
  document.querySelectorAll("#modal [data-zeig]").forEach(e => { e.hidden = !e.dataset.zeig.split(" ").some(t => an[t]); });
  const m = $("aMinLbl"); if(m) m.textContent = k ? "Mindestbestand je Größe" : "Mindestbestand";
}
/** Anfangsbestand je Größe (nur neue Bekleidung): ein Feld je Größe aus dem Größen-Feld, Eingaben bleiben erhalten. */
function grBestandFelder(){
  const box = $("aGrBestand"); if(!box) return;
  const alt = {};
  box.querySelectorAll("[data-agr]").forEach(e => { alt[e.dataset.agr] = e.value; });
  const gr = groessenLesenStill(wert("aGroessen"));
  box.innerHTML = gr.length
    ? gr.map(x => '<div class="feld"><span class="lbl">' + esc(x) + '</span><input type="number" min="0" step="any" inputmode="decimal" placeholder="0" data-agr="' + esc(x) + '" value="' + esc(alt[x] || "") + '"></div>').join("")
    : '<p class="sub" style="margin:0">Erst Größen eintragen.</p>';
}
function groessenLesenStill(t){
  const l = [];
  String(t || "").split(/[,;]/).map(x => x.trim()).filter(x => x && x.length <= 20).forEach(x => { if(l.indexOf(x) < 0) l.push(x); });
  return l.slice(0, 40);
}
function artikelForm(code, zweck){
  const a = code ? artikel(code) : { code:"", name:"", einheit:"Stück", preis:0, mindestbestand:0, lieferzeit_tage:LIEFERZEIT_STANDARD, art:"Stück", aktiv:true };
  const verbrauch = [["","—"]].concat((DB.artikel||[]).filter(x => x.art === "Vorrat").map(x => [x.code, x.name]));
  if(code) nrForm = null;
  const ko = kleiderOrte();
  artZweck = code ? (hatGroessen(code) ? "kleidung" : "werkstatt") : (zweck === "kleidung" && ko.length ? "kleidung" : "werkstatt");
  const wahl = ko.length || artZweck === "kleidung";
  const preisGesperrt = code && !darf("manager");
  const bestellOffen = !!(a.lieferant || a.bestellnummer || a.shop_link || (num(a.lieferzeit_tage) && num(a.lieferzeit_tage) !== LIEFERZEIT_STANDARD));
  const artFeld = '<div class="feld" data-zeig="W"><span class="lbl">Art</span><select id="aArt" data-c="artGruppe">' +
    ["Stück","Vorrat","Pauschale"].map(x => '<option' + (a.art === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div>';
  modal('<h3>' + (code ? "Artikel bearbeiten · " + esc(code) : "Neuer Artikel") + '</h3>' +
    (wahl ? '<div class="feld"><div class="seg">' + segBtn("aZweck", "werkstatt", "Werkstatt", artZweck) + segBtn("aZweck", "kleidung", "Bekleidung", artZweck) + '</div></div>' : '') +
    artFeld + (code ? '' : nummernWahl("artikel", 1)) +
    ukBox(code ? stueckKategorie(code) : "", code ? tagsVon("artikel", code) : []) +
    feld("Bezeichnung", "aName", a.name) +
    // Bekleidung: Größen
    '<div class="feld" data-zeig="K"><span class="lbl">Größen (durch Komma getrennt)</span><input type="text" id="aGroessen" data-c="aGroessen" value="' + esc((a.groessen || []).join(", ")) + '" placeholder="z. B. XS, S, M, L, XL">' +
      '<div class="row wrapr" style="gap:6px;margin-top:6px">' + GROESSEN_VORLAGEN.map((v, i) => '<button class="btn small" data-a="grVorlage" data-x="' + i + '">' + esc(v[0]) + '</button>').join("") + '</div></div>' +
    // kleine Felder: im Raster rücken ausgeblendete Felder einfach heraus
    '<div class="grid2">' +
      auswahl("Einheit", "aEinheit", einheitenListe(a.einheit), a.einheit || "Stück") +
      feld("Preis (€)" + (preisGesperrt ? " · ändert der Manager" : ""), "aPreis", a.preis, "number", ' step="0.01" min="0"' + (preisGesperrt ? " disabled" : "")) +
      '<div class="feld" data-zeig="L"><span class="lbl" id="aMinLbl">Mindestbestand</span><input type="number" id="aMin" value="' + esc(a.mindestbestand == null ? "" : a.mindestbestand) + '" step="any" min="0"></div>' +
      '<div class="feld" data-zeig="A"><span class="lbl">Arbeitszeit (min)</span><input type="number" id="aDauer" value="' + esc(a.dauer_min == null ? "" : a.dauer_min) + '" step="1" min="0" inputmode="numeric" placeholder="z. B. 15"></div>' +
    '</div>' +
    // Anfangsbestand (nur neu)
    (code ? '' :
      '<div class="grid2" data-zeig="W"><div data-zeig="L">' + feld("Bestand jetzt", "aBestand", "", "number", ' step="any" min="0" inputmode="decimal" placeholder="0"') + '</div>' +
        '<div class="feld" data-zeig="L"><span class="lbl">liegt in</span><select id="aBestandOrt">' + ortOptionen(standardOrt(), true) + '</select></div></div>' +
      (ko.length ? '<div class="feld" data-zeig="K"><span class="lbl">Bestand jetzt je Größe' + (ko.length > 1 ? '' : ' · ' + esc(ko[0])) + '</span>' +
        (ko.length > 1 ? '<select id="aKleidOrt" style="margin-bottom:8px">' + ko.map(o => '<option' + (o === view.kOrt ? " selected" : "") + '>' + esc(o) + '</option>').join("") + '</select>' : '<input type="hidden" id="aKleidOrt" value="' + esc(ko[0]) + '">') +
        '<div class="grgrid" id="aGrBestand"></div></div>' : '')) +
    // Pauschale: Verbrauch
    '<div class="grid2" data-zeig="P">' + auswahl("Verbraucht dabei", "aVerb", verbrauch, a.verbraucht_code) + feld("Menge je Leistung", "aVerbM", a.verbrauch_menge, "number", ' step="any" min="0"') + '</div>' +
    // Bestellangaben aufklappbar
    '<details class="mehrfelder" data-zeig="L"' + (bestellOffen ? " open" : "") + '><summary>Bestellangaben' + (a.lieferant ? ' · ' + esc(a.lieferant) : '') + '</summary>' +
      '<div class="grid2">' + feld("Lieferant", "aLief", a.lieferant) + feld("Bestellnummer", "aBest", a.bestellnummer) + '</div>' +
      '<div class="grid2">' + feld("Lieferzeit (Werktage Mo–Fr)", "aLz", a.lieferzeit_tage, "number", ' step="1" min="0"') + feld("Shop-Link", "aLink", a.shop_link) + '</div></details>' +
    (code ? auswahl("Status", "aAktiv", [["true","aktiv"],["false","inaktiv"]], String(a.aktiv)) : '<input type="hidden" id="aAktiv" value="true">') +
    '<p class="sub" data-zeig="K">Bestand wird je Größe geführt; ausgegeben wird als Leihgabe an Sportler (nie berechnet).</p>' +
    (code ? '' : '<p class="sub" data-zeig="W">Die Ziffer richtet sich nach der Art: Stück 1xx, Vorrat 5xx, Pauschale 9xx.</p>') +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
    (code && darf("arbeiten") ? '<button class="btn small" data-a="nrAendern" data-x="artikel|' + esc(code) + '">Code ändern</button>' : '') +
    '<span class="sp"></span><button class="btn primary" data-a="artikelSpeichern" data-x="' + esc(code || "") + '">Speichern</button></div>');
  artikelSichtbar();
  grBestandFelder();
}
function radForm(id){
  const r = id ? rad(id) : { id:"", bezeichnung:"", typ:"Bahn", marke:"", rahmennummer:"", groesse:"", eigentuemer_id:null, aktiv:true, notiz:"" };
  const eig = [["","—"]].concat((DB.sportler||[]).map(s => [s.id, s.name]));
  if(id) nrForm = null;
  const typFeld = '<div class="feld"><span class="lbl">Typ</span><select id="rTyp" data-c="nrVorschau">' +
    ["Bahn","Straße","Zeitfahren","Cross","Sonstiges"].map(x => '<option' + (r.typ === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div>';
  modal('<h3>' + (id ? "Rad bearbeiten · " + esc(id) : "Neues Rad") + '</h3>' +
    typFeld + (id ? "" : nummernWahl("rad", 0, r.typ)) +
    '<div class="grid2">' + feld("Bezeichnung", "rBez", r.bezeichnung, "text", ' placeholder="z. B. Bahnrad 01"') + feld("Marke", "rMarke", r.marke, "text", ' list="markenDL" placeholder="z. B. Look"') + '</div>' + markenDL() +
    '<div class="grid2">' + feld("Rahmennummer", "rRahmen", r.rahmennummer) + feld("Größe", "rGr", r.groesse) + '</div>' +
    auswahl("Eigentümer (zahlt Material am Rad)", "rEig", eig, r.eigentuemer_id) +
    feld("Notiz", "rNotiz", r.notiz) + auswahl("Status", "rAktiv", [["true","aktiv"],["false","inaktiv"]], String(r.aktiv)) +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
    (id && darf("arbeiten") ? '<button class="btn small" data-a="nrAendern" data-x="rad|' + esc(id) + '">Nummer ändern</button>' : '') +
    '<span class="sp"></span><button class="btn primary" data-a="radSpeichern" data-x="' + esc(id || "") + '">Speichern</button></div>');
}
function stueckForm(nr){
  const s = nr ? (DB.stueck||[]).find(x => x.nummer === nr) : { nummer:"", typ:"", marke:"", detail:"", seriennummer:"", kaufdatum:"", wert:"", notiz:"" };
  if(nr) nrForm = null;
  modal('<h3>' + (nr ? "Einzelstück bearbeiten · " + esc(nr) : "Neues Einzelstück") + '</h3>' +
    (nr ? "" : nummernWahl("stueck", 2)) +
    ukBox(nr ? stueckKategorie(nr) : "", nr ? tagsVon("stueck", nr) : []) +
    '<div class="grid2">' + feld("Typ", "eTyp", s.typ, "text", ' placeholder="Laufrad Bahn vorne"') + feld("Marke", "eMarke", s.marke, "text", ' list="markenDL" placeholder="z. B. Mavic"') + '</div>' + markenDL() +
    feld("Detail", "eDet", s.detail) +
    (nr ? '' : '<div class="feld"><span class="lbl">Anzahl gleicher Teile</span><input type="number" id="eAnzahl" value="1" min="1" max="50" step="1" inputmode="numeric" data-c="nrVorschau" style="max-width:120px">' +
              '<p class="sub" style="margin:6px 0 0">Mehr als 1, z. B. 4 Laufräder vorne: legt alle mit fortlaufenden Nummern an.</p></div>') +
    '<div class="grid2">' + feld("Seriennummer", "eSer", s.seriennummer) + kaufFeld("eKauf", s.kaufdatum) + '</div>' +
    feld("Notiz", "eNotiz", s.notiz) +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
    (nr ? '<button class="btn small" data-a="stueckLoeschen" data-x="' + esc(nr) + '">Löschen</button><button class="btn small" data-a="stueckEtikett" data-x="' + esc(nr) + '">Etikett</button>' +
          (darf("arbeiten") ? '<button class="btn small" data-a="nrAendern" data-x="stueck|' + esc(nr) + '">Nummer ändern</button>' : '') : '') +
    '<span class="sp"></span><button class="btn primary" data-a="stueckSpeichern" data-x="' + esc(nr || "") + '">Speichern</button></div>');
}
/* ---------------------------------------------------------------
   Nummer ändern (ab 19.0.0): Artikel, Einzelstück oder Rad bekommt eine
   neue Nummer, alles Verknüpfte zieht in der Datenbank mit
   (nummer_aendern). Trainer/Mechaniker dürfen das, solange noch nichts
   gebucht bzw. kein Ticket abgeschlossen ist — sonst der Werkstatt-Manager.
----------------------------------------------------------------*/
const NR_ART_TEXT = { artikel:"Artikel", stueck:"Einzelstück", rad:"Rad" };
function nummerAendernForm(art, alt){
  const r = art === "rad" ? rad(alt) : null;
  if(art === "rad" && !r) return;
  const kurz = ohneKuerzel(alt), p = r ? radPraefix(r.typ) : "";
  const mitVorlage = !!(r && radVorlage());
  let feldH;
  if(mitVorlage){
    const zahl = kurz.indexOf(p) === 0 && /^[0-9]+$/.test(kurz.slice(p.length)) ? kurz.slice(p.length) : "";
    feldH = radNummerFeld(r.typ, zahl) + '<p class="sub" style="margin:6px 0 0">Nur die Zahl. Der Teil davor folgt aus Vorlage und Typ (' + esc(r.typ) + ') — stimmt der Typ nicht, erst im Rad ändern und speichern.</p>';
  } else {
    feldH = '<input type="text" id="nrEigenWert" autocapitalize="characters" autocomplete="off" value="' + esc(kurz) + '">' +
            '<p class="sub" style="margin:6px 0 0">' + esc(kuerzel()) + '- wird ergänzt.' + (art === "artikel" ? ' Format wie B-120.' : '') + '</p>';
  }
  modal('<h3>' + (art === "artikel" ? "Code" : "Nummer") + ' ändern · ' + esc(alt) + '</h3>' +
    '<p class="sub" style="margin-top:0">' + NR_ART_TEXT[art] + ': Buchungen, Tickets, Tags und Zuordnungen ziehen mit. Das alte Etikett passt danach nicht mehr — neues drucken.</p>' +
    '<div class="feld"><span class="lbl">Neue ' + (art === "artikel" ? "Code" : "Nummer") + '</span>' + feldH + '</div>' +
    (darf("manager") ? '' : '<p class="sub">Ist schon etwas gebucht oder ein Ticket abgeschlossen, ändert das nur der Werkstatt-Manager.</p>') +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>' +
    '<button class="btn primary" data-a="nrAendernOk" data-x="' + esc(art + "|" + alt) + '">Ändern</button></div>');
  const e = $("nrEigenWert"); if(e){ e.focus(); try{ e.select(); }catch(x){} }
}
/** Neue Nummer aus dem Formular „Nummer ändern“ (voll, mit Kürzel). */
function nummerAusFormular(art, alt){
  const eing = wert("nrEigenWert");
  if(art === "rad"){ const r = rad(alt); return radIdAusEingabe(eing, r ? r.typ : "Sonstiges"); }
  return mitKuerzel(eing);
}

/* ---------- Mehr → Rad-Nummern (Werkstatt-Manager) ---------- */
function radNummernVerw(){
  const S = STANDORT || {};
  let h = '<div class="card"><p class="sub" style="margin-top:0">Haben eure Räder schon feste Nummern, z. B. HSG-TR-BR-0042, hier den gleichbleibenden Teil eintragen (HSG-TR). ' +
          'Beim Anlegen wird dann nur noch die Zahl eingetippt; Bahn/Straße usw. kommt aus dem Typ. Das Standort-Kürzel ' + esc(kuerzel()) + '- steht intern immer davor, damit kein Etikett mit einem anderen Standort verwechselt wird.</p>';
  h += '<div class="grid2">' + feld("Fester Teil (leer = Standard)", "rnVorlage", S.rad_vorlage || "", "text", ' autocapitalize="characters" maxlength="20" placeholder="z. B. HSG-TR" data-c="radNrVorschau"') +
       '<div class="feld"><span class="lbl">Stellen der Zahl</span><select id="rnStellen" data-c="radNrVorschau">' +
       [2,3,4,5,6].map(n => '<option' + (n === radStellen() ? " selected" : "") + '>' + n + '</option>').join("") + '</select></div></div>';
  h += '<p class="sub" id="rnVorschau" style="margin:0 0 12px">' + radNrVorschauText(S.rad_vorlage || "", radStellen()) + '</p>';
  h += '<button class="btn primary" data-a="radNrSpeichern">Speichern</button>';
  h += '<p class="sub" style="margin:12px 0 0">Vorhandene Räder behalten ihre Nummer. Falsch vergebene Nummern: Rad öffnen → Bearbeiten → „Nummer ändern“.</p></div>';
  return h;
}
/** Vorschau für Vorlage v und Stellen n (beim Zeichnen aus der Datenbank, beim Tippen aus den Feldern). */
function radNrVorschauText(v, n){
  v = String(v || "").toUpperCase().replace(/\s+/g, "");
  if(v && !/^[A-Z0-9]+(-[A-Z0-9]+){0,3}$/.test(v)) return '<span style="color:var(--sprint)">Nur Buchstaben und Ziffern, Teile mit Bindestrich, z. B. HSG-TR.</span>';
  const t = (v ? v + "-" : "");
  return 'Bahnrad: <strong class="mono">' + esc(t + "BR-" + "42".padStart(n, "0")) + '</strong> · Straßenrad: <strong class="mono">' + esc(t + "SR-" + "7".padStart(n, "0")) + '</strong>';
}
function radNrVorschau(){ const e = $("rnVorschau"); if(e) e.innerHTML = radNrVorschauText(wert("rnVorlage"), Number(wert("rnStellen")) || 2); }

const wert = id => { const e = $(id); return e ? e.value.trim() : ""; };
const zahlOderNull = id => { const v = wert(id); return v === "" ? null : Number(v.replace(",", ".")); };

/* ---------------------------------------------------------------
   Rechnung drucken — mit Briefkopf des Verbands, Zahlungshinweis,
   eindeutigem Verwendungszweck und GiroCode (EPC-QR für Banking-Apps).
   Bankverbindung hier eintragen; ohne IBAN wird ein Platzhalter gedruckt.
----------------------------------------------------------------*/

/** Eindeutiger Verwendungszweck: Rechnungsnummer + Werkstatt + Nachname (max. 140 Zeichen, SEPA). */
function verwendungszweck(r){
  const name = sportlerName(r.sportler_id).trim().split(/\s+/).pop() || "";
  return (r.nummer + " Werkstatt " + name).trim().slice(0, 140);
}
function faelligAm(r){ const d = new Date(String(r.datum).slice(0,10) + "T12:00:00"); d.setDate(d.getDate() + num((STANDORT || {}).zahlungsziel_tage == null ? 14 : STANDORT.zahlungsziel_tage)); return iso(d); }
/** GiroCode nach EPC069-12 (Version 002, UTF-8, Fehlerkorrektur M). */
function giroCode(r){
  const S = STANDORT || {};
  const iban = String(S.iban || "").replace(/\s+/g, "").toUpperCase();
  if(!iban) return "";
  const text = ["BCD", "002", "1", "SCT", String(S.bic || "").replace(/\s+/g, "").toUpperCase(), String(S.rg_empfaenger || "").slice(0, 70), iban,
                "EUR" + num(r.summe).toFixed(2), "", "", verwendungszweck(r)].join("\n");
  const hints = new Map(); hints.set(ZXing.EncodeHintType.MARGIN, 0); hints.set(ZXing.EncodeHintType.ERROR_CORRECTION, "M");
  const svg = new ZXing.BrowserQRCodeSvgWriter().write(text, 200, 200, hints);
  svg.setAttribute("viewBox", "0 0 200 200"); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  return svg.outerHTML;
}
/** Bezeichnung auf der Rechnung: Leistungen (Pauschalen) mit Zusatz. Ihr Verbrauch (z. B. Bremsöl) steht nie darauf. */
function rechnungText(code){ const a = artikel(code); return a ? a.name + (a.art === "Pauschale" ? " (Leistung)" : "") : code; }
function rechnungZeitraum(pos){
  if(!pos.length) return "";
  const t = pos.map(p => iso(new Date(p.zeit))).sort(), a = t[0], b = t[t.length - 1];
  return a === b ? deLang(a) : de(a) + "–" + deLang(b);
}
async function rechnungDrucken(id){
  const r = (DB.rechnungen||[]).find(x => x.id === id); if(!r || r.status === "storniert") return;
  let pos;
  try{ pos = await rest("/buchung?rechnung_id=eq." + id + "&order=zeit"); }catch(e){ return toast(e.message, true); }
  let bilder = {};
  try{ bilder = await standortLogos(); }catch(e){}
  const S = STANDORT || {}, name = sportlerName(r.sportler_id), vz = verwendungszweck(r), qr = giroCode(r), betrag = eur(r.summe);
  const zeilen = t => String(t || "").split("\n").map(z => z.trim()).filter(Boolean);
  const kopf = zeilen(S.rg_kopf), spalten = String(S.rg_fuss || "").split(/\n\s*\n/).map(zeilen).filter(z => z.length);
  const fett = z => z.length ? '<b>' + esc(z[0]) + '</b>' + z.slice(1).map(x => '<br>' + esc(x)).join("") : "";
  let h = '<div class="rechnung">';
  if(bilder.logo) h += '<div class="logo"><img src="' + bilder.logo + '" alt=""></div>';
  h += '<div class="kopf"><div><div class="absender">' + esc(S.rg_absender || "") + '</div>' +
       '<div class="empf">' + esc(name) + '</div></div>' +
       '<div class="verein">' + fett(kopf) + '</div></div>';
  h += '<div class="daten"><div class="l">Rechnungsnummer</div><div class="l">Rechnungsdatum</div><div class="l">Leistungszeitraum</div><div class="l">Fahrer / Kostenträger</div>' +
       '<div class="w"><b>' + esc(r.nummer) + '</b></div><div class="w">' + deLang(r.datum) + '</div><div class="w">' + rechnungZeitraum(pos) + '</div><div class="w">' + esc(name) + '</div></div>';
  h += '<h1>Rechnung</h1><div>' + esc(S.rg_text || "Für Werkstattleistungen und Material berechnen wir Ihnen:") + '</div>';
  h += '<table><thead><tr><th style="width:17mm">Datum</th><th>Leistung / Material</th><th class="r" style="width:14mm">Menge</th><th class="r" style="width:22mm">Einzelpreis</th><th class="r" style="width:22mm">Betrag</th></tr></thead><tbody>';
  pos.forEach(p => {
    h += '<tr><td>' + de(iso(new Date(p.zeit))) + '</td><td>' + esc(rechnungText(p.code)) + '</td><td class="r">' + zahl(-p.menge) + '</td>' +
         '<td class="r">' + eur(p.einzelpreis) + '</td><td class="r">' + eur(-p.menge * p.einzelpreis) + '</td></tr>';
  });
  h += '</tbody></table><div class="summe"><div><span>Rechnungsbetrag</span><span>' + betrag + '</span></div></div>';
  h += '<div class="zahlung"><div style="flex:1"><div class="t">Bitte überweisen Sie ' + betrag + ' bis zum ' + deLang(faelligAm(r)) + '.</div><div class="g">' +
       '<div class="l">Empfänger</div><div>' + esc(S.rg_empfaenger || "[Empfänger fehlt]") + '</div>' +
       '<div class="l">IBAN</div><div>' + esc(S.iban || "[IBAN folgt]") + '</div>' +
       '<div class="l">BIC / Bank</div><div>' + esc([S.bic, S.bank].filter(Boolean).join(" · ") || "[BIC / Bank folgt]") + '</div>' +
       '<div class="l">Verwendungszweck</div><div class="vz">' + esc(vz) + '</div></div>' +
       '<div class="hinweis">Bitte den Verwendungszweck genau so angeben – nur so können wir Ihre Zahlung zuordnen.</div></div>' +
       (qr ? '<div class="giro"><div class="qr">' + qr + '</div>GiroCode – mit Banking-App scannen</div>' : '') + '</div>';
  h += '<div class="gruss">Mit sportlichen Grüßen<br><b>' + esc(S.rg_empfaenger || "") + '</b></div>';
  h += '<div class="fuss"><div class="sp4" style="grid-template-columns:repeat(' + Math.max(1, spalten.length) + ',1fr)">' + spalten.map(z => '<div>' + fett(z) + '</div>').join("") + '</div>' +
       (bilder.fuss_logo ? '<div class="bank"><img src="' + bilder.fuss_logo + '" alt=""></div>' : '') + '</div>';
  h += '</div>';
  if(!S.iban) toast("Hinweis: IBAN ist noch nicht eingetragen (Mehr → Briefkopf & Bank) — Platzhalter wird gedruckt");
  modalZu();
  let d = $("druck"); if(!d){ d = document.createElement("div"); d.id = "druck"; document.body.appendChild(d); }
  d.innerHTML = h;
  let st = $("druckSeite"); if(!st){ st = document.createElement("style"); st.id = "druckSeite"; document.head.appendChild(st); }
  st.textContent = "@page{size:A4;margin:0}";
  document.body.classList.add("drucken");
  const fertig = () => { document.body.classList.remove("drucken"); st.textContent = ""; window.removeEventListener("afterprint", fertig); };
  window.addEventListener("afterprint", fertig);
  setTimeout(() => { window.print(); setTimeout(fertig, 1500); }, 50);
}
async function rechnungZeigen(id){
  const r = (DB.rechnungen||[]).find(x => x.id === id);
  if(r.status === "storniert"){
    modal('<h3>' + esc(r.nummer) + ' <span class="chip grau">storniert</span></h3><p class="sub" style="margin-top:-6px">' + esc(sportlerName(r.sportler_id)) + ' · ' + eur(r.summe) + '</p>' +
          '<p>Storniert ' + (r.storniert_am ? zeitKurz(r.storniert_am) : '') + (r.storniert_von ? ' von ' + esc(r.storniert_von) : '') + '.<br>Grund: ' + esc(r.storno_grund || "—") + '</p>' +
          '<p class="sub">Die Posten sind wieder offen und kommen in die nächste Rechnung.</p><button class="btn voll" data-a="modalZu">Schließen</button>');
    return;
  }
  try{
    const pos = await rest("/buchung?rechnung_id=eq." + id + "&order=zeit");
    let h = '<h3>' + esc(r.nummer) + '</h3><p class="sub" style="margin-top:-6px">' + esc(sportlerName(r.sportler_id)) + ' · ' + rechnungZeitraum(pos) + '</p>';
    h += '<p style="margin:0 0 8px">Verwendungszweck: <strong>' + esc(verwendungszweck(r)) + '</strong><br><span class="sub">fällig ' + deLang(faelligAm(r)) + '</span></p>';
    h += '<div class="card tabwrap"><table><thead><tr><th>Datum</th><th>Artikel</th><th>Menge</th><th>Betrag</th></tr></thead><tbody>';
    pos.forEach(p => { h += '<tr><td>' + de(iso(new Date(p.zeit))) + '</td><td style="text-align:left">' + esc(rechnungText(p.code)) + '</td><td class="mono">' + zahl(-p.menge) + '</td><td class="mono">' + eur(-p.menge * p.einzelpreis) + '</td></tr>'; });
    h += '</tbody></table><div class="row trenn"><strong>Summe</strong><span class="sp"></span><strong>' + eur(r.summe) + '</strong></div></div>';
    h += '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Schließen</button>' +
         (r.status === "offen" ? '<button class="btn small" data-a="rStorno" data-x="' + r.id + '">Stornieren</button>' : '') +
         '<span class="sp"></span><button class="btn primary" data-a="rechnungDrucken" data-x="' + r.id + '">Drucken</button></div>';
    modal(h);
  }catch(e){ toast(e.message, true); }
}
