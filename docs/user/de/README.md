# Plainva Nutzerhandbuch

Stand: 2026-10-09

Plainva ist ein Markdown-Vault-Editor: Deine Notizen sind gewöhnliche Markdown-Dateien in einem Ordner („Vault") auf Deinem Rechner — kein Datenbank-Silo, kein Zwang zu einem Cloud-Konto. Dieses Handbuch erklärt, wie Du mit Plainva arbeitest und wie die Dateiformate funktionieren.

## Inhalt

| Seite | Worum es geht |
|---|---|
| [Erste Schritte](Getting_Started.md) | Vault öffnen oder anlegen, die Oberfläche, Editor-Modi, Tabs und Split |
| [Notizen & Markdown](Notes_and_Markdown.md) | Wie Markdown-Dateien funktionieren: Schreiben, Formatieren, Eigenschaften (Frontmatter), Icons, Links, Vorlagen, Bilder |
| [Datenbanken (.base)](Databases_Base.md) | Notizen als Datenbank ansehen — Ansichten, Filter, Eigenschaften, Relationen, neue Einträge (ähnlich Notion, aber dateibasiert) |
| [Aus einer anderen App importieren](Import.md) | Notizen aus Notion, Evernote, Google Keep, Simplenote, Logseq oder einem Markdown-Ordner übernehmen — und was jeder Import nicht mitnehmen kann |
| [OKF](OKF.md) | Das Open Knowledge Format (0.2): `type`, Herkunft und Prüfvermerk, die Bundle-Version, index.md-Verwaltung und die optionale Vault-Konvertierung |
| [Dateiformat-Referenz](File_Format_Reference.md) | Das genaue Dateiformat jeder Vault-Datei — für Werkzeuge, Skripte oder eine KI, die Notizen und `.base`-Dateien direkt bearbeitet |
| [Automatisierung & Skripte](Automation_and_Scripts.md) | Plainva ohne Plugins erweitern: wie Skripte, CLI-Werkzeuge und KI-Agenten einen Vault sicher lesen und schreiben |
| [Backups & Versionsverlauf](Backups_and_Versioning.md) | Automatische Datei-Versionen, Wiederherstellen (auch gelöschter Dateien) und tägliche ZIP-Sicherungen des Vaults |
| [Die mobile App](Mobile_App.md) | Plainva auf Android und iOS: Aufbau, Bearbeiten, Datenbanken, Sync und Sicherheitsnetz |
| [Sync einrichten](Sync_Setup.md) | Schritt für Schritt je Anbieter: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Sicherheit & Freigaben](Security_and_Sharing.md) | Persönlicher verschlüsselter Workspace, Recovery-Sicherung, Migration und Sperren |
| [Kommentare & Vorschläge](Comments_and_Suggestions.md) | Kommentare, Vorschlagsmodus, Übersicht und Benachrichtigungen — in jedem Vault, mit oder ohne Verschlüsselung |
| [Sync-Kompatibilität](Sync_Compatibility.md) | Welche Dienste heute funktionieren — direkt, über WebDAV oder über den Desktop-Client des Anbieters |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Google-Drive-Sync mit eigenen Zugangsdaten einrichten |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | OneDrive- und Dropbox-Sync mit eigener App-Registrierung einrichten |
| [Suche](Search.md) | Volltextsuche, Schnellwechsel, Suchen & Ersetzen, Tags |
| [Aufgaben](Tasks.md) | Die vault-weite Aufgabenansicht: jede Checkbox über alle Notizen, mit Status-/Tag-/Ordner-/Fälligkeitsfiltern und Ein-Klick-Umschalten |
| [KI-Assistent (Beta)](AI_Assistant.md) | Fragen zu Deinen Notizen mit einem KI-Modell Deiner Wahl: Anbieter und Schlüssel, Profile, Kontext, Datenschutzregeln und Verlauf |
| [Skills (Beta)](AI_Skills.md) | Anleitungen für wiederkehrende Arbeit: die dreizehn mitgelieferten, eigene, Importieren und das Freigeben dessen, was ankommt, bevor es läuft |
| [Skripte (Beta)](AI_Scripts.md) | Kleine Programme, die Deinen Vault lesen und ein Ergebnis ausrechnen: ausführen, schreiben, was ihre Werkzeuge zurückgeben, ihre Grenzen und das Freigeben dessen, was ankommt, bevor es läuft |
| [Gedächtnis (Beta)](AI_Memory.md) | Was die KI über Dich wissen soll, ohne dass Du es wieder sagst: die zwei Orte, Einträge selbst anlegen, die KI etwas merken lassen, Regeln, Datenschutz und die beiden Dateien |
| [KI-Apps verbinden (Beta)](Connect_AI_Apps.md) | KI-Apps auf diesem Rechner (Claude Code, Claude Desktop, Editoren) den Vault über Plainvas MCP-Server lesen lassen: Einschalten, Koppeln, Ordner, was eine App sieht, und wie eine App Änderungen vorschlagen darf |
| [Externe Agenten (Beta)](External_Agents.md) | Den KI-Agenten eines anderen Herstellers im Ordner eines Vaults starten: was Plainva in seiner Sitzung kontrolliert und was nicht, Hinzufügen, Anmelden, Vorschläge und neue Notizen |
| [Journal](Journal.md) | Der schnelle Eintrag in die heutige Tagesnotiz: Erfassen von überall, die Journal-Ansicht über alle Tage, wie Einträge gespeichert werden, und das optionale globale Tastenkürzel |
| [Kalender & externe Aufgaben](Calendar_and_Tasks.md) | CalDAV-/Google-/Microsoft-Kalender verbinden, der Kalender-Tab, Meeting-Notizen und der Abgleich externer Aufgabenlisten mit der Aufgabendatenbank |
| [E-Mail-Capture](Email_Capture.md) | IMAP und Microsoft-Mail (experimentell): der Sandbox-Viewer, Mails als Notiz/.eml/Aufgabe ablegen sowie Verfassen und Senden |
| [Graph](Graph.md) | Kontext-Graph, Vault-Karte mit Aufräum-Modus und Zeitreise, Graph als Datenbank-Ansicht |
| [Tastenkürzel](Keyboard_Shortcuts.md) | Alle Tastenkombinationen im Überblick |
| [FAQ & Fehlerbehebung](FAQ.md) | Häufige Fragen: Obsidian-Kompatibilität, Konfliktdateien, Backups u. a. |

## Grundprinzipien

- **Deine Dateien gehören Dir.** Ein Vault ist ein normaler Ordner mit Markdown-Dateien. Du kannst ihn jederzeit mit anderen Programmen öffnen, kopieren oder sichern.
- **Reines Markdown als kanonisches Format.** Auch Zusatzfunktionen (Eigenschaften, Icons, Datenbanken) werden in offenen, lesbaren Text-Formaten gespeichert.
- **Obsidian-kompatibel.** Bestehende Obsidian-Vaults werden nicht beschädigt oder umformatiert; Obsidian kann alle von Plainva erzeugten Dateien öffnen.
