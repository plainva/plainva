# Configurare la sincronizzazione

Ultimo aggiornamento: 2026-07-21

Plainva sincronizza facoltativamente ogni vault con uno storage a tua scelta — direttamente dall'app, senza alcun servizio gestito da Plainva in mezzo: i tuoi dati viaggiano esclusivamente tra il tuo computer e il tuo account/server. Questa pagina illustra la configurazione per provider.

Quali servizi funzionano in generale (anche tramite WebDAV o il client desktop del provider) è trattato in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Nozioni di base

- La configurazione si trova in **Impostazioni → Vault → Account cloud**: **Collega account…** apre l'assistente — scegli prima il **provider**, poi spunta i **servizi** (per la sincronizzazione dei file: **File**), poi accedi. La panoramica a schede elenca i provider in base alla diffusione reale; con **Cerca provider…** trovi anche i provider di posta disponibili come preimpostazione. **Esattamente un** account per vault porta il servizio **File**. L'area **Sincronizzazione** mostra quindi l'account collegato con la sua **Cartella cloud** e gestisce il comportamento (**Intervallo di sincronizzazione**, coda); **Gestisci account** riporta agli account cloud.
- Per il servizio **File**, oltre a **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Archiviazione a oggetti (S3)** e il generico **WebDAV / CalDAV**, le schede includono anche **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** e **pCloud**: lì basta il tuo indirizzo e-mail più una **Password per app** — gli indirizzi del server sono già precompilati (basato su WebDAV; modificabile tramite **Avanzate: imposta gli endpoint singolarmente**).
- **Apri un vault online esistente dalla schermata di benvenuto**: **Apri vault** → **Vault online** ti guida attraverso gli stessi tre passaggi per ogni provider — **1. Connetti** (accedi o inserisci le credenziali), **2. Scegli la cartella nel cloud** (lì puoi anche crearne una nuova tramite **Nuova cartella**), **3. Scegli o crea la cartella locale**. In alternativa, puoi configurare la sincronizzazione per un vault già aperto in qualsiasi momento nelle Impostazioni.
- **Crea un nuovo vault nel cloud**: **Nuovo vault** → **Presso un servizio online** — scegli prima la struttura iniziale (vuota o un modello come PARA), poi connettiti e scegli la cartella di destinazione nel cloud o creala tramite **Nuova cartella**, infine la cartella locale. La struttura viene creata nella cartella locale e caricata automaticamente alla prima sincronizzazione.
- I salvataggi locali vengono caricati immediatamente; Plainva controlla le modifiche remote all'**Intervallo di sincronizzazione (secondi)** configurato.
- Le modifiche offline vengono messe in coda e trasferite al prossimo contatto; la barra di stato mostra **Online**/**Offline** e l'indicatore di sincronizzazione mostra lo stato (**Sincronizza ora** al clic). Durante una sincronizzazione lunga o alla prima connessione, la barra di stato mostra l'avanzamento come contatore (ad es. **Sync 123/540**), così vedi che sta elaborando l'intero vault.
- La prima volta che colleghi un vault online, un avviso una tantum ricorda che la sincronizzazione iniziale può richiedere del tempo a seconda delle dimensioni del vault — nel frattempo puoi continuare a lavorare.
- Se entrambe le parti modificano lo stesso file, Plainva le unisce automaticamente (unione a tre vie). Se non è possibile, la tua versione viene preservata in sicurezza come file `.CONFLICT` — non si perde mai nulla (vedi [FAQ](FAQ.md)).
- **Risoluzione dei conflitti**: un banner nella nota interessata (e **Risolvi conflitto…** nel menu contestuale del file `.CONFLICT` nell'albero) apre la finestra di dialogo di confronto — lo stato attuale del file a sinistra, la tua versione preservata a destra, modificabile con la ripresa dei singoli blocchi. **Salva la versione destra e risolvi** scrive il risultato nel file e rimuove la copia di conflitto; **Mantieni l'altra parte** scarta la tua copia (resta uno snapshot nella cronologia versioni). Anche la finestra di dialogo degli errori di sincronizzazione elenca le copie di conflitto esistenti e porta con un clic allo stesso confronto.
- **Protezione dalle eliminazioni di massa**: se una quota insolitamente grande dei file sincronizzati sta per essere eliminata nel cloud in una sola volta (ad esempio perché la cartella locale del vault è stata svuotata o spostata), Plainva sospende le eliminazioni e chiede prima conferma: **Elimina nel cloud** le esegue, **Non eliminare (ripristina)** le scarta e ripristina i file dal cloud alla prossima sincronizzazione. Le eliminazioni che hai confermato tu stesso in Plainva non vengono trattenute — per le eliminazioni grandi (più di 10 file o più del 20% del vault) Plainva chiede invece una seconda conferma prima di eliminare.
- Vengono sincronizzati anche gli allegati (immagini ecc.).
- **Le cartelle vuote** si sincronizzano anch'esse: una cartella creata in Plainva appare subito nel cloud, e le cartelle vuote nel cloud compaiono sui tuoi altri dispositivi al più tardi con il successivo elenco completo.
- Le credenziali e i token sono memorizzati nel portachiavi del sistema operativo (stato: **Impostazioni → App → Informazioni e diagnostica → Portachiavi del sistema operativo**), mai in file dentro il vault.
- **Disconnetti** interrompe la sincronizzazione del vault; nessun file viene eliminato da nessuna parte facendo questo.

## WebDAV / Nextcloud

La via più semplice per server autogestiti e la maggior parte degli storage cloud:

1. In **Account cloud** → **Collega account…** scegli la scheda **Nextcloud** (o **WebDAV / CalDAV**).
2. Inserisci l'**Indirizzo del server**, il **Nome utente** e la **Password o token dell'app** — usa una password dell'app invece della tua password principale quando possibile (in Nextcloud: Impostazioni → Sicurezza → Password delle app).
3. **Collega** verifica le credenziali; scegli poi la **Cartella cloud** tramite **Scegli cartella…**.

Particolarità **Nextcloud**: UN solo modulo copre file **e** calendario — Plainva deriva gli endpoint WebDAV e CalDAV direttamente dall'indirizzo del server (gli indirizzi derivati vengono mostrati nell'assistente; **Avanzate: imposta gli endpoint singolarmente** consente URL separati). Spunta entrambi i servizi e un solo passaggio li collega entrambi.

Gli indirizzi tipici dei server (Nextcloud, Koofr, MagentaCLOUD, Storage Box e molti altri) sono elencati in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Google Drive

Google Drive funziona attualmente con le tue credenziali ("Bring Your Own"): crei una volta un progetto Google Cloud gratuito, di tua proprietà esclusiva. La guida passo dopo passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versione breve: in **Account cloud** → **Collega account…**, scegli la scheda **Google**, spunta il servizio **File**, inserisci l'**ID client** e il **Secret client** dal tuo progetto Google, poi **Accedi con Google…** — l'accesso si apre nel tuo browser. Una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo Drive (sottocartelle incluse, predefinita "Plainva"). Nota: finché il progetto Google è in modalità di test, l'accesso scade dopo 7 giorni e va rinnovato tramite **Riconnetti** nei dettagli dell'account.

## OneDrive

Plainva fornisce una propria registrazione dell'app — **non devi più crearne una tua**:

1. In **Account cloud** → **Collega account…**, scegli la scheda **Microsoft** e spunta il servizio **File** (OneDrive) — se vuoi, insieme a **Calendario e attività** ed **E-mail** (un account Microsoft può portare tutti e tre i servizi).
2. **Accedi con Microsoft…** e conferma l'accesso nel browser. Fatto — Plainva crea la cartella (predefinita "Plainva") e ne sincronizza l'intero contenuto, inclusi i file aggiunti dall'esterno.
3. Facoltativo: una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo OneDrive (sottocartelle incluse).

Facoltativo: tramite **Usa il tuo ID applicazione** puoi invece fornire un ID client registrato da te (ad es. per restrizioni aziendali). Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Dropbox

Plainva fornisce una propria app Dropbox — **non serve un'app tua**:

1. In **Account cloud** → **Collega account…**, scegli la scheda **Dropbox** (porta solo il servizio **File**).
2. **Accedi con Dropbox…** e conferma nel browser. Fatto (cartella predefinita `/Plainva`).
3. Facoltativo: una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo Dropbox (sottocartelle incluse).

Facoltativo: tramite **Usa il tuo ID applicazione** puoi invece fornire una App Key registrata da te. Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## Archiviazione compatibile S3

Per AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner e altri — basata su chiavi, nessun accesso tramite browser. In **Account cloud** → **Collega account…**, scegli la scheda **Archiviazione a oggetti (S3)** e compila i campi:

| Campo | Significato |
|---|---|
| **Endpoint** | URL di base dell'API S3, ad es. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` oppure `http://127.0.0.1:9000` per MinIO locale |
| **Bucket** | Nome del bucket |
| **Regione** | Regione SigV4; `us-east-1` funziona per la maggior parte degli storage non AWS, Cloudflare R2 usa `auto` |
| **Access Key ID** / **Secret Access Key** | Una coppia di chiavi API dal provider |
| **Prefisso chiave (opzionale)** | Sottocartella nel bucket per il vault; vuoto = radice del bucket |
| **URL in stile path** | Consigliato (MinIO, R2 e la maggior parte dei servizi compatibili); disattiva solo per i bucket AWS in modalità virtual-hosted |

Puoi scegliere il **Prefisso chiave** (la cartella cloud) tramite **Scegli cartella…** direttamente dal bucket una volta connesso.

Dopo **Collega**, la sincronizzazione parte subito.

## Vedi anche

- [Compatibilità di sincronizzazione](Sync_Compatibility.md) — quali servizi funzionano e come, inclusa la via del client desktop
- [FAQ e risoluzione dei problemi](FAQ.md) — file in conflitto, comportamento offline

## Crittografia di sincronizzazione (passphrase)

> **Sostituito in P3:** Le istruzioni seguenti non valgono più per il contenuto. Usa [Sicurezza e condivisione](Security_and_Sharing.md). La passphrase rimasta qui protegge solo impostazioni e segreti opzionali.

Plainva può cifrare ciò che lascia il tuo dispositivo verso il server di sincronizzazione, mentre il tuo vault locale resta sempre in Markdown semplice, leggibile da Obsidian.

Apri **Impostazioni → Sincronizzazione → Passphrase di sincronizzazione e crittografia**:

1. **Imposta una passphrase.** Questo crea una chiave di cifratura per il vault e mostra un **codice di ripristino** monouso — conservalo in un luogo sicuro; è l'unico modo per rientrare se dimentichi la passphrase. Da quel momento, le **impostazioni** sincronizzate del vault viaggiano cifrate.
2. **Cifra il contenuto del vault** (facoltativo). Il pulsante **Cifra** ricarica ogni nota sul server di sincronizzazione come testo cifrato. I tuoi file locali restano in Markdown semplice, quindi un vault locale non corre mai rischi — provalo prima su un vault usa e getta. Al termine del caricamento, usa **Completa migrazione** per accettare da quel momento solo testo cifrato.
3. **Su un altro dispositivo**, apri lo stesso vault sincronizzato. Plainva rileva che il vault è cifrato e chiede la passphrase (o il codice di ripristino). Dopo lo sblocco, le note vengono decifrate e appaiono localmente.

La chiave sbloccata viene memorizzata nella cache su ogni dispositivo. Attiva **Richiedi la passphrase a ogni avvio** per reinserirla invece dopo ogni riavvio, e usa **Blocca** per rimuovere la chiave in cache da questo dispositivo.

**Sincronizza impostazioni** trasferisce le impostazioni condivise del vault e i metadati degli account; percorsi locali, layout e dati di runtime restano specifici del dispositivo. **Sincronizza segreti degli account** è un’opzione separata per password delle app e credenziali BYO consentite; i token OAuth non vengono mai condivisi. Lo stato della crittografia guida attraverso **Preparazione**, **Migrazione**, **Rigido**, **Decrittografia** e **Rotazione della chiave**. I dispositivi mobili possono sbloccare lo stesso vault cifrato con la passphrase.
