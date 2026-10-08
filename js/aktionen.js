/* js/aktionen.js — Aktionen: Klick-Aktionen (A) und Eingabe-Aktionen (C), verteilt über
   data-a / data-x bzw. data-c. Weitere Aktionen hängt js/konto.js an.
   Teil der App, geladen von index.html (Reihenfolge dort beachten). */

/* ---------------------------------------------------------------
   Aktionen
----------------------------------------------------------------*/
/** Vor dem Buchen: reicht der Bestand am Ort? Sonst nachfragen. true = weitermachen. */
function genugDa(code, ort, menge){
  if(istLeistung(code)) return true;
  const b = bestand(code); if(!b) return true;
  const physisch = amOrt(b, ort), res = istKoffer(ort) ? 0 : reserviertAm(code, ort, null);
  const frei = physisch - res;
  if(menge <= frei) return true;
  const folge = menge > physisch ? "Der Bestand wird dann negativ." : "Damit fehlen sie später bei den Tickets, für die sie reserviert sind.";
  return confirm("In " + ort + " sind nur " + zahl(Math.max(frei, 0)) + " " + b.einheit + " frei" +
                 (res ? " (" + zahl(res) + " reserviert)" : "") +
                 ". Trotzdem " + zahl(menge) + " buchen? " + folge);
}
function neuMaterial(code){
  const da = neu.pos.find(p => p.code && p.code === code);
  if(da){ da.menge = num(da.menge) + 1; render(); toast((artikel(code)||{}).name + " — jetzt " + zahl(da.menge) + "×"); return; }
  neu.pos.push({ code, menge:1 }); render();
}
function reservieren(code){
  const t = ticket(view.ticket); if(!t) return;
  const da = positionen(t.id).find(p => p.code === code);
  const name = (artikel(code)||{}).name || code;   // nur offene Schritte zählen hoch
  aktion(() => da ? aendern("ticket_position", "id=eq." + da.id, { menge:num(da.menge) + 1 })
                  : neuIn("ticket_position", { ticket_id:t.id, code, menge:1 }),
         () => {
           const tt = ticket(t.id);
           const menge = tt ? positionen(tt.id).filter(p => p.code === code).reduce((s, p) => s + num(p.menge), 0) : 1;
           return name + (menge > 1 ? " — jetzt " + zahl(menge) + "×" : "") +
                  (tt && fehlend(tt).indexOf(code) >= 0 ? " — fehlt, muss besorgt werden" : " reserviert");
         });
}
function tAendern(felder, meldung){
  const t = ticket(view.ticket); if(!t) return;
  aktion(() => aendern("ticket", "id=eq." + t.id, felder), meldung);
}

/** Alle Klick-Aktionen, verteilt über data-a / data-x. */
const A = {
  tab: x => {
    // Reiter erneut antippen führt zurück zur Übersicht dieses Reiters
    view.tab = x; view.ticket = null; view.suche = "";
    if(x === "tickets" && view.filter === "verlauf") view.filter = "offen";
    if(x === "raeder") view.rad = null;
    if(x === "mehr") view.mehr = null;
    if(x === "material") view.koffer = null;
    if(x === "neu" && !neu) neuStart();
    render(); window.scrollTo(0,0);
  },
  filter: x => { if(x === "verlauf" || view.filter === "verlauf") view.suche = ""; view.filter = x; render(); window.scrollTo(0,0); },
  verlaufArt: x => { verlaufArt = x; render(); },
  verlaufMehr: () => ladeTicketVerlauf(true),
  verlaufNeu: () => { ticketVerlauf = undefined; render(); },
  verlaufTicket: x => verlaufTicket(Number(x)),
  verlaufRad: x => { modalZu(); view.tab = "raeder"; view.rad = x; view.suche = ""; render(); window.scrollTo(0,0); },
  mat: x => { view.mat = x; view.koffer = null; view.suche = ""; render(); window.scrollTo(0,0); },
  matFilter: x => {
    // Wechsel zwischen Werkstattmaterial und dem übrigen Lager: Kategorie-Filter zurücksetzen
    if((x === "werkstatt") !== (view.matFilter === "werkstatt")){ view.lKat = ""; view.lUk = ""; }
    view.matFilter = x; render();
  },
  kofferAuf: x => { modalZu(); view.tab = "material"; view.mat = "lager"; view.koffer = x; view.suche = ""; render(); window.scrollTo(0,0); },
  kofferZu: () => { view.koffer = null; render(); window.scrollTo(0,0); },
  ortFilter: x => { view.lOrt = view.lOrt === x ? "" : x; view.suche = ""; render(); },
  ortBearbeiten: x => formLagerort(x ? Number(x) : null),
  ortArt: x => { ortArtWahl = x; document.querySelectorAll('[data-a="ortArt"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.x === x))); },
  ortSpeichern: x => {
    const name = (wert("oName") || "").trim();
    if(!name){ toast("Name fehlt.", true); return; }
    if(/\|/.test(name)){ toast("Der Strich | ist im Namen nicht möglich.", true); return; }
    if(!x){ aktion(() => rpc("lagerort_anlegen", { p_name:name, p_art:ortArtWahl }), name + " angelegt"); return; }
    const o = (DB.lagerorte||[]).find(z => z.id === Number(x)); if(!o) return;
    const e = $("oAktiv"), aktiv = e ? e.checked : o.aktiv;
    aktion(() => rpc("lagerort_aendern", { p_id:o.id, p_name:name !== o.name ? name : null, p_art:ortArtWahl !== o.art ? ortArtWahl : null,
                                           p_aktiv:aktiv !== o.aktiv ? aktiv : null }), "Gespeichert");
  },
  ortAusZeigen: () => { view.ortAus = !view.ortAus; render(); },
  /* Bekleidung */
  kleidungAuf: x => { view.tab = "material"; view.mat = "kleidung"; view.kOrt = x; view.suche = ""; render(); window.scrollTo(0,0); },
  kOrt: x => { view.kOrt = x; render(); },
  grVorlage: x => { const e = $("aGroessen"), v = GROESSEN_VORLAGEN[Number(x)]; if(e && v) e.value = v[1]; grBestandFelder(); },
  /* Artikelformular: Werkstatt oder Bekleidung (ab 17.1.0) */
  aZweck: x => {
    artZweck = x === "kleidung" ? "kleidung" : "werkstatt";
    document.querySelectorAll('#modal [data-a="aZweck"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.x === artZweck)));
    // Bekleidung ist immer Art „Stück“ (Codegruppe 1xx)
    const art = $("aArt");
    if(artZweck === "kleidung" && art && art.value !== "Stück"){ art.value = "Stück"; C.artGruppe("Stück"); }
    artikelSichtbar();
  },
  grZugang: x => formGroessen(x, "zugang"),
  grZaehlen: x => formGroessen(x, "zaehlen"),
  grSpeichern: () => {
    const f = grForm; if(!f) return;
    const ort = wert("gOrt") || f.ort, werte = [];
    let falsch = false;
    document.querySelectorAll("#modal [data-gr]").forEach(e => {
      const t = String(e.value).trim(); if(t === "") return;
      const n = Number(t.replace(",", "."));
      if(isNaN(n) || n < 0) falsch = true; else werte.push({ gr:e.dataset.gr, n });
    });
    if(falsch){ toast("Ungültige Zahl.", true); return; }
    if(f.art === "zugang"){
      const z = werte.filter(w => w.n > 0);
      if(!z.length){ toast("Keine Menge eingetragen.", true); return; }
      if(z.some(w => !w.gr)){ toast("Zugang nur mit Größe.", true); return; }
      const notiz = wert("gNotiz") || null, summe = z.reduce((m, w) => m + w.n, 0);
      aktion(() => neuIn("buchung", z.map(w => ({ art:"zugang", code:f.code, groesse:w.gr, menge:w.n, ort, notiz, bearbeiter:bearbeiter || null }))),
             "Zugang gebucht · " + zahl(summe) + " in " + ort);
    } else {
      if(!werte.length){ toast("Nichts gezählt.", true); return; }
      aktion(() => rpc("kleidung_zaehlen", { p_code:f.code, p_ort:ort, p_zaehlung:werte.map(w => ({ groesse:w.gr || null, gezaehlt:w.n })) }),
             n => n ? n + (n === 1 ? " Größe korrigiert" : " Größen korrigiert") : "Stimmt bereits");
    }
  },
  leihNeu: () => leihStart(null, ""),
  leihGr: x => {
    const l = leih; if(!l || !l.code) return;
    const p = l.posten.find(z => z.code === l.code && z.gr === x);
    if(p) p.menge += 1; else l.posten.push({ code:l.code, gr:x, menge:1 });
    leihZeichnen();
  },
  leihWeg: x => { if(leih){ leih.posten.splice(Number(x), 1); leihZeichnen(); } },
  leihBuchen: () => {
    const l = leih; if(!l) return;
    if(!l.sportler){ toast("Bitte Sportler wählen.", true); return; }
    if(!l.posten.length){ toast("Noch kein Teil gewählt.", true); return; }
    const knapp = [];
    const sum = {};
    l.posten.forEach(p => { const k = p.code + "|" + p.gr; sum[k] = (sum[k] || 0) + p.menge; });
    Object.keys(sum).forEach(k => { const [c, g] = [k.slice(0, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)];
      const da = hatGroessen(c) ? amOrtGr(c, l.ort, g) : amOrt({ code:c }, l.ort);
      if(sum[k] > da) knapp.push(((artikel(c) || {}).name || c) + " " + grName(g) + " (da: " + zahl(da) + ")"); });
    if(knapp.length && !confirm("Nicht genug im Lager:\n• " + knapp.join("\n• ") + "\n\nTrotzdem ausleihen? Der Bestand wird dann negativ.")) return;
    const n = l.posten.reduce((m, p) => m + p.menge, 0), name = sportlerName(Number(l.sportler));
    aktion(() => rpc("kleidung_ausleihen", { p_sportler:Number(l.sportler), p_ort:l.ort,
                                              p_posten:l.posten.map(p => ({ code:p.code, groesse:p.gr || null, menge:p.menge })), p_notiz:l.notiz || null }),
           zahl(n) + (n === 1 ? " Teil" : " Teile") + " an " + name + " ausgeliehen").then(r => { if(r !== undefined) leih = null; });
  },
  rueckNeu: x => rueckStart(x ? Number(x) : null),
  rueckBuchen: () => {
    const r = rueck; if(!r || !r.sportler) return;
    const l = ausgeliehenVon(Number(r.sportler)), posten = [];
    let falsch = false;
    document.querySelectorAll("#modal [data-rueck]").forEach(e => {
      const z = l[Number(e.dataset.rueck)], n = Number(String(e.value).replace(",", "."));
      if(!z) return;
      if(isNaN(n) || n < 0 || n > num(z.menge)) falsch = true;
      else if(n > 0) posten.push({ code:z.code, groesse:z.groesse || null, menge:n });
    });
    if(falsch){ toast("Menge prüfen — höchstens so viel, wie ausgeliehen ist.", true); return; }
    if(!posten.length){ toast("Nichts zurückzubuchen.", true); return; }
    const ort = wert("rOrt") || r.ort, n = posten.reduce((m, p) => m + p.menge, 0);
    aktion(() => rpc("kleidung_rueckgabe", { p_sportler:Number(r.sportler), p_ort:ort, p_posten:posten }),
           zahl(n) + (n === 1 ? " Teil" : " Teile") + " zurück in " + ort);
  },
  ortLoeschen: x => {
    const o = (DB.lagerorte||[]).find(z => z.id === Number(x)); if(!o) return;
    // Liegt dort etwas, gibt es Buchungen — dann geht nur Deaktivieren (nach dem Leerräumen)
    const da = (DB.bestand||[]).filter(b => amOrt(b, o.name) !== 0).map(b => b.name);
    const st = (DB.stueck||[]).filter(s => s.ort === o.name).map(s => s.nummer);
    if(da.length || st.length){
      alert(o.name + " lässt sich nicht löschen: Dort " + (da.length ? "liegt " + da.slice(0, 3).join(", ") + (da.length > 3 ? " u. a." : "") : "") +
            (da.length && st.length ? " und " : "") + (st.length ? "liegen Einzelstücke (" + st.slice(0, 3).join(", ") + ")" : "") +
            ".\n\nGebuchte Orte bleiben für die Buchungsgeschichte erhalten. Zum Aufräumen: Bestand umbuchen oder per Inventur auf 0 setzen, Einzelstücke umlagern, dann „aktiv“ ausschalten — der Ort verschwindet aus allen Listen.");
      return;
    }
    if(!confirm(o.name + " löschen?" + (o.art === "koffer" ? " Packliste und Termin-Zuordnung gehen mit." : ""))) return;
    aktion(() => rpc("lagerort_loeschen", { p_id:o.id }), o.name + " gelöscht");
  },
  ortHoch: x => {
    // nur unter den aktiven Orten tauschen (so wie sie angezeigt werden), deaktivierte hinten anhängen
    const l = lagerorte(), i = l.findIndex(o => o.id === Number(x));
    if(i <= 0) return;
    const ids = l.map(o => o.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    lagerorte(true).filter(o => !o.aktiv).forEach(o => ids.push(o.id));
    aktion(() => rpc("lagerorte_sortieren", { p_ids:ids }));
  },
  rt: x => { view.rt = x; view.suche = ""; render(); },
  radAuf: x => { modalZu(); view.tab = "raeder"; view.rad = x; view.ticket = null; view.suche = ""; render(); window.scrollTo(0,0); },
  radZu: () => { view.rad = null; render(); window.scrollTo(0,0); },
  geheMehr: x => { if(x === "standorte") standorteCache = undefined; if(x === "konten") kontenCache = undefined; if(x === "benachrichtigungen") pushCache = undefined; view.tab = "mehr"; view.mehr = x; view.suche = ""; render(); window.scrollTo(0,0); },
  mehrZu: () => { view.mehr = null; view.ukKat = null; render(); window.scrollTo(0,0); },
  ticketRad: x => { modalZu(); ticketFuerRad(x); },
  ticketStueck: x => { modalZu(); neuStart(); view.tab = "neu"; view.ticket = null; neuStueckWaehlen(x); window.scrollTo(0,0); },
  teilZeigen: x => { modalZu(); view.tab = "raeder"; view.rt = "teile"; view.rad = null; view.invKat = ""; view.invUk = ""; view.suche = x; render(); window.scrollTo(0,0); },
  teilTausch: x => teilWahl(x),
  teilAb: x => {
    if(!confirm(stueckText(x) + " vom Rad nehmen? Es kommt in die Werkstatt.")) return;
    aktion(() => aendern("stueck", "nummer=eq." + encodeURIComponent(x), { ort:"Werkstatt", rad_id:null }), x + " abgenommen");
  },
  teilTauschOk: x => {
    const [alt, neuNr] = x.split("|"), rid = view.rad;
    aktion(async () => {
      if(alt) await aendern("stueck", "nummer=eq." + encodeURIComponent(alt), { ort:"Werkstatt", rad_id:null });
      await aendern("stueck", "nummer=eq." + encodeURIComponent(neuNr), { ort:"am Rad", rad_id:rid });
    }, alt ? alt + " → " + neuNr + " getauscht" : neuNr + " angebaut");
  },
  oeffnen: x => { view.tab = "tickets"; view.ticket = Number(x); render(); window.scrollTo(0,0); },
  zurueck: () => { view.ticket = null; render(); },
  modalZu: () => modalZu(),
  modalHintergrund: (x, el, ev) => { if(ev.target === el) modalZu(); },
  scan: x => scanStart(x),
  drucken: () => window.print(),

  /* Neues Ticket */
  nArt: x => { neu.art = x; render(); },
  nRadTypAuf: x => { neu.radTypOffen = neu.radTypOffen || {}; neu.radTypOffen[x] = !neu.radTypOffen[x]; const l = $("wahlListe"); if(l) l.innerHTML = wahlListe(); },
  nFahrbereit: x => { neu.fahrbereit = x === "ja"; render(); },
  nOrt: x => { neu.arbeitsort = x; render(); },
  nAufwand: x => { neu.aufwand = x; render(); },
  nTermin: x => { Object.assign(neu, terminWert(x)); render(); },
  nMatWeg: x => { neu.pos.splice(Number(x), 1); render(); },
  nSchrittText: () => {
    const t = wert("nSchritt"), m = wert("nSchrittMin");
    if(!t){ toast("Was ist zu tun?", true); return; }
    neu.pos.push({ titel:t, menge:1, dauer_min: m ? Math.max(0, Math.round(Number(m.replace(",", ".")) || 0)) : null });
    render(); const el = $("nSchritt"); if(el) el.focus();
  },
  anlegen: () => ticketAnlegen(),

  /* Ticket-Detail */
  tTermin: x => { const w = terminWert(x); tAendern(w, "Termin geändert"); },
  tAufwand: x => tAendern({ aufwand:x }),
  tFahrbereit: x => tAendern({ fahrbereit: x === "ja" }),
  pruefen: x => {
    const s = (DB.stueck||[]).find(y => y.nummer === x);
    aktion(() => aendern("stueck", "nummer=eq." + encodeURIComponent(x), { zustand: s.zustand === "frei" ? "zu prüfen" : "frei" }));
  },
  posWeg: x => aktion(() => aendern("ticket_position", "id=eq." + x, { status:"storniert" }), "Schritt entfernt"),
  schrittText: () => {
    const t = ticket(view.ticket); if(!t) return;
    const titel = wert("tSchritt"), m = wert("tSchrittMin");
    if(!titel){ toast("Was ist zu tun?", true); return; }
    aktion(() => neuIn("ticket_position", { ticket_id:t.id, titel, menge:1, dauer_min: m ? Math.max(0, Math.round(Number(m.replace(",", ".")) || 0)) : null }), "Schritt hinzugefügt");
  },
  schrittAb: x => {
    const p = (DB.positionen||[]).find(y => y.id === Number(x)); if(!p) return;
    const t = ticket(p.ticket_id); if(!t) return;
    if(p.code && fehlend(t).indexOf(p.code) >= 0 &&
       !confirm(schrittName(p) + " ist nicht genug da. Trotzdem abhaken? Der Bestand wird dann negativ.")) return;
    aktion(() => rpc("position_erledigen", { p_position:p.id, p_bearbeiter:bearbeiter || null }),
           b => schrittName(p) + " erledigt" + (num(b) ? " · " + eur(b) + " gebucht" : ""))
      .then(b => {
        if(b === undefined) return;
        const tt = ticket(t.id);
        if(tt && !positionen(tt.id).length && schritte(tt.id).length)
          modal('<h3>Alle Schritte erledigt</h3><p class="sub" style="margin-top:-6px">Ticket jetzt schließen?</p><div style="display:grid;gap:8px">' +
                '<button class="btn primary" data-a="erledigt">Ticket schließen</button><button class="btn" data-a="modalZu">Noch offen lassen</button></div>');
      });
  },
  schrittZurueck: x => {
    const p = (DB.positionen||[]).find(y => y.id === Number(x)); if(!p) return;
    if(!confirm(schrittName(p) + " wieder öffnen?" + (p.status === "gebucht" ? " Die Buchung wird storniert." : ""))) return;
    aktion(() => rpc("position_zuruecknehmen", { p_position:p.id, p_bearbeiter:bearbeiter || null }), schrittName(p) + " wieder offen");
  },
  annehmen: () => {
    const t = ticket(view.ticket); if(!t) return;
    const sch = schaetzung(positionen(t.id)), vorschlag = sch ? aufwandVorschlag(sch.min) : null;
    let h = '<h3>Übernehmen</h3><p class="sub" style="margin-top:-6px">Wie groß ist der Arbeitsaufwand?' +
            (sch ? ' Laut Material ' + schaetzText(sch) + ' — Vorschlag: <strong>' + vorschlag + '</strong>.' : '') + '</p><div style="display:grid;gap:8px">';
    const markiert = vorschlag || t.aufwand;
    ["klein","mittel","groß"].forEach(k => h += '<button class="btn' + (markiert === k ? " primary" : "") + '" data-a="annehmenMit" data-x="' + k + '">' + k + ' · ' + AUFWAND[k] + ' T' + (k === vorschlag ? ' · Vorschlag' : '') + '</button>');
    h += '<button class="btn" data-a="modalZu">Abbrechen</button></div>';
    modal(h);
  },
  annehmenMit: x => tAendern({ status:"angenommen", uebernommen_von:bearbeiter || null, aufwand:x }, "Übernommen"),
  erledigt: () => {
    modalZu();
    const t = ticket(view.ticket); if(!t) return;
    const f = fehlend(t);
    if(f.length && !confirm("Es fehlt noch Material (" + f.map(c => (artikel(c)||{}).name || c).join(", ") + "). Trotzdem abschließen? Der Bestand wird dann negativ.")) return;
    aktion(() => rpc("ticket_abschliessen", { p_ticket:t.id, p_bearbeiter:bearbeiter || null }), s => { view.ticket = null; return "Ticket erledigt" + (num(s) ? " · " + eur(s) + " gebucht" : "") + " · steht jetzt im Verlauf"; })
      .then(() => { if(!ticket(t.id)){ view.ticket = null; render(); } });
  },
  stornieren: () => {
    if(!confirm("Ticket stornieren? Offene Schritte werden freigegeben" + (schritte(view.ticket).some(p => p.status === "gebucht") ? ", abgehaktes Material bleibt gebucht." : "."))) return;
    const id = view.ticket;
    aktion(() => rpc("ticket_stornieren", { p_ticket:id, p_bearbeiter:bearbeiter || null }), "Storniert · steht im Verlauf").then(() => { if(!ticket(id)){ view.ticket = null; render(); } });
  },

  /* Lager */
  artikelMenue: x => artikelMenue(x),
  formZugang: x => formZugang(x),
  formAusgabe: x => formAusgabe(x),
  formInventur: x => formInventur(x),
  formEntnahme: x => formEntnahme(x),
  entnahmeBuchen: x => {
    const m = zahlOderNull("fMenge");
    if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    if(!genugDa(x, wert("fOrt"), m)) return;
    const a = artikel(x);
    aktion(() => rpc("material_ausgeben", { p_code:x, p_menge:m, p_ort:wert("fOrt"), p_notiz:wert("fNotiz") || null, p_bearbeiter:bearbeiter || null }),
           "Entnahme gebucht · " + zahl(m) + " " + (a ? a.einheit : ""));
  },
  wEntnahme: x => {
    if(!genugDa(x, "Werkstatt", 1)) return;
    const a = artikel(x);
    aktion(() => rpc("material_ausgeben", { p_code:x, p_menge:1, p_ort:"Werkstatt", p_bearbeiter:bearbeiter || null }),
           () => { const b = bestand(x); return "−1 " + (a ? a.name : x) + " · noch " + zahl(b ? amOrt(b, HAUPT) : 0) + " " + (a ? a.einheit : ""); });
  },
  zugangBuchen: x => {
    const m = zahlOderNull("fMenge");
    if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    aktion(() => neuIn("buchung", { art:"zugang", code:x, menge:m, ort:wert("fOrt"), notiz:wert("fNotiz") || null, bearbeiter:bearbeiter || null }), "Zugang gebucht");
  },
  ausgabeBuchen: x => {
    const m = zahlOderNull("fMenge"), s = wert("fSportler");
    if(!s){ toast("Bitte Sportler wählen.", true); return; }
    if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    if(!genugDa(x, wert("fOrt"), m)) return;
    aktion(() => rpc("material_ausgeben", { p_code:x, p_menge:m, p_ort:wert("fOrt"), p_sportler:Number(s), p_notiz:wert("fNotiz") || null, p_bearbeiter:bearbeiter || null }),
           b => "Gebucht · " + eur(b));
  },
  inventurBuchen: x => {
    const m = zahlOderNull("fMenge");
    if(m === null || m < 0){ toast("Gezählte Menge fehlt.", true); return; }
    aktion(() => rpc("inventur", { p_code:x, p_ort:wert("fOrt"), p_gezaehlt:m, p_bearbeiter:bearbeiter || null }), d => d == 0 ? "Stimmt bereits" : "Korrigiert um " + (d > 0 ? "+" : "") + zahl(d));
  },

  /* Koffer */
  kofferRein: x => { const [c, o] = x.split("|"); if(!genugDa(c, "Werkstatt", 1)) return; aktion(() => rpc("umbuchen", { p_code:c, p_menge:1, p_von:"Werkstatt", p_nach:o, p_bearbeiter:bearbeiter || null })); },
  kofferRaus: x => { const [c, o] = x.split("|"); if(!genugDa(c, o, 1)) return; aktion(() => rpc("umbuchen", { p_code:c, p_menge:1, p_von:o, p_nach:"Werkstatt", p_bearbeiter:bearbeiter || null })); },
  kofferMenge: x => { const [c, o] = x.split("|"); formKofferMenge(c, o); },
  kofferMengeRein: x => {
    const [c, o] = x.split("|"), m = zahlOderNull("fMenge");
    if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    if(!genugDa(c, "Werkstatt", m)) return;
    kofferUmbuchen(c, "Werkstatt", o, m, zahl(m) + " " + ((artikel(c)||{}).einheit || "") + " eingepackt");
  },
  kofferMengeRaus: x => {
    const [c, o] = x.split("|"), m = zahlOderNull("fMenge");
    if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    if(!genugDa(c, o, m)) return;
    kofferUmbuchen(c, o, "Werkstatt", m, zahl(m) + " " + ((artikel(c)||{}).einheit || "") + " zurück in die Werkstatt");
  },
  kofferAuffuellen: o => {
    const plan = [], knapp = [];
    (DB.koffer||[]).filter(k => k.ort === o && num(k.fehlt) > 0).forEach(k => {
      const b = bestand(k.code), frei = istLeistung(k.code) || !b ? num(k.fehlt) : Math.max(greifbar(k.code, HAUPT, null), 0);
      const m = Math.min(num(k.fehlt), frei);
      if(m > 0) plan.push({ code:k.code, menge:m });
      if(m < num(k.fehlt)) knapp.push(k.name + " (" + zahl(m) + " von " + zahl(k.fehlt) + ")");
    });
    if(!plan.length){ toast("In der Werkstatt ist nichts davon frei.", true); return; }
    const text = "Einpacken in " + o + ":\n" + plan.map(p => "• " + zahl(p.menge) + " " + ((artikel(p.code)||{}).einheit || "") + " " + ((artikel(p.code)||{}).name || p.code)).join("\n") +
                 (knapp.length ? "\n\nNicht genug frei in der Werkstatt:\n" + knapp.map(t => "• " + t).join("\n") : "") + "\n\nUmbuchen?";
    if(!confirm(text)) return;
    aktion(async () => {
      for(const p of plan) await rpc("umbuchen", { p_code:p.code, p_menge:p.menge, p_von:"Werkstatt", p_nach:o, p_bearbeiter:bearbeiter || null });
      return plan.length;
    }, n => n + (n === 1 ? " Position" : " Positionen") + " eingepackt" + (knapp.length ? " — " + knapp.length + " bleibt offen" : ""));
  },
  terminNeu: () => {
    if(!wert("tDatum") || !wert("tName")){ toast("Datum und Name fehlen.", true); return; }
    aktion(() => neuIn("termin", { datum:wert("tDatum"), name:wert("tName"), koffer:wert("tKoffer") || null }), "Termin eingetragen");
  },
  terminWeg: x => {
    const t = (DB.termine||[]).find(y => y.id === Number(x));
    if(!confirm((t ? t.name + " (" + deLang(t.datum) + ")" : "Termin") + " löschen?")) return;
    aktion(() => loeschen("termin", "id=eq." + x), "Termin gelöscht");
  },

  /* Inventar */
  stueckNeu: () => stueckForm(null),
  stueckBearbeiten: x => stueckForm(x),
  stueckSpeichern: x => {
    let kauf;
    try{ kauf = kaufWert("eKauf"); }catch(e){ toast(e.message, true); return; }
    const d = { typ:wert("eTyp"), marke:marke(wert("eMarke")), detail:wert("eDet") || null, seriennummer:wert("eSer") || null, kaufdatum:kauf, notiz:wert("eNotiz") || null };
    const tags = ukFormWert();   // undefined = ohne Tag-Feld (Datenbank noch ohne Tags)
    const mitTags = tags === undefined ? d : Object.assign({}, d, { tags });   // für die Anlege-Funktionen
    const tagsSetzen = nummern => tags === undefined ? null : rpc("tags_setzen", { p_art:"stueck", p_schluessel:nummern, p_tags:tags });
    if(!d.typ){ toast("Typ fehlt.", true); return; }
    if(x){ aktion(async () => { await aendern("stueck", "nummer=eq." + encodeURIComponent(x), d); await tagsSetzen([x]); }, "Gespeichert"); return; }
    if(nrForm && nrForm.modus === "auto"){
      const kp = nrKategoriePruefen(); if(!kp) return;
      const b = kp.b;
      const n = Number(wert("eAnzahl") || 1);
      if(!Number.isInteger(n) || n < 1 || n > 50){ toast("Anzahl: 1 bis 50.", true); return; }
      if(n === 1){
        aktion(async () => { await kp.anlegen(); return rpc("stueck_anlegen", { p_buchstabe:b, p_gruppe:Number(wert("nrGruppe")), p_daten:mitTags }); }, nr => nr + " angelegt")
          .then(nr => { if(nr) etikettDialog([etikettStueck(stueckNr(nr) || Object.assign({ nummer:nr }, d))], nr + " angelegt — Etikett drucken?"); });
        return;
      }
      d.seriennummer = null; mitTags.seriennummer = null;
      aktion(async () => { await kp.anlegen(); return rpc("stueck_serie_anlegen", { p_buchstabe:b, p_gruppe:Number(wert("nrGruppe")), p_daten:mitTags, p_anzahl:n }); },
             l => l.length + " Stück angelegt: " + l[0] + " bis " + l[l.length - 1])
        .then(l => { if(l && l.length) etikettDialog(l.map(nr => etikettStueck(stueckNr(nr) || Object.assign({ nummer:nr }, d))), l.length + " Stück angelegt — Etiketten drucken?"); });
      return;
    }
    if(Number(wert("eAnzahl") || 1) > 1){ toast("Mehrere Stück auf einmal nur mit automatischer Nummer.", true); return; }
    const nr = mitKuerzel(wert("nrEigenWert"));
    if(!nr){ toast("Nummer fehlt.", true); return; }
    if(!NUMMER_FORMAT.test(nr)){ toast("Nummer: nur Buchstaben, Ziffern und Bindestriche.", true); return; }
    if(nummerVergeben(nr) || rad(nr)){ toast(nr + " ist schon vergeben.", true); return; }
    aktion(async () => { await neuIn("stueck", Object.assign({ nummer:nr }, d)); await tagsSetzen([nr]); }, nr + " angelegt");
  },

  /* Verwaltung */
  sportlerNeu: () => { const n = wert("sName"); if(!n){ toast("Name fehlt.", true); return; } aktion(() => neuIn("sportler", { name:n }), n + " angelegt"); },
  sportlerAbr: x => { const s = DB.sportler.find(y => y.id === Number(x)); aktion(() => aendern("sportler", "id=eq." + x, { abrechnen:!s.abrechnen })); },
  sportlerAktiv: x => { const s = DB.sportler.find(y => y.id === Number(x)); aktion(() => aendern("sportler", "id=eq." + x, { aktiv:!s.aktiv })); },
  radNeu: () => { radForm(null); vorschauNummer(); },
  radBearbeiten: x => radForm(x),
  radSpeichern: x => {
    const d = { bezeichnung:wert("rBez"), typ:wert("rTyp"), marke:marke(wert("rMarke")), rahmennummer:wert("rRahmen") || null, groesse:wert("rGr") || null,
                eigentuemer_id: wert("rEig") ? Number(wert("rEig")) : null, notiz:wert("rNotiz") || null, aktiv: wert("rAktiv") === "true" };
    if(!d.bezeichnung){ toast("Bezeichnung fehlt.", true); return; }
    if(x){ aktion(() => aendern("rad", "id=eq." + encodeURIComponent(x), d), "Gespeichert"); return; }
    if(nrForm && nrForm.modus === "auto"){
      aktion(() => rpc("rad_anlegen", { p_daten:d }), id => d.bezeichnung + " angelegt als " + id);
      return;
    }
    const id = radIdAusEingabe(wert("nrEigenWert"), d.typ);
    if(!id){ toast(radVorlage() ? "Bitte die Nummer (Zahl) eintragen." : "Rad-ID fehlt.", true); return; }
    if(!NUMMER_FORMAT.test(id)){ toast("Rad-ID: nur Buchstaben, Ziffern und Bindestriche.", true); return; }
    if(rad(id) || nummerVergeben(id)){ toast(id + " ist schon vergeben.", true); return; }
    aktion(() => neuIn("rad", Object.assign({ id }, d)), d.bezeichnung + " angelegt");
  },
  artikelNeu: x => artikelForm(null, x),
  artikelBearbeiten: x => artikelForm(x),
  artikelSpeichern: x => {
    const kleid = artZweck === "kleidung";
    const d = { name:wert("aName"), einheit:wert("aEinheit") || "Stück", preis:zahlOderNull("aPreis") || 0, mindestbestand:zahlOderNull("aMin") || 0,
                lieferzeit_tage: !kleid && wert("aArt") === "Pauschale" ? 0 : Math.max(0, Math.round(zahlOderNull("aLz") || 0)), art:kleid ? "Stück" : wert("aArt"), verbraucht_code:wert("aVerb") || null,
                verbrauch_menge: zahlOderNull("aVerbM"), lieferant:wert("aLief") || null, bestellnummer:wert("aBest") || null,
                shop_link:wert("aLink") || null, aktiv: wert("aAktiv") === "true",
                dauer_min: zahlOderNull("aDauer") == null ? null : Math.max(0, Math.round(zahlOderNull("aDauer"))) };
    // Werkstatt-Artikel haben keine Größen; Bekleidung braucht welche
    let gr = null;
    if(kleid){
      gr = groessenLesen(wert("aGroessen"));
      if(gr === false) return;
      if(!gr){ toast("Bitte Größen eintragen (oder „One Size“).", true); return; }
    } else if(x && hatGroessen(x) && !confirm("Als Werkstatt-Artikel speichern? Die Größen (" + groessen(x).join(", ") + ") werden entfernt.")) return;
    d.groessen = gr;
    const tags = ukFormWert();   // undefined = ohne Tag-Feld (Datenbank noch ohne Tags)
    const tagsSetzen = c => tags === undefined ? null : rpc("tags_setzen", { p_art:"artikel", p_schluessel:[c], p_tags:tags });
    if(!d.name){ toast("Bezeichnung fehlt.", true); return; }
    if(x){ aktion(async () => { await aendern("artikel", "code=eq." + encodeURIComponent(x), d); await tagsSetzen(x); }, "Gespeichert"); return; }
    // Anfangsbestand: wird direkt nach dem Anlegen als Zugang gebucht (nicht bei Pauschalen).
    // Bekleidung: je Größe ins gewählte Bekleidungslager.
    const startGr = [];
    let falsch = false;
    if(kleid) document.querySelectorAll("#modal [data-agr]").forEach(e => {
      const t = String(e.value).trim(); if(t === "") return;
      const n = Number(t.replace(",", "."));
      if(isNaN(n) || n < 0) falsch = true; else if(n > 0 && gr.indexOf(e.dataset.agr) >= 0) startGr.push({ gr:e.dataset.agr, n });
    });
    if(falsch){ toast("Bestand: ungültige Zahl.", true); return; }
    const start = kleid ? startGr.reduce((m, w) => m + w.n, 0) : d.art === "Pauschale" ? 0 : (zahlOderNull("aBestand") || 0);
    if(start < 0){ toast("Bestand darf nicht negativ sein.", true); return; }
    const startOrt = (kleid ? wert("aKleidOrt") : wert("aBestandOrt")) || "Werkstatt";
    const mitBestand = async c => {
      if(kleid && startGr.length) await neuIn("buchung", startGr.map(w => ({ art:"zugang", code:c, groesse:w.gr, menge:w.n, ort:startOrt, notiz:"Anfangsbestand", bearbeiter:bearbeiter || null })));
      else if(!kleid && start > 0) await neuIn("buchung", { art:"zugang", code:c, menge:start, ort:startOrt, notiz:"Anfangsbestand", bearbeiter:bearbeiter || null });
      return c;
    };
    const meldung = c => c + " angelegt" + (start > 0 ? " · " + zahl(start) + " " + d.einheit + " in " + startOrt : "");
    const etikett = c => { if(c) etikettDialog([etikettArtikel(artikel(c) || Object.assign({ code:c }, d))], meldung(c) + " — Etikett drucken?", true); };
    if(nrForm && nrForm.modus === "auto"){
      const kp = nrKategoriePruefen(); if(!kp) return;
      const b = kp.b;
      aktion(async () => { await kp.anlegen(); return mitBestand(await rpc("artikel_anlegen", { p_buchstabe:b, p_gruppe:Number(wert("nrGruppe")), p_daten:tags === undefined ? d : Object.assign({}, d, { tags }) })); }, meldung).then(etikett);
      return;
    }
    const code = mitKuerzel(wert("nrEigenWert"));
    if(!/^[A-Z]{2,3}-[A-Z]{1,3}-[0-9]+$/.test(code)){ toast("Code im Format B-120.", true); return; }
    if(nummerVergeben(code)){ toast(code + " ist schon vergeben.", true); return; }
    aktion(async () => { await neuIn("artikel", Object.assign({ code }, d)); await tagsSetzen(code); return mitBestand(code); }, meldung).then(etikett);
  },
  rechnungErstellen: x => {
    if(!confirm("Rechnung für " + sportlerName(Number(x)) + " über alle offenen Posten erstellen?")) return;
    aktion(() => rpc("rechnung_erstellen", { p_sportler:Number(x) }), "Rechnung erstellt");   // Zeitraum: alles bis heute (Datenbankzeit)
  },
  rechnungZeigen: x => rechnungZeigen(Number(x)),
  rechnungDrucken: x => rechnungDrucken(Number(x)),
  rechnungStatus: x => {
    const r = DB.rechnungen.find(y => y.id === Number(x));
    if(r.status === "bezahlt" && !confirm(r.nummer + " wieder auf „offen“ setzen?")) return;
    aktion(() => aendern("rechnung", "id=eq." + x, { status: r.status === "offen" ? "bezahlt" : "offen" })); },
  export: x => exportiere(x),

  /* Neues Ticket: Rad oder Einzelstück */
  nWahlRad: x => { radImNeuen(x); neu.wahlSuche = ""; render(); },
  nWahlStueck: x => { if(!neu.rad && !neu.stuecke.length) neu.pickerOffen = true; neuStueckUmschalten(x); },
  nWahlSerie: x => {
    const l = x.split(","), alle = l.every(n => neu.stuecke.indexOf(n) >= 0);
    if(alle) neu.stuecke = neu.stuecke.filter(n => l.indexOf(n) < 0);
    else l.forEach(n => neuStueckWaehlen(n, true));
    neu.pickerOffen = true; render();
  },
  nRadWeg: () => { const alt = neu.rad; neu.rad = ""; neu.stuecke = neu.stuecke.filter(n => (stueckNr(n) || {}).rad_id !== alt); render(); },
  nPickerAuf: () => { neu.pickerOffen = true; neu.loseOffen = true; render(); },
  nPickerZu: () => { neu.pickerOffen = false; neu.wahlSuche = ""; render(); },
  nLoseAuf: () => { neu.loseOffen = !neu.loseOffen; const l = $("wahlListe"); if(l) l.innerHTML = wahlListe(); },
  nKatAuf: x => { neu.katOffen = neu.katOffen || {}; neu.katOffen[x] = !neu.katOffen[x]; const l = $("wahlListe"); if(l) l.innerHTML = wahlListe(); },
  nTeil: x => neuStueckUmschalten(x),

  /* Fotos */
  fotoZeigen: x => fotoZeigen(Number(x)),
  fotoLoeschen: x => {
    if(!confirm("Foto löschen?")) return;
    delete fotoCache[view.ticket];
    aktion(() => loeschen("foto", "id=eq." + Number(x)), "Foto gelöscht");
  },
  nFotoWeg: x => { neu.fotos = neu.fotos.filter(f => f.client_id !== x); render(); },

  /* Bestellliste */
  bestellZu: () => { view.mat = "lager"; render(); },
  bestellMarkieren: x => {
    const e = bestellBedarf().find(y => y.a.code === x); if(!e) return;
    modal('<h3>Als bestellt markieren</h3><p class="sub" style="margin-top:-6px">' + esc(e.a.name) + ' · ' + esc(e.a.code) + '</p>' +
          feld("Bestellte Menge (" + esc(e.a.einheit) + ")", "bMenge", e.rest, "number", ' min="0" step="any" inputmode="decimal"') +
          '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="bestellSpeichern" data-x="' + esc(x) + '">Bestellt</button></div>');
  },
  bestellSpeichern: x => {
    const m = zahlOderNull("bMenge"); if(!m || m <= 0){ toast("Menge fehlt.", true); return; }
    aktion(() => neuIn("bestellung", { code:x, menge:m, bearbeiter:bearbeiter || null }), "Als bestellt markiert");
  },
  bestellAlle: x => {
    const g = bestellBedarf().filter(y => (y.a.lieferant || "") === x && y.rest > 0);
    if(!g.length || !confirm(g.length + " Artikel" + (x ? " bei " + x : "") + " als bestellt markieren (jeweils die vorgeschlagene Menge)?")) return;
    aktion(() => neuIn("bestellung", g.map(y => ({ code:y.a.code, menge:y.rest, bearbeiter:bearbeiter || null }))), g.length + " Artikel als bestellt markiert");
  },
  bestellZurueck: x => {
    if(!confirm("Bestellung zurücknehmen?")) return;
    aktion(() => loeschen("bestellung", "id=eq." + Number(x)), "Bestellung zurückgenommen");
  },
  bestellWarenkorb: x => {
    const w = warenkorbPositionen(x); if(!w.mit.length) return;
    if(!w.ohne.length){ warenkorbSenden(w.mit); toast(w.mit.length + " Positionen an den Warenkorb geschickt"); return; }
    modal('<h3>In Warenkorb legen</h3><p>' + w.mit.length + ' Artikel kommen in den Warenkorb. Ohne Produkt-Link (bitte von Hand dazulegen):</p>' +
          '<ul>' + w.ohne.map(y => '<li>' + zahl(y.rest) + ' ' + esc(y.a.einheit) + ' ' + esc(y.a.name) + '</li>').join("") + '</ul>' +
          '<p class="sub">Damit ein Artikel automatisch mitkommt, als Shop-Link die Form <span class="mono">bike-discount.de/de/detail/&lt;Produkt-ID&gt;</span> eintragen.</p>' +
          '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span><button class="btn primary" data-a="bestellWarenkorbOk" data-x="' + esc(x) + '">Warenkorb öffnen</button></div>');
  },
  bestellWarenkorbOk: x => { const n = warenkorbSenden(warenkorbPositionen(x).mit); modalZu(); if(n) toast(n + " Positionen an den Warenkorb geschickt"); },
  bestellKopieren: async x => {
    const t = bestellText(x);
    try{ await navigator.clipboard.writeText(t); toast("Bestellliste kopiert"); }
    catch(e){ modal('<h3>Bestellliste</h3><textarea rows="10" style="width:100%">' + esc(t) + '</textarea><button class="btn voll" data-a="modalZu">Schließen</button>'); }
  },

  /* Etiketten */
  serieEtiketten: x => { const g = (DB.stueck||[]).filter(s => serienSchluessel(s) === x && s.ort !== "ausgemustert"); etikettDialog(g.map(etikettStueck), g.length + " Etiketten · " + g[0].typ); },
  stueckEtikett: x => { const s = stueckNr(x); if(s) etikettDialog([etikettStueck(s)], "Etikett " + x); },
  artikelEtikett: x => { const a = artikel(x); if(a) etikettDialog([etikettArtikel(a)], "Etikett " + a.name, true); },
  radEtikett: x => { const r = rad(x); if(r) etikettDialog([etikettRad(r)], "QR-Etikett " + r.bezeichnung); },
  radEtikettenAlle: () => { const l = (DB.raeder||[]).filter(r => r.aktiv); etikettDialog(l.map(etikettRad), "QR-Etiketten · " + l.length + " Räder"); },
  etDrucken: () => {
    const v = vorlage(wert("etVorlage")), start = Math.min(felderJeSeite(v), Math.max(1, Number(wert("etStart") || 1)));
    const k = Math.min(50, Math.max(1, Number(wert("etKopien") || 1)));
    const wahl = document.querySelector('input[name="etCode"]:checked'), art = wahl && wahl.value === "bar" ? "bar" : "qr";
    try{ localStorage.setItem("wEtikettVorlage", v.id); localStorage.setItem("wEtikettCode", art); if($("etKurz")) localStorage.setItem("wEtikettKurz", $("etKurz").checked ? "1" : "0"); }catch(e){}
    const items = etikettAuftrag || [], quelle = etikettQuelle, leeren = !!($("etLeeren") && $("etLeeren").checked);
    let schmal = 0;
    if(art === "bar" && !v.tasche){
      const fehler = items.find(it => { try{ code128Werte(it.bc); return false; }catch(e){ return true; } });
      if(fehler){ toast("„" + fehler.titel + "“ enthält Zeichen, die als Barcode nicht gehen — bitte QR-Code wählen.", true); return; }
      schmal = Math.min.apply(null, items.map(it => barModulMm(barText(it), barBreiteMm(v))));
    }
    modalZu();
    if(quelle === "druckliste" && leeren){ drucklisteSpeichern([]); render(); }
    if(art === "bar" && !v.tasche && schmal < 0.19) toast("Achtung: Der Barcode wird sehr fein (Strich " + schmal.toFixed(2).replace(".", ",") + " mm) — ggf. breitere Etiketten oder QR-Code nehmen.", true);
    etikettenDrucken(items, v, v.seite === "A4" ? start : 1, k, false, art);
  },
  etBilder: () => {
    const v = vorlage(wert("etVorlage")), wahl = document.querySelector('input[name="etCode"]:checked'), art = wahl && wahl.value === "bar" ? "bar" : "qr";
    try{ localStorage.setItem("wEtikettVorlage", v.id); localStorage.setItem("wEtikettCode", art); if($("etKurz")) localStorage.setItem("wEtikettKurz", $("etKurz").checked ? "1" : "0"); }catch(e){}
    const items = etikettAuftrag || [];
    if(v.tasche){ toast("Laufradtaschen-Tags gibt es nur zum Drucken auf A4 — bitte „Drucken“ nehmen.", true); return; }
    if(art === "bar"){
      const fehler = items.find(it => { try{ code128Werte(it.bc); return false; }catch(e){ return true; } });
      if(fehler){ toast("„" + fehler.titel + "“ enthält Zeichen, die als Barcode nicht gehen — bitte QR-Code wählen.", true); return; }
    }
    if(items.length > 60){ toast("Höchstens 60 Bilder auf einmal — bitte weniger auswählen.", true); return; }
    etikettBilderZeigen(items, v, art).catch(e => toast(e.message, true));
  },
  etTeilen: x => etikettBilderTeilen(x),
  sortWahl: x => { const [p, a] = x.split("|"); sortSetzen(p, a); render(); },
  etSammeln: () => {
    const k = Math.min(50, Math.max(1, Number(wert("etKopien") || 1)));
    aufDruckliste(etikettAuftrag || [], k);
    modalZu(); render();
    toast("Auf der Druckliste: " + drucklisteAnzahl() + " Etiketten — Mehr → Etiketten");
  },
  etZurueck: () => etikettDialog(etikettAuftrag || [], "Etiketten drucken", false, etikettQuelle),
  vorlagenVerwalten: () => vorlagenVerwalten(),
  vorlageForm: x => vorlageForm(x),
  vorlageSpeichern: x => {
    const n = id => Number(String(wert(id) || "0").replace(",", "."));
    const v = { id:x || "eigen_" + Date.now(), eigen:true, name:wert("vName"), form:wert("vForm"), seite:wert("vSeite"),
                b:n("vB"), h:wert("vForm") === "rund" ? n("vB") : n("vH"), sp:Math.round(n("vSp")), ze:Math.round(n("vZe")),
                ro:n("vRo"), li:n("vLi"), ah:n("vAh"), av:n("vAv") };
    if(!v.name){ toast("Bitte einen Namen eingeben.", true); return; }
    if(!(v.b > 0 && v.h > 0)){ toast("Breite und Höhe fehlen.", true); return; }
    if(v.seite === "A4"){
      if(!(v.sp >= 1 && v.ze >= 1)){ toast("Spalten und Zeilen fehlen.", true); return; }
      const breit = v.li + v.sp * v.b + (v.sp - 1) * v.ah, hoch = v.ro + v.ze * v.h + (v.ze - 1) * v.av;
      if(breit > 210.5 || hoch > 297.5){ toast("Passt nicht auf A4 (" + breit.toFixed(1) + " × " + hoch.toFixed(1) + " mm) — Maße prüfen.", true); return; }
    }
    const l = eigeneVorlagen().filter(y => y.id !== v.id); l.push(v); eigeneSpeichern(l);
    try{ localStorage.setItem("wEtikettVorlage", v.id); }catch(e){}
    toast("Gespeichert: " + v.name); vorlagenVerwalten();
  },
  vorlageLoeschen: x => { if(!confirm("Diese Etiketten-Art löschen?")) return; eigeneSpeichern(eigeneVorlagen().filter(y => y.id !== x)); vorlagenVerwalten(); },
  vorlageTest: x => { modalZu(); etikettenDrucken([], vorlage(x), 1, 1, true); },
  /* Druckliste */
  dlEntfernen: x => { const [t, id] = x.split("|"); drucklisteSpeichern(druckliste().filter(e => !(e.typ === t && e.id === id))); render(); },
  dlLeeren: () => { if(!confirm("Druckliste leeren?")) return; drucklisteSpeichern([]); render(); },
  dlDrucken: () => {
    const items = [];
    druckliste().forEach(e => { const it = etikettAus(e); if(it) for(let i = 0; i < (e.n || 1); i++) items.push(it); });
    if(!items.length){ toast("Die Druckliste ist leer.", true); return; }
    etikettDialog(items, "Druckliste drucken", false, "druckliste");
  },
  dlAlle: x => { document.querySelectorAll('[data-dl="' + x + '"]').forEach(c => c.checked = true); },
  dlKeine: x => { document.querySelectorAll('[data-dl="' + x + '"]').forEach(c => c.checked = false); },
  dlAuswahl: () => {
    const items = [];
    document.querySelectorAll("[data-dl]:checked").forEach(c => c.value.split(",").forEach(v => {
      const [t, id] = v.split("|"); const it = etikettAus({ typ:t, id }); if(it) items.push(it);
    }));
    if(!items.length){ toast("Nichts ausgewählt.", true); return; }
    aufDruckliste(items, 1); render(); window.scrollTo(0,0);
    toast(items.length + " Etiketten zur Druckliste hinzugefügt");
  },
  zurDruckliste: () => { modalZu(); view.tab = "mehr"; view.mehr = "etiketten"; render(); window.scrollTo(0,0); },
  zeigAus: () => { view.zeigAus = !view.zeigAus; render(); },

  /* Lager/Inventar: Kategorie → Tag (x = "l|L" bzw. "inv|L"; leer = zurück) */
  katFilter: x => { const [p, k] = x.split("|"); view[p + "Kat"] = k || ""; view[p + "Uk"] = ""; render(); },
  ukFilter: x => { const [p, u] = x.split("|"); view[p + "Uk"] = view[p + "Uk"] === u ? "" : u; render(); },
  ukVerwalten: x => { view.tab = "mehr"; view.mehr = "tags"; view.ukKat = x || null; view.suche = ""; render(); window.scrollTo(0,0); },
  serieAuf: x => { if(!view.serieOffen) view.serieOffen = {}; view.serieOffen[x] = !view.serieOffen[x]; render(); },

  stueckLoeschen: x => stueckeLoeschen([x]),
  stFahrbereit: (x, el) => { stFahrbereit = x === "ja"; el.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.x === x))); },
  stueckTicketAnlegen: x => {
    const s = stueckNr(x); if(!s) return;
    const problem = wert("stProblem");
    if(!problem){ toast("Bitte kurz beschreiben, was ist.", true); return; }
    aktion(() => rpc("ticket_anlegen", { p_rad:s.rad_id || null, p_stueck:x, p_problem:problem, p_fahrbereit:s.rad_id ? stFahrbereit : true,
                                         p_bearbeiter:bearbeiter || null, p_client_id:neueId() }),
           id => "Ticket " + tnr(id) + " angelegt");
  },
  tsDazu: () => { tsSuche = ""; tsDazuForm(); },
  tsNimm: async x => {
    const t = ticket(view.ticket); if(!t) return;
    const l = x.split(",");
    const r = await aktion(() => rpc("ticket_stuecke_aendern", { p_ticket:t.id, p_mit:l }), l.join(", ") + " im Ticket");
    if(r !== undefined && ticket(t.id)) tsDazuForm();   // offen lassen, um weitere dazuzunehmen
  },
  tsWeg: x => {
    const t = ticket(view.ticket); if(!t) return;
    if(!confirm(stueckText(x) + " aus " + tnr(t.id) + " nehmen?")) return;
    aktion(() => rpc("ticket_stuecke_aendern", { p_ticket:t.id, p_ohne:[x] }), x + " aus dem Ticket genommen");
  },
  zumTicket: x => { view.tab = "tickets"; view.ticket = Number(x); view.suche = ""; render(); window.scrollTo(0,0); },
  katKlapp: x => {
    const [p, k] = x.split("|"), key = KAT_QUELLE[p].zuKey, l = katZu(key), i = l.indexOf(k);
    if(i >= 0) l.splice(i, 1); else l.push(k);
    katZuSpeichern(l, key); render();
  },
  katAlle: x => {
    const [p, w] = x.split("|"), key = KAT_QUELLE[p].zuKey;
    const alle = p === "l" ? (DB.bestand||[]).map(b => stueckKategorie(b.code)) : (DB.stueck||[]).map(s => stueckKategorie(s.nummer));
    katZuSpeichern(w === "zu" ? Array.from(new Set(alle)) : [], key); render();
  },

  /* Mehr → Tags */
  ukKatAuf: x => { view.ukKat = x; render(); window.scrollTo(0,0); },
  ukKatZu: () => { view.ukKat = null; render(); window.scrollTo(0,0); },
  katUmbenennen: x => {
    const alt = katNamen()[x] || "";
    modal('<h3>Kategorie ' + esc(x) + '</h3><p class="sub" style="margin-top:-6px">Nur der Name ändert sich — Codes und Etiketten bleiben gleich.</p>' + feld("Name", "katName", alt) +
          '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><span class="sp"></span>' +
          '<button class="btn primary" data-a="katNameSpeichern" data-x="' + esc(x) + '">Speichern</button></div>');
  },
  katNameSpeichern: x => {
    const n = wert("katName").trim(); if(!n){ toast("Name fehlt.", true); return; }
    const namen = katNamen();
    if(Object.keys(namen).some(k => k !== x && namen[k].toLowerCase() === n.toLowerCase())){ toast("„" + n + "“ gibt es schon.", true); return; }
    // Upsert: Buchstaben, die bisher nur in Codes vorkamen, bekommen so erstmals einen Namen.
    aktion(() => rest("/kategorie?on_conflict=buchstabe", { method:"POST", body:{ buchstabe:x, name:n },
                      headers:{ Prefer:"resolution=merge-duplicates,return=minimal" } }), "Gespeichert");
  },
  ukNeu: x => {
    const n = wert("ukNeuName");
    if(!n){ toast("Name fehlt.", true); return; }
    const l = tagListe(x);
    if(l.some(t => t.name.toLowerCase() === n.toLowerCase())){ toast(n + " gibt es schon.", true); return; }
    const sort = l.reduce((m, t) => Math.max(m, t.sortierung), -1) + 1;
    aktion(() => neuIn("tag", { buchstabe:x, name:n, sortierung:sort }), n + " angelegt");
  },
  ukHoch: x => {
    const t = tagNachId(x); if(!t) return;
    const l = tagListe(t.buchstabe), i = l.indexOf(t); if(i <= 0) return;
    l.splice(i, 1); l.splice(i - 1, 0, t);
    // Reihenfolge neu durchnummerieren — nur Zeilen schreiben, die sich ändern
    aktion(async () => { for(let j = 0; j < l.length; j++) if(l[j].sortierung !== j) await aendern("tag", "id=eq." + l[j].id, { sortierung:j }); });
  },
  ukUmbenennen: x => {
    const t = tagNachId(x); if(!t) return;
    modal('<h3>Tag bearbeiten</h3><p class="sub" style="margin-top:-6px">' + esc(kategorieName(t.buchstabe)) + '</p>' + feld("Name", "ukName", t.name) +
          '<div class="row" style="gap:8px"><button class="btn" data-a="modalZu">Abbrechen</button><button class="btn small" data-a="ukLoeschen" data-x="' + t.id + '">Löschen</button>' +
          '<span class="sp"></span><button class="btn primary" data-a="ukNameSpeichern" data-x="' + t.id + '">Speichern</button></div>');
  },
  ukNameSpeichern: x => {
    const t = tagNachId(x), n = wert("ukName"); if(!t) return;
    if(!n){ toast("Name fehlt.", true); return; }
    if(tagListe(t.buchstabe).some(y => y.id !== t.id && y.name.toLowerCase() === n.toLowerCase())){ toast(n + " gibt es schon.", true); return; }
    aktion(() => aendern("tag", "id=eq." + t.id, { name:n }), "Umbenannt");
  },
  ukLoeschen: x => {
    const t = tagNachId(x); if(!t) return;
    const n = tagAnzahl(t.id);
    const betr = [n.a ? n.a + " Artikel" : "", n.s ? n.s + (n.s === 1 ? " Einzelstück" : " Einzelstücke") : ""].filter(Boolean).join(" und ");
    if(!confirm("„" + t.name + "“ löschen?" + (betr ? "\n\n" + betr + " verlieren nur diesen Tag, sonst bleibt alles wie es ist." : ""))) return;
    if(view.lUk === String(t.id)) view.lUk = "";
    if(view.invUk === String(t.id)) view.invUk = "";
    aktion(() => loeschen("tag", "id=eq." + t.id), t.name + " gelöscht");
  },
  ukZuordnen: x => ukZuordnenDialog(x),
  uzAlle: () => document.querySelectorAll("[data-uz]").forEach(c => c.checked = true),
  uzOhne: () => document.querySelectorAll("[data-uz]").forEach(c => c.checked = c.dataset.ohne === "1"),
  uzKeine: () => document.querySelectorAll("[data-uz]").forEach(c => c.checked = false),
  ukZuordnenSpeichern: x => {
    const [tab] = x.split("|"), tagId = Number(wert("uzZiel")), t = tagNachId(tagId);
    if(!t) return;
    const mit = [], ohne = [];
    document.querySelectorAll("[data-uz]").forEach(c => { const z = uzZeilen[Number(c.dataset.uz)]; if(z) (c.checked ? mit : ohne).push(...z.werte); });
    const vorher = new Set(uzZeilen.filter(z => z.ids.indexOf(tagId) >= 0).flatMap(z => z.werte));
    const dazu = mit.filter(v => !vorher.has(v)).length, weg = ohne.filter(v => vorher.has(v)).length;
    if(!dazu && !weg){ modalZu(); toast("Nichts geändert."); return; }
    aktion(() => rpc("tag_zuordnen", { p_tag:tagId, p_art:tab, p_mit:mit, p_ohne:ohne }),
           t.name + ": " + [dazu ? dazu + " dazu" : "", weg ? weg + " entfernt" : ""].filter(Boolean).join(", "));
  },
  /* Tags im Formular */
  tagUmschalten: (x, el) => el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")),
  tagNeuImFormular: async () => {
    const k = formKat(); if(!k){ toast("Erst Kategorie wählen.", true); return; }
    const n = (prompt("Neuer Tag in " + kategorieName(k) + ":") || "").trim(); if(!n) return;
    if(offline){ toast("Offline — Änderungen sind erst mit Netz möglich.", true); return; }
    const l = tagListe(k), da = l.find(t => t.name.toLowerCase() === n.toLowerCase());
    const gewaehlt = tagsImFormular();
    try{
      let id = da ? da.id : null;
      if(!id){
        const r = await rest("/tag", { method:"POST", body:{ buchstabe:k, name:n, sortierung:l.reduce((m, t) => Math.max(m, t.sortierung), -1) + 1 }, headers:{ Prefer:"return=representation" } });
        const neuT = Array.isArray(r) ? r[0] : r; id = neuT.id;
        DB.tags = (DB.tags || []).concat([neuT]);
      }
      gewaehlt.push(id);
      const box = $("ukBox"); if(box) box.innerHTML = tagAuswahl(k, gewaehlt);
    }catch(e){ toast(e.message, true); }
  },
  serieBearbeiten: x => serieForm(x),
  serieSpeichern: x => {
    const g = (DB.stueck||[]).filter(s => serienSchluessel(s) === x);
    let kauf;
    try{ kauf = kaufWert("eKauf"); }catch(e){ toast(e.message, true); return; }
    const d = { typ:wert("eTyp"), marke:marke(wert("eMarke")), detail:wert("eDet") || null, notiz:wert("eNotiz") || null };
    if(!d.typ){ toast("Typ fehlt.", true); return; }
    const monate = Array.from(new Set(g.map(s => (s.kaufdatum || "").slice(0, 7))));
    if(kauf){ if(!(monate.length === 1 && monate[0] === kauf.slice(0, 7))) d.kaufdatum = kauf; }   // gleicher Monat: genaue Daten behalten
    else if(monate.length === 1) d.kaufdatum = null;                                               // gemeinsames Datum bewusst geleert
    if(!wert("eNotiz") && new Set(g.map(s => s.notiz || "")).size > 1) delete d.notiz;  // verschiedene Notizen nicht überschreiben
    const tags = ukFormWert();
    aktion(async () => {
      await aendern("stueck", "nummer=in.(" + g.map(s => encodeURIComponent(s.nummer)).join(",") + ")", d);
      if(tags !== undefined) await rpc("tags_setzen", { p_art:"stueck", p_schluessel:g.map(s => s.nummer), p_tags:tags });
    }, g.length + " Stück geändert");
  },
  serieLoeschen: x => stueckeLoeschen((DB.stueck||[]).filter(s => serienSchluessel(s) === x).map(s => s.nummer)),

  /* Storno */
  buchungenArtikel: x => buchungenArtikel(x),
  postenZeigen: x => postenZeigen(Number(x)),
  bStorno: x => grundAbfragen("Buchung stornieren", "Es wird eine Gegenbuchung angelegt; die ursprüngliche Buchung bleibt sichtbar.", "bStornoOk", x, "Stornieren"),
  bStornoOk: x => {
    const g = wert("sGrund"); if(!g){ toast("Bitte einen Grund angeben.", true); return; }
    aktion(() => rpc("buchung_stornieren", { p_buchung:Number(x), p_grund:g, p_bearbeiter:bearbeiter || null }),
           n => n > 1 ? n + " zusammengehörige Buchungen storniert" : "Buchung storniert");
  },
  rStorno: x => {
    const r = DB.rechnungen.find(y => y.id === Number(x));
    grundAbfragen("Rechnung " + esc(r.nummer) + " stornieren", "Nummer und Betrag bleiben als „storniert“ stehen. Die Posten werden wieder offen und kommen in die nächste Rechnung.", "rStornoOk", x, "Rechnung stornieren");
  },
  rStornoOk: x => {
    const g = wert("sGrund"); if(!g){ toast("Bitte einen Grund angeben.", true); return; }
    aktion(() => rpc("rechnung_stornieren", { p_rechnung:Number(x), p_grund:g, p_bearbeiter:bearbeiter || null }), "Rechnung storniert");
  },

  /* Inventur-Modus */
  invStart: () => { view.tab = "material"; view.mat = "inventur"; view.suche = ""; modalZu(); render(); window.scrollTo(0,0); },
  invNeu: x => { inv = { ort:x, start:new Date().toISOString(), ids:{}, z:{} }; (x === INV_ALLE ? orte() : [x]).forEach(o => inv.ids[o] = neueId()); invSpeichern(); invAnsicht = { filter:"alle", buchstabe:"" }; view.tab = "material"; view.mat = "inventur"; view.suche = ""; modalZu(); render(); window.scrollTo(0,0); },
  invPause: () => { view.mat = "lager"; view.suche = ""; render(); },
  invFilter: x => { invAnsicht.filter = x; render(); },
  invBuchstabe: x => { invAnsicht.buchstabe = x; render(); },
  invOk: x => { invSetzen(x, String(invSystem(x))); invWeiter(x); },
  invAbbrechen: () => {
    const n = Object.keys(inv.z).length;
    if(n && !confirm("Zählung verwerfen? " + n + " gezählte Artikel gehen verloren, es wird nichts gebucht.")) return;
    inv = null; invSpeichern(); render();
  },
  invAbschluss: () => invAbschluss(),
  invBuchen: () => {
    const lauf = inv;
    // Je Ort eine Buchung mit eigener Kennung — wird nach einem Abbruch neu gesendet,
    // bucht die Datenbank bereits erledigte Orte nicht noch einmal.
    const jeOrt = {};
    Object.keys(lauf.z).forEach(k => { const t = invTeile(k); (jeOrt[t.ort] = jeOrt[t.ort] || []).push({ code:t.code, gezaehlt:num(lauf.z[k].g), basis:num(lauf.z[k].b) }); });
    aktion(async () => {
      let summe = 0;
      for(const o of Object.keys(jeOrt)){
        if(!lauf.ids[o]) lauf.ids[o] = neueId();
        summe += await rpc("inventur_buchen", { p_ort:o, p_zaehlung:jeOrt[o], p_bearbeiter:bearbeiter || null, p_lauf:lauf.ids[o] });
      }
      return summe;
    }, n => "Inventur gebucht · " + n + " Korrektur" + (n === 1 ? "" : "en"))
      .then(r => { if(r !== undefined && inv === lauf){ inv = null; invSpeichern(); view.mat = "lager"; render(); } });
  },

  /* Nummernvergabe */
  nrAendern: x => { const i = x.indexOf("|"); nummerAendernForm(x.slice(0, i), x.slice(i + 1)); },
  nrAendernOk: x => {
    const i = x.indexOf("|"), art = x.slice(0, i), alt = x.slice(i + 1);
    const nr = nummerAusFormular(art, alt);
    if(!nr || nr === kuerzel() + "-"){ toast("Neue Nummer fehlt.", true); return; }
    if(nr === alt){ modalZu(); return; }
    if(!NUMMER_FORMAT.test(nr)){ toast("Nur Buchstaben, Ziffern und Bindestriche.", true); return; }
    if(art === "artikel" && !/^[A-Z]{2,3}-[A-Z]{1,3}-[0-9]+$/.test(nr)){ toast("Code im Format B-120.", true); return; }
    if(nummerVergeben(nr) || rad(nr)){ toast(nr + " ist schon vergeben.", true); return; }
    if(!confirm(alt + " → " + nr + "\n\nNummer ändern? Das alte Etikett passt danach nicht mehr.")) return;
    aktion(() => rpc("nummer_aendern", { p_art:art, p_alt:alt, p_neu:nr }), n => alt + " → " + n)
      .then(n => {
        if(!n) return;
        if(view.rad === alt){ view.rad = n; render(); }
        const et = art === "rad" ? (rad(n) && etikettRad(rad(n))) : art === "stueck" ? (stueckNr(n) && etikettStueck(stueckNr(n))) : (artikel(n) && etikettArtikel(artikel(n)));
        if(et) etikettDialog([et], alt + " → " + n + " — neues Etikett drucken?");
      });
  },
  radNrSpeichern: () => {
    const v = wert("rnVorlage").toUpperCase().replace(/\s+/g, ""), n = Number(wert("rnStellen"));
    if(v && !/^[A-Z0-9]+(-[A-Z0-9]+){0,3}$/.test(v)){ toast("Fester Teil: Buchstaben und Ziffern, Teile mit Bindestrich, z. B. HSG-TR.", true); return; }
    aktion(() => rpc("rad_nummern_setzen", { p_vorlage:v || null, p_stellen:n }), "Rad-Nummern gespeichert");
  },
  nrModus: (x, el) => {
    if(!nrForm) return;
    nrForm.modus = x;
    el.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.x === x)));
    $("nrAuto").hidden = x !== "auto"; $("nrEigen").hidden = x !== "eigen";
    if(x === "auto") vorschauNummer(); else { const e = $("nrEigenWert"); if(e) e.focus(); }
    ukBoxAktualisieren();
  },

  /* Abgelehnte Offline-Tickets */
  fehlerZeigen: () => fehlerZeigen(),
  fehlerNochmal: x => {
    const f = fehlerListe(), e = f.find(y => y.op.p_client_id === x);
    if(!e) return;
    speichereFehler(f.filter(y => y !== e));
    inWarteschlange(e.op);
    modalZu(); render();
    sendeWarteschlange();
  },
  fehlerVerwerfen: x => {
    if(!confirm("Ticket endgültig verwerfen? Es ist nur auf diesem Gerät gespeichert.")) return;
    speichereFehler(fehlerListe().filter(y => y.op.p_client_id !== x));
    fehlerZeigen(); render();
  }
};

/** Änderungen an Feldern, verteilt über data-c. */
const C = {
  uzTag: v => { const l = $("uzListe"); if(l) l.innerHTML = uzListe(Number(v)); },
  suche: v => { view.suche = v; },
  nRad: v => { neu.rad = v; render(); },
  nProblem: v => { neu.problem = v; },
  nAnlass: v => { neu.anlass = v; },
  nDatum: v => { neu.soll_fertig = v || null; neu.naechstmoeglich = false; render(); },
  nMat: v => { if(v) neuMaterial(v); },
  tDatum: v => tAendern({ soll_fertig:v || null, naechstmoeglich:false }, "Termin geändert"),
  tAnlass: v => tAendern({ anlass:v || null }),
  tOrt: v => tAendern({ arbeitsort:v }),
  tKosten: v => tAendern({ kostentraeger_id: v ? Number(v) : null }),
  tMatWahl: v => { if(v) reservieren(v); },
  posMenge: (v, x) => {
    const n = Number(String(v).replace(",", "."));
    if(v === "" || isNaN(n) || n < 0){ render(); return; }
    aktion(() => aendern("ticket_position", "id=eq." + x, n === 0 ? { status:"storniert" } : { menge:n }),
           n === 0 ? "Reservierung freigegeben" : "Menge geändert");
  },
  nMenge: (v, x) => {
    const n = Number(String(v).replace(",", "."));
    if(v === "" || isNaN(n) || n < 0){ render(); return; }
    if(n === 0) neu.pos.splice(Number(x), 1);
    else { const p = neu.pos[Number(x)]; if(p) p.menge = n; }
    render();
  },
  nrVorschau: () => {
    const p = $("nrPraefix"), t = $("rTyp"); if(p && t) p.textContent = radPraefix(t.value);
    vorschauNummer(); ukBoxAktualisieren();
  },
  radNrVorschau: () => radNrVorschau(),
  nrBuch: (v, x, el) => { if(el) el.dataset.selbst = el.value ? "1" : ""; vorschauNummer(); ukBoxAktualisieren(); },
  /* Name der neuen Kategorie: schlägt den Anfangsbuchstaben vor, solange er frei ist
     und der Buchstabe nicht selbst eingetragen wurde. */
  nrKatName: v => {
    const e = $("nrBuch"); if(!e || e.dataset.selbst === "1") return;
    const ersterB = (String(v).trim().normalize("NFD").replace(/[^A-Za-z]/g, "")[0] || "").toUpperCase();
    e.value = ersterB && !katBelegt(ersterB) ? ersterB : "";
    vorschauNummer(); ukBoxAktualisieren();
  },
  nrEigen: () => ukBoxAktualisieren(),
  etVorlage: v => { const vo = vorlage(v), f = $("etStartFeld"), i = $("etStart"), c = $("etCodeFeld"); if(f) f.hidden = vo.seite !== "A4"; if(c) c.hidden = !!vo.tasche; if(i){ i.max = felderJeSeite(vo); if(Number(i.value) > felderJeSeite(vo)) i.value = 1; } },
  artGruppe: v => {
    artikelSichtbar();
    const g = $("nrGruppe"), k = $("nrKat");
    if(!g || !GRUPPE_FUER_ART[v]) return;
    g.value = String(GRUPPE_FUER_ART[v]);
    if(k){ const alt = k.value; k.innerHTML = kategorieOptionen(GRUPPE_FUER_ART[v]); k.value = alt; }
    vorschauNummer();
  },
  nrKat: v => {
    const box = $("nrNeu"); if(box) box.hidden = v !== "_neu";
    if(v === "_neu"){ const e = $("nrKatName") || $("nrBuch"); if(e) e.focus(); }
    vorschauNummer();
    ukBoxAktualisieren();
  },
  invZahl: (v, x) => invSetzen(x, v),
  fotoDatei: (v, x, el) => {
    const dateien = Array.from(el.files || []); el.value = "";
    if(!dateien.length) return;
    const tid = Number(x), da = Array.isArray(fotoCache[tid]) ? fotoCache[tid].length : 0, frei = Math.max(FOTOS_PRO_TICKET - da, 0);
    if(dateien.length > frei){
      toast(frei ? "Höchstens " + FOTOS_PRO_TICKET + " Fotos pro Ticket — es werden nur " + frei + " gespeichert." : "Das Ticket hat schon " + FOTOS_PRO_TICKET + " Fotos.", true);
      dateien.splice(frei);
      if(!dateien.length) return;
    }
    aktion(async () => {
      delete fotoCache[tid];
      let n = 0;
      for(const d of dateien){ await fotoHochladen(tid, await fotoAufbereiten(d), bearbeiter); n++; }
      return n;
    }, n => n + (n === 1 ? " Foto" : " Fotos") + " gespeichert");
  },
  nFoto: async (v, x, el) => {
    const dateien = Array.from(el.files || []); el.value = "";
    for(const d of dateien){
      if(offline && neu.fotos.length >= FOTOS_OFFLINE){ toast("Offline höchstens " + FOTOS_OFFLINE + " Fotos.", true); break; }
      if(neu.fotos.length >= FOTOS_PRO_TICKET){ toast("Höchstens " + FOTOS_PRO_TICKET + " Fotos pro Ticket.", true); break; }
      try{ neu.fotos.push(await fotoAufbereiten(d)); }catch(e){ toast(e.message, true); }
    }
    render();
  },
  nOrtWahl: v => { neu.arbeitsort = v; render(); },
  nZuweisen: v => { neu.zuweisen = v; render(); },
  grOrt: v => { if(grForm) formGroessen(grForm.code, grForm.art, v); },
  leihSportler: v => { if(leih) leih.sportler = v; },
  leihOrt: v => { if(leih){ leih.ort = v; leihZeichnen(); } },
  leihArtikel: v => { if(leih){ leih.code = v; leihZeichnen(); } },
  leihNotiz: v => { if(leih) leih.notiz = v; },
  rueckSportler: v => { if(rueck){ rueck.sportler = v; rueckZeichnen(); } },
  invOrt: (v, x) => { const e = $("fMenge"), b = bestand(x); if(e) e.placeholder = "bisher " + zahl(b ? amOrt(b, v) : 0); },
  kofferSoll: (v, x) => {
    const [c, o] = x.split("|"), s = Number(String(v).replace(",", "."));
    if(isNaN(s) || s < 0) return;
    if(s === 0 && !darf("manager")){ toast("Positionen aus der Packliste entfernt der Werkstatt-Manager.", true); render(); return; }
    aktion(() => s === 0 ? loeschen("koffer_soll", "code=eq." + encodeURIComponent(c) + "&ort=eq." + encodeURIComponent(o))
                         : aendern("koffer_soll", "code=eq." + encodeURIComponent(c) + "&ort=eq." + encodeURIComponent(o), { soll:s }));
  },
  kofferNeu: (v, x) => { if(v) aktion(() => neuIn("koffer_soll", { code:v, ort:x, soll:1 }), "Zur Packliste hinzugefügt"); },
  stueckOrt: (v, x) => {
    const d = v.indexOf("rad:") === 0 ? { ort:"am Rad", rad_id:v.slice(4) } : { ort:v, rad_id:null };
    aktion(() => aendern("stueck", "nummer=eq." + encodeURIComponent(x), d), x + " umgebucht");
  },
  stueckZustand: async (v, x) => {
    const r = await aktion(() => aendern("stueck", "nummer=eq." + encodeURIComponent(x), { zustand:v }), "Zustand: " + v);
    if(r === undefined) return;
    if((v === "zu prüfen" || v === "defekt") && !stueckTicket(x)) stueckTicketForm(x, v);
  },
  radFahrer: (v, x) => aktion(() => rpc("rad_zuordnen", { p_rad:x, p_sportler: v ? Number(v) : null }), "Fahrer geändert")
};
