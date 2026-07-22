# Attività

Ultimo aggiornamento: 2026-07-22

La vista Attività raccoglie in un unico posto ogni casella di controllo del tuo vault: tutte le voci di elenco `- [ ]` e `- [x]` in tutte le tue note, raggruppate per la nota in cui si trovano. È la vista "cosa devo ancora fare?" sul puro Markdown — nessun plugin, nessun file speciale.

## Perché una vista separata (e non un `.base`)

Un [database (`.base`)](Databases_Base.md) lavora su note intere — una riga per nota. Una casella di controllo è una singola *riga* all'interno di una nota, e una nota può contenerne molte, quindi un `.base` non può elencarle. La vista Attività è basata sulle righe: legge direttamente le righe delle attività, così una singola nota di progetto con dieci sottoattività le mostra tutte e dieci.

## Aprire la vista Attività

- Fai clic sull'**icona della lista di controllo** nella barra delle azioni all'estrema sinistra, oppure
- apri la **palette dei comandi** (`Ctrl/Cmd+P`) ed esegui **Apri attività**.

Si apre come una scheda, come qualsiasi nota.

## Leggere l'elenco

Le attività sono raggruppate per nota; il titolo della nota compare come intestazione su cui puoi fare clic per aprire la nota. Ogni attività mostra la sua casella di controllo e il suo testo, barrato una volta completata. Una **scadenza** scritta come `📅 2026-08-01` nella riga dell'attività compare come un piccolo badge.

## Filtrare

La barra in alto restringe l'elenco:

- **Aperte / Completate / Tutte** — in base allo stato della casella di controllo (parte da **Aperte**).
- **Filtra attività…** — testo libero; corrisponde al testo dell'attività.
- **Tutte le cartelle** — solo le attività nella cartella scelta (e nelle sue sottocartelle).
- **Tutti i tag** — solo le attività che portano un `#tag` in linea scelto.
- **Con scadenza** — solo le attività che hanno una data `📅`.

I tag e le scadenze vengono letti direttamente dalla riga dell'attività — ad esempio `- [ ] Paga fattura #finance 📅 2026-08-01`.

## Spuntare le attività

Fai clic sulla **casella di controllo** di un'attività per alternarla tra aperta e completata. La modifica viene scritta direttamente nella nota (come una normale scrittura di file sicura — cambia solo il singolo carattere `[ ]`/`[x]`), così la nota, Obsidian e qualsiasi sincronizzazione restano allineati. Fai invece clic sul **testo** dell'attività per aprire la nota e saltare a quella riga.

Se una nota è cambiata da quando l'elenco è stato generato, un clic obsoleto viene ignorato e l'elenco si aggiorna — usa il pulsante **Aggiorna** in alto a destra per ricaricare in qualsiasi momento.

## Database attività predefinito

Le caselle di controllo si scrivono in fretta, ma a volte una riga cresce fino a diventare un'attività "vera" — con uno stato, una scadenza e una nota propria. Per questo, scegli un **Database attività predefinito** nelle Impostazioni sotto **Contenuto e struttura**: un [database (`.base`)](Databases_Base.md) in cui queste attività vivono come note proprie. **Crea database…** ne genera uno già pronto (cartella di archiviazione più un `.base` con una **colonna casella di controllo di completamento** (`fatto`), una colonna di stato, una colonna di scadenza, una vista tabella e una vista bacheca); puoi altrettanto bene scegliere un database già esistente. La proprietà della casella di controllo è la verità sul completamento di un'attività (attiva/disattiva, come per i provider); la colonna di stato resta coerente quando la spunti. Un database senza colonna casella di controllo ricade sulla convenzione di stato: prima opzione = aperta, ultima = completata.

Una volta impostato, la vista Attività mostra due sezioni: in alto le voci del **Database attività**, e in basso **Dalle note** — il consueto elenco di caselle di controllo. Lo stato è modificabile direttamente nella panoramica: la casella di controllo è la proprietà casella di controllo di completamento della nota e la commuta (la colonna di stato la segue), e un clic sul chip di stato apre un menu con tutte le opzioni (**Cambia stato**). I filtri **Aperte**/**Completate**/**Tutte** si applicano a entrambe le sezioni, e **Apri come database** salta alla vista completa del database con la sua bacheca e i suoi filtri. **Aggiorna** avvia inoltre una vera sincronizzazione con il provider quando sono collegati degli account.

## Trasformare una casella di controllo in un'attività di database

Ogni riga di attività porta un'icona di database: **Sposta nel database delle attività**. Un clic

- crea una nuova nota nella cartella di archiviazione del database (usando il suo modello predefinito, se ne è impostato uno),
- porta una data `📅` nella colonna della scadenza, imposta la prima opzione di stato per le attività aperte e salva i `#tags` della riga come tag della nota,
- collega la nuova nota alla nota di origine tramite una proprietà `source`, e
- sostituisce la riga della casella di controllo nella nota di origine con un wiki-link alla nuova nota attività — la voce resta leggibile dove è stata scritta, e l'attività ora vive nel database.

**Clic destro** sull'icona per scegliere invece un database diverso come destinazione; senza un database predefinito, il clic apre subito quel selettore. Tutto resta puro Markdown: la nuova attività è una nota normale con frontmatter, e il link nella nota di origine è un normale `[[wiki-link]]`.

## Nascondere le note dalla vista Attività

Alcune note contengono caselle di controllo che non sono mai attività "vere" — soprattutto i **modelli**. Per tenerle fuori dall'elenco, una nota può escludere se stessa. La verità resta nel file: l'esclusione è un campo del frontmatter della nota, non un'impostazione nascosta dell'app. Si sincronizza, è visibile in Obsidian e può essere verificata con qualsiasi editor di testo:

```yaml
---
plainva:
  tasks: false
---
```

Non devi scrivere questo campo a mano:

- **Nascondi dalle attività** — un'icona a forma di occhio si trova a destra della riga di intestazione di ogni nota; un clic scrive il marcatore in quella nota e la nasconde.
- **Mostra nascoste** — questa opzione nella barra dei filtri fa ricomparire le note nascoste (attenuate), ciascuna con un'icona **Mostra di nuovo nelle attività** (che rimuove il marcatore).
- **Nascondi modelli** — se la cartella dei tuoi modelli contiene note con caselle di controllo, in alto a destra compare il pulsante **Nascondi modelli**, che scrive il marcatore in tutte contemporaneamente.

I modelli appena creati portano il marcatore automaticamente. Quando crei una nota **a partire da** un modello, il marcatore viene rimosso di nuovo — la nuova nota è contenuto reale e mostra le sue attività normalmente.

## Compatibilità con Obsidian

Le attività sono normali caselle di controllo GFM (GitHub-Flavored Markdown). Plainva non aggiunge mai una sintassi speciale: le stesse righe `- [ ]` vengono renderizzate come caselle di controllo in Obsidian e si leggono correttamente in qualsiasi editor. Le convenzioni `📅 data` e `#tag` sono lo stile comune di Obsidian-Tasks, ma sono solo testo nella tua nota.

## Vedi anche

- [Note e Markdown](Notes_and_Markdown.md) — scrivere elenchi di attività nell'editor
- [Ricerca](Search.md) — ricerca full-text in tutto il vault
- [Database (.base)](Databases_Base.md) — database a livello di nota

## Completare dalla panoramica

Spuntando un’attività nella panoramica, Plainva scrive la casella nella nota sorgente e aggiorna la nota nell’indice prima di rileggere l’elenco. L’attività lascia subito **Aperte** e non riappare da un indice obsoleto.
