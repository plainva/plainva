# Sicurezza e condivisione

## Centro sicurezza, ricifratura e slice pubblicati

**Sicurezza e condivisione** ha due livelli. La **Panoramica** (primo livello) mostra lo stato di protezione, **Completa migrazione** quando restano residui in chiaro, **Rimuovi la connessione al cloud crittografato** e due schede che aprono il secondo livello — **Dispositivi e ripristino** e **Condividi con altri**. Nel secondo livello la navigazione per aree sostituisce la colonna sinistra delle impostazioni, raggruppata in **Il tuo accesso** (Dispositivi, ripristino) e **Condivisione** (Membri, gruppi, slice, pubblicazioni); **‹ Panoramica** torna al primo livello. Le azioni visibili restano disponibili: un’azione apre il vault, la connessione, la configurazione o lo sblocco necessario. La revoca può avviare una ricifratura completa ripristinabile. Crea un Vault Slice con **Dettagli → Contenuto → Permessi → Revisione**. Le pubblicazioni esterne vivono in un workspace cifrato separato; la proiezione ripulita rimuove proprietà private, link esclusi e incorporamenti. La pubblicazione pubblica attende revisione crittografica indipendente e prove reali Android/iOS.

Ultima verifica: 2026-07-23

Plainva mantiene il vault come file leggibili sul dispositivo e salva la copia cloud come oggetti cifrati opachi. Dopo aver collegato un account, apri **Impostazioni → vault → Sicurezza e condivisione**.

## Configurazione

1. Scegli i nomi di proprietario e dispositivo. Le chiavi restano nel portachiavi di sistema o, se non disponibile, sotto una passphrase locale.
2. Salva il file `.pvrecovery` e conserva separatamente il codice visualizzato. Ogni blocco ha un numero di gruppo visibile; inserisci i valori dei due gruppi evidenziati per confermare che il backup sia leggibile. Servono entrambe le parti e nessuna contiene credenziali cloud.
3. Attiva il workspace. Plainva pubblica la policy firmata e cifra tutti i file in `.pvws/`. Il vault locale resta leggibile e la migrazione riprende dopo interruzioni.

Il vecchio contenuto in chiaro resta accanto a `.pvws/` durante la migrazione. Puoi rimuoverlo esplicitamente solo con stato **Protetto**; i file locali non vengono mai eliminati.

Le modifiche offline restano in una coda durevole. Le eliminazioni richiedono tombstone firmati e le modifiche parallele vengono conservate come copie `.CONFLICT-…`.

## Dispositivi e recupero

Per aggiungere il **tuo** secondo dispositivo, apri **Dispositivi e ripristino → Dispositivi → Aggiungi un altro dispositivo**: Plainva mostra un codice di invito legato alla tua stessa iscrizione — **non** crea un nuovo membro. Incollalo sul secondo dispositivo (**Sicurezza e condivisione → unisciti**) e approvalo su un dispositivo già presente; confronta prima l’impronta su entrambi i dispositivi. Per aggiungere invece un’altra persona, usa **Condividi con altri → Membri → Invita una persona** (vedi sotto). Un dispositivo rimosso non può firmare nuove modifiche valide. L’invito e la richiesta di associazione di un dispositivo che si unisce vengono mostrati anche come codici QR scansionabili — su dispositivo mobile, **Scansiona invito** legge un codice con la fotocamera invece di incollare il testo.

Il ripristino si trova in **Dispositivi e ripristino → Ripristino**, suddiviso in **Stato attuale** (se è salvato un pacchetto di ripristino e l’impronta del workspace) e il **Flusso di ripristino**. Se perdi tutti i dispositivi, scegli lì **Ripristina accesso** e apri il file `.pvrecovery` con il codice conservato separatamente; Plainva crea un nuovo dispositivo proprietario, può revocare i dispositivi persi e non riscrive gli oggetti di contenuto. **Rinnova recupero** sostituisce il vecchio set di ripristino tramite una catena di ancoraggio con doppia firma. Conserva di nuovo il nuovo file e il codice separatamente; il vecchio set è poi non valido.

## Membri, ruoli e slice

Proprietari e amministratori possono invitare membri, creare gruppi e limitare un ruolo all’intero workspace, a uno slice o a un oggetto. Editor modifica, Commenter commenta, Reader legge soltanto e Contributor crea soltanto nel proprio ambito. Il controllo avviene prima della scrittura locale e prima della firma, anche per importazioni, ripristini, automazioni e azioni IA.

Uno slice contiene una cartella, una selezione o una regola dinamica su percorso, tipo, tag e proprietà. Usa sempre **Anteprima** prima della pubblicazione. Gli oggetti non autorizzati non vengono materializzati né inseriti in ricerca, grafo o anteprime.

## Commenti, versioni e quarantena

Commenti e marcatori di risoluzione sono cifrati e firmati. **Cronologia versioni** legge le revisioni cifrate e ripristina una versione come nuova modifica firmata o copia. Un artefatto remoto non valido viene isolato in **Integrità e fork locali**: puoi riprovare, esportare il ciphertext, segnarlo riparato o ignorarlo. Non blocca il resto della sincronizzazione e l’assenza remota non equivale mai a eliminazione.

## Rimuovere correttamente un vault cifrato

Quando non ti serve più un vault cifrato, dismettilo in Plainva **prima** di eliminare la cartella cloud. L’ordine conta: la protezione fail-closed mantiene la sincronizzazione ferma se la copia cloud sparisce mentre Plainva si aspetta ancora una connessione cifrata — questo ti protegge da un aggressore che tolga la cifratura per forzare il testo in chiaro.

1. Apri **Impostazioni → vault → Security & Sharing**.
2. Nella panoramica, nella scheda **Crittografia**, scegli **Rimuovi la connessione al cloud crittografato**. Plainva cancella le chiavi locali e i dati del workspace su questo dispositivo e riapre il vault come un vault normale. (Questa è un’operazione locale del dispositivo; un’azione globale di «annullare la crittografia» che riscrive anche la copia nel cloud in testo in chiaro è un’azione separata aggiunta in seguito.)
3. Solo a questo punto elimina la cartella cloud (gli oggetti `.pvws/`) presso il tuo provider se vuoi liberartene. Plainva non elimina per te gli oggetti cifrati nel cloud.

Per, invece, **porre completamente fine alla crittografia e mantenere il vault nel cloud come file normali**, scegli **Rimuovere la crittografia** nella stessa scheda **Crittografia**: Plainva riapre il vault come un normale vault cloud e ricarica tutte le tue note nello stesso cloud come file in chiaro, poi smette di cifrare. I file locali non vengono mai modificati e nulla viene eliminato; la vecchia cartella cifrata `.pvws/` resta finché non la elimini presso il tuo provider (Plainva non può rimuovere per te quegli oggetti immutabili). Conferma prima l’avviso di pericolo — le note lasciano l’archivio cifrato come testo in chiaro.

Se hai già eliminato la copia cloud e la sincronizzazione ora fallisce con un errore «area di lavoro mancante» o «manifest mancante», la soluzione è lo stesso ripristino, offerto dove compare l’errore:

- Per un **workspace** cifrato, apri **Security & Sharing**. Lo stato mostra un errore con una nota di recupero; nella scheda **Crittografia** scegli **Rimuovi la connessione al cloud crittografato** per reimpostare il workspace su questo dispositivo così che la sincronizzazione torni a funzionare.
- Per una **connessione di sincronizzazione** con contenuto cifrato, fai clic sullo stato di sincronizzazione per aprire la finestra di errore e scegli **Reimposta crittografia**. Questo pulsante compare solo quando i dati di cifratura remoti mancano o non sono validi.

Entrambe le azioni sono esplicite e confermate. Plainva non declassa mai in silenzio una connessione cifrata a testo in chiaro, e nessuna delle due azioni elimina file locali. Se il cloud contiene ancora contenuti cifrati che vuoi davvero, annulla invece — reimpostare riprenderebbe la sincronizzazione in chiaro.

Rimuovere un vault con **Dimentica i dati dell’app** (Splash → rimuovere un vault → dimentica anche i dati dell’app) cancella anche questi marcatori di cifratura, così un vault rimosso in questo modo non lascia nulla che possa bloccare una riconnessione successiva.
