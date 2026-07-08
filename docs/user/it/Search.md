# Ricerca

Stand: 2026-07-06

Plainva offre tre modi per cercare: ricerca full-text in tutto il vault, il selettore rapido per aprire i file e trova e sostituisci all'interno di una nota.

## Ricerca full-text in tutto il vault

Il campo di ricerca in alto nella barra laterale cerca in tutto il vault — sia nei titoli *che* nei contenuti. È supportata da un indice full-text locale (SQLite FTS5) che viene costruito all'apertura del vault e tenuto aggiornato a ogni modifica; la ricerca funziona quindi offline e senza ritardi percettibili.

La ricerca reagisce mentre digiti: i prefissi delle parole trovano già corrispondenza ("Proget" trova "Progetto piano") — non serve premere Invio. La **X** a destra del campo cancella la ricerca corrente (oppure premi `Esc`); la barra laterale mostra quindi di nuovo il normale albero dei file.

L'elenco dei risultati mostra in alto il conteggio dei risultati e raggruppa i risultati: prima i risultati **Nome del file** (il termine compare nel nome della nota), poi i risultati **Contenuto**. Ogni riga mostra l'icona del documento, il percorso della cartella e — per i risultati nel contenuto — un estratto di testo con la corrispondenza evidenziata. Un clic su un risultato apre la nota e salta direttamente alla prima occorrenza; lì viene selezionata. Se non c'è alcuna corrispondenza, l'elenco mostra **Nessun risultato**.

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

## Tag

La vista della barra laterale **Tag** elenca tutti i `#tag` nel vault con un conteggio dei risultati; un clic mostra i **File con #tag**. I tag funzionano nel testo (`#project`) e nel frontmatter (`tags: [project]`). Il campo di ricerca della barra laterale filtra anche l'elenco dei tag.

## Navigare all'interno di una nota

La **Struttura** nella barra laterale destra elenca tutti i titoli della nota attiva — un clic salta al punto. Per saltare tra le note, aiutano anche i **Backlink** (chi collega qui) e i pulsanti **Indietro**/**Avanti** dell'editor.

## Vedi anche

- [Scorciatoie da tastiera](Keyboard_Shortcuts.md)
- [Database (.base)](Databases_Base.md) — query strutturate sulle proprietà invece del testo completo
