# Attività

Stand: 2026-07-15

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
