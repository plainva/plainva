# Attività

Ultimo aggiornamento: 2026-09-20

La vista Attività raccoglie in un unico posto ogni casella di controllo del tuo vault: tutte le voci di elenco `- [ ]` e `- [x]` in tutte le tue note, raggruppate per la nota in cui si trovano. È la vista "cosa devo ancora fare?" sul puro Markdown — nessun plugin, nessun file speciale.

## Perché una vista separata (e non un `.base`)

Un [database (`.base`)](Databases_Base.md) lavora su note intere — una riga per nota. Una casella di controllo è una singola *riga* all'interno di una nota, e una nota può contenerne molte, quindi un `.base` non può elencarle. La vista Attività è basata sulle righe: legge direttamente le righe delle attività, così una singola nota di progetto con dieci sottoattività le mostra tutte e dieci.

## Aprire la vista Attività

- Fai clic sull'**icona della lista di controllo** nella barra delle azioni all'estrema sinistra, oppure
- apri la **palette dei comandi** (`Ctrl/Cmd+P`) ed esegui **Apri attività**.

Si apre come una scheda, come qualsiasi nota.

## Sul telefono

La vista Attività esiste anche su mobile. La apri tramite il **▾** accanto al titolo nella barra superiore, e puoi collocarla nella barra di navigazione (**Impostazioni** → **Barra di navigazione**).

Mostra le stesse due sezioni del desktop: in alto il **Database attività**, sotto l'elenco delle caselle di controllo in **Dalle note**, con i filtri **Aperte**/**Completate**/**Tutte** e la ricerca libera per testo. Spuntare, **Cambia stato**, spostare una casella di controllo **nel database**, **+ Nuova attività**, **Blocca tempo** e **Ripetizione** funzionano come descritto sopra e scrivono gli stessi file: la stessa nota con il frontmatter, lo stesso `[[wiki-link]]` nella riga originale, la stessa regola in `plainva.repeat`.

Quale database il tuo vault usa come database attività si imposta sul telefono in **Impostazioni** → **Contenuto e struttura**. L'impostazione viaggia tramite la [sincronizzazione delle impostazioni](Sync_Setup.md), quindi la scegli una sola volta, sul dispositivo che preferisci.

I quattro filtri della barra desktop appaiono sul telefono come chip sopra l'elenco: **Cartella**, **Tag**, **Con scadenza** e **Mostra nascoste**. Chip anziché menu a tendina, perché una barra di filtri sopra un elenco già stretto costa più spazio di quanto ne guadagni — un tocco apre la scelta, un secondo la cancella di nuovo.

## Leggere l'elenco

Le attività sono raggruppate per nota; il titolo della nota compare come intestazione su cui puoi fare clic per aprire la nota. Ogni attività mostra la sua casella di controllo e il suo testo, barrato una volta completata. Una **scadenza** scritta come `📅 2026-08-01` nella riga dell'attività compare come un piccolo badge.

## Filtrare

La barra in alto restringe l'elenco:

- **Aperte / Completate / Tutte** — in base allo stato della casella (inizia su **Aperte**). Questo filtro appartiene all'elenco **Tutte**; gli elenchi del pianificatore **Oggi**, **Prossimamente**, **In entrata** e **Completate** rispondono da soli a questa domanda.
- **Filtra attività…** — testo libero; corrisponde al testo dell'attività.
- **Tutte le cartelle** — solo le attività nella cartella scelta (e nelle sue sottocartelle).
- **Tutti i tag** — solo le attività che portano un `#tag` in linea scelto.
- **Con scadenza** — solo le attività che hanno una data `📅`.

I tag e le scadenze vengono letti direttamente dalla riga dell'attività — ad esempio `- [ ] Paga fattura #finance 📅 2026-08-01`.

## Spuntare le attività

Fai clic sulla **casella di controllo** di un'attività per alternarla tra aperta e completata. La modifica viene scritta direttamente nella nota (come una normale scrittura di file sicura — cambia solo il singolo carattere `[ ]`/`[x]`), così la nota, Obsidian e qualsiasi sincronizzazione restano allineati. Fai invece clic sul **testo** dell'attività per aprire la nota e saltare a quella riga.

Se una nota è cambiata da quando l'elenco è stato generato, un clic obsoleto viene ignorato e l'elenco si aggiorna — usa il pulsante **Aggiorna** in alto a destra per ricaricare in qualsiasi momento.

## Database attività predefinito

Le caselle di controllo si scrivono in fretta, ma a volte una riga cresce fino a diventare un'attività "vera" — con uno stato, una scadenza e una nota propria. Per questo, scegli un **Database attività predefinito** nelle Impostazioni sotto **Contenuto e struttura**: un [database (`.base`)](Databases_Base.md) in cui queste attività vivono come note proprie. **Crea database…** ne genera uno già pronto (cartella di archiviazione più un `.base` con una **colonna casella di controllo di completamento** (`fatto`), una colonna di stato, una colonna di scadenza, oltre a una vista tabella, una bacheca e una cronologia — la cronologia colloca ogni attività nel suo giorno di scadenza); puoi altrettanto bene scegliere un database già esistente. La proprietà della casella di controllo è la verità sul completamento di un'attività (attiva/disattiva, come per i provider); la colonna di stato resta coerente quando la spunti. Un database senza colonna casella di controllo ricade sulla convenzione di stato: prima opzione = aperta, ultima = completata.

Una volta impostato, la vista Attività mostra due sezioni: in alto le voci del **Database attività**, e in basso **Dalle note** — il consueto elenco di caselle di controllo. Lo stato è modificabile direttamente nella panoramica: la casella di controllo è la proprietà casella di controllo di completamento della nota e la commuta (la colonna di stato la segue), e un clic sul chip di stato apre un menu con tutte le opzioni (**Cambia stato**). I filtri **Aperte**/**Completate**/**Tutte** si applicano a entrambe le sezioni, e **Apri come database** salta alla vista completa del database con la sua bacheca e i suoi filtri. **Aggiorna** avvia inoltre una vera sincronizzazione con il provider quando sono collegati degli account.

## Trasformare una casella di controllo in un'attività di database

Ogni riga di attività porta un'icona di database: **Sposta nel database delle attività**. Un clic

- crea una nuova nota nella cartella di archiviazione del database (usando il suo modello predefinito, se ne è impostato uno),
- porta una data `📅` nella colonna della scadenza, imposta la prima opzione di stato per le attività aperte e salva i `#tags` della riga come tag della nota,
- collega la nuova nota alla nota di origine tramite una proprietà `source`, e
- sostituisce la riga della casella di controllo nella nota di origine con un wiki-link alla nuova nota attività — la voce resta leggibile dove è stata scritta, e l'attività ora vive nel database.

**Clic destro** sull'icona per scegliere invece un database diverso come destinazione; senza un database predefinito, il clic apre subito quel selettore. Tutto resta puro Markdown: la nuova attività è una nota normale con frontmatter, e il link nella nota di origine è un normale `[[wiki-link]]`.

**+ Nuova attività** nell'intestazione della sezione posiziona il cursore nel campo di cattura sopra gli elenchi (vedi *Pianificatore, cattura rapida, priorità e stati* più sotto). L'attività viene creata direttamente nel database delle attività — stessa cartella di archiviazione, stesso modello e valori predefiniti di una casella promossa — e una notifica offre **Apri**. Le caselle scritte in una nota restano in quella nota — diventano attività del database solo quando le sposti.

## Bloccare tempo per un'attività

Un'attività ha una data di scadenza e può avere un **orario del giorno** (`2026-09-21T14:00`) — è il momento in cui Plainva te lo ricorda. Un orario è un istante, non un intervallo. Quando vuoi riservarle una finestra, Plainva crea un **evento** — è l'oggetto che possiede un intervallo di tempo, viene disegnato con le sovrapposizioni nella griglia e si sincronizza con il tuo account calendario.

L'icona del calendario su una riga attività apre **Blocca tempo**: la data (precompilata con la scadenza), l'inizio e la **Durata** (15 min, 30 min, 1 h, 2 h o **Personalizzata**), più un selettore di calendario quando più di uno accetta scritture. L'evento porta il titolo dell'attività e rimanda alla nota. Un **clic destro** sulla riga mostra le stesse azioni del foglio sul telefono: completata/aperta, sposta nel database, ripetizione, blocca tempo.

Per un'attività del database, la nota ricorda anche il blocco nel frontmatter (`plainva.blocks`), così il collegamento è visibile da entrambi i lati. Una riga con casella non ha una nota propria — lì viene creato solo l'evento, che punta alla nota in cui si trova la riga. L'icona compare solo se è collegato un account calendario.

## Ripetere le attività

Un'attività che ritorna regolarmente riceve una **ripetizione** tramite l'icona di ripetizione nella sezione **Database attività**. Plainva non crea una **serie**: spuntando l'attività si crea la **successiva** come nota propria accanto a quella completata, con la nuova scadenza. In questo modo c'è sempre esattamente un'attività aperta, quella completata resta come registro di ciò che è stato fatto, e non esiste una serie invisibile dalla quale eliminare tutto per sbaglio — elimina un'attività e la catena finisce.

Il dialogo offre tre elementi:

- **Ritmo** — Giornaliera, Settimanale, Mensile o Annuale, più l'intervallo sotto **Ogni** (ad esempio "Ogni 3" + "Giornaliera" = ogni tre giorni).
- **Contato da: Scadenza** — una cadenza fissa ("ogni lunedì"). Spunta con ritardo un'attività scaduta e Plainva passa alla prossima scadenza **nel futuro**, invece di riempire l'elenco con quelle che hai mancato.
- **Contato da: Completamento** — il ritmo parte dal giorno in cui la spunti ("ogni tre giorni dopo aver annaffiato le piante").

**Non ripetere** rimuove di nuovo la ripetizione. Le attività mensili non slittano mai oltre la fine di un mese: il 31 gennaio più un mese è il 28 o il 29 febbraio, non il 3 marzo.

Nel **calendario**, per questo motivo, un'attività ricorrente compare solo **una volta**, alla sua scadenza attuale, con un simbolo di ripetizione sulla riga. Non è un difetto, ma il rovescio della medaglia del generatore: non esiste una serie da cui il calendario possa disegnare altre occorrenze, e righe senza una nota dietro non potrebbero essere aperte. Impostare invece la ripetizione sull'**evento collegato** (tramite **Blocca tempo**) è una vera serie di eventi: il tuo provider la espande e vedi molte occorrenze — ma questo non crea **nessuna attività**, solo eventi.

La regola vive nel frontmatter della nota (`plainva.repeat`) e quindi viaggia con la tua sincronizzazione — non in un'impostazione nascosta dell'app, e nemmeno come colonna del database, perché appartiene a **questa** attività, non a ogni voce del database. Le attività rispecchiate da un elenco di attività del tuo provider non offrono la ripetizione: si ripetono lì, e un secondo ritmo sopra spingerebbe indietro dei duplicati verso il provider.

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

<!-- accounts-tasks-2026-09-11 -->
## Separa attività con lo stesso titolo

Le attività del provider vengono associate in base all’identità. Le diverse ricorrenze hanno file propri. I falsi conflitti esistenti possono essere conservati come attività separate.

Questi file appartengono ad attività diverse. Le attività ricorrenti con lo stesso titolo possono essere istanze distinte. Entrambi i contenuti vengono conservati separatamente.

**Conserva come attività separate** — Questo file resta invariato: File attuale  La copia in conflitto viene conservata come file separato: copia di conflitto

<!-- tasks-jex-2026-09-14 -->
## Metadati Tasks e ripetizione

Desktop, mobile e anteprima dal vivo riconoscono ➕ creazione, ✅ completamento, 📅 scadenza, ⏳ pianificazione, 🛫 inizio, 🆔 ID e 🔁 ripetizione. Date: YYYY-MM-DD. Gli ID esistenti restano anche spostando le righe; i dati sconosciuti rimangono nel Markdown.

Sono automatiche solo le regole inglesi `every [N] day/week/month/year[s] [when done]` (N: 1–999). Il completamento avanza di un periodo, anche ancora scaduto; `when done` parte dal giorno di completamento. Distanze tra date e limiti di fine mese sono rispettati. Senza data, la successiva resta senza data. Regole complesse, dipendenze, ID di blocco o duplicati, date invalide, contenuto indentato, ripetizione nativa e attività dei fornitori disattivano questo generatore.

Spuntare aggiunge la data di completamento alle attività con metadati. La ripetizione supportata aggiunge un ID se manca e assegna alla successiva un ID `pv-…` distinto. È un’unica modifica Markdown, annullabile nell’editor. Riaprire e rispuntare conserva la successiva e le sue modifiche.

Le attività native del database saltano ancora i periodi scaduti. Un piano di destinazione salvato evita duplicati. Se la successiva non è confermata, controlla la cartella; riaprire e spuntare può riprendere dopo un errore di scrittura. Se la fonte è cambiata non viene scritta una copia diversa: controlla le note e crea manualmente la successiva se necessario. Una successiva confermata e poi eliminata non viene ricreata.

## Ripristinare i filtri delle attività

Stato, ricerca, cartella, tag, filtro di scadenza e visibilità delle attività nascoste vengono ricordati per vault su questo dispositivo, anche dopo aver aperto una nota o riavviato. « Reimposta filtri » torna alle attività aperte senza altri filtri. Cartelle e tag non disponibili restano visibili e possono essere rimossi dai relativi selettori. Dimenticare il vault elimina questo stato. Il database predefinito delle attività rimane nelle impostazioni del vault; i filtri non vengono sincronizzati.

<!-- planner-capture-2026-09-20 -->
## Pianificatore, cattura rapida, priorità e stati

La vista Attività si apre su **Oggi**. Gli elenchi — una barra a sinistra sul desktop, un segmento sopra l'elenco sul telefono — sono **Oggi** (ciò che scade oggi, con **In ritardo** in cima), **Prossimamente** (i prossimi 14 giorni, per giorno), **In entrata** (attività aperte senza data), **Tutte** (le due sezioni descritte sopra, con il filtro **Aperte**/**Completate**/**Tutte**) e **Completate**. Ogni elenco attinge da entrambe le fonti, il database delle attività e le caselle nelle tue note, ordinate per priorità, poi per orario, poi per titolo. Gli altri filtri si applicano a ogni elenco, e l'elenco scelto viene ricordato per vault. Sul desktop la barra elenca anche i tag più frequenti come filtri a un clic; sul telefono la schermata **Oggi** porta all'**Oggi** del pianificatore.

Sopra gli elenchi si trova il campo di cattura; sul telefono, **+ Nuova attività** e il pulsante **＋** lo aprono come foglio. Digita una riga — `Inviare offerta domani alle 14:00 !!! #cliente ogni settimana` — e premi Invio: Plainva crea l'attività nel database delle attività. Riconosce oggi, domani, dopodomani, i giorni della settimana, «tra 3 giorni», «la prossima settimana», le date in cifre, un orario (`14:30`, `14h`), una ricorrenza (giornaliera, settimanale, mensile, annuale, «ogni lunedì», «ogni 2 settimane»), `!`, `!!` e `!!!` per priorità bassa, media e alta, e `#tags` — le parole nella lingua dell'app, cifre e segni in qualsiasi lingua. Tutto ciò che riconosce viene evidenziato nel campo ed elencato sotto come un blocco rimovibile **prima** che venga salvato qualcosa; togli un blocco e le sue parole tornano semplicemente a contare come titolo. Sul telefono, dei pulsanti rapidi scrivono le stesse parole al posto tuo. Se il database delle attività indica un elenco di un provider, un chip decide se l'attività viene creata anche lì.

**Imposta priorità** nel menu di una riga (clic destro sul desktop, tocco prolungato sul telefono) offre **alta**, **media**, **bassa** e **nessuna**; una bandierina davanti al titolo la mostra. Nel database delle attività, la priorità è una colonna a selezione: un database creato ora ce l'ha già, uno più vecchio la riceve la prima volta che imposti una priorità — mai per il solo fatto di essere aperto. Una casella porta il simbolo del plugin Obsidian Tasks sulla sua riga: Plainva legge 🔺 e ⏫ come alta, 🔼 come media, 🔽 e ⏬ come bassa, e scrive ⏫, 🔼 o 🔽.

`- [/]` (**In corso**) e `- [-]` (**Annullata**) sono anch'esse attività. Ricevono una propria casella nell'editor, in modalità lettura e in ogni elenco; in corso conta come aperta, annullata come chiusa. Un clic continua a spostarsi solo tra aperta e completata — completa un'attività in corso e riapre una annullata. **Imposta stato** nel menu della riga imposta i due stati; Plainva non li scrive mai da sola.

Altri modi per crearle: **Nuova attività** nel menu del vassoio di sistema sul desktop (quando Plainva continua a girare in background), su Android la scorciatoia del launcher **Nuova attività** (tocco prolungato sull'icona dell'app), e sul telefono **Crea come attività** quando condividi qualcosa con Plainva — il testo e gli allegati finiscono nella nota dell'attività. Come un'attività con orario te lo ricorda è descritto in [Calendario e attività esterne](Calendar_and_Tasks.md).

<!-- widgets-2026-09-23 -->
## Spuntare da un widget

La casella del widget **Oggi** registra una richiesta: la spunta compare subito, la nota cambia alla prossima apertura di Plainva, ed è allora che avvengono anche la ricorrenza e la sincronizzazione. Fino a quel momento la riga dice **verrà applicato all’apertura di Plainva**. Un’attività completata, eliminata o spostata nel frattempo resta intatta. Su iPhone serve iOS 17; al di sotto, un tocco sulla riga apre l’attività. Dettagli: [L’app per dispositivi mobili](Mobile_App.md).
