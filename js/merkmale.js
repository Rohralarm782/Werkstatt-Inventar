/* js/merkmale.js — Vorgaben und eigene Einträge (ab 21.0.0): Radtypen, Tag-Gruppen und
   Merkmale (Eigenschaften mit genau einem Wert, z. B. Rahmengröße 52 cm) sowie der
   Lagerort am Rad. Enthält die Merkmal-Felder in den Formularen, die Merkmal-Filter,
   die Verwaltung am Standort (Mehr → Kategorien, Tags & Merkmale) und die Vorgaben
   für den Gesamt-Admin (Mehr → Vorgaben).
   Vorgabe = Eintrag des Landesverbands (standort_id leer), gilt an allen Standorten und
   lässt sich dort nur ausblenden. Eigene Einträge gehören einem Standort.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ---------------------------------------------------------------
   Daten (DB.mk, geladen in ladeMerkmale) und Nachschlagen
----------------------------------------------------------------*/
const RAD_TYPEN_ALT = [["Bahn", "BR"], ["Straße", "SR"], ["Zeitfahren", "ZF"], ["Cross", "CX"], ["Sonstiges", "SO"]];
const TAG_GRUPPEN_ALT = ["Marke", "Baugruppe", "Disziplin"];
const BEIM_SPORTLER = "beim Sportler";
const MK_TYPEN = { auswahl:"Auswahl", zahl:"Zahl", text:"Text", janein:"Ja/Nein" };
const SVG_SCHLOSS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** Ist Migration 21.0.0 gelaufen (Radtypen, Merkmale … geladen)? */
function mkDa(){ return !!(DB && DB.mk); }
function istVorgabe(x){ return !!x && x.standort_id == null; }
function mkAus(art, id){ return mkDa() && DB.mk.aus.some(a => a.art === art && a.objekt_id === Number(id)); }
const natSort = (a, b) => String(a).localeCompare(String(b), "de", { numeric:true, sensitivity:"base" });
/** Vorgaben zuerst (in ihrer Reihenfolge), dann eigene */
function vorgabeZuerst(a, b){ return (istVorgabe(b) - istVorgabe(a)) || (num(a.reihenfolge) - num(b.reihenfolge)) || natSort(a.name, b.name); }

/** Alle Radtypen am Standort: { id, name, kuerzel, vorgabe, aus } — ohne Migration die festen fünf. */
function radTypenAlle(){
  if(!mkDa()) return RAD_TYPEN_ALT.map(([name, kuerzel], i) => ({ id:null, name, kuerzel, vorgabe:true, aus:false, reihenfolge:i }));
  return DB.mk.radtypen.slice().sort(vorgabeZuerst).map(t => Object.assign({}, t, { vorgabe:istVorgabe(t), aus:mkAus("radtyp", t.id) }));
}
/** Wählbare Radtypen (nicht ausgeblendet); extra: diesen Namen zusätzlich (Typ eines vorhandenen Rads). */
function radTypNamen(extra){
  const l = radTypenAlle().filter(t => !t.aus).map(t => t.name);
  if(extra && l.indexOf(extra) < 0) l.push(extra);
  return l;
}
function radTyp(name){ return radTypenAlle().find(t => t.name === name) || null; }
function radKuerzelVon(typ){ const t = radTyp(typ); return t ? t.kuerzel : "SO"; }

/** Gruppen übergreifender Tags: { id, name, vorgabe, aus } */
function tagGruppenAlle(){
  if(!mkDa()) return TAG_GRUPPEN_ALT.map((name, i) => ({ id:null, name, vorgabe:true, aus:false, reihenfolge:i }));
  return DB.mk.gruppen.slice().sort(vorgabeZuerst).map(g => Object.assign({}, g, { vorgabe:istVorgabe(g), aus:mkAus("tag_gruppe", g.id) }));
}
function tagGruppen(){ return tagGruppenAlle().map(g => g.name); }
/** Gruppen, aus denen man im Formular neue Tags wählt/anlegt (ohne Marke, ohne ausgeblendete). */
function tagGruppenWahl(){ return tagGruppenAlle().filter(g => g.name !== "Marke" && !g.aus).map(g => g.name); }
function tagGruppe(name){ return tagGruppenAlle().find(g => g.name === name) || null; }
/* Disziplin = Radtyp (ab 21.1.0): Die Datenbank führt je Radtyp einen Tag der Gruppe
   „Disziplin“ (außer „Sonstiges“). Ein Teil kann mehrere Disziplinen haben; keine heißt
   „passt zu allem“. Neu anlegen und umbenennen nur über die Radtypen. */
const DISZIPLIN = "Disziplin";
/** Namen (klein) der Radtypen, die hier als Disziplin wählbar sind: nicht ausgeblendet, ohne Sonstiges. */
function disziplinNamen(){ return radTypenAlle().filter(t => !t.aus && t.name.toLowerCase() !== "sonstiges").map(t => t.name.toLowerCase()); }
/** Übergreifenden Tag für Neues anbieten? Disziplin nur, wenn ihr Radtyp hier gilt. */
function globWaehlbar(t){ return !!t && !!t.gruppe && t.gruppe !== "Marke" && (t.gruppe !== DISZIPLIN || !mkDa() || disziplinNamen().indexOf(t.name.toLowerCase()) >= 0); }
/** Gruppen, in denen man im Formular neue Tags anlegen darf (ohne Marke und Disziplin). */
function tagGruppenNeu(){ return tagGruppenWahl().filter(g => !(mkDa() && g === DISZIPLIN)); }

function mkMerkmal(id){ return mkDa() ? DB.mk.merkmale.find(m => m.id === Number(id)) || null : null; }
function mkWert(id){ return mkDa() ? DB.mk.werte.find(w => w.id === Number(id)) || null : null; }
function mkZiel(id){ return mkDa() ? DB.mk.ziele.find(z => z.id === Number(id)) || null : null; }

/* Ziel = wo Merkmale abgefragt werden: Rad → { radtyp:id }, Artikel/Einzelstück → { buchstabe } */
function zielRad(typName){ const t = mkDa() ? radTyp(typName) : null; return t && t.id ? { radtyp:t.id } : null; }
function zielKat(b){ return b ? { buchstabe:b } : null; }
function zielVon(art, x){ return art === "rad" ? zielRad(x.typ) : zielKat(stueckKategorie(art === "artikel" ? x.code : x.nummer)); }
function zielPasst(z, ziel){ return !!ziel && (ziel.radtyp ? z.radtyp_id === ziel.radtyp : z.buchstabe === ziel.buchstabe); }
function zielSchluessel(ziel){ return ziel.radtyp ? "rt:" + ziel.radtyp : "k:" + ziel.buchstabe; }
function zielAus(s){ const [a, v] = String(s).split(":"); return a === "rt" ? { radtyp:Number(v) } : { buchstabe:v }; }
function zielName(ziel){
  if(!ziel) return "";
  if(ziel.radtyp){ const t = (DB.mk.radtypen || []).find(x => x.id === ziel.radtyp); return t ? t.name : "?"; }
  return kategorieName(ziel.buchstabe);
}
/** Zuordnungen eines Ziels in Formular-Reihenfolge; mitAus: auch die hier ausgeblendeten. */
function mkZiele(ziel, mitAus){
  if(!mkDa() || !ziel) return [];
  return DB.mk.ziele.filter(z => zielPasst(z, ziel) && (mitAus || !mkAus("merkmal_ziel", z.id)) && mkMerkmal(z.merkmal_id))
    .sort((a, b) => (istVorgabe(b) - istVorgabe(a)) || (a.reihenfolge - b.reihenfolge) || (a.id - b.id));
}
function mkPflicht(zielId){ return mkDa() && DB.mk.pflicht.some(p => p.ziel_id === Number(zielId)); }
/** Werte eines Merkmals zur Auswahl: allgemeine und (bei Rädern) die des Radtyps; ohne ausgeblendete. */
function mkWerte(mid, radtypId, mitAus){
  if(!mkDa()) return [];
  return DB.mk.werte.filter(w => w.merkmal_id === Number(mid) && (w.radtyp_id == null || w.radtyp_id === radtypId) && (mitAus || !mkAus("merkmal_wert", w.id)))
    .sort((a, b) => natSort(a.wert, b.wert));
}
function mkTypText(m){ return MK_TYPEN[m.typ] + (m.typ === "zahl" && m.einheit ? " in " + m.einheit : ""); }
function mkWertText(m, v){
  if(v == null || !m) return "";
  if(m.typ === "auswahl"){ const w = mkWert(v); return w ? w.wert : "?"; }
  if(m.typ === "janein") return v ? "ja" : "nein";
  if(m.typ === "zahl") return zahl(v) + (m.einheit ? " " + m.einheit : "");
  return String(v);
}
/** Merkmale eines Datensatzes als Liste [{ m, text }] in der Reihenfolge seines Ziels (Rest dahinter). */
function mkListe(obj, ziel){
  const mm = (obj && obj.merkmale) || {};
  if(!mkDa() || !Object.keys(mm).length) return [];
  const ids = mkZiele(ziel, true).map(z => String(z.merkmal_id));
  Object.keys(mm).forEach(k => { if(ids.indexOf(k) < 0) ids.push(k); });
  return ids.filter(k => k in mm && mkMerkmal(k)).map(k => ({ m:mkMerkmal(k), text:mkWertText(mkMerkmal(k), mm[k]), v:mm[k] }));
}
/** Kurztext „52 cm · 700C · U15m“ (Ja/Nein: nur der Name, wenn ja); mitName: „Rahmengröße 52 cm · …“ */
function mkText(obj, ziel, mitName){
  return mkListe(obj, ziel).map(x => x.m.typ === "janein" ? (x.v ? x.m.name : (mitName ? x.m.name + " nein" : "")) : (mitName ? x.m.name + " " + x.text : x.text))
    .filter(Boolean).join(" · ");
}
/** Für die Suche: alle Werte und Namen */
function mkSuchtext(obj){ return mkListe(obj, null).map(x => x.m.name + " " + x.text).join(" "); }
/** Für Serien: gleiche Merkmale = gleicher Schlüssel */
function mkSchluessel(obj){ const mm = (obj && obj.merkmale) || {}; return Object.keys(mm).sort().map(k => k + "=" + JSON.stringify(mm[k])).join(","); }
/** Wie oft ein Wert (bzw. das Merkmal überhaupt) eingetragen ist — Räder, Artikel, Einzelstücke dieses Standorts */
function mkNutzung(mid, wid){
  const k = String(mid);
  return [DB.raeder, DB.artikel, DB.stueck].reduce((n, l) => n + (l || []).filter(x => x.merkmale && k in x.merkmale && (wid == null || x.merkmale[k] === wid)).length, 0);
}
/** Wo ein Merkmal abgefragt wird: „Bahn, Straße, Antrieb“ */
function mkWo(mid){
  return DB.mk.ziele.filter(z => z.merkmal_id === Number(mid) && !mkAus("merkmal_ziel", z.id))
    .map(z => z.radtyp_id ? zielName({ radtyp:z.radtyp_id }) : kategorieName(z.buchstabe)).join(", ");
}

/* ---------------------------------------------------------------
   Lagerort am Rad
----------------------------------------------------------------*/
function radOrtDa(){ return (DB.raeder || []).some(r => "ort" in r) || (mkDa() && !(DB.raeder || []).length); }
function radOrtText(r){ return r.ort || ""; }
function radOrtOptionen(aktuell){
  const l = raumOrte().concat([BEIM_SPORTLER]);
  if(aktuell && l.indexOf(aktuell) < 0) l.push(aktuell);
  return '<option value="">— nicht erfasst —</option>' + l.map(o => '<option' + (o === aktuell ? " selected" : "") + '>' + esc(o) + '</option>').join("");
}

/* ---------------------------------------------------------------
   Merkmal-Felder in den Formularen (Rad, Artikel, Einzelstück, Serie).
   <div id="mkBox" data-art data-kat data-alt> — data-alt: bisherige Merkmale.
   Beim Wechsel von Radtyp bzw. Kategorie werden die Felder neu gezeichnet.
----------------------------------------------------------------*/
function mkFeldHtml(z, m, radtypId, v){
  const id = "mk_" + m.id, pfl = mkPflicht(z.id);
  const lbl = esc(m.name) + (m.typ === "zahl" && m.einheit ? " (" + esc(m.einheit) + ")" : "") + (pfl ? " *" : "");
  const attr = ' id="' + id + '" data-mk="' + m.id + '" data-pflicht="' + (pfl ? 1 : 0) + '"';
  let inp;
  if(m.typ === "auswahl"){
    const l = mkWerte(m.id, radtypId), da = v != null && l.some(w => w.id === v);
    inp = '<select' + attr + '><option value="">—</option>' + l.map(w => '<option value="' + w.id + '"' + (v === w.id ? " selected" : "") + '>' + esc(w.wert) + '</option>').join("") +
          (v != null && !da ? '<option value="' + esc(v) + '" selected>' + esc(mkWertText(m, v)) + ' (ausgeblendet)</option>' : '') + '</select>';
    if(!l.length && !(v != null)) inp += '<span class="sub" style="font-size:12px">Noch keine Werte — Mehr → Kategorien, Tags &amp; Merkmale</span>';
  } else if(m.typ === "janein"){
    inp = '<select' + attr + '><option value="">—</option><option value="true"' + (v === true ? " selected" : "") + '>ja</option><option value="false"' + (v === false ? " selected" : "") + '>nein</option></select>';
  } else if(m.typ === "zahl"){
    inp = '<input type="number" step="any" inputmode="decimal"' + attr + ' value="' + esc(v == null ? "" : v) + '">';
  } else {
    inp = '<input type="text" maxlength="200"' + attr + ' value="' + esc(v == null ? "" : v) + '">';
  }
  return '<div class="feld"><label class="lbl" for="' + id + '">' + lbl + '</label>' + inp + '</div>';
}
function mkBoxInnen(ziel, werte){
  const zl = mkZiele(ziel); if(!zl.length) return "";
  const rid = (ziel && ziel.radtyp) || null;
  let h = '<div class="mkkopf">Merkmale · ' + esc(zielName(ziel)) + '</div><div class="grid2 mkgrid">';
  zl.forEach(z => { const m = mkMerkmal(z.merkmal_id); h += mkFeldHtml(z, m, rid, werte[m.id]); });
  return h + '</div>';
}
/** art: "rad" | "artikel" | "stueck"; kat: fester Buchstabe (Bearbeiten), sonst aus der Nummernwahl */
function mkBox(art, ziel, alt, kat){
  if(!mkDa()) return "";
  return '<div id="mkBox" data-art="' + art + '" data-kat="' + esc(kat || "") + '" data-alt="' + esc(JSON.stringify(alt || {})) + '">' + mkBoxInnen(ziel, alt || {}) + '</div>';
}
function mkAltWert(box){ try{ return JSON.parse(box.dataset.alt || "{}") || {}; }catch(e){ return {}; } }
function mkFormZiel(){
  const box = $("mkBox"); if(!box) return null;
  if(box.dataset.art === "rad") return zielRad(wert("rTyp"));
  return zielKat(box.dataset.kat || formKat());
}
/** Ausgefüllte Felder: { merkmalId: Wert } (leer = fehlt) */
function mkFormEingaben(){
  const o = {};
  document.querySelectorAll("#mkBox [data-mk]").forEach(e => {
    const m = mkMerkmal(e.dataset.mk); if(!m) return;
    const t = String(e.value).trim(); if(t === "") return;
    if(m.typ === "auswahl") o[m.id] = Number(t);
    else if(m.typ === "janein") o[m.id] = t === "true";
    else if(m.typ === "zahl"){ const n = Number(t.replace(",", ".")); if(!isNaN(n)) o[m.id] = n; }
    else o[m.id] = t;
  });
  return o;
}
/** Felder neu zeichnen (Radtyp bzw. Kategorie gewechselt); Eingaben bleiben erhalten. */
function mkBoxAktualisieren(){
  const box = $("mkBox"); if(!box) return;
  const w = Object.assign({}, mkAltWert(box));
  document.querySelectorAll("#mkBox [data-mk]").forEach(e => delete w[e.dataset.mk]);
  Object.assign(w, mkFormEingaben());
  box.innerHTML = mkBoxInnen(mkFormZiel(), w);
}
/** Zum Speichern: undefined = keine Merkmal-Felder (Datenbank vor 21.0.0), sonst das neue Objekt.
    Angaben zu hier ausgeblendeten Merkmalen bleiben; Angaben, die nicht mehr zu Radtyp bzw.
    Kategorie passen, fallen weg. Fehlt eine Pflichtangabe → Fehler. */
function mkFormWert(){
  const box = $("mkBox"); if(!box || !mkDa()) return undefined;
  const alt = mkAltWert(box), ziel = mkFormZiel();
  const passend = mkZiele(ziel, true).map(z => String(z.merkmal_id));
  const o = {};
  Object.keys(alt).forEach(k => { if(passend.indexOf(k) >= 0) o[k] = alt[k]; });
  const ein = mkFormEingaben(), fehlt = [];
  document.querySelectorAll("#mkBox [data-mk]").forEach(e => {
    const k = e.dataset.mk;
    if(k in ein) o[k] = ein[k];
    else { delete o[k]; if(e.dataset.pflicht === "1") fehlt.push(mkMerkmal(k).name); }
  });
  if(fehlt.length) throw new Error("Bitte ausfüllen: " + fehlt.join(", "));
  return o;
}

/* ---------------------------------------------------------------
   Filter nach Merkmalen (Lager, Einzelstücke, Räder).
   view[p + "Mk"] = { merkmalId: JSON des Werts }; mehrere gelten zusammen.
----------------------------------------------------------------*/
function mkFilterWahl(p){ const v = view[p + "Mk"]; return v && typeof v === "object" ? v : {}; }
function mkFilterAnwenden(p, items, obj){
  const gew = mkFilterWahl(p), ks = Object.keys(gew);
  if(!ks.length) return items;
  return items.filter(i => { const mm = ((obj(i) || {}).merkmale) || {}; return ks.every(k => JSON.stringify(mm[k]) === gew[k]); });
}
/** Zeile(n) mit den Werten der Merkmale, die in items vorkommen. Gewählte stehen vorn (mit ×). */
function mkFilterZeile(p, items, obj){
  if(!mkDa()) return "";
  const gew = mkFilterWahl(p), c = {};
  items.forEach(i => { const mm = ((obj(i) || {}).merkmale) || {};
    Object.keys(mm).forEach(k => { const key = JSON.stringify(mm[k]); (c[k] = c[k] || {})[key] = (c[k][key] || 0) + 1; }); });
  let h = "";
  Object.keys(gew).forEach(k => { const m = mkMerkmal(k); if(!m) return;
    h += '<button class="btn small primary" data-a="mkFilter" data-x="' + esc(p + "|" + k + "|") + '" aria-label="Filter ' + esc(m.name) + ' aufheben">' + esc(m.name + ": " + mkWertText(m, JSON.parse(gew[k]))) + ' ×</button>'; });
  h = h ? '<div class="chipzeile">' + h + '</div>' : "";
  const mids = Object.keys(c).filter(k => !(k in gew) && mkMerkmal(k) && mkMerkmal(k).typ !== "text")
    .filter(k => Object.keys(c[k]).length > 1 || Object.values(c[k])[0] < items.length)   // nur, wenn es etwas zu unterscheiden gibt
    .sort((a, b) => vorgabeZuerst(mkMerkmal(a), mkMerkmal(b)));
  mids.forEach(k => {
    const m = mkMerkmal(k);
    const keys = Object.keys(c[k]).sort((a, b) => natSort(mkWertText(m, JSON.parse(a)), mkWertText(m, JSON.parse(b))));
    h += '<div class="chipzeile gtzeile"><span class="gtgruppe">' + esc(m.name) + '</span>' +
         keys.map(key => '<button class="btn small" data-a="mkFilter" data-x="' + esc(p + "|" + k + "|" + key) + '">' + esc(mkWertText(m, JSON.parse(key))) + ' · ' + c[k][key] + '</button>').join("") + '</div>';
  });
  return h;
}
/** Räder: Typ, Lagerort und Merkmale. Gibt { html, liste } zurück. */
function radFilter(liste){
  const typ = view.rTyp || "", ort = view.rOrt;   // ort: undefined = alle, "" = nicht erfasst
  let h = '<div class="chipzeile">';
  if(typ){
    const n = liste.filter(r => r.typ === typ).length;
    h += '<button class="btn small primary" data-a="radFilterTyp" data-x="" aria-label="Typ-Filter aufheben">‹ ' + esc(typ) + ' · ' + n + '</button>';
    liste = liste.filter(r => r.typ === typ);
  } else {
    const c = zaehle(liste, r => r.typ), ks = Object.keys(c);
    const reihe = radTypenAlle().map(t => t.name).filter(t => c[t]).concat(ks.filter(k => !radTyp(k)));
    if(reihe.length > 1) reihe.forEach(k => h += '<button class="btn small" data-a="radFilterTyp" data-x="' + esc(k) + '">' + esc(k) + ' · ' + c[k] + '</button>');
  }
  if(radOrtDa()){
    if(ort !== undefined){
      const n = liste.filter(r => (r.ort || "") === ort).length;
      h += '<button class="btn small primary glob" data-a="radFilterOrt" data-x="' + esc(ort) + '" aria-label="Ort-Filter aufheben">' + esc(ort || "Ort nicht erfasst") + ' · ' + n + ' ×</button>';
      liste = liste.filter(r => (r.ort || "") === ort);
    } else {
      const c = zaehle(liste, r => r.ort || "");
      if(Object.keys(c).length > 1) Object.keys(c).sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || natSort(a, b))
        .forEach(k => h += '<button class="btn small glob" data-a="radFilterOrt" data-x="' + esc(k) + '">' + esc(k || "Ort nicht erfasst") + ' · ' + c[k] + '</button>');
    }
  }
  h += '</div>';
  if(h === '<div class="chipzeile"></div>') h = "";
  h += mkFilterZeile("rad", liste, r => r);
  return { html:h, liste:mkFilterAnwenden("rad", liste, r => r) };
}

/* ---------------------------------------------------------------
   Mehr → Kategorien, Tags & Merkmale (am Standort)
   view.ukKat: Buchstabe (Kategorie), "#Gruppe" (Tag-Gruppe), "@rt:id" (Radtyp), "@mk:id" (Merkmal)
----------------------------------------------------------------*/
function herkunftChip(vorgabe, aus){
  return (aus ? '<span class="chip grau">ausgeblendet</span>' : '') +
         (vorgabe ? '<span class="chip grau" title="Vorgabe des Landesverbands — gilt an allen Standorten">' + SVG_SCHLOSS + ' Vorgabe</span>' : '<span class="chip blau">eigen</span>');
}
function anzahlText(n, eins, mehr){ return n + " " + (n === 1 ? eins : mehr); }
/** Abschnitt Radtypen in der Übersicht */
function radtypenAbschnitt(){
  let h = '<h2 class="sec">Radtypen</h2><div class="card" style="padding-top:0;padding-bottom:0">';
  radTypenAlle().forEach(t => {
    const n = (DB.raeder || []).filter(r => r.typ === t.name).length, nm = mkZiele({ radtyp:t.id }).length;
    h += '<button class="zeile-btn' + (t.aus ? ' aus' : '') + '" data-a="ukKatAuf" data-x="@rt:' + t.id + '"><span class="txt"><span class="titel">' + esc(t.name) + ' <span class="sub">· ' + esc(t.kuerzel) + '</span></span>' +
         '<span class="sub">' + anzahlText(n, "Rad", "Räder") + ' · ' + anzahlText(nm, "Merkmal", "Merkmale") + '</span></span><span class="chips">' + herkunftChip(t.vorgabe, t.aus) + '</span>' + SVG_PFEIL + '</button>';
  });
  h += '</div>';
  if(darf("manager")) h += '<div class="row wrapr" style="gap:8px;margin:-4px 0 10px"><button class="btn small" data-a="rtForm" data-x="">+ eigener Radtyp</button></div>';
  return h + '<p class="sub" style="margin-top:-4px">Die Radtypen sind zugleich die Disziplinen bei den Tags (außer „Sonstiges“).</p>';
}
/** Abschnitt Merkmale in der Übersicht */
function merkmaleAbschnitt(){
  const l = DB.mk.merkmale.slice().sort(vorgabeZuerst);
  let h = '<h2 class="sec">Merkmale</h2><div class="card" style="padding-top:0;padding-bottom:0">';
  if(!l.length) h += '<p class="sub">Noch keine.</p>';
  l.forEach(m => {
    const wo = mkWo(m.id);
    h += '<button class="zeile-btn" data-a="ukKatAuf" data-x="@mk:' + m.id + '"><span class="txt"><span class="titel">' + esc(m.name) + '</span>' +
         '<span class="sub">' + esc(mkTypText(m)) + ' · ' + esc(wo || "noch nirgends abgefragt") + '</span></span><span class="chips">' + herkunftChip(istVorgabe(m), false) + '</span>' + SVG_PFEIL + '</button>';
  });
  h += '</div>';
  if(darf("manager")) h += '<div class="row wrapr" style="gap:8px;margin:-4px 0 10px"><button class="btn small" data-a="mkForm" data-x="">+ eigenes Merkmal</button></div>';
  return h + '<p class="sub">Merkmale sind Eigenschaften mit genau einem Wert, z. B. Rahmengröße 52 cm — anders als Tags, die zum Finden da sind. Welche abgefragt werden, steht beim Radtyp bzw. bei der Kategorie.</p>';
}
/** Merkmale eines Radtyps bzw. einer Kategorie: Liste mit Pflicht/ausblenden, dazu Merkmal hinzufügen. */
function zielAbschnitt(ziel){
  const mgr = darf("manager"), zl = mkZiele(ziel, true);
  let h = '<h2 class="sec">Merkmale</h2><div class="card">';
  if(!zl.length) h += '<p class="sub" style="margin:0">Noch keine Merkmale.</p>';
  else {
    h += '<div class="liste">';
    zl.forEach(z => {
      const m = mkMerkmal(z.merkmal_id), aus = mkAus("merkmal_ziel", z.id), pfl = mkPflicht(z.id), vg = istVorgabe(z);
      const werte = m.typ === "auswahl" ? mkWerte(m.id, ziel.radtyp || null).map(w => w.wert) : [];
      const vorschau = m.typ === "auswahl" ? (werte.length ? werte.slice(0, 6).join(", ") + (werte.length > 6 ? " …" : "") : "noch keine Werte") : mkTypText(m);
      h += '<div class="eintrag' + (aus ? ' aus' : '') + '"><button class="lzeile" data-a="ukKatAuf" data-x="@mk:' + m.id + '"><strong>' + esc(m.name) + '</strong>' +
           (pfl && !aus ? ' <span class="chip warn">Pflicht</span>' : '') + ' ' + herkunftChip(vg, aus) + '<br><span class="sub">' + esc(vorschau) + '</span></button>';
      if(mgr) h += '<div class="knoepfe">' + (aus ? '' : '<button class="btn small" data-a="mkPflicht" data-x="' + z.id + '|' + (pfl ? 0 : 1) + '">' + (pfl ? "keine Pflicht" : "Pflicht") + '</button>') +
                   (vg ? '<button class="btn small" data-a="mkAusblenden" data-x="merkmal_ziel|' + z.id + '|' + (aus ? 0 : 1) + '">' + (aus ? "einblenden" : "ausblenden") + '</button>'
                       : '<button class="btn small" data-a="mkZielWeg" data-x="' + z.id + '">entfernen</button>') + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  if(mgr){
    const frei = DB.mk.merkmale.filter(m => !zl.some(z => z.merkmal_id === m.id)).sort((a, b) => natSort(a.name, b.name));
    h += '<div class="row" style="gap:8px;margin-top:10px"><select id="mkZielNeu" aria-label="Merkmal hinzufügen" style="flex:1"><option value="">Merkmal hinzufügen …</option>' +
         frei.map(m => '<option value="' + m.id + '">' + esc(m.name) + (istVorgabe(m) ? '' : ' (eigen)') + '</option>').join("") +
         '<option value="_neu">＋ neues eigenes Merkmal …</option></select><button class="btn primary" data-a="mkZielDazu" data-x="' + zielSchluessel(ziel) + '">Hinzufügen</button></div>';
  }
  h += '</div>';
  if(mgr) h += '<p class="sub">Mit Schloss: Vorgabe des Landesverbands — hier nur ausblenden. Pflicht legt jeder Standort selbst fest; ohne Pflichtangabe lässt sich nicht speichern. Name antippen: Werte ansehen und eigene ergänzen.</p>';
  return h;
}
function radtypVerw(id){
  const t = radTypenAlle().find(x => x.id === id);
  if(!t){ view.ukKat = null; return ukVerw(); }
  const mgr = darf("manager"), n = (DB.raeder || []).filter(r => r.typ === t.name).length;
  let h = '<button class="btn small zurueck" data-a="ukKatZu">← Kategorien, Tags &amp; Merkmale</button>' +
          '<div class="row wrapr" style="gap:8px;align-items:center;margin:4px 0 6px"><h3 style="margin:0">' + esc(t.name) + '</h3>' + herkunftChip(t.vorgabe, t.aus) + '<span class="sp"></span>';
  if(mgr) h += t.vorgabe ? '<button class="btn small" data-a="mkAusblenden" data-x="radtyp|' + t.id + '|' + (t.aus ? 0 : 1) + '">' + (t.aus ? "einblenden" : "ausblenden") + '</button>'
                         : '<button class="btn small" data-a="rtForm" data-x="' + t.id + '">bearbeiten</button>';
  h += '</div><p class="sub" style="margin:0 0 10px">Kürzel ' + esc(t.kuerzel) + ' · Rad-Nummern ' + esc(kuerzel() + "-" + (radVorlage() ? radVorlage() + "-" : "") + t.kuerzel + "-" + "1".padStart(radStellen(), "0")) + ' … · ' + anzahlText(n, "Rad", "Räder") +
       (t.aus ? ' · ausgeblendet: nicht mehr wählbar, vorhandene Räder bleiben' : '') + '</p>';
  return h + zielAbschnitt({ radtyp:t.id });
}
function merkmalVerw(id){
  const m = mkMerkmal(id);
  if(!m){ view.ukKat = null; return ukVerw(); }
  const mgr = darf("manager"), vg = istVorgabe(m);
  let h = '<button class="btn small zurueck" data-a="mkZurueck">← zurück</button>' +
          '<div class="row wrapr" style="gap:8px;align-items:center;margin:4px 0 6px"><h3 style="margin:0">' + esc(m.name) + '</h3>' + herkunftChip(vg, false) + '<span class="sp"></span>' +
          (mgr && !vg ? '<button class="btn small" data-a="mkForm" data-x="' + m.id + '">bearbeiten</button>' : '') + '</div>' +
          '<p class="sub" style="margin:0 0 10px">' + esc(mkTypText(m)) + ' · abgefragt bei: ' + esc(mkWo(m.id) || "noch nirgends") + ' · ' + anzahlText(mkNutzung(m.id), "Eintrag", "Einträge") + '</p>';
  if(m.typ !== "auswahl") return h + '<div class="card"><p class="sub" style="margin:0">Freie Eingabe (' + esc(MK_TYPEN[m.typ]) + ') — keine Werteliste.</p></div>';
  // Gruppen: Werte für alle, dazu je Radtyp, bei dem es eigene Werte gibt oder das Merkmal abgefragt wird
  const rts = [];
  DB.mk.ziele.filter(z => z.merkmal_id === m.id && z.radtyp_id).forEach(z => { if(rts.indexOf(z.radtyp_id) < 0) rts.push(z.radtyp_id); });
  DB.mk.werte.filter(w => w.merkmal_id === m.id && w.radtyp_id).forEach(w => { if(rts.indexOf(w.radtyp_id) < 0) rts.push(w.radtyp_id); });
  const gruppen = [null].concat(rts.filter(r => DB.mk.werte.some(w => w.merkmal_id === m.id && w.radtyp_id === r)));
  gruppen.forEach(rid => {
    const l = DB.mk.werte.filter(w => w.merkmal_id === m.id && (w.radtyp_id || null) === rid).sort((a, b) => natSort(a.wert, b.wert));
    if(rid === null && !l.length && gruppen.length > 1) return;
    h += '<h2 class="sec">' + (rid === null ? (gruppen.length > 1 ? "Werte für alle" : "Werte") : "Werte nur bei " + esc(zielName({ radtyp:rid }))) + '</h2><div class="card"><div class="liste">';
    if(!l.length) h += '<div class="sub">Noch keine Werte.</div>';
    l.forEach(w => {
      const aus = mkAus("merkmal_wert", w.id), wv = istVorgabe(w), n = mkNutzung(m.id, w.id);
      h += '<div class="eintrag' + (aus ? ' aus' : '') + '"><div class="txt">' + (wv ? '<span class="schloss" title="Vorgabe">' + SVG_SCHLOSS + '</span> ' : '') + '<strong>' + esc(w.wert) + '</strong>' +
           (wv ? '' : ' <span class="chip blau">eigen</span>') + (aus ? ' <span class="chip grau">ausgeblendet</span>' : '') + '<br><span class="sub">' + anzahlText(n, "Eintrag", "Einträge") + '</span></div>';
      if(mgr) h += '<div class="knoepfe">' + (wv ? '<button class="btn small" data-a="mkAusblenden" data-x="merkmal_wert|' + w.id + '|' + (aus ? 0 : 1) + '">' + (aus ? "einblenden" : "ausblenden") + '</button>'
                                               : '<button class="btn small" data-a="mkWertForm" data-x="' + w.id + '">bearbeiten</button>') + '</div>';
      h += '</div>';
    });
    h += '</div></div>';
  });
  if(mgr){
    const rtsZiel = DB.mk.ziele.filter(z => z.merkmal_id === m.id && z.radtyp_id).map(z => z.radtyp_id).filter((v, i, a) => a.indexOf(v) === i);
    h += '<div class="card"><span class="lbl">Eigener Wert</span><div class="row" style="gap:8px;flex-wrap:wrap"><input type="text" id="mkWertName" maxlength="40" placeholder="z. B. ' + esc(m.name === "Laufraddimension" ? "700C" : "neuer Wert") + '" style="flex:1 1 140px;min-width:0">' +
         (rtsZiel.length ? '<select id="mkWertRt" aria-label="gilt für" style="flex:1 1 120px;min-width:0"><option value="">für alle</option>' + rtsZiel.map(r => '<option value="' + r + '">nur ' + esc(zielName({ radtyp:r })) + '</option>').join("") + '</select>' : '') +
         '<button class="btn primary" data-a="mkWertNeu" data-x="' + m.id + '">Hinzufügen</button></div></div>';
    h += '<p class="sub">Werte mit Schloss sind Vorgaben des Landesverbands — hier nur ausblenden. Ein ausgeblendeter Wert bleibt bei den Einträgen stehen, die ihn schon haben, ist aber nicht mehr wählbar.</p>';
  }
  return h;
}
/** Kopf der Kategorie-Seite (Mehr → … → Kategorie): Herkunft, ausblenden, Name ändern */
function katKopfKnoepfe(k){
  const kat = (DB.kategorien || []).find(x => x.buchstabe === k);
  if(!kat || !("vorgabe" in kat)) return null;   // Datenbank vor 21.0.0: wie bisher
  const mgr = darf("manager"), aus = kat.aktiv === false;
  return { chip:herkunftChip(kat.vorgabe, aus),
           knoepfe:mgr ? (kat.vorgabe ? '' : '<button class="btn small" data-a="katUmbenennen" data-x="' + esc(k) + '">Name ändern</button>') +
                         '<button class="btn small" data-a="katAusblenden" data-x="' + esc(k) + '">' + (aus ? "einblenden" : "ausblenden") + '</button>' : '' };
}
function katAusgeblendet(k){ const kat = (DB.kategorien || []).find(x => x.buchstabe === k); return !!kat && kat.aktiv === false; }
/** Kopf einer Tag-Gruppe: Herkunft, ausblenden bzw. umbenennen/löschen */
function gruppeKopfKnoepfe(name){
  const g = tagGruppe(name); if(!g || g.id == null) return { chip:"", knoepfe:"" };
  const mgr = darf("manager");
  return { chip:herkunftChip(g.vorgabe, g.aus),
           knoepfe:!mgr ? '' : g.vorgabe ? (g.name === "Marke" ? '' : '<button class="btn small" data-a="mkAusblenden" data-x="tag_gruppe|' + g.id + '|' + (g.aus ? 0 : 1) + '">' + (g.aus ? "einblenden" : "ausblenden") + '</button>')
                                          : '<button class="btn small" data-a="tgForm" data-x="' + g.id + '">bearbeiten</button>' };
}

/* ---------------------------------------------------------------
   Formulare (Modal) am Standort
----------------------------------------------------------------*/
function rtForm(id){
  const t = id ? radTypenAlle().find(x => x.id === id) : { name:"", kuerzel:"" };
  modal('<h3>' + (id ? "Radtyp bearbeiten" : "Eigener Radtyp") + '</h3>' +
        '<div class="grid2">' + feld("Name", "rtName", t.name, "text", ' maxlength="30" placeholder="z. B. Mountainbike"') +
        feld("Kürzel (Rad-Nummer)", "rtKuerzel", t.kuerzel, "text", ' maxlength="3" autocapitalize="characters" placeholder="z. B. MT"') + '</div>' +
        '<p class="sub" style="margin-top:-4px">Das Kürzel steht in neuen Rad-Nummern (' + esc(kuerzel()) + '-MT-01). Vorhandene Nummern bleiben.</p>' +
        '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
        (id ? '<button class="btn small" data-a="mkLoeschen" data-x="radtyp|' + id + '">Löschen</button>' : '') +
        '<span class="sp"></span><button class="btn primary" data-a="rtSpeichern" data-x="' + (id || "") + '">Speichern</button></div>');
}
/** x: id (bearbeiten) oder "" bzw. "|rt:5" (neu, danach dort abfragen) */
function mkForm(x){
  const [ids, ziel] = String(x || "").split("|"), id = Number(ids) || null;
  const m = id ? mkMerkmal(id) : { name:"", typ:"auswahl", einheit:"" };
  const benutzt = id ? mkNutzung(id) > 0 : false;
  modal('<h3>' + (id ? "Merkmal bearbeiten" : "Eigenes Merkmal") + '</h3>' +
        (ziel ? '<p class="sub" style="margin-top:-6px">Wird danach bei ' + esc(zielName(zielAus(ziel))) + ' abgefragt.</p>' : '') +
        feld("Name", "mkName", m.name, "text", ' maxlength="40" placeholder="z. B. Pedalsystem"') +
        '<div class="grid2"><div class="feld"><span class="lbl">Typ</span><select id="mkTyp"' + (benutzt ? ' disabled' : '') + '>' +
        Object.keys(MK_TYPEN).map(k => '<option value="' + k + '"' + (m.typ === k ? " selected" : "") + '>' + MK_TYPEN[k] + '</option>').join("") + '</select></div>' +
        feld("Einheit (nur bei Zahl)", "mkEinheit", m.einheit, "text", ' maxlength="10" placeholder="z. B. mm"') + '</div>' +
        (benutzt ? '<p class="sub" style="margin-top:-4px">Schon eingetragen — der Typ bleibt.</p>' : '<p class="sub" style="margin-top:-4px">Auswahl: Werte legst du danach an (z. B. Look Kéo, Shimano SPD-SL).</p>') +
        '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
        (id ? '<button class="btn small" data-a="mkLoeschen" data-x="merkmal|' + id + '">Löschen</button>' : '') +
        '<span class="sp"></span><button class="btn primary" data-a="mkSpeichern" data-x="' + esc(x || "") + '">Speichern</button></div>');
}
function mkWertForm(id){
  const w = mkWert(id); if(!w) return;
  modal('<h3>Wert bearbeiten</h3><p class="sub" style="margin-top:-6px">' + esc(mkMerkmal(w.merkmal_id).name) + (w.radtyp_id ? ' · nur ' + esc(zielName({ radtyp:w.radtyp_id })) : '') + ' · ' + anzahlText(mkNutzung(w.merkmal_id, w.id), "Eintrag", "Einträge") + '</p>' +
        feld("Wert", "mkWertEdit", w.wert, "text", ' maxlength="40"') +
        '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
        '<button class="btn small" data-a="mkLoeschen" data-x="merkmal_wert|' + w.id + '">Löschen</button>' +
        '<button class="btn small" data-a="mkAusblenden" data-x="merkmal_wert|' + w.id + '|' + (mkAus("merkmal_wert", w.id) ? 0 : 1) + '">' + (mkAus("merkmal_wert", w.id) ? "einblenden" : "ausblenden") + '</button>' +
        '<span class="sp"></span><button class="btn primary" data-a="mkWertSpeichern" data-x="' + w.id + '">Speichern</button></div>');
}
function tgForm(id){
  const g = id ? tagGruppenAlle().find(x => x.id === id) : { name:"" };
  modal('<h3>' + (id ? "Tag-Gruppe bearbeiten" : "Eigene Tag-Gruppe") + '</h3>' +
        feld("Name", "tgName", g.name, "text", ' maxlength="30" placeholder="z. B. Saison"') +
        '<p class="sub" style="margin-top:-4px">Übergreifende Tags dieser Gruppe passen zu jeder Kategorie, z. B. Saison → Winter, Trainingslager.</p>' +
        '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' +
        (id ? '<button class="btn small" data-a="mkLoeschen" data-x="tag_gruppe|' + id + '">Löschen</button>' : '') +
        '<span class="sp"></span><button class="btn primary" data-a="tgSpeichern" data-x="' + (id || "") + '">Speichern</button></div>');
}

/* ---------------------------------------------------------------
   Mehr → Vorgaben (nur Gesamt-Admin): gilt an allen Standorten.
   Daten aus vorgaben() — dort gibt es von den Standorten nur Namen und Anzahlen.
----------------------------------------------------------------*/
let vorgabenCache;   // undefined = noch nicht geladen | "laedt" | { … } | { fehler }
async function ladeVorgaben(){
  if(vorgabenCache === "laedt") return;
  vorgabenCache = "laedt";
  try{ vorgabenCache = await rpc("vorgaben"); }
  catch(e){ vorgabenCache = { fehler:e.message }; }
  if(view.tab === "mehr" && view.mehr === "vorgaben") render();
}
function vgStandorte(n, aus){
  const t = [];
  if(n != null) t.push(n ? "an " + anzahlText(n, "Standort", "Standorten") + " genutzt" : "noch nirgends genutzt");
  if(aus) t.push("an " + aus + " ausgeblendet");
  return t.join(" · ");
}
function vorgabenVerw(){
  const v = vorgabenCache;
  if(v === undefined){ setTimeout(ladeVorgaben, 0); return '<p class="sub">lädt…</p>'; }
  if(v === "laedt") return '<p class="sub">lädt…</p>';
  if(v.fehler) return '<div class="card"><p style="margin:0">' + (/vorgaben/.test(v.fehler) && /function|schema cache|not find/i.test(v.fehler)
    ? 'Für Vorgaben muss die Datenbank aktualisiert werden: <span class="mono">db/migration_21.0.0.sql</span> im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.' : esc(v.fehler)) + '</p></div>';
  if(view.vgMk) return vgMerkmalVerw(view.vgMk);
  const zeile = (titel, sub, knopf) => '<div class="eintrag"><div class="txt"><strong>' + titel + '</strong>' + (sub ? '<br><span class="sub">' + sub + '</span>' : '') + '</div>' + (knopf ? '<div class="knoepfe">' + knopf + '</div>' : '') + '</div>';
  let h = '<div class="banner gelb">Änderungen gelten sofort an allen ' + v.standorte + ' Standorten. Daten der Standorte siehst du hier nicht, nur Anzahlen.</div>';
  h += '<h2 class="sec">Radtypen</h2><div class="card liste">';
  v.radtypen.forEach(t => h += zeile(esc(t.name) + ' <span class="sub">· ' + esc(t.kuerzel) + '</span>', esc(vgStandorte(t.genutzt, t.aus)), '<button class="btn small" data-a="vgRtForm" data-x="' + t.id + '">bearbeiten</button>'));
  h += '<button class="btn small" style="margin-top:8px" data-a="vgRtForm" data-x="">+ Radtyp</button></div>';
  h += '<h2 class="sec">Kategorien</h2><div class="card liste">';
  v.kategorien.forEach(k => h += zeile(esc(k.name) + ' <span class="sub">· ' + esc(k.buchstabe) + '</span>', esc(vgStandorte(null, k.aus)), '<button class="btn small" data-a="vgKatForm" data-x="' + esc(k.buchstabe) + '">bearbeiten</button>'));
  h += '<button class="btn small" style="margin-top:8px" data-a="vgKatForm" data-x="">+ Kategorie</button></div>';
  h += '<h2 class="sec">Tag-Gruppen</h2><div class="card liste">';
  v.gruppen.forEach(g => h += zeile(esc(g.name), esc(vgStandorte(g.genutzt, g.aus)), g.name === "Marke" || g.name === DISZIPLIN ? '' : '<button class="btn small" data-a="vgTgForm" data-x="' + g.id + '">bearbeiten</button>'));
  h += '<button class="btn small" style="margin-top:8px" data-a="vgTgForm" data-x="">+ Tag-Gruppe</button></div>';
  h += '<h2 class="sec">Merkmale</h2><div class="card" style="padding-top:0;padding-bottom:0">';
  v.merkmale.forEach(m => {
    const wo = vgWo(m.id);
    h += '<button class="zeile-btn" data-a="vgMkAuf" data-x="' + m.id + '"><span class="txt"><span class="titel">' + esc(m.name) + '</span><span class="sub">' + esc(MK_TYPEN[m.typ] + " · " + (wo || "noch nirgends abgefragt") + " · " + vgStandorte(m.genutzt)) + '</span></span>' + SVG_PFEIL + '</button>';
  });
  h += '</div><div class="row wrapr" style="gap:8px;margin:-4px 0 10px"><button class="btn small" data-a="vgMkForm" data-x="">+ Merkmal</button></div>';
  h += '<h2 class="sec">Vorschläge aus den Standorten</h2>';
  if(!v.vorschlaege.length) h += '<div class="leer">Keine — die Standorte haben nichts Eigenes angelegt.</div>';
  else {
    const art = { radtyp:"Radtyp", kategorie:"Kategorie", tag_gruppe:"Tag-Gruppe", merkmal:"Merkmal", merkmal_wert:"Wert" };
    h += '<div class="card liste">';
    v.vorschlaege.forEach(x => h += zeile(esc(art[x.art] + " „" + x.name + "“"),
      esc([x.zusatz && x.art === "merkmal" ? MK_TYPEN[x.zusatz] : x.zusatz, "in " + (x.standorte || []).join(", ")].filter(Boolean).join(" · ")),
      '<button class="btn small primary" data-a="vgUebernehmen" data-x="' + esc(x.art + "|" + (x.id || "") + "|" + (x.buchstabe || "")) + '">übernehmen</button>'));
    h += '</div><p class="sub">Übernehmen macht den Eintrag zur Vorgabe. Gleichnamige eigene Einträge aller Standorte gehen darin auf; Angaben an Rädern, Artikeln und Teilen bleiben erhalten.</p>';
  }
  return h;
}
function vgWo(mid){
  const v = vorgabenCache;
  return v.ziele.filter(z => z.merkmal_id === mid).map(z => z.radtyp_id ? ((v.radtypen.find(t => t.id === z.radtyp_id) || {}).name || "?") : ((v.kategorien.find(k => k.buchstabe === z.buchstabe) || {}).name || z.buchstabe)).join(", ");
}
function vgMerkmalVerw(id){
  const v = vorgabenCache, m = v.merkmale.find(x => x.id === id);
  if(!m){ view.vgMk = null; return vorgabenVerw(); }
  let h = '<button class="btn small zurueck" data-a="vgMkZu">← Vorgaben</button>' +
          '<div class="row wrapr" style="gap:8px;align-items:center;margin:4px 0 6px"><h3 style="margin:0">' + esc(m.name) + '</h3><span class="sp"></span>' +
          '<button class="btn small" data-a="vgMkForm" data-x="' + m.id + '">bearbeiten</button></div>' +
          '<p class="sub" style="margin:0 0 10px">' + esc(mkTypText(m) + " · " + vgStandorte(m.genutzt)) + '</p>';
  // Abgefragt bei: alle Vorgabe-Radtypen und -Kategorien zum An-/Abhaken
  const ziel = (rid, b) => v.ziele.find(z => z.merkmal_id === id && (rid ? z.radtyp_id === rid : z.buchstabe === b));
  const knopf = (rid, b, name) => { const z = ziel(rid, b);
    return '<button class="btn small' + (z ? ' primary' : '') + '" aria-pressed="' + !!z + '" data-a="vgZiel" data-x="' + id + '|' + (rid ? "rt:" + rid : "k:" + b) + '|' + (z ? 0 : 1) + '"' +
           (z && (z.pflicht || z.aus) ? ' title="' + esc(["Pflicht an " + z.pflicht, "ausgeblendet an " + z.aus].join(" · ")) + '"' : '') + '>' + esc(name) + '</button>'; };
  h += '<div class="card"><span class="lbl">Abgefragt bei (für alle Standorte)</span><div class="tagwahl">' + v.radtypen.map(t => knopf(t.id, null, t.name)).join("") + '</div>' +
       '<div class="tagwahl" style="margin-top:6px">' + v.kategorien.map(k => knopf(null, k.buchstabe, k.name)).join("") + '</div>' +
       '<p class="sub" style="margin:8px 0 0">Antippen = an/aus. Pflicht legen die Standorte selbst fest.</p></div>';
  if(m.typ === "auswahl"){
    const rts = v.ziele.filter(z => z.merkmal_id === id && z.radtyp_id).map(z => z.radtyp_id);
    v.werte.filter(w => w.merkmal_id === id && w.radtyp_id).forEach(w => { if(rts.indexOf(w.radtyp_id) < 0) rts.push(w.radtyp_id); });
    const rtsU = rts.filter((x, i, a) => a.indexOf(x) === i);
    [null].concat(rtsU).forEach(rid => {
      const l = v.werte.filter(w => w.merkmal_id === id && (w.radtyp_id || null) === rid).sort((a, b) => natSort(a.wert, b.wert));
      if(rid !== null && !l.length) return;
      h += '<h2 class="sec">' + (rid === null ? (rtsU.some(r => v.werte.some(w => w.merkmal_id === id && w.radtyp_id === r)) ? "Werte für alle" : "Werte") : "Werte nur bei " + esc((v.radtypen.find(t => t.id === rid) || {}).name || "?")) + '</h2><div class="card liste">';
      if(!l.length) h += '<div class="sub">Keine Vorgabe-Werte — die Standorte legen eigene an.</div>';
      l.forEach(w => h += '<div class="eintrag"><div class="txt"><strong>' + esc(w.wert) + '</strong><br><span class="sub">' + esc(vgStandorte(w.genutzt, w.aus)) + '</span></div>' +
                         '<div class="knoepfe"><button class="btn small" data-a="vgWertForm" data-x="' + w.id + '">bearbeiten</button></div></div>');
      h += '</div>';
    });
    h += '<div class="card"><span class="lbl">Vorgabe-Wert</span><div class="row" style="gap:8px;flex-wrap:wrap"><input type="text" id="vgWertName" maxlength="40" placeholder="neuer Wert" style="flex:1 1 140px;min-width:0">' +
         (rtsU.length ? '<select id="vgWertRt" aria-label="gilt für" style="flex:1 1 120px;min-width:0"><option value="">für alle</option>' + rtsU.map(r => '<option value="' + r + '">nur ' + esc((v.radtypen.find(t => t.id === r) || {}).name || "?") + '</option>').join("") + '</select>' : '') +
         '<button class="btn primary" data-a="vgWertNeu" data-x="' + id + '">Hinzufügen</button></div></div>';
  }
  return h;
}
function vgFormular(titel, felder, loeschen, speichern){
  modal('<h3>' + titel + '</h3>' + felder + '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button>' + (loeschen || '') +
        '<span class="sp"></span>' + speichern + '</div>');
}
/** Vorgabe ändern: danach Vorgaben und Standort-Daten neu laden */
function vgAktion(fn, meldung){
  return aktion(async () => { const r = await fn(); vorgabenCache = undefined; return r; }, meldung);
}

/* ---------------------------------------------------------------
   Aktionen
----------------------------------------------------------------*/
Object.assign(A, {
  /* Filter */
  mkFilter: x => {
    const [p, k, ...rest] = x.split("|"), key = rest.join("|"), o = Object.assign({}, mkFilterWahl(p));
    if(!key || o[k] === key) delete o[k]; else o[k] = key;
    view[p + "Mk"] = o; render();
  },
  radFilterTyp: x => { view.rTyp = x || ""; view.radMk = {}; render(); },
  radFilterOrt: x => { view.rOrt = view.rOrt === x ? undefined : x; render(); },
  /* Navigation */
  mkZurueck: () => { view.ukKat = view.ukVon || null; view.ukVon = null; render(); window.scrollTo(0,0); },
  /* Standort: Radtypen, Merkmale, Werte, Tag-Gruppen */
  rtForm: x => rtForm(x ? Number(x) : null),
  rtSpeichern: x => {
    const n = wert("rtName").trim(), k = wert("rtKuerzel").trim().toUpperCase();
    if(!n){ toast("Name fehlt.", true); return; }
    if(!/^[A-Z]{2,3}$/.test(k)){ toast("Kürzel: 2 bis 3 Buchstaben A–Z.", true); return; }
    aktion(async () => { const id = await rpc("radtyp_speichern", { p_id:x ? Number(x) : null, p_name:n, p_kuerzel:k, p_vorgabe:false }); if(!x) view.ukKat = "@rt:" + id; return id; }, n + " gespeichert");
  },
  mkForm: x => mkForm(x),
  mkSpeichern: x => {
    const [ids, ziel] = String(x || "").split("|"), id = Number(ids) || null;
    const n = wert("mkName").trim(), typ = wert("mkTyp"), e = wert("mkEinheit").trim();
    if(!n){ toast("Name fehlt.", true); return; }
    aktion(async () => {
      const mid = await rpc("merkmal_speichern", { p_id:id, p_name:n, p_typ:typ, p_einheit:typ === "zahl" ? (e || null) : null, p_vorgabe:false });
      if(ziel){ const z = zielAus(ziel); await rpc("merkmal_ziel_setzen", { p_merkmal:mid, p_radtyp:z.radtyp || null, p_buchstabe:z.buchstabe || null, p_an:true, p_vorgabe:false }); }
      if(!id){ view.ukVon = view.ukKat; view.ukKat = "@mk:" + mid; }   // vor dem Neuzeichnen: gleich zur Seite des neuen Merkmals
      return mid;
    }, n + " gespeichert");
  },
  mkWertNeu: x => {
    const n = wert("mkWertName").trim(); if(!n){ toast("Wert fehlt.", true); return; }
    const rt = $("mkWertRt") && wert("mkWertRt") ? Number(wert("mkWertRt")) : null;
    aktion(() => rpc("merkmal_wert_speichern", { p_id:null, p_merkmal:Number(x), p_radtyp:rt, p_wert:n, p_vorgabe:false }), n + " hinzugefügt");
  },
  mkWertForm: x => mkWertForm(Number(x)),
  mkWertSpeichern: x => {
    const n = wert("mkWertEdit").trim(); if(!n){ toast("Wert fehlt.", true); return; }
    aktion(() => rpc("merkmal_wert_speichern", { p_id:Number(x), p_merkmal:null, p_radtyp:null, p_wert:n, p_vorgabe:false }), "Gespeichert");
  },
  mkAusblenden: x => {
    const [art, id, aus] = x.split("|");
    aktion(() => rpc("ausblenden", { p_art:art, p_id:Number(id), p_aus:aus === "1" }), aus === "1" ? "Ausgeblendet" : "Eingeblendet");
  },
  mkPflicht: x => { const [id, an] = x.split("|"); aktion(() => rpc("merkmal_pflicht_setzen", { p_ziel:Number(id), p_an:an === "1" }), an === "1" ? "Jetzt Pflicht" : "Keine Pflicht mehr"); },
  mkZielWeg: x => {
    const z = mkZiel(x); if(!z) return;
    const m = mkMerkmal(z.merkmal_id);
    if(!confirm("„" + m.name + "“ bei " + (z.radtyp_id ? zielName({ radtyp:z.radtyp_id }) : kategorieName(z.buchstabe)) + " nicht mehr abfragen?\n\nSchon eingetragene Angaben bleiben gespeichert.")) return;
    aktion(() => rpc("merkmal_ziel_setzen", { p_merkmal:z.merkmal_id, p_radtyp:z.radtyp_id, p_buchstabe:z.buchstabe, p_an:false, p_vorgabe:false }), m.name + " entfernt");
  },
  mkZielDazu: x => {
    const v = wert("mkZielNeu"); if(!v){ toast("Bitte ein Merkmal wählen.", true); return; }
    if(v === "_neu"){ mkForm("|" + x); return; }
    const z = zielAus(x);
    aktion(() => rpc("merkmal_ziel_setzen", { p_merkmal:Number(v), p_radtyp:z.radtyp || null, p_buchstabe:z.buchstabe || null, p_an:true, p_vorgabe:false }), (mkMerkmal(v) || {}).name + " hinzugefügt");
  },
  mkLoeschen: x => {
    const [art, id] = x.split("|");
    if(!confirm("Wirklich löschen? Geht nur, solange nichts mehr daran hängt — sonst besser ausblenden.")) return;
    aktion(async () => { await rpc("eintrag_loeschen", { p_art:art, p_id:Number(id) }); if(art !== "merkmal_wert") view.ukKat = null; }, "Gelöscht");
  },
  tgForm: x => tgForm(x ? Number(x) : null),
  tgSpeichern: x => {
    const n = wert("tgName").trim(); if(!n){ toast("Name fehlt.", true); return; }
    aktion(async () => { await rpc("tag_gruppe_speichern", { p_id:x ? Number(x) : null, p_name:n, p_vorgabe:false }); if(x) view.ukKat = "#" + n; }, n + " gespeichert");
  },
  katAusblenden: x => {
    const kat = (DB.kategorien || []).find(k => k.buchstabe === x); if(!kat) return;
    aktion(() => aendern("kategorie", "buchstabe=eq." + encodeURIComponent(x), { aktiv:kat.aktiv === false }), kat.aktiv === false ? "Eingeblendet" : "Ausgeblendet — für neue Artikel und Teile nicht mehr wählbar");
  },

  /* Gesamt-Admin: Vorgaben */
  vgMkAuf: x => { view.vgMk = Number(x); render(); window.scrollTo(0,0); },
  vgMkZu: () => { view.vgMk = null; render(); window.scrollTo(0,0); },
  vgRtForm: x => {
    const t = x ? vorgabenCache.radtypen.find(y => y.id === Number(x)) : { name:"", kuerzel:"" };
    vgFormular(x ? "Vorgabe-Radtyp" : "Neuer Vorgabe-Radtyp",
      '<div class="grid2">' + feld("Name", "vgName", t.name, "text", ' maxlength="30"') + feld("Kürzel", "vgKuerzel", t.kuerzel, "text", ' maxlength="3" autocapitalize="characters"') + '</div>' +
      '<p class="sub" style="margin-top:-4px">Umbenennen ändert den Typ an allen Rädern mit. Heißt ein eigener Radtyp eines Standorts genauso, geht er in der Vorgabe auf.</p>',
      x ? '<button class="btn small" data-a="vgLoeschen" data-x="radtyp|' + x + '">Löschen</button>' : '',
      '<button class="btn primary" data-a="vgRtSpeichern" data-x="' + (x || "") + '">Speichern</button>');
  },
  vgRtSpeichern: x => {
    const n = wert("vgName").trim(), k = wert("vgKuerzel").trim().toUpperCase();
    if(!n || !/^[A-Z]{2,3}$/.test(k)){ toast("Name und Kürzel (2–3 Buchstaben) angeben.", true); return; }
    vgAktion(() => rpc("radtyp_speichern", { p_id:x ? Number(x) : null, p_name:n, p_kuerzel:k, p_vorgabe:true }), n + " gespeichert");
  },
  vgKatForm: x => {
    const k = x ? vorgabenCache.kategorien.find(y => y.buchstabe === x) : { buchstabe:"", name:"" };
    vgFormular(x ? "Vorgabe-Kategorie " + esc(x) : "Neue Vorgabe-Kategorie",
      '<div class="grid2">' + feld("Buchstabe im Code", "vgBuch", k.buchstabe, "text", ' maxlength="3" autocapitalize="characters"' + (x ? ' disabled' : '')) + feld("Name", "vgName", k.name, "text", ' maxlength="40"') + '</div>' +
      '<p class="sub" style="margin-top:-4px">Gilt sofort an allen Standorten. Steht der Buchstabe an einem Standort schon für eine andere eigene Kategorie, muss das dort erst geklärt werden.</p>',
      x ? '<button class="btn small" data-a="vgLoeschen" data-x="kategorie|' + esc(x) + '">Aufheben</button>' : '',
      '<button class="btn primary" data-a="vgKatSpeichern" data-x="' + esc(x || "") + '">Speichern</button>');
  },
  vgKatSpeichern: x => {
    const b = (x || wert("vgBuch")).trim().toUpperCase(), n = wert("vgName").trim();
    if(!/^[A-Z]{1,3}$/.test(b) || !n){ toast("Buchstabe (1–3) und Name angeben.", true); return; }
    vgAktion(() => rpc("vorgabe_kategorie_speichern", { p_buchstabe:b, p_name:n }), n + " gespeichert");
  },
  vgTgForm: x => {
    const g = x ? vorgabenCache.gruppen.find(y => y.id === Number(x)) : { name:"" };
    vgFormular(x ? "Vorgabe-Tag-Gruppe" : "Neue Vorgabe-Tag-Gruppe", feld("Name", "vgName", g.name, "text", ' maxlength="30"'),
      x ? '<button class="btn small" data-a="vgLoeschen" data-x="tag_gruppe|' + x + '">Löschen</button>' : '',
      '<button class="btn primary" data-a="vgTgSpeichern" data-x="' + (x || "") + '">Speichern</button>');
  },
  vgTgSpeichern: x => {
    const n = wert("vgName").trim(); if(!n){ toast("Name fehlt.", true); return; }
    vgAktion(() => rpc("tag_gruppe_speichern", { p_id:x ? Number(x) : null, p_name:n, p_vorgabe:true }), n + " gespeichert");
  },
  vgMkForm: x => {
    const m = x ? vorgabenCache.merkmale.find(y => y.id === Number(x)) : { name:"", typ:"auswahl", einheit:"" };
    vgFormular(x ? "Vorgabe-Merkmal" : "Neues Vorgabe-Merkmal",
      feld("Name", "vgName", m.name, "text", ' maxlength="40"') +
      '<div class="grid2"><div class="feld"><span class="lbl">Typ</span><select id="vgTyp"' + (x && m.genutzt ? ' disabled' : '') + '>' + Object.keys(MK_TYPEN).map(k => '<option value="' + k + '"' + (m.typ === k ? " selected" : "") + '>' + MK_TYPEN[k] + '</option>').join("") + '</select></div>' +
      feld("Einheit (nur bei Zahl)", "vgEinheit", m.einheit, "text", ' maxlength="10"') + '</div>',
      x ? '<button class="btn small" data-a="vgLoeschen" data-x="merkmal|' + x + '">Löschen</button>' : '',
      '<button class="btn primary" data-a="vgMkSpeichern" data-x="' + (x || "") + '">Speichern</button>');
  },
  vgMkSpeichern: x => {
    const n = wert("vgName").trim(), typ = wert("vgTyp"), e = wert("vgEinheit").trim();
    if(!n){ toast("Name fehlt.", true); return; }
    vgAktion(async () => { const id = await rpc("merkmal_speichern", { p_id:x ? Number(x) : null, p_name:n, p_typ:typ, p_einheit:typ === "zahl" ? (e || null) : null, p_vorgabe:true }); if(!x) view.vgMk = id; return id; },
             n + " gespeichert");
  },
  vgZiel: x => {
    const [mid, ziel, an] = x.split("|"), z = zielAus(ziel);
    vgAktion(() => rpc("merkmal_ziel_setzen", { p_merkmal:Number(mid), p_radtyp:z.radtyp || null, p_buchstabe:z.buchstabe || null, p_an:an === "1", p_vorgabe:true }));
  },
  vgWertNeu: x => {
    const n = wert("vgWertName").trim(); if(!n){ toast("Wert fehlt.", true); return; }
    const rt = $("vgWertRt") && wert("vgWertRt") ? Number(wert("vgWertRt")) : null;
    vgAktion(() => rpc("merkmal_wert_speichern", { p_id:null, p_merkmal:Number(x), p_radtyp:rt, p_wert:n, p_vorgabe:true }), n + " hinzugefügt");
  },
  vgWertForm: x => {
    const w = vorgabenCache.werte.find(y => y.id === Number(x)); if(!w) return;
    vgFormular("Vorgabe-Wert", feld("Wert", "vgName", w.wert, "text", ' maxlength="40"') + '<p class="sub" style="margin-top:-4px">' + esc(vgStandorte(w.genutzt, w.aus)) + '</p>',
      '<button class="btn small" data-a="vgLoeschen" data-x="merkmal_wert|' + w.id + '">Löschen</button>',
      '<button class="btn primary" data-a="vgWertSpeichern" data-x="' + w.id + '">Speichern</button>');
  },
  vgWertSpeichern: x => {
    const n = wert("vgName").trim(); if(!n){ toast("Wert fehlt.", true); return; }
    vgAktion(() => rpc("merkmal_wert_speichern", { p_id:Number(x), p_merkmal:null, p_radtyp:null, p_wert:n, p_vorgabe:true }), "Gespeichert");
  },
  vgLoeschen: x => {
    const [art, id] = x.split("|");
    if(!confirm(art === "kategorie" ? "Vorgabe aufheben? An den Standorten bleibt die Kategorie als eigene stehen." : "Vorgabe löschen? Geht nur, solange an keinem Standort etwas daran hängt.")) return;
    vgAktion(async () => { await (art === "kategorie" ? rpc("vorgabe_kategorie_loeschen", { p_buchstabe:id }) : rpc("eintrag_loeschen", { p_art:art, p_id:Number(id) })); if(art === "merkmal") view.vgMk = null; },
             art === "kategorie" ? "Aufgehoben" : "Gelöscht");
  },
  vgUebernehmen: x => {
    const [art, id, b] = x.split("|");
    if(!confirm("Als Vorgabe für alle Standorte übernehmen? Gleichnamige eigene Einträge gehen darin auf.")) return;
    vgAktion(() => rpc("als_vorgabe_uebernehmen", { p_art:art, p_id:id ? Number(id) : null, p_buchstabe:b || null }), "Übernommen");
  }
});
Object.assign(C, {
  /** Lagerort eines Rads direkt auf der Rad-Seite ändern */
  radOrt: (v, x) => aktion(() => aendern("rad", "id=eq." + encodeURIComponent(x), { ort:v || null }), "Lagerort: " + (v || "nicht erfasst"))
});
