# KI-Apps verbinden (Beta)

Stand: 2026-10-07

KI-Apps auf Deinem Rechner — Claude Code, Claude Desktop, Cursor, VS Code und andere, die das Model Context Protocol (MCP) sprechen — können Deinen Vault über Plainva lesen: ihn durchsuchen, Notizen und ihre Abschnitte lesen, Gliederungen, Backlinks, Datenbanken, Aufgaben und zuletzt benutzte Notizen, und eine Notiz in Plainva öffnen. Ändern können sie nichts. Das gehört zu den experimentellen KI-Funktionen und geht nur am Desktop.

Die Gegenrichtung — Plainvas Assistent nutzt Werkzeuge von Servern, die Du selbst anbindest — steht unter **Externe Werkzeuge (MCP)** im [KI-Assistenten](AI_Assistant.md).

## So funktioniert es

Plainva bringt neben der App ein kleines Hilfsprogramm mit, `plainva-mcp`. Eine KI-App startet es, und das Hilfsprogramm verbindet sich über einen privaten Kanal dieses Rechners mit dem laufenden Plainva — eine Named Pipe unter Windows, ein Socket in einem privaten Ordner unter macOS und Linux. Ein Netzwerk-Port wird nie geöffnet. Plainva muss mit dem Vault geöffnet laufen; sonst bekommt die App eine klare Meldung.

## Einschalten

1. Öffne **Einstellungen → KI & Automatisierung** und schalte **KI auf diesem Gerät nutzen** ein.
2. Schalte **KI-Apps auf diesem Rechner diesen Vault lesen lassen** ein.
3. Richte die App ein (siehe unten). Beim ersten Verbinden fragt Plainva, welche App es ist, welches Programm sie gestartet hat und welche Ordner sie lesen darf. Nichts ist vorausgewählt: wähle Ordner oder **Der ganze Vault**, dann **Erlauben**. **Ablehnen** weist die App ab, und Plainva fragt zehn Minuten lang nicht erneut nach ihr.

Die App bewahrt für das nächste Mal ein Geheimnis im Schlüsselbund des Systems auf. Ordner gelten je App und je Vault: in einem anderen Vault fragt die App erneut.

## Eine App einrichten

- **Claude Code:** kopiere den **Befehl für Claude Code** aus den Einstellungen und führe ihn in einem Terminal aus.
- **Claude Desktop:** **Paket erstellen …** schreibt eine Datei `plainva.mcpb`; öffne sie, und Claude Desktop installiert Plainva.
- **Andere Apps (JSON):** kopiere die Konfiguration und trage sie in die MCP-Einstellungen der App ein, etwa in die `mcp.json` von Cursor.

## Was eine App sieht

Nur die Ordner, die Du erlaubt hast, und nur, was Deine Datenschutzregeln an ein Cloud-Modell gehen lassen: Notizen mit `cloud: deny` oder in einem Ordner mit dieser Regel gibt es für eine App nicht — weder ihren Text noch ihre Titel —, Links auf sie werden zurückgehalten, und Ortsangaben aus dem Journal gehen nie mit. Plainvas eigene Ordner (`.plainva`, `.agent`) und die Regeln selbst sind nie lesbar. Jeder Pfad in einer Anfrage und in einer Antwort wird zweimal geprüft: im App-Fenster und im nativen Teil von Plainva.

Die Einstellungen listen die erlaubten Apps mit ihren Ordnern und die letzten Anfragen. **Entfernen** nimmt einer App die Erlaubnis in jedem Vault zurück.

Neben den Werkzeugen bietet Plainva seine drei Skills als Prompts an, in der Sprache der App: `daily-orientation`, `weekly-review` und `project-status`, das nach dem Namen des Projekts fragt. Eine App, die Prompts unterstützt, führt sie unter ihren Befehlen.

## Grenzen

- Nur am Desktop: Telefone führen keine solchen Apps aus, und weder iOS noch Android lassen eine App einer anderen einen privaten Kanal anbieten.
- ChatGPT und claude.ai im Browser erreichen es nicht: sie verbinden sich nur mit Servern im Internet, und einen solchen betreibt Plainva nicht.
- Nur lesen; dass eine App Änderungen vorschlägt, kommt in einer späteren Version.
