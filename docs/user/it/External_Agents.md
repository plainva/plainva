# Agenti esterni (Beta)

Ultimo aggiornamento: 2026-10-07

Un agente esterno è un programma di IA di un altro produttore — un agente che hai installato sul tuo computer e a cui hai effettuato l'accesso tu stesso, con il tuo abbonamento o la tua chiave. Plainva può avviare un agente del genere nella cartella di un vault e mostrare la sua sessione nella scheda IA. Fa parte delle funzioni di IA sperimentali e funziona solo sul desktop.

Un agente esterno non è l'assistente di Plainva. L'[Assistente IA](AI_Assistant.md) invia solo ciò che il suo riepilogo ti ha mostrato, e mai ciò che le tue regole sulla privacy trattengono. Un agente legge e invia da sé. Questa pagina dice che cosa Plainva controlla in una sessione del genere — e che cosa no.

## Che cosa Plainva non controlla

- **Il programma.** Un agente è il programma di qualcun altro. Gira su questo computer con i tuoi permessi, nella cartella del vault, e non è recintato: può leggere e modificare tutto ciò che puoi leggere e modificare tu.
- **Che cosa legge e invia.** Legge i file da sé — anche le note che tieni lontane dal cloud — e invia ciò che sceglie al proprio servizio. Le tue regole sulla privacy e il riepilogo prima dell'invio non lo raggiungono, e niente ti chiede prima che invii.
- **Che cosa scrive da sé.** Una modifica che l'agente fa da sé è subito nel vault, senza proposta. La sessione te lo dice quando l'agente segnala una modifica del genere; una modifica che non segnala, Plainva non la vede.
- **Il suo accesso.** L'agente effettua l'accesso da sé. Plainva non vede mai le sue credenziali e non ne conserva nessuna.

Avvia un agente solo in un vault il cui contenuto può arrivare al servizio dell'agente.

## Che cosa Plainva controlla

- **I propri strumenti.** Dove **Consenti alle app di IA di questo computer di leggere questo vault** è attivo, gli strumenti di Plainva vengono offerti all'agente — gli stessi di ogni app in [Collegare app di IA](Connect_AI_Apps.md): solo le cartelle che concedi, mai una nota tenuta lontana dal cloud o da Internet, e solo in lettura — a meno che lì tu non gli consenta di proporre modifiche.
- **Che cosa l'agente chiede a Plainva di leggere.** Una nota tenuta lontana dal cloud e le cartelle proprie di Plainva non vengono consegnate. L'agente ne viene informato, e anche tu.
- **Che cosa l'agente chiede a Plainva di scrivere.** Non viene scritto nulla. Una modifica a una nota diventa un giro di proposte a nome dell'agente, e una nota nuova aspetta finché non la crei.
- **Nessun terminale.** Plainva non offre a un agente un terminale proprio.

## Aggiungere un agente

1. Installa l'agente tu stesso, come descrive il suo produttore, ed effettua l'accesso nel suo programma.
2. Apri **Impostazioni → IA e automazione** (la parte App). In **Agenti esterni**, **Trovato su questo computer** segnala gli agenti che Plainva conosce per nome e trova installati; **Aggiungi** ne aggiunge uno. Per qualsiasi altro programma che parla l'Agent Client Protocol, scegli **Aggiungi agente…** sotto **Un altro agente** e compila **Nome**, **Programma** e **Argomenti, uno per riga**.
3. Il tuo sistema mostra l'intero comando ancora una volta prima che venga ricordato.

Plainva non installa nessun agente e non ne scarica nessuno. Avvia esattamente il programma che hai confermato, direttamente e senza shell. Il comando viene ricordato su questo dispositivo, mai nel vault. **Rimuovi** fa dimenticare a Plainva come avviare un agente; il programma stesso e il suo accesso restano come sono.

## Avviare una sessione

Apri la scheda IA e scegli **Agente**. Prima che parta qualcosa, **Prima di avviare ⟨agente⟩** elenca ciò che l'agente fa da sé e ciò che Plainva controlla, e dice se gli strumenti di Plainva verranno offerti. **Avvia la sessione** avvia il programma dell'agente nella cartella del vault. La prima volta che avvii un agente in un vault da quando Plainva è stato aperto, il tuo sistema chiede ancora una volta e mostra la cartella e l'intero comando.

Gira una sessione alla volta, e appartiene al vault in cui è stata avviata: **Termina la sessione** ferma il programma dell'agente, e chiudere il vault o Plainva fa lo stesso. Finché gira, la prima riga della sessione dice chi è l'agente e che le tue regole sulla privacy non valgono per lui. In un workspace cifrato non viene avviato nessun agente.

## Effettuare l'accesso

Un agente che non ha effettuato l'accesso lo dice, e la sessione mostra **⟨agente⟩ chiede un accesso** con i modi che l'agente nomina. A seconda dell'agente, sceglierne uno apre una finestra di terminale con il programma dell'agente, oppure l'agente ti porta da sé al suo accesso. Plainva aspetta e poi avvia di nuovo l'agente. Dove non si può aprire un terminale, Plainva mostra il comando da eseguire in un tuo terminale; dopo scegli **Riprova**. Plainva non vede nulla dell'accesso.

## In una sessione

Scrivi che cosa deve fare l'agente. La nota che hai aperta viene nominata all'agente — il suo nome e dove si trova, non il suo testo —, a meno che tu non la tolga sopra il campo di immissione; una nota che tieni lontana dal cloud non viene mai nominata. La sessione mostra ciò che dice l'agente, il suo piano e ciascuno dei suoi passi, con i file del vault che nomina.

Quando l'agente vuole il tuo permesso per un passo, **⟨agente⟩ chiede** lo mostra. Le parole sono dell'agente, e le scelte sono quelle che l'agente offre — **Consenti**, **Consenti sempre**, **Rifiuta**, **Rifiuta sempre**. La tua risposta va solo all'agente: ciò che fa dopo un sì è affar suo, e un «sempre» è una promessa che mantiene l'agente, non Plainva.

**Interrompi** termina la risposta a cui l'agente sta lavorando.

## Che cosa scrive l'agente

**Tramite Plainva.** Una modifica che l'agente consegna a Plainva non viene mai scritta nella nota. Quando la risposta dell'agente è finita, ogni nota che ha modificato porta un giro di proposte, firmato **⟨nome⟩ (agente esterno)**: in **Proposte** accetti o rifiuti ogni modifica o l'intero giro, come con il giro di una persona. Una nota che non esiste ancora compare sotto **Nuove note dell'agente**. **Crea** la scrive — contrassegnata con `generated`, con l'agente come autore —, e **Scarta** la lascia cadere. Gli indirizzi web che l'agente ha portato vengono scritti in modo che niente li apra o li carichi (`https[://]…`).

Plainva non accetta tutto: solo note Markdown, solo il loro testo e non le loro proprietà, nessuna nota che porta regole di IA o campi di fiducia, niente di ciò che è tenuto lontano dal cloud, e non più di 150 modifiche a una nota per volta. Ciò che non ha accettato lo dice la sessione, e l'agente ne viene informato.

**Da sé.** Un agente può anche scrivere file da sé, come qualsiasi programma. Quando segnala una modifica del genere, la sessione dice **L'agente ha modificato ⟨nota⟩ da sé: è nel vault senza proposta.** Quale strada prende un agente, Plainva non può prometterlo: dipende dall'agente e da come è configurato. Nelle impostazioni, ogni agente mostra ciò che si è visto l'ultima volta su questo computer — quante modifiche sono arrivate tramite Plainva e quante ne ha scritte da sé.

## Che cosa conserva Plainva

- **Su questo dispositivo:** il comando che hai confermato, il tuo nome per l'agente e ciò che si è visto l'ultima volta delle sue modifiche — nei dati propri di Plainva, mai nel vault.
- **Per vault:** **Ultime sessioni in questo vault** indica quando c'è stata una sessione, con quale agente, e quanti messaggi, modifiche tramite Plainva e modifiche proprie ci sono stati — mai ciò che è stato detto.
- **Non la sessione stessa:** ciò che tu e l'agente avete detto sparisce quando la sessione viene chiusa. Ciò che l'agente conserva dalla sua parte è affare dell'agente.

Se il programma dell'agente termina da solo, la sessione lo dice, e **Mostra le sue ultime righe** mostra la fine di ciò che il programma ha scritto.

## Limiti

- Solo sul desktop e solo nella finestra principale. Sul telefono c'è l'assistente proprio di Plainva.
- Non in un workspace cifrato.
- Una sessione alla volta, e nessuna cronologia: una sessione terminata non si può riaprire.
- I modi, i modelli e i comandi propri di un agente non si possono scegliere da Plainva, e non gli si possono inviare immagini.
- Finora questo è stato provato solo con un agente di prova proprio di Plainva. Quali agenti funzionano qui, e quali consegnano le loro modifiche a Plainva, si vede provandoli — i riscontri sono benvenuti.
