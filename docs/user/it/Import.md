# Importare da un'altra app

Ultimo aggiornamento: 2026-07-28

Plainva può importare le tue note da altre app di appunti. L'importazione scrive sempre nel vault che hai attualmente aperto, in una sottocartella che tu stesso nomini — quindi non tocca mai il resto del tuo vault, e puoi spostare o eliminare la cartella importata in seguito come qualsiasi altra cartella.

**L’importazione avviene sul desktop.** L’app mobile non può importare: porta le note sul desktop e arriveranno sul tuo telefono tramite la sincronizzazione, come qualsiasi altro file.

## Avviare un'importazione

Due modi per iniziare:

- **Palette dei comandi** (`Mod+P`) → **Importa da un'altra app...**
- **Clic destro su una cartella** nell'albero dei file → **Importa da un'altra app...**

La procedura guidata ha tre passaggi: scegli l'app da cui provieni, scegli i file di esportazione (oppure inserisci un token di integrazione Notion) e assegna un nome alla cartella di destinazione. Ottieni poi un'anteprima con il numero di note e database e un elenco di tutto ciò che l'importatore non può trasferire. Nulla viene scritto finché non premi **Avvia importazione**.

## Cosa puoi importare

| Origine | Cosa selezioni | Cosa viene trasferito |
|---|---|---|
| **Notion (API)** | Un token di integrazione | Pagine, gerarchia delle cartelle, database con righe, relazioni, 21 tipi di proprietà |
| **Notion (esportazione ZIP)** | Lo ZIP o la cartella estratta | Pagine e struttura delle cartelle. I database vengono creati **vuoti** |
| **Evernote (ENEX)** | Uno o più file `.enex` | Note, tag, liste di controllo (spuntate e non spuntate), date di creazione/modifica |
| **Google Keep (Takeout)** | Lo ZIP di Takeout o i file `.json` | Note, liste di controllo, etichette come tag, colore, fissate/archiviate |
| **Simplenote** | Il file `.json` esportato | Le note attive e i loro tag |
| **Logseq** | La cartella del tuo grafo | I file, copiati invariati |
| **Cartella Markdown / ZIP** | Una cartella, dei file o uno ZIP | I file `.md` e la loro struttura di cartelle |

Non esiste un importatore per Obsidian — e non serve. Plainva apre direttamente un vault Obsidian: **Apri vault** e scegli la cartella.

## Notion in dettaglio

Notion è l'unica origine in cui i due percorsi differiscono molto.

**Con un token di integrazione (consigliato).** Crea un token su `notion.so/my-integrations`. Poi apri ogni pagina di Notion che vuoi importare, scegli **"..."** in alto a destra → **Connessioni**, e aggiungi la tua integrazione — Notion espone solo le pagine che hai collegato esplicitamente.

Tramite l'API, Plainva vede la struttura, non solo il testo:

- La gerarchia delle pagine diventa una struttura di cartelle.
- Ogni database diventa un file `.base` più una cartella con **una nota per riga**.
- **Le relazioni diventano wiki-link** tra queste note, in entrambe le direzioni.
- Vengono mappati 21 tipi di proprietà — selezione, stato, selezione multipla, data, numero, casella di controllo, URL, email, telefono, formula, rollup, relazione, persone, ID univoco e altro.
- Le viste Tabella, Bacheca, Calendario ed Elenco vengono generate dallo schema del database.
- I database incorporati in una pagina diventano incorporamenti dal vivo `![[Database.base]]`.

**Da un'esportazione ZIP.** Funziona offline e non richiede alcun token, ma l'esportazione di Notion non contiene lo schema del database né gli ID delle pagine. Le pagine e le loro cartelle vengono trasferite, e **i link tra le pagine importate continuano a funzionare** — Notion li scrive con un ID lungo in ogni segmento del percorso, e Plainva li indirizza alle note che ha effettivamente scritto. I database vengono creati come file `.base` **vuoti**, e il rapporto lo segnala. Se i tuoi database sono importanti, usa il percorso API.

## Cosa le importazioni non possono trasferire

Ogni importatore indica i propri limiti nell'anteprima e di nuovo nel rapporto. I principali:

- **Allegati e immagini non vengono importati.** Il rapporto li elenca uno per uno, così sai cosa resta nella tua esportazione; anche gli allegati di Evernote e le immagini di Keep restano lì.
- **Alcune voci dell'archivio vengono saltate di proposito:** file molto grandi, collegamenti simbolici e voci con un percorso non sicuro. Appaiono con un motivo nell'anteprima, prima che tu avvii l'importazione.
- **Le pagine Notion molto lunghe** vengono lette per intero, ma il contenuto annidato all'interno di toggle, colonne o sotto-elenchi non viene seguito.
- **I file Logseq vengono copiati invariati** — le proprietà `key:: value` e i riferimenti ai blocchi non vengono convertiti in proprietà o link di Plainva.
- **Le note eliminate restano eliminate.** Il cestino di Simplenote e di Google Keep viene saltato — hai deciso una volta di fare a meno di quelle note, e un'importazione non dovrebbe restituirtele di nascosto. Compaiono per nome nel rapporto, così vedi cosa è rimasto indietro.
- **Le esportazioni ZIP di Notion** creano database vuoti (vedi sopra).

## Anche le date vengono trasferite

Una raccolta cresciuta nel corso degli anni perde il proprio riferimento temporale se, dopo un'importazione, tutto risulta datato a oggi. Per questo Plainva trasferisce le date dell'origine:

- Compaiono come `created` e `updated` nel frontmatter della nota importata, che è anche il punto in cui l'asse temporale del grafo le legge.
- Anche il file stesso riceve la data di modifica dell'origine, così l'ordinamento per data e **Aperti di recente** risultano corretti. La data di creazione del file può essere impostata solo su Windows; sugli altri sistemi è il frontmatter a farsene carico.
- Se un'origine non fornisce alcuna data, Plainva usa la data del file di esportazione. Non ne inventa mai una: se non c'è alcuna indicazione, il campo resta vuoto.

## Un errore non interrompe l'intera importazione

Se una singola nota non può essere scritta, l'importazione prosegue e il rapporto la segnala con il motivo. Il rapporto viene scritto anche quando l'esecuzione si interrompe in anticipo — così vedi sempre cosa è già arrivato nel tuo vault.

## Nulla viene sovrascritto

L'importazione scrive nel vault che hai aperto, quindi è pensata per essere non distruttiva:

- Se il nome di una nota è già in uso, la nota importata viene **numerata** (`Meeting (2).md`) invece di sostituire quella esistente. Questo vale anche quando due note di origine condividono un nome.
- Le note importate ricevono il consueto frontmatter OKF (`type`, `okf_version`), così si comportano come qualsiasi altra nota di Plainva nei filtri e nelle viste `.base`.
- Nulla al di fuori della sottocartella di destinazione viene modificato.

Se preferisci mantenere l'importazione completamente separata, crea prima un nuovo vault (**Nuovo vault** sulla schermata di benvenuto) e importa lì.

## Il rapporto di importazione

Ogni esecuzione scrive un **rapporto di importazione** nella cartella di destinazione. Elenca:

- quante note e database sono stati importati,
- cosa questo importatore non può trasferire affatto,
- tutto ciò che è arrivato **in modo incompleto** o è stato **saltato**, con il motivo,
- e ogni file, con il suo stato.

Il rapporto è la registrazione onesta dell'esecuzione — se qualcosa è stato troncato o scartato, appare lì invece di essere silenziosamente conteggiato come un successo. Vale la pena leggerlo prima di eliminare l'esportazione.

## Vedi anche

- [Database (.base)](Databases_Base.md) — cosa succede ai database Notion importati
- [OKF](OKF.md) — il frontmatter che ricevono le note importate
- [Per iniziare](Getting_Started.md) — creare un vault separato per un'importazione
