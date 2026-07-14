# Database (.base)

Stand: 2026-07-08

Con i file `.base` trasformi le note in database: tabelle, bacheche, calendari — con filtri, proprietà tipizzate e relazioni tra database. Il concetto ricorda i database di Notion, con una differenza decisiva: **i dati non vivono nel database, vivono nelle tue note.**

> **Suggerimento:** Se crei un nuovo vault dal modello **PARA**, **GTD**, **Zettelkasten** o **Journal** (vedi [Per iniziare](Getting_Started.md)), i database corrispondenti sono già configurati e collegati tra loro — un buon punto di partenza per capire come tutto si incastra.

## Il concetto fondamentale

Un file `.base` memorizza solo la *vista* delle tue note: quali origini (cartelle, tag), quali viste, quali filtri e colonne. I valori effettivi vivono nel frontmatter delle singole note Markdown — ogni riga della tabella *è* una nota.

Concretamente, questo significa:

- Modifica una cella nella tabella e Plainva scrive il valore nel frontmatter della nota.
- Elimina il file `.base` e perdi solo la vista — tutti i dati restano nelle note.
- Le stesse note possono comparire in un numero qualsiasi di database contemporaneamente.

Il formato del file è compatibile con il formato Bases di Obsidian (dettagli alla fine di questa pagina).

## Creare un database

- **Albero dei file**: clic destro → **Nuovo database (.base)** — oppure tramite il pulsante **Nuovo** della barra laterale (**Nuovo database**).
- La procedura guidata **Nuovo database** chiede due cose: l'**Origine dati** (almeno una **Cartella** o un **Tag**; combinarli restringe il risultato — un contatore dal vivo mostra quante note corrispondono) e le colonne (proprietà trovate nelle note corrispondenti, pronte per essere adottate). Poi **Crea database**.
- **Dentro una nota**: comando slash **Incorpora database** (mostra un `.base` esistente in linea) o **Crea database in linea** (crea un nuovo `.base` nella cartella e lo incorpora).

Ogni database può avere una propria icona con un **Colore dell'icona del database** — visibile nell'albero dei file, nelle schede e nell'intestazione.

## Viste

Un database può avere un numero qualsiasi di viste; ognuna ha un **Tipo di vista**:

| Vista | A cosa serve |
|---|---|
| **Tabella** | Griglia classica, ordinabile, con modifica in linea e sottoelementi opzionali |
| **Elenco** | Elenco compatto di righe |
| **Galleria** | Schede con un'**Immagine di copertina** opzionale |
| **Bacheca** | Colonne stile Kanban raggruppate per una proprietà (**Raggruppa per**) — trascinare le schede tra le colonne cambia il valore; trascinare un'**intestazione di colonna** riordina le colonne |
| **Calendario** | Voci per **Campo data** su un calendario mensile, trascinabili |
| **Cronologia** | Asse temporale con **Data di inizio** e **Data di fine** opzionale |

**Aggiungi vista** ne crea altre; **Opzioni della vista** offre **Rinomina**, **Duplica**, **Elimina** e riordino trascinando. Plainva ricorda l'ultima vista attiva per file. Calendario e Cronologia richiedono un campo data (**Solo data** o **Data e ora** come **Formato**); le voci mostrano i campi abilitati sotto **Proprietà**.

## Configura: origini, filtri, ordinamento, proprietà

Il pulsante **Configura** (in alto a destra) apre il pannello con quattro aree:

- **Origine dati** — le origini a cartella e tag del database (si può selezionare anche la **Cartella radice**). Nessuna origine = tutti i file.
- **Filtro** — righe di regole composte da proprietà, operatore e valore. Gli operatori si adattano al tipo di campo: **è** / **non è** / **contiene** / **non contiene** / **è vuoto** / **non è vuoto**, per i numeri **maggiore di** / **minore di** / **almeno** / **al massimo**, per le date **dopo** / **prima di** / **da** / **fino a**. La **Logica** in alto decide se devono corrispondere **Tutte** le condizioni (E) o **Almeno una** (O). **Aggiungi gruppo** costruisce gruppi di filtri in stile Notion: un riquadro con una propria logica E/O all'interno della logica principale. I filtri profondamente annidati provenienti da Obsidian appaiono come **Filtro complesso (non modificabile)** — vengono mantenuti e applicati. I filtri vengono salvati **per vista** (il pannello indica **Si applica a questa vista**): ogni vista mantiene le proprie regole di filtro, mentre l'**Origine dati** (cartelle/tag) resta condivisa in tutto il database. Tutto vive nel file `.base`, non in un archivio separato.
- **Ordina** — più regole di ordinamento (**Crescente**/**Decrescente**); cambia la loro priorità trascinandole.
- **Proprietà** — mostra/nascondi colonne, trascina per riordinare, crea una **Nuova proprietà**.

## Proprietà e tipi di campo

Cliccare sull'intestazione di una colonna apre l'editor delle proprietà (**Proprietà: X**):

- **Nome** — rinominare influisce sulle note: al salvataggio, la proprietà viene rinominata nel frontmatter di ogni nota corrispondente (con conferma e un indicatore di avanzamento).
- **Tipo di campo** — Testo, Numero, Casella di controllo, Data, Data e ora, Elenco, Tag, Selezione, Stato, Selezione multipla, URL, Email, Telefono, Relazione (lo stesso menu di tipi raggruppato del pannello **Proprietà** delle note).
- **Opzioni** (per Selezione/Stato/Selezione multipla) — valori fissi con un **Colore** e, per **Stato**, un **Gruppo**/fase (ad es. da fare → in corso → completato); riordina trascinando. Quando apri l'editor della colonna, l'elenco delle opzioni è già precompilato con i valori usati nel database, così puoi assegnare un colore a ciascuno senza doverlo ridigitare.
- **Elimina proprietà** — rimuove colonna, schema, filtri e regole di ordinamento dal database. La casella **Rimuovila anche dal frontmatter delle note** (attiva per impostazione predefinita) pulisce anche le note sorgente.

Note comportamentali:

- Se una proprietà manca in alcune note, Plainva propone di **aggiungerla (vuota) a N file sorgente**.
- Per **Selezione**, **Stato**, **Selezione multipla**, **Elenco** e **Tag**, una virgola in un valore separa più voci; nel tipo **Testo** una virgola resta testo semplice.
- Anche qui sono protetti i campi di sistema OKF `type` e `okf_version`: nome, tipo di campo ed eliminazione sono bloccati, e le celle di `okf_version` sono in sola lettura (approfondimento: [OKF](OKF.md)).

## Relazioni

Le relazioni collegano le note tra loro — come in Notion, ma memorizzate come normalissimi `[[wiki-link]]` nel frontmatter (visibili in Obsidian come link cliccabili nelle proprietà).

- **Creazione**: aggiungi una proprietà di tipo di campo **Relazione**. Facoltativamente scegli un **Database di destinazione (.base)** — il selettore allora suggerisce solo note di quel database (vuoto = **Qualsiasi nota**; **Questo database** abilita le auto-relazioni). La **Cardinalità** limita a **Esattamente 1** o consente **Nessun limite**.
- **Impostare i valori**: il selettore cerca le note, esclude la voce corrente e può creare una destinazione al volo tramite **Crea nuova nota**. Un'etichetta con "La nota collegata non esiste" segnala un link interrotto (destinazione eliminata/rinominata al di fuori di Plainva).
- **Relazione inversa**: l'opzione **Mostra su "X"** crea una colonna calcolata nel database di destinazione che mostra i link in senso inverso — è direttamente modificabile (le modifiche vengono scritte nelle note che collegano). Eliminare la relazione rimuove anche la sua colonna inversa.
- **Sottoelementi**: per le auto-relazioni puoi **Abilitare i sottoelementi** — le voci con una relazione genitore appaiono comprimibili sotto la loro voce genitore nella tabella (i cicli sono gestiti; disattivato, l'elenco resta piatto e i valori vengono mantenuti).
- **Bacheca per relazione**: le bacheche possono raggruppare per una relazione; trascinare le schede tra le colonne riscrive il link.
- **Filtrare sulle relazioni**: contiene / non contiene / è vuoto / non è vuoto, con un selettore di note.
- Contano anche i backlink: i link del frontmatter compaiono nel pannello **Backlink**, e rinominare i file aggiorna automaticamente i link delle relazioni.

## Creare nuove voci

Il pulsante **Voce** in alto a sinistra (in precedenza **Nuovo**; chiaramente distinto dal **Nuovo** globale della barra laterale) crea un nuovo elemento:

- Il nome del file segue lo schema `{nome del database}_{numero progressivo}` (gli spazi diventano `_`); la nota inizia con un titolo corrispondente ed eredita le origini a tag del database e i valori di filtro semplici, così compare subito nella vista. Si apre poi la finestra di anteprima per compilarla.
- **Cartella di archiviazione**: i nuovi elementi finiscono sempre in una cartella designata. Se il database non ha ancora una cartella come origine, un dialogo ti guida una volta nella creazione; con più cartelle di origine ne scegli una una volta sola. Cambiala in qualsiasi momento tramite il menu a freccia sul pulsante → **Cambia cartella di archiviazione…**.
- **Modelli**: il menu a freccia (**Modelli e cartella di archiviazione**) elenca i modelli dalla cartella dei modelli del tuo vault — usane uno una volta, mettilo in evidenza con **Imposta come predefinito** (allora ogni clic su **Voce** lo userà per questo database), oppure **Crea nuovo modello** (un nuovo modello inizia con un'intestazione `# {{title}}`, quindi le voci create da esso ereditano il proprio nome di file come H1). Lo stesso menu offre anche **Apri la cartella dei modelli**, che mostra la cartella dei modelli nell'albero dei file: i modelli sono note normali che puoi modificare, rinominare o eliminare lì.
- **Segnaposto dei modelli**: i modelli interpolano `{{title}}`, `{{date}}` e `{{time}}`. Quando *inserisci* un modello in una nota (comando slash **Inserisci modello** / `Mod+Alt+T`), se ne risolvono altri due: `{{cursor}}` indica dove finisce il cursore dopo l'inserimento, e `{{prompt:Etichetta}}` ti chiede un valore (etichettato *Etichetta*) e inserisce la tua risposta. Creare una *nuova* nota da un modello rimuove `{{cursor}}` e lascia vuoto ogni `{{prompt:…}}`.

## Uso quotidiano

- **Modifica in linea**: un singolo clic in una cella (o su un valore della scheda) la rende modificabile — in ogni vista.
- **Apertura**: cliccare sul titolo di una voce apre la nota nella finestra di anteprima — una finestra fluttuante che puoi trascinare dalla barra del titolo e ridimensionare dall'angolo. Mantiene una propria cronologia **Indietro**/**Avanti** per le note che apri al suo interno, ha un interruttore che mostra una colonna **Proprietà** per la nota visualizzata, e offre **Apri come scheda** e **Apri nella vista divisa**. `Ctrl`+clic apre direttamente nella vista divisa; in alternativa trascina una scheda sulla zona di rilascio **Rilascia qui: apri nella vista divisa**.
- **Trascinamento**: mentre trascini le schede (Bacheca, Calendario, Cronologia) una scheda fantasma segue il puntatore. In una **Bacheca** puoi anche trascinare un'**intestazione di colonna** per riordinare le colonne — per le bacheche **Selezione**/**Stato** questo riordina le opzioni della proprietà (così i menu a tendina in tutta l'app seguono l'ordine); le bacheche per relazione e testo libero ricordano l'ordine per ogni vista.
- **Colore della colonna**: nelle impostazioni della **Vista** di una bacheca, **Colore della colonna** permette a una colonna di assumere il colore del proprio gruppo — sia come **Intera colonna** (l'intera colonna viene colorata) sia come **Solo chip** (solo il chip nell'intestazione, l'impostazione predefinita). Si applica ai gruppi Selezione/Stato/Selezione multipla.
- **Incorporamento**: i database possono essere incorporati nelle note (comando slash **Incorpora database** o `@` → **Database**) e usati lì con piena funzionalità.
- **Ambito automatico dentro un elemento correlato**: quando incorpori un database dentro un singolo elemento di un database *correlato*, viene filtrato automaticamente su quell'elemento — incorpora il database delle attività dentro la nota di un progetto e vedrai solo le attività di quel progetto. Funziona in entrambe le direzioni (incorpora il lato "molti" per vedere le righe che puntano all'elemento ospitante, oppure il lato "uno" per vedere a cosa punta l'elemento ospitante) e anche per i database con auto-relazioni e una gerarchia genitore/sottoelementi (incorporare il database dentro un elemento ne mostra i sottoelementi, annidati). Una piccola etichetta **Filtro** nell'intestazione dell'incorporamento mostra su cosa è ristretto l'ambito; usala per cambiare la relazione o scegliere **Mostra tutto**. L'ambito non viene mai scritto nel file `.base`, quindi lo stesso database mostra le righe giuste in ogni elemento in cui è incorporato.
- **Le nuove voci ereditano il collegamento**: creare una voce con **Voce** dentro un incorporamento con questo ambito automatico la collega subito all'elemento ospitante (un'attività creata nell'elenco attività incorporato di un progetto appartiene subito a quel progetto). Nella direzione inversa è invece l'elemento ospitante a essere collegato alla nuova voce; una relazione a valore singolo già assegnata resta invariata.
- **Filtro esplicito "Questa nota" (come il filtro "questa pagina" di Notion)**: invece di affidarti all'ambito automatico, puoi renderlo esplicito e permanente. In **Configura → Filtro**, aggiungi una regola su una proprietà di relazione e scegli il valore **Questa nota**. Il database viene così ristretto alla nota in cui è incorporato — ideale per i **modelli**: incorpora il database delle attività in un modello di progetto, e ogni progetto creato da esso mostrerà le proprie attività. Funziona per qualsiasi proprietà wiki-link, non solo per le relazioni rilevate automaticamente, e un filtro esplicito **Questa nota** ha la precedenza sull'ambito automatico. Questo filtro vive solo in Plainva (non viene scritto nella `.base` come filtro normale), quindi sia Obsidian sia un'apertura autonoma mostrano tutte le righe.

## Esempio: come appare un file .base

I file `.base` sono YAML — ecco un semplice elenco di progetti:

```yaml
filters:
  and:
    - 'file.hasTag("project")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: open
          color: teal
          group: Active
        - value: done
          color: gray
          group: Completed
views:
  - type: table
    name: All projects
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Tutto ciò che è specifico di Plainva (colori, rendering della bacheca, relazioni, cartella di archiviazione) vive sotto chiavi `plainva:`.

## Modificare i file .base direttamente (strumenti e IA)

I file `.base` sono YAML in chiaro — puoi modificarli direttamente con uno strumento, uno script o un assistente IA, senza passare dall'interfaccia di Plainva. Tre regole ferree:

- **La nota è la fonte di verità.** I valori delle proprietà vivono nel frontmatter delle note, mai nella `.base`. La `.base` decide solo quali note e colonne vengono mostrate.
- **Solo quattro chiavi di primo livello:** `filters`, `formulas`, `properties`, `views`. Aggiungerne un'altra fa rifiutare l'intero file a Obsidian.
- **Conserva le chiavi sconosciute.** Non "ripulire" ciò che non riconosci durante un ciclo di lettura/scrittura.

Una trappola comune: le chiavi della mappa `properties:` e le liste `order:`/`sort:` di una vista usano il prefisso `note.` (ad es. `note.status`), ma dentro le espressioni di filtro e le sotto-chiavi `plainva` (come `groupBy`) si usa la chiave bare (`status`).

Il contratto completo — ogni chiave, ogni tipo di input, come funzionano le relazioni su entrambi i lati — è nella [File Format Reference](File_Format_Reference.md).

## E Obsidian?

Il formato corrisponde al formato Bases di Obsidian; Plainva scrive le sue estensioni esclusivamente in sotto-chiavi `plainva:`, che Obsidian ignora ("graceful degradation"):

- Obsidian apre il file senza errori; le viste esclusive di Plainva come Bacheca/Calendario/Cronologia vi appaiono come una semplice tabella.
- Le colonne di relazione inversa appaiono vuote in Obsidian (sono calcolate); i valori delle relazioni nelle note vi sono visibili come link cliccabili.
- Al primo utilizzo di un'estensione di questo tipo, un dialogo (**Estensione Plainva**) lo segnala; può essere disattivato in **Impostazioni** tramite **Database estesi** o **Avvisi**.

## Vedi anche

- [File Format Reference](File_Format_Reference.md) — il contratto esatto su disco delle `.base` per strumenti e modifica a mano
- [Note e Markdown](Notes_and_Markdown.md) — proprietà/frontmatter nel dettaglio
- [OKF](OKF.md) — cosa ti offre in pratica un `type` uniforme
