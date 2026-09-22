# Diario

Ultimo aggiornamento: 2026-09-22

Il diario è il modo rapido per annotare qualcosa senza aprire una nota: un pensiero, una telefonata, una riga sulla giornata. Ogni voce è una normale riga di elenco con un orario — `- 14:05 Il router è in cantina` — sotto un'intestazione della **nota giornaliera di oggi**. Non c'è un nuovo formato di file né un database: le voci vivono nelle tue note giornaliere, leggibili in qualsiasi editor e compatibili con i plugin di diario di Obsidian (Thino, Knomo).

## Scrivere una voce

Un campo, un **Invio**. Plainva registra l'orario; tu scrivi solo il testo. Tag, link e una seconda riga si digitano semplicemente — il testo è Markdown ordinario.

- **Al desktop:** `Ctrl+Shift+J` apre il campo **Voce di diario** da qualsiasi punto di Plainva. Lo stesso campo si trova nel menu **＋** della barra laterale, nella palette dei comandi e nel menu del vassoio di sistema (**Voce di diario**). `Invio` salva, `Shift+Enter` inizia una nuova riga, `Esc` scarta.
- **Al telefono:** il pulsante **＋** offre **Voce di diario**; la schermata del diario ha un pulsante a penna tutto suo. Anche una pressione prolungata sull'icona dell'app offre **Voce di diario** — su Android come scorciatoia dell'app, su iOS come azione rapida. Lì `Invio` resta un'interruzione di riga; **Salva voce** salva.
- **Dal foglio di condivisione (telefono):** scegli Plainva e attiva **Nel diario** — testo e link diventano la voce, i file condivisi finiscono nella cartella degli allegati e vengono incorporati.
- **Con un'immagine:** il campo del telefono ha **Aggiungi foto**; al desktop incolli un'immagine dagli appunti nel campo. L'immagine va dove vanno gli allegati e viene incorporata nella voce.

Se la nota giornaliera di oggi non esiste ancora, viene creata al momento — dal tuo modello di nota giornaliera, senza porre le sue domande. Dopo il salvataggio, un avviso dice **Voce salvata** e offre **Annulla**.

Il campo fa una cosa sola: una voce di diario. Sotto, **Crea invece un'attività** passa ciò che hai scritto alla [vista attività](Tasks.md), dove l'attività nasce come sempre, e chiude il campo. Il chip **Come attività** è un'altra cosa: lascia la voce nel diario e le dà una casella (`- [ ] 14:05 ordinare il ricambio`), così compare anche nella vista attività sotto **Dalle note**. La casella del chip resta vuota finché non lo scegli.

## La vista del diario

**Apri diario** (barra delle azioni sul desktop, **Aree** al telefono, oppure la palette dei comandi) mostra tutti i giorni come un unico flusso: il giorno più recente in alto, e all'interno di un giorno la voce più recente per prima. I link si aprono, i tag sono pillole, un'immagine incorporata appare come anteprima, e una voce lunga è ripiegata — **Altro** la apre.

- **Cercare e filtrare:** il campo di ricerca cerca nei giorni caricati; i chip **Tutte**, **Solo attività** e i tag più frequenti restringono il flusso. Un clic su un tag in una voce filtra in base a esso.
- **Giorni più vecchi:** Plainva carica gli ultimi 14 giorni che hanno voci. **Carica precedenti** recupera il tratto successivo; **Vai a un giorno** apre il selettore di data, in cui i giorni con voci sono contrassegnati, e carica all'indietro fino al giorno che scegli.
- **Apri nota** nell'intestazione di un giorno apre quella nota giornaliera; un clic su una voce apre la nota a quella riga.
- Le **caselle di controllo** delle voci di tipo attività possono essere spuntate direttamente nel flusso. Si comportano come nella vista delle attività, compresa la data di completamento e la prossima occorrenza di un'attività ricorrente.

Ogni voce ha un menu (clic destro o **⋯** al desktop; **⋯**, una pressione prolungata o uno scorrimento al telefono): **Modifica** cambia il testo sul posto e mantiene l'orario, **Copia** copia il testo, **Trasforma in attività** aggiunge la casella di controllo e **Ritrasforma in voce** la rimuove, **Mostra nella nota** salta alla riga, **Elimina** rimuove la voce — con **Annulla** nell'avviso che segue.

Le voci di un singolo giorno compaiono anche dove guardi quel giorno: come sezione **Diario** nella barra laterale destra del desktop (per il giorno della nota giornaliera aperta, altrimenti oggi) e sul telefono nella schermata **Oggi** per il giorno scelto. Nella barra laterale è una sezione come le altre: si chiude, se lo ricorda, si può nascondere e parte chiusa. Le sue righe stanno su una riga: lì non si usa nulla, ogni riga inizia dallo stesso bordo e un'attività porta un segno discreto a destra invece di una casella (spuntala nel flusso o nella nota). La matita nell'intestazione apre il consueto campo **Voce di diario** per quel giorno, e **Tutti i giorni** porta al flusso.

## Come viene salvata una voce

```markdown
## Journal

- 09:12 Chiamata all'officina #cliente
- [ ] 10:30 Ordina il pezzo di ricambio
- 14:05 Il router è in cantina
  La chiave è dalla signora Berger.
```

- Le voci vengono accodate alla fine della sezione, così il file si legge in ordine cronologico; la vista mostra le più recenti in alto.
- L'intestazione si chiama **Journal** per impostazione predefinita e può essere cambiata per ogni vault in **Impostazioni → Vault → Contenuto e struttura** (**Intestazione del diario**; al telefono in **Impostazioni → Contenuto e struttura**). Il suo livello non ha importanza. Se l'intestazione manca, Plainva aggiunge `## Journal` alla fine della nota. Cambiare l'impostazione non rinomina le intestazioni esistenti.
- **La giornata finisce alle** (stesso punto nelle impostazioni) sposta più avanti il confine del giorno: impostata su **04:00**, tutto ciò che scrivi tra mezzanotte e le quattro appartiene ancora al giorno precedente — la voce va nella nota giornaliera di ieri e mantiene la sua ora reale (`- 01:30 …`). L'intestazione del giorno nel diario dice allora **fino alle 04:00**. Il confine vale per la nota giornaliera e per il diario, **non** per il calendario né per la scadenza delle attività: un appuntamento all'01:30 di mercoledì resta di mercoledì. Il valore predefinito è **Mezzanotte**; l'impostazione appartiene al vault e vale su tutti i dispositivi.
- **Nota vocale**: l'icona del microfono nel campo di acquisizione registra. Mentre va vedi il tempo trascorso e hai due vie d'uscita: **Scarta** butta via la ripresa, **Allega** la scrive nella cartella degli allegati e la aggiunge alla voce. Il nome del file porta data e ora (`Nota vocale 2026-09-22 1430.m4a`). Plainva chiede l'accesso al microfono al **primo** tocco, mai all'avvio, e non registra nulla finché non inizi tu; la registrazione resta nel tuo vault e non va da nessuna parte.
- Plainva legge anche `- 14:05:30 Testo` (con i secondi) e le voci con una casella di controllo, e continua l'elenco nel modo in cui la tua nota lo scrive (`-`, `*` o `+`, con o senza righe vuote tra le voci). Le righe esistenti non vengono mai riformattate.
- Una modifica che non può essere collocata in sicurezza — per esempio perché un blocco di codice nella sezione non è mai stato chiuso — viene rifiutata con un messaggio, e il campo mantiene il tuo testo.

Il formato esatto è nel [File Format Reference](File_Format_Reference.md).

## Due dispositivi contemporaneamente

Se due dispositivi aggiungono voci alla stessa nota giornaliera prima di essersi sincronizzati, questo **non è un conflitto**: Plainva unisce le voci per orario, e ogni riga di entrambi i dispositivi viene conservata. Questo vale anche quando entrambi i dispositivi hanno creato la nota del giorno in modo indipendente. Ogni altra modifica simultanea alla nota viene gestita con la stessa cautela di prima (vedi [Compatibilità di sincronizzazione](Sync_Compatibility.md)).

## Cattura rapida globale (desktop, opzionale)

In **Impostazioni → Avvio e comportamento → Cattura rapida globale** puoi attivare **Cattura da qualsiasi punto con una scorciatoia di sistema**. La scorciatoia — in modo predefinito `Ctrl+Alt+J` (`Cmd+Option+J` su macOS) — apre allora una piccola finestra con il campo della voce anche mentre un'altra applicazione è in primo piano, finché Plainva è in esecuzione (anche nel vassoio di sistema). `Invio` scrive la voce nella nota giornaliera di oggi del vault aperto in Plainva e chiude la finestra; `Esc` scarta.

- **Cambia** registra una nuova scorciatoia: premi la combinazione che vuoi, con `Ctrl`, `Alt` o il tasto Windows/Comando. **Ripristina il valore predefinito** riporta quello predefinito.
- Se un'altra applicazione usa già la scorciatoia, o il sistema non l'accetta, Plainva lo dice sotto l'interruttore invece di lasciare una scorciatoia che non fa nulla.
- Sotto **Wayland** (Linux) il sistema non offre alle applicazioni alcuna scorciatoia di sistema; Plainva lo dice e non registra nulla. La voce nel vassoio di sistema e `Ctrl+Shift+J` portano allo stesso campo.
- La scorciatoia appartiene al dispositivo e non fa parte del profilo delle impostazioni.
