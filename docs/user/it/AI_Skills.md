# Competenze (Beta)

Ultimo aggiornamento: 2026-10-09

Una competenza è un insieme di istruzioni per un lavoro che ritorna: preparare una riunione, ordinare le tue attività, un riepilogo settimanale. Plainva ne include tredici e puoi scriverne di tue. Le competenze usano il formato aperto Agent Skills — una cartella con uno `SKILL.md` — e quindi funzionano anche in altre app di IA che leggono questo formato.

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
| **Documentarsi** | Si documenta su una domanda, sia sul web sia nelle tue note, con ogni fonte citata. |
| **E-mail e calendario** | Passa in rassegna le e-mail recenti e i prossimi appuntamenti: cosa richiede una risposta, cosa preparare, quali attività ne derivano. |
| **Scrivere e rivedere** | Riassume, accorcia o riscrive una nota, come testo che riprendi tu. |
| **Curare le conoscenze** | Trova note che dicono la stessa cosa, sono superate o non sono collegate a nulla. |
| **Sistemare i link** | Controlla i link di una nota: che non portano da nessuna parte, mancanti, a senso unico. |
| **Curare la memoria** | Rilegge la memoria: voci che dicono la stessa cosa, si contraddicono o sono superate — e prepara bozze di ciò che va unito e di ciò che si può togliere. |
| **Controllo privacy** | Trova cosa di una nota dovrebbe restare su questo dispositivo e propone una regola. |
| **Riflessione** | Ripensa con te alle note di un giorno o di una settimana, con gentilezza e mai una diagnosi. |

Tutte si limitano a leggere: nessuna cambia una nota o invia qualcosa. La competenza che prepara bozze è **Curare la memoria**: ciò che propone per la memoria resta in attesa finché non lo accetti. Solo **Documentarsi** usa Internet, e solo **E-mail e calendario** legge le tue e-mail — vedi sotto. Controllo privacy e Riflessione sono pensate per un modello su questo dispositivo; con un modello nel cloud lo segnala il riepilogo di invio. Disattiva qualsiasi competenza sotto **Competenze**: l'interruttore vale per questo vault su questo dispositivo. **Crea la tua versione** ne copia una nel tuo vault, dove puoi modificarla.

## Su Internet e nelle tue e-mail

**Documentarsi** è l'unica competenza inclusa in Plainva che usa Internet. Avviarla è una tua scelta per la sua conversazione, come il globo sotto il campo di testo: dove hai attivato **L'IA può usare Internet in questo vault**, cerca e legge pagine — e finché le tue note sono nella conversazione, ogni pagina e ogni ricerca chiede comunque prima, come descritto sotto **Su Internet** in [Assistente IA](AI_Assistant.md). Dove l'interruttore è disattivato, si documenta solo nelle tue note e lo dice. Lo stesso vale quando l'IA carica da sola la competenza in una conversazione che hai iniziato senza Internet.

**E-mail e calendario** legge le e-mail con la stessa domanda di qualsiasi conversazione: **Leggere le tue e-mail?** la prima volta. Non legge mai da sola il testo di un messaggio; un secondo lettore senza strumenti ne scrive un rapporto. Entrambe le cose sono descritte in [Assistente IA](AI_Assistant.md).

Una tua competenza usa Internet solo quando la sua riga `allowed-tools` nomina `web_search` o `fetch_url`. **Controlla e approva** dice allora **Usa Internet dove l'hai consentito per questo vault.** prima che tu la approvi. Una competenza che non nomina alcuno strumento non porta mai con sé Internet.

Un'esecuzione di prova non usa mai Internet e non chiede mai: le e-mail che in questa sessione non aveva il permesso di leggere restano non lette.

## Proporre modifiche

Una tua competenza propone modifiche solo quando la sua riga `allowed-tools` nomina gli strumenti adatti: `propose_edit` e `set_property` per le proposte sul testo e sulle proprietà di una nota, `create_note`, `create_entry`, `create_task` e `add_journal_entry` per le bozze, `rename_note`, `move_note` e `delete_note` per i piani. **Controlla e approva** allora li nomina uno per uno e dice **Può proporre modifiche, lasciare bozze e presentare piani. Nel vault non cambia nulla prima che tu accetti, crei o confermi.** Una competenza che non nomina alcuno strumento non propone nulla — nemmeno una che avevi approvato prima ci guadagna qualcosa —, e un'esecuzione di prova non lascia nulla. Che cosa sono le tre forme: **Proporre modifiche** in [Assistente IA](AI_Assistant.md).

## Le tue competenze

**Nuova competenza** chiede un nome, una descrizione — in base a questa l'IA sceglie la competenza — e le istruzioni. Plainva le scrive come `.agent/skills/<nome>/SKILL.md` nel tuo vault, dove viaggiano con lui come qualsiasi nota. **Modifica** apre il file come una nota.

**Importa…** accetta una competenza come file `.zip` o `.skill`. Prima di scrivere qualcosa, Plainva la controlla: esattamente una competenza nel formato, nessun percorso fuori dalla sua cartella, i limiti di dimensione. Indica la licenza, gli script che non eseguirà e gli strumenti che non ha. I file nascosti — nomi che iniziano con un punto — non fanno parte di una competenza e vengono tralasciati.

## Nulla si esegue prima che tu lo approvi

Una competenza del tuo vault che è nuova o modificata — tramite la sincronizzazione, un'importazione o una modifica su questo o un altro dispositivo — non si esegue finché non la approvi **su questo dispositivo**. Queste competenze aspettano in alto in **Competenze**, sotto **In attesa della tua approvazione**, e in **Impostazioni → IA e automazione** (la parte Vault). **Controlla e approva** mostra cosa può fare la competenza, cosa è cambiato dalla tua ultima approvazione, le sue istruzioni, i suoi file e dove si trova. L'approvazione vale esattamente per questa versione; qualsiasi modifica la annulla. Le approvazioni sono salvate su questo dispositivo, mai nel vault.

Lo stesso vale per un `AGENTS.md` in cima al tuo vault: una volta approvato, le sue istruzioni permanenti accompagnano ogni nuova conversazione. Né una competenza né `AGENTS.md` possono annullare le tue regole sulla privacy, e una competenza non ottiene mai più di quanto ha una conversazione: può solo restringerlo. Una regola che aggiungi nella memoria, o che accetti dall'IA, è una riga in più di questo file; vedi [Memoria](AI_Memory.md).

## Verificare le competenze con un modello

Una competenza può portare scenari di prova: un messaggio che la avvia e ciò che fa una buona esecuzione. Le competenze fornite li hanno; per le tue, scrivili in `tests/scenarios.json` nella cartella della competenza:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` indica gli strumenti che una buona esecuzione usa e quelli che non deve toccare; `cites`, le note che la sua risposta nomina; `never`, testo che non deve comparirvi. Una competenza ha al massimo otto scenari.

**Verifica con ⟨modello⟩** — in fondo a **Competenze** o nel menu di una competenza — esegue gli scenari con il modello che userebbe una nuova conversazione. Nulla parte da solo: la finestra dice prima quanti scenari girerebbero e con quale modello, e tu imposti un **Tetto** in dollari statunitensi; la verifica termina tra due scenari appena viene raggiunto. Se per il modello non è noto alcun prezzo, la verifica termina dopo un numero fisso di token; un modello su questo dispositivo non ha bisogno di un tetto.

Ogni scenario è un'esecuzione normale della sua competenza: legge il tuo vault come un'esecuzione a mano, passa dallo stesso riepilogo prima dell'invio, conta nel tuo consumo e lascia la sua conversazione nella cronologia, dove la sua prossima esecuzione la sostituisce. Poi ogni scenario mostra il suo esito a parole, e la riga della competenza dice com'è andata la sua ultima esecuzione. Un esito vale per un modello e una versione della competenza: se scegli un altro modello o modifichi la competenza, la riga lo dice invece di mostrare un esito che non conta più. Alcuni scenari forniti chiedono di note del vault di prova di Plainva; nel tuo vault non valgono, e la finestra li conta a parte invece di considerarli falliti.

## Imparare da una conversazione

Una conversazione può lasciare qualcosa: un fatto che vale la pena conoscere, una regola o una competenza che non si è spinta abbastanza in là. Per chiederlo c'è **Impara da questa conversazione** — nel menu di una conversazione nell'elenco e sotto la sua ultima risposta. Nulla legge le tue conversazioni in background.

Una finestra dice prima cosa accadrebbe: la conversazione viene inviata ancora una volta al modello con cui è stata condotta, e a nessun altro — ciò che hai scritto e le risposte ricevute, con i nomi degli strumenti usati. Non va insieme nulla di ciò che uno strumento ha restituito, né alcuna nota. Se nella conversazione è stata eseguita una tua competenza, le sue istruzioni vanno insieme, così da poter proporre una versione migliore. **Impara** avvia la rilettura; costa una richiesta.

Ciò che ritorna sono bozze, ciascuna con il **Riscontro** che la rilettura ne dà, e nulla di tutto ciò vale finché non lo accetti. La decisione su una voce per la memoria e su una regola si prende sulla rispettiva scheda, come descritto in [Memoria](AI_Memory.md). La bozza di una competenza ha invece il pulsante **Controlla**.

Una conversazione che ha letto una pagina web, un'e-mail o uno strumento esterno propone solo voci per la memoria: ciò che ha scritto uno sconosciuto non diventa né una regola né una competenza. Lo stesso vale se la conversazione si basa su note tenute lontane dal cloud o da Internet, e le voci che ne derivano portano con sé questa regola. Una conversazione condotta con un modello su questo dispositivo viene riletta su questo dispositivo.

### Accettare una proposta per una competenza

**Controlla** mostra cosa cambierebbe, riga per riga, e cosa può fare la competenza. Ciò che può fare resta com'è: una proposta cambia le istruzioni di una competenza e nient'altro. Strumenti, cartelle e limiti della competenza non li stabilisce mai un modello. La finestra dice inoltre se la versione attuale è stata verificata, quanto costa in più o in meno un'esecuzione e da quale conversazione proviene la proposta. **Rielabora** trasforma il confronto in un campo in cui puoi scrivere.

**Accetta** scrive la nuova versione e la approva su questo dispositivo, perché l'hai vista qui. Sugli altri tuoi dispositivi la competenza attende poi la rispettiva approvazione, come per qualsiasi modifica. Una proposta per una nuova competenza parte con i valori predefiniti di Plainva: legge e mostra, e non cambia nulla. Una competenza che hai importato e le competenze incluse in Plainva non vengono mai riscritte da una proposta.

### Versioni sotto osservazione e la via del ritorno

Una versione nata da una proposta resta sotto osservazione per tre esecuzioni, e la sua riga le conta. Se un'esecuzione non termina con una risposta, la sezione delle competenze nomina la competenza sotto **Versioni sotto osservazione** e offre due possibilità: **Torna alla versione precedente** oppure **Mantieni**. Non si torna mai indietro da soli.

Nel menu di una competenza, **Versioni precedenti…** elenca ciò che la cronologia delle versioni del vault conserva del file della competenza. La finestra mette a confronto la versione che scegli con la competenza com'è ora — le sue righe e ciò che può fare — e avvisa dove la versione precedente può fare di più. **Ripristina questa versione** la riscrive e la approva su questo dispositivo. Le versioni sono conservate su questo dispositivo.

Per una competenza cambiata in qualsiasi altro modo — tramite la sincronizzazione o una modifica su un altro dispositivo — **Controlla e approva** dice lo stesso sotto **Rispetto alla versione approvata**: quali strumenti sono stati aggiunti e quali tolti, le cartelle, il limite.

Sotto **Cosa è stato imparato** la sezione delle competenze apre `.agent/logs/learning.md`: una riga per ogni competenza e ogni regola accettate da una proposta, con il giorno e la conversazione. Il file viaggia con il tuo vault.

## Riordino

Le competenze si accumulano. Sotto **Riordino**, la vista delle competenze segnala ciò che questo dispositivo ha notato da sé. Nessun modello viene interpellato e nulla viene inviato, e ogni riga è una domanda, non un'affermazione:

- Due competenze che dicono quasi la stessa cosa, perciò l'IA sceglie ora l'una, ora l'altra. **Confronta** mostra le due competenze una accanto all'altra.
- Una tua competenza che non viene eseguita da più di 90 giorni. **Disattiva** toglie la competenza dal catalogo; resta nel vault.
- Una competenza il cui elenco cita uno strumento che Plainva non ha. Viene eseguita senza quello strumento.
- Una competenza che non ha superato la sua verifica con il modello scelto ora.
- Una competenza le cui esecuzioni continuano a finire senza risposta, e un percorso che hai seguito a mano in tre conversazioni. In entrambi i casi una rilettura dell'ultima conversazione di questo tipo può proporre qualcosa — come descritto in «Imparare da una conversazione»: costa una richiesta e chiede prima conferma.

Ogni riga offre un passaggio e nessuno viene eseguito al posto tuo. **Non mostrare più** mette da parte una riga su questo dispositivo; ricompare quando è cambiata la situazione stessa.

## Cosa va al fornitore

Il riepilogo di invio elenca sotto **Istruzioni** cosa va insieme: la competenza della conversazione, l'elenco delle competenze che l'IA può caricare e `AGENTS.md`. Se istruzioni dal tuo vault vanno per la prima volta a un cloud, il riepilogo ricompare. I caratteri invisibili di una competenza non raggiungono mai un modello.

## Limiti della beta

Una competenza non esegue script propri; per i piccoli programmi che leggono il vault, vedi [Script](AI_Scripts.md). Le tue competenze non vengono offerte alle app di IA collegate tramite il server MCP; solo quelle incluse in Plainva.
