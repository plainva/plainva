# Erste Schritte

Stand: 2026-07-29

Diese Seite bringt Dich von der Installation zum ersten Arbeiten: Vault öffnen oder anlegen, die Oberfläche kennenlernen, die drei Editor-Modi verstehen.

## Was ist ein Vault?

Ein Vault ist ein ganz normaler Ordner auf Deinem Rechner, in dem Deine Markdown-Notizen liegen. Plainva legt darin einen versteckten Unterordner `.plainva/` für den Suchindex und Einstellungen an — Deine Notizen selbst bleiben unangetastete `.md`-Dateien. Du kannst mehrere Vaults haben (z. B. „Privat" und „Arbeit") und zwischen ihnen wechseln.

## Einen Vault öffnen oder anlegen

Beim **allerersten** Start — bevor Du je einen Vault geöffnet hast — zeigt Plainva einmalig ein kurzes Willkommen. Es erklärt in drei Zeilen, worauf Plainva aufbaut, zeigt daneben eine kleine Vorschau der Oberfläche und bietet direkt die drei Wege hinein an: **Vault öffnen**, **Neuer Vault** und **Aus anderer App importieren**. Mit **Später** überspringst Du es und landest auf dem normalen Willkommensbildschirm; wieder erscheint es nicht — es sei denn, Du holst es unter **Einstellungen → Start & Verhalten → Willkommensbildschirm** zurück.

Nach einem Update zeigt dieselbe Stelle, was sich geändert hat: die größte Neuerung dieser Version mit eigener Überschrift, der Rest als je eine Zeile. Er erscheint einmal je Version — unter **Einstellungen → Start & Verhalten → Release-Highlights erneut anzeigen** kannst Du ihn jederzeit erneut aufrufen.

Beim Start begrüßt Dich der Willkommensbildschirm:

- **Vault öffnen** — Plainva fragt zuerst **„Wo liegt Dein Vault?"**: **Lokaler Ordner** öffnet einen bestehenden Ordner mit Markdown-Dateien auf diesem Computer (auch Obsidian-Vaults funktionieren direkt); **Online-Vault** synchronisiert einen bestehenden Vault aus der Cloud in einen lokalen Ordner — bei allen Anbietern in denselben drei Schritten (**Verbinden**, **Ordner in der Cloud wählen**, **lokalen Ordner wählen**; siehe [Sync einrichten](Sync_Setup.md)).
- **Neuer Vault** — zuerst kommt die Frage **„Wo soll Dein Vault liegen?"** (**Auf diesem Computer** oder **Bei einem Online-Dienst**), danach wählst Du die Startstruktur: leer oder mit einer vorbereiteten Ordnerstruktur; beides ist jederzeit anpassbar. Der **Leere Vault** enthält nur eine `index.md`-Übersicht. Als Vorlagen stehen **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** und **Journal** bereit — jede legt Ordner, eine Willkommensnotiz mit Kurzanleitung und automatisch gepflegte `index.md`-Übersichten im [OKF-Format](OKF.md) an (Ordner- und Dateinamen folgen der App-Sprache). Die **Journal**-Vorlage richtet zusätzlich die Tagesnotizen-Einstellungen des Vaults gleich mit ein. Die Vorlagen **PARA**, **GTD**, **Zettelkasten** und **Journal** bringen außerdem fertig verknüpfte [Datenbanken](Databases_Base.md) samt Notiz-Vorlagen mit — etwa Projekte mit Status-Board und Bereichs-Bezug oder Aufgaben, die auf ihr Projekt verweisen. Beim Online-Weg folgt nach der Vorlage die Verbindung: Anbieter wählen, verbinden, den Ordner in der Cloud wählen oder über **Neuer Ordner** frisch anlegen, lokalen Ordner wählen — die gewählte Struktur entsteht im lokalen Ordner und wird beim ersten Sync in die Cloud hochgeladen.

Unter **Kürzliche Vaults** findest Du alles, was Du schon einmal geöffnet hast. Mit **Aus Liste entfernen** verschwindet ein Eintrag nur aus Plainva — die Dateien bleiben auf der Festplatte. Die Option **Letzten Vault beim Start automatisch öffnen** überspringt den Willkommensbildschirm künftig. Beim Entfernen fragt Plainva, ob zusätzlich alle App-Daten des Vaults vergessen werden sollen (Suchindex, Einstellungen, Fenster-Layout, Sync-Zugangsdaten; automatische ZIP-Backups nur über die extra Checkbox) – Dein Vault-Ordner bleibt in jedem Fall unangetastet.

## Die Oberfläche

- **Linke Seitenleiste** — drei Ansichten: **Dateien** (der Dateibaum), **Tags** (alle `#tags` im Vault) und **Datenbanken** (jede `.base` im Vault, nach Ordner gruppiert — ein Klick öffnet sie); Lesezeichen und Zuletzt geöffnet sind Abschnitte über dem Baum. Ganz oben liegt das Suchfeld, daneben ein **+** für Neue Notiz, Neuer Ordner, Neue Base und Tageseintrag. Der Platzhalter im Suchfeld sagt, was gerade durchsucht wird, und die Reiter tragen ihren Namen, solange die Leiste breit genug ist — wird sie schmaler, behält zuerst nur noch der aktive Reiter seinen Namen, dann bleiben die Symbole. Unten: Vault-Wechsler, **Tägliche Notiz öffnen** und **Einstellungen**. Ein Klick auf das Doppelpfeil-Symbol neben den Ansichten klappt alle Ordner auf einmal ein oder aus, und **Im Dateibaum anzeigen** im ⋮-Menü des Editors zeigt die geöffnete Notiz direkt im Baum. In der Ansicht **Dateien** zeigt eine Kopfzeile den Namen und das Icon des aktuellen Vaults, und ein Streifen **Zuletzt geöffnet** über dem Baum bietet Ein-Klick-Zugriff auf die zuletzt geöffneten Notizen.
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
- **Dieselben Aktionen in den Abschnitten über dem Baum:** Ein Rechtsklick auf einen Eintrag in **Zuletzt geöffnet** oder **Lesezeichen** öffnet dasselbe Menü — ohne die Ordner-Einträge, dafür mit **Aus der Liste entfernen** (das nimmt nur den Eintrag aus der Liste, nie die Datei). Umbenannt wird dort über einen Abfrage-Dialog statt im Feld der Zeile. Die Kalender- und Aufgabenübersicht kann ebenfalls in **Zuletzt geöffnet** stehen; sie lässt sich öffnen und aus der Liste nehmen, aber nicht umbenennen oder löschen — sie ist eine Ansicht, keine Datei.
- **Mehrfachauswahl:** Löschen mit einer Bestätigung, Duplizieren und Verschieben per Drag funktionieren für alle ausgewählten Elemente zusammen. Gelöschtes landet im Papierkorb des Betriebssystems.
- Neue Notizen starten automatisch mit einer `# Überschrift` aus dem Dateinamen.
- Die eigene `index.md` eines Ordners (seine Übersicht) sortiert im Baum an den **Anfang** dieses Ordners, über seine Unterordner und Dateien — nicht alphabetisch zwischen den übrigen Notizen.
- **Neu einlesen:** Der Kreispfeil in der Kopfzeile des Baums (oder **F5**) liest den Vault neu ein — Plainva gleicht den Index mit dem Ordner ab und holt bei Online-Vaults zusätzlich die Cloud-Dateien. Anschließend zeigt ein kurzer Bericht, was neu, geändert, entfernt oder übersprungen wurde. Für einzelne Ordner gibt es **Ordner neu einlesen** im Rechtsklick-Menü.

## Tägliche Notizen

Der Knopf **Tageseintrag** in der linken Aktionsleiste öffnet bzw. erstellt die Notiz des Tages. Basis-Ordner, Datumsformat und eine optionale Vorlage stellst Du unter **Einstellungen → Vault → Inhalt & Struktur** (über **Ordner auswählen…** neben dem Feld wählst Du den Ordner auch direkt im Vault) ein.

Das Datumsformat nutzt dieselben Kürzel wie Obsidian: `YYYY` Jahr, `MM` Monat, `DD` Tag, `dddd` Wochentagsname — `YYYY-MM-DD dddd` ergibt `2026-07-29 Wednesday`. Text, der unverändert bleiben soll, gehört in eckige Klammern: `[Tagebuch] YYYY-MM-DD`. Monats- und Wochentagsnamen sind immer englisch, damit ein Wechsel der App-Sprache Deine vorhandenen Tagesnotizen nicht unauffindbar macht.

Der **Kalender** rechts ist eine Tagesübersicht: Ein **Klick** auf ein Datum öffnet den [Kalender-Tab](Calendar_and_Tasks.md) an diesem Tag; ein **Rechtsklick** öffnet ein Menü, das oben den Tag nennt und **Kalender öffnen**, **Tageseintrag** sowie die Termine und fälligen Aufgaben des Tages anbietet. Tage mit einer Tagesnotiz tragen ein kleines **Sonnen-Symbol**, Tage mit Terminen farbige Punkte je Kalender. Der **Heute**-Knopf bringt Dich zurück zum aktuellen Monat; ein Klick auf das Monatslabel öffnet eine Schnellauswahl für Monat und Jahr. Dort blendest Du über **Kalenderwochen anzeigen** auch eine KW-Spalte ein — die Einstellung bleibt gespeichert.

## Einstellungen

**Einstellungen** (Zahnrad unten in der Aktionsleiste ganz links oder `Strg+,`) schließen über das **X** oben rechts, `Esc` oder einen Klick außerhalb des Fensters. Änderungen speichern sofort automatisch — nur Cloud-Zugangsdaten übernimmst Du bewusst per **Verbinden** im Bereich **Cloud-Konten** (siehe [Sync einrichten](Sync_Setup.md)). Die Einstellungen sind zweigeteilt; jeder Bereich in der linken Leiste öffnet seine eigene Seite, auf der die Einstellungen in benannten Gruppen-Karten liegen:

- **App** — alles, was app-weit gilt, in fünf Bereichen. **Erscheinungsbild**: die **Theme**-Auswahl als Vorschau-Karten — neben **Petrol** (Standard) stehen **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (E-Ink-artig, maximal ruhig), **Sepia** (warmes Papier), **Wald**, **Mitternacht** (OLED-Schwarz), **Hoher Kontrast** und **Phosphor Grün**/**Phosphor Amber** (Retro-Terminal mit dezenten Scanlines) bereit; dazu der **Modus** (**Hell**/**Dunkel**/**System-Standard**; Ein-Modus-Themes wie **Mitternacht** legen den Modus fest, der Hell/Dunkel-Schalter in der Titelleiste pausiert dann), **Sprache**, **Wochenbeginn**, **Kompaktheitsgrad** und **Oberflächen-Zoom**. **Editor & Notizen**: **Standard-Ansicht**, **Inhalts-Schriftgröße** und **Inhalts-Schriftart**. **Start & Verhalten**: letzten Vault automatisch öffnen, Kompatibilitäts-Hinweise. **Updates**: Plainva sucht beim Start still nach neuen Versionen und zeigt bei Funden einen Hinweis — ein Klick darauf lädt und installiert das Update direkt (der Hinweis bleibt bis zum Neustart stehen). Abschaltbar über **Beim Start nach Updates suchen**. **Über & Diagnose**: Versionsangaben, Status des **OS-Keychain**, **Performance-Messwerte**, **Diagnose exportieren…** (ohne Notizinhalte) und **Problem melden**. Die Tastenkombinationen erreichst Du jederzeit per `F1` oder **Tastenkombinationen anzeigen** unten links.
- **Vault** — der gewählte Vault steht als kleine Karte in der Leiste (der aktive Vault trägt einen Punkt); bei mehreren Vaults öffnet **Wechseln** darunter eine Auswahl-Liste. Darunter die Bereiche pro Vault: **Cloud-Konten** ist der eine Ort für alle Cloud-Anmeldungen — **Konto verbinden…** wählt den Anbieter (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV oder ein E-Mail-Postfach) und die Dienste (**Dateien**, **Kalender & Aufgaben**, **E-Mail**), die dieses Konto tragen soll. Die Dienst-Bereiche **Synchronisation** (siehe [Sync einrichten](Sync_Setup.md)), **Kalender** (siehe [Kalender & Aufgaben](Calendar_and_Tasks.md)) und **E-Mail** (siehe [E-Mail-Erfassung](Email_Capture.md)) erscheinen erst, wenn ein verbundenes Konto den jeweiligen Dienst trägt. Dazu immer: **Inhalt & Struktur** (**Tagesnotizen**, **Vorlagen** (der **Vorlagen-Ordner**), **Tagesnotizen** (inkl. ihrer **Vorlage**), der **Eingangsordner**, der **Anhänge-Ordner**, **Aufgaben**, **OKF (Open Knowledge Format)** — siehe [OKF](OKF.md) — und **Erweiterte Datenbanken**), **Backup & Versionierung** und **Wartung** (**Index neu aufbauen**, gelöschte Dateien wiederherstellen, Vault-Statistik).

## Tabs

- **Rechtsklick auf einen Tab** öffnet sein Menü: **Anheften**, **Neu laden**, **Im Split öffnen (rechts)**, **Pfad kopieren**, **Im Dateimanager zeigen** und die Schließen-Gruppe.
- **Anheften** hält einen Tab fest: Er rückt an den Anfang der Leiste, zeigt statt des Schließen-Kreuzes eine Nadel und überlebt jedes **Andere schließen** / **Links schließen** / **Rechts schließen** / **Alle schließen**. Zum Schließen erst wieder **Lösen**.
- **Neu laden** verwirft die Ansicht und liest die Datei frisch von der Platte — nützlich, wenn ein anderes Programm sie geändert hat. Hat der Tab ungespeicherte Änderungen, lehnt Plainva das Neuladen ab, statt Deine Arbeit zu überschreiben.

## Leisten & Bereiche anpassen

Die Aktionsleiste ganz links, die Reiter der linken Seitenleiste, die Abschnitte über dem Dateibaum und die Abschnitte der rechten Seitenleiste folgen alle derselben Mechanik.

Die Aktionsleiste bietet **Neue Notiz**, **Neuer Ordner** und **Neue Base** an. Alle drei legen im **ausgewählten Ordner** des Dateibaums an; ist eine Datei ausgewählt, in deren Ordner; ist nichts ausgewählt, auf der obersten Ebene. Der **Tageseintrag** hält sich nicht daran — er gehört immer in den Ordner, den Du in den Einstellungen dafür festgelegt hast. Brauchst Du eine der drei nicht, blende sie aus.

**Direkt an Ort und Stelle:** **Halte** einen Knopf oder eine Abschnitts-Überschrift gedrückt und ziehe ihn an seine neue Stelle — ein normaler Klick löst weiterhin nur aus, und wer beim Halten scrollt, scrollt (das Ziehen bricht dann ab). Mit `Esc` brichst Du ein laufendes Ziehen ab. Ein **Rechtsklick** bietet dieselben Aktionen ohne Halten: **Nach oben**, **Ausblenden** und **Leisten anpassen…**.

**Zentral:** Unter **Einstellungen → Vault → Leisten & Bereiche** liegen alle vier Leisten untereinander. Jede ist **eine** Liste mit einer Trennlinie: Was darüber steht, ist sichtbar; was darunter steht, ist ausgeblendet. Verschoben wird hier mit dem Zieh-Griff — auf dieser Seite wird eine Liste geordnet, deshalb ist der Griff hier richtig. Ziehst Du an den oberen oder unteren Rand, scrollt die Seite mit, sodass ein Eintrag auch von ganz unten nach ganz oben in einer Bewegung wandert.

Zwei Dinge lassen sich bewusst nicht ausblenden: **Hilfe** und **Einstellungen** ganz unten in der Aktionsleiste, und der Reiter **Dateien** der linken Seitenleiste. Alles andere darfst Du ausblenden; ausgeblendete Aktionen der Aktionsleiste bleiben über die **Befehls-Palette** (`Strg+P`) erreichbar. Abschnitte der rechten Seitenleiste, die zur geöffneten Notiz nichts zu zeigen haben, erscheinen ohnehin gar nicht erst.

Die Anordnung gehört zum Vault und reist über die [Einstellungs-Synchronisation](Sync_Setup.md) zu Deinen anderen Geräten. Ein Vault, in dem Du nichts geändert hast, folgt Deinem **Standard** — den setzt Du mit **Als Standard übernehmen**, und mit **Auf Standard zurücksetzen** kehrt ein angepasster Vault dorthin zurück.

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

## Globale Einstellung der rechten Seitenleiste

Abschnitte, die zur geöffneten Notiz nichts zu zeigen haben — **Gliederung**, **Backlinks**, **Eigenschaften**, **Datenbanken** — erscheinen gar nicht erst, statt als graue Zeile stehen zu bleiben. Die gesamte rechte Seitenleiste merkt sich für Notizen eine globale Einstellung; Vollflächenansichten ohne Notizkontext schließen sie nur vorübergehend.

**Wenn Du die Leiste schmal ziehst**, wechselt sie in drei Stufen, damit nichts zerbricht:

- **ab 280 px** — wie gewohnt.
- **232–280 px** — Eigenschaften stehen mit dem Namen über dem Wert statt daneben, lange Werte brechen um, die Abschnitte rücken enger.
- **unter 232 px** — der Kalender zeigt **eine Woche statt des Monats** (sieben Tage, Kalenderwoche rechts darunter); ein Monatsraster hätte hier 14 Pixel breite Zellen und wäre kein Kalender mehr. Der Graph wird flacher, und Backlinks zeigen nur noch den Dateinamen ohne Pfadzeile.

Schmaler als **200 px** lässt sich die rechte Leiste nicht ziehen — darunter ist kein Abschnitt mehr bedienbar. Die linke Leiste darf weiter bis 150 px, weil Dateinamen dort einfach kürzen.
