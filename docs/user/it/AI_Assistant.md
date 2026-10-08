# Assistente IA (Beta)

Ultimo aggiornamento: 2026-10-08

Plainva può rispondere a domande sulle tue note con un modello IA di tua scelta. Legge il tuo vault, cita le note su cui si basa, apre note e viste per te e propone modifiche — come proposte su una nota, come bozze di qualcosa di nuovo o come un piano che confermi tu. Non cambia mai una nota da solo. L'assistente è **sperimentale** ed è disattivato finché non lo attivi, singolarmente su ogni dispositivo.

## Attivare l'IA

Apri **Impostazioni → IA e automazione** (la parte App) e attiva **Usa l'IA su questo dispositivo**. Senza l'interruttore non ci sono né il pulsante IA, né la scheda IA, né il compagno. Non viene inviato nulla finché non fai una domanda.

## Scegliere un provider

Plainva non porta un proprio servizio IA: usi un provider di tua scelta, con una tua chiave. Ogni provider può essere scelto; Plainva indica le loro condizioni e i tempi di conservazione, così decidi tu — non ne esclude nessuno.

| Tipo | Provider |
|---|---|
| Provider cloud | Anthropic, OpenAI, Google Gemini |
| Gateway e server propri | OpenRouter, qualsiasi **Server compatibile con OpenAI** |
| Su questo computer (desktop) | Ollama, LM Studio |
| Su questo telefono | Apple (iPhone), Gemini Nano (Android) |

1. In **IA e automazione**, scegli **Aggiungi provider** e selezionane uno. Ogni voce porta una breve nota sulle sue condizioni — per esempio che l'accesso gratuito di Google può permettere a delle persone di leggere i tuoi input.
2. Inserisci la chiave con **Inserisci chiave**. La chiave va nell'archivio sicuro di questo dispositivo; Plainva non la mostra mai più — né all'IA né sullo schermo.
3. **Verifica connessione** carica la lista dei modelli del provider. Se fallisce, il messaggio spiega perché (una chiave rifiutata, nessuna connessione, un modello sconosciuto).

Un **Server compatibile con OpenAI** si aggiunge tramite il suo indirizzo. Plainva chiede ancora una volta conferma prima di aggiungerlo, in una finestra del sistema operativo, e invia solo all'indirizzo che hai confermato. `http` semplice funziona solo per un server su questo dispositivo; tutto il resto richiede `https`.

Se non hai ancora una chiave: un modello su questo computer (Ollama, LM Studio) non costa nulla, e la console di ogni provider rilascia chiavi.

**Il modello del sistema sul telefono.** Su un iPhone con Apple Intelligence (da iPhone 15 Pro), **Aggiungi provider** propone per primo **Apple**, su alcuni telefoni Android **Gemini Nano**. Non richiede chiavi, non costa nulla e nulla lascia il dispositivo: per questo nessun riepilogo chiede prima dell'invio. La sua finestra è piccola, circa 4.000 token per note, domanda e risposta insieme: partono meno note, i turni precedenti vengono accorciati e non usa strumenti. La riga dice se è pronto e, se no, perché: Apple Intelligence disattivata, un dispositivo che non può eseguirlo, un modello che il sistema sta ancora preparando; su Android, **Carica modello** chiede al sistema di scaricarlo. Il modello di Apple non parla tutte le lingue (niente polacco). Se il profilo **Locale** lo indica, scrive anche le sintesi sul telefono.

## Modelli e profili

Quattro profili — **Veloce**, **Bilanciato**, **Potente** e **Locale** — sono la tua assegnazione di modelli. Scegli un provider e un modello per ciascuno, dalla lista del provider oppure digitando l'ID del modello esattamente come lo chiama il provider. **Predefinito per le nuove conversazioni** stabilisce con quale profilo inizia una nuova conversazione. Plainva non definisce nessun modello «il migliore».

Un quinto posto, **Audio**, contiene il modello che trascrive le note vocali; non è mai quello predefinito per una conversazione.

Un sesto posto, **Embedding**, contiene il modello con cui calcola la ricerca per significato quando scegli **Provider proprio** in **Ricerca semantica** — vedi [Ricerca](Search.md).

## Chiedere

- **Desktop:** il pulsante IA nella barra delle azioni, **Ctrl+J** (⌘J su macOS) oppure **Chiedi all'IA** nella palette dei comandi apre il compagno — una piccola finestra sopra il tuo lavoro. **Apri come scheda** sposta la stessa conversazione nella scheda IA, dove sono elencate le tue conversazioni.
- **Telefono:** **Chiedi all'IA** nel menu ⋮ di una nota apre il foglio IA sopra quella nota. L'area **IA** (nel foglio delle aree, o nella barra di navigazione se la metti lì) mostra la conversazione a schermo intero; **Conversazioni** elenca quelle precedenti.
- **Accanto alla nota:** sul desktop la stessa conversazione è l'ultima sezione della barra laterale destra, **IA**. Su un telefono o un tablet è la scheda **IA** del contesto della nota — accanto a **Proprietà** e **Backlink** —, che un tablet mostra accanto alla nota.

La nota che hai aperta viene inclusa automaticamente; rimuovila dal contesto con la sua ✕ se vuoi. **Fissa una nota…** aggiunge altre note. L'assistente può anche cercare da solo: consulta il vault, legge le note e le loro sezioni, i database, i backlink e le note collegate, elenca le attività, gli appuntamenti e le note aperte o modificate di recente, e apre note e viste. Da solo non può cambiare, creare o eliminare nulla; ciò che può proporre al loro posto è descritto più sotto, in «Proporre modifiche».

L'assistente può anche mostrarti delle cose: aprire una nota a un titolo, mostrare una nota nel grafo, portare il calendario su un giorno, aprire viste, mostrare e nascondere le barre laterali. Per farlo usa i comandi della palette dei comandi — e tra questi solo quelli che mostrano qualcosa: non può attivare quelli che creano, modificano, eliminano, esportano o aprono una finestra.

Ogni conversazione inizia con la riga «Le risposte sono scritte da un'IA — ⟨modello⟩ tramite ⟨provider⟩». Sotto ogni risposta una riga indica cosa è stato inviato e dove: quante note, all'incirca quanti token e — dove il provider pubblica i prezzi — il costo approssimativo. **Interrompi** termina una risposta in qualsiasi momento.

Un link in una risposta si apre solo dopo che ne hai confermato l'indirizzo, e le immagini nelle risposte non vengono mai caricate.

## Cosa parte con una domanda

A ogni domanda Plainva raccoglie ciò che può contare — su questo dispositivo, prima di inviare qualsiasi cosa:

- **Dove ti trovi:** data e ora, la nota o il database aperto e la tua selezione, le schede aperte, le attività in scadenza nella prossima settimana, i prossimi appuntamenti e la nota di oggi.
- **Note che possono contare:** trovate a partire dalle tue parole, dai link della nota aperta e da ciò che hai aperto o modificato di recente. Prima decidono le tue regole sulla privacy; vengono valutate solo le note che esse consentono. Alcune partono come sezioni — non come note intere —, altre solo con il titolo e una scheda — la prima frase della loro sezione e ogni frase con numeri, date, attività, negazioni o link, parola per parola — o solo con il nome; l'assistente ne legge di più quando gli serve.

Una nota che la conversazione contiene già e che da allora non è cambiata viene nominata, non inviata di nuovo. I luoghi del tuo diario e i valori d'umore non partono mai da soli.

## Prima di inviare qualsiasi cosa

La prima richiesta di una sessione mostra un riepilogo: dove va (provider e modello), quali note e quale parte di ciascuna, cos'altro parte (la tua selezione, appuntamenti, attività), cosa è stato trattenuto e all'incirca quanti token. **Invia** la invia; **Annulla** non invia nulla e ti restituisce le tue parole nel campo di testo; il − accanto a una nota la esclude. Entro ciò che hai approvato, le richieste successive partono senza domande. Il riepilogo torna ogni volta che l'ambito cresce: un altro modello o provider, un nuovo tipo di dati, note da un'altra cartella, nuovi strumenti o una richiesta molto più grande. Un modello su questo dispositivo non chiede mai.

Se vuoi vedere il riepilogo prima di ogni richiesta, attiva **Chiedi prima di ogni richiesta** — nel riepilogo stesso o in **Impostazioni → IA e automazione**, alla voce **Invio**.

La riga sotto ogni risposta apre il riepilogo di ciò che è partito con essa. Se una risposta non cita nessuna delle note inviate, un avviso sopra quella riga lo dice; verifica allora la risposta con le note. Se sono partite delle note, la riga indica anche la copertura: **copertura alta** quando quasi ogni affermazione della risposta cita una nota, **copertura parziale** o **copertura bassa** quando sono meno.

## Vedi contesto

L'occhio sotto il campo di testo, **Vedi contesto**, mostra ciò che porterebbe la prossima richiesta — prima che parta, per il modello scelto ora. Per ogni nota: perché è stata scelta (aperta ora, fissata, corrisponde alle tue parole, vicino per significato, collegata, in scadenza…), quale parte parte e all'incirca quanti token. Ogni nota puoi

- escluderla dalla prossima richiesta (**Reincludi** la riporta),
- fissarla alla conversazione,
- tenerla su questo dispositivo per sempre: questo scrive la regola `cloud: deny` nella nota (vedi sotto).

Anche le note che le tue regole trattengono sono elencate, perché tu sappia cosa manca; non vengono mai valutate né inviate. **Invia con questo contesto** invia ciò che hai scritto. In una scheda IA ampia la vista resta aperta come colonna accanto alla conversazione.

Sopra le note, **Inviato** dice quanta parte di queste note parte — per esempio ~870 di 3.460 token — e **Risparmiato** quanto è in meno rispetto a inviare intere tutte le note proposte; la prima volta dice anche quanti token sarebbero stati. **Mostra come traccia nel grafo** apre il grafo con la nota aperta e le fonti evidenziate, e i link tra loro.

Quando il testo che andrebbe a un cloud sembra contenere una password o una chiave, un numero di conto o di carta, un numero di documento o fiscale, o dati sulla salute, una riga sotto la nota indica **Forse sensibile** e cosa è stato rilevato — in **Vedi contesto** e nel riepilogo prima dell'invio. **Tieni su questo dispositivo** scrive la regola `cloud: deny` nella nota. Per numeri e segreti, **Oscura in questa conversazione** li sostituisce con un segnaposto come `⟦withheld account⟧` in ogni messaggio di questa conversazione, anche quando il modello legge la nota da sé, finché non scegli **Invia senza oscurare**; il riepilogo li conta sotto **Trattenuto**. Attività e appuntamenti hanno la stessa scelta nella riga **Attività, appuntamenti e dettagli della nota aperta**. La prima volta in una sessione in cui qualcosa di questo tipo partirebbe senza essere oscurato, il riepilogo chiede prima dell'invio. Il controllo avviene su questo dispositivo; è un'indicazione, non un filtro: può lasciarsi sfuggire qualcosa e non blocca mai una richiesta. Un passaggio selezionato parte così com'è; con un modello su questo dispositivo non compare alcuna indicazione.

## Sintesi

Con **Sintesi con il modello locale** (in **Impostazioni → IA e automazione**, disattivato finché non lo attivi), un modello sul tuo computer scrive brevi sintesi delle sezioni lunghe delle tue note, di note intere, delle cartelle di primo livello e del vault. Funziona solo quando il profilo **Locale** indica un server su questo computer (Ollama, LM Studio; sul telefono, il modello del sistema) — mai un cloud in background — e solo mentre Plainva è inattivo; sul telefono solo finché è aperto. Ogni sintesi viene verificata: la sintesi di una sezione deve mantenere parola per parola ogni numero, data, importo, link, tag e ogni negazione, altrimenti partono le frasi della sezione stessa. Una sintesi è legata al testo esatto che rappresenta; se modifichi la sezione, non viene usata finché non è stata riscritta. Le sintesi delle cartelle e del vault nascono solo da note che le tue regole lasciano andare a un cloud. In **Vedi contesto**, una fonte inviata come sintesi lo indica, e **Originale** invia le sue frasi con il messaggio successivo.

## Con una selezione

Seleziona del testo in una nota e l'IA lavora solo su quel passaggio.

- **Desktop:** mentre modifichi, **IA** nella barra di selezione offre **Come proposta** — **Riscrivi**, **Accorcia**, **Traduci…**, **Crea attività** — e **Nel compagno** — **Spiega** e **Domanda sulla selezione…** (**Ctrl+J**, ⌘J su macOS).
- **Telefono:** **IA** nella barra sopra una selezione — in lettura come in modifica — apre il foglio IA.
- **In ogni conversazione:** finché nella nota aperta c'è del testo selezionato, la riga **Con la selezione** sopra l'input offre le stesse azioni.

Un'azione di proposta invia solo il passaggio selezionato — non il resto della nota, nessuna nota fissata, nessuno strumento — e chiede con lo stesso riepilogo di una domanda. La risposta torna nella nota come un giro di proposte, come quello di una persona: in **Proposte** accetti o rifiuti ogni modifica o l'intero giro, e nella nota non cambia nulla prima che tu lo faccia. La riga dell'autore del giro dice **Plainva IA · ⟨modello⟩**, così resta visibile quale passaggio ha scritto un'IA. **Crea attività** aggiunge le attività sotto il passaggio invece di sostituirlo. Ogni azione conserva la sua conversazione nella cronologia.

Un passaggio di una nota che le tue regole tengono lontana dal cloud — o uno con link a note del genere o con indicazioni di luogo — non va a nessun modello cloud. In un workspace cifrato le azioni di proposta non sono ancora disponibili: le sue proposte non possono ancora indicare l'IA come autore.

## In un thread di commenti

Rivolgiti all'assistente in un commento e lui risponde nel thread. Digita una **@** nel campo del commento e scegli **IA** — la voce con il simbolo dell'IA — oppure scrivi tu stesso il nome: **@IA**, **@AI** e **@KI** lo raggiungono tutti, qualunque sia la lingua dell'app. Appena il tuo commento è inviato, il thread mostra sotto **IA** la riga **sta scrivendo una risposta…**; **Interrompi** la ferma. La risposta compare come risposta nello stesso thread, con la riga dell'autore **Plainva IA · ⟨modello⟩**. A differenza di una proposta non aspetta di essere accettata — è un'annotazione accanto alla nota, mai testo al suo interno — e sul dispositivo che ha fatto la domanda la elimini come una tua.

Il thread va al modello come una domanda: i suoi commenti, il passaggio a cui è legato e la nota stessa, attraverso lo stesso riepilogo. Un thread di commenti è un tipo di dati a sé, perciò il riepilogo chiede la prima volta. Dove le tue regole tengono la nota lontana dal cloud, nemmeno i suoi commenti ci vanno, e i link che contengono verso note di quel tipo vengono trattenuti. Solo un commento che invii su questo dispositivo chiama l'assistente; uno che arriva con la sincronizzazione non lo fa mai, qualunque cosa dica. Gli indirizzi web che l'IA porta di sua iniziativa — in una risposta, in una proposta o in una trascrizione — vengono scritti in modo che nulla li apra o li carichi (`https[://]…`); gli indirizzi che il tuo testo conteneva già restano come sono. In un workspace cifrato non ci si può ancora rivolgere all'assistente: i suoi commenti non possono ancora indicare l'IA come autore.

## Competenze

Le competenze sono istruzioni per lavori ricorrenti. Dodici sono incluse in Plainva — tra cui **Orientamento del giorno**, **Riepilogo settimanale** e **Stato del progetto** come chip in una conversazione vuota — e puoi scriverne o importarne di tue. Avviane una con un clic, oppure chiedi semplicemente: l'IA carica da sola una competenza adatta. Le tue competenze si eseguono solo dopo che le hai approvate su questo dispositivo. Tutto su di esse: [Competenze](AI_Skills.md).

## Trascrivere una nota vocale

Su ogni nota vocale — nell'editor, in modalità lettura, nel diario e sulle schede — **Trascrivi** trasforma la registrazione in testo. Va così com'è al modello del profilo **Audio**, attraverso lo stesso riepilogo di una domanda; una registrazione è un tipo di dati a sé, perciò il riepilogo chiede la prima volta. La trascrizione torna come proposta sotto la registrazione, con l'autore **Plainva IA · ⟨modello⟩**: accettala o rifiutala in **Proposte**.

**Audio** richiede un provider con una via audio: OpenAI (per esempio `gpt-4o-transcribe` o `whisper-1`), Gemini o un tuo server compatibile — uno su questo computer tiene la registrazione sul dispositivo. Si possono trascrivere registrazioni fino a 11 MB. Una registrazione in una nota che le tue regole tengono lontana dal cloud non va a nessun modello cloud, e i workspace cifrati non lo offrono ancora.

## Spiegare un'immagine

Su ogni immagine del vault, **Spiega immagine** chiede all'IA che cosa mostra l'immagine.

- **Desktop:** nella barra degli strumenti di un'immagine aperta e nel menu che si apre con un clic destro su un'immagine in una nota — in modifica come in modalità lettura.
- **Telefono:** sotto un'immagine aperta (su un'immagine in una nota, **Apri immagine** ti porta lì).

L'immagine va, con la domanda, al modello con cui iniziano le nuove conversazioni — in una conversazione a parte, in cui puoi continuare a chiedere: che cosa dice una tabella, che cosa c'è nella seconda colonna, che cosa significa un diagramma. Il riepilogo mostra l'immagine prima che venga inviata; un'immagine è un tipo di dati a sé, perciò il riepilogo chiede la prima volta.

**Ciò che parte non è il file.** Plainva disegna l'immagine, la riduce a un massimo di 1.568 pixel sul lato più lungo e la salva di nuovo per l'invio. Così parte senza ciò che il file registra su di essa: il luogo in cui è stata scattata una foto, la data, la fotocamera. Il riepilogo mostra esattamente l'immagine che parte, con le sue dimensioni. Quella copia resta con la conversazione su questo dispositivo, così puoi vedere anche più tardi che cosa ha ricevuto il provider; se elimini la conversazione, sparisce.

**Regole.** Un'immagine in una cartella che le tue regole tengono lontana dal cloud non va a nessun modello cloud. Lo stesso vale per un'immagine mostrata in una nota con la regola `cloud: deny` — ovunque tu prema **Spiega immagine**, anche sull'immagine aperta: prima dell'invio Plainva cerca quali note incorporano l'immagine e, se non riesce a scoprirlo, l'immagine resta su questo dispositivo. Un modello su questo dispositivo resta consentito. Ciò che è scritto in un'immagine è contenuto, come il testo di una nota, mai un'istruzione: la conversazione di **Spiega immagine** può cercare nel tuo vault, ma non può usare Internet e non attiva nulla nell'app.

**Quali modelli leggono le immagini.** La maggior parte dei modelli cloud lo fa. Il modello del sistema sul telefono no, e **Spiega immagine** lo segnala. Dove la lista di un provider indica che un modello non legge immagini, il riepilogo te lo dice prima dell'invio. Se un provider rifiuta la richiesta, scegli un altro modello sotto la conversazione e chiedi di nuovo — l'immagine c'è ancora.

## Su Internet

L'assistente non può usare Internet finché non lo consenti — e lo consenti tre volte:

1. **Per il vault.** In **Impostazioni → IA e automazione** (la parte Vault), attiva **L'IA può usare Internet in questo vault**. È disattivato per ogni vault finché non decidi, e vale solo su questo dispositivo.
2. **Per una conversazione.** Prima del primo messaggio di una nuova conversazione, premi il globo sotto il campo di testo — **Lascia che questa conversazione usi Internet**. Che una conversazione possa usare Internet si decide quando inizia; per cambiarlo, inizia una nuova conversazione. Una conversazione che può usarlo lo dice nella sua prima riga. Avviare la competenza **Documentarsi** è la stessa scelta: la sua conversazione può usare Internet — vedi [Competenze](AI_Skills.md).
3. **Per ogni richiesta.** Finché le tue note sono nella conversazione, ogni pagina che l'assistente vuole leggere e ogni ricerca che vuole fare chiedono prima, con l'indirizzo completo o le parole di ricerca — è tutto ciò che lascia il tuo dispositivo per questo. **Leggi la pagina** o **Cerca** lascia passare questa singola richiesta; **Non leggere** o **Non cercare** la lascia cadere, e l'assistente prosegue senza di essa.

**Che cos'è una richiesta.** Leggere una pagina è una richiesta da questo dispositivo al sito, come aprire la pagina in un browser — senza cookie, senza accesso e senza nulla delle tue note; come in ogni visita, il sito vede il tuo indirizzo IP. Vengono lette solo pagine pubbliche tramite `https`; gli indirizzi della tua rete domestica o aziendale vengono rifiutati. Una ricerca va al provider del tuo modello — Anthropic, OpenAI, Google Gemini o OpenRouter —, che cerca esattamente con le parole che ti sono state mostrate; i provider possono addebitare le ricerche separatamente. Un modello su questo dispositivo può leggere pagine ma non può cercare, e il modello del sistema sul telefono non può usare Internet affatto.

**Da dove viene un indirizzo.** La domanda dice se hai indicato tu l'indirizzo, se lo ha indicato una nota o un risultato — oppure se il modello lo ha costruito da sé. Un indirizzo costruito dal modello potrebbe contenere qualcosa delle tue note: leggilo prima di lasciarlo passare.

**Siti senza conferma.** Con **Sempre per ⟨sito⟩** in una domanda, oppure sotto **Siti senza conferma** nelle impostazioni del vault, le pagine di un sito vengono lette senza chiedere — finché l'indirizzo è stato indicato da te, da una nota o da un risultato. Un indirizzo costruito dal modello chiede sempre.

**Cosa legge l'assistente.** Mai la pagina stessa. Una seconda richiesta allo stesso modello, senza strumenti, legge la pagina e scrive un breve rapporto: un riepilogo, affermazioni con il passaggio su cui si basano e link che si trovano davvero nella pagina. Una pagina che cerca di dare istruzioni all'assistente gli arriva quindi come rapporto su una pagina — mai come una pagina su cui lavora. Sotto la risposta, **Letto sul web** elenca le pagine lette, e la riga sotto apre tutto ciò che è stato richiesto.

**Note che restano fuori.** Una nota o una cartella con **Accesso web: mai** (vedi Regole sulla privacy più sotto) non esiste per una conversazione che può usare Internet: non nel suo contesto, non per i suoi strumenti, e i link ad essa vengono trattenuti.

Un link in una risposta il cui indirizzo è stato costruito dal modello stesso è contrassegnato, e la domanda prima dell'apertura lo dice. Se non torna nessuna risposta — nessuna connessione, il provider non risponde —, la conversazione elenca invece le note che corrispondono meglio alla tua domanda.

## E-mail e appuntamenti

**Appuntamenti.** L'assistente elenca gli appuntamenti dei tuoi calendari collegati — giorno, ora e titolo, su richiesta anche il luogo e chi partecipa — e legge un singolo appuntamento nel dettaglio: l'organizzatore, i partecipanti con le loro risposte e la tua. Non riceve mai il link di una riunione online; quello resta nel calendario.

**E-mail.** Se in questo vault sono collegati account di posta, l'assistente può cercare e leggere messaggi. L'e-mail non fa parte degli strumenti con cui inizia una conversazione: l'assistente la cerca solo quando la tua domanda ne ha bisogno, e al primo accesso Plainva chiede — **Leggere le tue e-mail?** **Consenti** vale per questo provider finché non chiudi Plainva; un altro modello o un altro provider chiede di nuovo. **Non consentire** lascia fuori l'accesso, e l'assistente prosegue senza. Un modello su questo dispositivo non chiede, perché per lui non esce nulla dal dispositivo.

**Cosa ne legge l'assistente.** Di una ricerca vede la data, il mittente e l'oggetto dei messaggi — mai il loro testo. Il testo di un messaggio e la descrizione di un appuntamento non li legge mai da solo: li hanno scritti altre persone, e chi scrive un'e-mail o un invito può scrivere proprio per questo lettore. Un secondo lettore senza alcuno strumento li legge e scrive un breve rapporto — un riepilogo, affermazioni con il passaggio su cui si basano e link che si trovano davvero lì dentro. Se un modello su questo dispositivo è impostato come **Locale** in **Modelli e profili**, quel modello è il lettore, e il testo in sé non lascia il dispositivo; al provider va solo il rapporto. Altrimenti legge il provider della conversazione, in una richiesta a parte e senza strumenti. La domanda ti dice prima chi legge.

**Cosa non cambia.** L'assistente legge soltanto: un messaggio che ha letto resta non letto, non sposta, non risponde e non elimina nulla, e non apre gli allegati — li nomina soltanto. Sotto la risposta vedi quanti messaggi sono stati letti, e la riga sotto dice chi ne ha letto il testo. Un'e-mail o un appuntamento che scrive per te è sempre e solo una bozza che invii o salvi tu — vedi **Proporre modifiche** più sotto.

## Strumenti esterni (MCP)

L'assistente può usare strumenti di server che colleghi tu stesso, tramite il Model Context Protocol (MCP) — un sistema di ticket, un wiki, un database del tuo team. È la direzione opposta di [Collegare app di IA](Connect_AI_Apps.md): lì, altre app leggono il tuo vault tramite Plainva; qui, l'assistente di Plainva interroga altri server. Nulla di un server viene usato prima che tu abbia guardato che cosa offre, e ogni chiamata ti viene mostrata prima che parta.

**Aggiungere un server.** In **Impostazioni → IA e automazione** (la parte Vault), sotto **Strumenti esterni (MCP)**, scegli **Aggiungi un server…**. Dagli un nome tuo e il suo indirizzo (`https://…`), e un token di accesso se il server lo richiede — va nell'archivio sicuro di questo dispositivo e non viene mai più mostrato. Sul desktop un server può essere anche un **Programma su questo computer**: il file da avviare, i suoi argomenti e i valori per il suo ambiente. Plainva lo avvia direttamente, senza shell, e in una sandbox quando il tuo computer ne ha una che Plainva possa usare. Il tuo sistema mostra ancora una volta l'indirizzo o l'intero comando prima che venga ricordato. Sul telefono un server è sempre un indirizzo.

**Accedere.** Alcuni server chiedono un accesso invece di un token. Il suo controllo dice allora **Il server chiede un accesso.** Scegli **Accedi…**: Plainva chiede al server dove si trova il suo accesso, apre quella pagina nel tuo browser e aspetta il tuo ritorno. Ciò che riceve resta nell'archivio sicuro di questo dispositivo e va solo a questo server; né tu né l'IA lo vedete mai. Viene rinnovato senza di te finché il server lo consente e, quando è terminato, il controllo ti chiede di accedere di nuovo. Se il servizio di accesso non permette alle app di registrarsi da sole, Plainva chiede l'**ID client** che ti ha dato il gestore del server. **Esci** dimentica l'accesso; un accesso e un token di accesso salvato si sostituiscono a vicenda.

**Controllarlo.** Un server appena aggiunto non offre ancora nulla. Il suo controllo mostra che cosa è registrato e che cosa il server elenca: la sua descrizione, i suoi strumenti con le loro descrizioni — parole del server stesso — e i suoi prompt. **Approva** consente esattamente questi testi, su questo dispositivo. Prima che un server venga usato, Plainva carica di nuovo ciò che elenca e lo confronta con ciò che hai approvato; se qualcosa è diverso, il server resta bloccato finché non lo guardi di nuovo, e il controllo dice che cosa è cambiato.

**Che cosa consente un vault.** Ogni vault decide da sé: se usare il server (**Usa ⟨server⟩ in questo vault**), quali dei suoi strumenti l'assistente può chiamare — nessuno è spuntato —, e sotto **Note che possono accompagnare una chiamata**, se **Nessuna**, **Cartelle scelte** o **L'intero vault**. Si può spuntare anche uno strumento che non dichiara di limitarsi a leggere; la sua riga indica che cosa una chiamata può allora fare sul server: modificare qualcosa, oppure modificare, sovrascrivere o eliminare qualcosa. Una spunta vale per ciò che lo strumento dichiarava quando l'hai messa: se in seguito dichiara di poter fare di più, viene offerto di nuovo solo dopo che lo hai spuntato un'altra volta.

**In una conversazione.** Gli strumenti dei tuoi server non sono tra gli strumenti con cui inizia una conversazione: l'assistente li cerca solo quando la tua domanda ne ha bisogno, e il riepilogo prima dell'invio nomina i server a cui appartengono. Ogni singola chiamata chiede prima — **Chiamare ⟨server⟩?** — con lo strumento ed esattamente ciò che verrebbe inviato. **Chiama** lascia passare questa sola chiamata, **Non chiamare** la lascia cadere, e non esiste un «sempre». Uno strumento che può modificare qualcosa chiede con altre parole — **Lasciare che ⟨server⟩ modifichi qualcosa?** —, aggiunge che Plainva non può annullarlo, e il suo pulsante è **Esegui**. Una chiamata non parte affatto se la conversazione ha letto una nota che si trova fuori da ciò che il vault consente a questo server, o una che tieni lontana dal cloud. Ciò che torna è trattato come il testo di uno sconosciuto: l'assistente lo legge e non ne accetta istruzioni.

**Prompt.** Un server può offrire prompt — richieste già pronte. Si trovano sotto una conversazione vuota, e li avvii solo tu. La prima volta, Plainva mostra in che cosa si trasforma un prompt prima che venga inviato come tuo messaggio; da allora esattamente quel testo parte senza chiedere, e un altro testo blocca il server.

**Che cosa conserva Plainva.** L'indirizzo o il comando viene ricordato su questo dispositivo, i valori salvati nel suo archivio sicuro; la tua approvazione si trova nei dati di Plainva, mai nel vault — così chi può scrivere nel vault non può approvare un server. Sotto **Chiamate recenti in questo vault** il controllo indica quando uno strumento è stato chiamato, quale e come è finita — mai che cosa è stato detto. **Rimuovi server** elimina il server da questo dispositivo, per ogni vault.

Una conversazione avviata da una competenza, un'azione su una selezione e una risposta in un thread di commenti non raggiungono gli strumenti esterni, e nemmeno il modello del sistema sul telefono.

## Agenti esterni

Sul desktop, Plainva può anche avviare un agente di IA di un altro produttore nella cartella del vault — un programma che hai installato e a cui hai effettuato l'accesso tu stesso. Un agente del genere non è l'assistente: legge e invia da sé, e le tue regole sulla privacy e il riepilogo prima dell'invio non lo raggiungono. Che cosa Plainva controlla nella sua sessione e che cosa no: [Agenti esterni](External_Agents.md).

## Proporre modifiche

L'assistente può proporre più di una risposta — e nulla di ciò che propone è nel tuo vault finché non lo dici tu. Le forme sono tre, e ciascuna attende là dove decidi tu.

- **Una proposta su una nota.** Se chiedi una modifica a una nota che esiste, l'assistente la lascia sulla nota come proposte: a margine, firmate «Plainva IA · ⟨modello⟩», ogni modifica da accettare o rifiutare per conto suo — come le proposte di una persona, vedi [Commenti e suggerimenti](Comments_and_Suggestions.md). Quando accetti, prima la nota com'era viene conservata come versione: la cronologia delle versioni ha sempre la via del ritorno. Sotto la risposta una riga nomina la nota; premendola la apri. Un valore per una proprietà della nota viene proposto allo stesso modo: la scheda mostra la proprietà con ciò che dice ora barrato e ciò che direbbe, e segnala come nuova una proprietà che la nota non ha ancora. Se, quando decidi, la proprietà dice altro, la scheda indica che la proposta non è più adatta. L'assistente non può proporre chi ha creato una nota né chi ne risponde (vedi [OKF](OKF.md)), e nemmeno le proprietà che Plainva tiene per sé. In un database, un valore proposto per una voce compare anche nella cella di quella voce, dove lo accetti o lo rifiuti senza aprire la nota — vedi [Database (.base)](Databases_Base.md).
- **Una bozza.** Una nuova nota, un'attività o una voce di diario resta una bozza: una scheda sotto la risposta dice che cosa diventerebbe e dove andrebbe. **Crea** la realizza — la nota nella cartella indicata dalla scheda (la **Cartella Inbox**, se l'assistente non ne ha indicata un'altra), l'attività letta dalle sue parole come se le avessi scritte nel campo di cattura, la voce nel diario del giorno indicato sulla scheda. **Mostra** apre prima il testo di una nota; **Scarta** butta via la bozza. Una nota creata da una bozza dice chi l'ha scritta (`generated`, vedi [OKF](OKF.md)) e nomina le note su cui si basava la conversazione. Dove le tue nuove attività vanno anche in un elenco di attività del tuo provider, la scheda di un'attività porta l'interruttore del campo di cattura, **Crea anche in “…”**: è attivo, e l'attività viene creata anche lì, a meno che tu non lo disattivi. Una voce di un database si prepara allo stesso modo: la sua scheda nomina il database e le proprietà che la voce avrebbe, e **Crea** la scrive come nota nella cartella in cui quel database tiene le sue voci — con quelle proprietà e con tutto ciò che lì fa di una nota una voce. Un database che non ha ancora una cartella di archiviazione per le nuove voci accetta una bozza del genere solo dopo che hai creato tu la sua prima voce.
- **Un piano.** Rinominare, spostare o eliminare una nota non si può controllare pezzo per pezzo, perciò l'assistente chiede: una domanda sopra il campo di immissione mostra che cosa accadrebbe — il nuovo nome e quanti link in quante note lo seguono, oppure la cartella di destinazione, con un avviso se la nota perdesse così una regola sulla privacy della sua cartella. Dopo il tuo sì, Plainva lo fa come quando lo fai tu; l'assistente viene a sapere solo se è avvenuto. Per un'eliminazione la domanda apre soltanto la finestra di eliminazione di Plainva: nulla sparisce prima che tu confermi lì. Anche una delle regole sulla privacy proprie di una nota viene chiesta allo stesso modo e non viene mai lasciata come proposta: la domanda nomina la regola e dice se verrebbe scritta nella nota o tolta da essa, con un avviso se poi la nota potesse di nuovo andare ai modelli nel cloud o entrare in conversazioni con Internet. Dopo il tuo sì, Plainva la scrive; la regola vale da quel momento e non ritira ciò che una conversazione ha già inviato.

**Un'e-mail e un appuntamento.** Dove in questo vault è collegato un account di posta o un calendario che accetta appuntamenti, l'assistente può anche preparare un'e-mail o un appuntamento. Non invia e non salva né l'una né l'altro. La scheda nomina tutti i destinatari — **A**, **Cc** e **Ccn**, oppure i **Partecipanti** — e segnala ogni indirizzo che non hai scritto tu in questa conversazione: l'assistente può averlo preso da una nota, da un'e-mail o da una pagina web, quindi controllalo. **Apri in Mail** apre l'e-mail come nuovo messaggio con tutto già compilato, **Apri nel calendario** apre l'appuntamento nell'editor degli eventi del calendario; lì cambi ciò che vuoi, e **Invia** o **Salva** è un passo tuo. I partecipanti ricevono un invito dal tuo provider di calendario quando salvi, come per ogni appuntamento che inserisci tu. La bozza resta nell'elenco finché l'e-mail non è davvero partita o il calendario non ha accettato l'appuntamento: chiudere il messaggio, annullare un invio nei suoi pochi secondi o un calendario che rifiuta la lasciano dov'era. Un'e-mail che metti da parte con **Salva bozza** da quel momento sta tra le bozze della tua casella ed esce anch'essa dall'elenco; sul desktop vale lo stesso per un messaggio che sposti in una finestra propria.

In un database l'assistente lavora anche senza una conversazione: **Compila «…» con l'IA…** legge la nota di ogni voce che non ha un valore in una colonna e ne propone uno per ciascuna, e nelle impostazioni dei filtri una frase diventa regole di filtro che vedi prima che si applichino. Prima di inviare qualsiasi cosa, il riepilogo mostra come sempre che cosa parte — per una colonna le note di quelle voci, ciascuna in una richiesta a sé; per un filtro solo le colonne del database con nomi, tipi e opzioni, e la tua frase, mai una voce. Entrambe le cose sono descritte in [Database (.base)](Databases_Base.md).

Tutto ciò che attende sta in un elenco: **In attesa**, un segmento della scheda IA sul desktop e di **Conversazioni** sul telefono. Nomina le note che portano proposte di un'IA e le bozze di questo dispositivo, ciascuna con chi l'ha lasciata. Le bozze restano sul dispositivo su cui sono state fatte, come le conversazioni; le proposte fanno parte dei commenti della nota e raggiungono con essi gli altri tuoi dispositivi.

Tre limiti valgono qualunque cosa si chieda all'assistente. Un indirizzo web che porta in una proposta o in una bozza viene scritto in modo che nulla lo apra o lo carichi (`https[://]…`); un indirizzo che hai scritto tu resta com'è. Una conversazione che ha letto una nota tenuta fuori dal cloud o da Internet lascia una proposta, un'attività o una voce di diario solo dove vale la stessa regola — una nota o una voce di database in bozza porta invece la regola con sé, e un'e-mail o un appuntamento non vengono preparati affatto. E in un workspace cifrato non si propone, non si prepara e non si pianifica nulla.

All'assistente si chiede di nominare una nota come link, quindi un link è l'unica affermazione del suo testo che Plainva può controllare: se una proposta o una bozza rimanda a una nota che il tuo vault non ha, lo dicono la riga sotto la risposta e la scheda della bozza — **Collegato, ma non presente in questo vault:** e i nomi. Per questo non viene trattenuto nulla; forse vuoi prima il link e poi la nota. Un link a una nota che nel tuo vault c'è ma che l'IA qui non può leggere — una regola sulla privacy la tiene fuori dalla conversazione — ha una riga propria: **Collega a note che l'IA qui non può leggere:** e i nomi. All'IA stessa viene detto lo stesso in entrambi i casi, quindi non può scoprire un nome provandolo. Plainva non controlla se un'affermazione è vera.

Una competenza ha queste capacità solo se le nomina, e il suo controllo lo dice — vedi [Competenze](AI_Skills.md).

## Conservare una risposta come nota

Sotto ogni risposta terminata, **Conserva come nota** trasforma la risposta in una nota del tuo vault. La premi tu e Plainva scrive la nota — l'assistente stesso continua a non cambiare nulla.

- **Dove va.** Nella **Cartella Inbox** del vault (**Impostazioni → Contenuto e struttura**), con un nome ricavato dalla tua domanda — in una conversazione avviata da una competenza, dalla competenza e dalla nota che era aperta, o dal giorno. Una nota che è già lì non viene mai toccata: la nuova riceve il primo nome libero. Plainva la apre subito.
- **Chi l'ha scritta.** La prima riga lo dice a parole — una risposta di Plainva IA, con il modello, l'ora e la tua domanda. Le proprietà della nota dicono lo stesso per altri strumenti: `generated`, con il modello e l'ora. Nulla segna la nota come revisionata; questo resta compito tuo — vedi [OKF](OKF.md).
- **Su cosa si basa.** Sotto la risposta, **Fonti** elenca ciò che l'esecuzione ha usato davvero. Plainva scrive questo elenco dal proprio registro, non il modello: le pagine lette e quando, le ricerche e tramite quale provider, e le tue note che sono state incluse o lette. Le proprietà riportano lo stesso elenco come `sources`.
- **Indirizzi.** Ogni indirizzo web che il modello ha scritto nella sua risposta viene scritto in modo che nulla lo apra o lo carichi (`https[://]…`), e un'immagine dal web non è mai un'immagine nella nota. Solo le pagine sotto **Fonti** sono link veri: indirizzi che l'esecuzione ha letto con il tuo permesso. I link alle tue note restano link.
- **Regole.** Una risposta conservata eredita le regole sulla privacy di ciò su cui si basa. Se una nota che era nella conversazione, o una che l'assistente ha letto, è tenuta lontana dal cloud o da Internet, la nuova nota porta la stessa regola — scritta nella nota stessa dove la sua cartella consentirebbe di più. Così una risposta che un modello su questo dispositivo ha ricavato da una nota privata non raggiunge nemmeno un cloud come nota.

In un workspace condiviso i suoi membri possono leggere una nota — e così i lettori di una pubblicazione che comprende la cartella. Lì Plainva chiede ogni volta, con il nome della nota e la cartella: **Conserva come nota** la scrive, **Non conservare** non scrive nulla.

## Regole sulla privacy

Alcune note non devono mai raggiungere un provider cloud. Una regola può trovarsi nel frontmatter di una nota:

```yaml
plainva:
  ai:
    cloud: deny
```

oppure, per un'intera cartella, in **Impostazioni → IA e automazione** (la parte Vault), che scrive le regole in `.agent/policy.yml`. Una nota tenuta lontana dal cloud non contribuisce con nulla — né testo né titolo — e i link ad essa in altre note vengono trattenuti. I modelli su questo dispositivo restano consentiti. I workspace cifrati tengono il cloud disattivato, a meno che tu non lo consenta lì. Il formato esatto si trova nella [File Format Reference](File_Format_Reference.md).

Un'immagine appartiene alle note che la mostrano: anche un'immagine incorporata in una nota tenuta lontana dal cloud non va a nessun modello cloud (vedi Spiegare un'immagine più sopra).

Una seconda regola, `web: deny` — **Accesso web: mai** nelle impostazioni —, tiene una nota o una cartella fuori da ogni conversazione che può usare Internet.

Su iPhone e iPad, le stesse due regole decidono quali titoli di note Siri e Comandi Rapidi possono trovare, una volta che l'hai attivato: una nota tenuta lontana dal cloud o dall'accesso web non viene mai nominata loro. Vedi «Siri e Comandi Rapidi» in [L'app mobile](Mobile_App.md).

## Cronologia e utilizzo

Le conversazioni restano su questo dispositivo, per vault — mai nel vault e mai sincronizzate. **Conserva le conversazioni** stabilisce per quanto tempo; puoi eliminare singole conversazioni nell'elenco o tutte quelle di un vault in una volta. **Utilizzo di questo mese** somma i token per provider e modello.

## Limiti della beta

- Sul desktop l'IA funziona solo nella finestra principale.
- Sul telefono una risposta arriva solo mentre l'app è aperta.
- L'assistente non cambia nessuna nota da solo: una modifica a una nota e la trascrizione di una nota vocale sono proposte che accetti o rifiuti, ciò che è nuovo è una bozza finché non premi **Crea**, un'e-mail o un appuntamento una bozza finché non invii o salvi tu, e rinominare, spostare o eliminare attendono il tuo sì; in un thread di commenti scrive una risposta accanto alla nota, mai testo al suo interno. Una risposta diventa una nota solo quando premi **Conserva come nota**; allora la scrive Plainva, non l'assistente.

Il feedback sulla beta va nelle discussioni del progetto su GitHub: **Feedback sull'IA (beta)** nelle impostazioni ne apre una.
