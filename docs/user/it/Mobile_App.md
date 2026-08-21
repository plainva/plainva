# L'app mobile

Ultimo aggiornamento: 2026-08-21

Plainva è disponibile anche come app per Android e iOS. Funziona con gli stessi file Markdown, lo stesso formato **OKF** e lo stesso motore di sincronizzazione dell'app desktop — il tuo vault resta identico in entrambi i mondi.

## Installare l’app

L’app mobile è in **test aperto** su Google Play. Su **Android** si entra direttamente: apri il link del test da [plainva.com/android-beta](https://plainva.com/android-beta), tocca **Diventa tester** e installa l’app da Google Play — nessun invito e nessun gruppo a cui iscriversi. Plainva è pubblicato anche sul Play Store. Su **iPhone** la distribuzione passa da TestFlight; la lista d’attesa è su [plainva.com](https://plainva.com).

È una build iniziale: tieni un backup del tuo vault e dimmi cosa non va.

## Layout

- **Barra inferiore:** **da due a quattro** superfici di lavoro a tua scelta, più la voce fissa **Aree** in fondo — in tutto, da tre a cinque destinazioni per una barra. **Note** resta sempre visibile: è così che accedi ai tuoi file.
- **Ogni area** (Note, Oggi, Attività, Calendario, E-mail, Grafo) resta a un tocco di distanza grazie al **foglio delle aree**: **Aree** nella barra, il **▾ accanto al titolo**, oppure una **pressione prolungata sulla barra**. Il foglio segna l'area attuale e porta direttamente, in basso, a **Personalizza la barra di navigazione…**. Tag, segnalibri ed elementi aperti di recente non sono più aree a sé stanti — si trovano ora sotto **Note**.
- **Configurare la barra:** **Impostazioni** → **Barra di navigazione**. Usa **−**/**+** per stabilire quante superfici di lavoro mostra la barra (2–4, con anteprima dal vivo) e la **maniglia di trascinamento** per ordinare l'elenco: le voci in alto formano la barra (contrassegnate da una cornice), trascinarne una verso l'alto la promuove nella barra. Trascinando fino al bordo superiore o inferiore, l'elenco scorre di conseguenza, così un unico movimento copre l'intero elenco. Non viene mai nascosto nulla — ciò che non è nella barra resta raggiungibile tramite **Aree**. Se l'area in cui ti trovi lascia la barra, l'app passa alla prima visibile. Puoi organizzare la stessa barra anche **sul desktop** (Impostazioni → Vault → Barre e aree); con la sincronizzazione delle impostazioni attiva, la disposizione viaggia tra i tuoi dispositivi.
- **Una riga di cartella conta tutto ciò che sta sotto**, non solo le note che vi si trovano direttamente: una cartella piena di sottocartelle non dice più «0 note» accanto a una freccia che porta a centinaia.
- **＋** fluttua come un pulsante rotondo sopra la barra e apre la creazione rapida: nota, nota giornaliera, cartella, database, "Da modello…".
- **Tenere premuta una riga mostra ciò che quella riga sa fare**: nota, cartella, database e attività rispondono allo stesso modo, e **Seleziona più elementi** è la prima voce di quel foglio. Scorrere verso sinistra esegue direttamente le due azioni più frequenti; foglio e scorrimento offrono le stesse cose nello stesso ordine.
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

I database `.base` funzionano come su desktop: ogni vista (tabella, elenco, galleria, bacheca, calendario, cronologia), modifica tipizzata delle celle, le schede della bacheca si spostano tenendo premuto. **Configura** gestisce viste, colonne, filtri (inclusi i gruppi), ordinamento e proprietà.

La **vista calendario** ha tre periodi: **mese**, **settimana**, **giorno**. Il mese resta il punto di partenza — è l'unico che mostra ancora una forma sullo schermo di un telefono; settimana e giorno sono elenchi, perché sette colonne di contenuto smettono di essere leggibili a quella larghezza. Una voce che copre più giorni compare come **barra** invece di ripetersi ogni giorno, e gli orari precedono il titolo. La **linea del tempo** mostra una **riga per voce** con una barra dall'inizio alla fine: entrambe le estremità si **trascinano col dito**, e questo scrive il campo data della nota. In **Configura** scegli il campo data e quello di fine e **colore per** — stessa impostazione, stesso file del computer. Gli schemi di relazione (destinazioni, cardinalità) restano gestiti dal desktop.

**Più elementi alla volta**: tieni premuta una riga e scegli **Seleziona più elementi** — la prima voce di quel foglio. Da quel momento un tocco seleziona invece di aprire, e una barra in basso indica quanti sono. Da lì puoi **eliminare** la selezione (una sola domanda, non dodici — con la stessa panoramica dei collegamenti che offre un'eliminazione singola) oppure usare **Imposta valore…** per impostare una proprietà su tutti insieme: scegli prima la proprietà, poi il valore. Dove una proprietà indica **attualmente misto**, gli elementi selezionati portano valori diversi. Un valore vuoto rimuove la proprietà. Mentre è in corso vedi l'avanzamento e puoi annullare; ciò che è già stato scritto resta. Tag, elenchi, selezione multipla e relazioni non sono inclusi di proposito — lì «impostarli tutti su X» significherebbe far sparire ogni valore esistente.

Una vista **Bacheca appunti** mostra le note come una bacheca a due colonne di schede adesive: il tocco apre la nota, la pressione prolungata mostra le azioni (fissa, etichette, colore, elimina), trascinare dopo una pressione prolungata riordina, e le caselle di controllo si spuntano direttamente sulla scheda. Il campo in alto cattura una nuova nota. Suggerimento: punta il database sulla tua cartella Inbox (**Impostazioni** → **Contenuto e struttura**) e sia le note rapide del ＋ sia i testi condivisi da altre app finiscono direttamente sulla bacheca.

## Attività

L'area **Attività** raccoglie ogni casella di controllo del tuo vault — tutte le righe `- [ ]` e `- [x]` in tutte le note, raggruppate per nota. È la panoramica basata sulle righe che un database non può darti, perché un database lavora su note intere.

Toccare un'attività apre la nota **su quella riga**; la casella la spunta e riscrive esattamente il carattere `[ ]`/`[x]`. Le scadenze (`📅`) e i `#tags` compaiono come chip, così non si ripetono all'interno del testo.

Se il tuo vault ha un **database attività** (**Impostazioni** → **Contenuto e struttura**), l'area lo mostra sopra come sezione a sé: spuntare, cambiare stato, **+ Nuova attività** e **Apri come database**. Se il database indica un elenco di attività di un provider (**Configura** → **Origine dati** → **Crea anche le nuove attività in** — impostabile qui esattamente come sul desktop), il foglio di creazione porta anche un interruttore **Crea anche in “…”**: attivo, perché scegliere l'elenco è già la decisione, e disattivato per l'unica attività che deve restare nel vault. Una casella di controllo spostata e un messaggio catturato come attività seguono la stessa strada. Ogni riga con casella porta poi anche **Nel database** nella sua riga meta — la riga resta come wiki-link, e l'attività continua a vivere come nota propria.

Gli **Elenchi attività** che hai selezionato per i tuoi account vengono specchiati in quel database dal telefono stesso — importa le nuove attività, riconosce una nota esistente dalla sua àncora (invece di crearne una seconda) e invia le tue modifiche al provider. Elimina deliberatamente una nota di attività e l'attività viene eliminata anche presso il provider — con otto secondi di **Annulla**; manda l'app in background entro quel margine e l'attività resta. Un file semplicemente mancante, invece, non elimina mai nulla. Le regole nel dettaglio sono sotto [Calendario e attività](Calendar_and_Tasks.md).

Sopra l'elenco trovi gli stessi filtri del desktop: **Cartella**, **Tag**, **Con scadenza** e **Mostra nascoste**. Nascondere è una proprietà della **nota**, non della singola attività — l'icona a forma di occhio sull'intestazione di una nota scrive `plainva.tasks: false` nel frontmatter di quella nota e la toglie dalla panoramica; **Nascondi modelli** fa lo stesso contemporaneamente per l'intera cartella dei modelli. Il file mantiene le sue attività, smettono solo di essere contate. Tenere premuto **Nel database** sceglie il **database di destinazione** quando il tuo vault ne ha più di uno.

Una riga di attività mostra il titolo su tutta la larghezza; stato, scadenza, ripetizione e tag stanno sotto, ed esattamente un'azione sta a destra. **Blocca tempo** (l'icona del calendario a destra) crea un evento calendario per l'attività quando è collegato un calendario (data, inizio, durata, più il selettore di calendario quando più di uno è scrivibile); **Ripetizione** nella riga meta crea l'attività successiva con una nuova scadenza quando spunti questa. Entrambe sono descritte in [Attività](Tasks.md).

## Oggi

**Oggi** è la superficie del giorno. La striscia in alto seleziona un giorno — si estende **in entrambe le direzioni**, due settimane indietro e due settimane avanti, e un punto contrassegna ogni giorno che ha già una nota giornaliera. Sotto si trova la **nota giornaliera** del giorno selezionato (con il suo modello e la sua cartella, da aprire o creare), poi gli **appuntamenti e scadenze** di quel giorno, e infine ciò che hai modificato in quel giorno.

La sezione centrale riunisce ciò che altrimenti si trova su due aree distinte: prima gli eventi per l'intera giornata, poi quelli con un orario preciso in ordine cronologico, e infine le attività in scadenza quel giorno. Toccare un'attività apre la sua nota. Senza un calendario collegato e senza un database attività, la sezione semplicemente non c'è.

## Tag

L'elenco dei tag si trova sotto **Note**. Toccare apre le note di un tag; la freccia espande i tag annidati. **Tenere premuto** un tag offre **Rinomina tag** — in tutto il vault, come sul desktop: Plainva riscrive ogni nota che lo porta (nel frontmatter e come `#tag` nel testo, compresi i suoi `tag/child` figli) e poi ti dice in quante note è stato sostituito. Una nota che non può essere letta o scritta viene saltata — le altre vengono comunque rinominate.

## Trova e sostituisci in tutto il vault

Il percorso è la lente nell’intestazione, poi `>` e **Trova e sostituisci nel vault**. La schermata cerca in tutte le note insieme. Inserisci un termine, tocca **Trova** e le corrispondenze appaiono raggruppate per nota con il loro numero; un tocco apre le righe di una nota, e ne resta aperta una sola alla volta. Deseleziona le note da escludere: è per nota, mai per riga, perché una nota viene sostituita per intero o per niente. **Sostituisci in N note** riscrive il resto, con barra di avanzamento e un **Annulla** che si ferma alla nota successiva. Ogni nota viene riletta subito prima di essere scritta, così un’anteprima superata non può mai sovrascrivere contenuto più recente; una nota cambiata nel frattempo viene saltata e te lo diciamo. Maiuscole/minuscole, parola intera e regex valgono anche qui.
## Panoramiche (index.md)

In un vault OKF l'`index.md` è l'indice di una cartella. Il telefono offre due vie d'accesso, pensate per due momenti diversi.

**Per il momento in cui te ne accorgi:** tieni premuta una cartella — la scheda offre **Crea panoramica** se non ce n'è una e **Aggiorna panoramica** se Plainva mantiene quella esistente. La riga dichiara il proprio effetto invece di chiederti di scegliere. Se l'`index.md` di quella cartella l'hai scritto tu, la riga non compare affatto: il tuo file è tuo.

**Per il giro di riordino:** **Impostazioni → Vault → Manutenzione → Panoramiche** elenca ogni cartella con il numero di note e il suo stato — ordinato per *dove manca qualcosa*, non alfabeticamente, così le poche cartelle che richiedono attenzione non finiscono sepolte tra quelle a posto. In alto, **Genera index.md nelle N cartelle che non ce l'hanno** crea quelle mancanti in un colpo solo. Se una cartella senza `index.md` contiene già una nota di panoramica (MOC, panoramica, README…), qui puoi **adottarla** — questo rinomina il file e porta con sé i collegamenti in tutto il vault, perciò viene chiesto prima.

**Sempre aggiornate.** Le panoramiche generate da Plainva portano un contrassegno invisibile. Solo quei file vengono mantenuti — e d'ora in poi li mantiene anche il telefono: crea, sposta o elimina note lì e Plainva riscrive poco dopo le panoramiche interessate. Prima lo faceva solo il desktop, quindi un vault curato sul telefono invecchiava in silenzio.

**Sola lettura, con una via d'uscita.** Una panoramica gestita si apre in lettura con una fascia sopra: **Aggiorna** la riscrive, **Modifica comunque** rimuove il contrassegno — da quel momento il file è interamente tuo e non viene più sovrascritto automaticamente. Senza quella protezione la prossima esecuzione scriverebbe in silenzio sopra ciò che hai digitato.


## Converti al formato OKF

Portare un intero vault al [formato OKF](OKF.md) ora funziona anche dal telefono: **Impostazioni → Vault → Manutenzione → Converti al formato OKF**. La procedura guidata analizza, ti fa scegliere il `type` predefinito, **nomina le note interessate** e solo dopo scrive: ogni file passa dalla cartella di backup prima di essere modificato.

Poiché un telefono può terminare un'app in esecuzione in qualsiasi momento, si aggiungono due cose di cui il desktop non ha bisogno: l'esecuzione si ferma al file successivo quando tocchi **Pausa** o l'app passa in secondo piano — e alla successiva apertura del vault Plainva chiede se un'esecuzione interrotta debba essere **continuata** o **ripristinata**. **Più tardi** è una risposta valida; la domanda ritorna, non va persa.

Un'esecuzione interrotta lascia un vault convertito solo in parte, non rotto: vengono aggiunti solo campi di frontmatter, ogni nota resta Markdown valido e qualsiasi altro editor può ancora leggerla.

### OKF 0.2 sul telefono

I campi di [OKF 0.2](OKF.md) — provenienza, revisione, stato, scadenza — vengono letti e mostrati sul telefono esattamente come sul desktop: il badge **Bozza**/**Dismessa** nell'intestazione della nota, l'avviso **Segnata come obsoleta** sopra la nota, e la sezione **Fiducia e provenienza** nel pannello di contesto della nota con il livello di fiducia. Anche **Segna come revisionata** si trova lì: aggiunge `human:<tuo nome>` all'elenco `verified`; Plainva chiede il nome una volta per vault, lo tiene sul dispositivo e ti permette di cambiarlo in **Impostazioni → Vault → Contenuto e struttura → Nome del revisore**. La versione del bundle di un vault viene portata alla 0.2 in **Impostazioni → Vault → Manutenzione → Versione del bundle** — con un'anteprima, un backup e la casella che rimuove il campo `okf_version` legacy dalle note.

## Grafo

La **mappa del vault** mostra il tuo vault come nodi e archi. Toccare una bolla di cartella la dispiega, toccare una nota la apre; i chip sopra filtrano per tipo di nota, tag e tipo di arco. Trascina un nodo e **la mappa ricorda dove lo hai messo** — la disposizione memorizzata si trova in `.plainva/graph.json` e resta volutamente su questo dispositivo, come l'indice di ricerca.

**Tenere premuto** un nodo apre il suo menu: apri (o espandi/comprimi per una cartella), **Focus sulla selezione** e, se il nodo è fissato, **Sblocca**. Tenere premuto un **arco** indica entrambe le estremità e apre l'una o l'altra nota. Trascina una nota **su un'altra** e Plainva propone di **collegarle** — come un link testuale alla fine della nota, oppure tramite una relazione del database corrispondente; una relazione che consente esattamente una voce chiede conferma prima, perché sostituisce il valore attuale. Il chip **Seleziona** trasforma un trascinamento su un'area vuota in un rettangolo di selezione (un telefono non ha un tasto modificatore); le note selezionate possono essere eliminate insieme, con la stessa conferma di una singola. **Esporta come SVG…** consegna la mappa al foglio di condivisione del tuo dispositivo.

La stessa pulizia in piccolo la fa il **grafo nel pannello di contesto di una nota**: mostra il vicinato della nota aperta e, sotto, suggerimenti su cos'altro potrebbe appartenerle. **Collega** inserisce il link nel punto del testo — non alla fine della nota —, e un suggerimento ignorato resta ignorato, anche dopo la chiusura della nota.

Il chip **Pulizia** apre l'elenco di pulizia: le **orfane** (note a cui nessuno rimanda), i **link interrotti** (riferimenti che non portano da nessuna parte) e le **menzioni** — punti in cui una nota viene nominata ma non collegata. Elimini un'orfana con la stessa conferma di ovunque altro, crei la nota mancante per un link interrotto, e colleghi una menzione esattamente **nel punto del passaggio** invece che alla fine della nota. Ciò che ignori resta ignorato: non ricompare al passaggio successivo. La scansione delle menzioni legge ogni nota e quindi parte solo quando lo chiedi tu — e può essere interrotta in qualsiasi momento.

Il **Focus** si può attivare anche dal menu del nodo: la mappa mostra quindi solo il suo vicinato fino alla profondità che scegli (1–3). Il chip che mostra la profondità cancella di nuovo il focus. Altri due chip leggono la mappa in base all'età: la **Mappa di calore** tinge ogni nodo in base a quanto recentemente è cambiato, e il **Viaggio nel tempo** nasconde tutto ciò che è più recente del cursore — così puoi vedere il vault crescere.

## Calendario ed eventi

L'area **Calendario** mostra i tuoi calendari collegati nelle viste **Giorno**, **3 giorni** e **Agenda** — lo stesso modello di account del desktop. Vi accedi dalla barra di navigazione o tramite **Aree**. Ogni colonna del giorno riporta in alto il suo **giorno della settimana e la data**, e sotto una striscia per gli **eventi di tutto il giorno** di quella giornata; entrambi scorrono insieme alla griglia invece di occupare spazio in modo permanente. Toccare un evento apre l'**anteprima dell'evento** come foglio — la stessa superficie della finestra flottante del desktop: intervallo orario, luogo, descrizione, partecipanti con le loro risposte e, se appartiene a una serie, il suo ritmo insieme al prossimo appuntamento. Per un invito offre **Accetta**, **Provvisorio** e **Rifiuta**, e sotto **Modifica evento**, **Nota della riunione** ed **Elimina evento**. Scorrendo verso il basso il foglio si chiude. Le note giornaliere non si trovano qui: vivono in **Oggi**.

Gestisci gli account dall'icona a forma di ingranaggio nel calendario degli eventi: collega **CalDAV** sul dispositivo con una password per app (es. Fastmail, Nextcloud, iCloud); Google e Microsoft seguono tramite accesso dal browser. Per ogni account puoi mostrare o nascondere singoli calendari.

Da un evento, **Nota della riunione** crea la nota che gli appartiene — la stessa nota che trova anche il desktop: resta collegata all'evento, quindi richiamarla di nuovo la riapre invece di crearne una seconda, e finisce nella **Cartella riunioni**. Scegli quella cartella nell'area degli account, sotto **Impostazioni calendario**, con un **esplora cartelle** invece di digitarne il percorso; lì si trova anche il **Calendario predefinito** (quello in cui inizia un nuovo evento); entrambi appartengono al vault e viaggiano con la sincronizzazione delle impostazioni. Lo stesso posto ti permette di scegliere, per account, quali **Elenchi attività** si riflettono nel tuo database attività.

**L'accesso è per dispositivo.** A sincronizzarsi sono le *impostazioni* del tuo account, mai l'accesso in sé — è voluto: le credenziali non devono lasciare il dispositivo. Un account arrivato così tramite la sincronizzazione delle impostazioni compare quindi nell'elenco, ma porta il contrassegno **accedi**, con una riga sotto che indica cosa fare. Finché nessun account ha eseguito l'accesso su questo dispositivo, il calendario e la posta lo spiegano lì al posto di restare semplicemente vuoti, e **Accedi su questo dispositivo** ti porta agli account. Gli account con l'accesso eseguito mostrano **attivo**. Se un accesso scade più tardi o viene revocato, la riga dice **accesso scaduto** insieme al motivo — e **Accedi di nuovo** lo rimette in funzione senza rimuovere l'account: lo stesso account, gli stessi calendari. Per Google e Microsoft, Plainva cerca sul dispositivo stesso la registrazione dell'app di cui ha bisogno — presso l'account, presso la sincronizzazione dei file dello stesso account, oppure presso un altro account dello stesso provider. Solo quando davvero non ce n'è nessuna, il modulo si apre e la richiede.

**Un accesso per tutti i servizi — anche qui.** Se un account Microsoft o Google porta più servizi (ad esempio file e calendario), la panoramica **Account cloud** propone di unirli in un unico accesso. Da quel momento un solo accesso tiene attivi tutti i servizi invece di uno soltanto — prima, un servizio poteva continuare a funzionare mentre un altro dello stesso account era già scaduto in silenzio. Una casella Gmail resta esclusa: funziona tramite IMAP con una password per app e non richiede alcun consenso. L'offerta resta finché l'accesso condiviso non copre tutti i servizi dell'account. Se manca un servizio, i dettagli dell'account offrono due vie d'uscita: **Reimposta l’accesso condiviso** lascia che ogni servizio torni a usare il proprio, e **Esci dalla procedura** annulla un tentativo di connessione mai concluso.

**Promemoria.** In **Impostazioni calendario → Promemoria** attivi **Ricorda gli appuntamenti**; il telefono chiede allora una volta l'autorizzazione per le notifiche. Vale il promemoria che l'appuntamento porta con sé: solo quando non dice nulla Plainva avvisa 15 minuti prima, e gli appuntamenti di un giorno intero la sera precedente alle 19:00. Un appuntamento che espressamente non vuole promemoria non ne riceve. Vengono pianificati i prossimi 14 giorni, al massimo 64 promemoria in anticipo: tanti ne consente iOS; Plainva riempie di nuovo quella finestra a ogni apertura e dopo ogni aggiornamento del calendario, e ti dice da quando un periodo non ci sta più, invece di inghiottire appuntamenti in silenzio. **Il limite che resta:** il telefono può annunciare solo ciò che ha visto durante l'ultima sincronizzazione — un invito che arriva dieci minuti prima dell'inizio non raggiunge più alcuna notifica.

**Che cosa imposti insieme.** L'**Anticipo** vale per gli appuntamenti senza un promemoria proprio; **Appuntamenti di un giorno intero** stabilisce in quale sera o mattina si fanno sentire. **Attività in scadenza** aggiunge anche le attività del tuo database delle attività — con un orario come un appuntamento, senza orario secondo la regola del giorno intero. **Solo questi calendari** limita da dove arrivano i promemoria; se non selezioni nulla compare **Tutti**, e un calendario aggiunto in seguito rientra da sé. La notifica porta due gesti: su un appuntamento **Nota della riunione** (la crea oppure apre quella esistente), su un'attività **Spunta** — che la completa lì per lì e, per un'attività ricorrente, crea la successiva senza che tu apra l'app.

## E-mail

In **Impostazioni → E-mail** colleghi una **casella Microsoft** (Outlook.com, Microsoft 365) direttamente tramite l’accesso nel browser, senza password per app. Come per il calendario, l’accesso vale per dispositivo.

In seguito puoi aprire **E-mail** come area a sé dal ▾ accanto al titolo e collocarla nella barra di navigazione. La riga sotto il titolo mostra cartella, non letti e account, e apre il selettore delle cartelle. Tocca un messaggio per leggerlo; **Salva come nota** lo archivia nella cartella **Mail** del tuo vault (catturarlo due volte apre la stessa nota). Le immagini remote restano bloccate finché non le consenti per quel messaggio: un’immagine caricata rivela al mittente quando e dove hai letto.

**Anche le caselle IMAP funzionano sul telefono.** Aggiungine una in **Impostazioni → E-mail**: scegli il provider, inserisci l’indirizzo e la password per app, e Plainva compila i server. Se il tuo provider non è nell’elenco, **Avanzate** ti permettono di inserire tu stesso i server IMAP e SMTP, le porte e un nome utente diverso, e un account esistente si può modificare in seguito. Per selezionare più messaggi basta tenere premuto uno di essi; poi un tocco ne aggiunge altri. Nella vista conversazioni, tenere premuta o toccare la riga della conversazione sceglie l’intero scambio — e ogni messaggio conserva la propria cartella, quindi una risposta da **Inviata** viene contrassegnata lì.

Un messaggio aperto offre **Rispondi**, **Rispondi a tutti** e **Inoltra**. Una risposta cita l'originale sotto il tuo testo; "Rispondi a tutti" include anche gli altri destinatari e omette il tuo indirizzo. Quando **componi**, **Allega file** aggiunge un file dal vault — sul telefono il vault è l'archivio a cui puoi accedere, e tutto ciò che arriva sul dispositivo (un allegato salvato, una foto inserita) si trova già lì. Ogni allegato ha una propria riga con **Rimuovi allegato**, finché il messaggio non è ancora partito.

Un messaggio che hai iniziato non deve per forza essere inviato: **Salva bozza** lo archivia nella cartella delle bozze del tuo account — dove qualsiasi programma di posta su quella casella lo troverà, non in un posto riservato al telefono. Quale sia quella cartella lo dice il server; solo quando tace il nome viene indovinato. Nell'elenco, accanto alla riga della cartella ci sono due interruttori: **Non letti** riduce ciò che è caricato al momento (così il contatore e **Carica altro** restano raggiungibili), mentre **Contrassegnati** chiede al server tutti i messaggi contrassegnati della cartella — compresi quelli ben oltre la pagina caricata. In **Tutte le caselle di posta** l'interruttore dei contrassegnati manca di proposito: quella richiesta indica esattamente una casella.

Da un messaggio aperto, tre strade portano nel vault: **Salva come nota**, **→ Attività** nel menu ⋮ (crea una voce nel tuo database attività predefinito — con il suo modello, lo stato e la data del messaggio) e **+ .eml**, che salva inoltre il messaggio originale e vi rimanda dalla nota. Tutte e tre sono ancorate: catturare due volte lo stesso messaggio apre ciò che c'è già. **Elimina** ora si trova anche nel menu ⋮ invece che accanto alla freccia indietro; nell'elenco basta uno scorrimento. Spostare nel cestino offre **Annulla**, perché è reversibile — l'eliminazione definitiva dal cestino continua a chiedere conferma, perché non lo è. E invece di più avvisi impilati uno sopra l'altro c'è ora **una sola** riga: l'errore, altrimenti gli account non raggiungibili (da due in su, come numero), altrimenti la nota sulla copia salvata.

Una nota può essere inviata dal proprio menu ⋮: **Invia la nota via e-mail (mailto)** la consegna all'app di posta del telefono — per questo Plainva non ha bisogno di un proprio account — mentre **Invia per email** apre l'editor di composizione proprio di Plainva con oggetto e testo.

## Importa da un'altra app

In **Impostazioni → Manutenzione → Importa da un'altra app** porti su questo dispositivo le note di un'altra app, con le stesse sorgenti del desktop.

Per prima cosa scegli dove scrivere: in una **sottocartella** del vault aperto oppure in un **nuovo vault** su questo dispositivo. Il vault nuovo è la scelta giusta quando qui non c'è ancora nulla; gli dai soltanto un nome, e annullare l'intera importazione significa rimuoverlo in **Altro → Vault**.

Le sorgenti che richiedono un accesso — Notion tramite la sua API — chiedono un token nella procedura guidata. Vale per quella sola esecuzione e non viene memorizzato.

I dettagli di ogni sorgente sono in [Importa da un'altra app](Import.md).

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

**Le condivisioni si gestiscono ora qui**, non più solo sul desktop: in **Persone e permessi** inviti un membro con un ruolo (**Invita** lo crea — il suo dispositivo lo associ dopo), crei un gruppo e cambi il ruolo di un gruppo direttamente nella sua riga. In **Slice** crei una condivisione per una **Cartella**. Deliberatamente non sul telefono: le slice da una selezione libera o da una regola dinamica — entrambe richiederebbero superfici che qui non esistono.

## Rete di sicurezza

Gli snapshot (cronologia delle versioni), un diario delle bozze (dopo un arresto anomalo la nota offre l'ultimo stato non salvato) e le copie in conflitto con una vista di confronto proteggono i tuoi dati. La conservazione si configura in **Impostazioni** → **Backup e cronologia delle versioni**.

**Se qualcuno modifica la stessa nota altrove** mentre stai scrivendo qui, Plainva conserva la tua versione come copia accanto e adotta quella arrivata. Ora questo compare **sulla nota** e resta finché non lo risolvi: un avviso sopra il testo indica il percorso della copia, la apre e, se vuoi, mostra le **differenze**. Prima era un messaggio che spariva dopo qualche secondo — e il salvataggio continuava a riprovare, scrivendo un'altra copia a ogni giro. Ora ne viene scritta esattamente una.

**Quando elimini una cartella**, la finestra di dialogo indica quanti file contiene — il numero compare anche sul pulsante. Plainva crea prima uno snapshot di ogni file al suo interno, che puoi recuperare in **Impostazioni** → **Manutenzione** → **Ripristina i file eliminati**. Dichiara anche apertamente un limite: **può essere conservato solo ciò che questo telefono ha scritto almeno una volta.** Una nota arrivata solo tramite sincronizzazione e mai modificata qui non esiste in nessuno snapshot. A differenza del desktop, un telefono non ha un cestino del sistema operativo che lo recuperi. Se l'eliminazione riguarda più di dieci file, o più di un quinto del vault, Plainva chiede una seconda volta — esattamente come sul desktop.

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

**Scorri una riga verso sinistra** per rivelare le sue azioni: **Segnalibro** ed **Elimina** su una nota, **Rinomina** ed **Elimina cartella** su una cartella, **Elimina** su un database e nella casella. Sono le stesse azioni che la riga offre nel suo menu (tenere premuto) — lo scorrimento è solo la via più breve per arrivarci, mai l'unica. La prima volta te lo dice una striscia sopra l'elenco; la tocchi per farla sparire, e compare esattamente una volta per vault.

Eliminare chiede conferma tramite la stessa finestra di dialogo di sempre. Mentre selezioni più righe, lo scorrimento è disattivato — un gesto che indica esattamente una riga non ha un significato chiaro accanto a una selezione che stai ancora componendo. Con le **conversazioni** attive nella casella, uno scorrimento su una conversazione riguarda l'**intera** conversazione (invece di un annulla, ti dice poi quanti messaggi conteneva); un singolo messaggio espanso si scorre comunque a parte. Le righe di attività non hanno azioni di scorrimento — portano i propri comandi visibili sulla riga.

## Su schermi larghi

L'app segue la larghezza della finestra, non il nome del dispositivo:

- **sotto i 600 px** — una superficie dopo l'altra, come sul telefono.
- **da 600 a 839 px** — la barra di navigazione diventa una **barra laterale**; resta comunque un'unica superficie.
- **da 840 px in su** — il navigatore e la superficie di lavoro stanno **fianco a fianco**. È lo stesso navigatore dell'area **Note**, solo accanto al tuo lavoro invece che davanti.

Su un tablet, o su un telefono grande ruotato, ottieni lo stesso modello spaziale del desktop — navighi a sinistra, lavori al centro — invece di un telefono ingrandito.


## Database nel calendario

Sopra le viste del calendario c'è una fila di chip: ogni vista `.base` di tipo **calendario** o **sequenza temporale** che indichi una colonna data può essere mostrata lì. Le voci mostrate compaiono tra gli appuntamenti negli elenchi del giorno e dell'agenda — con un **rombo e un bordo tratteggiato**, così una nota non sembra mai un appuntamento; nella griglia del mese come **punto vuoto**. Un tocco apre la nota.

**La scelta appartiene al vault**, non al dispositivo: ciò che mostri sul computer lo ritrovi qui appena la sincronizzazione delle impostazioni è passata. Sul telefono si pianifica dal foglio della voce — il trascinamento resta al computer.

Al contrario, la vista calendario di un database può mostrare il **numero di appuntamenti reali** del giorno nell'angolo della cella — vedi rispetto a cosa stai pianificando.
