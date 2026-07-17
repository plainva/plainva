# Guida utente di Plainva

Ultimo aggiornamento: 2026-07-06

Questa traduzione è stata generata automaticamente — le correzioni sono benvenute.

Plainva è un editor di vault Markdown: le tue note sono semplici file Markdown in una cartella (un "vault") sul tuo computer — nessun silo di database, nessun account cloud imposto. Questa guida spiega come lavorare con Plainva e come funzionano i formati dei file.

## Sommario

| Pagina | Cosa copre |
|---|---|
| [Per iniziare](Getting_Started.md) | Aprire o creare un vault, l'interfaccia, le modalità dell'editor, le schede e la vista divisa |
| [Note e Markdown](Notes_and_Markdown.md) | Come funzionano i file Markdown: scrittura, formattazione, proprietà (frontmatter), icone, link, modelli, immagini |
| [Database (.base)](Databases_Base.md) | Visualizzare le note come un database — viste, filtri, proprietà, relazioni, nuovi elementi (simile a Notion, ma basato su file) |
| [OKF](OKF.md) | L'Open Knowledge Format: `type`, `okf_version`, la gestione di index.md e la conversione facoltativa del vault |
| [File Format Reference](File_Format_Reference.md) | Il formato esatto su disco di ogni file del vault — per strumenti, script o un'IA che modifica direttamente note e file `.base` |
| [Automazione e script](Automation_and_Scripts.md) | Estendere Plainva senza plugin: come script, strumenti CLI e agenti IA leggono e scrivono un vault in sicurezza |
| [Backup e cronologia delle versioni](Backups_and_Versioning.md) | Versioni automatiche dei file, ripristino (anche dei file eliminati) e backup ZIP giornalieri del vault |
| [L'app mobile](Mobile_App.md) | Plainva su Android e iOS: struttura, modifica, database, sincronizzazione e rete di sicurezza |
| [Configurare la sincronizzazione](Sync_Setup.md) | Passo dopo passo per provider: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Compatibilità di sincronizzazione](Sync_Compatibility.md) | Quali servizi funzionano oggi — direttamente, tramite WebDAV o tramite il client desktop del provider |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Configurare la sincronizzazione con Google Drive usando le tue credenziali |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Configurare la sincronizzazione con OneDrive e Dropbox usando una registrazione app personale |
| [Ricerca](Search.md) | Ricerca full-text, selettore rapido, trova e sostituisci, tag |
| [Attività](Tasks.md) | La vista delle attività di tutto il vault: ogni casella di controllo nelle tue note, con filtri per stato/tag/cartella/scadenza e spunta con un clic |
| [Calendario e attività esterne](Calendar_and_Tasks.md) | Collegare calendari CalDAV/Google/Microsoft, la scheda del calendario, le note delle riunioni e la sincronizzazione degli elenchi attività esterni con il database attività |
| [Cattura e-mail](Email_Capture.md) | IMAP di sola lettura: il visualizzatore sandbox, salvare le e-mail come note/.eml/attività e ottenere i contenuti senza inviare |
| [Grafo](Graph.md) | Grafo contestuale, mappa del vault con modalità di pulizia e viaggio nel tempo, grafo come vista database |
| [Scorciatoie da tastiera](Keyboard_Shortcuts.md) | Tutte le scorciatoie da tastiera in un colpo d'occhio |
| [FAQ e risoluzione dei problemi](FAQ.md) | Domande frequenti: compatibilità con Obsidian, file in conflitto, backup e altro |

## Principi fondamentali

- **I tuoi file appartengono a te.** Un vault è una semplice cartella di file Markdown. Puoi aprirla, copiarla o farne un backup con qualsiasi altro programma in qualsiasi momento.
- **Il Markdown puro è il formato canonico.** Anche le funzionalità aggiuntive (proprietà, icone, database) sono memorizzate in formati di testo aperti e leggibili.
- **Compatibile con Obsidian.** I vault Obsidian esistenti non vengono mai danneggiati né riformattati; Obsidian può aprire ogni file creato da Plainva.
