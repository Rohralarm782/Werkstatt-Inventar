/* js/konto.js — Konten, Sitzungen, Standort, Rollen in der Oberfläche, Anmeldung,
   Konten-/Standortverwaltung, Briefkopf, Ansicht für Sportler.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ---------------------------------------------------------------
   Konten, Sitzungen, Standort (seit 14.0.0)
   Das Gerät merkt sich seinen Standort und den Modus:
   - „handy“: eine Person, bleibt angemeldet (90 Tage oder 12 Stunden)
   - „werkstatt“: mehrere Personen gleichzeitig eingetragen, alle werden
     um 23 Uhr ausgetragen. Gebucht wird mit der aktiven Person; sind
     mehrere eingetragen, fragt die App „Wer macht das?“.
   Jede Anfrage trägt den Sitzungsschlüssel (X-Sitzung) und den
   Standort (X-Standort); was erlaubt ist, entscheidet die Datenbank.
----------------------------------------------------------------*/
class AbgemeldetFehler extends Error {}

function lies(k, d){ try{ const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; }catch(e){ return d; } }
const GERAET = Object.assign({ standort:null, standortName:"", modus:"handy" }, lies("wGeraet", {}));
let SITZUNGEN = lies("wSitzungen", []);   // [{ token, bis, konto_id, name, pin_laenge, gesamt_admin, sportler_id, standorte:[{id,name,rolle,rollen}] }]
let aktivKonto = lies("wAktiv", null);
let ICH = null;          // Antwort von ich() für die aktive Person (rolle = Hauptrolle, rollen = alle am Standort)
let STANDORT = null;     // Name, Briefkopf und Bank des Standorts (ohne Logos)
let anm = null;          // Anmeldung in Arbeit (siehe anmeldungHtml)

function merkeGeraet(){ try{ localStorage.setItem("wGeraet", JSON.stringify(GERAET)); }catch(e){} }
function sitzungen(){ const jetzt = Date.now(); SITZUNGEN = SITZUNGEN.filter(s => s && s.token && new Date(s.bis).getTime() > jetzt); return SITZUNGEN; }
function merkeSitzungen(){
  sitzungen();
  if(!SITZUNGEN.some(s => s.konto_id === aktivKonto)) aktivKonto = SITZUNGEN.length ? SITZUNGEN[0].konto_id : null;
  try{ localStorage.setItem("wSitzungen", JSON.stringify(SITZUNGEN)); localStorage.setItem("wAktiv", JSON.stringify(aktivKonto)); }catch(e){}
}
function aktiveSitzung(){ const l = sitzungen(); return l.find(s => s.konto_id === aktivKonto) || l[0] || null; }
function sitzungFuer(kontoId){ return sitzungen().find(s => s.konto_id === kontoId) || null; }
function sitzungEntfernen(kontoId){ SITZUNGEN = SITZUNGEN.filter(s => s.konto_id !== kontoId); merkeSitzungen(); }
/** Hauptrolle am Standort (die stärkste): manager | trainer | geschaeftsstelle | sportler */
function rolle(){ return ICH ? ICH.rolle : null; }
/** Alle Rollen am Standort (ab 18.0.0 mehrere möglich, z. B. Trainer + Sportler) */
function rollen(){ return ICH ? (ICH.rollen || (ICH.rolle ? [ICH.rolle] : [])) : []; }
const ROLLEN_TEXT = { admin:"Gesamt-Admin", manager:"Werkstatt-Manager", trainer:"Trainer/Mechaniker", geschaeftsstelle:"Geschäftsstelle", sportler:"Sportler" };
const ROLLEN_REIHE = ["admin", "manager", "trainer", "geschaeftsstelle", "sportler"];
/** „Trainer/Mechaniker + Sportler“ — x: Objekt mit rollen (Liste) oder rolle */
function rollenText(x){
  const l = x ? (x.rollen || (x.rolle ? [x.rolle] : [])) : [];
  return l.slice().sort((a, b) => ROLLEN_REIHE.indexOf(a) - ROLLEN_REIHE.indexOf(b)).map(r => ROLLEN_TEXT[r] || r).join(" + ");
}
function standortVon(s, st){ return ((s && s.standorte) || []).find(y => y.id === st) || null; }
function rolleAm(s, st){ const x = standortVon(s, st); return x ? x.rolle : ""; }
/** arbeiten: buchen, Tickets, Stammdaten, neue Kategorien/Tags · manager: löschen, umbenennen, Preise, Konten · rechnen: Rechnungen, Briefkopf.
    Mehrere Rollen: es zählt, was eine davon darf. */
function darf(was){
  const r = rollen(), hat = l => l.some(x => r.indexOf(x) >= 0);
  if(was === "arbeiten") return hat(["admin", "manager", "trainer"]);
  if(was === "manager")  return hat(["admin", "manager"]);
  if(was === "rechnen")  return hat(["admin", "manager", "geschaeftsstelle"]);
  if(was === "admin")    return !!(ICH && ICH.gesamt_admin);   // Gesamt-Admin: Standorte verwalten, nicht in fremde Daten
  return false;
}
/** Eingetragene Personen am Werkstatt-Laptop (ohne reine Sportler) */
function werkstattPersonen(){ return GERAET.modus === "werkstatt" ? sitzungen().filter(s => rolleAm(s, GERAET.standort) !== "sportler") : []; }

/** Antwort von anmelden / einladung_einloesen übernehmen */
function sitzungUebernehmen(r){
  const s = Object.assign({ token:r.token, bis:r.gueltig_bis }, r.konto);
  if(GERAET.modus !== "werkstatt") SITZUNGEN = [];
  SITZUNGEN = SITZUNGEN.filter(x => x.konto_id !== s.konto_id).concat([s]);
  aktivKonto = s.konto_id;
  merkeSitzungen();
  if(!(s.standorte || []).some(x => x.id === GERAET.standort) && (s.standorte || []).length){
    GERAET.standort = s.standorte[0].id; GERAET.standortName = s.standorte[0].name; merkeGeraet();
  }
}

/* ---------- Rollen in der Oberfläche ----------
   Die Datenbank prüft jede Änderung selbst. Die App blendet nur aus,
   was die Rolle nicht darf, damit niemand ins Leere tippt. */
const IMMER_OK = ["anmWahl","anmName","anmNameOk","anmCode","anmCodeOk","anmCodePinOk","anmTaste","anmOk","anmZurueck","anmStandort","anmGeraet","anmAbbrechen",
  "kontoMenue","kontoAktiv","kontoAustragen","kontoAlleAus","personEintragen","standortWechseln","standortWahl","pinAendern","pinAendernOk","abmelden",
  "geraetEinstellen","geraetModus","werWahl","werWahlAbbrechen","codeKopieren","codeTeilen",
  "kontNeu","kontNeuOk","kontBearbeiten","kontSpeichern","kontCode","kontAktiv","sportlerZugang","standortNeu","standortNeuOk","standortHin",
  "stManagerNeu","stManagerNeuOk","stManagerCode","stManagerAktiv",
  "briefkopfSpeichern","logoWeg","spProblem","spProblemOk","spFotosOk","spTicket","modalZu","modalHintergrund"];
const LESEN_OK = ["tab","filter","verlaufArt","verlaufMehr","verlaufNeu","verlaufTicket","verlaufRad","mat","matFilter","kofferAuf","kofferZu","rt","radAuf","radZu",
  "geheMehr","mehrZu","teilZeigen","oeffnen","zurueck","scan","drucken","artikelMenue","export","rechnungZeigen","rechnungDrucken","postenZeigen","fotoZeigen",
  "bestellZu","bestellKopieren","buchungenArtikel","serieEtiketten","stueckEtikett","artikelEtikett","radEtikett","radEtikettenAlle","etDrucken","etSammeln","etZurueck",
  "vorlagenVerwalten","vorlageForm","vorlageSpeichern","vorlageLoeschen","vorlageTest","dlEntfernen","dlLeeren","dlDrucken","dlAlle","dlKeine","dlAuswahl","zurDruckliste",
  "zeigAus","katFilter","ukFilter","katKlapp","katAlle","serieAuf","ukKatAuf","ukKatZu","fehlerZeigen","fehlerVerwerfen","invFilter"];
const RECHNEN_NUR = ["rechnungErstellen","rechnungStatus","rStorno","rStornoOk"];
const MANAGER_NUR = ["terminWeg","fotoLoeschen","ukHoch","ukUmbenennen","ukNameSpeichern","ukLoeschen","katUmbenennen","katNameSpeichern",
  "stueckLoeschen","serieLoeschen"];
const LESEN_C_OK = ["suche","uzTag","etVorlage","logoDatei"];
function aktionErlaubt(a){
  if(IMMER_OK.indexOf(a) >= 0) return true;
  const r = rolle();
  if(r === "geschaeftsstelle") return LESEN_OK.indexOf(a) >= 0 || RECHNEN_NUR.indexOf(a) >= 0;
  if(r === "sportler") return LESEN_OK.indexOf(a) >= 0;
  if(RECHNEN_NUR.indexOf(a) >= 0 && !darf("rechnen")) return false;
  if(MANAGER_NUR.indexOf(a) >= 0 && !darf("manager")) return false;
  return true;
}
function eingabeErlaubt(c){ return darf("arbeiten") || LESEN_C_OK.indexOf(c) >= 0; }
(function rollenCss(){
  const nicht = l => l.map(a => ':not([data-a="' + a + '"])').join("");
  const st = document.createElement("style");
  st.textContent =
    'body.nur-lesen [data-a]' + nicht(IMMER_OK.concat(LESEN_OK, RECHNEN_NUR)) + '{display:none!important}' +
    'body.nur-lesen [data-a="tab"][data-x="neu"]{display:none!important}' +
    'body.nur-lesen [data-c]' + LESEN_C_OK.map(c => ':not([data-c="' + c + '"])').join("") + '{pointer-events:none;opacity:.55}' +
    MANAGER_NUR.map(a => 'body.kein-manager [data-a="' + a + '"]').join(",") + '{display:none!important}' +
    RECHNEN_NUR.map(a => 'body.kein-rechnen [data-a="' + a + '"]').join(",") + '{display:none!important}';
  document.head.appendChild(st);
})();
function rollenKlassen(){
  const b = document.body.classList;
  b.toggle("nur-lesen", rolle() === "geschaeftsstelle");
  b.toggle("kein-manager", !darf("manager"));
  b.toggle("kein-rechnen", !darf("rechnen"));
}

/* ---------- „Wer macht das?“ am Werkstatt-Laptop ---------- */
let werWahlFertig = null;
function werMachtDas(){
  const l = werkstattPersonen();
  if(l.length < 2 || rolle() === "sportler") return Promise.resolve(true);
  return new Promise(ok => {
    werWahlFertig = ok;
    let el = $("werWahl"); if(!el){ el = document.createElement("div"); el.id = "werWahl"; document.body.appendChild(el); }
    let h = '<div class="overlay" style="z-index:58"><div class="sheet"><h3>Wer macht das?</h3><div style="display:grid;gap:8px">';
    l.forEach(s => h += '<button class="btn' + (s.konto_id === aktivKonto ? " primary" : "") + '" style="justify-content:flex-start" data-a="werWahl" data-x="' + s.konto_id + '">' +
                       esc(s.name) + ' <span class="sub" style="color:inherit;opacity:.75">· ' + esc(rollenText(standortVon(s, GERAET.standort))) + '</span></button>');
    h += '</div><button class="btn voll" style="margin-top:12px" data-a="werWahlAbbrechen">Abbrechen</button></div></div>';
    el.innerHTML = h;
  });
}
function werWahlSchliessen(wert){ const el = $("werWahl"); if(el) el.innerHTML = ""; const f = werWahlFertig; werWahlFertig = null; if(f) f(wert); }

/* ---------- Anmeldung ----------
   anm.schritt: standort | wer | pin | name | code | codepin
   anm.imModal: true = „Person eintragen“ am Werkstatt-Laptop */
function anmStart(imModal){ anm = { schritt: GERAET.standort ? "wer" : "standort", imModal:!!imModal, pin:"", bleiben:true }; anmeldungZeigen(); }
async function anmLaden(){
  if(!anm || anm.laedt) return;
  try{
    if(anm.schritt === "standort" && !anm.standorte){
      anm.laedt = true; anm.standorte = await rpc("standorte_liste");
      if(anm.standorte.length === 1 && !anm.wechseln){ GERAET.standort = anm.standorte[0].id; GERAET.standortName = anm.standorte[0].name; merkeGeraet(); anm.schritt = "wer"; }
    }
    if(anm.schritt === "wer" && !anm.liste){ anm.laedt = true; anm.liste = await rpc("anmelde_liste", { p_standort:GERAET.standort }); }
    anm.fehler = "";
  }catch(e){ anm.fehler = e instanceof NetzFehler ? "Keine Verbindung — bitte mit Netz noch einmal versuchen." : e.message; anm.laedtFehler = true; }
  finally{ if(anm){ anm.laedt = false; } }
  anmeldungZeigen();
}
function pinPunkte(n, min){
  let h = '<div class="pinpunkte" aria-label="PIN, ' + n + ' Ziffern eingegeben">';
  for(let i = 0; i < Math.max(min, n); i++) h += '<span class="' + (i < n ? "voll" : "") + '"></span>';
  return h + '</div>';
}
function pinBlock(min){
  let h = pinPunkte(anm.pin.length, min) + '<div class="pinfeld">';
  ["1","2","3","4","5","6","7","8","9"].forEach(z => h += '<button class="btn" data-a="anmTaste" data-x="' + z + '">' + z + '</button>');
  h += '<button class="btn" data-a="anmTaste" data-x="weg" aria-label="Ziffer löschen">←</button><button class="btn" data-a="anmTaste" data-x="0">0</button>' +
       '<button class="btn primary" data-a="anmOk">OK</button></div>';
  return h;
}
function anmeldungHtml(){
  const a = anm, st = esc(GERAET.standortName || "");
  let h = '';
  if(a.fehler) h += '<div class="fehlerbox" style="margin-top:0">' + esc(a.fehler) + '</div>';
  if(a.schritt === "standort"){
    h += '<div class="card"><span class="lbl">Standort dieses Geräts</span>';
    if(!a.standorte){ h += a.laedtFehler ? '<button class="btn voll" data-a="anmZurueck">Nochmal versuchen</button>' : '<div class="sub">Lädt…</div>'; }
    else h += '<div style="display:grid;gap:8px">' + a.standorte.map(s => '<button class="btn" data-a="anmStandort" data-x="' + s.id + '">' + esc(s.name) + '</button>').join("") + '</div>';
    h += '</div><div class="card"><span class="lbl">Neu hier?</span><button class="btn voll" data-a="anmCode">Einladungscode eingeben</button>' +
         '<p class="sub" style="margin:8px 0 0">Mit dem Code wird der Standort automatisch gewählt.</p>';
    return h + '</div>' + (a.imModal || a.wechseln ? '<button class="btn voll" data-a="anmAbbrechen">Abbrechen</button>' : '');
  }
  if(a.schritt === "wer"){
    h += '<div class="card"><span class="lbl">Wer meldet sich an?</span>';
    if(!a.liste){ h += a.laedtFehler ? '<button class="btn voll" data-a="anmZurueck">Nochmal versuchen</button>' : '<div class="sub">Lädt…</div>'; }
    else {
      h += '<div class="kacheln">';
      a.liste.forEach(k => h += '<button class="btn kachel" data-a="anmWahl" data-x="' + k.id + '"><span>' + esc(k.name) + '</span><span class="sub">' + esc(rollenText(k)) + '</span></button>');
      h += '<button class="btn kachel" data-a="anmName"><span>Name eingeben</span><span class="sub">Sportler und andere</span></button>' +
           '<button class="btn kachel" data-a="anmCode"><span>Code</span><span class="sub">Einladung / neue PIN</span></button></div>';
    }
    h += '</div><p class="sub" style="text-align:center">Standort ' + st + ' · ' + (GERAET.modus === "werkstatt" ? "Werkstatt-Laptop" : "persönliches Gerät") +
         ' · <button class="btn small link" data-a="anmGeraet">Gerät einstellen</button></p>';
    if(a.imModal) h += '<button class="btn voll" data-a="anmAbbrechen">Abbrechen</button>';
    return h;
  }
  if(a.schritt === "name"){
    return h + '<div class="card"><span class="lbl">Dein Name</span><div class="feld"><input type="text" id="anmNameFeld" autocomplete="username" value="' + esc(a.name || "") + '" placeholder="so wie in der Einladung"></div>' +
      '<div class="row" style="gap:8px"><button class="btn" data-a="anmZurueck">Zurück</button><span class="sp"></span><button class="btn primary" data-a="anmNameOk">Weiter</button></div></div>';
  }
  if(a.schritt === "pin"){
    h += '<div class="card" style="text-align:center"><div class="sub">PIN für <strong style="color:var(--ink)">' + esc(a.name) + '</strong></div>' + pinBlock(4);
    if(GERAET.modus !== "werkstatt") h += '<label class="row" style="gap:8px;justify-content:center;margin-top:10px;font-size:14px"><input type="checkbox" id="anmBleiben"' + (a.bleiben ? " checked" : "") + ' style="width:20px;height:20px"> Auf diesem Gerät angemeldet bleiben</label>';
    else h += '<p class="sub" style="margin:10px 0 0">Werkstatt-Laptop: um 23 Uhr wirst du automatisch ausgetragen.</p>';
    return h + '</div><button class="btn voll" data-a="anmZurueck">Zurück</button>';
  }
  if(a.schritt === "code"){
    return h + '<div class="card"><span class="lbl">Einladungscode</span><div class="feld"><input type="text" id="anmCodeFeld" autocomplete="off" autocapitalize="characters" value="' + esc(a.code || "") + '" placeholder="XXXX-XXXX" style="font-size:22px;letter-spacing:.12em;text-transform:uppercase"></div>' +
      '<p class="sub" style="margin-top:0">Den Code bekommst du vom Werkstatt-Manager — auch, wenn du deine PIN vergessen hast.</p>' +
      '<div class="row" style="gap:8px"><button class="btn" data-a="anmZurueck">Zurück</button><span class="sp"></span><button class="btn primary" data-a="anmCodeOk">Weiter</button></div></div>';
  }
  if(a.schritt === "codepin"){
    const n = a.codeInfo.pin_laenge;
    return h + '<div class="card"><h3 style="margin:0 0 6px">Hallo ' + esc(a.codeInfo.name) + '</h3><p class="sub" style="margin-top:0">Wähle deine PIN: nur Ziffern, mindestens ' + n + '. Keine einfache Folge wie 1234.</p>' +
      '<div class="grid2"><div class="feld"><span class="lbl">Neue PIN</span><input type="password" id="anmPin1" inputmode="numeric" autocomplete="new-password"></div>' +
      '<div class="feld"><span class="lbl">Wiederholen</span><input type="password" id="anmPin2" inputmode="numeric" autocomplete="new-password"></div></div>' +
      (GERAET.modus !== "werkstatt" ? '<label class="row" style="gap:8px;font-size:14px;margin-bottom:10px"><input type="checkbox" id="anmBleiben" checked style="width:20px;height:20px"> Auf diesem Gerät angemeldet bleiben</label>' : '') +
      '<div class="row" style="gap:8px"><button class="btn" data-a="anmZurueck">Zurück</button><span class="sp"></span><button class="btn primary" data-a="anmCodePinOk">PIN speichern</button></div></div>';
  }
  return h;
}
function anmeldungZeigen(){
  if(!anm) anm = { schritt: GERAET.standort ? "wer" : "standort", imModal:false, pin:"", bleiben:true };
  const titel = anm.schritt === "standort" ? "Standort wählen" : anm.schritt === "code" || anm.schritt === "codepin" ? "Einladung" : "Anmelden";
  if(anm.imModal){
    modal('<h3>' + (anm.schritt === "wer" ? "Person eintragen" : titel) + '</h3>' + anmeldungHtml());
  } else {
    $("tabs").hidden = true; $("scanBtn").hidden = true; $("banner").innerHTML = "";
    $("wer").hidden = !aktiveSitzung(); if(aktiveSitzung()) $("wer").textContent = werText();
    app.innerHTML = '<h2 class="sec" style="margin-top:4px">' + titel + '</h2>' + anmeldungHtml();
    zeigeStand();
  }
  const f = $("anmNameFeld") || $("anmCodeFeld") || $("anmPin1"); if(f) setTimeout(() => f.focus(), 30);
  if((anm.schritt === "standort" && !anm.standorte) || (anm.schritt === "wer" && !anm.liste)) if(!anm.laedtFehler) anmLaden();
}
function anmFertig(r){
  sitzungUebernehmen(r);
  const imModal = anm && anm.imModal;
  anm = null;
  if(imModal) modalZu();
  try{ if(location.hash) history.replaceState(null, "", location.pathname + location.search); }catch(e){}
  toast("Angemeldet: " + r.konto.name);
  DB = null; ICH = null;
  app.innerHTML = '<div class="leer">Lädt…</div>';
  frischLaden().then(() => { if(DB) radAusLink(); });
}
async function anmPinSenden(){
  const a = anm; if(!a || a.sendet) return;
  const b = $("anmBleiben"); if(b) a.bleiben = b.checked;
  if(a.pin.length < 4){ a.fehler = "Bitte die PIN eingeben."; anmeldungZeigen(); return; }
  a.sendet = true;
  try{
    const r = await rpc("anmelden", { p_standort:GERAET.standort, p_pin:a.pin, p_konto:a.konto || null, p_name:a.konto ? null : a.name,
                                      p_geraet:GERAET.modus, p_bleiben:a.bleiben });
    a.pin = "";
    if(!r || !r.ok){ a.fehler = (r && r.fehler) || "Anmeldung fehlgeschlagen."; a.sendet = false; anmeldungZeigen(); return; }
    anmFertig(r);
  }catch(e){ a.sendet = false; a.pin = ""; a.fehler = e instanceof NetzFehler ? "Keine Verbindung." : e.message; anmeldungZeigen(); }
}
/** Aufruf über den Einladungslink …#einladung=XXXX-XXXX */
function einladungAusLink(){
  const m = /einladung=([A-Za-z0-9-]+)/.exec(location.hash || "");
  if(!m) return false;
  anm = { schritt:"code", code:m[1].toUpperCase(), imModal:false, pin:"", bleiben:true };
  return true;
}
document.addEventListener("keydown", ev => {
  if(!anm || anm.schritt !== "pin" || (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName))) return;
  if(/^[0-9]$/.test(ev.key)){ ev.preventDefault(); A.anmTaste(ev.key); }
  else if(ev.key === "Backspace"){ ev.preventDefault(); A.anmTaste("weg"); }
  else if(ev.key === "Enter"){ ev.preventDefault(); A.anmOk(); }
});
document.addEventListener("keydown", ev => {
  if(ev.key !== "Enter" || !anm || !ev.target) return;
  if(ev.target.id === "anmNameFeld"){ ev.preventDefault(); A.anmNameOk(); }
  if(ev.target.id === "anmCodeFeld"){ ev.preventDefault(); A.anmCodeOk(); }
  if(ev.target.id === "anmPin2"){ ev.preventDefault(); A.anmCodePinOk(); }
});

/* ---------- Kopfzeile: wer ist angemeldet ---------- */
function werText(){
  const s = aktiveSitzung(); if(!s) return "Anmelden";
  const n = werkstattPersonen().length;
  return s.name + (GERAET.modus === "werkstatt" && n > 1 ? " · " + n : "") + " ▾";
}
function kontoMenue(){
  const s = aktiveSitzung();
  if(!s){ anmStart(false); return; }
  let h = '<h3>' + esc(s.name) + '</h3><p class="sub" style="margin-top:-6px">' + esc(rollenText(standortVon(s, GERAET.standort))) + ' · ' + esc(GERAET.standortName || "") + '</p>';
  if(GERAET.modus === "werkstatt"){
    h += '<div class="card" style="padding-top:4px;padding-bottom:4px"><span class="lbl" style="margin-top:8px">Gerade in der Werkstatt</span><div class="liste">';
    sitzungen().forEach(x => {
      const aktiv = x.konto_id === aktivKonto;
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(x.name) + '</strong>' + (aktiv ? ' <span class="chip ok">aktiv</span>' : '') +
           '<br><span class="sub">' + esc(rollenText(standortVon(x, GERAET.standort))) + '</span></div><div class="knoepfe">' +
           (aktiv ? '' : '<button class="btn small" data-a="kontoAktiv" data-x="' + x.konto_id + '">wechseln</button>') +
           '<button class="btn small" data-a="kontoAustragen" data-x="' + x.konto_id + '">austragen</button></div></div>';
    });
    h += '</div><button class="btn voll" style="margin:8px 0" data-a="personEintragen">+ Person eintragen (mit PIN)</button></div>' +
         '<p class="sub">Alle werden um 23 Uhr automatisch ausgetragen.</p>';
  }
  h += '<div style="display:grid;gap:8px">';
  if(GERAET.modus !== "werkstatt" && ((s.standorte || []).length > 1)) h += '<button class="btn" data-a="standortWechseln">Standort wechseln</button>';
  h += '<button class="btn" data-a="pinAendern">PIN ändern</button>';
  h += GERAET.modus === "werkstatt" ? '<button class="btn" data-a="kontoAlleAus">Alle austragen</button>' : '<button class="btn" data-a="abmelden">Abmelden</button>';
  h += '<button class="btn" data-a="geraetEinstellen">Gerät einstellen</button><button class="btn" data-a="modalZu">Schließen</button></div>';
  modal(h);
}
async function austragen(kontoId){
  const s = sitzungFuer(kontoId);
  if(s){ try{ await rest("/rpc/abmelden", { method:"POST", body:{}, sitzung:s }); }catch(e){} }
  sitzungEntfernen(kontoId);
}
function geraetDialog(){
  modal('<h3>Gerät einstellen</h3><div class="liste">' +
    '<label class="eintrag" style="cursor:pointer"><input type="radio" name="gm" value="handy"' + (GERAET.modus !== "werkstatt" ? " checked" : "") + ' style="width:20px;height:20px"><div class="txt"><strong>Persönliches Gerät</strong><br><span class="sub">Eine Person, bleibt angemeldet.</span></div></label>' +
    '<label class="eintrag" style="cursor:pointer"><input type="radio" name="gm" value="werkstatt"' + (GERAET.modus === "werkstatt" ? " checked" : "") + ' style="width:20px;height:20px"><div class="txt"><strong>Werkstatt-Laptop</strong><br><span class="sub">Mehrere tragen sich mit ihrer PIN ein; beim Buchen fragt die App, wer es macht. Um 23 Uhr werden alle ausgetragen.</span></div></label>' +
    '</div><div class="trenn"><span class="lbl">Standort</span><div class="row" style="gap:8px"><span>' + esc(GERAET.standortName || "—") + '</span><span class="sp"></span><button class="btn small" data-a="anmStandort" data-x="wechseln">ändern</button></div>' +
    '<p class="sub">Den Standort ändern geht nur, wenn niemand eingetragen ist — oder über „Standort wechseln“.</p></div>' +
    '<div class="row" style="gap:8px;margin-top:10px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="geraetModus">Speichern</button></div>');
}

/* ---------- Konten verwalten (Mehr → Konten) ---------- */
let kontenCache;   // undefined | "laedt" | "fehler" | [...]
async function ladeKonten(){
  if(kontenCache === "laedt") return;
  kontenCache = "laedt";
  try{ kontenCache = await rpc("konten_liste"); }catch(e){ kontenCache = "fehler"; toast(e.message, true); }
  render();
}
function kontoStatus(k){
  if(!k.aktiv) return '<span class="chip grau">deaktiviert</span>';
  if(k.gesperrt) return '<span class="chip alarm">gesperrt</span>';
  if(!k.pin_gesetzt) return k.einladung_bis ? '<span class="chip warn">Einladung offen bis ' + de(k.einladung_bis) + '</span>' : '<span class="chip warn">ohne PIN</span>';
  return '<span class="chip ok">aktiv</span>';
}
function kontenVerw(){
  if(kontenCache === undefined){ ladeKonten(); return '<div class="leer">Lädt…</div>'; }
  if(kontenCache === "laedt") return '<div class="leer">Lädt…</div>';
  if(kontenCache === "fehler") return '<div class="leer">Konnte nicht geladen werden. <button class="btn small" data-a="geheMehr" data-x="konten">nochmal</button></div>';
  let h = '<button class="btn primary" data-a="kontNeu" style="margin-bottom:10px">+ Neues Konto</button><div class="card liste">';
  kontenCache.forEach(k => {
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(k.name) + '</strong> <span class="sub">· ' + esc(rollenText(k)) + '</span><br>' + kontoStatus(k) +
         (k.zuletzt ? ' <span class="sub">zuletzt ' + de(k.zuletzt) + '</span>' : '') + '</div>' +
         (k.rolle === "admin" ? '' : '<button class="btn small" data-a="kontBearbeiten" data-x="' + k.id + '">bearbeiten</button>') + '</div>';
  });
  h += '</div><p class="sub">Neue Personen bekommen einen Einladungscode (7 Tage gültig, einmal). Damit wählen sie ihre PIN. PIN vergessen? Unter „bearbeiten“ einen neuen Code erzeugen — die alte PIN gilt dann nicht mehr. ' +
       'Sportler-Zugänge gibt es auch auf der Seite Sportler.' + (darf("admin") ? ' Werkstatt-Manager anderer Standorte lädst du unter Mehr → Standorte ein.' : '') + '</p>';
  return h;
}
/* Rollen als Häkchen (ab 18.0.0 mehrere je Konto). Werkstatt-Manager nur für den
   Gesamt-Admin. Beim Häkchen „Sportler“ erscheint die Sportler-Auswahl, solange
   das Konto noch mit keinem Sportler verknüpft ist (spFest = verknüpfter Name). */
const ROLLEN_ERKL = { manager:"alles, auch Konten, Preise, Löschen", trainer:"buchen, Tickets, Material und Stammdaten anlegen",
  geschaeftsstelle:"alles ansehen, Rechnungen, Briefkopf", sportler:"eigene Räder, Tickets, Rechnungen" };
function rollenAuswahl(pre, gewaehlt, spFest){
  const l = (darf("admin") ? ["manager"] : []).concat(["trainer", "geschaeftsstelle", "sportler"]);
  const sp = (DB.sportler||[]).filter(s => s.aktiv && s.abrechnen && !(Array.isArray(kontenCache) && kontenCache.some(k => k.sportler_id === s.id && k.aktiv)));
  const spBox = pre + 'SpBox';
  let h = '<div class="feld"><span class="lbl">Rollen (auch mehrere)</span><div class="liste">';
  l.forEach(r => {
    h += '<label class="eintrag" style="cursor:pointer"><input type="checkbox" data-rolle="' + pre + '" value="' + r + '"' + (gewaehlt.indexOf(r) >= 0 ? " checked" : "") +
         (r === "sportler" && !spFest ? ' onchange="document.getElementById(\'' + spBox + '\').hidden=!this.checked"' : '') + ' style="width:20px;height:20px">' +
         '<div class="txt"><strong>' + esc(ROLLEN_TEXT[r]) + '</strong>' + (r === "sportler" && spFest ? ' <span class="sub">· ' + esc(spFest) + '</span>' : '') +
         '<br><span class="sub">' + esc(ROLLEN_ERKL[r]) + '</span></div></label>';
  });
  h += '</div></div>';
  if(!spFest) h += '<div class="feld" id="' + spBox + '"' + (gewaehlt.indexOf("sportler") >= 0 ? "" : " hidden") + '><span class="lbl">Welcher Sportler?</span><select id="' + pre + 'Sportler"><option value="">— wählen —</option>' +
                   sp.map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join("") + '</select></div>';
  return h;
}
function rollenGewaehlt(pre){ return Array.from(document.querySelectorAll('[data-rolle="' + pre + '"]')).filter(c => c.checked).map(c => c.value); }
function pinLaengeFuer(l){ return l.indexOf("manager") >= 0 || l.indexOf("geschaeftsstelle") >= 0 ? 6 : 4; }
function codeZeigen(r){
  const link = appUrl() + "#einladung=" + r.code;
  modal('<h3>Einladung für ' + esc(r.name) + '</h3>' +
    '<div class="card" style="text-align:center"><div class="codegross">' + esc(r.code) + '</div>' +
    '<div style="width:160px;height:160px;margin:10px auto">' + qrSvg(link, {}) + '</div>' +
    '<p class="sub" style="margin:0">Gilt bis ' + esc(new Date(r.gueltig_bis).toLocaleString("de-DE", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })) + ' Uhr, nur einmal.</p></div>' +
    '<p class="sub">Link öffnen oder in der App „Code“ wählen und den Code eintippen, dann eine PIN wählen. Der Code erscheint nur jetzt — bei Bedarf einfach einen neuen erzeugen.</p>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-a="codeKopieren" data-x="' + esc(link) + '">Link kopieren</button>' +
    (navigator.share ? '<button class="btn" data-a="codeTeilen" data-x="' + esc(link) + '">Teilen</button>' : '') +
    '<span class="sp"></span><button class="btn primary" data-a="modalZu">Fertig</button></div>');
}
async function kontoRpc(fn, args, nachher){
  if(offline){ toast("Offline — erst wieder mit Netz.", true); return; }
  sperren(true);
  try{ const r = await rpc(fn, args); kontenCache = undefined; if(nachher) nachher(r); else { modalZu(); render(); } return r; }
  catch(e){ toast(e.message, true); }
  finally{ sperren(false); }
}

/* ---------- Standorte (Gesamt-Admin) ---------- */
let standorteCache;   // undefined | "laedt" | "fehler" | [...]
async function ladeStandorte(){
  if(standorteCache === "laedt") return;
  standorteCache = "laedt";
  try{ standorteCache = await rpc("standorte_verwaltung"); }catch(e){ standorteCache = "fehler"; toast(e.message, true); }
  render();
}
/** Gesamt-Admin: alle Standorte mit ihren Werkstatt-Managern — ohne Zugriff auf deren Daten. */
function standorteVerw(){
  if(standorteCache === undefined){ ladeStandorte(); return '<div class="leer">Lädt…</div>'; }
  if(standorteCache === "laedt") return '<div class="leer">Lädt…</div>';
  if(standorteCache === "fehler") return '<div class="leer">Konnte nicht geladen werden. <button class="btn small" data-a="geheMehr" data-x="standorte">nochmal</button></div>';
  let h = '<button class="btn primary" data-a="standortNeu" style="margin-bottom:10px">+ Neuer Standort</button>';
  standorteCache.forEach(st => {
    h += '<div class="card"><div class="row" style="gap:8px"><span class="big" style="flex:1">' + esc(st.name) + '</span><span class="chip grau">' + esc(st.kuerzel) + '</span>' +
         (st.id === GERAET.standort ? '<span class="chip ok">hier</span>' : st.meine_rolle ? '<button class="btn small" data-a="standortHin" data-x="' + st.id + '">wechseln</button>' : '') + '</div>' +
         '<span class="lbl" style="margin-top:10px">Werkstatt-Manager</span><div class="liste">';
    if(!st.manager.length) h += '<div class="sub">noch keiner</div>';
    st.manager.forEach(k => {
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(k.name) + '</strong><br>' + kontoStatus(k) + (k.zuletzt ? ' <span class="sub">zuletzt ' + de(k.zuletzt) + '</span>' : '') + '</div><div class="knoepfe">' +
           '<button class="btn small" data-a="stManagerCode" data-x="' + k.id + '">' + (k.pin_gesetzt ? "PIN zurücksetzen" : "neuer Code") + '</button>' +
           '<button class="btn small" data-a="stManagerAktiv" data-x="' + k.id + '">' + (k.aktiv ? "deaktivieren" : "aktivieren") + '</button></div></div>';
    });
    h += '</div><button class="btn small" style="margin-top:8px" data-a="stManagerNeu" data-x="' + st.id + '">+ Manager einladen</button></div>';
  });
  h += '<p class="sub">Die Standorte sind getrennt: Du siehst hier nur Name, Kürzel und die Werkstatt-Manager. In die Daten eines Standorts kommst du nur, wenn du dort selbst eine Rolle hast. ' +
       'Jeder Code beginnt mit dem Kürzel des Standorts (SN-B-101) — so landet ein Etikett nie im falschen Lager.</p>';
  return h;
}
function stManager(id){ for(const st of (Array.isArray(standorteCache) ? standorteCache : [])){ const k = st.manager.find(x => x.id === id); if(k) return k; } return null; }
function standortSetzen(id, name){
  GERAET.standort = id; GERAET.standortName = name || ""; merkeGeraet();
  DB = null; ICH = null; kontenCache = undefined; standorteCache = undefined; view.mehr = null; view.tab = "tickets"; view.ticket = null;
  try{ localStorage.removeItem("wSnap"); }catch(e){}
  modalZu(); app.innerHTML = '<div class="leer">Lädt…</div>';
  frischLaden();
}

/* ---------- Briefkopf & Bank (Mehr → Briefkopf) ---------- */
const BRIEFKOPF_FELDER = [
  ["rg_empfaenger", "Zahlungsempfänger / Kontoinhaber", "text", "Steht im Zahlungskasten, im GiroCode und unter dem Gruß."],
  ["iban", "IBAN", "text", ""], ["bic", "BIC", "text", ""], ["bank", "Bank", "text", ""],
  ["zahlungsziel_tage", "Zahlungsziel (Tage)", "number", ""],
  ["rg_absender", "Absenderzeile über der Anschrift", "text", "Eine Zeile, klein über dem Empfänger."],
  ["rg_kopf", "Kontaktblock rechts oben", "area", "Eine Angabe je Zeile; die erste Zeile wird fett."],
  ["rg_text", "Einleitungssatz", "area", ""],
  ["rg_fuss", "Fußzeile", "area", "Spalten durch eine Leerzeile trennen; die erste Zeile jeder Spalte wird fett."]
];
function briefkopfVerw(){
  const S = STANDORT || {};
  let h = '<div class="card">';
  if(darf("manager")) h += feld("Name des Standorts", "bk_name", S.name);
  BRIEFKOPF_FELDER.forEach(([k, l, t, hinweis]) => {
    h += t === "area" ? '<div class="feld"><span class="lbl">' + l + '</span><textarea id="bk_' + k + '" rows="' + (k === "rg_fuss" ? 9 : 4) + '">' + esc(S[k] || "") + '</textarea>' + (hinweis ? '<span class="sub">' + hinweis + '</span>' : '') + '</div>'
                      : feld(l, "bk_" + k, S[k], t, t === "number" ? ' min="0" max="90" step="1"' : '') + (hinweis ? '<p class="sub" style="margin:-8px 0 12px">' + hinweis + '</p>' : '');
  });
  h += '<button class="btn primary" data-a="briefkopfSpeichern">Speichern</button></div>';
  h += '<div class="card"><span class="lbl">Logos</span><p class="sub" style="margin-top:0">Oben mittig auf der Rechnung und klein in der Fußzeile (z. B. Bank). Bild wählen — es wird auf dem Gerät verkleinert.</p>' +
       '<div class="grid2"><div class="feld"><span class="lbl">Logo oben</span><input type="file" accept="image/*" data-c="logoDatei" data-x="logo"><button class="btn small link" data-a="logoWeg" data-x="logo">entfernen</button></div>' +
       '<div class="feld"><span class="lbl">Logo Fußzeile</span><input type="file" accept="image/*" data-c="logoDatei" data-x="fuss_logo"><button class="btn small link" data-a="logoWeg" data-x="fuss_logo">entfernen</button></div></div>' +
       '<p class="sub" style="margin:0">Vorschau: eine Rechnung unter Mehr → Rechnungen drucken.</p></div>';
  return h;
}
let logoCache = {};
async function standortLogos(){
  const id = GERAET.standort;
  if(!logoCache[id]){
    const r = await rest("/standort?id=eq." + id + "&select=logo,fuss_logo");
    logoCache[id] = r[0] || {};
  }
  return logoCache[id];
}

/* ---------- Ansicht für Sportler ---------- */
async function ladeSportler(){
  const [raeder, tickets, rechnungen, sportler, stueck, artikel, standort] = await Promise.all([
    rest("/v_rad?order=id"), rest("/ticket?order=id.desc&limit=50"), rest("/rechnung?order=id.desc&limit=50"),
    rest("/sportler"), rest("/stueck?order=nummer"), rest("/artikel?order=code"), rest("/standort?select=" + STANDORT_SPALTEN)
  ]);
  const ausgeliehen = (await rest("/v_ausgeliehen?order=seit.desc").catch(ohneTabelle)) || [];
  const positionen = tickets.length ? await rest("/ticket_position?ticket_id=in.(" + tickets.map(t => t.id).join(",") + ")&status=neq.storniert&order=id") : [];
  const tsDa = await stueckeAnTickets(tickets);
  // Anzahl Fotos der offenen Tickets (für „Fotos ergänzen“, höchstens FOTOS_PRO_TICKET)
  const offeneIds = tickets.filter(t => t.status === "offen" || t.status === "angenommen").map(t => t.id);
  const fotoIds = offeneIds.length ? await rest("/foto?ticket_id=in.(" + offeneIds.join(",") + ")&select=ticket_id") : [];
  const fotoAnzahl = {};
  fotoIds.forEach(x => fotoAnzahl[x.ticket_id] = (fotoAnzahl[x.ticket_id] || 0) + 1);
  STANDORT = standort[0] || null;
  DB = { bestand:[], artikel, raeder, sportler, stueck, tickets, positionen, koffer:[], termine:[], rechnungen, offenePosten:[], zaehlung:[], bestellungen:[],
         tags:null, artikelTags:[], stueckTags:[], tsDa, kategorien:null, fotoAnzahl, ausgeliehen };
  stand = new Date();
  offline = false;
}
function sportlerView(){
  const offen = t => t.status === "offen" || t.status === "angenommen";
  let h = '<h2 class="sec" style="margin-top:4px">Meine Räder</h2>';
  if(!(DB.raeder||[]).length) h += '<div class="leer">Dir ist noch kein Rad zugeordnet. Sag deinem Trainer Bescheid.</div>';
  (DB.raeder||[]).forEach(r => {
    const t = (DB.tickets||[]).filter(x => x.rad_id === r.id && offen(x));
    const steht = t.some(x => !x.fahrbereit);
    h += '<div class="card"><div class="row" style="gap:8px;align-items:flex-start"><div style="flex:1;min-width:0"><span class="big">' + esc(r.bezeichnung || r.id) + '</span>' +
         '<div class="sub">' + esc([r.id, r.typ, r.marke, r.groesse ? "Gr. " + r.groesse : ""].filter(Boolean).join(" · ")) + '</div></div>' +
         (t.length ? '<span class="chip ' + (steht ? "alarm" : "warn") + '">' + (steht ? "steht · " : "") + 'Ticket offen</span>' : '<span class="chip ok">alles ok</span>') + '</div>' +
         '<button class="btn voll ' + (t.length ? "" : "rot") + '" style="margin-top:10px" data-a="spProblem" data-x="' + esc(r.id) + '">' +
         (t.length ? tnr(t[0].id) + ' ansehen · Fotos ergänzen' : 'Problem melden') + '</button></div>';
  });
  const leih = (DB.ausgeliehen || []).filter(z => num(z.menge) > 0);
  if(leih.length){
    h += '<h2 class="sec">Ausgeliehene Bekleidung</h2><div class="card liste">';
    leih.forEach(z => h += '<div class="eintrag"><div class="txt"><strong>' + esc((artikel(z.code) || {}).name || z.code) + '</strong> ' + esc(grName(z.groesse)) +
                           '<br><span class="sub">' + zahl(z.menge) + ' Stück' + (z.seit ? ' · seit ' + de(z.seit) : '') + '</span></div></div>');
    h += '</div><p class="sub">Leihgabe — bitte zurückgeben, wenn du sie nicht mehr brauchst.</p>';
  }
  const tl = (DB.tickets||[]).slice().sort((a, b) => (offen(b) - offen(a)) || (b.id - a.id));
  h += '<h2 class="sec">Meine Tickets</h2>';
  if(!tl.length) h += '<div class="leer">Noch keine Tickets.</div>';
  else {
    h += '<div class="card liste">';
    tl.forEach(t => {
      const p = positionen(t.id), fertig = p.filter(schrittFertig).length;
      const st = t.status === "erledigt" ? '<span class="chip ok">erledigt</span>' : t.status === "storniert" ? '<span class="chip grau">storniert</span>' :
                 t.status === "angenommen" ? '<span class="chip warn">in Arbeit</span>' : '<span class="chip grau">gemeldet</span>';
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(t.problem) + '</strong><br><span class="sub">' + tnr(t.id) + ' · ' + esc(ticketObjekt(t)) +
           ' · ' + de(t.angelegt) + (offen(t) && t.soll_fertig ? ' · soll fertig ' + de(t.soll_fertig) : '') + (offen(t) && p.length ? ' · ' + fertig + '/' + p.length + ' Schritte' : '') +
           (t.status === "erledigt" && t.erledigt_am ? ' · erledigt ' + de(t.erledigt_am) : '') + '</span></div>' + st + '</div>';
    });
    h += '</div>';
  }
  h += '<h2 class="sec">Meine Rechnungen</h2>';
  if(!(DB.rechnungen||[]).length) h += '<div class="leer">Keine Rechnungen.</div>';
  else {
    h += '<div class="card liste">';
    DB.rechnungen.forEach(r => {
      h += '<div class="eintrag"><div class="txt"><strong>' + esc(r.nummer) + '</strong><br><span class="sub">' + deLang(r.datum) + ' · ' + eur(r.summe) + '</span></div>' +
           (r.status === "bezahlt" ? '<span class="chip ok">bezahlt</span>' : r.status === "storniert" ? '<span class="chip grau">storniert</span>' : '<span class="chip warn">offen</span>') +
           '<button class="btn small" data-a="rechnungZeigen" data-x="' + r.id + '">anzeigen</button></div>';
    });
    h += '</div>';
  }
  return h;
}
function spProblemForm(radId){
  const r = rad(radId);
  if(!r){ toast("Das Rad gehört nicht zu dir.", true); return; }
  // Pro Rad nur ein offenes Ticket — dann dort Fotos ergänzen
  const t = (DB.tickets||[]).filter(x => x.rad_id === r.id && (x.status === "offen" || x.status === "angenommen")).sort((a, b) => a.id - b.id)[0];
  if(t){
    const n = (DB.fotoAnzahl || {})[t.id] || 0, frei = Math.max(FOTOS_PRO_TICKET - n, 0);
    modal('<h3>' + tnr(t.id) + ' ist offen</h3><p class="sub" style="margin-top:-6px">' + esc(r.bezeichnung || r.id) + ' · ' + esc(r.id) + '</p>' +
      '<div class="card"><strong>' + esc(t.problem) + '</strong><br><span class="sub">' + (t.status === "angenommen" ? "in Arbeit" : "gemeldet") + ' · ' + de(t.angelegt) +
      (t.fahrbereit ? '' : ' · steht') + '</span></div>' +
      '<p class="sub">Für dieses Rad ist schon ein Ticket offen. Ein neues kannst du melden, wenn es erledigt ist — sonst sprich die Werkstatt direkt an.</p>' +
      (frei ? '<div class="feld"><span class="lbl">Fotos ergänzen (' + n + '/' + FOTOS_PRO_TICKET + ')</span><input type="file" id="spFotos" accept="image/*" multiple></div>' +
              '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Schließen</button><span class="sp"></span><button class="btn primary" data-a="spFotosOk" data-x="' + t.id + '">Fotos senden</button></div>'
            : '<p class="sub">Das Ticket hat schon ' + FOTOS_PRO_TICKET + ' Fotos.</p><div class="row"><span class="sp"></span><button class="btn" data-a="modalZu">Schließen</button></div>'));
    return;
  }
  modal('<h3>Problem melden</h3><p class="sub" style="margin-top:-6px">' + esc(r.bezeichnung || r.id) + ' · ' + esc(r.id) + '</p>' +
    '<div class="feld"><span class="lbl">Was ist los?</span><textarea id="spText" placeholder="z. B. Kette springt im großen Gang"></textarea></div>' +
    '<div class="feld"><span class="lbl">Kannst du noch fahren?</span><select id="spFahr"><option value="ja">Ja, fahrbereit</option><option value="nein">Nein — das Rad steht</option></select></div>' +
    '<div class="feld"><span class="lbl">Bis wann brauchst du es? (optional)</span><input type="date" id="spDatum"></div>' +
    '<div class="feld"><span class="lbl">Fotos (optional)</span><input type="file" id="spFotos" accept="image/*" multiple></div>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn rot" data-a="spProblemOk" data-x="' + esc(radId) + '">Melden</button></div>');
}

/* ---------- Aktionen ---------- */
Object.assign(A, {
  anmStandort: x => {
    if(x === "wechseln"){
      if(sitzungen().length){ toast("Erst alle abmelden — oder „Standort wechseln“ im Menü oben rechts.", true); return; }
      modalZu(); anm = { schritt:"standort", wechseln:true, imModal:false, pin:"", bleiben:true }; anmeldungZeigen(); return;
    }
    const s = (anm && anm.standorte || []).find(y => y.id === Number(x)); if(!s) return;
    GERAET.standort = s.id; GERAET.standortName = s.name; merkeGeraet();
    anm = { schritt:"wer", imModal:anm.imModal, pin:"", bleiben:true }; anmeldungZeigen();
  },
  anmWahl: x => { const k = (anm.liste||[]).find(y => y.id === Number(x)); if(!k) return; Object.assign(anm, { schritt:"pin", konto:k.id, name:k.name, pin:"", fehler:"" }); anmeldungZeigen(); },
  anmName: () => { Object.assign(anm, { schritt:"name", konto:null, pin:"", fehler:"" }); anmeldungZeigen(); },
  anmNameOk: () => { const n = wert("anmNameFeld"); if(!n){ toast("Name fehlt.", true); return; } Object.assign(anm, { schritt:"pin", konto:null, name:n, pin:"", fehler:"" }); anmeldungZeigen(); },
  anmCode: () => { Object.assign(anm, { schritt:"code", fehler:"" }); anmeldungZeigen(); },
  anmCodeOk: async () => {
    const c = wert("anmCodeFeld"); if(!c){ toast("Code fehlt.", true); return; }
    anm.code = c.toUpperCase();
    try{
      const r = await rpc("einladung_pruefen", { p_code:anm.code });
      if(!r.ok){ anm.fehler = r.fehler; anmeldungZeigen(); return; }
      Object.assign(anm, { schritt:"codepin", codeInfo:r, fehler:"" }); anmeldungZeigen();
    }catch(e){ anm.fehler = e instanceof NetzFehler ? "Keine Verbindung." : e.message; anmeldungZeigen(); }
  },
  anmCodePinOk: async () => {
    const p1 = wert("anmPin1"), p2 = wert("anmPin2"), b = $("anmBleiben");
    if(p1 !== p2){ anm.fehler = "Die beiden PINs sind nicht gleich."; anmeldungZeigen(); return; }
    if(anm.sendet) return; anm.sendet = true;
    try{
      const r = await rpc("einladung_einloesen", { p_code:anm.code, p_pin:p1, p_geraet:GERAET.modus, p_bleiben:b ? b.checked : true });
      anm.sendet = false;
      if(!r.ok){ anm.fehler = r.fehler; anmeldungZeigen(); return; }
      anmFertig(r);
    }catch(e){ anm.sendet = false; anm.fehler = e instanceof NetzFehler ? "Keine Verbindung." : e.message; anmeldungZeigen(); }
  },
  anmTaste: x => {
    if(!anm || anm.schritt !== "pin") return;
    const b = $("anmBleiben"); if(b) anm.bleiben = b.checked;
    if(x === "weg") anm.pin = anm.pin.slice(0, -1); else if(anm.pin.length < 12) anm.pin += x;
    anm.fehler = "";
    const p = document.querySelector(".pinpunkte"); if(p) p.outerHTML = pinPunkte(anm.pin.length, 4);
    const f = document.querySelector(".fehlerbox"); if(f) f.remove();
  },
  anmOk: () => anmPinSenden(),
  anmZurueck: () => {
    if(!anm) return;
    if(anm.laedtFehler){ anm.laedtFehler = false; anm.fehler = ""; anmeldungZeigen(); return; }
    Object.assign(anm, { schritt: GERAET.standort ? "wer" : "standort", pin:"", fehler:"", konto:null });
    anmeldungZeigen();
  },
  anmGeraet: () => geraetDialog(),
  anmAbbrechen: () => { const m = anm && anm.imModal; anm = null; if(m) modalZu(); render(); },
  kontoMenue: () => kontoMenue(),
  kontoAktiv: x => { aktivKonto = Number(x); merkeSitzungen(); modalZu(); toast("Aktiv: " + (aktiveSitzung() || {}).name); frischLaden(); },
  kontoAustragen: async x => {
    await austragen(Number(x));
    modalZu();
    if(!aktiveSitzung()){ DB = null; ICH = null; render(); return; }
    frischLaden();
  },
  kontoAlleAus: async () => {
    if(!confirm("Alle eingetragenen Personen austragen?")) return;
    for(const s of sitzungen().slice()) await austragen(s.konto_id);
    modalZu(); DB = null; ICH = null; render();
  },
  abmelden: async () => { await austragen(aktivKonto); try{ localStorage.removeItem("wSnap"); }catch(e){} modalZu(); DB = null; ICH = null; render(); },
  personEintragen: () => anmStart(true),
  standortWechseln: () => {
    const s = aktiveSitzung(), l = (s && s.standorte) || [];
    modal('<h3>Standort wechseln</h3><div style="display:grid;gap:8px">' +
      l.map(x => '<button class="btn' + (x.id === GERAET.standort ? " primary" : "") + '" data-a="standortHin" data-x="' + x.id + '">' + esc(x.name) + ' <span class="sub" style="color:inherit;opacity:.75">· ' + esc(rollenText(x)) + '</span></button>').join("") +
      '</div><button class="btn voll" style="margin-top:12px" data-a="modalZu">Abbrechen</button>');
  },
  standortHin: x => { const s = aktiveSitzung(), z = ((s && s.standorte) || []).find(y => y.id === Number(x)); if(z) standortSetzen(z.id, z.name); },
  pinAendern: () => modal('<h3>PIN ändern</h3>' + feld("Bisherige PIN", "pinAlt", "", "password", ' inputmode="numeric" autocomplete="current-password"') +
    '<div class="grid2">' + feld("Neue PIN", "pinNeu1", "", "password", ' inputmode="numeric" autocomplete="new-password"') + feld("Wiederholen", "pinNeu2", "", "password", ' inputmode="numeric" autocomplete="new-password"') + '</div>' +
    '<p class="sub">Mindestens ' + ((aktiveSitzung() || {}).pin_laenge || 4) + ' Ziffern. Andere Geräte werden dabei abgemeldet.</p>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="pinAendernOk">Speichern</button></div>'),
  pinAendernOk: async () => {
    if(wert("pinNeu1") !== wert("pinNeu2")){ toast("Die beiden neuen PINs sind nicht gleich.", true); return; }
    try{ await rpc("pin_aendern", { p_alt:wert("pinAlt"), p_neu:wert("pinNeu1") }); modalZu(); toast("PIN geändert"); }
    catch(e){ toast(e.message, true); }
  },
  geraetEinstellen: () => geraetDialog(),
  geraetModus: () => {
    const el = document.querySelector('input[name="gm"]:checked'); const m = el ? el.value : "handy";
    if(m !== GERAET.modus){
      GERAET.modus = m; merkeGeraet();
      if(m === "handy" && sitzungen().length > 1){
        const behalten = aktiveSitzung();
        sitzungen().filter(s => s !== behalten).forEach(s => austragen(s.konto_id));
      }
      toast(m === "werkstatt" ? "Werkstatt-Laptop: mehrere Personen, Abmeldung um 23 Uhr (gilt ab der nächsten Anmeldung)" : "Persönliches Gerät");
    }
    modalZu(); render();
  },
  werWahl: x => {
    const id = Number(x);
    if(id !== aktivKonto){ aktivKonto = id; merkeSitzungen(); bearbeiter = (aktiveSitzung() || {}).name || ""; $("wer").textContent = werText(); }
    werWahlSchliessen(true);
  },
  werWahlAbbrechen: () => werWahlSchliessen(false),
  codeKopieren: x => {
    const fertig = () => toast("Link kopiert");
    if(navigator.clipboard) navigator.clipboard.writeText(x).then(fertig, () => prompt("Link kopieren:", x));
    else prompt("Link kopieren:", x);
  },
  codeTeilen: x => { navigator.share({ title:"Einladung Werkstatt", text:"Deine Einladung für die Werkstatt-App:", url:x }).catch(() => {}); },
  kontNeu: () => {
    modal('<h3>Neues Konto</h3>' + feld("Name", "knName", "", "text", ' placeholder="bei Sportlern: leer = Name des Sportlers"') +
      rollenAuswahl("kn", ["trainer"], "") +
      '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="kontNeuOk">Einladung erzeugen</button></div>');
  },
  kontNeuOk: () => {
    const l = rollenGewaehlt("kn"), sp = wert("knSportler");
    if(!l.length){ toast("Bitte mindestens eine Rolle wählen.", true); return; }
    if(l.indexOf("sportler") >= 0 && !sp){ toast("Bitte den Sportler wählen.", true); return; }
    if(l.indexOf("sportler") < 0 && !wert("knName")){ toast("Name fehlt.", true); return; }
    kontoRpc("konto_anlegen", { p_name:wert("knName") || null, p_rolle:l[0], p_sportler:sp ? Number(sp) : null, p_rollen:l }, x => { codeZeigen(x); render(); });
  },
  kontBearbeiten: x => {
    const k = (Array.isArray(kontenCache) ? kontenCache : []).find(y => y.id === Number(x)); if(!k) return;
    const l = k.rollen || [k.rolle];
    const rolleFest = l.indexOf("manager") >= 0 && !darf("admin");
    const spName = k.sportler_id ? (((DB.sportler||[]).find(s => s.id === k.sportler_id) || {}).name || "verknüpft") : "";
    modal('<h3>' + esc(k.name) + '</h3><p class="sub" style="margin-top:-6px">' + esc(rollenText(k)) + ' · ' + kontoStatus(k) + '</p>' +
      feld("Name", "kbName", k.name) +
      (rolleFest ? '<p class="sub">Die Rollen eines Werkstatt-Managers ändert nur der Gesamt-Admin.</p>' : rollenAuswahl("kb", l, spName)) +
      '<div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap"><button class="btn" data-a="kontCode" data-x="' + k.id + '">' + (k.pin_gesetzt ? "PIN zurücksetzen (neuer Code)" : "Neuer Code") + '</button>' +
      '<button class="btn" data-a="kontAktiv" data-x="' + k.id + '">' + (k.aktiv ? "Deaktivieren" : "Aktivieren") + '</button></div>' +
      '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="kontSpeichern" data-x="' + k.id + '">Speichern</button></div>');
  },
  kontSpeichern: async x => {
    const k = kontenCache.find(y => y.id === Number(x)), n = wert("kbName");
    const alt = k.rollen || [k.rolle], fest = !document.querySelector('[data-rolle="kb"]');
    const neu = fest ? alt : rollenGewaehlt("kb"), sp = wert("kbSportler");
    const gleich = neu.length === alt.length && neu.every(r => alt.indexOf(r) >= 0);
    if(!n){ toast("Name fehlt.", true); return; }
    if(!neu.length){ toast("Bitte mindestens eine Rolle wählen.", true); return; }
    if(neu.indexOf("sportler") >= 0 && !k.sportler_id && !sp){ toast("Bitte den Sportler wählen.", true); return; }
    // Mit Manager/Geschäftsstelle braucht das Konto 6 Ziffern: die alte PIN gilt dann nicht mehr,
    // die Datenbank gibt einen neuen Einladungscode zurück.
    if(!gleich && k.pin_gesetzt && pinLaengeFuer(neu) > pinLaengeFuer(alt) &&
       !confirm(k.name + " braucht als " + rollenText({ rollen:neu }) + " eine 6-stellige PIN. Die bisherige PIN gilt danach nicht mehr, alle Geräte werden abgemeldet und du bekommst einen neuen Einladungscode. Weiter?")) return;
    if(n !== k.name){
      const ok = await kontoRpc("konto_aendern", { p_konto:k.id, p_name:n, p_rolle:null, p_aktiv:null }, () => {});
      if(ok === undefined) return;   // Fehler wurde schon gemeldet
    }
    if(gleich){ modalZu(); toast("Gespeichert"); render(); return; }
    kontoRpc("konto_rollen", { p_konto:k.id, p_rollen:neu, p_sportler:sp ? Number(sp) : null }, res => {
      if(res && res.code){ codeZeigen(res); render(); }
      else { modalZu(); toast("Gespeichert"); render(); }
    });
  },
  kontCode: x => {
    const k = kontenCache.find(y => y.id === Number(x));
    if(k.pin_gesetzt && !confirm("PIN von " + k.name + " zurücksetzen? Die alte PIN gilt sofort nicht mehr, alle Geräte werden abgemeldet.")) return;
    kontoRpc("konto_neuer_code", { p_konto:k.id }, r => { codeZeigen(r); render(); });
  },
  kontAktiv: x => {
    const k = kontenCache.find(y => y.id === Number(x));
    if(k.aktiv && !confirm(k.name + " deaktivieren? Die Person wird überall abgemeldet und kann sich nicht mehr anmelden.")) return;
    kontoRpc("konto_aendern", { p_konto:k.id, p_name:null, p_rolle:null, p_aktiv:!k.aktiv }, () => { modalZu(); render(); });
  },
  sportlerZugang: x => {
    const s = (DB.sportler||[]).find(y => y.id === Number(x));
    if(!confirm("Einladung für " + (s ? s.name : "den Sportler") + " erzeugen? Hat er schon einen Zugang, gilt seine alte PIN danach nicht mehr.")) return;
    kontoRpc("sportler_zugang", { p_sportler:Number(x) }, r => { codeZeigen(r); render(); });
  },
  standortNeu: () => modal('<h3>Neuer Standort</h3>' + feld("Name", "snName", "", "text", ' placeholder="z. B. Greifswald"') +
    feld("Kürzel (2–3 Buchstaben, steht vor jedem Code)", "snKz", "", "text", ' maxlength="3" autocapitalize="characters" placeholder="z. B. HGW"') +
    feld("Name des Werkstatt-Managers (optional)", "snManager", "") +
    '<p class="sub">Das Kürzel steht auf allen Etiketten (HGW-B-101, HGW-BR-01) und lässt sich später nicht mehr ändern. Der neue Standort bekommt die Standard-Kategorien; du selbst hast dort keinen Zugriff.</p>' +
    '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="standortNeuOk">Anlegen</button></div>'),
  standortNeuOk: async () => {
    const n = wert("snName"), kz = wert("snKz").toUpperCase(), m = wert("snManager");
    if(!n){ toast("Name fehlt.", true); return; }
    if(!/^[A-Z]{2,3}$/.test(kz)){ toast("Kürzel: 2 bis 3 Buchstaben A–Z.", true); return; }
    const id = await kontoRpc("standort_anlegen", { p_name:n, p_kuerzel:kz }, () => {});
    if(!id) return;
    standorteCache = undefined;
    if(m) await kontoRpc("standort_manager_einladen", { p_standort:id, p_name:m }, r => { codeZeigen(r); });
    else { modalZu(); toast("Standort „" + n + "“ angelegt"); }
    render();
  },
  stManagerNeu: x => {
    const st = (standorteCache || []).find(y => y.id === Number(x)); if(!st) return;
    modal('<h3>Werkstatt-Manager für ' + esc(st.name) + '</h3>' + feld("Name", "smName", "") +
      '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="stManagerNeuOk" data-x="' + st.id + '">Einladung erzeugen</button></div>');
  },
  stManagerNeuOk: x => {
    const n = wert("smName"); if(!n){ toast("Name fehlt.", true); return; }
    kontoRpc("standort_manager_einladen", { p_standort:Number(x), p_name:n }, r => { standorteCache = undefined; codeZeigen(r); render(); });
  },
  stManagerCode: x => {
    const k = stManager(Number(x)); if(!k) return;
    if(k.pin_gesetzt && !confirm("PIN von " + k.name + " zurücksetzen? Die alte PIN gilt sofort nicht mehr, alle Geräte werden abgemeldet.")) return;
    kontoRpc("manager_neuer_code", { p_konto:k.id }, r => { standorteCache = undefined; codeZeigen(r); render(); });
  },
  stManagerAktiv: x => {
    const k = stManager(Number(x)); if(!k) return;
    if(k.aktiv && !confirm(k.name + " deaktivieren? Er wird überall abgemeldet und kann sich nicht mehr anmelden.")) return;
    kontoRpc("manager_aktiv", { p_konto:k.id, p_aktiv:!k.aktiv }, () => { standorteCache = undefined; modalZu(); render(); });
  },
  briefkopfSpeichern: () => {
    const d = {};
    BRIEFKOPF_FELDER.forEach(([k, , t]) => { const v = wert("bk_" + k); d[k] = t === "number" ? (v === "" ? 14 : Number(v)) : (v || null); });
    if(darf("manager") && $("bk_name")){ const n = wert("bk_name"); if(!n){ toast("Name fehlt.", true); return; } d.name = n; }
    aktion(() => aendern("standort", "id=eq." + GERAET.standort, d), "Briefkopf gespeichert").then(() => {
      if(d.name){ GERAET.standortName = d.name; merkeGeraet(); }
    });
  },
  logoWeg: x => { if(!confirm("Logo entfernen?")) return; delete logoCache[GERAET.standort]; aktion(() => aendern("standort", "id=eq." + GERAET.standort, { [x]:null }), "Logo entfernt"); },
  spProblem: x => spProblemForm(x),
  spFotosOk: x => {
    const tid = Number(x), el = $("spFotos"), dateien = el ? Array.from(el.files || []) : [];
    if(!dateien.length){ toast("Bitte Fotos auswählen.", true); return; }
    const frei = Math.max(FOTOS_PRO_TICKET - ((DB.fotoAnzahl || {})[tid] || 0), 0);
    if(dateien.length > frei) toast("Höchstens " + FOTOS_PRO_TICKET + " Fotos pro Ticket — es werden nur " + frei + " gesendet.", true);
    const auswahl = dateien.slice(0, frei);
    aktion(async () => { for(const d of auswahl) await fotoHochladen(tid, await fotoAufbereiten(d)); return auswahl.length; },
           n => n + (n === 1 ? " Foto" : " Fotos") + " ergänzt");
  },
  spProblemOk: x => {
    const text = wert("spText"); if(!text){ toast("Bitte kurz beschreiben, was ist.", true); return; }
    const el = $("spFotos"), alle = el ? Array.from(el.files || []) : [];
    if(alle.length > FOTOS_PRO_TICKET) toast("Höchstens " + FOTOS_PRO_TICKET + " Fotos pro Ticket — es werden die ersten " + FOTOS_PRO_TICKET + " gesendet.", true);
    const dateien = alle.slice(0, FOTOS_PRO_TICKET);
    const op = { p_rad:x, p_problem:text, p_fahrbereit:wert("spFahr") !== "nein", p_soll_fertig:wert("spDatum") || null,
                 p_naechstmoeglich:false, p_anlass:null, p_arbeitsort:"Werkstatt", p_positionen:[], p_client_id:neueId() };
    aktion(async () => {
      const id = await rpc("ticket_anlegen", op);
      for(const d of dateien) await fotoHochladen(id, await fotoAufbereiten(d));
      return id;
    }, "Danke — die Werkstatt ist informiert");
  }
});
Object.assign(C, {
  logoDatei: (v, x, el) => {
    const d = (el.files || [])[0]; el.value = "";
    if(!d) return;
    aktion(async () => {
      const img = await bildLaden(d);
      const k = Math.min(1, 900 / img.width, 300 / img.height), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.85);
      delete logoCache[GERAET.standort];
      return aendern("standort", "id=eq." + GERAET.standort, { [x]:url });
    }, "Logo gespeichert");
  }
});
