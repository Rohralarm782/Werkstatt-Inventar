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
  { version:"21.8.0", datum:"2026-11-25", titel:"Sitzpositionen", punkte:[
    { art:"neu", fuer:"werkstatt", titel:"Sitzposition je Rad",
      text:"Auf der Rad-Seite gibt es „Sitzposition“: Sattelhöhe, Sattelversatz, Lenker und Vorbau in mm, bei einem montierten TT-Lenker auch Spacer, Reichweite E und Erhöhung H. Die Grafik bewegt sich mit den Werten. Jede Speicherung landet im Verlauf." },
    { art:"neu", fuer:"werkstatt", titel:"Hinweis zum Gegenprüfen",
      text:"Änderst du einen Wert am Sattel oder am Lenker, bittet die App, die zugehörigen Werte zu prüfen. Es wird nichts automatisch verschoben." },
    { art:"neu", fuer:"werkstatt", titel:"Laserjig-Haken je Lenker",
      text:"Pro Lenker bzw. Aufsatz lässt sich festhalten, ob die Werte am Laserjig bestätigt sind. Ändern sich die Lenkerwerte, ist der Haken wieder weg. Den Zeitfahraufsatz erkennt die App am Tag „TT-Lenker“, einen eigenen Lenker am Tag „Lenker“." },
    { art:"neu", fuer:"werkstatt", titel:"UCI-Kategorie beim Sportler",
      text:"Unter Mehr → Sportler & Kostenträger lässt sich die UCI-Größenkategorie (1–3) eintragen. Sie steht dann bei der Sitzposition." },
    { art:"neu", fuer:"sportler", titel:"Deine Sitzposition",
      text:"Bei deinem Rad siehst du jetzt die eingetragene Sitzposition. Ändern kann sie dein Trainer." }
  ]},
  { version:"21.7.0", datum:"2026-11-18", titel:"Artikel löschen", punkte:[
    { art:"neu", fuer:"manager", titel:"Falsch angelegte Artikel löschen",
      text:"In „Artikel bearbeiten“ gibt es „Löschen“. Gedacht für Fehleingaben. Wurde ein Artikel schon an Sportler ausgegeben, in einem Ticket verwendet oder abgerechnet, geht nur „inaktiv“." }
  ]},
  { version:"21.6.0", datum:"2026-11-17", titel:"Probleme am eigenen Material melden", punkte:[
    { art:"neu", fuer:"sportler", titel:"Problem melden für dein Material",
      text:"Unter „Mein Material“ kannst du für jedes Teil ein Problem melden und Fotos schicken, genau wie bei deinen Rädern." },
    { art:"neu", fuer:"werkstatt", titel:"Packliste aufräumen",
      text:"In der Koffer-Packliste nimmt ✕ einen Artikel heraus. Das dürfen jetzt auch Trainer und Mechaniker. Liegt davon noch etwas im Koffer, erst mit „Menge…“ zurückbuchen." },
    { art:"besser", fuer:"werkstatt", titel:"Kürzere Nummern auf Etiketten",
      text:"Auf den Etiketten steht die Nummer ohne Standort-Kürzel, z. B. LR-014 statt SN-LR-014. Der Code selbst bleibt gleich." },
    { art:"besser", fuer:"werkstatt", titel:"Tickets für Material eines Sportlers",
      text:"Ein Ticket nur für Teile, die fest einem Sportler gehören, zeigt diesen Sportler als Fahrer." }
  ]},
  { version:"21.5.0", datum:"2026-11-17", titel:"Material fest beim Sportler", punkte:[
    { art:"neu", fuer:"werkstatt", titel:"Teile fest einem Sportler zuordnen",
      text:"Im Einzelstück (oder in der Serie) gibt es „Fest zugeordnet an“, z. B. für die Laufräder in der Laufradtasche. Der Name steht auf der Karte und ist in der Suche zu finden." },
    { art:"neu", fuer:"werkstatt", titel:"Name auf dem Etikett",
      text:"Beim Etikettendruck per Häkchen wählen: mit Name und mit Code. Ohne Code stehen nur Nummer und Name groß drauf. Auf dem Laufradtaschen-Tag steht der Name rot unter dem Typ. Bei Rädern ist es der aktuelle Fahrer." },
    { art:"behoben", fuer:"werkstatt", titel:"Koffer-Packliste auf dem Handy",
      text:"Die Packliste passt wieder auf schmale Bildschirme. Die Knöpfe +1, −1 und „Menge…“ stehen dort unter dem Artikel." },
    { art:"neu", fuer:"sportler", titel:"Mein Material",
      text:"Teile, die dir fest zugeordnet sind, z. B. deine Laufräder, siehst du jetzt unter „Mein Material“." }
  ]},
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
/** „Was ist neu?“ gibt es nur für X.Y.0 (ab 21.6.2): Patches (X.Y.Z mit Z > 0) bekommen keinen Eintrag und kein Fenster. */
function neuStufe(v){ const x = String(v).split("."); return (x[0] || 0) + "." + (x[1] || 0) + ".0"; }
function neuIstStufe(v){ return versionVergleich(v, neuStufe(v)) === 0; }
function neuGesehenAlle(){ try{ return JSON.parse(localStorage.getItem("wNeuGesehen") || "{}") || {}; }catch(e){ return {}; } }
function neuKonto(){ const s = aktiveSitzung(); return s ? String(s.konto_id) : ""; }
/** Stand aus der Datenbank (kommt mit app_daten → ich), nur wenn ICH zum aktiven Konto gehört. */
function neuKontoStand(k){ return ICH && String(ICH.konto_id) === k ? (ICH.neu_gesehen || "") : ""; }
function neuSpaeter(a, b){ return !a ? (b || "") : !b ? a : versionVergleich(a, b) >= 0 ? a : b; }
/** Bis zu welcher Version hat dieses Konto „Was ist neu?“ gesehen? (Datenbank oder Browser, der neuere Stand) */
function neuGesehen(k){ return neuSpaeter(neuGesehenAlle()[k], neuKontoStand(k)); }
/** Stand merken: im Browser und am Konto in der Datenbank (nur vorwärts, Fehler still). */
function neuMerken(v){
  const k = neuKonto(); if(!k) return;
  v = v || APP_VERSION;
  const g = neuGesehenAlle();
  if(!g[k] || versionVergleich(g[k], v) < 0){ g[k] = v; try{ localStorage.setItem("wNeuGesehen", JSON.stringify(g)); }catch(e){} }
  const db = neuKontoStand(k);
  if(!ICH || String(ICH.konto_id) !== k || (db && versionVergleich(db, v) >= 0)) return;
  ICH.neu_gesehen = v;
  rpc("neu_gesehen_setzen", { p_version:v }).catch(() => {});   // klappt es nicht, beim nächsten Laden wieder
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
  return NEUIGKEITEN.filter(v => neuIstStufe(v.version) && (!ab || versionVergleich(v.version, ab) > 0) && versionVergleich(v.version, APP_VERSION) <= 0)
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
  const ab = neuGesehen(k);
  if(ab && versionVergleich(ab, neuStufe(APP_VERSION)) >= 0){ neuMerken(ab); return; }   // schon gesehen (ggf. Stand ans Konto übertragen)
  if(String($("modal").innerHTML).trim()) return;   // ein anderes Fenster ist offen → beim nächsten Laden
  // Noch kein Stand (weder Konto noch Browser): auf einem neuen Gerät nichts zeigen, sonst nur die aktuelle Version
  const liste = ab ? neuVersionen(ab).slice(0, NEU_MAX)
                   : NEU_GERAET_BEKANNT ? neuVersionen(null).filter(v => v.version === neuStufe(APP_VERSION)) : [];
  if(!liste.length){ neuMerken(); return; }   // nichts, was diese Person betrifft
  neuFenster(liste, false);
  neuMerken();
}

Object.assign(A, {
  neuigkeiten: () => neuFenster(neuVersionen(null), true),
  neuGelesen: () => modalZu()
});
