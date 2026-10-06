/* js/etiketten.js — Etiketten: Vorlagen, QR-/Barcodes, Druck.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ===============================================================
   Etiketten — Vorlagen (rechteckig/rund, A4-Bogen oder Einzeletikett),
   eigene Vorlagen nach den Maßen auf der Packung, Testseite mit Umrissen,
   und eine Druckliste zum Sammeln, damit Bögen voll werden.
   QR-Codes erzeugt das eingebaute ZXing — nichts wird nachgeladen.
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
function etikettStueck(s){ return { typ:"stueck", id:s.nummer, qr:s.nummer, titel:s.nummer, zeile:s.typ + (s.marke ? " · " + s.marke : "") }; }
function etikettArtikel(a){ return { typ:"artikel", id:a.code, qr:a.code, titel:a.code, zeile:a.name }; }
function etikettRad(r){ return { typ:"rad", id:r.id, qr:radQrText(r.id), titel:r.id, zeile:r.bezeichnung, fuss:"Problem? Scannen → Ticket" }; }
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
  h += '<div class="grid2"><div class="feld" id="etStartFeld"' + (v.seite === "A4" ? "" : " hidden") + '><span class="lbl">Erstes freies Feld</span>' +
       '<input type="number" id="etStart" value="1" min="1" max="' + felderJeSeite(v) + '" inputmode="numeric"></div>';
  h += mitKopien ? feld("Anzahl je Etikett", "etKopien", 1, "number", ' min="1" max="50" inputmode="numeric"') : '';
  h += '</div><p class="sub">Bei einem angefangenen Bogen das erste freie Feld angeben — gezählt wird zeilenweise von links oben.</p>';
  if(quelle === "druckliste") h += '<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="etLeeren" checked> Druckliste danach leeren</label>';
  h += '<div class="row wrapr" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>';
  if(quelle !== "druckliste") h += '<button class="btn" data-a="etSammeln">auf Druckliste</button>';
  h += '<button class="btn primary" data-a="etDrucken">Drucken</button></div>';
  modal(h);
}

function qrSvg(text, cache){
  if(cache[text]) return cache[text];
  const hints = new Map(); hints.set(ZXing.EncodeHintType.MARGIN, 0);
  const svg = new ZXing.BrowserQRCodeSvgWriter().write(text, 200, 200, hints);
  svg.setAttribute("viewBox", "0 0 200 200"); svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
  return (cache[text] = svg.outerHTML);
}
/** Inhalt eines Etiketts passend zur Größe: quer (QR links, Text rechts) oder hoch/rund (QR oben, Nummer darunter). */
function etikettInhalt(it, v, cache){
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
/** Druckt items auf Vorlage v; start = erstes freies Feld (Bogen); test = nur Umrisse mit Feldnummern. */
function etikettenDrucken(items, v, start, kopien, test){
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
        const c = etikettInhalt(it, v, cache);
        html += '<div class="etikett ' + c.cls + '" style="' + pos + c.stil + '">' + c.html + '</div>';
      });
      html += '</div>';
    }
  } else {
    (test ? [{ qr:"TEST", titel:"TEST", zeile:"Testetikett" }] : liste).forEach(it => {
      const c = etikettInhalt(it, v, cache);
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
