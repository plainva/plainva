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

Aprila dalla barra delle azioni all'estrema sinistra (icona del calendario) o dalla palette dei comandi (**Apri calendario**). Tramite il selettore nell'intestazione sono disponibili cinque viste: **Giorno**, **3 giorni** e **Settimana** mostrano una **griglia oraria** con una colonna delle ore a sinistra; gli eventi appaiono come blocchi all'orario di inizio, la loro altezza corrisponde alla durata, gli eventi sovrapposti stanno affiancati e una linea rossa indica "adesso". Gli eventi per l'intera giornata e (con la sovrapposizione delle attività attiva) le attività in scadenza stanno nella striscia sopra la griglia. **Mese** mostra la griglia del mese (un punto colorato per calendario) più, a destra, una griglia oraria per il giorno selezionato. **Agenda** elenca le settimane a venire raggruppate per giorno. **Oggi** torna indietro; le frecce avanzano o retrocedono del periodo attivo (un giorno, tre giorni, una settimana o un mese). Il primo giorno della settimana segue l'impostazione **Inizio settimana** (Impostazioni → App → Aspetto: Lunedì, Sabato o Domenica) — si applica anche al calendario della barra laterale. La vista si aggiorna automaticamente ogni pochi minuti; il pulsante **Aggiorna ora** la forza.

- **Nuovo evento**: **cliccando su uno spazio vuoto nella griglia oraria** si apre una piccola finestra di creazione rapida (titolo, orario, calendario, luogo) — **Salva** lo crea subito, **Altre opzioni** apre il dialogo completo dell'evento. **Trascinando** sulla griglia si imposta la durata. Il **+** nell'intestazione apre il dialogo completo: titolo, calendario, data/ora o un intervallo per l'intera giornata, luogo, descrizione ed eventualmente una semplice **ripetizione** (Giornaliera/Settimanale/Mensile/Annuale).
- **Modifica / elimina**: **cliccando su un evento** nella griglia oraria si apre il dialogo precompilato con i suoi valori e con le azioni **Nota della riunione** ed **Elimina**. Le modifiche vengono scritte presso il provider con un controllo di sicurezza: se l'evento è cambiato in remoto nel frattempo, Plainva aggiorna la vista invece di sovrascrivere.
- **Sposta / ridimensiona**: puoi **trascinare** un evento direttamente nella griglia oraria — trascinando il corpo lo si sposta a un altro orario (anche su un altro giorno nella vista Settimana o 3 giorni), trascinando il suo **bordo inferiore** se ne cambia la durata. Il nuovo orario viene scritto subito presso il provider (per ora gli eventi ricorrenti restano modificabili solo tramite il dialogo).
- Gli **eventi ricorrenti** portano un badge di ripetizione. Modificare o eliminare un'istanza chiede **"Solo questo evento"** (crea un'eccezione / salta solo quell'occorrenza) o **"Tutti gli eventi"** (modifica l'intera serie). Plainva non riscrive mai una regola di ricorrenza esistente.
- **Mostra attività** (accanto al pulsante **Aggiorna ora**, quando è impostato un database attività predefinito): sovrappone le voci con scadenza del tuo [database attività predefinito](Tasks.md) sulla striscia della griglia oraria e sulla griglia mensile; le attività completate appaiono barrate. Disattivata per impostazione predefinita, la scelta viene ricordata per dispositivo.

## Evento → nota della riunione

L'icona a forma di nota su qualsiasi evento crea (o riapre) la sua **nota della riunione** — una nota normale nella tua cartella riunioni chiamata `AAAA-MM-GG Titolo.md`, precompilata con data, luogo e partecipanti, più una piccola marcatura `plainva.pim` nel frontmatter che la collega all'evento. Un nuovo clic sullo stesso evento apre sempre la stessa nota; una tua nota che per caso condivide lo stesso nome non viene mai toccata.

## Elenchi attività esterni nel database attività

Spunta un **elenco attività** in un account collegato e le sue attività appaiono come note nel tuo [database attività predefinito](Tasks.md): il titolo diventa la nota (H1), la scadenza finisce nella colonna della data del database, e il completamento si riflette nella **proprietà casella di controllo di completamento** del database (la colonna di stato la segue; un database senza colonna casella di controllo utilizza la convenzione di stato — prima opzione = aperta, ultima = completata). La sincronizzazione è bidirezionale e per campo:

- Modifichi la nota (titolo, scadenza, stato) → la modifica viene inviata al provider.
- Cambi l'attività da remoto → la nota si adegua.
- Se entrambe le parti sono cambiate, per quel campo vince la tua modifica locale; il resto segue il lato remoto.

Due regole di sicurezza proteggono i tuoi dati: **eliminare la nota non elimina mai l'attività remota** (smette semplicemente di sincronizzarsi e non viene reimportata), e **un'attività eliminata da remoto non elimina mai la tua nota** (diventa semplicemente una nota normale). Rinominare o spostare una nota di attività va bene — la marcatura nel frontmatter mantiene il collegamento.

Limiti attuali: le attività create come normali note non vengono inviate al provider (creale da remoto o tramite il database attività), e per ora tutto in questa pagina è desktop-first.
