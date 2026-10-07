# Collegare app di IA (Beta)

Ultimo aggiornamento: 2026-10-07

Le app di IA del tuo computer — Claude Code, Claude Desktop, Cursor, VS Code e altre che parlano il Model Context Protocol (MCP) — possono leggere il tuo vault tramite Plainva: cercarvi, leggere le note e le loro sezioni, strutture, backlink, database, attività e note recenti, e aprire una nota in Plainva. Da sole non modificano nulla: un'app a cui lo consenti può proporre modifiche, e queste attendono la tua decisione (vedi sotto). Fa parte delle funzioni di IA sperimentali e funziona solo sul desktop.

La direzione opposta — l'assistente di Plainva che usa strumenti di server che colleghi tu stesso — è descritta sotto **Strumenti esterni (MCP)** in [Assistente IA](AI_Assistant.md).

Una terza via — Plainva avvia un agente di IA di un altro produttore nella cartella del vault, con la sua sessione nella scheda IA — è descritta in [Agenti esterni](External_Agents.md).

## Come funziona

Plainva installa accanto all'app un piccolo programma ausiliario, `plainva-mcp`. Un'app di IA lo avvia, e il programma si collega a Plainva in esecuzione tramite un canale privato di questo computer: una named pipe su Windows, un socket in una cartella privata su macOS e Linux. Nessuna porta di rete viene mai aperta. Plainva deve essere aperto con il vault; altrimenti l'app riceve un messaggio chiaro.

## Attivarlo

1. Apri **Impostazioni → IA e automazione** e attiva **Usa l'IA su questo dispositivo**.
2. Attiva **Consenti alle app di IA di questo computer di leggere questo vault**.
3. Configura l'app (vedi sotto). Alla prima connessione Plainva chiede quale app è, quale programma l'ha avviata e quali cartelle può leggere. Non c'è niente di selezionato: scegli le cartelle o **L'intero vault**, poi **Consenti**. **Rifiuta** allontana l'app, e Plainva non chiede più di lei per dieci minuti. Sotto le cartelle c'è **Può proporre modifiche**, disattivato finché non lo selezioni; che cosa consente è descritto più sotto.

L'app conserva un segreto nel portachiavi del sistema per la volta successiva. Le cartelle valgono per app e per vault: in un altro vault l'app chiede di nuovo.

## Configurare un'app

- **Claude Code:** copia il **Comando per Claude Code** dalle impostazioni ed eseguilo in un terminale.
- **Claude Desktop:** **Crea pacchetto…** scrive un file `plainva.mcpb`; aprilo, e Claude Desktop installa Plainva.
- **Altre app (JSON):** copia la configurazione e aggiungila alle impostazioni MCP dell'app, per esempio al `mcp.json` di Cursor.

## Cosa vede un'app

Solo le cartelle che hai consentito, e solo ciò che le tue regole sulla privacy lasciano andare a un modello cloud che può raggiungere Internet — un'app è trattata come tale, perché Plainva non vede che cosa fa di ciò che legge: le note con `cloud: deny` o `web: deny`, o in una cartella con una di queste regole, per un'app non esistono — né il testo né i titoli —, i link verso di esse vengono trattenuti e i luoghi del diario non partono mai. Le cartelle proprie di Plainva (`.plainva`, `.agent`) e le regole stesse non sono mai leggibili. Ogni percorso di una richiesta e di una risposta viene controllato due volte: nella finestra dell'app e nella parte nativa di Plainva.

Le impostazioni elencano le app consentite con le loro cartelle e le ultime richieste. **Rimuovi** ritira il permesso di un'app in tutti i vault. Vale subito, anche per un'app connessa in quel momento.

Oltre agli strumenti, Plainva offre le sue tre competenze come prompt, nella lingua dell'app: `daily-orientation`, `weekly-review` e `project-status`, che chiede il nome del progetto. Un'app che supporta i prompt li elenca tra i suoi comandi.

## Lasciare che un'app proponga modifiche

Leggere non è mai un permesso di scrivere. Che un'app possa anche proporre modifiche è una risposta a sé: **Può proporre modifiche** nella domanda alla sua prima connessione, o più tardi l'interruttore **… può proporre modifiche** nelle impostazioni — per app e per vault, e disattivato finché non lo attivi. Vale dalla successiva richiesta dell'app; gli strumenti aggiuntivi compaiono nell'app quando si riconnette.

Un'app a cui lo hai consentito riceve altri sei strumenti, e nessuno modifica il vault:

- **Una modifica a una nota** — al testo o a una delle sue proprietà — diventa una proposta a margine della nota, firmata con il nome dell'app e «(app di IA)». Lì accetti o rifiuti ogni modifica, come per ogni proposta (vedi [Commenti e suggerimenti](Comments_and_Suggestions.md)).
- **Una nuova nota** diventa una bozza sotto **In attesa**, nella scheda IA. Esiste quando lì scegli **Crea**.
- **Rinominare, spostare ed eliminare** chiedono prima. Plainva mostra nella propria finestra che cosa accadrebbe — per una rinomina anche le note i cui link seguirebbero — e l'app mostra un avviso che Plainva è in attesa. Solo dopo **Consenti** in Plainva, e quando l'app prosegue, Plainva lo fa come quando lo fai a mano; l'app viene a sapere solo se è avvenuto. Per un'eliminazione Plainva apre allora la propria finestra di eliminazione, e nulla sparisce prima che tu confermi lì. A un'app che non può mostrare un avviso del genere questi tre strumenti non vengono offerti.

Un indirizzo web che un'app porta viene scritto in modo che nulla lo apra o lo carichi (`https[://]…`), come per l'assistente. Le regole sulla privacy proprie di una nota (`plainva.ai`) non le imposta nessuna app, e in un workspace cifrato nulla viene proposto, abbozzato o pianificato. **Richieste recenti** nelle impostazioni dice per ogni richiesta che cosa ne è stato — anche che Plainva ha chiesto a te, o che hai detto di no.

## Limiti

- Solo desktop: i telefoni non eseguono queste app, e né iOS né Android permettono a un'app di offrirne a un'altra un canale privato.
- ChatGPT e claude.ai nel browser non possono raggiungerlo: si collegano solo a server su internet, e Plainva non ne gestisce.
- Un'app non modifica mai il vault da sola: ciò che scrive attende come proposta o bozza, e rinominare, spostare o eliminare richiede il tuo sì in Plainva.
