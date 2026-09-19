# Ricerca

Ultimo aggiornamento: 2026-09-19

Plainva offre tre modi per cercare: ricerca full-text in tutto il vault, il selettore rapido per aprire i file e trova e sostituisci all'interno di una nota.

## Ricerca full-text in tutto il vault

Il campo in alto nella barra laterale cerca titoli e contenuti nell’intero vault. Un indice full-text locale (SQLite FTS5) viene creato all’apertura del vault e aggiornato quando cambiano i file. La ricerca funziona offline.

La ricerca reagisce mentre digiti: i prefissi delle parole trovano già corrispondenza ("Proget" trova "Progetto piano") — non serve premere Invio. La **X** a destra del campo cancella la ricerca corrente (oppure premi `Esc`); la barra laterale mostra quindi di nuovo il normale albero dei file.

La ricerca elenca le singole occorrenze con un estratto, il percorso delle intestazioni e il numero di riga. Aprendo una riga viene selezionata proprio quell’occorrenza; più corrispondenze nella stessa nota compaiono separatamente. Il conteggio comprende solo i risultati già caricati. Puoi caricare altre occorrenze. Le frecce cambiano la selezione e Invio la apre. Caricamento, risultati vuoti ed errori sono indicati; una nuova ricerca scarta le vecchie risposte. Se una modifica impedisce di identificare un’occorrenza senza ambiguità, compare un avviso. Le stesse occorrenze sono disponibili nel selettore rapido e nella ricerca mobile. Tornando alla ricerca sul telefono vengono ripristinati la query, i risultati caricati e la posizione della lista. I risultati arrivano per **Pertinenza**, a meno che tu non scelga **Ultima modifica**, **Titolo** o **Percorso** con il pulsante di ordinamento accanto al campo di ricerca (sul telefono: nella barra della ricerca); caricandone altri l'ordine scelto resta.

Il campo di ricerca si applica anche alle altre viste della barra laterale: in **Tag** filtra l'elenco dei tag, in **Segnalibri** i segnalibri.

### Operatori di ricerca

- `"frase esatta"` — le virgolette fanno corrispondere esattamente la sequenza di parole. Questo funge anche da ricerca per parola intera per un singolo termine: `"piano"` trova "piano" ma non "pianificazione".
- `-termine` — esclude le note che contengono il termine (funziona anche con le frasi: `-"vecchia versione"`).
- `path:cartella` — solo i file il cui percorso contiene il testo (es. `path:Progetti`; con spazi: `path:"La mia cartella"`).
- `tag:nome` — solo le note che portano quel tag, inclusi i tag annidati: `tag:progetto` trova anche `#progetto/interno`. Funziona anche `tag:#progetto`.
- Gli operatori possono essere negati (`-path:Archivio`, `-tag:fatto`) e combinati liberamente con i termini di ricerca: `piano tag:progetto -bozza`.
- Più termini vengono combinati con AND. Caratteri speciali come `- ( ) : *` all'interno dei termini sono innocui — Plainva tratta l'input in modo letterale.

## Selettore rapido

`Ctrl+O` o `Ctrl+K` apre il selettore rapido: digita, naviga con i tasti freccia, apri con `Invio`. Senza alcun input mostra l'elenco **File recenti** — il modo più veloce per passare tra le tue note attuali. I risultati possono anche essere aperti direttamente in una nuova scheda (il piè di pagina del dialogo mostra i tasti).

La corrispondenza è fuzzy: `prjpiano` trova anche "Piano Progetto" — le lettere devono comparire solo nell'ordine giusto, e gli inizi di parola contano di più. E quando la nota non esiste ancora, l'elenco mostra **Crea "…"**: `Invio` la crea subito (nella radice del vault) e la apre — digita un nome, premi Invio, inizia a scrivere.

Sotto i risultati sul nome, il selettore rapido mostra anche un gruppo **Contenuto**: note il cui testo corrisponde al tuo input, con un estratto evidenziato della corrispondenza. Aprire un risultato di questo tipo salta direttamente alla corrispondenza all'interno della nota — proprio come per la ricerca nella barra laterale.

## Trova e sostituisci all'interno di una nota

`Ctrl+F` apre la barra di ricerca dell'editor (in Anteprima dal vivo e in modalità sorgente):

- **Trova** con `Invio`/**successivo** e **precedente** tra i risultati; **tutti** evidenzia ogni occorrenza.
- Opzioni: **maiuscole/minuscole**, **parola intera**, **regex**.
- **Sostituisci**: sostituisci singoli risultati (**sostituisci**) o **sostituisci tutto**.

### In tutto il vault

`Ctrl/Cmd+Shift+F` (oppure **Trova e sostituisci nel vault** nella palette dei comandi) cerca contemporaneamente in tutte le note. Inserisci un termine, premi **Trova**, e i risultati compaiono raggruppati per nota con una riga di contesto ciascuno. Digita una sostituzione, deseleziona le note che vuoi escludere, e **Sostituisci in N note** riscrive le altre — ogni nota viene salvata in modo sicuro (scrittura atomica + uno snapshot di versione), così un'anteprima non aggiornata non può mai sovrascrivere contenuti più recenti. Anche qui funzionano maiuscole/minuscole, parola intera e regex; in modalità regex nella sostituzione sono disponibili i riferimenti `$1`/`$2`.

Ogni corrispondenza mostra due righe: **prima** con il punto trovato e **dopo** con il risultato; con un’espressione regolare i riferimenti `$1` vengono risolti, così la modifica è verificabile prima di scrivere qualcosa. Un’espressione non valida viene segnalata accanto al campo invece di restituire un elenco vuoto; se non c’è nulla, lo stato vuoto dice cosa controllare. Durante la sostituzione vedi l’avanzamento e puoi **Annullare**: le note già scritte restano scritte e vengono elencate. Sul telefono ogni corrispondenza mostra le stesse due righe.

**Sul telefono** la stessa cosa si trova in la lente nell’intestazione, poi `>` e **Trova e sostituisci nel vault**: le corrispondenze sono raggruppate per nota e chiuse, così un termine con quaranta corrispondenze non seppellisce l’azione; tocca una nota per guardarci dentro, deseleziona quelle da lasciare fuori, e il pulsante dichiara la propria portata (**Sostituisci in 2 note**). Se esci dall’app, una sostituzione in corso si ferma alla nota successiva — le note già scritte restano scritte e vengono elencate.

## Tag

La vista della barra laterale **Tag** elenca tutti i `#tag` nel vault con un conteggio dei risultati; un clic mostra i **File con #tag**. I tag funzionano nel testo (`#project`) e nel frontmatter (`tags: [project]`). Il campo di ricerca della barra laterale filtra anche l'elenco dei tag.

**Rinomina un tag** in tutto il vault: fai clic destro su un tag nella vista **Tag** e inserisci un nuovo nome. Plainva riscrive il tag ovunque — nel corpo delle note (`#tag` e i suoi sottotag `#tag/child`) e nel frontmatter (`tags:`) — salvando ogni nota interessata attraverso lo stesso percorso sicuro. I tag non correlati che contengono semplicemente il nome (per esempio `#area/tag`) restano invariati.

## Navigare all'interno di una nota

La **Struttura** nella barra laterale destra elenca tutti i titoli della nota attiva — un clic salta al punto. Per saltare tra le note, aiutano anche i **Backlink** (chi collega qui) e i pulsanti **Indietro**/**Avanti** dell'editor.

## Vedi anche

- [Scorciatoie da tastiera](Keyboard_Shortcuts.md)
- [Database (.base)](Databases_Base.md) — query strutturate sulle proprietà invece del testo completo
