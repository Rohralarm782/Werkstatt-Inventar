/* js/core.js — Grundlagen: Konfiguration, Zustand, Zugang (Neon Auth), Datenbank (rest/rpc),
   Laden, Hilfsfunktionen, Rahmen (render) und Modal.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Werkstatt RSZ MV — Tickets, Lager, Koffer, Inventar, Verwaltung
   Datenquelle: Neon (Postgres) über Data API, anonymer Schlüssel von Neon Auth.
   Anmeldung mit Name + PIN (Konten in der Datenbank, seit 14.0.0).
   ===============================================================*/

const API_URL  = "https://ep-red-sunset-b1rq936o.apirest.c-5.eu-central-1.aws.neon.tech/neondb/rest/v1";
const AUTH_URL = "https://ep-red-sunset-b1rq936o.neonauth.c-5.eu-central-1.aws.neon.tech/neondb/auth";


/* ---------------------------------------------------------------
   Zustand
----------------------------------------------------------------*/
let DB = null;             // frisch geladene Daten
let stand = null;          // Zeitpunkt des letzten erfolgreichen Ladens
let offline = false;       // true = Anzeige zeigt einen alten Stand
// tab: tickets | neu | material | raeder | mehr
let view = { tab:"tickets", ticket:null, filter:"offen", suche:"", mat:"lager", koffer:null, lOrt:"", kOrt:"", ortAus:false, matFilter:"alle", rt:"raeder", rad:null, mehr:null };
let neu = null;            // Entwurf neues Ticket
let jwt = null, jwtExp = 0;
let bearbeiter = "";       // Name der aktiven Person (aus der Sitzung, siehe Konten)

const $ = id => document.getElementById(id);
const app = $("app");

/* ---------------------------------------------------------------
   Kleinkram
----------------------------------------------------------------*/
/** Heute, 0 Uhr — bei jedem Aufruf neu, damit eine über Nacht offene App nicht mit gestern rechnet. */
function heute(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function plusTage(n){ const d = heute(); d.setDate(d.getDate()+n); return d; }
function iso(d){ const m=d.getMonth()+1, t=d.getDate(); return d.getFullYear()+"-"+(m<10?"0":"")+m+"-"+(t<10?"0":"")+t; }
function de(s){ if(!s) return ""; const p=String(s).slice(0,10).split("-"); return p.length===3 ? p[2]+"."+p[1]+"." : String(s); }
function deLang(s){ if(!s) return ""; const p=String(s).slice(0,10).split("-"); return p[2]+"."+p[1]+"."+p[0]; }
function tageBis(s){ if(!s) return null; const d=new Date(String(s).slice(0,10)+"T00:00:00"); return isNaN(d)?null:Math.round((d-heute())/86400000); }
function uhr(d){ return d ? d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}) : ""; }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function num(v){ const n = Number(v); return isNaN(n) ? 0 : n; }
function zahl(v){ return num(v).toLocaleString("de-DE",{maximumFractionDigits:2}); }
function eur(v){ return num(v).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}) + " €"; }
function tnr(id){ return "T-" + String(id).padStart(4,"0"); }

/** Kommender Freitag — heute, wenn heute Freitag ist; am Wochenende der Freitag danach. */
function naechsterFreitag(){ const tag = heute().getDay(); return plusTage(tag <= 5 ? 5 - tag : 6); }

let toastTimer = null;
function toast(msg, fehler){
  $("toast").innerHTML = '<div class="toast'+(fehler?" fehler":"")+'">'+esc(msg)+'</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").innerHTML = ""; }, fehler ? 5000 : 3000);
}
function piep(ok){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(.12, ctx.currentTime); o.start();
    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime+.18); o.stop(ctx.currentTime+.2);
  }catch(e){}
}

/* ---------------------------------------------------------------
   Zugang ohne Anmeldung: Die App holt sich bei Neon Auth einen anonymen
   Schlüssel (gilt eine Stunde) und erneuert ihn selbst.
----------------------------------------------------------------*/
class NetzFehler extends Error {}

function jwtInhalt(t){
  try{
    let b = t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    while(b.length % 4) b += "=";
    return JSON.parse(atob(b));
  }catch(e){ return {}; }
}
async function netz(url, opt){
  try{ return await fetch(url, opt); }
  catch(e){ throw new NetzFehler("Keine Verbindung"); }
}
async function holeJwt(zwingend){
  if(!zwingend && jwt && Date.now()/1000 < jwtExp - 60) return jwt;
  const r = await netz(AUTH_URL + "/token/anonymous");
  if(!r.ok) throw new Error("Datenbank-Zugang nicht erreichbar (HTTP " + r.status + ")");
  const d = await r.json();
  if(!d.token) throw new Error("Datenbank-Zugang: kein Schlüssel erhalten");
  jwt = d.token;
  jwtExp = jwtInhalt(jwt).exp || 0;
  return jwt;
}

/* ---------------------------------------------------------------
   Datenbank (Data API, PostgREST)
----------------------------------------------------------------*/
async function rest(pfad, opt){
  opt = opt || {};
  const sitzung = opt.sitzung || aktiveSitzung();
  const baue = tok => ({
    method: opt.method || "GET",
    headers: Object.assign({ "Authorization":"Bearer " + tok, "Content-Type":"application/json", "Accept":"application/json",
                             "X-Sitzung": sitzung ? sitzung.token : "", "X-Standort": GERAET.standort ? String(GERAET.standort) : "" }, opt.headers || {}),
    body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined
  });
  let r = await netz(API_URL + pfad, baue(await holeJwt()));
  if(r.status === 401){ r = await netz(API_URL + pfad, baue(await holeJwt(true))); }
  const text = await r.text();
  let d = null;
  if(text){ try{ d = JSON.parse(text); }catch(e){ d = text; } }
  if(!r.ok){
    let m = d && typeof d === "object" ? (d.message || d.hint || d.details) : null;
    m = m || ("Datenbank: HTTP " + r.status);
    if(/Nicht angemeldet/.test(m) && sitzung){ sitzungEntfernen(sitzung.konto_id); throw new AbgemeldetFehler("Abgemeldet — bitte neu anmelden."); }
    if(/row-level security|permission denied/i.test(m)) m = "Keine Berechtigung für diese Änderung.";
    else if(/Could not find the function/i.test(m))
      m = "Die Datenbank kennt diese Funktion noch nicht (" + (String(pfad).match(/^\/rpc\/([a-z_0-9]+)/) || [, "?"])[1] + ") – Migration in Neon ausführen und danach Data API → „Refresh schema cache“.";
    else if(/duplicate key.*(artikel_pkey|stueck_pkey|rad_pkey)/i.test(m)) m = "Die Nummer ist schon vergeben (vielleicht an einem anderen Standort).";
    throw new Error(m);
  }
  return d;
}
const rpc   = (fn, args, sitzung) => rest("/rpc/" + fn, { method:"POST", body:args || {}, sitzung });
const neuIn = (tab, zeile) => rest("/" + tab, { method:"POST", body:zeile, headers:{ Prefer:"return=minimal" } });
const aendern = (tab, filter, felder) => rest("/" + tab + "?" + filter, { method:"PATCH", body:felder, headers:{ Prefer:"return=minimal" } });
const loeschen = (tab, filter) => rest("/" + tab + "?" + filter, { method:"DELETE", headers:{ Prefer:"return=minimal" } });

/** Für optionale Tabellen: fehlt die Tabelle (Migration noch nicht gelaufen) → null; Netzfehler brechen ab. */
function ohneTabelle(e){ if(e instanceof NetzFehler) throw e; return null; }
/** Hängt an jedes Ticket die Liste seiner Einzelstücke (t.stuecke). Gibt zurück,
    ob die Tabelle ticket_stueck da ist (Migration 12.0.0). */
async function stueckeAnTickets(tickets){
  if(!tickets.length){ const z = await rest("/ticket_stueck?limit=1").catch(ohneTabelle); return Array.isArray(z); }
  const z = await rest("/ticket_stueck?ticket_id=in.(" + tickets.map(t => t.id).join(",") + ")").catch(ohneTabelle);
  if(!Array.isArray(z)){ tickets.forEach(t => t.stuecke = t.stueck_nummer ? [t.stueck_nummer] : []); return false; }
  const sort = (a, b) => a.localeCompare(b, "de", { numeric:true });
  tickets.forEach(t => t.stuecke = z.filter(x => x.ticket_id === t.id).map(x => x.nummer).sort(sort));
  return true;
}
const STANDORT_SPALTEN = "id,name,kuerzel,aktiv,rg_empfaenger,rg_absender,rg_kopf,rg_fuss,rg_text,iban,bic,bank,zahlungsziel_tage,rad_vorlage,rad_stellen";
async function ladeAlles(){
  // Wer ist angemeldet, welche Rolle am Standort? (Sitzung abgelaufen → nächste Person oder Anmeldung)
  const ich = await rpc("ich");
  if(!ich){
    sitzungEntfernen(aktivKonto);
    if(aktiveSitzung()) return ladeAlles();
    ICH = null;
    throw new AbgemeldetFehler("Abgemeldet — bitte neu anmelden.");
  }
  // Mehrere Rollen je Konto (ab 18.0.0): ich() liefert dann „rollen“
  if(!Array.isArray(ich.rollen))
    throw new Error("Für 18.0.0 muss die Datenbank aktualisiert werden: db/migration_18.0.0.sql im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.");
  const sz = aktiveSitzung();
  Object.assign(sz, { name:ich.name, standorte:ich.standorte, pin_laenge:ich.pin_laenge, gesamt_admin:ich.gesamt_admin, sportler_id:ich.sportler_id });
  merkeSitzungen();
  if(!ich.rolle){
    const erst = (ich.standorte || [])[0];
    if(erst && erst.id !== GERAET.standort && GERAET.modus !== "werkstatt"){ GERAET.standort = erst.id; GERAET.standortName = erst.name; merkeGeraet(); return ladeAlles(); }
    ICH = null;
    throw new Error("Für den Standort " + (GERAET.standortName || "") + " hast du keinen Zugang.");
  }
  ICH = ich; bearbeiter = ich.name;
  const hier = (ich.standorte || []).find(x => x.id === GERAET.standort);
  if(hier && hier.name !== GERAET.standortName){ GERAET.standortName = hier.name; merkeGeraet(); }
  rollenKlassen();
  if(ich.rolle === "sportler") return ladeSportler();

  const tag = iso(heute());
  const q = [
    rest("/v_bestand?order=code"),
    rest("/artikel?order=code"),
    rest("/v_rad?order=id"),
    rest("/sportler?order=name"),
    rest("/stueck?order=nummer"),
    rest("/ticket?status=in.(offen,angenommen)&order=id"),
    rest("/v_koffer?order=ort,code"),
    rest("/termin?datum=gte." + tag + "&order=datum"),
    // Rad-Nummern-Vorlage (ab 19.0.0)
    rest("/standort?select=" + STANDORT_SPALTEN).catch(ohneTabelle),
    rest("/rechnung?order=id.desc&limit=100"),
    rest("/v_offene_posten?order=zeit"),
    rest("/zaehlung"),
    rest("/bestellung?erhalten_am=is.null&order=bestellt_am"),
    // Tags (ab 11.0.0). Fehlen die Tabellen noch (Migration nicht ausgeführt),
    // läuft die App ohne Tags weiter — nur Netzfehler brechen ab.
    rest("/tag?order=buchstabe,sortierung,name").catch(ohneTabelle),
    rest("/artikel_tag").catch(ohneTabelle),
    rest("/stueck_tag").catch(ohneTabelle),
    // Kategorie-Namen (ab 13.0.0). Fehlt die Tabelle, gelten die festen Namen im Code.
    rest("/kategorie?order=buchstabe").catch(ohneTabelle),
    // Lagerorte (ab 15.0.0)
    rest("/lagerort?order=reihenfolge,name").catch(ohneTabelle),
    rest("/v_bestand_ort").catch(ohneTabelle),
    // Bekleidung (ab 16.0.0)
    rest("/v_bestand_groesse").catch(ohneTabelle),
    rest("/v_ausgeliehen?order=seit.desc").catch(ohneTabelle)
  ];
  const [bestand, artikel, raeder, sportler, stueck, tickets, koffer, termine, standort, rechnungen, offenePosten, zaehlung, bestellungen, tags, artikelTags, stueckTags, kats, lagerorteRoh, bestandOrtRoh, groesseRoh, ausgeliehen] = await Promise.all(q);
  if(!Array.isArray(lagerorteRoh) || !Array.isArray(bestandOrtRoh))
    throw new Error("Für 15.0.0 muss die Datenbank aktualisiert werden: db/migration_15.0.0.sql im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.");
  if(!Array.isArray(groesseRoh) || !Array.isArray(ausgeliehen))
    throw new Error("Für 16.0.0 muss die Datenbank aktualisiert werden: db/migration_16.0.0.sql im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.");
  if(!Array.isArray(standort))
    throw new Error("Für 19.0.0 muss die Datenbank aktualisiert werden: db/migration_19.0.0.sql im SQL-Editor von Neon ausführen, danach Data API → „Refresh schema cache“.");
  const groesseBestand = {};   // { code: { ort: { groesse|"": menge } } }
  groesseRoh.forEach(z => { const c = groesseBestand[z.code] = groesseBestand[z.code] || {}; (c[z.ort] = c[z.ort] || {})[z.groesse || ""] = num(z.menge); });
  const bestandOrt = {};
  bestandOrtRoh.forEach(z => (bestandOrt[z.code] = bestandOrt[z.code] || {})[z.ort] = num(z.menge));
  const kofferAktiv = lagerorteRoh.filter(o => o.aktiv && o.art === "koffer").map(o => o.name);
  // Arbeitsschritte der offenen Tickets — offene und schon abgehakte
  verlaufCache = {};   // Rad-Verlauf beim nächsten Anzeigen neu holen
  ticketVerlauf = undefined;   // Ticket-Verlauf ebenso
  const positionen = tickets.length ? await rest("/ticket_position?ticket_id=in.(" + tickets.map(t => t.id).join(",") + ")&status=neq.storniert&order=id") : [];
  // Einzelstücke der Tickets (ab 12.0.0 beliebig viele). Fehlt die Tabelle noch
  // (Migration nicht ausgeführt), gilt das alte Feld stueck_nummer.
  const tsDa = await stueckeAnTickets(tickets);
  const mitTags = Array.isArray(tags) && Array.isArray(artikelTags) && Array.isArray(stueckTags);
  STANDORT = standort[0] || null;
  DB = { bestand, artikel, raeder, sportler, stueck, tickets, positionen, termine, rechnungen, offenePosten, zaehlung, bestellungen,
         koffer:koffer.filter(k => kofferAktiv.indexOf(k.ort) >= 0), lagerorte:lagerorteRoh, bestandOrt, groesseBestand, ausgeliehen,
         tags:mitTags ? tags : null, artikelTags:mitTags ? artikelTags : [], stueckTags:mitTags ? stueckTags : [], tsDa,
         kategorien:Array.isArray(kats) ? kats : null };
  stand = new Date();
  offline = false;
  try{ localStorage.setItem("wSnap", JSON.stringify({ stand:stand.toISOString(), DB, ICH, STANDORT, konto:aktivKonto, standort:GERAET.standort })); }catch(e){}
}

/* ---------------------------------------------------------------
   Nur frische Daten zeigen: während geladen wird, ist die Seite gesperrt.
----------------------------------------------------------------*/
function sperren(an){ app.classList.toggle("laedt", !!an); $("modal").classList.toggle("laedt", !!an); if(an) $("stand").textContent = "lädt…"; }

async function frischLaden(){
  sperren(true);
  try{
    await ladeAlles();
    render();
    sendeWarteschlange();
  }catch(e){
    if(e instanceof AbgemeldetFehler){ DB = null; ICH = null; render(); toast(e.message, true); return; }
    if(e instanceof NetzFehler){ offlineAnzeigen(); return; }
    if(!DB){ app.innerHTML = '<div class="fehlerbox">' + esc(e.message) + '</div><button class="btn" data-a="kontoMenue">Konto / Standort</button>'; }
    toast(e.message, true);
  }finally{ sperren(false); zeigeStand(); }
}

/** Jede Änderung: schreiben, danach alles frisch laden — erst dann ist die Anzeige wieder frei.
    Läuft schon eine, wird eine zweite nicht gestartet (Doppeltipp auf „Buchen“ bucht sonst doppelt). */
let aktionLaeuft = false;
async function aktion(fn, meldung){
  if(offline){ toast("Offline — Änderungen sind erst mit Netz möglich.", true); return; }
  if(aktionLaeuft){ toast("Moment — es wird noch gespeichert.", true); return; }
  if(werWahlFertig) return;
  if(!(await werMachtDas())) return;
  aktionLaeuft = true;
  sperren(true);
  let r, geschrieben = false;
  try{
    r = await fn();
    geschrieben = true;
    modalZu();
    await ladeAlles();
    render();
    if(meldung) toast(typeof meldung === "function" ? meldung(r) : meldung);
    return r;
  }catch(e){
    if(e instanceof AbgemeldetFehler){ modalZu(); DB = null; ICH = null; render(); toast(e.message, true); return; }
    if(e instanceof NetzFehler){
      offlineAnzeigen();
      if(geschrieben){
        // Gespeichert ist es, nur das Neuladen ging nicht mehr.
        modalZu();
        toast((meldung ? (typeof meldung === "function" ? meldung(r) : meldung) : "Gespeichert") + " — Anzeige ohne Netz nicht aktualisiert.");
        return r;
      }
      toast("Keine Verbindung — wahrscheinlich nicht gespeichert. Mit Netz prüfen, bevor du es nochmal buchst.", true);
      return;
    }
    toast(e.message, true);
    try{ await ladeAlles(); render(); }catch(x){ if(x instanceof AbgemeldetFehler){ DB = null; render(); } }
  }finally{ aktionLaeuft = false; sperren(false); zeigeStand(); }
}

function zeigeStand(){
  const st = GERAET.standortName ? GERAET.standortName + " · " : "";
  $("stand").textContent = st + (offline ? "offline" : (stand && DB ? "Stand " + uhr(stand) : ""));
}

/* ---------------------------------------------------------------
   Offline am Wettkampf: alter Stand nur mit rotem Balken,
   nur neue Tickets möglich — die werden nachgesendet.
----------------------------------------------------------------*/
function warteschlange(){ try{ return JSON.parse(localStorage.getItem("wQueue") || "[]"); }catch(e){ return []; } }
function speichereWarteschlange(q){ localStorage.setItem("wQueue", JSON.stringify(q)); }
/** Tickets, die beim Nachsenden abgelehnt wurden — bleiben auf dem Gerät, bis sie gesendet oder verworfen sind. */
function fehlerListe(){ try{ return JSON.parse(localStorage.getItem("wQueueFehler") || "[]"); }catch(e){ return []; } }
function speichereFehler(f){ localStorage.setItem("wQueueFehler", JSON.stringify(f)); }

/** Eindeutige Kennung je Ticket — die Datenbank legt jede Kennung nur einmal an. */
function neueId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0,8) + "-" + h.slice(8,12) + "-" + h.slice(12,16) + "-" + h.slice(16,20) + "-" + h.slice(20);
}
/** In die Warteschlange — passt sie mit Fotos nicht mehr in den Gerätespeicher, ohne Fotos. Rückgabe false = Fotos fehlen. */
function inWarteschlange(op){
  const ohne = x => x.p_client_id !== op.p_client_id;
  try{ speichereWarteschlange(warteschlange().filter(ohne).concat([op])); return true; }
  catch(e){
    const kurz = Object.assign({}, op); delete kurz._fotos;
    speichereWarteschlange(warteschlange().filter(ohne).concat([kurz]));
    return !(op._fotos && op._fotos.length);
  }
}

function offlineAnzeigen(){
  let snap = null;
  try{ snap = JSON.parse(localStorage.getItem("wSnap") || "null"); }catch(e){}
  if(!snap || snap.konto !== aktivKonto || snap.standort !== GERAET.standort || !snap.ICH){
    app.innerHTML = '<div class="fehlerbox">Keine Verbindung und kein gespeicherter Stand. Mit Netz einmal öffnen, dann klappt es auch offline.</div>';
    return;
  }
  DB = snap.DB; ICH = snap.ICH; STANDORT = snap.STANDORT || null; bearbeiter = ICH.name; rollenKlassen();
  stand = new Date(snap.stand); offline = true;
  render();
}
let sendetGerade = false;
/** Wartende Tickets nacheinander senden. Läuft nie doppelt; jedes Ticket trägt seine Kennung,
    sodass auch ein Nachsenden nach verlorener Antwort kein zweites Ticket erzeugt. */
async function sendeWarteschlange(){
  if(sendetGerade || offline || !warteschlange().length) return;
  sendetGerade = true;
  let gesendet = 0, abgelehnt = 0;
  try{
    for(;;){
      const q = warteschlange();
      if(!q.length) break;
      const op = q[0];
      if(!op.p_client_id){ op.p_client_id = neueId(); speichereWarteschlange(q); }   // aus 4.0.1 übrig
      try{
        await ticketSenden(op);
        gesendet++;
      }catch(e){
        if(e instanceof NetzFehler) break;            // bleibt stehen, später mit derselben Kennung
        const f = fehlerListe();
        f.push({ op, fehler:e.message, zeit:new Date().toISOString() });
        speichereFehler(f);
        abgelehnt++;
      }
      speichereWarteschlange(warteschlange().filter(x => x.p_client_id !== op.p_client_id));
    }
  }finally{ sendetGerade = false; }
  if(abgelehnt) toast(abgelehnt + " Ticket(s) wurden abgelehnt — siehe roter Balken.", true);
  else if(gesendet) toast(gesendet + " Ticket(s) nachgesendet");
  if(gesendet || abgelehnt){ try{ await ladeAlles(); }catch(e){} render(); zeigeStand(); }
}
function fehlerZeigen(){
  const f = fehlerListe();
  if(!f.length){ modalZu(); return; }
  let h = '<h3>Nicht angelegte Tickets</h3><p class="sub" style="margin-top:-6px">Diese Tickets wurden offline erfasst, beim Nachsenden aber abgelehnt. Sie liegen nur auf diesem Gerät.</p><div class="liste">';
  f.forEach(x => {
    const r = x.op.p_rad ? rad(x.op.p_rad) : null;
    const st = x.op.p_stuecke || (x.op.p_stueck ? [x.op.p_stueck] : []);
    const name = r ? (r.fahrer || r.bezeichnung) : st.length ? stueckeKurz(st) : (x.op.p_rad || "Allgemein");
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(name) + '</strong> · ' + esc(x.op.p_problem) +
         '<br><span class="sub" style="color:var(--sprint)">' + esc(x.fehler) + '</span></div>' +
         '<div class="knoepfe"><button class="btn small" data-a="fehlerNochmal" data-x="' + esc(x.op.p_client_id) + '">nochmal senden</button>' +
         '<button class="btn small" data-a="fehlerVerwerfen" data-x="' + esc(x.op.p_client_id) + '">verwerfen</button></div></div>';
  });
  h += '</div><button class="btn voll" style="margin-top:12px" data-a="modalZu">Schließen</button>';
  modal(h);
}
window.addEventListener("online", () => frischLaden());
window.addEventListener("offline", () => { if(DB){ offline = true; render(); zeigeStand(); } });

/* Beim Zurückkehren zur App frisch laden, wenn der Stand älter als eine Minute ist. */
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState !== "visible" || !DB) return;
  if(!stand || Date.now() - stand.getTime() > 60000) frischLaden();
});

/* ---------------------------------------------------------------
   Zugriff auf die Daten
----------------------------------------------------------------*/
const AUFWAND = { "klein":0, "mittel":1, "groß":5 };
/* Lagerorte kommen ab 15.0.0 aus der Datenbank (Mehr → Lagerorte). „Werkstatt“
   ist an jedem Standort der feste Hauptraum. Räume zusammen sind das Lager
   (daraus kommt „frei“), Koffer/Werkzeugkästen haben eine Packliste. */
const HAUPT = "Werkstatt";
const ORTE_ALT = [{ id:0, name:"Werkstatt", art:"raum", haupt:true, aktiv:true, reihenfolge:0 },
                  { id:0, name:"Koffer Bahn", art:"koffer", haupt:false, aktiv:true, reihenfolge:1 },
                  { id:0, name:"Koffer Straße", art:"koffer", haupt:false, aktiv:true, reihenfolge:2 }];
/** Lagerorte: Hauptraum, weitere Räume, dann Koffer — je in der eingestellten Reihenfolge. alle = auch deaktivierte. */
function lagerorte(alle){
  const l = (DB && Array.isArray(DB.lagerorte)) ? DB.lagerorte : ORTE_ALT;
  const rang = { raum:0, bekleidung:1, koffer:2 };
  return l.filter(o => alle || o.aktiv).slice().sort((a, b) =>
    (b.haupt ? 1 : 0) - (a.haupt ? 1 : 0) || (num(rang[a.art]) - num(rang[b.art])) ||
    num(a.reihenfolge) - num(b.reihenfolge) || a.name.localeCompare(b.name, "de"));
}
function orte(){ return lagerorte().map(o => o.name); }
function raumOrte(){ return lagerorte().filter(o => o.art === "raum").map(o => o.name); }
function kleiderOrte(){ return lagerorte().filter(o => o.art === "bekleidung").map(o => o.name); }
function kofferOrte(){ return lagerorte().filter(o => o.art === "koffer").map(o => o.name); }
function lagerort(name){ return ((DB && Array.isArray(DB.lagerorte)) ? DB.lagerorte : ORTE_ALT).find(o => o.name === name) || null; }
function istKoffer(name){ const o = lagerort(name); return !!o && o.art === "koffer"; }
/** Vorgabe in Formularen: der gerade gefilterte Raum, sonst die Werkstatt. */
function standardOrt(){ return view.lOrt && raumOrte().indexOf(view.lOrt) >= 0 ? view.lOrt : HAUPT; }

function sportlerName(id){ const s = (DB.sportler||[]).find(x => x.id === id); return s ? s.name : ""; }
function rad(id){ return (DB.raeder||[]).find(r => r.id === id) || null; }
function artikel(code){ return (DB.artikel||[]).find(a => a.code === code) || null; }
function bestand(code){ return (DB.bestand||[]).find(b => b.code === code) || null; }
function ticket(id){ return (DB.tickets||[]).find(t => t.id === id) || null; }
/** Offene Schritte eines Tickets (noch nicht abgehakt): Material ist reserviert. */
function positionen(tid){ return (DB.positionen||[]).filter(p => p.ticket_id === tid && p.status === "reserviert"); }
/** Alle Schritte eines Tickets — offen und abgehakt. */
function schritte(tid){ return (DB.positionen||[]).filter(p => p.ticket_id === tid && p.status !== "storniert"); }
function schrittFertig(p){ return p.status === "gebucht" || p.status === "erledigt"; }
function schrittName(p){ return p.code ? ((artikel(p.code) || {}).name || p.code) : (p.titel || "Schritt"); }
function stueckAm(radId){ return (DB.stueck||[]).filter(s => s.rad_id === radId); }
function stueckNr(nr){ return (DB.stueck||[]).find(s => s.nummer === nr) || null; }
/** Nummern der Einzelstücke, die direkt am Ticket hängen (ab 12.0.0 beliebig viele). */
function tStuecke(t){ return t.stuecke || (t.stueck_nummer ? [t.stueck_nummer] : []); }
/** Einzelstücke, die zu einem Ticket gehören: die am Rad und die des Tickets selbst. */
function ticketStuecke(t){
  const l = t.rad_id ? stueckAm(t.rad_id) : [];
  tStuecke(t).forEach(nr => { const s = stueckNr(nr); if(s && l.indexOf(s) < 0) l.push(s); });
  return l;
}
/** Mehrere Einzelstücke kurz: „L-209 VR Scheibe · Mavic“ bzw. „3× VR Scheibe · Mavic, L-205 HR Scheibe“. */
function stueckeKurz(nummern){
  if(nummern.length === 1) return stueckText(nummern[0]);
  const gr = {}, reihe = [];
  nummern.forEach(nr => { const s = stueckNr(nr), k = s ? s.typ + (s.marke ? " · " + s.marke : "") : nr;
                          if(!gr[k]){ gr[k] = []; reihe.push(k); } gr[k].push(nr); });
  return reihe.map(k => gr[k].length > 1 ? gr[k].length + "× " + k : stueckText(gr[k][0])).join(", ");
}
function pruefOffen(t){ return ticketStuecke(t).filter(s => s.zustand === "zu prüfen"); }
function stueckText(nr){ const s = stueckNr(nr); return s ? nr + " " + s.typ + (s.marke ? " · " + s.marke : "") : nr; }
/** Allgemeines Ticket: weder Rad noch Einzelstück (z. B. Werkstatt aufräumen, ab 14.3.0). */
function istAllgemein(t){ return !t.rad_id && !t.fahrer_id && !tStuecke(t).length; }
function wer(t){
  if(istAllgemein(t)) return "Allgemein";
  const f = t.fahrer_id ? sportlerName(t.fahrer_id) : "";
  if(f) return f;
  const r = t.rad_id ? rad(t.rad_id) : null;
  if(r) return r.fahrer || r.bezeichnung;
  const st = tStuecke(t);
  return st.length ? stueckeKurz(st) : (t.rad_id || "");
}
/** Zweite Zeile eines Tickets: Rad und ggf. Einzelstück. */
function ticketObjekt(t){
  if(istAllgemein(t)) return "ohne Rad · " + t.arbeitsort;
  const teile = [];
  if(t.rad_id) teile.push(radName(t.rad_id));
  const st = tStuecke(t);
  if(st.length && (t.rad_id || t.fahrer_id)) teile.push(st.length === 1 ? stueckText(st[0]) : st.join(", "));
  if(!t.rad_id && !t.fahrer_id) teile.push(st.length > 1 ? st.join(", ") : "Einzelstück");
  return teile.join(" · ");
}
/** Offenes Ticket zu einem Einzelstück (nur offene stehen in DB.tickets). */
function stueckTicket(nr){ return (DB.tickets||[]).find(t => tStuecke(t).indexOf(nr) >= 0) || null; }
function radName(id){ const r = rad(id); return r ? r.bezeichnung : id; }
/** Bestand eines Artikels an einem Ort (aus v_bestand_ort). */
function amOrt(b, ort){ const z = (DB.bestandOrt || {})[b.code]; return z ? num(z[ort]) : 0; }
/** Für offene Tickets mit diesem Arbeitsort reserviert (ohne das Ticket tid). */
function reserviertAm(code, ort, tid){
  let s = 0;
  (DB.positionen||[]).forEach(p => {
    if(p.code !== code || p.status !== "reserviert" || p.ticket_id === tid) return;
    const t = ticket(p.ticket_id);
    if(t && t.arbeitsort === ort) s += num(p.menge);
  });
  return s;
}
/* Bekleidung (ab 16.0.0): Artikel mit Größenliste, Bestand je Größe, Ausleihe an Sportler. */
function groessen(code){ const a = artikel(code); return a && Array.isArray(a.groessen) && a.groessen.length ? a.groessen : null; }
function hatGroessen(code){ return !!groessen(code); }
/** Bestand einer Größe an einem Ort ("" = ohne Größe). */
function amOrtGr(code, ort, gr){ const z = ((DB.groesseBestand || {})[code] || {})[ort]; return z ? num(z[gr || ""]) : 0; }
/** Spalten für die Größen-Tabelle: Größenliste + Altbestand ohne/mit entfernter Größe an diesem Ort (oder allen Orten). */
function groessenSpalten(code, ort){
  const g = (groessen(code) || []).slice(), c = (DB.groesseBestand || {})[code] || {};
  (ort ? [ort] : Object.keys(c)).forEach(o => Object.keys(c[o] || {}).forEach(k => { if(num(c[o][k]) !== 0 && g.indexOf(k) < 0) g.push(k); }));
  return g;
}
function grName(gr){ return gr ? gr : "ohne Größe"; }
/** Ausgeliehen: Summe je Artikel (und Größe), optional für einen Sportler. */
function verliehen(code, gr, sportlerId){
  return (DB.ausgeliehen || []).filter(z => z.code === code && (gr === undefined || (z.groesse || "") === gr) &&
                                            (sportlerId === undefined || z.sportler_id === sportlerId)).reduce((m, z) => m + num(z.menge), 0);
}
function ausgeliehenVon(sportlerId){ return (DB.ausgeliehen || []).filter(z => z.sportler_id === sportlerId && num(z.menge) > 0); }

/** Orte, an denen der Artikel liegt, in der Reihenfolge der Lagerorte: [[Ort, Menge], …] */
function verteilung(b){
  const z = (DB.bestandOrt || {})[b.code] || {}, bekannt = lagerorte(true).map(o => o.name);
  return bekannt.concat(Object.keys(z).filter(o => bekannt.indexOf(o) < 0)).filter(o => num(z[o]) !== 0).map(o => [o, num(z[o])]);
}

function istLeistung(code){ const a = artikel(code); return !!a && a.art === "Pauschale"; }

/** Was ist für dieses Ticket am Arbeitsort greifbar? Eigene Reservierungen zählen als greifbar.
    Leistungen (Pauschalen) haben keinen Bestand und sind immer greifbar. */
function greifbar(code, ort, tid){
  if(istLeistung(code)) return Infinity;
  const b = bestand(code);
  if(!b) return 0;
  if(istKoffer(ort)) return amOrt(b, ort);
  return amOrt(b, ort) - reserviertAm(code, ort, tid);
}
/** Codes, von denen für dieses Ticket am Arbeitsort nicht genug da ist — unabhängig von der Lieferzeit. */
function fehlend(t){
  const bedarf = {};
  positionen(t.id).forEach(p => { if(p.code) bedarf[p.code] = (bedarf[p.code] || 0) + num(p.menge); });
  return Object.keys(bedarf).filter(c => bedarf[c] > greifbar(c, t.arbeitsort, t.id));
}
/** Längste Lieferzeit der fehlenden Teile (0, wenn nichts fehlt oder keine Lieferzeit eingetragen ist). */
function beschaffung(t){
  return fehlend(t).reduce((max, c) => Math.max(max, num((artikel(c) || {}).lieferzeit_tage)), 0);
}
function puffer(t){
  if(t.naechstmoeglich) return null;
  const bis = tageBis(t.soll_fertig);
  if(bis === null) return null;
  return bis - (AUFWAND[t.aufwand] || 0) - beschaffung(t);
}
function pufferText(t){
  if(t.naechstmoeglich) return { txt:"sofort", farbe:"var(--sprint)" };
  const p = puffer(t);
  if(p === null) return { txt:"—", farbe:"var(--ink-2)" };
  return { txt:p + " T", farbe: p <= 1 ? "var(--sprint)" : p <= 4 ? "var(--warn)" : "var(--ok)" };
}
function sortiert(list){
  return list.slice().sort((a,b) => {
    if(a.naechstmoeglich !== b.naechstmoeglich) return a.naechstmoeglich ? -1 : 1;
    if(a.naechstmoeglich) return a.id - b.id;
    const pa = puffer(a), pb = puffer(b);
    if(pa === null && pb === null) return a.id - b.id;
    if(pa === null) return 1;
    if(pb === null) return -1;
    return pa - pb;
  });
}
function offeneTickets(){ return DB.tickets || []; }

/** Warnungen: anstehende Rennen, deren Koffer unvollständig ist. */
function kofferWarnungen(){
  const out = [];
  (DB.termine||[]).forEach(t => {
    const tage = tageBis(t.datum);
    if(tage === null || tage < 0 || tage > 10 || !t.koffer) return;
    const fehlt = (DB.koffer||[]).filter(k => k.ort === t.koffer && num(k.fehlt) > 0);
    if(fehlt.length) out.push({ termin:t, tage, fehlt });
  });
  return out;
}

/* ===============================================================
   Rahmen
   ===============================================================*/
function render(){
  $("ver").textContent = APP_VERSION;
  if((anm && !anm.imModal) || !aktiveSitzung() || !GERAET.standort){ anmeldungZeigen(); return; }
  if(!DB) return;
  const sp = rolle() === "sportler";
  $("tabs").hidden = sp;
  $("wer").hidden = false; $("scanBtn").hidden = sp;
  $("wer").textContent = werText();
  if(sp){ renderBanner(); app.innerHTML = sportlerView(); zeigeStand(); return; }
  if(view.tab === "neu" && !darf("arbeiten")) view.tab = "tickets";
  const reiter = view.tab === "neu" ? "tickets" : view.tab;   // "Neu" gehört zu Tickets
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === reiter)));
  renderBanner();
  const v = view.tab;
  app.innerHTML =
    v === "neu"      ? neuView() :
    v === "material" ? materialView() :
    v === "raeder"   ? raederView() :
    v === "mehr"     ? mehrView() :
    (view.ticket ? detailView(view.ticket) : boardView());
  zeigeStand();
}
function renderBanner(){
  let h = "";
  if(offline){
    const q = warteschlange().length;
    h += '<div class="banner rot">Offline — Stand von ' + (stand ? stand.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "?") +
         '. Die Anzeige kann veraltet sein. Neue Tickets werden gespeichert und nachgesendet' + (q ? ' (' + q + ' wartend)' : '') + '.</div>';
  }
  const abgelehnt = fehlerListe().length;
  if(abgelehnt){
    h += '<div class="banner rot">' + abgelehnt + ' offline erfasste(s) Ticket(s) konnten nicht angelegt werden. ' +
         '<button class="btn small" data-a="fehlerZeigen" style="margin-left:6px">ansehen</button></div>';
  }
  kofferWarnungen().forEach(w => {
    h += '<div class="banner gelb"><strong>' + esc(w.termin.name) + '</strong> ' +
         (w.tage === 0 ? 'heute' : w.tage === 1 ? 'morgen' : 'in ' + w.tage + ' Tagen') +
         ' — im ' + esc(w.termin.koffer) + ' fehlen ' + w.fehlt.length + ' Positionen: ' +
         esc(w.fehlt.slice(0,4).map(k => zahl(k.fehlt) + "× " + k.name).join(", ")) + (w.fehlt.length > 4 ? " …" : "") +
         ' <button class="btn small" data-a="kofferAuf" data-x="' + esc(w.termin.koffer) + '" style="margin-left:6px">Koffer öffnen</button></div>';
  });
  $("banner").innerHTML = h;
}

/* ---------------------------------------------------------------
   Standort-Kürzel ausblenden (ab 19.1.0): Alle Nummern tragen intern das
   Kürzel des Standorts (HGW-HSG-TR-BR-0042, SN-B-101). Angezeigt und auf
   Etiketten als Text gedruckt wird die Nummer ohne das eigene Kürzel
   (HSG-TR-BR-0042, B-101). Im QR-Code, in data-x, in Eingabefeldern, im
   Export und in der Datenbank bleibt die volle Nummer, damit die Zuordnung
   zum Standort fest bleibt. Umgesetzt als ein Durchgang über die Textknoten
   (start.js beobachtet die Seite), damit keine Anzeige vergessen wird.
----------------------------------------------------------------*/
let kuerzelMuster = null, kuerzelMusterFuer = "";
function kuerzelRegex(){
  const k = typeof kuerzel === "function" ? kuerzel() : "";
  if(!/^[A-Z]{2,3}$/.test(k)) return null;
  if(k !== kuerzelMusterFuer){
    // nur ganze Nummern: Kürzel-, dann Teile aus A–Z/0–9, letzte endet auf einer Ziffer
    kuerzelMuster = new RegExp("(^|[^A-Za-z0-9-])" + k + "-((?:[A-Z0-9]+-)*[A-Z0-9]*[0-9])(?![A-Za-z0-9-])", "g");
    kuerzelMusterFuer = k;
  }
  return kuerzelMuster;
}
const KUERZEL_NICHT_IN = { TEXTAREA:1, SCRIPT:1, STYLE:1, INPUT:1 };
/** Entfernt das eigene Kürzel aus den Textknoten unter root (nur Anzeige). */
function kuerzelAusblenden(root){
  const re = kuerzelRegex(); if(!re || !root) return;
  const pruefe = t => {
    const el = t.parentNode;
    if(!el || KUERZEL_NICHT_IN[el.nodeName] || (el.closest && el.closest("[contenteditable],textarea"))) return;
    re.lastIndex = 0;
    if(!re.test(t.nodeValue)) return;
    t.nodeValue = t.nodeValue.replace(re, "$1$2");
  };
  if(root.nodeType === 3){ pruefe(root); return; }
  if(root.nodeType !== 1 || KUERZEL_NICHT_IN[root.nodeName]) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while((n = w.nextNode())) pruefe(n);
}

/* ---------------------------------------------------------------
   Modal
----------------------------------------------------------------*/
function modal(html){ $("modal").innerHTML = '<div class="overlay" data-a="modalHintergrund"><div class="sheet">' + html + '</div></div>'; }
function modalZu(){ scanStopp(); $("modal").innerHTML = ""; }
