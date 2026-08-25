# Sicurezza e condivisione

> **Sperimentale — non ancora verificato in modo indipendente.** Gli workspace cifrati vengono rilasciati come anteprima. Il design crittografico non è ancora stato sottoposto a un audit indipendente e le verifiche su due dispositivi con hardware Android e iOS reale sono ancora in corso. Provalo pure, ma conserva una copia di backup di tutto ciò che non puoi perdere e non affidargli ancora materiale che deve essere davvero protetto.

## Centro sicurezza, ricifratura e slice pubblicati

**Sicurezza e condivisione** ha due livelli. La **Panoramica** (primo livello) mostra lo stato di protezione, **Completa migrazione** quando restano residui in chiaro, **Rimuovi la connessione al cloud crittografato** e due schede che aprono il secondo livello — **Dispositivi e ripristino** e **Condividi con altri**. Nel secondo livello la navigazione per aree sostituisce la colonna sinistra delle impostazioni, raggruppata in **Il tuo accesso** (Dispositivi, ripristino) e **Condivisione** (Membri, gruppi, slice, pubblicazioni); **‹ Panoramica** torna al primo livello. Le azioni visibili restano disponibili: un’azione apre il vault, la connessione, la configurazione o lo sblocco necessario. La revoca può avviare una ricifratura completa ripristinabile. Crea un Vault Slice con **Dettagli → Contenuto → Permessi → Revisione**. Le pubblicazioni esterne vivono in un workspace cifrato separato; la proiezione ripulita rimuove proprietà private, link esclusi e incorporamenti. La pubblicazione pubblica attende revisione crittografica indipendente e prove reali Android/iOS.

Crea un Vault Slice con i quattro passaggi **Dettagli → Contenuto → Permessi → Revisione**. **Pubblicare uno slice verso altre persone è previsto e non è ancora disponibile:** la procedura guidata mostra le opzioni per farti vedere cosa arriverà, ma sono disattivate e non esce nulla dal vault. Quando la pubblicazione arriverà, una pubblicazione esterna vivrà in un proprio spazio dei nomi di workspace cifrato, le proiezioni ripulite rimuoveranno le proprietà private del frontmatter, neutralizzeranno i link verso le note escluse e ometteranno gli incorporamenti esclusi, e i permessi di Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV e S3 saranno una protezione aggiuntiva, mai un sostituto dei ruoli cifrati. La pubblicazione pubblica resta bloccata finché non vengono registrate la revisione crittografica indipendente e le verifiche reali su due dispositivi Android/iOS.

Ultima verifica: 2026-08-25

Plainva mantiene il vault come file leggibili sul dispositivo e salva la copia cloud come oggetti cifrati opachi. Dopo aver collegato un account, apri **Impostazioni → vault → Sicurezza e condivisione**.

Su mobile la sezione indica prima lo stato reale di questo vault: **Solo su questo dispositivo** senza connessione cloud, **Questa connessione non è crittografata** per un normale vault cloud — **Configura la crittografia** esegue lì gli stessi tre passaggi del desktop (identità → file di ripristino e codice → attivazione con avanzamento riprendibile) — oppure i passaggi di accesso appena la connessione contiene un'area di lavoro crittografata.

## Configurazione

1. Scegli i nomi di proprietario e dispositivo. Le chiavi restano nel portachiavi di sistema o, se non disponibile, sotto una passphrase locale.
2. Salva il file `.pvrecovery` e conserva separatamente il codice visualizzato. Ogni blocco ha un numero di gruppo visibile; inserisci i valori dei due gruppi evidenziati per confermare che il backup sia leggibile. Servono entrambe le parti e nessuna contiene credenziali cloud.
3. Attiva il workspace. Plainva pubblica la policy firmata e cifra tutti i file in `.pvws/`. Il vault locale resta leggibile e la migrazione riprende dopo interruzioni.

Il vecchio contenuto in chiaro resta accanto a `.pvws/` durante la migrazione. Puoi rimuoverlo esplicitamente solo con stato **Protetto**; i file locali non vengono mai eliminati.

## Nell’uso quotidiano

Le modifiche offline restano in una coda durevole. Ogni modifica è firmata; una cancellazione remota da sola non elimina mai un file locale, mentre una lapide firmata può farlo. Le modifiche parallele offline vengono conservate come copie `.CONFLICT-…`. **Blocca** rimuove le chiavi del workspace dalla sessione corrente; **Sblocca** usa il portachiavi di sistema o la passphrase locale.

## Dispositivi e recupero

Per aggiungere il **tuo** secondo dispositivo, apri **Dispositivi e ripristino → Dispositivi → Aggiungi un altro dispositivo**: Plainva mostra un codice di invito legato alla tua stessa iscrizione — **non** crea un nuovo membro. Incollalo sul secondo dispositivo (**Sicurezza e condivisione → unisciti**) e approvalo su un dispositivo già presente; confronta prima l’impronta su entrambi i dispositivi. Per aggiungere invece un’altra persona, usa **Condividi con altri → Membri → Invita una persona** (vedi sotto). Un dispositivo rimosso non può firmare nuove modifiche valide. L’invito e la richiesta di associazione di un dispositivo che si unisce vengono mostrati anche come codici QR scansionabili — su dispositivo mobile, **Scansiona invito** legge un codice con la fotocamera invece di incollare il testo.

Rimuovere un dispositivo o un membro comporta due costi possibili, e anche il telefono li offre entrambi. **Solo da ora in poi** interrompe subito l’accesso alle nuove chiavi ed è veloce. **Ricifra tutto** riscrive anche tutto ciò che è già cifrato; è un lavoro lungo, continua in background e riprende da solo dopo un riavvio — la scheda di stato conta gli oggetti mentre è in corso. Nessuna delle due può recuperare ciò che l’altra parte ha già scaricato, per questo la domanda lo dice prima che tu scelga. Non puoi mai rimuovere il dispositivo che hai in mano: ti escluderebbe, lasciandoti solo il pacchetto di ripristino.

Il ripristino si trova in **Dispositivi e ripristino → Ripristino**, suddiviso in **Stato attuale** (se è salvato un pacchetto di ripristino e l’impronta del workspace) e il **Flusso di ripristino**. Se perdi tutti i dispositivi, scegli lì **Ripristina accesso** e apri il file `.pvrecovery` con il codice conservato separatamente; Plainva crea un nuovo dispositivo proprietario, può revocare i dispositivi persi e non riscrive gli oggetti di contenuto. **Rinnova recupero** sostituisce il vecchio set di ripristino tramite una catena di ancoraggio con doppia firma. Conserva di nuovo il nuovo file e il codice separatamente; il vecchio set è poi non valido. Plainva chiede prima, perché il file che hai in mano smette di funzionare in quel momento.

## Membri, ruoli e slice

Proprietari e amministratori possono invitare membri, creare gruppi e limitare un ruolo all’intero workspace, a uno slice o a un oggetto. Editor modifica, Commenter commenta, Reader legge soltanto e Contributor crea soltanto nel proprio ambito. Il controllo avviene prima della scrittura locale e prima della firma, anche per importazioni, ripristini, automazioni e azioni IA.

La proprietà può passare a un altro membro attivo. Apri **Condividi con altri → Membri** (su mobile: la sezione **Team**) e scegli **Trasferisci la proprietà** accanto a quella persona. Servono il file di ripristino attuale e il suo codice, perché proprietà e set di ripristino si spostano insieme: Plainva crea prima un pacchetto di ripristino sostitutivo e lo consegna solo dopo che l’hai salvato. Consegna quel file e il nuovo codice al nuovo proprietario tramite canali separati — diventi Admin, e quella persona diventa poi l’unica Owner.

Uno slice contiene una cartella, una selezione o una regola dinamica su percorso, tipo, tag e proprietà. Usa sempre **Anteprima** prima della pubblicazione. Gli oggetti non autorizzati non vengono materializzati né inseriti in ricerca, grafo o anteprime.

## Commenti, versioni e quarantena

Commenter ottiene un editor di sola lettura con un'area commenti. I commenti e i marcatori di risoluzione sono essi stessi oggetti cifrati e firmati del workspace. **Cronologia versioni** legge le revisioni cifrate del workspace e ripristina una revisione precedente come nuova modifica firmata o come copia.

Gli artefatti remoti non validi vengono isolati singolarmente in **Integrità e fork locali**. Puoi riprovare, esportare il ciphertext, contrassegnare come riparato un artefatto riparato esternamente, oppure ignorarlo deliberatamente. Un file non valido non blocca il resto della sincronizzazione valida, e la sola assenza remota non equivale mai a eliminazione. Una modifica apportata da un programma locale senza permesso di scrittura viene conservata come una copia privata del fork.

## Rimuovere correttamente un vault cifrato

Quando non ti serve più un vault cifrato, dismettilo in Plainva **prima** di eliminare la cartella cloud. L’ordine conta: la protezione fail-closed mantiene la sincronizzazione ferma se la copia cloud sparisce mentre Plainva si aspetta ancora una connessione cifrata — questo ti protegge da un aggressore che tolga la cifratura per forzare il testo in chiaro.

1. Apri **Impostazioni → vault → Security & Sharing**.
2. Nella panoramica, nella scheda **Crittografia**, scegli **Rimuovi la connessione al cloud crittografato**. Plainva cancella le chiavi locali e i dati del workspace su questo dispositivo e riapre il vault come un vault normale. (Questa è un’operazione locale del dispositivo: la copia nel cloud resta cifrata. Per riaverla in testo in chiaro la strada è **Annulla la crittografia** — vedi il paragrafo qui sotto.)
3. Solo a questo punto elimina la cartella cloud (gli oggetti `.pvws/`) presso il tuo provider se vuoi liberartene. Plainva non elimina per te gli oggetti cifrati nel cloud.

Su mobile lo stesso passaggio si trova nello stesso punto, con una differenza: lo confermi digitando il nome del vault. Tutto il resto è identico — le chiavi locali e i dati del workspace spariscono, il vault si riapre come un vault normale e gli oggetti crittografati nel cloud restano finché non li elimini tu stesso. Funziona senza connessione, perché in questo passaggio non c’è nulla di remoto.

Per, invece, **porre completamente fine alla crittografia e mantenere il vault nel cloud come file normali**, scegli **Rimuovere la crittografia** nella stessa scheda **Crittografia**: Plainva riapre il vault come un normale vault cloud e ricarica tutte le tue note nello stesso cloud come file in chiaro, poi smette di cifrare. I file locali non vengono mai modificati e nulla viene eliminato; la vecchia cartella cifrata `.pvws/` resta finché non la elimini presso il tuo provider (Plainva non può rimuovere per te quegli oggetti immutabili). Conferma prima l’avviso di pericolo — le note lasciano l’archivio cifrato come testo in chiaro.

Se hai già eliminato la copia cloud e la sincronizzazione ora fallisce con un errore «area di lavoro mancante» o «manifest mancante», la soluzione è lo stesso ripristino, offerto dove compare l’errore:

- Per un **workspace** cifrato, apri **Security & Sharing**. Lo stato mostra un errore con una nota di recupero; nella scheda **Crittografia** scegli **Rimuovi la connessione al cloud crittografato** per reimpostare il workspace su questo dispositivo così che la sincronizzazione torni a funzionare.
- Per una **connessione di sincronizzazione** con contenuto cifrato, fai clic sullo stato di sincronizzazione per aprire la finestra di errore e scegli **Reimposta crittografia**. Questo pulsante compare solo quando i dati di cifratura remoti mancano o non sono validi.

Entrambe le azioni sono esplicite e confermate. Plainva non declassa mai in silenzio una connessione cifrata a testo in chiaro, e nessuna delle due azioni elimina file locali. Se il cloud contiene ancora contenuti cifrati che vuoi davvero, annulla invece — reimpostare riprenderebbe la sincronizzazione in chiaro.

Rimuovere un vault con **Dimentica i dati dell’app** (Splash → rimuovere un vault → dimentica anche i dati dell’app) cancella anche questi marcatori di cifratura, così un vault rimosso in questo modo non lascia nulla che possa bloccare una riconnessione successiva.
