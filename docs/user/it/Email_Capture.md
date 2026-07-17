# Cattura e-mail

Ultimo aggiornamento: 2026-07-18

Plainva può leggere la tua casella di posta — e solo leggerla — per estrarre conoscenza dalle e-mail e portarla nel tuo vault. Deliberatamente **non** è un client di posta: si collega tramite IMAP in modalità di sola lettura, non modifica mai nulla nella casella (nemmeno i contrassegni di lettura) e non invia mai e-mail da sé.

## Collegare una casella di posta

**Impostazioni → Vault → Calendario e account → E-mail (IMAP, sola lettura) → Aggiungi account…**: host, porta e una **Password per app**. Per Gmail è `imap.gmail.com`, porta `993`, con una password per app da [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (richiede l'autenticazione a due fattori) — nessun OAuth, nessuna verifica. Il collegamento verifica l'accesso prima che venga salvato qualcosa; la password finisce nel portachiavi del sistema operativo. L'impostazione **Cartella e-mail** sceglie dove vengono salvate le e-mail catturate (predefinita `Mail`).

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

## Portare fuori i contenuti — senza inviare

Plainva non parla mai SMTP. Invece:

- **Rispondi come nota** (su un messaggio): crea una nota indirizzata al mittente (`to:` nel frontmatter) con l'originale citato — scrivi la tua risposta in Plainva.
- **Salva la nota come bozza nella casella** (palette dei comandi, su qualsiasi nota aperta): salva la nota come **bozza nella tua casella** tramite IMAP — scegli account, destinatario e cartella bozze, poi apri il tuo programma di posta abituale, controlla e invia da lì. La formattazione viene mantenuta.
- **Invia la nota via e-mail (mailto)** (palette dei comandi): apre il tuo programma di posta predefinito con la nota come testo semplice (le note lunghe vengono accorciate).
- **Copia la nota come testo e-mail** (palette dei comandi): mette la nota negli appunti con la formattazione — incollala in qualsiasi finestra di composizione e-mail.
