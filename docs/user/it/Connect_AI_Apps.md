# Collegare app di IA (Beta)

Ultimo aggiornamento: 2026-11-17

Le app di IA del tuo computer — Claude Code, Claude Desktop, Cursor, VS Code e altre che parlano il Model Context Protocol (MCP) — possono leggere il tuo vault tramite Plainva: cercarvi, leggere le note e le loro sezioni, strutture, backlink, database, attività e note recenti, e aprire una nota in Plainva. Da sole non modificano nulla: un'app a cui lo consenti può proporre modifiche, e queste attendono la tua decisione (vedi sotto). Fa parte delle funzioni di IA sperimentali e funziona solo sul desktop.

La direzione opposta — l'assistente di Plainva che usa strumenti di server che colleghi tu stesso — è descritta sotto **Strumenti esterni** in [Assistente IA](AI_Assistant.md).

Una terza via — Plainva avvia un agente di IA di un altro produttore nella cartella del vault, con la sua sessione nella scheda IA — è descritta in [Agenti esterni](External_Agents.md).

## Come funziona

Plainva installa accanto all'app un piccolo programma ausiliario, `plainva-mcp`. Un'app di IA lo avvia, e il programma si collega a Plainva in esecuzione tramite un canale privato di questo computer: una named pipe su Windows, un socket in una cartella privata su macOS e Linux. Nessuna porta di rete viene mai aperta. Plainva deve essere aperto con il vault; altrimenti l'app riceve un messaggio chiaro.

## Attivarlo

1. Apri **Impostazioni → IA** e attiva **Usa l'IA su questo dispositivo**.
2. Nella scheda **App di IA su questo computer** attiva **Consenti alle app di IA di questo computer di leggere questo vault**.
3. Configura l'app (vedi sotto). Alla prima connessione Plainva chiede quale app è, quale programma l'ha avviata e quali cartelle può leggere. Non c'è niente di selezionato: scegli tra le cartelle di primo livello del vault o **L'intero vault**, poi **Consenti**. **Rifiuta** allontana l'app, e Plainva non chiede più di lei per dieci minuti. Sotto le cartelle c'è **Può proporre modifiche**, disattivato finché non lo selezioni; che cosa consente è descritto più sotto.

L'app conserva un segreto nel portachiavi del sistema per la volta successiva. Le cartelle valgono per app e per vault: in un altro vault l'app chiede di nuovo. Se apri un altro vault, le app connesse a quello precedente vengono disconnesse; leggono quello nuovo solo dopo essersi riconnesse. Finché **Completamente locale** è attivo (vedi [Assistente IA](AI_Assistant.md)), il server è in pausa: nessuna app può leggere il vault, e un'app che si collega viene rifiutata.

## Configurare un'app

- **Claude Code:** copia il **Comando per Claude Code** dalle impostazioni ed eseguilo in un terminale.
- **Claude Desktop:** **Crea pacchetto…** scrive un file `plainva.mcpb`; aprilo, e Claude Desktop installa Plainva.
- **Altre app (JSON):** copia la configurazione e aggiungila alle impostazioni MCP dell'app, per esempio al `mcp.json` di Cursor.

## Cosa vede un'app

Solo le cartelle che hai consentito, e solo ciò che le tue regole sulla privacy lasciano andare a un modello cloud che può raggiungere Internet — un'app è trattata come tale, perché Plainva non vede che cosa fa di ciò che legge: le note con `cloud: deny` o `web: deny`, o in una cartella con una di queste regole, per un'app non esistono — né il testo né i titoli —, i link verso di esse vengono trattenuti e i luoghi del diario non partono mai. Anche una nota in una cartella consentita il cui nome non si può valutare così com'è — termina con uno spazio o un punto, contiene i due punti o non è nella forma Unicode composta — viene lasciata fuori, e la risposta dice quante note sono state lasciate fuori. Le cartelle proprie di Plainva (`.plainva`, `.agent`) e le regole stesse non sono mai leggibili. Ogni percorso di una richiesta e di una risposta viene controllato due volte: nella finestra dell'app e nella parte nativa di Plainva. Un collegamento a una cartella che, dentro una cartella consentita, porta altrove non viene seguito, e un database risponde solo con valori calcolati da note che l'app può leggere: un conteggio o una somma su collegamenti verso altre cartelle lascia fuori quelle note. Un collegamento in ciò che un'app legge resta solo se porta a una nota che l'app può leggere; ogni altro — anche verso una nota che non esiste — viene trattenuto. Una ricerca non trova una nota tramite il testo di un collegamento trattenuto e, nel dubbio, la lascia fuori; una modifica che toccherebbe un collegamento trattenuto o porterebbe il suo segnaposto in una nota viene rifiutata.

Le impostazioni elencano le app che hai consentito su questo computer con le loro cartelle in questo vault (**nessuna in questo vault** per un'app consentita solo altrove) e le ultime richieste. **Rimuovi** ritira il permesso di un'app in tutti i vault. Vale subito, anche per un'app connessa in quel momento.

Finché il workspace cifrato del vault aperto è bloccato, Plainva non risponde a nessuna app: ogni richiesta — anche un elenco o una ricerca — viene rifiutata con un messaggio che dice che il workspace è bloccato, una richiesta in corso quando lo blocchi non riceve nulla di ciò che ha trovato, e un'app che si connette lo sa subito. Sbloccalo e la stessa connessione risponde di nuovo. Un permesso segue il nome della cartella: se rinomini una cartella consentita, l'app non la vede più finché non la consenti di nuovo, e una nuova cartella con il vecchio nome le sarebbe visibile.

Oltre agli strumenti, Plainva offre cinque delle sue competenze come prompt, nella lingua propria di Plainva, e il riferimento al formato dei file come risorsa (`plainva://format`): i prompt sono `daily-orientation`, `weekly-review`, `project-status`, `meeting-prep` e `task-triage`; `project-status` chiede il nome del progetto e `meeting-prep` la riunione. Un'app che supporta i prompt li elenca tra i suoi comandi.

## Lasciare che un'app proponga modifiche

Leggere non è mai un permesso di scrivere. Che un'app possa anche proporre modifiche è una risposta a sé: **Può proporre modifiche** nella domanda alla sua prima connessione, o più tardi l'interruttore **… può proporre modifiche** nelle impostazioni — per app e per vault, e disattivato finché non lo attivi. Vale dalla successiva richiesta dell'app; Plainva dice subito a un'app connessa che i suoi strumenti sono cambiati (un'app che usa la revisione più recente del protocollo lo viene a sapere solo se ha chiesto di essere avvisata) — se poi li mostra senza riconnettersi dipende dall'app.

Un'app a cui lo hai consentito riceve altri sei strumenti, e nessuno modifica il vault:

- **Una modifica a una nota** — al testo o a una delle sue proprietà — diventa una proposta a margine della nota, firmata con il nome dell'app e «(app di IA)». Lì accetti o rifiuti ogni modifica, come per ogni proposta (vedi [Commenti e suggerimenti](Comments_and_Suggestions.md)).
- **Una nuova nota** diventa una bozza sotto **Da decidere**, nella scheda IA. Esiste quando lì scegli **Crea**.
- **Rinominare, spostare ed eliminare** chiedono prima. Plainva mostra nella propria finestra che cosa accadrebbe — per una rinomina anche le note i cui link seguirebbero — e l'app mostra un avviso che Plainva è in attesa. Solo dopo **Consenti** in Plainva, e quando l'app prosegue, Plainva lo fa come quando lo fai a mano; l'app viene a sapere solo se è avvenuto. Per un'eliminazione Plainva apre allora la propria finestra di eliminazione, e nulla sparisce prima che tu confermi lì. A un'app che non può mostrare un avviso del genere — serve la revisione 2026-07-28 del protocollo MCP o più recente, e l'app deve poterti porre una domanda in un modulo — questi tre strumenti non vengono offerti.

Un indirizzo web che un'app porta viene scritto in modo che nulla lo apra o lo carichi (`https[://]…`), come per l'assistente. Le regole sulla privacy proprie di una nota (`plainva.ai`) non le imposta nessuna app, e in un workspace cifrato nulla viene proposto, abbozzato o pianificato. L'elenco delle richieste recenti nelle impostazioni mostra le otto più recenti e segna quelle su cui Plainva ti ha chiesto (**richiesta di conferma**), quelle che hai negato (**negata**) e quelle che non sono passate (**rifiutata**); una richiesta passata non porta alcuna parola.

## Limiti

- Solo desktop: i telefoni non eseguono queste app, e né iOS né Android permettono a un'app di offrirne a un'altra un canale privato.
- ChatGPT e claude.ai nel browser non possono raggiungerlo: si collegano solo a server su internet, e Plainva non ne gestisce.
- Un'app non modifica mai il vault da sola: ciò che scrive attende come proposta o bozza, e rinominare, spostare o eliminare richiede il tuo sì in Plainva.
