/* js/etiketten.js — Etiketten: Vorlagen, QR-Codes/Barcodes, Druck.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Etiketten — Vorlagen (rechteckig/rund, A4-Bogen oder Einzeletikett),
   eigene Vorlagen nach den Maßen auf der Packung, Testseite mit Umrissen,
   und eine Druckliste zum Sammeln, damit Bögen voll werden.
   QR-Codes erzeugt das eingebaute ZXing; Barcodes (Code 128) erzeugt
   barcode128() unten selbst — nichts wird nachgeladen.
   ===============================================================*/
// Maße in mm. seite: "A4" (Bogen, Raster sp × ze) oder "einzeln" (ein Etikett je Seite, z. B. Etikettendrucker)
const ETIKETT_VORLAGEN = [
  { id:"a4_70x37",  name:"A4 · 3 × 8 · 70 × 37 mm",            form:"rechteck", seite:"A4", b:70,   h:37,   sp:3, ze:8, ro:0,     li:0,    ah:0,   av:0 },
  { id:"a4_63x38",  name:"A4 · 3 × 7 · 63,5 × 38,1 mm",        form:"rechteck", seite:"A4", b:63.5, h:38.1, sp:3, ze:7, ro:15.15, li:7.25, ah:2.5, av:0 },
  { id:"rolle_62x29", name:"Etikettendrucker · 62 × 29 mm",     form:"rechteck", seite:"einzeln", b:62, h:29 }
];
function eigeneVorlagen(){ try{ return JSON.parse(localStorage.getItem("wEtikettVorlagen") || "[]"); }catch(e){ return []; } }
function eigeneSpeichern(l){ localStorage.setItem("wEtikettVorlagen", JSON.stringify(l)); }
function alleVorlagen(){ return ETIKETT_VORLAGEN.concat(eigeneVorlagen()); }
function vorlage(id){ return alleVorlagen().find(v => v.id === id) || ETIKETT_VORLAGEN[0]; }
function vorlageText(v){
  return v.name + (v.eigen ? " (eigene)" : "");
}
function felderJeSeite(v){ return v.seite === "A4" ? v.sp * v.ze : 1; }

let etikettAuftrag = null, etikettQuelle = null;
function appUrl(){ return location.origin + location.pathname; }
function radQrText(id){ return appUrl() + "?rad=" + encodeURIComponent(id); }
function etikettStueck(s){ return { typ:"stueck", id:s.nummer, qr:s.nummer, bc:s.nummer, titel:s.nummer, zeile:s.typ + (s.marke ? " · " + s.marke : "") }; }
function etikettArtikel(a){ return { typ:"artikel", id:a.code, qr:a.code, bc:a.code, titel:a.code, zeile:a.name }; }
function etikettRad(r){ return { typ:"rad", id:r.id, qr:radQrText(r.id), bc:r.id, titel:r.id, zeile:r.bezeichnung, fuss:"Problem? Scannen → Ticket" }; }
/** Eintrag der Druckliste → Etikett mit aktuellen Daten (oder null, wenn es das nicht mehr gibt). */
function etikettAus(e){
  if(e.typ === "stueck"){ const s = stueckNr(e.id); return s ? etikettStueck(s) : null; }
  if(e.typ === "artikel"){ const a = artikel(e.id); return a ? etikettArtikel(a) : null; }
  if(e.typ === "rad"){ const r = rad(e.id); return r ? etikettRad(r) : null; }
  return null;
}

/* ---- Druckliste: sammeln, später zusammen drucken (liegt auf dem Gerät) ---- */
function druckliste(){ try{ return JSON.parse(localStorage.getItem("wDruckliste") || "[]"); }catch(e){ return []; } }
function drucklisteSpeichern(l){ localStorage.setItem("wDruckliste", JSON.stringify(l)); }
function drucklisteAnzahl(){ return druckliste().reduce((m, e) => m + (e.n || 1), 0); }
function aufDruckliste(items, n){
  const l = druckliste();
  items.forEach(it => {
    const da = l.find(e => e.typ === it.typ && e.id === it.id);
    if(da) da.n = Math.max(da.n || 1, n || 1); else l.push({ typ:it.typ, id:it.id, n:n || 1 });
  });
  drucklisteSpeichern(l);
  return l;
}

function etikettDialog(items, titel, mitKopien, quelle){
  if(!items.length) return;
  etikettAuftrag = items; etikettQuelle = quelle || null;
  const vid = localStorage.getItem("wEtikettVorlage") || ETIKETT_VORLAGEN[0].id, v = vorlage(vid);
  let h = '<h3>' + esc(titel || "Etiketten drucken") + '</h3><p class="sub" style="margin-top:-6px">' + items.length + ' Etikett' + (items.length === 1 ? '' : 'en') + ': ' +
          esc(items.slice(0, 6).map(x => x.titel).join(", ") + (items.length > 6 ? " …" : "")) + '</p>';
  h += '<div class="feld"><span class="lbl">Etiketten-Art</span><div class="row" style="gap:8px"><select id="etVorlage" data-c="etVorlage" style="flex:1">' +
       alleVorlagen().map(x => '<option value="' + esc(x.id) + '"' + (x.id === v.id ? " selected" : "") + '>' + esc(vorlageText(x)) + '</option>').join("") +
       '</select><button class="btn small" data-a="vorlagenVerwalten">eigene …</button></div></div>';
  h += '<div class="feld"><span class="lbl">Code</span><div class="row" style="gap:16px">' +
       [["qr","QR-Code"],["bar","Barcode (für schmale Etiketten)"]].map(o => '<label class="row" style="gap:6px"><input type="radio" name="etCode" value="' + o[0] + '"' + (codeArt() === o[0] ? " checked" : "") + '> ' + o[1] + '</label>').join("") +
       '</div><label class="row" style="gap:6px;margin-top:6px"><input type="checkbox" id="etKurz"' + (barKurz() ? " checked" : "") + '> Barcode ohne Standort-Kürzel (dickere Striche, besser lesbar)</label></div>';
  h += '<div class="grid2"><div class="feld" id="etStartFeld"' + (v.seite === "A4" ? "" : " hidden") + '><span class="lbl">Erstes freies Feld</span>' +
       '<input type="number" id="etStart" value="1" min="1" max="' + felderJeSeite(v) + '" inputmode="numeric"></div>';
  h += mitKopien ? feld("Anzahl je Etikett", "etKopien", 1, "number", ' min="1" max="50" inputmode="numeric"') : '';
  h += '</div><p class="sub">Bei einem angefangenen Bogen das erste freie Feld angeben — gezählt wird zeilenweise von links oben. ' +
       '„als Bild“: für Etikettendrucker mit Handy-App — vorher eine eigene Etiketten-Art „einzeln“ in der Größe des Bands anlegen.</p>';
  if(quelle === "druckliste") h += '<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="etLeeren" checked> Druckliste danach leeren</label>';
  h += '<div class="row wrapr" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>';
  if(quelle !== "druckliste") h += '<button class="btn" data-a="etSammeln">auf Druckliste</button>';
  h += '<button class="btn" data-a="etBilder" title="für Etikettendrucker mit Handy-App">als Bild</button>';
  h += '<button class="btn primary" data-a="etDrucken">Drucken</button></div>';
  modal(h);
}

/** Gewählte Code-Art auf diesem Gerät: "qr" oder "bar". */
function codeArt(){ try{ return localStorage.getItem("wEtikettCode") === "bar" ? "bar" : "qr"; }catch(e){ return "qr"; } }
/** Barcode ohne eigenes Standort-Kürzel? (Gerät merkt es sich; Standard: ja.) Kürzerer Inhalt = dickere Striche.
    Der Scanner ergänzt das Kürzel des eigenen Standorts (scanTreffer). Der QR-Code behält immer die volle Nummer. */
function barKurz(){ try{ return localStorage.getItem("wEtikettKurz") !== "0"; }catch(e){ return true; } }
/** Text, der im Barcode steht. */
function barText(it){ return barKurz() ? anzeigeNummer(it.bc) : String(it.bc); }

/* ---- Barcode Code 128 (liest der Scanner der App, ebenso jedes Handscanner-Gerät) ----
   Muster je Zeichenwert 0–106 als Strich-/Lückenbreiten in Modulen; 106 = Stopp. */
const C128 = ("212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132," +
  "221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311," +
  "112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224," +
  "111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211," +
  "411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112").split(",");
/** Zeichenwerte für text: Zeichensatz B, längere Ziffernfolgen platzsparend in Zeichensatz C. Wirft bei Zeichen außerhalb ASCII 32–126. */
function code128Werte(text){
  const t = String(text);
  if(!t.length) throw new Error("Leerer Code");
  for(const ch of t){ const c = ch.charCodeAt(0); if(ch.length !== 1 || c < 32 || c > 126) throw new Error("Zeichen nicht für Barcode geeignet: " + ch); }
  const ziffern = i => { let n = 0; while(i + n < t.length && t[i + n] >= "0" && t[i + n] <= "9") n++; return n; };
  // Lohnt C? am Anfang/Ende ab 4 Ziffern, mittendrin ab 6 (sonst kostet der Wechsel mehr, als er spart)
  const lohntC = (i, n) => n >= ((i === 0 || i + n === t.length) ? 4 : 6) || (i === 0 && n === t.length && n >= 2 && n % 2 === 0);
  const w = []; let satz = null, i = 0;
  while(i < t.length){
    const n = ziffern(i);
    if(lohntC(i, n)){
      // bei ungerader Anzahl die erste Ziffer noch in B (am Anfang: letzte Ziffer ans Ende in B)
      let paare = Math.floor(n / 2);
      if(n % 2 && i > 0){ if(satz !== "B"){ w.push(satz ? 100 : 104); satz = "B"; } w.push(t.charCodeAt(i) - 32); i++; }
      w.push(satz === null ? 105 : 99); satz = "C";
      for(let k = 0; k < paare; k++){ w.push(Number(t.substr(i, 2))); i += 2; }
    } else {
      if(satz !== "B"){ w.push(satz === null ? 104 : 100); satz = "B"; }
      w.push(t.charCodeAt(i) - 32); i++;
    }
  }
  let summe = w[0];
  for(let k = 1; k < w.length; k++) summe += w[k] * k;
  return w.concat([summe % 103, 106]);
}
/** Breiten (Strich, Lücke, Strich, …) aller Module ohne Ruhezone. */
function code128Breiten(text){ return code128Werte(text).map(v => C128[v]).join("").split("").map(Number); }
/** Anzahl Module inkl. Ruhezone 10 links und rechts. */
function code128Module(text){ return code128Breiten(text).reduce((m, x) => m + x, 0) + 20; }
function barSvg(text, cache){
  const k = "bar:" + text;
  if(cache[k]) return cache[k];
  const br = code128Breiten(text), n = br.reduce((m, x) => m + x, 0) + 20;
  let x = 10, r = "";
  br.forEach((b, i) => { if(i % 2 === 0) r += '<rect x="' + x + '" y="0" width="' + b + '" height="1"/>'; x += b; });
  return (cache[k] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" width="100%" height="100%" fill="#000">' + r + '</svg>');
}
/** Breite eines Strich-Moduls in mm, wenn text auf breiteMm gedruckt wird. Unter ca. 0,19 mm wird es für Kameras schwierig. */
function barModulMm(text, breiteMm){ return breiteMm / code128Module(text); }
/** Nutzbare Breite für den Barcode auf Vorlage v (wie in barcodeInhalt). */
function barBreiteMm(v){
  const b = Number(v.b), h = Number(v.h);
  if(v.form === "rund") return Math.min(b, h) * 0.74;
  return b - 2 * Math.min(2, b * 0.05, h * 0.08);
}
/** Gezeigte Nummer ohne das eigene Standort-Kürzel (wie in der Anzeige, siehe core.js). */
function anzeigeNummer(t){
  const re = typeof kuerzelRegex === "function" ? kuerzelRegex() : null;
  if(!re) return String(t);
  re.lastIndex = 0;
  return String(t).replace(re, "$1$2");
}
/** Maße eines Barcode-Etiketts in mm (für Druck und Bild gleich). */
function barLayout(it, v){
  const b = Number(v.b), h = Number(v.h), rund = v.form === "rund", d = Math.min(b, h);
  const W = barBreiteMm(v), H = rund ? d * 0.6 : h - 2 * Math.min(2, b * 0.05, h * 0.08);
  const pad = rund ? 0 : Math.min(2, b * 0.05, h * 0.08);
  const titel = String(it.titel || it.bc);
  const t = Math.max(1.6, Math.min(4.5, H * 0.2, W / (anzeigeNummer(titel).length * 0.7)));
  const mitZeile = !!it.zeile && H >= 14, z = Math.max(1.6, Math.min(2.8, H * 0.12));
  const mitFuss = !!it.fuss && !rund && H >= 26;
  const strich = Math.max(2, H - t * 1.15 - (mitZeile ? z * 1.3 : 0) - (mitFuss ? z * 1.1 : 0) - 0.6);
  return { b, h, rund, W, pad, titel, t, mitZeile, z, mitFuss, strich };
}
/** Barcode-Etikett: Bezeichnung oben (wenn Platz), Striche über die volle Breite, Nummer darunter. */
function barcodeInhalt(it, v, cache){
  const L = barLayout(it, v), mm = x => x.toFixed(2) + "mm";
  return { cls:"hoch barcode" + (L.rund ? " rund" : ""), stil:"padding:" + mm(L.pad),
    html:(L.mitZeile ? '<div class="z" style="font-size:' + mm(L.z) + ';max-width:' + mm(L.W) + '">' + esc(it.zeile) + '</div>' : '') +
         '<div class="bar" style="width:' + mm(L.W) + ';height:' + mm(L.strich) + '">' + barSvg(barText(it), cache) + '</div>' +
         '<div class="t" style="font-size:' + mm(L.t) + ';margin-top:' + mm(0.4) + '">' + esc(L.titel) + '</div>' +
         (L.mitFuss ? '<div class="z" style="font-size:' + mm(L.z * 0.8) + '">' + esc(it.fuss) + '</div>' : '') };
}

/* ---- Etikett als Bild (PNG) — für Etikettendrucker mit Handy-App (z. B. Katasymbol E11):
   Bild in der Größe des Etiketts mit 8 Punkten je mm (203 dpi, übliche Auflösung solcher Drucker).
   Striche des Barcodes auf ganze Punkte gerundet, damit sie scharf bleiben. ---- */
const BILD_PX_MM = 8;
/** Text einpassen: verkleinern bis minPx, sonst mit … kürzen. */
function bildText(ctx, text, x, y, maxW, px, fett, minPx){
  text = String(text || "");
  const font = g => (fett ? "bold " : "") + g + "px Arial, Helvetica, sans-serif";
  let g = px; ctx.font = font(g);
  while(g > (minPx || px * 0.6) && ctx.measureText(text).width > maxW){ g -= 1; ctx.font = font(g); }
  if(ctx.measureText(text).width > maxW){
    while(text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    text += "…";
  }
  ctx.fillText(text, x, y);
}
function bildQr(ctx, text, x, y, groesse){
  const m = ZXing.QRCodeEncoder.encode(text, ZXing.QRCodeDecoderErrorCorrectionLevel.M, new Map()).getMatrix();
  const n = m.getWidth(), k = Math.max(1, Math.floor(groesse / n)), ox = Math.round(x + (groesse - n * k) / 2), oy = Math.round(y + (groesse - n * k) / 2);
  for(let r = 0; r < n; r++) for(let c = 0; c < n; c++) if(m.get(c, r) === 1) ctx.fillRect(ox + c * k, oy + r * k, k, k);
}
/** Druckpunkte je Strich-Modul für text auf breitePx: Ruhezone 10 Module; werden die Striche mit 5 Modulen
    einen Punkt dicker, dann 5 — dazu kommt der weiße Etikettenrand (barLayout.pad), zusammen rund 8 Module.
    ZXing braucht vor dem Startzeichen mind. 5,5 Module Weiß. */
function barPunkte(text, breitePx){
  const m = code128Breiten(text).reduce((s, w) => s + w, 0);
  return Math.max(1, Math.floor(breitePx / (m + 20)), Math.floor(breitePx / (m + 10)));
}
function bildBarcode(ctx, text, x, y, breite, hoehe){
  const br = code128Breiten(text), m = br.reduce((s, w) => s + w, 0), k = barPunkte(text, breite);
  let cx = Math.round(x + (breite - m * k) / 2);
  br.forEach((w, i) => { if(i % 2 === 0) ctx.fillRect(cx, Math.round(y), w * k, Math.round(hoehe)); cx += w * k; });
}
/** Zeichnet ein Etikett auf eine Leinwand; art "qr" oder "bar". */
function etikettBild(it, v, art){
  const P = BILD_PX_MM, b = Number(v.b), h = Number(v.h), rund = v.form === "rund";
  const cv = document.createElement("canvas");
  cv.width = Math.round(b * P); cv.height = Math.round(h * P);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const titel = anzeigeNummer(it.titel || it.bc || it.qr);
  if(art === "bar" && it.bc){
    const L = barLayout(it, v);
    const hoch = (L.mitZeile ? L.z * 1.3 : 0) + L.strich + 0.4 + L.t * 1.15 + (L.mitFuss ? L.z * 1.1 : 0);
    let y = (h - hoch) / 2;
    if(L.mitZeile){ bildText(ctx, it.zeile, b * P / 2, (y + L.z) * P, L.W * P, L.z * P, false); y += L.z * 1.3; }
    bildBarcode(ctx, barText(it), (b - L.W) / 2 * P, y * P, L.W * P, L.strich * P); y += L.strich + 0.4;
    bildText(ctx, titel, b * P / 2, (y + L.t * 0.95) * P, L.W * P, L.t * P, true); y += L.t * 1.15;
    if(L.mitFuss) bildText(ctx, it.fuss, b * P / 2, (y + L.z * 0.8) * P, L.W * P, L.z * 0.8 * P, false);
    return cv;
  }
  if(!rund && b / h >= 1.4){
    // quer: QR links, Text rechts
    const pad = Math.min(3, h * 0.08), q = h - 2 * pad, tx = pad * 2 + q, tw = b - tx - pad;
    const t = Math.min(5.5, h * 0.15), z = Math.max(2.2, Math.min(3, h * 0.08));
    bildQr(ctx, it.qr, pad * P, pad * P, q * P);
    ctx.textAlign = "left";
    let y = h / 2 - (t + (it.zeile ? z * 1.4 : 0) + (it.fuss ? z * 1.2 : 0)) / 2 + t * 0.85;
    bildText(ctx, titel, tx * P, y * P, tw * P, t * P, true); y += z * 1.4;
    if(it.zeile){ bildText(ctx, anzeigeNummer(it.zeile), tx * P, y * P, tw * P, z * P, false); y += z * 1.2; }
    if(it.fuss) bildText(ctx, it.fuss, tx * P, y * P, tw * P, z * 0.8 * P, false);
    return cv;
  }
  // hoch oder rund: QR oben, Nummer darunter
  const d = Math.min(b, h), q = rund ? d * 0.5 : Math.min(b * 0.75, h * 0.62), t = Math.min(5, d * 0.12), z = Math.max(1.8, d * 0.06);
  const mitZeile = !!it.zeile && (!rund || d >= 35);
  const hoch = q + d * 0.03 + t * 1.05 + (mitZeile ? z * 1.2 : 0);
  let y = (h - hoch) / 2;
  bildQr(ctx, it.qr, (b - q) / 2 * P, y * P, q * P); y += q + d * 0.03;
  bildText(ctx, titel, b * P / 2, (y + t * 0.9) * P, (rund ? d * 0.8 : b * 0.94) * P, t * P, true); y += t * 1.05;
  if(mitZeile) bildText(ctx, anzeigeNummer(it.zeile), b * P / 2, (y + z) * P, (rund ? d * 0.7 : b * 0.94) * P, z * P, false);
  return cv;
}
function leinwandBlob(cv){ return new Promise((ok, nein) => cv.toBlob(bl => bl ? ok(bl) : nein(new Error("Bild konnte nicht erstellt werden.")), "image/png")); }
function bildDateiname(it){ return anzeigeNummer(it.titel || it.bc || "etikett").replace(/[^A-Za-z0-9_-]+/g, "_") + ".png"; }

let etikettBilder = [];   // [{ name, blob, url }] — zuletzt erstellte Bilder
/** Erstellt die Bilder und zeigt sie an; Teilen/Sichern danach per Knopf (Teilen braucht ein frisches Antippen). */
async function etikettBilderZeigen(items, v, art){
  etikettBilder.forEach(x => { try{ URL.revokeObjectURL(x.url); }catch(e){} });
  etikettBilder = [];
  for(const it of items){
    const blob = await leinwandBlob(etikettBild(it, v, art));
    etikettBilder.push({ name:bildDateiname(it), blob, url:URL.createObjectURL(blob) });
  }
  // Barcode: Striche unter 2 Druckpunkten (0,25 mm) liest die Kamera schlecht
  const fein = art === "bar" && items.some(it => it.bc && barPunkte(barText(it), barBreiteMm(v) * BILD_PX_MM) < 2);
  const teilen = !!(navigator.canShare && navigator.share && navigator.canShare({ files:[new File([etikettBilder[0].blob], etikettBilder[0].name, { type:"image/png" })] }));
  let h = '<h3>Etiketten als Bild</h3><p class="sub" style="margin-top:-6px">' + etikettBilder.length + ' Bild' + (etikettBilder.length === 1 ? '' : 'er') + ' · ' +
          esc(String(v.b).replace(".", ",") + " × " + String(v.h).replace(".", ",")) + ' mm · 203 dpi. In der App des Etikettendruckers als Bild einfügen und auf die volle Etikettengröße ziehen.</p>';
  if(fein) h += '<p class="sub" style="color:var(--warn)">Achtung: Für diese Etikettenbreite ist der Barcode sehr fein (1 Druckpunkt je Strich) — breiteres Band, kürzere Nummer oder QR-Code nehmen und vorher testen.</p>';
  h += '<div class="bildvorschau">' + etikettBilder.map(x => '<img src="' + x.url + '" alt="' + esc(x.name) + '" style="aspect-ratio:' + Number(v.b) + '/' + Number(v.h) + '">').join("") + '</div>';
  h += '<p class="sub">' + (teilen ? '„Teilen“ öffnet das Teilen-Menü: „Bilder sichern“ bzw. „In Galerie speichern“ wählen.' : 'Bilder werden heruntergeladen.') +
       ' Einzelnes Bild: lange antippen → sichern.</p>';
  h += '<div class="row wrapr" style="gap:8px"><button class="btn" data-a="etZurueck">Zurück</button><span class="sp"></span>' +
       '<button class="btn primary" data-a="etTeilen" data-x="' + (teilen ? "teilen" : "laden") + '">' + (teilen ? "Teilen / Sichern" : "Herunterladen") + '</button></div>';
  modal(h);
}
async function etikettBilderTeilen(art){
  if(!etikettBilder.length) return;
  if(art === "teilen"){
    const files = etikettBilder.map(x => new File([x.blob], x.name, { type:"image/png" }));
    try{ await navigator.share({ files, title:"Etiketten" }); return; }
    catch(e){ if(e && e.name === "AbortError") return; toast("Teilen ging nicht (" + e.message + ") — Bilder werden heruntergeladen."); }
  }
  etikettBilder.forEach((x, i) => setTimeout(() => {
    const a = document.createElement("a"); a.href = x.url; a.download = x.name; document.body.appendChild(a); a.click(); a.remove();
  }, i * 300));
}

function qrSvg(text, cache){
  if(cache[text]) return cache[text];
  const hints = new Map(); hints.set(ZXing.EncodeHintType.MARGIN, 0);
  const svg = new ZXing.BrowserQRCodeSvgWriter().write(text, 200, 200, hints);
  svg.setAttribute("viewBox", "0 0 200 200"); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  return (cache[text] = svg.outerHTML);
}
/** Inhalt eines Etiketts passend zur Größe: quer (QR links, Text rechts) oder hoch/rund (QR oben, Nummer darunter). */
function etikettInhalt(it, v, cache, art){
  if(art === "bar" && it.bc) return barcodeInhalt(it, v, cache);
  const b = Number(v.b), h = Number(v.h), rund = v.form === "rund";
  const mm = x => x.toFixed(2) + "mm";
  if(!rund && b / h >= 1.4){
    const pad = Math.min(3, h * 0.08), q = h - 2 * pad;
    const t = Math.min(5.5, h * 0.15, (b - q - 3 * pad) / 4.2), z = Math.max(2.2, Math.min(3, h * 0.08));
    return { cls:"quer", stil:"padding:" + mm(pad) + ";gap:" + mm(pad),
      html:'<div class="qr" style="width:' + mm(q) + ';height:' + mm(q) + '">' + qrSvg(it.qr, cache) + '</div><div class="txt"><div class="t" style="font-size:' + mm(t) + '">' + esc(it.titel) + '</div>' +
           '<div class="z" style="font-size:' + mm(z) + ';margin-top:' + mm(z * 0.4) + '">' + esc(it.zeile || "") + '</div>' +
           (it.fuss ? '<div class="z" style="font-size:' + mm(z * 0.8) + ';margin-top:' + mm(z * 0.4) + '">' + esc(it.fuss) + '</div>' : '') + '</div>' };
  }
  // hoch oder rund: QR oben, Nummer darunter; bei rund kleiner, damit alles im Kreis liegt
  const d = Math.min(b, h), q = rund ? d * 0.5 : Math.min(b * 0.75, h * 0.62), t = Math.min(5, d * 0.12), z = Math.max(1.8, d * 0.06);
  return { cls:"hoch" + (rund ? " rund" : ""), stil:"padding:" + mm(d * 0.06),
    html:'<div class="qr" style="width:' + mm(q) + ';height:' + mm(q) + '">' + qrSvg(it.qr, cache) + '</div>' +
         '<div class="t" style="font-size:' + mm(t) + ';margin-top:' + mm(d * 0.03) + '">' + esc(it.titel) + '</div>' +
         (it.zeile && !rund ? '<div class="z" style="font-size:' + mm(z) + '">' + esc(it.zeile) + '</div>' : '') +
         (it.zeile && rund && d >= 35 ? '<div class="z" style="font-size:' + mm(z) + ';max-width:' + mm(d * 0.7) + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.zeile) + '</div>' : '') };
}
/** Druckt items auf Vorlage v; start = erstes freies Feld (Bogen); test = nur Umrisse mit Feldnummern; art = "qr" oder "bar". */
function etikettenDrucken(items, v, start, kopien, test, art){
  const liste = [];
  items.forEach(it => { for(let i = 0; i < kopien; i++) liste.push(it); });
  const cache = {}, mm = x => Number(x).toFixed(2) + "mm";
  const b = Number(v.b), h = Number(v.h);
  let html = "";
  if(v.seite === "A4"){
    const jeSeite = v.sp * v.ze;
    const felder = test ? Array.from({ length:jeSeite }, (_, i) => i + 1) : Array(Math.max(0, start - 1)).fill(null).concat(liste);
    for(let i = 0; i < felder.length; i += jeSeite){
      html += '<div class="seite" style="width:210mm;height:296mm">';
      felder.slice(i, i + jeSeite).forEach((it, k) => {
        if(it === null) return;
        const sp = k % v.sp, ze = Math.floor(k / v.sp);
        const pos = "left:" + mm(Number(v.li) + sp * (b + Number(v.ah))) + ";top:" + mm(Number(v.ro) + ze * (h + Number(v.av))) + ";width:" + mm(b) + ";height:" + mm(h) + ";";
        if(test){ html += '<div class="etikett umriss hoch' + (v.form === "rund" ? " rund" : "") + '" style="' + pos + '"><span class="nr">' + it + '</span></div>'; return; }
        const c = etikettInhalt(it, v, cache, art);
        html += '<div class="etikett ' + c.cls + '" style="' + pos + c.stil + '">' + c.html + '</div>';
      });
      html += '</div>';
    }
  } else {
    (test ? [{ qr:"TEST", titel:"TEST", zeile:"Testetikett" }] : liste).forEach(it => {
      const c = etikettInhalt(it, v, cache, test ? "qr" : art);
      html += '<div class="seite" style="width:' + mm(b) + ';height:' + mm(h) + '"><div class="etikett ' + c.cls + (test ? " umriss" : "") + '" style="left:0;top:0;width:' + mm(b) + ';height:' + mm(h) + ';' + c.stil + '">' + c.html + '</div></div>';
    });
  }
  let d = $("druck"); if(!d){ d = document.createElement("div"); d.id = "druck"; document.body.appendChild(d); }
  d.innerHTML = html;
  let st = $("druckSeite"); if(!st){ st = document.createElement("style"); st.id = "druckSeite"; document.head.appendChild(st); }
  st.textContent = v.seite === "A4" ? "@page{size:A4;margin:0}" : "@page{size:" + mm(b) + " " + mm(h) + ";margin:0}";
  document.body.classList.add("drucken");
  const fertig = () => { document.body.classList.remove("drucken"); st.textContent = ""; window.removeEventListener("afterprint", fertig); };
  window.addEventListener("afterprint", fertig);
  setTimeout(() => { window.print(); setTimeout(fertig, 1500); }, 50);
}

/* ---- Eigene Vorlagen: Maße von der Packung ---- */
function vorlagenVerwalten(){
  const l = eigeneVorlagen();
  let h = '<h3>Eigene Etiketten-Arten</h3><p class="sub" style="margin-top:-6px">Maße stehen auf der Packung bzw. dem Bogen. Mit „Testseite“ auf normales Papier drucken und gegen den Bogen halten.</p>';
  h += '<div class="card liste">' + (l.length ? l.map(v => '<div class="eintrag"><div class="txt"><strong>' + esc(v.name) + '</strong><br><span class="sub">' +
        (v.form === "rund" ? "rund Ø " + v.b : v.b + " × " + v.h) + ' mm · ' + (v.seite === "A4" ? "A4 " + v.sp + " × " + v.ze : "einzeln") + '</span></div>' +
        '<div class="knoepfe"><button class="btn small" data-a="vorlageTest" data-x="' + esc(v.id) + '">Testseite</button><button class="btn small" data-a="vorlageForm" data-x="' + esc(v.id) + '">bearbeiten</button></div></div>').join("")
        : '<div class="sub">Noch keine eigene Art angelegt.</div>') + '</div>';
  h += '<div class="row wrapr" style="gap:8px"><button class="btn" data-a="etZurueck">Zurück</button><span class="sp"></span><button class="btn primary" data-a="vorlageForm" data-x="">Neue Etiketten-Art</button></div>';
  modal(h);
}
function vorlageForm(id){
  const v = id ? eigeneVorlagen().find(x => x.id === id) : { name:"", form:"rund", seite:"A4", b:40, h:40, sp:4, ze:6, ro:13.5, li:15, ah:5, av:5 };
  if(!v) return;
  const zahlFeld = (l, i, w) => feld(l, i, w, "number", ' step="0.01" min="0" inputmode="decimal"');
  let h = '<h3>' + (id ? "Etiketten-Art bearbeiten" : "Neue Etiketten-Art") + '</h3>';
  h += feld("Name", "vName", v.name, "text", ' placeholder="z. B. Zweckform rund 40 mm"');
  h += '<div class="grid2">' + auswahl("Form", "vForm", [["rechteck","rechteckig"],["rund","rund"]], v.form) + auswahl("Papier", "vSeite", [["A4","A4-Bogen"],["einzeln","einzeln / Rolle"]], v.seite) + '</div>';
  h += '<div class="grid2">' + zahlFeld("Breite bzw. Ø (mm)", "vB", v.b) + zahlFeld("Höhe (mm, bei rund = Ø)", "vH", v.h) + '</div>';
  h += '<p class="sub" style="margin:-4px 0 8px">Nur für A4-Bögen:</p>';
  h += '<div class="grid2">' + zahlFeld("Spalten", "vSp", v.sp) + zahlFeld("Zeilen", "vZe", v.ze) + '</div>';
  h += '<div class="grid2">' + zahlFeld("Rand oben (mm)", "vRo", v.ro) + zahlFeld("Rand links (mm)", "vLi", v.li) + '</div>';
  h += '<div class="grid2">' + zahlFeld("Abstand waagerecht (mm)", "vAh", v.ah) + zahlFeld("Abstand senkrecht (mm)", "vAv", v.av) + '</div>';
  h += '<p class="sub">Rand = vom Papierrand bis zum ersten Etikett. Abstand = Lücke zwischen zwei Etiketten.</p>';
  h += '<div class="row wrapr" style="gap:8px"><button class="btn" data-a="vorlagenVerwalten">Zurück</button>' +
       (id ? '<button class="btn small" data-a="vorlageLoeschen" data-x="' + esc(id) + '">löschen</button>' : '') +
       '<span class="sp"></span><button class="btn primary" data-a="vorlageSpeichern" data-x="' + esc(id || "") + '">Speichern</button></div>';
  modal(h);
}
