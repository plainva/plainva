# Competenze (Beta)

Ultimo aggiornamento: 2026-10-08

Una competenza è un insieme di istruzioni per un lavoro che ritorna: preparare una riunione, ordinare le tue attività, un riepilogo settimanale. Plainva ne include dodici e puoi scriverne di tue. Le competenze usano il formato aperto Agent Skills — una cartella con uno `SKILL.md` — e quindi funzionano anche in altre app di IA che leggono questo formato.

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
| **Controllo privacy** | Trova cosa di una nota dovrebbe restare su questo dispositivo e propone una regola. |
| **Riflessione** | Ripensa con te alle note di un giorno o di una settimana, con gentilezza e mai una diagnosi. |

Tutte si limitano a leggere: nessuna cambia una nota o invia qualcosa. Solo **Documentarsi** usa Internet, e solo **E-mail e calendario** legge le tue e-mail — vedi sotto. Controllo privacy e Riflessione sono pensate per un modello su questo dispositivo; con un modello nel cloud lo segnala il riepilogo di invio. Disattiva qualsiasi competenza sotto **Competenze**: l'interruttore vale per questo vault su questo dispositivo. **Crea la tua versione** ne copia una nel tuo vault, dove puoi modificarla.

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

Lo stesso vale per un `AGENTS.md` in cima al tuo vault: una volta approvato, le sue istruzioni permanenti accompagnano ogni nuova conversazione. Né una competenza né `AGENTS.md` possono annullare le tue regole sulla privacy, e una competenza non ottiene mai più di quanto ha una conversazione: può solo restringerlo.

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

## Cosa va al fornitore

Il riepilogo di invio elenca sotto **Istruzioni** cosa va insieme: la competenza della conversazione, l'elenco delle competenze che l'IA può caricare e `AGENTS.md`. Se istruzioni dal tuo vault vanno per la prima volta a un cloud, il riepilogo ricompare. I caratteri invisibili di una competenza non raggiungono mai un modello.

## Limiti della beta

Una competenza non esegue script propri; per i piccoli programmi che leggono il vault, vedi [Script](AI_Scripts.md). Le tue competenze non vengono offerte alle app di IA collegate tramite il server MCP; solo quelle incluse in Plainva.
