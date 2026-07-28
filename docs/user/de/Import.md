# Aus einer anderen App importieren

Stand: 2026-07-28

Plainva kann Notizen aus anderen Notiz-Apps übernehmen. Der Import schreibt immer in den Vault, den Du gerade geöffnet hast — in einen Unterordner, den Du selbst benennst. Der Rest Deines Vaults wird nicht angefasst, und Du kannst den importierten Ordner hinterher wie jeden anderen Ordner verschieben oder löschen.

**Der Import läuft am Desktop.** Die mobile App kann nicht importieren: Hol die Notizen am Desktop herein — über die Synchronisation kommen sie wie jede andere Datei auf Dein Telefon.

## Import starten

Drei Wege:

- **Startbildschirm** → **Aus anderer App importieren** — der Weg, wenn Du noch gar keinen Vault hast, also der Normalfall beim Umstieg.
- **Befehlspalette** (`Mod+P`) → **Aus anderer App importieren...**
- **Rechtsklick auf einen Ordner** im Dateibaum → **Aus anderer App importieren...**

Der erste Schritt fragt nach Deinem Export — **Dateien wählen…** oder **Ordner wählen…**, je nachdem, was Du vorliegen hast. Danach benennt der Assistent die erkannte App und Du legst fest, wohin geschrieben wird. Es folgt eine Vorschau mit den Zahlen des Laufs, den Grenzen dieses Imports und den Schaltern zur Quelle. Geschrieben wird erst, wenn Du auf **Import starten** klickst.

**Du musst nicht wissen, welcher Eintrag zu Deinem Export passt.** Wähle die Dateien, und Plainva erkennt die Quelle — einen Notion-Export an den langen IDs in seinen Pfaden, einen Logseq-Graphen an seinen Ordnern `journals/` und `pages/`, einen Keep- oder Simplenote-Export am Inhalt des JSON. Der Assistent sagt, was er erkannt hat; lag er falsch, änderst Du es in den Kacheln darunter, und Deine Wahl bleibt stehen.

## Wohin der Import schreibt

Genau eines von beiden je Import — nie beides:

- **Neuer Vault**: Du wählst einen leeren Ordner, Plainva legt darin einen frischen Vault an und importiert dorthin. Nichts von dem, was Du schon hast, kann berührt werden, und den ganzen Import machst Du rückgängig, indem Du diesen Ordner löschst. Das ist die richtige Wahl, wenn Du Plainva ausprobierst.
- **Unterordner im offenen Vault**: Alles landet in einem einzigen, neu angelegten Unterordner, den Du benennst. Der Rest Deines Vaults bleibt unberührt.

Die Zielzeile unter der Auswahl nennt immer den genauen Ordner — wo etwas landet, ist damit nie eine Vermutung.

## Optionen für diesen Import

In der Vorschau stehen unter den Zahlen die Schalter, die **zur erkannten Quelle passen** — jede Quelle bringt ihre eigenen mit, und was eine Quelle nicht kann, taucht dort auch nicht auf. Sie stehen dort und nicht früher, weil die Fragen erst Sinn ergeben, wenn Du siehst, was auf Dich zukommt; ein Schalter, der die Zahlen ändert, lässt sie sofort neu zählen.

- **Datum aus der Quelle übernehmen** (an) — die importierten Notizen behalten Erstell- und Änderungsdatum aus der Quelle. Ohne diese Option tragen alle das heutige Datum.
- **Auch gelöschte Notizen importieren** (aus) — bei Google Keep und Simplenote, deren Export den Papierkorb mitliefert. Standardmäßig bleibt liegen, was dort liegt; der Bericht nennt es beim Namen.

## Was die Vorschau zeigt

Die Vorschau ist die letzte Station vor dem Schreiben und nennt alles, was danach eine Überraschung wäre:

- die Zahlen des Laufs — Notizen und Datenbanken, dazu **Anhänge** und **Checklisten**, sofern die Quelle welche hat,
- den genauen Zielordner,
- was dieser Import **nicht** übernehmen kann, und einzeln aufgeführt, was im Archiv übersprungen wurde,
- bei einem Vault mit Cloud-Verbindung den Hinweis, dass die importierten Notizen anschließend **hochgeladen** werden,
- bei sehr großen Quellen den Hinweis, dass Suchindex und Erst-Sync danach eine Weile brauchen.

## Einen Lauf stoppen

Ein großer Workspace dauert, deshalb lässt sich ein Import stoppen: **Import stoppen** während des Laufs. Was schon im Vault angekommen ist, bleibt dort, und der Bericht beschreibt es — ein Teil-Import ist kein kaputter. Wie beim vollständigen Import ist der Ordner das Rückgängig.

## Was Du importieren kannst

| Quelle | Was Du auswählst | Was übernommen wird |
|---|---|---|
| **Notion (API)** | Einen Integrations-Token | Seiten, Ordner-Hierarchie, Datenbanken mit Zeilen, Relationen, 21 Eigenschaftstypen |
| **Notion (ZIP-Export)** | Das ZIP oder den entpackten Ordner | Seiten und Ordnerstruktur; eine Datenbank bekommt Spalten und Zeilenwerte aus der CSV daneben |
| **Evernote (ENEX)** | Eine oder mehrere `.enex`-Dateien | Notizen, Tags, Checklisten (abgehakt und offen), Erstellt-/Geändert-Daten |
| **Google Keep (Takeout)** | Das Takeout-ZIP oder die `.json`-Dateien | Notizen, Checklisten, Labels als Tags, Farbe in der Notiz-Kopfzeile, angeheftete Notizen als Pinnwand |
| **Simplenote** | Die exportierte `.json`-Datei | Aktive Notizen und ihre Tags |
| **Logseq** | Deinen Graph-Ordner | Die Dateien, unverändert kopiert |
| **Joplin** | Der Markdown-Export als Ordner oder ZIP | Notizen mit ihren Notizbüchern, Frontmatter, Tags und Ressourcen |
| **Bear (TextBundle)** | Die exportierten `.textbundle`-Ordner | Notizen mit ihren Bildern |
| **Notesnook** | Der Markdown-Export | Notizen und ihre Notizbuch-Ordner; eine Notiz in zwei Notizbüchern wird einmal importiert |
| **Capacities** | Der Export als Ordner oder ZIP | Notizen mit ihren Eigenschaften als Frontmatter, dazu Medien |
| **Amplenote** | Das Export-ZIP | Notizen mit ihrem Frontmatter und ihren Bildern |
| **Supernotes** | Der Markdown-Export | Karten als Markdown, mit den Metadaten-Dateien daneben |
| **Heptabase** | Der Markdown-Export | Karten mit ihrem Frontmatter; die Whiteboard-Anordnung kommt nicht mit |
| **UpNote** | Der Markdown-Export | Notizen mit ihren Notizbüchern und Anhängen |
| **Craft** | Der Markdown-Export | Dokumente mit ihren Assets |
| **Anytype** | Der Markdown-Export | Objekte mit ihren Relationen als Frontmatter |
| **Standard Notes** | Das entschlüsselte JSON-Backup | Notizen mit ihren Titeln und Tags |
| **Workflowy / Dynalist** | Der OPML-Export | Eine Notiz je Eintrag der obersten Ebene, die Unterpunkte als verschachtelte Listen |
| **Trilium** | Der Subtree-Export | Der Notizbaum und seine Anhänge; HTML-Notizen werden zu Markdown |
| **Roam Research** | Der JSON-Export | Seiten als Notizen, Gliederungen als verschachtelte Listen; Blockreferenzen werden zum Text, auf den sie zeigten |
| **Reflect** | Der Markdown-Export | Notizen mit ihren Wiki-Links und Tagesnotizen |
| **TiddlyWiki** | Der JSON-Export | Tiddler als Notizen mit ihren Tags und Daten; WikiText bleibt, wie er geschrieben ist |
| **Tana** | Ein Tana-Paste-Text | Jeder oberste Knoten wird eine Notiz, seine Kinder bleiben Aufzählungspunkte |
| **RemNote** | Der Markdown-Export | Dokumente mit ihren verschachtelten Rems |
| **HTML-Ordner / ZIP** | Ein Ordner, Dateien oder ein ZIP mit HTML-Seiten | Die Seiten als Markdown-Notizen, die Links untereinander umgebogen |
| **Markdown-Ordner / ZIP** | Einen Ordner, Dateien oder ein ZIP | Die `.md`-Dateien und ihre Ordnerstruktur |

**Obsidian** steht mit in der Liste, startet aber keinen Import — und braucht auch keinen. Plainva arbeitet mit denselben Markdown-Dateien: Der Eintrag erklärt das und bietet Dir **Vault öffnen** an. Wiki-Links, Tags, Frontmatter und `.base`-Dateien funktionieren weiter, und Dein Vault bleibt mit Obsidian nutzbar. Ehrlich dazu gehört: Es gibt kein Plugin-Ökosystem, kein Canvas und kein Dataview — dafür Filter in `.base`; Plugin-Syntax in Deinen Notizen bleibt als Text stehen.

## Warum fehlt meine App?

Manche Apps stehen nicht in der Liste, und der Grund ist jedes Mal ein anderer — das ist wichtig, denn zwei davon fehlen nur vorerst.

- **OneNote** — es gibt keinen Massen-Export, der etwas Brauchbares liefert. Der Weg führte über Microsofts Graph-API mit delegiertem Login: ein Aufruf je Seite, ein weiterer für jedes Bild, dazu die Entscheidung, wie eine frei belegbare Fläche überhaupt zu Markdown wird. Das ist als Zukunftsprojekt vermerkt, nicht ausgeschlossen — die API selbst steht frei zur Verfügung.
- **Apple Notes** — auch Apple bietet keinen Massen-Export, und die Notizen zu lesen hieße, eine SQLite-Datenbank zurückzuentwickeln, und das nur unter macOS. Etablierte Exportwerkzeuge tun das bereits. Exportiere mit einem davon nach Markdown und bring den Ordner über **Markdown-Ordner / ZIP** herein.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — kein dokumentierter Export, aus dem sich importieren ließe.
- **Confluence** — die API liefert Confluences eigenes Storage-Format, einen XHTML-Dialekt rund um Makros, der einen eigenen Konverter bräuchte; und es ist ein Team-Wiki, keine persönliche Sammlung. Der Weg hinein ist heute der Bereichs-Export: den Bereich als **HTML** exportieren und den Ordner über **HTML-Ordner / ZIP** hereinholen. Die Links zwischen den exportierten Seiten funktionieren weiter.

Für alles, was nicht in der Liste steht, ist der Weg derselbe: Kann Deine App Markdown-Dateien schreiben, nimmt der Eintrag **Markdown-Ordner / ZIP** sie an — mitsamt ihrer Ordnerstruktur.

## Notion im Detail

Notion ist die eine Quelle, bei der sich die beiden Wege deutlich unterscheiden.

**Mit Integrations-Token (empfohlen).** Den Token legst Du unter `notion.so/my-integrations` an — der Assistent nennt die drei Schritte und öffnet Dir die Seite. Öffne danach in Notion jede Seite, die Du importieren willst, klicke oben rechts auf **„..."** → **Verbindungen**, und füge Deine Integration hinzu — Notion gibt nur Seiten heraus, die Du ausdrücklich verbunden hast.

**Plainva speichert den Token nicht.** Er gilt für diesen einen Lauf und ist danach wieder weg; es entsteht kein verbundenes Konto. Für den nächsten Import fügst Du ihn erneut ein.

Über die API sieht Plainva die Struktur, nicht nur den Text:

- Die Seiten-Hierarchie wird zur Ordnerstruktur.
- Jede Datenbank wird eine `.base`-Datei plus ein Ordner mit **einer Notiz pro Zeile**.
- **Relationen werden zu Wiki-Links** zwischen diesen Notizen, in beide Richtungen.
- 21 Eigenschaftstypen werden übernommen — Auswahl, Status, Mehrfachauswahl, Datum, Zahl, Checkbox, URL, E-Mail, Telefon, Formel, Rollup, Relation, Personen, eindeutige ID und weitere.
- Tabellen-, Board-, Kalender- und Listenansicht werden aus dem Datenbankschema erzeugt.
- In eine Seite eingebettete Datenbanken werden zu echten `![[Datenbank.base]]`-Embeds.

**Aus einem ZIP-Export.** Das funktioniert offline und ohne Token, aber Notions Export enthält weder das Datenbankschema noch die Seiten-IDs. Seiten und Ordner kommen mit, und **Links zwischen den importierten Seiten funktionieren weiter** — Notion schreibt sie mit einer langen ID in jedem Pfadabschnitt, und Plainva richtet sie auf die Notizen aus, die tatsächlich geschrieben wurden. Die `.csv` neben jedem Datenbank-Ordner wird für das gelesen, was die Seiten selbst nicht tragen: die Spalten, ihre Typen und die Werte jeder Zeile als Frontmatter. Zeilen, für die der Export keine Seite hat, werden als Notizen geschrieben. Zugeordnet wird über den Titel — der API-Weg ist der mit echten IDs und bleibt die bessere Wahl für einen Workspace, der auf Relationen gebaut ist.

## Was ein Import nicht übernehmen kann

Jeder Import nennt seine Grenzen in der Vorschau und noch einmal im Bericht. Die wichtigsten:

- **Anhänge kommen mit.** Aus einem ZIP oder Ordner behalten sie ihren Platz im Export, damit ein relativer Bild-Link in einer Notiz weiter funktioniert. Aus Notion über die API werden sie während des Imports heruntergeladen — Notion signiert diese Links, und sie laufen binnen einer Stunde ab — und landen in einem Ordner `Attachments`; Bilder, die eine Seite von woanders aus dem Netz einbindet, bleiben Links. Zwei Ausnahmen bleiben in Deinem Export und werden im Bericht einzeln genannt: Anhänge in einer Evernote-`.enex` und Google-Keep-Bilder.
- **Einzelne Einträge in einem Archiv überspringt Plainva bewusst:** sehr große Dateien, symbolische Links und Einträge mit unsicherem Pfad. Sie erscheinen mit Grund in der Vorschau, bevor Du den Import startest.
- **Sehr lange Notion-Seiten** werden vollständig gelesen, aber Inhalte in Toggles, Spalten oder Unterlisten werden nicht verfolgt.
- **Logseq-Dateien werden unverändert kopiert** — `key:: value`-Eigenschaften und Block-Referenzen werden nicht in Plainva-Eigenschaften oder -Links umgewandelt.
- **Gelöschtes bleibt gelöscht.** Der Papierkorb von Simplenote und Google Keep wird übersprungen — Du hattest Dich einmal gegen diese Notizen entschieden, und ein Import soll sie Dir nicht stillschweigend zurückgeben. Im Bericht stehen sie namentlich, damit Du siehst, was zurückblieb.
- **Notion-ZIP-Exporte** ordnen Zeilen über den Titel zu (siehe oben) und tragen keine Relationen zwischen Datenbanken.
- **HTML-Tabellen und Codeblöcke verlieren ihre Struktur.** Die Umwandlung liest Überschriften, Listen, Auszeichnungen, Links und Bilder; eine Tabelle wird zum Text ihrer Zellen. Jede Seite, bei der das passiert ist, steht im Bericht.

## Daten und Zeiten bleiben erhalten

Eine über Jahre gewachsene Sammlung verliert ihren Zeitbezug, wenn nach dem Import alles von heute stammt. Plainva übernimmt deshalb die Datumsangaben der Quelle:

- Sie stehen als `created` und `updated` im Frontmatter der importierten Notiz — dort liest sie auch die Zeitachse des Graphen.
- Zusätzlich bekommt die Datei selbst das Änderungsdatum der Quelle, sodass Sortierung nach Datum und **Zuletzt geöffnet** stimmen. Das Erstellungsdatum der Datei lässt sich nur unter Windows setzen; auf den anderen Systemen ist das Frontmatter der Träger.
- Liefert eine Quelle kein Datum mit, nimmt Plainva das Datum der Exportdatei. Erfunden wird nie eines: fehlt jede Angabe, bleibt das Feld leer.

## Ein Fehler beendet nicht den ganzen Import

Wenn eine einzelne Notiz nicht geschrieben werden kann, läuft der Import weiter und der Bericht nennt sie mit Grund. Auch wenn der Lauf vorzeitig abbricht, wird der Bericht geschrieben — Du siehst also immer, was schon in Deinem Vault liegt.

## Es wird nichts überschrieben

Der Import schreibt in den geöffneten Vault und ist deshalb bewusst nicht-destruktiv gebaut:

- Ist ein Notizname schon vergeben, bekommt die importierte Notiz eine **Nummer** (`Meeting (2).md`), statt die vorhandene zu ersetzen. Das gilt auch, wenn zwei Quellnotizen denselben Namen tragen.
- Importierte Notizen bekommen das übliche OKF-Frontmatter (`type`, `okf_version`) und verhalten sich damit in `.base`-Filtern und -Ansichten wie jede andere Plainva-Notiz.
- Außerhalb des Ziel-Unterordners wird nichts verändert.

Wenn Du den Import lieber komplett getrennt halten willst, lege vorher einen neuen Vault an (**Neuer Vault** im Startbildschirm) und importiere dorthin.

## Der Import-Bericht

Jeder Durchlauf schreibt einen **Import-Bericht** in den Zielordner. Er listet:

- wie viele Notizen und Datenbanken importiert wurden,
- was dieser Import grundsätzlich nicht übernehmen kann,
- alles, was **unvollständig** ankam oder **übersprungen** wurde, mit Grund,
- und jede einzelne Datei mit ihrem Status.

Der Bericht ist das ehrliche Protokoll des Durchlaufs — wenn etwas abgeschnitten oder weggelassen wurde, steht es dort und wird nicht stillschweigend als Erfolg gezählt. Lies ihn, bevor Du den Export löschst.

Ganz unten steht, wie Du den Import **rückgängig** machst: Alles aus einem Lauf liegt in einem einzigen Ordner — löschst Du ihn, ist der Import weg. Beim Ziel **Neuer Vault** ist das der Ordner des neuen Vaults. Einen eigenen Rückgängig-Befehl braucht es dafür nicht. Der Bericht selbst ist eine normale Notiz und darf gelöscht werden, sobald Du ihn gelesen hast.

## Verwandte Seiten

- [Datenbanken (.base)](Databases_Base.md) — was mit importierten Notion-Datenbanken passiert
- [OKF](OKF.md) — das Frontmatter, das importierte Notizen bekommen
- [Erste Schritte](Getting_Started.md) — einen eigenen Vault für den Import anlegen
