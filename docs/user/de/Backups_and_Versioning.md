# Backups & Versionsverlauf

Stand: 2026-07-11

Plainva sichert Deine Arbeit auf zwei Ebenen: **Datei-Versionen** (automatische Snapshots jeder einzelnen Datei beim Bearbeiten und Löschen) und **Vault-Backups** (regelmäßige ZIP-Sicherungen des ganzen Vaults außerhalb des Vault-Ordners). Beides läuft ohne Zutun im Hintergrund und lässt sich in den Einstellungen unter **Backup & Versionierung** anpassen.

## Datei-Versionen (Snapshots)

Bei jedem Speichern legt Plainva vorher einen Snapshot der alten Fassung an — als normale Textkopie unter `.plainva/backups/` im Vault (dieser Ordner ist im Dateibaum, in der Suche und im Sync ausgeblendet). Damit beim schnellen Tippen nicht hunderte Kopien entstehen, gilt ein **Snapshot-Intervall** (Standard: höchstens alle 2 Minuten eine neue Version). **Löschen sichert immer**, unabhängig vom Intervall.

Aufbewahrung (je Vault einstellbar):

- **Snapshot-Intervall**: Bei jeder Änderung / 30 s / 2 min / 5 min / 10 min
- **Versionen pro Datei**: Standard 100 — darüber fliegen die ältesten raus
- **Maximales Alter**: Standard 90 Tage — ältere Versionen werden bei einem täglichen Aufräumlauf **endgültig** entfernt („Unbegrenzt" schaltet das ab)

Beim Umbenennen oder Verschieben einer Datei wandert ihre Versions-Historie mit.

## Versionsverlauf ansehen und wiederherstellen

Rechtsklick auf eine Datei im Dateibaum (oder auf ihren Tab) oder das **⋮**-Menü oben rechts im Editor → **Versionsverlauf…** öffnet die Versionsliste:

- Links stehen alle Snapshots nach Tag gruppiert, mit Uhrzeit und Größe.
- Rechts siehst Du die Vorschau; bei Textdateien vergleicht **Mit aktueller Fassung vergleichen** die gewählte Version Seite an Seite mit dem aktuellen Inhalt (links die alte Version, rechts der aktuelle Stand).
- **Wiederherstellen** ersetzt den aktuellen Inhalt durch die gewählte Version. Keine Angst: Der aktuelle Stand wird vorher selbst als Snapshot gesichert — Wiederherstellen ist also selbst rückgängig machbar.
- **Als Kopie wiederherstellen** legt die Version als neue Datei daneben an (`Name (Version 2026-07-05 14-30).md`), ohne das Original anzufassen.

Auch Bilder haben Versionen (mit Vorschau); andere Binärdateien lassen sich ohne Vorschau wiederherstellen.

## Gelöschte Dateien wiederherstellen

Da jedes Löschen vorher einen Snapshot anlegt, kann Plainva gelöschte Dateien zurückholen: Rechtsklick auf den Vault-Namen ganz oben im Dateibaum → **Gelöschte Dateien wiederherstellen…** (auch über die Einstellungen erreichbar). Die Liste zeigt alle Dateien, deren Snapshots noch da sind, das Original aber fehlt — **Wiederherstellen** legt die jüngste Fassung am ursprünglichen Ort wieder an (Ordner werden bei Bedarf neu erstellt), **Versionen…** öffnet die komplette Historie der gelöschten Datei.

Hinweis: Wird ein **ganzer Ordner** gelöscht, landet er im Papierkorb des Betriebssystems — für diesen Fall ist der System-Papierkorb der erste Weg; in Plainva findest Du dann ggf. nur ältere Snapshots der enthaltenen Dateien.

## Automatische Vault-Backups (ZIP)

Zusätzlich sichert Plainva den ganzen Vault als ZIP-Datei — standardmäßig **täglich** im Hintergrund (beim Öffnen des Vaults, wenn die letzte Sicherung älter als 24 Stunden ist). Das schützt auch dann, wenn der Vault-Ordner selbst verloren geht oder beschädigt wird, denn die ZIPs liegen **außerhalb** des Vaults:

- Standard-Zielordner ist der App-Datenordner (unter **Zielordner** in den Einstellungen angezeigt; **Ordner öffnen** führt direkt hin).
- Über **Ordner wählen…** kannst Du stattdessen z. B. eine externe Platte oder ein NAS wählen; **Standard** stellt den App-Datenordner wieder ein. Ist das Ziel gerade nicht erreichbar (NAS aus), meldet die Statusleiste das dezent und Plainva versucht es später erneut.
- **Aufbewahrte Sicherungen** (Standard: 7) begrenzt die Anzahl; ältere ZIPs desselben Vaults werden automatisch gelöscht. Fremde Dateien im Zielordner bleiben unangetastet.
- **Jetzt sichern** stößt jederzeit manuell eine Sicherung an; die Statusleiste zeigt den Lauf und das Ergebnis.

Die ZIP-Dateien heißen `VaultName_2026-07-05_14-30-00.zip` und enthalten alle Notizen, Anhänge und auch Deine `.obsidian`-Konfiguration — **nicht** enthalten ist der interne `.plainva`-Ordner (der Suchindex wird beim nächsten Öffnen neu aufgebaut; die Datei-Versionen sind bewusst nicht Teil des ZIPs).

**Wiederherstellen aus einem ZIP:** Das ZIP ist eine ganz normale Archivdatei. Entpacke sie an einen beliebigen Ort und öffne den entpackten Ordner in Plainva als Vault — fertig.

## Einstellungen im Überblick

Einstellungen → **Vault** → **Backup & Versionierung**:

| Einstellung | Standard | Bedeutung |
|---|---|---|
| **Automatische Vault-Sicherung (ZIP)** | An | Tägliches ZIP im Hintergrund |
| **Zielordner** | App-Datenordner | Ablageort der ZIPs, frei wählbar |
| **Aufbewahrte Sicherungen** | 7 | So viele ZIPs bleiben erhalten |
| **Snapshot-Intervall** | 2 min | Höchstens so oft entsteht beim Tippen eine neue Datei-Version |
| **Versionen pro Datei** | 100 | Obergrenze je Datei |
| **Maximales Alter** | 90 Tage | Ältere Versionen werden endgültig entfernt |

## Gut zu wissen

- Die Datei-Versionen sind gewöhnliche Kopien unter `.plainva/backups/` — Du kannst sie zur Not auch ohne Plainva im Dateimanager öffnen.
- Plainvas eigener Sync überträgt `.plainva` nie. Synchronisierst Du den Vault-Ordner aber mit einem Drittanbieter-Client (z. B. der Nextcloud-App), wandern die Snapshots dort mit — das kostet etwas Speicher, schadet aber nicht.
- Sync-Konflikte sind zusätzlich über `.CONFLICT`-Dateien abgesichert (siehe [FAQ](FAQ.md)); der Versionsverlauf ergänzt das um die zeitliche Historie jeder Datei.
