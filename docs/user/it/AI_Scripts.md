# Script (Beta)

Ultimo aggiornamento: 2026-10-08

Uno script è un piccolo programma per ciò che un modello fa male e che un programma fa ogni volta allo stesso modo: contare, ordinare, confrontare, sommare. Lo scrivi in JavaScript. Gira in un ambiente chiuso dentro Plainva: non può aprire un file, raggiungere la rete né rimandare qualcosa a più tardi. Chiama solo gli strumenti che hai spuntato per lui, e questi leggono il tuo vault come fanno gli strumenti dell'IA. Uno script non cambia nulla.

## Eseguire uno script

I tuoi script si trovano sotto **Competenze** nella scheda IA — sul telefono in **Conversazioni → Competenze** — nel gruppo **Script**. **Esegui** apre lo script: inserisci ciò che chiede e premi **Esegui**. Mentre gira, vedi ogni strumento che chiama, e **Interrompi** lo termina. Al termine la finestra mostra le **Chiamate**, il **Risultato** — che puoi copiare — e il **Registro**, insieme a quanto l'esecuzione ha usato dei suoi limiti.

Un'esecuzione che avvii da qui resta su questo dispositivo: nulla di ciò va a un modello, perciò legge anche le note che tieni lontane dal cloud. Con **Esecuzione di prova** vengono chiamati gli strumenti che leggono, mentre una chiamata che mostrerebbe qualcosa nell'app viene solo annotata.

## In una conversazione

In una conversazione normale l'IA può trovare i tuoi script attivi ed eseguirne uno quando serve; il passaggio dice allora **Esegue lo script «word-count»**. Lo script legge solo ciò che quella conversazione può leggere: una nota che tieni lontana dal cloud resta lontana, e ogni nota che lo script legge rientra tra quelle che l'esecuzione ha letto. Ciò che restituisce va al modello come dati, mai come istruzioni. A una conversazione avviata con una competenza non vengono offerti script, e nemmeno a un'app di IA collegata tramite il server MCP.

## Scrivere uno script

**Nuovo script** chiede:

- **Nome** — lettere minuscole, cifre e trattini; diventa la cartella.
- **Descrizione** — a cosa serve lo script; lo riconoscete da questa, tu e l'IA.
- **Strumenti** — spunta ciò che lo script può chiamare. Per lo script non esiste nient'altro.
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

Il linguaggio è JavaScript secondo lo standard ES2020. Non ci sono `fetch`, timer, `import` né accesso ai file, e ciò che uno script restituisce deve essere composto da dati che si possono scrivere come JSON. Uno strumento che rifiuta — una nota che non esiste, una nota che la conversazione non può leggere — lancia un errore che lo script può intercettare.

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
| `get_calendar` — **Lettura degli appuntamenti** | `from` e `to` come `YYYY-MM-DD`; facoltativi `details`, `limit` (fino a 100) | `events`: un elenco di `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Sta usando l'app** | `id`, un comando dell'app come `open-note`, `show-in-graph` o `open-calendar`; facoltativo `args` con `path`, `section` o `date` | `done`, `command` |

## Limiti

Uno script porta i suoi limiti nel proprio manifesto. Il modulo ne imposta tre:

| Limite | Predefinito | Intervallo |
|---|---|---|
| **Secondi di calcolo** | 5 | da 1 a 30 |
| **Chiamate a strumenti** | 20 | da 0 a 50 |
| **Memoria in MB** | 32 | da 8 a 128 |

Conta solo il tempo in cui uno script calcola, non quello che impiega uno strumento. Uno script che supera un limite viene terminato, la finestra dice di quale limite si trattava, e uno script terminato non restituisce nulla. Gli argomenti di una chiamata e il risultato possono essere grandi al massimo 64 KB ciascuno.

## Nulla si esegue prima che tu lo approvi

Uno script nuovo o modificato — arrivato con la sincronizzazione o scritto da un altro programma — non si esegue finché non lo approvi **su questo dispositivo**. Aspetta in alto in **Competenze**, sotto **In attesa della tua approvazione**. **Controlla e approva** mostra **Cosa può fare**, i suoi **Limiti**, i suoi **Dati in ingresso** e l'intero **Codice**, e dice se il codice si può leggere come JavaScript; il codice che non si può leggere non viene approvato.

Con **Approva**, questo dispositivo firma esattamente questi file. La chiave per farlo viene creata su questo dispositivo e conservata nel suo portachiavi. Qualsiasi modifica a un file annulla l'approvazione, e su ciascuno dei tuoi altri dispositivi lo script attende una propria approvazione — un'approvazione non si può portare da un dispositivo all'altro. Nel menu di uno script, **Ritira l'approvazione** la revoca, e **Mostra il codice** riapre il controllo.

## Limiti della beta

Gli script si limitano a leggere: non propongono modifiche. Una competenza non può avviare uno script, e la cartella `scripts/` di una competenza non viene eseguita. E-mail, Internet e gli strumenti dei server esterni non sono a disposizione degli script.
