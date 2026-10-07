/* js/inventar.js — Inventar: nummerierte Einzelstücke (Räder & Teile).
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Inventar — nummerierte Einzelstücke
   ===============================================================*/
/* Inventar: Kategorie-Menü oben; gleiche Teile (gleicher Typ, gleiche Marke,
   gleiches Detail) werden zu einer Serie „4×“ zusammengefasst und lassen
   sich aufklappen. */
function stueckKategorie(nr){ return codeBuchstabe(nr) || "?"; }
function kategorieName(k){ return katNamen()[k] || "Kategorie " + k; }
/** Gleiche Teile = gleicher Typ, Marke, Detail, in derselben Kategorie und mit denselben Tags. */
function serienSchluessel(s){ return [s.typ, s.marke, s.detail].map(x => (x || "").trim().toLowerCase()).concat([stueckKategorie(s.nummer), tagsVon("stueck", s.nummer).join("+")]).join("|"); }

/* ---------------------------------------------------------------
   Tags — je Kategorie-Buchstabe eine eigene Liste (wie früher die
   Unterkategorien). Ein Artikel / Einzelstück kann mehrere Tags seiner
   Kategorie haben (artikel_tag, stueck_tag). Die Kategorie bleibt der
   Buchstabe im Code; Codes und Etiketten ändern sich nie.
----------------------------------------------------------------*/
/** Gibt es die Tabellen schon (Migration 11.0.0 ausgeführt)? */
function tagDa(){ return Array.isArray(DB.tags); }
function tagListe(k){
  return (DB.tags || []).filter(t => t.buchstabe === k)
    .sort((a, b) => (a.sortierung - b.sortierung) || a.name.localeCompare(b.name, "de"));
}
function tagNachId(id){ return id == null ? null : (DB.tags || []).find(t => t.id === Number(id)) || null; }
function tagRang(t){ return tagListe(t.buchstabe).indexOf(t); }
/** Zuordnungen als Nachschlagetabelle (wird nach jedem Laden neu gebaut). */
let tagIndexFuer = null, tagIndex = { artikel:{}, stueck:{} };
function tagIndexHolen(){
  if(tagIndexFuer === DB) return tagIndex;
  const ix = { artikel:{}, stueck:{} };
  (DB.artikelTags || []).forEach(z => (ix.artikel[z.code] = ix.artikel[z.code] || []).push(z.tag_id));
  (DB.stueckTags || []).forEach(z => (ix.stueck[z.nummer] = ix.stueck[z.nummer] || []).push(z.tag_id));
  tagIndexFuer = DB; tagIndex = ix;
  return ix;
}
/** Tag-ids eines Artikels ("artikel") oder Einzelstücks ("stueck") — nur Tags der eigenen
    Kategorie, in der Reihenfolge der Tag-Liste. */
function tagsVon(art, schluessel){
  const k = stueckKategorie(schluessel);
  return (tagIndexHolen()[art][schluessel] || []).map(tagNachId).filter(t => t && t.buchstabe === k)
    .sort((a, b) => tagRang(a) - tagRang(b)).map(t => t.id);
}
/** Gliederung: Überschrift = erster Tag (nach Reihenfolge), sonst "ohne". */
function ukSchluessel(ids){ return ids.length ? String(ids[0]) : "ohne"; }
function ukRang(ids){ const t = ids.length ? tagNachId(ids[0]) : null; return t ? tagRang(t) : 1e6; }
function ukText(schluessel){ return schluessel === "ohne" ? "ohne Tag" : ((tagNachId(schluessel) || {}).name || "?"); }
function tagNamen(ids){ return ids.map(id => (tagNachId(id) || {}).name || "").join(" "); }
/** Kleine Tag-Chips für Listenzeilen */
function tagChips(ids){ return ids.length ? '<br><span class="tagzeile">' + ids.map(id => '<span class="chip grau">' + esc((tagNachId(id) || {}).name || "?") + '</span>').join(" ") + '</span>' : ""; }

/** Zugriff auf Kategorie/Tags je Liste: Lager (Artikel) und Inventar (Einzelstücke). */
const KAT_QUELLE = {
  l:   { kat: b => stueckKategorie(b.code),   tags: b => tagsVon("artikel", b.code),  zuKey:"wLagerKatZu" },
  inv: { kat: s => stueckKategorie(s.nummer), tags: s => tagsVon("stueck", s.nummer), zuKey:"wInvKatZu" }
};
/** Ordnet nach Kategorie, erstem Tag, Nummer. */
function katSortieren(p, liste, nummer){
  const q = KAT_QUELLE[p];
  return liste.slice().sort((a, b) => {
    const ka = q.kat(a), kb = q.kat(b);
    return ka.localeCompare(kb) || (ukRang(q.tags(a)) - ukRang(q.tags(b))) ||
           nummer(a).localeCompare(nummer(b), "de", { numeric:true });
  });
}

/* ---------------------------------------------------------------
   Sortierung der Übersichten (ab 20.0.0): Material ("l"), Einzelstücke ("inv")
   und Räder ("rad") wahlweise wie bisher (nach Kategorie bzw. Fahrer), nach
   Nummer oder nach letzter Änderung (Spalte geaendert_am, setzt die Datenbank).
   Die Wahl bleibt auf dem Gerät.
----------------------------------------------------------------*/
const SORT_ARTEN = ["standard", "nummer", "geaendert"];
function sortWahlen(){ try{ return JSON.parse(localStorage.getItem("wSort") || "{}") || {}; }catch(e){ return {}; } }
function sortArt(p){ const a = sortWahlen()[p]; return SORT_ARTEN.indexOf(a) >= 0 ? a : "standard"; }
function sortSetzen(p, a){ const o = sortWahlen(); o[p] = SORT_ARTEN.indexOf(a) >= 0 ? a : "standard"; try{ localStorage.setItem("wSort", JSON.stringify(o)); }catch(e){} }
/** Knopfreihe „Sortieren: Kategorie · Nummer · Zuletzt geändert“ */
function sortZeile(p, standardText){
  const a = sortArt(p), t = { standard:standardText, nummer:"Nummer", geaendert:"zuletzt geändert" };
  return '<div class="row sortzeile" style="gap:6px;margin:-2px 0 10px;flex-wrap:wrap;align-items:center"><span class="sub">Sortieren:</span>' +
         SORT_ARTEN.map(x => '<button class="btn small' + (a === x ? " primary" : "") + '" data-a="sortWahl" data-x="' + p + '|' + x + '"' + (a === x ? ' aria-pressed="true"' : '') + '>' + t[x] + '</button>').join("") + '</div>';
}
/** Zeitpunkt der letzten Änderung in ms (0, wenn unbekannt — z. B. Migration 20.0.0 noch nicht gelaufen). */
function geaendertZeit(x){ const t = x && x.geaendert_am ? Date.parse(x.geaendert_am) : NaN; return isNaN(t) ? 0 : t; }
function geaendertText(x){ const t = geaendertZeit(x); return t ? "geändert " + deLang(iso(new Date(t))) : ""; }
/** Sortiert nach Nummer bzw. neueste Änderung zuerst (bei gleicher Zeit nach Nummer). */
function nachArt(liste, art, nummer, zeit){
  const nr = (a, b) => String(nummer(a)).localeCompare(String(nummer(b)), "de", { numeric:true });
  return liste.slice().sort(art === "geaendert" ? (a, b) => (zeit(b) - zeit(a)) || nr(a, b) : nr);
}
/** Hinweis, wenn nach Änderung sortiert wird, die Datenbank die Zeit aber noch nicht liefert. */
function geaendertFehlt(liste, zeit){
  return liste.length && !liste.some(x => zeit(x)) ? '<p class="sub" style="color:var(--warn);margin:-4px 0 10px">Die Datenbank liefert noch keine Änderungszeit — Migration 20.0.0 ausführen, danach Data API → „Refresh schema cache“.</p>' : '';
}

/** Filterzeile: ohne Auswahl die Kategorien. Nach Antippen einer Kategorie stehen an
    derselben Stelle „‹ Kategorie“ (zurück) und deren Tags — eine Zeile, nicht zwei.
    Ein Eintrag mit mehreren Tags zählt bei jedem seiner Tags mit.
    Gezählt wird, was nach den übrigen Filtern (Suche, zu bestellen …) übrig ist. */
function katFilterZeile(p, items){
  const q = KAT_QUELLE[p], kat = view[p + "Kat"] || "";
  let h = '<div class="chipzeile">';
  if(!kat){
    const c = zaehle(items, q.kat), ks = Object.keys(c).sort();
    const mitTags = ks.some(k => tagListe(k).length);
    if(ks.length < 2 && !mitTags) return "";
    ks.forEach(k => h += '<button class="btn small" data-a="katFilter" data-x="' + p + '|' + esc(k) + '">' + esc(kategorieName(k)) + ' · ' + c[k] + '</button>');
    return h + '</div>';
  }
  // Gewählten Tag gibt es nicht mehr (gelöscht) → Auswahl aufheben
  const gew = view[p + "Uk"];
  if(gew && gew !== "ohne" && !(tagNachId(gew) && tagNachId(gew).buchstabe === kat)) view[p + "Uk"] = "";
  const uk = view[p + "Uk"] || "";
  const inKat = items.filter(i => q.kat(i) === kat);
  h += '<button class="btn small primary" data-a="katFilter" data-x="' + p + '|" aria-label="Kategorie-Filter aufheben">‹ ' + esc(kategorieName(kat)) + ' · ' + inKat.length + '</button>';
  const c = { ohne:0 };
  inKat.forEach(i => { const ids = q.tags(i); if(!ids.length) c.ohne++; ids.forEach(id => c[id] = (c[id] || 0) + 1); });
  // Tag gewählt: nur er (mit ×), die übrigen ausgeblendet — wie eine Ebene tiefer
  if(uk) return h + '<button class="btn small primary" data-a="ukFilter" data-x="' + p + '|' + esc(uk) + '" aria-label="Tag-Filter aufheben">' +
                    esc(ukText(uk)) + ' · ' + (c[uk] || 0) + ' ×</button></div>';
  const chips = tagListe(kat).filter(t => c[t.id]);
  chips.forEach(t => h += '<button class="btn small" data-a="ukFilter" data-x="' + p + '|' + t.id + '">' + esc(t.name) + ' · ' + c[t.id] + '</button>');
  if(chips.length && c.ohne) h += '<button class="btn small" data-a="ukFilter" data-x="' + p + '|ohne">ohne Tag · ' + c.ohne + '</button>';
  if(tagDa() && !tagListe(kat).length) h += '<button class="btn small link" data-a="ukVerwalten" data-x="' + esc(kat) + '">+ Tags</button>';
  return h + '</div>';
}
function katFilterAnwenden(p, items){
  const q = KAT_QUELLE[p], kat = view[p + "Kat"] || "", uk = view[p + "Uk"] || "";
  if(!kat) return items;
  return items.filter(i => {
    if(q.kat(i) !== kat) return false;
    if(!uk) return true;
    const ids = q.tags(i);
    return uk === "ohne" ? !ids.length : ids.indexOf(Number(uk)) >= 0;
  });
}

/** Liste gegliedert ausgeben: Kategorie-Überschrift (antippen = ein-/ausklappen),
    darunter Tag-Überschriften (erster Tag eines Eintrags) — die nur, wenn in der
    Kategorie welche vergeben sind. eintraege: [{ kat, uk, n, html }] in fertiger Reihenfolge.
    o: { p, mitKat, mitUk, klappbar, block(html), einheit:[eins, mehrere] } */
function gegliedert(eintraege, o){
  const zu = o.klappbar ? katZu(KAT_QUELLE[o.p].zuKey) : [];
  const katN = {}, ukN = {}, ukBenutzt = {};
  eintraege.forEach(e => {
    katN[e.kat] = (katN[e.kat] || 0) + e.n;
    ukN[e.kat + "|" + e.uk] = (ukN[e.kat + "|" + e.uk] || 0) + e.n;
    if(e.uk !== "ohne") ukBenutzt[e.kat] = true;
  });
  const anz = n => n + " " + (n === 1 ? o.einheit[0] : o.einheit[1]);
  let h = "", puffer = "", katV = null, ukV = null;
  const raus = () => { if(puffer){ h += o.block(puffer); puffer = ""; } };
  eintraege.forEach(e => {
    if(e.kat !== katV){
      raus(); katV = e.kat; ukV = null;
      if(o.mitKat){
        const zuHier = zu.indexOf(e.kat) >= 0;
        h += o.klappbar
          ? '<button class="kat-kopf" data-a="katKlapp" data-x="' + o.p + '|' + esc(e.kat) + '" aria-expanded="' + !zuHier + '"><span class="pfeil">' + (zuHier ? "▸" : "▾") + '</span>' +
            esc(kategorieName(e.kat)) + ' <span class="sub">· ' + anz(katN[e.kat]) + '</span></button>'
          : '<div class="kat-kopf" style="cursor:default">' + esc(kategorieName(e.kat)) + ' <span class="sub">· ' + anz(katN[e.kat]) + '</span></div>';
      }
    }
    if(o.mitKat && o.klappbar && zu.indexOf(e.kat) >= 0) return;
    if(o.mitUk && ukBenutzt[e.kat] && e.uk !== ukV){
      raus(); ukV = e.uk;
      h += '<div class="uk-kopf">' + esc(ukText(e.uk)) + ' <span class="sub">· ' + ukN[e.kat + "|" + e.uk] + '</span></div>';
    }
    puffer += e.html;
  });
  raus();
  return h;
}
/** "L-201–L-204, L-207" — aufeinanderfolgende Nummern zusammengefasst. */
function nummernText(nummern){
  const teile = [];
  nummern.slice().sort().forEach(nr => {
    const m = /^(.*-)(\d+)$/.exec(nr), letzt = teile[teile.length - 1];
    if(m && letzt && letzt.p === m[1] && letzt.bis + 1 === Number(m[2]) && String(m[2]).length === letzt.len){ letzt.bis++; return; }
    teile.push(m ? { p:m[1], von:Number(m[2]), bis:Number(m[2]), len:m[2].length } : { roh:nr });
  });
  const z = n => String(n);
  return teile.map(t => t.roh ? t.roh : t.von === t.bis ? t.p + z(t.von) : t.p + z(t.von) + "–" + t.p + z(t.bis)).join(", ");
}
function stueckOrtText(s){ const r = s.rad_id ? rad(s.rad_id) : null; return r ? "an " + (r.fahrer || r.bezeichnung) : s.ort; }
function zaehle(liste, f){ const c = {}; liste.forEach(x => { const k = f(x); c[k] = (c[k] || 0) + 1; }); return c; }

function stueckKarte(s, gesperrt, zusatz){
  const r = s.rad_id ? rad(s.rad_id) : null;
  let h = '<div class="card"><div class="row wrapr"><span><strong>' + esc(s.nummer) + '</strong> · ' + esc(s.typ) + (s.marke ? ' · ' + esc(s.marke) : '') + '<br><span class="sub">' + esc(s.detail || "") + (s.kaufdatum ? (s.detail ? ' · ' : '') + 'gekauft ' + monatJahr(s.kaufdatum) : '') + '</span></span><span class="sp"></span>';
  h += s.zustand === "zu prüfen" ? '<span class="chip alarm">zu prüfen</span>' : s.zustand === "defekt" ? '<span class="chip alarm">defekt</span>' : '<span class="chip ok">frei</span>';
  const tk = stueckTicket(s.nummer);
  if(tk) h += '<button class="chip warn" style="border:none;cursor:pointer;margin-left:4px" data-a="zumTicket" data-x="' + tk.id + '">Ticket ' + tnr(tk.id) + ' ›</button>';
  h += '</div><p class="sub" style="margin:8px 0">' + (r ? 'am Rad von ' + esc(r.fahrer || r.bezeichnung) + ' (' + esc(r.bezeichnung) + ')' : esc(s.ort)) + (zusatz ? ' · ' + esc(zusatz) : '') + '</p>';
  h += '<div class="grid2"><select data-c="stueckOrt" data-x="' + esc(s.nummer) + '"' + gesperrt + '>';
  orte().concat(s.ort !== "am Rad" && orte().indexOf(s.ort) < 0 && s.ort !== "ausgemustert" ? [s.ort] : [], ["ausgemustert"])
    .forEach(o => h += '<option value="' + esc(o) + '"' + (s.ort === o ? " selected" : "") + '>' + esc(o) + '</option>');
  (DB.raeder||[]).filter(x => x.aktiv || x.id === s.rad_id).forEach(x => h += '<option value="rad:' + esc(x.id) + '"' + (s.rad_id === x.id ? " selected" : "") + '>an ' + esc(x.fahrer || x.bezeichnung) + '</option>');
  h += '</select><select data-c="stueckZustand" data-x="' + esc(s.nummer) + '"' + gesperrt + '>';
  ["frei","zu prüfen","defekt"].forEach(z => h += '<option' + (s.zustand === z ? " selected" : "") + '>' + z + '</option>');
  h += '</select></div><button class="btn small" style="margin-top:8px" data-a="stueckBearbeiten" data-x="' + esc(s.nummer) + '"' + gesperrt + '>Details bearbeiten</button></div>';
  return h;
}
function serienKarte(gruppe, offen, zusatz){
  const s0 = gruppe[0], key = serienSchluessel(s0);
  const zust = zaehle(gruppe, s => s.zustand || "frei"), orte = zaehle(gruppe, stueckOrtText);
  let chips = "";
  ["defekt","zu prüfen"].forEach(z => { if(zust[z]) chips += '<span class="chip alarm">' + zust[z] + ' ' + z + '</span>'; });
  if(zust["frei"]) chips += '<span class="chip ok">' + (zust["frei"] === gruppe.length ? "frei" : zust["frei"] + " frei") + '</span>';
  const ortText = Object.keys(orte).length === 1 ? "alle " + Object.keys(orte)[0] : Object.keys(orte).map(o => orte[o] + "× " + o).join(" · ");
  let h = '<div class="card serie"><div class="row wrapr"><span><strong class="anzahl">' + gruppe.length + '×</strong> ' + esc(s0.typ) + (s0.marke ? ' · ' + esc(s0.marke) : '') +
          (s0.detail ? '<br><span class="sub">' + esc(s0.detail) + '</span>' : '') + '</span><span class="sp"></span><span class="chips">' + chips + '</span></div>';
  const daten = Array.from(new Set(gruppe.map(s => (s.kaufdatum || "").slice(0, 7))));
  const kauf = daten.length === 1 ? (daten[0] ? " · gekauft " + monatJahr(daten[0]) : "") : " · verschiedene Kaufdaten";
  h += '<p class="sub" style="margin:8px 0"><span class="mono">' + esc(nummernText(gruppe.map(s => s.nummer))) + '</span> · ' + esc(ortText) + esc(kauf) + (zusatz ? ' · ' + esc(zusatz) : '') + '</p>';
  h += '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn small" data-a="serieAuf" data-x="' + esc(key) + '">' + (offen ? "zuklappen ▴" : "einzeln ▾") + '</button>' +
       '<button class="btn small" data-a="serieBearbeiten" data-x="' + esc(key) + '"' + (offline ? " disabled" : "") + '>bearbeiten</button>' +
       '<button class="btn small" data-a="serieEtiketten" data-x="' + esc(key) + '">Etiketten</button>' +
       '<button class="btn small" data-a="serieLoeschen" data-x="' + esc(key) + '"' + (offline ? " disabled" : "") + '>löschen</button></div></div>';
  return h;
}

/** Gemeinsame Angaben einer Serie auf einmal ändern (Seriennummer bleibt je Stück). */
function serieForm(key){
  const g = (DB.stueck||[]).filter(s => serienSchluessel(s) === key);
  if(!g.length) return;
  const s0 = g[0], gleich = f => new Set(g.map(s => s[f] || "")).size === 1 ? (s0[f] || "") : "";
  const monate = Array.from(new Set(g.map(s => (s.kaufdatum || "").slice(0, 7))));
  const kaufVerschieden = monate.length > 1;
  modal('<h3>Serie bearbeiten · ' + g.length + '×</h3><p class="sub" style="margin-top:-6px">' + esc(nummernText(g.map(s => s.nummer))) + ' — Änderungen gelten für alle ' + g.length + ' Stück.</p>' +
    '<div class="grid2">' + feld("Typ", "eTyp", s0.typ) + feld("Marke", "eMarke", s0.marke, "text", ' list="markenDL"') + '</div>' + markenDL() +
    feld("Detail", "eDet", s0.detail) +
    ukBox(stueckKategorie(s0.nummer), tagsVon("stueck", s0.nummer)) +
    kaufFeld("eKauf", kaufVerschieden ? "" : (monate[0] ? monate[0] + "-01" : "")) +
    (kaufVerschieden ? '<p class="sub" style="margin:-4px 0 8px">Die Stücke haben verschiedene Kaufdaten. Leer lassen = unverändert.</p>' : '') +
    feld("Notiz", "eNotiz", gleich("notiz")) +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="serieSpeichern" data-x="' + esc(key) + '">Für alle speichern</button></div>');
}
/* Kaufdatum nur als Monat/Jahr. Gespeichert wird der Monatserste; ein vorhandenes
   genaues Datum bleibt unverändert, solange Monat und Jahr gleich bleiben. */
const MONATE = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
function monatJahr(d){ if(!d) return ""; const p = String(d).slice(0, 7).split("-"); return p[1] + "/" + p[0]; }
function kaufFeld(id, wert, label){
  const ym = wert ? String(wert).slice(0, 7) : "", jahrJetzt = heute().getFullYear();
  const j = ym ? Number(ym.slice(0, 4)) : null, m = ym ? Number(ym.slice(5, 7)) : null;
  let h = '<div class="feld"><span class="lbl">' + (label || "Kaufdatum") + '</span><div class="row" style="gap:8px">';
  h += '<select id="' + id + 'M" data-orig="' + esc(wert || "") + '"><option value="">Monat</option>';
  MONATE.forEach((t, i) => h += '<option value="' + (i + 1) + '"' + (m === i + 1 ? " selected" : "") + '>' + t + '</option>');
  h += '</select><select id="' + id + 'J"><option value="">Jahr</option>';
  const bis = Math.min(jahrJetzt - 30, j || jahrJetzt);
  for(let y = jahrJetzt; y >= bis; y--) h += '<option' + (j === y ? " selected" : "") + '>' + y + '</option>';
  return h + '</select></div></div>';
}
/** "YYYY-MM-DD" oder null. Nur Monat oder nur Jahr → Fehler. */
function kaufWert(id){
  const mEl = $(id + "M"); if(!mEl) return null;
  const m = mEl.value, j = wert(id + "J"), orig = mEl.dataset.orig || "";
  if(!m && !j) return null;
  if(!m || !j) throw new Error("Kaufdatum: bitte Monat und Jahr wählen — oder beides leer lassen.");
  const ym = j + "-" + String(m).padStart(2, "0");
  return orig.slice(0, 7) === ym ? orig : ym + "-01";
}

/** Nach „zu prüfen“ / „defekt“: Ticket für das Einzelstück anbieten, vorausgefüllt. */
function stueckTicketForm(nr, zustand){
  const s = stueckNr(nr); if(!s) return;
  const r = s.rad_id ? rad(s.rad_id) : null;
  let h = '<h3>Ticket anlegen?</h3><p class="sub" style="margin-top:-6px">' + esc(stueckText(nr)) + ' steht jetzt auf „' + esc(zustand) + '“' +
          (r ? ' · am Rad von ' + esc(r.fahrer || r.bezeichnung) : ' · ' + esc(s.ort)) + '.</p>';
  h += '<div class="feld"><span class="lbl">Was ist?</span><textarea id="stProblem" rows="2">' + esc((zustand === "defekt" ? "Defekt: " : "Prüfen: ") + s.typ + (s.marke ? " " + s.marke : "")) + '</textarea></div>';
  if(r) h += '<div class="feld"><span class="lbl">Rad fährt?</span><div class="seg">' + segBtn("stFahrbereit", "ja", "Ja, fährt", "ja") + segBtn("stFahrbereit", "nein", "Nein, steht", "ja") + '</div></div>';
  h += '<p class="sub">Solange das Teil auf „zu prüfen“ steht, lässt sich das Ticket nicht abschließen — erst freigeben.</p>';
  h += '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Ohne Ticket</button><span class="sp"></span>' +
       '<button class="btn primary" data-a="stueckTicketAnlegen" data-x="' + esc(nr) + '">Ticket anlegen</button></div>';
  modal(h);
  stFahrbereit = true;
}
let stFahrbereit = true;

/** Zugeklappte Kategorien (Inventar bzw. Lager) — bleiben auf dem Gerät gespeichert. */
function katZu(key){ try{ return JSON.parse(localStorage.getItem(key || "wInvKatZu") || "[]"); }catch(e){ return []; } }
function katZuSpeichern(l, key){ try{ localStorage.setItem(key || "wInvKatZu", JSON.stringify(l)); }catch(e){} }

/** Einzelstücke endgültig löschen — gedacht für Fehleingaben. Ausgemusterte Teile besser auf „ausgemustert“ setzen. */
function stueckeLoeschen(nummern){
  if(!nummern.length) return;
  const text = nummern.length === 1 ? nummern[0] : nummern.length + " Einzelstücke (" + nummernText(nummern) + ")";
  if(!confirm(text + " endgültig löschen?\n\nNur für Fehleingaben. Teile, die es gab und die weg sind, besser auf Ort „ausgemustert“ setzen — dann bleibt nachvollziehbar, was mit ihnen war.")) return;
  aktion(async () => {
    let weg;
    try{ weg = await rest("/stueck?nummer=in.(" + nummern.map(encodeURIComponent).join(",") + ")", { method:"DELETE", headers:{ Prefer:"return=representation" } }); }
    catch(e){ if(/foreign key|ticket/i.test(e.message)) throw new Error("Zu diesem Einzelstück gibt es Tickets — statt löschen auf Ort „ausgemustert“ setzen."); throw e; }
    if(!weg || !weg.length) throw new Error("Nichts gelöscht.");
    return weg.length;
  }, n => (n === 1 ? text : n + " Einzelstücke") + " gelöscht");
}

function inventarView(){
  const gesperrt = offline ? " disabled" : "";
  if(!view.serieOffen) view.serieOffen = {};
  let h = '<div class="row wrapr" style="gap:8px;margin-bottom:10px">' +
          '<button class="btn" data-a="stueckNeu"' + gesperrt + '>+ Neues Einzelstück</button>' +
          (drucklisteAnzahl() ? '<button class="btn warnwahl" data-a="zurDruckliste">Druckliste · ' + drucklisteAnzahl() + '</button>' : '') + '</div>';

  const roh = DB.stueck || [], qRoh = view.suche.toLowerCase().trim();
  const nAus = roh.filter(s => s.ort === "ausgemustert").length;
  // Ausgemusterte nur auf Wunsch — oder wenn genau ihre Nummer gesucht/gescannt wird
  const alle = view.zeigAus ? roh : roh.filter(s => s.ort !== "ausgemustert" || (qRoh && s.nummer.toLowerCase() === qRoh));
  // Suche zuerst; Kategorie/Tag filtern danach (die Zahlen an den Knöpfen passen zur Suche)
  const q = view.suche.toLowerCase();
  const gesucht = alle.filter(s => !q || (s.nummer + " " + s.typ + " " + (s.marke||"") + " " + (s.detail||"") + " " + (s.rad_id ? (rad(s.rad_id)||{}).fahrer || "" : "") + " " + tagNamen(tagsVon("stueck", s.nummer))).toLowerCase().indexOf(q) >= 0);
  h += katFilterZeile("inv", gesucht);
  h += '<div class="feld"><input type="search" data-c="suche" placeholder="Nummer, Typ, Marke, Fahrer" value="' + esc(view.suche) + '"></div>';
  h += sortZeile("inv", "Kategorie");
  const liste = katFilterAnwenden("inv", gesucht);
  const ausKnopf = nAus ? '<p style="text-align:center;margin-top:14px"><button class="btn small link" data-a="zeigAus">' + (view.zeigAus ? "ausgemusterte ausblenden" : "ausgemusterte zeigen (" + nAus + ")") + '</button></p>' : '';
  if(!liste.length) return h + '<div class="leer">' + (alle.length ? "Nichts gefunden." : roh.length ? "Nur ausgemusterte Einzelstücke vorhanden." : "Noch keine Einzelstücke erfasst.") + '</div>' + ausKnopf;

  // Serien bilden — Reihenfolge: Kategorie, erster Tag, kleinste Nummer (Standard),
  // sonst nach Nummer bzw. neuester Änderung in der Serie
  const sArt = sortArt("inv"), zeit = s => geaendertZeit(s);
  if(sArt === "geaendert") h += geaendertFehlt(liste, zeit);
  const gruppen = {}, reihe = [];
  (sArt === "standard" ? katSortieren("inv", liste, s => s.nummer) : nachArt(liste, sArt, s => s.nummer, zeit)).forEach(s => {
    const k = serienSchluessel(s);
    if(!gruppen[k]){ gruppen[k] = []; reihe.push(k); }
    gruppen[k].push(s);
  });
  // Ohne Kategorie-Filter: Überschrift je Kategorie (antippen = ein-/ausklappen),
  // darin Tags. Bei einer Suche ist alles aufgeklappt.
  const flach = sArt !== "standard";
  const mitKat = !view.invKat && !flach;
  const katsHier = Array.from(new Set(liste.map(s => stueckKategorie(s.nummer))));
  if(mitKat && katsHier.length > 1 && !q){
    h += '<div class="row" style="gap:6px;margin:-2px 0 4px;justify-content:flex-end">' +
         '<button class="btn small link" data-a="katAlle" data-x="inv|zu">alle zuklappen</button>' +
         '<button class="btn small link" data-a="katAlle" data-x="inv|auf">alle aufklappen</button></div>';
  }
  const eintraege = reihe.map(k => {
    const g = gruppen[k], kat = flach ? "" : stueckKategorie(g[0].nummer);
    const zusatz = sArt === "geaendert" ? geaendertText(g.reduce((m, s) => zeit(s) > zeit(m) ? s : m, g[0])) : "";
    let html;
    if(g.length === 1) html = stueckKarte(g[0], gesperrt, zusatz);
    else {
      // Aufgeklappt, wenn gewünscht oder wenn die Suche eine Nummer der Serie trifft (z. B. nach dem Scannen)
      const offen = !!view.serieOffen[k] || (q && g.some(s => s.nummer.toLowerCase().indexOf(q) >= 0));
      html = serienKarte(g, offen, zusatz) + (offen ? '<div class="serie-teile">' + g.map(s => stueckKarte(s, gesperrt, sArt === "geaendert" ? geaendertText(s) : "")).join("") + '</div>' : '');
    }
    return { kat, uk:flach ? "ohne" : ukSchluessel(tagsVon("stueck", g[0].nummer)), n:g.length, html };
  });
  h += gegliedert(eintraege, { p:"inv", mitKat, mitUk:!view.invUk && !flach, klappbar:!q && !flach, block:x => x, einheit:["Teil", "Teile"] });
  return h + ausKnopf;
}
