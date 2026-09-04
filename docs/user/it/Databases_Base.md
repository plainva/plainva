# Database (.base)

Ultimo aggiornamento: 2026-09-04

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

- **Albero dei file**: clic destro → **Nuovo database (.base)** — oppure tramite il pulsante **Nuovo** della barra laterale (**Nuovo database (.base)**).
- La procedura guidata **Nuovo database** chiede due cose: l'**Origine dati** (almeno una **Cartella** o un **Tag**; combinarli restringe il risultato — un contatore dal vivo mostra quante note corrispondono) e le colonne (proprietà trovate nelle note corrispondenti, pronte per essere adottate). Poi **Crea database**.
- **Dentro una nota**: comando slash **Incorpora database** (mostra un `.base` esistente in linea) o **Crea database in linea** (crea un nuovo `.base` nella cartella e lo incorpora).

Ogni database può avere una propria icona con un **Colore dell'icona del database** — visibile nell'albero dei file, nelle schede e nell'intestazione.

Un database può anche fungere da **Database attività predefinito** del vault (Impostazioni → **Contenuto e struttura**): la [vista Attività](Tasks.md) mostra allora le sue voci in una sezione propria e può spostare le caselle di controllo delle note al suo interno.

## Viste

Un database può avere un numero qualsiasi di viste; ognuna ha un **Tipo di vista**:

| Vista | A cosa serve |
|---|---|
| **Tabella** | Griglia classica, ordinabile, con modifica in linea e sottoelementi opzionali |
| **Elenco** | Elenco compatto di righe |
| **Galleria** | Schede con un'**Immagine di copertina** opzionale |
| **Bacheca** | Colonne stile Kanban raggruppate per una proprietà (**Raggruppa per**) — trascinare le schede tra le colonne cambia il valore; trascinare un'**intestazione di colonna** riordina le colonne |
| **Calendario** | Voci per **Campo data** in **Mese**, **Settimana** o **Giorno**, trascinabili |
| **Cronologia** | Asse temporale con **Data di inizio** e **Data di fine** opzionale |
| **Bacheca appunti** | In stile Google Keep, con note adesive — le schede mostrano il contenuto della nota renderizzato (sezione dedicata più sotto) |

**Aggiungi vista** ne crea altre; **Opzioni della vista** offre **Rinomina**, **Duplica**, **Elimina** e riordino trascinando. Plainva ricorda l'ultima vista attiva per file. Calendario e Cronologia richiedono un campo data (**Solo data** o **Data e ora** come **Formato**); le voci mostrano i campi abilitati sotto **Proprietà**.

## Configura: schede per vista, colonne, filtro, ordinamento, origine dati

Il pulsante **Configura** (in alto a destra) apre il pannello **accanto** alla vista attiva, così ogni modifica compare subito nella tabella o nella bacheca. In alto, delle **schede** permettono di scegliere un'area — ne viene mostrata solo una alla volta, invece di un lungo elenco. Un piccolo indicatore mostra, per ogni area, se riguarda **Questa vista** o l'**Intero database**:

- **Vista** — il **tipo di vista** come selettore a icone (Tabella, Elenco, Scheda, Bacheca, Galleria, Calendario, Cronologia, Bacheca appunti) insieme alle sue opzioni specifiche per tipo: raggruppamento e colore delle colonne per la bacheca, il campo data per calendario/cronologia, l'immagine di copertina della galleria, i sottoelementi, il formato data. Questi selettori offrono solo proprietà del **tipo corrispondente**: il **campo data** solo proprietà data, **Raggruppa per** solo proprietà Selezione/Stato/Selezione multipla/Relazione, l'**immagine di copertina** solo proprietà Testo/URL. Per il tipo di vista **Grafo** la scheda **Proprietà** è disabilitata — il grafo non mostra colonne (colore/dimensione/archi si impostano nella sua barra degli strumenti).
- **Colonne** — le proprietà della vista, suddivise in **Visibili** e **Nascoste**. Clicca sull'occhio per mostrare o nascondere una colonna; trascina la maniglia per riordinare. Ogni riga mostra un'etichetta con il tipo di campo, l'ingranaggio apre l'editor della colonna, **Nuova proprietà** ne aggiunge una.
- **Filtro** — ogni regola compare come una frase a **chip** leggibile (ad es. "Lo stato non è Completato"); cliccandoci si espande l'editor (proprietà, operatore, valore). Gli operatori si adattano al tipo di campo: **è** / **non è** / **contiene** / **non contiene** / **è vuoto** / **non è vuoto**, per i numeri **maggiore di** / **minore di** / **almeno** / **al massimo**, per le date **dopo** / **prima di** / **da** / **fino a**. La **Logica** in alto decide se devono corrispondere **Tutte** le condizioni (E) o **Almeno una** (O). **Aggiungi gruppo** crea gruppi di filtri in stile Notion: un riquadro con una propria logica E/O all'interno della logica principale. I filtri profondamente annidati provenienti da Obsidian appaiono come **Filtro complesso (non modificabile)** — vengono mantenuti e applicati. I filtri vengono salvati **per vista**; tutto vive nel file `.base`, non in un archivio separato.
- **Ordina** — più regole di ordinamento (**Crescente**/**Decrescente**); cambia la loro priorità trascinandole.
- **Origine dati** — le origini a cartella e tag del database (si può selezionare anche la **Cartella radice**). Nessuna origine = tutti i file. Si applica all'intero database, non solo alla vista attiva.

Sul telefono, **Configura** apre le stesse aree come un elenco; toccarne una apre l'area di dettaglio corrispondente, e la freccia indietro ne esce.

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

## Aggregazioni

Un'**aggregazione** calcola un valore dalle note verso cui punta un collegamento — "quante delle attività di questo progetto sono ancora aperte", "quanto impegno c'è complessivamente", "quando scade l'ultima".

- **Creazione**: una nuova proprietà di tipo di campo **Aggregazione**. Si scelgono tre cose: il **collegamento** attraverso cui calcolare (una relazione o una relazione inversa di questo database), la **proprietà** delle note collegate e il **calcolo**. **Conteggio con condizione** e **Percentuale con condizione** aggiungono una **condizione** — con gli stessi operatori usati dai filtri.
- **Calcoli**: conteggio · conteggio con condizione · percentuale con condizione · somma · media · mediana · valore minimo e massimo · data più antica e più recente · spuntato e non spuntato · con e senza valore · valori distinti.
- **Anteprima**: mentre la si configura, l'editor mostra i valori che produrrebbe per le prime voci. Seguono lo stesso percorso della colonna finita, quindi l'anteprima non può mostrare nulla di diverso da ciò che mostrerà la tabella.
- **Il valore non viene mai salvato.** Viene calcolato ogni volta che viene mostrato — come la relazione inversa. Nessuna nota riporta "12 attività aperte", quindi nessuna sincronizzazione può trascinarsi dietro un numero obsoleto e nessun dispositivo può affermarne uno diverso. La cella è quindi **non modificabile**: ciò che si vuole cambiare, si cambia nelle note collegate.
- **Niente da misurare non è zero**: una somma senza un solo valore numerico resta vuota invece di affermare 0. Il **conteggio**, al contrario, conta le note — un progetto senza attività ha onestamente 0.
- **In Obsidian** la colonna resta vuota: Obsidian non conosce l'aggregazione e mostra il database come una tabella senza quei valori. Il file resta valido, non si perde nulla.
- **Limite**: un'aggregazione non calcola su un'altra aggregazione. Se il collegamento scelto punta a una colonna calcolata, la nuova colonna resta vuota.

## Piè di colonna

Una colonna di una tabella può avere una riga sotto che la riassume — la **Somma** di uno sforzo, la data **Più remota**, o quante righe hanno anche solo un valore.

- **Impostarlo**: in **Configura → Colonne**, scegli un **Piè di colonna** accanto alla colonna. **Nessun piè di colonna** lo rimuove di nuovo.
- **Calcoli**: Media · Min · Max · Somma · Intervallo · Mediana · Dev. standard · Più remota · Più recente · Spuntate · Non spuntate · Senza valore · Con valore · Distinti.
- **Il piè calcola sulle righe che la vista mostra** — non sull'intero vault. Un filtro quindi cambia anche il numero sottostante.
- **Niente da misurare non è zero**: una colonna senza un solo valore utilizzabile lascia il proprio piè vuoto invece di affermare 0. Una colonna senza un piè proprio resta vuota e non prende mai in prestito il numero della colonna vicina.
- **Visibile in Obsidian**: i piè di colonna sono una funzione propria di Obsidian, non un'aggiunta di Plainva. Quello che imposti qui lo vedi lì — e viceversa. Le espressioni di formula personalizzate scritte in Obsidian restano nel file; Plainva semplicemente non mostra alcun valore per loro.

## Pianificare progetti: traguardi, dipendenze, impegno

La vista cronologia trasforma un database in un piano. Quattro elementi lo reggono, e tutti vivono nelle note, non nel file `.base`:

- **Un traguardo** è una voce con una data e **senza fine**. La cronologia lo disegna come un rombo invece che come una barra: un momento, non un periodo. Non c'è nulla da attivare: lascia vuota la proprietà di fine.
- **Le dipendenze** dicono «questo non può iniziare finché quello non è finito». La proprietà è `blockedBy` e la sua forma segue la **RFC 9253** — lo stesso vocabolario che il plugin TaskNotes già scrive:

```yaml
blockedBy:
  - uid: "[[Projects/Rollout]]"
    reltype: FINISHTOSTART
    gap: P1D
```

  Viene memorizzata una **sola** direzione: una coppia memorizzata sono due fatti che possono contraddirsi. Solo `FINISHTOSTART` viene valutato e disegnato; gli altri tipi restano intatti nel file. Un ciclo viene rifiutato al momento della scrittura, indicando il percorso che chiuderebbe.
- **Un conflitto viene segnalato, mai corretto.** Se un'attività inizia prima che finisca quella che sta aspettando, la freccia diventa rossa e resta rossa. Le date sono la tua affermazione: Plainva dice soltanto che due di esse non concordano.
- **L'impegno** è un semplice numero di minuti, in una proprietà a tua scelta (il modello **Progetto** la chiama `effort`). Un piè di colonna lo somma; un riepilogo lo accumula sulle attività di un progetto.
- **Il tempo effettivo** *non* viene memorizzato. Viene letto dagli appuntamenti che l'attività ha bloccato, quindi resta corretto quando sposti o ridimensioni l'appuntamento. Senza un account calendario la colonna mostra un trattino anziché uno zero: «non misurato» e «misurato, ed era nulla» sono affermazioni diverse.

## Dove si colloca questa nota? (contesto del database)

Quando apri direttamente una voce di database — dall'albero dei file, dalla ricerca o tramite un `[[link]]` — Plainva ora ti dice di cosa fa parte:

- Sopra la nota c'è una **riga di contesto**: i database a cui appartiene la nota, come chip cliccabili (un clic apre il database), seguiti dal percorso `voce genitore / questa nota` quando il database usa i sottoelementi. Se la nota appartiene a **più** database, compaiono tutti — la riga va a capo invece di ometterne uno.
- Nella barra laterale destra, la sezione **Database** è l'**ispettore della voce**: mostra la nota così come la vede il suo database — le colonne della prima vista, nell'ordine di quella vista, con i tipi e i colori delle opzioni del `.base`, e **modificabile** proprio come nella tabella. Così uno stato può essere cambiato senza aprire il database. Sopra si trova la posizione nella vista (**12 / 34**) con le frecce verso la voce precedente e successiva. Una nota che appartiene a più database ottiene un blocco per ciascun database. Sotto seguono la **voce genitore**, i **sottoelementi** (comprimibili) e le voci **collegate** tramite relazioni — ciascuna cliccabile.
- La posizione compare solo quando la nota si trova effettivamente **nella** vista: l'appartenenza a un database deliberatamente non dipende dai filtri di una vista, quindi le due cose possono legittimamente divergere.
- Il pannello **Proprietà** resta comunque utile accanto: mostra il frontmatter grezzo — ogni campo, senza l'ordine, i tipi e i filtri del database.
- Se una nota non appartiene a nessun database, non compaiono né la riga né la sezione. Niente di tutto ciò viene scritto nella nota: il contesto viene ricalcolato dai tuoi file `.base` e dai tuoi link ogni volta che la apri, e la nota stessa resta puro Markdown.

## Creare nuove voci

Il pulsante **Voce** in alto a sinistra (in precedenza **Nuovo**; chiaramente distinto dal **Nuovo** globale della barra laterale) crea un nuovo elemento:

- Il nome del file segue lo schema `{nome del database}_{numero progressivo}` (gli spazi diventano `_`); la nota inizia con un titolo corrispondente ed eredita le origini a tag del database e i valori di filtro semplici, così compare subito nella vista. Si apre poi la finestra di anteprima per compilarla.
- **Cartella di archiviazione**: i nuovi elementi finiscono sempre in una cartella designata. Se il database non ha ancora una cartella come origine, un dialogo ti guida una volta nella creazione; con più cartelle di origine ne scegli una una volta sola. Cambiala in qualsiasi momento tramite il menu a freccia sul pulsante → **Cambia cartella di archiviazione…**.
- **Modelli**: il menu a freccia (**Modelli e cartella di archiviazione**) elenca i modelli dalla cartella dei modelli del tuo vault — usane uno una volta, mettilo in evidenza con **Imposta come predefinito** (allora ogni clic su **Voce** lo userà per questo database), oppure **Crea nuovo modello** (un nuovo modello inizia con un'intestazione `# {{title}}`, quindi le voci create da esso ereditano il proprio nome di file come H1). Lo stesso menu offre anche **Apri la cartella dei modelli**, che mostra la cartella dei modelli nell'albero dei file: i modelli sono note normali che puoi modificare, rinominare o eliminare lì.
- **Modelli per database**: i modelli possono essere assegnati ai database. Per impostazione predefinita, il menu a freccia del pulsante **Voce** mostra solo i modelli assegnati a questo database (più il suo modello predefinito); tutto il resto è raggiungibile tramite **Mostra tutti i modelli (n)**. Assegna direttamente lì — l'icona del database su ogni riga mostra **Assegna a questo database** oppure **Rimuovi l’assegnazione a questo database** — oppure sul modello stesso: il menu **⋮** dell'editor offre **Database di destinazione…**, un dialogo con un campo di ricerca in cui assegni il modello a un numero qualsiasi di database. Un modello creato da un database tramite **Crea nuovo modello** parte già assegnato a esso. L'assegnazione viene memorizzata come elenco `plainva.templateFor` nel frontmatter del modello (vedi [File Format Reference](File_Format_Reference.md)); non viene mai copiata nelle voci create dal modello, e rinominare una `.base` porta con sé le assegnazioni. Il comando slash **Inserisci modello** resta volutamente non filtrato — inserisce testo in una nota esistente e non ha un contesto di database.
- **Elenchi di attività**: se il database è un database di attività e hai collegato un account calendario/attività, **Configura → Origine dati** mostra la riga **Crea anche le nuove attività in**. Scegli lì un elenco e ogni attività creata in Plainva viene creata anche in quell'elenco presso il provider — da **+ Nuova attività**, da una casella di controllo spostata e da un'e-mail catturata come attività, allo stesso modo; senza scegliere, resta una semplice nota, esattamente come prima. La scelta appartiene al database (memorizzata come `plainva.taskList`, vedi [File Format Reference](File_Format_Reference.md)), non alla singola attività, e la riga compare solo quando un account offre effettivamente un elenco di attività. Se l'elenco scelto in seguito scompare (account rimosso, elenco eliminato), Plainva non crea l'attività altrove — tratta il database come se non fosse stata fatta alcuna scelta. La nuova attività ricorda quale attività le corrisponde presso il provider; senza questa nota, la prossima sincronizzazione creerebbe una seconda nota per la stessa attività. Se la creazione presso il provider fallisce, la nota resta e Plainva lo segnala — la nota è il risultato, l'attività presso il provider l'aggiunta.
- **Segnaposto dei modelli**: i modelli interpolano `{{title}}`, `{{date}}` e `{{time}}`. Quando *inserisci* un modello in una nota (comando slash **Inserisci modello** / `Mod+Alt+T`), se ne risolvono altri due: `{{cursor}}` indica dove finisce il cursore dopo l'inserimento, e `{{prompt:Etichetta}}` ti chiede un valore (etichettato *Etichetta*) e inserisce la tua risposta. Creare una *nuova* nota da un modello ora si comporta allo stesso modo: Plainva chiede tutti i valori `{{prompt:…}}` in una volta sola e posiziona il cursore su `{{cursor}}` non appena la nota si apre. Solo i percorsi in background (sincronizzazione delle attività, cattura e-mail) non vengono mai chiesti — lì le risposte restano vuote. L'elenco completo dei segnaposto è in [Note e Markdown](Notes_and_Markdown.md).
- **Rinominare, duplicare, eliminare**: un clic destro su una voce offre in ogni vista (tabella, elenco, schede, bacheca, calendario, cronologia) **Apri**, **Apri nel riquadro**, **Rinomina…**, **Duplica** ed **Elimina…** — l'eliminazione passa dal consueto dialogo a cascata. Le stesse azioni si trovano nel menu ⋮ della finestra di anteprima, e un doppio clic sul suo titolo rinomina anch'esso. Se il titolo rispecchia ancora il nome del file (lo stato di una voce `{nome database}_{numero}` appena creata), segue la rinomina; un titolo scritto da te non viene mai toccato.

## Bacheca appunti (note adesive come Google Keep)

Il tipo di vista **Bacheca appunti** mostra le note del database come schede con il loro contenuto renderizzato — una bacheca piena di note adesive. Le schede renderizzano testo, elenchi e caselle di controllo cliccabili (un clic spunta l'attività direttamente nella nota), immagini e formattazione; tabelle, formule e incorporamenti appaiono come segnaposto discreti. Cliccare su una scheda apre la nota nella finestra di anteprima.

- **Cattura rapida**: il campo **Scrivi una nota…** sopra la bacheca si espande in un piccolo popup con un campo **Titolo** e il testo della nota su più righe — come in Google Keep. Un titolo digitato diventa il nome del file E la prima intestazione della nota; senza titolo il file riceve un nome basato sul timestamp e la nota non ha intestazione. Il testo è comunque il contenuto — nessun modello, nessuna deviazione (Ctrl/Cmd+Invio salva).
- **Fissaggio**: il pulsante per fissare (in alto a destra al passaggio del mouse su una scheda) solleva una scheda nella sezione **Fissate**.
- **Disposizione**: trascina le schede per riordinarle; l'ordine vive nel file `.base` e si sincronizza con esso. Le schede non ancora disposte (catturate di recente o create dall'esterno) compaiono in cima, dalla più recente. Se sotto **Configura** è impostata una regola di ordinamento, questa prevale — il trascinamento viene allora disattivato.
- **Etichette**: la barra dei chip sopra la bacheca filtra le schede — per impostazione predefinita per tag, commutabile su una proprietà a selezione multipla (**Configura** → **Origine delle etichette**). Selezionare più chip filtra in combinazione (E); la selezione è effimera e non viene mai scritta nel file. Modifica le etichette di una scheda tramite **Etichette** nel menu contestuale della scheda.
- **Colore**: il menu contestuale tinge la scheda. Il colore è il colore dell'intestazione della nota (`plainva.header_color`) — si applica ovunque la nota compaia, inclusa l'intestazione dell'editor.
- **Proprietà**: le proprietà spuntate in **Configura** → **Proprietà** vengono visualizzate come righe compatte in fondo a ogni scheda — le date seguono il formato data della vista, i valori vuoti vengono omessi.
- **Mobile**: sul telefono, il tocco apre la nota, la pressione prolungata mostra le azioni (fissa, etichette, colore, elimina), trascinare dopo una pressione prolungata riordina. Suggerimento: punta il database sulla tua cartella Inbox (**Impostazioni** → **Cartelle**) e sia le note rapide del ＋ sia i testi condivisi da altre app finiscono direttamente sulla bacheca.

Nota per i vault sincronizzati: se due dispositivi dispongono la bacheca nello stesso momento, può comparire una copia `.CONFLICT` del file `.base` — a essere interessata è solo la disposizione, mai il contenuto delle note; elimina o unisci la copia.

## Uso quotidiano

- **Modifica in linea**: un singolo clic in una cella (o su un valore della scheda) la rende modificabile — in ogni vista.
- **Apertura**: cliccare sul titolo di una voce apre la nota nella finestra di anteprima — una finestra fluttuante che puoi trascinare dalla barra del titolo e ridimensionare dall'angolo. Mantiene una propria cronologia **Indietro**/**Avanti** per le note che apri al suo interno, ha un interruttore che mostra una colonna **Proprietà** per la nota visualizzata, e offre **Apri come scheda** e **Apri nella vista divisa**. `Ctrl`+clic apre direttamente nella vista divisa; in alternativa trascina una scheda sulla zona di rilascio **Rilascia qui: apri nella vista divisa**. La colonna delle proprietà si allarga o restringe trascinando il bordo sinistro (minimo 232 px); sotto i 280 px mette l'etichetta sopra il valore, come la barra laterale destra.
- **Trascinamento**: mentre trascini le schede (Bacheca, Calendario, Cronologia) una scheda fantasma segue il puntatore. In una **Bacheca** puoi anche trascinare un'**intestazione di colonna** per riordinare le colonne — per le bacheche **Selezione**/**Stato** questo riordina le opzioni della proprietà (così i menu a tendina in tutta l'app seguono l'ordine); le bacheche per relazione e testo libero ricordano l'ordine per ogni vista.
- **Colore della colonna**: nelle impostazioni della **Vista** di una bacheca, **Colore della colonna** permette a una colonna di assumere il colore del proprio gruppo — sia come **Intera colonna** (l'intera colonna viene colorata) sia come **Solo chip** (solo il chip nell'intestazione, l'impostazione predefinita). Si applica ai gruppi Selezione/Stato/Selezione multipla.
- **Incorporamento**: i database possono essere incorporati nelle note (comando slash **Incorpora database** o `@` → **Database**) e usati lì con piena funzionalità.
- **Ambito automatico dentro un elemento correlato**: quando incorpori un database dentro un singolo elemento di un database *correlato*, viene filtrato automaticamente su quell'elemento — incorpora il database delle attività dentro la nota di un progetto e vedrai solo le attività di quel progetto. Funziona in entrambe le direzioni (incorpora il lato "molti" per vedere le righe che puntano all'elemento ospitante, oppure il lato "uno" per vedere a cosa punta l'elemento ospitante) e anche per i database con auto-relazioni e una gerarchia genitore/sottoelementi (incorporare il database dentro un elemento ne mostra i sottoelementi, annidati). Una piccola etichetta **Filtro** nell'intestazione dell'incorporamento mostra su cosa è ristretto l'ambito; usala per cambiare la relazione o scegliere **Mostra tutto**. L'ambito non viene mai scritto nel file `.base`, quindi lo stesso database mostra le righe giuste in ogni elemento in cui è incorporato.
- **Le nuove voci ereditano il collegamento**: creare una voce con **Voce** dentro un incorporamento con questo ambito automatico la collega subito all'elemento ospitante (un'attività creata nell'elenco attività incorporato di un progetto appartiene subito a quel progetto). Nella direzione inversa è invece l'elemento ospitante a essere collegato alla nuova voce; una relazione a valore singolo già assegnata resta invariata.
- **Filtro esplicito "Questa nota" (come il filtro "questa pagina" di Notion)**: invece di affidarti all'ambito automatico, puoi renderlo esplicito e permanente. In **Configura → Filtro**, aggiungi una regola su una proprietà di relazione e scegli il valore **Questa nota**. Il database viene così ristretto alla nota in cui è incorporato — ideale per i **modelli**: incorpora il database delle attività in un modello di progetto, e ogni progetto creato da esso mostrerà le proprie attività. Funziona per qualsiasi proprietà wiki-link, non solo per le relazioni rilevate automaticamente, e un filtro esplicito **Questa nota** ha la precedenza sull'ambito automatico. Questo filtro vive solo in Plainva (non viene scritto nella `.base` come filtro normale), quindi sia Obsidian sia un'apertura autonoma mostrano tutte le righe.
- **Commenti su una cella**: se una proprietà porta annotazioni, la sua cella mostra un piccolo punto con il numero di thread aperti — in **Tabella**, **Board** e **Galleria**. Un commento è appeso alla **nota e alla sua chiave di proprietà**, non al `.base`: la stessa annotazione compare perciò in ogni database che mostra la nota, e nel pannello **Proprietà** della nota stessa. **Commenta questa proprietà** nel menu della cella avvia un nuovo thread. Rinominando una colonna i commenti la seguono; se la proprietà viene eliminata, la scheda resta leggibile e nomina il valore che aveva registrato. Maggiori dettagli in [Sicurezza e condivisione](Security_and_Sharing.md).

## Più voci alla volta

A volte un cambiamento non riguarda una voce, ma dodici.

**Commenti su una proprietà**: se una cella porta un piccolo fumetto con un numero, a quella proprietà è appesa un’annotazione — un clic lo apre sulla scheda corrispondente. Una nuova si avvia con un clic destro sulla cella, **Commenta la proprietà**; sul telefono la stessa voce sta in fondo al foglio che apre un tocco sulla cella. Viene scritta sulla nota, non sul database: la stessa annotazione compare in ogni vista che mostra questa proprietà e nel pannello delle proprietà della nota.

**Selezionare (desktop)**: Nella **tabella** e nell'**elenco**, ogni riga ha una casella di controllo davanti. Resta discreta finché non ne hai bisogno: appare quando il puntatore è sopra la riga, quando la tastiera la raggiunge, e per tutte le righe non appena qualcosa è selezionato. `Shift`+clic seleziona un intervallo, la casella di controllo dell'intestazione seleziona tutto. Un clic in una **cella** continua a modificarla — la selezione non gli toglie quel clic. Un clic su una casella già selezionata deseleziona la riga; con **Maiusc** estendi la selezione fino alla riga cliccata.

**Selezionare (telefono)**: Tieni premuta una riga e scegli **Seleziona più elementi** — è la prima voce del foglio. Da quel momento un tocco seleziona invece di aprire, finché non azzeri la selezione.

Mentre qualcosa è selezionato, una barra sostituisce la barra degli strumenti e mostra quante voci sono.

- **Elimina**: Viene posta UNA sola domanda, non dodici — ed è la stessa domanda a cascata di un'eliminazione singola (vedi sotto). Sul desktop lo fa anche il tasto `Canc`; mentre digiti in un campo, il tasto appartiene al campo.
- **Imposta un valore**: **Imposta valore…** chiede una proprietà e poi mostra l'editor che il suo tipo ha già. Sul telefono sono due fogli, e l'elenco delle proprietà dice **attualmente misto** dove le voci selezionate divergono. Un valore vuoto **rimuove** la proprietà, esattamente come svuotare una cella.

Mentre è in corso vedi l'avanzamento ("7 di 24") e puoi annullarlo — ciò che è già stato scritto resta e viene segnalato. Un singolo file che fallisce non interrompe l'operazione: alla fine ti viene detto quanti sono stati modificati e quanti no. Se il cambiamento riguarda una grande parte della vista, compare la stessa seconda domanda dell'eliminazione.

**Il limite, di proposito**: impostare funziona per proprietà con *un* valore — testo, numero, casella di controllo, data, selezione, stato, e-mail, telefono. **Non** per tag, elenchi, selezione multipla e relazioni: lì "imposta tutti su X" significherebbe che ogni valore esistente scompare. Questo richiede un proprio *aggiungi* e *rimuovi*, e arriverà più avanti.

## Eliminare con collegamenti (eliminazione a cascata)

Quando elimini qualcosa da cui dipendono altre voci, Plainva mostra una panoramica invece di una semplice domanda sì/no:

- **Elemento con elementi assegnati** (ad es. un progetto a cui puntano attività tramite una relazione): il dialogo elenca gli elementi assegnati — inclusi i loro stessi sottoelementi — raggruppati per database di origine, chiedendo **Elimina anche gli elementi assegnati**. Gli elementi **condivisi** (assegnati anche a un altro elemento) sono esclusi per impostazione predefinita e portano un badge tipo "anche 'Campagna T3'".
- **Eliminare un intero database**: quando elimini una `.base`, il dialogo chiede se devono sparire anche **tutti gli elementi** del database (**Elimina anche tutti gli elementi**). Gli elementi che sono anche righe di un *altro* database sono esclusi per impostazione predefinita. Le panoramiche di cartella (`index.md`) e gli allegati restano sempre.
- **Database collegati**: ogni database collegato tramite una relazione riceve una propria scheda chiaramente denominata con due passaggi — prima solo gli elementi **assegnati**, facoltativamente **l'intero** database (file più ogni elemento). Entrambi i passaggi sono **disattivati** per impostazione predefinita: nulla di un database collegato viene eliminato senza il tuo segno di spunta esplicito.

**Mostra elementi** apre un elenco per gruppo con una casella di controllo per ogni elemento, così puoi mantenere singoli elementi. Il pulsante rosso conta dal vivo ("Elimina 15 file"). **Pulisci i riferimenti** (attivo per impostazione predefinita) rimuove dalle proprietà delle note rimanenti i riferimenti agli elementi eliminati; i link nel corpo del testo restano intatti. Oltre la nota soglia per le eliminazioni di massa compare anche la seconda richiesta di sicurezza, e con la sincronizzazione attiva l'eliminazione raggiunge anche il cloud. Ogni file eliminato conserva uno snapshot di versione — recuperabile tramite **Ripristina i file eliminati**. Se viene eliminato il database configurato come **Database attività predefinito**, Plainva reimposta quell'impostazione e rimuove le assegnazioni dei modelli; le attività su Google/Microsoft restano intatte. Sul telefono la stessa panoramica appare come un foglio con segni di spunta per gruppo e un contatore (senza esclusione per singolo elemento).

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

## Il calendario di un database: mese, settimana, giorno

La vista calendario mostra tre periodi — **Mese**, **Settimana** e **Giorno**. Il selettore sta in alto accanto a **Oggi**; ◀ e ▶ si spostano sempre del periodo che stai guardando. Il cambio conserva il giorno su cui ti trovi: da **Mese** a **Settimana** vedi la settimana che contiene quel giorno.

Se la colonna della data porta un **orario**, questo compare prima del titolo e le voci di un giorno sono ordinate secondo l'orologio — quelle senza orario seguono sotto. L'**inizio settimana** segue la tua impostazione in **Aspetto**, esattamente come nel calendario vero.

Se la vista ha anche una **data di fine** (Configura → Vista), una voce su più giorni è disegnata come **una barra** sui suoi giorni, non come una catena di schede uguali. Dove esce dalla settimana la barra viene tagliata al bordo e prosegue senza ripetere il titolo.

## La cronologia: barre, bordi, colore

La cronologia mostra **una riga per voce** e, al suo interno, una **barra** dalla data di inizio a quella di fine. In alto passi tra **Settimana**, **3 settimane** e **Trimestre**; una linea verticale segna **oggi** su tutte le righe.

**I bordi di una barra sono maniglie.** Trascina il bordo destro e Plainva scrive la **data di fine** nella nota; il bordo sinistro scrive la **data di inizio**. Trascina la barra stessa e le due date si spostano insieme — la sua lunghezza resta quella che era. Due cose che nessun gesto può forzare: un bordo non supera mai l'altro (una fine prima del suo inizio sarebbe un record rotto) e, senza una **data di fine** configurata, non ne viene inventata alcuna — allora si muove solo l'inizio.

Una barra che va oltre il periodo mostrato viene tagliata al bordo e lì **non porta maniglia**: quello che vedi è il bordo della finestra, non la fine della voce.

**Colore per proprietà:** in Configura → Vista scegli una proprietà di selezione, stato o selezione multipla sotto **Colore per**. Le barre assumono allora il colore del loro valore — lo stesso che porta come chip e sulla lavagna. Senza questa scelta ogni barra mantiene il colore d'accento.
