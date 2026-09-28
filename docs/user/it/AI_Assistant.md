# Assistente IA (Beta)

Ultimo aggiornamento: 2026-09-24

Plainva può rispondere a domande sulle tue note con un modello IA di tua scelta. Legge il tuo vault, cita le note su cui si basa e può aprire note e viste per te — non cambia nulla. L'assistente è **sperimentale** ed è disattivato finché non lo attivi, singolarmente su ogni dispositivo.

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

## Chiedere

- **Desktop:** il pulsante IA nella barra delle azioni, **Ctrl+J** (⌘J su macOS) oppure **Chiedi all'IA** nella palette dei comandi apre il compagno — una piccola finestra sopra il tuo lavoro. **Apri come scheda** sposta la stessa conversazione nella scheda IA, dove sono elencate le tue conversazioni.
- **Telefono:** **Chiedi all'IA** nel menu ⋮ di una nota apre il foglio IA sopra quella nota. L'area **IA** (nel foglio delle aree, o nella barra di navigazione se la metti lì) mostra la conversazione a schermo intero; **Conversazioni** elenca quelle precedenti.

La nota che hai aperta viene inclusa automaticamente; rimuovila dal contesto con la sua ✕ se vuoi. **Fissa una nota…** aggiunge altre note. L'assistente può anche cercare da solo: consulta il vault, legge le note e le loro sezioni, elenca le attività e apre note e viste. Non può cambiare, creare o eliminare nulla.

Ogni conversazione inizia con la riga «Le risposte sono scritte da un'IA — ⟨modello⟩ tramite ⟨provider⟩». Sotto ogni risposta una riga indica cosa è stato inviato e dove: quante note, all'incirca quanti token e — dove il provider pubblica i prezzi — il costo approssimativo. **Interrompi** termina una risposta in qualsiasi momento.

Un link in una risposta si apre solo dopo che ne hai confermato l'indirizzo, e le immagini nelle risposte non vengono mai caricate.

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
- L'assistente legge; proporre modifiche come suggerimenti arriverà in una versione successiva.
