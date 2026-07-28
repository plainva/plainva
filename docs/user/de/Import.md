# Aus einer anderen App importieren

Stand: 2026-07-28

Plainva kann Notizen aus anderen Notiz-Apps übernehmen. Der Import schreibt immer in den Vault, den Du gerade geöffnet hast — in einen Unterordner, den Du selbst benennst. Der Rest Deines Vaults wird nicht angefasst, und Du kannst den importierten Ordner hinterher wie jeden anderen Ordner verschieben oder löschen.

**Der Import läuft am Desktop.** Die mobile App kann nicht importieren: Hol die Notizen am Desktop herein — über die Synchronisation kommen sie wie jede andere Datei auf Dein Telefon.

## Import starten

Zwei Wege:

- **Befehlspalette** (`Mod+P`) → **Aus anderer App importieren...**
- **Rechtsklick auf einen Ordner** im Dateibaum → **Aus anderer App importieren...**

Der Assistent hat drei Schritte: App auswählen, aus der Du kommst; Export-Dateien wählen (oder einen Notion-Token eingeben); Zielordner benennen. Danach siehst Du eine Vorschau mit der Anzahl der Notizen und Datenbanken sowie einer Liste dessen, was der Import nicht übernehmen kann. Geschrieben wird erst, wenn Du auf **Import starten** klickst.

## Was Du importieren kannst

| Quelle | Was Du auswählst | Was übernommen wird |
|---|---|---|
| **Notion (API)** | Einen Integrations-Token | Seiten, Ordner-Hierarchie, Datenbanken mit Zeilen, Relationen, 21 Eigenschaftstypen |
| **Notion (ZIP-Export)** | Das ZIP oder den entpackten Ordner | Seiten und Ordnerstruktur. Datenbanken werden **leer** angelegt |
| **Evernote (ENEX)** | Eine oder mehrere `.enex`-Dateien | Notizen, Tags, Checklisten (abgehakt und offen), Erstellt-/Geändert-Daten |
| **Google Keep (Takeout)** | Das Takeout-ZIP oder die `.json`-Dateien | Notizen, Checklisten, Labels als Tags, Farbe, angepinnt/archiviert |
| **Simplenote** | Die exportierte `.json`-Datei | Aktive Notizen und ihre Tags |
| **Logseq** | Deinen Graph-Ordner | Die Dateien, unverändert kopiert |
| **Markdown-Ordner / ZIP** | Einen Ordner, Dateien oder ein ZIP | Die `.md`-Dateien und ihre Ordnerstruktur |

Einen Obsidian-Import gibt es nicht — und er wird auch nicht gebraucht. Plainva öffnet einen Obsidian-Vault direkt: **Vault öffnen** und den Ordner wählen.

## Notion im Detail

Notion ist die eine Quelle, bei der sich die beiden Wege deutlich unterscheiden.

**Mit Integrations-Token (empfohlen).** Den Token legst Du unter `notion.so/my-integrations` an. Öffne danach in Notion jede Seite, die Du importieren willst, klicke oben rechts auf **„..."** → **Verbindungen**, und füge Deine Integration hinzu — Notion gibt nur Seiten heraus, die Du ausdrücklich verbunden hast.

Über die API sieht Plainva die Struktur, nicht nur den Text:

- Die Seiten-Hierarchie wird zur Ordnerstruktur.
- Jede Datenbank wird eine `.base`-Datei plus ein Ordner mit **einer Notiz pro Zeile**.
- **Relationen werden zu Wiki-Links** zwischen diesen Notizen, in beide Richtungen.
- 21 Eigenschaftstypen werden übernommen — Auswahl, Status, Mehrfachauswahl, Datum, Zahl, Checkbox, URL, E-Mail, Telefon, Formel, Rollup, Relation, Personen, eindeutige ID und weitere.
- Tabellen-, Board-, Kalender- und Listenansicht werden aus dem Datenbankschema erzeugt.
- In eine Seite eingebettete Datenbanken werden zu echten `![[Datenbank.base]]`-Embeds.

**Aus einem ZIP-Export.** Das funktioniert offline und ohne Token, aber Notions Export enthält weder das Datenbankschema noch die Seiten-IDs. Seiten und Ordner kommen mit, und **Links zwischen den importierten Seiten funktionieren weiter** — Notion schreibt sie mit einer langen ID in jedem Pfadabschnitt, und Plainva richtet sie auf die Notizen aus, die tatsächlich geschrieben wurden. Datenbanken werden als **leere** `.base`-Dateien angelegt, und der Bericht sagt das auch. Wenn Deine Datenbanken wichtig sind, nimm den API-Weg.

## Was ein Import nicht übernehmen kann

Jeder Import nennt seine Grenzen in der Vorschau und noch einmal im Bericht. Die wichtigsten:

- **Anhänge und Bilder werden nicht importiert.** Der Bericht führt sie einzeln auf, damit Du weißt, was in Deinem Export zurückbleibt; Evernote-Anhänge und Keep-Bilder bleiben ebenfalls dort.
- **Einzelne Einträge in einem Archiv überspringt Plainva bewusst:** sehr große Dateien, symbolische Links und Einträge mit unsicherem Pfad. Sie erscheinen mit Grund in der Vorschau, bevor Du den Import startest.
- **Sehr lange Notion-Seiten** werden vollständig gelesen, aber Inhalte in Toggles, Spalten oder Unterlisten werden nicht verfolgt.
- **Logseq-Dateien werden unverändert kopiert** — `key:: value`-Eigenschaften und Block-Referenzen werden nicht in Plainva-Eigenschaften oder -Links umgewandelt.
- **Gelöschtes bleibt gelöscht.** Der Papierkorb von Simplenote und Google Keep wird übersprungen — Du hattest Dich einmal gegen diese Notizen entschieden, und ein Import soll sie Dir nicht stillschweigend zurückgeben. Im Bericht stehen sie namentlich, damit Du siehst, was zurückblieb.
- **Notion-ZIP-Exporte** legen leere Datenbanken an (siehe oben).

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

## Verwandte Seiten

- [Datenbanken (.base)](Databases_Base.md) — was mit importierten Notion-Datenbanken passiert
- [OKF](OKF.md) — das Frontmatter, das importierte Notizen bekommen
- [Erste Schritte](Getting_Started.md) — einen eigenen Vault für den Import anlegen
