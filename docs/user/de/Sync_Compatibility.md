# Plainva Sync-Kompatibilität

Stand: 2026-07-04 (aktualisiert nach der Integration von OneDrive, Dropbox und S3)

Plainva synchronisiert Vaults über austauschbare Sync-Adapter. Diese Seite zeigt, welche Dienste Du heute schon nutzen kannst — direkt integriert, über das WebDAV-Protokoll oder über den Desktop-Sync-Client des jeweiligen Anbieters.

## Direkt integriert

| Anbieter | Status | Hinweise |
|---|---|---|
| Lokaler Ordner | Verfügbar | Keine Einrichtung nötig; externe Änderungen (z. B. durch andere Sync-Tools) werden automatisch erkannt. |
| WebDAV / Nextcloud | Verfügbar, mit Nextcloud verifiziert | Server-URL, Benutzername und (empfohlen) App-Passwort. |
| Google Drive | Verfügbar (BYO-Credentials) | Eigenes Google-Cloud-Projekt nötig, siehe [Google-Drive-BYO-Anleitung](Google_Drive_BYO_Guide.md). |
| OneDrive | Verfügbar (neu 2026-07-04, native Abnahme ausstehend) | Anmeldung per Browser (PKCE, kein Secret). Bis Plainva eine eigene App-Registrierung ausliefert, brauchst Du eine eigene (kostenlose) Entra-App-Registrierung: Typ „Mobile und Desktopanwendungen", Redirect-URI `http://localhost`. |
| Dropbox | Verfügbar (neu 2026-07-04, native Abnahme ausstehend) | Anmeldung per Browser (PKCE, kein Secret). Bis Plainva eine eigene App ausliefert, brauchst Du eine eigene (kostenlose) Dropbox-App: Full-Dropbox-Zugriff, Redirect-URI exakt `http://127.0.0.1:41953`. |
| S3-kompatibler Object Storage | Verfügbar (neu 2026-07-04, native Abnahme ausstehend) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner u. a. — nur Endpoint, Bucket, Region und ein API-Schlüsselpaar nötig, keine Browser-Anmeldung. |

## Über WebDAV nutzbare Dienste

Der WebDAV-Adapter spricht Standard-WebDAV. Damit sollten unter anderem die folgenden Dienste funktionieren. Sie sind noch nicht einzeln verifiziert — Rückmeldungen sind willkommen. Die Adressen sind typische Muster; prüfe sie im Zweifel in der Dokumentation Deines Anbieters und nutze wenn möglich ein App-Passwort statt Deines Hauptpassworts.

| Dienst | Typische WebDAV-Adresse |
|---|---|
| Nextcloud (selbst gehostet oder bei einem Anbieter) | `https://<server>/remote.php/dav/files/<benutzer>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<benutzer>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<benutzer>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE Online-Speicher | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<benutzer>.your-storagebox.de` |
| Synology NAS | WebDAV-Server-Paket aktivieren, dann `https://<nas>:5006` |
| QNAP NAS | WebDAV im System aktivieren, Adresse laut QNAP-Doku |
| Seafile | SeafDAV aktivieren, dann `https://<server>/seafdav` |

## Über den Desktop-Sync-Client des Anbieters (lokaler Ordner)

Bis native Integrationen kommen, kannst Du jeden Dienst nutzen, dessen Desktop-Client einen lokalen Ordner synchron hält. Plainva behandelt den Vault dann als lokalen Ordner und erkennt externe Änderungen automatisch.

**Wichtig:** Stelle den Vault-Ordner auf „immer auf diesem Gerät behalten" / „offline verfügbar". Online-only-Platzhalterdateien (Files On-Demand, online-only, Streaming-Modus) können Indexierung und Sync stören.

- **OneDrive** (Explorer-Integration; Files On-Demand für den Vault-Ordner deaktivieren)
- **Dropbox** (Desktop-Client; „online-only" für den Vault-Ordner vermeiden)
- **Google Drive for Desktop** (Modus „Spiegeln" statt „Streamen" für den Vault-Ordner)
- **iCloud Drive** (iCloud für Windows bzw. macOS; Ordner auf „Immer behalten" setzen)
- **Syncthing / Resilio Sync** (P2P, ganz ohne Cloud-Anbieter)

## Hinweis zu den neuen Integrationen (2026-07-04)

OneDrive, Dropbox und S3-kompatibler Storage sind seit dem 2026-07-04 direkt integriert (siehe Tabelle oben) — früher als im Staging des Masterplans (§13.3) geplant. Sobald Plainva zentrale App-Registrierungen für OneDrive und Dropbox ausliefert, entfällt der Schritt mit der eigenen Client-ID bzw. dem eigenen App-Key; die Felder sind dann vorbefüllt. Der Desktop-Sync-Client-Weg (siehe oben) bleibt als Alternative bestehen.

## Bewusst nicht geplant

- **iCloud als API-Integration:** Apple bietet keine offizielle Drittanbieter-API für iCloud Drive. Nutze stattdessen den lokalen iCloud-Ordner (siehe oben).
- **Proton Drive / Mega:** keine offizielle bzw. nur schwer integrierbare API (E2E-Verschlüsselung, C++-SDK). Wird weiter beobachtet.
- **Watchlist** (bei Bedarf/Nachfrage): pCloud, Box, Filen, SFTP.
