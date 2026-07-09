# Per iniziare

Stand: 2026-07-09

Questa pagina ti accompagna dall'installazione al tuo primo lavoro vero e proprio: aprire o creare un vault, conoscere l'interfaccia e capire le tre modalità dell'editor.

## Cos'è un vault?

Un vault è una normale cartella sul tuo computer che contiene le tue note Markdown. Plainva aggiunge una sottocartella nascosta `.plainva/` per l'indice di ricerca e le impostazioni — le tue note stesse restano semplici file `.md` invariati. Puoi avere più vault (ad es. "Personale" e "Lavoro") e passare dall'uno all'altro.

## Aprire o creare un vault

All'avvio, la schermata di benvenuto ti accoglie con:

- **Apri vault locale** — scegli una cartella esistente di file Markdown (i vault di Obsidian funzionano immediatamente).
- **Crea nuovo vault** — inizia da vuoto o da una struttura di cartelle già pronta; entrambi modificabili in qualsiasi momento. Il **Vault vuoto** contiene solo una panoramica `index.md`. Modelli disponibili: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** e **Journal** — ognuno crea cartelle, una nota di benvenuto con una guida rapida e panoramiche `index.md` mantenute automaticamente nel [formato OKF](OKF.md) (i nomi di cartelle e file seguono la lingua dell'app). Il modello **Journal** collega inoltre le impostazioni delle note giornaliere del vault. I modelli **PARA**, **GTD**, **Zettelkasten** e **Journal** includono anche [database](Databases_Base.md) già collegati con modelli di nota corrispondenti — ad esempio progetti con una bacheca di stato e un link all'area, oppure attività che rimandano al loro progetto.
- **Apri vault online** — scegli il tuo provider cloud: **WebDAV / Nextcloud** si connette direttamente (inserisci l'URL del server, il nome utente e la password o il token dell'app, poi **Sfoglia il server**); per **Google Drive**, **OneDrive**, **Dropbox** e **Archiviazione compatibile S3** scegli prima una cartella locale di sincronizzazione — la configurazione si apre poi automaticamente nelle Impostazioni (vedi [Configurare la sincronizzazione](Sync_Setup.md)).

**Vault recenti** elenca tutto ciò che hai già aperto in precedenza. **Rimuovi dalla lista** rimuove una voce solo da Plainva — i file restano sul disco. Attiva **Apri automaticamente l'ultimo vault all'avvio** per saltare la schermata di benvenuto in futuro. Alla rimozione, Plainva chiede se dimenticare anche tutti i dati dell'app del vault (indice di ricerca, impostazioni, layout della finestra, credenziali di sincronizzazione; i backup ZIP automatici solo tramite la casella aggiuntiva) — la tua cartella del vault resta comunque intatta.

## L'interfaccia

- **Barra laterale sinistra** — tre viste: **File** (l'albero dei file), **Tag** (tutti i `#tag` nel vault) e **Segnalibri**. In alto si trova il grande pulsante **Nuovo** (Nuova nota, più **Altre opzioni** per Nuova cartella, Nuovo database, Nota giornaliera). In basso: il selettore del vault, **Apri nota giornaliera** e **Impostazioni**. Il pulsante a doppia freccia accanto alle tre viste comprime o espande tutte le cartelle in una volta, e **Mostra nell'albero dei file** nel menu ⋮ dell'editor mostra la nota aperta direttamente nell'albero.
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

La modalità in cui si aprono le note dipende da te: scegli la **Vista predefinita** in **Impostazioni → Generali** (lettura, dal vivo o sorgente). Cambiare la modalità nell'editor si applica a quel file per la sessione corrente.

Puoi anche alternare tra **Larghezza leggibile** e **Larghezza piena**.

## Le basi dell'albero dei file

- **Creazione:** clic destro su una cartella → **Nuova nota qui**, **Nuova cartella** o **Nuovo database (.base)**. Il grande pulsante **Nuovo** crea all'interno della cartella attualmente selezionata (o della cartella genitore di un file selezionato).
- **Selezione:** un clic seleziona, `Ctrl`+clic aggiunge/rimuove singolarmente, `Shift`+clic seleziona un intervallo, il clic centrale apre in una nuova scheda.
- **Menu contestuale:** include **Rinomina** (aggiorna i link in tutto il vault), **Duplica**, **Apri nella vista divisa (destra)** / **Apri nella vista divisa (in basso)**, **Aggiungi segnalibro**, **Copia percorso**, **Mostra in Esplora file**, **Elimina**.
- **Selezione multipla:** eliminare chiede conferma una sola volta per tutti gli elementi, duplicare e spostare trascinando funzionano sull'intera selezione. Gli elementi eliminati finiscono nel cestino del sistema operativo.
- Le nuove note iniziano automaticamente con un `# Titolo` derivato dal nome del file.

## Note giornaliere

**Apri nota giornaliera** (o un clic su una data nel **Calendario** a destra) apre o crea la nota di oggi. Configura la cartella base, il formato della data e un modello opzionale in **Impostazioni → Impostazioni del vault → Note giornaliere e modelli**.

Nel calendario, il pulsante **Oggi** torna al mese corrente; un clic sull'etichetta del mese apre un selettore rapido di mese/anno. Lì puoi anche attivare **Mostra i numeri di settimana** per aggiungere una colonna con la settimana ISO — l'impostazione viene ricordata.

## Impostazioni

Le **Impostazioni** (icona a forma di ingranaggio in basso nella barra delle azioni all'estrema sinistra, o `Ctrl+,`) si chiudono con la **X** in alto a destra, `Esc` o un clic fuori dalla finestra. Le modifiche vengono salvate subito e automaticamente — solo le credenziali di sincronizzazione vengono applicate deliberatamente tramite **Salva**/**Connetti** (vedi [Configurare la sincronizzazione](Sync_Setup.md)). Le impostazioni si dividono in due parti:

- **Generali** — il selettore del **Tema** come schede di anteprima: oltre a **Petrolio** (predefinito) trovi **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Carta** (simile a un e-ink, massimamente calmo), **Seppia** (carta calda), **Foresta**, **Mezzanotte** (nero OLED), **Alto contrasto** e **Fosforo verde**/**Fosforo ambra** (terminale retrò con scanline discrete). Più la **Modalità** (**Chiaro**/**Scuro**/**Predefinito di sistema**) — i temi a modalità unica come **Mezzanotte** (solo scuro) fissano la modalità, e l'interruttore chiaro/scuro nella barra del titolo si mette in pausa mentre sono attivi. Anche qui: **Lingua**, aggiornamenti (Plainva controlla silenziosamente le nuove versioni all'avvio e mostra un avviso quando ne trova una — disattivabile tramite **Cerca aggiornamenti all'avvio**), **Mostra le scorciatoie da tastiera** (anche con `F1`), **Avvisi**, **Diagnostica di sistema** (ad es. lo stato del **Portachiavi del sistema operativo**) e **Informazioni e diagnostica** (dettagli sulla versione, **Esporta diagnostica…** — senza contenuti delle note — e **Segnala un problema**).
- **Impostazioni del vault** — per vault: **Sincronizzazione cloud** (vedi [Configurare la sincronizzazione](Sync_Setup.md)), **Note giornaliere e modelli** (inclusa la **Cartella dei modelli**), **OKF (Open Knowledge Format)** (vedi [OKF](OKF.md)) e **Database estesi**.

## Personalizzare l'interfaccia

- **Attiva/disattiva le barre laterali** tramite i due pulsanti nella barra del titolo o con `Ctrl+Alt+B` (sinistra) / `Ctrl+Alt+R` (destra) — ideale per scrivere concentrati. Plainva ricorda lo stato.
- **Palette dei comandi**: `Ctrl+P` apre **Comandi** — digita e premi `Invio` per eseguire (nuova nota, nota giornaliera, dividi, barre laterali, **Esegui backup ora** e altro ancora).
- **Densità**: in **Impostazioni → Generali**, scegli tra **Comodo** e **Compatto** — Compatto restringe elenchi, menu e righe di tabella; il contenuto delle note resta invariato.
- **Finestre di dialogo e notifiche native-free**: le conferme appaiono come finestre di dialogo Plainva nello stile del tuo tema (le azioni distruttive hanno un pulsante rosso), gli avvisi brevi come notifiche discrete in basso a destra — niente più popup di sistema.

## Il grafo

Tramite **Ctrl/Cmd+Shift+G** (o la sezione **Grafo** nella barra laterale destra) vedi il tuo vault come una mappa: cartelle come bolle, note come nodi, relazioni come archi etichettati — inclusa una modalità di pulizia e il viaggio nel tempo. Dettagli: [Grafo](Graph.md).

## Vedi anche

- [Note e Markdown](Notes_and_Markdown.md) — tutto sulla scrittura
- [Scorciatoie da tastiera](Keyboard_Shortcuts.md)
- [FAQ e risoluzione dei problemi](FAQ.md)
