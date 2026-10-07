Werkstatt-Inventar LV Radsport MV

Live: https://rohralarm782.github.io/Werkstatt-Inventar/

## Aufbau (seit 17.0.0)

| Datei | Inhalt |
|---|---|
| `index.html` | Gerüst, `APP_VERSION`, Einbindung aller Dateien (Reihenfolge wichtig) |
| `css/app.css` | Gestaltung |
| `lib/zxing.min.js` | ZXing (QR/Barcode lesen und QR erzeugen), fest eingebaut, kein CDN; Barcodes (Code 128) erzeugt `js/etiketten.js` selbst |
| `js/core.js` | Konfiguration, Zustand, Zugang, Datenbank (rest/rpc), Laden, Hilfsfunktionen, Rahmen, Modal |
| `js/tickets.js` | Board, Ticket-Detail, Neues Ticket, Auswahl Rad/Einzelstück, Fotos |
| `js/lager.js` | Lager, Bestellliste, Koffer, Bekleidung, Buchungen ansehen/stornieren |
| `js/etiketten.js` | Etiketten und Druck (QR-Code oder Barcode Code 128; auch als Bild für Etikettendrucker mit Handy-App) |
| `js/inventur.js` | Inventur-Modus |
| `js/inventar.js` | Nummerierte Einzelstücke |
| `js/verwaltung.js` | Verwaltung/Mehr, Lagerorte, Stammdaten-Formulare, Nummern, Rechnung |
| `js/scanner.js` | Scanner |
| `js/aktionen.js` | Klick-Aktionen (`A`) und Eingabe-Aktionen (`C`) |
| `js/konto.js` | Konten, Sitzungen, Rollen, Anmeldung, Standorte, Briefkopf, Sportler-Ansicht |
| `js/start.js` | Globale Ereignisse und Programmstart (immer zuletzt laden) |
| `db/schema.sql` | Vollständiges Schema für eine neue Datenbank |
| `db/migration_X.Y.Z.sql` | Änderungen für die bestehende Datenbank, der Reihe nach |
| `updates/vX.Y.Z.md` | Protokoll je Version |
| `.github/workflows/veroeffentlichen.yml` | Veröffentlichung auf GitHub Pages (nachts automatisch oder per Knopf) |

Alle Skripte sind normale `<script>`-Dateien ohne Module und ohne
Build-Schritt; sie teilen sich den globalen Bereich wie zuvor die eine
`index.html`. Beim Laden ausgeführter Code darf nur Dinge aus derselben
oder einer früher geladenen Datei verwenden.

## Veröffentlichen (seit 20.0.1)

Ein Upload nach `main` geht **nicht sofort** live. GitHub veröffentlicht den
aktuellen Stand von `main` jede Nacht automatisch (ca. 3:15 Uhr im Sommer,
2:15 Uhr im Winter; kann sich etwas verzögern).

- **Sofort veröffentlichen** (dringende Fehler): im Repo auf **Actions** →
  links **„App veröffentlichen“** → rechts **„Run workflow“** → grüner Knopf.
  Nach 1–2 Minuten ist der neue Stand live.
- **Voraussetzung:** Settings → Pages → Source = „GitHub Actions“.
- **Datenbank-Migrationen** führt weiterhin niemand automatisch aus:
  - Migrationen, die nur etwas hinzufügen (neue Funktionen, Spalten,
    Rechte), können tagsüber vorab in Neon laufen; die alte App läuft weiter,
    nachts kommt das neue Frontend dazu.
  - Migrationen, die etwas umbauen oder entfernen: Migration ausführen und
    direkt danach sofort veröffentlichen.
- Wer die App offen hat, sieht den neuen Stand nach dem Neuladen.
