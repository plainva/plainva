# Dateiformat-Referenz

Stand: 2026-07-07

Diese Seite ist der genaue Formatvertrag für **jede Datei in einem Plainva-Vault**, so wie sie auf der Platte liegt. Sie ist so geschrieben, dass ein Werkzeug — ein anderes Programm, ein Skript oder ein KI-Assistent — Vault-Dateien direkt lesen und sicher bearbeiten kann, ohne den Umweg über Plainvas Oberfläche. Wenn Du nur die App nutzt, brauchst Du diese Seite nie; der normale Gebrauch steht in den [übrigen Handbuchseiten](README.md).

Alles hier ist reiner UTF-8-Text. Notizen sind Markdown mit YAML-Frontmatter; Datenbanken sind YAML. Nichts ist proprietär, nichts versteckt.

## Grundregeln (zuerst lesen)

1. **Die Notiz ist die Wahrheit. Eine `.base` ist nur eine Ansicht.** Die *Werte* der Eigenschaften stehen im Frontmatter der einzelnen Notizen — nie in der `.base`. Um einen Wert zu ändern, bearbeitest Du die Notiz.
2. **Notizen bleiben Obsidian-nativ.** In Notiz-Frontmatter schreibst Du ausschließlich einfache Skalare und Listen (String, Zahl, Boolean, ISO-Datum, YAML-Liste). Niemals ein verschachteltes Objekt oder ein „aktiv/ausgewählt"-Flag in eine Notiz.
3. **Eine `.base` nutzt nur Obsidians vier Top-Level-Schlüssel** (`filters`, `formulas`, `properties`, `views`). Jeder weitere Top-Level-Schlüssel bringt Obsidian dazu, die ganze Datei abzulehnen. Alles Plainva-Spezifische liegt unter verschachtelten `plainva:`-Unterschlüsseln.
4. **Erhalte, was Du nicht verstehst.** Unbekannte Schlüssel müssen einen Lese-/Schreib-Zyklus unverändert überstehen. Räume keine Schlüssel „auf", die Du nicht kennst.
5. **Schreibe UTF-8 ohne BOM, mit LF-Zeilenenden.**

## Der Vault auf einen Blick

Ein Vault ist ein normaler Ordner. Die Dateitypen, die Dir begegnen:

| Datei | Was es ist | Als Text bearbeitbar |
|---|---|---|
| `*.md` | Eine Notiz: YAML-Frontmatter + Markdown-Text | Ja |
| `*.base` | Eine Datenbank-Ansicht über Notizen (YAML) | Ja |
| `index.md` | Verwaltetes Inhaltsverzeichnis eines Ordners (reservierter Name) | Ja, mit Vorsicht — siehe [index.md](#indexmd-inhaltsverzeichnis-eines-ordners) |
| `log.md` | Reservierter Name, derzeit ungenutzt | In Ruhe lassen |
| Bilder, PDFs, … | Anhänge | Nein (binär) |
| `.plainva/` | Plainvas interner Ordner (Backups, Zustand) | **Nein — niemals anfassen** |

Die reservierten Namen `index.md` und `log.md` sind nie normale Notizen; lege unter diesen Namen keinen gewöhnlichen Inhalt an.

---

## Notizen (`.md`)

Eine Notiz ist eine Markdown-Datei. Ein optionaler YAML-Frontmatter-Block (zwischen zwei `---`-Zeilen) ganz oben trägt die Eigenschaften; danach folgt der Markdown-Text.

```markdown
---
type: Note
okf_version: "0.1"
tags: [projekt, aktiv]
status: In Arbeit
frist: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mein Projekt

Ein **fetter** Gedanke mit einem Link zu [[Andere Notiz]].

- [ ] Erste Aufgabe
```

### OKF-Frontmatter-Felder

Plainva folgt OKF (Open Knowledge Format), einer minimalen Konvention. Zwei Top-Level-Felder:

| Feld | Typ | Bedeutung |
|---|---|---|
| `type` | String | Welche Art von Dokument das ist (`Note`, `Daily Note`, `Project`, …). Das einzige Feld, das OKF wirklich verlangt. |
| `okf_version` | String | Die Konventions-Version, gegen die die Datei geschrieben wurde, z. B. `"0.1"`. In Anführungszeichen setzen, damit YAML sie als String behält. |

Eine Datei **ohne** `type` öffnet trotzdem einwandfrei; sie ist nur „nicht OKF-konform". Ein fehlendes `okf_version` allein ist kein Verstoß. Wenn Du eine neue Notiz anlegst, ist es gute Praxis, `type` (und `okf_version`) zu ergänzen. Die vollständige Begründung steht unter [OKF](OKF.md).

### Serialisierung der Eigenschaftswerte

Jeder Frontmatter-Schlüssel ist eine Eigenschaft. Schreibe den Wert in der nativen YAML-Form seines Typs:

| Eigenschaftstyp | YAML-Form | Beispiel |
|---|---|---|
| Text | Skalar-String | `titel: Hallo` |
| Zahl | Zahl | `prio: 3` |
| Checkbox | Boolean | `erledigt: true` |
| Datum | ISO-Datum-String | `frist: 2026-07-20` |
| Datum & Uhrzeit | ISO-Datetime-String | `am: 2026-07-20T14:30:00` |
| Liste | YAML-Liste aus Strings | `autoren: [Ada, Alan]` |
| Tags | YAML-Liste aus Strings | `tags: [projekt, aktiv]` |
| Auswählen / Status | einzelner Skalar-String | `status: Erledigt` |
| Mehrfachauswahl | YAML-Liste aus Strings | `labels: [dringend, spaeter]` |
| URL / E-Mail / Telefon | Skalar-String | `web: https://example.org` |
| Relation (einfach) | Wiki-Link-**String** | `projekt: "[[Projekt Alpha]]"` |
| Relation (mehrfach) | YAML-Liste aus Wiki-Link-Strings | `bezug: ["[[A]]", "[[B]]"]` |

Der „aktive" Wert einer Auswählen-/Status-Eigenschaft ist einfach dieser Skalar. Die *Menge der erlaubten Optionen* und ihre Farben stehen **nicht** in der Notiz — sie liegen in der regierenden `.base` (siehe [Optionen und Farben](#optionen-und-farben)). So bleibt die Notiz zu 100 % Obsidian-nativ.

> Setze Wiki-Link-Werte in Anführungszeichen (`"[[X]]"`). Unquotiertes `[[X]]` ist in YAML eine Flow-Sequenz und wird nicht wie gewünscht geparst.

### Der `plainva:`-Namespace in Notizen

Reine Präsentations-Extras liegen gebündelt unter einem einzigen `plainva:`-Schlüssel, damit andere Editoren sie ignorieren können:

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `icon` | Emoji-Grapheme oder `lucide:<kebab-name>` | Dokument-Icon (Notion-artig) |
| `icon_color` | Hex-Farbe (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tönung für ein `lucide:`-Icon (Emojis ignorieren sie) |
| `header_color` | Hex-Farbe | Farbstreifen über die volle Breite |

Alle drei sind optional. Schreibst Du keinen davon, lass den `plainva:`-Schlüssel ganz weg. Ungültige Werte werden beim Lesen ignoriert, nie als Fehler behandelt.

### Links

- **Wiki-Link:** `[[Notizname]]` — über den Notiznamen vault-weit aufgelöst. Mit Überschriften-Anker: `[[Notiz#Abschnitt]]`. Mit Anzeigetext: `[[Notiz|angezeigter Text]]`.
- **Markdown-Link:** `[Text](relativer/pfad.md)` funktioniert ebenso.
- **Backlinks** werden automatisch abgeleitet, auch aus Frontmatter-Wiki-Links (deshalb tauchen Relationen als Backlinks auf).

---

## Datenbanken (`.base`)

Eine `.base`-Datei ist YAML. Sie speichert eine *Ansicht* über Notizen — welche Notizen (Quellen), wie sie dargestellt werden (Ansichten), wie gefiltert und sortiert wird, und das Spaltenschema. Sie speichert **keine Notizwerte**. Das Format ist mit Obsidians Bases-Plugin kompatibel.

### Harte Regeln — bei einem Verstoß lehnt Obsidian die ganze Datei ab

- **Nur diese Top-Level-Schlüssel:** `filters`, `formulas`, `properties`, `views`. Niemals einen weiteren Top-Level-Schlüssel ergänzen. (Historisch machte ein Top-Level-`columns:` jede Datei kaputt — dieses Muster nicht wiederbeleben.)
- **Jede View braucht einen nicht-leeren String-`name`.**
- **Ein `filters`-Objekt trägt auf jeder Ebene genau eines von `and` / `or` / `not`** — nie zwei nebeneinander.

Plainva selbst heilt ältere Dateien, die gegen die letzten beiden Regeln verstoßen, beim nächsten Speichern; ein Werkzeug, das direkt schreibt, muss sie aber von vornherein einhalten.

### Eigenschafts-Bezeichner: wann das `note.`-Präfix gilt

Das ist die häufigste Stolperfalle, deshalb ausdrücklich:

| Wo | Form | Beispiel |
|---|---|---|
| Schlüssel der `properties:`-Map | mit Präfix | `note.status`, `file.name` |
| `order:`-Liste einer View | mit Präfix | `[file.name, note.status]` |
| `sort[].property` einer View | mit Präfix | `note.frist` |
| In **Filter**-Ausdrücken | **bare** | `status == "Erledigt"` |
| In `plainva`-Unterschlüsseln (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **bare** | `groupBy: status` |

Faustregel: Die *Obsidian-zugewandten* Strukturfelder nutzen `note.<key>` (und `file.<x>` für Eingebautes wie `file.name`, `file.folder`, `file.mtime`); alles innerhalb einer **Filter-Formel** oder eines **`plainva`-Blocks** nutzt den bloßen Frontmatter-Schlüssel.

### Top-Level-Schlüssel

- **`filters`** — welche Notizen zur Datenbank gehören. In Plainva stehen hier nur die **Quellen** (Ordner/Tag); Eigenschafts-Filterbedingungen werden pro Ansicht unter `views[i].filters` gespeichert. Siehe [Filter](#filter).
- **`properties`** — das Spaltenschema, nach Eigenschafts-ID indiziert. Native Obsidian-Unterschlüssel wie `displayName` (Spalten-Überschrift) sind erlaubt und werden erhalten; alle Plainva-Reichhaltigkeit liegt unter `properties[id].plainva`.
- **`views`** — eine geordnete Liste von Ansichten. Jede braucht `name` und `type`.
- **`formulas`** — ein Obsidian-Feature. Plainva legt sie nicht an, erhält sie aber unverändert.

### Die `plainva:`-Unterschlüssel-Karte

Alles Plainva-Spezifische ist namespaced. Drei Orte:

**`properties[<note.key>].plainva`** — pro Spalte:

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `input` | einer der Input-Typen unten | Der Feldtyp der Spalte |
| `options` | Liste aus Options-Objekten | Kuratierte Werte für Auswählen/Status/Mehrfachauswahl |
| `relationBase` | vault-relativer `.base`-Pfad | Ziel-Datenbank der Relation (siehe [Relationen](#relationen-der-zweiseitige-vertrag)) |
| `relationLimit` | `one` | Kardinalität: genau ein Link. Weglassen = unbegrenzt. |
| `reverseOf` | `{ base, property }` | Kennzeichnet eine **berechnete Rückrelations**-Spalte (kein `input`) |

**`views[i].plainva`** — pro View:

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Plainva-only-Ansichtsart (siehe unten) |
| `groupBy` | bare Eigenschaftsschlüssel | Gruppierungsspalte des Boards |
| `dateField` | bare Eigenschaftsschlüssel | Startdatum für Kalender/Zeitachse |
| `endField` | bare Eigenschaftsschlüssel | Enddatum der Zeitachse |
| `coverImage` | bare Eigenschaftsschlüssel | Titelbild-Eigenschaft der Galerie |
| `subItemsProperty` | bare Eigenschaftsschlüssel | Eltern-Spalte (Self-Relation) für die Unterelemente-Verschachtelung |
| `widths` | Map id → px | Spaltenbreiten |
| `dateFormat` | String | Datumsformat pro View (`default` ist implizit — weglassen) |

Neben dem `plainva`-Block kann eine View ein natives **`views[i].filters`**-Objekt tragen — die **Filter pro Ansicht** (dieselbe einwurzelige `and`/`or`/`not`-Grammatik wie das dateiweite `filters`). Plainva speichert Eigenschafts-Filterregeln hier, ein Satz pro View, sodass jede View unabhängig filtert; das dateiweite `filters` behält dann nur die Quellen. Obsidian wendet `views[i].filters` pro View nativ an.

**`views[0].plainva`** — dateiweite Schlüssel, nur auf der **ersten** View erlaubt:

| Schlüssel | Wert | Bedeutung |
|---|---|---|
| `fileIconColor` | Hex-Farbe | Tönung des Datenbank-Icons (Baum/Tabs/Header) |
| `newItemFolder` | vault-relativer Ordner | Ablage-Ordner des „Neu"-Knopfs |
| `newItemTemplate` | vault-relativer `.md`-Pfad | Standard-Vorlage neuer Elemente |
| `contextFilters` | Liste bloßer Eigenschaftsschlüssel | Selbstverweis-Filter („Diese Notiz") — siehe unten |

`contextFilters` ist Plainvas Pendant zu Notions „this page"-Filter. Jeder Eintrag ist ein Eigenschaftsschlüssel; ist die Datenbank in eine Notiz eingebettet, werden ihre Zeilen über diese Eigenschaft auf die Wirtsnotiz gefiltert (aufgelöst über den Link-Index — eine Owning-/Wiki-Link-Eigenschaft matcht Zeilen, die auf den Wirt zeigen, eine berechnete Rückspalte das, worauf der Wirt zeigt). Er wird bewusst **nicht** in die nativen `filters` geschrieben, sodass Obsidian ihn ignoriert und alle Zeilen zeigt; alleine in Plainva geöffnet entfällt er ebenfalls (kein Wirt) und zeigt alle Zeilen. Mehrere Einträge werden UND-verknüpft.

### Input-Typen

`plainva.input` ist einer von:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Eine berechnete **Rück**-Spalte hat **kein** `input` — sie wird allein durch `reverseOf` gekennzeichnet.

### Optionen und Farben

Auswählen-/Status-/Mehrfachauswahl-Spalten können eine kuratierte Optionsliste tragen. Jede Option:

```yaml
options:
  - value: Offen         # Pflicht
    color: amber         # optionaler Paletten-Name (siehe unten)
    group: Aktiv         # optional; NUR Status — ordnet Optionen in Stufen
  - value: Erledigt
    color: green
    group: Abgeschlossen
```

`color` ist ein **Paletten-Name**, keine CSS-Farbe. Gültige Namen: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Eine unbekannte Farbe fällt auf eine aus dem Wert abgeleitete Farbe zurück.

### Ansichtstypen

`views[i].type` ist auf der Platte ein nativer Obsidian-Typ. Plainva-only-Ansichten werden als `type: table` plus `plainva.render`-Hinweis geschrieben, sodass Obsidian sie zur einfachen Tabelle degradiert:

| Du willst | `type` auf der Platte | `plainva.render` |
|---|---|---|
| Tabelle | `table` | — |
| Liste | `list` | — |
| Galerie | `cards` | — |
| Board | `table` | `board` |
| Kalender | `table` | `calendar` |
| Zeitachse | `table` | `timeline` |

### Filter

`filters` wählt aus, welche Notizen in der Datenbank sind, und grenzt sie ein.

**Quellen-Bedingungen** entscheiden über die Mitgliedschaft:

- Ordner: `file.folder == "Pfad/Zum/Ordner"` (vault-relativ; der Wurzelordner ist `""`).
- Tag: `file.hasTag("projekt")` (ohne führendes `#`).

Mehrere Quellen sind einfach mehrere Einträge. Gar kein `filters` = jede Notiz im Vault.

**Wo Eigenschafts-Bedingungen stehen:** Auf Dateiebene gilt `filters` für jede Ansicht. Plainva speichert Eigenschafts-Filterregeln stattdessen **pro Ansicht** in `views[i].filters` (gleiche einwurzelige Struktur) und behält auf Dateiebene nur die Quellen, sodass jede Ansicht unabhängig filtern kann. Beides ist gültiges Obsidian; ein Werkzeug darf beides schreiben. Eine Altdatei mit Eigenschafts-Bedingungen auf Dateiebene funktioniert weiterhin — Plainva verteilt sie beim nächsten Speichern in jede Ansicht.

**Eigenschafts-Bedingungen** nutzen bloße Eigenschaftsnamen und diese Operatoren:

| Operator | Ausdruck |
|---|---|
| ist gleich | `status == "Erledigt"` |
| ist ungleich | `status != "Erledigt"` |
| enthält | `contains(labels, "dringend")` |
| enthält nicht | `!contains(labels, "dringend")` |
| größer / kleiner | `prio > "2"`, `prio < "5"` |
| mindestens / höchstens | `prio >= "2"`, `prio <= "5"` |
| ist leer | `status == ""` |
| ist nicht leer | `status != ""` |

**Struktur (einwurzelig!):** eines von `and` / `or` / `not`, dessen Einträge Bedingungs-Strings sind — oder eine Ebene verschachtelter `{and:[...]}` / `{or:[...]}`-Gruppenobjekte (Notion-artige Gruppen). Beispiel mit Quelle, Bedingung und ODER-Gruppe:

```yaml
filters:
  and:
    - 'file.folder == "Projekte"'
    - 'status != "Erledigt"'
    - or:
        - 'prio == "1"'
        - 'prio == "2"'
```

### Eine vollständige, kommentierte `.base`

```yaml
filters:
  and:
    - 'file.folder == "Projekte"'          # Quelle: Notizen im Ordner Projekte
properties:
  note.status:                             # Spalten-ID ist note.-präfigiert
    displayName: Status                    # optionale Obsidian-Spaltenbeschriftung
    plainva:
      input: status
      options:
        - value: Offen
          color: amber
          group: Aktiv
        - value: Erledigt
          color: green
          group: Abgeschlossen
views:
  - type: table                            # erste View: trägt auch die dateiweiten Schlüssel
    name: Alle Projekte                    # jede View braucht einen Namen
    order: [file.name, note.status]        # order nutzt note.-präfigierte IDs
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projekte
  - type: table                            # ein Board ist eine native Tabelle + Render-Hinweis
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy nutzt den BAREN Schlüssel
```

---

## Relationen (der zweiseitige Vertrag)

Eine Relation verknüpft Notizen miteinander. Das ist das Fehleranfälligste beim Schreiben von Hand, weil es sich über **drei** Stellen erstreckt. Halte alle drei konsistent.

1. **Der Wert steht im Frontmatter der Quell-Notiz**, als Wiki-Link (oder eine Liste davon):

   ```markdown
   ---
   type: Task
   projekt: "[[Projekt Alpha]]"
   ---
   ```

2. **Die Quell-`.base` deklariert die Relations-Spalte** (`relationBase` = die Ziel-Datenbank; `relationLimit: one` für einen einzelnen Link):

   ```yaml
   properties:
     note.projekt:
       plainva:
         input: relation
         relationBase: Projekte.base
         relationLimit: one
   ```

3. **Die Ziel-`.base` kann die Rückrichtung** mit einer **berechneten** Spalte zeigen. Ihre Werte werden **nirgends** gespeichert — sie werden aus den Links der Quell-Notizen abgeleitet:

   ```yaml
   properties:
     note.aufgaben:
       plainva:
         reverseOf:
           base: Aufgaben.base    # die Quell-.base (vault-relativer Pfad)
           property: projekt      # der BARE Quell-Eigenschaftsschlüssel
   ```

### Durchgespieltes Beispiel: Aufgaben ↔ Projekte

**`Aufgaben.base`**

```yaml
filters:
  and:
    - 'file.folder == "Aufgaben"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
          color: amber
        - value: Erledigt
          color: green
  note.projekt:
    plainva:
      input: relation
      relationBase: Projekte.base
      relationLimit: one
views:
  - type: table
    name: Alle Aufgaben
    order: [file.name, note.status, note.projekt]
```

**`Projekte.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projekte"'
properties:
  note.aufgaben:
    plainva:
      reverseOf:
        base: Aufgaben.base
        property: projekt
views:
  - type: table
    name: Alle Projekte
    order: [file.name, note.aufgaben]
```

**`Aufgaben/Angebot schreiben.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Offen
projekt: "[[Projekt Alpha]]"
---
# Angebot schreiben
```

**`Projekte/Projekt Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Projekt Alpha
```

Ergebnis: In `Projekte.base` listet die berechnete `aufgaben`-Spalte von **Projekt Alpha** „Angebot schreiben", weil das `projekt`-Feld dieser Aufgabe darauf zurückverweist. Beachte: `Projekt Alpha.md` hat **kein** `aufgaben:`-Feld — die Rückseite wird berechnet, nie gespeichert.

### Relations-DON'Ts

- **Schreibe keine Rückwerte in Notizen.** Eine `reverseOf`-Spalte ist berechnet. Ein `aufgaben:`-Feld in `Projekt Alpha.md` zu schreiben ist falsch und überlebt keinen Roundtrip.
- **Sorge dafür, dass Link-Ziele auflösen.** `"[[Projekt Alpha]]"` muss zu einem existierenden Notiznamen passen, sonst erscheint der Link als defekt.
- **Halte Pfade vault-relativ** mit Schrägstrichen und ohne führendes `./` (`Projekte.base`, `DB/Projekte.base`).
- **`reverseOf.property` ist der bare Quell-Schlüssel** (`projekt`), nicht `note.projekt`.

### Self-Relationen und Unterelemente

Für eine Relation, deren Ziel dieselbe Datenbank ist, zeigt `relationBase` auf genau diese `.base`. Um Kinder unter Eltern in einer Tabellenansicht zu verschachteln, setze `views[i].plainva.subItemsProperty` auf den baren Eltern-Relations-Schlüssel. Zyklen werden abgefangen; ohne Unterelemente bleiben die Zeilen flach und die Werte erhalten.

---

## `index.md` (Inhaltsverzeichnis eines Ordners)

`index.md` ist ein reservierter Name für das Inhaltsverzeichnis eines Ordners.

- **Nur die Wurzel-`index.md` darf Frontmatter tragen**, und dort nur `okf_version` (es kennzeichnet den Vault als OKF-aktiv). Eine `index.md` außerhalb der Wurzel muss **frontmatter-frei** sein — Frontmatter dort ist ein Reservname-Verstoß.
- Eine Plainva-**verwaltete** `index.md` endet mit dem Marker `<!-- plainva:index generated -->` (ein HTML-Kommentar, in der Leseansicht unsichtbar). Sein Vorhandensein bedeutet, dass Plainva die Datei automatisch aktuell hält. Bearbeitest Du so eine Datei von Hand, dann erhalte entweder den Marker (und die generierte Form) oder entferne ihn bewusst, um die Datei dauerhaft zu übernehmen.
- Generierte Listings sind Abschnitte aus Links in der Form `* [Titel](relativer/url) - beschreibung`.

Erzeugst Du eine Ordnerübersicht von Hand, ist die sichere Wahl, den Marker **nicht** zu setzen — dann überschreibt Plainva sie nie.

---

## Nicht-anfassen und Sicherheit

- **`.plainva/`** enthält Backups und internen Zustand. Niemals daraus Programmlogik lesen oder hineinschreiben.
- **Unbekannte Schlüssel sind heilig.** Wenn Du eine `.base` oder eine Notiz neu schreibst, trage jeden Schlüssel unverändert mit, den Du nicht ändern wolltest. Plainva selbst erhält unbekannte `.base`-Schlüssel über eine interne Rohkopie; ein Fremd-Schreiber sollte dasselbe tun (parsen → nur das Gemeinte ändern → serialisieren).
- **Werte ändern sich in der Notiz, nicht in der `.base`.** Um eine Zelle zu setzen, bearbeite das Frontmatter der Notiz. Die `.base` entscheidet nur, welche Notizen und Spalten gezeigt werden.
- **Ergänze keine Top-Level-`.base`-Schlüssel** über `filters` / `formulas` / `properties` / `views` hinaus.
- **Encoding:** UTF-8 ohne BOM, LF-Zeilenenden, überall.

### Graph-Ansichten (`plainva.render: "graph"`)

Eine Graph-Ansicht wird wie jede nicht-native Ansicht gespeichert: `type: table` plus Render-Hinweis. Ihre Optionen liegen im SELBEN `views[i].plainva`-Namensraum:

```yaml
views:
  - type: table
    name: Netz
    plainva:
      render: graph
      graphEdges: [projekt]        # Relations-Eigenschaften, die als Kanten erscheinen
      graphColorBy: status         # Auswahl-/Status-Eigenschaft -> Knotenfarbe
      graphSizeBy: prio            # Zahl-Eigenschaft -> Knotengröße
      graphShowExternal: true      # Relationsziele außerhalb der Ansicht einblenden
      graphShowIncoming: true      # Relationen aus ANDEREN Datenbanken, die hierauf zeigen (z. B. die Aufgaben eines Projekts)
```

Alle Graph-Options-Schlüssel sind optional; ungesetzte werden komplett weggelassen. Obsidian rendert dieselbe Datei als einfache Tabelle und darf keinen Fehler zeigen.

Eine **Board**-Ansicht (`plainva.render: "board"`) kann zusätzlich `views[i].plainva.boardColumnOrder` tragen — eine Liste von Gruppen-Spalten-Schlüsseln (`__UNGROUPED__` markiert die Spalte ohne Wert), die eine manuelle Spaltenreihenfolge merkt. Auswahl/Status-Boards ordnen stattdessen die `options` der Eigenschaft um. Ungesetzt weglassen.

## Siehe auch

- [Notizen & Markdown](Notes_and_Markdown.md) — dasselbe Material aus dem Blickwinkel „von Hand in der App schreiben"
- [Datenbanken (.base)](Databases_Base.md) — Datenbanken für den Alltag erklärt
- [OKF](OKF.md) — `type`, `okf_version`, index.md und die Vault-Konvertierung
