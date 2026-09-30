# Compatibilità di sincronizzazione di Plainva

Ultimo aggiornamento: 2026-09-30

Se un servizio WebDAV, CalDAV o S3 restituisce una pagina di accesso o un inventario incompleto, Plainva segnala un errore di sincronizzazione. La risposta non viene interpretata come una cartella o un elenco di calendari vuoto e non determina eliminazioni dedotte dal suo contenuto. Questo vale sia su desktop sia su mobile.

Se un file locale non può essere caricato per un errore di autorizzazione o lettura, il tentativo e il relativo errore restano in coda. Ripristina l’accesso al file e riprova la sincronizzazione. Solo un file realmente mancante viene considerato assente; un errore di accesso non viene registrato come caricamento riuscito.

Le modifiche offline vengono conservate anche dopo più rinominazioni. Plainva completa gli spostamenti collegati prima di caricare il contenuto attuale; un errore trattiene le operazioni dipendenti. Se manca la sorgente remota, Plainva carica il file locale o il contenuto della cartella nella nuova posizione. I contenuti illeggibili restano in coda con un errore per un nuovo tentativo.

La conferma vale solo per l’eliminazione effettivamente eseguita. Rimane valida nei nuovi tentativi dopo errori di connessione o un riavvio; i nuovi file creati nella stessa posizione non la ereditano. La conferma aggiuntiva di un’eliminazione di massa sospesa e l’opzione di ripristino riguardano solo le operazioni mostrate. Le eliminazioni estese già in coda prima dell’aggiornamento potrebbero richiedere una nuova conferma.

Le voci di diario che due dispositivi aggiungono alla stessa nota giornaliera prima di essersi sincronizzati non sono un conflitto: Plainva le unisce per orario e mantiene ogni riga di entrambi i dispositivi — anche quando entrambi i dispositivi hanno creato la nota del giorno in modo indipendente. Ogni altra modifica simultanea a una nota viene gestita come prima. Vedi [Diario](Journal.md).

Una cartella che crei in Plainva viene creata nel cloud all'interno della cartella del vault. Fino alla versione 0.8.3, Plainva creava anche una cartella vuota con lo stesso nome al primo livello di Google Drive, OneDrive o Dropbox, oppure del bucket S3 quando il vault usa un prefisso. Plainva non rimuove queste copie da solo; dopo aver verificato che una di queste cartelle di primo livello è vuota e non fa parte della cartella del tuo vault, puoi eliminarla.

Se una nota è stata eliminata su questo dispositivo mentre qui c'è ancora un file il cui nome differisce solo nella scrittura degli accenti o tra maiuscole e minuscole (per esempio `Neutralität` scritto in due forme Unicode), Plainva non la elimina nemmeno nel cloud: molti servizi considerano i due nomi lo stesso file. Plainva mostra la coppia sotto **Due grafie, un solo file** e non elimina nulla; rinomina uno dei due e la sincronizzazione prosegue normalmente. Lo stesso vale per una cartella che il cloud ha già nell'altra grafia: Plainva non la crea una seconda volta.

Plainva sincronizza i vault tramite adattatori di sincronizzazione intercambiabili. Questa pagina mostra quali servizi puoi usare oggi — direttamente integrati, tramite il protocollo WebDAV, o tramite il client di sincronizzazione desktop del provider stesso.

## Integrati direttamente

| Provider | Stato | Note |
|---|---|---|
| Cartella locale | Disponibile | Nessuna configurazione necessaria; le modifiche esterne (ad es. di altri strumenti di sincronizzazione) vengono rilevate automaticamente. |
| WebDAV / Nextcloud | Disponibile, verificato con Nextcloud | URL del server, nome utente e (consigliata) una password dell'app. |
| Google Drive | Disponibile (credenziali BYO) | Richiede un tuo progetto Google Cloud, vedi la [guida Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Disponibile | Accesso tramite browser (PKCE, nessun secret). Plainva fornisce una propria registrazione dell'app — basta scegliere OneDrive e connettersi, senza alcuna configurazione. Usare una propria (gratuita) registrazione app Entra resta facoltativo (vedi la guida [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md)). |
| Dropbox | Disponibile | Accesso tramite browser (PKCE, nessun secret). Plainva fornisce una propria app Dropbox — basta scegliere Dropbox e connettersi, senza alcuna configurazione. Usare una propria (gratuita) app Dropbox resta facoltativo (vedi la guida [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md)). |
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

**Una sola via per cartella:** per una cartella del vault usa o il client desktop del provider o la sincronizzazione di Plainva, mai entrambi contemporaneamente. Due strumenti di sincronizzazione nella stessa cartella caricano ogni modifica due volte e possono creare cartelle doppie — per esempio quando uno scrive le lettere accentate in una forma Unicode diversa dall'altro.

- **OneDrive** (integrazione con Esplora file; disattiva Files On-Demand per la cartella del vault)
- **Dropbox** (client desktop; evita "solo online" per la cartella del vault)
- **Google Drive per desktop** (modalità "Mirror" invece di "Stream" per la cartella del vault)
- **iCloud Drive** (iCloud per Windows o macOS; imposta la cartella su "Mantieni scaricato")
- **Syncthing / Resilio Sync** (P2P, nessun provider cloud in assoluto)

## Nota sulle nuove integrazioni (2026-07-04)

OneDrive, Dropbox e l'archiviazione compatibile S3 sono state integrate direttamente dal 2026-07-04 (vedi la tabella sopra) — prima del previsto nella scaletta del piano generale (§13.3). Plainva fornisce già proprie registrazioni dell'app per OneDrive e Dropbox, quindi non serve un tuo ID client o una tua chiave dell'app — i campi arrivano precompilati e ti basta connetterti. Usare un proprio ID app resta facoltativo (ad es. per restrizioni aziendali); vedi la guida [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md). La via del client di sincronizzazione desktop (vedi sopra) resta disponibile come alternativa.

## Deliberatamente non previsti

- **iCloud come integrazione API:** Apple non offre un'API ufficiale di terze parti per iCloud Drive. Usa invece la cartella iCloud locale (vedi sopra).
- **Proton Drive / Mega:** nessuna API ufficiale o solo API difficili da integrare (crittografia E2E, SDK in C++). Tenuti sotto osservazione.
- **Lista di osservazione** (su richiesta): pCloud, Box, Filen, SFTP.
