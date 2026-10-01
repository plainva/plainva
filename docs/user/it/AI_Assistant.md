# Assistente IA (Beta)

Ultimo aggiornamento: 2026-10-01

Plainva può rispondere a domande sulle tue note con un modello IA di tua scelta. Legge il tuo vault, cita le note su cui si basa, apre note e viste per te e propone modifiche a un passaggio selezionato come proposte — non cambia mai una nota da solo. L'assistente è **sperimentale** ed è disattivato finché non lo attivi, singolarmente su ogni dispositivo.

## Attivare l'IA

Apri **Impostazioni → IA e automazione** (la parte App) e attiva **Usa l'IA su questo dispositivo**. Senza l'interruttore non ci sono né il pulsante IA, né la scheda IA, né il compagno. Non viene inviato nulla finché non fai una domanda.

## Scegliere un provider

Plainva non porta un proprio servizio IA: usi un provider di tua scelta, con una tua chiave. Ogni provider può essere scelto; Plainva indica le loro condizioni e i tempi di conservazione, così decidi tu — non ne esclude nessuno.

| Tipo | Provider |
|---|---|
| Provider cloud | Anthropic, OpenAI, Google Gemini |
| Gateway e server propri | OpenRouter, qualsiasi **Server compatibile con OpenAI** |
| Su questo computer (desktop) | Ollama, LM Studio |

1. In **IA e automazione**, scegli **Aggiungi provider** e selezionane uno. Ogni voce porta una breve nota sulle sue condizioni — per esempio che l'accesso gratuito di Google può permettere a delle persone di leggere i tuoi input.
2. Inserisci la chiave con **Inserisci chiave**. La chiave va nell'archivio sicuro di questo dispositivo; Plainva non la mostra mai più — né all'IA né sullo schermo.
3. **Verifica connessione** carica la lista dei modelli del provider. Se fallisce, il messaggio spiega perché (una chiave rifiutata, nessuna connessione, un modello sconosciuto).

Un **Server compatibile con OpenAI** si aggiunge tramite il suo indirizzo. Plainva chiede ancora una volta conferma prima di aggiungerlo, in una finestra del sistema operativo, e invia solo all'indirizzo che hai confermato. `http` semplice funziona solo per un server su questo dispositivo; tutto il resto richiede `https`.

Se non hai ancora una chiave: un modello su questo computer (Ollama, LM Studio) non costa nulla, e la console di ogni provider rilascia chiavi.

## Modelli e profili

Quattro profili — **Veloce**, **Bilanciato**, **Potente** e **Locale** — sono la tua assegnazione di modelli. Scegli un provider e un modello per ciascuno, dalla lista del provider oppure digitando l'ID del modello esattamente come lo chiama il provider. **Predefinito per le nuove conversazioni** stabilisce con quale profilo inizia una nuova conversazione. Plainva non definisce nessun modello «il migliore».

Un quinto posto, **Audio**, contiene il modello che trascrive le note vocali; non è mai quello predefinito per una conversazione.

Un sesto posto, **Embedding**, contiene il modello con cui calcola la ricerca per significato quando scegli **Provider proprio** in **Ricerca semantica** — vedi [Ricerca](Search.md).

## Chiedere

- **Desktop:** il pulsante IA nella barra delle azioni, **Ctrl+J** (⌘J su macOS) oppure **Chiedi all'IA** nella palette dei comandi apre il compagno — una piccola finestra sopra il tuo lavoro. **Apri come scheda** sposta la stessa conversazione nella scheda IA, dove sono elencate le tue conversazioni.
- **Telefono:** **Chiedi all'IA** nel menu ⋮ di una nota apre il foglio IA sopra quella nota. L'area **IA** (nel foglio delle aree, o nella barra di navigazione se la metti lì) mostra la conversazione a schermo intero; **Conversazioni** elenca quelle precedenti.
- **Accanto alla nota:** sul desktop la stessa conversazione è l'ultima sezione della barra laterale destra, **IA**. Su un telefono o un tablet è la scheda **IA** del contesto della nota — accanto a **Proprietà** e **Backlink** —, che un tablet mostra accanto alla nota.

La nota che hai aperta viene inclusa automaticamente; rimuovila dal contesto con la sua ✕ se vuoi. **Fissa una nota…** aggiunge altre note. L'assistente può anche cercare da solo: consulta il vault, legge le note e le loro sezioni, i database, i backlink e le note collegate, elenca le attività, gli appuntamenti e le note aperte o modificate di recente, e apre note e viste. Non può cambiare, creare o eliminare nulla.

Ogni conversazione inizia con la riga «Le risposte sono scritte da un'IA — ⟨modello⟩ tramite ⟨provider⟩». Sotto ogni risposta una riga indica cosa è stato inviato e dove: quante note, all'incirca quanti token e — dove il provider pubblica i prezzi — il costo approssimativo. **Interrompi** termina una risposta in qualsiasi momento.

Un link in una risposta si apre solo dopo che ne hai confermato l'indirizzo, e le immagini nelle risposte non vengono mai caricate.

## Cosa parte con una domanda

A ogni domanda Plainva raccoglie ciò che può contare — su questo dispositivo, prima di inviare qualsiasi cosa:

- **Dove ti trovi:** data e ora, la nota o il database aperto e la tua selezione, le schede aperte, le attività in scadenza nella prossima settimana, i prossimi appuntamenti e la nota di oggi.
- **Note che possono contare:** trovate a partire dalle tue parole, dai link della nota aperta e da ciò che hai aperto o modificato di recente. Prima decidono le tue regole sulla privacy; vengono valutate solo le note che esse consentono. Alcune partono come sezioni — non come note intere —, altre solo con il titolo e una scheda — la prima frase della loro sezione e ogni frase con numeri, date, attività, negazioni o link, parola per parola — o solo con il nome; l'assistente ne legge di più quando gli serve.

Una nota che la conversazione contiene già e che da allora non è cambiata viene nominata, non inviata di nuovo. I luoghi del tuo diario e i valori d'umore non partono mai da soli.

## Prima di inviare qualsiasi cosa

La prima richiesta di una sessione mostra un riepilogo: dove va (provider e modello), quali note e quale parte di ciascuna, cos'altro parte (la tua selezione, appuntamenti, attività), cosa è stato trattenuto e all'incirca quanti token. **Invia** la invia; **Annulla** non invia nulla e ti restituisce le tue parole nel campo di testo; il − accanto a una nota la esclude. Entro ciò che hai approvato, le richieste successive partono senza domande. Il riepilogo torna ogni volta che l'ambito cresce: un altro modello o provider, un nuovo tipo di dati, note da un'altra cartella, nuovi strumenti o una richiesta molto più grande. Un modello su questo dispositivo non chiede mai.

Se vuoi vedere il riepilogo prima di ogni richiesta, attiva **Chiedi prima di ogni richiesta** — nel riepilogo stesso o in **Impostazioni → IA e automazione**, alla voce **Invio**.

La riga sotto ogni risposta apre il riepilogo di ciò che è partito con essa. Se una risposta non cita nessuna delle note inviate, un avviso sopra quella riga lo dice; verifica allora la risposta con le note. Se sono partite delle note, la riga indica anche la copertura: **copertura alta** quando quasi ogni affermazione della risposta cita una nota, **copertura parziale** o **copertura bassa** quando sono meno.

## Vedi contesto

L'occhio sotto il campo di testo, **Vedi contesto**, mostra ciò che porterebbe la prossima richiesta — prima che parta, per il modello scelto ora. Per ogni nota: perché è stata scelta (aperta ora, fissata, corrisponde alle tue parole, vicino per significato, collegata, in scadenza…), quale parte parte e all'incirca quanti token. Ogni nota puoi

- escluderla dalla prossima richiesta (**Reincludi** la riporta),
- fissarla alla conversazione,
- tenerla su questo dispositivo per sempre: questo scrive la regola `cloud: deny` nella nota (vedi sotto).

Anche le note che le tue regole trattengono sono elencate, perché tu sappia cosa manca; non vengono mai valutate né inviate. **Invia con questo contesto** invia ciò che hai scritto. In una scheda IA ampia la vista resta aperta come colonna accanto alla conversazione.

Sopra le note, **Inviato** dice quanta parte di queste note parte — per esempio ~870 di 3.460 token — e **Risparmiato** quanto è in meno rispetto a inviare intere tutte le note proposte; la prima volta dice anche quanti token sarebbero stati. **Mostra come traccia nel grafo** apre il grafo con la nota aperta e le fonti evidenziate, e i link tra loro.

## Con una selezione

Seleziona del testo in una nota e l'IA lavora solo su quel passaggio.

- **Desktop:** mentre modifichi, **IA** nella barra di selezione offre **Come proposta** — **Riscrivi**, **Accorcia**, **Traduci…**, **Crea attività** — e **Nel compagno** — **Spiega** e **Domanda sulla selezione…** (**Ctrl+J**, ⌘J su macOS).
- **Telefono:** **IA** nella barra sopra una selezione — in lettura come in modifica — apre il foglio IA.
- **In ogni conversazione:** finché nella nota aperta c'è del testo selezionato, la riga **Con la selezione** sopra l'input offre le stesse azioni.

Un'azione di proposta invia solo il passaggio selezionato — non il resto della nota, nessuna nota fissata, nessuno strumento — e chiede con lo stesso riepilogo di una domanda. La risposta torna nella nota come un giro di proposte, come quello di una persona: in **Proposte** accetti o rifiuti ogni modifica o l'intero giro, e nella nota non cambia nulla prima che tu lo faccia. La riga dell'autore del giro dice **Plainva IA · ⟨modello⟩**, così resta visibile quale passaggio ha scritto un'IA. **Crea attività** aggiunge le attività sotto il passaggio invece di sostituirlo. Ogni azione conserva la sua conversazione nella cronologia.

Un passaggio di una nota che le tue regole tengono lontana dal cloud — o uno con link a note del genere o con indicazioni di luogo — non va a nessun modello cloud. In un workspace cifrato le azioni di proposta non sono ancora disponibili: le sue proposte non possono ancora indicare l'IA come autore.

## Competenze

Tre competenze avviano domande frequenti con un clic: **Orientamento del giorno** (cosa conta oggi: attività in scadenza, appuntamenti e ciò su cui hai lavorato di recente), **Riepilogo settimanale** (gli ultimi sette giorni e la settimana che arriva) e **Stato del progetto** (obiettivo, avanzamento, punti aperti e prossimo passo del progetto della nota aperta). Le trovi come chip in una conversazione vuota, sotto **Competenze** nella scheda IA — sul telefono in **Conversazioni** — e nella palette dei comandi. Una competenza invia la sua domanda come tuo messaggio: nella tua lingua, visibile nella conversazione come tutto ciò che scrivi, e attraverso lo stesso riepilogo. Poi l'assistente cerca con i suoi strumenti abituali.

## Trascrivere una nota vocale

Su ogni nota vocale — nell'editor, in modalità lettura, nel diario e sulle schede — **Trascrivi** trasforma la registrazione in testo. Va così com'è al modello del profilo **Audio**, attraverso lo stesso riepilogo di una domanda; una registrazione è un tipo di dati a sé, perciò il riepilogo chiede la prima volta. La trascrizione torna come proposta sotto la registrazione, con l'autore **Plainva IA · ⟨modello⟩**: accettala o rifiutala in **Proposte**.

**Audio** richiede un provider con una via audio: OpenAI (per esempio `gpt-4o-transcribe` o `whisper-1`), Gemini o un tuo server compatibile — uno su questo computer tiene la registrazione sul dispositivo. Si possono trascrivere registrazioni fino a 11 MB. Una registrazione in una nota che le tue regole tengono lontana dal cloud non va a nessun modello cloud, e i workspace cifrati non lo offrono ancora.

## Regole sulla privacy

Alcune note non devono mai raggiungere un provider cloud. Una regola può trovarsi nel frontmatter di una nota:

```yaml
plainva:
  ai:
    cloud: deny
```

oppure, per un'intera cartella, in **Impostazioni → IA e automazione** (la parte Vault), che scrive le regole in `.agent/policy.yml`. Una nota tenuta lontana dal cloud non contribuisce con nulla — né testo né titolo — e i link ad essa in altre note vengono trattenuti. I modelli su questo dispositivo restano consentiti. I workspace cifrati tengono il cloud disattivato, a meno che tu non lo consenta lì. Il formato esatto si trova nella [File Format Reference](File_Format_Reference.md).

## Cronologia e utilizzo

Le conversazioni restano su questo dispositivo, per vault — mai nel vault e mai sincronizzate. **Conserva le conversazioni** stabilisce per quanto tempo; puoi eliminare singole conversazioni nell'elenco o tutte quelle di un vault in una volta. **Utilizzo di questo mese** somma i token per provider e modello.

## Limiti della beta

- Sul desktop l'IA funziona solo nella finestra principale.
- Sul telefono una risposta arriva solo mentre l'app è aperta.
- L'assistente non cambia nulla da solo: propone modifiche a un passaggio selezionato e trascrizioni di note vocali, come proposte che accetti o rifiuti.

Il feedback sulla beta va nelle discussioni del progetto su GitHub: **Feedback sull'IA (beta)** nelle impostazioni ne apre una.
