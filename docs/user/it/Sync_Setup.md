# Configurare la sincronizzazione

Stand: 2026-07-06

Plainva sincronizza facoltativamente ogni vault con uno storage a tua scelta — direttamente dall'app, senza alcun servizio gestito da Plainva in mezzo: i tuoi dati viaggiano esclusivamente tra il tuo computer e il tuo account/server. Questa pagina illustra la configurazione per provider.

Quali servizi funzionano in generale (anche tramite WebDAV o il client desktop del provider) è trattato in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Nozioni di base

- La configurazione si trova in **Impostazioni → Impostazioni del vault → Sincronizzazione cloud**. Il **Provider di sincronizzazione** viene scelto per vault: **Nessuno (solo locale)**, **WebDAV / Nextcloud**, **Google Drive**, **OneDrive**, **Dropbox** o **Archiviazione compatibile S3** — sempre esattamente uno per vault.
- I salvataggi locali vengono caricati immediatamente; Plainva controlla le modifiche remote all'**Intervallo di sincronizzazione (secondi)** configurato.
- Le modifiche offline vengono messe in coda e trasferite al prossimo contatto; la barra di stato mostra **Online**/**Offline** e l'indicatore di sincronizzazione mostra lo stato (**Sincronizza ora** al clic).
- Se entrambe le parti modificano lo stesso file, Plainva le unisce automaticamente (unione a tre vie). Se non è possibile, la tua versione viene preservata in sicurezza come file `.CONFLICT` — non si perde mai nulla (vedi [FAQ](FAQ.md)).
- **Risoluzione dei conflitti**: un banner nella nota interessata (e **Risolvi conflitto…** nel menu contestuale del file `.CONFLICT` nell'albero) apre la finestra di dialogo di confronto — lo stato attuale del file a sinistra, la tua versione preservata a destra, modificabile con la ripresa dei singoli blocchi. **Salva la versione destra e risolvi** scrive il risultato nel file e rimuove la copia di conflitto; **Mantieni l'altra parte** scarta la tua copia (resta uno snapshot nella cronologia versioni). Anche la finestra di dialogo degli errori di sincronizzazione elenca le copie di conflitto esistenti e porta con un clic allo stesso confronto.
- Vengono sincronizzati anche gli allegati (immagini ecc.).
- Le credenziali e i token sono memorizzati nel portachiavi del sistema operativo (stato: **Impostazioni → Diagnostica di sistema → Portachiavi del sistema operativo**), mai in file dentro il vault.
- **Disconnetti** interrompe la sincronizzazione del vault; nessun file viene eliminato da nessuna parte facendo questo.

## WebDAV / Nextcloud

La via più semplice per server autogestiti e la maggior parte degli storage cloud:

1. Imposta il **Provider di sincronizzazione** su **WebDAV / Nextcloud**.
2. Inserisci l'**URL del server**, il **Nome utente** e la **Password o token dell'app** — usa una password dell'app invece della tua password principale quando possibile (in Nextcloud: Impostazioni → Sicurezza → Password delle app).
3. Scegli la cartella di destinazione tramite **Sfoglia il server**, poi **Salva**.

Gli indirizzi tipici dei server (Nextcloud, Koofr, MagentaCLOUD, Storage Box e molti altri) sono elencati in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Google Drive

Google Drive funziona attualmente con le tue credenziali ("Bring Your Own"): crei una volta un progetto Google Cloud gratuito, di tua proprietà esclusiva. La guida passo dopo passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versione breve: inserisci l'**ID client** e il **Secret client** dal tuo progetto Google, imposta la **Cartella Drive (nome)** (predefinita "Plainva"), poi **Connetti a Google** — l'accesso si apre nel tuo browser. Una volta connesso, scegli la cartella tramite **Scegli cartella…** direttamente dal tuo Drive (sottocartelle incluse) invece di digitarne il nome. Nota: finché il progetto Google è in modalità di test, l'accesso scade dopo 7 giorni e va rinnovato tramite **Riconnetti**.

## OneDrive

Plainva fornisce una propria registrazione dell'app — **non devi più crearne una tua**:

1. Imposta il **Provider di sincronizzazione** su **OneDrive**; facoltativamente imposta la **Cartella OneDrive (nome)** (predefinita "Plainva").
2. **Connetti a Microsoft** e conferma l'accesso nel browser. Fatto — Plainva crea la cartella e ne sincronizza l'intero contenuto, inclusi i file aggiunti dall'esterno.
3. Facoltativo: una volta connesso, scegli la cartella di destinazione tramite **Scegli cartella…** direttamente dal tuo OneDrive (sottocartelle incluse) invece di digitarne il nome.

Facoltativo: tramite **Usa il tuo ID applicazione** puoi invece fornire un ID client registrato da te (ad es. per restrizioni aziendali). Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva fornisce una propria app Dropbox — **non serve un'app tua**:

1. Imposta il **Provider di sincronizzazione** su **Dropbox**; facoltativamente imposta la **Cartella Dropbox (percorso)** (predefinita `/Plainva`).
2. **Connetti a Dropbox** e conferma nel browser. Fatto.
3. Facoltativo: una volta connesso, scegli la cartella di destinazione tramite **Scegli cartella…** direttamente dal tuo Dropbox (sottocartelle incluse) invece di digitarne il percorso.

Facoltativo: tramite **Usa il tuo ID applicazione** puoi invece fornire una App Key registrata da te. Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Archiviazione compatibile S3

Per AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e altri — basata su chiavi, nessun accesso tramite browser:

| Campo | Significato |
|---|---|
| **Endpoint** | URL di base dell'API S3, ad es. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` oppure `http://127.0.0.1:9000` per MinIO locale |
| **Bucket** | Nome del bucket |
| **Regione** | Regione SigV4; `us-east-1` funziona per la maggior parte degli storage non AWS, Cloudflare R2 usa `auto` |
| **Access Key ID** / **Secret Access Key** | Una coppia di chiavi API dal provider |
| **Prefisso chiave (opzionale)** | Sottocartella nel bucket per il vault; vuoto = radice del bucket |
| **URL in stile path** | Consigliato (MinIO, R2 e la maggior parte dei servizi compatibili); disattiva solo per i bucket AWS in modalità virtual-hosted |

Puoi anche scegliere il **Prefisso chiave** tramite **Scegli cartella…** direttamente dal bucket — questo funziona già prima del salvataggio, non appena endpoint, bucket e chiavi sono compilati.

Dopo **Applica**, la sincronizzazione parte subito.

## Vedi anche

- [Compatibilità di sincronizzazione](Sync_Compatibility.md) — quali servizi funzionano e come, inclusa la via del client desktop
- [FAQ e risoluzione dei problemi](FAQ.md) — file in conflitto, comportamento offline
