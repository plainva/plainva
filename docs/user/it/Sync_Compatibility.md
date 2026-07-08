# Compatibilità di sincronizzazione di Plainva

Stand: 2026-07-04 (aggiornato dopo le integrazioni di OneDrive, Dropbox e S3)

Plainva sincronizza i vault tramite adattatori di sincronizzazione intercambiabili. Questa pagina mostra quali servizi puoi usare oggi — direttamente integrati, tramite il protocollo WebDAV, o tramite il client di sincronizzazione desktop del provider stesso.

## Integrati direttamente

| Provider | Stato | Note |
|---|---|---|
| Cartella locale | Disponibile | Nessuna configurazione necessaria; le modifiche esterne (ad es. di altri strumenti di sincronizzazione) vengono rilevate automaticamente. |
| WebDAV / Nextcloud | Disponibile, verificato con Nextcloud | URL del server, nome utente e (consigliata) una password dell'app. |
| Google Drive | Disponibile (credenziali BYO) | Richiede un tuo progetto Google Cloud, vedi la [guida Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Disponibile (nuovo 2026-07-04, accettazione nativa in sospeso) | Accesso tramite browser (PKCE, nessun secret). Finché Plainva non fornirà una propria registrazione dell'app, ne serve una tua (gratuita) registrazione app Entra: tipo "Applicazioni mobili e desktop", URI di reindirizzamento `http://localhost`. |
| Dropbox | Disponibile (nuovo 2026-07-04, accettazione nativa in sospeso) | Accesso tramite browser (PKCE, nessun secret). Finché Plainva non fornirà una propria app, ne serve una tua (gratuita) app Dropbox: accesso full-Dropbox, URI di reindirizzamento esattamente `http://127.0.0.1:41953`. |
| Archiviazione a oggetti compatibile S3 | Disponibile (nuovo 2026-07-04, accettazione nativa in sospeso) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e altri — bastano un endpoint, un bucket, una regione e una coppia di chiavi API; nessun accesso tramite browser. |

## Servizi utilizzabili tramite WebDAV

L'adattatore WebDAV parla WebDAV standard, quindi dovrebbero funzionare anche i seguenti servizi, tra gli altri. Non sono stati ancora verificati singolarmente — i riscontri sono benvenuti. Gli indirizzi sono schemi tipici; verificali nella documentazione del tuo provider e usa una password dell'app invece della tua password principale quando possibile.

| Servizio | Indirizzo WebDAV tipico |
|---|---|
| Nextcloud (autogestito o con un provider) | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | Abilita il pacchetto WebDAV Server, poi `https://<nas>:5006` |
| QNAP NAS | Abilita WebDAV nel sistema; indirizzo secondo la documentazione QNAP |
| Seafile | Abilita SeafDAV, poi `https://<server>/seafdav` |

## Tramite il client di sincronizzazione desktop del provider (cartella locale)

Finché non arrivano le integrazioni native, puoi usare qualsiasi servizio il cui client desktop mantenga sincronizzata una cartella locale. Plainva tratta allora il vault come una cartella locale e rileva automaticamente le modifiche esterne.

**Importante:** imposta la cartella del vault su "mantieni sempre su questo dispositivo" / "disponibile offline". I file segnaposto solo online (Files On-Demand, solo online, modalità streaming) possono interferire con l'indicizzazione e la sincronizzazione.

- **OneDrive** (integrazione con Esplora file; disattiva Files On-Demand per la cartella del vault)
- **Dropbox** (client desktop; evita "solo online" per la cartella del vault)
- **Google Drive per desktop** (modalità "Mirror" invece di "Stream" per la cartella del vault)
- **iCloud Drive** (iCloud per Windows o macOS; imposta la cartella su "Mantieni scaricato")
- **Syncthing / Resilio Sync** (P2P, nessun provider cloud in assoluto)

## Nota sulle nuove integrazioni (2026-07-04)

OneDrive, Dropbox e l'archiviazione compatibile S3 sono state integrate direttamente dal 2026-07-04 (vedi la tabella sopra) — prima del previsto nella scaletta del piano generale (§13.3). Non appena Plainva fornirà registrazioni centrali dell'app per OneDrive e Dropbox, il passaggio con un proprio ID client o chiave dell'app scomparirà; i campi verranno precompilati. La via del client di sincronizzazione desktop (vedi sopra) resta disponibile come alternativa.

## Deliberatamente non previsti

- **iCloud come integrazione API:** Apple non offre un'API ufficiale di terze parti per iCloud Drive. Usa invece la cartella iCloud locale (vedi sopra).
- **Proton Drive / Mega:** nessuna API ufficiale o solo API difficili da integrare (crittografia E2E, SDK in C++). Tenuti sotto osservazione.
- **Lista di osservazione** (su richiesta): pCloud, Box, Filen, SFTP.
