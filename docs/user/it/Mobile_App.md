# L'app mobile

Ultimo aggiornamento: 2026-07-26

Plainva è disponibile anche come app per Android e iOS. Funziona con gli stessi file Markdown, lo stesso formato **OKF** e lo stesso motore di sincronizzazione dell'app desktop — il tuo vault resta identico in entrambi i mondi.

## Layout

- **Barra inferiore:** **da tre a cinque** aree a tua scelta — non c'è più una scheda fissa **Altro**; lo spazio appartiene alle tue aree.
- **Ogni area** (Note, Oggi, Tag, Segnalibri, Calendario, Database, Grafo) resta a un tocco di distanza tramite il **foglio delle aree**: o il **▾ accanto al titolo** nella barra superiore, oppure una **pressione prolungata sulla barra inferiore**. Il foglio segna l'area attuale e porta direttamente, in basso, a **Disponi la barra di navigazione…**.
- **Configurare la barra:** **Impostazioni** → **Barra di navigazione**. Usa **−**/**+** per stabilire quante aree mostra la barra (da 3 a 5, con anteprima dal vivo) e la **maniglia di trascinamento** per ordinare l'elenco: le voci in alto formano la barra (contrassegnate da una cornice), trascinarne una verso l'alto la promuove nella barra. Non viene mai nascosto nulla — ciò che non è nella barra resta raggiungibile tramite il foglio delle aree. Se l'area in cui ti trovi lascia la barra, l'app passa alla prima visibile.
- **＋** fluttua come un pulsante rotondo sopra la barra e apre la creazione rapida: nota, nota giornaliera, cartella, database, "Da modello…".
- **Barra superiore:** il titolo con **▾** (apre il foglio delle aree), la ricerca e le **Impostazioni** (⋮); la schermata iniziale mostra inoltre "Aperti di recente" e i tuoi segnalibri.
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

**L'accesso è per dispositivo.** A sincronizzarsi sono le *impostazioni* del tuo account, mai l'accesso in sé — è voluto: le credenziali non devono lasciare il dispositivo. Un account arrivato così tramite la sincronizzazione delle impostazioni compare quindi nell'elenco, ma porta il contrassegno **accedi**, con una riga sotto che indica cosa fare. Finché nessun account ha eseguito l'accesso su questo dispositivo, il calendario lo spiega lì al posto di restare semplicemente vuoto, e **Accedi su questo dispositivo** ti porta agli account. Gli account con l'accesso eseguito mostrano **attivo**.

## E-mail

In **Impostazioni → E-mail** colleghi una **casella Microsoft** (Outlook.com, Microsoft 365) direttamente tramite l’accesso nel browser, senza password per app. Come per il calendario, l’accesso vale per dispositivo.

**Le caselle IMAP non funzionano ancora sul telefono.** Richiedono una connessione diretta al server di posta, ancora in fase di sviluppo. Una casella IMAP arrivata dal computer tramite la sincronizzazione delle impostazioni compare nell’elenco e te lo dice sul posto: per ora usala sul computer.

## Sincronizzazione

In **Impostazioni** (⋮), **Vault attivo** porta alla gestione dei vault; lì colleghi l'archiviazione cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Collega un vault cloud** porta un vault cloud esistente sul dispositivo; **Crea un vault** chiede prima **Su questo dispositivo** o **Presso un servizio online** e poi la struttura iniziale (vuota o un modello come PARA) — nel percorso online segue la connessione, la cartella di destinazione nel cloud può essere creata al momento tramite **Nuova cartella** nel foglio di selezione, e la struttura viene caricata alla prima sincronizzazione. Anche il primo avvio ("Collega un vault cloud") offre la stessa scelta tra un vault cloud esistente e uno nuovo. Ogni connessione ottiene un proprio vault separato sul dispositivo. La pagina del vault mostra stato, avanzamento, trasferimenti in sospeso e offre **Esporta il vault** (ZIP tramite il foglio di condivisione).

La frequenza con cui questo vault controlla le modifiche remote si imposta nella stessa pagina (**intervallo di sincronizzazione**, almeno 5 secondi) — i salvataggi locali partono comunque subito. Per Google Drive, OneDrive, Dropbox e S3 la **cartella cloud** può essere cambiata anche in seguito; con WebDAV la cartella fa parte dell'indirizzo del server, quindi ci si ricollega. Se la sincronizzazione delle impostazioni è cifrata puoi attivare anche **Chiedi la passphrase a ogni avvio**: la chiave non viene salvata sul dispositivo. E **Sicurezza e condivisione** dichiara ora apertamente che gli spazi di lavoro cifrati sono sperimentali e non ancora verificati in modo indipendente — conserva al sicuro il file e il codice di ripristino.

La pagina del vault indica anche se le tue **impostazioni** ti seguono — come una scheda con uno stato chiaro invece di un semplice pulsante:

- **Non vengono sincronizzate**: la sincronizzazione delle impostazioni è disattivata per questo vault. Attivala dal desktop.
- **Non ancora sbloccato su questo dispositivo**: le tue impostazioni sono memorizzate crittografate nel cloud. Inserisci la passphrase che hai scelto configurandolo sul desktop — questo dispositivo le sblocca una volta con essa.
- **Vengono sincronizzate**: questo dispositivo è sbloccato; cartelle, viste e regole di backup restano allineate con i tuoi altri dispositivi.

Ogni scheda indica anche cosa *non* viaggia: gli accessi restano sempre sul dispositivo (vedi [Calendario ed eventi](#calendario-ed-eventi)).

**Impostazioni** → **Sicurezza e condivisione** indica che cos'è realmente la connessione e, per un normale vault cloud, configura l'area di lavoro crittografata direttamente sul telefono (identità → file di ripristino e codice → attivazione). Senza connessione cloud non c'è nulla da crittografare, e la sezione lo dice.

## Rete di sicurezza

Gli snapshot (cronologia delle versioni), un diario delle bozze (dopo un arresto anomalo la nota offre l'ultimo stato non salvato) e le copie in conflitto con una vista di confronto proteggono i tuoi dati. La conservazione si configura in **Impostazioni** → **Backup e cronologia delle versioni**.

## Condivisione e scorciatoie

Su Android e iOS, testo e URL condivisi diventano una nuova nota nella cartella Inbox; immagini e file vengono importati come allegati (massimo 25 MB per file). Su Android, tieni premuta l’icona per le scorciatoie aggiuntive **Nuova nota** e **Oggi**. La pagina del vault permette di attivare **Sincronizza impostazioni** e di sbloccare o bloccare in sicurezza un vault cifrato con la passphrase.

## Cartelle, foto e calendario

Il pulsante mobile **Più** resta disponibile nelle cartelle annidate e ogni azione crea nella cartella aperta. Nell’intestazione il **menu a tre punti** apre le impostazioni; le nuove cartelle si creano dal pulsante **Più**.

Il pulsante foto propone **Scatta una foto** o **Scegli dalla libreria**, conserva la posizione di inserimento e mostra gli errori di autorizzazione o file.

**Calendario** apre direttamente il calendario del provider connesso. Le note giornaliere restano in **Oggi**; la precedente schermata mensile intermedia è stata rimossa senza modificare dati esistenti.
