/* js/lager.js — Material: Lager, Bestellliste, Koffer, Bekleidung, Buchungen ansehen/stornieren.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Lager
   ===============================================================*/
/** Material: Lager (mit Werkstatt und Koffern) · Bestellen · Inventur */
function materialView(){
  if(view.mat === "koffer") view.mat = "lager";   // alter Reiter aus 9.2.0
  if(view.mat === "lager" && view.koffer && kofferOrte().indexOf(view.koffer) >= 0) return kofferDetail(view.koffer);
  const nb = bestellBedarf().filter(x => x.rest > 0).length;
  let h = '<div class="seg" style="margin-bottom:12px">';
  h += segBtn("mat", "lager", "Lager", view.mat);
  if(kleiderOrte().length || view.mat === "kleidung") h += segBtn("mat", "kleidung", "Bekleidung", view.mat);
  h += segBtn("mat", "bestellen", "Bestellen" + (nb ? " · " + nb : ""), view.mat);
  h += segBtn("mat", "inventur", inv ? "Inventur ●" : "Inventur", view.mat);
  h += '</div>';
  if(view.mat === "bestellen") return h + bestellView();
  if(view.mat === "inventur") return h + (inv ? inventurView() : invStartView());
  if(view.mat === "kleidung") return h + kleidungView();
  return h + lagerView();
}
function lagerView(){
  const gesperrt = offline ? " disabled" : "";
  const zuBestellen = {};
  bestellBedarf().forEach(x => { if(x.rest > 0) zuBestellen[x.a.code] = x.rest; });
  const aktiv = (DB.bestand||[]).filter(b => b.aktiv);
  const res = aktiv.filter(b => num(b.reserviert) > 0);
  // Werkstattmaterial (W) steht nicht unter „Alle“, sondern unter einem eigenen Knopf
  const wMat = aktiv.filter(b => istWMat(b.code)), haupt = aktiv.filter(b => !istWMat(b.code));
  const imW = view.matFilter === "werkstatt";
  if(view.lOrt && raumOrte().indexOf(view.lOrt) < 0) view.lOrt = "";
  const imOrt = view.lOrt;
  let h = view.suche ? '' : orteBlock();
  if(imOrt && view.suche) h += '<div class="banner" style="background:var(--card);border:1px solid var(--line)">Nur <strong>' + esc(imOrt) + '</strong> — Artikel, die dort liegen ' +
                 '<button class="btn small" data-a="ortFilter" data-x="" style="margin-left:6px">alle Orte</button></div>';
  h += '<div class="feld"><input type="search" data-c="suche" placeholder="Artikel oder Code" value="' + esc(view.suche) + '"></div>';
  h += '<div class="row wrapr" style="gap:6px;margin-bottom:10px">';
  const knoepfe = [["alle", "Alle · " + (imOrt ? aktiv.filter(b => amOrt(b, imOrt) !== 0).length : haupt.length)], ["bestellen", "zu bestellen · " + Object.keys(zuBestellen).length], ["reserviert", "reserviert · " + res.length]];
  if(wMat.length || imW) knoepfe.push(["werkstatt", "Werkstattmaterial · " + wMat.length]);
  knoepfe.forEach(x => h += '<button class="btn small' + (view.matFilter === x[0] ? " primary" : "") + '" data-a="matFilter" data-x="' + x[0] + '">' + x[1] + '</button>');
  h += '</div>';
  if(imW) h += '<p class="sub" style="margin:-4px 0 10px">Nur zum Überblick — wird nicht an Sportler oder Räder gebucht und nicht berechnet. „−“ bucht eine Entnahme aus der Werkstatt; aufgefüllt wird über die Inventur.</p>';

  const q = view.suche.toLowerCase();
  // Bei einer Suche oder einem gewählten Raum wird unter „Alle“ Werkstattmaterial mit gezeigt
  let liste = q || imOrt ? aktiv : haupt;
  if(view.matFilter === "bestellen") liste = aktiv.filter(b => zuBestellen[b.code]);
  if(view.matFilter === "reserviert") liste = res;
  if(imW) liste = wMat;
  if(imOrt) liste = liste.filter(b => amOrt(b, imOrt) !== 0);
  if(q) liste = liste.filter(b => (b.name + " " + b.code + " " + tagNamen(tagsVon("artikel", b.code))).toLowerCase().indexOf(q) >= 0);
  // Kategorie → Tag (eine Zeile, siehe katFilterZeile)
  h += katFilterZeile("l", liste);
  liste = katFilterAnwenden("l", liste);
  if(!liste.length) return h + '<div class="leer">' + ((DB.bestand||[]).length ? "Nichts in dieser Auswahl." : "Noch keine Artikel. Unter Mehr → Artikel anlegen.") + '</div>';

  // Gegliedert nach Kategorie und (erstem) Tag; ohne Filter klappbar wie im Inventar
  // (ohne „alle zu-/aufklappen“-Links, damit es oben ruhig bleibt — Überschrift antippen reicht)
  // Sortierung: Standard = gegliedert nach Kategorie und Tag; nach Nummer / Änderung = eine flache Liste
  const sArt = sortArt("l"), flach = sArt !== "standard", zeit = b => geaendertZeit(artikel(b.code));
  h += sortZeile("l", "Kategorie");
  if(sArt === "geaendert") h += geaendertFehlt(liste, zeit);
  const mitKat = !view.lKat && !imW && !flach;
  const eintraege = (flach ? nachArt(liste, sArt, b => b.code, zeit) : katSortieren("l", liste, b => b.code)).map(b => {
    const kat = flach ? "" : stueckKategorie(b.code);
    return { kat, uk:flach ? "ohne" : ukSchluessel(tagsVon("artikel", b.code)), n:1,
             html:lagerZeile(b, zuBestellen, gesperrt, imOrt, sArt === "geaendert" ? geaendertText(artikel(b.code)) : "") };
  });
  h += gegliedert(eintraege, { p:"l", mitKat, mitUk:!view.lUk && !flach, klappbar:!q && !flach, block:x => '<div class="card liste">' + x + '</div>', einheit:["Artikel", "Artikel"] });
  if(!imW) h += '<p class="sub">Name antippen: Buchungen, Inventur, Etikett, Bearbeiten. „+“ = Zugang. „frei“ = in den Räumen und nicht reserviert; was in Koffern gepackt ist, zählt zum Bestand, aber nicht als frei.</p>';
  return h;
}

/** Eine Zeile der Lager-Liste */
function lagerZeile(b, zuBestellen, gesperrt, imOrt, zusatz){
  let h = "";
  const leistung = b.art === "Pauschale";
  const vt = verteilung(b);
  const knapp = !leistung && (num(b.frei) <= 0 || zuBestellen[b.code]);
  h += '<div class="eintrag"><button class="lzeile" data-a="artikelMenue" data-x="' + esc(b.code) + '"><strong>' + esc(b.name) + '</strong> <span class="sub">' + esc(b.code) + '</span>' + tagChips(tagsVon("artikel", b.code)) + '<br>';
  if(leistung) h += '<span class="sub">Leistung · ' + eur(b.preis) + '</span>';
  else {
    h += '<span class="sub">' + (imOrt ? '<strong style="color:var(--ink)">' + zahl(amOrt(b, imOrt)) + ' ' + esc(b.einheit) + ' in ' + esc(imOrt) + '</strong> · ' + zahl(b.gesamt) + ' gesamt'
                                       : '<strong style="color:var(--ink)">' + zahl(b.gesamt) + ' ' + esc(b.einheit) + ' im Lager</strong>');
    h += ' · <strong style="color:' + (knapp ? "var(--sprint)" : "var(--ok)") + '">' + zahl(b.frei) + ' frei</strong>';
    if(num(b.reserviert)) h += ' · ' + zahl(b.reserviert) + ' reserviert';
    h += '</span>';
    // Verteilung, sobald nicht alles in der Werkstatt liegt
    if(vt.length > 1 || (vt.length === 1 && vt[0][0] !== HAUPT)){
      h += '<br><span class="sub" style="font-size:12px">' + esc(vt.map(x => x[0] + " " + zahl(x[1])).join(" · ")) + '</span>' + aufteilungsBalken(b, knapp);
    }
    if(hatGroessen(b.code) && verliehen(b.code)) h += '<br><span class="sub" style="font-size:12px">' + zahl(verliehen(b.code)) + ' verliehen</span>';
    const off = (DB.bestellungen||[]).filter(o => o.code === b.code);
    if(off.length) h += '<br><span class="sub" style="color:var(--warn)">bestellt ' + off.map(o => zahl(o.menge) + ' am ' + de(o.bestellt_am)).join(", ") + '</span>';
    else if(zuBestellen[b.code]) h += '<br><span class="sub" style="color:var(--warn)">zu bestellen: ' + zahl(zuBestellen[b.code]) + ' ' + esc(b.einheit) + '</span>';
  }
  if(zusatz) h += '<br><span class="sub" style="font-size:12px">' + esc(zusatz) + '</span>';
  if(!leistung && istWMat(b.code))
    return h + '</button><div class="knoepfe"><button class="btn small" data-a="wEntnahme" data-x="' + esc(b.code) + '" aria-label="Eins entnehmen: ' + esc(b.name) + '"' + gesperrt + ' style="min-width:46px;font-size:20px">−</button></div></div>';
  h += '</button><div class="knoepfe"><button class="btn small" data-a="formAusgabe" data-x="' + esc(b.code) + '"' + gesperrt + '>' + (leistung ? "Buchen" : hatGroessen(b.code) ? "Ausleihen" : "Ausgeben") + '</button>';
  if(!leistung) h += '<button class="btn small" data-a="formZugang" data-x="' + esc(b.code) + '" aria-label="Zugang ' + esc(b.name) + '"' + gesperrt + '>+</button>';
  h += '</div></div>';
  return h;
}

/** Balken: frei · reserviert in Räumen · in Koffern */
function aufteilungsBalken(b, knapp){
  const ges = Math.max(num(b.lager), 0) + Math.max(num(b.koffer), 0);
  if(ges <= 0) return "";
  const frei = Math.max(Math.min(num(b.frei), num(b.lager)), 0);
  const rest = Math.max(num(b.lager) - frei, 0);
  const teil = (v, farbe) => v > 0 ? '<span style="width:' + (v / ges * 100).toFixed(1) + '%;background:' + farbe + '"></span>' : '';
  return '<span class="vbar" aria-hidden="true">' + teil(frei, knapp ? "var(--sprint)" : "var(--ok)") + teil(rest, "#C9C4BC") +
         teil(Math.max(num(b.koffer), 0), "var(--steher)") + '</span>';
}

/** Orte im Lager: Werkstatt und die Koffer als Unterbereiche */
function kofferStatus(ort){
  const zeilen = (DB.koffer||[]).filter(k => k.ort === ort);
  const fehlt = zeilen.filter(k => num(k.fehlt) > 0).length;
  if(!zeilen.length) return '<span class="chip grau">keine Packliste</span>';
  return fehlt ? '<span class="chip warn">' + fehlt + (fehlt === 1 ? ' Position fehlt' : ' Positionen fehlen') + '</span>' : '<span class="chip ok">komplett</span>';
}
function naechsterTermin(ort){
  return (DB.termine||[]).filter(t => t.koffer === ort && tageBis(t.datum) !== null && tageBis(t.datum) >= 0)
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)))[0] || null;
}
/** Lager-Karte: Räume und Koffer als Kacheln, je zwei pro Reihe. Ein Raum antippen
    filtert die Liste darunter; „alle Orte“ oben rechts hebt den Filter auf.
    Kompakt gehalten: Räume nur, wenn es mehr als einen gibt (sonst gibt es nichts
    auszuwählen); Bekleidung steht nicht hier, sondern im Reiter Material → Bekleidung
    (keine Teile-Summe – sagt nichts darüber, ob die richtigen Teile da sind).
    Gibt es weder mehrere Räume noch Koffer, entfällt die Karte ganz. */
function orteBlock(){
  const aktiv = (DB.bestand||[]).filter(b => b.aktiv && b.art !== "Pauschale");
  const raeume = lagerorte().filter(o => o.art === "raum"), koffer = lagerorte().filter(o => o.art === "koffer");
  const mehrRaeume = raeume.length > 1, imOrt = view.lOrt;
  if(!mehrRaeume && !koffer.length && !imOrt) return "";
  let h = '<div class="card orte" style="padding-bottom:2px"><div class="kopfzeile">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/></svg>' +
    '<div style="flex:1;min-width:0"><strong>Lager</strong> <span class="sub">· ' +
    (imOrt ? 'nur ' + esc(imOrt) + ' · ' + aktiv.filter(b => amOrt(b, imOrt) > 0).length + ' Artikel'
           : aktiv.length + ' Artikel') + '</span></div>' +
    (imOrt ? '<button class="btn small" data-a="ortFilter" data-x="">alle Orte</button>' : '') + '</div>';
  if(mehrRaeume){
    h += '<div class="gruppe">Räume</div><div class="kacheln">';
    raeume.forEach(o => {
      const n = aktiv.filter(b => amOrt(b, o.name) > 0).length, an = imOrt === o.name;
      h += '<button class="kachel" data-a="ortFilter" data-x="' + esc(o.name) + '" aria-pressed="' + an + '"><span class="titel">' + esc(o.name) + '</span><span class="sub">' + n + ' Artikel</span></button>';
    });
    h += '</div>';
  }
  if(koffer.length){
    h += '<div class="gruppe">Koffer &amp; Werkzeugkästen</div><div class="kacheln">';
    koffer.forEach(k => {
      const o = k.name, t = naechsterTermin(o), tage = t ? tageBis(t.datum) : null;
      const sub = t ? (tage === 0 ? "Rennen heute" : tage === 1 ? "Rennen morgen" : "Rennen in " + tage + " Tagen") : "";
      h += '<button class="kachel" data-a="kofferAuf" data-x="' + esc(o) + '"><span class="titel">' + esc(o) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + kofferStatus(o) + '</button>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

function artikelMenue(code){
  const b = bestand(code), a = artikel(code);
  if(!a) return;
  let h = '<h3>' + esc(a.name) + '</h3><p class="sub" style="margin-top:-6px">' + esc(code) + (b && a.art !== "Pauschale" ? ' · ' + zahl(b.gesamt) + ' im Lager · frei ' + zahl(b.frei) +
     (verteilung(b).length ? '<br>' + esc(verteilung(b).map(x => x[0] + " " + zahl(x[1])).join(" · ")) : '') : '') + '</p>';
  h += '<div style="display:grid;gap:8px">';
  if(istWMat(code) && a.art !== "Pauschale"){
    h += '<p class="sub" style="margin:0">Werkstattmaterial — nicht für Tickets, Räder oder Abrechnung.</p>';
    h += '<button class="btn primary" data-a="formEntnahme" data-x="' + esc(code) + '">Entnahme buchen</button>';
    h += '<button class="btn" data-a="formInventur" data-x="' + esc(code) + '">Inventur / Bestand korrigieren</button>';
    h += '<button class="btn" data-a="formZugang" data-x="' + esc(code) + '">Zugang buchen</button>';
  } else {
  if(a.art !== "Pauschale") h += '<button class="btn primary" data-a="formZugang" data-x="' + esc(code) + '">Zugang buchen</button>';
  h += '<button class="btn" data-a="formAusgabe" data-x="' + esc(code) + '">' + (a.art === "Pauschale" ? "Leistung buchen" : hatGroessen(code) ? "An Sportler ausleihen" : "An Sportler ausgeben") + '</button>';
  if(a.art !== "Pauschale") h += '<button class="btn" data-a="formInventur" data-x="' + esc(code) + '">Inventur / Bestand korrigieren</button>';
  }
  h += '<button class="btn" data-a="buchungenArtikel" data-x="' + esc(code) + '">Buchungen · Fehlbuchung stornieren</button>';
  h += '<button class="btn" data-a="artikelEtikett" data-x="' + esc(code) + '">Etikett drucken</button>';
  h += '<button class="btn" data-a="artikelBearbeiten" data-x="' + esc(code) + '">Artikel bearbeiten</button>';
  h += '<button class="btn" data-a="modalZu">Schließen</button></div>';
  modal(h);
}
function formZugang(code){
  if(hatGroessen(code)) return formGroessen(code, "zugang");
  const a = artikel(code);
  modal('<h3>Zugang · ' + esc(a.name) + '</h3>' +
    '<div class="grid2"><div class="feld"><span class="lbl">Menge (' + esc(a.einheit) + ')</span><input type="number" id="fMenge" min="0" step="any" inputmode="decimal"></div>' +
    '<div class="feld"><span class="lbl">Ort</span>' + ortSelect("fOrt",standardOrt()) + '</div></div>' +
    '<div class="feld"><span class="lbl">Notiz (Lieferant, Rechnung …)</span><input type="text" id="fNotiz"></div>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="zugangBuchen" data-x="' + esc(code) + '">Buchen</button></div>');
  setTimeout(() => { const e = $("fMenge"); if(e) e.focus(); }, 50);
}
function formAusgabe(code){
  if(hatGroessen(code)) return leihStart(null, code);
  const a = artikel(code);
  let s = '<select id="fSportler"><option value="">— Sportler wählen —</option>';
  (DB.sportler||[]).filter(x => x.aktiv).forEach(x => s += '<option value="' + x.id + '">' + esc(x.name) + (x.abrechnen ? " (wird berechnet)" : "") + '</option>');
  s += '</select>';
  modal('<h3>' + (a.art === "Pauschale" ? "Leistung" : "Ausgabe") + ' · ' + esc(a.name) + '</h3>' +
    '<div class="feld"><span class="lbl">An</span>' + s + '</div>' +
    '<div class="grid2"><div class="feld"><span class="lbl">Menge (' + esc(a.einheit) + ')</span><input type="number" id="fMenge" value="1" min="0" step="any" inputmode="decimal"></div>' +
    '<div class="feld"><span class="lbl">Aus</span>' + ortSelect("fOrt",standardOrt()) + '</div></div>' +
    '<div class="feld"><span class="lbl">Notiz</span><input type="text" id="fNotiz"></div>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="ausgabeBuchen" data-x="' + esc(code) + '">Buchen</button></div>');
}
/** Entnahme ohne Sportler (Werkstattmaterial) — wird nicht berechnet */
function formEntnahme(code){
  const a = artikel(code);
  modal('<h3>Entnahme · ' + esc(a.name) + '</h3><p class="sub" style="margin-top:-6px">Verbrauch in der Werkstatt, wird nicht berechnet.</p>' +
    '<div class="grid2"><div class="feld"><span class="lbl">Menge (' + esc(a.einheit) + ')</span><input type="number" id="fMenge" value="1" min="0" step="any" inputmode="decimal"></div>' +
    '<div class="feld"><span class="lbl">Aus</span>' + ortSelect("fOrt",standardOrt()) + '</div></div>' +
    '<div class="feld"><span class="lbl">Notiz</span><input type="text" id="fNotiz"></div>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="entnahmeBuchen" data-x="' + esc(code) + '">Buchen</button></div>');
}
function formInventur(code){
  if(hatGroessen(code)) return formGroessen(code, "zaehlen");
  const a = artikel(code), b = bestand(code);
  modal('<h3>Inventur · ' + esc(a.name) + '</h3><p class="sub" style="margin-top:-6px">Gezählten Bestand eintragen — die Differenz wird als Korrektur gebucht.</p>' +
    '<div class="grid2"><div class="feld"><span class="lbl">Ort</span>' + ortSelect("fOrt",standardOrt(),"invOrt",code) + '</div>' +
    '<div class="feld"><span class="lbl">Gezählt (' + esc(a.einheit) + ')</span><input type="number" id="fMenge" min="0" step="any" inputmode="decimal" placeholder="bisher ' + zahl(b ? amOrt(b, standardOrt()) : 0) + '"></div></div>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="inventurBuchen" data-x="' + esc(code) + '">Übernehmen</button></div>');
}
function ortSelect(id, wert, dataC, dataX){
  let h = '<select id="' + id + '"' + (dataC ? ' data-c="' + dataC + '" data-x="' + esc(dataX || "") + '"' : '') + '>';
  return h + ortOptionen(wert) + '</select>';
}
/** Räume zuerst (Werkstatt oben), die Koffer als Gruppe darunter. Ein deaktivierter
    Ort, der gerade gewählt ist (z. B. Arbeitsort eines Tickets), bleibt sichtbar. */
function ortOptionen(wert, ohneKleidung){
  const opt = o => '<option value="' + esc(o) + '"' + (o === wert ? " selected" : "") + '>' + esc(o) + '</option>';
  const r = raumOrte(), b = ohneKleidung ? [] : kleiderOrte(), k = kofferOrte();
  let h = r.length > 1 ? '<optgroup label="Räume">' + r.map(opt).join("") + '</optgroup>' : r.map(opt).join("");
  if(b.length) h += '<optgroup label="Bekleidung">' + b.map(opt).join("") + '</optgroup>';
  if(k.length) h += '<optgroup label="Koffer &amp; Werkzeugkästen">' + k.map(opt).join("") + '</optgroup>';
  if(wert && r.indexOf(wert) < 0 && b.indexOf(wert) < 0 && k.indexOf(wert) < 0) h += opt(wert);
  return h;
}

/* ===============================================================
   Bestellliste — was muss nachbestellt werden?
   Bedarf je Artikel (Lager = alle Räume, ohne Leistungen):
     Mindestbestand + was in den Koffern fehlt − frei im Lager
   („frei“ = Bestand in Räumen minus Reservierungen offener Tickets).
   Offene Bestellungen werden abgezogen; ein Zugang schließt sie
   automatisch ab (Datenbank).
   ===============================================================*/
function bestellBedarf(){
  const offen = {};
  (DB.bestellungen||[]).forEach(b => (offen[b.code] = offen[b.code] || []).push(b));
  const liste = [];
  (DB.artikel||[]).filter(a => a.aktiv && a.art !== "Pauschale").forEach(a => {
    const b = bestand(a.code), frei = b ? num(b.frei) : 0, mind = num(a.mindestbestand);
    const kofferFehlt = (DB.koffer||[]).filter(k => k.code === a.code).reduce((m, k) => m + num(k.fehlt), 0);
    // Bekleidung: Mindestbestand gilt je Größe (über alle Lager-Orte)
    const grFehlt = [];
    if(hatGroessen(a.code) && mind) groessen(a.code).forEach(g => {
      const da = orte().filter(o => !istKoffer(o)).reduce((m, o) => m + amOrtGr(a.code, o, g), 0);
      if(da < mind) grFehlt.push([g, mind - da]);
    });
    const bedarf = hatGroessen(a.code) ? grFehlt.reduce((m, x) => m + x[1], 0) : Math.max(0, mind + kofferFehlt - frei);
    const bestellt = (offen[a.code] || []).reduce((m, x) => m + num(x.menge), 0);
    if(bedarf <= 0 && !bestellt) return;
    const gruende = [];
    if(grFehlt.length) gruende.push("unter mind. " + zahl(mind) + " je Größe: " + grFehlt.map(x => x[0] + " +" + zahl(x[1])).join(", "));
    else if(mind && frei < mind && !hatGroessen(a.code)) gruende.push("frei " + zahl(frei) + " von mind. " + zahl(mind));
    else if(frei < 0) gruende.push(zahl(-frei) + " mehr reserviert als da");
    const tk = (DB.tickets||[]).filter(t => fehlend(t).indexOf(a.code) >= 0).map(t => tnr(t.id));
    if(tk.length) gruende.push("fehlt für " + tk.join(", "));
    (DB.koffer||[]).filter(k => k.code === a.code && num(k.fehlt) > 0).forEach(k => gruende.push(k.ort + " fehlt " + zahl(k.fehlt)));
    liste.push({ a, frei, bedarf, bestellt, rest:Math.max(0, bedarf - bestellt), offen:offen[a.code] || [], gruende });
  });
  return liste;
}
function bestellView(){
  const gesperrt = offline ? " disabled" : "";
  const liste = bestellBedarf();
  let h = "";
  if(!liste.length) return h + '<div class="leer">Nichts zu bestellen — alles über Mindestbestand, keine Fehlteile.</div>';
  const gruppen = {};
  liste.forEach(x => (gruppen[x.a.lieferant || ""] = gruppen[x.a.lieferant || ""] || []).push(x));
  Object.keys(gruppen).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "de")).forEach(lief => {
    const g = gruppen[lief], offenGes = g.filter(x => x.rest > 0);
    h += '<div class="row wrapr" style="gap:8px;margin:16px 0 8px"><h2 class="sec" style="margin:0">' + esc(lief || "Ohne Lieferant") + '</h2><span class="sp"></span>';
    if(offenGes.length){
      if(offenGes.some(x => bdProduktId(x.a.shop_link))) h += '<button class="btn small" data-a="bestellWarenkorb" data-x="' + esc(lief) + '">In Warenkorb legen</button>';
      h += '<button class="btn small" data-a="bestellKopieren" data-x="' + esc(lief) + '">Liste kopieren</button>';
      h += '<button class="btn small" data-a="bestellAlle" data-x="' + esc(lief) + '"' + gesperrt + '>alle bestellt</button>';
    }
    h += '</div><div class="card liste">';
    g.forEach(x => {
      const a = x.a;
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(a.name) + '</strong> <span class="sub">' + esc(a.code) + (a.bestellnummer ? ' · Best.-Nr. ' + esc(a.bestellnummer) : '') + '</span>' +
           '<br><span class="sub">' + esc(x.gruende.join(" · ")) + '</span>';
      x.offen.forEach(o => h += '<br><span class="sub" style="color:var(--ok)">bestellt ' + zahl(o.menge) + ' ' + esc(a.einheit) + ' am ' + de(o.bestellt_am) + (o.bearbeiter ? ' · ' + esc(o.bearbeiter) : '') + '</span> ' +
                                  '<button class="btn small link" data-a="bestellZurueck" data-x="' + o.id + '"' + gesperrt + '>zurücknehmen</button>');
      h += '</div>';
      if(x.rest > 0) h += '<span class="chip warn">' + zahl(x.rest) + ' ' + esc(a.einheit) + '</span>';
      else h += '<span class="chip ok">bestellt</span>';
      h += '<div class="knoepfe">';
      if(a.shop_link) h += '<a class="btn small" href="' + esc(shopUrl(a.shop_link)) + '" target="_blank" rel="noopener">Shop ↗</a>';
      if(x.rest > 0) h += '<button class="btn small primary" data-a="bestellMarkieren" data-x="' + esc(a.code) + '"' + gesperrt + '>bestellt</button>';
      h += '</div></div>';
    });
    h += '</div>';
  });
  h += '<p class="sub">Vorschlag = Mindestbestand + was in den Koffern fehlt − frei in der Werkstatt. Wird der Artikel als Zugang gebucht, ist die Bestellung erledigt.</p>';
  return h;
}
/** Shop-Link als Webadresse: ohne http(s) wird https:// davorgesetzt, andere Schemata nicht zugelassen. */
function shopUrl(l){ l = String(l || "").trim(); return /^https?:\/\//i.test(l) ? l : "https://" + l.replace(/^[a-z][a-z0-9+.-]*:\/*/i, ""); }
/* Sammel-Warenkorb bei Bike-Discount (Shopware 6).
   Der Shop-Link muss die Form https://www.bike-discount.de/de/detail/<Produkt-ID> haben
   (32 Zeichen 0–9/a–f, bei Varianten die ID der Variante). Der Link öffnet ganz normal die
   Produktseite; zusätzlich schickt „In Warenkorb legen“ alle Positionen in einem Formular
   an den Shop. Es ist das normale Formular des „In den Warenkorb“-Buttons, keine offizielle
   Schnittstelle – ändert Bike-Discount sein Shopsystem, kann das ausfallen. */
const BD_WARENKORB = "https://www.bike-discount.de/de/checkout/line-item/add";
function bdProduktId(link){
  const m = /bike-discount\.de\/(?:[a-z]{2}\/)?detail\/([0-9a-f]{32})(?:[\/?#]|$)/i.exec(String(link || "").trim());
  return m ? m[1].toLowerCase() : "";
}
/** Offene Positionen eines Lieferanten: mit Produkt-ID (für den Warenkorb) und ohne. */
function warenkorbPositionen(lief){
  const g = bestellBedarf().filter(x => (x.a.lieferant || "") === lief && x.rest > 0);
  return { mit: g.filter(x => bdProduktId(x.a.shop_link)), ohne: g.filter(x => !bdProduktId(x.a.shop_link)) };
}
/** Schickt die Positionen als ein Formular in einem neuen Tab an Bike-Discount.
    Mengen werden auf ganze Stück aufgerundet; gleiche Produkt-ID wird zusammengezählt. */
function warenkorbSenden(liste){
  const mengen = {};
  liste.forEach(x => { const id = bdProduktId(x.a.shop_link); if(id) mengen[id] = (mengen[id] || 0) + Math.max(1, Math.ceil(num(x.rest))); });
  const ids = Object.keys(mengen); if(!ids.length) return 0;
  const f = document.createElement("form");
  f.method = "post"; f.action = BD_WARENKORB; f.target = "_blank"; f.style.display = "none";
  const feldDazu = (n, v) => { const i = document.createElement("input"); i.type = "hidden"; i.name = n; i.value = v; f.appendChild(i); };
  feldDazu("redirectTo", "frontend.checkout.cart.page");
  ids.forEach(id => {
    const p = "lineItems[" + id + "]";
    feldDazu(p + "[id]", id); feldDazu(p + "[referencedId]", id); feldDazu(p + "[type]", "product");
    feldDazu(p + "[stackable]", "1"); feldDazu(p + "[removable]", "1"); feldDazu(p + "[quantity]", String(mengen[id]));
  });
  document.body.appendChild(f); f.submit(); f.remove();
  return ids.length;
}
function bestellText(lief){
  const g = bestellBedarf().filter(x => (x.a.lieferant || "") === lief && x.rest > 0);
  return "Bestellung LV Radsport M-V" + (lief ? " bei " + lief : "") + "\n\n" +
    g.map(x => "- " + zahl(x.rest) + " " + x.a.einheit + " " + x.a.name + (x.a.bestellnummer ? " (Best.-Nr. " + x.a.bestellnummer + ")" : "")).join("\n");
}

/* ===============================================================
   Koffer — Überblick und Warnung
   ===============================================================*/
function kofferDetail(ort){
  const gesperrt = offline ? " disabled" : "";
  const zeilen = (DB.koffer||[]).filter(k => k.ort === ort);
  let h = '<button class="btn small zurueck" data-a="kofferZu"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>Lager</button>';
  h += '<div class="row wrapr" style="gap:10px;margin-bottom:10px"><span class="big" style="font-size:26px">' + esc(ort) + '</span>' + kofferStatus(ort) + '</div>';
  const t = naechsterTermin(ort);
  if(t){
    const tage = tageBis(t.datum), fehlt = zeilen.filter(k => num(k.fehlt) > 0).length;
    h += '<div class="banner ' + (fehlt && tage <= 10 ? 'gelb' : '') + '" style="' + (fehlt && tage <= 10 ? '' : 'background:var(--card);border:1px solid var(--line)') + '">Nächstes Rennen: <strong>' + esc(t.name) + '</strong> am ' + deLang(t.datum) +
         (tage === 0 ? ' (heute)' : tage === 1 ? ' (morgen)' : ' (in ' + tage + ' Tagen)') + '</div>';
  }
  h += '<div class="card">';
  if(zeilen.length){
    h += '<div class="tabwrap"><table><thead><tr><th>Artikel</th><th>Soll</th><th>Ist</th><th>fehlt</th><th></th></tr></thead><tbody>';
    zeilen.forEach(k => {
      h += '<tr class="' + (num(k.fehlt) > 0 ? "low" : "") + '"><td>' + esc(k.name) + '</td>';
      h += '<td><input type="number" min="0" step="any" value="' + num(k.soll) + '" data-c="kofferSoll" data-x="' + esc(k.code) + '|' + ort + '" style="width:64px;min-height:36px;padding:4px 6px"' + gesperrt + '></td>';
      const ein = (artikel(k.code) || {}).einheit || "";
      h += '<td class="mono"><strong>' + zahl(k.ist) + '</strong>' + (ein && ein !== "Stück" ? ' <span class="sub">' + esc(ein) + '</span>' : '') + '</td>';
      h += '<td class="mono" style="color:' + (num(k.fehlt) > 0 ? "var(--sprint)" : "var(--ink-2)") + '">' + (num(k.fehlt) > 0 ? zahl(k.fehlt) : "–") + '</td>';
      h += '<td style="white-space:nowrap"><button class="btn small" data-a="kofferRein" data-x="' + esc(k.code) + '|' + ort + '"' + gesperrt + '>+1</button> ' +
           '<button class="btn small" data-a="kofferRaus" data-x="' + esc(k.code) + '|' + ort + '"' + gesperrt + '>−1</button> ' +
           '<button class="btn small" data-a="kofferMenge" data-x="' + esc(k.code) + '|' + ort + '"' + gesperrt + '>Menge…</button></td></tr>';
    });
    h += '</tbody></table></div>';
    const offen = zeilen.filter(k => num(k.fehlt) > 0).length;
    if(offen) h += '<div class="row trenn" style="gap:8px"><button class="btn primary" data-a="kofferAuffuellen" data-x="' + ort + '" style="flex:1"' + gesperrt + '>Alles Fehlende einpacken (' + offen + (offen === 1 ? ' Position' : ' Positionen') + ')</button></div>';
  } else h += '<p class="sub" style="margin:0 0 6px">Noch keine Packliste.</p>';
  h += '<div class="row trenn" style="gap:8px"><select data-c="kofferNeu" data-x="' + ort + '" style="flex:1"' + gesperrt + '><option value="">Artikel zur Packliste…</option>';
  (DB.artikel||[]).filter(a => a.aktiv && a.art !== "Pauschale" && !hatGroessen(a.code) && !zeilen.some(z => z.code === a.code)).forEach(a => h += '<option value="' + esc(a.code) + '">' + esc(a.name) + '</option>');
  h += '</select></div></div>';
  const st = (DB.stueck||[]).filter(s => s.ort === ort);
  if(st.length){
    h += '<h2 class="sec">Einzelstücke im Koffer</h2><div class="card">';
    st.forEach(s => h += '<div class="sub" style="color:var(--ink)">' + esc(s.nummer) + ' · ' + esc(s.typ) + '</div>');
    h += '</div>';
  }
  h += '<p class="sub">+1, −1 und „Menge…“ buchen zwischen Werkstatt und Koffer um, „Alles Fehlende einpacken“ füllt jede Position bis zum Soll auf (soweit in der Werkstatt frei). Der Lagerbestand bleibt gleich, nur „frei“ ändert sich.</p>';
  const n = (DB.termine||[]).length;
  h += '<button class="btn small link" data-a="geheMehr" data-x="termine">Rennen &amp; Termine' + (n ? ' · ' + n : '') + ' — warnt 10 Tage vorher, wenn im Koffer etwas fehlt</button>';
  return h;
}

/** Beliebige Menge zwischen Werkstatt und Koffer umbuchen; Vorschlag = was fehlt. */
function formKofferMenge(code, ort){
  const a = artikel(code) || { name:code, einheit:"" }, b = bestand(code);
  const k = (DB.koffer||[]).find(z => z.code === code && z.ort === ort) || {};
  const fehlt = num(k.fehlt);
  modal('<h3>' + esc(a.name) + ' · ' + esc(ort) + '</h3>' +
    '<p class="sub" style="margin-top:-6px">Im Koffer ' + zahl(k.ist) + ' von ' + zahl(k.soll) + ' ' + esc(a.einheit) +
      ' · in der Werkstatt frei ' + zahl(b ? Math.max(greifbar(code, HAUPT, null), 0) : 0) + ' ' + esc(a.einheit) + '</p>' +
    '<div class="feld"><span class="lbl">Menge (' + esc(a.einheit) + ')</span><input type="number" id="fMenge" min="0" step="any" inputmode="decimal" value="' + (fehlt > 0 ? fehlt : '') + '"></div>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>' +
    '<button class="btn" data-a="kofferMengeRaus" data-x="' + esc(code) + '|' + esc(ort) + '">Zurück in Werkstatt</button>' +
    '<button class="btn primary" data-a="kofferMengeRein" data-x="' + esc(code) + '|' + esc(ort) + '">In den Koffer</button></div>');
  setTimeout(() => { const e = $("fMenge"); if(e){ e.focus(); e.select(); } }, 50);
}
function kofferUmbuchen(code, von, nach, menge, meldung){
  return aktion(() => rpc("umbuchen", { p_code:code, p_menge:menge, p_von:von, p_nach:nach, p_bearbeiter:bearbeiter || null }), meldung);
}

/* ===============================================================
   Material → Bekleidung (ab 16.0.0)
   Artikel mit Größen: Bestand je Größe im Bekleidungslager, Ausleihe an
   Sportler (Leihgabe, nie berechnet), Rückgabe, Zählen je Größe.
   ===============================================================*/
const GROESSEN_VORLAGEN = [["XS–XXL", "XS, S, M, L, XL, XXL"], ["Kinder 116–176", "116, 128, 140, 152, 164, 176"],
                           ["Schuhe 38–47", "38, 39, 40, 41, 42, 43, 44, 45, 46, 47"], ["One Size", "One Size"]];
/** Größen aus dem Textfeld; null = keine, false = ungültig (Meldung schon gezeigt). */
function groessenLesen(t){
  const l = [];
  String(t || "").split(/[,;]/).map(x => x.trim()).filter(Boolean).forEach(x => { if(l.indexOf(x) < 0) l.push(x); });
  if(l.some(x => x.length > 20)){ toast("Eine Größe darf höchstens 20 Zeichen haben.", true); return false; }
  if(l.length > 40){ toast("Höchstens 40 Größen.", true); return false; }
  return l.length ? l : null;
}
function leihText(liste){ return liste.map(z => zahl(z.menge) + "× " + ((artikel(z.code) || {}).name || z.code) + (z.groesse ? " " + z.groesse : "")).join(", "); }
/** Artikel, die ins Bekleidungslager gehören: mit Größen, oder dort gebucht. */
function kleiderArtikel(ort){
  return (DB.artikel||[]).filter(a => a.aktiv && a.art !== "Pauschale" && (hatGroessen(a.code) || (ort && amOrt({ code:a.code }, ort) !== 0)))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}
function kleidungView(){
  const ko = kleiderOrte(), g = offline ? " disabled" : "";
  if(!ko.length) return '<div class="leer">Noch kein Bekleidungslager. ' + (darf("manager") ? 'Unter Mehr → Lagerorte einen Lagerort der Art „Bekleidung“ anlegen.' : 'Das legt der Werkstatt-Manager unter Mehr → Lagerorte an.') + '</div>';
  if(ko.indexOf(view.kOrt) < 0) view.kOrt = ko[0];
  const ort = view.kOrt;
  let h = "";
  if(ko.length > 1) h += '<div class="seg" style="margin-bottom:10px">' + ko.map(o => segBtn("kOrt", o, o, ort)).join("") + '</div>';
  h += '<div class="row" style="gap:8px;margin-bottom:12px"><button class="btn primary" style="flex:1" data-a="leihNeu"' + g + '>Ausleihen</button>' +
       '<button class="btn" style="flex:1" data-a="rueckNeu" data-x=""' + g + '>Rückgabe</button></div>';
  h += '<div class="feld"><input type="search" data-c="suche" placeholder="Artikel oder Code" value="' + esc(view.suche) + '"></div>';
  const q = view.suche.toLowerCase();
  let liste = kleiderArtikel(ort);
  if(q) liste = liste.filter(a => (a.name + " " + a.code).toLowerCase().indexOf(q) >= 0);
  if(!liste.length) h += '<div class="leer">' + (q ? "Nichts gefunden." : "Noch keine Bekleidung. Artikel anlegen und unter „Größen“ z. B. XS–XXL eintragen.") + '</div>';
  else {
    h += '<div class="card liste">';
    liste.forEach(a => {
      const sp = groessenSpalten(a.code, ort), mind = num(a.mindestbestand);
      const imLager = sp.reduce((m, x) => m + amOrtGr(a.code, ort, x), 0) + (sp.length ? 0 : amOrt({ code:a.code }, ort));
      h += '<div class="eintrag" style="display:block"><div class="row wrapr" style="gap:8px"><span style="flex:1;min-width:0"><strong>' + esc(a.name) + '</strong> <span class="sub">' + esc(a.code) + '</span><br>' +
           '<span class="sub">' + zahl(imLager) + ' in ' + esc(ort) + (verliehen(a.code) ? ' · ' + zahl(verliehen(a.code)) + ' verliehen' : '') + (mind ? ' · mind. ' + zahl(mind) + ' je Größe' : '') + '</span></span>' +
           '<button class="btn small" data-a="grZugang" data-x="' + esc(a.code) + '"' + g + ' aria-label="Zugang ' + esc(a.name) + '">+</button>' +
           '<button class="btn small" data-a="grZaehlen" data-x="' + esc(a.code) + '"' + g + '>Zählen</button></div>';
      if(!hatGroessen(a.code)){
        h += '<p class="sub" style="margin:6px 0 0">Ohne Größen — unter Artikel bearbeiten Größen eintragen, dann wird je Größe gezählt und ausgeliehen.</p></div>';
        return;
      }
      h += '<div class="tabwrap"><table class="gr"><tr><th></th>' + sp.map(x => '<th>' + esc(grName(x)) + '</th>').join("") + '</tr>' +
           '<tr><td class="zl">Lager</td>' + sp.map(x => { const n = amOrtGr(a.code, ort, x); return '<td class="' + (mind && x && n < mind ? "knapp" : "") + '">' + zahl(n) + '</td>'; }).join("") + '</tr>' +
           (verliehen(a.code) ? '<tr><td class="zl">verliehen</td>' + sp.map(x => '<td>' + (verliehen(a.code, x) ? zahl(verliehen(a.code, x)) : "–") + '</td>').join("") + '</tr>' : '') +
           '</table></div></div>';
    });
    h += '</div>';
  }
  // Wer hat was?
  const proSportler = {};
  (DB.ausgeliehen || []).filter(z => num(z.menge) > 0).forEach(z => (proSportler[z.sportler_id] = proSportler[z.sportler_id] || []).push(z));
  const ids = Object.keys(proSportler).map(Number).sort((x, y) => sportlerName(x).localeCompare(sportlerName(y), "de"));
  h += '<h2 class="sec">Verliehen' + (ids.length ? ' · ' + ids.length + (ids.length === 1 ? ' Sportler' : ' Sportler') : '') + '</h2>';
  if(!ids.length) h += '<div class="leer">Gerade ist nichts verliehen.</div>';
  else {
    h += '<div class="card liste">';
    ids.forEach(id => {
      const l = proSportler[id], seit = l.map(z => z.seit).filter(Boolean).sort()[0];
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(sportlerName(id) || ("Sportler " + id)) + '</strong><br><span class="sub">' + esc(leihText(l)) + (seit ? ' · seit ' + de(seit) : '') + '</span></div>' +
           '<div class="knoepfe"><button class="btn small" data-a="rueckNeu" data-x="' + id + '"' + g + '>Rückgabe</button></div></div>';
    });
    h += '</div>';
  }
  h += '<p class="sub">Ausleihen ist eine Leihgabe: Sie wird nie berechnet. Eine falsche Ausleihe lässt sich unter Artikel → Buchungen stornieren (ganz, solange nichts davon zurückgegeben ist).</p>';
  if(darf("arbeiten")) h += '<button class="btn small link" data-a="artikelNeu" data-x="kleidung">Neuer Bekleidungsartikel</button>';
  return h;
}

/* Zugang oder Zählen je Größe — art "zugang" | "zaehlen" */
let grForm = null;
function formGroessen(code, art, ort){
  const a = artikel(code); if(!a) return;
  const ko = kleiderOrte();
  ort = ort || (grForm && grForm.code === code && grForm.ort) || (ko.indexOf(view.kOrt) >= 0 ? view.kOrt : ko[0] || standardOrt());
  grForm = { code, art, ort };
  const sp = groessenSpalten(code, ort);
  let h = '<h3>' + (art === "zugang" ? "Zugang" : "Zählen") + ' · ' + esc(a.name) + '</h3>' +
          '<p class="sub" style="margin-top:-6px">' + (art === "zugang" ? "Menge je Größe eintragen, leer = keine." : "Gezählte Menge je Größe — die Differenz wird als Korrektur gebucht. Leer = nicht gezählt.") + '</p>' +
          '<div class="feld"><span class="lbl">Ort</span><select id="gOrt" data-c="grOrt">' + ortOptionen(ort) + '</select></div><div class="grid2">';
  sp.forEach(x => h += '<div class="feld"><span class="lbl">' + esc(grName(x)) + ' · jetzt ' + zahl(amOrtGr(code, ort, x)) + '</span><input type="number" min="0" step="any" inputmode="decimal" data-gr="' + esc(x) + '"></div>');
  h += '</div>' + (art === "zugang" ? '<div class="feld"><span class="lbl">Notiz (Lieferant, Rechnung …)</span><input type="text" id="gNotiz"></div>' : '') +
       '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="grSpeichern">' + (art === "zugang" ? "Buchen" : "Übernehmen") + '</button></div>';
  modal(h);
}

/* Ausleihen: Sportler, Ort, mehrere Teile mit Größe */
let leih = null;
function leihStart(sportlerId, code){
  const ko = kleiderOrte();
  leih = { sportler:sportlerId ? String(sportlerId) : "", ort:ko.indexOf(view.kOrt) >= 0 ? view.kOrt : (ko[0] || standardOrt()), code:code || "", posten:[], notiz:"" };
  leihZeichnen();
}
function leihZeichnen(){
  const ko = kleiderOrte(), l = leih;
  let h = '<h3>Bekleidung ausleihen</h3><p class="sub" style="margin-top:-6px">Leihgabe an einen Sportler — wird nicht berechnet.</p>';
  h += '<div class="feld"><span class="lbl">An</span><select data-c="leihSportler"><option value="">— Sportler wählen —</option>' +
       (DB.sportler||[]).filter(s => s.aktiv).map(s => '<option value="' + s.id + '"' + (String(s.id) === l.sportler ? " selected" : "") + '>' + esc(s.name) + '</option>').join("") + '</select></div>';
  if(ko.length > 1 || ko.indexOf(l.ort) < 0) h += '<div class="feld"><span class="lbl">Aus</span><select data-c="leihOrt">' + ortOptionen(l.ort) + '</select></div>';
  if(l.posten.length){
    h += '<div class="card liste" style="margin-bottom:10px">';
    l.posten.forEach((p, i) => h += '<div class="eintrag"><div class="txt"><strong>' + zahl(p.menge) + '× ' + esc((artikel(p.code) || {}).name || p.code) + '</strong> ' + esc(grName(p.gr)) + '</div>' +
      '<div class="knoepfe"><button class="btn small" data-a="leihWeg" data-x="' + i + '" aria-label="Entfernen">✕</button></div></div>');
    h += '</div>';
  }
  h += '<div class="feld"><span class="lbl">' + (l.posten.length ? "Weiteres Teil" : "Teil") + '</span><select data-c="leihArtikel"><option value="">Artikel wählen…</option>' +
       kleiderArtikel(l.ort).map(a => '<option value="' + esc(a.code) + '"' + (a.code === l.code ? " selected" : "") + '>' + esc(a.name) + '</option>').join("") + '</select>';
  if(l.code){
    const sp = hatGroessen(l.code) ? groessenSpalten(l.code, l.ort) : [""];
    h += '<div class="grwahl">' + sp.map(x => {
      const im = l.posten.filter(p => p.code === l.code && p.gr === x).reduce((m, p) => m + p.menge, 0);
      const da = hatGroessen(l.code) ? amOrtGr(l.code, l.ort, x) : amOrt({ code:l.code }, l.ort);
      return '<button data-a="leihGr" data-x="' + esc(x) + '" aria-pressed="' + (im > 0) + '">' + esc(grName(x)) + (im ? ' · ' + zahl(im) : '') + '<small>' + zahl(da - im) + ' da</small></button>';
    }).join("") + '</div><p class="sub" style="margin:0">Größe antippen fügt ein Teil hinzu (nochmal = eins mehr).</p>';
  }
  h += '</div><div class="feld"><span class="lbl">Notiz (optional)</span><input type="text" data-c="leihNotiz" value="' + esc(l.notiz) + '" placeholder="z. B. Saison 2027"></div>';
  const n = l.posten.reduce((m, p) => m + p.menge, 0);
  h += '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>' +
       '<button class="btn primary" data-a="leihBuchen"' + (n ? '' : ' disabled') + '>' + (n ? zahl(n) + (n === 1 ? ' Teil' : ' Teile') + ' ausleihen' : 'Ausleihen') + '</button></div>';
  modal(h);
}

/* Rückgabe: was ein Sportler hat, Menge je Zeile */
let rueck = null;
function rueckStart(sportlerId){
  const ko = kleiderOrte();
  rueck = { sportler:sportlerId ? String(sportlerId) : "", ort:ko.indexOf(view.kOrt) >= 0 ? view.kOrt : (ko[0] || standardOrt()) };
  rueckZeichnen();
}
function rueckZeichnen(){
  const r = rueck, mit = Array.from(new Set((DB.ausgeliehen || []).filter(z => num(z.menge) > 0).map(z => z.sportler_id)));
  let h = '<h3>Rückgabe</h3><div class="feld"><span class="lbl">Von</span><select data-c="rueckSportler"><option value="">— Sportler wählen —</option>' +
          mit.sort((x, y) => sportlerName(x).localeCompare(sportlerName(y), "de")).map(id => '<option value="' + id + '"' + (String(id) === r.sportler ? " selected" : "") + '>' + esc(sportlerName(id) || ("Sportler " + id)) + '</option>').join("") + '</select></div>';
  if(!mit.length) h += '<p class="sub">Gerade ist nichts verliehen.</p>';
  if(r.sportler){
    const l = ausgeliehenVon(Number(r.sportler));
    h += '<div class="feld"><span class="lbl">Zurück nach</span><select id="rOrt">' + ortOptionen(r.ort) + '</select></div>';
    h += '<div class="card liste" style="margin-bottom:10px">';
    l.forEach((z, i) => h += '<div class="eintrag"><div class="txt"><strong>' + esc((artikel(z.code) || {}).name || z.code) + '</strong> ' + esc(grName(z.groesse)) +
      '<br><span class="sub">ausgeliehen ' + zahl(z.menge) + (z.seit ? ' · seit ' + de(z.seit) : '') + '</span></div>' +
      '<input type="number" min="0" max="' + num(z.menge) + '" step="any" inputmode="decimal" data-rueck="' + i + '" value="' + num(z.menge) + '" style="width:70px" aria-label="Menge zurück"></div>');
    h += '</div><p class="sub" style="margin-top:-4px">Vorgabe: alles zurück. Was behalten wird, auf 0 setzen.</p>';
  }
  h += '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="rueckBuchen"' + (r.sportler ? '' : ' disabled') + '>Zurückbuchen</button></div>';
  modal(h);
}

/* ---------------------------------------------------------------
   Buchungen ansehen und Fehlbuchungen stornieren. Gelöscht wird nie:
   Ein Storno ist eine Gegenbuchung mit Grund, die alte Zeile bleibt.
----------------------------------------------------------------*/
const BUCHUNGSART = { zugang:"Zugang", entnahme:"Entnahme", umbuchung:"Umbuchung", korrektur:"Korrektur", storno:"Storno" };
function zeitKurz(z){ return new Date(z).toLocaleString("de-DE",{ day:"2-digit", month:"2-digit", year:"2-digit", hour:"2-digit", minute:"2-digit" }); }
function buchungsZeile(b, storniert){
  let h = '<div class="eintrag"><div class="txt"><strong>' + (BUCHUNGSART[b.art] || b.art) + ' ' + (num(b.menge) > 0 ? "+" : "") + zahl(b.menge) + '</strong> · ' + esc(b.ort) +
          (b.sportler_id ? ' · ' + esc(sportlerName(b.sportler_id)) : '') + (b.ticket_id ? ' · ' + tnr(b.ticket_id) : '') +
          '<br><span class="sub">' + zeitKurz(b.zeit) + (b.bearbeiter ? ' · ' + esc(b.bearbeiter) : '') + (b.notiz ? ' · ' + esc(b.notiz) : '') +
          (b.rechnung_id ? ' · auf Rechnung' : '') + '</span></div>';
  if(storniert) h += '<span class="chip grau">storniert</span>';
  else if(b.art !== "storno" && !b.rechnung_id && !offline) h += '<button class="btn small" data-a="bStorno" data-x="' + b.id + '">stornieren</button>';
  return h + '</div>';
}
async function buchungenArtikel(code){
  const a = artikel(code);
  modal('<h3>Buchungen · ' + esc(a ? a.name : code) + '</h3><p class="sub">lädt…</p>');
  try{
    const liste = await rest("/buchung?code=eq." + encodeURIComponent(code) + "&order=id.desc&limit=40");
    const ids = liste.map(b => b.id);
    const weg = ids.length ? (await rest("/buchung?storno_von=in.(" + ids.join(",") + ")&select=storno_von")).map(x => x.storno_von) : [];
    let h = '<h3>Buchungen · ' + esc(a ? a.name : code) + '</h3><p class="sub" style="margin-top:-6px">' + esc(code) + ' · die letzten ' + liste.length + ', neueste oben</p>';
    h += '<div class="card liste">' + (liste.length ? liste.map(b => buchungsZeile(b, weg.indexOf(b.id) >= 0)).join("") : '<div class="sub">Noch keine Buchungen.</div>') + '</div>';
    h += '<p class="sub">Stornieren legt eine Gegenbuchung an. Umbuchungen und Leistungen mit Verbrauch werden als Ganzes storniert. Was auf einer Rechnung steht, erst über die Rechnung stornieren.</p>';
    h += '<button class="btn voll" data-a="modalZu">Schließen</button>';
    modal(h);
  }catch(e){ modalZu(); toast(e.message, true); }
}
function postenZeigen(sid){
  const liste = (DB.offenePosten||[]).filter(p => p.sportler_id === sid);
  let h = '<h3>Offene Posten · ' + esc(sportlerName(sid)) + '</h3><div class="card liste">';
  liste.forEach(p => {
    h += '<div class="eintrag"><div class="txt"><strong>' + zahl(-p.menge) + ' × ' + esc((artikel(p.code)||{}).name || p.code) + '</strong> · ' + eur(-p.menge * p.einzelpreis) +
         '<br><span class="sub">' + zeitKurz(p.zeit) + (p.ticket_id ? ' · ' + tnr(p.ticket_id) : '') + (p.bearbeiter ? ' · ' + esc(p.bearbeiter) : '') + (p.notiz ? ' · ' + esc(p.notiz) : '') + '</span></div>' +
         '<button class="btn small" data-a="bStorno" data-x="' + p.id + '">stornieren</button></div>';
  });
  h += '</div><button class="btn voll" data-a="modalZu">Schließen</button>';
  modal(h);
}
function grundAbfragen(titel, text, aktionName, x, knopf){
  modal('<h3>' + titel + '</h3><p class="sub" style="margin-top:-6px">' + text + '</p>' +
        feld("Grund", "sGrund", "", "text", ' placeholder="z. B. falscher Sportler, Menge vertippt"') +
        '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>' +
        '<button class="btn rot" data-a="' + aktionName + '" data-x="' + esc(x) + '">' + knopf + '</button></div>');
  setTimeout(() => { const e = $("sGrund"); if(e) e.focus(); }, 50);
}
