# Die mobile App

Stand: 2026-07-21

Plainva gibt es auch als App für Android und iOS. Sie arbeitet mit denselben Markdown-Dateien, demselben **OKF**-Format und derselben Sync-Technik wie die Desktop-App — Dein Vault bleibt in beiden Welten identisch.

## Aufbau

- **Untere Leiste:** drei frei anordenbare Bereiche plus der feste **Mehr**-Tab. Unter **Mehr** stehen alle Bereiche (Notizen, Heute, Tags, Lesezeichen, Kalender, Datenbanken, Graph) — ein Tipp öffnet den Bereich, der **Zieh-Griff** ordnet die Liste an: die oberen drei bilden die Leiste (im Rahmen markiert), nach oben ziehen befördert einen Bereich hinein.
- **＋** schwebt als runder Knopf über der Leiste und öffnet die Schnellanlage: Notiz, Tagesnotiz, Ordner, Datenbank, „Aus Vorlage…".
- **Obere Leiste:** Suche und die **Einstellungen** (⋮); auf dem Startbildschirm zusätzlich „Zuletzt geöffnet" und Deine Lesezeichen.
- **Einstellungen:** Der ⋮-Knopf öffnet zuerst die Bereichsliste (wie die linke Seite der Desktop-Einstellungen) — ein Tipp öffnet die jeweilige Seite. Ganz oben führt **Aktiver Vault** zur Vault-Verwaltung: Vault wechseln (Häkchen = aktiv), **Neuen Vault erstellen** und **Mit Cloud verbinden**.

## Notizen lesen und bearbeiten

Notizen öffnen **gerendert und schreibgeschützt**; der Stift oben rechts wechselt ins Bearbeiten (mit Werkzeugleiste über der Tastatur: Formatierung, Listen, Wiki-Link, Slash-Befehle, Foto einfügen). `![[Notiz]]`-Einbettungen erscheinen als antippbare Vorschau-Karten.

Das **Notiz-Details**-Symbol in der Kopfzeile (zwischen Lesezeichen und ⋮-Menü) öffnet das Kontext-Blatt der Notiz: Eigenschaften (direkt editierbar), Backlinks, Gliederung, Graph und der **Versionsverlauf** — jede Bearbeitung erzeugt automatisch Snapshots, die Du ansehen, vergleichen und wiederherstellen kannst. Markdown-Quelltext und die Suche in der Notiz erreichst Du über das ⋮-Menü.

## Datenbanken (`.base`)

`.base`-Datenbanken funktionieren wie am Desktop: alle Ansichten (Tabelle, Liste, Galerie, Board, Kalender, Zeitachse), typgerechtes Bearbeiten der Zellen, Karten im Board per Gedrückthalten verschieben. Über **Konfigurieren** verwaltest Du Ansichten, Spalten, Filter (auch Gruppen), Sortierung und Eigenschaften. Relationen-Schema (Ziele, Kardinalität) pflegst Du weiterhin am Desktop.

Eine **Pinnwand**-Ansicht zeigt die Notizen als zweispaltiges Brett aus Zetteln: Tippen öffnet die Notiz, langes Drücken zeigt die Aktionen (Anpinnen, Labels, Farbe, Löschen), Ziehen nach langem Drücken ordnet um, und Kontrollkästchen lassen sich direkt auf der Karte abhaken. Das Eingabefeld oben erfasst einen neuen Zettel. Tipp: Zeigt die Datenbank auf Deinen Eingangsordner (**Einstellungen** → **Inhalt & Struktur**), landen auch die ＋-Schnellnotizen und aus anderen Apps geteilte Texte direkt auf dem Brett.

## Kalender und Termine

Der **Kalender** (unterer Tab bzw. über „Mehr") zeigt Deine Tagesnotizen als Monatsraster. Das Uhr-Symbol oben rechts öffnet den **Termin-Kalender** mit den Ansichten **Tag**, **3 Tage** und **Agenda** — Deine verbundenen Kalender laufen über dasselbe Konten-Modell wie am Desktop. Ein Tipp auf einen Termin zeigt die Details; bei einer Einladung kannst Du direkt **zusagen**, **vorläufig** annehmen oder **absagen**.

Konten verwaltest Du über das Zahnrad-Symbol im Termin-Kalender: **CalDAV** verbindest Du direkt auf dem Gerät mit einem App-Passwort (z. B. Fastmail, Nextcloud, iCloud); Google und Microsoft folgen über die Browser-Anmeldung. Je Konto lassen sich einzelne Kalender ein- und ausblenden.

## Synchronisation

In den **Einstellungen** (⋮) führt **Aktiver Vault** zur Vault-Verwaltung; dort verbindest Du Cloud-Speicher (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Mit Cloud verbinden** holt einen bestehenden Cloud-Vault aufs Gerät; **Neuen Vault erstellen** fragt zuerst **Auf diesem Gerät** oder **Bei einem Online-Dienst** und danach die Startstruktur (leer oder eine Vorlage wie PARA) — beim Online-Weg folgt das Verbinden, der Ziel-Ordner in der Cloud lässt sich im Auswahl-Blatt über **Neuer Ordner** frisch anlegen, und die Struktur wird beim ersten Sync hochgeladen. Dieselbe Wahl zwischen bestehendem und neuem Cloud-Vault bietet auch der erste Start („Mit Cloud verbinden"). Jede Verbindung bekommt einen eigenen, getrennten Vault auf dem Gerät. Die Vault-Seite zeigt Status, Fortschritt, ausstehende Übertragungen und bietet **Vault exportieren** (ZIP über das Teilen-Menü).

## Sicherheitsnetz

Snapshots (Versionsverlauf), ein Entwurfs-Journal (nach einem Absturz bietet die Notiz den letzten ungespeicherten Stand an) und Konflikt-Kopien mit Vergleichsansicht schützen Deine Daten. Die Aufbewahrung stellst Du unter **Einstellungen** → **Backup & Versionierung** ein.

## Teilen und Verknüpfungen

Auf Android und iOS landen geteilter Text und URLs als neue Notiz im Eingangsordner; geteilte Bilder und Dateien werden als Anhänge übernommen (maximal 25 MB pro Datei). Auf Android bietet das gedrückt gehaltene App-Symbol zusätzlich **Neue Notiz** und **Heute**. Auf der Vault-Seite kannst Du **Einstellungen synchronisieren** aktivieren und verschlüsselte Vaults sicher per Passphrase entsperren oder wieder sperren.
