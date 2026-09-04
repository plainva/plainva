# OKF — Open Knowledge Format

Ultimo aggiornamento: 2026-09-04

OKF (Open Knowledge Format) è una convenzione aperta per raccolte di conoscenza in Markdown: semplici file Markdown con una piccola intestazione frontmatter uniforme. Questa pagina spiega cos'è OKF, cosa fa automaticamente Plainva per esso — e perché non *devi* usarne nulla per forza.

## Cos'è OKF?

L'idea: ogni documento nel vault dice da sé cosa è. Basta una minima intestazione frontmatter:

```markdown
---
type: Note
---
# La mia nota
```

- **`type`** — che tipo di documento è (ad es. `Note`, `Daily Note`, `Project`). L'unico campo obbligatorio della convenzione.
- **`okf_version`** — la versione della convenzione seguita dal vault. Vive **una sola volta**, nell'`index.md` radice (attualmente `"0.2"`), non in ogni nota.
- **`index.md`** — ogni cartella può contenere un `index.md` come proprio sommario; i nomi `index.md` e `log.md` sono riservati a questo scopo e non dovrebbero essere usati per note normali.

> Scrivi file con uno strumento o uno script? Il contratto esatto dei campi — valori consentiti, come si serializza ogni tipo di proprietà e le regole sui nomi riservati — è nella [File Format Reference](File_Format_Reference.md).

**Da dove viene OKF:** OKF è una specifica aperta di Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), licenza Apache-2.0). Plainva segue **OKF 0.2** (pubblicata il 25 luglio 2026). Nuovi nella 0.2 sono cinque campi opzionali con cui una nota dichiara da dove viene, se qualcuno l'ha rivista e se è ancora valida — `generated`, `verified`, `sources`, `stale_after` e `status`. Cosa Plainva ne mostra e ne scrive è descritto sotto in "Provenienza, revisione e ciclo di vita".

## Perché Plainva usa OKF?

Il semplice Markdown è meravigliosamente portabile — ma da solo non ha una struttura affidabile. OKF ne aggiunge quel tanto che basta, e tutto resta normale Markdown con frontmatter standard:

- **Database, filtri e modelli possono contare sulla struttura.** Ogni nota porta un `type`, così le viste `.base` sui file semplici restano solide.
- **Le cartelle restano navigabili.** Un sommario `index.md` per cartella funziona sia per le persone sia per gli strumenti.
- **Script e assistenti IA possono lavorare con il tuo vault in sicurezza**, perché il formato su disco è uniforme e documentato.
- **Nessun lock-in.** OKF è una convenzione aperta sopra il semplice Markdown — altri strumenti OKF comprendono i tuoi file, oggi come tra dieci anni.

## Cosa fa automaticamente Plainva

**I nuovi file** ricevono automaticamente l'intestazione OKF: ogni nota creata in Plainva riceve `type` nel suo frontmatter — da OKF 0.2 il marcatore di versione `okf_version` vive una sola volta nell'`index.md` radice, non più in ogni nota. Configuri i valori per vault: **Impostazioni → Vault → Contenuto e struttura → OKF (Open Knowledge Format)** → **type per le nuove note** (predefinito `Note`) e **type per le note giornaliere** (predefinito `Daily Note`). Se un modello porta un proprio `type`, vince il modello.

**I file esistenti non vengono mai modificati senza chiedere.** Plainva aggiunge i campi OKF solo quando crea nuovi file o quando avvii esplicitamente la conversione.

**Campi di sistema protetti:** nel pannello **Proprietà**, `type` e — dove note più vecchie lo portano ancora — `okf_version` sono contrassegnati come campi di sistema OKF ("Campo di sistema OKF – gestito da Plainva"): il valore di `type` è selezionabile da un menu a tendina di tipi noti, `okf_version` è di sola visualizzazione; rinomina, cambio di tipo ed eliminazione sono bloccati così la convenzione non può rompersi per errore.

**La spiegazione:** **Cos'è OKF?** nelle impostazioni ti dà la versione breve in tre frasi, più un link a questa pagina. Non si apre più da sola; se un vault contiene file che non sono conformi al formato OKF, Plainva lo segnala una volta in un piccolo messaggio con un pulsante che ti porta direttamente alla conversione.

## Provenienza, revisione e ciclo di vita (OKF 0.2)

Da OKF 0.2 una nota può dichiarare da dove viene, chi l'ha rivista e se è ancora valida. Plainva ne fa tre cose:

**Cosa mostra Plainva.**

- Una nota con `status: draft` o `status: deprecated` porta un badge nell'intestazione del documento — **Bozza** o **Dismessa**. `stable` resta silenzioso; una tua colonna `status` con altri valori (ad esempio `Open` in un database attività) non è uno stato del ciclo di vita e non riceve alcun badge.
- Una volta superato `stale_after`, l'avviso **Segnata come obsoleta (dal …)** compare sopra la nota con un salto alle proprietà. L'avviso è solo visualizzazione — Plainva non cambia nulla nella nota.
- La sezione **Fiducia e provenienza** del pannello delle proprietà (sul telefono: nel pannello di contesto della nota) riassume i campi e ne ricava un livello di fiducia: **Non verificata**, **Confermata dalla macchina** o **Rivista da una persona** — più chi l'ha generata, l'elenco delle revisioni, le fonti come link cliccabili, lo stato e l'obsolescenza. Le righe **Stato**, **Obsoleta dopo** e **Versione OKF** hanno etichette tradotte; la chiave scritta nel file (`status`, `stale_after`, `okf_version`) compare come suggerimento sull'icona del lucchetto e non cambia mai.

**Cosa scrive Plainva.**

- `generated` (e, dove una fonte è nota, `sources`) è impostato esattamente da tre percorsi di scrittura macchina: l'**importatore** (`plainva-import/<version>`, un istante per esecuzione — anche il rapporto di importazione lo riporta), la **cattura e-mail** (`plainva-mail-capture/<version>`, con il Message-ID del messaggio come fonte) e la **sincronizzazione delle attività** (`plainva-task-sync/<version>`, solo quando crea una nota).
- `verified` viene scritto solo da **Segna come revisionata** nella sezione **Fiducia e provenienza**: Plainva aggiunge `human:<tuo nome>` con l'istante corrente all'elenco — una seconda revisione non sovrascrive mai la prima. Il tuo nome viene chiesto una volta per vault; resta su questo dispositivo e può essere cambiato in **Impostazioni → Vault → Contenuto e struttura → Nome del revisore**.
- L'editor non tocca mai da solo nessuno di questi campi, e le note esistenti non vengono mai timbrate a posteriori. `status` e `stale_after` li imposti tu, come proprietà o nel frontmatter.

**Aggiornare la versione del bundle.** La versione della convenzione vive una sola volta nell'`index.md` radice. Un vault che dichiara ancora `"0.1"` continua a funzionare senza modifiche — in **Impostazioni → Vault → Contenuto e struttura → Versione del bundle** (sul telefono: **Impostazioni → Vault → Manutenzione → Versione del bundle**) la porti alla 0.2 con **Aggiorna…**. Il dialogo mostra in anticipo cosa cambia: la riga nell'`index.md` radice e, come casella (attiva per impostazione predefinita), la rimozione del campo `okf_version` legacy dalle note che lo portano ancora. Ogni file viene salvato in backup prima di essere modificato; **Pulisci…** fa solo la seconda parte. La tabella dei campi e le regole di scrittura in dettaglio sono nella [File Format Reference](File_Format_Reference.md).

## index.md: il sommario per cartella

Un `index.md` è il sommario di una cartella: un elenco delle note e sottocartelle che contiene, con descrizioni e link relativi.

- **Generazione** — sempre su tua azione, mai dal nulla: clic destro su una cartella → **Genera/aggiorna index.md**, oppure in blocco tramite la **Gestione index.md** (**Impostazioni → Vault → Contenuto e struttura**).
- **Adottare invece di generare** — se hai già note di riepilogo (MOC, Panoramica, nota di cartella, README …), la gestione le suggerisce come candidate. **Adotta** rinomina il file in `index.md` (i link vengono aggiornati in tutto il vault) e può facoltativamente prepararlo per OKF.
- **Manutenzione automatica** — gli elenchi *generati* da Plainva portano un marcatore invisibile alla fine del file (un commento HTML). Solo tali file contrassegnati vengono mantenuti automaticamente aggiornati ogni volta che la cartella cambia — e solo nei vault OKF (riconoscibili da `okf_version` nell'`index.md` radice).
- **Sola lettura con via d'uscita** — i file index.md gestiti si aprono in modalità lettura con il banner "Questo index.md è gestito da Plainva e aggiornato automaticamente." Lì puoi **Aggiornare** — oppure scegliere **Modifica comunque**: questo rimuove il marcatore e il file torna interamente tuo (niente più aggiornamenti automatici).
- **Tutti in una volta** — **Aggiorna tutti i file index.md** è disponibile nel menu contestuale della radice del vault e nelle impostazioni; i file senza il marcatore vengono saltati.
- **Colmare le lacune** — nella gestione index.md, il pulsante **Genera index.md in tutte le cartelle che non ce l'hanno** preseleziona ogni cartella priva di un index.md, così puoi crearli tutti in un solo passaggio.
- **Sul telefono** — lo stesso, da due porte: tenendo premuta una cartella la scheda offre **Crea panoramica** oppure **Aggiorna panoramica**, a seconda di ciò che serve a quella cartella. Per il raro giro su tutto il vault c'è **Impostazioni → Vault → Manutenzione → Panoramiche**: le cartelle senza panoramica stanno in cima e **Genera index.md nelle N cartelle che non ce l'hanno** le crea in un colpo solo. Una cartella il cui `index.md` hai scritto tu viene elencata e lasciata stare — adottare è una decisione dichiarata in quell'elenco, mai l'effetto collaterale di un tocco. Anche la manutenzione automatica gira ora sul telefono: un vault modificato lì non invecchia più finché un desktop non lo apre.
- In modalità lettura, gli elenchi gestiti sono renderizzati come schede con icone di file/cartella; i link si aprono direttamente in Plainva.

## Convertire un vault esistente (opt-in)

Se i file nel vault non sono conformi al formato OKF (campo `type` mancante, o nomi riservati usati come note normali), Plainva propone la conversione — una volta all'apertura del vault, e permanentemente in **Impostazioni → Vault → Contenuto e struttura** (la voce compare solo finché c'è qualcosa da fare).

La procedura guidata **Converti al formato OKF** procede per passaggi chiari:

1. **Scansione** — mostra quanti file sono interessati (le cartelle di modelli e di sistema sono escluse; i file con frontmatter illeggibile vengono saltati, mai "riparati").
2. **Decisioni** — un `type` predefinito per i file che non ne hanno uno; i valori `type` esistenti possono essere **mantenuti** (consigliato — sono già type OKF validi) o rinominati in un campo diverso.
3. **Anteprima (nessuna modifica)** — una simulazione mostra in anticipo cosa cambierebbe.
4. **Converti** — ogni file viene salvato in backup in `.plainva/backups/` prima di essere modificato; un rapporto riassume cosa è cambiato, cosa è stato saltato e la cartella di backup. Dopo, puoi facoltativamente **continuare verso la gestione index.md**.

Un consiglio dalla procedura guidata: le modifiche passano normalmente per la sincronizzazione — per i vault git, esegui prima il commit.

### Sul telefono

Lo stesso percorso esiste anche su mobile: **Impostazioni → Vault → Manutenzione → Converti al formato OKF**. I passaggi sono gli stessi — scansione, decisioni, anteprima, conversione — e l'anteprima nomina le note interessate prima che venga scritto qualcosa.

Si aggiungono due cose, perché un telefono può togliere un'app dalla memoria in qualsiasi momento:

- **Metti in pausa e continua.** L'esecuzione si ferma al file successivo quando tocchi **Pausa** o l'app passa in secondo piano. Continuando si scrive nella stessa cartella di backup: non ne compare una seconda.
- **La domanda all'avvio.** Se un'esecuzione resta incompiuta, Plainva lo dice alla successiva apertura del vault e propone **Continua** o **Ripristina**; **Più tardi** è una risposta valida. Un'esecuzione interrotta lascia un vault convertito solo in parte, non rotto: vengono aggiunti solo campi di frontmatter e ogni nota resta Markdown valido.

**Ripristina** riporta i file dalla cartella di backup — anche sul desktop, dal rapporto alla fine dell'esecuzione. La cartella di backup resta lì; è l'unica copia dello stato precedente alla conversione.

## Devo per forza usare OKF?

No. OKF è uno standard gentile:

- I nuovi file ricevono l'intestazione automaticamente — non intralcia mai e non costa nulla.
- I vault esistenti (ad es. da Obsidian) continuano a funzionare senza modifiche; la conversione è rigorosamente opt-in.
- Un `okf_version` mancante — o uno che note più vecchie portano ancora — non conta come una violazione; puoi usare Plainva e Obsidian fianco a fianco permanentemente senza sollecitazioni.
- Obsidian e qualsiasi altro editor possono ancora aprire ogni file: è e resta semplice Markdown.

## Vedi anche

- [File Format Reference](File_Format_Reference.md) — il contratto esatto su disco di ogni file del vault
- [Note e Markdown](Notes_and_Markdown.md) — frontmatter e proprietà
- [Database (.base)](Databases_Base.md) — cosa ti offre in pratica un `type` uniforme
- [FAQ e risoluzione dei problemi](FAQ.md) — backup e index.md in sola lettura, tra l'altro
