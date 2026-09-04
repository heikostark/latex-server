# LaTeX-Projekt-Server

Ein kleiner Webserver in Rust (Axum), der eine Ein-Seiten-Weboberfläche zum
Bearbeiten und Kompilieren von LaTeX-Projekten bereitstellt.

## Voraussetzungen

- Rust/Cargo (getestet mit Rust 1.75+)
- Ein installiertes LaTeX-System im `PATH` des Servers (z. B. TeX Live) mit
  den Programmen `pdflatex` und `bibtex`, damit die Kompilier-Funktion
  funktioniert. Ohne LaTeX-Installation startet der Server trotzdem, aber
  der Kompilier-Button meldet dann einen entsprechenden Fehler.
- Für die Tabellenvorschau/-einfügung wird die Rust-Bibliothek `calamine`
  verwendet (wird beim Bauen automatisch von crates.io geladen) — es ist
  keine separate Installation von Excel oder LibreOffice auf dem Server
  nötig, um `.xlsx`-, `.xls`-, `.ods`- oder `.csv`-Dateien zu lesen.
- Für die Diff-Funktion (Bereich 1) wird das Kommandozeilenwerkzeug
  `latexdiff` im `PATH` des Servers benötigt (Teil der meisten TeX-Live-
  Installationen, unter Debian/Ubuntu z. B. per `apt install latexdiff`
  oder `texlive-extra-utils` nachinstallierbar). Ohne `latexdiff` liefert
  der Button „Diff erstellen“ eine entsprechende Fehlermeldung statt
  eines Absturzes.
- Für die automatische Dateisystem-Überwachung wird die Rust-Bibliothek
  `notify` verwendet (wird beim Bauen automatisch von crates.io geladen,
  keine separate Installation nötig). Unter Linux nutzt sie inotify;
  betriebssystemseitige Limits wie `fs.inotify.max_user_watches` können bei
  sehr großen Arbeitsordnern relevant werden, sind für normale
  LaTeX-Projekte aber unkritisch.

## Starten

```bash
cargo run --release
```

Der Server läuft danach unter <http://localhost:3000>. Öffne diese Adresse
im Browser.

## Bedienung

1. **Arbeitsordner öffnen**: Entweder den Pfad direkt in das Textfeld
   eingeben und „Öffnen“ klicken, oder über „Durchsuchen…“ den grafischen
   Ordnerauswahl-Dialog öffnen. Dieser zeigt den Server-seitigen
   Verzeichnisbaum an (Unterordner anklicken zum Hineinnavigieren, der
   Pfeil-nach-oben-Button für eine Ebene höher) — mit „Diesen Ordner
   wählen“ wird der aktuell angezeigte Ordner übernommen. Der
   Ordnerinhalt erscheint anschließend links (Bereich 1); eine vorhandene
   `.bib`-Datei wird automatisch im vierten Bereich angezeigt. Der
   Arbeitsordner selbst ist immer aufgeklappt, alle **Unterordner starten
   zugeklappt** (Pfeil „▶“) — ein Klick auf einen Unterordner klappt ihn
   auf („▼“) bzw. wieder zu; der Zustand bleibt auch nach dem
   Anlegen/Umbenennen/Löschen von Dateien erhalten (bis ein neuer
   Arbeitsordner geöffnet wird). Jede Datei zeigt ein zum Dateityp
   passendes, farbiges SVG-Icon (blau für `.tex`, violett für `.bib`, rot
   für PDF, grün für Bilder, orange für Tabellen, grau für
   Klassen-/Stil-/Log-/Build-Dateien, gelb für `.bak`-Sicherungen);
   Ordner wechseln zwischen geschlossenem und offenem Symbol. Alle Icons
   in der gesamten App sind als eingebettete SVGs umgesetzt — bewusst
   **keine Emoji** —, damit sie unabhängig davon sichtbar sind, ob auf
   dem verwendeten System eine Farb-Emoji-Schriftart installiert ist
   (siehe „Hinweis zu einem behobenen Fehler“ unten).
2. **Live-Synchronisation mit dem Dateisystem**: Der Arbeitsordner wird im
   Hintergrund rekursiv auf Änderungen überwacht (inotify unter Linux).
   Ändert sich dort etwas — auch außerhalb der App, z. B. durch einen
   anderen Editor, `git pull` oder ein Skript —, aktualisiert sich der
   Ordnerbaum automatisch, ganz ohne manuellen Neuladen-Klick.
3. **Datei bearbeiten**: Ein **Doppelklick** auf eine `.tex`- oder
   `.txt`-Datei im Ordnerbaum öffnet sie im
   [CodeMirror](https://codemirror.net/5/)-Editor (Bereich 2) mit
   LaTeX-Syntaxhervorhebung, Zeilennummern und automatischer
   Klammerprüfung. Ein einfacher Klick markiert eine Datei nur visuell
   (und merkt sich diese Datei zusätzlich als „ausgewählte Datei“ für die
   Diff-Funktion, siehe unten). Änderungen werden über „Speichern“ im
   Editor-Kopf, mit `Strg+S`, oder automatisch **alle 5 Minuten** (sofern
   ungesicherte Änderungen vorliegen) gespeichert.
4. **Suchen & Ersetzen / Rückgängig / Wiederholen**: Am Fuß des Editors
   (gleiche Höhe wie der Editor-Kopf) befindet sich eine Leiste mit
   Suchfeld, „◀“/„▶“ für vorherigen/nächsten Treffer (auch per `Enter`
   bzw. `Umschalt+Enter` im Suchfeld), Trefferanzahl, Ersatzfeld sowie
   „Ersetzen“ (aktueller Treffer) und „Alle“ (alle Treffer). Während der
   Eingabe werden **alle** Treffer im Editor gelb hervorgehoben (nicht nur
   der aktuell angesteuerte, der zusätzlich über die normale
   Cursor-Selektion abgesetzt ist); nach jeder Ersetzung wird die
   Hervorhebung automatisch aktualisiert. Ganz rechts sitzen „↶“
   (Rückgängig) und „↷“ (Wiederholen).
5. **LaTeX-Autovervollständigung**: Im Editor erscheint beim Tippen nach
   einem `\` automatisch ein Vorschlagsmenü mit passenden LaTeX-Befehlen
   (z. B. `\section`, `\textbf`, `\includegraphics`, griechische
   Buchstaben, …); nach `\begin{`/`\end{` werden stattdessen passende
   Umgebungsnamen vorgeschlagen (z. B. `itemize`, `figure`, `tabular`).
   Mit den Pfeiltasten auswählen und `Enter`/`Tab` bestätigen, `Esc`
   schließt das Menü. Manuell lässt sich die Vervollständigung jederzeit
   mit `Strg+Leertaste` aufrufen.
6. **Kompilieren**: Der Button „Kompilieren“ im Kopf des Editors
   (Bereich 2, neben „Speichern“) speichert die aktuelle Datei und ruft
   `pdflatex` mit dem Schalter `-file-line-error` auf (und bei Bedarf
   `bibtex`), damit Fehlermeldungen eine präzise Zeilennummer enthalten.
   Das Ergebnis erscheint rechts (Bereich 3) im Reiter „PDF“; Fehler und
   Warnungen aus dem Log landen im Reiter „Fehler“ und werden zusätzlich
   **direkt im Editor markiert**: die betroffene Zeile bekommt einen roten
   (Fehler) bzw. gelben (Warnung) Hintergrund sowie ein passendes Symbol
   im Rand; ein Klick auf einen Eintrag in der Fehlerliste springt im
   Editor zur entsprechenden Zeile. Die vor dem Kompilieren im
   PDF-Betrachter angezeigte Seite wird gemerkt und die neue PDF-Vorschau
   danach automatisch wieder auf diese Seite gesprungen (per
   `#page=N`-Fragment — ein von allen gängigen Browsern unterstützter
   PDF-Parameter). Das *Merken* der aktuellen Seite ist dabei Best-Effort:
   ob der eingebettete Browser-PDF-Viewer seine aktuelle Seite über die
   iframe-URL preisgibt, hängt vom Browser ab; gelingt das nicht, wird auf
   die zuletzt bekannte Seite bzw. Seite 1 zurückgefallen — es kommt nie
   zu einem Fehler, höchstens zu einer weniger präzisen Sprungmarke.
7. **Bilder**: Ein **Doppelklick** auf eine Bilddatei (PNG, JPG, GIF, SVG,
   BMP, WebP, …) im Arbeitsordner öffnet eine Vorschau als Dialog. **Ziehen**
   (Drag & Drop) einer Bilddatei in den Editor fügt an der Fallposition ein
   fertiges `figure`-Gerüst ein (`\includegraphics` mit automatisch
   berechnetem relativem Pfad zur aktuell geöffneten `.tex`-Datei,
   `\caption`, `\label`).
8. **Tabellen (Excel/LibreOffice/CSV)**: Ein **Doppelklick** auf eine
   `.xlsx`-, `.xls`-, `.ods`- oder `.csv`-Datei zeigt deren erstes
   Tabellenblatt als scrollbare Vorschau (CSV mit automatischer Erkennung
   von Komma oder Semikolon als Trennzeichen). **Ziehen** in den Editor
   fügt ein `table`-Gerüst mit den tatsächlichen Zelldaten ein
   (LaTeX-Sonderzeichen werden automatisch escaped; bei mehr als 20 Zeilen
   werden nur die ersten 20 übernommen, mit einem Kommentarhinweis auf die
   Gesamtzeilenzahl — für vollständige Daten bitte per Vorschau prüfen und
   bei Bedarf die Tabelle im Editor von Hand erweitern). Die generierte
   Tabelle nutzt `booktabs`-Befehle; `\usepackage{booktabs}` muss in der
   Präambel ergänzt werden (ein entsprechender Kommentar wird mit
   eingefügt).
9. **PDF-Dateien**: Ein **Doppelklick** auf eine `.pdf`-Datei im
   Arbeitsordner öffnet sie in einem neuen Browser-Tab.
10. **Dateien und Ordner verwalten**: Rechtsklick auf eine Datei, einen
   Ordner oder eine freie Fläche im Arbeitsordner öffnet ein Kontextmenü
   mit „Neuer Ordner hier“, „Neue .tex-Datei hier“, „Umbenennen“ und
   „Löschen“ (bei Ordnern inklusive Inhalt — es folgt eine
   Sicherheitsabfrage). Neue `.tex`-Dateien erhalten ein minimales
   LaTeX-Grundgerüst als Inhalt; ein neu angelegter Ordner wird direkt
   aufgeklappt angezeigt. Der Arbeitsordner selbst lässt sich weder
   umbenennen noch löschen. Alle diese Aktionen wirken unmittelbar auf
   das Dateisystem und werden dank der Live-Synchronisation (siehe
   Punkt 2) sofort im Baum sichtbar. (Eigene Buttons für „Neuer
   Ordner“/„Neue Datei“ im Kopf von Bereich 1 gibt es bewusst nicht mehr
   — das wäre doppelte Funktionalität zum Kontextmenü gewesen.)
11. **Diff erstellen (latexdiff)**: Am Fuß von Bereich 1 (gleiche Höhe wie
   der Kopf) sitzt der Button „Diff erstellen“. Er vergleicht die per
   **Einfachklick** im Arbeitsordner ausgewählte Datei (die „alte“
   Version) mit der aktuell **im Editor geöffneten** Datei (die „neue“
   Version) über das Kommandozeilenwerkzeug `latexdiff`. Der Editor-Inhalt
   wird dafür zuvor automatisch gespeichert. Das Ergebnis ist eine neue
   Datei `diff-<alt>-vs-<neu>.tex` im selben Ordner wie die Editor-Datei,
   mit `\DIFadd{…}`/`\DIFdel{…}`-Markierungen (inkl. der von `latexdiff`
   automatisch ergänzten Präambel-Pakete) — sie wird nach Erstellung
   automatisch im Editor geöffnet. Sind ausgewählte und geöffnete Datei
   identisch oder fehlt eine der beiden Auswahlen, erscheint eine
   entsprechende Statusmeldung statt eines Fehlers.
12. **Quellen**: Der vierte Bereich zeigt die im Arbeitsordner gefundenen
   BibTeX-Einträge (Schlüssel, Typ, Titel, Autor, Jahr).
   - **Doppelklick** auf einen Eintrag öffnet in einem neuen Fenster/Tab
     dessen Quelle: ein vorhandenes `url`-, `link`- oder `doi`-Feld, sonst
     ersatzweise eine Google-Scholar-Suche nach Titel und Autor.
   - **Ziehen** (Drag & Drop) eines Eintrags in den Editor (Bereich 2)
     fügt `\cite{schlüssel}` genau an der Position ein, an der losgelassen
     wird.
   - **Rechtsklick** öffnet ein Kontextmenü mit „Link/Google Scholar
     öffnen“, „\cite{} an Cursor einfügen“ (Alternative zum Ziehen),
     „Bearbeiten“ (roher BibTeX-Quelltext im Dialog editierbar) und
     „Löschen“ (mit Sicherheitsabfrage).
   - Der Button „+ Neu“ oben in Bereich 4 öffnet denselben
     Bearbeiten-Dialog mit einem vorausgefüllten `@article`-Gerüst zum
     Anlegen eines neuen Eintrags. Ist noch keine `.bib`-Datei geöffnet,
     wird vorher nach einem Dateinamen gefragt (Vorschlag:
     `referenzen.bib`) und die Datei bei Bedarf im Arbeitsordner neu
     angelegt.
13. **Projekt speichern/laden**: Trage oben einen Projektnamen ein und
    klicke „Speichern“, um Projektname, Arbeitsordner sowie zuletzt
    geöffnete `.tex`-/`.bib`-Datei serverseitig unter `projects/<name>.json`
    zu sichern. Über das Dropdown und „Laden“ lässt sich der Zustand
    später wiederherstellen.

## Automatische Sicherungen (.bak)

Bei jeder inhaltlichen Änderung einer bestehenden Datei wird zuvor
automatisch eine Sicherungskopie unter demselben Namen mit angehängtem
`.bak` abgelegt (z. B. `kapitel1.tex` → `kapitel1.tex.bak`). Eine neue
`.bak`-Datei überschreibt dabei jeweils die vorherige — es wird also immer
der Stand *unmittelbar vor* der letzten Änderung aufbewahrt, nicht der
gesamte Verlauf. Betroffen sind:

- Speichern einer `.tex`-/`.txt`-Datei im Editor (auch beim automatischen
  Speichern alle 5 Minuten)
- Löschen einer Datei über das Kontextmenü (die gelöschte Datei bleibt so
  als `.bak` erhalten)
- Anlegen, Bearbeiten und Löschen einzelner BibTeX-Einträge (jeweils die
  gesamte `.bib`-Datei wird vor der Änderung gesichert)

Kein Backup wird erzeugt beim Umbenennen (der Inhalt ändert sich nicht),
beim Anlegen einer komplett neuen Datei (es gibt noch nichts zu sichern)
oder beim Löschen eines ganzen Ordners (ein einzelnes `.bak` kann keinen
Ordnerinhalt abbilden).

## Projektstruktur

```
src/
  main.rs      – HTTP-Routen und Server-Setup: Verzeichnisbaum, Ordner-
                 auswahl (/api/browse), Ordner anlegen (/api/folder/create),
                 Datei lesen/speichern/erstellen/umbenennen/löschen,
                 Dateisystem-Überwachung als Server-Sent Events
                 (/api/watch), Bildvorschau (/api/image), Tabellenvorschau
                 (/api/table), Kompilieren (/api/compile), Diff-Erstellung
                 (/api/latexdiff), BibTeX lesen sowie einzelne Einträge
                 anlegen/bearbeiten/löschen (/api/bib/entry/create,
                 /api/bib/entry, /api/bib/entry/delete)
  tree.rs      – Rekursiver Verzeichnisbaum für den Arbeitsordner
  watch.rs     – Überwacht einen Ordner rekursiv auf Dateisystem-Änderungen
                 (über die `notify`-Bibliothek, unter Linux inotify) und
                 meldet sie entprellt (300 ms) über einen Kanal zurück;
                 beendet sich sauber, sobald der SSE-Client die Verbindung
                 trennt
  bibtex.rs    – Einfacher, klammertoleranter BibTeX-Parser
  table.rs     – Liest .xlsx/.xls/.xlsb/.ods über die `calamine`-Bibliothek
                 sowie .csv über einen eigenen, anführungszeichen-fähigen
                 Parser (mit Komma-/Semikolon-Erkennung) in eine
                 einheitliche Kopfzeilen-/Zeilen-Struktur
  compile.rs   – pdflatex-/bibtex-Pipeline (mit -file-line-error) inkl.
                 Log-Auswertung zu strukturierten Fehlern/Warnungen mit
                 Zeilennummer
  latexdiff.rs – Ruft das externe Kommandozeilenwerkzeug `latexdiff` auf
                 und schreibt dessen Ausgabe als neue .tex-Datei
                 (`diff-<alt>-vs-<neu>.tex`) neben die Editor-Datei
  project.rs   – Speichern/Laden von Projektkonfigurationen (JSON-Dateien)
static/
  index.html   – Seitenstruktur (Buttonleiste + 4 Bereiche mit Kopf- und
                 teilweise Fußleisten + Dialoge + Kontextmenüs)
  style.css    – Layout (10% / 40% / 40% / 10%) und Optik; Kopf- und
                 Fußleisten aller Bereiche nutzen dieselbe CSS-Variable
                 (--area-header-height) für eine einheitliche Höhe
  app.js       – Frontend-Logik (fetch-Aufrufe, Baum mit typ-passenden
                 Icons und Auf-/Zuklappen, live per Server-Sent Events mit
                 dem Dateisystem synchronisiert, CodeMirror, Tabs,
                 Ordnerauswahl-Dialog, Kontextmenüs, Bild-/Tabellenvorschau,
                 Drag-&-Drop-Einfügen von \figure/\table/\cite,
                 automatisches Speichern alle 5 Minuten, Suchen/Ersetzen
                 mit Treffer-Hervorhebung, LaTeX-Autovervollständigung,
                 Diff-Erstellung)
  vendor/codemirror/ – Lokal eingebettete CodeMirror-5-Dateien (JS/CSS,
                 inkl. LaTeX-Modus, Eclipse-Theme, dem Search-Cursor-Addon
                 für die Suchen/Ersetzen-Leiste und dem Hint-Addon für die
                 LaTeX-Autovervollständigung). Bewusst NICHT per CDN
                 eingebunden, damit der Editor unabhängig von externer
                 Netzwerkerreichbarkeit (Firewalls, Ad-Blocker, Offline-
                 Nutzung) zuverlässig lädt.
projects/      – Abgelegte Projektkonfigurationen (wird automatisch erstellt)
```

## Bekannte Einschränkungen

- Der Ordnerpfad wird als Text eingegeben (kein nativer Browser-Datei-Dialog),
  da der Server direkten Zugriff auf das lokale Dateisystem benötigt.
- Der BibTeX-Parser deckt die gängigen Fälle ab (verschachtelte Klammern,
  Anführungszeichen, nackte Zahlenwerte), aber keine `@string`-Makros.
- Beim Ziehen einer Tabellendatei in den Editor wird deren Inhalt über eine
  kurze synchrone Anfrage an den Server geladen (technisch notwendig, damit
  die Daten noch innerhalb desselben Zieh-Vorgangs zur Verfügung stehen);
  bei sehr großen Dateien kann das Ziehen dadurch kurz stocken. Für eine
  reine Vorschau ohne diese Verzögerung genügt der Doppelklick.
- Für Mehrbenutzerbetrieb ist der Server nicht ausgelegt — er dient als
  lokales Werkzeug für ein einzelnes LaTeX-Projekt zur Zeit.
- `.bak`-Sicherungen werden im selben Ordner wie die Originaldatei abgelegt
  und erscheinen dadurch auch im Ordnerbaum (Bereich 1). Das ist so
  beabsichtigt (Transparenz), kann bei sehr vielen Änderungen aber optisch
  auffallen.

## Hinweis zu einem behobenen Fehler (PDF-Vorschau)

Frühere Versionen banden CodeMirror per CDN (`cdnjs.cloudflare.com`) ein.
War dieses CDN nicht erreichbar (Firewall, Ad-Blocker, Offline-Nutzung),
schlug die Editor-Initialisierung fehl, *bevor* die App sich den geöffneten
Dateipfad gemerkt hatte — mit der Folge, dass „Kompilieren“ scheinbar
grundlos mit „Bitte zuerst eine .tex-Datei auswählen“ abbrach und nie eine
PDF entstand. CodeMirror wird jetzt lokal mitgeliefert (`static/vendor/`)
und lädt daher ganz ohne externe Netzwerkabhängigkeit; zusätzlich merkt sich
die App den geöffneten Dateipfad jetzt unabhängig davon, ob die
Editor-Anzeige selbst erfolgreich aufgebaut werden konnte.

Zusätzlich sendete `/api/pdf` (und `/api/image`) bislang keinen
`Content-Disposition`-Header. Ohne diesen Header überlassen manche Browser
die Entscheidung "inline anzeigen vs. herunterladen" einer Heuristik, die
je nach Browser-Version, Einstellungen oder installierten Erweiterungen
zum Herunterladen statt Anzeigen führen kann — der PDF-Tab blieb dann leer
und stattdessen öffnete sich ein Download-Dialog. Beide Endpunkte senden
jetzt explizit `Content-Disposition: inline`, was Browsern eindeutig
mitteilt, den Inhalt direkt darzustellen.

## Hinweis zu einem behobenen Fehler (unsichtbare Icons)

Frühere Versionen verwendeten für sämtliche Icons (Dateibaum, Buttons,
Kontextmenüs, Statusmeldungen) Unicode-Emoji-Zeichen. Deren Darstellung
hängt davon ab, ob auf dem jeweiligen System eine Farb-Emoji-Schriftart
installiert ist (z. B. „Noto Color Emoji“ unter Linux, standardmäßig
gebündelt unter Windows/macOS) — auf vielen Linux-Server- oder
Minimal-Installationen fehlt eine solche Schriftart, wodurch alle Icons
unsichtbar blieben, obwohl der restliche Text normal angezeigt wurde. Alle
Icons sind jetzt als eingebettetes SVG-Sprite (`<symbol>`-Definitionen am
Anfang von `index.html`, referenziert per `<use>`) umgesetzt und
verwenden `currentColor`/CSS-Klassen zur Einfärbung statt Emoji-Zeichen.
Dadurch sind sie unabhängig von installierten Schriftarten auf jedem
System identisch sichtbar. Als Nebeneffekt wurden dabei auch die
Buttons „Neuer Ordner“/„Neue .tex-Datei“ im Kopf von Bereich 1 entfernt,
da dieselbe Funktionalität bereits über das Rechtsklick-Kontextmenü
verfügbar war (siehe Punkt 10 oben).
