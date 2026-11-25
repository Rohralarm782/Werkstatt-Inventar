/* js/sitzposition.js — Sitzpositionen je Rad (ab 21.8.0)
   Sattel (SH, S) und Lenker eines Rads in Millimetern, mit Grafik, die sich mit
   den Werten bewegt, Prüf-Hinweisen, Laserjig-Haken je Lenker und Verlauf.
   - Normaler Lenker („Bahnlenker“): jedes Rad hat einen Standard-Lenker ohne
     Einzelstück. Ein montiertes Einzelstück mit Tag „Lenker“ ersetzt ihn.
   - Zeitfahraufsatz: nur, wenn ein Einzelstück mit Tag „TT-Lenker“ am Rad ist.
   - Werte und Jig-Haken gelten je Rad + Lenker. Der Sattel gilt fürs Rad.
   - Gespeichert wird über die Datenbankfunktion sitzposition_speichern; jede
     Speicherung ist eine neue Zeile (Verlauf). Aktueller Stand: DB.sitzpos
     (aus app_daten bzw. v_sitzposition).
   - Kein Wert verschiebt einen anderen. Wer einen Wert am Sattel bzw. Lenker
     ändert, wird gebeten, die zugehörigen Werte zu prüfen; der Vorbau löst das
     aus, wird selbst aber nie zur Prüfung markiert.
   Buchstaben wie in der UCI-Infografik: S, E, H; dazu SH, L, V, SP.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ---------------------------------------------------------------
   Felder
----------------------------------------------------------------*/
/* key: intern (Vorbau getrennt je Lenkerart), k: Buchstabe in der App, sp: Spalte in der Datenbank,
   min/max: Schieber (Eingabe ins Zahlfeld darf darüber hinaus), ref: Wert, mit dem die Grafik gezeichnet ist */
const SP_FELD = {
  SH: { k:"SH", sp:"sattelhoehe",   name:"Sattelhöhe",         hint:"Tretlagermitte bis Satteloberkante",              min:550, max:850, ref:742, gruppe:"sattel" },
  S:  { k:"S",  sp:"sattelversatz", name:"Sattelversatz",      hint:"Sattelspitze hinter dem Lot durchs Tretlager",    min:0,   max:70,  ref:63,  gruppe:"sattel" },
  L:  { k:"L",  sp:"lenker_vorne",  name:"Lenker vorne",       hint:"Tretlagermitte bis Lenkermitte, waagerecht",      min:400, max:680, ref:568, gruppe:"bahn" },
  Vb: { k:"V",  sp:"vorbau",        name:"Vorbau",             hint:"Länge · nur zur Info",                           min:40,  max:150, ref:120, gruppe:"bahn" },
  SP: { k:"SP", sp:"spacer",        name:"Stack (Spacer)",     hint:"Spacer unter den Armschalen",                     min:0,   max:150, ref:45,  gruppe:"tt" },
  Vt: { k:"V",  sp:"vorbau",        name:"Vorbau",             hint:"Länge · nur zur Info",                           min:40,  max:150, ref:120, gruppe:"tt" },
  E:  { k:"E",  sp:"reichweite",    name:"Reichweite Aufsatz", hint:"Tretlagerachse bis Aufsatzspitze, waagerecht · max. 850", min:650, max:850, ref:798, gruppe:"tt" },
  H:  { k:"H",  sp:"erhoehung",     name:"Erhöhung",           hint:"Mitte Armschale bis höchster Punkt Aufsatz · max. 140",   min:0,   max:140, ref:95,  gruppe:"tt" }
};
const SP_REIHE = { bahn:["SH", "S", "L", "Vb"], tt:["SH", "S", "SP", "Vt", "E", "H"] };
const SP_VORBAU = ["Vb", "Vt"];   // lösen Prüf-Hinweise aus, werden selbst nie markiert
/* Farben: Sitz blau, Lenker vorn rot (Bahnlinien der App), Vorbau/Spacer grau */
const SP_FARBE = { sattel:["#1B4CA1", "#E3ECF8"], vorn:["#C8102E", "#FBE7EA"], grau:["#5C646E", "#EFEDE9"] };
function spFarbe(key){ return key === "SH" || key === "S" ? SP_FARBE.sattel : key === "L" || key === "E" || key === "H" ? SP_FARBE.vorn : SP_FARBE.grau; }
const SP_ART_TEXT = { bahn:"Bahnlenker", tt:"Zeitfahraufsatz" };

/* ---------------------------------------------------------------
   Daten
----------------------------------------------------------------*/
/** Ist Migration 21.8.0 gelaufen? (app_daten liefert dann sitzpos) */
function spDa(){ return !!DB && Array.isArray(DB.sitzpos); }
/** Hat das Einzelstück einen Tag dieses Namens (Groß/Klein egal)? */
function spHatTag(nr, name){
  if(!DB || !DB.tags) return false;
  const ids = (tagIndexHolen().stueck[nr] || []);
  return ids.some(id => { const t = tagNachId(id); return t && String(t.name).trim().toLowerCase() === name; });
}
/** Montierte Lenker-Stücke am Rad: { bahn: Stück|null (Tag „Lenker“), tt: Stück|null (Tag „TT-Lenker“) } */
function spLenker(radId){
  const am = stueckAm(radId).slice().sort((a, b) => a.nummer.localeCompare(b.nummer, "de", { numeric:true }));
  return { bahn: am.find(s => spHatTag(s.nummer, "lenker")) || null, tt: am.find(s => spHatTag(s.nummer, "tt-lenker")) || null };
}
/** Aktueller Stand am Rad: Sattel aus der neuesten Zeile, Lenker je Art aus der Zeile des montierten Lenkers. */
function spAktuell(radId, lenker){
  const z = (DB.sitzpos || []).filter(x => x.rad_id === radId);
  const neueste = z.reduce((m, x) => !m || x.id > m.id ? x : m, null);
  const fuer = (art, st) => z.filter(x => x.art === art && (x.stueck_nummer || null) === (st ? st.nummer : null)).reduce((m, x) => !m || x.id > m.id ? x : m, null);
  return { sattel:neueste, bahn:fuer("bahn", lenker.bahn), tt:lenker.tt ? fuer("tt", lenker.tt) : null };
}
function spLenkerName(s, art){
  if(!s) return art === "bahn" ? "Standard-Lenker des Rads" : "—";
  return s.nummer + " · " + [s.typ, s.marke, s.detail && s.detail !== s.typ ? s.detail : ""].filter(Boolean).join(" · ");
}
/** UCI-Kategorie eines Sportlers als Chip-Text oder "". */
function spUciText(sportlerId){
  const s = sportlerId ? (DB.sportler || []).find(x => x.id === sportlerId) : null;
  return s && s.uci_kategorie ? "UCI Kat. " + s.uci_kategorie : "";
}
function spZahl(v){ if(v === null || v === undefined || String(v).trim() === "") return null; const n = Number(String(v).replace(",", ".").trim()); return isFinite(n) ? Math.round(n) : NaN; }
function spDatum(ts){ return ts ? deLang(ts) : ""; }
function spZeit(ts){ return ts ? deLang(ts) + " " + uhr(new Date(ts)) : ""; }

/* ---------------------------------------------------------------
   Grafik (Seitenansicht). Maßstab ≈ 0,2 px/mm; jeder Wert bewegt nur sein Teil.
   w: { SH, S, L, SP, E, H } in mm (null = Zeichnungswert), aktiv: Feld-Key oder null.
----------------------------------------------------------------*/
let spSvgNr = 0;
function spGeometrie(w){
  const n = k => { const x = w[k]; return x === null || x === undefined || isNaN(x) ? SP_FELD[k].ref : x; };
  const r = x => Math.round(x * 10) / 10, kl = (x, a, b) => Math.max(a, Math.min(b, x));
  // Sattelhöhe: Stütze fährt entlang des Sitzrohrs aus/ein (Änderung 1,5-fach dargestellt)
  const dL = kl(n("SH") - 742, -192, 108) * 0.3;
  const ax = -0.2756 * dL, ay = -0.9613 * dL;
  // Versatz S: nur der Sattel, ab dem Lot durchs Tretlager (0 = Spitze genau über dem Tretlager)
  const tipSX = 190 - kl(n("S"), 0, 70) * 0.4, sx = tipSX - 179;
  const pX = 149 + ax, pY = 55 + ay, bY = Math.max(16, 38 + ay);
  // Bahn: Lenkermitte waagerecht ab Tretlager
  const clampX = 291 + kl(n("L") - 568, -168, 112) * 0.4;
  // Zeitfahren: Spacer heben die Armschale, E setzt die Spitze nach vorn, H die Höhe über der Armschale
  const padX = 270, padY = 66 - kl(n("SP") - 45, -45, 105) * 0.4;
  const tipX = kl(349 + (n("E") - 798) * 0.4, padX + 30, 372);
  const tipY = padY - kl(n("H"), 0, 140) * 0.22;
  const y0 = padY + 3, spTop = padY + 3, gX = Math.min(tipX + 16, 386);
  return { r, ax, ay, sx, pX, pY, tipSX, tipSY:58 + ay, bY, clampX, padX, padY, tipX, tipY, y0, spTop, spH:Math.max(1, 89 - spTop), gX };
}
function spSvg(modus, w, aktiv, label){
  const g = spGeometrie(w), r = g.r, id = "spRad" + (++spSvgNr), zf = modus === "tt";
  const op = keys => !aktiv || keys.indexOf(aktiv) >= 0 ? 1 : 0.2;
  const bw = keys => keys.indexOf(aktiv) >= 0 ? 4 : 2.5;
  const vAktiv = SP_VORBAU.indexOf(aktiv) >= 0;
  const txt = (x, y, t, f) => '<text x="' + r(x) + '" y="' + r(y) + '" font-family="Inter, sans-serif" font-size="13" font-weight="700" fill="' + f + '" text-anchor="middle">' + t + '</text>';
  const ln = (x1, y1, x2, y2, f, sw, extra) => '<line x1="' + r(x1) + '" y1="' + r(y1) + '" x2="' + r(x2) + '" y2="' + r(y2) + '" stroke="' + f + '" stroke-width="' + sw + '"' + (extra || "") + '/>';
  const gestr = ' stroke-dasharray="3 3"', rund = ' stroke-linecap="round"';
  const BL = "#1B4CA1", RT = "#C8102E", GR = "#5C646E";
  let s = '<svg viewBox="0 0 395 285" role="img" aria-label="' + esc(label || "Seitenansicht des Rads mit den eingetragenen Maßen") + '" class="sp-svg">';
  // Laufrad mit Speichen (einmal definiert, zweimal benutzt)
  s += '<defs><g id="' + id + '"><circle r="63" fill="none" stroke="#C3BCB2" stroke-width="5"/><circle r="56.5" fill="none" stroke="#E4DFD8" stroke-width="6"/>' +
       '<circle r="53.3" fill="none" stroke="#C3BCB2" stroke-width="0.8"/><g stroke="#BDB6AC" stroke-width="0.8">';
  for(let i = 0; i < 16; i++){ const a = i * Math.PI / 8, c = Math.cos(a), sn = Math.sin(a); s += '<line x1="' + r(4 * c) + '" y1="' + r(4 * sn) + '" x2="' + r(53 * c) + '" y2="' + r(53 * sn) + '"/>'; }
  s += '</g><circle r="5.5" fill="#E4DFD8" stroke="#B5ADA2" stroke-width="1.2"/><circle r="1.8" fill="#B5ADA2"/></g></defs>';
  s += '<use href="#' + id + '" x="114" y="188"/><use href="#' + id + '" x="308" y="188"/>';
  // Kette, Rahmen (Kontur + Füllung)
  s += '<g fill="none" stroke="#C3BCB2" stroke-width="1.5"><line x1="190" y1="177" x2="114" y2="181"/><line x1="190" y1="223" x2="114" y2="195"/><circle cx="114" cy="188" r="7"/></g>';
  const rahmen = (farbe, d) => '<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke="' + farbe + '">' +
    '<line x1="190" y1="200" x2="114" y2="188" stroke-width="' + (7 - d) + '"/><line x1="159" y1="106" x2="114" y2="188" stroke-width="' + (6 - d) + '"/>' +
    '<line x1="190" y1="200" x2="161" y2="100" stroke-width="' + (10 - d) + '"/><line x1="161" y1="99" x2="268" y2="95" stroke-width="' + (9 - d) + '"/>' +
    '<line x1="190" y1="200" x2="274" y2="114" stroke-width="' + (12 - d) + '"/><line x1="267" y1="92" x2="277" y2="123" stroke-width="' + (12 - d) + '"/>' +
    '<path d="M277 122 Q297 148 308 188" stroke-width="' + (8 - d) + '"/></g>';
  s += rahmen("#C3BCB2", 0) + rahmen("#ECE8E2", 2.5);
  // Sattelstütze fährt aus/ein, Klemme mit; der Sattel rutscht zusätzlich auf den Streben (S)
  s += ln(159, 100, 151 + g.ax, 67 + g.ay, "#C3BCB2", 4, rund);
  s += '<rect x="144" y="63" width="14" height="5" rx="1.5" fill="#E4DFD8" stroke="#C3BCB2" stroke-width="1.2" transform="translate(' + r(g.ax) + ' ' + r(g.ay) + ')"/>';
  s += '<g transform="translate(' + r(g.sx) + ' ' + r(g.ay) + ')"><path d="M133 63 Q134 67 139 67 L165 66 Q170 66 171 62" fill="none" stroke="#B5ADA2" stroke-width="1.5" stroke-linecap="round"/>' +
       '<path d="M121 53 Q120 58 125 60 L133 61 Q152 62 168 61 Q176 60.5 179 58.5 Q180 56.5 176 56 Q160 55.5 146 54.5 Q134 53 128 50.5 Q122 49.5 121 53 Z" fill="#E4DFD8" stroke="#B5ADA2" stroke-width="1.4" stroke-linejoin="round"/></g>';
  // Kettenblatt, Kurbel, Steuersatz-Spacer
  s += '<circle cx="190" cy="200" r="23" fill="#F4F2EE" stroke="#C3BCB2" stroke-width="1.5"/><circle cx="190" cy="200" r="23" fill="none" stroke="#D2CCC3" stroke-width="2" stroke-dasharray="1.5 2"/>' +
       '<path d="M188 197 L215 211 L213 216 L186 203 Z" fill="#E4DFD8" stroke="#B5ADA2" stroke-width="1.2" stroke-linejoin="round"/><rect x="208" y="215" width="14" height="4" rx="1.5" fill="#E4DFD8" stroke="#B5ADA2" stroke-width="1.2"/>' +
       '<rect x="263.5" y="86" width="8" height="7" rx="1" fill="#E4DFD8" stroke="#C3BCB2" stroke-width="1.2" transform="rotate(-18 267.5 89.5)"/>';
  const vorbauF = vAktiv ? RT : "#3A4048";
  if(!zf){
    // Bahnlenker (klassischer Bogen), wandert mit L
    s += ln(267, 90, g.clampX, 87.5, vorbauF, vAktiv ? 7 : 5.5, rund);
    s += '<g transform="translate(' + r(g.clampX - 291) + ' 0)"><path d="M291 87.5 Q307 87 308.5 99 Q310 114 298 117.5 L289 116.5" fill="none" stroke="#3A4048" stroke-width="4.5" stroke-linecap="round"/>' +
         '<path d="M300 114 Q306 112 307.5 104" fill="none" stroke="#15181C" stroke-width="5.5" stroke-linecap="round" opacity=".55"/></g>';
  } else {
    // Zeitfahraufsatz auf Spacern (integriertes Cockpit)
    s += ln(267, 90, 293, 89, vorbauF, vAktiv ? 9.5 : 8, rund);
    s += '<path d="M293 89 L306 90 Q309 92 307 100 L305 108" fill="none" stroke="#3A4048" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>';
    s += '<rect x="266" y="' + r(g.spTop) + '" width="8" height="' + r(g.spH) + '" rx="1" fill="' + (aktiv === "SP" ? RT : GR) + '"/>';
    s += ln(g.padX, g.spTop, g.padX, 89, "#fff", 8, ' stroke-dasharray="0.8 5.2"');
    s += '<path d="M' + r(g.padX - 3) + ' ' + r(g.y0) + ' Q' + r(g.tipX - 22) + ' ' + r(g.y0 + (g.tipY - g.y0) * 0.2) + ' ' + r(g.tipX) + ' ' + r(g.tipY) + '" fill="none" stroke="#3A4048" stroke-width="3.5" stroke-linecap="round"/>';
    s += '<path d="M256 65 Q270 70 284 65 L284 68 Q270 74 256 68 Z" fill="#3A4048" transform="translate(0 ' + r(g.padY - 66) + ')"/>';
  }
  // Maße
  s += '<g opacity="' + op(["SH"]) + '">' + ln(190, 200, g.pX, g.pY, BL, bw(["SH"]), rund) + txt((190 + g.pX) / 2 - 12, (200 + g.pY) / 2 + 4, "SH", BL) + '</g>';
  s += '<g opacity="' + op(["S"]) + '">' + ln(g.tipSX, g.tipSY, g.tipSX, g.bY, BL, 1, gestr) + ln(190, 190, 190, g.bY, BL, 1, gestr) +
       ln(g.tipSX, g.bY, 190, g.bY, BL, bw(["S"]), rund) + txt(Math.min(g.tipSX, 186) - 6, Math.max(12, g.bY - 8), "S", BL) + '</g>';
  s += '<g opacity="' + op(SP_VORBAU) + '">' + txt(zf ? 281 : (267 + g.clampX) / 2 - 2, 106, "V", GR) + '</g>';
  if(!zf){
    s += '<g opacity="' + op(["L"]) + '">' + ln(190, 226, 190, 277, RT, 1, gestr) + ln(g.clampX, 92, g.clampX, 277, RT, 1, gestr) +
         ln(190, 271, g.clampX, 271, RT, bw(["L"]), rund) + txt((190 + g.clampX) / 2, 264, "L", RT) + '</g>';
  } else {
    s += '<g opacity="' + op(["E"]) + '">' + ln(190, 226, 190, 277, RT, 1, gestr) + ln(g.tipX, g.tipY + 4, g.tipX, 277, RT, 1, gestr) +
         ln(190, 271, g.tipX, 271, RT, bw(["E"]), rund) + txt((190 + g.tipX) / 2, 264, "E", RT) + '</g>';
    s += '<g opacity="' + op(["H"]) + '">' + ln(g.padX + 15, g.padY, g.gX + 5, g.padY, RT, 1, gestr) + ln(g.tipX + 4, g.tipY, g.gX + 5, g.tipY, RT, 1, gestr) +
         ln(g.gX, g.padY, g.gX, g.tipY, RT, bw(["H"]), rund) + txt(Math.min(g.gX + 4, 389), Math.min(g.padY, g.tipY) - 4, "H", RT) + '</g>';
    s += '<g opacity="' + op(["SP"]) + '">' + txt(252, (g.spTop + 89) / 2 + 5, "SP", GR) + '</g>';
  }
  // Messpunkte
  s += '<circle cx="190" cy="200" r="7" fill="#15181C"/><circle cx="190" cy="200" r="2.6" fill="#fff"/>';
  s += '<circle cx="' + r(g.pX) + '" cy="' + r(g.pY) + '" r="4.5" fill="' + BL + '" stroke="#fff" stroke-width="2"/><circle cx="' + r(g.tipSX) + '" cy="' + r(g.tipSY) + '" r="4" fill="' + BL + '" stroke="#fff" stroke-width="2"/>';
  if(!zf) s += '<circle cx="' + r(g.clampX) + '" cy="87.5" r="5" fill="' + RT + '" stroke="#fff" stroke-width="2"/>';
  else s += '<circle cx="' + g.padX + '" cy="' + r(g.padY) + '" r="5" fill="' + RT + '" stroke="#fff" stroke-width="2"/><circle cx="' + r(g.tipX) + '" cy="' + r(g.tipY) + '" r="5" fill="' + RT + '" stroke="#fff" stroke-width="2"/>';
  return s + '</svg>';
}
/** Werte einer gespeicherten Zeile (bzw. Sattel + Lenker) für die Grafik. */
function spWerteAus(sattel, zeile){
  const g = (z, sp) => z && z[sp] != null ? num(z[sp]) : null;
  return { SH:g(sattel, "sattelhoehe"), S:g(sattel, "sattelversatz"), L:g(zeile, "lenker_vorne"), SP:g(zeile, "spacer"), E:g(zeile, "reichweite"), H:g(zeile, "erhoehung") };
}

/* ---------------------------------------------------------------
   Bearbeiten: Zustand
----------------------------------------------------------------*/
let sp = null;               // Entwurf der offenen Sitzposition
let spVerlaufCache = {};     // Rad-ID → Zeilen | "laedt" | "fehler" (wird bei jedem Laden geleert, siehe core.js)

function spStart(radId){
  const lenker = spLenker(radId), akt = spAktuell(radId, lenker);
  const v = {}, wert = (z, col) => z && z[col] != null ? String(z[col]) : "";
  v.SH = wert(akt.sattel, "sattelhoehe"); v.S = wert(akt.sattel, "sattelversatz");
  v.L = wert(akt.bahn, "lenker_vorne"); v.Vb = wert(akt.bahn, "vorbau");
  v.SP = wert(akt.tt, "spacer"); v.Vt = wert(akt.tt, "vorbau"); v.E = wert(akt.tt, "reichweite"); v.H = wert(akt.tt, "erhoehung");
  const jig = { bahn:!!(akt.bahn && akt.bahn.jig_am), tt:!!(akt.tt && akt.tt.jig_am) };
  sp = { rad:radId, lenker, akt, modus:lenker.tt ? "tt" : "bahn", v, start:Object.assign({}, v),
         jig, jigStart:Object.assign({}, jig), jigReset:{ bahn:false, tt:false },
         pruefen:[], geaendert:[], aktiv:null, notiz:"" };
}
function spGruppen(){ return { sattel:["SH", "S"], bahn:["L", "Vb"], tt:["SP", "Vt", "E", "H"] }; }
/** Wert geändert: Kein anderer Wert wird verschoben. Die übrigen Werte derselben Gruppe kommen auf die
    Prüfliste — außer dem Vorbau und Werten, die schon selbst geändert oder mit „stimmt“ bestätigt wurden. Lenkerwerte geändert:
    die Jig-Bestätigung dieses Lenkers gilt nicht mehr. */
function spAendern(key, wert){
  if(!sp) return;
  sp.v[key] = wert;
  if(sp.geaendert.indexOf(key) < 0) sp.geaendert.push(key);
  const gr = SP_FELD[key].gruppe, liste = spGruppen()[gr];
  sp.pruefen = sp.pruefen.filter(x => x !== key);
  liste.forEach(x => { if(x !== key && SP_VORBAU.indexOf(x) < 0 && sp.geaendert.indexOf(x) < 0 && sp.pruefen.indexOf(x) < 0) sp.pruefen.push(x); });
  if(gr !== "sattel" && sp.jig[gr]){ sp.jig[gr] = false; sp.jigReset[gr] = true; }
  sp.aktiv = key;
}
/** Hat sich für diese Lenkerart etwas geändert (Werte oder Jig)? */
function spGeaendert(art){
  const keys = spGruppen()[art];
  return keys.some(k => String(sp.v[k]) !== String(sp.start[k])) || sp.jig[art] !== sp.jigStart[art];
}
function spSattelGeaendert(){ return ["SH", "S"].some(k => String(sp.v[k]) !== String(sp.start[k])); }
function spOffen(){ return sp.pruefen.filter(k => SP_REIHE[sp.modus].indexOf(k) >= 0); }
/** Werte für die Grafik aus dem Entwurf. */
function spEntwurfWerte(){ const o = {}; ["SH", "S", "L", "SP", "E", "H"].forEach(k => { const z = spZahl(sp.v[k]); o[k] = z === null || isNaN(z) ? null : z; }); return o; }

/* ---------------------------------------------------------------
   Bearbeiten: Ansicht (ganze Seite im Reiter Räder & Teile)
----------------------------------------------------------------*/
function sitzSeite(radId){
  const r = rad(radId);
  if(!spDa()){
    return '<button class="btn small zurueck" data-a="spZu">← ' + esc(r.bezeichnung) + '</button>' +
           '<div class="fehlerbox">Sitzpositionen brauchen das Datenbank-Update 21.8.0 (Migration in Neon ausführen, danach Data API → „Refresh schema cache“).</div>';
  }
  if(!sp || sp.rad !== radId) spStart(radId);
  const darfS = darf("arbeiten") && !offline, aus = darfS ? "" : " disabled";
  let h = '<button class="btn small zurueck" data-a="spZu">← ' + esc(r.bezeichnung) + '</button>';
  // Kopf: Rad, Fahrer, UCI-Kategorie, letzte Einstellung
  const uci = spUciText(r.fahrer_id), letzte = sp.akt.sattel;
  h += '<div class="card"><div class="row wrapr"><span class="big">' + esc(r.bezeichnung) + '</span><span class="sp"></span><span class="sub">' + esc(r.typ || "") + '</span></div>' +
       '<div class="row wrapr" style="gap:8px;margin-top:4px"><span>' + (r.fahrer ? 'fährt: <strong>' + esc(r.fahrer) + '</strong>' : '<span class="sub">ohne Fahrer</span>') + '</span>' +
       (uci ? '<span class="chip blau">' + esc(uci) + '</span>' : '') + '</div>' +
       '<p class="sub" style="margin:6px 0 0">' + (letzte ? 'Letzte Einstellung: ' + esc(spDatum(letzte.angelegt)) + (letzte.angelegt_von ? ' · ' + esc(letzte.angelegt_von) : '') : 'Noch keine Sitzposition eingetragen.') + '</p></div>';
  h += '<h2 class="sec">Sitzposition</h2>';
  // Lenkerart: Zeitfahren nur mit montiertem TT-Lenker
  if(sp.lenker.tt){
    h += '<div class="seg zwei" role="group" aria-label="Lenkerart" style="margin-bottom:12px">' +
         segBtn("spModus", "bahn", SP_ART_TEXT.bahn + (spGeaendert("bahn") ? " •" : ""), sp.modus) + segBtn("spModus", "tt", SP_ART_TEXT.tt + (spGeaendert("tt") ? " •" : ""), sp.modus) + '</div>';
  }
  // Montierter Lenker mit Jig-Haken
  const st = sp.lenker[sp.modus];
  h += '<div class="card"><span class="lbl">' + (sp.modus === "tt" ? "Montierter Aufsatz" : "Lenker") + '</span><strong>' + esc(spLenkerName(st, sp.modus)) + '</strong>' +
       (sp.modus === "bahn" && !st ? '<p class="sub" style="margin:2px 0 0">Ein Einzelstück mit Tag „Lenker“ am Rad ersetzt den Standard-Lenker.</p>' : '') +
       '<label class="sp-jig"><input type="checkbox" data-spjig="1"' + (sp.jig[sp.modus] ? " checked" : "") + aus + '>' +
       '<span><strong>Lenker am Laserjig bestätigt</strong><span class="sub" id="spJigHinweis" style="display:block">' + spJigHinweis() + '</span></span></label></div>';
  // Grafik (bleibt beim Scrollen oben) und Prüf-Hinweise
  h += '<div class="card sp-grafik"><div id="spGrafik">' + spSvg(sp.modus, spEntwurfWerte(), sp.aktiv) + '</div>' +
       '<p class="sub" style="margin:2px 4px 0;font-size:12px">Die Grafik folgt den Werten. S, E, H wie im UCI-Reglement. Blau = Sitz, Rot = Lenker vorn.</p></div>' +
       '<div id="spPruef">' + spPruefHtml() + '</div>';
  // Felder
  h += '<div class="card" style="padding-top:4px;padding-bottom:4px">';
  SP_REIHE[sp.modus].forEach((key, i) => {
    const f = SP_FELD[key], z = spZahl(sp.v[key]);
    h += '<div class="sp-feld"' + (i ? '' : ' style="border-top:none"') + '>' +
         '<div class="sp-kopf"><span class="sp-badge" id="spB_' + key + '" aria-hidden="true">' + f.k + '</span>' +
         '<label for="spT_' + key + '" class="sp-name"><strong>' + esc(f.name) + '</strong><span class="sub" id="spH_' + key + '">' + esc(f.hint) + '</span></label>' +
         '<input type="text" inputmode="numeric" autocomplete="off" class="sp-zahl" id="spT_' + key + '" data-sp="' + key + '" value="' + esc(sp.v[key]) + '" placeholder="—"' + aus + '>' +
         '<span class="sub" style="width:26px">mm</span></div>' +
         (darfS ? '<input type="range" class="sp-regler" id="spR_' + key + '" data-sp="' + key + '" min="' + f.min + '" max="' + f.max + '" step="1" value="' +
                  (z === null || isNaN(z) ? f.ref : Math.max(f.min, Math.min(f.max, z))) + '" aria-label="' + esc(f.name) + ' als Schieber">' : '') + '</div>';
  });
  h += '</div>';
  if(darfS){
    h += '<div class="card"><label class="lbl" for="spNotiz">Notiz</label><textarea id="spNotiz" data-spnotiz="1" rows="2" placeholder="z. B. Sattel 2 mm nach vorn">' + esc(sp.notiz) + '</textarea></div>';
    h += '<div class="row" style="gap:10px;margin-bottom:6px"><button class="btn" data-a="spVerwerfen">Verwerfen</button><button class="btn rot" style="flex:1" data-a="spSpeichern">Speichern</button></div>';
    h += '<p class="sub" style="margin:0 0 12px">Speichern legt eine neue Einstellung mit Datum und Namen an; ältere bleiben im Verlauf.</p>';
  } else if(offline){
    h += '<p class="sub">Offline — Änderungen sind erst mit Netz möglich.</p>';
  }
  h += spVerlaufKarte(radId);
  setTimeout(spFelderFaerben, 0);
  return h;
}
function spJigHinweis(){
  const art = sp.modus, z = sp.akt[art];
  if(sp.jig[art]){
    if(sp.jigStart[art] && z && z.jig_am && !spGeaendert(art)) return 'Bestätigt am ' + esc(spDatum(z.jig_am)) + ' · ' + esc(z.jig_von || "");
    return 'Wird beim Speichern als bestätigt eingetragen.';
  }
  return '<span style="color:var(--warn)">' + (sp.jigReset[art] ? 'Lenkerwerte geändert – vor dem Rennen nochmal am Jig prüfen.' : 'Nicht bestätigt – vor dem Rennen am Jig prüfen.') + '</span>';
}
function spPruefHtml(){
  const offen = spOffen();
  if(!offen.length) return "";
  const gr = spGruppen();
  let h = "";
  [["sattel", "Sattel geändert."], [sp.modus, sp.modus === "tt" ? "Aufsatz geändert." : "Lenker geändert."]].forEach(([name, titel]) => {
    const l = offen.filter(k => gr[name].indexOf(k) >= 0);
    if(!l.length) return;
    h += '<div class="sp-pruef" role="status"><span><strong>' + titel + '</strong> Bitte die zugehörigen Werte prüfen:</span><div class="row wrapr" style="gap:8px">' +
         l.map(k => '<button class="btn small" data-a="spOk" data-x="' + k + '">' + SP_FELD[k].k + ' ' + esc(SP_FELD[k].name) + ' ' +
                    esc(sp.v[k] === "" ? "—" : sp.v[k] + " mm") + ' · stimmt</button>').join("") + '</div></div>';
  });
  return h;
}
/** Hervorhebung, Prüf-Rahmen und Fehler an den Feldern setzen (ohne neu zu zeichnen). */
function spFelderFaerben(){
  if(!sp) return;
  const offen = spOffen();
  SP_REIHE[sp.modus].forEach(key => {
    const b = $("spB_" + key), t = $("spT_" + key), hnt = $("spH_" + key), rg = $("spR_" + key);
    if(!b || !t) return;
    const [farbe, hell] = spFarbe(key), an = sp.aktiv === key, pr = offen.indexOf(key) >= 0, z = spZahl(sp.v[key]);
    b.style.background = an ? farbe : hell; b.style.color = an ? "#fff" : farbe;
    t.classList.toggle("pruef", pr); t.classList.toggle("falsch", z !== null && isNaN(z));
    if(hnt){ hnt.textContent = (pr ? "Bitte prüfen · " : "") + SP_FELD[key].hint; hnt.style.color = pr ? "var(--warn)" : ""; }
    if(rg) rg.style.accentColor = farbe;
  });
}
/** Nach einer Eingabe: Grafik, Hinweise, Felder auffrischen — ohne die ganze Seite neu zu zeichnen
    (sonst springt der Schieber unter dem Finger weg). */
function spAuffrischen(quelle){
  const gr = $("spGrafik"); if(gr) gr.innerHTML = spSvg(sp.modus, spEntwurfWerte(), sp.aktiv);
  const pr = $("spPruef"); if(pr) pr.innerHTML = spPruefHtml();
  const jh = $("spJigHinweis"); if(jh) jh.innerHTML = spJigHinweis();
  const jc = document.querySelector("[data-spjig]"); if(jc) jc.checked = !!sp.jig[sp.modus];
  SP_REIHE[sp.modus].forEach(key => {
    const t = $("spT_" + key), rg = $("spR_" + key), f = SP_FELD[key], z = spZahl(sp.v[key]);
    if(t && t !== quelle && t.value !== String(sp.v[key])) t.value = sp.v[key];
    if(rg && rg !== quelle && z !== null && !isNaN(z)) rg.value = Math.max(f.min, Math.min(f.max, z));
  });
  document.querySelectorAll('[data-a="spModus"]').forEach(b => { const art = b.dataset.x; b.textContent = SP_ART_TEXT[art] + (spGeaendert(art) ? " •" : ""); });
  spFelderFaerben();
}

/* Eingaben: Zahlfeld und Schieber schreiben in den Entwurf. */
document.addEventListener("input", ev => {
  const el = ev.target;
  if(!el.dataset || !sp) return;
  if(el.dataset.spnotiz){ sp.notiz = el.value; return; }
  const key = el.dataset.sp;
  if(!key || !SP_FELD[key] || !darf("arbeiten")) return;
  spAendern(key, el.type === "range" ? String(el.value) : el.value.trim());
  spAuffrischen(el);
});
document.addEventListener("focusin", ev => {
  const el = ev.target, key = el.dataset && el.dataset.sp;
  if(!key || !sp || sp.aktiv === key) return;
  sp.aktiv = key;
  const gr = $("spGrafik"); if(gr) gr.innerHTML = spSvg(sp.modus, spEntwurfWerte(), sp.aktiv);
  spFelderFaerben();
});
document.addEventListener("pointerdown", ev => {
  const el = ev.target, key = el.dataset && el.dataset.sp;
  if(!key || !sp || el.type !== "range" || sp.aktiv === key) return;
  sp.aktiv = key;
  const gr = $("spGrafik"); if(gr) gr.innerHTML = spSvg(sp.modus, spEntwurfWerte(), sp.aktiv);
  spFelderFaerben();
});
document.addEventListener("change", ev => {
  const el = ev.target;
  if(!el.dataset || !el.dataset.spjig || !sp) return;
  if(!darf("arbeiten")){ el.checked = !el.checked; return; }
  sp.jig[sp.modus] = el.checked; sp.jigReset[sp.modus] = false;
  spAuffrischen(el);
});

/* ---------------------------------------------------------------
   Speichern
----------------------------------------------------------------*/
function spSpeichern(){
  if(!sp) return;
  const r = rad(sp.rad); if(!r) return;
  // Zahlen prüfen
  for(const key of Object.keys(SP_FELD)){
    const z = spZahl(sp.v[key]);
    if(z !== null && isNaN(z)){ toast(SP_FELD[key].k + " " + SP_FELD[key].name + ": bitte eine Zahl in mm.", true); return; }
  }
  if(sp.v.S !== "" && (spZahl(sp.v.S) < 0 || spZahl(sp.v.S) > 70)){ toast("Sattelversatz S: 0–70 mm.", true); return; }
  // Welche Lenkerarten werden gespeichert? Die angezeigte immer, die andere, wenn sich dort etwas geändert hat.
  const arten = [sp.modus];
  const andere = sp.modus === "tt" ? "bahn" : "tt";
  if((andere === "bahn" || sp.lenker.tt) && spGeaendert(andere)) arten.push(andere);
  if(!spSattelGeaendert() && !arten.some(spGeaendert) && !sp.notiz.trim()){ toast("Nichts geändert — nichts gespeichert."); return; }
  const werte = art => {
    const w = { sattelhoehe:spZahl(sp.v.SH), sattelversatz:spZahl(sp.v.S) };
    if(art === "bahn"){ w.lenker_vorne = spZahl(sp.v.L); w.vorbau = spZahl(sp.v.Vb); }
    else { w.spacer = spZahl(sp.v.SP); w.vorbau = spZahl(sp.v.Vt); w.reichweite = spZahl(sp.v.E); w.erhoehung = spZahl(sp.v.H); }
    return w;
  };
  const e = sp, offen = sp.pruefen.length;
  aktion(async () => {
    for(const art of arten){
      await rpc("sitzposition_speichern", { p_rad:e.rad, p_art:art, p_stueck:e.lenker[art] ? e.lenker[art].nummer : null,
                                            p_werte:werte(art), p_jig:!!e.jig[art], p_notiz:e.notiz.trim() || null });
    }
    sp = null; delete spVerlaufCache[e.rad];
  }, "Sitzposition gespeichert" + (arten.length > 1 ? " (" + arten.map(a => SP_ART_TEXT[a]).join(" und ") + ")" : "") +
     (offen ? " · " + offen + (offen === 1 ? " Wert" : " Werte") + " ungeprüft" : ""));
}
function spHatEntwurf(){
  return !!sp && (spSattelGeaendert() || spGeaendert("bahn") || (!!sp.lenker.tt && spGeaendert("tt")) || !!sp.notiz.trim());
}

/* ---------------------------------------------------------------
   Verlauf
----------------------------------------------------------------*/
async function spLadeVerlauf(radId){
  if(spVerlaufCache[radId] === "laedt") return;
  spVerlaufCache[radId] = "laedt";
  try{ spVerlaufCache[radId] = await rest("/sitzposition?rad_id=eq." + encodeURIComponent(radId) + "&order=id.desc&limit=40"); }
  catch(e){ spVerlaufCache[radId] = "fehler"; }
  if(view.tab === "raeder" && view.sitz === radId){
    // Nur den Verlauf austauschen, damit ein offener Entwurf und die Schieber unberührt bleiben
    const el = $("spVerlauf"); if(el) el.outerHTML = spVerlaufKarte(radId); else render();
  }
}
function spVerlaufKarte(radId){
  const v = spVerlaufCache[radId];
  if(v === undefined && !offline) setTimeout(() => spLadeVerlauf(radId), 0);
  let h = '<div class="card" id="spVerlauf"><span class="lbl">Verlauf der Einstellungen</span>';
  if(offline) return h + '<p class="sub" style="margin:0">Verlauf erst wieder mit Netz.</p></div>';
  if(v === undefined || v === "laedt") return h + '<p class="sub" style="margin:0">lädt…</p></div>';
  if(v === "fehler") return h + '<p class="sub" style="margin:0">Verlauf konnte nicht geladen werden.</p></div>';
  if(!v.length) return h + '<p class="sub" style="margin:0">Noch keine Einstellungen gespeichert.</p></div>';
  h += '<p class="sub" style="margin:-2px 0 6px">Geänderte Werte rot, der vorherige Wert in Klammern.</p><div class="liste">';
  v.forEach((z, i) => {
    // Vergleich: Sattel mit der Zeile davor, Lenker mit der Zeile davor für denselben Lenker
    const vorS = v[i + 1] || null, vorL = v.slice(i + 1).find(x => x.art === z.art && (x.stueck_nummer || "") === (z.stueck_nummer || "")) || null;
    const feld = (k, col, vor) => {
      if(z[col] == null && !(vor && vor[col] != null)) return "";
      const anders = vor && String(vor[col]) !== String(z[col]);
      return '<span class="sp-wert' + (anders ? ' anders' : '') + '">' + k + ' ' + (z[col] == null ? "—" : esc(z[col])) + (anders ? ' <small>(' + (vor[col] == null ? "—" : esc(vor[col])) + ')</small>' : '') + '</span>';
    };
    const werte = [feld("SH", "sattelhoehe", vorS), feld("S", "sattelversatz", vorS)]
      .concat(z.art === "bahn" ? [feld("L", "lenker_vorne", vorL), feld("V", "vorbau", vorL)]
                               : [feld("SP", "spacer", vorL), feld("V", "vorbau", vorL), feld("E", "reichweite", vorL), feld("H", "erhoehung", vorL)]).filter(Boolean);
    h += '<div class="eintrag"><div class="txt"><div class="row wrapr" style="gap:6px"><strong>' + esc(spZeit(z.angelegt)) + '</strong>' +
         (i === 0 ? '<span class="chip ok">neueste</span>' : '') + '<span class="sp"></span><span class="sub">' + esc(z.angelegt_von || "") + '</span></div>' +
         '<span class="sub">' + esc(SP_ART_TEXT[z.art] + " · " + (z.stueck_nummer ? z.stueck_nummer : "Standard-Lenker")) + '</span> ' +
         (z.jig_am ? '<span class="chip ok">Lenker ✓ Jig ' + esc(de(z.jig_am)) + '</span>' : '<span class="chip warn">Lenker nicht am Jig</span>') +
         '<div class="sp-werte">' + werte.join("") + '</div>' +
         (z.notiz ? '<span class="sub" style="white-space:pre-wrap">' + esc(z.notiz) + '</span>' : '') + '</div></div>';
  });
  return h + '</div></div>';
}

/* ---------------------------------------------------------------
   Rad-Seite: Kurzübersicht
----------------------------------------------------------------*/
function spWerteText(z, art){
  if(!z) return "";
  const t = (k, col) => z[col] != null ? k + " " + z[col] : "";
  return (art === "bahn" ? [t("L", "lenker_vorne"), t("V", "vorbau")] : [t("SP", "spacer"), t("V", "vorbau"), t("E", "reichweite"), t("H", "erhoehung")]).filter(Boolean).join(" · ");
}
function spJigChip(z){
  return z && z.jig_am ? '<span class="chip ok">✓ Jig ' + esc(de(z.jig_am)) + '</span>' : '<span class="chip warn">nicht am Jig</span>';
}
function spRadKarte(r){
  let h = '<div class="card"><div class="row wrapr" style="gap:8px"><span class="lbl" style="margin:0">Sitzposition</span><span class="sp"></span>';
  const uci = spUciText(r.fahrer_id);
  if(uci) h += '<span class="chip blau">' + esc(uci) + '</span>';
  h += '</div>';
  if(!spDa()) return h + '<p class="sub" style="margin:6px 0 0">Braucht das Datenbank-Update 21.8.0.</p></div>';
  const lenker = spLenker(r.id), akt = spAktuell(r.id, lenker);
  if(!akt.sattel) h += '<p class="sub" style="margin:6px 0 8px">Noch nicht eingetragen.</p>';
  else {
    const s = [akt.sattel.sattelhoehe != null ? "SH " + akt.sattel.sattelhoehe : "", akt.sattel.sattelversatz != null ? "S " + akt.sattel.sattelversatz : ""].filter(Boolean).join(" · ");
    h += '<div class="liste" style="margin-top:4px">';
    h += '<div class="eintrag"><div class="txt"><strong>Sattel</strong><br><span class="sub">' + esc(s || "—") + '</span></div></div>';
    h += '<div class="eintrag"><div class="txt"><strong>Lenker</strong> <span class="sub">' + esc(lenker.bahn ? lenker.bahn.nummer : "Standard") + '</span><br><span class="sub">' +
         esc(spWerteText(akt.bahn, "bahn") || "noch keine Werte") + '</span></div>' + (akt.bahn ? spJigChip(akt.bahn) : '') + '</div>';
    if(lenker.tt) h += '<div class="eintrag"><div class="txt"><strong>Zeitfahraufsatz</strong> <span class="sub">' + esc(lenker.tt.nummer) + '</span><br><span class="sub">' +
                       esc(spWerteText(akt.tt, "tt") || "noch keine Werte") + '</span></div>' + spJigChip(akt.tt) + '</div>';
    h += '</div><p class="sub" style="margin:4px 0 8px">Zuletzt ' + esc(spDatum(akt.sattel.angelegt)) + (akt.sattel.angelegt_von ? ' · ' + esc(akt.sattel.angelegt_von) : '') + '</p>';
  }
  return h + '<button class="btn small" data-a="spAuf" data-x="' + esc(r.id) + '">' + (darf("arbeiten") ? "Sitzposition eintragen" : "Sitzposition ansehen") + '</button></div>';
}

/* ---------------------------------------------------------------
   Sportler-Ansicht: eigene Sitzposition (nur lesen)
----------------------------------------------------------------*/
function spSportlerKarte(r){
  if(!Array.isArray(DB.sitzpos)) return "";
  const z = DB.sitzpos.filter(x => x.rad_id === r.id);
  if(!z.length) return "";
  const neueste = z.reduce((m, x) => !m || x.id > m.id ? x : m, null);
  // je Lenkerart nur die neueste Zeile (ein ersetzter Standard-Lenker taucht sonst doppelt auf)
  const zeigen = ["bahn", "tt"].map(art => z.filter(x => x.art === art).reduce((m, x) => !m || x.id > m.id ? x : m, null)).filter(Boolean);
  let h = '<div class="sp-sportler"><span class="lbl" style="margin:10px 0 2px">Sitzposition</span>' + spSvg(neueste.art, spWerteAus(neueste, neueste), null, "Deine Sitzposition") +
          '<p class="sub" style="margin:0 0 4px">Sattel: ' + esc([neueste.sattelhoehe != null ? "SH " + neueste.sattelhoehe : "", neueste.sattelversatz != null ? "S " + neueste.sattelversatz : ""].filter(Boolean).join(" · ") || "—") + '</p>';
  zeigen.forEach(x => { const t = spWerteText(x, x.art); if(t) h += '<p class="sub" style="margin:0 0 4px">' + esc(SP_ART_TEXT[x.art]) + ': ' + esc(t) + '</p>'; });
  return h + '<p class="sub" style="margin:0;font-size:12px">Stand ' + esc(spDatum(neueste.angelegt)) + ' · Änderungen macht dein Trainer.</p></div>';
}

/* ---------------------------------------------------------------
   Aktionen
----------------------------------------------------------------*/
Object.assign(A, {
  spAuf: x => { modalZu(); if(!sp || sp.rad !== x) sp = null; view.tab = "raeder"; view.rad = x; view.sitz = x; render(); window.scrollTo(0,0); },
  spZu: () => {
    if(spHatEntwurf() && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    sp = null; view.sitz = null; render(); window.scrollTo(0,0);
  },
  spModus: x => { if(!sp || (x === "tt" && !sp.lenker.tt)) return; sp.modus = x === "tt" ? "tt" : "bahn"; sp.aktiv = null; render(); },
  // „stimmt“: gilt wie selbst geprüft und wird bei weiteren Änderungen nicht wieder markiert
  spOk: x => { if(!sp) return; sp.pruefen = sp.pruefen.filter(k => k !== x); if(sp.geaendert.indexOf(x) < 0) sp.geaendert.push(x); spAuffrischen(null); },
  spVerwerfen: () => {
    if(spHatEntwurf() && !confirm("Änderungen verwerfen und den gespeicherten Stand wieder anzeigen?")) return;
    sp = null; render();
  },
  spSpeichern: () => spSpeichern()
});
Object.assign(C, {
  /** UCI-Größenkategorie beim Sportler (nur zur Info) */
  sportlerUci: (v, x) => {
    const n = v ? Number(v) : null;
    aktion(() => aendern("sportler", "id=eq." + x, { uci_kategorie:n }), n ? "UCI-Kategorie " + n + " gespeichert" : "UCI-Kategorie entfernt");
  }
});
