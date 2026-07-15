# Aufgaben

Stand: 2026-07-15

Die Aufgabenansicht sammelt jede Checkbox Deines Vaults an einem Ort: alle `- [ ]`- und `- [x]`-Listeneinträge über alle Notizen hinweg, gruppiert nach der Notiz, in der sie stehen. Sie ist die „Was habe ich noch zu tun?"-Ansicht über reines Markdown — kein Plugin, keine Sonderdatei.

## Warum eine eigene Ansicht (und keine `.base`)

Eine [Datenbank (`.base`)](Databases_Base.md) arbeitet auf ganzen Notizen — eine Zeile pro Notiz. Eine Checkbox ist eine einzelne *Zeile* innerhalb einer Notiz, und eine Notiz kann viele davon enthalten, deshalb kann eine `.base` sie nicht auflisten. Die Aufgabenansicht ist zeilenbasiert: Sie liest die Aufgabenzeilen direkt, sodass eine einzelne Projektnotiz mit zehn Unteraufgaben alle zehn zeigt.

## Aufgabenansicht öffnen

- Klicke auf das **Checklisten-Symbol** in der Aktionsleiste ganz links, oder
- öffne die **Befehls-Palette** (`Strg/Cmd+P`) und führe **Aufgaben öffnen** aus.

Sie öffnet sich als Tab, wie jede Notiz.

## Die Liste lesen

Aufgaben sind nach Notiz gruppiert; der Notiztitel ist eine Überschrift, die Du anklicken kannst, um die Notiz zu öffnen. Jede Aufgabe zeigt ihre Checkbox und ihren Text, durchgestrichen, sobald sie erledigt ist. Eine **Fälligkeit**, die als `📅 2026-08-01` in der Aufgabenzeile steht, erscheint als kleines Abzeichen.

## Filtern

Die Leiste oben grenzt die Liste ein:

- **Offen / Erledigt / Alle** — nach Checkbox-Zustand (startet bei **Offen**).
- **Aufgaben filtern…** — Freitext; passt auf den Aufgabentext.
- **Alle Ordner** — nur Aufgaben im gewählten Ordner (und seinen Unterordnern).
- **Alle Tags** — nur Aufgaben mit einem gewählten Inline-`#tag`.
- **Nur mit Fälligkeit** — nur Aufgaben mit einem `📅`-Datum.

Tags und Fälligkeiten werden direkt aus der Aufgabenzeile gelesen — zum Beispiel `- [ ] Rechnung bezahlen #finanzen 📅 2026-08-01`.

## Aufgaben abhaken

Klicke auf die **Checkbox** einer Aufgabe, um sie zwischen offen und erledigt umzuschalten. Die Änderung wird direkt in die Notiz zurückgeschrieben (als normaler, sicherer Dateischreibvorgang — nur das einzelne `[ ]`/`[x]`-Zeichen ändert sich), sodass die Notiz, Obsidian und jede Synchronisation im Gleichschritt bleiben. Klicke stattdessen auf den **Text** der Aufgabe, um die Notiz zu öffnen und zu dieser Zeile zu springen.

Hat sich eine Notiz seit dem Aufbau der Liste geändert, wird ein veraltetes Umschalten übersprungen und die Liste aktualisiert — mit dem **Aktualisieren**-Knopf oben rechts kannst Du jederzeit neu laden.

## Obsidian-Kompatibilität

Aufgaben sind gewöhnliche GFM-Checkboxen (GitHub Flavored Markdown). Plainva fügt nie eine Sondersyntax hinzu: Dieselben `- [ ]`-Zeilen werden in Obsidian als Checkboxen dargestellt und lesen sich in jedem Editor sauber. Die Konventionen `📅 Datum` und `#tag` sind der übliche Obsidian-Tasks-Stil, aber sie sind nur Text in Deiner Notiz.

## Siehe auch

- [Notizen & Markdown](Notes_and_Markdown.md) — Aufgabenlisten im Editor schreiben
- [Suche](Search.md) — Volltextsuche über den Vault
- [Datenbanken (.base)](Databases_Base.md) — Datenbanken auf Notiz-Ebene
