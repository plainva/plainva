# Notizen & Markdown

Stand: 2026-08-19

Jede Notiz in Plainva ist eine gewöhnliche Markdown-Datei (`.md`). Diese Seite erklärt, wie Du komfortabel schreibst und was dabei tatsächlich in der Datei landet — denn genau das macht Deine Notizen portabel: Jeder Text-Editor, Obsidian oder ein Git-Diff kann sie lesen.

## Das Grundprinzip: alles ist Text

Was Du in Plainva siehst — formatierter Text, Tabellen, Eigenschaften, Icons — wird als offener Text gespeichert:

```markdown
---
type: Note
okf_version: "0.1"
tags: [projekt]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mein Projekt

Ein **fetter** Gedanke mit einem Link auf [[Andere Notiz]].

- [ ] Erste Aufgabe
```

Der Block zwischen den `---`-Zeilen heißt **Frontmatter** (YAML): Dort liegen die Eigenschaften der Notiz. Darunter folgt der normale Markdown-Text. Plainva-eigene Darstellung (Icon, Header-Farbe) liegt gebündelt unter dem Schlüssel `plainva:` — andere Programme ignorieren ihn einfach.

## Schreiben in der Live-Vorschau

Die **Live-Vorschau** ist der Standard-Modus: Markdown wird beim Tippen gerendert, bleibt aber jederzeit editierbar.

### Das Slash-Menü

Tippe `/` am Zeilenanfang, um das Einfüge-Menü zu öffnen. Es ist in Sektionen gegliedert:

- **Grundlagen** — Text, Überschrift 1–6, Aufzählung, Nummerierte Liste, Aufgabenliste, Zitat, Code-Block, Tabelle, Trennlinie, **Formel (LaTeX)**, **Mermaid-Diagramm**
- **Text formatieren** — Fett, Kursiv, Durchgestrichen, Inline-Code, Markierung, **Emoji**
- **Verknüpfen & Einbetten** — Link, Interner Link, Bild (Web), Internes Bild, Einbettung, Datenbank einbetten, Inline-Datenbank erstellen
- **Dokument** — Dokument-Icon, Header-Farbe, Vorlage einfügen
- **Callouts** — 13 Varianten (Notiz, Info, To-do, Zusammenfassung, Tipp, Erfolg, Frage, Warnung, Fehlschlag, Gefahr, Bug, Beispiel, Zitat)

### Weitere Schreibhelfer

- **Auswahl-Toolbar** — markiere Text, und eine kleine Leiste bietet **Fett**, **Kursiv**, **Durchgestrichen**, **Inline-Code**, **Markierung** und **Link** an.
- **`@`-Mentions** — tippe `@` mitten im Text: fügt **Datum** (Heute, Morgen, Gestern oder **Datum wählen…**, gespeichert als ISO-Datum), Links auf **Notizen** oder **Datenbanken** ein.
- **Emoji** — der Slash-Befehl **Emoji** (`/emoji`) öffnet an der Schreibmarke einen Emoji-Picker; oder tippe `:name` (zum Beispiel `:rocket`) für Inline-Vorschläge. In beiden Fällen fügt Plainva das echte Emoji-**Zeichen** ein (portables Unicode), nie einen `:shortcode:` — so bleibt die Notiz in Obsidian, auf GitHub und überall sonst lesbar. (Das ist unabhängig vom **Dokument-Icon** der Notiz, das im Frontmatter liegt.)
- **Block-Griffe** — links neben jedem Absatz erscheint beim Überfahren ein Griff: per Drag verschiebst Du den Block, per Klick öffnet sich das Menü **Block-Aktionen** (**Umwandeln in** Text/Überschrift/Liste/Aufgabe/Zitat/Code-Block, **Duplizieren**, **Nach oben**/**Nach unten**, **Block löschen**). Ziehst Du eine Liste neben eine gleichartige Liste, fügt Plainva eine unsichtbare Trennzeile `<!-- -->` ein, damit beide Listen getrennt bleiben — in Markdown verschmelzen gleichartige Listen sonst trotz Leerzeile (auch in Obsidian).
- **Tabellen** — als Widget mit Klick-Editing in jeder Zelle. Die Zellen-Anzeige rendert Formatierung (**fett**, *kursiv*, `Code`, Markierung), klickbare Links (`[[Interner Link]]`, Web-Adressen) und `<br>` als Zeilenumbruch; beim Bearbeiten siehst Du den Rohtext. Das Tabellen-Menü bietet Zeilen/Spalten einfügen und löschen sowie die Ausrichtung (**Linksbündig**/**Zentriert**/**Rechtsbündig**).
- **Listen** schreiben sich weiter (Enter setzt das nächste Listenzeichen), Code-Blöcke werden je Sprache farbig hervorgehoben (auch im Lesemodus), eingefügte Inhalte werden als Markdown übernommen (Smart-Paste), Überschnitte lassen sich einklappen (Faltung).
- **Suchen & Ersetzen** in der aktuellen Notiz: `Strg+F` (siehe [Suche](Search.md)).

## Links und Backlinks

- **Interne Links**: `[[Notizname]]` (Wiki-Link) — per Slash-Menü oder `@` mit eingebauter Notiz-Suche. Klassische Markdown-Links `[Text](Pfad.md)` funktionieren ebenso.
- **Noch nicht angelegte Ziele**: Ein Wiki-Link auf eine Notiz, die es noch nicht gibt, wird **gedämpft und gestrichelt** dargestellt (in der Live-Vorschau wie im Lesemodus). Ein **Klick legt die Notiz an** und öffnet sie — sie liegt im Ordner der aktuellen Notiz (bzw. im angegebenen Pfad, wenn der Link einen enthält, z. B. `[[Ordner/Neue Notiz]]`). Möchtest Du vorher gefragt werden, aktiviere **Einstellungen → App → Editor & Notizen → Vor dem Anlegen leerer Links fragen**.
- **Backlinks**: Der Abschnitt **Backlinks** in der rechten Seitenleiste zeigt, welche Notizen auf die aktive verlinken — pro Quelldatei zusammengefasst, mit Zähler bei mehreren Vorkommen.
- **Umbenennen mit Link-Pflege**: Benennst Du eine Datei im Dateibaum um, aktualisiert Plainva alle Links darauf im ganzen Vault (Anker wie `#Abschnitt` bleiben erhalten) und meldet: „N Link(s) in M Datei(en) wurden auf den neuen Namen aktualisiert."

## Eigenschaften (Frontmatter)

Der Abschnitt **Eigenschaften** in der rechten Seitenleiste zeigt das Frontmatter der Notiz als Formular. Mit **Eigenschaft hinzufügen** legst Du neue an; jede Eigenschaft hat einen **Feldtyp**:

| Gruppe | Typen |
|---|---|
| **Einfach** | Text, Zahl, Kontrollkästchen, Datum, Datum & Uhrzeit |
| **Auswahl** | Auswählen, Status, Mehrfachauswahl |
| **Listen & Relationen** | Liste, Tags, Relation |
| **Web & Kontakt** | URL, E-Mail, Telefon |

Auswahl-Typen können feste Optionen mit **Farbe** und (bei **Status**) **Gruppe**/Stufe tragen — diese Optionslisten werden in Datenbanken (`.base`) gepflegt, siehe [Datenbanken (.base)](Databases_Base.md).

Zwei Felder sind geschützt: `type` und `okf_version` sind **OKF-Systemfelder** und werden von Plainva verwaltet — der `type`-Wert ist als Dropdown bekannter Typen wählbar, Name/Feldtyp/Löschen sind gesperrt (Hintergrund: [OKF](OKF.md)).

## Dokument-Icon und Header-Farbe

Jede Notiz kann ein Icon (Notion-artig über dem Titel, auch im Tab und Dateibaum sichtbar) und einen Farbstreifen über die volle Breite tragen:

- In der Live-Vorschau über dem Titel: **Icon hinzufügen** / **Farbstreifen hinzufügen** (später: **Icon ändern** / **Farbstreifen ändern**) — oder per Slash-Befehle **Dokument-Icon** und **Header-Farbe**.
- Der Icon-Picker kennt zwei Modi — **Emoji** und **Icons** —, die gleich bedient werden: dieselbe Kopfzone, dieselbe Suche, in beiden Modi **Kategorien** (Reiter) und ein Bereich **Zuletzt verwendet**, der auch einen Neustart überlebt.
- Der Icon-Satz umfasst rund **400 kuratierte Icons** in zehn Kategorien (Wissen & Dateien, Arbeit & Aufgaben, Technik, Menschen & Kontakt, Kreativ & Medien, Alltag & Zuhause, Natur & Wetter, Reisen & Orte, Geld & Zahlen, Zeichen & Zustände). Die Suche greift auf Namen und Stichwörter, auch deutsche.
- Im Icon-Modus wählst Du oben eine **Farbe** — dieselbe Palette wie beim Farbstreifen, **A** für die Standardfarbe, **Eigene Farbe …** für einen freien Wert. Sie gilt für das Icon, das Du anschließend antippst.
- Gespeichert wird beides im Frontmatter unter `plainva:` (`icon`, `icon_color`, `header_color`) — reine Darstellung, die andere Programme nicht stört.

## Vorlagen (Templates)

Lege einen **Vorlagen-Ordner (Templates)** in den **Einstellungen → Vault → Inhalt & Struktur** (über **Ordner auswählen…** neben dem Feld wählst Du den Ordner auch direkt im Vault) fest. Dann fügst Du Vorlagen per `Strg+Alt+T` oder Slash-Befehl **Vorlage einfügen** ein. Vorlagen bestimmen den Inhalt neuer Dateien vollständig — inklusive Frontmatter: Bringt die Vorlage ein eigenes `type` mit, gewinnt es. Beim Einfügen in eine bestehende Notiz bleibt das Frontmatter der Vorlage außen vor — es landet nur der Inhalt.

**Platzhalter**: Vorlagen setzen benannte Platzhalter ein — keine Skripte, keine Ausdrücke; nichts davon führt Code aus.

| Platzhalter | Was er einsetzt |
| --- | --- |
| `{{title}}` | Den Titel der Notiz |
| `{{date}}`, `{{time}}` | Datum bzw. Uhrzeit; mit eigenem Format: `{{date:DD.MM.YYYY}}` |
| `{{date+7}}`, `{{date-1}}` | Verschobenes Datum, mit Format kombinierbar |
| `{{yesterday}}`, `{{tomorrow}}` | Vortag, Folgetag |
| `{{weekday:monday}}`, `{{weekday:next friday}}` | Den Wochentag dieser bzw. der nächsten Woche; Format nach einem zweiten Doppelpunkt: `{{weekday:monday:DD.MM.}}`. Wo die Woche beginnt, folgt Deiner Kalender-Einstellung |
| `{{daily}}`, `{{daily+1}}`, `{{daily-1}}` | Einen Link auf die Tagesnotiz von heute, morgen oder gestern; mit eigener Beschriftung: `{{daily+1:Morgen}}` |
| `{{folder}}`, `{{vault}}` | Ablageordner der Notiz, Name des Vaults |
| `{{cursor}}` | Kein Text — markiert, wo die Schreibmarke danach steht |
| `{{prompt:Label}}`, `{{prompt:Label\|Vorgabe}}` | Fragt Dich nach Text (angezeigt als *Label*) |
| `{{select:Label\|A,B,C}}` | Fragt Dich mit einer Auswahlliste |
| `{{date_prompt:Label}}` | Fragt Dich nach einem Datum |
| `{{selection}}` | Den markierten Text — beim Einfügen einer Vorlage |
| `{{clipboard}}` | Die Zwischenablage — sie erscheint als **vorbelegte Frage**, nie unbemerkt in der Notiz |
| `\{{date}}` | Den Platzhalter selbst, unaufgelöst |

**Sprache der Datumsangaben**: Wochentage und Monatsnamen (`dddd`, `MMMM`) erscheinen in der Sprache der App — in einer deutschen Oberfläche schreibt `{{date:dddd, D. MMMM YYYY}}` also *Mittwoch, 29. Juli 2026*. Der **Dateiname** einer Tagesnotiz bleibt bewusst englisch: er muss zu dem Format passen, mit dem er angelegt wurde, sonst findet Plainva bestehende Tagesnotizen nicht mehr wieder.

Fragt eine Vorlage etwas, stellt Plainva **alle** Fragen zusammen in einem Dialog, bevor die Notiz geschrieben wird — beim Einfügen wie beim Anlegen; ein Abbruch legt nichts an. Nur bei Notizen, die im Hintergrund entstehen (etwa beim Aufgaben-Abgleich), wird nicht gefragt: dort bleiben die Antworten leer. Ein Platzhalter, den Plainva nicht kennt, bleibt sichtbar stehen — so sieht ein Tippfehler wie ein Tippfehler aus.

**Auf dem Telefon** arbeitet dieselbe Engine: Die Platzhalter werden ersetzt, die Fragen einer Vorlage erscheinen zusammen in einem Blatt (ein Abbruch legt nichts an), und die Zuordnungen Ordner → Vorlage und Notiztyp → Vorlage greifen auch dort — eine Notiz in `Projekte/` beginnt also auf beiden Geräten gleich. Zwei Unterschiede: Zugeordnet wird am Desktop (das Telefon wendet die Regeln nur an), und `{{weekday:…}}` rechnet dort immer ab Montag, weil es die Einstellung für den Wochenbeginn mobil noch nicht gibt.

**Vorlagen-eigene Angaben**: Eine Vorlage kann Angaben tragen, die nur für sie selbst gelten — dass ihre Aufgaben nicht in der **Aufgaben**-Übersicht auftauchen, oder zu welchen Datenbanken sie gehört. Eine daraus erstellte Notiz erbt sie nicht. Sehr alte Tagesnotizen können sie noch tragen; wie Du sie findest, steht in den [Häufigen Fragen](FAQ.md).

**Vorlagen je Ordner**: Unter **Einstellungen → Vault → Inhalt & Struktur → Vorlagen** ordnest Du einem Ordner eine Vorlage zu — jede neue Notiz dort startet dann aus ihr, ohne dass Du etwas wählst. Die Zuordnung gilt auch für Unterordner; passen mehrere, gewinnt der längste Pfad (`Projekte/Kunden` schlägt `Projekte`). Genauso ordnest Du eine Vorlage einem **Notiztyp** zu; sie greift, wenn für den Ordner nichts hinterlegt ist — Ordner schlägt Typ. Über **Neue Notiz aus Vorlage …** (Rechtsklick im Dateibaum, Befehls-Palette oder Schnellöffner) wählst Du eine Vorlage ausdrücklich — das schlägt jede Zuordnung. Die Zuordnungen liegen in den Einstellungen, nicht in den Notizen, und reisen über die Einstellungs-Synchronisation auf Deine anderen Geräte.

Vorlagen erstellen geht von überall: Die Befehls-Palette (`Strg+P`) bietet **Neue Vorlage erstellen** (eine frische Vorlage öffnet sich zum Bearbeiten) und **Aktuelle Notiz als Vorlage speichern** (kopiert die offene Notiz in den Vorlagen-Ordner). Vorlagen sind gewöhnliche Markdown-Dateien — bearbeite, benenne oder lösche sie direkt im Dateibaum.

## Tägliche Notizen

**Tägliche Notiz öffnen** (Seitenleiste) oder ein Klick im **Kalender** erstellt die Notiz des Tages nach Deinem **Datumsformat** im eingestellten **Basis-Ordner für tägliche Notizen**, optional aus einer Vorlage.

## Aufgaben, Formeln, Diagramme und Fußnoten

- **Aufgaben-Checkboxen**: `- [ ] Aufgabe` wird überall als Checkbox angezeigt — und im **Lesemodus** kannst Du sie direkt anklicken: Plainva schreibt `[x]` bzw. `[ ]` in die Datei zurück.
- **Mathe (LaTeX)**: `$E = mc^2$` im Fließtext und `$$…$$` als Block werden im Lesemodus UND in der Live-Vorschau als Formeln gerendert (KaTeX). Steht die Schreibmarke in der Formel, siehst Du die Syntax; ein Klick auf eine gerenderte Formel öffnet sie zum Bearbeiten. Nur der Quelltext-Modus zeigt immer die rohe Syntax. Den `$$…$$`-Block musst Du nicht auswendig kennen — der Slash-Befehl **Formel (LaTeX)** (`/katex`) fügt ihn ein und setzt die Schreibmarke hinein.
- **Mermaid-Diagramme**: Ein Codeblock mit der Sprache `mermaid` (am schnellsten über den Slash-Befehl **Mermaid-Diagramm**, `/mermaid`) wird im Lesemodus und in der Live-Vorschau als Diagramm gezeichnet — ein Klick auf das Diagramm zeigt den Code zum Bearbeiten:

  ````markdown
  ```mermaid
  graph TD
    Idee --> Notiz --> Wissen
  ```
  ````

- **Fußnoten**: `Text[^1]` und am Ende `[^1]: Die Fußnote.` — der Lesemodus rendert Verweis und Fußnotenapparat mit Sprungmarken. Am schnellsten geht es über den Slash-Befehl **Fußnote** (`/fußnote`): Er fügt den nächsten freien Verweis ein und springt direkt in die Definition am Notizende.

## Drucken und als PDF speichern

Im **⋮**-Menü des Editors und in der Befehls-Palette (`Strg+P`) findest Du **Drucken / Als PDF…**: Gedruckt wird immer die Leseansicht (aus Live/Quelltext wechselt Plainva vorher automatisch hinein). Im Systemdialog kannst Du statt eines Druckers auch „Als PDF speichern" wählen.

## Notiz exportieren

- **Als Markdown exportieren…** (⋮-Menü des Editors oder Befehls-Palette): speichert über den Systemdialog eine Kopie der Notiz an einen beliebigen Ort — zum Beispiel für ein anderes Programm. Verknüpfte Anhänge (Bilder) werden nicht mitkopiert; verweist die Notiz auf welche, zeigt Plainva einen kurzen Hinweis.
- **PDF**: Nutze **Drucken / Als PDF…** (oben) und wähle im Systemdialog „Als PDF speichern".

## Notiz in einer anderen App öffnen

Deine Notizen sind einfache `.md`-Dateien, jeder Markdown-Editor kann sie öffnen. Im **⋮**-Menü des Editors gibt es **In Standard-App öffnen**: Damit übergibt Plainva die aktuelle Notiz an die App, die Dein System für Markdown-Dateien verwendet (etwa Byword, MacDown oder VS Code). Plainva beobachtet die Datei weiter, sodass dort gemachte Änderungen hier automatisch erscheinen.

## Bilder und Anhänge

- **Einfügen**: Slash-Befehle **Internes Bild** (aus dem Vault suchen & einbetten) oder **Bild (Web)** (per URL). Außerdem: Eine Datei aus der Zwischenablage einfach **einfügen** (Strg+V) — ein Bild ebenso wie ein PDF oder eine Tabelle. Und Du kannst Dateien **aus dem Datei-Explorer in den Editor ziehen**: Bilder werden eingebettet (`![[…]]`), andere Dateien kopiert und verlinkt (`[[…]]`). Wohin diese Dateien kommen, ist eine Einstellung: **Einstellungen → Dein Vault → Inhalt & Struktur → Anhänge-Ordner** (Vorgabe `Attachments`, mit Ordner-Browser). Lässt Du sie leer, bleiben die Dateien neben der Notiz — so wie Plainva es vor dieser Einstellung gemacht hat. Der Ordner reist mit der Einstellungs-Synchronisation, also legen Rechner und Telefon Anhänge am selben Ort ab.
- **Datei anhängen…**: Der Slash-Befehl **Datei anhängen…** und derselbe Eintrag im **⋮**-Menü der Notiz öffnen den Dateidialog Deines Systems; am Telefon findest Du ihn im **＋**-Blatt unter **Datei vom Gerät…**. Die Datei wird in den Anhänge-Ordner kopiert — Bilder werden eingebettet (`![[…]]`), alles andere verlinkt (`[[…]]`).
- **Verlinken**: Tippst Du `[[`, schlägt Plainva zuerst Notizen vor und darunter, unter **Anhänge**, die Dateien Deines Vaults.
- **Ansehen**: Bilddateien (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) öffnen im eingebauten Bildviewer mit **Vergrößern**/**Verkleinern**, **Einpassen** und **Originalgröße (1:1)**.
- **Bearbeiten**: Der Knopf **Bearbeiten** öffnet den Bild-Editor mit **Zuschneiden**, Drehen/Spiegeln, **Größe ändern**, Zeichenwerkzeugen (**Stift**, **Pfeil**, **Rechteck**, **Text**) sowie **Rückgängig**/**Wiederholen**. Speichern direkt oder **Als Kopie speichern…**. Bearbeitbar sind PNG, JPG und WebP; andere Formate öffnen nur zur Ansicht.
- **Textdateien** öffnen in Plainva selbst: `.txt`, `.csv`, `.json`, `.yaml`, Quelltext und Ähnliches. Braucht Dein Vault mehr, trägst Du die Endungen unter **Einstellungen → Dein Vault → Inhalt & Struktur → Weitere Textdateien** ein — die Liste kann nur erweitern, nie etwas wegnehmen. Verrät der Dateianfang, dass es doch keine Textdatei ist, zeigt Plainva sie nicht an, sondern bietet das Standardprogramm an: sie anzuzeigen und zu speichern würde sie beschädigen. Eine so geöffnete Datei behält beim Speichern ihre Zeilenenden und ihr BOM — sie gehört Dir, nicht Plainva. Beim Bearbeiten färbt Plainva den Text anhand der Dateiendung ein — dieselbe Hervorhebung wie in einem Codeblock innerhalb einer Notiz. Die Notiz-Werkzeuge bleiben dabei aus: keine Live-Vorschau, kein Eigenschaften-Kopf, keine `[[Links]]`, kein „/"-Menü. Suchen und Ersetzen bleibt, weil das eine Textfunktion ist und keine Notiz-Funktion.
- Sonstige Anhänge öffnen per Klick im Standardprogramm des Systems — im Dateibaum ebenso wie über einen `[[Link]]`, ein Lesezeichen oder die Suche.

## Und Obsidian?

Alles bleibt Standard-Markdown mit Standard-Frontmatter. Obsidian öffnet die Dateien vollständig; den gebündelten `plainva:`-Schlüssel zeigt es als nicht editierbares Objekt in den Properties an — das ist beabsichtigt und stört nicht.

## Siehe auch

- [Datenbanken (.base)](Databases_Base.md) — Notizen als Tabelle, Board oder Kalender
- [OKF](OKF.md) — was `type` und `okf_version` bedeuten
- [Suche](Search.md) und [Tastenkürzel](Keyboard_Shortcuts.md)

## Auswahl formatieren

Erstreckt sich eine Auswahl über mehrere Zeilen, werden **Fett**, *Kursiv*, Durchgestrichen, Hervorhebung und Inline-Code getrennt auf jede nichtleere Zeile angewandt. Listen-, Zitat-, Überschriften- und Aufgabenpräfixe bleiben außerhalb der Inline-Markierungen. Links bleiben einzeilig, weil ein mehrzeiliger Linktext kein portables Markdown ist.

Eine ATX-Überschrift und eine GFM-Aufgabe sind alternative Blocktypen. Plainva schreibt deshalb keine fehlerhafte Mischform. Inline-Formatierungen funktionieren in beiden Blöcken vollständig; nutze `- [ ] **Wichtige Aufgabe**` für einen hervorgehobenen Aufgabentitel.
