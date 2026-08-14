# Note e Markdown

Ultimo aggiornamento: 2026-08-14

Ogni nota in Plainva è un normale file Markdown (`.md`). Questa pagina spiega come scrivere comodamente e cosa finisce effettivamente nel file — perché è proprio questo che rende le tue note portabili: qualsiasi editor di testo, Obsidian o un diff di git può leggerle.

## Il principio fondamentale: tutto è testo

Qualunque cosa tu veda in Plainva — testo formattato, tabelle, proprietà, icone — è memorizzata come testo aperto:

```markdown
---
type: Note
okf_version: "0.1"
tags: [project]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Il mio progetto

Un pensiero **in grassetto** con un link a [[Un'altra nota]].

- [ ] Prima attività
```

Il blocco tra le righe `---` è il **frontmatter** (YAML): è lì che vivono le proprietà della nota. Sotto viene il normale testo Markdown. La presentazione specifica di Plainva (icona, colore dell'intestazione) è raggruppata sotto l'unica chiave `plainva:` — gli altri programmi la ignorano semplicemente.

## Scrivere in Anteprima dal vivo

**Anteprima dal vivo** è la modalità predefinita: il Markdown viene renderizzato mentre digiti restando comunque sempre modificabile.

### Il menu slash

Digita `/` all'inizio di una riga per aprire il menu di inserimento. È suddiviso in sezioni:

- **Blocchi di base** — Testo, Titolo 1–6, Elenco puntato, Elenco numerato, Elenco di cose da fare, Citazione, Blocco di codice, Tabella, Separatore, **Formula (LaTeX)**, **Diagramma Mermaid**
- **Formattazione** — Grassetto, Corsivo, Barrato, Codice in linea, Evidenziazione, **Emoji**
- **Link e media** — Link, Link interno, Immagine (web), Immagine interna, Incorpora, Incorpora database, Crea database in linea
- **Documento** — Icona del documento, Colore dell'intestazione, Inserisci modello
- **Callout** — 13 varianti (Nota, Info, Da fare, Riepilogo, Suggerimento, Successo, Domanda, Avviso, Fallimento, Pericolo, Bug, Esempio, Citazione)

### Altri aiuti per la scrittura

- **Barra degli strumenti di selezione** — seleziona del testo e una piccola barra offre **Grassetto**, **Corsivo**, **Barrato**, **Codice in linea**, **Evidenziazione** e **Link**.
- **Menzioni `@`** — digita `@` ovunque nel testo per inserire una **Data** (Oggi, Domani, Ieri o **Scegli una data…**, memorizzata come data ISO), un link a una **Nota**, o un incorporamento di **Database**.
- **Emoji** — il comando slash **Emoji** (`/emoji`) apre un selettore di emoji alla posizione del cursore; oppure digita `:name` (ad esempio `:rocket`) per ottenere suggerimenti in linea. In entrambi i casi Plainva inserisce il carattere emoji vero e proprio (Unicode portabile), mai uno `:shortcode:` — così la nota resta leggibile in Obsidian, su GitHub e ovunque altro. (Questa funzione è indipendente dall'**Icona del documento** della nota, memorizzata nel frontmatter.)
- **Maniglie dei blocchi** — al passaggio del mouse compare una maniglia a sinistra di ogni paragrafo: trascinala per spostare il blocco, clicca per aprire **Azioni sul blocco** (**Trasforma in** Testo/Titolo/Elenco/Da fare/Citazione/Blocco di codice, **Duplica**, **Sposta su**/**Sposta giù**, **Elimina blocco**). Se trascini un elenco accanto a un altro elenco dello stesso tipo, Plainva inserisce una riga separatrice invisibile `<!-- -->` in modo che i due elenchi restino separati — in Markdown, elenchi dello stesso stile si fonderebbero altrimenti nonostante la riga vuota (anche in Obsidian).
- **Tabelle** — renderizzate come widget con celle modificabili con un clic. La visualizzazione della cella rende la formattazione (**grassetto**, *corsivo*, `codice`, evidenziazione), i link cliccabili (`[[Link interno]]`, indirizzi web) e `<br>` come interruzione di riga; durante la modifica vedi il testo grezzo. Il menu della tabella offre l'inserimento/eliminazione di righe e colonne oltre all'allineamento (**Allinea a sinistra**/**Allinea al centro**/**Allinea a destra**).
- **Gli elenchi continuano da soli** (Invio inserisce il prossimo marcatore di elenco), i blocchi di codice ottengono un'evidenziazione sensibile al linguaggio (anche in modalità lettura), il contenuto incollato viene convertito in Markdown (incolla intelligente) e i titoli possono essere ripiegati.
- **Trova e sostituisci** all'interno della nota corrente: `Ctrl+F` (vedi [Ricerca](Search.md)).

## Link e backlink

- **Link interni**: `[[Nome nota]]` (wiki-link) — tramite il menu slash o `@` con ricerca integrata delle note. Funzionano anche i classici link Markdown `[testo](percorso.md)`.
- **Destinazioni non ancora create**: un wiki-link a una nota che non esiste ancora viene mostrato **attenuato e con una sottolineatura tratteggiata** (sia in anteprima dal vivo sia in modalità lettura). Un **clic crea la nota** e la apre — viene collocata nella cartella della nota corrente (oppure nel percorso indicato, se il link ne contiene uno, ad es. `[[Cartella/Nuova nota]]`). Per essere avvisato prima, abilita **Impostazioni → App → Editor e note → Chiedi prima di creare link vuoti**.
- **Backlink**: la sezione **Backlink** nella barra laterale destra mostra quali note collegano quella attiva — raggruppate per file sorgente, con un contatore per le occorrenze multiple.
- **Rinomina con cura dei link**: quando rinomini un file nell'albero dei file, Plainva aggiorna ogni link ad esso in tutto il vault (le ancore come `#Sezione` vengono preservate) e riporta: "N link in M file sono stati aggiornati al nuovo nome."

## Proprietà (frontmatter)

La sezione **Proprietà** nella barra laterale destra mostra il frontmatter della nota come un modulo. **Aggiungi proprietà** ne crea di nuove; ogni proprietà ha un **Tipo di campo**:

| Gruppo | Tipi |
|---|---|
| **Base** | Testo, Numero, Casella di controllo, Data, Data e ora |
| **Scelta** | Selezione, Stato, Selezione multipla |
| **Elenchi e relazioni** | Elenco, Tag, Relazione |
| **Web e contatti** | URL, Email, Telefono |

I tipi a scelta possono avere opzioni fisse con un **Colore** e (per **Stato**) un **Gruppo**/fase — questi elenchi di opzioni sono gestiti nei database (`.base`), vedi [Database (.base)](Databases_Base.md).

Due campi sono protetti: `type` e `okf_version` sono **campi di sistema OKF** gestiti da Plainva — il valore di `type` è selezionabile da un menu a tendina di tipi noti, mentre nome/tipo di campo/eliminazione sono bloccati (approfondimento: [OKF](OKF.md)).

## Icona del documento e colore dell'intestazione

Ogni nota può avere un'icona (in stile Notion sopra il titolo, visibile anche nelle schede e nell'albero dei file) e una striscia di colore a larghezza piena:

- In Anteprima dal vivo, passa il mouse sopra il titolo: **Aggiungi icona** / **Aggiungi colore intestazione** (in seguito: **Cambia icona** / **Cambia colore intestazione**) — oppure usa i comandi slash **Icona del documento** e **Colore dell'intestazione**.
- Il selettore di icone ha due modalità — **Emoji** e **Icone** — che si usano nello stesso modo: una sola zona in alto, una sola ricerca, **categorie** (schede) in entrambe le modalità e una sezione **Usati di recente** che sopravvive a un riavvio.
- Il set comprende circa **400 icone selezionate** in dieci categorie (Sapere e file, Lavoro e attività, Tecnologia, Persone e contatti, Creatività e media, Quotidiano e casa, Natura e meteo, Viaggi e luoghi, Denaro e numeri, Simboli e stati). La ricerca considera nomi e parole chiave.
- In modalità icone scegli un **colore** in alto: la stessa tavolozza della fascia dell'intestazione, **A** per il colore predefinito e **Colore personalizzato …** per un valore libero. Vale per l'icona che toccherai subito dopo.
- Entrambe sono memorizzate nel frontmatter sotto `plainva:` (`icon`, `icon_color`, `header_color`) — pura presentazione che non influisce sugli altri programmi.

## Modelli

Imposta una **Cartella dei modelli** in **Impostazioni → Vault → Contenuto e struttura** (**Scegli cartella…** accanto al campo permette di scegliere la cartella direttamente nel vault). Poi inserisci i modelli con `Ctrl+Alt+T` o il comando slash **Inserisci modello**. I modelli definiscono completamente il contenuto dei nuovi file — incluso il frontmatter: se un modello porta un proprio `type`, vince il modello. Quando inserisci in una nota esistente, il frontmatter del modello viene omesso — viene inserito solo il contenuto.

**Segnaposto**: i modelli compilano segnaposto con nome — nessuno script, nessuna espressione; niente di tutto ciò esegue codice.

| Segnaposto | Cosa inserisce |
| --- | --- |
| `{{title}}` | Il titolo della nota |
| `{{date}}`, `{{time}}` | Data e ora; con un formato personalizzato: `{{date:DD.MM.YYYY}}` |
| `{{date+7}}`, `{{date-1}}` | Una data spostata, combinabile con un formato |
| `{{yesterday}}`, `{{tomorrow}}` | Il giorno prima, il giorno dopo |
| `{{weekday:monday}}`, `{{weekday:next friday}}` | Quel giorno della settimana, di questa settimana o della successiva; un formato segue i secondi due punti: `{{weekday:monday:DD.MM.}}`. Il giorno in cui inizia la settimana dipende dalla tua impostazione del calendario |
| `{{daily}}`, `{{daily+1}}`, `{{daily-1}}` | Un link alla nota giornaliera di oggi, di domani o di ieri |
| `{{folder}}`, `{{vault}}` | La cartella della nota, il nome del vault |
| `{{cursor}}` | Nessun testo — indica dove atterrerà il cursore in seguito |
| `{{prompt:Label}}`, `{{prompt:Label\|Default}}` | Ti chiede del testo (mostrato come *Label*) |
| `{{select:Label\|A,B,C}}` | Ti chiede con un elenco di opzioni |
| `{{date_prompt:Label}}` | Ti chiede una data |
| `{{selection}}` | Il testo selezionato — quando inserisci un modello |
| `{{clipboard}}` | Gli appunti — arrivano come una **domanda precompilata**, mai inosservati nella nota |
| `\{{date}}` | Il segnaposto stesso, non risolto |

Quando un modello chiede qualcosa, Plainva pone **tutte** le domande in un unico dialogo prima che la nota venga scritta — sia che tu inserisca sia che tu crei; annullare non crea nulla. Solo per le note create in background (per esempio nella sincronizzazione delle attività) non viene chiesto nulla: lì le risposte restano vuote. Un segnaposto che Plainva non conosce resta visibile — così un errore di battitura sembra un errore di battitura.

**Sul telefono** funziona lo stesso motore: i segnaposto vengono compilati, le domande di un modello arrivano insieme in un unico foglio (annullare non crea nulla), e le regole cartella → modello e tipo di nota → modello si applicano anche lì — quindi una nota in `Projekte/` inizia allo stesso modo su entrambi i dispositivi. Due differenze: le regole si definiscono sul desktop (il telefono le applica soltanto), e lì `{{weekday:…}}` calcola sempre a partire da lunedì, perché l'impostazione del primo giorno della settimana non esiste ancora su mobile.

**Impostazioni proprie del modello**: un modello può portare impostazioni valide solo per sé — che le sue attività restino fuori dalla vista **Attività**, o a quali database appartiene. Una nota creata da esso non le eredita. Le note giornaliere molto vecchie possono ancora portarle; le [FAQ](FAQ.md) spiegano come trovarle.

**Modelli per cartella**: in **Impostazioni → Vault → Contenuto e struttura → Modelli** associ una cartella a un modello — ogni nuova nota creata lì parte allora da esso, senza che tu debba scegliere nulla. L'associazione copre anche le sottocartelle; quando più corrispondono, vince il percorso più lungo (`Progetti/Clienti` batte `Progetti`). Allo stesso modo associ un modello a un **tipo di nota**; si applica quando nessuna regola di cartella copre la nota — la cartella batte il tipo. **Nuova nota da modello …** (clic destro nell'albero dei file, la palette dei comandi o il selettore rapido) ti permette di sceglierne uno esplicitamente — questo batte ogni associazione. Le associazioni vivono nelle impostazioni, non nelle note, e viaggiano verso i tuoi altri dispositivi tramite la sincronizzazione delle impostazioni.

Creare modelli funziona da qualsiasi punto: la palette dei comandi (`Ctrl+P`) offre **Crea nuovo modello** (si apre un modello nuovo pronto per la modifica) e **Salva la nota corrente come modello** (copia la nota aperta nella cartella dei modelli). I modelli sono normali file Markdown — modificali, rinominali o eliminali direttamente nell'albero dei file.

## Note giornaliere

**Apri nota giornaliera** (barra laterale) o un clic nel **Calendario** crea la nota di oggi usando il tuo formato data nella cartella delle note giornaliere configurata, facoltativamente da un modello.

## Attività, formule, diagrammi e note a piè di pagina

- **Caselle di attività**: `- [ ] attività` viene renderizzata ovunque come casella di controllo — e in **modalità lettura** puoi cliccarla: Plainva riscrive `[x]` o `[ ]` nel file.
- **Formule matematiche (LaTeX)**: `$E = mc^2$` in linea e `$$…$$` come blocco vengono renderizzati come formule sia in modalità lettura sia nell'anteprima dal vivo (KaTeX). Con il cursore all'interno di una formula vedi la sintassi; un clic su una formula renderizzata la apre per la modifica. Solo la modalità sorgente mostra sempre la sintassi grezza. Non devi imparare a memoria il blocco `$$…$$` — il comando slash **Formula (LaTeX)** (`/katex`) lo inserisce e posiziona il cursore al suo interno.
- **Diagrammi Mermaid**: un blocco di codice con il linguaggio `mermaid` (nel modo più rapido tramite il comando slash **Diagramma Mermaid**, `/mermaid`) viene disegnato come diagramma in modalità lettura e nell'anteprima dal vivo — un clic sul diagramma mostra il codice per la modifica:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Note a piè di pagina**: `Testo[^1]` più `[^1]: La nota a piè di pagina.` alla fine — la modalità lettura renderizza il riferimento e l'apparato delle note a piè di pagina con segni di salto. Il modo più rapido è il comando slash **Nota a piè di pagina** (`/footnote`): inserisce il prossimo riferimento libero e salta direttamente alla definizione in fondo alla nota.

## Stampa e salvataggio come PDF

Il menu **⋮** dell'editor e la palette dei comandi (`Ctrl+P`) hanno **Stampa / Salva come PDF…**: la stampa usa sempre la vista di lettura (da dal vivo/sorgente, Plainva passa prima a quella). Nella finestra di dialogo di sistema puoi scegliere "Salva come PDF" invece di una stampante.

## Esportare una nota

- **Esporta come Markdown…** (menu **⋮** dell'editor o palette dei comandi): salva una copia della nota in qualsiasi posizione tramite la finestra di dialogo di sistema — ad esempio per consegnarla a un altro programma. Gli allegati collegati (immagini) non vengono copiati insieme; se la nota ne referenzia, Plainva mostra un breve avviso.
- **PDF**: usa **Stampa / Salva come PDF…** (sopra) e scegli "Salva come PDF" nella finestra di dialogo di sistema.

## Aprire una nota in un altro editor

Le tue note sono normali file `.md`, quindi qualsiasi editor Markdown può aprirle. Il menu **⋮** dell'editor include **Apri nell'app predefinita**, che passa la nota corrente all'app che il tuo sistema usa per i file Markdown (Byword, MacDown, VS Code e così via). Plainva continua a osservare il file, quindi le modifiche che fai lì compaiono automaticamente qui.

## Immagini e allegati

- **Inserimento**: comandi slash **Immagine interna** (cerca e incorpora dal vault) o **Immagine (web)** (tramite URL). Inoltre: puoi semplicemente **incollare** un file dagli appunti (Ctrl+V) — un'immagine così come un PDF o un foglio di calcolo. E puoi **trascinare i file dall'esplora risorse nell'editor**: le immagini vengono incorporate (`![[…]]`), gli altri file vengono copiati e collegati (`[[…]]`). Dove finiscono questi file è un'impostazione: **Impostazioni → Il tuo archivio → Contenuto e struttura → Cartella degli allegati** (predefinita `Attachments`, con esplora cartelle). Lasciala vuota per tenerli accanto alla nota, come faceva Plainva prima di questa impostazione. La cartella viaggia con la sincronizzazione delle impostazioni, così computer e telefono archiviano gli allegati nello stesso posto.
- **Allega file…**: il comando slash **Allega file…** e la stessa voce nel menu **⋮** della nota aprono la finestra di dialogo file del tuo sistema; sul telefono si trova nel foglio **＋** come **File dal dispositivo…**. Il file viene copiato nella cartella degli allegati — le immagini vengono incorporate (`![[…]]`), tutto il resto viene collegato (`[[…]]`).
- **Collegare**: digita `[[` e Plainva propone prima le note e sotto, in **Allegati**, i file del tuo archivio.
- **Visualizzazione**: i file immagine (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) si aprono nel visualizzatore di immagini integrato con **Aumenta zoom**/**Riduci zoom**, **Adatta** e **Dimensione reale (1:1)**.
- **Modifica**: il pulsante **Modifica** apre l'editor di immagini con **Ritaglia**, ruota/capovolgi, **Ridimensiona**, strumenti di disegno (**Penna**, **Freccia**, **Rettangolo**, **Testo**) più **Annulla**/**Ripeti**. Salva sul posto o **Salva come copia…**. I formati modificabili sono PNG, JPG e WebP; gli altri formati si aprono in sola visualizzazione.
- **I file di testo** si aprono dentro Plainva: `.txt`, `.csv`, `.json`, `.yaml`, codice sorgente e simili. Se il tuo vault ne richiede altri, aggiungi le estensioni in **Impostazioni → Il tuo vault → Contenuto e struttura → Altri file di testo**: l'elenco può solo aggiungere, mai togliere. Se l'inizio del file rivela che non è testo, Plainva non lo mostra e propone il programma predefinito: mostrarlo e salvarlo lo danneggerebbe. Un file aperto così conserva i suoi fine riga e il suo BOM al salvataggio — è tuo, non di Plainva.
- Gli altri allegati si aprono con un clic nel programma predefinito del sistema: nell'albero dei file come tramite un `[[collegamento]]`, un segnalibro o la ricerca.

## E Obsidian?

Tutto resta Markdown standard con frontmatter standard. Obsidian apre i file completamente; mostra la chiave `plainva:` raggruppata come un oggetto non modificabile nel suo pannello delle proprietà — questo è voluto e innocuo.

## Vedi anche

- [Database (.base)](Databases_Base.md) — le note come tabella, bacheca o calendario
- [OKF](OKF.md) — cosa significano `type` e `okf_version`
- [Ricerca](Search.md) e [Scorciatoie da tastiera](Keyboard_Shortcuts.md)

## Formattare una selezione

Quando una selezione include più righe, **grassetto**, *corsivo*, barrato, evidenziazione e codice in linea vengono applicati separatamente a ogni riga non vuota. I prefissi di elenco, citazione, titolo e attività restano fuori dai marcatori. I link restano su una riga perché un’etichetta multiriga non è Markdown portabile.

Un titolo ATX e un’attività GFM sono tipi di blocco alternativi. Plainva non scrive combinazioni non valide. La formattazione in linea funziona in entrambi; usa `- [ ] **Attività importante**` per evidenziare il titolo.
