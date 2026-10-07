# KI-Apps verbinden (Beta)

Stand: 2026-10-07

KI-Apps auf Deinem Rechner — Claude Code, Claude Desktop, Cursor, VS Code und andere, die das Model Context Protocol (MCP) sprechen — können Deinen Vault über Plainva lesen: ihn durchsuchen, Notizen und ihre Abschnitte lesen, Gliederungen, Backlinks, Datenbanken, Aufgaben und zuletzt benutzte Notizen, und eine Notiz in Plainva öffnen. Von sich aus ändern sie nichts: eine App, der Du es erlaubst, darf Änderungen vorschlagen, und die warten, bis Du entscheidest (siehe unten). Das gehört zu den experimentellen KI-Funktionen und geht nur am Desktop.

Die Gegenrichtung — Plainvas Assistent nutzt Werkzeuge von Servern, die Du selbst anbindest — steht unter **Externe Werkzeuge (MCP)** im [KI-Assistenten](AI_Assistant.md).

Ein dritter Weg — Plainva startet den KI-Agenten eines anderen Herstellers im Ordner des Vaults, mit seiner Sitzung im KI-Tab — steht unter [Externe Agenten](External_Agents.md).

## So funktioniert es

Plainva bringt neben der App ein kleines Hilfsprogramm mit, `plainva-mcp`. Eine KI-App startet es, und das Hilfsprogramm verbindet sich über einen privaten Kanal dieses Rechners mit dem laufenden Plainva — eine Named Pipe unter Windows, ein Socket in einem privaten Ordner unter macOS und Linux. Ein Netzwerk-Port wird nie geöffnet. Plainva muss mit dem Vault geöffnet laufen; sonst bekommt die App eine klare Meldung.

## Einschalten

1. Öffne **Einstellungen → KI & Automatisierung** und schalte **KI auf diesem Gerät nutzen** ein.
2. Schalte **KI-Apps auf diesem Rechner diesen Vault lesen lassen** ein.
3. Richte die App ein (siehe unten). Beim ersten Verbinden fragt Plainva, welche App es ist, welches Programm sie gestartet hat und welche Ordner sie lesen darf. Nichts ist vorausgewählt: wähle Ordner oder **Der ganze Vault**, dann **Erlauben**. **Ablehnen** weist die App ab, und Plainva fragt zehn Minuten lang nicht erneut nach ihr. Unter den Ordnern steht **Darf Änderungen vorschlagen** — aus, solange Du den Haken nicht setzt; was er erlaubt, steht weiter unten.

Die App bewahrt für das nächste Mal ein Geheimnis im Schlüsselbund des Systems auf. Ordner gelten je App und je Vault: in einem anderen Vault fragt die App erneut.

## Eine App einrichten

- **Claude Code:** kopiere den **Befehl für Claude Code** aus den Einstellungen und führe ihn in einem Terminal aus.
- **Claude Desktop:** **Paket erstellen …** schreibt eine Datei `plainva.mcpb`; öffne sie, und Claude Desktop installiert Plainva.
- **Andere Apps (JSON):** kopiere die Konfiguration und trage sie in die MCP-Einstellungen der App ein, etwa in die `mcp.json` von Cursor.

## Was eine App sieht

Nur die Ordner, die Du erlaubt hast, und nur, was Deine Datenschutzregeln an ein Cloud-Modell gehen lassen, das ins Internet kann — als ein solches gilt eine App, denn Plainva sieht nicht, was sie mit dem Gelesenen tut: Notizen mit `cloud: deny` oder `web: deny` oder in einem Ordner mit einer dieser Regeln gibt es für eine App nicht — weder ihren Text noch ihre Titel —, Links auf sie werden zurückgehalten, und Ortsangaben aus dem Journal gehen nie mit. Plainvas eigene Ordner (`.plainva`, `.agent`) und die Regeln selbst sind nie lesbar. Jeder Pfad in einer Anfrage und in einer Antwort wird zweimal geprüft: im App-Fenster und im nativen Teil von Plainva.

Die Einstellungen listen die erlaubten Apps mit ihren Ordnern und die letzten Anfragen. **Entfernen** nimmt einer App die Erlaubnis in jedem Vault zurück. Das gilt sofort — auch für eine App, die in dem Moment verbunden ist.

Neben den Werkzeugen bietet Plainva seine drei Skills als Prompts an, in der Sprache der App: `daily-orientation`, `weekly-review` und `project-status`, das nach dem Namen des Projekts fragt. Eine App, die Prompts unterstützt, führt sie unter ihren Befehlen.

## Eine App Änderungen vorschlagen lassen

Lesen ist nie eine Erlaubnis zu schreiben. Ob eine App auch Änderungen vorschlagen darf, ist eine eigene Antwort: **Darf Änderungen vorschlagen** in der Frage beim ersten Verbinden oder später der Schalter **… darf Änderungen vorschlagen** in den Einstellungen — je App und je Vault, und aus, bis Du ihn setzt. Er gilt ab der nächsten Anfrage der App; die zusätzlichen Werkzeuge zeigt die App, sobald sie sich neu verbindet.

Eine App, der Du es erlaubt hast, bekommt sechs weitere Werkzeuge, und keines davon ändert den Vault:

- **Eine Änderung an einer Notiz** — an ihrem Text oder an einer ihrer Eigenschaften — wird ein Vorschlag am Rand der Notiz, gezeichnet mit dem Namen der App und „(KI-App)“. Dort übernimmst Du jede Änderung einzeln oder lehnst sie ab, wie bei jedem Vorschlag (siehe [Kommentare & Vorschläge](Comments_and_Suggestions.md)).
- **Eine neue Notiz** wird ein Entwurf unter **Offen** im KI-Tab. Es gibt sie, sobald Du dort **Anlegen** wählst.
- **Umbenennen, Verschieben und Löschen** fragen zuerst. Plainva zeigt im eigenen Fenster, was geschähe — beim Umbenennen auch die Notizen, deren Links folgen würden —, und die App zeigt einen Hinweis, dass Plainva wartet. Erst nach **Erlauben** in Plainva, und sobald die App fortfährt, führt Plainva es so aus, wie wenn Du es von Hand tust; die App erfährt nur, ob es geschehen ist. Beim Löschen öffnet Plainva dann den eigenen Löschdialog, und nichts verschwindet, bevor Du dort bestätigst. Einer App, die einen solchen Hinweis nicht zeigen kann, werden diese drei Werkzeuge nicht angeboten.

Eine Webadresse, die eine App mitbringt, wird so geschrieben, dass nichts sie öffnet oder lädt (`https[://]…`), wie beim Assistenten. Die eigenen Datenschutzregeln einer Notiz (`plainva.ai`) setzt keine App, und in einem verschlüsselten Workspace wird nichts vorgeschlagen, entworfen oder geplant. **Letzte Anfragen** in den Einstellungen sagt zu jeder Anfrage, was aus ihr wurde — auch, dass Plainva bei Dir nachgefragt hat oder dass Du Nein gesagt hast.

## Grenzen

- Nur am Desktop: Telefone führen keine solchen Apps aus, und weder iOS noch Android lassen eine App einer anderen einen privaten Kanal anbieten.
- ChatGPT und claude.ai im Browser erreichen es nicht: sie verbinden sich nur mit Servern im Internet, und einen solchen betreibt Plainva nicht.
- Von sich aus ändert eine App den Vault nie: was sie schreibt, wartet als Vorschlag oder Entwurf, und Umbenennen, Verschieben oder Löschen braucht Dein Ja in Plainva.
