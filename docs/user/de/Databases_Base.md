# Datenbanken (.base)

Stand: 2026-08-19

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

Eine Datenbank kann außerdem als **Standard-Aufgabendatenbank** des Vaults dienen (Einstellungen → **Inhalt & Struktur**): Die [Aufgabenansicht](Tasks.md) zeigt deren Einträge dann als eigenen Bereich und kann Checkboxen aus Notizen dorthin verschieben.

## Ansichten

Eine Datenbank kann beliebig viele Ansichten haben; jede hat einen **Ansichtstyp**:

| Ansicht | Wofür |
|---|---|
| **Tabelle** | Klassisches Raster, sortierbar, mit Inline-Editing und optionalen Unterelementen |
| **Liste** | Kompakte Zeilenliste |
| **Galerie** | Karten mit optionalem **Titelbild** |
| **Board** | Kanban-Spalten, gruppiert nach einer Eigenschaft (**Gruppieren nach**) — Karten per Drag verschieben ändert den Wert; eine **Spaltenüberschrift** per Drag ordnet die Spalten um |
| **Kalender** | Einträge nach **Datumsfeld** in **Monat**, **Woche** oder **Tag**, Einträge per Drag verschiebbar |
| **Zeitachse** | Zeitstrahl mit **Startdatum** und optionalem **Enddatum** |
| **Pinnwand** | Notizzettel-Brett im Google-Keep-Stil — Karten zeigen den gerenderten Notiz-Inhalt (eigener Abschnitt unten) |

**Ansicht hinzufügen** legt neue an; über **Ansichts-Optionen** kannst Du **Umbenennen**, **Duplizieren**, **Löschen** und die Reihenfolge per Drag ändern. Welche Ansicht zuletzt aktiv war, merkt sich Plainva pro Datei. Kalender und Zeitachse brauchen ein Datumsfeld (**Nur Datum** oder **Datum & Uhrzeit** als **Format**); Einträge zeigen die in den **Eigenschaften** aktivierten Felder an.

## Konfigurieren: Reiter für Ansicht, Spalten, Filter, Sortierung, Datenquelle

Der Knopf **Konfigurieren** (oben rechts) öffnet das Panel **neben** der laufenden Ansicht — so siehst Du jede Änderung sofort in der Tabelle bzw. dem Board. Oben wählst Du über **Reiter** einen Bereich; es ist immer nur einer sichtbar, statt einer langen Liste. Eine kleine Marke zeigt je Bereich, ob er **Diese Ansicht** oder die **Ganze Datenbank** betrifft:

- **Ansicht** — der **Ansichtstyp** als Kachel-Auswahl mit Symbolen (Tabelle, Liste, Karte, Board, Galerie, Kalender, Zeitachse, Pinnwand) samt seinen typ-eigenen Optionen: Board-Gruppierung und Spaltenfarbe, Datumsfeld für Kalender/Zeitachse, Galerie-Titelbild, Unterelemente, Datumsformat. Diese Auswahlfelder bieten nur Eigenschaften des **passenden Typs** an: das **Datumsfeld** nur Datums-Eigenschaften, **Gruppieren nach** nur Auswahl-/Status-/Mehrfachauswahl-/Relations-Eigenschaften, das **Titelbild** nur Text-/URL-Eigenschaften. Beim Ansichtstyp **Graph** entfällt der Reiter **Eigenschaften** — der Graph zeigt keine Spalten (Farbe/Größe/Kanten steuerst Du in seiner eigenen Leiste).
- **Spalten** — die Eigenschaften der Ansicht, getrennt in **Sichtbar** und **Ausgeblendet**. Ein Klick aufs Auge blendet eine Spalte ein oder aus; per Drag am Griff änderst Du die Reihenfolge. Jede Zeile zeigt ein Feldtyp-Kürzel, das Zahnrad öffnet den Spalten-Editor, **Neue Eigenschaft** legt eine an.
- **Filter** — jede Regel erscheint als lesbarer **Chip-Satz** (z. B. „Status ist nicht Erledigt"); ein Klick klappt sie zum Editor auf (Eigenschaft, Operator, Wert). Die Operatoren passen sich dem Feldtyp an: **ist** / **ist nicht** / **enthält** / **enthält nicht** / **ist leer** / **ist nicht leer**, für Zahlen **größer als** / **kleiner als** / **mindestens** / **höchstens**, für Datumsfelder **nach** / **vor** / **ab** / **bis**. Die **Logik** oben entscheidet, ob **Alle** Bedingungen (UND) oder **Beliebige** (ODER) gelten. Mit **Gruppe hinzufügen** baust Du Notion-artige Filtergruppen: ein Kasten mit eigener UND/ODER-Logik innerhalb der Hauptlogik. Sehr verschachtelte Filter aus Obsidian zeigt Plainva als **Komplexer Filter (nicht editierbar)** an — sie bleiben erhalten und werden angewendet. Filter werden **pro Ansicht** gespeichert; alles lebt in der `.base`-Datei, nicht in einem separaten Speicher.
- **Sortierung** — mehrere Sortierregeln (**Aufsteigend**/**Absteigend**); die Priorität änderst Du per Drag.
- **Datenquelle** — Ordner- und Tag-Quellen der Datenbank (auch das **Hauptverzeichnis** ist wählbar). Keine Quelle = alle Dateien. Gilt für die ganze Datenbank, nicht nur die aktive Ansicht.

Auf dem Smartphone öffnet **Konfigurieren** dieselben Bereiche als Liste; ein Tippen führt in den jeweiligen Detail-Bereich, der Zurück-Pfeil führt heraus.

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

## Auswertungen

Eine **Auswertung** rechnet einen Wert aus den Notizen, auf die eine Verknüpfung zeigt — „wie viele der Aufgaben dieses Projekts sind noch offen", „wie viel Aufwand steckt insgesamt darin", „wann ist die letzte fällig".

- **Anlegen**: Neue Eigenschaft vom Feldtyp **Auswertung**. Du wählst dreierlei: die **Verknüpfung**, über die gerechnet wird (eine Relation oder eine Rückrelation dieser Datenbank), die **Eigenschaft** der verknüpften Notizen und die **Berechnung**. Bei **Anzahl mit Bedingung** und **Prozent mit Bedingung** kommt eine **Bedingung** dazu — mit denselben Operatoren wie die Filter.
- **Berechnungen**: Anzahl · Anzahl mit Bedingung · Prozent mit Bedingung · Summe · Durchschnitt · Median · kleinster und größter Wert · frühestes und spätestes Datum · angehakt und nicht angehakt · mit und ohne Wert · verschiedene Werte.
- **Vorschau**: Während Du einstellst, zeigt der Editor die Werte, die dabei für die ersten Einträge herauskämen. Sie laufen über denselben Weg wie die fertige Spalte und können deshalb nichts anderes anzeigen als das, was später in der Tabelle steht.
- **Der Wert wird nie gespeichert.** Er entsteht bei jeder Anzeige neu — wie die Rückrelation. In keiner Notiz steht „12 offene Aufgaben"; deshalb kann keine Synchronisation eine veraltete Zahl mitschleppen und kein Gerät eine andere behaupten. Die Zelle ist entsprechend **nicht bearbeitbar**: Was Du ändern willst, änderst Du in den verknüpften Notizen.
- **Nichts zu messen ist nicht Null**: Eine Summe ohne einen einzigen Zahlenwert bleibt leer, statt 0 zu behaupten. **Anzahl** dagegen zählt Notizen — ein Projekt ohne Aufgaben hat ehrlich 0.
- **In Obsidian** bleibt die Spalte leer: Obsidian kennt die Auswertung nicht und zeigt die Datenbank als Tabelle ohne diese Werte. Die Datei bleibt gültig, nichts geht verloren.
- **Grenze**: Eine Auswertung rechnet nicht über eine andere Auswertung. Zeigt die gewählte Verknüpfung auf eine berechnete Spalte, bleibt die neue Spalte leer.

## Spaltenfüße

Unter einer Tabellenspalte kann eine Zeile stehen, die sie zusammenfasst — die **Summe** eines Aufwands, das **Frühestes** Datum, wie viele Zeilen einen Wert haben.

- **Einrichten**: unter **Konfigurieren → Spalten** neben der Spalte einen **Spaltenfuß** wählen. **Kein Spaltenfuß** nimmt ihn wieder weg.
- **Rechnungen**: Durchschnitt · Kleinster · Größter · Summe · Spanne · Median · Standardabw. · Frühestes · Spätestes · Angehakt · Nicht angehakt · Ohne Wert · Mit Wert · Verschiedene.
- **Der Fuß rechnet über die Zeilen, die die Ansicht zeigt** — nicht über den ganzen Vault. Ein Filter ändert also auch die Zahl darunter.
- **Nichts zu messen ist nicht null**: hat eine Spalte keinen einzigen auswertbaren Wert, bleibt der Fuß leer, statt 0 zu behaupten. Eine Spalte ohne eigenen Fuß bleibt leer und leiht sich nie die Zahl der Nachbarspalte.
- **In Obsidian sichtbar**: Spaltenfüße sind Obsidians eigene Funktion, kein Plainva-Zusatz. Was Du hier einstellst, siehst Du dort — und umgekehrt. Eigene Formel-Ausdrücke aus Obsidian bleiben in der Datei erhalten; Plainva zeigt für sie keinen Wert.

## Projekte planen: Meilensteine, Abhängigkeiten, Aufwand

Die Zeitachsen-Ansicht macht aus einer Datenbank einen Plan. Vier Dinge tragen das, und alle stehen in den Notizen, nicht in der `.base`:

- **Ein Meilenstein** ist ein Eintrag mit Datum und **ohne Ende**. Die Zeitachse zeichnet ihn als Raute statt als Balken — ein Zeitpunkt, kein Zeitraum. Es gibt nichts einzuschalten: Lass die Ende-Eigenschaft leer.
- **Abhängigkeiten** sagen „das hier kann erst beginnen, wenn das dort fertig ist". Die Eigenschaft heißt `blockedBy` und folgt **RFC 9253** — demselben Vokabular, das das TaskNotes-Plugin bereits schreibt:

```yaml
blockedBy:
  - uid: "[[Projects/Rollout]]"
    reltype: FINISHTOSTART
    gap: P1D
```

  Gespeichert wird nur **eine** Richtung: Ein gespeichertes Paar sind zwei Tatsachen, die einander widersprechen können. Ausgewertet und gezeichnet wird nur `FINISHTOSTART`; andere Typen bleiben in der Datei unangetastet. Einen Zyklus lehnt Plainva beim Schreiben ab und nennt den Pfad, den er schließen würde.
- **Ein Terminkonflikt wird gemeldet, nie korrigiert.** Beginnt eine Aufgabe, bevor die endet, auf die sie wartet, wird der Pfeil rot und bleibt rot. Die Daten sind Deine Aussage — Plainva sagt nur, dass zwei davon nicht zusammenpassen.
- **Der Aufwand** ist eine schlichte Zahl in Minuten, in einer Eigenschaft Deiner Wahl (die Vorlage **Projekt** nennt sie `effort`). Ein Spaltenfuß summiert ihn; eine Auswertungsspalte rechnet ihn über die Aufgaben eines Projekts zusammen.
- **Die Ist-Zeit** wird *nicht* gespeichert. Sie wird aus den Terminen gelesen, die eine Aufgabe geblockt hat — so bleibt sie richtig, wenn Du den Termin verschiebst oder verlängerst. Ohne Kalenderkonto zeigt die Spalte einen Strich statt einer Null: „nicht gemessen" und „gemessen, und es war nichts" sind verschiedene Aussagen.

## Wo gehört diese Notiz hin? (Datenbank-Kontext)

Öffnest Du einen Datenbank-Eintrag direkt — aus dem Dateibaum, über die Suche oder einen `[[Link]]` —, sagt Dir Plainva jetzt, in welchem Zusammenhang die Notiz steht:

- Über der Notiz steht eine **Kontextzeile**: die Datenbanken, zu denen die Notiz gehört, als anklickbare Chips (ein Klick öffnet die Datenbank), gefolgt vom Pfad `Eltern-Eintrag / diese Notiz`, wenn die Datenbank Unterelemente nutzt. Gehört die Notiz zu **mehreren** Datenbanken, erscheinen alle — die Zeile bricht dann um, statt eine wegzulassen.
- In der rechten Seitenleiste ist der Bereich **Datenbanken** der **Eintrags-Inspektor**: Er zeigt die Notiz so, wie ihre Datenbank sie sieht — die Spalten der ersten Ansicht in deren Reihenfolge, mit den Typen und Optionsfarben der `.base`, und **bearbeitbar** wie in der Tabelle. Ein Status lässt sich also ändern, ohne die Datenbank zu öffnen. Darüber steht die Position in der Ansicht (**12 / 34**) mit Pfeilen zum vorigen und nächsten Eintrag. Gehört die Notiz zu mehreren Datenbanken, bekommt jede ihren eigenen Block. Darunter folgen der **Eltern-Eintrag**, die **Unterelemente** (aufklappbar) und die über Relationen **verknüpften Einträge** — jeweils direkt anklickbar.
- Die Position erscheint nur, wenn die Notiz in der Ansicht auch **steht**: Die Zugehörigkeit zu einer Datenbank hängt bewusst nicht von den Filtern einer Ansicht ab, beides kann also auseinandergehen.
- Das **Eigenschaften**-Panel bleibt daneben nützlich: Es zeigt das rohe Frontmatter — alle Felder, ohne Reihenfolge, Typen und Filter der Datenbank.
- Gehört eine Notiz zu keiner Datenbank, erscheint weder Zeile noch Bereich. Nichts davon wird in die Notiz geschrieben: Der Kontext wird bei jedem Öffnen aus den `.base`-Dateien und Deinen Links neu berechnet, die Notiz selbst bleibt unverändertes Markdown.

## Neue Einträge anlegen

Der **Eintrag**-Knopf oben links (vormals **Neu**; klar getrennt vom globalen **Neu** der Seitenleiste) erstellt ein neues Element:

- Der Dateiname folgt dem Muster `{Datenbankname}_{laufende Nummer}` (Leerzeichen werden zu `_`); die Notiz startet mit passender Überschrift und erbt Tag-Quellen sowie einfache Filterwerte der Datenbank, damit sie sofort in der Ansicht erscheint. Danach öffnet sich das Peek-Fenster zum Ausfüllen.
- **Ablage-Ordner**: Neue Elemente landen dauerhaft in einem festgelegten Ordner. Hat die Datenbank keine Ordner-Quelle, führt Dich ein Dialog einmalig durch die Anlage; bei mehreren Ordner-Quellen wählst Du einmal aus. Später jederzeit änderbar über das Pfeil-Menü am Knopf → **Ablage-Ordner ändern…**.
- **Vorlagen**: Das Pfeil-Menü (**Vorlagen und Ablage-Ordner**) listet die Vorlagen Deines Vault-Template-Ordners — einmalig nutzen, per Stern **Als Standard setzen** (gilt dann für jeden Klick auf **Eintrag** dieser Datenbank) oder **Neue Vorlage erstellen** (eine neue Vorlage startet mit einer `# {{title}}`-Überschrift, sodass daraus erstellte Einträge ihren Dateinamen als H1 bekommen). Dasselbe Menü bietet außerdem **Vorlagen-Ordner öffnen**, das den Vorlagen-Ordner im Dateibaum anzeigt — Vorlagen sind normale Notizen, die Du dort bearbeiten, umbenennen oder löschen kannst.
- **Vorlagen je Datenbank**: Vorlagen lassen sich Datenbanken zuordnen. Das Pfeil-Menü zeigt standardmäßig nur die dieser Datenbank zugeordneten Vorlagen (plus ihre Standard-Vorlage); alle übrigen erreichst Du über **Alle Vorlagen anzeigen (n)**. Zuordnen geht direkt dort — das Datenbank-Symbol an jeder Zeile heißt **Dieser Datenbank zuordnen** bzw. **Zuordnung zu dieser Datenbank entfernen** — oder auf der Vorlage selbst: Im ⋮-Menü des Editors öffnet **Ziel-Datenbanken…** einen Dialog mit Suchfeld, in dem Du die Vorlage mehreren Datenbanken zuweist. Eine über **Neue Vorlage erstellen** aus einer Datenbank angelegte Vorlage ist ihr automatisch zugeordnet. Gespeichert wird die Zuordnung als `plainva.templateFor`-Liste im Frontmatter der Vorlage (siehe [Dateiformat-Referenz](File_Format_Reference.md)); beim Anlegen eines Eintrags wird sie nie in die neue Notiz übernommen, und beim Umbenennen einer `.base` ziehen die Zuordnungen automatisch mit. Der Slash-Befehl **Vorlage einfügen** bleibt bewusst ungefiltert — er fügt Text in eine bestehende Notiz ein und hat keinen Datenbank-Kontext.
- **Aufgabenlisten**: Ist die Datenbank eine Aufgaben-Datenbank und hast Du ein Kalender-/Aufgaben-Konto verbunden, steht unter **Konfigurieren → Datenquelle** die Zeile **Neue Aufgaben auch anlegen bei**. Wählst Du dort eine Liste, landet jede in Plainva angelegte Aufgabe zusätzlich in dieser Liste beim Anbieter — über **+ Neue Aufgabe**, über eine beförderte Checkbox und über eine als Aufgabe erfasste E-Mail gleichermaßen; ohne Auswahl bleibt sie eine Notiz — wie bisher. Die Wahl gehört zur Datenbank (gespeichert als `plainva.taskList`, siehe [Dateiformat-Referenz](File_Format_Reference.md)), nicht zur einzelnen Aufgabe, und die Zeile erscheint nur, wenn ein Konto überhaupt eine Aufgabenliste anbietet. Verschwindet die gewählte Liste später (Konto entfernt, Liste gelöscht), legt Plainva nichts irgendwo anders an, sondern behandelt die Datenbank wieder wie ohne Auswahl. Die neue Aufgabe merkt sich, welche Aufgabe beim Anbieter zu ihr gehört; ohne diesen Vermerk würde der nächste Abgleich eine zweite Notiz für dieselbe Aufgabe anlegen. Schlägt das Anlegen beim Anbieter fehl, bleibt die Notiz bestehen und Plainva sagt es — die Notiz ist die Lieferung, die Aufgabe beim Anbieter die Zugabe.
- **Vorlagen-Platzhalter**: Vorlagen ersetzen `{{title}}`, `{{date}}` und `{{time}}`. Beim *Einfügen* einer Vorlage in eine Notiz (Slash-Befehl **Vorlage einfügen** / `Mod+Alt+T`) kommen zwei weitere hinzu: `{{cursor}}` markiert, wo der Cursor nach dem Einfügen landet, und `{{prompt:Bezeichnung}}` fragt Dich nach einem Wert (Beschriftung *Bezeichnung*) und fügt Deine Antwort ein. Beim Erstellen einer *neuen* Notiz aus einer Vorlage gilt seit der Vorlagen-Engine dasselbe: Plainva fragt alle `{{prompt:…}}`-Werte zusammen ab und setzt die Schreibmarke auf `{{cursor}}`, sobald die Notiz aufgeht. Nur im Hintergrund (Aufgaben-Abgleich, Mail-Erfassung) wird nicht gefragt — dort bleiben die Antworten leer. Alle Platzhalter stehen in [Notizen und Markdown](Notes_and_Markdown.md).
- **Umbenennen, duplizieren, löschen**: Ein Rechtsklick auf einen Eintrag bietet in jeder Ansicht (Tabelle, Liste, Karten, Board, Kalender, Zeitachse) **Öffnen**, **Im Split öffnen**, **Umbenennen…**, **Duplizieren** und **Löschen…** — gelöscht wird über den gewohnten Kaskaden-Dialog. Dieselben Aktionen liegen im ⋮-Menü des Peek-Fensters, und ein Doppelklick auf dessen Titel benennt ebenfalls um. Spiegelt die Überschrift noch den Dateinamen (der Zustand eines frischen `{Datenbankname}_{Nummer}`-Eintrags), zieht sie beim Umbenennen mit; eine selbst geschriebene Überschrift bleibt unangetastet.

## Pinnwand (Notizzettel wie in Google Keep)

Der Ansichtstyp **Pinnwand** zeigt die Notizen der Datenbank als Karten mit ihrem gerenderten Inhalt — ein Brett voller Notizzettel. Karten rendern Text, Listen und anklickbare Kontrollkästchen (ein Klick hakt die Aufgabe direkt in der Notiz ab), Bilder und Formatierung; Tabellen, Formeln und Einbettungen erscheinen als dezente Platzhalter. Ein Klick auf eine Karte öffnet die Notiz im Vorschaufenster.

- **Schnell erfassen**: Das Feld **Notiz schreiben…** über dem Brett klappt zu einem kleinen Eingabefenster mit **Titel**-Feld und mehrzeiligem Notiztext auf — wie in Google Keep. Ein eingegebener Titel wird Dateiname UND erste Überschrift der Notiz; ohne Titel bekommt die Datei einen Zeitstempel-Namen und die Notiz keine Überschrift. Der Text ist in beiden Fällen der Inhalt — ohne Vorlage, ganz ohne Umwege (Strg/Cmd+Eingabe speichert).
- **Anpinnen**: Der Pin-Knopf (beim Überfahren der Karte oben rechts) hebt eine Karte in die Sektion **Angepinnt**.
- **Anordnen**: Karten lassen sich per Ziehen umsortieren; die Reihenfolge liegt in der `.base`-Datei und synchronisiert mit. Noch nicht angeordnete Karten (frisch erfasst oder extern angelegt) erscheinen oben, neueste zuerst. Ist unter **Konfigurieren** eine Sortierregel gesetzt, gewinnt sie — Ziehen ist dann deaktiviert.
- **Labels**: Die Chip-Leiste über dem Brett filtert die Karten — standardmäßig nach Tags, umschaltbar auf eine Mehrfachauswahl-Eigenschaft (**Konfigurieren** → **Label-Quelle**). Mehrere Chips filtern UND-verknüpft; die Auswahl ist flüchtig und wird nicht gespeichert. Die Labels einer Karte bearbeitest Du über **Labels** im Kontextmenü der Karte.
- **Farbe**: Das Kontextmenü färbt die Karte ein. Die Farbe ist die Kopfzeilen-Farbe der Notiz (`plainva.header_color`) — sie gilt überall, wo die Notiz erscheint, auch im Editor-Kopf.
- **Eigenschaften**: Die unter **Konfigurieren** → **Eigenschaften** angehakten Eigenschaften erscheinen als kompakte Zeilen unten auf jeder Karte — Datumswerte folgen dem Datumsformat der Ansicht, leere Werte werden übersprungen.
- **Mobil**: Auf dem Handy öffnet Tippen die Notiz, langes Drücken zeigt die Aktionen (Anpinnen, Labels, Farbe, Löschen), Ziehen nach langem Drücken ordnet um. Tipp: Zeigt die Datenbank auf Deinen Eingangsordner (**Einstellungen** → **Ordner**), landen auch die ＋-Schnellnotizen und aus anderen Apps geteilte Texte direkt auf dem Brett.

Hinweis für synchronisierte Vaults: Ordnen zwei Geräte das Brett gleichzeitig an, kann eine `.CONFLICT`-Kopie der `.base`-Datei entstehen — betroffen ist nur die Anordnung, nie der Inhalt der Notizen; die Kopie kannst Du löschen oder zusammenführen.

## Bedienung im Alltag

- **Inline-Editing**: Ein Einfach-Klick in eine Zelle (oder auf einen Karten-Wert) macht sie editierbar — in allen Ansichten.
- **Öffnen**: Ein Klick auf den Eintragstitel öffnet die Notiz im Peek-Fenster — einem frei beweglichen Fenster, das Du an der Titelleiste verschieben und an der Ecke in der Größe anpassen kannst. Es hat eine eigene **Zurück**/**Vorwärts**-Historie für die darin geöffneten Notizen, einen Umschalter, der eine **Eigenschaften**-Spalte für die gezeigte Notiz einblendet, sowie **Als Tab öffnen** und **Im Split öffnen**. `Strg`+Klick öffnet direkt im Split; alternativ ziehst Du eine Karte auf die Drop-Zone **Hier ablegen: im Split öffnen**.
- **Drag**: Beim Ziehen von Karten (Board, Kalender, Zeitachse) folgt eine Ghost-Karte dem Mauszeiger. In einem **Board** kannst Du außerdem eine **Spaltenüberschrift** ziehen, um die Spalten umzuordnen — bei **Auswahl**/**Status**-Boards ordnet das die Optionen der Eigenschaft um (die Dropdowns überall folgen), Relations- und Freitext-Boards merken sich die Reihenfolge pro Ansicht.
- **Spaltenfarbe**: In den **Ansicht**-Einstellungen eines Boards lässt **Spaltenfarbe** eine Spalte die Farbe ihrer Gruppe annehmen — entweder **Ganze Liste** (die ganze Spalte wird eingefärbt) oder **Nur Chip** (nur der Chip in der Überschrift, Standard). Gilt für Auswahl-/Status-/Mehrfachauswahl-Gruppen.
- **Einbetten**: Datenbanken lassen sich in Notizen einbetten (Slash-Befehl **Datenbank einbetten** oder `@` → **Datenbanken**) und dort vollwertig bedienen.
- **Automatischer Filter in einem verknüpften Element**: Bettest Du eine Datenbank in ein einzelnes Element einer *verknüpften* Datenbank ein, wird sie automatisch auf dieses Element gefiltert — bette die Aufgaben-Datenbank in eine Projekt-Notiz ein, und Du siehst nur die Aufgaben dieses Projekts. Das funktioniert in beide Richtungen (die „Viele"-Seite einbetten, um die auf das Element zeigenden Zeilen zu sehen, oder die „Eins"-Seite, um zu sehen, worauf das Element zeigt) und für selbstverknüpfte Datenbanken mit einer Über-/Unterelemente-Hierarchie (bettest Du die Datenbank in ein Element ein, erscheinen dessen Unterelemente, verschachtelt). Ein kleiner **Filter**-Chip in der Kopfzeile des Embeds zeigt, worauf gefiltert wird; darüber kannst Du die Relation wechseln oder **Alle anzeigen** wählen. Der Filter wird nie in die `.base`-Datei geschrieben — dieselbe Datenbank zeigt also in jedem Element, in das sie eingebettet ist, die richtigen Zeilen.
- **Neue Einträge erben die Verknüpfung**: Legst Du mit **Eintrag** innerhalb eines so gefilterten Embeds einen Eintrag an, wird er automatisch mit dem Element verknüpft (eine Aufgabe, die Du in der eingebetteten Aufgabenliste eines Projekts anlegst, gehört sofort zu diesem Projekt). In der Gegenrichtung wird stattdessen das Element mit dem neuen Eintrag verknüpft; eine bereits belegte Einzelwert-Relation bleibt unangetastet.
- **Expliziter Filter „Diese Notiz" (wie Notions „this page")**: Statt Dich auf den automatischen Filter zu verlassen, kannst Du ihn explizit und dauerhaft setzen. Füge unter **Konfigurieren → Filter** eine Regel auf einer Relations-Eigenschaft hinzu und wähle als Wert **Diese Notiz**. Die Datenbank ist dann auf die jeweilige Notiz gefiltert, in die sie eingebettet ist — ideal für **Vorlagen**: Bette die Aufgaben-Datenbank in eine Projekt-Vorlage ein, und jedes daraus erstellte Projekt zeigt seine eigenen Aufgaben. Es funktioniert für jede Wiki-Link-Eigenschaft, nicht nur für erkannte Relationen, und ein expliziter **Diese Notiz**-Filter hat Vorrang vor dem automatischen. Dieser Filter lebt nur in Plainva (er wird nicht als normaler Filter in die `.base` geschrieben), sodass Obsidian und ein Öffnen als eigener Tab beide alle Zeilen zeigen.

## Mehrere Einträge auf einmal

Manchmal betrifft eine Änderung nicht einen Eintrag, sondern zwölf.

**Auswählen (Desktop)**: In der **Tabelle** und in der **Liste** sitzt vor jeder Zeile ein Kästchen. Es ist unauffällig, bis Du es brauchst: Es erscheint, sobald der Mauszeiger über der Zeile steht, sobald es die Tastatur erreicht, und für alle Zeilen, sobald etwas ausgewählt ist. `Umschalt`+Klick wählt einen ganzen Bereich, das Kästchen in der Kopfzeile wählt alles. Ein Klick in eine **Zelle** bearbeitet sie weiterhin — die Auswahl nimmt ihm den Klick nicht weg.

**Auswählen (Handy)**: Halte eine Zeile gedrückt und wähle **Mehrere auswählen** — es ist der erste Eintrag im Blatt. Danach wählt ein Tipp aus statt zu öffnen, bis Du die Auswahl aufhebst.

Solange etwas ausgewählt ist, ersetzt eine Leiste die Werkzeugzeile und zeigt, wie viele Einträge es sind.

- **Löschen**: Es wird EINE Frage gestellt, nicht zwölf — und es ist dieselbe Kaskaden-Frage wie beim einzelnen Löschen (siehe unten). Am Desktop löscht auch die `Entf`-Taste; solange Du in einem Feld tippst, gehört sie dem Feld.
- **Wert setzen**: **Wert setzen…** öffnet die Auswahl einer Eigenschaft und dann den Editor, den ihr Typ ohnehin hat. Auf dem Handy sind das zwei Blätter; die Eigenschaftsliste sagt dort **derzeit gemischt**, wenn die ausgewählten Einträge verschiedene Werte tragen. Ein leerer Wert **entfernt** die Eigenschaft, genau wie beim Leeren einer Zelle.

Beim Setzen läuft ein Fortschritt mit („7 von 24"), der sich abbrechen lässt — bereits Geschriebenes bleibt und wird gemeldet. Schlägt eine einzelne Datei fehl, bricht der Lauf nicht ab: Am Ende steht, wie viele geändert wurden und wie viele nicht. Betrifft die Änderung einen großen Teil der Ansicht, kommt dieselbe zweite Rückfrage wie beim Löschen.

**Die Grenze, bewusst**: Setzen geht für Eigenschaften mit *einem* Wert — Text, Zahl, Kontrollkästchen, Datum, Auswahl, Status, E-Mail, Telefon. **Nicht** für Tags, Listen, Mehrfachauswahl und Relationen: Dort hieße „setze alle auf X", dass jeder bestehende Wert verschwindet. Das braucht ein eigenes *hinzufügen* und *entfernen* und kommt später.

## Löschen mit Zusammenhängen (Kaskadenlöschung)

Löschst Du etwas, an dem andere Einträge hängen, zeigt Plainva vor dem Löschen einen Überblick statt einer bloßen Ja/Nein-Frage:

- **Element mit zugeordneten Elementen** (z. B. ein Projekt, auf das Aufgaben per Relation zeigen): Der Dialog listet die zugeordneten Elemente — einschließlich ihrer eigenen Unterelemente — gruppiert nach Herkunfts-Datenbank, mit der Frage **Zugeordnete Elemente mitlöschen**. **Geteilte** Elemente (auch einem anderen Element zugeordnet) sind standardmäßig ausgenommen und tragen ein Abzeichen wie „auch ‚Q3-Kampagne‘".
- **Ganze Datenbank löschen**: Beim Löschen einer `.base` fragt der Dialog, ob **alle Elemente** der Datenbank mitgelöscht werden sollen (**Alle Elemente mitlöschen**). Elemente, die zugleich Zeilen einer *anderen* Datenbank sind, sind standardmäßig ausgenommen. Ordner-Übersichten (`index.md`) und Anhänge bleiben immer erhalten.
- **Verknüpfte Datenbanken**: Jede per Relation verknüpfte Datenbank bekommt eine eigene, klar benannte Karte mit zwei Stufen — erst nur die **zugeordneten** Elemente, optional die **ganze** Datenbank (Datei plus alle Elemente). Beide Stufen sind standardmäßig **aus**: Nichts aus einer verknüpften Datenbank wird ohne Dein ausdrückliches Häkchen gelöscht.

Über **Elemente anzeigen** öffnest Du je Gruppe eine Liste mit einer Checkbox pro Element — Du kannst also einzelne Elemente vom Löschen ausnehmen. Der rote Knopf zählt live mit („15 Dateien löschen"). **Verweise bereinigen** (standardmäßig an) entfernt Verweise auf Gelöschtes aus den Eigenschaften der verbleibenden Notizen; Links im Fließtext bleiben unverändert. Ab der bekannten Schwelle für große Löschungen erscheint zusätzlich die zweite Sicherheitsabfrage, und bei aktivem Sync wird die Löschung auch in der Cloud ausgeführt. Für jede gelöschte Datei bleibt ein Versions-Snapshot erhalten — wiederherstellbar über **Gelöschte Dateien wiederherstellen**. Wird die als **Standard-Aufgabendatenbank** eingestellte Datenbank gelöscht, setzt Plainva die Einstellung zurück und entfernt Vorlagen-Zuordnungen; Aufgaben bei Google/Microsoft bleiben davon unberührt. Auf dem Handy erscheint derselbe Überblick als Sheet mit Gruppen-Häkchen und Zähler (ohne Einzel-Abwahl).

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

## Der Kalender einer Datenbank: Monat, Woche, Tag

Die Kalenderansicht zeigt drei Zeiträume — **Monat**, **Woche** und **Tag**. Der Umschalter steht oben neben **Heute**; ◀ und ▶ bewegen sich immer um den gerade gezeigten Zeitraum weiter. Ein Wechsel behält den Tag, auf den Du gerade schaust: von **Monat** auf **Woche** zeigt die Woche, in der dieser Tag liegt.

Trägt die Datumsspalte eine **Uhrzeit**, steht sie vor dem Titel, und die Einträge eines Tages sind nach der Uhr sortiert — Einträge ohne Uhrzeit stehen darunter. Der **Wochenbeginn** folgt Deiner Einstellung unter **Erscheinungsbild**, genau wie im echten Kalender.

Hat die Ansicht zusätzlich ein **Enddatum** (Konfigurieren → Ansicht), wird ein mehrtägiger Eintrag als **ein Balken** über seine Tage gezeichnet — nicht als Kette gleich aussehender Kärtchen. Verlässt er die Woche, wird der Balken an der Kante abgeschnitten und ohne Titel fortgesetzt.

## Die Zeitachse: Balken, Kanten, Farbe

Die Zeitachse zeigt **eine Zeile je Eintrag** und darin einen **Balken** von seinem Startdatum bis zu seinem Enddatum. Oben schaltest Du zwischen **Woche**, **3 Wochen** und **Quartal** um; eine senkrechte Linie markiert **heute** über alle Zeilen hinweg.

**Die Kanten des Balkens sind Griffe.** Ziehst Du die rechte Kante, schreibt Plainva das **Enddatum** in die Notiz; die linke Kante schreibt das **Startdatum**. Ziehst Du den Balken selbst, wandern beide Daten mit — seine Länge bleibt, was sie war. Zwei Dinge kann keine Geste erzwingen: eine Kante wandert nie über die andere hinaus (aus einem Ende vor seinem Anfang würde ein kaputter Datensatz), und ohne konfiguriertes **Enddatum** entsteht auch keins — dann lässt sich nur der Anfang bewegen.

Ein Balken, der über den gezeigten Zeitraum hinausreicht, wird an der Kante abgeschnitten und trägt dort **keinen Griff**: was Du dort siehst, ist der Rand des Fensters, nicht das Ende des Eintrags.

**Farbe nach Eigenschaft:** Unter Konfigurieren → Ansicht wählst Du bei **Farbe nach** eine Auswahl-, Status- oder Mehrfachauswahl-Eigenschaft. Die Balken übernehmen dann die Farbe des jeweiligen Werts — dieselbe, die der Wert als Chip und im Board trägt. Ohne diese Auswahl bleiben alle Balken in der Akzentfarbe.
