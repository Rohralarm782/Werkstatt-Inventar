/* tools/push-morgen.js — Morgenlauf für die Benachrichtigungen (ab 20.2.0).
   Läuft über GitHub Actions (.github/workflows/push-morgen.yml) alle 30 Minuten
   zwischen 7 und 18:30 Uhr (Berlin), angestoßen von cron-job.org über einen
   …/dispatches-Aufruf (ab 20.5.0). Schickt jedem, dessen Uhrzeit (07:00–18:00)
   erreicht ist, höchstens eine Nachricht pro Standort und Tag.

   Damit App und Nachricht nie unterschiedlich rechnen, lädt der Lauf den Code
   der App selbst (js/core.js … js/push.js) in eine abgeschottete Umgebung,
   meldet sich mit einer kurzen Sitzung (15 Minuten, push_sitzung) für die
   jeweilige Person an und lädt über die Data API genau das, was sie in der App
   sieht. Puffer, Werktage, Fehlteile und Bestellliste kommen so aus denselben
   Funktionen wie in der App.

   Umgebung:
     NEON_DATABASE_URL   Verbindung zur Neon-Datenbank (GitHub-Secret)
     VAPID_PRIVATE_KEY   privater Push-Schlüssel (GitHub-Secret)
     TZ=Europe/Berlin    (setzt der Workflow) — „heute“ wie in der App
   Zum Testen:
     PUSH_TROCKEN=1      nichts senden und nichts als erledigt markieren, nur anzeigen
     PUSH_TEST_NAME=…    sofort an diese Person senden (alle ihre Standorte), unabhängig
                         von Uhrzeit und „heute schon gesendet“; markiert nichts
     PUSH_JETZT="2026-10-09 07:30"   Uhrzeit (Berlin) vorgeben
   Abhängigkeiten (installiert der Workflow): pg, web-push */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..");
const APP_URL = process.env.APP_URL || "https://rohralarm782.github.io/Werkstatt-Inventar/";
// Reihenfolge wie in index.html, ohne lib/zxing.min.js (Scanner/Etiketten) und start.js (Programmstart)
const APP_DATEIEN = ["core", "tickets", "lager", "etiketten", "inventur", "inventar", "verwaltung", "scanner", "aktionen", "konto", "push"]
  .map(n => path.join(WURZEL, "js", n + ".js"));
const MAX_TICKETS = 4, MAX_BESTELLEN = 3;
const TROCKEN = process.env.PUSH_TROCKEN === "1";
const TEST_NAME = (process.env.PUSH_TEST_NAME || "").trim();

/* ---------- Zeit in Berlin ---------- */
function berlinJetzt(){
  if(process.env.PUSH_JETZT){
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(process.env.PUSH_JETZT);
    if(!m) throw new Error("PUSH_JETZT bitte als JJJJ-MM-TT HH:MM");
    return { tag:m[1], uhr:m[2], ts:m[1] + " " + m[2] + ":00" };
  }
  const t = {};
  new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" })
    .formatToParts(new Date()).forEach(p => t[p.type] = p.value);
  const tag = t.year + "-" + t.month + "-" + t.day, uhr = t.hour + ":" + t.minute;
  return { tag, uhr, ts:tag + " " + uhr + ":00" };
}

/* ---------- Die App ohne Browser ---------- */
/** Platzhalter für alles aus dem Browser, was beim Laden angefasst wird (document, Elemente …). */
function attrappe(){
  const f = function(){};
  return new Proxy(f, {
    get(z, k){
      if(k === Symbol.toPrimitive) return () => "";
      if(k === "then") return undefined;      // kein Promise vortäuschen
      if(k === "length") return 0;
      return attrappe();
    },
    set(){ return true; },
    apply(){ return attrappe(); },
    construct(){ return attrappe(); },
    has(){ return true; }
  });
}
function speicher(){
  const m = new Map();
  return { getItem:k => m.has(k) ? m.get(k) : null, setItem:(k, v) => m.set(k, String(v)), removeItem:k => m.delete(k), clear:() => m.clear() };
}
let quellen = null;
function neueApp(){
  if(!quellen) quellen = APP_DATEIEN.map(f => ({ f, code:fs.readFileSync(f, "utf8") }));
  // Wie aus der App: mit Origin der Seite (Neon Auth kann Anfragen ohne Herkunft ablehnen)
  const herkunft = new URL(APP_URL).origin;
  const appFetch = (url, opt) => {
    opt = Object.assign({}, opt || {});
    const h = new Headers(opt.headers || {});
    if(!h.has("Origin")) h.set("Origin", herkunft);
    opt.headers = h;
    return fetch(url, opt);
  };
  const kontext = {
    console, fetch:appFetch, URL, URLSearchParams, Headers, Request, Response, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, atob, btoa, crypto:globalThis.crypto,
    TextEncoder, TextDecoder, structuredClone,
    document:attrappe(), history:attrappe(), NodeFilter:attrappe(), MutationObserver:attrappe(),
    localStorage:speicher(), sessionStorage:speicher(),
    navigator:{ userAgent:"push-morgen (node)", maxTouchPoints:0 },
    location:{ search:"", pathname:"/", protocol:"https:", origin:"https://push-morgen.invalid", href:"https://push-morgen.invalid/" },
    addEventListener(){}, removeEventListener(){}, matchMedia:() => ({ matches:false }),
    isSecureContext:true
  };
  kontext.window = kontext; kontext.self = kontext; kontext.globalThis = kontext;
  vm.createContext(kontext);
  quellen.forEach(q => vm.runInContext(q.code, kontext, { filename:q.f }));
  return kontext;
}
/* Wird in der App-Umgebung ausgeführt: dieselben Funktionen wie in der App. */
const AUSWERTUNG = String(function morgenAuswertung(opt){
  const ich = bearbeiter;
  let liste = offeneTickets();
  if(!opt.alle_tickets) liste = liste.filter(t => t.status === "offen" || (t.status === "angenommen" && t.uebernommen_von === ich));
  const dringend = [], bald = [];
  sortiert(liste).forEach(t => {
    if(t.naechstmoeglich){ dringend.push({ t, p:null }); return; }
    const p = puffer(t);
    if(p === null) return;
    if(p <= 0) dringend.push({ t, p });
    else if(p <= 2) bald.push({ t, p });
  });
  const re = kuerzelRegex();
  const ohneKuerzel = s => { if(!re) return s; re.lastIndex = 0; return String(s).replace(re, "$1$2"); };
  const zeile = x => {
    const t = x.t, was = t.rad_id || tStuecke(t)[0] || "";
    let problem = String(t.problem || "").split("\n")[0].trim();
    if(problem.length > 40) problem = problem.slice(0, 39).trim() + "…";
    const wann = x.p === null ? "sofort" : "Puffer " + String(x.p).replace("-", "−") + " T";
    return ohneKuerzel((was ? was + " · " : "") + problem) + " – " + wann;
  };
  const bestellen = opt.bestellen ? bestellBedarf().filter(x => x.rest > 0).map(x => x.a.name) : [];
  return {
    ich, standort_id: ICH && ICH.standort_id, rolle: ICH && ICH.rolle, rollen: ICH && ICH.rollen,
    dringend: opt.dringend ? dringend.map(zeile) : [],
    bald: opt.bald ? bald.map(zeile) : [],
    bestellen
  };
});

/** Lädt die Daten so, wie die Person sie sieht, und wertet sie aus. */
async function auswerten(e, token){
  const app = neueApp();
  vm.runInContext(
    "GERAET.standort = " + Number(e.standort_id) + "; GERAET.standortName = " + JSON.stringify(e.standort_name) + "; GERAET.modus = 'handy';" +
    "SITZUNGEN = [{ token: " + JSON.stringify(token) + ", bis: new Date(Date.now() + 15 * 60000).toISOString(), konto_id: " + Number(e.konto_id) + " }];" +
    "aktivKonto = " + Number(e.konto_id) + ";" + AUSWERTUNG, app);
  await vm.runInContext("ladeAlles()", app);
  const r = vm.runInContext("morgenAuswertung(" + JSON.stringify({ dringend:e.dringend, bald:e.bald, bestellen:e.bestellen, alle_tickets:e.alle_tickets }) + ")", app);
  if(Number(r.standort_id) !== Number(e.standort_id)) throw new Error("Standort " + e.standort_name + " für " + e.konto_name + " nicht erreichbar");
  return JSON.parse(JSON.stringify(r));
}

/** Nachricht bauen; null = nichts anstehend */
function nachricht(e, r){
  const teile = [];
  if(r.dringend.length) teile.push(r.dringend.length + " dringend");
  if(r.bald.length) teile.push(r.bald.length + " bald");
  if(r.bestellen.length) teile.push(r.bestellen.length + " zu bestellen");
  if(!teile.length) return null;
  const tickets = r.dringend.concat(r.bald);
  const zeilen = tickets.slice(0, MAX_TICKETS);
  if(tickets.length > MAX_TICKETS) zeilen.push("+ " + (tickets.length - MAX_TICKETS) + " weitere");
  if(r.bestellen.length)
    zeilen.push("Bestellen: " + r.bestellen.slice(0, MAX_BESTELLEN).join(", ") + (r.bestellen.length > MAX_BESTELLEN ? " …" : ""));
  const ziel = tickets.length ? "tickets" : "bestellen";
  return {
    title: (e.mehrere ? e.standort_name + ": " : "") + teile.join(" · "),
    body: zeilen.join("\n"),
    url: APP_URL + "?ziel=" + ziel + (e.mehrere ? "&standort=" + e.standort_id : ""),
    tag: "morgen-" + e.standort_id
  };
}

/* ---------- Ablauf ---------- */
async function main(){
  const jetzt = berlinJetzt();
  // Außerhalb des Fensters die Datenbank gar nicht erst wecken (bis 19:00 als Reserve für verspätete Läufe)
  if(!TEST_NAME && (jetzt.uhr < "07:00" || jetzt.uhr >= "19:00")){
    console.log("Berlin " + jetzt.tag + " " + jetzt.uhr + " — außerhalb 07:00–19:00, nichts zu tun.");
    return 0;
  }
  if(!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL fehlt (GitHub → Settings → Secrets and variables → Actions).");
  const { Client } = require("pg");
  const webpush = require("web-push");
  const pub = (/const PUSH_PUBLIC_KEY = "([A-Za-z0-9_-]+)"/.exec(fs.readFileSync(path.join(WURZEL, "js", "push.js"), "utf8")) || [])[1];
  if(!pub) throw new Error("PUSH_PUBLIC_KEY in js/push.js nicht gefunden");
  if(!TROCKEN){
    if(!process.env.VAPID_PRIVATE_KEY) throw new Error("VAPID_PRIVATE_KEY fehlt (GitHub → Settings → Secrets and variables → Actions).");
    webpush.setVapidDetails(APP_URL, pub, process.env.VAPID_PRIVATE_KEY.trim());
  }

  const db = new Client({ connectionString:process.env.NEON_DATABASE_URL });
  await db.connect();
  let fehler = 0;
  try{
    let liste;
    if(TEST_NAME){
      // Test: alle Standorte dieser Person, egal ob Uhrzeit/Tag passen oder heute schon gesendet wurde
      liste = (await db.query(
        "select e.konto_id, k.name as konto_name, e.standort_id, st.name as standort_name, " +
        "e.dringend and push_darf(e.konto_id, e.standort_id, 'tickets') as dringend, e.bald and push_darf(e.konto_id, e.standort_id, 'tickets') as bald, " +
        "e.bestellen and push_darf(e.konto_id, e.standort_id, 'bestellen') as bestellen, e.alle_tickets, $2::date as tag, " +
        "(select jsonb_agg(jsonb_build_object('id', g.id, 'endpoint', g.endpoint, 'p256dh', g.p256dh, 'auth', g.auth)) from push_geraet g where g.konto_id = e.konto_id) as geraete " +
        "from push_einstellung e join konto k on k.id = e.konto_id and k.aktiv join standort st on st.id = e.standort_id and st.aktiv " +
        "where lower(k.name) = lower($1) and push_darf(e.konto_id, e.standort_id, 'tickets')",
        [TEST_NAME, jetzt.tag])).rows.filter(e => e.geraete);
      liste.forEach(e => e.mehrere = liste.filter(x => x.konto_id === e.konto_id).length > 1);
      console.log("Test an " + TEST_NAME + ": " + liste.length + " Standort(e)");
    }else{
      liste = (await db.query("select * from push_faellig($1::timestamp)", [jetzt.ts])).rows;
      console.log("Berlin " + jetzt.tag + " " + jetzt.uhr + " — dran: " + liste.length);
    }

    const tokens = {};
    for(const e of liste){
      const wer = e.konto_name + " @ " + e.standort_name;
      try{
        if(!tokens[e.konto_id]) tokens[e.konto_id] = (await db.query("select push_sitzung($1) as t", [e.konto_id])).rows[0].t;
        const r = await auswerten(e, tokens[e.konto_id]);
        let n = nachricht(e, r);
        if(!n && TEST_NAME) n = { title:(e.mehrere ? e.standort_name + ": " : "") + "Test: heute steht nichts an", body:"So kommen die Morgen-Nachrichten an — an Tagen ohne Dringendes kommt sonst keine.", url:APP_URL + "?ziel=tickets", tag:"morgen-" + e.standort_id };
        if(!n) console.log("· " + wer + ": nichts anstehend");
        else{
          console.log("· " + wer + ": " + n.title + (TROCKEN ? "\n    " + n.body.split("\n").join("\n    ") + "\n    → " + n.url : ""));
          if(!TROCKEN){
            for(const g of (e.geraete || [])){
              try{
                await webpush.sendNotification({ endpoint:g.endpoint, keys:{ p256dh:g.p256dh, auth:g.auth } }, JSON.stringify(n), { TTL:6 * 3600, urgency:"normal" });
                await db.query("select push_zugestellt($1, true)", [g.id]);
              }catch(x){
                const weg = x.statusCode === 404 || x.statusCode === 410;
                console.log("    Gerät " + g.id + ": " + (weg ? "abgemeldet, wird entfernt" : "nicht zugestellt (" + (x.statusCode || x.message) + ")"));
                await db.query("select push_zugestellt($1, false, $2)", [g.id, weg]);
              }
            }
          }
        }
        if(!TROCKEN && !TEST_NAME) await db.query("select push_erledigt($1, $2, $3::date)", [e.konto_id, e.standort_id, e.tag]);
      }catch(x){
        fehler++;
        console.log("✗ " + wer + ": " + (x && x.message || x));
      }
    }
  }finally{
    try{ const n = (await db.query("select push_aufraeumen() as n")).rows[0].n; if(n) console.log("Kurz-Sitzungen entfernt: " + n); }catch(x){ console.log("Aufräumen: " + x.message); }
    await db.end();
  }
  return fehler ? 1 : 0;
}

if(require.main === module){
  main().then(code => process.exit(code), e => { console.error("✗ " + (e && e.message || e)); process.exit(1); });
}
module.exports = { main, neueApp, auswerten, nachricht, berlinJetzt };
