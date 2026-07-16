# Datenbanken (.base)

Stand: 2026-07-16

Mit `.base`-Dateien verwandelst Du Notizen in Datenbanken: Tabellen, Boards, Kalender — mit Filtern, typisierten Eigenschaften und Relationen zwischen Datenbanken. Das Konzept ähnelt Notion-Datenbanken, mit einem entscheidenden Unterschied: **Die Daten liegen nicht in der Datenbank, sondern in Deinen Notizen.**

> **Tipp:** Legst Du einen neuen Vault mit der Vorlage **PARA**, **GTD**, **Zettelkasten** oder **Journal** an (siehe [Erste Schritte](Getting_Started.md)), sind passende Datenbanken bereits fertig eingerichtet und untereinander verknüpft — ein guter Ausgangspunkt, um zu sehen, wie alles zusammenspielt.

## Das Kernkonzept

Eine `.base`-Datei speichert nur die *Sicht* auf Deine Notizen: welche Quellen (Ordner, Tags), welche Ansichten, welche Filter und Spalten. Die eigentlichen Werte stehen im Frontmatter der einzelnen Markdown-Notizen — jede Tabellenzeile *ist* eine Notiz.

Das heißt konkret:

- Änderst Du eine Zelle in der Tabelle, schreibt Plainva den Wert in das Frontmatter der Notiz.
- Löschst Du die `.base`-Datei, verlierst Du nur die Sicht — alle Daten bleiben in den Notizen erhalten.
- Dieselben Notizen können in beliebig vielen Datenbanken zugleich auftauchen.

Das Dateiformat ist mit Obsidians Bases-Format kompatibel (Details am Seitenende).

## Eine Datenbank anlegen

- **Dateibaum**: Rechtsklick → **Neue Datenbank (.base)** — oder über den **Neu**-Knopf der Seitenleiste (**Neue Base**).
- Der Wizard **Neue Datenbank** fragt zwei Dinge: die **Datenquelle** (mindestens ein **Ordner** oder ein **Tag**; Kombinationen grenzen weiter ein — ein Zähler zeigt live, wie viele Notizen passen) und die Spalten (in den gefundenen Notizen vorhandene Eigenschaften zum Übernehmen). Dann **Datenbank erstellen**.
- **In einer Notiz**: Slash-Befehl **Datenbank einbetten** (bestehende `.base` inline anzeigen) oder **Inline-Datenbank erstellen** (neue `.base` im Ordner anlegen und einbetten).

Jede Datenbank kann ein eigenes Icon mit **Icon-Farbe der Datenbank** tragen — sichtbar im Dateibaum, in Tabs und im Header.

## Ansichten

Eine Datenbank kann beliebig viele Ansichten haben; jede hat einen **Ansichtstyp**:

| Ansicht | Wofür |
|---|---|
| **Tabelle** | Klassisches Raster, sortierbar, mit Inline-Editing und optionalen Unterelementen |
| **Liste** | Kompakte Zeilenliste |
| **Galerie** | Karten mit optionalem **Titelbild** |
| **Board** | Kanban-Spalten, gruppiert nach einer Eigenschaft (**Gruppieren nach**) — Karten per Drag verschieben ändert den Wert; eine **Spaltenüberschrift** per Drag ordnet die Spalten um |
| **Kalender** | Einträge nach **Datumsfeld** auf einem Monatskalender, Einträge per Drag verschiebbar |
| **Zeitachse** | Zeitstrahl mit **Startdatum** und optionalem **Enddatum** |

**Ansicht hinzufügen** legt neue an; über **Ansichts-Optionen** kannst Du **Umbenennen**, **Duplizieren**, **Löschen** und die Reihenfolge per Drag ändern. Welche Ansicht zuletzt aktiv war, merkt sich Plainva pro Datei. Kalender und Zeitachse brauchen ein Datumsfeld (**Nur Datum** oder **Datum & Uhrzeit** als **Format**); Einträge zeigen die in den **Eigenschaften** aktivierten Felder an.

## Konfigurieren: Quellen, Filter, Sortierung, Eigenschaften

Der Knopf **Konfigurieren** (oben rechts) öffnet das Panel mit vier Bereichen:

- **Datenquelle** — Ordner- und Tag-Quellen der Datenbank (auch das **Hauptverzeichnis** ist wählbar). Keine Quelle = alle Dateien.
- **Filter** — Regelzeilen aus Eigenschaft, Operator und Wert. Die Operatoren passen sich dem Feldtyp an: **ist** / **ist nicht** / **enthält** / **enthält nicht** / **ist leer** / **ist nicht leer**, für Zahlen **größer als** / **kleiner als** / **mindestens** / **höchstens**, für Datumsfelder **nach** / **vor** / **ab** / **bis**. Die **Logik** oben entscheidet, ob **Alle** Bedingungen (UND) oder **Beliebige** (ODER) gelten. Mit **Gruppe hinzufügen** baust Du Notion-artige Filtergruppen: ein Kasten mit eigener UND/ODER-Logik innerhalb der Hauptlogik. Sehr verschachtelte Filter aus Obsidian zeigt Plainva als **Komplexer Filter (nicht editierbar)** an — sie bleiben erhalten und werden angewendet. Filter werden **pro Ansicht** gespeichert (das Panel weist mit **Gilt für diese Ansicht** darauf hin): Jede Ansicht behält ihre eigenen Filterregeln, während die **Datenquelle** (Ordner/Tags) für die ganze Datenbank gilt. Alles lebt in der `.base`-Datei, nicht in einem separaten Speicher.
- **Sortierung** — mehrere Sortierregeln (**Aufsteigend**/**Absteigend**); die Priorität änderst Du per Drag.
- **Eigenschaften** — Spalten ein-/ausblenden, die Reihenfolge per Drag ändern, **Neue Eigenschaft** anlegen.

## Eigenschaften und Feldtypen

Ein Klick auf einen Spaltenkopf öffnet den Eigenschafts-Editor (**Eigenschaft: X**):

- **Name** — Umbenennen wirkt auf die Notizen: Beim Speichern wird die Eigenschaft in allen passenden Notizen im Frontmatter umbenannt (mit Bestätigung und Fortschrittsanzeige).
- **Feldtyp** — Text, Zahl, Kontrollkästchen, Datum, Datum & Uhrzeit, Liste, Tags, Auswählen, Status, Mehrfachauswahl, URL, E-Mail, Telefon, Relation (dasselbe gruppierte Typ-Menü wie im **Eigenschaften**-Panel der Notizen).
- **Optionen** (bei Auswahl/Status/Mehrfachauswahl) — feste Werte mit **Farbe** und bei **Status** einer **Gruppe**/Stufe (z. B. offen → in Arbeit → erledigt); Reihenfolge per Drag. Beim Öffnen des Spalten-Editors ist die Optionsliste bereits mit den Werten vorbelegt, die in der Datenbank vorkommen — so kannst Du jedem eine Farbe geben, ohne ihn erst neu einzutippen.
- **Eigenschaft löschen** — entfernt Spalte, Schema, Filter und Sortierungen aus der Datenbank. Die Checkbox **Auch aus dem Frontmatter der Notizen entfernen** (standardmäßig an) bereinigt zusätzlich die Quell-Notizen.

Hinweise zum Verhalten:

- Fehlt eine Eigenschaft in manchen Notizen, bietet Plainva an, sie leer **in N Quelldateien einzutragen**.
- Bei **Auswählen**, **Status**, **Mehrfachauswahl**, **Liste** und **Tags** trennt ein Komma im Wert mehrere Einträge; im Typ **Text** bleibt das Komma normaler Text.
- Die OKF-Systemfelder `type` und `okf_version` sind auch hier geschützt: Name, Feldtyp und Löschen sind gesperrt, und `okf_version` lässt sich in den Zellen nicht bearbeiten (Hintergrund: [OKF](OKF.md)).

## Relationen

Relationen verknüpfen Notizen miteinander — wie in Notion, aber gespeichert als ganz normale `[[Wiki-Links]]` im Frontmatter (in Obsidian als klickbare Property-Links sichtbar).

- **Anlegen**: Neue Eigenschaft vom Feldtyp **Relation**. Optional wählst Du eine **Ziel-Datenbank (.base)** — dann schlägt der Picker nur Notizen aus dieser Datenbank vor (leer = **Beliebige Notiz**; **Diese Datenbank** erlaubt Selbst-Relationen). Die **Kardinalität** begrenzt auf **Genau 1** oder lässt **Keine Begrenzung**.
- **Werte setzen**: Der Picker sucht Notizen, schließt den aktuellen Eintrag aus und kann per **Neue Notiz anlegen** direkt ein Ziel erstellen. Zeigt ein Chip „Verlinkte Notiz existiert nicht", ist der Link verwaist (Ziel gelöscht/umbenannt außerhalb von Plainva).
- **Rückrelation**: Die Option **Auf „X" anzeigen** legt in der Ziel-Datenbank eine berechnete Spalte an, die die Verknüpfungen rückwärts zeigt — sie ist direkt editierbar (Änderungen schreiben in die verlinkenden Notizen). Löschen der Relation nimmt ihre Rückspalte mit.
- **Unterelemente**: Bei Selbst-Relationen kannst Du **Unterelemente aktivieren** — Einträge mit Eltern-Relation erscheinen in der Tabelle aufklappbar unter ihrem Eltern-Eintrag (Zyklen werden abgefangen; ausgeschaltet bleibt die Liste flach, die Werte bleiben erhalten).
- **Board nach Relation**: Boards können nach einer Relation gruppieren; Karten-Drag zwischen Spalten setzt den Link um.
- **Filter auf Relationen**: enthält / enthält nicht / ist leer / ist nicht leer, mit Notiz-Auswahl.
- Backlinks zählen mit: Frontmatter-Links erscheinen im **Backlinks**-Panel, und Datei-Umbenennungen ziehen Relation-Links automatisch nach.

## Neue Einträge anlegen

Der **Eintrag**-Knopf oben links (vormals **Neu**; klar getrennt vom globalen **Neu** der Seitenleiste) erstellt ein neues Element:

- Der Dateiname folgt dem Muster `{Datenbankname}_{laufende Nummer}` (Leerzeichen werden zu `_`); die Notiz startet mit passender Überschrift und erbt Tag-Quellen sowie einfache Filterwerte der Datenbank, damit sie sofort in der Ansicht erscheint. Danach öffnet sich das Peek-Fenster zum Ausfüllen.
- **Ablage-Ordner**: Neue Elemente landen dauerhaft in einem festgelegten Ordner. Hat die Datenbank keine Ordner-Quelle, führt Dich ein Dialog einmalig durch die Anlage; bei mehreren Ordner-Quellen wählst Du einmal aus. Später jederzeit änderbar über das Pfeil-Menü am Knopf → **Ablage-Ordner ändern…**.
- **Vorlagen**: Das Pfeil-Menü (**Vorlagen und Ablage-Ordner**) listet die Vorlagen Deines Vault-Template-Ordners — einmalig nutzen, per Stern **Als Standard setzen** (gilt dann für jeden Klick auf **Eintrag** dieser Datenbank) oder **Neue Vorlage erstellen** (eine neue Vorlage startet mit einer `# {{title}}`-Überschrift, sodass daraus erstellte Einträge ihren Dateinamen als H1 bekommen). Dasselbe Menü bietet außerdem **Vorlagen-Ordner öffnen**, das den Vorlagen-Ordner im Dateibaum anzeigt — Vorlagen sind normale Notizen, die Du dort bearbeiten, umbenennen oder löschen kannst.
- **Vorlagen je Datenbank**: Vorlagen lassen sich Datenbanken zuordnen. Das Pfeil-Menü zeigt standardmäßig nur die dieser Datenbank zugeordneten Vorlagen (plus ihre Standard-Vorlage); alle übrigen erreichst Du über **Alle Vorlagen anzeigen (n)**. Zuordnen geht direkt dort — das Datenbank-Symbol an jeder Zeile heißt **Dieser Datenbank zuordnen** bzw. **Zuordnung zu dieser Datenbank entfernen** — oder auf der Vorlage selbst: Im ⋮-Menü des Editors öffnet **Ziel-Datenbanken…** einen Dialog mit Suchfeld, in dem Du die Vorlage mehreren Datenbanken zuweist. Eine über **Neue Vorlage erstellen** aus einer Datenbank angelegte Vorlage ist ihr automatisch zugeordnet. Gespeichert wird die Zuordnung als `plainva.templateFor`-Liste im Frontmatter der Vorlage (siehe [Dateiformat-Referenz](File_Format_Reference.md)); beim Anlegen eines Eintrags wird sie nie in die neue Notiz übernommen, und beim Umbenennen einer `.base` ziehen die Zuordnungen automatisch mit. Der Slash-Befehl **Vorlage einfügen** bleibt bewusst ungefiltert — er fügt Text in eine bestehende Notiz ein und hat keinen Datenbank-Kontext.
- **Vorlagen-Platzhalter**: Vorlagen ersetzen `{{title}}`, `{{date}}` und `{{time}}`. Beim *Einfügen* einer Vorlage in eine Notiz (Slash-Befehl **Vorlage einfügen** / `Mod+Alt+T`) kommen zwei weitere hinzu: `{{cursor}}` markiert, wo der Cursor nach dem Einfügen landet, und `{{prompt:Bezeichnung}}` fragt Dich nach einem Wert (Beschriftung *Bezeichnung*) und fügt Deine Antwort ein. Beim Erstellen einer *neuen* Notiz aus einer Vorlage wird `{{cursor}}` entfernt und `{{prompt:…}}` bleibt leer.

## Bedienung im Alltag

- **Inline-Editing**: Ein Einfach-Klick in eine Zelle (oder auf einen Karten-Wert) macht sie editierbar — in allen Ansichten.
- **Öffnen**: Ein Klick auf den Eintragstitel öffnet die Notiz im Peek-Fenster — einem frei beweglichen Fenster, das Du an der Titelleiste verschieben und an der Ecke in der Größe anpassen kannst. Es hat eine eigene **Zurück**/**Vorwärts**-Historie für die darin geöffneten Notizen, einen Umschalter, der eine **Eigenschaften**-Spalte für die gezeigte Notiz einblendet, sowie **Als Tab öffnen** und **Im Split öffnen**. `Strg`+Klick öffnet direkt im Split; alternativ ziehst Du eine Karte auf die Drop-Zone **Hier ablegen: im Split öffnen**.
- **Drag**: Beim Ziehen von Karten (Board, Kalender, Zeitachse) folgt eine Ghost-Karte dem Mauszeiger. In einem **Board** kannst Du außerdem eine **Spaltenüberschrift** ziehen, um die Spalten umzuordnen — bei **Auswahl**/**Status**-Boards ordnet das die Optionen der Eigenschaft um (die Dropdowns überall folgen), Relations- und Freitext-Boards merken sich die Reihenfolge pro Ansicht.
- **Spaltenfarbe**: In den **Ansicht**-Einstellungen eines Boards lässt **Spaltenfarbe** eine Spalte die Farbe ihrer Gruppe annehmen — entweder **Ganze Liste** (die ganze Spalte wird eingefärbt) oder **Nur Chip** (nur der Chip in der Überschrift, Standard). Gilt für Auswahl-/Status-/Mehrfachauswahl-Gruppen.
- **Einbetten**: Datenbanken lassen sich in Notizen einbetten (Slash-Befehl **Datenbank einbetten** oder `@` → **Datenbanken**) und dort vollwertig bedienen.
- **Automatischer Filter in einem verknüpften Element**: Bettest Du eine Datenbank in ein einzelnes Element einer *verknüpften* Datenbank ein, wird sie automatisch auf dieses Element gefiltert — bette die Aufgaben-Datenbank in eine Projekt-Notiz ein, und Du siehst nur die Aufgaben dieses Projekts. Das funktioniert in beide Richtungen (die „Viele"-Seite einbetten, um die auf das Element zeigenden Zeilen zu sehen, oder die „Eins"-Seite, um zu sehen, worauf das Element zeigt) und für selbstverknüpfte Datenbanken mit einer Über-/Unterelemente-Hierarchie (bettest Du die Datenbank in ein Element ein, erscheinen dessen Unterelemente, verschachtelt). Ein kleiner **Filter**-Chip in der Kopfzeile des Embeds zeigt, worauf gefiltert wird; darüber kannst Du die Relation wechseln oder **Alle anzeigen** wählen. Der Filter wird nie in die `.base`-Datei geschrieben — dieselbe Datenbank zeigt also in jedem Element, in das sie eingebettet ist, die richtigen Zeilen.
- **Neue Einträge erben die Verknüpfung**: Legst Du mit **Eintrag** innerhalb eines so gefilterten Embeds einen Eintrag an, wird er automatisch mit dem Element verknüpft (eine Aufgabe, die Du in der eingebetteten Aufgabenliste eines Projekts anlegst, gehört sofort zu diesem Projekt). In der Gegenrichtung wird stattdessen das Element mit dem neuen Eintrag verknüpft; eine bereits belegte Einzelwert-Relation bleibt unangetastet.
- **Expliziter Filter „Diese Notiz" (wie Notions „this page")**: Statt Dich auf den automatischen Filter zu verlassen, kannst Du ihn explizit und dauerhaft setzen. Füge unter **Konfigurieren → Filter** eine Regel auf einer Relations-Eigenschaft hinzu und wähle als Wert **Diese Notiz**. Die Datenbank ist dann auf die jeweilige Notiz gefiltert, in die sie eingebettet ist — ideal für **Vorlagen**: Bette die Aufgaben-Datenbank in eine Projekt-Vorlage ein, und jedes daraus erstellte Projekt zeigt seine eigenen Aufgaben. Es funktioniert für jede Wiki-Link-Eigenschaft, nicht nur für erkannte Relationen, und ein expliziter **Diese Notiz**-Filter hat Vorrang vor dem automatischen. Dieser Filter lebt nur in Plainva (er wird nicht als normaler Filter in die `.base` geschrieben), sodass Obsidian und ein Öffnen als eigener Tab beide alle Zeilen zeigen.

## Beispiel: so sieht eine .base-Datei aus

`.base`-Dateien sind YAML — hier eine einfache Projektliste:

```yaml
filters:
  and:
    - 'file.hasTag("projekt")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: offen
          color: teal
          group: Aktiv
        - value: erledigt
          color: gray
          group: Abgeschlossen
views:
  - type: table
    name: Alle Projekte
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Alles Plainva-Spezifische (Farben, Board-Darstellung, Relationen, Ablage-Ordner) liegt unter `plainva:`-Schlüsseln.

## .base-Dateien direkt bearbeiten (Werkzeuge und KI)

Wenn ein Skript oder ein KI-Assistent `.base`-Dateien schreibt, ohne den Weg über Plainva zu gehen, zählen drei harte Regeln — bei einem Verstoß weigert sich Obsidian, die ganze Datei zu öffnen:

- **Nur die Top-Level-Schlüssel `filters`, `formulas`, `properties`, `views`.** Niemals einen weiteren Top-Level-Schlüssel ergänzen; alle Plainva-Extras liegen unter verschachtelten `plainva:`-Unterschlüsseln.
- **Jede View braucht einen nicht-leeren String-`name`.**
- **Ein `filters`-Objekt trägt pro Ebene genau eines von `and` / `or` / `not`** (nie zwei nebeneinander).

Noch eine Stolperfalle: Eigenschafts-IDs sind in der `properties:`-Map und in `order`/`sort` einer View `note.`-präfigiert (`note.status`), aber **bare** in Filter-Ausdrücken (`status == "Erledigt"`) und in `plainva`-Unterschlüsseln (`groupBy: status`).

Der vollständige Formatvertrag — jedes Feld, das komplette zweiseitige Relations-Beispiel und die Regeln fürs sichere Bearbeiten — steht in der [Dateiformat-Referenz](File_Format_Reference.md).

## Und Obsidian?

Das Format entspricht Obsidians Bases-Format; Plainva schreibt seine Erweiterungen ausschließlich in `plainva:`-Unterschlüssel, die Obsidian ignoriert („graceful degradation"):

- Obsidian öffnet die Datei fehlerfrei; Plainva-Ansichten wie Board/Kalender/Zeitachse erscheinen dort als einfache Tabelle.
- Rückrelations-Spalten erscheinen in Obsidian leer (sie sind berechnet); Relation-Werte in Notizen sind dort als klickbare Links sichtbar.
- Beim ersten Einsatz einer Plainva-Erweiterung weist ein Dialog (**Plainva-Erweiterung**) darauf hin; abschaltbar in den **Einstellungen** unter **Erweiterte Datenbanken** bzw. **Warnhinweise**.

## Siehe auch

- [Dateiformat-Referenz](File_Format_Reference.md) — der genaue `.base`-Formatvertrag für Werkzeuge und das Bearbeiten von Hand
- [Notizen & Markdown](Notes_and_Markdown.md) — Eigenschaften/Frontmatter im Detail
- [OKF](OKF.md) — einheitliche `type`-Felder machen Datenbanken verlässlicher
