# Riferimento dei database (.base)

Ultimo aggiornamento: 2026-11-03

Questa pagina elenca tutto ciò che un file `.base` può contenere e cosa fa Plainva con ciascuna parte: ogni chiave di primo livello, ogni forma di filtro, ogni tipo di vista con le sue opzioni, i riepiloghi, l'ordinamento, i limiti, cosa succede alle chiavi che Plainva non conosce e dove Plainva si comporta in modo diverso da Obsidian Bases. Descrive ciò che il codice di Plainva legge, valuta e scrive oggi — non la documentazione di Obsidian.

Per l'uso quotidiano leggi prima [Database (.base)](Databases_Base.md). Le regole che uno strumento deve rispettare quando scrive direttamente i file del vault e l'esempio completo di relazione sono nella [File Format Reference](File_Format_Reference.md).

## In sintesi

| Parte del file | Cosa fa Plainva |
|---|---|
| `filters` | Legge e applica le origini (cartella, tag) e le condizioni elencate in [Filtri](#filtri) |
| `views` | Legge tutti gli otto tipi di vista, il loro ordine, l'ordinamento, i filtri e i riepiloghi |
| `properties` | Legge lo schema delle colonne, il nome visualizzato e il blocco `plainva` di Plainva |
| `summaries` (vista) | Calcola i quattordici riepiloghi integrati |
| `formulas` | Le conserva nel file, non le calcola |
| `summaries` (primo livello) | Conserva le formule di riepilogo personalizzate, non le calcola |
| `this` | Non ancora supportato |
| Altre chiavi | Le conserva nel file (vedi [Chiavi che Plainva non conosce](#chiavi-che-plainva-non-conosce)) |

## Chiavi di primo livello

Un file `.base` è YAML con queste chiavi di primo livello. Tutte sono facoltative; un file senza `views` si apre con una tabella.

| Chiave | Contenuto | In Plainva |
|---|---|---|
| `filters` | Quali note appartengono al database (origini) | Letta e applicata |
| `properties` | Una voce per colonna, con l'ID della proprietà come chiave | Letta; le aggiunte di Plainva stanno nel suo blocco `plainva` |
| `views` | L'elenco delle viste | Letta; ogni vista richiede un `name` |
| `formulas` | Formule di Obsidian, `name: expression` | Conservata invariata, non calcolata |
| `summaries` | Formule di riepilogo personalizzate di Obsidian | Conservata invariata, non calcolata |

Plainva non scrive mai un'altra chiave di primo livello: Obsidian rifiuta di aprire un `.base` con una chiave che non conosce. Una chiave `columns:` di primo livello, scritta dalle versioni di Plainva molto vecchie, viene ancora letta e spostata in `properties` al successivo salvataggio del file.

## Proprietà (`properties`)

### ID delle proprietà

Un ID di proprietà dà il nome a una colonna. Esistono tre tipi:

| ID | Significa | Esempio |
|---|---|---|
| `note.<key>` | Una chiave del frontmatter delle note | `note.status` |
| `file.<field>` | Un'informazione sul file (vedi [Campi del file](#campi-del-file-file)) | `file.mtime` |
| `formula.<name>` | Una formula di Obsidian da `formulas` | `formula.price_per_unit` |

Le chiavi di `properties`, l'`order` di una vista e `sort[].property` usano questi ID. All'interno di un'espressione di filtro e di un blocco `plainva` una chiave del frontmatter si scrive nuda (`status`); un'espressione di filtro capisce anche `note.status`.

Quando una nota scrive una chiave con maiuscole e minuscole diverse da quelle della colonna (`Due` contro la colonna `due`), Plainva mostra comunque il valore in quella colonna e scrive le modifiche con la grafia della nota stessa.

### Nome visualizzato

`properties.<id>.displayName` è l'etichetta di colonna di Obsidian. Plainva la mostra come intestazione della colonna e la conserva. Senza di essa una chiave del frontmatter viene mostrata con l'iniziale maiuscola (solo a schermo); i campi del file hanno nomi propri, per esempio **Nome**, **Modificato**, **Dimensione**, **Percorso**, **Elenco cose da fare** e **Giorno dal nome del file**.

### Il blocco `plainva` di una colonna

Tutto ciò che Plainva aggiunge a una colonna sta sotto `properties.<id>.plainva`. Obsidian lo ignora.

| Chiave | Valore | Significato |
|---|---|---|
| `input` | un tipo di campo (elenco sotto) | Il tipo di campo della colonna |
| `ratingMax` | numero, da 1 a 10 | Quanti segni ha una valutazione (predefinito 5) |
| `ratingGlyph` | un carattere | Il segno che disegna una valutazione (predefinito un punto) |
| `options` | elenco di opzioni | Valori fissi per selezione, stato e selezione multipla |
| `relationBase` | percorso `.base` relativo al vault | Il database verso cui punta una relazione |
| `relationLimit` | `one` | Una relazione contiene esattamente un link; se assente, nessun limite |
| `reverseOf` | `{ base, property }` | Una colonna di relazione inversa calcolata |
| `rollup` | `{ through, of, fn, where }` | Una colonna di aggregazione calcolata (vedi [Aggregazioni](#aggregazioni)) |
| `previousKeys` | elenco di al massimo 8 nomi precedenti | Permette ai commenti di ritrovare una colonna rinominata |

### Tipi di campo (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Vengono lette anche due grafie più vecchie: `multi-select` come `multiselect` e `link` come `relation`. Una colonna senza `input` — o con un valore che non è in questo elenco — prende il suo tipo dai valori nelle note: `true`/`false` è una casella di controllo, un numero è un numero, un elenco di `[[links]]` è una relazione, `2026-07-03` è una data, un indirizzo web è un URL, e così via. Una colonna di relazione inversa e una colonna di aggregazione non hanno `input`.

### Opzioni e colori

Un'opzione è `{ value, label, color, group }`; solo `value` è obbligatorio. `color` è uno dei nomi della tavolozza `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — un nome sconosciuto ripiega su un colore ricavato dal valore. `group` è usato solo da **Stato**: le opzioni con lo stesso gruppo formano una fase. Una semplice stringa viene letta come un'opzione con quel valore.

### Aggregazioni

Una colonna di aggregazione calcola un valore dalle note a cui punta una colonna di collegamento di questo database. Il valore non è memorizzato in nessun file.

- `through` — una colonna di relazione o di relazione inversa di questo database.
- `of` — una proprietà delle note collegate; non serve per `count`.
- `fn` — una tra `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, richiesto da `countWhere` e `percentWhere`; `op` è uno tra `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, e un `value` vuoto significa «è vuoto».

Un'aggregazione a cui manca una parte obbligatoria, o che nomina una funzione non presente in questo elenco, viene ignorata: la colonna resta vuota e il database si apre comunque. Anche un'aggregazione attraverso un'altra colonna calcolata resta vuota.

## Campi del file (`file.*`)

Questi valori provengono dal file, non dal suo frontmatter. Ogni riga di un database porta con sé i seguenti:

| Campo | Valore |
|---|---|
| `file.name` | La proprietà `title` della nota, se ne ha una, altrimenti il nome del file senza `.md` |
| `file.path` | Il percorso relativo al vault |
| `file.mtime` | Ultima modifica, in millisecondi |
| `file.ctime` | Creazione, in millisecondi, dove il file system la fornisce |
| `file.size` | Dimensione in byte |
| `file.tags` | Tutti i tag della nota, nel frontmatter e nel testo, ciascuno con `#`; valorizzato quando un filtro, una bacheca appunti o una vista che mostra la colonna o ordina in base a essa ne ha bisogno |
| `file.tasks` | Avanzamento delle caselle di controllo come `done/total`; valorizzato per le bacheche e per una vista che mostra la colonna |
| `file.day` | Il giorno a cui corrisponde il nome del file di una nota giornaliera, secondo la cartella e il formato del vault; sola lettura, e solo il campo data di un calendario o di una cronologia può usarlo |
| `file.revision` | Un marcatore interno di modifica; non farci affidamento |

`file.folder` funziona come origine (vedi [Origini](#origini)) ma non è una colonna. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` e `file.file` non sono forniti: una colonna con uno di essi resta vuota, e un filtro li legge come vuoti.

## Filtri

### Dove stanno i filtri

Il `filters` di primo livello contiene le **origini** — quali note appartengono al database. Ogni vista può avere i propri `filters` con condizioni che restringono solo quella vista; Plainva scrive le condizioni lì. I due livelli si applicano insieme. Le condizioni che un file tiene al primo livello funzionano ancora; il successivo salvataggio in Plainva le sposta in ciascuna vista.

### Origini

| Origine | Espressione |
|---|---|
| Cartella | `file.folder == "Projects/Active"` — la cartella e tutte le sue sottocartelle; `""` e `"/"` sono l'intero vault |
| Tag | `file.hasTag("project")` — la nota porta esattamente questo tag; un `#` iniziale viene ignorato |

Più origini si combinano con `and` oppure `or` come qualsiasi altra condizione. Un database senza origini contiene tutte le note del vault. Gli allegati, i file riservati `index.md` e `log.md` e i file o le cartelle il cui nome inizia con un punto non sono mai righe.

### Condizioni

Una condizione è una stringa. I valori stanno tra virgolette doppie; `\"` e `\\` rappresentano una virgoletta e una barra rovesciata. La proprietà si scrive nuda o con `note.`.

| Condizione | Espressione |
|---|---|
| è | `status == "Done"` |
| non è | `status != "Done"` |
| contiene | `contains(labels, "urgent")` oppure `labels.contains("urgent")` |
| non contiene | `!contains(labels, "urgent")` oppure `!labels.contains("urgent")` |
| maggiore di, minore di | `effort > "3"`, `effort < "8"` |
| almeno, al massimo | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| è vuoto | `status == ""` oppure `status.isEmpty()` |
| non è vuoto | `status != ""` oppure `!status.isEmpty()` |
| ha un tag | `file.tags.contains("#work")`, negato con `!` |
| colore dell'intestazione, icona | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Come si confrontano i valori

- **è** e **non è** confrontano il testo. Su un elenco (tag, selezione multipla, relazione) **è** significa «l'elenco contiene questa voce», **non è** «non la contiene». Una nota senza la proprietà non corrisponde mai a **è** e corrisponde sempre a **non è**.
- **contiene** cerca il testo dentro il valore, o dentro ciascuna voce di un elenco. `labels.contains("x")` su un elenco richiede una voce che sia esattamente `x`; su `file.tags` entrambe le forme richiedono il tag intero, quindi `#work` non corrisponde a `#workshop` né a `#work/child`.
- **maggiore di**, **minore di**, **almeno**, **al massimo** confrontano come numeri quando entrambi i lati sono numeri, altrimenti come testo — il che mette le date ISO (`2026-07-03`) nell'ordine giusto. Una nota senza valore non corrisponde mai a queste condizioni.
- **è vuoto** corrisponde a una proprietà mancante, a un valore vuoto e a un elenco vuoto.
- Una casella di controllo si confronta come `"true"` o `"false"`.

### `and`, `or`, `not`

Un oggetto `filters` ha esattamente uno tra `and`, `or` e `not` a ogni livello; le sue voci sono stringhe di condizione o altri oggetti filtro.

| Chiave | Corrisponde quando |
|---|---|
| `and` | ogni voce corrisponde |
| `or` | almeno una voce corrisponde |
| `not` | nessuna voce corrisponde |

Plainva valuta qualsiasi profondità. Il pannello dei filtri modifica un livello di gruppi sotto **Tutte** o **Almeno una** (**Aggiungi gruppo**); una struttura più profonda appare come **Filtro complesso (non modificabile)**, resta nel file e viene applicata — una condizione al suo interno che Plainva non sa leggere viene indicata sotto di essa come non applicata. Un file più vecchio con `and` e `or` affiancati sullo stesso livello viene letto come «tutte quelle di `and` e almeno una di `or`» e scritto nella forma valida al successivo salvataggio.

### Cosa Plainva non sa leggere

Sono comprese solo le forme nelle due tabelle qui sopra. Tutto il resto — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, un numero senza virgolette (`price > 2`), `&&` e `||` dentro una stessa stringa, l'aritmetica, le funzioni di data come `now()`, oppure `this` — resta nel file e viene mostrato nel pannello dei filtri così com'è, con la nota **Non applicata: Plainva non riesce a leggere questa condizione, quindi non filtra nulla.** La vista mostra allora più note dello stesso filtro in Obsidian.

## Formule

Plainva non calcola le formule di Obsidian. `formulas` resta nel file invariato, e una colonna `formula.<name>` nell'`order` di una vista viene mostrata senza valori. **Esporta tabella** → **Formule (.base)** scrive alcune aggregazioni come formule, così che Obsidian possa calcolarle (vedi [Database](Databases_Base.md)).

## Viste

### Chiavi di ogni vista

| Chiave | Valore | In Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | Il tipo di vista; vedi la tabella successiva |
| `name` | testo | Obbligatorio; Plainva dà un nome a una vista che ne è priva quando salva |
| `order` | elenco di ID di proprietà | Le colonne visibili, in questo ordine |
| `sort` | elenco di `{ property, direction }` | Regole di ordinamento, `ASC` o `DESC` |
| `filters` | oggetto filtro | Le condizioni proprie della vista |
| `summaries` | mappa ID di proprietà → nome del riepilogo | Il piè di pagina di ogni colonna |
| `plainva` | mappa | Le opzioni di vista di Plainva, qui sotto |

### Gli otto tipi di vista

Obsidian conosce `table`, `list` e `cards`. Gli altri tipi di vista di Plainva sono memorizzati come `type: table` più `plainva.render`, così Obsidian li mostra come tabella.

| Tipo di vista | `type` su disco | `plainva.render` |
|---|---|---|
| **Tabella** (`table`) | `table` | — |
| **Elenco** (`list`) | `list` | — |
| **Galleria** (`gallery`) | `cards` | — |
| **Bacheca** (`board`) | `table` | `board` |
| **Calendario** (`calendar`) | `table` | `calendar` |
| **Cronologia** (`timeline`) | `table` | `timeline` |
| **Grafo** (`graph`) | `table` | `graph` |
| **Bacheca appunti** (`pinboard`) | `table` | `pinboard` |

Bacheca, Calendario, Cronologia, Grafo e Bacheca appunti sono offerti come **Tipo di vista** solo finché **Consenti le estensioni Plainva per i file .base** è attivo. Un `type` che Plainva non conosce viene mostrato come tabella e resta nel file così com'è finché non scegli un altro **Tipo di vista**.

### Opzioni della vista (`views[i].plainva`)

All'interno del blocco `plainva` una proprietà si scrive nuda (`status`), non come `note.status`.

| Chiave | Tipi di vista | Valore |
|---|---|---|
| `render` | Bacheca, Calendario, Cronologia, Grafo, Bacheca appunti | Il tipo di vista, vedi sopra |
| `groupBy` | Bacheca | La proprietà di cui sono fatte le colonne; in sua assenza, la proprietà del `groupBy` proprio di Obsidian della vista |
| `boardLaneBy` | Bacheca | Una seconda proprietà per **Corsie per** |
| `boardWipLimits` | Bacheca | Mappa valore della colonna → numero massimo di schede (**Limite WIP**), numeri interi maggiori di 0 |
| `boardColorMode` | Bacheca | `column` tinge l'intera colonna; se assente = solo il chip dell'intestazione |
| `boardColumnOrder` | Bacheca | Ordine manuale delle colonne; `__UNGROUPED__` è la colonna senza valore |
| `colorBy` | Bacheca, Cronologia | Schede e barre prendono il colore dell'opzione di questa proprietà (**Colore per**) |
| `dateField` | Calendario, Cronologia | La data di inizio (**Campo data**, **Data di inizio**); una proprietà data o `file.day` |
| `endField` | Calendario, Cronologia | La **Data di fine** |
| `coverImage` | Galleria | La proprietà che contiene l'**Immagine di copertina** |
| `subItemsProperty` | Tabella | La relazione genitore per i **Sottoelementi** |
| `widths` | Tabella | Mappa colonna → larghezza in pixel |
| `dateFormat` | tutti | `long`, `iso` o `relative`; se assente = la forma breve predefinita |
| `graphEdges` | Grafo | Proprietà di relazione disegnate come archi |
| `graphColorBy` | Grafo | Una proprietà di selezione o di stato che colora i nodi |
| `graphSizeBy` | Grafo | Una proprietà numerica che dimensiona i nodi |
| `graphShowExternal` | Grafo | `true` mostra anche i bersagli dei link fuori dalla vista |
| `graphShowIncoming` | Grafo | `true` mostra anche i link in arrivo da altri database |
| `pinboardOrder` | Bacheca appunti | Percorsi delle schede non fissate, in ordine manuale |
| `pinboardPinned` | Bacheca appunti | Percorsi delle schede fissate, in ordine |
| `pinboardFilterBy` | Bacheca appunti | **Origine delle etichette**: una proprietà di selezione multipla; se assente = i tag |

### Opzioni dell'intero file (solo prima vista)

Queste chiavi appartengono all'intero database. Plainva le scrive solo nel blocco `plainva` della prima vista e legge il primo valore valido di ciascuna.

| Chiave | Valore |
|---|---|
| `fileIconColor` | Colore esadecimale dell'icona del database (**Colore dell'icona del database**) |
| `newItemFolder` | Cartella in cui **Voce** memorizza le nuove voci |
| `newItemTemplate` | Modello per le nuove voci |
| `contextFilters` | Proprietà che limitano un database incorporato alla nota in cui è incorporato (**Questa nota**) |
| `taskList` | Account ed elenco (`"<account id> <list id>"`) in cui viene creata anche una nuova attività |

## Riepiloghi

`views[i].summaries` associa una colonna a uno di questi nomi; il piè di pagina lo calcola sulle righe che la vista mostra.

| Nome | In Plainva | Risultato |
|---|---|---|
| `Average` | **Media** | Media dei numeri |
| `Min` | **Min** | Il numero più piccolo |
| `Max` | **Max** | Il numero più grande |
| `Sum` | **Somma** | Totale dei numeri |
| `Range` | **Intervallo** | Il numero più grande meno il più piccolo; per le date l'intervallo in giorni |
| `Median` | **Mediana** | Valore centrale dei numeri |
| `Stddev` | **Dev. standard** | Deviazione standard di tutti i numeri (popolazione) |
| `Earliest` | **Più remota** | La data più remota |
| `Latest` | **Più recente** | La data più recente |
| `Checked` | **Spuntate** | Righe il cui valore è `true` o `yes` |
| `Unchecked` | **Non spuntate** | Tutte le altre righe |
| `Empty` | **Senza valore** | Righe senza valore |
| `Filled` | **Con valore** | Righe con un valore |
| `Unique` | **Distinti** | Numero di valori diversi; le voci di un elenco contano una per una |

I numeri sono arrotondati a due decimali, e viene letta anche la virgola decimale. Una colonna senza alcun valore utilizzabile non mostra alcun piè di pagina invece di 0. Qualsiasi altro nome è una formula personalizzata del `summaries` di primo livello: Plainva la conserva e mostra **Personalizzato: …** nel menu, ma non calcola alcun valore.

## Ordinamento e raggruppamento

- **Ordina** — `sort` è un elenco di regole; decide prima la prima regola, la successiva solo tra righe uguali. I numeri si ordinano come numeri, tutto il resto come testo (le date ISO nell'ordine giusto). Le righe senza valore vengono per ultime in entrambe le direzioni. Senza una regola, vengono per prime le note modificate più di recente. Plainva legge anche `field` al posto di `property`, e `asc`/`desc` in qualsiasi grafia di maiuscole e minuscole.
- **Raggruppamento** — la bacheca raggruppa per `plainva.groupBy`, con corsie per `plainva.boardLaneBy`. Una vista che porta invece il `groupBy` proprio di Obsidian raggruppa la sua bacheca per quella proprietà, e una modifica del raggruppamento viene scritta in esso (il suo `direction` resta). Plainva non raggruppa una tabella con esso.

## Incorporare un database e `this`

`![[Projects.base]]` in una nota mostra il database dentro la nota, nella vista di lettura e nell'editor. Una parte dopo `#` (il nome di una vista, come in `![[Projects.base#Board]]`) viene ignorata: l'incorporamento mostra la vista usata per ultima per questo database. Un blocco di codice ` ```base ` in una nota viene mostrato come codice, non come database.

**`this` non è ancora supportato.** Un filtro o una formula che usa `this` resta nel file, ma Plainva non lo valuta. Due cose coprono il caso più comune, «mostra le voci che appartengono a questa nota»: `contextFilters` (**Questa nota** nel pannello dei filtri) limita un database incorporato alla nota in cui è incorporato tramite una proprietà di relazione, e un database incorporato che è in relazione con il database della nota che lo ospita offre da sé **Filtra questo database sulla nota corrente**. Entrambe agiscono solo dentro Plainva; Obsidian mostra tutte le righe.

## Limiti

- Il `limit` di Obsidian per una vista viene conservato ma non applicato: una vista mostra tutte le sue righe.
- Il pannello dei filtri modifica un livello di gruppi di filtri; quelli più profondi vengono applicati ma lì si possono solo eliminare.
- Un valore di filtro deve stare tra virgolette doppie (vedi [Cosa Plainva non sa leggere](#cosa-plainva-non-sa-leggere)).
- Un'origine a cartella include sempre le sottocartelle.
- `ratingMax` viene disegnato tra 1 e 10, `previousKeys` conserva al massimo 8 nomi, un **Limite WIP** accetta solo numeri interi maggiori di 0, e `relationLimit` conosce solo `one`.
- Un'aggregazione non può calcolare su un'altra colonna calcolata.

## Chiavi che Plainva non conosce

Plainva legge un `.base`, cambia solo ciò che hai cambiato nell'app e riscrive l'intero file da capo — come YAML con terminatori di riga LF e senza BOM, quindi i commenti e la spaziatura di un file scritto a mano non vengono conservati. Di ciò che non conosce:

- **Conservato:** qualsiasi altra chiave di primo livello, `formulas`, il `summaries` di primo livello, `displayName` e ogni altra chiave di una voce di `properties`, le chiavi sconosciute nel blocco `plainva` di una colonna o di una vista, un'aggregazione che Plainva non sa leggere, le chiavi di una vista che Plainva non usa (`limit`, `image`, …), un tipo di vista che non conosce e le condizioni di filtro che non sa leggere. Un valore che Plainva capisce ma che non hai modificato mantiene la grafia del file (`status` o `note.status`, un'opzione scritta come testo semplice).
- **Riscritto:** solo le vecchie forme proprie di Plainva — una mappa `columns:` di primo livello passa in `properties`, `and` e `or` affiancati sullo stesso livello assumono la forma valida, e una vista che versioni molto vecchie salvavano come `type: board` diventa `type: table` con `plainva.render`.
- **Posizione:** le chiavi che una vista conserva appartengono a quella vista. Eliminare o spostare una vista in Plainva le porta con sé, e **Duplica** le copia nella nuova vista.

## Differenze rispetto a Obsidian Bases

| Argomento | Obsidian | Plainva |
|---|---|---|
| Formule, riepiloghi personalizzati | Calcolati | Conservati, non calcolati |
| `this` | Supportato | Non ancora supportato |
| Espressioni di filtro | Il linguaggio di espressioni completo | Le forme in [Condizioni](#condizioni) |
| `file.folder == "X"` | Solo le note direttamente in `X` | `X` e tutte le sue sottocartelle |
| `file.hasTag("x")` | Anche `#x/child` | Esattamente `#x` |
| `file.name` | Il nome del file | La proprietà `title`, se la nota ne ha una |
| `limit`, `groupBy` della vista | Applicati | `limit` conservato, non applicato; `groupBy` raggruppa una bacheca, non una tabella |
| Tipi di vista | `table`, `list`, `cards` e tipi dei plugin | Otto tipi; uno sconosciuto viene mostrato come tabella e conservato nel file |
| `![[db.base#View]]` | Apre quella vista | La vista usata per ultima |
| Blocco di codice ` ```base ` | Un database | Un blocco di codice |
| I blocchi `plainva` di Plainva | Ignorati | Bacheca, calendario, cronologia, grafo, bacheca appunti, relazioni, aggregazioni, tipi di campo |

## Vedi anche

- [Database (.base)](Databases_Base.md) — i database nell'uso quotidiano
- [File Format Reference](File_Format_Reference.md) — le regole su disco per gli strumenti, le relazioni in entrambe le direzioni, `index.md`
- [Note e Markdown](Notes_and_Markdown.md) — le proprietà in una nota
