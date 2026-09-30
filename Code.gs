/**
 * Werkstatt RSZ MV — Backend
 *
 * Einrichtung
 *   1. Mappe nach Google Sheets importieren (Datei > Importieren > Ersetzen).
 *   2. Erweiterungen > Apps Script, diesen Code einfügen, speichern.
 *   3. Bereitstellen > Neue Bereitstellung > Web-App.
 *        Ausführen als: Ich
 *        Zugriff: Jeder mit dem Link   (Link nicht öffentlich streuen)
 *   4. Die Web-App-URL oben in die index.html eintragen.
 *
 * Aufrufe
 *   GET  ?action=alles              → ein JSON mit allem, was die Seite braucht
 *   POST {aktion: "...", ...}       → schreibende Aktionen, siehe unten
 *
 * Der Browser schickt POSTs als text/plain. Das ist Absicht: Apps Script
 * beantwortet keine CORS-Preflight-Anfragen, und text/plain löst keine aus.
 */

var BLATT = {
  artikel: 'Artikel', sportler: 'Sportler', raeder: 'Raeder', zuordnung: 'Zuordnung',
  stueckgut: 'Stueckgut', zugaenge: 'Zugaenge', entnahmen: 'Entnahmen',
  bewegungen: 'Bewegungen', tickets: 'Tickets', positionen: 'Ticket_Positionen',
  bestand: 'Bestand', koffer: 'Koffer', rechnungen: 'Rechnungen'
};

/* ------------------------------------------------------------------ Helfer */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function blatt(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error('Blatt fehlt: ' + name);
  return s;
}

/** Liest ein Blatt als Array von Objekten, Kopfzeile = Schlüssel. Leere Zeilen fliegen raus. */
function lies(name, pflichtspalte) {
  var s = blatt(name), werte = s.getDataRange().getValues();
  if (werte.length < 2) return [];
  var kopf = werte[0], raus = [];
  for (var i = 1; i < werte.length; i++) {
    var zeile = werte[i], obj = { _zeile: i + 1 }, leer = true;
    for (var j = 0; j < kopf.length; j++) {
      if (!kopf[j]) continue;
      var v = zeile[j];
      obj[String(kopf[j])] = (v instanceof Date) ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : v;
      if (v !== '' && v !== null) leer = false;
    }
    if (leer) continue;
    if (pflichtspalte && !obj[pflichtspalte]) continue;
    raus.push(obj);
  }
  return raus;
}

function tz() { return ss().getSpreadsheetTimeZone(); }
function jetzt() { return new Date(); }

/** Spaltenindex (1-basiert) einer Überschrift. */
function spalte(name, ueberschrift) {
  var kopf = blatt(name).getRange(1, 1, 1, blatt(name).getLastColumn()).getValues()[0];
  for (var i = 0; i < kopf.length; i++) if (String(kopf[i]) === ueberschrift) return i + 1;
  throw new Error('Spalte fehlt: ' + ueberschrift + ' in ' + name);
}

/** Hängt eine Zeile an, geordnet nach der Kopfzeile. */
function anhaengen(name, obj) {
  var s = blatt(name);
  var kopf = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  var zeile = kopf.map(function (k) { return (k && obj[k] !== undefined) ? obj[k] : ''; });
  s.appendRow(zeile);
  return s.getLastRow();
}

function artikel(code) {
  var alle = lies(BLATT.artikel, 'Code');
  for (var i = 0; i < alle.length; i++) if (alle[i].Code === code) return alle[i];
  return null;
}

function antwort(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Alle Schreibzugriffe laufen hierdurch — zwei Trainer an der Bahn schreiben sonst übereinander. */
function mitSperre(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Gerade schreibt jemand anderes. Bitte nochmal.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* -------------------------------------------------------------------- Lesen */

function alles() {
  return {
    stand: Utilities.formatDate(jetzt(), tz(), "yyyy-MM-dd'T'HH:mm:ss"),
    artikel: lies(BLATT.artikel, 'Code'),
    sportler: lies(BLATT.sportler, 'Sportler'),
    raeder: lies(BLATT.raeder, 'Rad-ID'),
    zuordnung: lies(BLATT.zuordnung, 'Rad-ID'),
    stueckgut: lies(BLATT.stueckgut, 'Nummer'),
    bestand: lies(BLATT.bestand, 'Code'),
    koffer: lies(BLATT.koffer, 'Code'),
    tickets: lies(BLATT.tickets, 'Ticket').filter(function (t) { return t.Status !== 'erledigt'; }),
    positionen: lies(BLATT.positionen, 'Ticket').filter(function (p) { return p.Status === 'reserviert'; })
  };
}

/** Wer fährt das Rad gerade? Jüngste Zuordnung ohne 'gültig bis'. */
function aktuellerFahrer(radId) {
  var z = lies(BLATT.zuordnung, 'Rad-ID').filter(function (r) {
    return r['Rad-ID'] === radId && !r['gültig bis'];
  });
  z.sort(function (a, b) { return String(b['gültig ab']).localeCompare(String(a['gültig ab'])); });
  return z.length ? z[0].Fahrer : '';
}

function naechsteTicketnummer() {
  var t = lies(BLATT.tickets, 'Ticket'), max = 0;
  t.forEach(function (x) {
    var n = parseInt(String(x.Ticket).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return 'T-' + ('0000' + (max + 1)).slice(-4);
}

/* ---------------------------------------------------------------- Schreiben */

function ticketAnlegen(d) {
  return mitSperre(function () {
    var nr = naechsteTicketnummer();
    var rad = d.radId || '';
    anhaengen(BLATT.tickets, {
      'Ticket': nr,
      'angelegt': jetzt(),
      'Rad-ID': rad,
      'Fahrer': d.fahrer || aktuellerFahrer(rad),
      'Problem': d.problem || '',
      'fahrbereit': d.fahrbereit ? 'ja' : 'nein',
      'Aufwand': d.aufwand || '',
      'soll fertig': d.sollFertig ? new Date(d.sollFertig) : '',
      'Anlass': d.anlass || '',
      'Sportler': d.sportler || '',
      'Arbeitsort': d.arbeitsort || 'Werkstatt',
      'Status': 'offen',
      'Trainer': d.trainer || '',
      'Notiz': d.notiz || ''
    });
    (d.positionen || []).forEach(function (p) {
      anhaengen(BLATT.positionen, { 'Ticket': nr, 'Code': p.code, 'Menge': p.menge, 'Status': 'reserviert' });
    });
    return { ok: true, ticket: nr };
  });
}

/** Einzelne Felder eines Tickets ändern. felder = {Aufwand: "mittel", ...} */
function ticketAendern(d) {
  return mitSperre(function () {
    var s = blatt(BLATT.tickets), werte = s.getDataRange().getValues(), kopf = werte[0];
    for (var i = 1; i < werte.length; i++) {
      if (werte[i][0] !== d.ticket) continue;
      Object.keys(d.felder || {}).forEach(function (k) {
        var sp = kopf.indexOf(k);
        if (sp < 0) return;
        var v = d.felder[k];
        if (k === 'soll fertig' && v) v = new Date(v);
        s.getRange(i + 1, sp + 1).setValue(v === null ? '' : v);
      });
      return { ok: true };
    }
    throw new Error('Ticket nicht gefunden: ' + d.ticket);
  });
}

function reservieren(d) {
  return mitSperre(function () {
    anhaengen(BLATT.positionen, { 'Ticket': d.ticket, 'Code': d.code, 'Menge': d.menge || 1, 'Status': 'reserviert' });
    return { ok: true };
  });
}

function freigeben(d) {
  return mitSperre(function () {
    var s = blatt(BLATT.positionen), werte = s.getDataRange().getValues();
    var spStatus = spalte(BLATT.positionen, 'Status');
    for (var i = werte.length - 1; i >= 1; i--) {
      if (werte[i][0] === d.ticket && werte[i][1] === d.code && werte[i][4] === 'reserviert') {
        s.getRange(i + 1, spStatus).setValue('storniert');
        return { ok: true };
      }
    }
    throw new Error('Keine offene Reservierung für ' + d.code);
  });
}

/**
 * Ticket abschließen: jede reservierte Position wird zur Entnahme.
 * Preis wird als Zahl festgeschrieben, nicht verlinkt.
 * Pauschalen ziehen zusätzlich ihren hinterlegten Verbrauch vom Vorrat ab.
 */
function ticketAbschliessen(d) {
  return mitSperre(function () {
    var t = null;
    lies(BLATT.tickets, 'Ticket').forEach(function (x) { if (x.Ticket === d.ticket) t = x; });
    if (!t) throw new Error('Ticket nicht gefunden: ' + d.ticket);

    var ort = t.Arbeitsort || 'Werkstatt';
    var sportler = t.Sportler || 'LV';
    var abrechnen = 'nein';
    lies(BLATT.sportler, 'Sportler').forEach(function (s) {
      if (s.Sportler === sportler) abrechnen = s.Abrechnen || 'nein';
    });

    var s = blatt(BLATT.positionen), werte = s.getDataRange().getValues();
    var spStatus = spalte(BLATT.positionen, 'Status');
    var summe = 0, gebucht = 0;

    for (var i = 1; i < werte.length; i++) {
      if (werte[i][0] !== d.ticket || werte[i][4] !== 'reserviert') continue;
      var code = werte[i][1], menge = Number(werte[i][3]) || 0;
      var a = artikel(code);
      var preis = a ? Number(a['Preis (€)']) || 0 : 0;

      anhaengen(BLATT.entnahmen, {
        'Zeitstempel': jetzt(), 'Sportler': sportler, 'Code': code, 'Menge': menge, 'Ort': ort,
        'Einzelpreis (€)': preis, 'Abrechnen': abrechnen, 'Trainer': d.trainer || t.Trainer || '',
        'Ticket': d.ticket
      });

      if (a && a.Art === 'Pauschale' && a.Verbraucht) {
        anhaengen(BLATT.entnahmen, {
          'Zeitstempel': jetzt(), 'Sportler': sportler, 'Code': a.Verbraucht,
          'Menge': (Number(a.Verbrauch) || 0) * menge, 'Ort': ort,
          'Einzelpreis (€)': 0, 'Abrechnen': 'nein', 'Trainer': d.trainer || '',
          'Ticket': d.ticket, 'Notiz': 'Verbrauch aus ' + code
        });
      }

      s.getRange(i + 1, spStatus).setValue('gebucht');
      summe += preis * menge; gebucht++;
    }

    ticketAendern({ ticket: d.ticket, felder: { 'Status': 'erledigt' } });
    return { ok: true, positionen: gebucht, summe: summe };
  });
}

/** Material zwischen Werkstatt und Koffern umbuchen. */
function umbuchen(d) {
  return mitSperre(function () {
    anhaengen(BLATT.bewegungen, {
      'Zeitstempel': jetzt(), 'Was': 'Material', 'Code / Nummer': d.code,
      'Menge': d.menge, 'von': d.von, 'nach': d.nach, 'Trainer': d.trainer || '', 'Notiz': d.notiz || ''
    });
    return { ok: true };
  });
}

/** Einzelstück umsetzen: Ort im Stammblatt ändern und die Bewegung protokollieren. */
function stueckUmbuchen(d) {
  return mitSperre(function () {
    var s = blatt(BLATT.stueckgut), werte = s.getDataRange().getValues();
    var spOrt = spalte(BLATT.stueckgut, 'Ort'), spRad = spalte(BLATT.stueckgut, 'am Rad');
    for (var i = 1; i < werte.length; i++) {
      if (werte[i][0] !== d.nummer) continue;
      var vorher = werte[i][spOrt - 1] + (werte[i][spRad - 1] ? ' (' + werte[i][spRad - 1] + ')' : '');
      s.getRange(i + 1, spOrt).setValue(d.ort);
      s.getRange(i + 1, spRad).setValue(d.ort === 'am Rad' ? (d.radId || '') : '');
      anhaengen(BLATT.bewegungen, {
        'Zeitstempel': jetzt(), 'Was': 'Einzelstück', 'Code / Nummer': d.nummer, 'Menge': 1,
        'von': vorher, 'nach': d.ort === 'am Rad' ? 'am Rad ' + (d.radId || '') : d.ort,
        'Trainer': d.trainer || ''
      });
      return { ok: true };
    }
    throw new Error('Einzelstück nicht gefunden: ' + d.nummer);
  });
}

/** Zustand eines Einzelstücks setzen — 'zu prüfen' nach Sturz, 'frei' nach Freigabe. */
function zustandSetzen(d) {
  return mitSperre(function () {
    var s = blatt(BLATT.stueckgut), werte = s.getDataRange().getValues();
    var sp = spalte(BLATT.stueckgut, 'Zustand');
    for (var i = 1; i < werte.length; i++) {
      if (werte[i][0] === d.nummer) { s.getRange(i + 1, sp).setValue(d.zustand); return { ok: true }; }
    }
    throw new Error('Einzelstück nicht gefunden: ' + d.nummer);
  });
}

function zugang(d) {
  return mitSperre(function () {
    anhaengen(BLATT.zugaenge, {
      'Datum': d.datum ? new Date(d.datum) : jetzt(), 'Code': d.code, 'Menge': d.menge,
      'Ort': d.ort || 'Werkstatt', 'Einkauf gesamt (€)': d.einkauf || '',
      'Lieferant': d.lieferant || '', 'Notiz': d.notiz || ''
    });
    return { ok: true };
  });
}

/* ----------------------------------------------------------------- Routing */

function doGet(e) {
  try {
    var a = (e && e.parameter && e.parameter.action) || 'alles';
    if (a === 'alles') return antwort(alles());
    if (a === 'fahrer') return antwort({ fahrer: aktuellerFahrer(e.parameter.radId) });
    return antwort({ fehler: 'Unbekannte Aktion: ' + a });
  } catch (err) {
    return antwort({ fehler: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var f = {
      ticketAnlegen: ticketAnlegen, ticketAendern: ticketAendern,
      reservieren: reservieren, freigeben: freigeben, ticketAbschliessen: ticketAbschliessen,
      umbuchen: umbuchen, stueckUmbuchen: stueckUmbuchen, zustandSetzen: zustandSetzen, zugang: zugang
    }[d.aktion];
    if (!f) return antwort({ fehler: 'Unbekannte Aktion: ' + d.aktion });
    return antwort(f(d));
  } catch (err) {
    return antwort({ fehler: String(err.message || err) });
  }
}

/* ------------------------------------------------- Morgenmail (optionaler Trigger) */

/**
 * Täglicher Zeit-Trigger, z. B. 7:00. Schickt die offenen Tickets als Mail.
 * Einrichten unter Trigger > Trigger hinzufügen > morgenmail > Zeitgesteuert.
 */
function morgenmail() {
  var t = lies(BLATT.tickets, 'Ticket').filter(function (x) { return x.Status !== 'erledigt'; });
  if (!t.length) return;
  t.sort(function (a, b) { return (Number(a['Puffer (T)']) || 99) - (Number(b['Puffer (T)']) || 99); });

  var steht = t.filter(function (x) { return x.fahrbereit === 'nein'; });
  var zeile = function (x) {
    return '• ' + (x.Fahrer || x['Rad-ID']) + ' — ' + x.Problem +
      '  (Puffer ' + (x['Puffer (T)'] === '' ? '—' : x['Puffer (T)'] + ' T') + ')';
  };
  var text = '';
  if (steht.length) text += 'RAD STEHT:\n' + steht.map(zeile).join('\n') + '\n\n';
  text += 'ALLE OFFENEN (' + t.length + '):\n' + t.map(zeile).join('\n');
  text += '\n\n' + ss().getUrl();

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Werkstatt: ' + t.length + ' offene Tickets' + (steht.length ? ', ' + steht.length + ' Rad/Räder stehen' : ''),
    body: text
  });
}
