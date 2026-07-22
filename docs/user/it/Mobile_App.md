# L'app mobile

Ultimo aggiornamento: 2026-07-22

Plainva è disponibile anche come app per Android e iOS. Funziona con gli stessi file Markdown, lo stesso formato **OKF** e lo stesso motore di sincronizzazione dell'app desktop — il tuo vault resta identico in entrambi i mondi.

## Layout

- **Barra inferiore:** tre schermate disposte liberamente più la scheda fissa **Altro**. **Altro** elenca ogni schermata (Note, Oggi, Tag, Segnalibri, Calendario, Database, Grafo) — un tocco la apre, la **maniglia** riordina l'elenco: le prime tre formano la barra (contrassegnate da una cornice), trascinarne una verso l'alto la promuove nella barra.
- **＋** fluttua come un pulsante rotondo sopra la barra e apre la creazione rapida: nota, nota giornaliera, cartella, database, "Da modello…".
- **Barra superiore:** ricerca e le **Impostazioni** (⋮); la schermata iniziale mostra inoltre "Recenti" e i tuoi segnalibri.
- **Impostazioni:** il pulsante ⋮ apre prima l'elenco delle aree (come il lato sinistro delle impostazioni desktop) — un tocco apre quella pagina. In cima, **Vault attivo** porta alla gestione dei vault: cambiare vault (segno di spunta = attivo), **Crea un vault** e **Collega un vault cloud**.

## Leggere e modificare le note

Le note si aprono **renderizzate e in sola lettura**; la penna in alto a destra passa alla modifica (con una barra degli strumenti sopra la tastiera: formattazione, elenchi, wiki-link, comandi slash, inserisci foto). Gli incorporamenti `![[Nota]]` appaiono come schede di anteprima toccabili.

Il pulsante **Dettagli della nota** nell'intestazione (tra il segnalibro e il menu ⋮) apre il pannello di contesto della nota: proprietà (modificabili direttamente), backlink, struttura, grafo e la **cronologia delle versioni** — ogni modifica crea automaticamente snapshot che puoi ispezionare, confrontare e ripristinare. Il sorgente Markdown e la ricerca nella nota si trovano nel menu ⋮.

## Database (`.base`)

I database `.base` funzionano come su desktop: ogni vista (tabella, elenco, galleria, bacheca, calendario, cronologia), modifica tipizzata delle celle, le schede della bacheca si spostano tenendo premuto. **Configura** gestisce viste, colonne, filtri (inclusi i gruppi), ordinamento e proprietà. Gli schemi di relazione (destinazioni, cardinalità) restano gestiti dal desktop.

Una vista **Bacheca appunti** mostra le note come una bacheca a due colonne di schede adesive: il tocco apre la nota, la pressione prolungata mostra le azioni (fissa, etichette, colore, elimina), trascinare dopo una pressione prolungata riordina, e le caselle di controllo si spuntano direttamente sulla scheda. Il campo in alto cattura una nuova nota. Suggerimento: punta il database sulla tua cartella Inbox (**Impostazioni** → **Contenuto e struttura**) e sia le note rapide del ＋ sia i testi condivisi da altre app finiscono direttamente sulla bacheca.

## Calendario ed eventi

Il **Calendario** (scheda inferiore o tramite "Altro") mostra le tue note giornaliere come griglia mensile. L'icona dell'orologio in alto a destra apre il **calendario degli eventi** con le viste **Giorno**, **3 giorni** e **Agenda** — i tuoi calendari collegati usano lo stesso modello di account del desktop. Toccare un evento ne mostra i dettagli; per un invito puoi **accettare**, contrassegnarlo come **provvisorio** o **rifiutare** direttamente lì.

Gestisci gli account dall'icona a forma di ingranaggio nel calendario degli eventi: collega **CalDAV** sul dispositivo con una password per app (es. Fastmail, Nextcloud, iCloud); Google e Microsoft seguono tramite accesso dal browser. Per ogni account puoi mostrare o nascondere singoli calendari.

## Sincronizzazione

In **Impostazioni** (⋮), **Vault attivo** porta alla gestione dei vault; lì colleghi l'archiviazione cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Collega un vault cloud** porta un vault cloud esistente sul dispositivo; **Crea un vault** chiede prima **Su questo dispositivo** o **Presso un servizio online** e poi la struttura iniziale (vuota o un modello come PARA) — nel percorso online segue la connessione, la cartella di destinazione nel cloud può essere creata al momento tramite **Nuova cartella** nel foglio di selezione, e la struttura viene caricata alla prima sincronizzazione. Anche il primo avvio ("Collega un vault cloud") offre la stessa scelta tra un vault cloud esistente e uno nuovo. Ogni connessione ottiene un proprio vault separato sul dispositivo. La pagina del vault mostra stato, avanzamento, trasferimenti in sospeso e offre **Esporta il vault** (ZIP tramite il foglio di condivisione).

## Rete di sicurezza

Gli snapshot (cronologia delle versioni), un diario delle bozze (dopo un arresto anomalo la nota offre l'ultimo stato non salvato) e le copie in conflitto con una vista di confronto proteggono i tuoi dati. La conservazione si configura in **Impostazioni** → **Backup e cronologia delle versioni**.

## Condivisione e scorciatoie

Su Android e iOS, testo e URL condivisi diventano una nuova nota nella cartella Inbox; immagini e file vengono importati come allegati (massimo 25 MB per file). Su Android, tieni premuta l’icona per le scorciatoie aggiuntive **Nuova nota** e **Oggi**. La pagina del vault permette di attivare **Sincronizza impostazioni** e di sbloccare o bloccare in sicurezza un vault cifrato con la passphrase.

## Cartelle, foto e calendario

Il pulsante mobile **Più** resta disponibile nelle cartelle annidate e ogni azione crea nella cartella aperta. Nell’intestazione il **menu a tre punti** apre le impostazioni; le nuove cartelle si creano dal pulsante **Più**.

Il pulsante foto propone **Scatta una foto** o **Scegli dalla libreria**, conserva la posizione di inserimento e mostra gli errori di autorizzazione o file.

**Calendario** apre direttamente il calendario del provider connesso. Le note giornaliere restano in **Oggi**; la precedente schermata mensile intermedia è stata rimossa senza modificare dati esistenti.
