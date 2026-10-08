# Skripte (Beta)

Stand: 2026-10-08

Ein Skript ist ein kleines Programm für das, was ein Modell schlecht kann und ein Programm jedes Mal gleich macht: zählen, sortieren, vergleichen, zusammenrechnen. Du schreibst es in JavaScript. Es läuft in einem geschlossenen Kasten in Plainva: es kann keine Datei öffnen, nicht ins Netz und nicht auf später warten. Es ruft nur die Werkzeuge auf, die Du ihm angekreuzt hast: sie lesen Deinen Vault so, wie die Werkzeuge der KI es tun, oder hinterlassen einen Vorschlag, über den Du entscheidest. Von sich aus ändert ein Skript nichts.

## Ein Skript ausführen

Deine Skripte stehen unter **Skills** im KI-Tab — am Telefon unter **Gespräche → Skills** — in der Gruppe **Skripte**. **Ausführen** öffnet das Skript: trag ein, wonach es fragt, und drück **Ausführen**. Während es läuft, siehst Du jedes Werkzeug, das es aufruft, und **Stopp** beendet es. Danach zeigt der Dialog die **Aufrufe**, das **Ergebnis** — das Du kopieren kannst — und das **Protokoll**, dazu, was der Lauf von seinen Grenzen verbraucht hat.

Ein Lauf, den Du hier startest, bleibt auf diesem Gerät: nichts davon geht an ein Modell, deshalb liest er auch Notizen, die Du von der Cloud fernhältst. **Probelauf** ruft die Werkzeuge auf, die lesen, und schreibt einen Aufruf, der in der App etwas zeigen oder einen Vorschlag hinterlassen würde, nur auf.

## In einem Gespräch

In einem gewöhnlichen Gespräch kann die KI Deine aktiven Skripte finden und eines ausführen, wenn es passt; der Schritt heißt dann **Führt das Skript „word-count“ aus**. Das Skript liest nur, was dieses Gespräch lesen darf: eine Notiz, die Du von der Cloud fernhältst, bleibt fern, und jede Notiz, die das Skript liest, zählt zu dem, was der Lauf gelesen hat. Was es zurückgibt, geht als Daten an das Modell, nie als Anweisung. Einem Gespräch, das mit einem Skill gestartet wurde, werden keine Skripte angeboten, und einer KI-App, die über den MCP-Server verbunden ist, auch nicht.

## Änderungen vorschlagen

Ein Skript kann auch Werkzeuge bekommen, die vorschlagen. Die Werkzeuge **Schlägt Änderungen an einer Notiz vor** und **Schlägt einen Eigenschaftswert vor** hinterlassen einen Vorschlag am Rand einer Notiz; **Entwirft eine Notiz**, **Entwirft einen Datenbank-Eintrag**, **Entwirft eine Aufgabe** und **Entwirft einen Journal-Eintrag** hinterlassen einen Entwurf. Beides trägt den Namen des Skripts, und in Deinem Vault ändert sich nichts, bevor Du einen Vorschlag übernimmst oder einen Entwurf anlegst — genau wie bei einem Vorschlag der KI. Nach einem Lauf führt der Dialog sie unter **Vorschläge und Entwürfe** auf; ein Lauf, der mit **Probelauf** gestartet wurde, hinterlässt nichts.

Was ein Skript gelesen hat, entscheidet, wo es schreiben darf: einen Vorschlag oder einen Entwurf, der auf einer Notiz beruht, die Du von der Cloud fernhältst, nimmt nur ein Ort an, für den dieselbe Regel gilt. In einem Gespräch wird der KI ein Skript, das vorschlägt, nur angeboten, wo das Gespräch selbst vorschlagen kann, und was das Skript dort hinterlässt, trägt den Namen des Modells dieses Gesprächs.

## Ein Skript schreiben

**Neues Skript** fragt nach:

- **Name** — Kleinbuchstaben, Ziffern und Bindestriche; er wird der Ordner.
- **Beschreibung** — wofür das Skript ist; daran erkennst Du es, und die KI auch.
- **Werkzeuge** — kreuz an, was das Skript aufrufen darf: unter **Lesen**, was liest, unter **Vorschlagen**, was einen Vorschlag oder einen Entwurf hinterlässt. Etwas anderes gibt es für es nicht.
- **Eingaben** — wonach das Skript beim Start fragt: ein Name, ob es Text, eine Zahl oder Ja oder Nein ist, und ob es Pflicht ist.
- **Grenzen** — Sekunden Rechenzeit, Aufrufe von Werkzeugen und Speicher.
- **Code** — das Programm.

**Anlegen und freigeben** schreibt das Skript als `.agent/scripts/<name>/` in Deinen Vault — eine `manifest.json` und eine `main.js` — und gibt es auf diesem Gerät frei. **Bearbeiten** im Menü eines Skripts öffnet dasselbe Formular; **Speichern und freigeben** ersetzt die Dateien.

Der Code ist der Rumpf einer Funktion. `input` enthält die Eingaben unter ihrem Namen, `tools.<name>(…)` ruft ein Werkzeug auf und wird mit `await` abgewartet, `return` gibt das Ergebnis zurück, und `console.log(…)` schreibt eine Zeile ins Protokoll:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

Die Sprache ist JavaScript auf dem Stand von ES2020. Es gibt kein `fetch`, keinen Timer, kein `import` und keinen Zugriff auf Dateien, und was ein Skript zurückgibt, muss sich als JSON schreiben lassen. Ein Werkzeug, das ablehnt — eine Notiz, die es nicht gibt, eine Notiz, die das Gespräch nicht lesen darf —, wirft einen Fehler, den das Skript abfangen kann.

## Was ein Werkzeug zurückgibt

**Was ein Werkzeug zurückgibt** im Formular öffnet diese Seite. Jedes Werkzeug nimmt ein Objekt und gibt eines zurück; `cursor` nimmt das `next` des Aufrufs davor und setzt dessen Liste fort.

| Werkzeug | Du übergibst | Du bekommst |
|---|---|---|
| `search_vault` — **Durchsucht den Vault** | `query`; wahlweise `folder`, `limit` (bis 25), `cursor` | `results`: eine Liste aus `{ title, path, snippet }`; `next` |
| `read_note` — **Liest eine Notiz** | `path`; wahlweise `section`, `maxChars` (200 bis 20.000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Liest die Gliederung** | `path` | `path`; `properties`: Name und Wert; `sections`: eine Liste aus `{ level, text, section }` |
| `query_base` — **Liest eine Datenbank** | `base`, der Pfad der `.base`-Datei; wahlweise `view`, `limit` (bis 50), `cursor` | `base`, `view`, `views`; `rows`: eine Liste aus `{ title, path, properties }`; `next` |
| `get_tasks` — **Liest Aufgaben** | wahlweise `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (bis 50), `cursor` | `tasks`: eine Liste aus `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Liest Backlinks** | `path`; wahlweise `limit` (bis 50), `cursor` | `path`; `notes`: eine Liste aus `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Folgt Links** | `path`; wahlweise `depth` (1 oder 2), `limit` (bis 50) | `path`; `notes`: eine Liste aus `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Sieht zuletzt benutzte Notizen an** | wahlweise `kind` (`opened` oder `edited`), `limit` (bis 20) | `kind`; `notes`: eine Liste aus `{ title, path, at }` |
| `get_calendar` — **Liest Termine** | `from` und `to` als `YYYY-MM-DD`; wahlweise `details`, `limit` (bis 100) | `events`: eine Liste aus `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Bedient die App** | `id`, ein Befehl der App wie `open-note`, `show-in-graph` oder `open-calendar`; wahlweise `args` mit `path`, `section` oder `date` | `done`, `command` |
| `propose_edit` — **Schlägt Änderungen an einer Notiz vor** | `path`; `edits`, eine Liste aus `{ find, replace }`, oder `append`; wahlweise `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Schlägt einen Eigenschaftswert vor** | `path`, `key`, `value`; wahlweise `note` | `proposed`, `path`, `property` |
| `create_note` — **Entwirft eine Notiz** | `title`, `content`; wahlweise `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Entwirft einen Datenbank-Eintrag** | `base`, `title`; wahlweise `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Entwirft eine Aufgabe** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Entwirft einen Journal-Eintrag** | `text`; wahlweise `task` | `drafted`, `kind` |

## Grenzen

Ein Skript trägt seine Grenzen in seinem Manifest. Drei davon setzt das Formular:

| Grenze | Vorgabe | Bereich |
|---|---|---|
| **Sekunden Rechenzeit** | 5 | 1 bis 30 |
| **Aufrufe von Werkzeugen** | 20 | 0 bis 50 |
| **Speicher in MB** | 32 | 8 bis 128 |

Es zählt nur die Zeit, in der ein Skript rechnet, nicht die Zeit, die ein Werkzeug braucht. Ein Skript, das eine Grenze überschreitet, wird beendet, der Dialog sagt, welche Grenze es war, und ein beendetes Skript gibt nichts zurück. Die Argumente eines Aufrufs und das Ergebnis dürfen je höchstens 64 KB groß sein.

## Nichts läuft, bevor Du es freigibst

Ein Skript, das neu oder geändert ist — durch den Sync, oder von einem anderen Programm geschrieben —, läuft nicht, bis Du es **auf diesem Gerät** freigibst. Es wartet oben unter **Skills** bei **Warten auf Deine Freigabe**. **Prüfen und freigeben** zeigt **Was es darf**, seine **Grenzen**, seine **Eingabe** und den ganzen **Code**, und sagt, ob sich der Code als JavaScript lesen lässt; Code, bei dem das nicht geht, wird nicht freigegeben.

Mit **Freigeben** unterschreibt dieses Gerät genau diese Dateien. Der Schlüssel dafür entsteht auf diesem Gerät und liegt in seinem Schlüsselbund. Jede Änderung an einer Datei hebt die Freigabe auf, und auf jedem Deiner anderen Geräte wartet das Skript auf eine eigene Freigabe — eine Freigabe lässt sich nicht von einem Gerät auf ein anderes mitnehmen. **Freigabe zurückziehen** im Menü eines Skripts nimmt sie zurück, und **Code ansehen** zeigt die Prüfung noch einmal.

## Grenzen der Beta

Ein Skript schlägt vor und entwirft; es benennt, verschiebt oder löscht nie eine Notiz, und es schreibt keine E-Mail und keinen Termin. Ein Skill kann kein Skript starten, und der eigene Ordner `scripts/` eines Skills wird nicht ausgeführt. E-Mails, das Internet und die Werkzeuge externer Server stehen Skripten nicht zur Verfügung.
