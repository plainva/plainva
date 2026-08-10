# Per iniziare

Ultimo aggiornamento: 2026-08-10

Questa pagina ti accompagna dall'installazione al tuo primo lavoro vero e proprio: aprire o creare un vault, conoscere l'interfaccia e capire le tre modalità dell'editor.

## Requisiti di sistema

Plainva disegna la sua finestra con il motore web del sistema: è il motore, non il processore, a fissare la soglia minima:

- **Windows** 10 o successivo con il runtime WebView2 (Windows 11 lo include; su 10 lo aggiunge il programma di installazione)
- **macOS 13 (Ventura)** o successivo, Apple Silicon o Intel
- **Linux** con WebKitGTK 2.40 o successivo (verifica con `pkg-config --modversion webkit2gtk-4.1`)

Su un sistema al di sotto di questa soglia Plainva te lo dice all'avvio invece di aprire una finestra vuota.

## Cos'è un vault?

Un vault è una normale cartella sul tuo computer che contiene le tue note Markdown. Plainva aggiunge una sottocartella nascosta `.plainva/` per l'indice di ricerca e le impostazioni — le tue note stesse restano semplici file `.md` invariati. Puoi avere più vault (ad es. "Personale" e "Lavoro") e passare dall'uno all'altro.

## Aprire o creare un vault

Al **primissimo** avvio — prima che tu abbia mai aperto un vault — Plainva mostra, una sola volta, un breve messaggio di benvenuto. In tre righe spiega su cosa si basa Plainva, mostra accanto una piccola anteprima dell'interfaccia e offre subito i tre modi per entrare: **Apri vault**, **Nuovo vault** e **Importa da un'altra app**. **Più tardi** lo salta e ti lascia sulla normale schermata di benvenuto; non ricompare — a meno che tu non lo richiami di nuovo in **Impostazioni → Avvio e comportamento → Schermata di benvenuto**.

Dopo un aggiornamento, lo stesso punto mostra cosa è cambiato: la novità più importante di quella versione con un titolo proprio, e il resto in una riga ciascuna. Questo compare una volta per versione — puoi richiamarlo di nuovo in qualsiasi momento in **Impostazioni → Avvio e comportamento → Mostra di nuovo le novità**.

All'avvio, la schermata di benvenuto ti accoglie con:

- **Apri vault** — Plainva chiede prima **"Dove si trova il tuo vault?"**: **Cartella locale** apre una cartella esistente di file Markdown su questo computer (anche i vault di Obsidian funzionano immediatamente); **Vault online** sincronizza un vault esistente dal cloud in una cartella locale — con tutti i provider negli stessi tre passaggi (**Connetti**, **scegli la cartella nel cloud**, **scegli la cartella locale**; vedi [Configurare la sincronizzazione](Sync_Setup.md)).
- **Nuovo vault** — la prima domanda è **"Dove deve trovarsi il tuo vault?"** (**Su questo computer** o **Presso un servizio online**), poi scegli la struttura iniziale: inizia da vuoto o da una struttura di cartelle già pronta; entrambi modificabili in qualsiasi momento. Il **Vault vuoto** contiene solo una panoramica `index.md`. Modelli disponibili: **Plainva Tour**, **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** e **Journal** — ognuno crea cartelle, una nota di benvenuto con una guida rapida e panoramiche `index.md` mantenute automaticamente nel [formato OKF](OKF.md) (i nomi di cartelle e file seguono la lingua dell'app). Il modello **Plainva Tour** è il punto di partenza consigliato: riempie nove cartelle e sette database con esempi, così vedi ogni vista in azione una volta — bacheca, calendario, galleria, board, timeline, tabella e la vista ad albero con sottoelementi — oltre a modelli di nota, regole per le cartelle e una guida rapida Markdown. Qui non c'è nulla di prezioso: elimina ciò che non ti serve e rinomina il resto. Il modello **Journal** collega inoltre le impostazioni delle note giornaliere del vault. I modelli **Plainva Tour**, **PARA**, **GTD**, **Zettelkasten** e **Journal** includono anche [database](Databases_Base.md) già collegati con modelli di nota corrispondenti — ad esempio progetti con una bacheca di stato e un link all'area, oppure attività che rimandano al loro progetto. Nel percorso online, dopo il modello segue la connessione: scegli il provider, connettiti, scegli la cartella nel cloud o creane una nuova tramite **Nuova cartella**, scegli la cartella locale — la struttura scelta viene creata nella cartella locale e caricata nel cloud alla prima sincronizzazione.

**Vault recenti** elenca tutto ciò che hai già aperto in precedenza. **Rimuovi dalla lista** rimuove una voce solo da Plainva — i file restano sul disco. Attiva **Apri automaticamente l'ultimo vault all'avvio** per saltare la schermata di benvenuto in futuro. Alla rimozione, Plainva chiede se dimenticare anche tutti i dati dell'app del vault (indice di ricerca, impostazioni, layout della finestra, credenziali di sincronizzazione, calendario e caselle di posta; i backup ZIP automatici solo tramite la casella aggiuntiva) — la tua cartella del vault resta comunque intatta.

## L'interfaccia

- **Barra laterale sinistra** — tre viste: **File** (l'albero dei file), **Tag** (tutti i `#tag` nel vault) e **Database** (ogni `.base` nel vault, raggruppato per cartella — un clic per aprirlo); Segnalibri e Aperti di recente sono sezioni sopra l'albero. In cima si trova il campo di ricerca, con un **+** accanto per Nuova nota, Nuova cartella, Nuovo database e Nota giornaliera. Il testo segnaposto del campo di ricerca indica cosa si sta cercando, e le schede mostrano il proprio nome finché il pannello è abbastanza largo — man mano che si restringe, prima solo la scheda attiva mantiene il nome, poi restano solo le icone. In basso: il selettore del vault, **Apri nota giornaliera** e **Impostazioni**. Il pulsante a doppia freccia accanto alle tre viste comprime o espande tutte le cartelle in una volta, e **Mostra nell'albero dei file** nel menu ⋮ dell'editor mostra la nota aperta direttamente nell'albero. Nella vista **File**, un'intestazione mostra il nome e l'icona del vault corrente, e una striscia **Aperti di recente** sopra l'albero permette l'accesso con un clic alle note che avevi aperto più di recente.
- **Barra del titolo** — le tue schede aperte. Le schede possono essere riordinate trascinandole e spostate tra i riquadri dell'editor.
- **Area dell'editor** — dove leggi e scrivi. Tramite il menu della scheda (**Dividi a destra** / **Dividi in basso**) o le scorciatoie `Ctrl+Alt+V` / `Ctrl+Alt+S` dividi l'editor in due riquadri, ad es. una nota accanto a un database.
- **Barra laterale destra** — quattro sezioni, riordinabili trascinandole: **Calendario** (note giornaliere), **Struttura** (i titoli della nota attiva), **Backlink** (chi collega qui) e **Proprietà** (il frontmatter della nota).
- **Barra di stato** — conteggio di parole/caratteri, stato di sincronizzazione (Locale/Online/Offline) e stato di salvataggio (**Salvataggio...** / **Salvato**).

## Le tre modalità dell'editor

Cambia modalità in alto a destra nell'editor:

| Modalità | A cosa serve |
|---|---|
| **Modalità lettura** | Vista completamente renderizzata per leggere e navigare. I link si aprono direttamente in Plainva. |
| **Anteprima dal vivo** | Predefinita per scrivere: il Markdown viene renderizzato mentre digiti; i caratteri di formattazione compaiono solo dove stai lavorando. |
| **Sorgente Markdown** | Il testo grezzo senza rendering — per il controllo completo. |

La modalità in cui si aprono le note dipende da te: scegli la **Vista predefinita** in **Impostazioni → App → Editor e note** (lettura, dal vivo o sorgente). Cambiare la modalità nell'editor si applica a quel file per la sessione corrente.

Puoi anche alternare tra **Larghezza leggibile** e **Larghezza piena**.

## Le basi dell'albero dei file

- **Creazione:** clic destro su una cartella → **Nuova nota qui**, **Nuova cartella** o **Nuovo database (.base)**. Il grande pulsante **Nuovo** crea all'interno della cartella attualmente selezionata (o della cartella genitore di un file selezionato).
- **Selezione:** un clic seleziona, `Ctrl`+clic aggiunge/rimuove singolarmente, `Shift`+clic seleziona un intervallo, il clic centrale apre in una nuova scheda.
- **Menu contestuale:** include **Rinomina** (aggiorna i link in tutto il vault), **Duplica**, **Apri nella vista divisa (destra)** / **Apri nella vista divisa (in basso)**, **Aggiungi segnalibro**, **Copia percorso**, **Mostra in Esplora file**, **Elimina**.
- **Le stesse azioni nelle sezioni sopra l'albero:** un clic destro su una voce in **Aperti di recente** o **Segnalibri** apre lo stesso menu — senza le voci per le cartelle, ma con in più **Rimuovi dall'elenco** (questo rimuove solo la voce dall'elenco, mai il file). Qui rinominare avviene tramite una finestra di dialogo anziché nel campo della riga. Anche le viste calendario e attività possono comparire in **Aperti di recente**; possono essere aperte e rimosse dall'elenco, ma non rinominate né eliminate — sono viste, non file.
- **Selezione multipla:** eliminare chiede conferma una sola volta per tutti gli elementi, duplicare e spostare trascinando funzionano sull'intera selezione. Gli elementi eliminati finiscono nel cestino del sistema operativo.
- Le nuove note iniziano automaticamente con un `# Titolo` derivato dal nome del file.
- La `index.md` di una cartella (la sua panoramica) si posiziona nell'albero in **cima** a quella cartella, sopra le sue sottocartelle e i suoi file — non in ordine alfabetico tra le altre note.
- **Rileggi:** la freccia circolare nell'intestazione dell'albero (o **F5**) rilegge il vault — Plainva riconcilia l'indice con la cartella e, per i vault online, scarica anche i file dal cloud. Un breve resoconto indica poi cosa era nuovo, modificato, rimosso o saltato. Per una singola cartella c'è **Rileggi questa cartella** nel menu contestuale.

## Note giornaliere

Il pulsante **Nota giornaliera** nella barra delle azioni a sinistra apre o crea la nota di oggi. Configura la cartella base, il formato della data e un modello opzionale in **Impostazioni → Vault → Contenuto e struttura** (**Scegli cartella…** accanto al campo permette di scegliere la cartella direttamente nel vault).

Il formato della data usa gli stessi token di Obsidian: `YYYY` anno, `MM` mese, `DD` giorno, `dddd` nome del giorno — `YYYY-MM-DD dddd` produce `2026-07-29 Wednesday`. Il testo che deve restare invariato va tra parentesi quadre: `[Diario] YYYY-MM-DD`. I nomi di mesi e giorni sono sempre in inglese, così cambiare la lingua dell’app non rende mai introvabili le note giornaliere esistenti.

Il **Calendario** a destra è una panoramica del giorno: un **clic** su una data apre la [scheda del calendario](Calendar_and_Tasks.md) in quel giorno; un **clic destro** apre un menu che indica il giorno in alto e offre **Apri calendario**, **Nota giornaliera** e gli eventi e le attività in scadenza di quel giorno. I giorni con una nota giornaliera hanno un piccolo **simbolo del sole**, i giorni con eventi hanno puntini colorati per calendario. Il pulsante **Oggi** torna al mese corrente; un clic sull'etichetta del mese apre un selettore rapido di mese/anno. Lì puoi anche attivare **Mostra i numeri di settimana** per aggiungere una colonna con la settimana ISO — l'impostazione viene ricordata.

## Impostazioni

Le **Impostazioni** (icona a forma di ingranaggio in basso nella barra delle azioni all'estrema sinistra, o `Ctrl+,`) si chiudono con la **X** in alto a destra, `Esc` o un clic fuori dalla finestra. Le modifiche vengono salvate subito e automaticamente — solo le credenziali cloud vengono applicate deliberatamente tramite **Accesso** nell'area **Account cloud** (vedi [Configurare la sincronizzazione](Sync_Setup.md)). Le impostazioni si dividono in due parti; ogni area nella barra laterale sinistra apre la propria pagina, dove le impostazioni si trovano in schede di gruppo denominate:

- **App** — tutto ciò che vale per l'intera app, suddiviso in cinque aree. **Aspetto**: il selettore **Tema** come schede di anteprima — oltre a **Petrolio** (predefinito) trovi **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Carta** (simile a un e-ink, massimamente calmo), **Seppia** (carta calda), **Foresta**, **Mezzanotte** (nero OLED), **Alto contrasto** e **Fosforo verde**/**Fosforo ambra** (terminale retrò con scanline discrete); più la **Modalità** (**Chiaro**/**Scuro**/**Predefinito di sistema**; i temi a modalità unica come **Mezzanotte** fissano la modalità, e l'interruttore chiaro/scuro nella barra del titolo si mette in pausa mentre sono attivi), **Lingua**, **Inizio settimana**, **Densità** e **Zoom dell'interfaccia**. **Editor e note**: **Vista predefinita**, **Dimensione carattere del contenuto** e **Carattere del contenuto**. **Avvio e comportamento**: apertura automatica dell'ultimo vault, avvisi di compatibilità. **Aggiornamenti**: Plainva controlla silenziosamente le nuove versioni all'avvio e mostra un avviso quando ne trova una — un clic su di esso scarica e installa subito l'aggiornamento (l'avviso resta visibile fino al riavvio di Plainva). Disattivabile tramite **Cerca aggiornamenti all'avvio**. **Informazioni e diagnostica**: dettagli sulla versione, lo stato del **Portachiavi del sistema operativo**, **Metriche di prestazioni**, **Esporta diagnostica…** (senza contenuti delle note) e **Segnala un problema**. Le scorciatoie da tastiera restano raggiungibili in qualsiasi momento tramite `F1` o **Mostra le scorciatoie da tastiera** in basso a sinistra.
- **Vault** — il vault selezionato è mostrato come una piccola scheda nella barra laterale (il vault attivo porta un punto); con più vault, **Cambia** sotto di essa apre un elenco di selezione. Sotto, le aree per vault: **Account cloud** è l'unico posto per tutti gli accessi cloud — **Collega account…** sceglie il provider (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV o una casella e-mail) e i servizi (**File**, **Calendario e attività**, **E-mail**) che quell'account deve portare. Le aree di servizio **Sincronizzazione** (vedi [Configurare la sincronizzazione](Sync_Setup.md)), **Calendario** (vedi [Calendario e attività](Calendar_and_Tasks.md)) ed **E-mail** (vedi [Cattura e-mail](Email_Capture.md)) compaiono solo quando un account collegato porta quel servizio. Sempre presenti: **Contenuto e struttura** (**Note giornaliere**, **Modelli e attività** inclusa la **Cartella dei modelli** e le regole **cartella → modello** e **tipo di nota → modello** (valide anche sul telefono), la **Cartella Inbox**, la **Cartella degli allegati**, **OKF (Open Knowledge Format)** — vedi [OKF](OKF.md) — e **Database estesi**), **Backup e cronologia delle versioni** e **Manutenzione** (**Ricostruisci indice**, ripristina i file eliminati, statistiche del vault).

## Tabs

- **Clic destro su una scheda** per aprire il suo menu: **Blocca**, **Ricarica**, **Apri nella vista divisa (destra)**, **Copia percorso**, **Mostra in Esplora file** e il gruppo di chiusura.
- **Blocca** tiene ferma una scheda: si sposta all'inizio della barra delle schede, mostra una puntina invece della croce di chiusura e sopravvive a ogni **Chiudi le altre** / **Chiudi a sinistra** / **Chiudi a destra** / **Chiudi tutto**. Per chiuderla, tocca prima **Sblocca**.
- **Ricarica** scarta la vista attuale e rilegge il file dal disco — utile quando un altro programma lo ha modificato. Se la scheda ha modifiche non salvate, Plainva rifiuta di ricaricare piuttosto che sovrascrivere il tuo lavoro.

## Barre e aree

La barra delle azioni all'estrema sinistra, le schede della barra laterale sinistra, le sezioni sopra l'albero dei file e le sezioni della barra laterale destra funzionano tutte allo stesso modo.

La barra delle azioni offre **Nuova nota**, **Nuova cartella** e **Nuovo database**. Tutte e tre creano l'elemento all'interno della **cartella selezionata** nell'albero dei file; con un file selezionato, nella cartella di quel file; senza nulla selezionato, alla radice. La **Nota giornaliera** non segue questa regola — appartiene sempre alla cartella che hai indicato per essa nelle impostazioni. Se non ti serve una delle tre, nascondila.

**Proprio dove si trovano:** **tieni premuto** su un pulsante o su un'intestazione di sezione e trascinalo nella sua nuova posizione — un semplice clic continua solo ad attivarlo, e se scorri mentre tieni premuto, scorri (il trascinamento viene annullato). `Esc` annulla un trascinamento in corso. Un **clic destro** offre le stesse azioni senza tenere premuto: **Sposta in alto**, **Nascondi** e **Personalizza le barre…**.

**In un unico posto:** sotto **Impostazioni → Vault → Barre e aree** tutte e cinque le barre stanno una sotto l'altra — compresa la barra di navigazione del telefono, che puoi quindi organizzare sullo schermo grande. Ognuna è **un'unica** lista con una linea di separazione: tutto ciò che sta sopra è visibile, tutto ciò che sta sotto è nascosto. Qui sposti le voci con la maniglia di trascinamento — in questa pagina si sta ordinando proprio una lista, esattamente ciò a cui serve una maniglia. Trascinando fino al bordo superiore o inferiore, la pagina scorre di conseguenza, così una voce può spostarsi dal fondo fino in cima in un unico movimento.

Due cose non possono deliberatamente essere nascoste: **Mostra le scorciatoie da tastiera** e **Impostazioni** in fondo alla barra delle azioni, e la scheda **File** della barra laterale sinistra. Tutto il resto puoi nasconderlo a tuo piacimento; le azioni nascoste della barra restano raggiungibili dalla **palette dei comandi** (`Ctrl+P`). Le sezioni della barra laterale destra che non hanno nulla da mostrare per la nota aperta non compaiono mai.

Questa disposizione appartiene al vault e viaggia sui tuoi altri dispositivi tramite [Configurare la sincronizzazione](Sync_Setup.md). Un vault che non hai adattato segue il tuo **valore predefinito** — impostalo con **Salva come predefinito**, e **Ripristina il valore predefinito** riporta a quel valore un vault adattato.

## Personalizzare l'interfaccia

- **Attiva/disattiva le barre laterali** tramite i due pulsanti nella barra del titolo o con `Ctrl+Alt+B` (sinistra) / `Ctrl+Alt+R` (destra) — ideale per scrivere concentrati. Plainva ricorda lo stato.
- **Palette dei comandi**: `Ctrl+P` apre **Comandi** — digita e premi `Invio` per eseguire (nuova nota, nota giornaliera, dividi, barre laterali, **Esegui backup ora** e altro ancora).
- **Densità**: in **Impostazioni → App → Aspetto**, scegli tra **Comodo** e **Compatto** — Compatto restringe elenchi, menu e righe di tabella; il contenuto delle note resta invariato.
- **Carattere del contenuto**: in **Impostazioni → App → Editor e note** imposta la **Dimensione carattere del contenuto** (12–24 px) e il **Carattere del contenuto** (**Predefinito del tema**, **Serif**, **Sans-serif**, **Monospazio** oppure **Personalizzato…**, con il nome di un carattere installato) — questo scala solo l'editor e la vista di lettura; l'interfaccia resta invariata.
- **Zoom dell'interfaccia**: scala l'INTERA interfaccia tra l'80 % e il 150 % — in **Impostazioni → App → Aspetto** oppure con `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` ripristina).
- **Finestre di dialogo e notifiche native-free**: le conferme appaiono come finestre di dialogo Plainva nello stile del tuo tema (le azioni distruttive hanno un pulsante rosso), gli avvisi brevi come notifiche discrete in basso a destra — niente più popup di sistema.

## Il grafo

Tramite **Ctrl/Cmd+Shift+G** (o la sezione **Grafo** nella barra laterale destra) vedi il tuo vault come una mappa: cartelle come bolle, note come nodi, relazioni come archi etichettati — inclusa una modalità di pulizia e il viaggio nel tempo. Dettagli: [Grafo](Graph.md).

## Vedi anche

- [Note e Markdown](Notes_and_Markdown.md) — tutto sulla scrittura
- [Scorciatoie da tastiera](Keyboard_Shortcuts.md)
- [FAQ e risoluzione dei problemi](FAQ.md)

## Memoria della barra laterale destra

Le sezioni che non hanno nulla da mostrare per la nota aperta — **Struttura**, **Backlink**, **Proprietà**, **Database** — non compaiono affatto, invece di restare lì in grigio. L’intera barra laterale destra ricorda un’unica preferenza globale per le note; le viste a schermo intero senza contesto nota la chiudono solo temporaneamente.

**Quando trascini il pannello per restringerlo** cambia in tre passaggi, così niente si rompe:

- **280 px e oltre** — come al solito.
- **232–280 px** — le proprietà mettono il nome sopra il valore invece che accanto, i valori lunghi vanno a capo, le sezioni si stringono.
- **sotto i 232 px** — il calendario mostra **una settimana invece del mese** (sette giorni, numero della settimana in basso a destra); una griglia mensile avrebbe qui celle da 14 pixel e smetterebbe di essere un calendario. Il grafo diventa più corto, e i backlink mostrano il nome del file senza la riga del percorso.

La barra laterale destra non può scendere sotto i **200 px** — nessuna sezione è utilizzabile al di sotto. Quella sinistra scende ancora fino a 150 px, perché i nomi dei file si troncano semplicemente.
