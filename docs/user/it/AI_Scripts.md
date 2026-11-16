# Script (Beta)

Ultimo aggiornamento: 2026-11-16

Uno script è un piccolo programma per ciò che un modello fa male e che un programma fa ogni volta allo stesso modo: contare, ordinare, confrontare, sommare. Lo scrivi in JavaScript. Gira in un ambiente chiuso dentro Plainva: non può aprire un file, raggiungere la rete né rimandare qualcosa a più tardi. Chiama solo gli strumenti che hai spuntato per lui: questi leggono il tuo vault come fanno gli strumenti dell'IA, oppure lasciano una proposta su cui decidi tu. Uno script che avvii da qui non cambia nulla da solo; uno che l'IA avvia in una conversazione può scrivere direttamente dove lo consenti (vedi «In una conversazione» più sotto).

## Eseguire uno script

I tuoi script si trovano sotto **Competenze** nella scheda IA — sul telefono nel segmento **Competenze** dello schermo **IA** — nel gruppo **Script**. **Esegui** apre lo script: inserisci ciò che chiede e premi **Esegui**. Mentre gira, vedi ogni strumento che chiama, e **Interrompi** lo termina. Al termine la finestra mostra le **Chiamate**, il **Risultato** — che puoi copiare — e il **Registro**, insieme a quanto l'esecuzione ha usato dei suoi limiti.

Un'esecuzione che avvii da qui resta su questo dispositivo: nulla di ciò va a un modello, perciò legge anche le note che tieni lontane dal cloud. Con **Esecuzione di prova** vengono chiamati gli strumenti che leggono, mentre una chiamata che mostrerebbe qualcosa nell'app o lascerebbe una proposta viene solo annotata.

## In una conversazione

In una conversazione normale l'IA può trovare i tuoi script attivi ed eseguirne uno quando serve; il passaggio dice allora **Esegue lo script «word-count»**. Lo script legge solo ciò che quella conversazione può leggere: una nota che tieni lontana dal cloud resta lontana, e ogni nota che lo script legge rientra tra quelle che l'esecuzione ha letto. Ciò che restituisce va al modello come dati, mai come istruzioni. Una routine, l'esecuzione di prova di una competenza e i punti d'ingresso **Spiega immagine** e **Ricavane una nota** non eseguono alcuno script, a una conversazione avviata con una competenza non ne vengono offerti, e nemmeno a un'app di IA collegata tramite il server MCP.

## Proporre modifiche

Uno script può ricevere anche strumenti che propongono. Gli strumenti **Sta proponendo modifiche a una nota** e **Sta proponendo un valore di proprietà** lasciano una proposta a margine di una nota; gli strumenti **Sta preparando la bozza di una nota**, **Sta preparando la bozza di una voce di database**, **Sta preparando la bozza di un'attività** e **Sta preparando la bozza di una voce di diario** lasciano una bozza. Entrambe sono firmate con il nome dello script. Uno script che avvii da qui con **Esegui** non scrive nulla direttamente: nel tuo vault non cambia nulla prima che tu accetti una proposta o crei una bozza — esattamente come con una proposta dell'IA. Dopo un'esecuzione la finestra le elenca sotto **Proposte e bozze**; un'esecuzione avviata con **Esecuzione di prova** non lascia nulla.

Ciò che uno script ha letto decide dove può scrivere: una proposta o una bozza che si basa su una nota che tieni lontana dal cloud viene accolta solo da un luogo in cui vale la stessa regola. In una conversazione all'IA viene offerto uno script che propone solo dove può proporre la conversazione stessa, e ciò che lo script lascia lì porta il nome del modello della conversazione. Dove la conversazione applica le modifiche direttamente — con il chip **Applica direttamente** o per una destinazione in una cartella che consente **Modifica senza chiedere** —, viene applicato direttamente anche ciò che un tale script scrive: una modifica a una nota e alle sue proprietà, una nota nuova, una voce di database, un'attività o una voce di diario, con la stessa rete di sicurezza delle modifiche dirette dell'assistente (vedi «Applica direttamente» in [Assistente IA](AI_Assistant.md)). Senza questo consenso lo script lascia proposte e bozze, come sopra.

## Scrivere uno script

**Nuovo script** chiede:

- **Nome** — lettere minuscole, cifre e trattini; diventa la cartella.
- **Descrizione** — a cosa serve lo script; lo riconoscete da questa, tu e l'IA.
- **Strumenti** — spunta ciò che lo script può chiamare: sotto **Leggere** ciò che legge, sotto **Proporre** ciò che lascia una proposta o una bozza. Per lo script non esiste nient'altro.
- **Dati in ingresso** — ciò che lo script chiede all'avvio: un nome, se è un testo, un numero o sì o no, e se è obbligatorio.
- **Limiti** — secondi di calcolo, chiamate a strumenti e memoria.
- **Codice** — il programma.

**Crea e approva** scrive lo script nel tuo vault come `.agent/scripts/<name>/` — un `manifest.json` e un `main.js` — e lo approva su questo dispositivo. Nel menu di uno script, **Modifica** apre lo stesso modulo; **Salva e approva** sostituisce i file.

Il codice è il corpo di una funzione. `input` contiene i dati in ingresso, ciascuno sotto il proprio nome, `tools.<name>(…)` chiama uno strumento e si attende con await, `return` restituisce il risultato e `console.log(…)` scrive una riga nel registro:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

Il linguaggio è JavaScript attuale — ES2024 e gran parte di ES2025 — senza `Intl`. Non ci sono `fetch`, timer, `import` né accesso ai file, e ciò che uno script restituisce deve essere composto da dati che si possono scrivere come JSON. Uno strumento che rifiuta — una nota che non esiste, una nota che la conversazione non può leggere — lancia un errore che lo script può intercettare.

## Che cosa restituisce uno strumento

Nel modulo, **Che cosa restituisce uno strumento** apre questa pagina. Ogni strumento riceve un oggetto e ne restituisce uno; `cursor` prende il `next` della chiamata precedente e ne continua l'elenco.

| Strumento | Cosa passi | Cosa ottieni |
|---|---|---|
| `search_vault` — **Sta cercando nel vault** | `query`; facoltativi `folder`, `limit` (fino a 25), `cursor` | `results`: un elenco di `{ title, path, snippet }`; `next` |
| `read_note` — **Sta leggendo una nota** | `path`; facoltativi `section`, `maxChars` (da 200 a 20.000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Sta leggendo la struttura** | `path` | `path`; `properties`: nome e valore; `sections`: un elenco di `{ level, text, section }` |
| `query_base` — **Sta leggendo un database** | `base`, il percorso del file `.base`; facoltativi `view`, `limit` (fino a 50), `cursor` | `base`, `view`, `views`; `rows`: un elenco di `{ title, path, properties }`; `next` |
| `get_tasks` — **Sta leggendo le attività** | facoltativi `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (fino a 50), `cursor` | `tasks`: un elenco di `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Lettura dei backlink** | `path`; facoltativi `limit` (fino a 50), `cursor` | `path`; `notes`: un elenco di `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Seguo i collegamenti** | `path`; facoltativi `depth` (1 o 2), `limit` (fino a 50) | `path`; `notes`: un elenco di `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Guardo le note recenti** | facoltativi `kind` (`opened` o `edited`), `limit` (fino a 20) | `kind`; `notes`: un elenco di `{ title, path, at }` |
| `get_changes` — **Guardo cosa è cambiato** | `since` come `YYYY-MM-DD`; facoltativi `until`, `folder`, `limit` (fino a 20) | `since`, `until`; `notes`: un elenco di `{ path, title, kind, made, last, added, removed, gained }` |
| `get_note_history` — **Seguo l'evoluzione di una nota** | `path`; facoltativi `since` e `until` come `YYYY-MM-DD`, al massimo a 31 giorni l'uno dall'altro | `path`, `since`, `until`, `made`; `days`: un elenco di `{ day, added, removed, gained }` |
| `get_calendar` — **Lettura degli appuntamenti** | `from` e `to` come `YYYY-MM-DD`, al massimo a 31 giorni l'uno dall'altro; facoltativi `details`, `limit` (fino a 100) | `events`: un elenco di `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Sta usando l'app** | `id`, un comando dell'app come `open-note`, `show-in-graph` o `open-calendar`; facoltativo `args` con `path`, `section` o `date` | `done`, `command` |
| `propose_edit` — **Sta proponendo modifiche a una nota** | `path`; `edits`, un elenco di `{ find, replace }`, o `append`; facoltativi `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Sta proponendo un valore di proprietà** | `path`, `key`, `value`; facoltativo `note` | `proposed`, `path`, `property` |
| `create_note` — **Sta preparando la bozza di una nota** | `title`, `content`; facoltativo `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Sta preparando la bozza di una voce di database** | `base`, `title`; facoltativi `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Sta preparando la bozza di un'attività** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Sta preparando la bozza di una voce di diario** | `text`; facoltativo `task` | `drafted`, `kind` |

## Limiti

Uno script porta i suoi limiti nel proprio manifesto. Il modulo ne imposta tre:

| Limite | Predefinito | Intervallo |
|---|---|---|
| **Secondi di calcolo** | 5 | da 1 a 30 |
| **Chiamate a strumenti** | 20 | da 0 a 50 |
| **Memoria in MB** | 32 | da 8 a 128 |

Conta solo il tempo in cui uno script calcola, non quello che impiega uno strumento. Uno script che supera un limite — tempo, memoria, passaggi, numero di chiamate, dimensione degli argomenti di una chiamata o dimensione del risultato dello script stesso — viene terminato, la finestra dice di quale limite si trattava, e uno script terminato non restituisce nulla. La risposta di uno strumento più grande del limite per una chiamata non è una fine: lo script riceve un errore per quella chiamata e prosegue. Di serie gli argomenti di una chiamata, ciò che una chiamata restituisce e il risultato possono essere grandi al massimo 64 KB ciascuno; un manifesto può consentire fino a 256 KB.

## Nulla si esegue prima che tu lo approvi

Uno script nuovo o modificato — arrivato con la sincronizzazione o scritto da un altro programma — non si esegue finché non lo approvi **su questo dispositivo**. Aspetta in alto in **Competenze**, sotto **In attesa della tua approvazione**. **Controlla e approva** mostra **Cosa può fare**, i suoi **Limiti**, i suoi **Dati in ingresso** e l'intero **Codice**, e dice se il codice si può leggere come JavaScript; il codice che non si può leggere non viene approvato.

Con **Approva**, questo dispositivo firma esattamente questi file. La chiave per farlo viene creata su questo dispositivo e conservata nel suo portachiavi. Qualsiasi modifica a un file annulla l'approvazione, e su ciascuno dei tuoi altri dispositivi lo script attende una propria approvazione — un'approvazione non si può portare da un dispositivo all'altro. Nel menu di uno script, **Ritira l'approvazione** la revoca, e **Mostra il codice** riapre il controllo.

## Limiti della beta

Uno script propone e lascia bozze, e scrive direttamente solo in una conversazione in cui lasci che l'assistente applichi le modifiche direttamente; non rinomina, non sposta e non elimina mai una nota, e non scrive né e-mail né appuntamenti. Una competenza non può avviare uno script, e la cartella `scripts/` di una competenza non viene eseguita. E-mail, Internet e gli strumenti dei server esterni non sono a disposizione degli script.
