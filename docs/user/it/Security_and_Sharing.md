# Sicurezza e condivisione

## Centro sicurezza, ricifratura e slice pubblicati

La schermata segue i mockup con stato e schede recupero, dispositivi e team; un’azione apre il vault, la connessione, la configurazione o lo sblocco necessario. La revoca può avviare una ricifratura completa ripristinabile. Crea un Vault Slice con **Dettagli → Contenuto → Permessi → Revisione**. Le pubblicazioni esterne vivono in un workspace cifrato separato; la proiezione ripulita rimuove proprietà private, link esclusi e incorporamenti. La pubblicazione pubblica attende revisione crittografica indipendente e prove reali Android/iOS.

Ultima verifica: 2026-07-22

Plainva mantiene il vault come file leggibili sul dispositivo e salva la copia cloud come oggetti cifrati opachi. Dopo aver collegato un account, apri **Impostazioni → vault → Sicurezza e condivisione**.

## Configurazione

1. Scegli i nomi di proprietario e dispositivo. Le chiavi restano nel portachiavi di sistema o, se non disponibile, sotto una passphrase locale.
2. Salva il file `.pvrecovery` e conserva separatamente il codice visualizzato. Ogni blocco ha un numero di gruppo visibile; inserisci i valori dei due gruppi evidenziati per confermare che il backup sia leggibile. Servono entrambe le parti e nessuna contiene credenziali cloud.
3. Attiva il workspace. Plainva pubblica la policy firmata e cifra tutti i file in `.pvws/`. Il vault locale resta leggibile e la migrazione riprende dopo interruzioni.

Il vecchio contenuto in chiaro resta accanto a `.pvws/` durante la migrazione. Puoi rimuoverlo esplicitamente solo con stato **Protetto**; i file locali non vengono mai eliminati.

Le modifiche offline restano in una coda durevole. Le eliminazioni richiedono tombstone firmati e le modifiche parallele vengono conservate come copie `.CONFLICT-…`.

## Dispositivi e recupero

Un nuovo dispositivo mobile crea una richiesta QR/codice. Inserisci il codice breve su un desktop già approvato e confronta le impronte prima della conferma. Un dispositivo rimosso non può più firmare nuove modifiche. Se tutti i dispositivi sono persi, **Ripristina accesso** crea un nuovo dispositivo proprietario dal file `.pvrecovery` e dal codice separato, senza riscrivere i contenuti. **Rinnova recupero** ancora una nuova identità con doppia firma e invalida il vecchio set.

## Membri, ruoli e slice

Proprietari e amministratori possono invitare membri, creare gruppi e limitare un ruolo all’intero workspace, a uno slice o a un oggetto. Editor modifica, Commenter commenta, Reader legge soltanto e Contributor crea soltanto nel proprio ambito. Il controllo avviene prima della scrittura locale e prima della firma, anche per importazioni, ripristini, automazioni e azioni IA.

Uno slice contiene una cartella, una selezione o una regola dinamica su percorso, tipo, tag e proprietà. Usa sempre **Anteprima** prima della pubblicazione. Gli oggetti non autorizzati non vengono materializzati né inseriti in ricerca, grafo o anteprime.

## Commenti, versioni e quarantena

Commenti e marcatori di risoluzione sono cifrati e firmati. **Cronologia versioni** legge le revisioni cifrate e ripristina una versione come nuova modifica firmata o copia. Un artefatto remoto non valido viene isolato in **Integrità e fork locali**: puoi riprovare, esportare il ciphertext, segnarlo riparato o ignorarlo. Non blocca il resto della sincronizzazione e l’assenza remota non equivale mai a eliminazione.
