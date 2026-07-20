# Erste Schritte

Stand: 2026-07-20

Diese Seite bringt Dich von der Installation zum ersten Arbeiten: Vault öffnen oder anlegen, die Oberfläche kennenlernen, die drei Editor-Modi verstehen.

## Was ist ein Vault?

Ein Vault ist ein ganz normaler Ordner auf Deinem Rechner, in dem Deine Markdown-Notizen liegen. Plainva legt darin einen versteckten Unterordner `.plainva/` für den Suchindex und Einstellungen an — Deine Notizen selbst bleiben unangetastete `.md`-Dateien. Du kannst mehrere Vaults haben (z. B. „Privat" und „Arbeit") und zwischen ihnen wechseln.

## Einen Vault öffnen oder anlegen

Beim Start begrüßt Dich der Willkommensbildschirm:

- **Vault öffnen** — Plainva fragt zuerst **„Wo liegt Dein Vault?"**: **Lokaler Ordner** öffnet einen bestehenden Ordner mit Markdown-Dateien auf diesem Computer (auch Obsidian-Vaults funktionieren direkt); **Online-Vault** synchronisiert einen bestehenden Vault aus der Cloud in einen lokalen Ordner — bei allen Anbietern in denselben drei Schritten (**Verbinden**, **Ordner in der Cloud wählen**, **lokalen Ordner wählen**; siehe [Sync einrichten](Sync_Setup.md)).
- **Neuer Vault** — zuerst kommt die Frage **„Wo soll Dein Vault liegen?"** (**Auf diesem Computer** oder **Bei einem Online-Dienst**), danach wählst Du die Startstruktur: leer oder mit einer vorbereiteten Ordnerstruktur; beides ist jederzeit anpassbar. Der **Leere Vault** enthält nur eine `index.md`-Übersicht. Als Vorlagen stehen **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** und **Journal** bereit — jede legt Ordner, eine Willkommensnotiz mit Kurzanleitung und automatisch gepflegte `index.md`-Übersichten im [OKF-Format](OKF.md) an (Ordner- und Dateinamen folgen der App-Sprache). Die **Journal**-Vorlage richtet zusätzlich die Tagesnotizen-Einstellungen des Vaults gleich mit ein. Die Vorlagen **PARA**, **GTD**, **Zettelkasten** und **Journal** bringen außerdem fertig verknüpfte [Datenbanken](Databases_Base.md) samt Notiz-Vorlagen mit — etwa Projekte mit Status-Board und Bereichs-Bezug oder Aufgaben, die auf ihr Projekt verweisen. Beim Online-Weg folgt nach der Vorlage die Verbindung: Anbieter wählen, verbinden, den Ordner in der Cloud wählen oder über **Neuer Ordner** frisch anlegen, lokalen Ordner wählen — die gewählte Struktur entsteht im lokalen Ordner und wird beim ersten Sync in die Cloud hochgeladen.

Unter **Kürzliche Vaults** findest Du alles, was Du schon einmal geöffnet hast. Mit **Aus Liste entfernen** verschwindet ein Eintrag nur aus Plainva — die Dateien bleiben auf der Festplatte. Die Option **Letzten Vault beim Start automatisch öffnen** überspringt den Willkommensbildschirm künftig. Beim Entfernen fragt Plainva, ob zusätzlich alle App-Daten des Vaults vergessen werden sollen (Suchindex, Einstellungen, Fenster-Layout, Sync-Zugangsdaten; automatische ZIP-Backups nur über die extra Checkbox) – Dein Vault-Ordner bleibt in jedem Fall unangetastet.

## Die Oberfläche

- **Linke Seitenleiste** — vier Ansichten: **Dateien** (der Dateibaum), **Tags** (alle `#tags` im Vault), **Lesezeichen** und **Datenbanken** (jede `.base` im Vault, nach Ordner gruppiert — ein Klick öffnet sie). Oben sitzt der große **Neu**-Knopf (Neue Notiz, daneben **Weitere Optionen** für Neuer Ordner, Neue Base, Tageseintrag). Unten: Vault-Wechsler, **Tägliche Notiz öffnen** und **Einstellungen**. Ein Klick auf das Doppelpfeil-Symbol neben den Ansichten klappt alle Ordner auf einmal ein oder aus, und **Im Dateibaum anzeigen** im ⋮-Menü des Editors zeigt die geöffnete Notiz direkt im Baum. In der Ansicht **Dateien** zeigt eine Kopfzeile den Namen und das Icon des aktuellen Vaults, und ein Streifen **Zuletzt geöffnet** über dem Baum bietet Ein-Klick-Zugriff auf die zuletzt geöffneten Notizen.
- **Titelleiste** — Deine geöffneten Tabs. Tabs lassen sich per Drag umsortieren und zwischen Editor-Bereichen verschieben.
- **Editor-Bereich** — hier liest und schreibst Du. Über das Tab-Menü (**Rechts teilen** / **Unten teilen**) oder die Kürzel `Strg+Alt+V` / `Strg+Alt+S` teilst Du den Editor in zwei Bereiche (Split), z. B. für Notiz + Datenbank nebeneinander.
- **Rechte Seitenleiste** — vier Abschnitte, per Drag umsortierbar: **Kalender** (Tagesnotizen), **Gliederung** (Überschriften der aktiven Notiz), **Backlinks** (wer verlinkt hierher) und **Eigenschaften** (das Frontmatter der Notiz).
- **Statusleiste** — Wortzahl/Zeichen, Sync-Status (Lokal/Online/Offline) und Speicherstatus (**Speichert...** / **Gespeichert**).

## Die drei Editor-Modi

Oben rechts im Editor wechselst Du den Modus:

| Modus | Wofür |
|---|---|
| **Lesemodus** | Fertig gerenderte Ansicht zum Lesen und Navigieren. Links öffnen direkt in Plainva. |
| **Live-Vorschau** | Der Standard zum Schreiben: Markdown wird beim Tippen gerendert, Formatierungszeichen erscheinen nur, wo Du gerade arbeitest. |
| **Markdown Source** | Der rohe Text ohne Rendering — für volle Kontrolle. |

In welchem Modus Notizen öffnen, bestimmst Du über die **Standard-Ansicht** unter **Einstellungen → App → Editor & Notizen** (Lesen, Live oder Quelltext). Ein manueller Wechsel im Editor gilt je Datei für die laufende Sitzung.

Zusätzlich kannst Du zwischen **Lesbare Breite** und **Volle Breite** umschalten.

## Dateibaum-Grundlagen

- **Anlegen:** Rechtsklick auf einen Ordner → **Neue Notiz hier**, **Neuer Ordner hier** oder **Neue Datenbank (.base)**. Der große **Neu**-Knopf legt im gerade ausgewählten Ordner an (bzw. im Elternordner der ausgewählten Datei).
- **Auswählen:** Klick wählt aus, `Strg`+Klick fügt einzeln hinzu/entfernt, `Umschalt`+Klick wählt einen Bereich, Mittelklick öffnet in einem neuen Tab.
- **Kontextmenü:** u. a. **Umbenennen** (aktualisiert Links vault-weit), **Duplizieren**, **Im Split öffnen (rechts)** / **Im Split öffnen (unten)**, **Lesezeichen hinzufügen**, **Pfad kopieren**, **Im Dateimanager zeigen**, **Löschen**.
- **Mehrfachauswahl:** Löschen mit einer Bestätigung, Duplizieren und Verschieben per Drag funktionieren für alle ausgewählten Elemente zusammen. Gelöschtes landet im Papierkorb des Betriebssystems.
- Neue Notizen starten automatisch mit einer `# Überschrift` aus dem Dateinamen.
- Die eigene `index.md` eines Ordners (seine Übersicht) sortiert im Baum an den **Anfang** dieses Ordners, über seine Unterordner und Dateien — nicht alphabetisch zwischen den übrigen Notizen.

## Tägliche Notizen

Der Knopf **Tageseintrag** in der linken Aktionsleiste öffnet bzw. erstellt die Notiz des Tages. Basis-Ordner, Datumsformat und eine optionale Vorlage stellst Du unter **Einstellungen → Vault → Inhalt & Struktur** (über **Ordner auswählen…** neben dem Feld wählst Du den Ordner auch direkt im Vault) ein.

Der **Kalender** rechts ist eine Tagesübersicht: Ein **Klick** auf ein Datum öffnet den [Kalender-Tab](Calendar_and_Tasks.md) an diesem Tag; ein **Rechtsklick** öffnet ein Menü, das oben den Tag nennt und **Kalender öffnen**, **Tageseintrag** sowie die Termine und fälligen Aufgaben des Tages anbietet. Tage mit einer Tagesnotiz tragen ein kleines **Sonnen-Symbol**, Tage mit Terminen farbige Punkte je Kalender. Der **Heute**-Knopf bringt Dich zurück zum aktuellen Monat; ein Klick auf das Monatslabel öffnet eine Schnellauswahl für Monat und Jahr. Dort blendest Du über **Kalenderwochen anzeigen** auch eine KW-Spalte ein — die Einstellung bleibt gespeichert.

## Einstellungen

**Einstellungen** (Zahnrad unten in der Aktionsleiste ganz links oder `Strg+,`) schließen über das **X** oben rechts, `Esc` oder einen Klick außerhalb des Fensters. Änderungen speichern sofort automatisch — nur Cloud-Zugangsdaten übernimmst Du bewusst per **Verbinden** im Bereich **Cloud-Konten** (siehe [Sync einrichten](Sync_Setup.md)). Die Einstellungen sind zweigeteilt; jeder Bereich in der linken Leiste öffnet seine eigene Seite, auf der die Einstellungen in benannten Gruppen-Karten liegen:

- **App** — alles, was app-weit gilt, in fünf Bereichen. **Erscheinungsbild**: die **Theme**-Auswahl als Vorschau-Karten — neben **Petrol** (Standard) stehen **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (E-Ink-artig, maximal ruhig), **Sepia** (warmes Papier), **Wald**, **Mitternacht** (OLED-Schwarz), **Hoher Kontrast** und **Phosphor Grün**/**Phosphor Amber** (Retro-Terminal mit dezenten Scanlines) bereit; dazu der **Modus** (**Hell**/**Dunkel**/**System-Standard**; Ein-Modus-Themes wie **Mitternacht** legen den Modus fest, der Hell/Dunkel-Schalter in der Titelleiste pausiert dann), **Sprache**, **Wochenbeginn**, **Kompaktheitsgrad** und **Oberflächen-Zoom**. **Editor & Notizen**: **Standard-Ansicht**, **Inhalts-Schriftgröße** und **Inhalts-Schriftart**. **Start & Verhalten**: letzten Vault automatisch öffnen, Kompatibilitäts-Hinweise. **Updates**: Plainva sucht beim Start still nach neuen Versionen und zeigt bei Funden einen Hinweis — ein Klick darauf lädt und installiert das Update direkt (der Hinweis bleibt bis zum Neustart stehen). Abschaltbar über **Beim Start nach Updates suchen**. **Über & Diagnose**: Versionsangaben, Status des **OS-Keychain**, **Performance-Messwerte**, **Diagnose exportieren…** (ohne Notizinhalte) und **Problem melden**. Die Tastenkombinationen erreichst Du jederzeit per `F1` oder **Tastenkombinationen anzeigen** unten links.
- **Vault** — der gewählte Vault steht als kleine Karte in der Leiste (der aktive Vault trägt einen Punkt); bei mehreren Vaults öffnet **Wechseln** darunter eine Auswahl-Liste. Darunter die Bereiche pro Vault: **Cloud-Konten** ist der eine Ort für alle Cloud-Anmeldungen — **Konto verbinden…** wählt den Anbieter (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV oder ein E-Mail-Postfach) und die Dienste (**Dateien**, **Kalender & Aufgaben**, **E-Mail**), die dieses Konto tragen soll. Die Dienst-Bereiche **Synchronisation** (siehe [Sync einrichten](Sync_Setup.md)), **Kalender** (siehe [Kalender & Aufgaben](Calendar_and_Tasks.md)) und **E-Mail** (siehe [E-Mail-Erfassung](Email_Capture.md)) erscheinen erst, wenn ein verbundenes Konto den jeweiligen Dienst trägt. Dazu immer: **Inhalt & Struktur** (**Tagesnotizen**, **Vorlagen & Aufgaben** inkl. **Vorlagen-Ordner (Templates)**, **OKF (Open Knowledge Format)** — siehe [OKF](OKF.md) — und **Erweiterte Datenbanken**), **Backup & Versionierung** und **Wartung** (**Index neu aufbauen**, gelöschte Dateien wiederherstellen, Vault-Statistik).

## Oberfläche anpassen

- **Seitenleisten ein-/ausblenden**: über die beiden Knöpfe in der Titelleiste oder `Strg+Alt+B` (links) / `Strg+Alt+R` (rechts) — ideal zum fokussierten Schreiben. Plainva merkt sich den Zustand.
- **Befehls-Palette**: `Strg+P` öffnet **Befehle** — tippen, mit `Enter` ausführen (Neue Notiz, Tageseintrag, Teilen, Seitenleisten, **Jetzt sichern** u. v. m.).
- **Kompaktheitsgrad**: Unter **Einstellungen → App → Erscheinungsbild** wählst Du zwischen **Standard** und **Kompakt** — Kompakt verdichtet Dateibaum, Listen, Menüs und Tabellen; der Notiz-Inhalt bleibt unverändert.
- **Inhalts-Schrift**: Unter **Einstellungen → App → Editor & Notizen** stellst Du die **Inhalts-Schriftgröße** (12–24 px) und die **Inhalts-Schriftart** ein (Theme-Standard, Serif, Sans-Serif, Monospace oder der Name einer installierten Schriftart) — das skaliert nur Editor und Leseansicht; die Oberfläche bleibt, wie sie ist.
- **Oberflächen-Zoom**: skaliert die GESAMTE Oberfläche zwischen 80 % und 150 % — unter **Einstellungen → App → Erscheinungsbild** oder per `Strg+Plus`/`Strg+Minus` (`Strg+0` setzt zurück).
- **Eigene Dialoge & Hinweise**: Bestätigungen erscheinen als Plainva-Dialoge im Stil Deines Themes (destruktive Aktionen mit rotem Knopf), kurze Meldungen als dezente Hinweise unten rechts — keine System-Popups mehr.

## Siehe auch

- [Notizen & Markdown](Notes_and_Markdown.md) — alles über das Schreiben
- [Tastenkürzel](Keyboard_Shortcuts.md)
- [FAQ & Fehlerbehebung](FAQ.md)

## Der Graph

Über **Strg/Cmd+Umschalt+G** (oder die Sektion **Graph** in der rechten Seitenleiste) siehst Du Dein Vault als Karte: Ordner als Blasen, Notizen als Knoten, Relationen als beschriftete Kanten — samt Aufräum-Modus und Zeitreise. Details: [Graph](Graph.md).
