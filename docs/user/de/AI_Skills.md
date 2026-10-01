# Skills (Beta)

Stand: 2026-10-01

Ein Skill ist eine Anleitung für Arbeit, die wiederkommt: ein Meeting vorbereiten, die Aufgaben sortieren, ein Wochenrückblick. Plainva bringt zehn davon mit, und Du kannst eigene schreiben. Skills nutzen das offene Format Agent Skills — ein Ordner mit einer `SKILL.md` — und funktionieren deshalb auch in anderen KI-Apps, die das Format lesen.

## Einen Skill benutzen

Starte einen Skill mit einem Klick: als Chip in einem leeren Gespräch (die drei meistgenutzten), unter **Skills** im KI-Tab, am Telefon unter **Gespräche → Skills** oder aus der Befehlspalette. Das Gespräch läuft dann mit dem Skill: seine Anweisungen gehen mit, und er benutzt nur die Werkzeuge und Ordner, die er nennt.

Du kannst auch einfach fragen. In jedem Gespräch kennt die KI Namen und Beschreibungen Deiner aktiven Skills und lädt einen, wenn Deine Frage passt — „Bereite mein nächstes Meeting vor“ genügt.

## Die mitgelieferten Skills

| Skill | Was er tut |
|---|---|
| **Tagesorientierung** | Was heute wichtig ist: fällige Aufgaben, Termine und woran Du zuletzt gearbeitet hast. |
| **Wochenrückblick** | Die letzten sieben Tage und die Woche, die kommt, mit drei Vorschlägen. |
| **Projektstatus** | Ziel, Fortschritt, offene Punkte und der nächste Schritt eines Projekts. |
| **Meeting vorbereiten** | Bereitet ein Meeting aus früheren Notizen und offenen Punkten vor oder fasst es hinterher zusammen. |
| **Aufgaben sichten** | Ordnet Deine offenen Aufgaben: was jetzt, was warten kann, was weg kann. |
| **Schreiben und überarbeiten** | Fasst eine Notiz zusammen, kürzt sie oder schreibt sie um — als Text, den Du übernimmst. |
| **Wissen pflegen** | Findet Notizen, die dasselbe sagen, veraltet sind oder mit nichts verbunden. |
| **Links bereinigen** | Prüft die Links einer Notiz: ins Leere, fehlend, einseitig. |
| **Datenschutz prüfen** | Findet, was aus einer Notiz besser auf diesem Gerät bleibt, und schlägt eine Regel vor. |
| **Reflexion** | Blickt mit Dir auf die Notizen eines Tages oder einer Woche zurück — freundlich, nie eine Diagnose. |

Alle lesen nur: keiner ändert eine Notiz, sendet etwas oder geht ins Internet. Datenschutz prüfen und Reflexion sind für ein Modell auf diesem Gerät gedacht; mit einem Cloud-Modell sagt die Sende-Übersicht das. Jeden Skill schaltest Du unter **Skills** aus — der Schalter gilt für diesen Vault auf diesem Gerät. **Eigene Fassung anlegen** kopiert einen in Deinen Vault, wo Du ihn ändern kannst.

## Eigene Skills

**Neuer Skill** fragt nach einem Namen, einer Beschreibung — daran wählt die KI den Skill — und den Anweisungen. Plainva schreibt sie als `.agent/skills/<name>/SKILL.md` in Deinen Vault, wo sie wie jede Notiz mitreisen. **Bearbeiten** öffnet die Datei wie eine Notiz.

**Importieren …** nimmt einen Skill als `.zip`- oder `.skill`-Datei. Bevor etwas geschrieben wird, prüft Plainva ihn: genau ein Skill im Format, kein Pfad außerhalb seines Ordners, die Größengrenzen. Es nennt die Lizenz, Skripte, die es nicht ausführt, und Werkzeuge, die es nicht hat.

## Nichts läuft, bevor Du es freigibst

Ein Skill in Deinem Vault, der neu ist oder sich geändert hat — per Sync, durch einen Import oder eine Bearbeitung auf diesem oder einem anderen Gerät —, läuft erst, wenn Du ihn **auf diesem Gerät** freigibst. Solche Skills warten oben unter **Skills** bei **Warten auf Deine Freigabe** und in **Einstellungen → KI & Automatisierung** (Teil Vault). **Prüfen und freigeben** zeigt, was der Skill darf, was sich seit Deiner letzten Freigabe geändert hat, seine Anweisungen, Dateien und wo er liegt. Die Freigabe gilt genau dieser Fassung; jede Änderung hebt sie wieder auf. Freigaben liegen auf diesem Gerät, nie im Vault.

Dasselbe gilt für eine `AGENTS.md` oben in Deinem Vault: freigegeben, gehen ihre stehenden Anweisungen in jedes neue Gespräch. Weder ein Skill noch die `AGENTS.md` kann Deine Datenschutzregeln aufheben, und ein Skill bekommt nie mehr, als ein Gespräch hat — er kann es nur enger machen.

## Was an den Anbieter geht

Die Sende-Übersicht nennt unter **Anweisungen**, was mitgeht: den Skill des Gesprächs, die Liste der Skills, die die KI laden darf, und die `AGENTS.md`. Gehen Anweisungen aus Deinem Vault zum ersten Mal an eine Cloud, kommt die Übersicht wieder. Unsichtbare Zeichen in einem Skill erreichen nie ein Modell.

## Grenzen der Beta

Skills führen keine Skripte aus, und Skills, die das Web oder Deine Mail brauchen, kommen später. Deine eigenen Skills werden KI-Apps, die über den MCP-Server verbunden sind, nicht angeboten; nur die mitgelieferten.
