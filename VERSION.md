# Version

**20.0.0** — 07.10.2026

Etiketten wahlweise mit Barcode (Code 128) und als Bild für Etikettendrucker
mit Handy-App; Übersichten (Material, Räder, Einzelstücke) nach Nummer oder
letzter Änderung sortierbar. Datenbankänderung: db/migration_20.0.0.sql.

Die Versionsnummer steht als `APP_VERSION` in der `index.html` und wird
unten in der App angezeigt. Bei jedem Update dort zusätzlich alle
`?v=…`-Angaben an den eingebundenen Dateien auf die neue Version setzen,
damit Browser keine alten Dateien aus dem Zwischenspeicher mischen.

## Verlauf

| Version | Datum | Kurz |
|---|---|---|
| 20.0.0 | 07.10.2026 | Barcode-Etiketten, Etiketten als Bild (Handy-Drucker), Sortierung nach Nummer / letzter Änderung (Migration) |
| 19.1.0 | 07.10.2026 | Standort-Kürzel in Anzeige und Etikettentext ausgeblendet, im QR-Code bleibt es |
| 19.0.1 | 07.10.2026 | Rad-Nummern: Vorschau korrigiert, deutsche Meldung bei fehlender Datenbank-Funktion |
| 19.0.0 | 07.10.2026 | Rad-Nummern-Vorlage je Standort, Nummer ändern, eigene Nummern frei (Migration) |
| 18.0.0 | 07.10.2026 | Mehrere Rollen je Konto, Rollen ändern, Trainer legen Kategorien/Tags an (Migration) |
| 17.1.0 | 06.10.2026 | Artikelformular: Werkstatt / Bekleidung getrennt, Anfangsbestand je Größe |
| 17.0.1 | 06.10.2026 | Lager-Karte kompakter (ein Raum ausgeblendet, Bekleidung raus, keine Erklärtexte) |
| 17.0.0 | 06.10.2026 | index.html aufgeteilt (css/, lib/, js/ nach Bereichen), keine Funktionsänderung |
| 16.0.0 | 06.10.2026 | Bekleidung (Größen, Ausleihe/Rückgabe), Lager-Kacheln, Lagerorte aufgeräumt (enthält die nicht einzeln gelieferte 15.0.1) |
| 15.0.0 | 06.10.2026 | Lagerorte selbst anlegen (Räume, Koffer/Werkzeugkästen), Raum-Filter im Lager |
| 14.3.0 | 06.10.2026 | Neues Ticket aufgeräumt, Räder nach Typ klappbar, allgemeine Tickets ohne Rad |
| 14.2.0 | 06.10.2026 | Höchstens 5 Fotos pro Ticket, Fotos nach 30 Tagen löschen, Sportler: ein offenes Ticket pro Rad |
| 14.1.1 | 06.10.2026 | Anmeldung abgesichert (Sperre, deaktivierte Sportler, Rollenwechsel), Verbrauch nur eigener Standort |
| 14.1.0 | 06.10.2026 | Gesamt-Admin ohne Zugriff auf fremde Standorte, Manager von außen einladen |
| 14.0.0 | 06.10.2026 | Konten (Name + PIN), Rollen, Standorte, Codes mit Standort-Kürzel |
| 13.0.0 | 05.10.2026 | Kategorie-Namen in der Datenbank, Name bei neuer Kategorie |
| 12.0.0 | 05.10.2026 | Mehrere Einzelstücke je Ticket (z. B. Rad + Laufräder) |
| 11.0.0 | 05.10.2026 | Tags statt Unterkategorien (mehrere je Artikel/Teil) |
| 10.1.0 | 05.10.2026 | Werkstattmaterial: eigener Filter im Lager, „−“ = Entnahme |
| 10.0.0 | 05.10.2026 | Unterkategorien, Filter Kategorie → Unterkategorie |
| 9.5.0 | 05.10.2026 | Bestand direkt beim Anlegen eines Artikels |
| 9.4.1 | 05.10.2026 | Einheit als Auswahl (Stück, Paar, ml) |
| 9.4.0 | 05.10.2026 | Koffer: Menge frei eingeben, alles Fehlende auf einmal einpacken |
| 9.3.0 | 05.10.2026 | Koffer als Unterbereiche des Lagers (kein eigener Reiter mehr) |
| 9.2.0 | 04.10.2026 | Rechnung mit Briefkopf, Verwendungszweck und GiroCode |
| 9.1.0 | 04.10.2026 | Ticket-Verlauf (erledigte/stornierte Tickets ansehen) |
| 9.0.0 | 02.10.2026 | Neues Menü, Arbeitsschritte mit Teil-Abschluss, Rad-Seite, Scan überall |
| 8.1.1 | 02.10.2026 | Bugfixes: Doppeltipp, Rad-QR offline, Druckformat, Inventar-Scan u. a. |
| 8.1.0 | 02.10.2026 | Etiketten-Arten (auch rund), Druckliste/Sammel-Druck |
| 8.0.0 | 02.10.2026 | Bestellliste, QR am Rad, Etiketten, Ausgemusterte ausblenden |
| 7.0.0 | 02.10.2026 | Arbeitszeit-Schätzung, Vormerken ohne Vorrat |
| 6.2.1 | 01.10.2026 | Auswahlliste kompakter |
| 6.2.0 | 01.10.2026 | Gemeinsame Auswahlliste Rad/Einzelstück |
| 6.1.0 | 01.10.2026 | Neues Ticket mit Einzelstück, setzt „zu prüfen“ |
| 6.0.0 | 01.10.2026 | Tickets für Einzelstücke, Rad-Marke repariert |
| 5.4.0 | 01.10.2026 | Kaufdatum Monat/Jahr, Kategorien klappbar |
| 5.3.2 | 01.10.2026 | Kaufdatum-Fix, Serie bearbeiten |
| 5.3.1 | 01.10.2026 | Inventar nach Kategorie gegliedert |
| 5.3.0 | 01.10.2026 | Inventur über alle Orte in einem Durchgang |
| 5.2.0 | 01.10.2026 | Inventar: Kategorie-Menü, Serien „4×“, Löschen |
| 5.1.0 | 01.10.2026 | Einzelstücke als Serie anlegen, Feld „Wert“ entfernt |
| 5.0.1 | 01.10.2026 | Nummernvergabe über Kategorie-Auswahl |
| 5.0.0 | 01.10.2026 | Inventur-Modus, automatische Nummern, Marke, Storno, Fotos am Ticket |
| 4.0.2 | 01.10.2026 | Fehlerbehebungen, Offline-Tickets ohne Doppel, engere Zugriffsrechte |
| 4.0.1 | 01.10.2026 | Menü in der Kopfleiste, Unteroptionen klar abgesetzt, „Neu“ unter Tickets |
| 4.0.0 | 30.09.2026 | Kein Login, Namen je Gerät, Bearbeiter an Buchungen/Tickets, Löschschutz |
| 3.0.0 | 30.09.2026 | Neon statt Sheets, Stammdaten in der App, Lager wie früher, Koffer als Überblick |
| 2.0.0 | 30.09.2026 | Tickets, Orte, Koffer, Einzelgut; Arbeitsmappe + Apps Script |
| 1.x | bis 09/2026 | Materialbuchung gegen die alte Lager-Mappe |
