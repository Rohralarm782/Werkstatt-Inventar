/* js/neuigkeiten.js — „Was ist neu?“ (ab 21.4.0)
   Nach einem Update zeigt die App jeder Person einmal, was sich seit ihrem letzten
   Besuch geändert hat, nur die Punkte, die ihre Rolle betreffen. Gemerkt wird je
   Konto auf dem Gerät (localStorage „wNeuGesehen“: { konto_id: Version }).
   Alle Neuigkeiten: unten bei der Versionsnummer → „Was ist neu?“.

   Bei jedem Update mit spürbaren Änderungen oben in NEUIGKEITEN einen Eintrag
   ergänzen: für Nutzer geschrieben (was ändert sich für mich?), ohne Technik.
   art: "neu" | "besser" | "behoben"
   fuer: "alle" | "werkstatt" (Manager, Trainer/Mechaniker) | "manager" | "rechnen"
         (Manager, Geschäftsstelle) | "sportler"
   Reine Technik-Updates brauchen keinen Eintrag; dann erscheint nichts.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

const NEUIGKEITEN = [
  { version:"21.4.0", datum:"2026-11-17", titel:"Größen für Werkstattmaterial", punkte:[
    { art:"neu", fuer:"werkstatt", titel:"Ein Artikel, mehrere Größen",
      text:"Zipper-Beutel, Kabelbinder oder Tape können Größen haben, z. B. 1 L, 3 L, 5 L. Der Bestand wird je Größe geführt. Beim „−“ und beim Einpacken in den Koffer tippst du die Größe an." },
    { art:"neu", fuer:"werkstatt", titel:"Mindestbestand je Größe",
      text:"Im Artikel steht für jede Größe ein eigener Mindestbestand. Die Bestellliste und die Morgen-Nachricht melden dann genau die Größe, die nachgekauft werden muss." },
    { art:"besser", fuer:"werkstatt", titel:"Koffer bleibt einfach",
      text:"In der Packliste steht der Artikel weiter als Ganzes, z. B. „Panzertape 2“. Darunter siehst du, welche Größen gerade im Koffer sind." }
  ]},
  { version:"21.3.0", datum:"2026-11-14", titel:"Sportler und Kostenträger getrennt", punkte:[
    { art:"neu", fuer:"werkstatt", titel:"Eigene Liste für Kostenträger",
      text:"Vereine, LV und BSP stehen unter Mehr → Sportler & Kostenträger in einer eigenen Liste. Bei der Fahrer-Auswahl erscheinen nur noch Sportler." },
    { art:"neu", fuer:"werkstatt", titel:"Eigentümer „Fahrer selbst“",
      text:"Gehört ein Rad dem, der es fährt, gehen neue Tickets automatisch an den aktuellen Fahrer." },
    { art:"neu", fuer:"manager", titel:"Rad-Nummern je Kostenträger",
      text:"Mit einem Kürzel beim Kostenträger bekommen seine neuen Räder eine eigene Nummernreihe, z. B. DAS-BR-01." }
  ]},
  { version:"21.2.0", datum:"2026-10-26", titel:"Schneller und ruhiger", punkte:[
    { art:"besser", fuer:"alle", titel:"Schnellerer Start",
      text:"Die App lädt ihre Daten in einem Schritt und zeigt die erste Seite früher an." },
    { art:"besser", fuer:"werkstatt", titel:"Flüssigere Suche",
      text:"Die Suche ruckelt auch auf älteren Handys nicht mehr beim Tippen." },
    { art:"besser", fuer:"alle", titel:"Schriften in der App",
      text:"Schriften werden nicht mehr bei Google geladen. Das schont den Datenschutz und klappt auch bei schlechtem Netz." }
  ]},
  { version:"21.1.0", datum:"2026-10-26", titel:"Aufgeräumte Tags", punkte:[
    { art:"besser", fuer:"werkstatt", titel:"Disziplin = Radtyp",
      text:"Die Disziplinen folgen den Radtypen des Standorts. Ein Teil ohne Disziplin passt zu allem." },
    { art:"besser", fuer:"werkstatt", titel:"Weniger doppelte Angaben",
      text:"Die Tag-Gruppe „Baugruppe“ entfällt, das sagt schon die Kategorie. Bei Antriebsteilen reicht die Marke." }
  ]},
  { version:"21.0.0", datum:"2026-10-26", titel:"Merkmale und Lagerort am Rad", punkte:[
    { art:"neu", fuer:"werkstatt", titel:"Merkmale",
      text:"Räder und Teile haben Merkmale wie Rahmengröße oder Laufraddimension. Listen lassen sich danach filtern." },
    { art:"neu", fuer:"werkstatt", titel:"Lagerort am Rad",
      text:"Bei jedem Rad steht, in welchem Raum es ist oder ob es beim Sportler ist." },
    { art:"neu", fuer:"manager", titel:"Eigene Einträge am Standort",
      text:"Eigene Radtypen, Merkmale und Tag-Gruppen anlegen und Vorgaben des Landesverbands ausblenden." }
  ]}
];
const NEU_ART = { neu:"Neu", besser:"Verbessert", behoben:"Behoben" };
const NEU_MAX = 4;   // so viele Versionen höchstens im Fenster nach einem Update
// War auf diesem Gerät schon jemand angemeldet, bevor diese Seite geladen wurde?
const NEU_GERAET_BEKANNT = (() => { try{ return !!localStorage.getItem("wSitzungen"); }catch(e){ return false; } })();

/** Versionen vergleichen: <0, 0, >0 */
function versionVergleich(a, b){
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for(let i = 0; i < 3; i++){ const d = (x[i] || 0) - (y[i] || 0); if(d) return d; }
  return 0;
}
function neuGesehenAlle(){ try{ return JSON.parse(localStorage.getItem("wNeuGesehen") || "{}") || {}; }catch(e){ return {}; } }
function neuKonto(){ const s = aktiveSitzung(); return s ? String(s.konto_id) : ""; }
function neuMerken(){
  const k = neuKonto(); if(!k) return;
  const g = neuGesehenAlle(); g[k] = APP_VERSION;
  try{ localStorage.setItem("wNeuGesehen", JSON.stringify(g)); }catch(e){}
}
/** Betrifft der Punkt die angemeldete Person? */
function neuFuerMich(p){
  const f = p.fuer || "alle";
  if(f === "alle") return true;
  if(f === "sportler") return rolle() === "sportler";
  return darf(f === "werkstatt" ? "arbeiten" : f);
}
/** Versionen (neueste zuerst) mit den Punkten für diese Person; ab = nur neuer als diese Version. */
function neuVersionen(ab){
  return NEUIGKEITEN.filter(v => (!ab || versionVergleich(v.version, ab) > 0) && versionVergleich(v.version, APP_VERSION) <= 0)
    .map(v => Object.assign({}, v, { punkte:v.punkte.filter(neuFuerMich) })).filter(v => v.punkte.length);
}
function neuDatum(d){
  const t = new Date(d + "T12:00:00");
  return isNaN(t) ? "" : t.toLocaleDateString("de-DE", { day:"numeric", month:"long", year:"numeric" });
}
function neuVersionHtml(v, mitKopf){
  return '<section class="neu-version">' +
    (mitKopf ? '<div class="neu-vkopf"><span class="neu-vnr">Version ' + esc(v.version) + '</span><span class="neu-vdatum">' + esc(neuDatum(v.datum)) + '</span></div>' : '') +
    '<h4 class="neu-vtitel">' + esc(v.titel) + '</h4><ul class="neu-liste">' +
    v.punkte.map(p => '<li><span class="neu-badge ' + esc(p.art) + '">' + esc(NEU_ART[p.art] || p.art) + '</span>' +
                      '<div><strong>' + esc(p.titel) + '</strong><p>' + esc(p.text) + '</p></div></li>').join("") +
    '</ul></section>';
}
/** Das Fenster. liste: Versionen (neueste zuerst); alle: Gesamtübersicht statt „seit deinem letzten Besuch“. */
function neuFenster(liste, alle){
  const erste = liste[0];
  let h = '<div class="neu-kopf"><div class="neu-oben">' + (alle ? 'Alle Neuigkeiten' : 'Neu in der Werkstatt-App') + '</div>' +
          '<div class="neu-gross">' + (alle ? 'Was ist neu?' : 'Version ' + esc(erste.version)) + '</div>' +
          '<div class="neu-unter">' + (alle ? 'Aktuell: Version ' + esc(APP_VERSION) : esc(neuDatum(erste.datum)) + (liste.length > 1 ? ' · mit den Neuerungen seit deinem letzten Besuch' : '')) + '</div></div>';
  h += '<div class="neu-inhalt">' + (liste.length ? liste.map((v, i) => neuVersionHtml(v, alle || i > 0)).join("") : '<p class="sub">Noch keine Einträge.</p>') + '</div>';
  h += '<div class="neu-fuss">' + (alle ? '' : '<button class="btn small link" data-a="neuigkeiten">Alle Neuigkeiten</button>') +
       '<span class="sp"></span><button class="btn primary" data-a="neuGelesen">' + (alle ? 'Schließen' : 'Alles klar') + '</button></div>';
  $("modal").innerHTML = '<div class="overlay" data-a="modalHintergrund"><div class="sheet neu-sheet" role="dialog" aria-label="Neuigkeiten">' + h + '</div></div>';
}
/** Nach dem Laden: Gibt es für diese Person Ungesehenes? Dann einmal zeigen. */
function neuigkeitenPruefen(){
  const k = neuKonto(); if(!k || !DB) return;
  const ab = neuGesehenAlle()[k];
  if(ab && versionVergleich(ab, APP_VERSION) >= 0) return;
  if(String($("modal").innerHTML).trim()) return;   // ein anderes Fenster ist offen → beim nächsten Laden
  // Erstes Mal mit diesem Konto: auf einem neuen Gerät nichts zeigen, sonst nur die aktuelle Version
  const liste = ab ? neuVersionen(ab).slice(0, NEU_MAX)
                   : NEU_GERAET_BEKANNT ? neuVersionen(null).filter(v => v.version === APP_VERSION) : [];
  if(!liste.length){ neuMerken(); return; }   // nichts, was diese Person betrifft
  neuFenster(liste, false);
  neuMerken();
}

Object.assign(A, {
  neuigkeiten: () => neuFenster(neuVersionen(null), true),
  neuGelesen: () => modalZu()
});
