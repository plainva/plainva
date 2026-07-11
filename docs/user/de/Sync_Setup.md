# Sync einrichten

Stand: 2026-07-11

Plainva synchronisiert jeden Vault optional mit einem Speicher Deiner Wahl — direkt aus der App, ohne Zusatzdienst von Plainva: Deine Daten laufen ausschließlich zwischen Deinem Rechner und Deinem eigenen Konto/Server. Diese Seite führt durch die Einrichtung je Anbieter.

Welche Dienste grundsätzlich funktionieren (auch über WebDAV oder den Desktop-Client des Anbieters), steht in der [Sync-Kompatibilität](Sync_Compatibility.md).

## Grundlagen

- Einrichtung unter **Einstellungen → Vault → Synchronisation**. Der **Sync Provider** wird pro Vault gewählt: **Keiner (Nur lokal)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** oder **S3-kompatibler Speicher** — immer genau einer pro Vault.
- **Neuen Online-Vault vom Startbildschirm einrichten**: **Online-Vault öffnen** führt Dich bei allen Anbietern gleich durch drei Schritte — **1. Verbinden** (Anmeldung bzw. Zugangsdaten eingeben), **2. Ordner in der Cloud wählen**, **3. lokalen Ordner wählen oder erstellen**. Alternativ richtest Du den Sync für einen bereits offenen Vault jederzeit unter Einstellungen ein.
- Lokale Speicherungen werden sofort hochgeladen; auf Remote-Änderungen prüft Plainva im eingestellten **Sync-Intervall (Sekunden)**.
- Offline-Änderungen werden in einer Warteschlange gesammelt und beim nächsten Kontakt übertragen; die Statusleiste zeigt **Online**/**Offline** und der Sync-Indikator den Zustand (**Jetzt synchronisieren** per Klick). Bei einem langen oder erstmaligen Sync zeigt die Statusleiste den Fortschritt als Zähler (z. B. **Sync 123/540**), damit Du siehst, dass sie den Vault abarbeitet.
- Wenn Du zum ersten Mal einen Online-Vault verbindest, weist ein einmaliger Hinweis darauf hin, dass die erste Synchronisierung je nach Vault-Größe etwas dauern kann — Du kannst dabei weiterarbeiten.
- Ändern beide Seiten dieselbe Datei, führt Plainva sie automatisch zusammen (3-Wege-Merge). Geht das nicht, wird Deine Version sicher als `.CONFLICT`-Datei bewahrt — nichts geht verloren (siehe [FAQ](FAQ.md)).
- **Konflikte lösen**: Ein Banner in der betroffenen Notiz (und **Konflikt lösen…** im Rechtsklick-Menü der `.CONFLICT`-Datei im Baum) öffnet den Vergleichsdialog — links der aktuelle Stand der Datei, rechts Deine gesicherte Version zum Bearbeiten und blockweisen Übernehmen. **Rechte Version speichern & auflösen** schreibt das Ergebnis in die Datei und räumt die Konfliktkopie auf; **Andere Seite behalten** verwirft Deine Kopie (ein Versions-Snapshot bleibt). Auch der Sync-Fehler-Dialog listet vorhandene Konfliktkopien und führt mit einem Klick in denselben Vergleich.
- **Schutz vor Massenlöschungen**: Sollen ungewöhnlich viele der synchronisierten Dateien auf einmal in der Cloud gelöscht werden (z. B. weil der lokale Vault-Ordner geleert oder verschoben wurde), hält Plainva die Löschungen an und fragt zuerst nach: **In der Cloud löschen** führt sie aus, **Nicht löschen (wiederherstellen)** verwirft sie und stellt die Dateien beim nächsten Sync aus der Cloud wieder her. Löschungen, die Du in Plainva selbst bestätigt hast, werden nicht angehalten – bei großen Löschungen (mehr als 10 Dateien oder mehr als 20 % des Vaults) fragt Plainva stattdessen schon vor dem Löschen ein zweites Mal nach.
- Anhänge (Bilder etc.) werden mitsynchronisiert.
- Zugangsdaten und Tokens landen im Schlüsselbund des Betriebssystems (Status: **Einstellungen → App → Über & Diagnose → OS-Keychain**), nie in Dateien im Vault.
- **Trennen** stoppt den Sync des Vaults; Dateien werden dadurch nirgends gelöscht.

## WebDAV / Nextcloud

Der einfachste Weg für eigene Server und die meisten Cloud-Speicher:

1. **Sync Provider** auf **WebDAV / Nextcloud** stellen.
2. **Server URL**, **Benutzername** und **Passwort oder App-Token** eintragen — nutze wenn möglich ein App-Passwort statt Deines Hauptpassworts (in Nextcloud: Einstellungen → Sicherheit → App-Passwörter).
3. Mit **Server durchsuchen** den Zielordner wählen, dann **Speichern**.

Typische Server-Adressen (Nextcloud, Koofr, MagentaCLOUD, Storage Box u. v. m.) findest Du in der [Sync-Kompatibilität](Sync_Compatibility.md).

## Google Drive

Google Drive läuft aktuell mit eigenen Zugangsdaten („Bring Your Own"): Du legst einmalig ein kostenloses eigenes Google-Cloud-Projekt an, das nur Dir gehört. Die Schritt-für-Schritt-Anleitung: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Kurzfassung: **Client ID** und **Client Secret** aus Deinem Google-Projekt eintragen, **Drive-Ordner (Name)** festlegen (Standard „Plainva"), **Mit Google verbinden** — die Anmeldung öffnet sich im Browser. Nach dem Verbinden wählst Du den Ordner über **Ordner auswählen…** direkt aus Deinem Drive (auch Unterordner), statt den Namen zu tippen. Hinweis: Im Testing-Modus des Google-Projekts läuft die Anmeldung nach 7 Tagen ab und muss per **Neu verbinden** erneuert werden.

## OneDrive

Plainva liefert eine eigene App-Registrierung mit — Du musst **keine eigene ID mehr anlegen**:

1. **Sync Provider** auf **OneDrive** stellen; optional **OneDrive-Ordner (Name)** festlegen (Standard „Plainva").
2. **Mit Microsoft verbinden** und die Anmeldung im Browser bestätigen. Fertig — Plainva legt den Ordner an und synchronisiert seinen gesamten Inhalt, auch extern hinzugefügte Dateien.
3. Optional: Nach dem Verbinden wählst Du den Zielordner über **Ordner auswählen…** direkt aus Deinem OneDrive (auch Unterordner), statt den Namen zu tippen.

Optional: Über **Eigene App-ID verwenden** kannst Du stattdessen eine selbst registrierte Client-ID hinterlegen (z. B. bei Firmen-Sperren). Ausführliche Anleitung: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva liefert eine eigene Dropbox-App mit — **keine eigene App nötig**:

1. **Sync Provider** auf **Dropbox** stellen; optional **Dropbox-Ordner (Pfad)** festlegen (Standard `/Plainva`).
2. **Mit Dropbox verbinden** und im Browser bestätigen. Fertig.
3. Optional: Nach dem Verbinden wählst Du den Zielordner über **Ordner auswählen…** direkt aus Deiner Dropbox (auch Unterordner), statt den Pfad zu tippen.

Optional: Über **Eigene App-ID verwenden** kannst Du stattdessen einen selbst registrierten App-Key hinterlegen. Ausführliche Anleitung: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-kompatibler Speicher

Für AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner u. a. — schlüsselbasiert, ganz ohne Browser-Anmeldung:

| Feld | Bedeutung |
|---|---|
| **Endpoint** | Basis-URL der S3-API, z. B. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` oder `http://127.0.0.1:9000` für lokales MinIO |
| **Bucket** | Name des Buckets |
| **Region** | SigV4-Region; `us-east-1` funktioniert für die meisten Nicht-AWS-Speicher, Cloudflare R2 nutzt `auto` |
| **Access Key ID** / **Secret Access Key** | Ein API-Schlüsselpaar des Anbieters |
| **Key-Präfix (optional)** | Unterordner im Bucket für den Vault; leer = Bucket-Wurzel |
| **Path-Style-URLs** | Empfohlen (MinIO, R2 und die meisten Kompatiblen); nur für virtual-hosted AWS-Buckets deaktivieren |

Den **Key-Präfix** kannst Du auch über **Ordner auswählen…** direkt aus dem Bucket wählen — das funktioniert schon vor dem Speichern, sobald Endpoint, Bucket und Schlüssel eingetragen sind.

Nach **Übernehmen** startet der Sync direkt.

## Siehe auch

- [Sync-Kompatibilität](Sync_Compatibility.md) — welche Dienste wie funktionieren, inkl. Desktop-Client-Weg
- [FAQ & Fehlerbehebung](FAQ.md) — Konfliktdateien, Offline-Verhalten
