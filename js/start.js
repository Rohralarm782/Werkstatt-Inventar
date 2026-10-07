/* js/start.js — Start: globale Ereignisse (Klick, Eingabe, Tasten) und Programmstart.
   Wird als letzte Datei geladen.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

document.addEventListener("click", ev => {
  const tab = ev.target.closest(".tab");
  if(tab){ A.tab(tab.dataset.tab); return; }
  if(ev.target.closest("#wer")){ kontoMenue(); return; }
  if(ev.target.closest("#scanBtn")){ scanGlobal(); return; }
  const el = ev.target.closest("[data-a]");
  if(!el || el.disabled) return;
  if(!aktionErlaubt(el.dataset.a)){ toast("Dafür fehlt die Berechtigung.", true); return; }
  const f = A[el.dataset.a];
  if(f) f(el.dataset.x, el, ev);
});
/* Texteingaben: laufend mitschreiben, ohne neu zu zeichnen (Fokus bleibt). */
document.addEventListener("input", ev => {
  const el = ev.target, c = el.dataset && el.dataset.c;
  if(c === "suche"){
    C.suche(el.value);
    const pos = el.selectionStart; render();
    const n = document.querySelector('[data-c="suche"]'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(e){} }
    return;
  }
  if(c === "nProblem" || c === "nAnlass") C[c](el.value);
  if(c === "nrVorschau") vorschauNummer();
  if(c === "aGroessen") grBestandFelder();
  if(c === "radNrVorschau") radNrVorschau();
  if(c === "nrBuch" || c === "nrKatName") C[c](el.value, el.dataset.x, el);
  if(c === "nWahlSuche"){ neu.wahlSuche = el.value; const l = $("wahlListe"); if(l) l.innerHTML = wahlListe(); }
  if(c === "tsSuche"){ tsSuche = el.value; const t = ticket(view.ticket), l = $("tsListe"); if(l && t) l.innerHTML = tsListe(t); }
});
/* Inventur: Enter übernimmt die Zahl und springt zur nächsten Zeile. */
document.addEventListener("keydown", ev => {
  const el = ev.target;
  if(ev.key !== "Enter" || !el.dataset || el.dataset.c !== "invZahl") return;
  ev.preventDefault();
  const code = el.dataset.x;
  invSetzen(code, el.value);
  invWeiter(code);
});
/* Auswahlfelder und abgeschlossene Eingaben: sofort übernehmen. */
document.addEventListener("change", ev => {
  const el = ev.target, c = el.dataset && el.dataset.c;
  if(!c || c === "suche" || c === "nProblem") return;
  if(c === "nAnlass") return;
  if(!eingabeErlaubt(c)){ toast("Dafür fehlt die Berechtigung.", true); render(); return; }
  const f = C[c];
  if(f) f(el.value, el.dataset.x, el);
});

/* Standort-Kürzel in der Anzeige ausblenden (siehe core.js): alles, was neu
   in die Seite kommt — Ansichten, Fenster, Meldungen, Druckbereich. */
new MutationObserver(liste => {
  liste.forEach(m => {
    if(m.type === "characterData") kuerzelAusblenden(m.target);
    else m.addedNodes.forEach(n => kuerzelAusblenden(n));
  });
}).observe(document.body, { childList:true, subtree:true, characterData:true });

/* ===============================================================
   Start
   ===============================================================*/
/** Aufruf über den QR-Code am Rad (…?rad=BR-01): direkt ein neues Ticket für dieses Rad. */
function radAusLink(){
  const id = new URLSearchParams(location.search).get("rad");
  if(!id || !DB || offline && !rolle()) return;
  try{ history.replaceState(null, "", location.pathname); }catch(e){}
  ticketFuerRad(id);
}
function ticketFuerRad(id){
  const r = rad(id);
  if(rolle() === "sportler"){ if(r) spProblemForm(id); else toast("Das Rad " + id + " gehört nicht zu dir.", true); return; }
  if(!darf("arbeiten")){ toast("Tickets legen Werkstatt und Trainer an.", true); return; }
  if(!r){ toast("Unbekanntes Rad: " + id, true); return; }
  neuStart(); neu.rad = r.id;
  view.tab = "neu"; view.ticket = null; render(); window.scrollTo(0,0);
  toast("Neues Ticket für " + (r.fahrer || r.bezeichnung));
}

async function start(){
  $("ver").textContent = APP_VERSION;
  einladungAusLink();
  if(anm || !aktiveSitzung() || !GERAET.standort){ render(); return; }
  app.innerHTML = '<div class="leer">Lädt…</div>';
  $("stand").textContent = "lädt…";
  try{
    await holeJwt(true);
    await ladeAlles();
    render();
    radAusLink();
    sendeWarteschlange();
  }catch(e){
    if(e instanceof AbgemeldetFehler){ DB = null; render(); toast(e.message, true); return; }
    if(e instanceof NetzFehler){ offlineAnzeigen(); if(DB){ render(); radAusLink(); } zeigeStand(); return; }
    app.innerHTML = '<div class="fehlerbox">' + esc(e.message) + '</div><button class="btn" data-a="kontoMenue">Konto / Standort</button>';
  }
  zeigeStand();
}

start();
