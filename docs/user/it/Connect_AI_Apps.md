# Collegare app di IA (Beta)

Ultimo aggiornamento: 2026-09-29

Le app di IA del tuo computer — Claude Code, Claude Desktop, Cursor, VS Code e altre che parlano il Model Context Protocol (MCP) — possono leggere il tuo vault tramite Plainva: cercarvi, leggere le note e le loro sezioni, strutture, backlink, database, attività e note recenti, e aprire una nota in Plainva. Non possono modificare nulla. Fa parte delle funzioni di IA sperimentali e funziona solo sul desktop.

## Come funziona

Plainva installa accanto all'app un piccolo programma ausiliario, `plainva-mcp`. Un'app di IA lo avvia, e il programma si collega a Plainva in esecuzione tramite un canale privato di questo computer: una named pipe su Windows, un socket in una cartella privata su macOS e Linux. Nessuna porta di rete viene mai aperta. Plainva deve essere aperto con il vault; altrimenti l'app riceve un messaggio chiaro.

## Attivarlo

1. Apri **Impostazioni → IA e automazione** e attiva **Usa l'IA su questo dispositivo**.
2. Attiva **Consenti alle app di IA di questo computer di leggere questo vault**.
3. Configura l'app (vedi sotto). Alla prima connessione Plainva chiede quale app è, quale programma l'ha avviata e quali cartelle può leggere. Non c'è niente di selezionato: scegli le cartelle o **L'intero vault**, poi **Consenti**. **Rifiuta** allontana l'app, e Plainva non chiede più di lei per dieci minuti.

L'app conserva un segreto nel portachiavi del sistema per la volta successiva. Le cartelle valgono per app e per vault: in un altro vault l'app chiede di nuovo.

## Configurare un'app

- **Claude Code:** copia il **Comando per Claude Code** dalle impostazioni ed eseguilo in un terminale.
- **Claude Desktop:** **Crea pacchetto…** scrive un file `plainva.mcpb`; aprilo, e Claude Desktop installa Plainva.
- **Altre app (JSON):** copia la configurazione e aggiungila alle impostazioni MCP dell'app, per esempio al `mcp.json` di Cursor.

## Cosa vede un'app

Solo le cartelle che hai consentito, e solo ciò che le tue regole sulla privacy lasciano andare a un modello cloud: le note con `cloud: deny`, o in una cartella con questa regola, per un'app non esistono — né il testo né i titoli —, i link verso di esse vengono trattenuti e i luoghi del diario non partono mai. Le cartelle proprie di Plainva (`.plainva`, `.agent`) e le regole stesse non sono mai leggibili. Ogni percorso di una richiesta e di una risposta viene controllato due volte: nella finestra dell'app e nella parte nativa di Plainva.

Le impostazioni elencano le app consentite con le loro cartelle e le ultime richieste. **Rimuovi** ritira il permesso di un'app in tutti i vault.

## Limiti

- Solo desktop: i telefoni non eseguono queste app, e né iOS né Android permettono a un'app di offrirne a un'altra un canale privato.
- ChatGPT e claude.ai nel browser non possono raggiungerlo: si collegano solo a server su internet, e Plainva non ne gestisce.
- Solo lettura; permettere a un'app di proporre modifiche arriverà in una versione successiva.
