# File Format Reference

Ultimo aggiornamento: 2026-07-17

Questa pagina è il contratto esatto, così come sta su disco, per **ogni file in un vault Plainva**. È scritta in modo che uno strumento — un altro programma, uno script o un assistente IA — possa leggere e modificare in sicurezza i file del vault direttamente, senza passare dall'interfaccia di Plainva. Se usi solo l'app, non ti serve mai questa pagina; le [altre pagine della guida](README.md) coprono l'uso normale.

Tutto qui è puro testo UTF-8. Le note sono Markdown con frontmatter YAML; i database sono YAML. Niente è proprietario, niente è nascosto.

## Regole d'oro (leggi prima queste)

1. **La nota è la fonte di verità. Una `.base` è solo una vista.** I *valori* delle proprietà vivono nel frontmatter delle singole note — mai nella `.base`. Per cambiare un valore, modifica la nota.
2. **Le note restano Obsidian-native.** Nel frontmatter delle note scrivi sempre e solo scalari e liste semplici (stringa, numero, booleano, data ISO, lista YAML). Mai un oggetto annidato o un flag "attivo/selezionato" in una nota.
3. **Una `.base` usa solo le quattro chiavi di primo livello di Obsidian** (`filters`, `formulas`, `properties`, `views`). Aggiungere qualsiasi altra chiave di primo livello fa rifiutare l'intero file a Obsidian. Tutti i dati specifici di Plainva vivono sotto sotto-chiavi annidate `plainva:`.
4. **Conserva ciò che non capisci.** Le chiavi sconosciute devono sopravvivere invariate a un ciclo di lettura/scrittura. Non "ripulire" chiavi che non riconosci.
5. **Scrivi UTF-8 senza BOM, con terminazioni di riga LF.**

## Il vault in breve

Un vault è una cartella ordinaria. I tipi di file che incontrerai:

| File | Cos'è | Modificabile come testo |
|---|---|---|
| `*.md` | Una nota: frontmatter YAML + corpo Markdown | Sì |
| `*.base` | Una vista database sulle note (YAML) | Sì |
| `index.md` | Il sommario gestito di una cartella (nome riservato) | Sì, con cautela — vedi [index.md](#indexmd-sommario-di-una-cartella) |
| `log.md` | Nome riservato, attualmente non usato | Non toccare |
| immagini, PDF, … | Allegati | No (binario) |
| `.plainva/` | Cartella interna di Plainva (backup, stato) | **No — non toccare mai** |

I nomi riservati `index.md` e `log.md` non sono mai note normali; non creare contenuto ordinario sotto quei nomi.

---

## Note (`.md`)

Una nota è un file Markdown. Un blocco opzionale di frontmatter YAML (tra due righe `---`) in cima contiene le sue proprietà; segue il corpo Markdown.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### Campi frontmatter OKF

Plainva segue OKF (Open Knowledge Format), una convenzione minima. Due campi di primo livello:

| Campo | Tipo | Significato |
|---|---|---|
| `type` | stringa | Che tipo di documento è (`Note`, `Daily Note`, `Project`, …). L'unico campo che OKF richiede davvero. |
| `okf_version` | stringa | La versione della convenzione contro cui è stato scritto il file, ad es. `"0.1"`. Mettila tra virgolette perché YAML la mantenga una stringa. |

Un file **senza** `type` si apre comunque senza problemi; è semplicemente "non conforme a OKF". Un `okf_version` mancante da solo non è una violazione. Quando crei una nuova nota, aggiungere `type` (e `okf_version`) è buona pratica. Vedi [OKF](OKF.md) per la motivazione completa.

### Serializzazione dei valori delle proprietà

Ogni chiave del frontmatter è una proprietà. Scrivi il valore nella forma YAML nativa del suo tipo:

| Tipo di proprietà | Forma YAML | Esempio |
|---|---|---|
| Testo | stringa scalare | `title: Hello` |
| Numero | numero | `priority: 3` |
| Casella di controllo | booleano | `done: true` |
| Data | stringa data ISO | `due: 2026-07-20` |
| Data e ora | stringa datetime ISO | `at: 2026-07-20T14:30:00` |
| Elenco | lista YAML di stringhe | `authors: [Ada, Alan]` |
| Tag | lista YAML di stringhe | `tags: [project, active]` |
| Selezione / Stato | stringa scalare singola | `status: Done` |
| Selezione multipla | lista YAML di stringhe | `labels: [urgent, later]` |
| URL / Email / Telefono | stringa scalare | `site: https://example.org` |
| Relazione (singola) | **stringa** wiki-link | `project: "[[Project Alpha]]"` |
| Relazione (multipla) | lista YAML di stringhe wiki-link | `related: ["[[A]]", "[[B]]"]` |

Il valore "attivo" di una proprietà Selezione/Stato è solo quel semplice scalare. La *tavolozza delle opzioni consentite* e i loro colori **non** vivono nella nota — vivono nella `.base` che governa (vedi [Opzioni e colori](#opzioni-e-colori)). Questo mantiene la nota al 100% Obsidian-nativa.

> Metti tra virgolette i valori wiki-link (`"[[X]]"`). Un `[[X]]` senza virgolette è una sequenza flow YAML e non verrà interpretato come intendi.

### Il namespace `plainva:` nelle note

Gli extra specifici di Plainva sono raggruppati sotto un'unica chiave `plainva:` così che altri editor possano ignorarli:

| Chiave | Valore | Significato |
|---|---|---|
| `icon` | grafema emoji, oppure `lucide:<nome-kebab>` | Icona del documento (stile Notion) |
| `icon_color` | colore esadecimale (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tinta per un'icona `lucide:` (le emoji la ignorano) |
| `header_color` | colore esadecimale | Striscia di intestazione a tutta larghezza |
| `tasks` | `false` | Esclude le caselle di controllo di questa nota dalla [vista Attività](Tasks.md) |
| `templateFor` | elenco di wiki-link a file `.base` | Assegna un **modello** ai database elencati (rilevante solo per le note all'interno della cartella dei modelli) |

Tutte queste sono opzionali. Se non ne scrivi nessuna, ometti del tutto la chiave `plainva:`. I valori non validi vengono ignorati in lettura, mai trattati come errore.

`templateFor` è il contratto di campo dell'assegnazione dei modelli (vedi [Database (.base)](Databases_Base.md)): su una nota all'interno della cartella dei modelli elenca i database il cui menu **Voce** mostra il modello per impostazione predefinita. I valori sono wiki-link completi, estensione `.base` inclusa — bare (`"[[Tasks.base]]"` corrisponde al file con quel nome in qualsiasi cartella, quindi sopravvive ai semplici spostamenti di cartella) oppure qualificati con il percorso (`"[[Projekte/Tasks.base]]"` corrisponde esattamente a quel percorso). Plainva scrive link bare e li qualifica solo quando esistono due file `.base` con lo stesso nome. Uno scalare al posto di un elenco è tollerato. Quando una voce viene creata dal modello, `templateFor` — a differenza delle altre chiavi `plainva:` — **non** viene copiato nella nuova nota.

### Link

- **Wiki-link:** `[[Nome nota]]` — risolto per nome della nota in tutto il vault. Con un'ancora a un titolo: `[[Nota#Sezione]]`. Con testo visualizzato: `[[Nota|testo mostrato]]`.
- **Link Markdown:** anche `[testo](percorso/relativo.md)` funziona.
- I **backlink** sono derivati automaticamente, anche dai wiki-link nel frontmatter (è così che le relazioni compaiono come backlink).

---

## Database (`.base`)

Un file `.base` è YAML. Memorizza una *vista* sulle note — quali note (origini), come mostrarle (viste), come filtrarle e ordinarle, e lo schema delle colonne. Non memorizza **nessun valore di nota**. Il formato è compatibile con il plugin Bases di Obsidian.

### Regole ferree — violane una e Obsidian rifiuta l'intero file

- **Solo queste chiavi di primo livello:** `filters`, `formulas`, `properties`, `views`. Non aggiungere mai un'altra chiave di primo livello. (Storicamente una chiave `columns:` di primo livello rompeva ogni file — non reintrodurre questo schema.)
- **Ogni vista richiede un `name` stringa non vuoto.**
- **Un oggetto `filters` porta esattamente uno tra `and` / `or` / `not` a ogni livello** — mai due fianco a fianco.

Plainva stesso ripara i file più vecchi che violano queste ultime due regole al prossimo salvataggio, ma uno strumento che scrive direttamente deve rispettarle fin da subito.

### Identificatori di proprietà: quando usare il prefisso `note.`

Questo confonde spesso, quindi è esplicito:

| Dove | Forma | Esempio |
|---|---|---|
| Chiavi della mappa `properties:` | con prefisso | `note.status`, `file.name` |
| Lista `order:` di una vista | con prefisso | `[file.name, note.status]` |
| `sort[].property` di una vista | con prefisso | `note.due` |
| Dentro le espressioni di **filtro** | **bare** | `status == "Done"` |
| Dentro le sotto-chiavi `plainva` (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **bare** | `groupBy: status` |

Regola pratica: i campi strutturali *rivolti a Obsidian* usano `note.<chiave>` (e `file.<x>` per gli integrati come `file.name`, `file.folder`, `file.mtime`); tutto ciò che è dentro una **formula di filtro** o un **blocco `plainva`** usa la chiave nuda del frontmatter.

### Chiavi di primo livello

- **`filters`** — quali note appartengono a questo database. In Plainva contiene solo le **origini** (cartella/tag); le condizioni di filtro sulle proprietà sono memorizzate per vista sotto `views[i].filters`. Vedi [Filtri](#filtri).
- **`properties`** — lo schema delle colonne, indicizzato per id di proprietà. Le sotto-chiavi native di Obsidian come `displayName` (etichetta dell'intestazione di colonna) sono ammesse e conservate; tutta la ricchezza di Plainva vive sotto `properties[id].plainva`.
- **`views`** — una lista ordinata di viste. Ognuna richiede un `name` e un `type`.
- **`formulas`** — una funzionalità di Obsidian. Plainva non le crea ma le conserva intatte.

### La mappa di sotto-chiavi `plainva:`

Tutto ciò che è specifico di Plainva è in namespace. Tre posizioni:

**`properties[<note.key>].plainva`** — per colonna:

| Chiave | Valore | Significato |
|---|---|---|
| `input` | uno dei tipi di input sotto | Il tipo di campo della colonna |
| `options` | lista di oggetti opzione | Valori curati per selezione/stato/selezione multipla |
| `relationBase` | percorso `.base` vault-relativo | Database di destinazione della relazione (vedi [Relazioni](#relazioni-il-contratto-a-due-vie)) |
| `relationLimit` | `one` | Cardinalità: link singolo. Ometti per illimitato. |
| `reverseOf` | `{ base, property }` | Contrassegna una colonna di **relazione inversa calcolata** (nessun `input`) |

**`views[i].plainva`** — per vista:

| Chiave | Valore | Significato |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` / `graph` / `pinboard` | Tipo di vista esclusivo di Plainva (vedi sotto) |
| `groupBy` | chiave di proprietà bare | Colonna di raggruppamento della bacheca |
| `dateField` | chiave di proprietà bare | Data di inizio per calendario/cronologia |
| `endField` | chiave di proprietà bare | Data di fine della cronologia |
| `coverImage` | chiave di proprietà bare | Proprietà immagine di copertina della galleria |
| `subItemsProperty` | chiave di proprietà bare | Colonna genitore per auto-relazione, per l'annidamento dei sottoelementi |
| `widths` | mappa id → px | Larghezze delle colonne |
| `dateFormat` | stringa | Formato data per vista (`default` è implicito — omettilo) |
| `pinboardOrder` | elenco di percorsi vault-relativi | Ordine manuale delle schede della bacheca NON fissate |
| `pinboardPinned` | elenco di percorsi vault-relativi | Schede fissate; l'ordine dell'elenco è l'ordine della sezione |
| `pinboardFilterBy` | `tags` oppure una chiave di selezione multipla bare | Origine delle etichette della barra dei chip della bacheca (`tags` è implicito — omettilo) |

Oltre al blocco `plainva`, una vista può portare un oggetto nativo **`views[i].filters`** — i **filtri delle proprietà per vista** (la stessa struttura a radice singola `and`/`or`/`not` del `filters` a livello di file). Plainva memorizza qui le regole di filtro delle proprietà, un insieme per vista, così che ogni vista filtri in modo indipendente; il `filters` a livello di file mantiene poi solo le origini. Obsidian applica `views[i].filters` per vista in modo nativo.

**`views[0].plainva`** — chiavi valide per l'intero file, ammesse **solo sulla prima vista**:

| Chiave | Valore | Significato |
|---|---|---|
| `fileIconColor` | colore esadecimale | Tinta dell'icona del database (albero/schede/intestazione) |
| `newItemFolder` | cartella vault-relativa | Dove il pulsante "Nuovo" archivia i nuovi elementi |
| `newItemTemplate` | percorso `.md` vault-relativo | Modello predefinito per i nuovi elementi |
| `contextFilters` | elenco di chiavi di proprietà semplici | Filtri di auto-riferimento ("Questa nota") — vedi sotto |

`contextFilters` è l'equivalente in Plainva del filtro "questa pagina" di Notion. Ogni voce è una chiave di proprietà; quando il database è incorporato in una nota, le sue righe vengono ristrette a quella nota ospitante tramite quella proprietà (risolta tramite l'indice dei link — una proprietà proprietaria o di link semplice corrisponde alle righe che puntano alla nota ospitante, una colonna inversa calcolata corrisponde a ciò a cui essa punta). Non viene scritto volutamente nel `filters` nativo, quindi Obsidian lo ignora e mostra tutte le righe; aperto in modo autonomo in Plainva viene anch'esso scartato (nessuna nota ospitante) e mostra tutte le righe. Più voci si combinano con un AND.

### Tipi di input

`plainva.input` è uno tra:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Una colonna **inversa** calcolata non ha **nessun** `input` — è identificata unicamente da `reverseOf`.

### Opzioni e colori

Le colonne Selezione/Stato/Selezione multipla possono portare un elenco di opzioni curato. Ogni opzione:

```yaml
options:
  - value: Open          # obbligatorio
    color: amber         # nome di tavolozza opzionale (vedi sotto)
    group: Active        # opzionale; solo STATO — ordina le opzioni in fasi
  - value: Done
    color: green
    group: Closed
```

`color` è un **nome di tavolozza**, non un colore CSS. Nomi validi: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Un colore sconosciuto ripiega su un colore derivato dal valore.

### Tipi di vista

`views[i].type` su disco è un tipo nativo di Obsidian. Le rese esclusive di Plainva sono scritte come `type: table` più un suggerimento `plainva.render`, così Obsidian le degrada a una semplice tabella:

| Vuoi | `type` su disco | `plainva.render` |
|---|---|---|
| Tabella | `table` | — |
| Elenco | `list` | — |
| Galleria | `cards` | — |
| Bacheca | `table` | `board` |
| Calendario | `table` | `calendar` |
| Cronologia | `table` | `timeline` |

### Filtri

`filters` seleziona quali note sono nel database e le restringe.

Le **condizioni di origine** decidono l'appartenenza:

- Cartella: `file.folder == "Path/To/Folder"` (vault-relativo; la cartella radice è `""`).
- Tag: `file.hasTag("project")` (senza `#` iniziale).

Più origini sono semplicemente più voci. Nessun `filters` affatto = ogni nota nel vault.

**Dove vivono le condizioni di proprietà:** a livello di file, `filters` si applica a ogni vista. Plainva invece memorizza le regole di filtro delle proprietà **per vista** in `views[i].filters` (stessa struttura a radice singola) e mantiene solo le origini a livello di file, così che ogni vista possa filtrare in modo indipendente. Entrambe le forme sono valide per Obsidian; uno strumento può scrivere l'una o l'altra. Un file più vecchio con condizioni di proprietà a livello di file continua comunque a funzionare — Plainva le distribuisce in ogni vista al prossimo salvataggio.

Le **condizioni di proprietà** usano nomi di proprietà bare e questi operatori:

| Operatore | Espressione |
|---|---|
| uguale a | `status == "Done"` |
| diverso da | `status != "Done"` |
| contiene | `contains(labels, "urgent")` |
| non contiene | `!contains(labels, "urgent")` |
| maggiore / minore | `priority > "2"`, `priority < "5"` |
| almeno / al massimo | `priority >= "2"`, `priority <= "5"` |
| è vuoto | `status == ""` |
| non è vuoto | `status != ""` |

**Struttura (a radice singola!):** uno tra `and` / `or` / `not`, le cui voci sono stringhe di condizione — oppure un livello di oggetti gruppo annidati `{and:[...]}` / `{or:[...]}` (gruppi in stile Notion). Esempio che combina un'origine, una condizione e un gruppo OR:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Una `.base` completa e commentata

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # origine: note nella cartella Projects
properties:
  note.status:                             # l'id di colonna è prefigurato con note.
    displayName: Status                    # etichetta di colonna Obsidian opzionale
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # prima vista: porta anche le chiavi dell'intero file
    name: All projects                     # ogni vista richiede un nome
    order: [file.name, note.status]        # order usa id prefigurati con note.
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # una bacheca è una tabella nativa + suggerimento di rendering
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy usa la chiave BARE
```

---

## Relazioni (il contratto a due vie)

Una relazione collega le note tra loro. È la cosa più soggetta a errori da scrivere a mano, perché si estende su **tre** luoghi. Rendili tutti e tre coerenti.

1. **Il valore vive nel frontmatter della nota di origine**, come wiki-link (o una lista di essi):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **La `.base` di origine dichiara la colonna di relazione** (`relationBase` = il database di destinazione; `relationLimit: one` per un link singolo):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **La `.base` di destinazione può mostrare l'inverso** con una colonna **calcolata**. I suoi valori **non** sono memorizzati da nessuna parte — sono derivati dai link delle note di origine:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # la .base di origine (percorso vault-relativo)
           property: project      # la chiave BARE della proprietà di origine
   ```

### Esempio pratico: Tasks ↔ Projects

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Risultato: in `Projects.base`, la colonna calcolata `tasks` di **Project Alpha** elenca "Write proposal", perché il `project` di quel task rimanda a esso. Nota che `Project Alpha.md` non ha **nessuna** chiave `tasks:` — il lato inverso è calcolato, mai memorizzato.

### I NON di una relazione

- **Non scrivere valori inversi nelle note.** Una colonna `reverseOf` è calcolata. Scrivere una chiave `tasks:` in `Project Alpha.md` è sbagliato e non sopravvive a un roundtrip.
- **Fai in modo che le destinazioni dei link si risolvano.** `"[[Project Alpha]]"` deve corrispondere a una nota esistente, altrimenti il link appare interrotto.
- **Mantieni i percorsi vault-relativi** con barre in avanti e senza `./` iniziale (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` è la chiave bare di origine** (`project`), non `note.project`.

### Auto-relazioni e sottoelementi

Per una relazione la cui destinazione è lo stesso database, punta `relationBase` a quella stessa `.base`. Per annidare i figli sotto i genitori in una vista tabella, imposta `views[i].plainva.subItemsProperty` sulla chiave bare della relazione genitore. I cicli sono gestiti; con i sottoelementi disattivati, le righe restano piatte e i valori vengono conservati.

---

## `index.md` (sommario di una cartella)

`index.md` è un nome riservato per il sommario di una cartella.

- **Solo la `index.md` radice può portare frontmatter**, e solo `okf_version` (contrassegna il vault come OKF-attivo). Una `index.md` non radice deve essere **priva di frontmatter** — il frontmatter lì è una violazione del nome riservato.
- Una `index.md` **gestita** da Plainva termina con il marcatore `<!-- plainva:index generated -->` (un commento HTML, invisibile in modalità lettura). La sua presenza significa che Plainva mantiene il file aggiornato automaticamente. Se modifichi a mano un file simile, conserva il marcatore (e mantieni la forma generata) oppure rimuovilo deliberatamente per assumere il file in modo permanente.
- Gli elenchi generati sono sezioni di link nella forma `* [Titolo](url/relativo) - descrizione`.

Se generi a mano una panoramica di cartella, la scelta sicura è **non** aggiungere il marcatore — così Plainva non la sovrascriverà mai.

---

### Viste grafo (`plainva.render: "graph"`)

Una vista grafo è memorizzata come ogni altra vista non nativa: `type: table` più il suggerimento di rendering. Le sue opzioni vivono nello STESSO namespace `views[i].plainva`:

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # chiavi di proprietà di relazione disegnate come archi
      graphColorBy: status         # proprietà selezione/stato -> colore del nodo
      graphSizeBy: prio            # proprietà numero -> dimensione del nodo
      graphShowExternal: true      # includi le destinazioni di relazione fuori dalla vista
      graphShowIncoming: true      # relazioni da ALTRI database che puntano qui (ad es. le attività di un progetto)
```

Tutte le chiavi di opzione del grafo sono opzionali; omettile del tutto quando non impostate. Obsidian rende lo stesso file come una semplice tabella e non deve generare errori.

Una vista **Bacheca** (`plainva.render: "board"`) può inoltre portare `views[i].plainva.boardColumnOrder` — un elenco di chiavi delle colonne di gruppo (`__UNGROUPED__` contrassegna la colonna senza valore) che memorizza un ordine manuale delle colonne. Le bacheche Selezione/Stato riordinano invece le `options` della proprietà. Ometti la chiave quando non impostata.

### La vista bacheca appunti (`plainva.render: "pinboard"`)

Una bacheca viene memorizzata come ogni altra vista non nativa: `type: table` più il suggerimento di rendering. Le sue chiavi vivono nello stesso namespace `views[i].plainva`:

```yaml
views:
  - type: table
    name: Pinboard
    plainva:
      render: pinboard
      pinboardOrder:                  # ordine manuale delle schede non fissate
        - "Notes/Groceries.md"
      pinboardPinned:                 # fissate; l'ordine dell'elenco = ordine della sezione
        - "Notes/Idea.md"
      pinboardFilterBy: note.labels   # origine delle etichette della barra dei chip; ometti = tags
```

Regole: i percorsi fissati non vengono ripetuti in `pinboardOrder`. Le schede che non compaiono in nessuno dei due elenchi vengono renderizzate in cima, dalla più recente (data di creazione). Le voci il cui file non esiste più o è uscito dall'insieme di origine vengono ignorate e ripulite al salvataggio successivo. Quando una nota viene rinominata o spostata, Plainva riassegna automaticamente i percorsi in entrambi gli elenchi; gli strumenti esterni devono fare lo stesso. Obsidian ignora le chiavi e mostra la vista come una tabella.

## Da non toccare e sicurezza

- **`.plainva/`** contiene backup e stato interno. Non leggerne mai la logica del programma né scriverci dentro.
- **Le chiavi sconosciute sono sacre.** Quando riscrivi una `.base` o una nota, porta con te ogni chiave che non intendevi cambiare. Plainva stesso conserva le chiavi `.base` sconosciute tramite una copia grezza interna; uno scrittore terzo dovrebbe fare lo stesso (analizza → cambia solo ciò che intendi → serializza).
- **I valori cambiano nella nota, non nella `.base`.** Per impostare una cella, modifica il frontmatter della nota. La `.base` decide solo quali note e colonne vengono mostrate.
- **Non aggiungere chiavi `.base` di primo livello** oltre a `filters` / `formulas` / `properties` / `views`.
- **Codifica:** UTF-8 senza BOM, terminazioni di riga LF, ovunque.

## Vedi anche

- [Note e Markdown](Notes_and_Markdown.md) — lo stesso materiale dal punto di vista della scrittura a mano nell'app
- [Database (.base)](Databases_Base.md) — i database spiegati per l'uso quotidiano
- [OKF](OKF.md) — `type`, `okf_version`, index.md e la conversione del vault
