# Plainva Nutzerhandbuch

Stand: 2026-07-06

Plainva ist ein Markdown-Vault-Editor: Deine Notizen sind gewöhnliche Markdown-Dateien in einem Ordner („Vault") auf Deinem Rechner — kein Datenbank-Silo, kein Zwang zu einem Cloud-Konto. Dieses Handbuch erklärt, wie Du mit Plainva arbeitest und wie die Dateiformate funktionieren.

## Inhalt

| Seite | Worum es geht |
|---|---|
| [Erste Schritte](Getting_Started.md) | Vault öffnen oder anlegen, die Oberfläche, Editor-Modi, Tabs und Split |
| [Notizen & Markdown](Notes_and_Markdown.md) | Wie Markdown-Dateien funktionieren: Schreiben, Formatieren, Eigenschaften (Frontmatter), Icons, Links, Vorlagen, Bilder |
| [Datenbanken (.base)](Databases_Base.md) | Notizen als Datenbank ansehen — Ansichten, Filter, Eigenschaften, Relationen, neue Einträge (ähnlich Notion, aber dateibasiert) |
| [OKF](OKF.md) | Das Open Knowledge Format: `type`, `okf_version`, index.md-Verwaltung und die optionale Vault-Konvertierung |
| [Dateiformat-Referenz](File_Format_Reference.md) | Das genaue Dateiformat jeder Vault-Datei — für Werkzeuge, Skripte oder eine KI, die Notizen und `.base`-Dateien direkt bearbeitet |
| [Automatisierung & Skripte](Automation_and_Scripts.md) | Plainva ohne Plugins erweitern: wie Skripte, CLI-Werkzeuge und KI-Agenten einen Vault sicher lesen und schreiben |
| [Backups & Versionsverlauf](Backups_and_Versioning.md) | Automatische Datei-Versionen, Wiederherstellen (auch gelöschter Dateien) und tägliche ZIP-Sicherungen des Vaults |
| [Die mobile App](Mobile_App.md) | Plainva auf Android und iOS: Aufbau, Bearbeiten, Datenbanken, Sync und Sicherheitsnetz |
| [Sync einrichten](Sync_Setup.md) | Schritt für Schritt je Anbieter: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Sync-Kompatibilität](Sync_Compatibility.md) | Welche Dienste heute funktionieren — direkt, über WebDAV oder über den Desktop-Client des Anbieters |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Google-Drive-Sync mit eigenen Zugangsdaten einrichten |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | OneDrive- und Dropbox-Sync mit eigener App-Registrierung einrichten |
| [Suche](Search.md) | Volltextsuche, Schnellwechsel, Suchen & Ersetzen, Tags |
| [Aufgaben](Tasks.md) | Die vault-weite Aufgabenansicht: jede Checkbox über alle Notizen, mit Status-/Tag-/Ordner-/Fälligkeitsfiltern und Ein-Klick-Umschalten |
| [Graph](Graph.md) | Kontext-Graph, Vault-Karte mit Aufräum-Modus und Zeitreise, Graph als Datenbank-Ansicht |
| [Tastenkürzel](Keyboard_Shortcuts.md) | Alle Tastenkombinationen im Überblick |
| [FAQ & Fehlerbehebung](FAQ.md) | Häufige Fragen: Obsidian-Kompatibilität, Konfliktdateien, Backups u. a. |

## Grundprinzipien

- **Deine Dateien gehören Dir.** Ein Vault ist ein normaler Ordner mit Markdown-Dateien. Du kannst ihn jederzeit mit anderen Programmen öffnen, kopieren oder sichern.
- **Reines Markdown als kanonisches Format.** Auch Zusatzfunktionen (Eigenschaften, Icons, Datenbanken) werden in offenen, lesbaren Text-Formaten gespeichert.
- **Obsidian-kompatibel.** Bestehende Obsidian-Vaults werden nicht beschädigt oder umformatiert; Obsidian kann alle von Plainva erzeugten Dateien öffnen.
