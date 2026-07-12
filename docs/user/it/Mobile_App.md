# L'app mobile

Stand: 2026-07-12

Plainva è disponibile anche come app per Android e iOS. Funziona con gli stessi file Markdown, lo stesso formato **OKF** e lo stesso motore di sincronizzazione dell'app desktop — il tuo vault resta identico in entrambi i mondi.

## Layout

- **Barra inferiore:** fino a quattro schermate a tua scelta (Note, Oggi, Tag, Segnalibri, Calendario, Database) attorno al pulsante fisso **＋**. Cambia la selezione in **Impostazioni** → **Barra delle schede**.
- **＋**: un tocco cattura subito una nuova nota (nella cartella visibile, altrimenti nella cartella Inbox). Tieni premuto per la creazione rapida: nota, nota giornaliera, cartella, database, "Da modello…".
- **Barra superiore:** ricerca e il menu Altro; la schermata iniziale mostra inoltre "Recenti" e i tuoi segnalibri.

## Leggere e modificare le note

Le note si aprono **renderizzate e in sola lettura**; la penna in alto a destra passa alla modifica (con una barra degli strumenti sopra la tastiera: formattazione, elenchi, wiki-link, comandi slash, inserisci foto). Gli incorporamenti `![[Nota]]` appaiono come schede di anteprima toccabili.

Il simbolo **ⓘ** apre il pannello di contesto della nota: proprietà (modificabili direttamente), backlink, struttura, sorgente Markdown, ricerca nella nota e la **cronologia delle versioni** — ogni modifica crea automaticamente snapshot che puoi ispezionare, confrontare e ripristinare.

## Database (`.base`)

I database `.base` funzionano come su desktop: ogni vista (tabella, elenco, galleria, bacheca, calendario, cronologia), modifica tipizzata delle celle, le schede della bacheca si spostano tenendo premuto. **Configura** gestisce viste, colonne, filtri (inclusi i gruppi), ordinamento e proprietà. Gli schemi di relazione (destinazioni, cardinalità) restano gestiti dal desktop.

## Sincronizzazione

In **Altro** → **Vault** colleghi l'archiviazione cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). Ogni connessione ottiene un proprio vault separato sul dispositivo. La pagina del vault mostra stato, avanzamento, trasferimenti in sospeso e offre **Esporta il vault** (ZIP tramite il foglio di condivisione).

## Rete di sicurezza

Gli snapshot (cronologia delle versioni), un diario delle bozze (dopo un arresto anomalo la nota offre l'ultimo stato non salvato) e le copie in conflitto con una vista di confronto proteggono i tuoi dati. La conservazione si configura in **Impostazioni**.

## Condivisione e scorciatoie (Android)

Il testo condiviso da altre app arriva come nuova nota nella cartella Inbox. Tieni premuto sull'icona dell'app per le scorciatoie **Nuova nota** e **Oggi**.
