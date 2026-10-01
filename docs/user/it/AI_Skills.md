# Competenze (Beta)

Ultimo aggiornamento: 2026-10-01

Una competenza è un insieme di istruzioni per un lavoro che ritorna: preparare una riunione, ordinare le tue attività, un riepilogo settimanale. Plainva ne include dieci e puoi scriverne di tue. Le competenze usano il formato aperto Agent Skills — una cartella con uno `SKILL.md` — e quindi funzionano anche in altre app di IA che leggono questo formato.

## Usare una competenza

Avvia una competenza con un clic: come chip in una conversazione vuota (le tre più usate), sotto **Competenze** nella scheda IA, sul telefono in **Conversazioni → Competenze**, oppure dalla palette dei comandi. La conversazione procede allora con la competenza: le sue istruzioni vanno insieme, e usa solo gli strumenti e le cartelle che la competenza nomina.

Puoi anche semplicemente chiedere. In ogni conversazione l'IA conosce i nomi e le descrizioni delle tue competenze attive e ne carica una quando la tua domanda corrisponde: basta «prepara la mia prossima riunione».

## Le competenze incluse in Plainva

| Competenza | Cosa fa |
|---|---|
| **Orientamento del giorno** | Cosa conta oggi: attività in scadenza, appuntamenti e ciò su cui hai lavorato di recente. |
| **Riepilogo settimanale** | Gli ultimi sette giorni e la settimana che arriva, con tre suggerimenti. |
| **Stato del progetto** | Obiettivo, avanzamento, punti aperti e prossimo passo di un progetto. |
| **Preparare una riunione** | Prepara una riunione da note precedenti e punti aperti, oppure la riassume dopo. |
| **Smistare le attività** | Ordina le tue attività aperte: cosa ora, cosa può aspettare, cosa togliere. |
| **Scrivere e rivedere** | Riassume, accorcia o riscrive una nota, come testo che riprendi tu. |
| **Curare le conoscenze** | Trova note che dicono la stessa cosa, sono superate o non sono collegate a nulla. |
| **Sistemare i link** | Controlla i link di una nota: che non portano da nessuna parte, mancanti, a senso unico. |
| **Controllo privacy** | Trova cosa di una nota dovrebbe restare su questo dispositivo e propone una regola. |
| **Riflessione** | Ripensa con te alle note di un giorno o di una settimana, con gentilezza e mai una diagnosi. |

Tutte si limitano a leggere: nessuna cambia una nota, invia qualcosa o va su internet. Controllo privacy e Riflessione sono pensate per un modello su questo dispositivo; con un modello nel cloud lo segnala il riepilogo di invio. Disattiva qualsiasi competenza sotto **Competenze**: l'interruttore vale per questo vault su questo dispositivo. **Crea la tua versione** ne copia una nel tuo vault, dove puoi modificarla.

## Le tue competenze

**Nuova competenza** chiede un nome, una descrizione — in base a questa l'IA sceglie la competenza — e le istruzioni. Plainva le scrive come `.agent/skills/<nome>/SKILL.md` nel tuo vault, dove viaggiano con lui come qualsiasi nota. **Modifica** apre il file come una nota.

**Importa…** accetta una competenza come file `.zip` o `.skill`. Prima di scrivere qualcosa, Plainva la controlla: esattamente una competenza nel formato, nessun percorso fuori dalla sua cartella, i limiti di dimensione. Indica la licenza, gli script che non eseguirà e gli strumenti che non ha.

## Nulla si esegue prima che tu lo approvi

Una competenza del tuo vault che è nuova o modificata — tramite la sincronizzazione, un'importazione o una modifica su questo o un altro dispositivo — non si esegue finché non la approvi **su questo dispositivo**. Queste competenze aspettano in alto in **Competenze**, sotto **In attesa della tua approvazione**, e in **Impostazioni → IA e automazione** (la parte Vault). **Controlla e approva** mostra cosa può fare la competenza, cosa è cambiato dalla tua ultima approvazione, le sue istruzioni, i suoi file e dove si trova. L'approvazione vale esattamente per questa versione; qualsiasi modifica la annulla. Le approvazioni sono salvate su questo dispositivo, mai nel vault.

Lo stesso vale per un `AGENTS.md` in cima al tuo vault: una volta approvato, le sue istruzioni permanenti accompagnano ogni nuova conversazione. Né una competenza né `AGENTS.md` possono annullare le tue regole sulla privacy, e una competenza non ottiene mai più di quanto ha una conversazione: può solo restringerlo.

## Cosa va al fornitore

Il riepilogo di invio elenca sotto **Istruzioni** cosa va insieme: la competenza della conversazione, l'elenco delle competenze che l'IA può caricare e `AGENTS.md`. Se istruzioni dal tuo vault vanno per la prima volta a un cloud, il riepilogo ricompare. I caratteri invisibili di una competenza non raggiungono mai un modello.

## Limiti della beta

Le competenze non eseguono script, e quelle che richiedono il web o la tua posta arriveranno più avanti. Le tue competenze non vengono offerte alle app di IA collegate tramite il server MCP; solo quelle incluse in Plainva.
