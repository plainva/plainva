# Automatisierung & Skripte

Stand: 2026-07-15

Plainva hat kein Plugin-System, das fremden Code ausführt. Stattdessen ist der Vault selbst die Erweiterungs-Schnittstelle: Deine Notizen sind reines Markdown, Datenbanken sind reines YAML (`.base`), und die [OKF-Konventionen](OKF.md) geben jeder Datei eine vorhersagbare Struktur. Alles, was Dateien lesen und schreiben kann — ein Shell-Skript, ein Python-Programm, ein CLI-Werkzeug, ein geplanter Job oder ein KI-Agent — kann Deinen Vault erweitern, erzeugen oder umbauen, ganz ohne eine Plainva-spezifische API.

Diese Seite erklärt, wie das **sicher** geht. Das genaue Byte-Format jeder Datei steht separat in der [Dateiformat-Referenz](File_Format_Reference.md); diese Seite ist der praktische Begleiter: die Regeln, der Ablauf und was Du einer KI mitgibst.

## Warum Dateien statt einer Plugin-Sandbox

- **Sicherheit.** Ein Code-Plugin-System führt fremde Programme in Deinem Editor aus, mit Zugriff auf Deine Notizen. Reine Dateien brauchen dieses Vertrauen nicht: Ein Skript berührt nur den Ordner, auf den Du es ansetzt, mit den normalen Rechten Deines Betriebssystems.
- **Langlebigkeit.** Das Format überlebt die App. Eine Markdown-Datei, die Du vor fünf Jahren per Skript erzeugt hast, öffnet heute noch — in Plainva, in Obsidian, in jedem Texteditor. Es gibt keine Plugin-API, die veralten könnte.
- **Das Format ist der Vertrag.** Weil das Dateiformat offen und dokumentiert ist, ist die „API" stabil und einsehbar. Du kannst sie diffen, in Git versionieren und über sie nachdenken.

Wenn Du etwas möchtest, das Plainva nicht von Haus aus kann, wartest Du nicht auf ein Plugin — Du schreibst ein kleines Skript gegen die Dateien.

## Einen Vault sicher lesen

Alles ist UTF-8-Text:

- **Notizen (`.md`)** — ein optionaler YAML-Frontmatter-Block (zwischen zwei `---`-Zeilen ganz oben) trägt die Eigenschaften; darunter folgt der Markdown-Text. Den Frontmatter parst Du mit einer beliebigen YAML-Bibliothek.
- **Datenbanken (`.base`)** — reines YAML, das Ansichten über Notizen beschreibt. Die *Werte* stehen nie in der `.base`; sie liegen im Frontmatter der Notizen.
- **Struktur** — Tags sind `#tag` im Text oder `tags:` im Frontmatter; Links sind `[[Notiz]]` (Wiki-Links) oder `[Text](pfad.md)`. Aufgaben sind Listeneinträge `- [ ]` / `- [x]`.

Lesen braucht nie besondere Vorsicht — Textdateien können durch bloßes Lesen nicht „beschädigt" werden. Die Regeln unten drehen sich alle ums *Schreiben*.

## Einen Vault sicher schreiben

Hältst Du diese Regeln ein, übernehmen Plainva (und Obsidian) Deine Änderungen sauber. Plainva überwacht den Vault-Ordner: Ein externer Schreibvorgang wird automatisch erkannt und neu indexiert, meist innerhalb einer Sekunde.

1. **Schreibe UTF-8 ohne BOM, mit LF-Zeilenenden.** Windows-Werkzeuge, die standardmäßig UTF-16 oder CRLF schreiben, erzeugen Dateien, die Plainva bei jedem Sync als geändert behandelt.
2. **Schreibe atomar.** Schreibe in eine temporäre Datei im selben Ordner und benenne sie dann über das Ziel um. Eine halb geschriebene Notiz (etwa nach einem Absturz) ist schlimmer als keine Änderung. Plainva selbst schreibt jede Notiz so.
3. **Bewahre OKF-Frontmatter und unbekannte Schlüssel.** Behalte `type` und `okf_version`, wenn Du eine Notiz neu schreibst, und wirf nie Frontmatter-Schlüssel weg, die Du nicht kennst — reiche sie unverändert durch. „Räume" keine Schlüssel auf, die Du nicht verstehst.
4. **Fass `.plainva/` nie an.** Dieser Ordner enthält Plainvas gerätelokalen Index, Backups, Graph-Pins und Sync-Status. Er ist nicht Teil Deiner Inhalte und darf von Deinen Skripten nie geschrieben, synchronisiert oder nach Git committet werden.
5. **Halte die `.base`-Regeln ein.** Eine `.base` nutzt nur Obsidians vier Top-Level-Schlüssel (`filters`, `formulas`, `properties`, `views`); jede Ansicht braucht einen `name`; Filter sind einwurzelig. Alle Plainva-spezifischen Daten liegen unter verschachtelten `plainva:`-Unterschlüsseln. Die [Dateiformat-Referenz](File_Format_Reference.md#databases-base) enthält den vollständigen Vertrag inklusive eines zweiseitigen Relations-Beispiels.
6. **Streite nicht mit dem Editor.** Wenn eine Notiz in Plainva geöffnet ist *und* ungespeicherte Änderungen hat, schreibe sie nicht im selben Moment per Skript neu. Plainva hat als Sicherheitsnetz einen Konflikt-Auflöser, aber der sauberste Weg ist, die App zuerst speichern zu lassen (oder Notizen zu bearbeiten, die gerade nicht offen sind).

## Muster

Ein paar häufige Aufgaben, alle nur Dateioperationen:

- **Notizen in Serie anlegen** — `.md`-Dateien mit einem OKF-Frontmatter-Block (`type`, `okf_version`, dazu Deine eigenen Eigenschaften) und einem Markdown-Text erzeugen. Plainva indexiert sie, sobald sie erscheinen.
- **Tagesnotiz- oder Report-Generatoren** — ein geplantes Skript, das eine datierte Notiz in Deinen Tagesnotizen-Ordner schreibt, gefüllt aus einer anderen Quelle.
- **Eigenschafts-Durchläufe** — den Frontmatter jeder Notiz lesen, ein Feld umformen, zurückschreiben (atomar, unbekannte Schlüssel bewahrend).
- **Export / Veröffentlichung** — den Vault lesen und nach HTML, einer statischen Website oder einem PDF rendern. Nur Lesen — keine Regeln zu beachten.
- **Link-Pflege** — `[[Notiz]]`-Links und `tags:` neu durchsuchen und einen Bericht erzeugen oder direkt reparieren.

Halte Skripte möglichst idempotent: Zweimaliges Ausführen darf keine Inhalte verdoppeln.

## Den Vault einer KI übergeben

Ein KI-Agent mit Lese-/Schreibzugriff auf einen Vault-Ordner ist genau der Fall, für den dieses Design gebaut ist. Damit er korrekt arbeitet:

1. **Gib ihm die [Dateiformat-Referenz](File_Format_Reference.md).** Sie ist für einen maschinellen Leser geschrieben: der OKF-Frontmatter-Vertrag, die Eigenschaft→YAML-Serialisierung, das vollständige `.base`-Schema mit seinen harten Obsidian-Regeln, der `index.md`-Vertrag und die Sicherheitsregeln — alles, was ein Agent braucht, um Dateien zu bearbeiten, ohne sie zu zerstören.
2. **Setz ihn auf den Vault-Ordner an, nicht auf `.plainva/`.** Sag klar, dass `.plainva/` tabu ist.
3. **Verlange atomare, minimale Änderungen.** Ein Agent, der eine ganze Notiz neu schreibt, um eine Eigenschaft zu ändern, sollte den Rest von Frontmatter und Text wortgetreu bewahren.

Weil der Vertrag ein Dokument ist und keine laufende API, funktionieren dieselben Anweisungen mit jeder KI, offline wie online.

## Sicherheit in Kürze

- UTF-8, kein BOM, LF.
- Atomar schreiben (temporäre Datei + Umbenennen).
- `type`, `okf_version` und unbekannte Schlüssel bewahren.
- Nie in `.plainva/` schreiben.
- `.base`: vier Top-Level-Schlüssel, benannte Ansichten, einwurzelige Filter, `plainva:`-Unterschlüssel für alles andere.
- Der Vault wird überwacht — externe Änderungen erscheinen automatisch in Plainva.

## Siehe auch

- [Dateiformat-Referenz](File_Format_Reference.md) — das genaue Dateiformat jeder Datei
- [OKF](OKF.md) — das Open Knowledge Format, das den Dateien ihre vorhersagbare Struktur gibt
- [Datenbanken (.base)](Databases_Base.md) — wie `.base`-Ansichten funktionieren
