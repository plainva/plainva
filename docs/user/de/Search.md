# Suche

Stand: 2026-07-15

Plainva bietet drei Suchwege: die Volltextsuche über den ganzen Vault, den Schnellwechsel zum Datei-Öffnen und Suchen & Ersetzen innerhalb einer Notiz.

## Volltextsuche im Vault

Das Suchfeld oben in der Seitenleiste durchsucht den gesamten Vault — Titel *und* Inhalte. Dahinter steht ein lokaler Volltextindex (SQLite FTS5), der beim Öffnen des Vaults aufgebaut und bei jeder Änderung aktuell gehalten wird; die Suche funktioniert deshalb auch offline und ohne spürbare Wartezeit.

Die Suche reagiert sofort beim Tippen: Schon Wortanfänge liefern Treffer („Projek" findet „Projektplan"), ohne dass Du Enter drücken musst. Das **X** rechts im Suchfeld löscht die aktuelle Suche (alternativ `Esc`); danach zeigt die Seitenleiste wieder den normalen Dateibaum.

Die Trefferliste zeigt oben die Trefferzahl und gruppiert die Ergebnisse: zuerst **Dateiname** (der Suchbegriff kommt im Namen der Notiz vor), darunter **Inhalt**. Jede Zeile zeigt das Dokument-Icon, den Ordnerpfad und bei Inhaltstreffern einen Textausschnitt mit hervorgehobener Fundstelle. Ein Klick öffnet die Notiz und springt direkt zur ersten Fundstelle; sie ist dort markiert. Gibt es nichts zu finden, meldet die Liste **Keine Treffer**.

Das Suchfeld wirkt auch auf die anderen Seitenleisten-Ansichten: In **Tags** filtert es die Tag-Liste, in **Lesezeichen** die Lesezeichen.

### Suchoperatoren

- `"exakte Phrase"` — Anführungszeichen suchen die Wortfolge exakt. Das eignet sich auch als Ganzwort-Suche für ein einzelnes Wort: `"plan"` findet „Plan", aber nicht „Projektplan".
- `-begriff` — schließt Notizen aus, die den Begriff enthalten (auch mit Phrase: `-"alte Version"`).
- `path:ordner` — nur Dateien, deren Pfad den Text enthält (z. B. `path:Projekte`; mit Leerzeichen: `path:"Mein Ordner"`).
- `tag:name` — nur Notizen mit diesem Tag, inklusive Unter-Tags: `tag:projekt` findet auch `#projekt/intern`. `tag:#projekt` funktioniert ebenfalls.
- Operatoren lassen sich negieren (`-path:Archiv`, `-tag:erledigt`) und frei mit Suchbegriffen kombinieren: `plan tag:projekt -entwurf`.
- Mehrere Begriffe verknüpft die Suche mit UND. Sonderzeichen wie `- ( ) : *` in Suchbegriffen sind unproblematisch — Plainva behandelt die Eingabe wörtlich.

## Schnellwechsel (Quick Switcher)

`Strg+O` oder `Strg+K` öffnet den Schnellwechsel: tippen, mit den Pfeiltasten navigieren, mit `Enter` öffnen. Ohne Eingabe zeigt er die **Kürzlich geöffnet**-Liste — der schnellste Weg, zwischen Deinen aktuellen Notizen zu springen. Treffer lassen sich auch direkt in einem neuen Tab öffnen (die Fußzeile des Dialogs zeigt die jeweiligen Tasten).

Die Suche ist unscharf (Fuzzy): `prjplan` findet auch „Project Plan" — die Buchstaben müssen nur in der richtigen Reihenfolge vorkommen; Wortanfänge zählen mehr. Und wenn es die Notiz noch nicht gibt, zeigt die Liste **'…' erstellen**: `Enter` legt sie sofort an (im Vault-Stammordner) und öffnet sie — Name tippen, Enter, losschreiben.

Unter den Namens-Treffern erscheint zusätzlich die Gruppe **Inhalt**: Notizen, deren Text zur Eingabe passt, mit hervorgehobenem Fundstellen-Ausschnitt. Öffnest Du so einen Treffer, springt Plainva direkt zur Fundstelle in der Notiz — wie bei der Seitenleisten-Suche.

## Suchen & Ersetzen in der Notiz

`Strg+F` öffnet die Suchleiste des Editors (in der Live-Vorschau und im Quelltext-Modus):

- **Suchen** mit `Enter`/**weiter** und **zurück** durch die Treffer; **alle** hebt alle Fundstellen hervor.
- Optionen: **Groß/klein**, **ganzes Wort**, **Regex**.
- **Ersetzen**: einzelne Treffer **ersetzen** oder **alle ersetzen**.

### Im ganzen Vault

`Strg/Cmd+Umschalt+F` (oder **Im Vault suchen & ersetzen** in der Befehls-Palette) durchsucht alle Notizen auf einmal. Suchtext eingeben, **Suchen** drücken — die Treffer erscheinen nach Notiz gruppiert mit je einer Kontextzeile. Ersetzungstext eingeben, einzelne Notizen bei Bedarf abwählen, und **In N Notizen ersetzen** schreibt den Rest um — jede Notiz wird sicher zurückgeschrieben (atomarer Schreibvorgang + Versions-Schnappschuss), sodass eine veraltete Vorschau nie neueren Inhalt überschreibt. Groß/klein, ganzes Wort und Regex gelten auch hier; im Regex-Modus stehen `$1`/`$2`-Rückverweise in der Ersetzung zur Verfügung.

## Tags

Die Seitenleisten-Ansicht **Tags** listet alle `#tags` des Vaults mit Trefferzahl; ein Klick zeigt die **Dateien mit #tag**. Tags funktionieren im Text (`#projekt`) und im Frontmatter (`tags: [projekt]`). Das Suchfeld der Seitenleiste filtert die Tag-Liste mit.

**Ein Tag umbenennen** — im ganzen Vault: Rechtsklick auf ein Tag in der **Tags**-Ansicht und einen neuen Namen eingeben. Plainva schreibt das Tag überall um — in den Notiz-Texten (`#tag` und seine `#tag/kind`-Unter-Tags) und im Frontmatter (`tags:`) — und speichert jede betroffene Notiz über denselben sicheren Weg. Fremde Tags, die den Namen nur enthalten (etwa `#bereich/tag`), bleiben unangetastet.

## Navigation in der Notiz

Die **Gliederung** in der rechten Seitenleiste listet alle Überschriften der aktiven Notiz — ein Klick springt zur Stelle. Für Sprünge zwischen Notizen helfen außerdem **Backlinks** (wer verlinkt hierher) und die **Zurück**/**Vorwärts**-Knöpfe des Editors.

## Siehe auch

- [Tastenkürzel](Keyboard_Shortcuts.md)
- [Datenbanken (.base)](Databases_Base.md) — strukturierte Abfragen über Eigenschaften statt Volltext
