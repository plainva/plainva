# FAQ e risoluzione dei problemi

Ultimo aggiornamento: 2026-09-03

Risposte alle domande più comuni — dalla compatibilità con Obsidian ai file in conflitto e ai backup.

## Nozioni fondamentali

### Dove vivono i miei dati?

Esclusivamente presso di te: un vault è una semplice cartella di file Markdown sul tuo computer. Plainva non gestisce un proprio server e non conserva copie da nessuna parte. Se sincronizzi, i dati passano direttamente tra il tuo computer e *il tuo* storage (il tuo Nextcloud, il tuo OneDrive, il tuo bucket …). Le credenziali vivono nel portachiavi del sistema operativo.

### Posso usare Plainva e Obsidian fianco a fianco?

Sì — è una promessa fondamentale, con un'unica avvertenza onesta. Plainva scrive semplice Markdown con frontmatter standard; tutto ciò che è specifico di Plainva è raggruppato sotto chiavi `plainva:` (nelle note e nei file `.base`), che Obsidian ignora semplicemente quando apre i file. Obsidian mostra la chiave `plainva` come un oggetto non modificabile nelle sue proprietà — questo è innocuo. Le viste esclusive di Plainva come Bacheca o Calendario appaiono in Obsidian come una semplice tabella.

L'avvertenza: **aprire è sempre sicuro, modificare non sempre.** Un vault Obsidian esistente può essere aperto e modificato in Plainva senza rischi — nulla viene migrato o riformattato. Ma non appena un vault usa funzionalità di Plainva (estensioni per i database come bacheche, relazioni o colonne di relazione inversa, file `index.md` gestiti), modificare questi file specifici in Obsidian può interrompere la funzionalità di Plainva, perché Obsidian non conosce le estensioni `plainva:`. Le note senza estensioni Plainva possono essere modificate ovunque, in qualsiasi momento. Al primo utilizzo di un'estensione di questo tipo, un dialogo di promemoria (**Estensione Plainva**) lo segnala; può essere disattivato in **Impostazioni → App → Avvio e comportamento**.

### Plainva modifica il mio vault esistente?

Non senza chiedere. I file esistenti vengono toccati solo quando avvii esplicitamente un'azione (ad es. la [conversione OKF](OKF.md) — con anteprima e backup). Solo i file appena creati ricevono automaticamente la piccola intestazione frontmatter OKF.

## File e modifica

### Ho eliminato qualcosa — è sparito?

No, per fortuna in doppia copia: prima di ogni eliminazione Plainva salva il file come snapshot — clic destro sul nome del vault → **Ripristina i file eliminati…** lo riporta indietro all'interno dell'app. Inoltre, i file e le cartelle eliminati finiscono nel cestino del sistema operativo (per le cartelle intere, il cestino è il modo principale per recuperarle). Dettagli: [Backup e cronologia delle versioni](Backups_and_Versioning.md).

### Esistono versioni più vecchie delle mie note?

Sì: Plainva crea automaticamente versioni dei file mentre modifichi. Clic destro su un file → **Cronologia delle versioni…** mostra tutti gli snapshot con una vista di confronto e **Ripristina**. Inoltre, Plainva esegue il backup dell'intero vault giornalmente come ZIP fuori dalla cartella del vault. Dettagli: [Backup e cronologia delle versioni](Backups_and_Versioning.md).

### Perché il mio index.md è in sola lettura?

È stato generato da Plainva e viene mantenuto automaticamente aggiornato (riconoscibile dal banner "Questo index.md è gestito da Plainva…"). **Modifica comunque** lo affida permanentemente alla tua gestione manuale — non si aggiornerà più automaticamente. Dettagli: [OKF](OKF.md).

### Cosa succede quando rinomino una proprietà in un database?

Il nuovo nome viene scritto nel frontmatter di **ogni nota corrispondente** (dopo conferma, con un indicatore di avanzamento). Vale lo stesso principio per l'eliminazione: la casella **Rimuovila anche dal frontmatter delle note** pulisce anche le note sorgente. Entrambe agiscono quindi sui tuoi file — è esattamente a questo che servono.

### Posso annullare la conversione OKF?

Prima di ogni modifica, la procedura guidata salva il file in backup in `.plainva/backups/okf-conversion-<timestamp>/`. Il rapporto finale indica la cartella esatta; da lì puoi ricopiare singoli file. Usa anche **Anteprima (nessuna modifica)** prima di convertire.

### Una vecchia nota giornaliera manca nella vista Attività

Le note giornaliere molto vecchie potrebbero aver ereditato un'impostazione dal loro modello che nasconde le loro attività. Cerca nel vault `"tasks: false"` — **con** le virgolette, altrimenti troverai anche note in cui entrambe le parole compaiono solo per caso. Nei risultati, la riga si trova nel frontmatter sotto un blocco `plainva:`; elimina lì `tasks: false` (e `templateFor:`, se presente) e la nota ricompare. Le note create di recente da un modello non lo ereditano più.

## Sincronizzazione

### Cos'è un file .CONFLICT?

Se lo stesso file è stato modificato qui e su un altro dispositivo contemporaneamente, Plainva cerca prima di unire automaticamente entrambe le versioni. Se non è possibile, **la tua** versione viene salvata in sicurezza come file `.CONFLICT` accanto all'originale — non si perde mai nulla. I file in conflitto sono contrassegnati nell'albero dei file; con un clic destro scegli **Mantieni questa versione** (la versione in conflitto sostituisce l'originale) o **Scarta il conflitto**.

Per risolverlo, **Confronta versioni** (clic destro sul file di conflitto, l’avviso nella nota o la finestra di errore di sincronizzazione) mostra entrambe le versioni affiancate — la nota a sinistra, la copia a destra — con le uscite **adotta**, **tieni entrambe**, **scarta copia** e **più tardi**; sul desktop il lato destro si può anche unire riga per riga. Ogni uscita che scarta qualcosa chiede prima.

### Il mio accesso Google scade continuamente

Con la configurazione "Bring Your Own", il tuo progetto Google resta in modalità di test; Google termina quindi la sessione dopo 7 giorni. Plainva rinnova i token automaticamente in background, ma una volta scaduti, usa **Riconnetti** nelle impostazioni di sincronizzazione. Dettagli: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Il mio vault vive in una cartella OneDrive/Dropbox/iCloud e Plainva si comporta in modo strano

Imposta la cartella del vault su "mantieni sempre su questo dispositivo" / "disponibile offline" nel client di sincronizzazione del provider. I file segnaposto solo online (Files On-Demand, "solo online") interferiscono con l'indicizzazione e la sincronizzazione. Dettagli: [Compatibilità di sincronizzazione](Sync_Compatibility.md).

### Sono offline — cosa succede alle mie modifiche?

Vengono salvate localmente come al solito e raccolte in una coda; non appena torna la connessione, Plainva le trasferisce automaticamente. La barra di stato mostra **Online**/**Offline**.

### La barra di stato mostra Offline anche se ho internet

Allora è la connessione di sincronizzazione stessa a essere interrotta — spesso perché l'accesso è scaduto o le credenziali sono cambiate (ad es. con Google Drive). Clicca su **Offline** nella barra di stato o sul triangolo di avviso accanto al nome del vault: il dialogo mostra il messaggio di errore esatto, e **Apri le impostazioni di sincronizzazione** ti porta direttamente al modulo del provider corrispondente dove ristabilisci la connessione (ad es. **Riconnetti**). Ogni clic avvia anche subito un nuovo tentativo di sincronizzazione.

### Perché manca il provider X (Proton, Tuta, iCloud Drive …)?

Plainva collega qualsiasi provider che offra un'interfaccia aperta (IMAP, CalDAV, WebDAV, S3 o un'API documentata). Alcuni servizi semplicemente non offrono alcun accesso per altre app — non è una scelta di Plainva: **Proton Mail** è cifrato end-to-end e parla IMAP solo tramite il Proton Mail Bridge locale a pagamento (esiste una preimpostazione apposita); Proton Calendar e Proton Drive non hanno un'interfaccia utilizzabile. **Tuta** non offre volutamente né IMAP né CalDAV. **iCloud Drive** non ha un'interfaccia per app di terze parti (iCloud **Mail** e **Calendario**, invece, funzionano tramite la scheda Apple). **Baidu Netdisk/TeraBox** e **NAVER MYBOX** hanno chiuso o disattivato le proprie interfacce per gli sviluppatori indipendenti. Se ti manca un provider con un'interfaccia aperta, faccelo sapere su GitHub.

## App

### Cosa fa F5, e dov'è il menu contestuale del browser?

Plainva è un'applicazione desktop, non una pagina web. Per questo `F5` (e Ctrl+R) non ricarica la finestra — questo scarterebbe le schede aperte e le modifiche non salvate. Il tasto invece **rilegge il vault**: Plainva riconcilia l'indice con la cartella e, per i vault online, scarica anche i file dal cloud. Il menu contestuale integrato della WebView resta nascosto; un clic destro su testo selezionato offre comunque **Copia**, e l'albero dei file, le schede e le tabelle mantengono i propri menu contestuali.

### Perché non vedo subito i file creati esternamente?

Normalmente Plainva si accorge da solo quando un altro programma modifica qualcosa nella cartella del tuo vault. Quando questo non funziona — ad esempio su unità di rete, in cartelle cloud o quando il file proviene da un altro computer — usa **Rileggi il vault**:

* `F5`, oppure la freccia circolare nell'intestazione dell'albero dei file,
* **Rileggi questa cartella** nel menu contestuale di una cartella (più veloce nei vault molto grandi),
* il comando **Rileggi il vault** nella palette dei comandi (`Ctrl/Cmd+P`).

Plainva mostra quindi un breve resoconto: quanti file erano nuovi, modificati o rimossi — e **quali voci sono state saltate**. Una cartella saltata è il motivo più comune per cui un file non "arriva" mai: Plainva non è riuscito a leggerla (permessi mancanti, unità di rete disconnessa) oppure fa riferimento a se stessa in modo circolare. Nei vault online, il resoconto indica anche che è stata richiesta una sincronizzazione completa con il cloud.

Inoltre, Plainva riconcilia automaticamente ogni volta che torni alla finestra da un altro programma (al massimo ogni 30 secondi; il cloud al massimo ogni 5 minuti). Se un file resta invisibile anche dopo, usa **Ricostruisci l'indice da zero** in Impostazioni → Vault → Manutenzione.

### Perché non vedo animazioni?

Plainva rispetta l'impostazione "riduci movimento" del tuo sistema. Se transizioni ed effetti sono assenti (pulsanti, menu ed evidenziazioni non si muovono), le animazioni sono disattivate nel tuo sistema operativo. Su **Windows**: Impostazioni → Accessibilità → Effetti visivi → attiva **Effetti di animazione**. Su **macOS**: Impostazioni di Sistema → Accessibilità → Schermo → disattiva **Riduci movimento**.

### Come cambio la lingua?

**Impostazioni → App → Aspetto → Lingua** (attualmente tedesco e inglese).

### "Cerca aggiornamenti" non trova nulla

Finché non ci sono ancora release pubbliche, la ricerca di aggiornamenti riporta: "Non ci sono ancora aggiornamenti pubblici (release) disponibili." Non è un errore.

### Ci sono funzioni nascoste?

La Flotta Stellare non commenta le voci di corridoio. Ma si dice che il logo nella barra del titolo risponda a colpi persistenti — e chi poi conosce le parole giuste vedrà Plainva sotto una luce del tutto nuova. Alcuni dicono: in quattro.

## Vedi anche

- [Configurare la sincronizzazione](Sync_Setup.md) e [Compatibilità di sincronizzazione](Sync_Compatibility.md)
- [OKF](OKF.md) — conversione, index.md, campi di sistema
