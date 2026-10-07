# Vokabeltrainer – iPhone-PWA

Diese Version ist eine **Progressive Web App (PWA)** für iPhone/Safari. Sie braucht keinen eigenen Server, keine Datenbank, keinen App Store und kein Xcode. Für die Veröffentlichung reicht statisches HTTPS-Hosting, z. B. GitHub Pages.

## Enthalten

- 150 Vokabeln aus den bereitgestellten Seiten von **Unit 1 – Friends**
- Kategorien nach Kapitel/Abschnitt (Way in, Station 1, Holiday activities, Last summer, Station 2, Feelings, Reading corner, Film corner, Checkpoint, Viewing skills)
- Karteikarten Deutsch → Englisch oder Englisch → Deutsch
- englische Sprachausgabe über die iPhone-Stimmen (britisch oder amerikanisch)
- „Gewusst“ / „Nochmal“ mit einfacher Wiederholungslogik
- Suche, manuelles Ergänzen, Bearbeiten und Löschen
- Import von Text/CSV/JSON
- PDF-Import mit Texterkennung; bei gescannten PDFs wird OCR versucht
- Foto-Import mit OCR und anschließender Kontrollansicht
- Sicherung/Übertragung des gesamten Vokabelbestands und Lernstands als JSON-Datei
- Service Worker und App-Manifest für Offline-Betrieb und Home-Screen-Installation

## Wichtig zum Offline-Betrieb

**Lernen, Vokabeln, Lernstand, Einstellungen und Sprachausgabe funktionieren nach dem ersten vollständigen Laden offline.**

Beim ersten Öffnen lädt der Service Worker die eigentliche App in den lokalen Cache des iPhones. Warte, bis oben rechts **„Offline bereit“** steht, bevor du die Internetverbindung testweise abschaltest.

Die automatische PDF-/Foto-Erkennung verwendet zusätzliche JavaScript-/OCR-Bibliotheken. Beim **allerersten** OCR-Einsatz braucht das iPhone Internet. Unter **Einstellungen → OCR/PDF für Offline-Nutzung vorbereiten** kann man diese Komponenten einmalig laden. Die Vokabeln selbst und der Lernstand bleiben lokal auf dem Gerät.

## Installation über GitHub Pages – Schritt für Schritt

1. ZIP-Datei entpacken.
2. Auf GitHub ein neues Repository anlegen, z. B. `vokabeltrainer`.
3. **Alle Dateien aus diesem Ordner** in die oberste Ebene des Repositorys hochladen. Wichtig: `index.html` muss direkt im Repository liegen, nicht noch in einem Unterordner.
4. In GitHub: **Settings → Pages**.
5. Unter „Build and deployment“: **Deploy from a branch** wählen.
6. Branch **main**, Ordner **/(root)** auswählen und speichern.
7. Nach kurzer Zeit erscheint die GitHub-Pages-Adresse, z. B. `https://BENUTZERNAME.github.io/vokabeltrainer/`.
8. Diese Adresse auf dem iPhone in **Safari** öffnen.
9. Warten, bis in der App oben rechts **„Offline bereit“** erscheint.
10. In Safari auf **Teilen → Zum Home-Bildschirm → Hinzufügen** tippen.
11. Die App künftig über das neue Symbol „Vokabeln“ starten.
12. Für spätere PDF-/Foto-Imports empfiehlt sich einmalig: **Einstellungen → OCR/PDF für Offline-Nutzung vorbereiten**.

## Update der App

Dateien im GitHub-Repository durch eine neue Version ersetzen und committen. Der Service Worker aktualisiert die App bei einem späteren Online-Start. Der Lernstand liegt in `localStorage` auf dem iPhone und wird bei normalen App-Updates nicht überschrieben.

Vor größeren Änderungen empfiehlt sich trotzdem **Einstellungen → Sicherung exportieren**.

## Neue Vokabelseiten importieren

In der App unten **Import** öffnen.

- **PDF**: Datei aus „Dateien“ auswählen. Textbasierte PDFs werden direkt gelesen. Bei Seiten ohne eingebetteten Text versucht die App OCR.
- **Foto**: JPG/PNG bzw. ein vom Browser lesbares Bild auswählen und OCR starten lassen.
- **Text**: Am zuverlässigsten eine Zeile pro Vokabel, z. B. `to borrow = ausleihen`.
- **JSON-Sicherung**: Eine frühere App-Sicherung kann über Einstellungen wieder eingespielt werden.

Die automatische Erkennung ist absichtlich konservativ. Vor dem Speichern werden erkannte Englisch-/Deutsch-Paare in einer **Kontrollansicht** gezeigt und können korrigiert werden.

## Datenschutz

- Vokabeln, Lernstand und Einstellungen werden lokal im Browser-Speicher des iPhones gespeichert.
- Es gibt kein eigenes Backend und keine Datenbank.
- Die OCR läuft im Browser auf dem Gerät. Beim ersten Laden der OCR-Bibliothek bzw. ihrer Sprachdaten werden nur Programmdateien von öffentlichen CDNs geladen; die ausgewählten Buchseiten werden von dieser App nicht an einen eigenen Server geschickt.

## Dateien

- `index.html` – App-Oberfläche
- `styles.css` – Gestaltung
- `app.js` – Lernlogik, Import, Sprachausgabe, Sicherung
- `seed-data.js` – die 150 Startvokabeln
- `sw.js` – Offline-Cache / Service Worker
- `manifest.webmanifest` – PWA-Metadaten
- `icons/` – App-Symbole

## Technischer Hinweis

Die App benötigt **HTTPS**, damit der Service Worker auf einem echten iPhone zuverlässig arbeitet. GitHub Pages liefert automatisch HTTPS. Ein bloßes Öffnen der `index.html` aus der Dateien-App (`file://`) reicht für den PWA-/Offline-Modus nicht aus.
