# Configurare la sincronizzazione

Ultimo aggiornamento: 2026-10-26

Plainva sincronizza facoltativamente ogni vault con uno storage a tua scelta — direttamente dall'app, senza alcun servizio gestito da Plainva in mezzo: i tuoi dati viaggiano esclusivamente tra il tuo computer e il tuo account/server. Questa pagina illustra la configurazione per provider.

Quali servizi funzionano in generale (anche tramite WebDAV o il client desktop del provider) è trattato in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Confronta le versioni conservate

Quando un conflitto di testo non può essere unito automaticamente, rimane aperta una sola copia di lavoro locale per originale. Le modifiche successive vengono salvate nella stessa copia, anche dopo aver riaperto la nota o riavviato l’app. L’avviso spiega: **Stai modificando la tua copia in conflitto. Verrà sincronizzata dopo l’unione.**

Nel confronto, **Confronta le versioni conservate** mostra la versione iniziale salvata, se disponibile. Se la copia di lavoro viene modificata fuori da questa sessione, anche l’altra versione viene conservata e può essere confrontata. Adozione, conservazione di entrambe e scarto ricontrollano i file attuali; ricarica il confronto se non è più aggiornato. Risolvi il conflitto prima di spostare o eliminare il file interessato o la sua cartella. Le vecchie copie in conflitto restano elencate separatamente.

Finché un conflitto è aperto, il resto dell’app continua a lavorare con la nota. Una modifica fatta fuori dall’editor — una cella di un database, un’attività spuntata, una voce di diario, un collegamento che segue una nota rinominata — viene scritta nella nota e anche nella tua copia in conflitto, quindi resta qualunque versione tu tenga. Se la tua copia non ha più il punto a cui la modifica appartiene (ad esempio un’attività che lì hai riformulato), la copia resta come l’hai lasciata e il confronto mostra la differenza. Se un altro dispositivo modifica lo stesso punto della nota stessa prima che il tuo dispositivo l’abbia caricata, il testo proprio della nota non va perso: resta come un’ulteriore copia in conflitto accanto alla nota.

L’esportazione diagnostica include anche i conflitti recenti: tipo di archiviazione, origine della scrittura, confronto degli hash e differenze nei terminatori di riga, nel BOM o nell’ultimo a capo. Questi dati non contengono testo delle note né nomi di file. L’esportazione è sempre in inglese, qualunque sia la lingua dell’app, così puoi incollarla così com’è in una segnalazione su GitHub.

## Nozioni di base

- La configurazione si trova in **Impostazioni → Vault → Account cloud**: **Collega account…** apre l'assistente — scegli prima il **provider**, poi spunta i **servizi** (per la sincronizzazione dei file: **File**), poi accedi. La panoramica a schede elenca i provider in base alla diffusione reale; con **Cerca provider…** trovi anche i provider di posta disponibili come preimpostazione. **Esattamente un** account per vault porta il servizio **File**. L'area **Sincronizzazione** mostra quindi l'account collegato e tiene ciò che vale per l'intero vault (cifratura, sincronizzazione delle impostazioni, coda, diagnostica); **Cartella cloud e intervallo di questo account** porta alla pagina **File** dell'account con la **Cartella cloud**, l'**Intervallo di sincronizzazione (secondi)**, lo stato della sincronizzazione e **Sospendi la sincronizzazione**. Appena il servizio **File** è collegato, l'assistente chiede una volta la **cartella cloud** — per ogni provider, con **Nuova cartella** direttamente nel selettore; **Sfoglia** resta la via per tornarci. Con WebDAV la cartella fa parte dell'indirizzo del server, quindi lì non c'è selettore.
- Per il servizio **File**, oltre a **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Archiviazione a oggetti (S3)** e il generico **WebDAV / CalDAV**, le schede includono anche **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** e **pCloud**: lì basta il tuo indirizzo e-mail più una **Password per app** — gli indirizzi del server sono già precompilati (basato su WebDAV; modificabile tramite **Avanzate: imposta gli endpoint singolarmente**).
- **Apri un vault online esistente dalla schermata di benvenuto**: **Apri vault** → **Vault online** ti guida attraverso gli stessi tre passaggi per ogni provider — **1. Connetti** (accedi o inserisci le credenziali), **2. Scegli la cartella nel cloud** (lì puoi anche crearne una nuova tramite **Nuova cartella**), **3. Scegli o crea la cartella locale**. In alternativa, puoi configurare la sincronizzazione per un vault già aperto in qualsiasi momento nelle Impostazioni. Con Google Drive e OneDrive, il passaggio 1 ti fa accedere con l'**Accesso su questo dispositivo** — lo stesso di **Account cloud** — e il vault riceve subito lì il suo account.
- **Crea un nuovo vault nel cloud**: **Nuovo vault** → **Presso un servizio online** — scegli prima la struttura iniziale (vuota o un modello come PARA), poi connettiti e scegli la cartella di destinazione nel cloud o creala tramite **Nuova cartella**, infine la cartella locale. La struttura viene creata nella cartella locale e caricata automaticamente alla prima sincronizzazione.
- I salvataggi locali vengono caricati immediatamente; Plainva controlla le modifiche remote all'**Intervallo di sincronizzazione (secondi)** configurato.
- Le modifiche offline vengono messe in coda e trasferite al prossimo contatto; la barra di stato mostra **Online**/**Offline** e l'indicatore di sincronizzazione mostra lo stato (**Sincronizza ora** al clic). Durante una sincronizzazione lunga o alla prima connessione, la barra di stato mostra l'avanzamento come contatore (ad es. **Sync 123/540**), così vedi che sta elaborando l'intero vault.
- Se entrambe le parti modificano lo stesso file, Plainva le unisce automaticamente (unione a tre vie). Se non è possibile, la tua versione viene preservata in sicurezza come file `.CONFLICT` — non si perde mai nulla (vedi [FAQ](FAQ.md)).
- **Risoluzione dei conflitti**: un banner nella nota interessata (e **Risolvi conflitto…** nel menu contestuale del file `.CONFLICT` nell'albero) apre la finestra di dialogo di confronto — lo stato attuale del file a sinistra, la tua versione preservata a destra, modificabile con la ripresa dei singoli blocchi. **Salva la versione destra e risolvi** scrive il risultato nel file e rimuove la copia di conflitto; **Mantieni l'altra parte** scarta la tua copia (resta uno snapshot nella cronologia versioni). Anche la finestra di dialogo degli errori di sincronizzazione elenca le copie di conflitto esistenti e porta con un clic allo stesso confronto.
- **Protezione dalle eliminazioni di massa**: se una quota insolitamente grande dei file sincronizzati sta per essere eliminata nel cloud in una sola volta (ad esempio perché la cartella locale del vault è stata svuotata o spostata), Plainva sospende le eliminazioni e chiede prima conferma: **Elimina nel cloud** le esegue, **Non eliminare (ripristina)** le scarta e ripristina i file dal cloud alla prossima sincronizzazione. Le eliminazioni che hai confermato tu stesso in Plainva non vengono trattenute — per le eliminazioni grandi (più di 10 file o più del 20% del vault) Plainva chiede invece una seconda conferma prima di eliminare.
- **Eliminato nel cloud, modificato qui**: se un altro dispositivo ha eliminato un file nel cloud mentre questo dispositivo aveva ancora modifiche non caricate, Plainva non lo elimina. Conserva il file, lo carica di nuovo come file nuovo e ti dice una volta di quale file si tratta. Se vuoi davvero eliminarlo, eliminalo di nuovo qui. Vale su desktop e su mobile.
- Vengono sincronizzati anche gli allegati (immagini ecc.).
- **Le cartelle vuote** si sincronizzano anch'esse: una cartella creata in Plainva appare subito nel cloud, e le cartelle vuote nel cloud compaiono sui tuoi altri dispositivi al più tardi con il successivo elenco completo.
- Le credenziali e i token sono memorizzati nel portachiavi del sistema operativo (stato: **Impostazioni → App → Informazioni e diagnostica → Portachiavi del sistema operativo**), mai in file dentro il vault.
- **Accessi salvati** (**Impostazioni → Vault → Sincronizzazione**) mostra ciò che Plainva ha depositato nel portachiavi, comprese voci di vault che non apri più da tempo. Ogni riga indica il servizio e il vault; **Rimuovi** chiede conferma. Plainva non cancella mai nulla qui di propria iniziativa.
- Le voci del portachiavi hanno **nomi leggibili** — `plainva · <vault> · <servizio> · <id account> · #<impronta>` invece di una stringa base64. Plainva rinomina le voci esistenti una sola volta, alla prima apertura di un vault; se una rinomina non può concludersi in sicurezza, la voce vecchia resta dov'è e Plainva riprova alla prossima apertura.
- **Sospendi la sincronizzazione** (nella pagina **File** dell'account) interrompe la sincronizzazione del vault su questo dispositivo; nessun file viene eliminato da nessuna parte facendo questo, e una volta riattivata riprende da dove si era fermata.
- **`http://` è consentito, `https://` è la raccomandazione.** Un server che gestisci tu stesso sulla tua rete di solito parla `http` in chiaro — funziona, anche sul telefono. Su internet non dovresti: WebDAV invia la tua password a **ogni** richiesta, in chiaro tramite `http`. Se inserisci un indirizzo non cifrato al di fuori della tua rete, Plainva te lo segnala nel modulo — ma non te lo impedisce.

## WebDAV / Nextcloud

La via più semplice per server autogestiti e la maggior parte degli storage cloud:

1. In **Account cloud** → **Collega account…** scegli la scheda **Nextcloud** (o **WebDAV / CalDAV**).
2. Inserisci l'**Indirizzo del server**, il **Nome utente** e la **Password o token dell'app** — usa una password dell'app invece della tua password principale quando possibile (in Nextcloud: Impostazioni → Sicurezza → Password delle app).
3. **Collega** verifica le credenziali; scegli poi la **Cartella cloud** tramite **Scegli cartella…**. Anche qui si può creare una **nuova cartella** — come ovunque Plainva scelga una cartella cloud, anche sul telefono sotto **Cambia cartella cloud**.

Particolarità **Nextcloud**: UN solo modulo copre file **e** calendario — Plainva deriva gli endpoint WebDAV e CalDAV direttamente dall'indirizzo del server (gli indirizzi derivati vengono mostrati nell'assistente; **Avanzate: imposta gli endpoint singolarmente** consente URL separati). Spunta entrambi i servizi e un solo passaggio li collega entrambi.

Gli indirizzi tipici dei server (Nextcloud, Koofr, MagentaCLOUD, Storage Box e molti altri) sono elencati in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

**L'indirizzo punta alla cartella del vault stessa.** Tutto ciò che si trova sotto appartiene al vault, quindi un indirizzo un livello troppo in alto trascina con sé anche le cartelle vicine. Con WebDAV la cartella fa parte dell'indirizzo del server: per spostare il vault in seguito, riconnetti l'account.

Le modifiche della password vengono prima verificate con tutti i servizi interessati protetti da password. Se il salvataggio viene interrotto, le modifiche confermate vengono mantenute. Riapri l’account e scegli **Continua il salvataggio**. L’operazione protetta resta disponibile dopo un riavvio. Se il collegamento dell’account o le credenziali sono cambiati, scegli **Verifica di nuovo la password** per controllare la password attuale nei servizi ora associati. Le credenziali mancanti non vengono ignorate. Un nuovo accesso al calendario viene usato anche alla successiva apertura di un vault precedentemente chiuso.

Una nuova connessione al calendario resta associata al vault in cui l’hai avviata. Se lo chiudi o cambi vault durante la verifica, avvia nuovamente la connessione in quel vault. Se non è possibile leggere le credenziali esistenti, l’unione si interrompe e conserva gli account precedenti.

## Google Drive

Google Drive accede con **Accesso su questo dispositivo**. Per impostazione predefinita è l'**Accesso standard**: se la tua build lo include, non devi inserire nulla. Se non lo include, Plainva lo dice e ti chiede il tuo **ID client personale** — quello di un client di un progetto Google Cloud gratuito tutto tuo, di tua proprietà esclusiva ("Bring Your Own"). La guida passo dopo passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versione breve: in **Account cloud** → **Collega account…**, scegli la scheda **Google**, spunta il servizio **File**, poi **Accedi con Google…** — l'accesso si apre nel tuo browser. Con un ID client personale lo inserisci prima nella procedura, sotto **Altro accesso**: sul desktop l'**ID client** e il **Secret client** di un client di tipo "App desktop", sul telefono solo l'**ID client** di un client di tipo "iOS". Una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo Drive (sottocartelle incluse, predefinita "Plainva"). Nota: finché il tuo progetto Google personale è in modalità **Test**, l'accesso scade dopo **7 giorni** — definitivamente, perché in questa modalità Google lascia scadere anche il refresh token, quindi Plainva non può rinnovarlo in background. La sincronizzazione ti dice allora che l'accesso è scaduto, e **Riconnetti** nei dettagli dell'account lo ripristina — un unico passaggio per **tutti** i servizi di quell'account. **In produzione** elimina la scadenza fissa della modalità di test. Non garantisce un accesso permanente: Google può comunque far scadere o revocare l’accesso. I requisiti di pubblicazione e verifica dipendono dall’uso e dai permessi richiesti. [Google: scadenza dei token di aggiornamento](https://developers.google.com/identity/protocols/oauth2#expiration).

Se selezioni **File** e **Calendario e attività** insieme durante la connessione, Google chiede il consenso una **sola volta**, richiedendo esattamente i permessi dei servizi scelti. Aggiungendo un altro servizio in seguito, il consenso viene chiesto di nuovo, per tutto ciò che l'account porta più il nuovo servizio.

## OneDrive

Plainva fornisce un proprio accesso per Microsoft (**Accesso standard**) — **non ti serve un ID tuo**:

1. In **Account cloud** → **Collega account…**, scegli la scheda **Microsoft** e spunta il servizio **File** (OneDrive) — se vuoi, insieme a **Calendario e attività** ed **E-mail** (un account Microsoft può portare tutti e tre i servizi).
2. **Accedi con Microsoft…** e conferma l'accesso nel browser. Fatto — Plainva crea la cartella (predefinita "Plainva") e ne sincronizza l'intero contenuto, inclusi i file aggiunti dall'esterno.
3. Facoltativo: una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo OneDrive (sottocartelle incluse).

Facoltativo: in **Accesso su questo dispositivo** → **Cambia** → **ID client personale** puoi invece inserire l'ID applicazione (client) di una registrazione dell'app tua (ad es. per restrizioni aziendali) — solo per questo dispositivo. Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

**Un solo accesso per tutti i servizi.** Per **Microsoft** e **Google**, collegare un account, attivarvi un altro servizio e **Riconnetti** sono lo stesso passo: il provider chiede il consenso una **sola volta**, per tutto ciò che l'account porta più ciò che aggiungi, e Plainva mantiene un unico accesso per l'intero account. Poi ogni servizio mostra il proprio esito — attivo, oppure **Non autorizzato: la casella non era selezionata all’accesso. Accedi di nuovo e seleziona il servizio.** se hai tolto la sua spunta nella schermata di consenso del provider; accedendo di nuovo e spuntandolo si risolve. Un servizio che fallisce non blocca gli altri. Se colleghi un account che il vault ha già, Plainva aggiunge i servizi a quell'account invece di crearne un secondo, e lo dice. Il passo di accesso della procedura mostra solo ciò di cui questo provider ha bisogno per i servizi scelti: per Google e Microsoft un pulsante, **Accedi con Google…** oppure **Accedi con Microsoft…**, con l'accesso standard; il tuo ID client personale — e, per Google, solo quando è scelto **E-mail**, **E-mail con password per le app** — stanno ripiegati sotto **Altro accesso**. Per una casella e-mail i server stanno dietro **Avanzate: imposta gli endpoint singolarmente** non appena l'indirizzo indica un provider noto; per Dropbox la chiave dell'app personale è sotto **Altro accesso**. **Riconnetti** con un account diverso da quello mostrato viene rifiutato e non cambia nulla.

La procedura porta con sé il provider scelto **in ogni passo**: i passi 2 e 3 aprono subito il modulo giusto (il modulo del calendario Google invece di una scelta del provider, Gmail invece di un modulo IMAP generico) e non chiedono mai di nuovo chi volevi collegare. Ciò che un passo ha già raccolto è già presente nel successivo: con Nextcloud, Plainva ricava l'indirizzo CalDAV dall'indirizzo del server del passo 1, e una password di suite si digita una volta invece di tre. Questi dati vivono in memoria solo per la durata della procedura; non vengono salvati da nessuna parte e spariscono quando finisce — anche se la chiudi con **Esci dalla procedura**.

Gli account che conservano ancora un accesso per ogni servizio da una versione precedente lo indicano nella propria pagina. **Riconnetti** copre tutti i servizi dell'account — sul desktop come nell'[app mobile](Mobile_App.md): un unico passaggio, e da quel momento tutti i servizi condividono lo stesso accesso. Non è solo comodità: accessi separati potevano disallinearsi tra loro, lasciando un servizio in funzione mentre un altro dello stesso account era già scaduto in silenzio.

**Gmail nell'account Google.** Quando l'accesso su questo dispositivo consente la posta, Gmail fa parte dello stesso consenso e la casella è legata all'account Google. Quando non la consente — **Accesso standard** senza l'approvazione di Google per la posta — attivare **E-mail** nell'account Google chiede lì una **Password per app**, sotto **Gmail con password per app**: sullo stesso account, mai come secondo account. Accedere di nuovo a Google conserva una tale password per app. Outlook mantiene separati gli accessi salvati e le connessioni di ogni vault, anche quando lo stesso profilo account è presente in più vault. Vale sia su desktop sia su dispositivi mobili.

File, calendario e posta di Outlook richiedono ciascuno le proprie autorizzazioni. Una sincronizzazione dei file funzionante non significa quindi che anche il calendario o la casella di posta siano autorizzati. Plainva controlla i permessi di ogni servizio; se ne manca uno, accedi di nuovo e concedi l’accesso necessario. I nomi equivalenti delle autorizzazioni Google vengono riconosciuti.

**Accesso su questo dispositivo.** Con quale accesso un dispositivo accede a Google o Microsoft si imposta per dispositivo, non per l'intero account — gli altri dispositivi mantengono la propria impostazione. Lo vedi e lo cambi nella pagina dell'account (desktop: **Impostazioni → il tuo vault → Account cloud** → l'account → **Accesso su questo dispositivo** → **Cambia**; telefono: l'account in **Account cloud** → la riga **Accesso su questo dispositivo**) e nella procedura, sotto **Altro accesso**. L'**Accesso standard** è quello predefinito ogni volta che la tua build lo include; allora non inserisci nulla. L'**ID client personale** richiede, per Google sul desktop, l'**ID client** e il **Secret client** di un client di tipo "App desktop"; sul telefono (Android e iPhone) l'**ID client** di un client di tipo "iOS" con il bundle ID `com.plainva.app`, senza secret; per Microsoft l'ID applicazione (client) della tua registrazione dell'app. Se la tua build non ha un accesso standard per Google, Plainva lo dice e ti chiede il tuo ID client personale. Accedendo di nuovo si usa l'impostazione di questo dispositivo. La riga indica con cosa accede questo dispositivo: **Accesso standard** oppure **ID client personale** con gli ultimi sei caratteri dell'ID client, ad esempio «(…a1b2c3)».

**Verifica connessione.** Ogni pagina account offre **Verifica connessione** — una finestra di dialogo sul desktop, un foglio sul telefono. Ogni servizio legge qualcosa di piccolo e mostra **Funziona**, **Accesso non eseguito**, **Accesso scaduto: accedi di nuovo**, **Non consentito: accedi di nuovo e spunta il servizio** oppure l'errore a parole. Ogni riga che non funziona porta la propria azione: **Accedi**, **Riconnetti** (per un account con password apre la password) oppure **Concedi l’autorizzazione**. Quando Google rifiuta Gmail — l'autorizzazione non è stata concessa, l'app non è verificata o il progetto ha raggiunto il limite di utenti —, la riga e-mail propone anche **Collega con password per le app**: Gmail passa allora via IMAP con una password per le app, sullo stesso account, e la casella rifiutata lascia il posto a questa. Se il fornitore rifiuta l'ID client personale di questo dispositivo perché è stato eliminato o non è autorizzato, la riga lo dice e propone **Usa l’accesso standard** quando la tua build include l'accesso standard. L'esito viene registrato nella diagnostica.

**Accesso necessario, uscire, rimuovere.** Un account Google o Microsoft mostra, nell'elenco e nella propria pagina, lo stato del suo unico accesso su questo dispositivo. **Accesso necessario** significa che questo dispositivo non ha eseguito l'accesso per l'account; accanto c'è **Accedi**. Se dice **accesso scaduto**, l'accesso non vale più; accanto c'è **Riconnetti**. **Esci da questo dispositivo** elimina l'accesso di questo dispositivo — per un account con password, la password salvata qui — l'account, i suoi servizi e le impostazioni restano, gli altri dispositivi restano connessi e presso il fornitore non viene revocato nulla; poi l'account mostra **Accesso necessario**, e **Accedi** chiede di nuovo la password. **Rimuovi account…** toglie l'account con tutti i suoi servizi dal vault, su tutti i dispositivi, dopo una conferma — la domanda dice cosa se ne va (i servizi di questo account, gli accessi su tutti i dispositivi, la sua cache del calendario) e cosa resta (ogni nota, anche le e-mail archiviate e le note degli eventi; presso il fornitore non viene eliminato nulla). Il vault e le sue note restano.

**La pagina dell'account.** Ogni account — Google, Microsoft, Dropbox, iCloud, Nextcloud/WebDAV, S3, una casella e-mail o **Su questo dispositivo** — ha la stessa pagina nello stesso ordine, sul desktop e sul telefono: (1) l'**intestazione** con l'unico stato dell'account, **Collegato**, **Accesso necessario** o **Scaduto**, e solo quando serve il suo pulsante **Accedi** o **Riconnetti**; (2) i **servizi** **File**, **Calendario e attività** ed **E-mail**, ciascuno con un interruttore, una riga di stato e una freccia verso la pagina di questo account per quel servizio; (3) **Accesso su questo dispositivo** — l'accesso per Google e Microsoft, la chiave dell'app per Dropbox, server, utente e password per un account con password, le chiavi per S3, il permesso di sistema per **Su questo dispositivo**; (4) **Verifica connessione**; (5) la fine con **Esci da questo dispositivo** e **Rimuovi account…**. Ciò che un provider non può fare manca, senza mai essere spostato altrove. Un interruttore spento ferma il servizio per il vault su tutti i dispositivi; la connessione, la cache del calendario e le e-mail archiviate restano, e una volta riacceso riprende da dove si era fermato.

**La pagina di un servizio di un account.** La freccia accanto a un servizio apre ciò che appartiene a questo account: per **File** la **Cartella cloud**, l'**Intervallo di sincronizzazione (secondi)**, lo stato della sincronizzazione e **Sospendi la sincronizzazione** (solo questo dispositivo); per **Calendario e attività** i calendari e gli elenchi attività dell'account con i loro interruttori, il colore proprio di un calendario (colora solo questo vault; il provider tiene il suo) e il **Calendario predefinito**; per **E-mail** le cartelle, i mittenti e la firma. Ogni pagina porta alle impostazioni che tutti gli account condividono: **Sincronizzazione**, **Calendario** ed **E-mail** sotto il tuo vault tengono ciò che vale per tutti gli account — promemoria, cartella riunioni, regole, risposta automatica, cartella di archiviazione.

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

**Account su tutti i tuoi dispositivi** sono tre passaggi. **1 · Impostazioni e account**: mette le impostazioni del vault *e i tuoi account* (calendari, caselle di posta, selezione dei calendari) in un piccolo file nel vault — finché non è configurata alcuna passphrase non ne serve **nessuna**; non appena esiste, ogni dispositivo deve inserirla prima che le impostazioni viaggino da lì. Questo passaggio è **attivo per impostazione predefinita** — impostazioni e account non sono segreti; puoi disattivarlo per singolo vault in qualsiasi momento. **2 · Passphrase di sincronizzazione** (facoltativo): serve solo se devono viaggiare anche gli accessi; cifra inoltre le impostazioni del passaggio 1. **3 · Portare gli accessi**: porta inoltre le password statiche IMAP e CalDAV, cifrate, e si può attivare solo quando il passaggio 1 è in funzione e la passphrase è sbloccata — una password può raggiungere solo un account che il dispositivo già conosce. Non vengono portati: i percorsi specifici del dispositivo e gli accessi OAuth (Microsoft, Google); i loro token sono legati al dispositivo, quindi l’account compare sul nuovo dispositivo e lì richiede una volta **Accedi**.

Sul **telefono** trovi la stessa catena nella pagina del vault, con gli stessi tre passaggi e lo stesso blocco. Gli account che arrivano da un altro dispositivo vengono creati lì; non devi più inserirli a mano. Con **Prendi ora da un altro dispositivo** li ottieni subito invece di attendere il giro successivo.

Se Plainva segnala che una **versione precedente continua a pubblicare dati account ritirati**, aggiorna Plainva su ogni dispositivo che usa questo vault. Il dispositivo attuale ignora le vecchie credenziali client Google e mantiene l’accesso locale funzionante. Non confermare la rimozione dei vecchi dati remoti finché tutti i dispositivi partecipanti non sono stati aggiornati. Plainva offre il pulsante nell'avviso sotto **Impostazioni → Vault → Sincronizzazione → Diagnostica**: **Rimuovi le voci dismesse** — la domanda che pone è esattamente questa conferma.

Dove avviene questo **accesso** dipende dal servizio: una casella mostra il pulsante **Accedi su questo dispositivo** sulla propria riga nell'area **E-mail**, un account di calendario o file lo fa in **Account cloud**. Una casella Microsoft porta sempre a **Account cloud**, perché il suo accesso avviene nel browser.

Se imposti la cifratura **da zero**, il passo 3 è attivo fin dall'inizio — altrimenti ogni ulteriore dispositivo resterebbe senza accessi in modo permanente. Per un vault che usi già non cambia nulla in silenzio: Plainva chiede una volta e ricorda la tua risposta.

Se un account compare come **due schede**, Plainva non è riuscita a recuperare l'identità dal provider — e non deve tirare a indovinare. Apri una delle due in **Account cloud** e usa **Unisci** per dire che è lo stesso account; Plainva mostra prima che cosa verrà mantenuto.

Se **Calendario** elenca due righe per lo stesso calendario, Plainva lo segnala e **non** le unisce da sola: unirle costerebbe la selezione del calendario e il collegamento alle attività rispecchiate. Controlla quale riga porta la tua selezione e rimuovi l'altra.

Un account che rimuovi resta rimosso: l'eliminazione viaggia tramite la sincronizzazione delle impostazioni verso i tuoi altri dispositivi, invece di tornare da lì al giro successivo.

## Che cosa viaggia e che cosa resta qui

Se in **Account cloud** appare **Controlla gli account duplicati**, Plainva non decide intenzionalmente in base al nome. Scegli **Mantieni questo account** sulla scheda corretta. La conferma indica destinazione, origini e servizi interessati e crea prima un backup su questo dispositivo. **Annulla** non modifica nulla. L’unione rimuove solo account locali, cache e credenziali orfani; nulla viene eliminato presso il provider.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Viaggia con l'archivio | Resta su questo dispositivo |
| --- | --- |
| Account — calendari, caselle di posta, account cloud, segnalibri | Percorsi assoluti — posizione dell'archivio, destinazione dei backup |
| Cartelle e modelli — note del giorno, cartella dei modelli, cartella Inbox, cartella degli allegati, database delle attività | Token di accesso Microsoft e Google |
| Impostazioni del calendario — cartella delle riunioni, calendario predefinito | Quale casella e quale cartella hai aperto per ultime |
| Impostazioni della posta — cartella di archiviazione, immagini remote | La disposizione iniziale di questo dispositivo per i nuovi archivi |
| Regole di backup — intervallo degli snapshot, conservazione, archivi | Password statiche — a meno che il passo 3 non sia attivo |
| Intervallo di sincronizzazione |  |
| Disposizione delle barre (desktop) |  |

Il telefono ne porta un po' meno: la disposizione delle quattro barre **desktop** resta sul computer — la sua barra di navigazione viaggia comunque, così come la cartella delle riunioni. La sua catena sulla pagina dell'archivio mostra che cosa porta, e sotto entrambi i dispositivi dicono che cosa ha fatto davvero la sincronizzazione per ultimo, con i nomi delle impostazioni che hanno viaggiato e, in una ricezione, quelle che sono cambiate. L'avviso «Impostazioni adottate da un altro dispositivo» compare al massimo una volta per sessione e solo se qualcosa è cambiato davvero; dopo, sono queste righe a dirlo. Nuovo da questa versione: il telefono adotta anche il formato del nome delle note del giorno, il tipo OKF delle nuove note e i tuoi segnalibri. Prima, un archivio impostato su un altro formato di data otteneva una seconda nota del giorno per lo stesso giorno non appena il telefono lo toccava.

La diagnostica separa ora **ultimo controllo** (campi del profilo locale), **ultimo download**, **ultima applicazione** e **ultimo invio effettivo**. “Inviato” cambia solo dopo una scrittura nel cloud riuscita; i cicli invariati aggiornano quindi controllo e download, ma non l’orario di invio. Gli esiti dei segreti sono separati come conteggi di importati, invariati, rifiutati, obsoleti, in errore o in attesa di un account. Contengono solo codici motivo stabili — mai ID account, password, token o errori grezzi. Un avviso di client precedente indica che Plainva va aggiornato su tutti i dispositivi partecipanti; questo dispositivo ignora i dati Google client ritirati.

**Le cancellazioni viaggiano.** Una cancellazione che hai confermato resta 90 giorni in un registro (`.plainva/sync/deletions.json`) e viene replicata su ogni altro dispositivo senza domande, anche dopo un riavvio e anche se lì mancano molti file insieme. Se invece nel cloud mancano molti file senza che il registro li spieghi, Plainva ferma la replica e chiede: **applicare le cancellazioni** o **tenerle in locale** (in tal caso ricarica i file come nuovi). Lo stesso vale per gli elenchi attività: una cancellazione eseguita presso il fornitore rimuove la nota attività anche sull’altro dispositivo, purché lì sia invariata. Prima di chiedere — e prima di togliere qui anche un solo file — Plainva verifica direttamente con il cloud: chiede uno per uno un campione dei file mancanti. Se anche uno solo c'è, l'elenco del cloud era incompleto: non viene eliminato nulla, nessuno viene interpellato e lo stato della sincronizzazione mostra **Il cloud ha risposto in modo incompleto: non è stato eliminato nulla** con **Controlla di nuovo**. Una voce del registro viene scritta solo dopo che un file è risultato davvero assente ed è stato tolto qui, e una voce il cui file ricompare nel cloud viene ritirata; **Controlla il registro delle eliminazioni**, in **Informazioni e diagnostica**, lo fa su richiesta. Se la cartella cloud di un vault già sincronizzato non viene trovata, Plainva non crea più un sostituto vuoto ma lo segnala: a quel punto scegli la cartella esistente.

## Errori e nuovo tentativo automatico

La finestra conserva l’esatto tentativo fallito anche se un nuovo tentativo automatico ha già cambiato lo stato in tempo reale. Mostra se il tentativo è in corso o riuscito. La riconnessione è consigliata solo per errori di autenticazione; gli errori di rete, timeout e provider mantengono i dettagli e vengono riprovati automaticamente. Anche la sincronizzazione delle impostazioni attende gli errori temporanei: un timeout compare dapprima come una nota discreta con un contatore e diventa un messaggio rosso solo dopo il terzo errore consecutivo; un accesso scaduto, invece, subito.

## Nomi che differiscono solo nella grafia

Google Drive non distingue maiuscole e minuscole durante la ricerca, e Windows e macOS salvano `Nota.md` e `nota.md` nello stesso file. Inoltre, lo stesso carattere può essere memorizzato in due modi: `ü` come un solo carattere, oppure come `u` seguita da dieresi. Per questa **grafia** Plainva intende ora lo stesso file e continua a sincronizzare normalmente, finché esiste una sola corrispondenza.

Se invece due nomi differiscono per **maiuscole e minuscole**, sono due file. Plainva non modifica né elimina nulla e mostra la scheda **Due grafie, un solo file** con entrambi i nomi: su mobile nella pagina del vault, sul desktop nelle impostazioni di sincronizzazione. Tutti gli altri file continuano a essere sincronizzati. Rinomina una delle due note e la scheda scompare da sola.

Il nuovo accesso non copre tutti i servizi. I tuoi accessi precedenti sono stati conservati. Accedi di nuovo e autorizza tutti i servizi elencati. Il collegamento dell’account è cambiato. Apri le impostazioni attuali dell’account e accedi di nuovo.

## Google Drive: download incompleti

Quando Google Drive limita temporaneamente le richieste, Plainva riprova il download dopo una pausa. Un download fallito non viene considerato un file mancante o una modifica completata. Il contenuto locale e lo stato di sincronizzazione confermato restano intatti; il ciclo successivo riprova la modifica in sospeso. Gli altri file scaricati restano disponibili. I permessi mancanti e gli altri rifiuti permanenti compaiono come errori con il percorso del file e la causa. Vale su desktop e dispositivi mobili.

## Trasferimenti di file interrotti

I limiti di tempo coprono anche la ricezione dei file da WebDAV, Dropbox, OneDrive, S3 e Google Drive. Se una risposta ricevuta a blocchi smette di fornire dati, Plainva termina quel tentativo e ripete le letture un numero limitato di volte con una nuova richiesta. Il progresso mantiene attivo il download anche quando l’intero file richiede più del tempo di base. Le richieste mobili native hanno anche limiti propri. Un download incompleto non sostituisce mai il file locale esistente e non conferma l’avanzamento della sincronizzazione. I caricamenti grandi mantengono un tempo proporzionato alla dimensione; un esito incerto viene gestito dalla normale ripresa della sincronizzazione, senza inviarlo di nuovo alla cieca.

<!-- accounts-tasks-2026-09-11 -->
## Amplia gli account esistenti

Aggiungi file, calendario o email all’account che deve portarli. Per Google e Microsoft è un unico consenso per tutto ciò che l’account porta più il nuovo servizio.

Apri **Account cloud**, scegli l’account esistente e attiva il servizio mancante (sul telefono: **Aggiungi**). I servizi esistenti restano collegati, e un servizio che fallisce non blocca gli altri. Gmail si unisce all’accesso Google quando l’accesso su questo dispositivo consente la posta; altrimenti Plainva chiede una password per app sullo stesso account. Annullare l’assistente non scollega i servizi completati. Il trasferimento mobile mantiene il vault di origine e considera un vault di destinazione corrispondente o prepara un contenitore separato. I file in collisione vengono confrontati singolarmente e si conservano entrambi i contenuti. Le destinazioni cifrate si aprono tramite il percorso di abbinamento esistente.

Quando aggiungi file sul dispositivo mobile, Plainva mostra origine, destinazione e collisioni prima del trasferimento. Contenuti e servizi esistenti vengono conservati; un trasferimento interrotto può essere ripetuto.

<!-- http-platform-trust-2026-09-14 -->
## Certificati per server autogestiti

Android considera attendibili anche le autorità di certificazione installate nelle impostazioni di sistema. Vale per tutte le connessioni Plainva che usano questa configurazione, non solo per un server WebDAV. Sul desktop, HTTP usa le autorità di sistema e le radici pubbliche; iOS usa le proprie impostazioni di attendibilità. La validità e il nome del server vengono ancora verificati. Correggi i certificati scaduti, non ancora validi o di un altro server. Plainva non permette mai di accettare tutti i certificati. Se il sistema non specifica la causa, Plainva segnala la verifica fallita senza supposizioni. La diagnostica HTTP mobile contiene metodo e codice di errore, senza credenziali, nomi dei certificati o percorsi privati.

<!-- workspace-retry-2026-09-14 -->
## Tentativi automatici e cronologia di sincronizzazione mancante

La connessione è temporaneamente non disponibile. Plainva riproverà automaticamente; le modifiche in attesa restano su questo dispositivo.

Accedi di nuovo all’account di sincronizzazione. Le modifiche in attesa restano su questo dispositivo finché l’accesso non viene ripristinato.

Plainva non può verificare il vault cifrato. La sincronizzazione è sospesa; i dati locali e le modifiche in attesa vengono conservati. Apri Sicurezza e condivisione, ripristina una copia verificabile se disponibile, poi verifica di nuovo.

Su un dispositivo che conserva la cronologia completa e verificabile, scegli Sincronizza ora. Plainva può ripristinare le operazioni firmate mancanti da quella copia. Poi verifica di nuovo su Plainva. Se non esiste una copia valida, conserva o esporta i dati locali; la verifica non viene mai reimpostata per aggirare la lacuna.

I file di annotazioni non cifrati di altri dispositivi restano sul server. Solo il dispositivo di origine può completare la conversione. Plainva non elimina i file di altri dispositivi.

<!-- account-grants-destination-2026-09-14 -->
Un accesso viene adottato solo dopo aver verificato identità, permessi effettivamente concessi e archiviazione sicura. Aggiungere un servizio fa accedere l’account una sola volta per tutti i suoi servizi; se nessuno è autorizzato, gli accessi funzionanti restano come erano. Un altro dispositivo richiede un proprio accesso.

Nelle impostazioni di sincronizzazione, il selettore Google Drive mostra la destinazione attuale e l’anteprima della cartella scelta. Apri cartelle omonime e confronta file e date. «Usa questa destinazione» salva l’ID univoco della cartella. Se diventa inaccessibile, Plainva segnala l’errore senza creare una sostituta. Le altre cartelle non vengono spostate né eliminate.
