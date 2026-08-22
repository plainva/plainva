# Cattura e-mail

Ultimo aggiornamento: 2026-08-22

Plainva può leggere la tua casella di posta per estrarre conoscenza dalle e-mail e portarla nel tuo vault, e — dalla 0.4.0 — anche scrivere e inviare e-mail. L'attenzione resta sulla **cattura** dei messaggi come note; una casella collegata tramite **IMAP** viene letta solo per la cattura (non cambia nulla in essa, nemmeno i contrassegni di lettura) finché non configuri l'invio.

> **Sperimentale.** Il client di posta comunica con account esterni reali (IMAP/SMTP e Microsoft) che non si possono esercitare nei test automatizzati di Plainva. Funziona ed è usato quotidianamente, ma trattalo come un'anteprima: mantieni un backup e segnala per favore tutto ciò che sembra fuori posto.

## Collegare una casella di posta

**Impostazioni → Vault → Account cloud → Collega account…** e scegli il provider:

- **Microsoft** — per Outlook.com e Microsoft 365: spunta **E-mail** nel passaggio dei servizi (se vuoi, insieme a **File** e **Calendario e attività** — un account, un accesso) e accedi direttamente nel browser, senza password per l'app e senza IMAP. Plainva usa la registrazione app centrale di Plainva (puoi facoltativamente fornire un tuo ID app nei dettagli dell'account). Lettura, cattura e **invio diretto** passano tutti attraverso l'accesso Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — schede dedicate: indirizzo e-mail più una **Password per app**, i server sono già precompilati (la maggior parte di queste schede permette anche di spuntare **Calendario e attività** nello stesso passaggio — una sola password per app per tutti i servizi scelti). L'assistente collega di volta in volta la guida ufficiale del provider per creare la password per app.
- **Server e-mail (IMAP)** — per qualsiasi altro provider: host, porta e una password oppure una **Password per app**. Sono disponibili preimpostazioni già pronte per provider di tutto il mondo — da **web.de**/**GMX** e **T-Online**, passando per **Orange**, **Libero**, **WP**, **Seznam** e **Comcast**, fino a **QQ Mail**, **NetEase**, **Naver** e **Yahoo! JAPAN**; il menu **Provider** ha per questo una riga di ricerca, e digitando il tuo indirizzo viene scelta automaticamente la preimpostazione corrispondente. Dove un provider ha delle particolarità, l'assistente lo segnala subito sotto il modulo: alcuni richiedono una **Password per app** o un **codice di autorizzazione** al posto della password dell'account, altri richiedono di attivare prima IMAP nelle impostazioni del provider — ciascuno con un link alla guida ufficiale. Per Gmail è `imap.gmail.com`, porta `993`, con una password per app da [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (richiede l'autenticazione a due fattori) — nessun OAuth, nessuna verifica; l'assistente lo segnala da solo per gli indirizzi Gmail. Le **caselle Outlook.com** non si possono più collegare tramite IMAP con password (Microsoft ha disattivato questa via) — la preimpostazione rimanda alla scheda **Microsoft**. **Proton Mail** funziona solo tramite il Proton Mail Bridge locale a pagamento (ha una propria preimpostazione). Aggiungi un host SMTP per inviare direttamente.

Il collegamento verifica l'accesso prima che venga salvato qualcosa; le credenziali finiscono nel portachiavi del sistema operativo. Le caselle collegate e le impostazioni di cattura si trovano poi nell'area **E-mail**: l'impostazione **Cartella e-mail** sceglie dove vengono salvate le e-mail catturate (predefinita `Mail`).

**Accedere su un secondo dispositivo.** Quando una casella arriva tramite la sincronizzazione delle impostazioni, la sua password non la segue automaticamente: gli accessi vengono trasferiti solo se attivi tu la sincronizzazione delle credenziali. Una casella così mostra il pulsante **Accedi su questo dispositivo** nell'area **E-mail**: digita la password e Plainva la verifica presso il provider prima di salvarla nel portachiavi. Per una casella Microsoft lo stesso pulsante porta a **Account cloud**, perché è lì che avviene l'accesso nel browser. Se questo lascia vuoto l'elenco dei messaggi, lo stesso avviso con lo stesso pulsante compare anche lì — non devi cercare le impostazioni da solo.

## Leggere le e-mail

Apri la scheda e-mail dalla barra delle azioni all'estrema sinistra (icona e-mail) o dalla palette dei comandi (**Apri e-mail**). L'elenco mostra la tua posta in arrivo dalla più recente (non lette in grassetto, **Carica altro** procede oltre). Selezionare un messaggio lo apre in un **visualizzatore sandbox**:

- **I contenuti remoti sono bloccati** — i pixel di tracciamento, le immagini remote e i caricatori di stile vengono rimossi e conteggiati ("Contenuti remoti bloccati (n)"). Vengono visualizzate solo le immagini inline autonome. **Mostra immagini** accanto al contatore rivela una tantum le immagini https del messaggio; **Carica sempre le immagini remote** nelle impostazioni della posta trasforma questo in un'opzione permanente. Attenzione: caricare le immagini remote permette al mittente di vedere il tuo indirizzo IP e quando hai aperto l'e-mail — per questo il blocco è l'impostazione predefinita.
- **Letto vuol dire letto** — un messaggio che apri conta come letto dopo tre secondi. Se lo segni **non letto a mano**, resta non letto finché è aperto; il conto alla rovescia riparte solo quando lo chiudi e lo riapri. Uguale su entrambi i dispositivi — prima, il timer del desktop annullava il contrassegno dopo tre secondi, e il telefono segnava un messaggio come letto non appena veniva aperto.
- I link vengono mostrati come testo semplice e non sono cliccabili all'interno del visualizzatore.
- Gli script e i moduli non vengono mai eseguiti. Il messaggio viene visualizzato in un frame isolato con criteri di contenuto rigidi.
- **I messaggi larghi vengono adattati** — molte newsletter sono costruite per una larghezza di colonna fissa e non possono essere ridisposte. Invece di tagliare un messaggio del genere sul bordo sinistro, Plainva lo riduce alla larghezza del frame; sul telefono il frame cresce con esso, così scorri la pagina come al solito.
- **Conversazioni** — l'interruttore sopra l'elenco (icona a fumetto) raccoglie i messaggi collegati in una sola riga: partecipanti, numero e l'oggetto con cui lo scambio è iniziato. Un tocco la espande; ogni messaggio conserva la sua cartella e la indica quando non è quella aperta. Per questo Plainva legge anche **Inviata**, così le tue risposte fanno parte della conversazione. Disattivato, tutto resta come prima — un elenco piatto — e la scelta è ricordata per vault, su entrambi i dispositivi. Il raggruppamento segue la catena di risposte dei messaggi (su Microsoft, la conversazione che tiene il fornitore stesso); solo se una risposta non porta quella catena subentra l'oggetto, e allora solo per una risposta riconoscibile («Re:», «I:») entro 30 giorni, perché due messaggi che condividono solo l'oggetto non si fondano.
- **Tutte le caselle di posta** — la prima voce sopra l'elenco delle cartelle mostra la posta in arrivo di **tutti** gli account in un unico elenco, dalla più recente, e ogni riga indica l'account a cui appartiene. Letto/non letto e il contrassegno funzionano anche qui; spostare ed eliminare restano della singola casella, perché ogni account ha la propria cartella di destinazione: apri il messaggio e agisci nella sua casella. Un account senza accesso valido viene nominato e non svuota l'elenco degli altri.
- **Selezionare più messaggi** — Ctrl+clic (macOS: ⌘+clic) sceglie singoli messaggi, Maiusc+clic un intervallo; nella vista conversazioni un Ctrl+clic sulla conversazione sceglie l'intero scambio, e ogni messaggio conserva la propria cartella.

Gli allegati sono elencati con nome e dimensione; l'originale `.eml` (sotto) li contiene per intero.

Quando apri una cartella che hai già aperto, l'elenco compare **subito** dalla cache locale mentre l'aggiornamento gira in background; finché non arriva, un avviso dice “aggiornamento” — è confermato solo ciò che ha inviato il server. Lo stesso vale per un messaggio che hai già letto. Sul telefono il messaggio **più recente** di una cartella viene precaricato in background: si apre quindi senza attesa, anche se non lo avevi mai aperto.

Sul desktop le tre colonne (cartelle · elenco · lettore) si trascinano dai separatori; le larghezze vengono ricordate **per vault** e sopravvivono a un riavvio. Ogni colonna mantiene una larghezza minima, così il lettore non può essere schiacciato.

Quando un aggiornamento fallisce — niente rete, oppure il provider sta limitando le richieste —, l'elenco continua a mostrare l'ultima copia vista su questo dispositivo, con un avviso che lo dice, invece di un riquadro vuoto. Un messaggio già letto resta leggibile allo stesso modo. Resta comunque solo una cache: il server ha sempre ragione, nulla qui è l'unica copia di qualcosa e rimuovendo il vault sparisce con esso.

## Portare un messaggio nel vault

Tre pulsanti su ogni messaggio:

- **Salva come nota** — crea una nota nella tua cartella e-mail (`AAAA-MM-GG Oggetto.md`) con mittente e data nel frontmatter e il corpo in testo semplice sotto l'intestazione dell'oggetto. Catturare due volte lo stesso messaggio apre la nota esistente invece di duplicarla.
- **+ .eml** — memorizza inoltre l'originale grezzo accanto alla nota e lo collega. Il file `.eml` contiene tutto, allegati inclusi, e si apre in qualsiasi programma di posta. Se la nota esiste già, la copia originale viene aggiunta — a meno che non ce ne sia già una collegata.
- **→ Attività** — crea una voce nel tuo [database attività predefinito](Tasks.md) con l'oggetto come titolo, la data odierna come scadenza e lo stato aperto precompilato.

## Scrivere e inviare

Non appena un account può inviare — un account **Microsoft**, oppure un account **IMAP** con un **host SMTP** configurato —, puoi scrivere e inviare e-mail da Plainva:

- **Scrivi** (nella scheda e-mail) apre una finestra fluttuante con righe etichettate **Da / A / Cc / Ccn**. Digita un indirizzo e premi Invio o virgola per trasformarlo in un chip; **Cc/Ccn** compaiono su richiesta. Il corpo è un editor Markdown con una barra degli strumenti di formattazione e un menu comandi "/". Un link `[testo](https://…)` compare come un link già formato mentre scrivi — i caratteri Markdown ricompaiono non appena il cursore vi entra, e un clic apre la destinazione nel tuo browser. All'invio il corpo viene comunque convertito in HTML: il destinatario riceve sempre un link vero, indipendentemente da come appariva nella finestra.
- **Inserisci modello…** mette un modello di nota nel corpo del messaggio. Le domande del modello (`{{prompt:…}}`) vengono poste **una volta sola, in un'unica finestra**, invece di viaggiare come segnaposto; il suo frontmatter resta fuori — un corpo di posta non ne ha, e il destinatario riceverebbe YAML. Se annulli, non viene inserito nulla.
- **Rispondi**, **Rispondi a tutti** e **Inoltra** su qualsiasi messaggio aprono la stessa finestra con l'originale citato e i destinatari precompilati; un inoltro porta con sé gli allegati.
- **Invia** parte via SMTP (account IMAP) o Microsoft Graph (account Microsoft).
- **Questa nota via e-mail** (menu `⋮` di una nota, o la palette dei comandi) avvia un messaggio con la nota attuale come allegato, oppure incorporata come testo.

## La posta in una finestra propria

Fai clic destro su **E-mail** nella barra delle azioni per aprire la casella in una finestra propria; **Apri finestra comunicazioni** nella palette dei comandi mette posta e calendario affiancati.

Durante la composizione, l'icona a comparsa solleva la finestra di composizione in una finestra propria — destinatari, oggetto, testo e allegati viaggiano con essa, compreso un indirizzo appena digitato e non ancora confermato. **L'invio avviene comunque nella finestra principale**: la finestra di composizione consegna il messaggio e si chiude, e l'avviso con **Annulla** compare dove stai continuando a lavorare. Così chiudere una finestra non decide mai tra inviare e perdere.

Una finestra di composizione **non** viene ripristinata al prossimo avvio — quello che contiene vive in memoria. Quindi finisci un messaggio lungo, oppure salvalo come bozza.

## Consegnare una nota senza il client di posta

Non devi inviare dall'interno di Plainva. Questo funziona con qualsiasi nota e non richiede SMTP:

- **Rispondi come nota** (su un messaggio): crea una nota indirizzata al mittente (`to:` nel frontmatter) con l'originale citato — scrivi la tua risposta in Plainva.
- **Salva la nota come bozza nella casella** (palette dei comandi, su qualsiasi nota aperta): salva la nota come **bozza nella tua casella** tramite IMAP — scegli account, destinatario e cartella bozze, poi apri il tuo programma di posta abituale, controlla e invia da lì. La formattazione viene mantenuta.
- **Invia la nota via e-mail (mailto)** (palette dei comandi): apre il tuo programma di posta predefinito con la nota come testo semplice (le note lunghe vengono accorciate).
- **Copia la nota come testo e-mail** (palette dei comandi): mette la nota negli appunti con la formattazione — incollala in qualsiasi finestra di composizione e-mail.

## Firma e indirizzi mittente

In **Impostazioni → E-mail → Invio** ogni casella ha due impostazioni proprie:

- **Firma** — in Markdown, aggiunta sotto il tuo testo quando scrivi (e sopra un originale citato o inoltrato, dove il lettore se la aspetta). Cambiando mittente nella finestra di composizione la firma viene sostituita invece di accumularne una seconda. Il campo usa lo stesso editor della finestra di composizione, quindi vedi la firma come verrà inviata.
- **Firma per indirizzo** — quando hai altri indirizzi mittente, sopra il campo compare la scelta **Firma per**. «Predefinita (tutti gli indirizzi)» è la firma dell'account; scegli un indirizzo per scriverne una solo per lui. Gli indirizzi senza firma propria continuano a usare quella predefinita, e cambiare mittente mentre scrivi inserisce quella giusta — anche tra due indirizzi dello stesso account. Se svuoti il campo di un indirizzo, torna alla predefinita.
- **Altri indirizzi mittente** — uno per riga, ad es. `Nome <alias@example.org>`. Il campo **Da** elenca allora indirizzi anziché account: prima quello della casella, poi i suoi alias. Se un indirizzo venga davvero accettato lo decide il tuo provider: un server che rifiuta l'invio con un alias lo dice, e Plainva mostra quell'errore invece di inviare in silenzio con un altro nome.

## Azioni sulla casella

Stelle e contrassegni si sincronizzano tramite IMAP e Microsoft; **Contrassegnati** mostra la selezione del server. I messaggi si possono spostare singolarmente o in gruppo. Fuori dal cestino, **Elimina** significa sempre “sposta nel cestino”; solo nel cestino compare **Elimina definitivamente** dopo una conferma. Con Gmail, lo spostamento cambia le etichette e le azioni in **Tutti i messaggi** possono interessare il messaggio in ogni etichetta; Plainva avvisa prima.

## Disiscriversi e annullare l'invio

Quando un messaggio porta l'intestazione `List-Unsubscribe`, Plainva mostra nel lettore un pulsante **Disiscriviti**. Quello che accade dopo è ciò che ha indicato il **mittente**: Plainva non indovina nulla dal corpo e non fa clic al posto tuo. Un indirizzo web si apre nel browser dopo una conferma; un indirizzo di posta finisce nella finestra di scrittura, così vedi che cosa esce. I percorsi `http://` non cifrati vengono scartati, perché disiscriversi in chiaro trasmette il tuo indirizzo in chiaro.

**Annulla invio** è un **ritardo, non un richiamo**: dopo l'invio Plainva attende qualche secondo prima di consegnare il messaggio al server, e in quel tempo un avviso tiene pronto il pulsante **Annulla**. Poi il messaggio è partito e non si ferma più — nessun programma di posta può recuperare un messaggio consegnato. Se in quel momento esci da Plainva (sul telefono: passi a un'altra app), l'invio parte **subito** invece di essere annullato: un messaggio che hai chiesto di inviare non deve sparire perché l'app è passata in secondo piano.

## Rimandare

C'è posta che non è urgente ma nemmeno conclusa. **Rimanda** toglie un messaggio dall'elenco fino a un momento che scegli: più tardi oggi, domani mattina, nel fine settimana o la prossima settimana. Sul computer la voce sta nel menu contestuale della riga; sul telefono è anche un gesto di scorrimento. Il pulsante **Rimandati** li riporta alla vista; da lì **Riporta ora** rimette subito un messaggio nell'elenco.

Due cose da dire chiaramente. Primo: rimandare è un **contrassegno di Plainva**, non una funzione del server — né IMAP né Microsoft conoscono qualcosa del genere. Il contrassegno viaggia con la sincronizzazione delle impostazioni, quindi un messaggio rimandato sul telefono riposa anche sul computer; in un altro programma di posta sta normalmente nella posta in arrivo. Secondo: rimandare nasconde soltanto l'**elenco della cartella** in cui l'hai fatto — la ricerca e «Tutte le caselle» continuano a mostrare il messaggio. Rimandato significa «non tra i piedi», non «sparito».

## Segnalare lo spam

**Spam** sposta un messaggio nella cartella spam dell'account e, dove il server lo supporta, lo contrassegna con la parola chiave `$Junk`. Nella cartella spam lo stesso pulsante diventa **Non è spam** e riporta il messaggio nella posta in arrivo. Entrambi sono disponibili nel lettore, nella selezione multipla e, sul telefono, come azione di scorrimento della riga.

Onestamente: **spostare da solo non addestra necessariamente il filtro.** Alcuni server imparano, altri memorizzano soltanto la parola chiave, altri ancora la rifiutano. Dopo l'azione Plainva dice cosa è successo davvero — «contrassegnato come spam e spostato» oppure solo «spostato». Se il tuo account non ha alcuna cartella spam, Plainva propone di creare una cartella **Junk** invece di spingere la posta in un nome di cartella inventato.

## Risposta automatica di assenza

Una risposta automatica appartiene al server, non a un programma che per caso è aperto. Perciò Plainva la offre **solo dove sopravvive allo spegnimento del computer**: sugli account Microsoft e sulle caselle con un server Sieve (mailbox.org, Fastmail, Nextcloud, Mailcow e altri). Se una casella non ha né l’uno né l’altro, non compare alcun interruttore ma una frase che lo spiega.

La trovi in **Impostazioni → E-mail** e, sul telefono, nell’area degli account: oggetto, testo e un periodo. Senza periodo la risposta resta attiva finché non la disattivi; con un periodo inizia e finisce da sola, anche se non apri più Plainva.

**Le tue regole di filtro restano intatte.** In uno script Sieve Plainva scrive soltanto la propria sezione, contrassegnata con `# --- BEGIN PLAINVA`, e lascia tutto il resto carattere per carattere. Se vi trova una sezione che non può leggere in sicurezza, non cambia **nulla** e te lo dice.

## Regole

Una regola controlla mittente, destinatario o oggetto e poi fa qualcosa: sposta, segna come letto, contrassegna, segnala come spam o mette nel cestino. Le trovi in **Impostazioni → E-mail**.

**Ed ecco la parte importante:** per ora le regole vengono eseguite **solo mentre Plainva è aperto** e solo sui messaggi che Plainva ha scaricato. Sul telefono significa inoltre: solo mentre l’app era in primo piano. Una regola quindi non filtra nulla mentre il computer è spento — la scheda lo dice sul posto, invece di lasciar intendere un filtro lato server che qui non c’è ancora.

Se una regola controlla il **testo del messaggio**, vale solo quando apri il messaggio: il testo non è nell’elenco. Anche questo è scritto sulla scheda.

**Salvare presso il provider.** Se la casella dispone di un server Sieve, il pulsante **Salva presso il provider** trasforma le regole in un filtro lato server: funziona quindi anche a Plainva chiuso. Plainva scrive solo la propria sezione contrassegnata e lascia intatte le regole scritte a mano — la stessa promessa della risposta automatica, perché entrambe condividono quell'unica sezione.

Una regola che il server non può esprimere — per esempio un controllo sul corpo del messaggio su un server privo dell'estensione corrispondente — resta **locale**, e Plainva te lo dice. Non viene caricata di proposito: uno script con un requisito sconosciuto al server viene rifiutato **per intero**, portandosi via anche la risposta automatica.

Le regole di Gmail si impostano ancora nelle impostazioni di Google.

**Con Microsoft** non serve un server aggiuntivo: lo stesso pulsante salva le regole come regole di Outlook nella casella. Plainva sostituisce solo le regole che ha creato lui stesso e lascia intatte le tue — e le colloca *dopo* le tue, perché una regola scritta a mano c'era prima. Microsoft confronta solo con «contiene»: «è esattamente», «inizia con», «finisce con», una regola sui destinatari in copia e la marcatura restano quindi locali, e ti vengono indicate.

**Sul telefono** crei le regole per intero: nelle impostazioni di posta tocca una regola e la vedrai come **Se** e **Allora** — ogni condizione e ogni azione è una riga, e toccandola vengono chiesti campo, confronto e valore su fogli separati. Non è un modulo rimpicciolito, di proposito: cinque controlli affiancati sulla larghezza di un telefono sono il modo in cui una regola viene digitata male. L'ultima condizione non si può togliere: una regola senza condizioni varrebbe per ogni messaggio.

**Salva come nota** è l'azione che nessun programma di posta ha: la regola salva il messaggio come nota nel tuo vault, con mittente, data e testo — la stessa acquisizione del pulsante nel lettore, ma automatica. La stessa mail due volte dà la **stessa** nota, e il messaggio resta nella sua cartella: viene salvata una copia, non si sposta nulla. Una regola con questa azione resta **sempre** locale, anche su una casella che saprebbe eseguire regole. È voluto: salvare il resto della regola presso il provider lascerebbe che il server spostasse il messaggio prima che ci fosse qualcosa da salvare.
