# Importare da un'altra app

Ultimo aggiornamento: 2026-07-28

Plainva può importare le tue note da altre app di appunti. L'importazione scrive sempre nel vault che hai attualmente aperto, in una sottocartella che tu stesso nomini — quindi non tocca mai il resto del tuo vault, e puoi spostare o eliminare la cartella importata in seguito come qualsiasi altra cartella.

**L’importazione avviene sul desktop.** L’app mobile non può importare: porta le note sul desktop e arriveranno sul tuo telefono tramite la sincronizzazione, come qualsiasi altro file.

## Avviare un'importazione

Tre modi per iniziare:

- **Schermata di benvenuto** → **Importa da un'altra app** — il modo di procedere se non hai ancora nessun vault, il caso normale quando stai cambiando app.
- **Palette dei comandi** (`Mod+P`) → **Importa da un'altra app...**
- **Clic destro su una cartella** nell'albero dei file → **Importa da un'altra app...**

Il primo passaggio chiede la tua esportazione — **Scegli file...** oppure **Scegli cartella...**, a seconda di ciò che hai. La procedura guidata indica poi l'app che ha riconosciuto e tu decidi dove scrive l'importazione. Segue un'anteprima con i numeri dell'esecuzione, i limiti di questa importazione e le opzioni per l'origine. Nulla viene scritto finché non premi **Avvia importazione**.

**Non devi sapere quale voce corrisponde alla tua esportazione.** Scegli i file, e Plainva riconosce l'origine — un'esportazione Notion dagli ID lunghi nei suoi percorsi, un grafo Logseq dalle sue cartelle `journals/` e `pages/`, un'esportazione Keep o Simplenote dal contenuto del JSON. La procedura guidata indica cosa ha riconosciuto; se ha sbagliato, modificalo nell'elenco sopra e la tua scelta resterà valida.

## Dove scrive l'importazione

Esattamente uno dei due per ogni importazione — mai entrambi:

- **Nuovo vault**: scegli una cartella vuota, Plainva vi crea un vault nuovo e importa lì. Nulla di ciò che hai già può essere toccato, e annullare l'intera importazione significa eliminare quella cartella. È la scelta giusta se stai provando Plainva.
- **Sottocartella del vault aperto**: tutto finisce in un'unica sottocartella appena creata, che tu nomini. Il resto del tuo vault resta intatto.

La riga di destinazione sotto la scelta indica sempre la cartella esatta, così dove finiranno le cose non è mai una supposizione.

## Opzioni per questa importazione

L'anteprima mostra, sotto i numeri, gli interruttori **adatti all'origine riconosciuta** — ogni origine porta i propri, e ciò che un'origine non sa fare non compare mai lì. Si trovano lì e non prima, perché le domande hanno senso solo una volta che vedi cosa sta arrivando; un interruttore che cambia i numeri li fa ricontare all'istante.

- **Mantieni le date dalla fonte** (attivo) — le note importate mantengono le date di creazione e modifica dell'origine. Senza questa opzione, tutte hanno la data di oggi.
- **Importa anche le note eliminate** (disattivato) — per Google Keep e Simplenote, le cui esportazioni includono il cestino. Per impostazione predefinita, ciò che vi si trova resta lì; il rapporto lo nomina.

## Cosa mostra l'anteprima

L'anteprima è l'ultima tappa prima che venga scritto qualcosa, e indica tutto ciò che altrimenti sarebbe una sorpresa in seguito:

- i numeri dell'esecuzione — note e database, più **allegati** e **liste di controllo** dove l'origine ne ha,
- la cartella di destinazione esatta,
- cosa questo importatore **non può** trasferire, e ogni voce dell'archivio che è stata saltata,
- per un vault con una connessione cloud, l'avviso che le note importate verranno **caricate** in seguito,
- per origini molto grandi, l'avviso che l'indice di ricerca e la prima sincronizzazione richiederanno un po' di tempo.

## Interrompere un'esecuzione

Un'area di lavoro grande può richiedere tempo, perciò un'importazione può essere interrotta: **Interrompi importazione** durante l'esecuzione. Ciò che è già arrivato nel vault resta lì, e il rapporto lo descrive — un'importazione parziale non è un'importazione rotta. Come per un'importazione completa, l'annullamento consiste nell'eliminare la cartella.

## Cosa puoi importare

| Origine | Cosa selezioni | Cosa viene trasferito |
|---|---|---|
| **Notion (API)** | Un token di integrazione | Pagine, gerarchia delle cartelle, database con righe, relazioni, 21 tipi di proprietà |
| **Notion (esportazione ZIP)** | Lo ZIP o la cartella estratta | Pagine e struttura di cartelle; un database riceve colonne e valori delle righe dal CSV accanto |
| **Evernote (ENEX)** | Uno o più file `.enex` | Note, tag, liste di controllo (spuntate e non spuntate), date di creazione/modifica |
| **Google Keep (Takeout)** | Lo ZIP di Takeout o i file `.json` | Note, liste di controllo, etichette come tag, colore nell’intestazione della nota, note fissate come bacheca |
| **Simplenote** | Il file `.json` esportato | Le note attive e i loro tag |
| **Logseq** | La cartella del tuo grafo | I file, copiati invariati |
| **Joplin** | La cartella o lo ZIP dell’esportazione Markdown | Note con i loro taccuini, frontmatter, tag e risorse |
| **Bear (TextBundle)** | Le cartelle `.textbundle` esportate | Note con le loro immagini |
| **Notesnook** | L’esportazione Markdown | Note e le loro cartelle-taccuino; una nota in due taccuini viene importata una volta |
| **Capacities** | La cartella o lo ZIP dell’esportazione | Note con le loro proprietà come frontmatter, più i media |
| **Amplenote** | Lo ZIP dell’esportazione | Note con il loro frontmatter e le loro immagini |
| **Supernotes** | L’esportazione Markdown | Schede in Markdown, con i file di metadati accanto |
| **Heptabase** | L’esportazione Markdown | Schede con il loro frontmatter; la disposizione della whiteboard non viene trasferita |
| **UpNote** | L’esportazione Markdown | Note con i loro taccuini e allegati |
| **Craft** | L’esportazione Markdown | Documenti con le loro risorse |
| **Anytype** | L’esportazione Markdown | Oggetti con le loro relazioni come frontmatter |
| **Standard Notes** | Il backup JSON decifrato | Note con i loro titoli e tag |
| **Workflowy / Dynalist** | L’esportazione OPML | Una nota per ogni voce di primo livello, i figli come elenchi annidati |
| **Trilium** | L’esportazione del sottoalbero | L’albero delle note e i suoi allegati; le note HTML diventano Markdown |
| **Cartella Markdown / ZIP** | Una cartella, dei file o uno ZIP | I file `.md` e la loro struttura di cartelle |

**Obsidian** è presente anche nell'elenco, ma non avvia alcuna importazione — e non ne serve nessuna. Plainva lavora con gli stessi file Markdown: la voce lo spiega e ti offre **Apri vault**. Wiki-link, tag, frontmatter e file `.base` continuano a funzionare, e il tuo vault resta utilizzabile in Obsidian. Onestamente: non c'è un ecosistema di plugin, non c'è Canvas e non c'è Dataview — al loro posto hai i filtri in `.base`, e la sintassi dei plugin nelle tue note resta lì come testo semplice.

## Perché manca la mia app?

Alcune app non sono nell'elenco, e il motivo è ogni volta diverso — il che è importante, perché due di esse mancano solo per ora.

- **OneNote** — non esiste un'esportazione massiva che produca qualcosa di utilizzabile. La strada sarebbe l'API Graph di Microsoft con un login delegato: una chiamata per pagina, un'altra per ogni immagine, più la decisione su come una pagina a disposizione libera diventi anche solo Markdown. È segnalato come progetto futuro, non escluso — l'API stessa è liberamente disponibile.
- **Apple Notes** — anche Apple non offre un'esportazione massiva, e leggere le note significa fare reverse engineering di un database SQLite, solo su macOS. Esistono già strumenti di esportazione consolidati che lo fanno. Esporta in Markdown con uno di questi, poi importa la cartella tramite **Cartella Markdown / ZIP**.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — nessuna esportazione documentata da cui valga la pena importare.

Per tutto ciò che non è nell'elenco, la via d'accesso è la stessa: se la tua app può scrivere file Markdown, la voce **Cartella Markdown / ZIP** li accetta, insieme alla loro struttura di cartelle.

## Notion in dettaglio

Notion è l'unica origine in cui i due percorsi differiscono molto.

**Con un token di integrazione (consigliato).** Crea un token su `notion.so/my-integrations` — la procedura guidata indica i tre passaggi e ti apre la pagina. Poi apri ogni pagina di Notion che vuoi importare, scegli **"..."** in alto a destra → **Connessioni**, e aggiungi la tua integrazione — Notion espone solo le pagine che hai collegato esplicitamente.

**Plainva non memorizza il token.** Viene usato per quella singola esecuzione e poi sparisce; non viene creato alcun account collegato. Per la prossima importazione dovrai incollarlo di nuovo.

Tramite l'API, Plainva vede la struttura, non solo il testo:

- La gerarchia delle pagine diventa una struttura di cartelle.
- Ogni database diventa un file `.base` più una cartella con **una nota per riga**.
- **Le relazioni diventano wiki-link** tra queste note, in entrambe le direzioni.
- Vengono mappati 21 tipi di proprietà — selezione, stato, selezione multipla, data, numero, casella di controllo, URL, email, telefono, formula, rollup, relazione, persone, ID univoco e altro.
- Le viste Tabella, Bacheca, Calendario ed Elenco vengono generate dallo schema del database.
- I database incorporati in una pagina diventano incorporamenti dal vivo `![[Database.base]]`.

**Da un'esportazione ZIP.** Funziona offline e non richiede alcun token, ma l'esportazione di Notion non contiene lo schema del database né gli ID delle pagine. Le pagine e le loro cartelle vengono trasferite, e **i link tra le pagine importate continuano a funzionare** — Notion li scrive con un ID lungo in ogni segmento del percorso, e Plainva li indirizza alle note che ha effettivamente scritto. Il `.csv` accanto a ogni cartella di database viene letto per ciò che le pagine stesse non portano: le colonne, i loro tipi e i valori di ogni riga come frontmatter. Le righe per cui l'esportazione non ha una pagina vengono scritte come note. L'abbinamento avviene per titolo — la via API è quella con ID reali e resta la scelta migliore per uno spazio costruito sulle relazioni.

## Cosa le importazioni non possono trasferire

Ogni importatore indica i propri limiti nell'anteprima e di nuovo nel rapporto. I principali:

- **Gli allegati vengono trasferiti.** Da uno ZIP o da una cartella mantengono la posizione che avevano nell'esportazione, così un link relativo a un'immagine dentro una nota continua a funzionare. Da Notion tramite l'API vengono scaricati durante l'importazione — Notion firma quei link e scadono nel giro di un'ora — e finiscono in una cartella `Attachments`; le immagini che una pagina richiama da altrove sul web restano link. Due eccezioni restano nella tua esportazione e vengono elencate una per una nel rapporto: gli allegati dentro un `.enex` di Evernote e le immagini di Google Keep.
- **Alcune voci dell'archivio vengono saltate di proposito:** file molto grandi, collegamenti simbolici e voci con un percorso non sicuro. Appaiono con un motivo nell'anteprima, prima che tu avvii l'importazione.
- **Le pagine Notion molto lunghe** vengono lette per intero, ma il contenuto annidato all'interno di toggle, colonne o sotto-elenchi non viene seguito.
- **I file Logseq vengono copiati invariati** — le proprietà `key:: value` e i riferimenti ai blocchi non vengono convertiti in proprietà o link di Plainva.
- **Le note eliminate restano eliminate.** Il cestino di Simplenote e di Google Keep viene saltato — hai deciso una volta di fare a meno di quelle note, e un'importazione non dovrebbe restituirtele di nascosto. Compaiono per nome nel rapporto, così vedi cosa è rimasto indietro.
- **Le esportazioni ZIP di Notion** abbinano righe e pagine per titolo (vedi sopra) e non trasferiscono relazioni tra database.

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

In fondo è indicato come **annullare** l'importazione: tutto ciò che proviene da un'esecuzione si trova in un'unica cartella — eliminarla fa sparire l'importazione. Con la destinazione **Nuovo vault** si tratta della cartella stessa del nuovo vault. Non serve alcun comando di annullamento separato per questo. Il rapporto stesso è una nota normale e può essere eliminato non appena lo hai letto.

## Vedi anche

- [Database (.base)](Databases_Base.md) — cosa succede ai database Notion importati
- [OKF](OKF.md) — il frontmatter che ricevono le note importate
- [Per iniziare](Getting_Started.md) — creare un vault separato per un'importazione
