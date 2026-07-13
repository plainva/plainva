# Die mobile App

Stand: 2026-07-13

Plainva gibt es auch als App für Android und iOS. Sie arbeitet mit denselben Markdown-Dateien, demselben **OKF**-Format und derselben Sync-Technik wie die Desktop-App — Dein Vault bleibt in beiden Welten identisch.

## Aufbau

- **Untere Leiste:** bis zu vier frei wählbare Bereiche (Notizen, Heute, Tags, Lesezeichen, Kalender, Datenbanken) rund um den festen **＋**-Knopf. Die Auswahl änderst Du unter **Einstellungen** → **Tab-Leiste**.
- **＋**: Tippen erfasst sofort eine neue Notiz (in den sichtbaren Ordner, sonst in den Eingangsordner). Gedrückt halten öffnet die Schnellanlage: Notiz, Tagesnotiz, Ordner, Datenbank, „Aus Vorlage…".
- **Obere Leiste:** Suche und das Mehr-Menü; auf dem Startbildschirm zusätzlich „Zuletzt geöffnet" und Deine Lesezeichen.

## Notizen lesen und bearbeiten

Notizen öffnen **gerendert und schreibgeschützt**; der Stift oben rechts wechselt ins Bearbeiten (mit Werkzeugleiste über der Tastatur: Formatierung, Listen, Wiki-Link, Slash-Befehle, Foto einfügen). `![[Notiz]]`-Einbettungen erscheinen als antippbare Vorschau-Karten.

Das **ⓘ**-Symbol öffnet das Kontext-Blatt der Notiz: Eigenschaften (direkt editierbar), Backlinks, Gliederung, Markdown-Quelltext, Suche in der Notiz und der **Versionsverlauf** — jede Bearbeitung erzeugt automatisch Snapshots, die Du ansehen, vergleichen und wiederherstellen kannst.

## Datenbanken (`.base`)

`.base`-Datenbanken funktionieren wie am Desktop: alle Ansichten (Tabelle, Liste, Galerie, Board, Kalender, Zeitachse), typgerechtes Bearbeiten der Zellen, Karten im Board per Gedrückthalten verschieben. Über **Konfigurieren** verwaltest Du Ansichten, Spalten, Filter (auch Gruppen), Sortierung und Eigenschaften. Relationen-Schema (Ziele, Kardinalität) pflegst Du weiterhin am Desktop.

## Synchronisation

Unter **Mehr** → **Vaults** verbindest Du Cloud-Speicher (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Mit Cloud verbinden** holt einen bestehenden Cloud-Vault aufs Gerät; **Neuen Vault erstellen** fragt zuerst **Auf diesem Gerät** oder **Bei einem Online-Dienst** und danach die Startstruktur (leer oder eine Vorlage wie PARA) — beim Online-Weg folgt das Verbinden, der Ziel-Ordner in der Cloud lässt sich im Auswahl-Blatt über **Neuer Ordner** frisch anlegen, und die Struktur wird beim ersten Sync hochgeladen. Dieselbe Wahl zwischen bestehendem und neuem Cloud-Vault bietet auch der erste Start („Mit Cloud verbinden"). Jede Verbindung bekommt einen eigenen, getrennten Vault auf dem Gerät. Die Vault-Seite zeigt Status, Fortschritt, ausstehende Übertragungen und bietet **Vault exportieren** (ZIP über das Teilen-Menü).

## Sicherheitsnetz

Snapshots (Versionsverlauf), ein Entwurfs-Journal (nach einem Absturz bietet die Notiz den letzten ungespeicherten Stand an) und Konflikt-Kopien mit Vergleichsansicht schützen Deine Daten. Die Aufbewahrung stellst Du in den **Einstellungen** ein.

## Teilen und Verknüpfungen (Android)

Geteilter Text aus anderen Apps landet als neue Notiz im Eingangsordner. Das App-Symbol gedrückt halten bietet die Verknüpfungen **Neue Notiz** und **Heute**.
