# Datenbank-Referenz (.base)

Stand: 2026-11-03

Diese Seite listet auf, was eine `.base`-Datei enthalten kann und was Plainva mit jedem Teil macht: jeden Schlüssel der obersten Ebene, jede Filterform, jeden Ansichtstyp mit seinen Optionen, Zusammenfassungen, Sortierung, Grenzen, was mit Schlüsseln geschieht, die Plainva nicht kennt, und wo sich Plainva anders verhält als Obsidian Bases. Sie beschreibt, was der Code von Plainva heute liest, auswertet und schreibt — nicht die Dokumentation von Obsidian.

Für den Alltag lies zuerst [Datenbanken (.base)](Databases_Base.md). Die Regeln, die ein Werkzeug einhalten muss, wenn es Vault-Dateien direkt schreibt, und das vollständige Relations-Beispiel stehen in der [Dateiformat-Referenz](File_Format_Reference.md).

## Auf einen Blick

| Teil der Datei | Was Plainva damit macht |
|---|---|
| `filters` | Liest und wendet die Quellen (Ordner, Tag) und die Bedingungen an, die unter [Filter](#filter) stehen |
| `views` | Liest alle acht Ansichtstypen, ihre Reihenfolge, Sortierung, Filter und Zusammenfassungen |
| `properties` | Liest das Spaltenschema, den Anzeigenamen und den `plainva`-Block von Plainva |
| `summaries` (Ansicht) | Berechnet die vierzehn eingebauten Zusammenfassungen |
| `formulas` | Behält sie in der Datei, berechnet sie nicht |
| `summaries` (oberste Ebene) | Behält eigene Zusammenfassungsformeln, berechnet sie nicht |
| `this` | Noch nicht unterstützt |
| Andere Schlüssel | Behält sie in der Datei (siehe [Schlüssel, die Plainva nicht kennt](#schlüssel-die-plainva-nicht-kennt)) |

## Schlüssel der obersten Ebene

Eine `.base`-Datei ist YAML mit diesen Schlüsseln auf oberster Ebene. Alle sind optional; eine Datei ohne `views` öffnet sich mit einer Tabelle.

| Schlüssel | Inhalt | In Plainva |
|---|---|---|
| `filters` | Welche Notizen zur Datenbank gehören (Quellen) | Gelesen und angewendet |
| `properties` | Ein Eintrag je Spalte, benannt nach der Eigenschafts-ID | Gelesen; die Ergänzungen von Plainva stehen in ihrem `plainva`-Block |
| `views` | Die Liste der Ansichten | Gelesen; jede Ansicht braucht einen `name` |
| `formulas` | Obsidian-Formeln, `name: expression` | Unverändert behalten, nicht berechnet |
| `summaries` | Eigene Zusammenfassungsformeln von Obsidian | Unverändert behalten, nicht berechnet |

Plainva schreibt nie einen weiteren Schlüssel auf oberster Ebene: Obsidian öffnet eine `.base` mit einem Schlüssel, den es nicht kennt, nicht. Ein Schlüssel `columns:` auf oberster Ebene, den sehr alte Plainva-Versionen geschrieben haben, wird weiterhin gelesen und beim nächsten Speichern der Datei nach `properties` verschoben.

## Eigenschaften (`properties`)

### Eigenschafts-IDs

Eine Eigenschafts-ID benennt eine Spalte. Es gibt drei Arten:

| ID | Bedeutet | Beispiel |
|---|---|---|
| `note.<key>` | Ein Schlüssel im Frontmatter der Notizen | `note.status` |
| `file.<field>` | Eine Angabe zur Datei (siehe [Dateifelder](#dateifelder-file)) | `file.mtime` |
| `formula.<name>` | Eine Obsidian-Formel aus `formulas` | `formula.price_per_unit` |

Die Schlüssel von `properties`, das `order` einer Ansicht und `sort[].property` verwenden diese IDs. In einem Filterausdruck und in einem `plainva`-Block steht ein Frontmatter-Schlüssel ohne Präfix (`status`); ein Filterausdruck versteht auch `note.status`.

Schreibt eine Notiz einen Schlüssel in anderer Groß-/Kleinschreibung als die Spalte (`Due` gegenüber der Spalte `due`), zeigt Plainva den Wert trotzdem in dieser Spalte und schreibt Änderungen unter der Schreibweise der Notiz zurück.

### Anzeigename

`properties.<id>.displayName` ist die Spaltenbeschriftung von Obsidian. Plainva zeigt sie als Spaltenkopf und behält sie. Ohne sie wird ein Frontmatter-Schlüssel mit großem Anfangsbuchstaben gezeigt (nur auf dem Bildschirm); die Dateifelder haben eigene Namen, zum Beispiel **Name**, **Geändert**, **Größe**, **Pfad**, **Checkliste** und **Tag aus dem Dateinamen**.

### Der `plainva`-Block einer Spalte

Alles, was Plainva zu einer Spalte hinzufügt, steht unter `properties.<id>.plainva`. Obsidian ignoriert es.

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `input` | ein Feldtyp (Liste unten) | Der Feldtyp der Spalte |
| `ratingMax` | Zahl, 1 bis 10 | Wie viele Marken eine Bewertung hat (Standard 5) |
| `ratingGlyph` | ein Zeichen | Die Marke, die eine Bewertung zeichnet (Standard ein Punkt) |
| `options` | Liste von Optionen | Feste Werte für Auswahl, Status und Mehrfachauswahl |
| `relationBase` | `.base`-Pfad relativ zum Vault | Die Datenbank, auf die eine Relation zeigt |
| `relationLimit` | `one` | Eine Relation enthält genau einen Link; fehlt der Schlüssel, gibt es keine Begrenzung |
| `reverseOf` | `{ base, property }` | Eine berechnete Rückrelations-Spalte |
| `rollup` | `{ through, of, fn, where }` | Eine berechnete Auswertungsspalte (siehe [Auswertungen](#auswertungen)) |
| `previousKeys` | Liste von bis zu 8 früheren Namen | Lässt Kommentare eine umbenannte Spalte wiederfinden |

### Feldtypen (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Zwei ältere Schreibweisen werden ebenfalls gelesen: `multi-select` als `multiselect` und `link` als `relation`. Eine Spalte ohne `input` — oder mit einem Wert, der nicht in dieser Liste steht — bekommt ihren Typ aus den Werten in den Notizen: `true`/`false` ist ein Kontrollkästchen, eine Zahl eine Zahl, eine Liste von `[[links]]` eine Relation, `2026-07-03` ein Datum, eine Webadresse eine URL und so weiter. Eine Rückrelations-Spalte und eine Auswertungsspalte haben kein `input`.

### Optionen und Farben

Eine Option ist `{ value, label, color, group }`; nur `value` ist Pflicht. `color` ist einer der Palettennamen `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — ein unbekannter Name fällt auf eine aus dem Wert abgeleitete Farbe zurück. `group` wird nur bei **Status** verwendet: Optionen mit derselben Gruppe bilden eine Stufe. Eine einfache Zeichenkette wird als Option mit diesem Wert gelesen.

### Auswertungen

Eine Auswertungsspalte berechnet einen Wert aus den Notizen, auf die eine Verknüpfungsspalte dieser Datenbank zeigt. Der Wert wird in keiner Datei gespeichert.

- `through` — eine Relations- oder Rückrelations-Spalte dieser Datenbank.
- `of` — eine Eigenschaft der verknüpften Notizen; bei `count` nicht nötig.
- `fn` — eines von `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, Pflicht bei `countWhere` und `percentWhere`; `op` ist eines von `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, und ein leerer `value` bedeutet „ist leer“.

Eine Auswertung, der ein Pflichtteil fehlt oder die eine Funktion nennt, die nicht in dieser Liste steht, wird ignoriert: Die Spalte bleibt leer, und die Datenbank öffnet sich trotzdem. Auch eine Auswertung über eine andere berechnete Spalte bleibt leer.

## Dateifelder (`file.*`)

Diese Werte stammen aus der Datei, nicht aus ihrem Frontmatter. Jede Zeile einer Datenbank trägt Folgendes:

| Feld | Wert |
|---|---|
| `file.name` | Die Eigenschaft `title` der Notiz, falls sie eine hat, sonst der Dateiname ohne `.md` |
| `file.path` | Der Pfad relativ zum Vault |
| `file.mtime` | Zuletzt geändert, in Millisekunden |
| `file.ctime` | Erstellt, in Millisekunden, soweit das Dateisystem es meldet |
| `file.size` | Größe in Bytes |
| `file.tags` | Alle Tags der Notiz, aus Frontmatter und Text, jeweils mit `#`; gefüllt, wenn ein Filter, eine Pinnwand oder eine Ansicht, die die Spalte zeigt oder nach ihr sortiert, sie braucht |
| `file.tasks` | Fortschritt der Kontrollkästchen als `done/total`; gefüllt für Boards und für eine Ansicht, die die Spalte zeigt |
| `file.day` | Der Tag, für den der Dateiname einer Tagesnotiz steht, nach Ordner und Format des Vaults; nur lesbar, und nur das Datumsfeld eines Kalenders oder einer Zeitleiste kann es verwenden |
| `file.revision` | Eine interne Änderungsmarke; verlass Dich nicht darauf |

`file.folder` funktioniert als Quelle (siehe [Quellen](#quellen)), ist aber keine Spalte. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` und `file.file` gibt es nicht: Eine Spalte mit einem davon bleibt leer, und ein Filter liest sie als leer.

## Filter

### Wo Filter stehen

Der `filters`-Schlüssel auf oberster Ebene enthält die **Quellen** — welche Notizen zur Datenbank gehören. Jede Ansicht kann eigene `filters` mit Bedingungen tragen, die nur diese Ansicht eingrenzen; Plainva schreibt die Bedingungen dorthin. Beide Ebenen gelten zusammen. Bedingungen, die eine Datei auf oberster Ebene behält, funktionieren weiterhin; beim nächsten Speichern in Plainva werden sie in jede Ansicht verschoben.

### Quellen

| Quelle | Ausdruck |
|---|---|
| Ordner | `file.folder == "Projects/Active"` — der Ordner und alle Unterordner; `""` und `"/"` sind der ganze Vault |
| Tag | `file.hasTag("project")` — die Notiz trägt genau diesen Tag; ein führendes `#` wird ignoriert |

Mehrere Quellen werden wie jede andere Bedingung mit `and` oder `or` verknüpft. Eine Datenbank ohne Quellen enthält jede Notiz des Vaults. Anhänge, die reservierten Dateien `index.md` und `log.md` sowie Dateien oder Ordner, deren Name mit einem Punkt beginnt, sind nie Zeilen.

### Bedingungen

Eine Bedingung ist eine Zeichenkette. Werte stehen in doppelten Anführungszeichen; `\"` und `\\` maskieren ein Anführungszeichen und einen Backslash. Die Eigenschaft steht ohne Präfix oder mit `note.`.

| Bedingung | Ausdruck |
|---|---|
| ist | `status == "Done"` |
| ist nicht | `status != "Done"` |
| enthält | `contains(labels, "urgent")` oder `labels.contains("urgent")` |
| enthält nicht | `!contains(labels, "urgent")` oder `!labels.contains("urgent")` |
| größer als, kleiner als | `effort > "3"`, `effort < "8"` |
| mindestens, höchstens | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| ist leer | `status == ""` oder `status.isEmpty()` |
| ist nicht leer | `status != ""` oder `!status.isEmpty()` |
| hat einen Tag | `file.tags.contains("#work")`, mit `!` verneint |
| Kopfzeilenfarbe, Icon | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Wie Werte verglichen werden

- **ist** und **ist nicht** vergleichen Text. Bei einer Liste (Tags, Mehrfachauswahl, Relation) heißt **ist** „die Liste hat diesen Eintrag“, **ist nicht** „sie hat ihn nicht“. Eine Notiz ohne die Eigenschaft trifft nie **ist** und immer **ist nicht**.
- **enthält** sucht den Text innerhalb des Werts oder innerhalb jedes Eintrags einer Liste. `labels.contains("x")` bei einer Liste verlangt einen Eintrag, der genau `x` ist; bei `file.tags` verlangen beide Formen den ganzen Tag, also trifft `#work` weder `#workshop` noch `#work/child`.
- **größer als**, **kleiner als**, **mindestens**, **höchstens** vergleichen als Zahlen, wenn beide Seiten Zahlen sind, sonst als Text — dadurch stehen ISO-Daten (`2026-07-03`) in der richtigen Reihenfolge. Eine Notiz ohne Wert trifft sie nie.
- **ist leer** trifft eine fehlende Eigenschaft, einen leeren Wert und eine leere Liste.
- Ein Kontrollkästchen wird als `"true"` oder `"false"` verglichen.

### `and`, `or`, `not`

Ein `filters`-Objekt hat auf jeder Ebene genau eines von `and`, `or` und `not`; seine Einträge sind Bedingungs-Zeichenketten oder weitere Filterobjekte.

| Schlüssel | Trifft zu, wenn |
|---|---|
| `and` | jeder Eintrag zutrifft |
| `or` | mindestens ein Eintrag zutrifft |
| `not` | kein Eintrag zutrifft |

Plainva wertet jede Tiefe aus. Das Filter-Panel bearbeitet eine Ebene von Gruppen unter **Alle** oder **Beliebige** (**Gruppe hinzufügen**); eine tiefere Struktur erscheint als **Komplexer Filter (nicht editierbar)**, bleibt in der Datei und wird angewendet — eine Bedingung darin, die Plainva nicht lesen kann, wird darunter als nicht angewendet genannt. Eine ältere Datei mit `and` und `or` nebeneinander auf einer Ebene wird als „alle aus `and` und eines aus `or`“ gelesen und beim nächsten Speichern in der gültigen Form geschrieben.

### Was Plainva nicht lesen kann

Verstanden werden nur die Formen in den beiden Tabellen oben. Alles andere — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, eine Zahl ohne Anführungszeichen (`price > 2`), `&&` und `||` innerhalb einer Zeichenkette, Arithmetik, Datumsfunktionen wie `now()` oder `this` — bleibt in der Datei und wird im Filter-Panel wie geschrieben angezeigt, mit dem Hinweis **Nicht angewendet: Plainva kann diese Bedingung nicht lesen, sie filtert nichts.** Die Ansicht zeigt dann mehr Notizen als derselbe Filter in Obsidian.

## Formeln

Plainva berechnet keine Obsidian-Formeln. `formulas` bleibt unverändert in der Datei, und eine Spalte `formula.<name>` im `order` einer Ansicht wird ohne Werte angezeigt. **Tabelle exportieren** → **Formeln (.base)** schreibt einige Auswertungen als Formeln, damit Obsidian sie berechnen kann (siehe [Datenbanken](Databases_Base.md)).

## Ansichten

### Schlüssel jeder Ansicht

| Schlüssel | Wert | In Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | Der Ansichtstyp; siehe die nächste Tabelle |
| `name` | Text | Pflicht; eine Ansicht ohne Namen bekommt beim Speichern von Plainva einen |
| `order` | Liste von Eigenschafts-IDs | Die sichtbaren Spalten in dieser Reihenfolge |
| `sort` | Liste von `{ property, direction }` | Sortierregeln, `ASC` oder `DESC` |
| `filters` | Filterobjekt | Die eigenen Bedingungen der Ansicht |
| `summaries` | Zuordnung Eigenschafts-ID → Name der Zusammenfassung | Die Fußzeile jeder Spalte |
| `plainva` | Zuordnung | Die Ansichtsoptionen von Plainva, unten |

### Die acht Ansichtstypen

Obsidian kennt `table`, `list` und `cards`. Die übrigen Ansichtstypen von Plainva werden als `type: table` plus `plainva.render` gespeichert, sodass Obsidian sie als Tabelle zeigt.

| Ansichtstyp | `type` auf dem Datenträger | `plainva.render` |
|---|---|---|
| **Tabelle** (`table`) | `table` | — |
| **Liste** (`list`) | `list` | — |
| **Galerie** (`gallery`) | `cards` | — |
| **Board** (`board`) | `table` | `board` |
| **Kalender** (`calendar`) | `table` | `calendar` |
| **Zeitleiste** (`timeline`) | `table` | `timeline` |
| **Graph** (`graph`) | `table` | `graph` |
| **Pinnwand** (`pinboard`) | `table` | `pinboard` |

Board, Kalender, Zeitleiste, Graph und Pinnwand werden als **Ansichtstyp** nur angeboten, solange **Plainva-Erweiterungen für .base Dateien erlauben** eingeschaltet ist. Ein `type`, den Plainva nicht kennt, wird als Tabelle gezeigt und bleibt wie geschrieben in der Datei, bis Du einen anderen **Ansichtstyp** wählst.

### Ansichtsoptionen (`views[i].plainva`)

Innerhalb des `plainva`-Blocks steht eine Eigenschaft ohne Präfix (`status`), nicht als `note.status`.

| Schlüssel | Ansichtstypen | Wert |
|---|---|---|
| `render` | Board, Kalender, Zeitleiste, Graph, Pinnwand | Der Ansichtstyp, siehe oben |
| `groupBy` | Board | Die Eigenschaft, aus der die Spalten bestehen; ohne sie die Eigenschaft des eigenen `groupBy` der Ansicht von Obsidian |
| `boardLaneBy` | Board | Eine zweite Eigenschaft für **Spuren nach** |
| `boardWipLimits` | Board | Zuordnung Spaltenwert → höchste Kartenzahl (**WIP-Limit**), ganze Zahlen über 0 |
| `boardColorMode` | Board | `column` tönt die ganze Spalte; fehlt der Schlüssel, nur der Chip in der Überschrift |
| `boardColumnOrder` | Board | Manuelle Spaltenreihenfolge; `__UNGROUPED__` ist die Spalte ohne Wert |
| `colorBy` | Board, Zeitleiste | Karten und Balken übernehmen die Optionsfarbe dieser Eigenschaft (**Farbe nach**) |
| `dateField` | Kalender, Zeitleiste | Das Startdatum (**Datumsfeld**, **Startdatum**); eine Datums-Eigenschaft oder `file.day` |
| `endField` | Kalender, Zeitleiste | Das **Enddatum** |
| `coverImage` | Galerie | Die Eigenschaft, die das **Titelbild** enthält |
| `subItemsProperty` | Tabelle | Die Eltern-Relation für **Unterelemente** |
| `widths` | Tabelle | Zuordnung Spalte → Breite in Pixeln |
| `dateFormat` | alle | `long`, `iso` oder `relative`; fehlt der Schlüssel, gilt die kurze Standardform |
| `graphEdges` | Graph | Relations-Eigenschaften, die als Kanten gezeichnet werden |
| `graphColorBy` | Graph | Eine Auswahl- oder Status-Eigenschaft, die die Knoten einfärbt |
| `graphSizeBy` | Graph | Eine Zahlen-Eigenschaft, die die Größe der Knoten bestimmt |
| `graphShowExternal` | Graph | `true` zeigt auch Linkziele außerhalb der Ansicht |
| `graphShowIncoming` | Graph | `true` zeigt auch Links, die aus anderen Datenbanken hereinkommen |
| `pinboardOrder` | Pinnwand | Pfade der nicht angepinnten Karten in manueller Reihenfolge |
| `pinboardPinned` | Pinnwand | Pfade der angepinnten Karten in Reihenfolge |
| `pinboardFilterBy` | Pinnwand | **Label-Quelle**: eine Mehrfachauswahl-Eigenschaft; fehlt der Schlüssel, sind es die Tags |

### Optionen für die ganze Datei (nur erste Ansicht)

Diese Schlüssel gehören zur ganzen Datenbank. Plainva schreibt sie nur in den `plainva`-Block der ersten Ansicht und liest von jedem den ersten gültigen Wert.

| Schlüssel | Wert |
|---|---|
| `fileIconColor` | Hex-Farbe des Datenbank-Icons (**Icon-Farbe der Datenbank**) |
| `newItemFolder` | Ordner, in dem **Eintrag** neue Einträge ablegt |
| `newItemTemplate` | Vorlage für neue Einträge |
| `contextFilters` | Eigenschaften, die eine eingebettete Datenbank auf die Notiz begrenzen, in die sie eingebettet ist (**Diese Notiz**) |
| `taskList` | Konto und Liste (`"<account id> <list id>"`), in der eine neue Aufgabe zusätzlich angelegt wird |

## Zusammenfassungen

`views[i].summaries` ordnet einer Spalte einen dieser Namen zu; die Fußzeile berechnet ihn über die Zeilen, die die Ansicht zeigt.

| Name | In Plainva | Ergebnis |
|---|---|---|
| `Average` | **Durchschnitt** | Mittelwert der Zahlen |
| `Min` | **Kleinster** | Kleinste Zahl |
| `Max` | **Größter** | Größte Zahl |
| `Sum` | **Summe** | Summe der Zahlen |
| `Range` | **Spanne** | Größte minus kleinste Zahl; bei Daten die Spanne in Tagen |
| `Median` | **Median** | Mittlerer Wert der Zahlen |
| `Stddev` | **Standardabw.** | Standardabweichung aller Zahlen (Grundgesamtheit) |
| `Earliest` | **Frühestes** | Frühestes Datum |
| `Latest` | **Spätestes** | Spätestes Datum |
| `Checked` | **Angehakt** | Zeilen, deren Wert `true` oder `yes` ist |
| `Unchecked` | **Nicht angehakt** | Alle anderen Zeilen |
| `Empty` | **Ohne Wert** | Zeilen ohne Wert |
| `Filled` | **Mit Wert** | Zeilen mit Wert |
| `Unique` | **Verschiedene** | Anzahl verschiedener Werte; Listeneinträge zählen einzeln |

Zahlen werden auf zwei Dezimalstellen gerundet, und auch ein Dezimalkomma wird gelesen. Eine Spalte ohne brauchbaren Wert zeigt keine Fußzeile statt 0. Jeder andere Name ist eine eigene Formel aus den `summaries` der obersten Ebene: Plainva behält sie und zeigt **Benutzerdefiniert: …** im Menü, berechnet aber keinen Wert.

## Sortierung und Gruppierung

- **Sortierung** — `sort` ist eine Liste von Regeln; die erste Regel entscheidet zuerst, die nächste nur zwischen gleichen Zeilen. Zahlen werden als Zahlen sortiert, alles andere als Text (ISO-Daten in der richtigen Reihenfolge). Zeilen ohne Wert stehen in beiden Richtungen zuletzt. Ohne Regel stehen die zuletzt geänderten Notizen zuerst. Plainva liest außerdem `field` für `property` und `asc`/`desc` in beliebiger Schreibweise.
- **Gruppierung** — das Board gruppiert nach `plainva.groupBy`, mit Spuren nach `plainva.boardLaneBy`. Eine Ansicht, die stattdessen das eigene `groupBy` von Obsidian trägt, gruppiert ihr Board nach dieser Eigenschaft, und eine Änderung der Gruppierung wird dort hineingeschrieben (dessen `direction` bleibt). Plainva gruppiert eine Tabelle nicht danach.

## Eine Datenbank einbetten, und `this`

`![[Projects.base]]` in einer Notiz zeigt die Datenbank in der Notiz, in der Leseansicht und im Editor. Ein Teil nach `#` (ein Ansichtsname, wie in `![[Projects.base#Board]]`) wird ignoriert: Die Einbettung zeigt die Ansicht, die zuletzt für diese Datenbank verwendet wurde. Ein ` ```base `-Codeblock in einer Notiz wird als Code gezeigt, nicht als Datenbank.

**`this` wird noch nicht unterstützt.** Ein Filter oder eine Formel, die `this` verwendet, bleibt in der Datei, aber Plainva wertet sie nicht aus. Zwei Dinge decken den häufigsten Fall ab, „zeige die Einträge, die zu dieser Notiz gehören“: `contextFilters` (**Diese Notiz** im Filter-Panel) begrenzt eine eingebettete Datenbank über eine Relations-Eigenschaft auf die Notiz, in die sie eingebettet ist, und eine eingebettete Datenbank, die sich auf die Datenbank ihrer Wirtsnotiz bezieht, bietet von sich aus **Diese Datenbank auf die aktuelle Notiz filtern** an. Beides wirkt nur innerhalb von Plainva; Obsidian zeigt alle Zeilen.

## Grenzen

- Das `limit` einer Ansicht von Obsidian wird behalten, aber nicht angewendet: Eine Ansicht zeigt alle ihre Zeilen.
- Das Filter-Panel bearbeitet eine Ebene von Filtergruppen; tiefere werden angewendet, lassen sich dort aber nur löschen.
- Ein Filterwert muss in doppelten Anführungszeichen stehen (siehe [Was Plainva nicht lesen kann](#was-plainva-nicht-lesen-kann)).
- Eine Ordnerquelle schließt immer die Unterordner ein.
- `ratingMax` wird zwischen 1 und 10 gezeichnet, `previousKeys` behält höchstens 8 Namen, ein **WIP-Limit** nimmt nur ganze Zahlen über 0, und `relationLimit` kennt nur `one`.
- Eine Auswertung kann nicht über eine andere berechnete Spalte rechnen.

## Schlüssel, die Plainva nicht kennt

Plainva liest eine `.base`, ändert nur, was Du in der App geändert hast, und schreibt die ganze Datei neu — als YAML mit LF-Zeilenenden und ohne BOM, sodass Kommentare und die Abstände einer von Hand geschriebenen Datei nicht erhalten bleiben. Von dem, was es nicht kennt:

- **Behalten:** jeder andere Schlüssel auf oberster Ebene, `formulas`, die `summaries` der obersten Ebene, `displayName` und jeder andere Schlüssel eines `properties`-Eintrags, unbekannte Schlüssel im `plainva`-Block einer Spalte oder einer Ansicht, eine Auswertung, die Plainva nicht lesen kann, die Schlüssel einer Ansicht, die Plainva nicht verwendet (`limit`, `image`, …), ein Ansichtstyp, den es nicht kennt, und Filterbedingungen, die es nicht lesen kann. Ein Wert, den Plainva versteht, den Du aber nicht geändert hast, behält die Schreibweise der Datei (`status` oder `note.status`, eine als reiner Text geschriebene Option).
- **Neu geschrieben:** nur Plainvas eigene alte Formen — eine `columns:`-Map auf oberster Ebene wandert nach `properties`, `and` und `or` nebeneinander auf einer Ebene werden zur gültigen Form, und eine Ansicht, die sehr alte Versionen als `type: board` gespeichert haben, wird zu `type: table` mit `plainva.render`.
- **Position:** Die Schlüssel, die eine Ansicht behält, gehören zu dieser Ansicht. Beim Löschen oder Verschieben einer Ansicht in Plainva wandern sie mit, und **Duplizieren** kopiert sie in die neue Ansicht.

## Unterschiede zu Obsidian Bases

| Thema | Obsidian | Plainva |
|---|---|---|
| Formeln, eigene Zusammenfassungen | Berechnet | Behalten, nicht berechnet |
| `this` | Unterstützt | Noch nicht unterstützt |
| Filterausdrücke | Die volle Ausdruckssprache | Die Formen unter [Bedingungen](#bedingungen) |
| `file.folder == "X"` | Nur Notizen direkt in `X` | `X` und alle Unterordner |
| `file.hasTag("x")` | Auch `#x/child` | Genau `#x` |
| `file.name` | Der Dateiname | Die Eigenschaft `title`, falls die Notiz eine hat |
| `limit`, `groupBy` einer Ansicht | Angewendet | `limit` behalten, nicht angewendet; `groupBy` gruppiert ein Board, keine Tabelle |
| Ansichtstypen | `table`, `list`, `cards` und Plugin-Typen | Acht Typen; ein unbekannter wird als Tabelle gezeigt und bleibt in der Datei |
| `![[db.base#View]]` | Öffnet diese Ansicht | Die zuletzt verwendete Ansicht |
| ` ```base `-Codeblock | Eine Datenbank | Ein Codeblock |
| `plainva`-Blöcke von Plainva | Ignoriert | Board, Kalender, Zeitleiste, Graph, Pinnwand, Relationen, Auswertungen, Feldtypen |

## Siehe auch

- [Datenbanken (.base)](Databases_Base.md) — Datenbanken im Alltag
- [Dateiformat-Referenz](File_Format_Reference.md) — die Regeln für Werkzeuge auf dem Datenträger, Relationen in beide Richtungen, `index.md`
- [Notizen & Markdown](Notes_and_Markdown.md) — Eigenschaften in einer Notiz
