# Memoria (Beta)

Ultimo aggiornamento: 2026-10-25

La memoria contiene ciò che l'IA deve sapere su di te e sul tuo lavoro senza che tu glielo ripeta: che cosa fai, come preferisci ricevere le risposte, chi sono i tuoi clienti. Sono due file nel tuo vault. Nulla entra nella memoria senza il tuo sì, e puoi leggere, modificare ed eliminare ogni voce.

## Due posti

**Sempre incluso** va in ogni nuova conversazione. Tienilo breve: ha spazio per 2.000 caratteri e una barra mostra quanto è pieno. Una voce che non ci sta più è contrassegnata con **Spazio esaurito: non inclusa** — è salvata, ma non viene inviata. Le voci vengono incluse nell'ordine in cui sono elencate, quindi ciò che conta di più va in cima; l'ordine lo cambi nel file.

**Da consultare** non viene inviato. Quando una domanda può dipendere da qualcosa che hai detto all'IA in precedenza, l'IA cerca lì e la conversazione mostra **Sta cercando nella memoria**. È il posto per ciò che conta solo a volte: le condizioni di un cliente, una decisione e il suo motivo.

## Aprire la memoria

Sul desktop scegli **Memoria** nella scheda IA, accanto a **Competenze**. Sul telefono è **Conversazioni → Memoria**. Anche **Impostazioni → IA e automazione** (la parte Vault) porta lì: **Apri la memoria** sotto **Competenze e memoria**.

## Aggiungere una voce a mano

**Nuova voce** chiede tre cose: il testo — una sola cosa per voce, su una riga di al massimo 500 caratteri —, il posto (**Sempre incluso** o **Da consultare**) e se la voce è riservata a **Solo modelli su questo dispositivo**. Spunta questa opzione per tutto ciò che non va comunicato a nessun modello cloud.

Il pulsante ⋯ di una voce — sul telefono, un tocco sulla voce — offre **Modifica**, lo spostamento nell'altro posto (**Includi sempre** o **Solo da consultare**) ed **Elimina**.

## Far ricordare qualcosa all'IA

Dillo in una conversazione: «Ricorda che fatturo a giornata, non a ore». L'IA prepara la bozza di una voce; non scrive mai una voce da sola. Sotto la sua risposta, una scheda **Bozza · Voce della memoria** mostra il testo completo. Scegli il posto, poi **Ricorda** — oppure **Scarta**. Una bozza su cui non hai deciso resta sotto **In attesa**, e la memoria dice quante ce ne sono.

«Dimentica che …» funziona allo stesso modo: la scheda riporta **Bozza · Togliere dalla memoria**, e **Togli** rimuove la voce. Quando dici all'IA che qualcosa è cambiato, la scheda mostra sotto **Sostituisce** quale voce viene rimpiazzata dalla nuova formulazione.

Anche una conversazione conclusa può proporre voci: **Impara da questa conversazione** la rilegge e lascia delle bozze, ciascuna con il proprio riscontro. Come funziona, e che cosa una rilettura del genere può proporre in generale, è descritto in [Competenze](AI_Skills.md).

## Una regola non è un ricordo

«Rispondi sempre in tedesco» non è qualcosa da sapere: è qualcosa da fare. Una regola così non va nella memoria: diventa una riga delle **Istruzioni del vault** (`AGENTS.md`), che ogni modello riceve come istruzione. Aggiungine una con **Aggiungi una regola** sotto **Regole per l'IA**, oppure chiedi all'IA; la sua scheda riporta allora **Bozza · Regola per l'IA**, con il pulsante **Aggiungi come regola**.

Come tutte le istruzioni, il file va approvato su ogni dispositivo prima di avere effetto lì (vedi [Competenze](AI_Skills.md)). Una regola che aggiungi su un dispositivo dove il file è già approvato vale subito lì; gli altri tuoi dispositivi ti chiedono prima.

## Riordino

Una memoria che è cresciuta si ripete. Sotto **Riordino**, la vista della memoria segnala ciò che questo dispositivo ha notato da sé, senza chiedere a un modello: due voci che dicono quasi la stessa cosa, una voce che ha più di un anno e voci di **Sempre incluso** che non trovano più posto. **Confronta** mostra le due voci insieme, ciascuna con tutto ciò che il suo menu permette di fare.

Per uno sguardo più attento c'è una competenza. **Curare la memoria** legge le voci con il modello di una conversazione e prepara bozze di ciò che va unito e di ciò che si può togliere; si avvia dalla riga **Far rileggere la memoria**. Ciò che propone sono bozze come tutte le altre: nulla cambia finché non lo accetti e, dove due voci si contraddicono, chiede invece di decidere.

## Stile di scrittura

Una bozza dell'IA suona come l'IA. La sezione **Stile di scrittura** descrive come scrivi, perché una bozza possa suonare come te: misurato su note che scegli tu.

**Scegli esempi…** apre il selettore di note di **Fissa una nota…**; scegli fino a otto note scritte da te. Questo dispositivo vi misura, senza modello e senza inviare nulla: quanto sono lunghe le tue frasi e i tuoi paragrafi, elenchi o testo continuo, titoli, come ti rivolgi alle persone (in tedesco «du» o «Sie», in francese «tu» o «vous», dove una lingua lo mostra nelle sue parole), grassetto, emoji, punti esclamativi e trattini. Proprietà, codice e citazioni non contano. Ogni tratto compare con i numeri su cui si basa, e la sua ✕ lo toglie da solo; **Ripristina** riporta ciò che hai tolto. Nessuna parola e nessuna espressione delle tue note viene conservata: il dispositivo tiene i percorsi degli esempi e ciò che hai tolto, e misura di nuovo ogni volta che lo stile viene mostrato o usato.

Lo stile viene usato solo dove lo scegli: **Il mio stile**, il pulsante accanto al globo sotto il campo del messaggio, lo dà alla conversazione che inizi subito dopo; come Internet, resta fisso dal suo primo messaggio. La conversazione dice allora **Con il tuo stile di scrittura**, il riepilogo d'invio ha una riga **Stile di scrittura**, e una bozza nata in una conversazione così dice di essere stata scritta con il tuo stile di scrittura; resta una bozza dell'IA, firmata con il suo modello. L'IA segue lo stile in ciò che tieni per te (una nota, una voce del diario, una riscrittura del tuo testo), non di sua iniziativa in un'e-mail, un invito o un commento; chiediglielo lì e lo farà.

Lo stile resta su questo dispositivo, non nel vault: su un altro dispositivo ne scegli lì gli esempi. Un esempio che le tue regole sulla privacy tengono lontano da un modello non dà a quel modello nessuno dei suoi tratti (il riepilogo d'invio lo conta sotto **Trattenuto**), e ciò che un modello su questo dispositivo scrive con i tratti di una nota così mantiene le regole della nota.

## Privacy

- Una voce può avere una regola propria: **Non ai modelli cloud**, **Non nelle conversazioni con Internet**. Un modello su questo dispositivo riceve ogni voce.
- Se l'IA ha preparato la bozza di una voce in una conversazione in cui ha letto note soggette a una regola sulla privacy, la voce riceve le stesse regole — la scheda dice **La voce riceve le regole sulla privacy delle note su cui si basava questa conversazione.** Ciò che proviene da una nota che deve restare su questo dispositivo non arriva a un cloud attraverso la memoria.
- Anche le tue [regole sulla privacy](AI_Assistant.md) valgono per i due file: una regola per la cartella `.agent/` tiene l'intera memoria lontana dal cloud.
- Il riepilogo di invio ha una riga **Memoria** — quante voci partono — e sotto **Trattenuto** conta le voci che le tue regole trattengono. Non nomina mai una voce.
- Per l'IA una voce è un'informazione, non un'istruzione: una frase nella memoria non le concede alcun permesso.
- Una conversazione conserva la memoria con cui è stata avviata. Una voce che elimini non va a nessuna nuova conversazione; le conversazioni già avviate conservano ciò che hanno ricevuto.

## Disattivare la memoria

**Usa la memoria su questo dispositivo** è attivo finché non lo disattivi. Quando è disattivato, una conversazione su questo dispositivo non riceve nulla dalla memoria e non vi aggiunge nulla. I file restano come sono, e ogni dispositivo decide per sé.

## I due file

`.agent/active_memory.md` (sempre incluso) e `.agent/MEMORY.md` (da consultare) sono Markdown puro. Ogni voce è un elemento di elenco e i titoli raggruppano le voci. Ciò che Plainva sa di una voce è scritto in un commento che la segue:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` e `by` indicano quando è stata aggiunta la voce e se l'hai scritta tu o hai accettato una bozza, `source` nomina la conversazione da cui proviene una bozza e `deny` contiene le regole della voce (`cloud`, `web`). Puoi modificare i file con qualsiasi editor. In Plainva, **Apri file** apre l'uno o l'altro.

Plainva non tira a indovinare. Una voce con un commento danneggiato è contrassegnata con **Regole illeggibili: non va a nessun modello** finché non ripari il commento o non aggiungi di nuovo la voce. Il testo nascosto in un commento o in caratteri invisibili non viene mai inviato; la voce mostra allora quante parti nascoste sono state tralasciate. Un file contiene al massimo 2.000 voci e 256 KB.
