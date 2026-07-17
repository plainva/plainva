# Automazione e script

Ultimo aggiornamento: 2026-07-15

Plainva non ha un sistema di plugin che esegue codice di terze parti. È invece il vault stesso a fare da interfaccia di estensione: le tue note sono semplice Markdown, i database sono puro YAML (`.base`), e le [convenzioni OKF](OKF.md) danno a ogni file una struttura prevedibile. Qualsiasi cosa sia in grado di leggere e scrivere file — uno script shell, un programma Python, uno strumento CLI, un job pianificato o un agente IA — può estendere, generare o riorganizzare il tuo vault senza bisogno di un'unica API specifica di Plainva.

Questa pagina spiega come farlo **in sicurezza**. Il formato esatto di ogni file, a livello di byte, è documentato separatamente nella [File Format Reference](File_Format_Reference.md); questa pagina ne è il compagno pratico: le regole, il flusso di lavoro e cosa consegnare a un assistente IA.

## Perché file invece di una sandbox per plugin

- **Sicurezza.** Un sistema di plugin a codice esegue il programma di qualcun altro dentro il tuo editor, con accesso alle tue note. I semplici file non richiedono questo tipo di fiducia: uno script tocca solo la cartella verso cui lo indirizzi, con i normali permessi del tuo sistema operativo.
- **Longevità.** Il formato sopravvive all'app. Un file Markdown generato con uno script cinque anni fa si apre ancora oggi — in Plainva, in Obsidian, in qualsiasi editor di testo. Non esiste un'API di plugin da deprecare.
- **Il formato è il contratto.** Poiché il formato su disco è aperto e documentato, l'"API" è stabile e ispezionabile. Puoi confrontarla con un diff, versionarla in Git e ragionarci sopra.

Se vuoi qualcosa che Plainva non fa di serie, non aspetti un plugin — scrivi un piccolo script che agisce sui file.

## Leggere un vault in sicurezza

Tutto è testo UTF-8:

- **Note (`.md`)** — un blocco opzionale di frontmatter YAML (tra due righe `---` in cima) contiene le proprietà; segue il corpo Markdown. Analizza il frontmatter con qualsiasi libreria YAML.
- **Database (`.base`)** — puro YAML che descrive viste sulle note. I *valori* non sono mai nella `.base`; vivono nel frontmatter delle note.
- **Struttura** — i tag sono `#tag` nel corpo del testo o `tags:` nel frontmatter; i link sono `[[Note]]` (wiki link) o `[text](path.md)`. Le attività sono voci di elenco `- [ ]` / `- [x]`.

Leggere non richiede mai particolare attenzione — i file di testo non possono essere "corrotti" leggendoli. Le regole seguenti riguardano tutte la *scrittura*.

## Scrivere un vault in sicurezza

Segui queste regole e Plainva (e Obsidian) accetteranno le tue modifiche senza problemi. Plainva osserva la cartella del vault: una scrittura esterna viene rilevata e re-indicizzata automaticamente, di solito entro un secondo.

1. **Scrivi in UTF-8 senza BOM, con terminatori di riga LF.** Gli strumenti Windows che usano UTF-16 o CRLF come impostazione predefinita producono file che Plainva considera modificati a ogni sincronizzazione.
2. **Scrivi in modo atomico.** Scrivi in un file temporaneo nella stessa cartella, poi rinominalo sopra il file di destinazione. Una nota scritta solo a metà (ad esempio dopo un arresto anomalo) è peggio di nessuna modifica. Plainva stesso scrive ogni nota in questo modo.
3. **Conserva il frontmatter OKF e le chiavi sconosciute.** Mantieni `type` e `okf_version` quando riscrivi una nota, e non scartare mai le chiavi del frontmatter che non riconosci — falle sopravvivere invariate. Non "ripulire" chiavi che non capisci.
4. **Non toccare mai `.plainva/`.** Quella cartella contiene l'indice locale di Plainva, i backup, i fissaggi del grafo e lo stato di sincronizzazione. Non fa parte dei tuoi contenuti e i tuoi script non devono mai scriverla, sincronizzarla o includerla in un commit su Git.
5. **Rispetta le regole della `.base`.** Una `.base` usa solo le quattro chiavi di primo livello di Obsidian (`filters`, `formulas`, `properties`, `views`); ogni vista richiede un `name`; i filtri sono a radice singola. Tutti i dati specifici di Plainva vanno sotto sotto-chiavi annidate `plainva:`. La [File Format Reference](File_Format_Reference.md#databases-base) contiene il contratto completo, incluso un esempio di relazioni a due vie.
6. **Non entrare in conflitto con l'editor.** Se una nota è aperta *e* ha modifiche non salvate in Plainva, evita di riscriverla da uno script nello stesso momento. Plainva ha un risolutore di conflitti come rete di sicurezza, ma il percorso più pulito è lasciare che l'app salvi per prima (oppure modificare note che al momento non sono aperte).

## Casi d'uso

Alcuni compiti comuni, tutti semplici operazioni sui file:

- **Creare note in blocco** — genera file `.md` con un blocco di frontmatter OKF (`type`, `okf_version`, oltre alle tue proprietà) e un corpo Markdown. Plainva le indicizza non appena compaiono.
- **Generatori di note giornaliere o report** — uno script pianificato che scrive una nota datata nella tua cartella delle note giornaliere, compilata a partire da un'altra fonte.
- **Scansioni delle proprietà** — leggi il frontmatter di ogni nota, trasforma un campo, riscrivilo (in modo atomico, conservando le chiavi sconosciute).
- **Esportazione / pubblicazione** — leggi il vault e rendilo in HTML, un sito statico o un PDF. Solo lettura — nessuna regola di cui preoccuparsi.
- **Manutenzione dei link** — riesamina i link `[[Note]]` e i `tags:` e produci un report, oppure correggili direttamente.

Mantieni gli script idempotenti quando possibile: eseguirli due volte non dovrebbe duplicare i contenuti.

## Consegnare il vault a un assistente IA

Un agente IA con accesso in lettura/scrittura a una cartella del vault è esattamente il caso per cui questo design è pensato. Perché funzioni correttamente:

1. **Dagli la [File Format Reference](File_Format_Reference.md).** È scritta per un lettore automatico: il contratto del frontmatter OKF, la serializzazione proprietà→YAML, lo schema `.base` completo con le sue regole rigide di Obsidian, il contratto di `index.md` e le regole di sicurezza — tutto ciò di cui un agente ha bisogno per modificare i file senza romperli.
2. **Puntalo sulla cartella del vault, non sulla cartella `.plainva/`.** Chiarisci che `.plainva/` è vietata.
3. **Chiedi modifiche atomiche e minime.** Un agente che riscrive un'intera nota per cambiare una sola proprietà dovrebbe conservare il resto del frontmatter e del corpo del testo invariato.

Poiché il contratto è un documento e non un'API in esecuzione, le stesse istruzioni funzionano con qualsiasi assistente, offline o online.

## Sicurezza in breve

- UTF-8, senza BOM, LF.
- Scrivi in modo atomico (file temporaneo + rinomina).
- Conserva `type`, `okf_version` e le chiavi sconosciute.
- Non scrivere mai in `.plainva/`.
- `.base`: quattro chiavi di primo livello, viste con nome, filtri a radice singola, sotto-chiavi `plainva:` per tutto il resto.
- Il vault è osservato — le modifiche esterne compaiono automaticamente in Plainva.

## Vedi anche

- [File Format Reference](File_Format_Reference.md) — il formato esatto su disco di ogni file
- [OKF](OKF.md) — l'Open Knowledge Format che dà ai file la loro struttura prevedibile
- [Database (.base)](Databases_Base.md) — come funzionano le viste `.base`
