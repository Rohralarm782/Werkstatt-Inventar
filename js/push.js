/* js/push.js — Morgen-Benachrichtigungen (ab 20.2.0): Mehr → Benachrichtigungen,
   dieses Gerät an-/abmelden, Einstellungen je Standort, Probe-Nachricht,
   Sprung aus einer Nachricht in die App (…?ziel=tickets|bestellen&standort=ID).
   Verschickt werden die Nachrichten vom Morgenlauf (.github/workflows/push-morgen.yml,
   tools/push-morgen.js), nicht von der App.
   Teil der App, geladen von index.html (Reihenfolge dort beachten: nach aktionen.js
   und konto.js, vor start.js). */

/* Öffentlicher Push-Schlüssel (VAPID). Der private Schlüssel steht nur in den
   GitHub-Secrets (VAPID_PRIVATE_KEY). Bei einem neuen Schlüsselpaar müssen alle
   Geräte Benachrichtigungen einmal aus- und wieder einschalten. */
const PUSH_PUBLIC_KEY = "BHMpFn0SaM0LQd9jgLaSAAonZyNcrXphuXLr4RJqq3KtNKnWIPMmSXvlsiJ6dMLwHFucofeoEl9gLRQGYwhAX0I";
const PUSH_TAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];   // ISO 1–7
const PUSH_STANDARD = { uhrzeit:"07:30", tage:[1,2,3,4,5], dringend:true, bald:true, bestellen:false, alle_tickets:false };

let pushCache;              // undefined | "laedt" | "fehler" | Antwort von push_meine
let pushCacheFuer = "";     // Konto|Standort, für das pushCache gilt
let pushHier = null;        // Push-Abo dieses Browsers (Endpoint) oder null
let pushLaeuft = false;

function pushSchluessel(){ return String(aktivKonto) + "|" + String(GERAET.standort); }
function pushDaten(){ return (pushCache && typeof pushCache === "object" && pushCacheFuer === pushSchluessel()) ? pushCache : null; }

/* ---------- Was kann dieses Gerät? ---------- */
function istIOS(){ const u = navigator.userAgent; return /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1); }
function istInstalliert(){ return navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches); }
function pushTechnik(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext !== false; }
/** null = geht; sonst Text, warum nicht */
function pushHindernis(){
  if(istIOS() && !istInstalliert())
    return "Auf iPhone und iPad gehen Benachrichtigungen nur aus der installierten App: in Safari Teilen → „Zum Home-Bildschirm“, die App dort öffnen und hier einschalten. (In der installierten App einmal neu anmelden.)";
  if(!pushTechnik()) return "Dieser Browser kann keine Push-Nachrichten empfangen. Auf Android Chrome verwenden, auf dem iPhone die installierte App.";
  if(Notification.permission === "denied")
    return "Benachrichtigungen sind für die Werkstatt-App blockiert. In den Einstellungen des Handys (bzw. des Browsers) für diese Seite erlauben, dann die App neu öffnen.";
  return null;
}
function geraetName(){
  const u = navigator.userAgent;
  const os = /iPhone/.test(u) ? "iPhone" : (/iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)) ? "iPad" : /Android/.test(u) ? "Android" :
             /Windows/.test(u) ? "Windows" : /Mac/.test(u) ? "Mac" : /Linux/.test(u) ? "Linux" : "Gerät";
  const br = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return os + (br && os !== "iPhone" && os !== "iPad" ? " · " + br : "") + (istInstalliert() ? " (App)" : "");
}

/* ---------- Service Worker ---------- */
function swRegistrieren(){
  if(!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return Promise.resolve(null);
  return navigator.serviceWorker.register("sw.js").catch(() => null);
}
async function swBereit(){
  await swRegistrieren();
  return navigator.serviceWorker.ready;
}
async function aktuellesAbo(){
  if(!pushTechnik()) return null;
  try{
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? await reg.pushManager.getSubscription() : null;
  }catch(e){ return null; }
}
function b64UrlZuBytes(s){
  const b = (s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const r = atob(b), out = new Uint8Array(r.length);
  for(let i = 0; i < r.length; i++) out[i] = r.charCodeAt(i);
  return out;
}

/* ---------- Laden ---------- */
async function ladePush(){
  if(pushCache === "laedt") return;
  pushCache = "laedt"; pushCacheFuer = pushSchluessel();
  try{
    const [d, abo] = await Promise.all([rpc("push_meine"), aktuellesAbo()]);
    pushCache = d; pushHier = abo ? abo.endpoint : null;
  }catch(e){
    if(e instanceof AbgemeldetFehler){ pushCache = undefined; DB = null; ICH = null; render(); toast(e.message, true); return; }
    pushCache = "fehler"; toast(e.message, true);
  }
  render();
}
/** Änderung ausführen, dann neu laden. Läuft nie doppelt. */
async function pushTun(fn, meldung){
  if(offline){ toast("Offline — erst wieder mit Netz.", true); return; }
  if(pushLaeuft) return;
  pushLaeuft = true; sperren(true);
  try{
    const m = await fn();
    pushCache = undefined;
    await ladePush();
    if(m !== false && (m || meldung)) toast(typeof m === "string" ? m : meldung);
  }catch(e){
    if(e instanceof AbgemeldetFehler){ DB = null; ICH = null; render(); toast(e.message, true); return; }
    toast(e.message || String(e), true);
    pushCache = undefined; render();
  }finally{ pushLaeuft = false; sperren(false); zeigeStand(); }
}

/* ---------- Anzeige ---------- */
function pushTageText(tage){
  const t = (tage || []).slice().sort((a, b) => a - b), s = t.join(",");
  if(!t.length) return "keine Tage";
  if(s === "1,2,3,4,5,6,7") return "täglich";
  if(s === "1,2,3,4,5") return "Mo–Fr";
  return t.map(d => PUSH_TAGE[d - 1]).join(", ");
}
function pushKategorien(e, d){
  const n = [e.dringend, e.bald, e.bestellen && d.darf_bestellen].filter(Boolean).length;
  return n ? n + (n === 1 ? " Kategorie" : " Kategorien") : "keine Kategorie";
}
/** Untertitel unter Mehr */
function pushMehrText(){
  const d = pushDaten();
  if(!d || !d.einstellung) return "Morgens aufs Handy: dringende und baldige Tickets" + (darf("manager") ? ", Bestellen" : "");
  if(!d.geraete.length) return "Kein Gerät eingeschaltet";
  const e = d.einstellung;
  return e.uhrzeit + " · " + pushTageText(e.tage) + " · " + pushKategorien(e, d);
}
function pushWann(z){ if(!z) return ""; const d = new Date(z); return (iso(d) === iso(heute()) ? "heute" : de(z)) + " " + uhr(d); }

function pushVerw(){
  if(pushCacheFuer !== pushSchluessel() && pushCache !== "laedt") pushCache = undefined;
  if(pushCache === undefined){ ladePush(); return '<div class="leer">Lädt…</div>'; }
  if(pushCache === "laedt") return '<div class="leer">Lädt…</div>';
  if(pushCache === "fehler") return '<div class="leer">Konnte nicht geladen werden. <button class="btn small" data-a="geheMehr" data-x="benachrichtigungen">nochmal</button></div>';
  const d = pushCache;
  if(!d.darf_tickets) return '<div class="leer">Benachrichtigungen gibt es für Werkstatt-Manager und Trainer/Mechaniker.</div>';
  const e = Object.assign({}, PUSH_STANDARD, { bestellen:d.darf_bestellen }, d.einstellung || {});
  const hier = d.geraete.find(g => g.endpoint === pushHier);
  const hindernis = pushHindernis();
  let h = '';

  // Dieses Gerät
  h += '<div class="card pz-stapel">';
  if(hier){
    h += '<div class="row"><span class="sp"><strong>Dieses Gerät</strong><br><span class="sub">' + esc(hier.name) + ' · seit ' + de(hier.angelegt) + '</span></span><span class="chip ok">an</span></div>' +
         '<div class="row wrapr" style="gap:8px"><button class="btn small" data-a="pushAus">Ausschalten</button><button class="btn small" data-a="pushProbe">Probe-Nachricht</button></div>';
  }else if(hindernis){
    h += '<div class="row"><span class="sp"><strong>Dieses Gerät</strong></span><span class="chip grau">aus</span></div><div class="pz-hinweis">' + esc(hindernis) + '</div>';
  }else{
    h += '<div class="row"><span class="sp"><strong>Dieses Gerät</strong><br><span class="sub">bekommt noch keine Benachrichtigungen</span></span><span class="chip grau">aus</span></div>' +
         '<button class="btn primary" data-a="pushEin">Auf diesem Gerät einschalten</button>' +
         '<span class="sub">Das Handy fragt einmal, ob die App Benachrichtigungen senden darf — bitte „Erlauben“.</span>';
  }
  h += '</div>';

  // Wann
  let opt = "";
  for(let m = 7 * 60; m <= 12 * 60; m += 15){
    const t = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    opt += '<option value="' + t + '"' + (t === e.uhrzeit ? " selected" : "") + '>' + t + ' Uhr</option>';
  }
  h += '<h2 class="sec">Wann</h2><div class="card pz-stapel">' +
       '<div><label class="lbl" for="pzUhr">Uhrzeit</label><select id="pzUhr">' + opt + '</select>' +
       '<span class="sub">07:00–12:00 im Viertelstunden-Takt. Die Nachricht kommt bis ca. 15 Minuten später.</span></div>' +
       '<div><span class="lbl">Tage</span><div class="pz-tage" role="group" aria-label="Tage">' +
       PUSH_TAGE.map((t, i) => '<button type="button" data-a="pushTag" data-x="' + (i + 1) + '" aria-pressed="' + (e.tage.indexOf(i + 1) >= 0) + '">' + t + '</button>').join("") +
       '</div><span class="sub">Tippen zum An- und Abwählen.</span></div></div>';

  // Was
  const wahl = (id, an, titel, text, typ, name) => '<label class="pz-wahl"><input type="' + (typ || "checkbox") + '" id="' + id + '"' + (name ? ' name="' + name + '"' : '') + (an ? ' checked' : '') + '>' +
    '<span class="txt"><strong>' + titel + '</strong>' + (text ? '<span class="sub">' + text + '</span>' : '') + '</span></label>';
  h += '<h2 class="sec">Was</h2><div class="card">' +
       wahl("pzDring", e.dringend, "Dringende Tickets", "„sofort“ und Puffer 0 Tage oder weniger (auch überfällig)") +
       wahl("pzBald", e.bald, "Baldige Tickets", "Puffer 1–2 Tage") +
       (d.darf_bestellen ? wahl("pzBest", e.bestellen, "Bestellen", "Bestellliste ist nicht leer · nur Werkstatt-Manager") : '') +
       '</div>';
  h += '<h2 class="sec">Welche Tickets</h2><div class="card">' +
       wahl("pzMeine", !e.alle_tickets, "Meine + noch nicht übernommene", "", "radio", "pzWelche") +
       wahl("pzAlle", e.alle_tickets, "Alle am Standort", "", "radio", "pzWelche") + '</div>';
  const nSt = ((aktiveSitzung() || {}).standorte || []).filter(s => (s.rollen || [s.rolle]).some(r => r === "manager" || r === "trainer")).length;
  h += '<p class="sub" style="margin:8px 2px 0">Gilt für ' + esc(GERAET.standortName || "diesen Standort") + '.' +
       (nSt > 1 ? ' Andere Standorte stellst du dort ein (Standort wechseln); sind mehrere eingeschaltet, steht der Standort in der Nachricht.' : '') +
       ' Steht nichts an, kommt keine Nachricht.</p>';
  h += '<div style="margin-top:12px"><button class="btn primary voll" data-a="pushSpeichern">Speichern</button></div>';

  // Geräte
  h += '<h2 class="sec">Meine Geräte</h2><div class="card liste">';
  if(!d.geraete.length) h += '<div class="sub">Noch kein Gerät eingeschaltet.</div>';
  d.geraete.forEach(g => {
    const dieses = g.endpoint === pushHier;
    h += '<div class="eintrag"><div class="txt"><strong>' + esc(g.name) + '</strong>' + (dieses ? ' <span class="chip grau">dieses</span>' : '') + '<br><span class="sub">' +
         (g.zugestellt ? 'zuletzt zugestellt ' + pushWann(g.zugestellt) : 'eingeschaltet ' + de(g.angelegt)) +
         (g.fehler ? ' · <span style="color:var(--warn)">' + g.fehler + '× nicht zugestellt</span>' : '') + '</span></div>' +
         (dieses ? '' : '<button class="btn small" data-a="pushWeg" data-x="' + g.id + '">Entfernen</button>') + '</div>';
  });
  h += '</div><p class="sub">Ein Gerät, das du nicht mehr benutzt, hier entfernen. Abgemeldete Geräte verschwinden beim nächsten Versand von selbst.</p>';
  return h;
}

/* ---------- Aktionen ---------- */
Object.assign(A, {
  pushTag: (x, el) => { el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")); },
  pushEin: () => pushTun(async () => {
    const h = pushHindernis(); if(h) throw new Error(h);
    const erlaubnis = await Notification.requestPermission();
    if(erlaubnis !== "granted") throw new Error("Ohne Erlaubnis keine Benachrichtigungen. In den Einstellungen des Handys für die App erlauben.");
    const reg = await swBereit();
    let abo = await reg.pushManager.getSubscription();
    if(!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64UrlZuBytes(PUSH_PUBLIC_KEY) });
    const j = abo.toJSON();
    await rpc("push_geraet_anmelden", { p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_name:geraetName() });
    return "Benachrichtigungen auf diesem Gerät an";
  }),
  pushAus: () => pushTun(async () => {
    const abo = await aktuellesAbo();
    if(abo){
      await rpc("push_geraet_entfernen", { p_endpoint:abo.endpoint });
      try{ await abo.unsubscribe(); }catch(e){}
    }
    return "Benachrichtigungen auf diesem Gerät aus";
  }),
  pushWeg: x => pushTun(async () => { await rpc("push_geraet_entfernen", { p_id:Number(x) }); return "Gerät entfernt"; }),
  pushProbe: async () => {
    try{
      const reg = await swBereit();
      await reg.showNotification("Probe-Nachricht", {
        body: "So kommen die Morgen-Nachrichten an. Antippen öffnet die Tickets.",
        icon: "icons/icon-192.png", badge: "icons/badge-72.png", tag: "probe", data: { url: "./?ziel=tickets" }
      });
      toast("Probe-Nachricht gesendet — kommt sie nicht, Benachrichtigungen in den Handy-Einstellungen prüfen.");
    }catch(e){ toast("Probe-Nachricht ging nicht: " + (e.message || e), true); }
  },
  pushSpeichern: () => {
    const tage = Array.from(document.querySelectorAll('.pz-tage [aria-pressed="true"]')).map(b => Number(b.dataset.x));
    const an = id => { const el = $(id); return !!(el && el.checked); };
    const d = pushDaten();
    pushTun(async () => {
      await rpc("push_einstellung_setzen", { p_uhrzeit:wert("pzUhr"), p_tage:tage, p_dringend:an("pzDring"), p_bald:an("pzBald"),
                                             p_bestellen:an("pzBest"), p_alle_tickets:an("pzAlle") });
      if(!tage.length || !(an("pzDring") || an("pzBald") || an("pzBest"))) return "Gespeichert — ohne Tag oder Kategorie kommt keine Nachricht";
      if(d && !d.geraete.length) return "Gespeichert — noch auf einem Gerät einschalten";
      return "Gespeichert";
    });
  }
});

/* ---------- Aus einer Nachricht in die App ---------- */
/** Vor dem ersten Laden: Nachricht für einen anderen Standort → dorthin wechseln. */
function standortAusLink(){
  const id = Number(new URLSearchParams(location.search).get("standort"));
  if(!id || id === GERAET.standort) return;
  const st = ((aktiveSitzung() || {}).standorte || []).find(s => s.id === id);
  if(st){ GERAET.standort = st.id; GERAET.standortName = st.name; merkeGeraet(); }
}
/** Nach dem Laden: zu den Tickets bzw. zur Bestellliste. */
function zielAusLink(){
  const p = new URLSearchParams(location.search), ziel = p.get("ziel");
  if(!ziel) return;
  try{ history.replaceState(null, "", location.pathname); }catch(e){}
  if(!DB || rolle() === "sportler") return;
  modalZu();
  if(ziel === "bestellen"){ view.tab = "material"; view.mat = "bestellen"; view.koffer = null; }
  else { view.tab = "tickets"; view.ticket = null; view.filter = "offen"; view.suche = ""; }
  render(); window.scrollTo(0,0);
}

swRegistrieren();
if("serviceWorker" in navigator){
  // Fallback, wenn der Service Worker die offene App nicht selbst umleiten kann
  navigator.serviceWorker.addEventListener("message", ev => {
    if(ev.data && ev.data.art === "ziel" && typeof ev.data.url === "string" && ev.data.url.indexOf(location.origin) === 0) location.href = ev.data.url;
  });
}
