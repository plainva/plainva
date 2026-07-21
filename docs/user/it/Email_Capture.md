# Cattura e-mail

Ultimo aggiornamento: 2026-07-21

Plainva può leggere la tua casella di posta per estrarre conoscenza dalle e-mail e portarla nel tuo vault, e — dalla 0.4.0 — anche scrivere e inviare e-mail. L'attenzione resta sulla **cattura** dei messaggi come note; una casella collegata tramite **IMAP** viene letta solo per la cattura (non cambia nulla in essa, nemmeno i contrassegni di lettura) finché non configuri l'invio.

> **Sperimentale.** Il client di posta comunica con account esterni reali (IMAP/SMTP e Microsoft) che non si possono esercitare nei test automatizzati di Plainva. Funziona ed è usato quotidianamente, ma trattalo come un'anteprima: mantieni un backup e segnala per favore tutto ciò che sembra fuori posto.

## Collegare una casella di posta

**Impostazioni → Vault → Account cloud → Collega account…** e scegli il provider:

- **Microsoft** — per Outlook.com e Microsoft 365: spunta **E-mail** nel passaggio dei servizi (se vuoi, insieme a **File** e **Calendario e attività** — un account, un accesso) e accedi direttamente nel browser, senza password per l'app e senza IMAP. Plainva usa la registrazione app centrale di Plainva (puoi facoltativamente fornire un tuo ID app nei dettagli dell'account). Lettura, cattura e **invio diretto** passano tutti attraverso l'accesso Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — schede dedicate: indirizzo e-mail più una **Password per app**, i server sono già precompilati (la maggior parte di queste schede permette anche di spuntare **Calendario e attività** nello stesso passaggio — una sola password per app per tutti i servizi scelti). L'assistente collega di volta in volta la guida ufficiale del provider per creare la password per app.
- **Server e-mail (IMAP)** — per qualsiasi altro provider: host, porta e una password oppure una **Password per app**. Sono disponibili preimpostazioni già pronte per provider di tutto il mondo — da **web.de**/**GMX** e **T-Online**, passando per **Orange**, **Libero**, **WP**, **Seznam** e **Comcast**, fino a **QQ Mail**, **NetEase**, **Naver** e **Yahoo! JAPAN**; il menu **Provider** ha per questo una riga di ricerca, e digitando il tuo indirizzo viene scelta automaticamente la preimpostazione corrispondente. Dove un provider ha delle particolarità, l'assistente lo segnala subito sotto il modulo: alcuni richiedono una **Password per app** o un **codice di autorizzazione** al posto della password dell'account, altri richiedono di attivare prima IMAP nelle impostazioni del provider — ciascuno con un link alla guida ufficiale. Per Gmail è `imap.gmail.com`, porta `993`, con una password per app da [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (richiede l'autenticazione a due fattori) — nessun OAuth, nessuna verifica; l'assistente lo segnala da solo per gli indirizzi Gmail. Le **caselle Outlook.com** non si possono più collegare tramite IMAP con password (Microsoft ha disattivato questa via) — la preimpostazione rimanda alla scheda **Microsoft**. **Proton Mail** funziona solo tramite il Proton Mail Bridge locale a pagamento (ha una propria preimpostazione). Aggiungi un host SMTP per inviare direttamente.

Il collegamento verifica l'accesso prima che venga salvato qualcosa; le credenziali finiscono nel portachiavi del sistema operativo. Le caselle collegate e le impostazioni di cattura si trovano poi nell'area **E-mail**: l'impostazione **Cartella e-mail** sceglie dove vengono salvate le e-mail catturate (predefinita `Mail`).

## Leggere le e-mail

Apri la scheda e-mail dalla barra delle azioni all'estrema sinistra (icona e-mail) o dalla palette dei comandi (**Apri e-mail**). L'elenco mostra la tua posta in arrivo dalla più recente (non lette in grassetto, **Carica altro** procede oltre). Selezionare un messaggio lo apre in un **visualizzatore sandbox**:

- **I contenuti remoti sono bloccati** — i pixel di tracciamento, le immagini remote e i caricatori di stile vengono rimossi e conteggiati ("Contenuti remoti bloccati (n)"). Vengono visualizzate solo le immagini inline autonome. **Mostra immagini** accanto al contatore rivela una tantum le immagini https del messaggio; **Carica sempre le immagini remote** nelle impostazioni della posta trasforma questo in un'opzione permanente. Attenzione: caricare le immagini remote permette al mittente di vedere il tuo indirizzo IP e quando hai aperto l'e-mail — per questo il blocco è l'impostazione predefinita.
- I link vengono mostrati come testo semplice e non sono cliccabili all'interno del visualizzatore.
- Gli script e i moduli non vengono mai eseguiti. Il messaggio viene visualizzato in un frame isolato con criteri di contenuto rigidi.

Gli allegati sono elencati con nome e dimensione; l'originale `.eml` (sotto) li contiene per intero.

## Portare un messaggio nel vault

Tre pulsanti su ogni messaggio:

- **Salva come nota** — crea una nota nella tua cartella e-mail (`AAAA-MM-GG Oggetto.md`) con mittente e data nel frontmatter e il corpo in testo semplice sotto l'intestazione dell'oggetto. Catturare due volte lo stesso messaggio apre la nota esistente invece di duplicarla.
- **+ .eml** — memorizza inoltre l'originale grezzo accanto alla nota e lo collega. Il file `.eml` contiene tutto, allegati inclusi, e si apre in qualsiasi programma di posta.
- **→ Attività** — crea una voce nel tuo [database attività predefinito](Tasks.md) con l'oggetto come titolo, la data odierna come scadenza e lo stato aperto precompilato.

## Scrivere e inviare

Non appena un account può inviare — un account **Microsoft**, oppure un account **IMAP** con un **host SMTP** configurato —, puoi scrivere e inviare e-mail da Plainva:

- **Scrivi** (nella scheda e-mail) apre una finestra fluttuante con righe etichettate **Da / A / Cc / Ccn**. Digita un indirizzo e premi Invio o virgola per trasformarlo in un chip; **Cc/Ccn** compaiono su richiesta. Il corpo è un editor Markdown con una barra degli strumenti di formattazione e un menu comandi "/".
- **Rispondi**, **Rispondi a tutti** e **Inoltra** su qualsiasi messaggio aprono la stessa finestra con l'originale citato e i destinatari precompilati; un inoltro porta con sé gli allegati.
- **Invia** parte via SMTP (account IMAP) o Microsoft Graph (account Microsoft).
- **Questa nota via e-mail** (menu `⋮` di una nota, o la palette dei comandi) avvia un messaggio con la nota attuale come allegato, oppure incorporata come testo.

## Consegnare una nota senza il client di posta

Non devi inviare dall'interno di Plainva. Questo funziona con qualsiasi nota e non richiede SMTP:

- **Rispondi come nota** (su un messaggio): crea una nota indirizzata al mittente (`to:` nel frontmatter) con l'originale citato — scrivi la tua risposta in Plainva.
- **Salva la nota come bozza nella casella** (palette dei comandi, su qualsiasi nota aperta): salva la nota come **bozza nella tua casella** tramite IMAP — scegli account, destinatario e cartella bozze, poi apri il tuo programma di posta abituale, controlla e invia da lì. La formattazione viene mantenuta.
- **Invia la nota via e-mail (mailto)** (palette dei comandi): apre il tuo programma di posta predefinito con la nota come testo semplice (le note lunghe vengono accorciate).
- **Copia la nota come testo e-mail** (palette dei comandi): mette la nota negli appunti con la formattazione — incollala in qualsiasi finestra di composizione e-mail.

## Azioni sulla casella

Stelle e contrassegni si sincronizzano tramite IMAP e Microsoft; **Contrassegnati** mostra la selezione del server. I messaggi si possono spostare singolarmente o in gruppo. Fuori dal cestino, **Elimina** significa sempre “sposta nel cestino”; solo nel cestino compare **Elimina definitivamente** dopo una conferma. Con Gmail, lo spostamento cambia le etichette e le azioni in **Tutti i messaggi** possono interessare il messaggio in ogni etichetta; Plainva avvisa prima.
