# OKF — Open Knowledge Format

Stand: 2026-07-11

OKF (Open Knowledge Format) è una convenzione aperta per raccolte di conoscenza in Markdown: semplici file Markdown con una piccola intestazione frontmatter uniforme. Questa pagina spiega cos'è OKF, cosa fa automaticamente Plainva per esso — e perché non *devi* usarne nulla per forza.

## Cos'è OKF?

L'idea: ogni documento nel vault dice da sé cosa è. Basta una minima intestazione frontmatter:

```markdown
---
type: Note
okf_version: "0.1"
---
# La mia nota
```

- **`type`** — che tipo di documento è (ad es. `Note`, `Daily Note`, `Project`). L'unico campo obbligatorio della convenzione.
- **`okf_version`** — la versione della convenzione contro cui è stato scritto il file.
- **`index.md`** — ogni cartella può contenere un `index.md` come proprio sommario; i nomi `index.md` e `log.md` sono riservati a questo scopo e non dovrebbero essere usati per note normali.

> Scrivi file con uno strumento o uno script? Il contratto esatto dei campi — valori consentiti, come si serializza ogni tipo di proprietà e le regole sui nomi riservati — è nella [File Format Reference](File_Format_Reference.md).

## Perché Plainva usa OKF?

Il semplice Markdown è meravigliosamente portabile — ma da solo non ha una struttura affidabile. OKF ne aggiunge quel tanto che basta, e tutto resta normale Markdown con frontmatter standard:

- **Database, filtri e modelli possono contare sulla struttura.** Ogni nota porta un `type`, così le viste `.base` sui file semplici restano solide.
- **Le cartelle restano navigabili.** Un sommario `index.md` per cartella funziona sia per le persone sia per gli strumenti.
- **Script e assistenti IA possono lavorare con il tuo vault in sicurezza**, perché il formato su disco è uniforme e documentato.
- **Nessun lock-in.** OKF è una convenzione aperta sopra il semplice Markdown — altri strumenti OKF comprendono i tuoi file, oggi come tra dieci anni.

## Cosa fa automaticamente Plainva

**I nuovi file** ricevono automaticamente l'intestazione OKF: ogni nota creata in Plainva riceve `type` e `okf_version` nel suo frontmatter. Configuri i valori per vault: **Impostazioni → Vault → Contenuto e struttura → OKF (Open Knowledge Format)** → **type per le nuove note** (predefinito `Note`) e **type per le note giornaliere** (predefinito `Daily Note`). Se un modello porta un proprio `type`, vince il modello.

**I file esistenti non vengono mai modificati senza chiedere.** Plainva aggiunge i campi OKF solo quando crea nuovi file o quando avvii esplicitamente la conversione.

**Campi di sistema protetti:** nel pannello **Proprietà**, `type` e `okf_version` sono contrassegnati come campi di sistema OKF ("Campo di sistema OKF – gestito da Plainva"): il valore di `type` è selezionabile da un menu a tendina di tipi noti, `okf_version` è di sola visualizzazione; rinomina, cambio di tipo ed eliminazione sono bloccati così la convenzione non può rompersi per errore.

**La spiegazione:** quando apri per la prima volta un vault, Plainva mostra una volta **Cos'è OKF?** — lo stesso riepilogo è sempre disponibile nelle impostazioni.

## index.md: il sommario per cartella

Un `index.md` è il sommario di una cartella: un elenco delle note e sottocartelle che contiene, con descrizioni e link relativi.

- **Generazione** — sempre su tua azione, mai dal nulla: clic destro su una cartella → **Genera/aggiorna index.md**, oppure in blocco tramite la **Gestione index.md** (**Impostazioni → Vault → Contenuto e struttura**).
- **Adottare invece di generare** — se hai già note di riepilogo (MOC, Panoramica, nota di cartella, README …), la gestione le suggerisce come candidate. **Adotta** rinomina il file in `index.md` (i link vengono aggiornati in tutto il vault) e può facoltativamente prepararlo per OKF.
- **Manutenzione automatica** — gli elenchi *generati* da Plainva portano un marcatore invisibile alla fine del file (un commento HTML). Solo tali file contrassegnati vengono mantenuti automaticamente aggiornati ogni volta che la cartella cambia — e solo nei vault OKF (riconoscibili da `okf_version` nell'`index.md` radice).
- **Sola lettura con via d'uscita** — i file index.md gestiti si aprono in modalità lettura con il banner "Questo index.md è gestito da Plainva e aggiornato automaticamente." Lì puoi **Aggiornare** — oppure scegliere **Modifica comunque**: questo rimuove il marcatore e il file torna interamente tuo (niente più aggiornamenti automatici).
- **Tutti in una volta** — **Aggiorna tutti i file index.md** è disponibile nel menu contestuale della radice del vault e nelle impostazioni; i file senza il marcatore vengono saltati.
- **Colmare le lacune** — nella gestione index.md, il pulsante **Genera index.md in tutte le cartelle che non ce l'hanno** preseleziona ogni cartella priva di un index.md, così puoi crearli tutti in un solo passaggio.
- In modalità lettura, gli elenchi gestiti sono renderizzati come schede con icone di file/cartella; i link si aprono direttamente in Plainva.

## Convertire un vault esistente (opt-in)

Se i file nel vault non sono conformi al formato OKF (campo `type` mancante, o nomi riservati usati come note normali), Plainva propone la conversione — una volta all'apertura del vault, e permanentemente in **Impostazioni → Vault → Contenuto e struttura** (la voce compare solo finché c'è qualcosa da fare).

La procedura guidata **Converti al formato OKF** procede per passaggi chiari:

1. **Scansione** — mostra quanti file sono interessati (le cartelle di modelli e di sistema sono escluse; i file con frontmatter illeggibile vengono saltati, mai "riparati").
2. **Decisioni** — un `type` predefinito per i file che non ne hanno uno; i valori `type` esistenti possono essere **mantenuti** (consigliato — sono già type OKF validi) o rinominati in un campo diverso.
3. **Anteprima (nessuna modifica)** — una simulazione mostra in anticipo cosa cambierebbe.
4. **Converti** — ogni file viene salvato in backup in `.plainva/backups/` prima di essere modificato; un rapporto riassume cosa è cambiato, cosa è stato saltato e la cartella di backup. Dopo, puoi facoltativamente **continuare verso la gestione index.md**.

Un consiglio dalla procedura guidata: le modifiche passano normalmente per la sincronizzazione — per i vault git, esegui prima il commit.

## Devo per forza usare OKF?

No. OKF è uno standard gentile:

- I nuovi file ricevono l'intestazione automaticamente — non intralcia mai e non costa nulla.
- I vault esistenti (ad es. da Obsidian) continuano a funzionare senza modifiche; la conversione è rigorosamente opt-in.
- Un `okf_version` mancante da solo non conta come una violazione — puoi usare Plainva e Obsidian fianco a fianco permanentemente senza sollecitazioni.
- Obsidian e qualsiasi altro editor possono ancora aprire ogni file: è e resta semplice Markdown.

## Vedi anche

- [File Format Reference](File_Format_Reference.md) — il contratto esatto su disco di ogni file del vault
- [Note e Markdown](Notes_and_Markdown.md) — frontmatter e proprietà
- [Database (.base)](Databases_Base.md) — cosa ti offre in pratica un `type` uniforme
- [FAQ e risoluzione dei problemi](FAQ.md) — backup e index.md in sola lettura, tra l'altro
