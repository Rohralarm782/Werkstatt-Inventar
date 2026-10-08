/* js/scanner.js — Scanner (ZXing, fest eingebaut in lib/zxing.min.js).
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ---------------------------------------------------------------
   Scanner (ZXing, fest eingebaut)
----------------------------------------------------------------*/
let leser = null;
async function scanStart(ziel){
  modal('<h3>Scannen</h3><div class="scanbox"><video id="cam" playsinline muted></video><div class="reticle"></div></div>' +
        '<button class="btn voll" data-a="modalZu">Abbrechen</button>');
  try{
    // TRY_HARDER: sucht viele Bildzeilen ab statt nur ~15 um die Mitte — nötig für Thermodruck mit
    // ausgefransten Strichkanten. Nur die Formate, die hier vorkommen (spart Rechenzeit).
    const F = ZXing.BarcodeFormat, hinweise = new Map();
    hinweise.set(ZXing.DecodeHintType.TRY_HARDER, true);
    hinweise.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.DATA_MATRIX]);
    leser = new ZXing.BrowserMultiFormatReader(hinweise, 300);
    leser.decode = scanBildLesen;
    let fertig = false;
    // Rückkamera mit höherer Auflösung (Standard wären 640 × 480) — für feine Striche schmaler Etiketten
    const kamera = { video:{ facingMode:"environment", width:{ ideal:1280 }, height:{ ideal:720 } } };
    await leser.decodeFromConstraints(kamera, "cam", erg => {
      if(!erg || fertig) return;
      fertig = true;
      const code = erg.getText().trim();
      modalZu(); piep(true);
      scanTreffer(ziel, code);
    });
  }catch(e){ modalZu(); toast("Kamera nicht verfügbar: " + e.message, true); }
}
/* Ein Kamerabild lesen — ersetzt leser.decode (ZXing ruft es in seiner Scan-Schleife auf; this = leser).
   Abwechselnd normal und um 90° gedreht: Strichcodes liest ZXing nur mit senkrechten Strichen, und seine
   eingebaute Drehung (TRY_HARDER) versagt in dieser Version beim Videobild. Gelesen wird der mittlere
   Ausschnitt (80 % × 80 %), dort liegt der Rahmen — weniger Rechenzeit je Bild. */
let scanLw = null, scanGedreht = false;
function scanBildLesen(video){
  const W = video.videoWidth, H = video.videoHeight;
  if(!W || !H) throw new ZXing.NotFoundException();
  const aw = Math.round(W * 0.8), ah = Math.round(H * 0.8), ax = Math.round((W - aw) / 2), ay = Math.round((H - ah) / 2);
  scanGedreht = !scanGedreht;
  if(!scanLw) scanLw = document.createElement("canvas");
  const c = scanLw;
  c.width = scanGedreht ? ah : aw; c.height = scanGedreht ? aw : ah;
  const ctx = c.getContext("2d", { willReadFrequently:true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if(scanGedreht){ ctx.translate(ah, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(video, ax, ay, aw, ah, 0, 0, aw, ah);
  const bild = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c, false)));
  return this.decodeBitmap(bild);
}
function scanStopp(){ try{ if(leser) leser.reset(); }catch(e){} leser = null; }
function scanTreffer(ziel, code){
  // QR-Code eines Rads enthält einen Link (…?rad=BR-01)
  const mRad = /[?&]rad=([^&#]+)/.exec(code);
  if(mRad) code = decodeURIComponent(mRad[1]);
  // Etikett ohne Standort-Kürzel (z. B. HSG-TR-SR-0042): mit Kürzel suchen, wenn es das gibt
  if(!artikel(code) && !rad(code) && !stueckNr(code)){
    const m = mitKuerzel(code);
    if(artikel(m) || rad(m) || stueckNr(m)) code = m;
  }
  // Codes tragen das Kürzel des Standorts; Etiketten anderer Standorte nicht verwechseln
  const fremd = /^([A-Z]{2,3})-[A-Z]{1,3}-[0-9]+$/.exec(code);
  if(fremd && kuerzel() && fremd[1] !== kuerzel() && !artikel(code) && !rad(code) && !stueckNr(code)){
    const st = ((aktiveSitzung() || {}).standorte || []).find(x => x.kuerzel === fremd[1]);
    piep(false); toast("Das Etikett gehört zu " + (st ? st.name : "einem anderen Standort (" + fremd[1] + ")") + ".", true); return;
  }
  if(!artikel(code) && !rad(code) && !stueckNr(code) && /^[A-Z]{1,3}-[0-9]+$/.test(code)) code = mitKuerzel(code);
  // Scan-Knopf oben: wirkt dort, wo man gerade ist
  if(ziel === "kontextNeu") ziel = artikel(code) ? "neuMaterial" : "neuRad";
  if(ziel === "kontextTicket") ziel = artikel(code) ? "ticketMaterial" : "global";
  if(ziel === "global") return scanErgebnis(code);
  if(mRad && ziel !== "neuRad" && ziel !== "neuStueck"){ piep(false); toast("Das ist der QR-Code von Rad " + code + " — oben mit dem Scan-Knopf scannen.", true); return; }
  if(ziel === "neuStueck" || (ziel === "neuRad" && stueckNr(code) && !rad(code))){
    if(!stueckNr(code)){ piep(false); toast("Unbekanntes Einzelstück: " + code, true); return; }
    neu.wahlSuche = ""; if(neuStueckWaehlen(code, true)) toast(code + " gewählt"); render(); return;
  }
  if(ziel === "neuRad"){
    const r = rad(code) || (DB.raeder||[]).find(x => x.rahmennummer === code);
    if(!r){ piep(false); toast("Unbekanntes Rad: " + code, true); return; }
    radImNeuen(r.id); neu.wahlSuche = ""; render(); toast("Rad: " + (r.fahrer || r.bezeichnung)); return;
  }
  const a = artikel(code);
  if(ziel === "inventur"){
    if(!a || a.art === "Pauschale" || !a.aktiv){ piep(false); toast("Kein zählbarer Lagerartikel: " + code, true); return; }
    let el = document.querySelector('[data-c="invZahl"][data-x^="' + code + '|"]');
    if(!el){ invAnsicht = { filter:"alle", buchstabe:"" }; view.suche = ""; render(); el = document.querySelector('[data-c="invZahl"][data-x^="' + code + '|"]'); }
    if(el){ el.scrollIntoView({ block:"center" }); el.focus(); try{ el.select(); }catch(e){} }
    return;
  }
  if(!a){ piep(false); toast("Kein Artikel: " + code, true); return; }
  if((ziel === "neuMaterial" || ziel === "ticketMaterial") && istWMat(code)){ piep(false); toast(a.name + " ist Werkstattmaterial — wird nicht an Tickets gebucht.", true); return; }
  if(ziel === "neuMaterial"){ neuMaterial(code); return; }
  if(ziel === "ticketMaterial"){ reservieren(code); return; }
  artikelMenue(code);
}
/** Scan-Knopf oben: im Ticket bzw. beim neuen Ticket landet ein Artikel dort, in der Inventur wird gezählt — sonst „was ist das?“. */
function scanGlobal(){
  if(view.tab === "material" && view.mat === "inventur" && inv) return scanStart("inventur");
  if(view.tab === "neu") return scanStart("kontextNeu");
  if(view.tab === "tickets" && view.ticket && ticket(view.ticket)) return scanStart("kontextTicket");
  scanStart("global");
}
function scanErgebnis(code){
  const r = rad(code) || (DB.raeder||[]).find(x => x.rahmennummer === code);
  const st = !r && stueckNr(code), a = !r && !st && artikel(code);
  if(a) return artikelMenue(code);
  if(!r && !st){ piep(false); toast("Unbekannter Code: " + code, true); return; }
  let h = '<span class="lbl">Erkannt: ' + (r ? "Rad" : "Einzelstück") + '</span>';
  if(r){
    const tk = (DB.tickets||[]).filter(t => t.rad_id === r.id);
    h += '<h3 style="margin:0">' + esc(r.fahrer || r.bezeichnung) + '</h3><p class="sub" style="margin:2px 0 12px">' + esc(r.id + " · " + r.bezeichnung) + (tk.length ? ' · ' + tk.length + ' offene' + (tk.length === 1 ? 's Ticket' : ' Tickets') : '') + '</p>';
    h += '<div style="display:grid;gap:8px"><button class="btn rot" data-a="ticketRad" data-x="' + esc(r.id) + '">Problem melden · neues Ticket</button>' +
         '<button class="btn" data-a="radAuf" data-x="' + esc(r.id) + '">Zur Rad-Seite</button>';
  } else {
    const ar = st.rad_id ? rad(st.rad_id) : null;
    h += '<h3 style="margin:0">' + esc(st.nummer + " · " + st.typ) + '</h3><p class="sub" style="margin:2px 0 12px">' + esc([st.marke, ar ? "am " + (ar.fahrer ? ar.bezeichnung + " (" + ar.fahrer + ")" : ar.bezeichnung) : st.ort, st.zustand].filter(Boolean).join(" · ")) + '</p>';
    h += '<div style="display:grid;gap:8px"><button class="btn rot" data-a="ticketStueck" data-x="' + esc(st.nummer) + '">Problem melden · neues Ticket</button>' +
         '<button class="btn" data-a="teilZeigen" data-x="' + esc(st.nummer) + '">Ort / Zustand ändern</button>' +
         (ar ? '<button class="btn" data-a="radAuf" data-x="' + esc(ar.id) + '">Zum Rad</button>' : '');
  }
  piep(true);
  modal(h + '<button class="btn" data-a="modalZu">Schließen</button></div>');
}
