# Grafo

Ultimo aggiornamento: 2026-07-14

Il grafo di Plainva è uno strumento di lavoro, non un poster: ti mostra dove sei, cosa è collegato, cosa manca — e puoi agire direttamente su di esso. C'è UN motore del grafo con tre facce.

## Grafo contestuale (barra laterale destra)

Apri la sezione **Grafo** nella barra laterale destra. Mostra la nota attiva al centro, la struttura delle cartelle sopra, per le panoramiche di cartella (index.md) le note contenute sotto, i riferimenti in entrata a sinistra e quelli in uscita a destra. Le relazioni dai database portano il nome della loro proprietà come etichetta.

- Cliccare su un nodo apre la nota (il focus ruota con te).
- Ctrl/Cmd+clic apre in una divisione, il clic centrale in una nuova scheda.
- Trascina un nodo altrove e resta fissato (piccolo punto), memorizzato per nota — riapri quella nota e ritrovi il tuo layout. La nota attiva resta sempre al centro. L'**icona di fissaggio** in alto a destra attiva e disattiva la memorizzazione; disattivandola, il layout memorizzato di questa nota viene eliminato.
- Sotto, compaiono fino a tre **suggerimenti**: note che menzionano la tua nota attiva (ma non la collegano), sono spesso collegate insieme a essa, condividono un vicinato simile o condividono un tag raro. Se il titolo compare come testo nella nota attiva, il suggerimento mostra un'**anteprima del passaggio** che verrebbe collegato; **Collega** trasforma esattamente quel passaggio in un wiki-link (come `[[Destinazione|testo]]` quando il testo visibile differisce dalla destinazione). Se non esiste un passaggio corrispondente, il link viene aggiunto alla fine della nota (l'anteprima lo indica). **Ignora suggerimento** ricorda la tua decisione.

## Mappa del vault (scheda dedicata)

Apri la mappa con **Ctrl/Cmd+Shift+G**, tramite l'icona del grafo nella **barra delle azioni** all'estrema sinistra, oppure tramite la palette dei comandi (**Apri grafo**). Si apre in una scheda dedicata. Invece di una matassa, vedi la tua struttura di cartelle reale come bolle — un doppio clic su una bolla dispiega la cartella in un **cerchio contenitore** che racchiude le sue note e sottocartelle; le sottocartelle dispiegate si annidano al suo interno come su una mappa. Un doppio clic sul **bordo del cerchio** richiude la cartella, **Comprimi tutte le cartelle** chiude tutto. Il cerchio segue sempre il suo contenuto: sposta le note al suo interno e cresce con esse; trascina il bordo e la cartella si sposta insieme al suo contenuto. All'interno di un cerchio le note continuano a disporsi secondo i propri collegamenti, e gli archi corrono direttamente da nota a nota. Il layout è deterministico: la stessa mappa appare uguale ogni volta che la apri. **Sposta la mappa** con il tasto centrale del mouse o Ctrl/Cmd+trascina, e fai **zoom** con la rotellina del mouse. Trascina un nodo e resta fissato (piccolo punto). In alto a destra, l'**icona di fissaggio** attiva e disattiva la memorizzazione: disattivandola, il layout memorizzato di questa vista viene eliminato e torna il layout automatico (lo stesso effetto di **Reimposta layout** nel menu del clic destro). I fissaggi sono memorizzati per dispositivo.

Strumenti nella barra dell'intestazione:

- Stili degli archi a colpo d'occhio (legenda, in basso a sinistra): le **relazioni** sono linee di accento continue con un'etichetta, i **collegamenti** sono tratteggiati, gli **incorporamenti** sono punteggiati.
- **Cerca** attenua tutto ciò che non corrisponde. Filtra per **tipo** (OKF) e **tag**; i tipi di arco (**Collegamenti**, **Relazioni**, **Incorporamenti**) si attivano/disattivano singolarmente.
- Le note di panoramica gestite da Plainva (`index.md` e `log.md`) sono nascoste per impostazione predefinita — collegano quasi tutto e sovraccaricherebbero altrimenti il grafo; questo vale anche per il grafo contestuale e il grafo del database. Nella mappa del vault, le recuperi tramite il pulsante **Filtri** con la casella **Mostra index.md**.
- **Focus sulla selezione** riduce la mappa a una nota selezionata più 1–3 salti di vicinato.
- **Mappa di calore** illumina le note modificate di recente (7/30/90 giorni) — "su cosa stavo lavorando?"
- **Viaggio nel tempo** mostra le note in base alla loro data di creazione; il cursore riproduce la crescita del tuo vault. La data proviene da una proprietà `date`/`datum`, altrimenti dalla data di creazione del file (un'approssimazione per i vault solo cloud).

Lavorare sulla mappa:

- Trascina un nodo **su** un altro: Plainva propone di scrivere un link di testo — oppure direttamente una **relazione** corrispondente dai tuoi database (se la relazione consente esattamente una voce, Plainva chiede conferma prima di sostituire).
- Clic destro su un nodo: Apri, Anteprima, Apri nella divisione, **Nuova nota collegata**, Rinomina (con aggiornamento dei link in tutto il vault), Segnalibro, Elimina.
- Clic destro su uno spazio vuoto: **Nuova nota**, Reimposta layout, **Esporta come PNG/SVG**.
- Cliccare su un fascio di archi tra cartelle elenca i singoli link; passare il mouse su un arco mostra la frase in cui vive il link.
- **Trascinare su uno spazio vuoto** apre un rettangolo di selezione e contrassegna più note (Shift+trascina estende una selezione esistente); trascinando poi uno dei nodi contrassegnati, si spostano tutti insieme. Il piè di pagina offre segnalibro/elimina per la selezione.
- **Alt+trascinare un nodo** lo sposta insieme ai suoi vicini collegati direttamente — la nota e tutto ciò che si trova a un salto di distanza si riposizionano come gruppo; un nodo che si trova semplicemente nelle vicinanze ma non è collegato resta fermo.

## Pulizia

Il pulsante **Pulizia** apre un elenco di lavoro con tre schede: **Orfane** (note senza connessioni), **Link interrotti** (destinazioni che non esistono — **Crea nota** le crea) e **Menzioni** (**Scansiona il vault** trova i punti in cui una nota viene nominata ma non collegata; **Collega** trasforma l'occorrenza in un wiki-link). Il piè di pagina della mappa mostra il conteggio delle orfane — cliccarci apre il pannello.

## Grafo come vista database

Ogni database `.base` può ottenere una vista **Grafo** (aggiungi vista → **Grafo**): le righe del database diventano nodi, le tue **relazioni** diventano archi etichettati. Nella barra dell'intestazione scegli le proprietà degli archi, **Colore per** una proprietà di selezione, **Dimensione per** un numero e se le **destinazioni esterne** (relazioni che puntano fuori dal database) o le **relazioni in entrata** (relazioni da altri database che puntano a queste voci — ad es. le attività di un progetto) compaiono. La vista è salvata in modo compatibile con Obsidian: Obsidian mostra lo stesso file come una tabella.

## Limiti

- Il grafo mostra note (file), non singoli paragrafi.
- I fissaggi e i suggerimenti ignorati vivono sotto `.plainva/` e non viaggiano con la sincronizzazione — il layout di base è identico su ogni dispositivo.
- I suggerimenti sono pure analisi del vault; nulla lascia il tuo computer.
