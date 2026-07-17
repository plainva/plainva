# Calendario e attività esterne

Ultimo aggiornamento: 2026-07-18

Plainva può collegare i tuoi account calendario e attività esistenti — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendario + Tasks) e **Microsoft** (Calendario Outlook + To Do) — e lavorare con essi in entrambe le direzioni. Le tue note restano il centro: gli eventi possono diventare note delle riunioni, e le liste di attività esterne si specchiano nel tuo [database attività predefinito](Tasks.md) come note ordinarie.

## Collegare un account

Apri **Impostazioni → Vault → Calendario e account → Aggiungi account…** e scegli un provider:

- **CalDAV**: URL del server, nome utente e una **Password per app** (in Nextcloud: Impostazioni → Sicurezza → Dispositivi e sessioni). Nessuna registrazione, nessuna chiave.
- **Google**: necessita di un proprio ID client OAuth (lo stesso modello BYO della sincronizzazione con Google Drive — vedi la [guida a Drive](Google_Drive_BYO_Guide.md)). Nel tuo progetto Google Cloud, abilita inoltre le *Google Calendar API* e *Google Tasks API* e aggiungi i loro ambiti alla schermata di consenso. Il browser si apre per il consenso; il collegamento verifica l'account prima che venga salvato qualcosa.
- **Microsoft**: basta cliccare su **Collega** e confermare nel browser — non serve alcuna configurazione.

Ogni account elenca i suoi **calendari** (quelli spuntati compaiono nella scheda del calendario) e i suoi **elenchi attività** (deliberatamente non spuntati per impostazione predefinita — spuntandone uno avvia la sincronizzazione delle attività descritta di seguito). Le password e i token sono memorizzati nel portachiavi del sistema operativo. L'impostazione **Cartella riunioni** sotto gli account sceglie dove vengono create le note delle riunioni.

## La scheda del calendario

Aprila dalla barra delle azioni all'estrema sinistra (icona del calendario) o dalla palette dei comandi (**Apri calendario**). Ottieni una griglia mensile con i tuoi eventi (un punto colorato per calendario) e un riquadro del giorno che elenca il giorno selezionato — prima gli eventi per l'intera giornata, poi quelli con orario, nome del calendario e luogo. La vista si aggiorna automaticamente ogni pochi minuti; il pulsante **Aggiorna ora** la forza.

- **Nuovo evento**: il **+** nel riquadro del giorno — titolo, calendario, data/ora o un intervallo per l'intera giornata, luogo ed eventualmente una semplice **ripetizione** (Giornaliera/Settimanale/Mensile/Annuale).
- **Modifica / elimina**: le icone a forma di matita e cestino su un evento. Le modifiche vengono scritte presso il provider con un controllo di sicurezza: se l'evento è cambiato in remoto nel frattempo, Plainva aggiorna la vista invece di sovrascrivere.
- Gli **eventi ricorrenti** portano un badge di ripetizione. Modificare o eliminare un'istanza chiede **"Solo questo evento"** (crea un'eccezione / salta solo quell'occorrenza) o **"Tutti gli eventi"** (modifica l'intera serie). Plainva non riscrive mai una regola di ricorrenza esistente.
- **Mostra attività** (accanto al pulsante **Aggiorna ora**, quando è impostato un database attività predefinito): sovrappone le voci con scadenza del tuo [database attività predefinito](Tasks.md) sulla griglia mensile e sul riquadro del giorno; le attività completate appaiono barrate. Disattivata per impostazione predefinita, la scelta viene ricordata per dispositivo.

## Evento → nota della riunione

L'icona a forma di nota su qualsiasi evento crea (o riapre) la sua **nota della riunione** — una nota normale nella tua cartella riunioni chiamata `AAAA-MM-GG Titolo.md`, precompilata con data, luogo e partecipanti, più una piccola marcatura `plainva.pim` nel frontmatter che la collega all'evento. Un nuovo clic sullo stesso evento apre sempre la stessa nota; una tua nota che per caso condivide lo stesso nome non viene mai toccata.

## Elenchi attività esterni nel database attività

Spunta un **elenco attività** in un account collegato e le sue attività appaiono come note nel tuo [database attività predefinito](Tasks.md): il titolo diventa la nota (H1), la scadenza finisce nella colonna della data del database, e il completamento si riflette nella colonna dello stato (prima opzione = aperta, ultima opzione = completata). La sincronizzazione è bidirezionale e per campo:

- Modifichi la nota (titolo, scadenza, stato) → la modifica viene inviata al provider.
- Cambi l'attività da remoto → la nota si adegua.
- Se entrambe le parti sono cambiate, per quel campo vince la tua modifica locale; il resto segue il lato remoto.

Due regole di sicurezza proteggono i tuoi dati: **eliminare la nota non elimina mai l'attività remota** (smette semplicemente di sincronizzarsi e non viene reimportata), e **un'attività eliminata da remoto non elimina mai la tua nota** (diventa semplicemente una nota normale). Rinominare o spostare una nota di attività va bene — la marcatura nel frontmatter mantiene il collegamento.

Limiti attuali: le attività create come normali note non vengono inviate al provider (creale da remoto o tramite il database attività), e per ora tutto in questa pagina è desktop-first.
