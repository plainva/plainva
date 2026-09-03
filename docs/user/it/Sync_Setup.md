# Configurare la sincronizzazione

Ultimo aggiornamento: 2026-09-03

Plainva sincronizza facoltativamente ogni vault con uno storage a tua scelta — direttamente dall'app, senza alcun servizio gestito da Plainva in mezzo: i tuoi dati viaggiano esclusivamente tra il tuo computer e il tuo account/server. Questa pagina illustra la configurazione per provider.

Quali servizi funzionano in generale (anche tramite WebDAV o il client desktop del provider) è trattato in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

## Nozioni di base

- La configurazione si trova in **Impostazioni → Vault → Account cloud**: **Collega account…** apre l'assistente — scegli prima il **provider**, poi spunta i **servizi** (per la sincronizzazione dei file: **File**), poi accedi. La panoramica a schede elenca i provider in base alla diffusione reale; con **Cerca provider…** trovi anche i provider di posta disponibili come preimpostazione. **Esattamente un** account per vault porta il servizio **File**. L'area **Sincronizzazione** mostra quindi l'account collegato con la sua **Cartella cloud** e gestisce il comportamento (**Intervallo di sincronizzazione**, coda); **Gestisci account** riporta agli account cloud.
- Per il servizio **File**, oltre a **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Archiviazione a oggetti (S3)** e il generico **WebDAV / CalDAV**, le schede includono anche **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** e **pCloud**: lì basta il tuo indirizzo e-mail più una **Password per app** — gli indirizzi del server sono già precompilati (basato su WebDAV; modificabile tramite **Avanzate: imposta gli endpoint singolarmente**).
- **Apri un vault online esistente dalla schermata di benvenuto**: **Apri vault** → **Vault online** ti guida attraverso gli stessi tre passaggi per ogni provider — **1. Connetti** (accedi o inserisci le credenziali), **2. Scegli la cartella nel cloud** (lì puoi anche crearne una nuova tramite **Nuova cartella**), **3. Scegli o crea la cartella locale**. In alternativa, puoi configurare la sincronizzazione per un vault già aperto in qualsiasi momento nelle Impostazioni.
- **Crea un nuovo vault nel cloud**: **Nuovo vault** → **Presso un servizio online** — scegli prima la struttura iniziale (vuota o un modello come PARA), poi connettiti e scegli la cartella di destinazione nel cloud o creala tramite **Nuova cartella**, infine la cartella locale. La struttura viene creata nella cartella locale e caricata automaticamente alla prima sincronizzazione.
- I salvataggi locali vengono caricati immediatamente; Plainva controlla le modifiche remote all'**Intervallo di sincronizzazione (secondi)** configurato.
- Le modifiche offline vengono messe in coda e trasferite al prossimo contatto; la barra di stato mostra **Online**/**Offline** e l'indicatore di sincronizzazione mostra lo stato (**Sincronizza ora** al clic). Durante una sincronizzazione lunga o alla prima connessione, la barra di stato mostra l'avanzamento come contatore (ad es. **Sync 123/540**), così vedi che sta elaborando l'intero vault.
- Se entrambe le parti modificano lo stesso file, Plainva le unisce automaticamente (unione a tre vie). Se non è possibile, la tua versione viene preservata in sicurezza come file `.CONFLICT` — non si perde mai nulla (vedi [FAQ](FAQ.md)).
- **Risoluzione dei conflitti**: un banner nella nota interessata (e **Risolvi conflitto…** nel menu contestuale del file `.CONFLICT` nell'albero) apre la finestra di dialogo di confronto — lo stato attuale del file a sinistra, la tua versione preservata a destra, modificabile con la ripresa dei singoli blocchi. **Salva la versione destra e risolvi** scrive il risultato nel file e rimuove la copia di conflitto; **Mantieni l'altra parte** scarta la tua copia (resta uno snapshot nella cronologia versioni). Anche la finestra di dialogo degli errori di sincronizzazione elenca le copie di conflitto esistenti e porta con un clic allo stesso confronto.
- **Protezione dalle eliminazioni di massa**: se una quota insolitamente grande dei file sincronizzati sta per essere eliminata nel cloud in una sola volta (ad esempio perché la cartella locale del vault è stata svuotata o spostata), Plainva sospende le eliminazioni e chiede prima conferma: **Elimina nel cloud** le esegue, **Non eliminare (ripristina)** le scarta e ripristina i file dal cloud alla prossima sincronizzazione. Le eliminazioni che hai confermato tu stesso in Plainva non vengono trattenute — per le eliminazioni grandi (più di 10 file o più del 20% del vault) Plainva chiede invece una seconda conferma prima di eliminare.
- Vengono sincronizzati anche gli allegati (immagini ecc.).
- **Le cartelle vuote** si sincronizzano anch'esse: una cartella creata in Plainva appare subito nel cloud, e le cartelle vuote nel cloud compaiono sui tuoi altri dispositivi al più tardi con il successivo elenco completo.
- Le credenziali e i token sono memorizzati nel portachiavi del sistema operativo (stato: **Impostazioni → App → Informazioni e diagnostica → Portachiavi del sistema operativo**), mai in file dentro il vault.
- **Accessi salvati** (**Impostazioni → Vault → Sincronizzazione**) mostra ciò che Plainva ha depositato nel portachiavi, comprese voci di vault che non apri più da tempo. Ogni riga indica il servizio e il vault; **Rimuovi** chiede conferma. Plainva non cancella mai nulla qui di propria iniziativa.
- Le voci del portachiavi hanno **nomi leggibili** — `plainva · <vault> · <servizio> · <id account> · #<impronta>` invece di una stringa base64. Plainva rinomina le voci esistenti una sola volta, alla prima apertura di un vault; se una rinomina non può concludersi in sicurezza, la voce vecchia resta dov'è e Plainva riprova alla prossima apertura.
- **Disconnetti** interrompe la sincronizzazione del vault; nessun file viene eliminato da nessuna parte facendo questo.
- **`http://` è consentito, `https://` è la raccomandazione.** Un server che gestisci tu stesso sulla tua rete di solito parla `http` in chiaro — funziona, anche sul telefono. Su internet non dovresti: WebDAV invia la tua password a **ogni** richiesta, in chiaro tramite `http`. Se inserisci un indirizzo non cifrato al di fuori della tua rete, Plainva te lo segnala nel modulo — ma non te lo impedisce.

## WebDAV / Nextcloud

La via più semplice per server autogestiti e la maggior parte degli storage cloud:

1. In **Account cloud** → **Collega account…** scegli la scheda **Nextcloud** (o **WebDAV / CalDAV**).
2. Inserisci l'**Indirizzo del server**, il **Nome utente** e la **Password o token dell'app** — usa una password dell'app invece della tua password principale quando possibile (in Nextcloud: Impostazioni → Sicurezza → Password delle app).
3. **Collega** verifica le credenziali; scegli poi la **Cartella cloud** tramite **Scegli cartella…**.

Particolarità **Nextcloud**: UN solo modulo copre file **e** calendario — Plainva deriva gli endpoint WebDAV e CalDAV direttamente dall'indirizzo del server (gli indirizzi derivati vengono mostrati nell'assistente; **Avanzate: imposta gli endpoint singolarmente** consente URL separati). Spunta entrambi i servizi e un solo passaggio li collega entrambi.

Gli indirizzi tipici dei server (Nextcloud, Koofr, MagentaCLOUD, Storage Box e molti altri) sono elencati in [Compatibilità di sincronizzazione](Sync_Compatibility.md).

Se la password per app cambia in seguito, inseriscila **una sola volta** nei dettagli dell'account sotto **Credenziali**: Plainva la verifica su ogni servizio di quell'account e la salva solo quando tutti la accettano, così nessun servizio resta con la vecchia password.

## Google Drive

Google Drive funziona attualmente con le tue credenziali ("Bring Your Own"): crei una volta un progetto Google Cloud gratuito, di tua proprietà esclusiva. La guida passo dopo passo: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Versione breve: in **Account cloud** → **Collega account…**, scegli la scheda **Google**, spunta il servizio **File**, inserisci l'**ID client** e il **Secret client** dal tuo progetto Google, poi **Accedi con Google…** — l'accesso si apre nel tuo browser. Una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo Drive (sottocartelle incluse, predefinita "Plainva"). Nota: finché il tuo progetto Google è in modalità **Test**, l'accesso scade dopo **7 giorni** — definitivamente, perché in questa modalità Google lascia scadere anche il refresh token, quindi Plainva non può rinnovarlo in background. La sincronizzazione ti dice allora che l'accesso è scaduto, e **Riconnetti** nei dettagli dell'account lo ripristina — un unico passaggio per **tutti** i servizi di quell'account. Se non vuoi farlo ogni settimana, imposta il progetto Google su **In produzione** nella console: l'accesso resta allora valido (per un'app non verificata Google mostra una volta una schermata di avviso, che puoi confermare come proprietario).

Se selezioni **File** e **Calendario** insieme durante la connessione, Google chiede il consenso una **sola volta**, richiedendo esattamente i permessi dei servizi scelti. Aggiungendo un altro servizio in seguito compare un secondo consenso integrativo.

## OneDrive

Plainva fornisce una propria registrazione dell'app — **non devi più crearne una tua**:

1. In **Account cloud** → **Collega account…**, scegli la scheda **Microsoft** e spunta il servizio **File** (OneDrive) — se vuoi, insieme a **Calendario e attività** ed **E-mail** (un account Microsoft può portare tutti e tre i servizi).
2. **Accedi con Microsoft…** e conferma l'accesso nel browser. Fatto — Plainva crea la cartella (predefinita "Plainva") e ne sincronizza l'intero contenuto, inclusi i file aggiunti dall'esterno.
3. Facoltativo: una volta connesso, scegli la **Cartella cloud** tramite **Scegli cartella…** direttamente dal tuo OneDrive (sottocartelle incluse).

Facoltativo: tramite **Usa il tuo ID applicazione** puoi invece fornire un ID client registrato da te (ad es. per restrizioni aziendali). Guida dettagliata: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Se colleghi più servizi di un account insieme — ad esempio **File** e **Calendario** — il provider chiede il consenso una **sola volta**, e Plainva mantiene un unico accesso per l'intero account. Questo vale per **Microsoft** (file, calendario, e-mail) così come per **Google** (file e calendario; una casella Gmail resta esclusa, perché funziona tramite IMAP con una password per app e non richiede alcun consenso).

La procedura porta con sé il provider scelto **in ogni passo**: i passi 2 e 3 aprono subito il modulo giusto (il modulo del calendario Google invece di una scelta del provider, Gmail invece di un modulo IMAP generico) e non chiedono mai di nuovo chi volevi collegare. Ciò che un passo ha già raccolto è già presente nel successivo: con Nextcloud, Plainva ricava l'indirizzo CalDAV dall'indirizzo del server del passo 1, e una password di suite si digita una volta invece di tre. Questi dati vivono in memoria solo per la durata della procedura; non vengono salvati da nessuna parte e spariscono quando finisce — anche se la chiudi con **Esci dalla procedura**.

Gli account che accedono ancora servizio per servizio sono contrassegnati come **Accesso vecchio** nell'elenco degli account e offrono **Un accesso per tutti i servizi** — nell'elenco degli account e nei dettagli dell'account, sul desktop come nell'[app mobile](Mobile_App.md). Un unico passaggio, e da quel momento tutti i servizi condividono lo stesso accesso. Non è solo comodità: accessi separati potevano disallinearsi tra loro, lasciando un servizio in funzione mentre un altro dello stesso account era già scaduto in silenzio. Per questi account **Riconnetti** ora rinnova l'intero account invece di un solo servizio. L'offerta resta valida anche quando esiste già un accesso condiviso che però non copre tutti i servizi dell'account — perché per esempio hai lasciato una spunta scoperta nella schermata di consenso; Google non può ampliare un consenso già concesso.

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

**Le cancellazioni viaggiano.** Una cancellazione che hai confermato resta 90 giorni in un registro (`.plainva/sync/deletions.json`) e viene replicata su ogni altro dispositivo senza domande, anche dopo un riavvio e anche se lì mancano molti file insieme. Se invece nel cloud mancano molti file senza che il registro li spieghi, Plainva ferma la replica e chiede: **applicare le cancellazioni** o **tenerle in locale** (in tal caso ricarica i file come nuovi). Lo stesso vale per gli elenchi attività: una cancellazione eseguita presso il fornitore rimuove la nota attività anche sull’altro dispositivo, purché lì sia invariata.

## Errori e nuovo tentativo automatico

La finestra conserva l’esatto tentativo fallito anche se un nuovo tentativo automatico ha già cambiato lo stato in tempo reale. Mostra se il tentativo è in corso o riuscito. La riconnessione è consigliata solo per errori di autenticazione; gli errori di rete, timeout e provider mantengono i dettagli e vengono riprovati automaticamente. Anche la sincronizzazione delle impostazioni attende gli errori temporanei: un timeout compare dapprima come una nota discreta con un contatore e diventa un messaggio rosso solo dopo il terzo errore consecutivo; un accesso scaduto, invece, subito.

## Nomi che differiscono solo nella grafia

Google Drive non distingue maiuscole e minuscole durante la ricerca, e Windows e macOS salvano `Nota.md` e `nota.md` nello stesso file. Inoltre, lo stesso carattere può essere memorizzato in due modi: `ü` come un solo carattere, oppure come `u` seguita da dieresi. Per questa **grafia** Plainva intende ora lo stesso file e continua a sincronizzare normalmente, finché esiste una sola corrispondenza.

Se invece due nomi differiscono per **maiuscole e minuscole**, sono due file. Plainva non modifica né elimina nulla e mostra la scheda **Due grafie, un solo file** con entrambi i nomi: su mobile nella pagina del vault, sul desktop nelle impostazioni di sincronizzazione. Tutti gli altri file continuano a essere sincronizzati. Rinomina una delle due note e la scheda scompare da sola.
