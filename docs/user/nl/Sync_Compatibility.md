# Plainva Sync-compatibiliteit

Laatst bijgewerkt: 2026-07-08 (OneDrive en Dropbox leveren nu centrale app-ID's mee — geen eigen app-registratie meer nodig)

Plainva synchroniseert vaults via verwisselbare sync-adapters. Deze pagina toont welke diensten je vandaag al kunt gebruiken — rechtstreeks geïntegreerd, via het WebDAV-protocol, of via de eigen desktop-sync-client van de provider.

## Rechtstreeks geïntegreerd

| Provider | Status | Opmerkingen |
|---|---|---|
| Lokale map | Beschikbaar | Geen installatie nodig; externe wijzigingen (bijv. door andere sync-tools) worden automatisch herkend. |
| WebDAV / Nextcloud | Beschikbaar, geverifieerd met Nextcloud | Server-URL, gebruikersnaam en (aanbevolen) een app-wachtwoord. |
| Google Drive | Beschikbaar (BYO-credentials) | Vereist een eigen Google Cloud-project, zie de [Google Drive BYO-handleiding](Google_Drive_BYO_Guide.md). |
| OneDrive | Beschikbaar | Aanmelding via browser (PKCE, geen secret). Plainva levert een eigen app-registratie mee — kies gewoon OneDrive en verbind, geen configuratie nodig. Een eigen (gratis) Entra-app-registratie gebruiken blijft optioneel (zie de [OneDrive & Dropbox BYO-handleiding](OneDrive_and_Dropbox_BYO_Guide.md)). |
| Dropbox | Beschikbaar | Aanmelding via browser (PKCE, geen secret). Plainva levert een eigen Dropbox-app mee — kies gewoon Dropbox en verbind, geen configuratie nodig. Een eigen (gratis) Dropbox-app gebruiken blijft optioneel (zie de [OneDrive & Dropbox BYO-handleiding](OneDrive_and_Dropbox_BYO_Guide.md)). |
| S3-compatibele objectopslag | Beschikbaar (nieuw 2026-07-04, native goedkeuring nog in behandeling) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner en andere — alleen een endpoint, bucket, regio en een API-sleutelpaar nodig, geen browseraanmelding. |

## Diensten bruikbaar via WebDAV

De WebDAV-adapter spreekt standaard WebDAV, dus de volgende diensten zouden onder andere moeten werken. Ze zijn nog niet afzonderlijk geverifieerd — feedback is welkom. De adressen zijn typische patronen; controleer ze in de documentatie van je provider en gebruik indien mogelijk een app-wachtwoord in plaats van je hoofdwachtwoord.

| Dienst | Typisch WebDAV-adres |
|---|---|
| Nextcloud (zelf gehost of bij een provider) | `https://<server>/remote.php/dav/files/<gebruiker>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<gebruiker>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<gebruiker>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online-opslag | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<gebruiker>.your-storagebox.de` |
| Synology NAS | Schakel het WebDAV Server-pakket in, dan `https://<nas>:5006` |
| QNAP NAS | Schakel WebDAV in het systeem in; adres volgens QNAP-documentatie |
| Seafile | Schakel SeafDAV in, dan `https://<server>/seafdav` |

## Via de desktop-sync-client van de provider (lokale map)

Tot native integraties beschikbaar zijn, kun je elke dienst gebruiken waarvan de desktop-client een lokale map synchroon houdt. Plainva behandelt de vault dan als een lokale map en herkent externe wijzigingen automatisch.

**Belangrijk:** stel de vault-map in op "altijd op dit apparaat behouden" / "offline beschikbaar". Online-only-placeholderbestanden (Files On-Demand, online-only, streamingmodus) kunnen indexering en sync verstoren.

- **OneDrive** (Explorer-integratie; schakel Files On-Demand uit voor de vault-map)
- **Dropbox** (desktop-client; vermijd "online-only" voor de vault-map)
- **Google Drive for Desktop** (modus "Spiegelen" in plaats van "Streamen" voor de vault-map)
- **iCloud Drive** (iCloud voor Windows of macOS; stel de map in op "Altijd behouden")
- **Syncthing / Resilio Sync** (P2P, helemaal zonder cloudprovider)

## Opmerking over de nieuwe integraties (2026-07-04)

OneDrive, Dropbox en S3-compatibele opslag zijn sinds 2026-07-04 rechtstreeks geïntegreerd (zie de tabel hierboven) — eerder dan gepland in de fasering van het masterplan (§13.3). Plainva levert eigen app-registraties voor OneDrive en Dropbox mee, dus je hebt geen eigen client-ID of app-key nodig — de velden zijn al vooraf ingevuld en je hoeft alleen te verbinden. Een eigen app-ID gebruiken blijft optioneel (bijvoorbeeld bij zakelijke restricties); zie de [OneDrive & Dropbox BYO-handleiding](OneDrive_and_Dropbox_BYO_Guide.md). De route via de desktop-sync-client (zie hierboven) blijft beschikbaar als alternatief.

## Bewust niet gepland

- **iCloud als API-integratie:** Apple biedt geen officiële externe API voor iCloud Drive. Gebruik in plaats daarvan de lokale iCloud-map (zie hierboven).
- **Proton Drive / Mega:** geen officiële, of alleen moeilijk te integreren API (E2E-versleuteling, C++-SDK). Wordt verder gevolgd.
- **Watchlist** (op aanvraag): pCloud, Box, Filen, SFTP.
