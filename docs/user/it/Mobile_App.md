# L'app mobile

Ultimo aggiornamento: 2026-08-04

Plainva è disponibile anche come app per Android e iOS. Funziona con gli stessi file Markdown, lo stesso formato **OKF** e lo stesso motore di sincronizzazione dell'app desktop — il tuo vault resta identico in entrambi i mondi.

## Installare l’app

L’app mobile è in **beta chiusa**. Su **Android** si entra in due passaggi: unisciti al gruppo di tester da [plainva.com/android-beta](https://plainva.com/android-beta), poi accetta su Google Play. Su **iPhone** la distribuzione passa da TestFlight; la lista d’attesa è su [plainva.com](https://plainva.com).

Google pubblica l’app sul Play Store pubblico solo quando 12 tester restano iscritti per 14 giorni consecutivi — iscriversi e lasciarla semplicemente installata aiuta già.

## Layout

- **Barra inferiore:** **da due a quattro** superfici di lavoro a tua scelta, più la voce fissa **Aree** in fondo — in tutto, da tre a cinque destinazioni per una barra. **Note** resta sempre visibile: è così che accedi ai tuoi file.
- **Ogni area** (Note, Oggi, Attività, Calendario, E-mail, Grafo) resta a un tocco di distanza grazie al **foglio delle aree**: **Aree** nella barra, il **▾ accanto al titolo**, oppure una **pressione prolungata sulla barra**. Il foglio segna l'area attuale e porta direttamente, in basso, a **Personalizza la barra di navigazione…**. Tag, segnalibri ed elementi aperti di recente non sono più aree a sé stanti — si trovano ora sotto **Note**.
- **Configurare la barra:** **Impostazioni** → **Barra di navigazione**. Usa **−**/**+** per stabilire quante superfici di lavoro mostra la barra (2–4, con anteprima dal vivo) e la **maniglia di trascinamento** per ordinare l'elenco: le voci in alto formano la barra (contrassegnate da una cornice), trascinarne una verso l'alto la promuove nella barra. Trascinando fino al bordo superiore o inferiore, l'elenco scorre di conseguenza, così un unico movimento copre l'intero elenco. Non viene mai nascosto nulla — ciò che non è nella barra resta raggiungibile tramite **Aree**. Se l'area in cui ti trovi lascia la barra, l'app passa alla prima visibile. Puoi organizzare la stessa barra anche **sul desktop** (Impostazioni → Vault → Barre e aree); con la sincronizzazione delle impostazioni attiva, la disposizione viaggia tra i tuoi dispositivi.
- **＋** fluttua come un pulsante rotondo sopra la barra e apre la creazione rapida: nota, nota giornaliera, cartella, database, "Da modello…".
- **Intestazione:** la stessa ovunque — a sinistra Indietro (assente su una superficie di lavoro), al centro il titolo e una riga di contesto, a destra la ricerca e ⋮. Scorrendo, si stacca dal contenuto e la barra di navigazione si ritira sulle sue icone; risalendo, si riapre.
- **Un ⋮ significa sempre la stessa cosa:** azioni sull'oggetto attualmente aperto. Le impostazioni dell'app non si trovano dietro di esso.
- **Impostazioni:** in fondo a **Note**, proprio come sul desktop. Aprono prima l'elenco delle aree (come il lato sinistro delle impostazioni desktop) — un tocco apre quella pagina. In cima, **Vault attivo** porta alla gestione dei vault: cambiare vault (segno di spunta = attivo), **Crea un vault** e **Collega un vault cloud**. L’elenco mostra **le stesse aree del desktop** — tra cui **Avvio e comportamento** (mostrare di nuovo il benvenuto e le novità), **Barre e aree** (la barra di navigazione) e **Manutenzione** (Statistiche del vault, ricostruire l’indice, ripristinare i file eliminati). Manca solo **Aggiornamenti**: l’app non si aggiorna da sola, se ne occupano Google Play e TestFlight. **Manutenzione** contiene anche l’**importazione da altre app**: sul telefono scrive sempre in una sottocartella del vault aperto, mostra prima che cosa creerebbe, può essere interrotta durante l’esecuzione e lascia un resoconto.

## Leggere e modificare le note

Le note si aprono **renderizzate e in sola lettura**; la penna in alto a destra passa alla modifica (con una barra degli strumenti sopra la tastiera: formattazione, elenchi, wiki-link, comandi slash, inserisci foto). Gli incorporamenti `![[Nota]]` appaiono come schede di anteprima toccabili.

Il pulsante **Dettagli della nota** nell'intestazione (tra il segnalibro e il menu ⋮) apre il pannello di contesto della nota: proprietà (modificabili direttamente), backlink, struttura, grafo e la **cronologia delle versioni** — ogni modifica crea automaticamente snapshot che puoi ispezionare, confrontare e ripristinare. Il sorgente Markdown e la ricerca nella nota si trovano nel menu ⋮.

## Modelli

I modelli funzionano esattamente come sul desktop: i segnaposto (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) vengono compilati quando la nota viene creata, **tutte** le domande di un modello arrivano insieme in **un unico** foglio — annullalo e non viene creato nulla — e `{{cursor}}` posiziona il cursore non appena la nota si apre.

Le regole **cartella → modello** e **tipo di nota → modello** si impostano sul desktop; viaggiano con la sincronizzazione delle impostazioni e si applicano anche qui — quindi una nota in `Projekte/` inizia allo stesso modo su entrambi i dispositivi, inclusa la cattura con `＋` e con **+ Voce** in un database. Due dettagli: `{{weekday:…}}` conta sempre a partire da lunedì sul telefono (l'impostazione del primo giorno della settimana non esiste ancora lì), e `{{clipboard}}` chiede il contenuto degli appunti nello stesso foglio, invece di leggerlo senza chiedere. L'elenco completo dei segnaposto è in [Note e Markdown](Notes_and_Markdown.md).

## Database (`.base`)

I database `.base` funzionano come su desktop: ogni vista (tabella, elenco, galleria, bacheca, calendario, cronologia), modifica tipizzata delle celle, le schede della bacheca si spostano tenendo premuto. **Configura** gestisce viste, colonne, filtri (inclusi i gruppi), ordinamento e proprietà. Gli schemi di relazione (destinazioni, cardinalità) restano gestiti dal desktop.

Una vista **Bacheca appunti** mostra le note come una bacheca a due colonne di schede adesive: il tocco apre la nota, la pressione prolungata mostra le azioni (fissa, etichette, colore, elimina), trascinare dopo una pressione prolungata riordina, e le caselle di controllo si spuntano direttamente sulla scheda. Il campo in alto cattura una nuova nota. Suggerimento: punta il database sulla tua cartella Inbox (**Impostazioni** → **Contenuto e struttura**) e sia le note rapide del ＋ sia i testi condivisi da altre app finiscono direttamente sulla bacheca.

## Attività

L'area **Attività** raccoglie ogni casella di controllo del tuo vault — tutte le righe `- [ ]` e `- [x]` in tutte le note, raggruppate per nota. È la panoramica basata sulle righe che un database non può darti, perché un database lavora su note intere.

Toccare un'attività apre la nota **su quella riga**; la casella la spunta e riscrive esattamente il carattere `[ ]`/`[x]`. Le scadenze (`📅`) e i `#tags` compaiono come chip, così non si ripetono all'interno del testo.

Se il tuo vault ha un **database attività** (**Impostazioni** → **Contenuto e struttura**), l'area lo mostra sopra come sezione a sé: spuntare, cambiare stato, **+ Nuova attività** e **Apri come database**. Ogni riga con casella porta poi anche un pulsante che la **sposta nel database** — la riga resta come wiki-link, e l'attività continua a vivere come nota propria.

Sopra l'elenco trovi gli stessi filtri del desktop: **Cartella**, **Tag**, **Con scadenza** e **Mostra nascoste**. Nascondere è una proprietà della **nota**, non della singola attività — l'icona a forma di occhio sull'intestazione di una nota scrive `plainva.tasks: false` nel frontmatter di quella nota e la toglie dalla panoramica; **Nascondi modelli** fa lo stesso contemporaneamente per l'intera cartella dei modelli. Il file mantiene le sue attività, smettono solo di essere contate. Tenere premuto a lungo il pulsante di spostamento sceglie il **database di destinazione** quando il tuo vault ne ha più di uno.

Altre due azioni su un'attività del database: **Blocca tempo** crea un evento calendario per l'attività quando è collegato un calendario (data, inizio, durata, più il selettore di calendario quando più di uno è scrivibile), e **Ripetizione** crea l'attività successiva con una nuova scadenza quando spunti questa. Entrambe sono descritte in [Attività](Tasks.md).

## Oggi

**Oggi** è la superficie del giorno. La striscia in alto seleziona un giorno — si estende **in entrambe le direzioni**, due settimane indietro e due settimane avanti, e un punto contrassegna ogni giorno che ha già una nota giornaliera. Sotto si trova la **nota giornaliera** del giorno selezionato (con il suo modello e la sua cartella, da aprire o creare), poi gli **appuntamenti e scadenze** di quel giorno, e infine ciò che hai modificato in quel giorno.

La sezione centrale riunisce ciò che altrimenti si trova su due aree distinte: prima gli eventi per l'intera giornata, poi quelli con un orario preciso in ordine cronologico, e infine le attività in scadenza quel giorno. Toccare un'attività apre la sua nota. Senza un calendario collegato e senza un database attività, la sezione semplicemente non c'è.

## Tag

L'elenco dei tag si trova sotto **Note**. Toccare apre le note di un tag; la freccia espande i tag annidati. **Tenere premuto** un tag offre **Rinomina tag** — in tutto il vault, come sul desktop: Plainva riscrive ogni nota che lo porta (nel frontmatter e come `#tag` nel testo, compresi i suoi `tag/child` figli) e poi ti dice in quante note è stato sostituito. Una nota che non può essere letta o scritta viene saltata — le altre vengono comunque rinominate.

## Grafo

La **mappa del vault** mostra il tuo vault come nodi e archi. Toccare una bolla di cartella la dispiega, toccare una nota la apre; i chip sopra filtrano per tipo di nota, tag e tipo di arco. Trascina un nodo e **la mappa ricorda dove lo hai messo** — la disposizione memorizzata si trova in `.plainva/graph.json` e resta volutamente su questo dispositivo, come l'indice di ricerca.

**Tenere premuto** un nodo apre il suo menu: apri (o espandi/comprimi per una cartella), **Focus sulla selezione** e, se il nodo è fissato, **Sblocca**. Tenere premuto un **arco** indica entrambe le estremità e apre l'una o l'altra nota. Trascina una nota **su un'altra** e Plainva propone di **collegarle** — come un link testuale alla fine della nota, oppure tramite una relazione del database corrispondente; una relazione che consente esattamente una voce chiede conferma prima, perché sostituisce il valore attuale. Il chip **Seleziona** trasforma un trascinamento su un'area vuota in un rettangolo di selezione (un telefono non ha un tasto modificatore); le note selezionate possono essere eliminate insieme, con la stessa conferma di una singola. **Esporta come SVG…** consegna la mappa al foglio di condivisione del tuo dispositivo.

La stessa pulizia in piccolo la fa il **grafo nel pannello di contesto di una nota**: mostra il vicinato della nota aperta e, sotto, suggerimenti su cos'altro potrebbe appartenerle. **Collega** inserisce il link nel punto del testo — non alla fine della nota —, e un suggerimento ignorato resta ignorato, anche dopo la chiusura della nota.

Il chip **Pulizia** apre l'elenco di pulizia: le **orfane** (note a cui nessuno rimanda), i **link interrotti** (riferimenti che non portano da nessuna parte) e le **menzioni** — punti in cui una nota viene nominata ma non collegata. Elimini un'orfana con la stessa conferma di ovunque altro, crei la nota mancante per un link interrotto, e colleghi una menzione esattamente **nel punto del passaggio** invece che alla fine della nota. Ciò che ignori resta ignorato: non ricompare al passaggio successivo. La scansione delle menzioni legge ogni nota e quindi parte solo quando lo chiedi tu — e può essere interrotta in qualsiasi momento.

Il **Focus** si può attivare anche dal menu del nodo: la mappa mostra quindi solo il suo vicinato fino alla profondità che scegli (1–3). Il chip che mostra la profondità cancella di nuovo il focus. Altri due chip leggono la mappa in base all'età: la **Mappa di calore** tinge ogni nodo in base a quanto recentemente è cambiato, e il **Viaggio nel tempo** nasconde tutto ciò che è più recente del cursore — così puoi vedere il vault crescere.

## Calendario ed eventi

L'area **Calendario** mostra i tuoi calendari collegati nelle viste **Giorno**, **3 giorni** e **Agenda** — lo stesso modello di account del desktop. Vi accedi dalla barra di navigazione o tramite **Aree**. Toccare un evento ne mostra i dettagli; per un invito puoi **accettare**, contrassegnarlo come **provvisorio** o **rifiutare** direttamente lì. Le note giornaliere non si trovano qui: vivono in **Oggi**.

Gestisci gli account dall'icona a forma di ingranaggio nel calendario degli eventi: collega **CalDAV** sul dispositivo con una password per app (es. Fastmail, Nextcloud, iCloud); Google e Microsoft seguono tramite accesso dal browser. Per ogni account puoi mostrare o nascondere singoli calendari.

Da un evento, **Nota della riunione** crea la nota che gli appartiene — la stessa nota che trova anche il desktop: resta collegata all'evento, quindi richiamarla di nuovo la riapre invece di crearne una seconda, e finisce nella **Cartella riunioni**. Quella cartella e il **Calendario predefinito** (quello in cui inizia un nuovo evento) si impostano nell'area degli account, sotto **Impostazioni calendario**; entrambi appartengono al vault e viaggiano con la sincronizzazione delle impostazioni. Lo stesso posto ti permette di scegliere, per account, quali **Elenchi attività** si riflettono nel tuo database attività.

**L'accesso è per dispositivo.** A sincronizzarsi sono le *impostazioni* del tuo account, mai l'accesso in sé — è voluto: le credenziali non devono lasciare il dispositivo. Un account arrivato così tramite la sincronizzazione delle impostazioni compare quindi nell'elenco, ma porta il contrassegno **accedi**, con una riga sotto che indica cosa fare. Finché nessun account ha eseguito l'accesso su questo dispositivo, il calendario lo spiega lì al posto di restare semplicemente vuoto, e **Accedi su questo dispositivo** ti porta agli account. Gli account con l'accesso eseguito mostrano **attivo**. Se un accesso scade più tardi o viene revocato, la riga dice **accesso scaduto** insieme al motivo — e **Accedi di nuovo** lo rimette in funzione senza rimuovere l'account: lo stesso account, gli stessi calendari.

**Un accesso per tutti i servizi — anche qui.** Se un account Microsoft o Google porta più servizi (ad esempio file e calendario), la panoramica **Account cloud** propone di unirli in un unico accesso. Da quel momento un solo accesso tiene attivi tutti i servizi invece di uno soltanto — prima, un servizio poteva continuare a funzionare mentre un altro dello stesso account era già scaduto in silenzio. Una casella Gmail resta esclusa: funziona tramite IMAP con una password per app e non richiede alcun consenso.

## E-mail

In **Impostazioni → E-mail** colleghi una **casella Microsoft** (Outlook.com, Microsoft 365) direttamente tramite l’accesso nel browser, senza password per app. Come per il calendario, l’accesso vale per dispositivo.

In seguito puoi aprire **E-mail** come area a sé dal ▾ accanto al titolo e collocarla nella barra di navigazione. La riga sotto il titolo mostra cartella, non letti e account, e apre il selettore delle cartelle. Tocca un messaggio per leggerlo; **Salva come nota** lo archivia nella cartella **Mail** del tuo vault (catturarlo due volte apre la stessa nota). Le immagini remote restano bloccate finché non le consenti per quel messaggio: un’immagine caricata rivela al mittente quando e dove hai letto.

**Anche le caselle IMAP funzionano sul telefono.** Aggiungine una in **Impostazioni → E-mail**: scegli il provider, inserisci l’indirizzo e la password per app, e Plainva compila i server. Se il tuo provider non è nell’elenco, **Avanzate** ti permettono di inserire tu stesso i server IMAP e SMTP, le porte e un nome utente diverso, e un account esistente si può modificare in seguito. Per selezionare più messaggi basta tenere premuto uno di essi; poi un tocco ne aggiunge altri. Nella vista conversazioni, tenere premuta o toccare la riga della conversazione sceglie l’intero scambio — e ogni messaggio conserva la propria cartella, quindi una risposta da **Inviata** viene contrassegnata lì.

Un messaggio aperto offre **Rispondi**, **Rispondi a tutti** e **Inoltra**. Una risposta cita l'originale sotto il tuo testo; "Rispondi a tutti" include anche gli altri destinatari e omette il tuo indirizzo. Quando **componi**, **Allega file** aggiunge un file dal vault — sul telefono il vault è l'archivio a cui puoi accedere, e tutto ciò che arriva sul dispositivo (un allegato salvato, una foto inserita) si trova già lì. Ogni allegato ha una propria riga con **Rimuovi allegato**, finché il messaggio non è ancora partito.

Un messaggio che hai iniziato non deve per forza essere inviato: **Salva bozza** lo archivia nella cartella delle bozze del tuo account — dove qualsiasi programma di posta su quella casella lo troverà, non in un posto riservato al telefono. Quale sia quella cartella lo dice il server; solo quando tace il nome viene indovinato. Nell'elenco, accanto alla riga della cartella ci sono due interruttori: **Non letti** riduce ciò che è caricato al momento (così il contatore e **Carica altro** restano raggiungibili), mentre **Contrassegnati** chiede al server tutti i messaggi contrassegnati della cartella — compresi quelli ben oltre la pagina caricata. In **Tutte le caselle di posta** l'interruttore dei contrassegnati manca di proposito: quella richiesta indica esattamente una casella.

Da un messaggio aperto, tre strade portano nel vault: **Salva come nota**, **→ Attività** nel menu ⋮ (crea una voce nel tuo database attività predefinito — con il suo modello, lo stato e la data del messaggio) e **+ .eml**, che salva inoltre il messaggio originale e vi rimanda dalla nota. Tutte e tre sono ancorate: catturare due volte lo stesso messaggio apre ciò che c'è già. **Elimina** ora si trova anche nel menu ⋮ invece che accanto alla freccia indietro; nell'elenco basta uno scorrimento. Spostare nel cestino offre **Annulla**, perché è reversibile — l'eliminazione definitiva dal cestino continua a chiedere conferma, perché non lo è. E invece di più avvisi impilati uno sopra l'altro c'è ora **una sola** riga: l'errore, altrimenti gli account non raggiungibili (da due in su, come numero), altrimenti la nota sulla copia salvata.

Una nota può essere inviata dal proprio menu ⋮: **Invia la nota via e-mail (mailto)** la consegna all'app di posta del telefono — per questo Plainva non ha bisogno di un proprio account — mentre **Invia per email** apre l'editor di composizione proprio di Plainva con oggetto e testo.

## Sincronizzazione

Le **Impostazioni** (in fondo a **Note**) portano, tramite **Vault attivo**, alla gestione dei vault; lì colleghi l'archiviazione cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Collega un vault cloud** porta un vault cloud esistente sul dispositivo; **Crea un vault** chiede prima **Su questo dispositivo** o **Presso un servizio online** e poi la struttura iniziale (vuota o un modello come PARA) — nel percorso online segue la connessione, la cartella di destinazione nel cloud può essere creata al momento tramite **Nuova cartella** nel foglio di selezione, e la struttura viene caricata alla prima sincronizzazione. Il primo avvio offre la stessa scelta tra un vault cloud esistente e uno nuovo ("Collega un vault cloud"). Ogni connessione ottiene un proprio vault separato sul dispositivo. La pagina del vault mostra stato, avanzamento, trasferimenti in sospeso e offre **Esporta il vault** (uno ZIP tramite il foglio di condivisione).

La pagina del vault è organizzata in base a cosa servono i suoi controlli: in alto una **scheda di stato** risponde all'unica domanda con cui si apre questa pagina — sta funzionando? (stato, ultima esecuzione, trasferimenti in sospeso e intervallo su una riga). Sotto, gruppi con nome — **Connessione**, **Contenuti** — e in fondo, separata da un proprio bordo, la **Zona pericolosa** con **Disconnetti la sincronizzazione** e **Elimina vault**. Prima c'erano fino a nove pulsanti identici in una sola riga, con **Ripristina i file eliminati** proprio accanto a **Elimina vault**.

Sotto **Contenuti**, accanto a **Esporta il vault**, c'è ora anche il **backup automatico del vault**: uno ZIP dell'intero vault al giorno, di cui vengono conservati gli ultimi **sette** (**Backup da conservare**); **Esegui backup ora** ne crea uno subito. Gli archivi si trovano nei documenti del dispositivo, non nella cache — ciò che il sistema operativo può svuotare in qualsiasi momento non è un archivio. Un telefono non ha una sveglia in background: il controllo avviene all'apertura dell'app e ogni volta che vi si torna, quindi il backup recupera invece di eseguirsi a un orario fisso. La riga sotto l'interruttore indica quindi quando è stato eseguito l'ultima volta — è così che diventa visibile un backup che, in silenzio, non avviene mai. Finora sul mobile esisteva solo l'esportazione manuale, quindi un vault che nessuno pensava di esportare non aveva alcun archivio.

La frequenza con cui questo vault controlla le modifiche remote si imposta nella stessa pagina (**intervallo di sincronizzazione**, almeno 5 secondi) — i salvataggi locali partono comunque subito. Per Google Drive, OneDrive, Dropbox e S3 la **cartella cloud** può essere cambiata anche in seguito; con WebDAV la cartella fa parte dell'indirizzo del server, quindi ci si ricollega. Se la sincronizzazione delle impostazioni è cifrata puoi attivare anche **Chiedi la passphrase a ogni avvio**: la chiave non viene salvata sul dispositivo. E **Sicurezza e condivisione** dichiara ora apertamente che gli spazi di lavoro cifrati sono sperimentali e non ancora verificati in modo indipendente — conserva al sicuro il file e il codice di ripristino.

La pagina del vault indica anche se le tue **impostazioni** ti seguono — come una scheda con uno stato chiaro invece di un semplice pulsante:

- **Non vengono sincronizzate**: la sincronizzazione delle impostazioni è disattivata per questo vault. Attivala dal desktop.
- **Non ancora crittografato**: questo vault non ha ancora una passphrase di sincronizzazione. Ora puoi impostarne una **sul telefono**: la procedura guidata mostra il codice di ripristino e ti fa reinserire due gruppi scelti a caso prima che venga scritto qualsiasi cosa. Se in cloud esiste già una passphrase, il telefono te lo dice e non ne crea mai una seconda — questo escluderebbe tutti gli altri dispositivi.
- **Non ancora sbloccato su questo dispositivo**: le tue impostazioni sono memorizzate crittografate nel cloud. Inserisci la passphrase scelta durante la configurazione — sul desktop o qui, sul telefono; questo dispositivo le sblocca una volta con essa.
- **Vengono sincronizzate**: questo dispositivo è sbloccato; cartelle, viste e regole di backup restano allineate con i tuoi altri dispositivi.

Ogni scheda indica anche cosa *non* viaggia: gli accessi restano sempre sul dispositivo (vedi [Calendario ed eventi](#calendario-ed-eventi)).

**Impostazioni** → **Sicurezza e condivisione** indica che cos'è realmente la connessione e, per un normale vault cloud, configura l'area di lavoro crittografata direttamente sul telefono (identità → file di ripristino e codice → attivazione). Senza connessione cloud non c'è nulla da crittografare, e la sezione lo dice.

Entrambe le configurazioni — l'area di lavoro crittografata e la passphrase di sincronizzazione — funzionano ora come **un proprio flusso, senza barra di navigazione**: finché una delle due è aperta c'è esattamente un'uscita, e questa chiede conferma. Non è un ornamento. Fino all'ultimo passaggio la tua chiave esiste solo in memoria, e uscire la scarta; prima, un tocco sulla barra poteva farlo senza dire nulla. L'ultimo passaggio mostra una barra di avanzamento quando c'è qualcosa da contare — l'area di lavoro cifra di nuovo ogni file, mentre la passphrase di sincronizzazione comporta due scritture, e inventare una percentuale per quest'ultima sarebbe una bugia a forma di barra.

**Le condivisioni si gestiscono ora qui**, non più solo sul desktop: in **Persone e permessi** inviti un membro con un ruolo (**Invita** lo crea — il suo dispositivo lo associ dopo), crei un gruppo e cambi il ruolo di un gruppo direttamente nella sua riga. In **Slice** crei una condivisione per una **Cartella**. Deliberatamente non sul telefono: le slice da una selezione libera o da una regola dinamica — entrambe richiederebbero superfici che qui non esistono — oltre al cambio delle chiavi, al trasferimento della proprietà e alla dismissione, che per ora restano sul desktop.

## Rete di sicurezza

Gli snapshot (cronologia delle versioni), un diario delle bozze (dopo un arresto anomalo la nota offre l'ultimo stato non salvato) e le copie in conflitto con una vista di confronto proteggono i tuoi dati. La conservazione si configura in **Impostazioni** → **Backup e cronologia delle versioni**.

## Condivisione e scorciatoie

Su Android e iOS, il testo e gli URL condivisi diventano una nuova nota nella cartella Inbox; le immagini e i file condivisi vengono importati come allegati (massimo 25 MB per file). Su Android, tieni premuta l'icona dell'app per le scorciatoie aggiuntive **Nuova nota** e **Oggi**.

## Cartelle, foto e calendario

Il pulsante mobile **Più** resta disponibile nelle cartelle annidate, e ogni azione di creazione rapida crea nella cartella che hai aperto — comprese le nuove cartelle. Il ⋮ nell'intestazione appartiene invece all'oggetto aperto: mostra le azioni di quell'oggetto, mai le impostazioni dell'app.

Il pulsante foto dell'editor propone **Scatta una foto** o **Scegli dalla libreria**, conserva la posizione di inserimento e segnala in modo visibile gli errori di autorizzazione o di file. Le foto finiscono nella cartella degli allegati del vault — la stessa che usa il tuo computer.

Eventi e note giornaliere sono deliberatamente separati: **Calendario** mostra i calendari collegati (vedi [Calendario ed eventi](#calendario-ed-eventi)), **Oggi** mostra la nota giornaliera di un giorno scelto. Non esiste una vista mensile locale delle note giornaliere — a questo pensa la striscia in **Oggi**.

## Allegati e immagini

Oltre a note e database, il navigatore mostra ora gli **allegati**: immagini, PDF e tutto ciò che si trova nella cartella. Un’immagine si apre dentro Plainva; il resto passa al sistema, che sa che cos’è un PDF mentre Plainva no. **Condividi** consegna un file a qualsiasi altra app.

Il menu ⋮ di una nota contiene **Esporta come Markdown…**: consegna il file stesso al pannello di condivisione del sistema, dove trovi Stampa, «Salva su File» e ogni editor installato. **Condividi**, sopra, invia solo il testo della nota.

## Scorrimento

**Scorri una riga di nota verso sinistra** nell'elenco per rivelare due azioni: **Segnalibro** e **Elimina**. Eliminare chiede conferma tramite la stessa finestra di dialogo di sempre. Mentre selezioni più righe, lo scorrimento è disattivato — un gesto che indica esattamente una riga non ha un significato chiaro accanto a una selezione che stai ancora componendo. Lo stesso gesto elimina un messaggio nell'elenco della posta.

## Su schermi larghi

L'app segue la larghezza della finestra, non il nome del dispositivo:

- **sotto i 600 px** — una superficie dopo l'altra, come sul telefono.
- **da 600 a 839 px** — la barra di navigazione diventa una **barra laterale**; resta comunque un'unica superficie.
- **da 840 px in su** — il navigatore e la superficie di lavoro stanno **fianco a fianco**. È lo stesso navigatore dell'area **Note**, solo accanto al tuo lavoro invece che davanti.

Su un tablet, o su un telefono grande ruotato, ottieni lo stesso modello spaziale del desktop — navighi a sinistra, lavori al centro — invece di un telefono ingrandito.
