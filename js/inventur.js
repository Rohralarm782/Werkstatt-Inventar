/* js/inventur.js — Inventur-Modus: durchzählen und am Ende in einem Schritt buchen.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Inventur-Modus — schnell durchzählen, am Ende alles in einem Schritt
   buchen. Die Zählung liegt bis dahin auf dem Gerät (übersteht Neuladen).
   Je Artikel wird der Systembestand IM MOMENT DES ZÄHLENS gemerkt (b);
   gebucht wird nur gezählt − b, damit Buchungen während der Inventur
   erhalten bleiben.
   ===============================================================*/
function invLaden(){
  let i = null;
  try{ i = JSON.parse(localStorage.getItem("wInventur") || "null"); }catch(e){ return null; }
  if(!i) return null;
  // Entwurf aus 5.0–5.2 (Schlüssel nur Code, ein Ort) auf das neue Format bringen
  if(!i.ids){
    const z = {};
    Object.keys(i.z || {}).forEach(k => z[k.indexOf("|") >= 0 ? k : k + "|" + i.ort] = i.z[k]);
    i.z = z; i.ids = {}; i.ids[i.ort] = i.id;
  }
  return i;
}
function invSpeichern(){
  try{ if(inv) localStorage.setItem("wInventur", JSON.stringify(inv)); else localStorage.removeItem("wInventur"); }
  catch(e){ toast("Zählung konnte auf dem Gerät nicht gesichert werden.", true); }
}
// { ort:<Lagerort>|"alle", start, ids:{ Ort:uuid }, z:{ "Code|Ort":{ g, b } } }
let inv = invLaden();
let invAnsicht = { filter:"alle", buchstabe:"" };

const INV_ALLE = "alle";
function invTitel(){ return inv.ort === INV_ALLE ? "alle Orte" : inv.ort; }
/** Artikel mit Größen (Bekleidung) werden je Größe gezählt: Material → Bekleidung → „Zählen“. */
function invArtikel(){ return (DB.bestand||[]).filter(b => b.aktiv && b.art !== "Pauschale" && !hatGroessen(b.code)); }
/** Wo wird dieser Artikel gezählt? Bei „alle“: Werkstatt immer, andere Räume und Koffer nur, wenn dort
    etwas liegt, ein Koffer-Soll besteht oder dort schon gezählt wurde. */
function invOrteFuer(b){
  if(inv.ort !== INV_ALLE) return [inv.ort];
  return orte().filter(o => o === HAUPT || num(amOrt(b, o)) !== 0 || inv.z[b.code + "|" + o] ||
                          (DB.koffer||[]).some(k => k.code === b.code && k.ort === o && num(k.soll) > 0));
}
function invSchluessel(code, ort){ return code + "|" + ort; }
function invTeile(key){ const i = key.lastIndexOf("|"); return { code:key.slice(0, i), ort:key.slice(i + 1) }; }
function invSystem(key){ const t = invTeile(key), b = bestand(t.code); return b ? amOrt(b, t.ort) : 0; }
function invZuletzt(code, ort){ const z = (DB.zaehlung||[]).find(x => x.code === code && x.ort === ort); return z ? z.gezaehlt_am : null; }
function invStelleStatus(key){ const z = inv.z[key]; return !z ? "offen" : num(z.g) !== num(z.b) ? "abw" : "ok"; }
/** Status eines Artikels über alle seine Zählstellen: abw vor offen vor ok. */
function invStatus(b){
  const st = invOrteFuer(b).map(o => invStelleStatus(invSchluessel(b.code, o)));
  return st.indexOf("abw") >= 0 ? "abw" : st.indexOf("offen") >= 0 ? "offen" : "ok";
}
/** Kürzel des Standorts vor jedem Code (SN-B-101, SN-BR-01) */
function kuerzel(){ return (STANDORT && STANDORT.kuerzel) || ""; }
/** Kategorie-Buchstabe: SN-B-101 → B (auch ohne Kürzel: B-101 → B) */
function codeBuchstabe(c){ const m = /^(?:[A-Z]{2,3}-)?([A-Z]{1,3})-[0-9]/.exec(c || ""); return m ? m[1] : ""; }
/** Eingetippte Nummer ohne Kürzel (B-120, BR-01) bekommt das Kürzel dieses Standorts. */
function mitKuerzel(c){ c = String(c || "").trim().toUpperCase(); return /^[A-Z]{1,3}-[0-9]+$/.test(c) && kuerzel() ? kuerzel() + "-" + c : c; }
function invBuchstabe(code){ return codeBuchstabe(code) || "?"; }
function invFortschritt(){
  let stellen = 0, gezaehlt = 0, abw = 0;
  invArtikel().forEach(b => invOrteFuer(b).forEach(o => {
    const k = invSchluessel(b.code, o); stellen++;
    if(inv.z[k]){ gezaehlt++; if(invStelleStatus(k) === "abw") abw++; }
  }));
  return gezaehlt + " von " + stellen + " gezählt" + (abw ? " · " + abw + " Abweichung" + (abw === 1 ? "" : "en") : "");
}
function invStelle(b, ort, mitOrt){
  const key = invSchluessel(b.code, ort), z = inv.z[key], sys = amOrt(b, ort), zl = invZuletzt(b.code, ort);
  let diff = "";
  if(z){ const d = num(z.g) - num(z.b); diff = d === 0 ? "✓" : (d > 0 ? "+" : "") + zahl(d); }
  return '<div class="stelle ' + invStelleStatus(key) + '"><span class="wo">' + (mitOrt ? '<strong>' + esc(ort) + '</strong> · ' : '') +
    'System ' + zahl(sys) + '<br><span class="sub">' + (zl ? 'zuletzt ' + deLang(zl) : 'noch nie gezählt') + '</span></span>' +
    '<span class="diff mono">' + diff + '</span>' +
    '<input type="number" class="menge" min="0" step="any" inputmode="decimal" enterkeyhint="next" data-c="invZahl" data-x="' + esc(key) + '" value="' + (z ? num(z.g) : "") + '" placeholder="Zahl" aria-label="Gezählt: ' + esc(b.name) + ', ' + esc(ort) + '">' +
    '<button class="btn small" data-a="invOk" data-x="' + esc(key) + '" title="Stimmt mit System überein">✓</button></div>';
}
function invZeile(b){
  const orte = invOrteFuer(b), mitOrt = inv.ort === INV_ALLE;
  return '<div class="eintrag inv ' + invStatus(b) + '" id="inv-' + esc(b.code) + '">' +
    '<div class="txt"><strong>' + esc(b.name) + '</strong> <span class="sub">' + esc(b.code) + ' · in ' + esc(b.einheit) + '</span></div>' +
    '<div class="stellen">' + orte.map(o => invStelle(b, o, mitOrt)).join("") + '</div></div>';
}
function inventurView(){
  let liste = invArtikel();
  const buchstaben = Array.from(new Set(liste.map(b => invBuchstabe(b.code)))).sort();
  let h = '<div class="card"><div class="row wrapr" style="gap:8px">' +
          '<span class="big" style="font-size:22px">Inventur · ' + esc(invTitel()) + '</span><span class="sp"></span>' +
          '<button class="btn small primary" data-a="scan" data-x="inventur">Scannen</button></div>';
  h += '<p class="sub" style="margin:8px 0 0">Begonnen ' + new Date(inv.start).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) +
       ' · <strong id="invStand">' + invFortschritt() + '</strong></p>';
  if(inv.ort === INV_ALLE) h += '<p class="sub" style="margin:4px 0 0">Weitere Räume und Koffer erscheinen bei einem Artikel nur, wenn dort etwas liegt oder ein Koffer-Soll besteht.</p>';
  h += '<div class="row" style="gap:8px;margin-top:10px"><button class="btn small" data-a="invAbbrechen">Verwerfen</button><span class="sp"></span>' +
       '<button class="btn primary" data-a="invAbschluss">Übernehmen …</button></div></div>';

  h += '<div class="seg" style="margin-bottom:8px">' + segBtn("invFilter", "alle", "Alle", invAnsicht.filter) +
       segBtn("invFilter", "offen", "Noch offen", invAnsicht.filter) + segBtn("invFilter", "abw", "Abweichung", invAnsicht.filter) + '</div>';
  if(buchstaben.length > 1){
    h += '<div class="row wrapr" style="gap:6px;margin-bottom:8px"><button class="btn small' + (!invAnsicht.buchstabe ? " primary" : "") + '" data-a="invBuchstabe" data-x="">alle</button>';
    buchstaben.forEach(x => h += '<button class="btn small' + (invAnsicht.buchstabe === x ? " primary" : "") + '" data-a="invBuchstabe" data-x="' + esc(x) + '">' + esc(x) + '</button>');
    h += '</div>';
  }
  h += '<div class="feld"><input type="search" data-c="suche" placeholder="Artikel oder Code" value="' + esc(view.suche) + '"></div>';

  if(invAnsicht.buchstabe) liste = liste.filter(b => invBuchstabe(b.code) === invAnsicht.buchstabe);
  if(invAnsicht.filter === "offen") liste = liste.filter(b => invStatus(b) === "offen");
  if(invAnsicht.filter === "abw")   liste = liste.filter(b => invStatus(b) === "abw");
  const q = view.suche.toLowerCase();
  if(q) liste = liste.filter(b => (b.name + " " + b.code + " " + tagNamen(tagsVon("artikel", b.code))).toLowerCase().indexOf(q) >= 0);
  if(!liste.length) return h + '<div class="leer">Nichts in dieser Auswahl.</div>';
  h += '<div class="card liste">' + liste.map(invZeile).join("") + '</div>';
  h += '<p class="sub">Zahl eintragen und Enter — weiter zum nächsten Feld. ✓ = stimmt mit dem System. Leeres Feld = nicht gezählt. ' +
       'Gebucht wird erst mit „Übernehmen“; bis dahin bleibt die Zählung auf diesem Gerät.</p>';
  return h;
}
/** Inventur starten: wo wird gezählt? */
function invStartView(){
  const g = offline ? " disabled" : "";
  return '<div class="card"><span class="lbl">Inventur starten — wo wird gezählt?</span><div style="display:grid;gap:8px">' +
    '<button class="btn primary" data-a="invNeu" data-x="' + INV_ALLE + '"' + g + '>Ganzes Lager (alle Orte)</button>' +
    '<span class="lbl" style="margin:6px 0 0">' + (raumOrte().length > 1 ? 'Einzelner Raum' : 'Nur Werkstatt') + '</span>' +
    raumOrte().map(o => '<button class="btn" data-a="invNeu" data-x="' + esc(o) + '"' + g + '>' + (raumOrte().length > 1 ? esc(o) : 'Nur ' + esc(o)) + '</button>').join("") +
    (kleiderOrte().length ? '<span class="lbl" style="margin:6px 0 0">Bekleidung</span><p class="sub" style="margin:0">Artikel mit Größen werden unter Material → Bekleidung je Größe gezählt („Zählen“).</p>' : '') +
    (kofferOrte().length ? '<span class="lbl" style="margin:6px 0 0">Einzelner Koffer</span>' : '') +
    kofferOrte().map(o => '<button class="btn" data-a="invNeu" data-x="' + esc(o) + '"' + g + '>' + esc(o) + '</button>').join("") + '</div>' +
    '<p class="sub" style="margin:10px 0 0">Gezählt wird auf diesem Gerät; gebucht wird erst mit „Übernehmen“. Einen einzelnen Artikel korrigieren: Lager → Artikel antippen → Inventur.</p></div>';
}
function invSetzen(key, wertText){
  const n = wertText === "" || wertText == null ? null : Number(String(wertText).replace(",", "."));
  if(n === null) delete inv.z[key];
  else if(isNaN(n) || n < 0){ toast("Ungültige Zahl.", true); }
  else {
    const alt = inv.z[key];
    // gleiche Zahl nochmal bestätigt: Bezugspunkt bleibt der vom ersten Zählen
    if(!alt || num(alt.g) !== n) inv.z[key] = { g:n, b:invSystem(key) };
  }
  invSpeichern();
  const code = invTeile(key).code, b = bestand(code), el = document.getElementById("inv-" + code);
  if(el && b){
    // Das Feld, das gerade den Fokus hat, verliert ihn beim Ersetzen — dessen
    // "change" darf dann nicht ein zweites Mal hier landen.
    const akt = document.activeElement;
    if(akt && el.contains(akt) && akt.dataset) akt.dataset.c = "";
    const neuZeile = document.createElement("div");
    neuZeile.innerHTML = invZeile(b);
    el.replaceWith(neuZeile.firstChild);
  }
  const st = $("invStand"); if(st) st.textContent = invFortschritt();
}
function invWeiter(key){
  const felder = Array.from(document.querySelectorAll('[data-c="invZahl"]'));
  const i = felder.findIndex(e => e.dataset.x === key), n = felder[i + 1];
  if(n){ n.focus(); try{ n.select(); }catch(e){} n.scrollIntoView({ block:"center", behavior:"smooth" }); }
  else { const e = document.activeElement; if(e && e.blur) e.blur(); }
}
function invAbschluss(){
  const keys = Object.keys(inv.z);
  if(!keys.length){ toast("Noch nichts gezählt.", true); return; }
  const abw = keys.filter(k => invStelleStatus(k) === "abw");
  const bewegt = keys.filter(k => num(invSystem(k)) !== num(inv.z[k].b));
  let stellen = 0; invArtikel().forEach(b => stellen += invOrteFuer(b).length);
  const offen = stellen - keys.length, mitOrt = inv.ort === INV_ALLE;
  let h = '<h3>Inventur übernehmen · ' + esc(invTitel()) + '</h3>';
  h += '<p class="sub" style="margin-top:-6px">' + keys.length + ' gezählt, davon ' + (keys.length - abw.length) + ' ohne Abweichung' +
       (offen > 0 ? ' · ' + offen + ' nicht gezählt — bleiben unverändert' : '') + '.</p>';
  if(abw.length){
    h += '<div class="card tabwrap"><table><thead><tr><th>Artikel</th>' + (mitOrt ? '<th>Ort</th>' : '') + '<th>System</th><th>gezählt</th><th>Korrektur</th></tr></thead><tbody>';
    abw.sort().forEach(k => {
      const t = invTeile(k), z = inv.z[k], a = artikel(t.code), d = num(z.g) - num(z.b);
      h += '<tr><td style="text-align:left">' + esc(a ? a.name : t.code) + '<br><span class="sub">' + esc(t.code) + '</span></td>' + (mitOrt ? '<td style="text-align:left">' + esc(t.ort) + '</td>' : '') +
           '<td class="mono">' + zahl(z.b) + '</td><td class="mono">' + zahl(z.g) + '</td>' +
           '<td class="mono" style="color:' + (d < 0 ? "var(--sprint)" : "var(--ok)") + '"><strong>' + (d > 0 ? "+" : "") + zahl(d) + '</strong></td></tr>';
    });
    h += '</tbody></table></div>';
  } else h += '<p>Keine Abweichungen — es wird nur festgehalten, dass gezählt wurde.</p>';
  if(bewegt.length) h += '<p class="sub">Bei ' + bewegt.length + ' Position' + (bewegt.length === 1 ? '' : 'en') + ' wurde seit dem Zählen gebucht. Diese Buchungen bleiben erhalten; korrigiert wird nur die Abweichung zum Zeitpunkt des Zählens.</p>';
  h += '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Zurück</button><span class="sp"></span>' +
       '<button class="btn primary" data-a="invBuchen">' + (abw.length ? abw.length + " Korrektur" + (abw.length === 1 ? "" : "en") + " buchen" : "Zählung abschließen") + '</button></div>';
  modal(h);
}
