# KI-Apps verbinden (Beta)

Stand: 2026-11-20

KI-Apps auf Deinem Rechner — Claude Code, Claude Desktop, Cursor, VS Code und andere, die das Model Context Protocol (MCP) sprechen — können Deinen Vault über Plainva lesen: ihn durchsuchen, Notizen und ihre Abschnitte lesen, Gliederungen, Backlinks, Datenbanken, Aufgaben und zuletzt benutzte Notizen, und eine Notiz in Plainva öffnen. Von sich aus ändern sie nichts: eine App, der Du es erlaubst, darf Änderungen vorschlagen, und die warten, bis Du entscheidest (siehe unten). Das gehört zu den experimentellen KI-Funktionen und geht nur am Desktop.

Die Gegenrichtung — Plainvas Assistent nutzt Werkzeuge von Servern, die Du selbst anbindest — steht unter **Externe Werkzeuge** im [KI-Assistenten](AI_Assistant.md).

Ein dritter Weg — Plainva startet den KI-Agenten eines anderen Herstellers im Ordner des Vaults, mit seiner Sitzung im KI-Tab — steht unter [Externe Agenten](External_Agents.md).

## So funktioniert es

Plainva bringt neben der App ein kleines Hilfsprogramm mit, `plainva-mcp`. Eine KI-App startet es, und das Hilfsprogramm verbindet sich über einen privaten Kanal dieses Rechners mit dem laufenden Plainva — eine Named Pipe unter Windows, ein Socket in einem privaten Ordner unter macOS und Linux. Ein Netzwerk-Port wird nie geöffnet. Plainva muss mit dem Vault geöffnet laufen; sonst bekommt die App eine klare Meldung.

## Einschalten

1. Öffne **Einstellungen → KI** und schalte **KI auf diesem Gerät nutzen** ein; die Zeilen für KI-Apps auf diesem Rechner stehen in der Karte **Andere Programme** weiter unten auf der Seite.
2. Schalte **KI-Apps auf diesem Rechner diesen Vault lesen lassen** ein.
3. Richte die App ein (siehe unten). Beim ersten Verbinden fragt Plainva, welche App es ist, welches Programm sie gestartet hat und welche Ordner sie lesen darf. Nichts ist vorausgewählt: wähle unter den Ordnern der obersten Ebene des Vaults oder **Der ganze Vault**, dann **Erlauben**. **Ablehnen** weist die App ab, und Plainva fragt zehn Minuten lang nicht erneut nach ihr. Unter den Ordnern steht **Darf Änderungen vorschlagen** — aus, solange Du den Haken nicht setzt; was er erlaubt, steht weiter unten.

Die App bewahrt für das nächste Mal ein Geheimnis im Schlüsselbund des Systems auf. Ordner gelten je App und je Vault: in einem anderen Vault fragt die App erneut. Öffnest Du einen anderen Vault, trennt Plainva die Apps, die mit dem vorigen verbunden waren; den neuen lesen sie erst, wenn sie sich wieder verbinden. Solange **Voll-lokal** an ist (siehe [KI-Assistent](AI_Assistant.md)), ruht der Server: keine App kann den Vault lesen, und eine App, die sich verbindet, wird abgewiesen.

## Eine App einrichten

- **Claude Code:** kopiere den **Befehl für Claude Code** aus den Einstellungen und führe ihn in einem Terminal aus.
- **Claude Desktop:** **Paket erstellen …** schreibt eine Datei `plainva.mcpb`; öffne sie, und Claude Desktop installiert Plainva.
- **Andere Apps (JSON):** kopiere die Konfiguration und trage sie in die MCP-Einstellungen der App ein, etwa in die `mcp.json` von Cursor.

## Was eine App sieht

Nur die Ordner, die Du erlaubt hast, und nur, was Deine Datenschutzregeln an ein Cloud-Modell gehen lassen, das ins Internet kann — als ein solches gilt eine App, denn Plainva sieht nicht, was sie mit dem Gelesenen tut: Notizen mit `cloud: deny` oder `web: deny` oder in einem Ordner mit einer dieser Regeln gibt es für eine App nicht — weder ihren Text noch ihre Titel —, Links auf sie werden zurückgehalten, und Ortsangaben aus dem Journal gehen nie mit. Eine Notiz in einem erlaubten Ordner, deren Name sich so, wie er dasteht, nicht beurteilen lässt — er endet auf ein Leerzeichen oder einen Punkt, enthält einen Doppelpunkt oder steht nicht in zusammengesetzter Unicode-Form —, bleibt ebenfalls draußen, und die Antwort sagt, wie viele Notizen ausgelassen wurden. Plainvas eigene Ordner (`.plainva`, `.agent`) und die Regeln selbst sind nie lesbar. Jeder Pfad in einer Anfrage und in einer Antwort wird zweimal geprüft: im App-Fenster und im nativen Teil von Plainva. Ein Ordner-Link in einem erlaubten Ordner, der woandershin führt, wird nicht verfolgt, und eine Datenbank antwortet nur mit Werten aus Notizen, die die App lesen darf: eine Anzahl oder Summe über Links in andere Ordner lässt diese Notizen aus. Ein Link in dem, was eine App liest, bleibt nur stehen, wenn er zu einer Notiz führt, die die App lesen darf; jeder andere – auch einer zu einer Notiz, die es nicht gibt – wird zurückgehalten. Eine Suche findet eine Notiz nicht über den Text eines zurückgehaltenen Links und lässt eine Notiz im Zweifel aus; eine Änderung, die einen zurückgehaltenen Link berühren oder seinen Platzhalter in eine Notiz tragen würde, wird abgelehnt.

Die Einstellungen listen die Apps, die Du auf diesem Rechner erlaubt hast, mit ihren Ordnern in diesem Vault (**keiner in diesem Vault** bei einer App, die nur anderswo erlaubt ist) und die letzten Anfragen. **Entfernen** nimmt einer App die Erlaubnis in jedem Vault zurück. Das gilt sofort — auch für eine App, die in dem Moment verbunden ist.

Solange der verschlüsselte Workspace des offenen Vaults auf diesem Gerät nicht offen ist — er ist gesperrt, oder auf diesem Gerät liegt kein Schlüssel dafür —, antwortet Plainva keiner App: Jede Anfrage — auch eine Liste oder eine Suche — wird mit einer Meldung abgelehnt, die sagt, welcher der beiden Fälle vorliegt; eine Anfrage, die läuft, während Du sperrst, bekommt nichts von dem, was sie gefunden hat, und eine App, die sich verbindet, erfährt es sofort. Entsperrst Du den Workspace oder richtest Du ihn auf diesem Gerät ein, antwortet dieselbe Verbindung wieder. Eine Freigabe gilt dem Namen eines Ordners: Benennst Du einen erlaubten Ordner um, sieht die App ihn nicht mehr, bis Du ihn wieder erlaubst, und ein neuer Ordner mit dem alten Namen wäre für sie sichtbar.

Neben den Werkzeugen bietet Plainva fünf seiner Skills als Prompts an, in Plainvas eigener Sprache, und die Referenz des Dateiformats als Ressource (`plainva://format`): die Prompts sind `daily-orientation`, `weekly-review`, `project-status`, `meeting-prep` und `task-triage`; `project-status` fragt nach dem Namen des Projekts und `meeting-prep` nach dem Meeting. Eine App, die Prompts unterstützt, führt sie unter ihren Befehlen.

## Eine App Änderungen vorschlagen lassen

Lesen ist nie eine Erlaubnis zu schreiben. Ob eine App auch Änderungen vorschlagen darf, ist eine eigene Antwort: **Darf Änderungen vorschlagen** in der Frage beim ersten Verbinden oder später der Schalter **… darf Änderungen vorschlagen** in den Einstellungen — je App und je Vault, und aus, bis Du ihn setzt. Er gilt ab der nächsten Anfrage der App; Plainva sagt einer verbundenen App sofort, dass sich ihre Werkzeuge geändert haben (eine App, die die neueste Protokollrevision nutzt, erfährt es nur, wenn sie darum gebeten hat) — ob sie sie dann ohne neues Verbinden zeigt, liegt an der App.

Eine App, der Du es erlaubt hast, bekommt sechs weitere Werkzeuge, und keines davon ändert den Vault:

- **Eine Änderung an einer Notiz** — an ihrem Text oder an einer ihrer Eigenschaften — wird ein Vorschlag am Rand der Notiz, gezeichnet mit dem Namen der App und „(KI-App)“. Dort übernimmst Du jede Änderung einzeln oder lehnst sie ab, wie bei jedem Vorschlag (siehe [Kommentare & Vorschläge](Comments_and_Suggestions.md)).
- **Eine neue Notiz** wird ein Entwurf unter **Zu entscheiden** im KI-Tab. Es gibt sie, sobald Du dort **Anlegen** wählst.
- **Umbenennen, Verschieben und Löschen** fragen zuerst. Plainva zeigt im eigenen Fenster, was geschähe — beim Umbenennen auch die Notizen, deren Links folgen würden —, und die App zeigt einen Hinweis, dass Plainva wartet. Erst nach **Erlauben** in Plainva, und sobald die App fortfährt, führt Plainva es so aus, wie wenn Du es von Hand tust; die App erfährt nur, ob es geschehen ist. Beim Löschen öffnet Plainva dann den eigenen Löschdialog, und nichts verschwindet, bevor Du dort bestätigst. Einer App, die einen solchen Hinweis nicht zeigen kann — sie braucht MCP-Protokollrevision 2026-07-28 oder neuer und muss Dir in einem Formular eine Frage stellen können —, werden diese drei Werkzeuge nicht angeboten.

Eine Webadresse, die eine App mitbringt, wird so geschrieben, dass nichts sie öffnet oder lädt (`https[://]…`), wie beim Assistenten. Die eigenen Datenschutzregeln einer Notiz (`plainva.ai`) setzt keine App, und in einem verschlüsselten Workspace wird nichts vorgeschlagen, entworfen oder geplant. Die Liste der letzten Anfragen in den Einstellungen zeigt die acht neuesten und markiert die, bei denen Plainva Dich gefragt hat (**Rückfrage**), die, die Du abgelehnt hast (**abgelehnt**), und die, die nicht durchgingen (**abgewiesen**); eine Anfrage, die durchging, trägt kein Wort.

## Grenzen

- Nur am Desktop: Telefone führen keine solchen Apps aus, und weder iOS noch Android lassen eine App einer anderen einen privaten Kanal anbieten.
- ChatGPT und claude.ai im Browser erreichen es nicht: sie verbinden sich nur mit Servern im Internet, und einen solchen betreibt Plainva nicht.
- Von sich aus ändert eine App den Vault nie: was sie schreibt, wartet als Vorschlag oder Entwurf, und Umbenennen, Verschieben oder Löschen braucht Dein Ja in Plainva.
