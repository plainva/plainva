# OKF — Open Knowledge Format

Stand: 2026-07-07

OKF (Open Knowledge Format) ist eine offene Konvention für Markdown-Wissenssammlungen: reine Markdown-Dateien mit einem kleinen, einheitlichen Frontmatter-Kopf. Diese Seite erklärt, was OKF ist, was Plainva dafür automatisch tut — und warum Du nichts davon nutzen *musst*.

## Was ist OKF?

Die Idee: Jedes Dokument im Vault sagt selbst, was es ist. Dafür genügt ein Minimalkopf im Frontmatter:

```markdown
---
type: Note
okf_version: "0.1"
---
# Meine Notiz
```

- **`type`** — welche Art Dokument das ist (z. B. `Note`, `Daily Note`, `Projekt`). Das einzige Pflichtfeld der Konvention.
- **`okf_version`** — die Version der Konvention, nach der die Datei geschrieben wurde.
- **`index.md`** — pro Ordner darf eine `index.md` als Inhaltsverzeichnis liegen; die Namen `index.md` und `log.md` sind dafür reserviert und sollten nicht für normale Notizen verwendet werden.

> Schreibst Du Dateien mit einem Werkzeug oder Skript? Der genaue Feldvertrag — erlaubte Werte, wie jeder Eigenschaftstyp serialisiert wird und die Reservname-Regeln — steht in der [Dateiformat-Referenz](File_Format_Reference.md).

## Warum nutzt Plainva OKF?

Reines Markdown ist wunderbar portabel — hat für sich genommen aber keine verlässliche Struktur. OKF ergänzt genau so viel davon wie nötig, und alles bleibt gewöhnliches Markdown mit Standard-Frontmatter:

- **Datenbanken, Filter und Vorlagen können sich auf Struktur verlassen.** Jede Notiz trägt einen `type` — so bleiben `.base`-Ansichten über reine Dateien robust.
- **Ordner bleiben navigierbar.** Eine `index.md` als Inhaltsverzeichnis pro Ordner funktioniert für Menschen wie für Werkzeuge.
- **Skripte und KI-Assistenten können sicher mit Deinem Vault arbeiten**, weil das Format auf der Platte einheitlich und dokumentiert ist.
- **Kein Lock-in.** OKF ist eine offene Konvention über reinem Markdown — auch andere OKF-Werkzeuge verstehen Deine Dateien, heute und in zehn Jahren.

## Was Plainva automatisch macht

**Neue Dateien** bekommen den OKF-Kopf automatisch: Jede in Plainva angelegte Notiz erhält `type` und `okf_version` ins Frontmatter. Welche Werte, stellst Du pro Vault ein: **Einstellungen → Vault Einstellungen → OKF (Open Knowledge Format)** → **type für neue Notizen** (Standard `Note`) und **type für Daily Notes** (Standard `Daily Note`). Bringt eine Vorlage ein eigenes `type` mit, gewinnt die Vorlage.

**Bestehende Dateien werden nie ungefragt verändert.** Plainva ergänzt OKF-Felder nur beim Anlegen neuer Dateien oder wenn Du die Konvertierung ausdrücklich startest.

**Geschützte Systemfelder:** Im **Eigenschaften**-Panel sind `type` und `okf_version` als OKF-Systemfelder gekennzeichnet („OKF-Systemfeld – wird von Plainva verwaltet"): Der `type`-Wert ist per Dropdown bekannter Typen wählbar, `okf_version` ist reine Anzeige; Umbenennen, Typwechsel und Löschen sind gesperrt, damit die Konvention nicht versehentlich bricht.

**Das Erklärmodal:** Beim ersten Öffnen eines Vaults zeigt Plainva einmalig **Was ist OKF?** — dieselbe Kurzfassung findest Du jederzeit in den Einstellungen.

## index.md: das Inhaltsverzeichnis je Ordner

Eine `index.md` ist das Inhaltsverzeichnis eines Ordners: eine Liste der enthaltenen Notizen und Unterordner mit Beschreibungen und relativen Links.

- **Erzeugen** — immer auf Deine Aktion hin, nie automatisch aus dem Nichts: Rechtsklick auf einen Ordner → **index.md erzeugen/aktualisieren**, oder gesammelt über die **index.md-Verwaltung** (**Einstellungen → OKF → Öffnen…**).
- **Übernehmen statt erzeugen** — hast Du bereits Überblicksnotizen (MOC, Übersicht, Folder-Note, README …), schlägt die Verwaltung sie als Kandidaten vor. **Übernehmen** benennt die Datei zu `index.md` um (Links werden vault-weit aktualisiert) und kann sie optional OKF-konform aufbereiten.
- **Automatische Pflege** — von Plainva *erzeugte* Listings tragen am Dateiende eine unsichtbare Markierung (ein HTML-Kommentar). Nur solche markierten Dateien hält Plainva automatisch aktuell, sobald sich im Ordner etwas ändert — und nur in OKF-Vaults (erkennbar an `okf_version` in der Wurzel-`index.md`).
- **Schreibgeschützt mit Ausweg** — verwaltete index.md-Dateien öffnen im Lesemodus mit dem Banner „Diese index.md wird von Plainva verwaltet und automatisch aktualisiert." Dort kannst Du **Aktualisieren** — oder **Trotzdem bearbeiten**: Das entfernt die Markierung, und die Datei gehört wieder ganz Dir (keine automatischen Updates mehr).
- **Alle auf einmal** — **Alle index.md aktualisieren** gibt es im Kontextmenü des Vault-Stamms und in den Einstellungen; Dateien ohne Markierung werden dabei übersprungen.
- In der Leseansicht erscheinen verwaltete Listings als Karten mit Datei-/Ordner-Icons; Links öffnen direkt in Plainva.

## Einen bestehenden Vault konvertieren (Opt-in)

Wenn Dateien im Vault nicht dem OKF-Format entsprechen (fehlendes `type`-Feld oder reservierte Namen als normale Notiz), bietet Plainva die Konvertierung an — einmalig beim Öffnen des Vaults und dauerhaft unter **Einstellungen → OKF → OKF-Konvertierung** (der Eintrag erscheint nur, solange es etwas zu tun gibt).

Der Wizard **In OKF-Format überführen** arbeitet in klaren Schritten:

1. **Scan** — zeigt, wie viele Dateien betroffen sind (Vorlagen- und Systemordner sind ausgenommen; Dateien mit unlesbarem Frontmatter werden übersprungen, nie „repariert").
2. **Entscheidungen** — Standard-`type` für Dateien ohne `type`; bestehende `type`-Werte kannst Du **übernehmen** (empfohlen — sie sind bereits gültige OKF-Typen) oder in ein anderes Feld umbenennen lassen.
3. **Vorschau (ohne Änderungen)** — ein Dry-Run zeigt vorab, was sich ändern würde.
4. **Konvertieren** — vor jeder Änderung wird die Datei nach `.plainva/backups/` gesichert; ein Bericht fasst Geändertes, Übersprungenes und den Backup-Ordner zusammen. Danach geht es optional **weiter zur index.md-Verwaltung**.

Tipp aus dem Wizard: Die Änderungen laufen normal durch die Synchronisation — bei Git-Vaults vorher committen.

## Muss ich OKF nutzen?

Nein. OKF ist ein sanfter Standard:

- Neue Dateien bekommen den Kopf automatisch — das stört nirgends und kostet nichts.
- Bestehende Vaults (z. B. aus Obsidian) funktionieren unverändert weiter; die Konvertierung ist strikt Opt-in.
- Ein fehlendes `okf_version` allein gilt nicht als Verstoß — Du kannst Plainva und Obsidian dauerhaft parallel nutzen, ohne Dauer-Hinweise.
- Obsidian und jeder andere Editor können alle Dateien weiterhin öffnen: Es ist und bleibt normales Markdown.

## Siehe auch

- [Dateiformat-Referenz](File_Format_Reference.md) — der genaue Formatvertrag für jede Vault-Datei
- [Notizen & Markdown](Notes_and_Markdown.md) — Frontmatter und Eigenschaften
- [Datenbanken (.base)](Databases_Base.md) — was ein einheitlicher `type` praktisch bringt
- [FAQ & Fehlerbehebung](FAQ.md) — u. a. Backups und schreibgeschützte index.md
