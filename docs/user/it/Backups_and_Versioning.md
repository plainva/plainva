# Backup e cronologia delle versioni

Stand: 2026-07-05

Plainva protegge il tuo lavoro su due livelli: **versioni dei file** (snapshot automatici di ogni singolo file durante la modifica e l'eliminazione) e **backup del vault** (archivi ZIP regolari dell'intero vault, salvati fuori dalla cartella del vault). Entrambi funzionano in background senza alcuna configurazione e possono essere regolati nelle impostazioni sotto **Backup e cronologia delle versioni**.

## Versioni dei file (snapshot)

Prima di ogni salvataggio, Plainva memorizza uno snapshot dello stato precedente — come semplice copia di testo sotto `.plainva/backups/` all'interno del vault (questa cartella è nascosta nell'albero dei file, nella ricerca e nella sincronizzazione). Per evitare centinaia di copie mentre digiti, si applica un **Intervallo degli snapshot** (predefinito: al massimo una nuova versione ogni 2 minuti). **L'eliminazione crea sempre uno snapshot**, indipendentemente dall'intervallo.

Conservazione (configurabile per vault):

- **Intervallo degli snapshot**: A ogni modifica / 30 s / 2 min / 5 min / 10 min
- **Versioni per file**: predefinito 100 — oltre questo numero vengono rimosse le più vecchie
- **Età massima**: predefinito 90 giorni — le versioni più vecchie vengono rimosse **definitivamente** da una pulizia giornaliera ("Illimitata" disattiva questo limite)

Quando rinomini o sposti un file, la sua cronologia delle versioni lo segue.

## Visualizzare e ripristinare le versioni

Clic destro su un file nell'albero dei file (o sulla sua scheda), oppure il menu **⋮** in alto a destra nell'editor → **Cronologia delle versioni…** apre l'elenco delle versioni:

- A sinistra sono elencati tutti gli snapshot raggruppati per giorno, con orario e dimensione.
- A destra viene mostrata un'anteprima; per i file di testo, **Confronta con la versione attuale** mostra la versione selezionata affiancata al contenuto attuale (la vecchia versione a sinistra, lo stato attuale a destra).
- **Ripristina** sostituisce il contenuto attuale con la versione selezionata. Nessuna preoccupazione: lo stato attuale viene prima salvato a sua volta come snapshot — quindi un ripristino può sempre essere annullato.
- **Ripristina come copia** crea la versione come nuovo file accanto all'originale (`Name (Version 2026-07-05 14-30).md`) senza toccarlo.

Anche le immagini hanno versioni (con anteprima); gli altri file binari possono essere ripristinati senza anteprima.

## Ripristinare i file eliminati

Poiché ogni eliminazione crea prima uno snapshot del file, Plainva può recuperare i file eliminati: clic destro sul nome del vault in cima all'albero dei file → **Ripristina i file eliminati…** (raggiungibile anche dalle impostazioni). L'elenco mostra tutti i file i cui snapshot esistono ancora mentre l'originale è sparito — **Ripristina** ricrea lo stato più recente nella posizione originale (le cartelle vengono ricreate se necessario), **Versioni…** apre la cronologia completa del file eliminato.

Nota: eliminare un'**intera cartella** la sposta nel cestino del sistema operativo — in questo caso il cestino di sistema è il modo principale per recuperarla; in Plainva potresti trovare solo snapshot più vecchi dei file contenuti.

## Backup automatici del vault (ZIP)

Inoltre, Plainva esegue il backup dell'intero vault come file ZIP — per impostazione predefinita **giornalmente** in background (all'apertura del vault, se l'ultimo backup è più vecchio di 24 ore). Questo ti protegge anche se la cartella del vault stessa viene persa o danneggiata, perché gli ZIP si trovano **fuori** dal vault:

- La destinazione predefinita è la cartella dati dell'app (mostrata sotto **Cartella di destinazione** nelle impostazioni; **Apri cartella** ti porta direttamente lì).
- Tramite **Scegli cartella…** puoi scegliere invece un disco esterno o un NAS; **Predefinita** torna alla cartella dati dell'app. Se la destinazione al momento non è raggiungibile (NAS spento), la barra di stato lo segnala in modo discreto e Plainva riprova più tardi.
- **Backup da conservare** (predefinito: 7) limita il numero; gli ZIP più vecchi dello stesso vault vengono eliminati automaticamente. I file estranei nella cartella di destinazione non vengono mai toccati.
- **Esegui backup ora** avvia manualmente un backup in qualsiasi momento; la barra di stato mostra l'esecuzione e il suo risultato.

I file ZIP si chiamano `VaultName_2026-07-05_14-30-00.zip` e contengono tutte le note, gli allegati e la tua configurazione `.obsidian` — **non** contengono la cartella interna `.plainva` (l'indice di ricerca viene ricostruito alla prossima apertura; le versioni dei file non fanno volutamente parte dello ZIP).

**Ripristinare da uno ZIP:** lo ZIP è un archivio del tutto normale. Estrailo ovunque e apri la cartella estratta in Plainva come vault — fatto.

## Impostazioni in sintesi

Impostazioni → il tuo vault → **Backup e cronologia delle versioni**:

| Impostazione | Predefinito | Significato |
|---|---|---|
| **Backup automatico del vault (ZIP)** | Attivo | ZIP giornaliero in background |
| **Cartella di destinazione** | Cartella dati dell'app | Dove vengono salvati gli ZIP, liberamente scelta |
| **Backup da conservare** | 7 | Questo numero di ZIP viene conservato |
| **Intervallo degli snapshot** | 2 min | Al massimo con questa frequenza viene creata una nuova versione del file durante la digitazione |
| **Versioni per file** | 100 | Limite massimo per file |
| **Età massima** | 90 giorni | Le versioni più vecchie vengono rimosse definitivamente |

## Buono a sapersi

- Le versioni dei file sono normali copie sotto `.plainva/backups/` — in caso di necessità puoi aprirle anche senza Plainva in qualsiasi file manager.
- La sincronizzazione propria di Plainva non trasferisce mai `.plainva`. Se sincronizzi la cartella del vault con un client di terze parti (ad es. l'app di Nextcloud), gli snapshot viaggiano insieme — questo costa un po' di spazio, ma non causa danni.
- I conflitti di sincronizzazione sono protetti aggiuntivamente tramite file `.CONFLICT` (vedi le [FAQ](FAQ.md)); la cronologia delle versioni completa questo con la storia temporale di ogni file.
