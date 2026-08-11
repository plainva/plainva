import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_IT } from "./projectTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

const PARA_STRINGS_IT: ParaStrings = {
  name: "PARA",
  description: "Progetti, Aree, Risorse, Archivio — ordinati per prossimità operativa (Tiago Forte).",
  folders: {
    projects: "Progetti",
    tasks: "Attività",
    areas: "Aree",
    resources: "Risorse",
    archive: "Archivio",
    templates: "Modelli",
  },
  folderHints: {
    projects: "Iniziative con un obiettivo chiaro e una data di fine (Progetti.base).",
    tasks: "Singoli prossimi passi — ognuna rimanda al proprio progetto (Attività.base).",
    areas: "Responsabilità continuative, senza una data di fine.",
    resources: "Argomenti, materiali e riferimenti da conservare.",
    archive: "Ciò che è concluso o inattivo, proveniente dalle altre cartelle.",
  },
  welcome: {
    file: "Benvenuto.md",
    description: "Punto di partenza e guida rapida per questo vault.",
    title: "Benvenuto",
    intro:
      "Questo vault è organizzato secondo il metodo PARA (Tiago Forte): i contenuti sono ordinati per prossimità operativa, non per argomento. Gli esempi qui sotto sono note vere — modificale, spostale, eliminale.",
    outro:
      "Apri i database Progetti.base, Attività.base e Aree.base per vedere i progetti per stato, assegnare loro delle attività e collegarli alle loro aree — ciò che è concluso passa nell'Archivio, mentre i link e le panoramiche index.md vengono mantenuti automaticamente.",
  },
  welcomeSections: { databases: "I tuoi database", start: "Da dove iniziare" },
  baseFiles: { projects: "Progetti.base", tasks: "Attività.base", areas: "Aree.base" },
  keys: { status: "stato", area: "area", due: "scadenza", tasks: "attivita", project: "progetto", projects: "progetti" },
  options: {
    projectStatus: ["Pianificato", "Attivo", "In attesa", "Concluso"],
    taskStatus: ["Aperta", "In corso", "Fatta"],
  },
  views: { table: "Tabella", byStatus: "Per stato" },
  templates: {
    project: { file: "Progetto.md", body: "# {{title}}\n\n## Obiettivo\n\n## Prossimi passi\n\n- [ ] \n" },
    task: { file: "Attività.md", body: "# {{title}}\n\n## Note\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Team",
        body: "Un'area è una responsabilità continuativa, senza una data di fine. I progetti si collegano ad essa tramite la loro proprietà Area — la tabella in Aree.base li rispecchia qui.",
      },
      { title: "Finanze", body: "Contabilità, contratti, assicurazioni. Prosegue anche quando nessun progetto è aperto." },
      { title: "Salute", body: "Tutto ciò che richiede attenzione costante invece di avere una fine." },
    ],
    projects: [
      {
        title: "Dichiarazione dei redditi 2026",
        body: "Un progetto ha un obiettivo chiaro e una fine prevedibile. Questo è pianificato ma non ancora iniziato — per questo si trova nella prima colonna della board.",
        props: { stato: "Pianificato", area: "[[Finanze]]", scadenza: "{{today+45}}" },
      },
      {
        title: "Trasloco nel nuovo ufficio",
        body: "L'esempio attivo: le attività qui sotto rimandano a questa nota tramite la loro proprietà Progetto, e Progetti.base le rispecchia nella colonna Attività.\n\n- [ ] Annotare l'obiettivo del progetto\n- [ ] Decidere il prossimo passo",
        props: { stato: "Attivo", area: "[[Team]]", scadenza: "{{today+21}}" },
      },
      {
        title: "Programma per la schiena",
        body: "In attesa di qualcosa al di fuori del tuo controllo — qui, un appuntamento. È esattamente per questo che esiste la terza colonna.",
        props: { stato: "In attesa", area: "[[Salute]]", scadenza: "{{today+10}}" },
      },
      {
        title: "Rilancio del sito web",
        body: "Concluso. Un progetto terminato resta visibile finché non lo sposti nell'Archivio — il database segue il file.",
        props: { stato: "Concluso", area: "[[Team]]", scadenza: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Richiedere preventivi ai traslocatori",
        body: "Un'attività è un singolo, concreto prossimo passo.",
        props: { stato: "Aperta", progetto: "[[Trasloco nel nuovo ufficio]]", scadenza: "{{today+3}}" },
      },
      {
        title: "Verificare il preavviso di disdetta per i vecchi locali",
        body: "Iniziata ma non ancora terminata — la colonna centrale della board.",
        props: { stato: "In corso", progetto: "[[Trasloco nel nuovo ufficio]]", scadenza: "{{today+1}}" },
      },
      {
        title: "Concordare la planimetria con il team",
        body: "Trascina la scheda in un'altra colonna della board: Plainva scrive il nuovo stato nella nota.",
        props: { stato: "In corso", progetto: "[[Trasloco nel nuovo ufficio]]", scadenza: "{{today+7}}" },
      },
      {
        title: "Ordinare le ricevute",
        body: "Appartiene a un progetto che non è ancora iniziato — è permesso, e spesso utile.",
        props: { stato: "Aperta", progetto: "[[Dichiarazione dei redditi 2026]]", scadenza: "{{today+14}}" },
      },
      {
        title: "Prenotare l'appuntamento dal fisioterapista",
        body: "Fatta. L'attività resta come nota; è cambiato solo il suo stato.",
        props: { stato: "Fatta", progetto: "[[Programma per la schiena]]", scadenza: "{{today-2}}" },
      },
      {
        title: "Reindirizzare il vecchio dominio",
        body: "L'ultimo passo del progetto concluso.",
        props: { stato: "Fatta", progetto: "[[Rilancio del sito web]]", scadenza: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Lista di controllo per il trasloco dell'ufficio",
        body: "Le risorse sono materiale di consultazione — nessun obiettivo, nessuna data di fine. Non si trovano volutamente in nessun database: non tutto ha bisogno di righe e colonne.\n\n- [ ] Cambio di indirizzo in banca e presso l'assicurazione\n- [ ] Misurare rete e stampanti",
      },
      {
        title: "Cosa distingue PARA dalle cartelle",
        body: "PARA ordina per prossimità operativa: i progetti finiscono, le aree continuano, le risorse sono materiale di consultazione, l'archivio è tutto il resto. Sposta una nota tra le cartelle non appena il suo ruolo cambia.",
      },
    ],
    archive: [
      {
        title: "Fiera 2025",
        body: "Ecco come si presenta un elemento archiviato: una nota normale, solo in un'altra cartella. Non si perde nulla — semplicemente non compare più nei database attivi.",
      },
    ],
  },
};

const GTD_STRINGS_IT: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — posta in arrivo, attività, progetti, riferimenti ed elenco Un giorno forse.",
  folders: {
    inbox: "Posta in arrivo",
    tasks: "Attività",
    projects: "Progetti",
    reference: "Riferimenti",
    someday: "Un giorno forse",
    templates: "Modelli",
  },
  folderHints: {
    inbox: "Il punto di raccolta di tutto ciò che arriva — svuotala regolarmente.",
    tasks: "Singole prossime azioni — organizzate per stato e contesto (Attività.base).",
    projects: "Tutto ciò che richiede più di un passo (Progetti.base).",
    reference: "Materiale di consultazione, senza bisogno di alcuna azione.",
    someday: "Idee e progetti per più avanti.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    description: "Punto di partenza e guida rapida per questo vault.",
    intro:
      "Questo vault segue Getting Things Done (David Allen): tutto arriva prima nella posta in arrivo e da lì viene smistato in attività e progetti concreti. Gli esempi qui sotto sono note vere — elaborale, spostale, eliminale.",
    outro:
      "In Attività.base assegni ogni attività a un progetto tramite la sua proprietà Progetto; Progetti.base mostra poi automaticamente ciò che appartiene a ciascun progetto nella colonna Attività. La revisione settimanale mantiene affidabile il sistema.",
  },
  welcomeSections: { databases: "I tuoi database", start: "Da dove iniziare" },
  baseFiles: { tasks: "Attività.base", projects: "Progetti.base" },
  keys: { status: "stato", context: "contesto", project: "progetto", due: "scadenza", tasks: "attivita" },
  options: {
    taskStatus: ["Posta in arrivo", "Prossima", "In attesa", "Un giorno forse", "Fatto"],
    context: ["@Casa", "@Lavoro", "@Commissioni", "@Telefono"],
    projectStatus: ["Attivo", "In attesa", "Un giorno forse", "Concluso"],
  },
  views: { table: "Tabella", byStatus: "Per stato", byContext: "Per contesto" },
  templates: {
    task: { file: "Attività.md", body: "# {{title}}\n\n## Note\n\n- [ ] \n" },
    project: { file: "Progetto.md", body: "# {{title}}\n\n## Risultato desiderato\n\n## Prossimi passi\n\n- [ ] \n" },
  },
  review: {
    title: "Revisione settimanale",
    description: "Lista di controllo per la revisione settimanale GTD.",
    body: "- [ ] Azzerare la posta in arrivo\n- [ ] Scorrere la lista dei progetti e controllare le prossime azioni\n- [ ] Scorrere la lista Un giorno forse\n- [ ] Guardare il calendario delle prossime due settimane",
  },
  samples: {
    projects: [
      {
        title: "Rinnovare la cucina",
        body: "Risultato desiderato: cosa sarà vero quando sarà finito? In GTD, tutto ciò che richiede più di un passo è un progetto — anche le cose che non sembrano tali.",
        props: { stato: "Attivo" },
      },
      {
        title: "Tagliando dell'auto",
        body: "In attesa di qualcun altro — qui, di una richiamata dall'officina. Per questo il progetto si trova nella seconda colonna della board.",
        props: { stato: "In attesa" },
      },
      {
        title: "Imparare lo spagnolo",
        body: "Un giorno, forse. Vive nel sistema così smette di vivere nella tua testa — ma non chiede attenzione proprio adesso.",
        props: { stato: "Un giorno forse" },
      },
      {
        title: "Sistemare i documenti fiscali",
        body: "Concluso. Un progetto terminato resta visibile finché non lo rimuovi — il database segue il file.",
        props: { stato: "Concluso" },
      },
    ],
    tasks: [
      {
        title: "Raccogliere idee",
        body: "Appena arrivata nella posta in arrivo e non ancora elaborata — per questo non ha né contesto né progetto. La prossima revisione le darà entrambi.",
        props: { stato: "Posta in arrivo" },
      },
      {
        title: "Misurare la cucina",
        body: "Un'attività è una singola, concreta prossima azione. Tramite la sua proprietà Progetto appartiene al rinnovo.",
        props: { stato: "Prossima", contesto: "@Casa", progetto: "[[Rinnovare la cucina]]", scadenza: "{{today+2}}" },
      },
      {
        title: "Rivedere il preventivo del falegname",
        body: "Trascina la scheda in un'altra colonna della board: Plainva scrive il nuovo stato nella nota.",
        props: { stato: "Prossima", contesto: "@Lavoro", progetto: "[[Rinnovare la cucina]]", scadenza: "{{today+5}}" },
      },
      {
        title: "Richiamare l'officina",
        body: "In attesa di qualcun altro. Il contesto @Telefono raccoglie tutto ciò che puoi sbrigare in un colpo solo una volta che hai il telefono in mano.",
        props: { stato: "In attesa", contesto: "@Telefono", progetto: "[[Tagliando dell'auto]]" },
      },
      {
        title: "Cercare un corso di lingua nelle vicinanze",
        body: "Appartiene a un progetto Un giorno forse e aspetta con lui. Anche questa è una decisione — solo contraria al farlo adesso.",
        props: { stato: "Un giorno forse", contesto: "@Commissioni", progetto: "[[Imparare lo spagnolo]]" },
      },
      {
        title: "Scansionare le ricevute dell'anno scorso",
        body: "Fatto. L'attività resta una nota; è cambiato solo il suo stato.",
        props: { stato: "Fatto", contesto: "@Casa", progetto: "[[Sistemare i documenti fiscali]]", scadenza: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "Le due domande di GTD",
        body: "I riferimenti sono materiale senza nulla da fare — per questo non si trovano in nessun database.\n\nQuando elabori la posta in arrivo rispondi a due domande: è attuabile? E se sì — qual è l'unica, concreta prossima azione? Tutto il resto è riferimento, un giorno forse, o cestino.",
      },
    ],
    someday: [
      {
        title: "Album fotografico dell'estate scorsa",
        body: "Un giorno forse non significa mai, significa non ora. Durante la revisione settimanale scorri questa lista — ciò che ti colpisce due volte diventa un progetto.",
      },
    ],
  },
};

const ZK_STRINGS_IT: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Un'idea per nota, densamente collegate — note fugaci, di lettura e permanenti (Luhmann).",
  folders: {
    fleeting: "Note fugaci",
    literature: "Note di lettura",
    permanent: "Note permanenti",
    templates: "Modelli",
  },
  folderHints: {
    fleeting: "Pensieri grezzi e rapidi — effimeri, da elaborare più avanti.",
    literature: "Riassunti di ciò che hai letto, con parole tue, con la fonte.",
    permanent: "Idee durature e ben formulate — una per nota, fortemente collegate.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    description: "Punto di partenza e guida rapida per questo vault.",
    intro:
      "Questo vault segue il metodo Zettelkasten (Niklas Luhmann): un'idea per nota — le connessioni nascono dai link, non dalle gerarchie di cartelle. Le schede qui sotto rimandano l'una all'altra; seguile e poi guarda il grafo.",
    outro:
      "Usa Lettura.base per tenere traccia delle tue fonti per stato di lettura; Note.base collega le note permanenti alla letteratura da cui provengono tramite la loro proprietà Fonte.",
  },
  welcomeSections: { databases: "I tuoi database", start: "Da dove iniziare" },
  baseFiles: { literature: "Lettura.base", slips: "Note.base" },
  keys: { author: "autore", year: "anno", kind: "tipo", status: "stato", url: "url", slips: "note", source: "fonte" },
  options: {
    kind: ["Libro", "Articolo", "Video", "Podcast", "Sito web"],
    status: ["Da leggere", "Letto", "Elaborato"],
  },
  views: { table: "Tabella", byStatus: "Per stato" },
  templates: {
    literature: { file: "Nota di lettura.md", body: "# {{title}}\n\n## Riassunto\n\n## Fonte\n" },
    slip: { file: "Scheda.md", body: "# {{title}}\n\nUn'idea, in frasi complete.\n\n## Schede correlate\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Un pensiero per scheda",
        body: "Una nota permanente contiene esattamente un'idea, in frasi complete e con parole tue. Solo così può essere riutilizzata in un contesto diverso più avanti, senza dover consultare l'originale.\n\nProsegui con: [[Collegare invece di archiviare]] e [[Scrivere è pensare]].",
        props: { fonte: ["[[Luhmann - Comunicare con gli schedari]]"] },
      },
      {
        title: "Collegare invece di archiviare",
        body: "Una cartella costringe ogni nota in un unico cassetto. Un link le permette di stare in tutti i contesti a cui appartiene — per questo uno schedario acquista valore nel tempo invece di diventare ingestibile.\n\nControparte: [[Un pensiero per scheda]]. Conseguenza pratica: [[La scheda d'ingresso]].",
        props: { fonte: ["[[Luhmann - Comunicare con gli schedari]]"] },
      },
      {
        title: "Scrivere è pensare",
        body: "Se riesci a scrivere un'idea con parole tue, l'hai capita; se non ci riesci, non ancora. Trasformare una nota di lettura in una scheda non è quindi una copia — è il vero lavoro.\n\nVedi anche [[Un pensiero per scheda]].",
        props: { fonte: ["[[Ahrens - Il metodo Zettelkasten]]"] },
      },
      {
        title: "La scheda d'ingresso",
        body: "Uno schedario ha bisogno di porte. Una scheda d'ingresso raccoglie i link ai filoni su cui stai lavorando — non sostituisce un indice, è essa stessa una scheda che continua a cambiare.\n\nFiloni: [[Collegare invece di archiviare]] · [[Scrivere è pensare]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Comunicare con gli schedari",
        body: "Riassumi con parole tue ciò che hai letto e annota la fonte. Le note permanenti rimandano qui tramite la loro proprietà Fonte — la colonna Note mostra quali lo fanno.",
        props: { autore: "Niklas Luhmann", anno: 1981, tipo: "Articolo", stato: "Elaborato" },
      },
      {
        title: "Ahrens - Il metodo Zettelkasten",
        body: "Letto, ma non ancora trasformato in schede. Ecco a cosa serve lo stato: la prossima volta che guardi, ti dice dove si è fermato il lavoro.",
        props: { autore: "Sönke Ahrens", anno: 2017, tipo: "Libro", stato: "Letto" },
      },
      {
        title: "Podcast sulla scrittura di note",
        body: "Non ancora letto — o ascoltato. Nel board questa fonte si trova nella prima colonna finché non la tocchi.",
        props: { tipo: "Podcast", stato: "Da leggere" },
      },
    ],
    fleeting: [
      {
        title: "Appunti da una passeggiata",
        body: "Le note fugaci sono materiale grezzo: scarabocchiate, incomplete, effimere. Elaborandole diventano una scheda — oppure nulla, e va bene anche così.\n\n- Idea: i riferimenti valgono più delle cartelle\n- Da verificare: è accurata quella citazione di Luhmann?",
      },
    ],
  },
};

const ACE_STRINGS_IT: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlante, Calendario e Impegni — lavoro sulla conoscenza centrato sulle MOC, secondo Nick Milo.",
  folders: { atlas: "Atlante", calendar: "Calendario", efforts: "Impegni" },
  folderHints: {
    atlas: "Le mappe della tua conoscenza — MOC e note di sintesi.",
    calendar: "Ciò che è legato al tempo — note giornaliere, diari, retrospettive.",
    efforts: "Impegni — tutto ciò su cui stai lavorando attivamente.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    description: "Punto di partenza e guida rapida per questo vault.",
    intro:
      "Questo vault usa lo schema ACE di \"Linking Your Thinking\" (Nick Milo): la conoscenza è collegata tramite Maps of Content (MOC) invece che con un annidamento profondo. Tutto ciò che segue è collegato alla nota Home — seguila cliccando, poi guarda il grafo.",
    outro:
      "Inizia nell'Atlante con la nota Home e collega da lì verso la tua conoscenza. Una MOC è solo una nota: può crescere, dividersi e sparire di nuovo.",
  },
  welcomeSections: { start: "Da dove iniziare" },
  home: {
    title: "Home",
    description: "La tua Map of Content di livello più alto.",
    lead:
      "La nota Home è il tuo punto di ingresso: collega qui le tue Maps of Content più importanti e gli impegni in corso. Nessuna cartella può farlo — una cartella può archiviare una nota solo in un unico posto.",
    mapsHeading: "Mappe",
    effortsHeading: "Impegni in corso",
  },
  maps: [
    {
      title: "Scrittura MOC",
      body:
        "Una Map of Content raccoglie ciò che appartiene a un argomento e lo ordina con parole tue. Non sostituisce un indice — è la tua visione di un argomento, in un dato momento.",
      leads: "Da qui:",
    },
    {
      title: "Giardino MOC",
      body:
        "Anche una MOC può puntare fuori dall'Atlante: questa mappa porta a un impegno in corso. Proprio questo collegamento trasversale è il punto centrale.",
      leads: "Da qui:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Perché mappe invece di cartelle",
        body:
          "Una cartella risponde alla domanda «dove si trova?». Una mappa risponde a «cosa appartiene insieme, e perché?» — e la stessa nota può comparire su più mappe.\n\nTorna alla mappa: [[Scrittura MOC]].",
      },
    ],
    efforts: [
      {
        title: "Costruire un'aiuola rialzata",
        body:
          "Un impegno (effort) è qualcosa su cui stai lavorando ora, con una fine prevedibile. Non si trova volutamente nell'Atlante: l'Atlante è per ciò che dura.\n\n- [ ] Decidere le misure\n- [ ] Procurarsi il legname\n\nAppartiene a [[Giardino MOC]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body:
          "Ciò che è legato al tempo appartiene alla cartella Calendario: note giornaliere, retrospettive, tutto ciò che è legato a una data e non a un argomento.\n\nVisto oggi: [[Perché mappe invece di cartelle]].",
      },
    ],
  },
};

const JD_STRINGS_IT: JdStrings = {
  name: "Johnny.Decimal",
  description: "Aree e categorie numerate (10-19 / 11 / 11.01) per ritrovare tutto con certezza.",
  folders: {
    system: "00-09 Sistema",
    systemIndex: "00 Indice",
    personal: "10-19 Personale",
    finance: "11 Finanze",
    health: "12 Salute",
    work: "20-29 Lavoro",
    projects: "21 Progetti",
    meetings: "22 Riunioni",
  },
  folderHints: {
    system: "La gestione del sistema stesso — indice e convenzioni.",
    personal: "Area di esempio per argomenti personali.",
    work: "Area di esempio per argomenti di lavoro.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    description: "Punto di partenza e guida rapida per questo vault.",
    intro:
      "Questo vault è organizzato secondo Johnny.Decimal: al massimo dieci aree (10-19, 20-29, …), al massimo dieci categorie per area (11, 12, …) — e ogni nota riceve un ID come 11.01. Gli esempi qui sotto mostrano come si presenta.",
    outro:
      "Rinomina le aree e le categorie in base ai tuoi argomenti — la profondità volutamente limitata (area → categoria → ID) è il cuore del metodo. Un numero non viene mai riassegnato, anche quando la nota scompare.",
  },
  welcomeSections: { start: "Da dove iniziare" },
  index: {
    id: "00.00",
    title: "Indice",
    description: "L'indice Johnny.Decimal: tutti i numeri in un unico posto.",
    lead:
      "Tieni qui l'elenco di tutte le aree, categorie e ID. Chi cerca un numero controlla prima questa nota — se non è nell'indice, non esiste.",
  },
  samples: [
    {
      id: "11.01",
      title: "Bilancio familiare",
      body:
        "La prima nota nella categoria 11 riceve lo 01 — la successiva lo 02, e così via. Il numero resta legato alla nota anche se la rinomini.",
    },
    {
      id: "21.01",
      title: "Rilancio del sito web",
      body:
        "Anche un intero progetto riceve esattamente un numero. Tutto ciò che gli appartiene fa riferimento a quel numero, invece di sparire in una propria sottocartella.",
    },
    {
      id: "22.01",
      title: "Kick-off sito web",
      body:
        "Le note di riunione sono una categoria a sé, così non intasano il numero del progetto. Questa appartiene a [[21.01 Rilancio del sito web]].",
    },
  ],
};

const JOURNAL_STRINGS_IT: JournalStrings = {
  name: "Journal",
  description:
    "Note giornaliere con un modello già pronto e un database del diario — le note giornaliere sono configurate fin da subito.",
  folders: { journal: "Diario", templates: "Modelli" },
  folderHints: {
    journal: "Le tue note giornaliere, una al giorno.",
    templates: "Modelli per le nuove note — il modello di nota giornaliera è già configurato.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto",
    description: "Punto di partenza e guida rapida per questo vault.",
    intro:
      "Questo vault è pensato per la scrittura quotidiana: le note giornaliere vivono nella cartella Diario e vengono create a partire dal modello nella cartella Modelli. Due giorni di esempio sono già presenti — oggi e ieri.",
    outro:
      "Apri il calendario nella barra laterale destra e clicca su un giorno per creare la nota giornaliera successiva. Diario.base mostra le tue voci come tabella e su un calendario — con data, umore e parole chiave.",
  },
  welcomeSections: { databases: "I tuoi database", start: "Da dove iniziare" },
  baseFile: "Diario.base",
  keys: { date: "data", mood: "umore", tags: "parolechiave" },
  moods: ["Buono", "Neutro", "Cattivo", "Produttivo", "Stanco"],
  views: { table: "Tabella", calendar: "Calendario" },
  template: {
    file: "Nota giornaliera.md",
    description: "Modello per le nuove note giornaliere — {{date}}, {{time}} e {{title}} vengono sostituiti.",
    body: "# {{title}}\n\n## Note\n\n## Attività\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Produttivo",
      tags: ["lavoro", "scrittura"],
      body:
        "Ecco come si presenta una voce. Umore e parole chiave si trovano nel frontmatter — per questo Diario.base può ordinare e filtrare in base a essi, senza che tu debba gestire nulla due volte.\n\n## Note\n\n- Il calendario nella barra laterale destra porta a ogni giorno.\n\n## Attività\n\n- [x] Scrivere la prima nota giornaliera\n- [ ] Tornare domani",
    },
    {
      offset: -1,
      mood: "Stanco",
      tags: ["quotidiano"],
      body:
        "Anche una voce breve è una voce. Nel tempo, ciò che conta non è il singolo giorno ma la sequenza — è per questo che esiste la vista tabella ordinata per data.\n\n## Note\n\n- Fatto poco, ma finito presto.",
    },
  ],
};

/** The one note that shows the editor itself: callouts, a table, a diagram, a
 * formula, a footnote, a highlight, tasks and an embedded image. */
const CHEAT_SHEET_IT = `Tutto quello che segue è puro Markdown. Passa da lettura a modifica con la barra degli strumenti — l'editor mostra i simboli di formattazione solo dove si trova il cursore.

> [!tip] Callout
> Inizia una citazione con \`> [!tip]\`. Ci sono altri tipi: note, warning, danger, example, question.

## Una tabella

| Scorciatoia | Fa |
| --- | --- |
| \`Mod+P\` | Palette dei comandi |
| \`Mod+O\` | Apertura rapida |
| \`F1\` | Tutte le scorciatoie |

## Un diagramma

\`\`\`mermaid
flowchart LR
  A[Nota veloce] --> B[Attività]
  B --> C[Progetto]
  C --> D[Area]
\`\`\`

## Una formula

In linea: $E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Un'immagine

![[Allegati/skizze.svg]]

## Attività ed evidenziazioni

- [x] Qualcosa di finito
- [ ] Qualcosa ==da evidenziare== #tour

I link puntano a note: [[Rilancio del sito web]] e [[Lavoro]].

Anche le note a piè di pagina funzionano.[^1]

[^1]: Come questa.
`;

/** Italian strings. */
export const TOUR_STRINGS_IT: TourStrings = {
  name: "Plainva Tour",
  description:
    "Un vault guidato: bacheca, note giornaliere, aree, progetti e attività — ogni vista che Plainva offre, piena di esempi.",
  folders: {
    quickNotes: "Note veloci",
    journal: "Diario",
    areas: "Aree",
    projects: "Progetti",
    tasks: "Attività",
    resources: "Risorse",
    archive: "Archivio",
    attachments: "Allegati",
    templates: "Modelli",
  },
  folderHints: {
    quickNotes: "Tutto ciò che non ha ancora un posto — mostrato come bacheca.",
    journal: "Una nota al giorno, mostrata su un calendario.",
    areas: "Responsabilità continuative, come galleria.",
    projects: "Cose con una fine, su board e timeline.",
    tasks: "Il database delle attività standard — board e tabella.",
    resources: "Materiale che vuoi conservare.",
    archive: "Lavoro concluso; spostare qui una nota la toglie dalle viste attive.",
    attachments: "Immagini e file.",
    templates: "Modelli di nota, ognuno collegato al proprio database.",
  },
  welcome: {
    file: "Benvenuto.md",
    title: "Benvenuto in Plainva",
    intro:
      "Questo vault è un tour. Ogni cartella qui sotto è piena di esempi, e ogni database mostra una vista diversa — aprili e cambia le cose: qui non c'è nulla di prezioso.",
    outro:
      "Tutto ciò che vedi è puro Markdown in questa cartella. Elimina ciò che non ti serve, rinomina il resto: il vault è tuo.",
  },
  templates: {
    project: { file: "Progetto.md", body: "# {{title}}\n\n## Obiettivo\n\n## Prossimi passi\n\n- [ ] \n" },
    task: { file: "Attività.md", body: "# {{title}}\n\n" },
    area: { file: "Area.md", body: "# {{title}}\n\n## Come capisco che sta andando bene\n\n" },
    resource: { file: "Risorsa.md", body: "# {{title}}\n\n## Perché vale la pena conservarla\n\n" },
    quickNote: { file: "Nota veloce.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Nota giornaliera.md",
      description:
        "Modello per le nuove note giornaliere — {{date}}, {{time}} e {{daily±1}} vengono sostituiti alla creazione della nota.",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## Attività\n\n- [ ] \n\n## Note\n\n{{cursor}}\n",
    },
    meeting: {
      file: "Riunione.md",
      description:
        "Non assegnato a un database — compare in \"Mostra tutti i modelli\". Fa tre domande in un UNICO dialogo.",
      body: "# {{title}}\n\n**Tipo:** {{select:Tipo|Settimanale,Uno a uno,Workshop,Revisione}}\n**Data:** {{date_prompt:Data della riunione}}\n**Presenti:** {{prompt:Presenti|io}}\n\n## Agenda\n\n{{cursor}}\n\n## Decisioni\n\n## Attività\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Aree.base",
    projects: "Progetti.base",
    tasks: "Attività.base",
    resources: "Risorse.base",
    quickNotes: "Note veloci.base",
    journal: "Diario.base",
    archive: "Archivio.base",
  },
  keys: {
    focus: "focus", cover: "cover", projects: "progetti",
    status: "stato", area: "area", start: "inizio", end: "fine", tasks: "attivita",
    done: "fatto", project: "progetto", due: "scadenza", priority: "priorita",
    date: "data", mood: "umore", topics: "parolechiave",
    kind: "tipo", url: "url", readStatus: "stato",
    finished: "concluso",
  },
  options: {
    projectStatus: ["Pianificato", "Attivo", "In attesa", "Concluso"],
    taskStatus: ["Aperta", "In corso", "Fatta"],
    priority: ["Alta", "Media", "Bassa"],
    mood: ["Buono", "Neutro", "Faticoso", "Produttivo"],
    resourceKind: ["Libro", "Articolo", "Video", "Strumento", "Riferimento"],
    resourceStatus: ["Nuovo", "Letto"],
  },
  views: {
    table: "Tabella", board: "Board", timeline: "Timeline", gallery: "Galleria",
    list: "Lista", tree: "Albero", calendar: "Calendario", pinboard: "Bacheca",
  },
  subItems: { parent: "Elemento principale", children: "Sottoelementi" },
  welcomeSections: { databases: "I tuoi database", start: "Da dove iniziare" },
  samples: {
    areas: [
      {
        title: "Lavoro",
        body: "Tutto ciò per cui vengo pagato. I progetti qui hanno delle scadenze.",
        icon: "💼",
        color: "#2a7f7b",
        props: { focus: "Consegnare senza straordinari", cover: "Allegati/cover.svg" },
      },
      {
        title: "Casa",
        body: "L'appartamento, la burocrazia, le cose che devono andare avanti.",
        icon: "🏠",
        color: "#8a6d3b",
        props: { focus: "Niente in ritardo", cover: "Allegati/cover.svg" },
      },
      {
        title: "Salute",
        body: "Sonno, movimento, alimentazione — le cose noiose che decidono tutto il resto.",
        icon: "🌱",
        color: "#3d7f4a",
        props: { focus: "Tre sessioni a settimana" },
      },
      {
        title: "Apprendimento",
        body: "Ciò in cui voglio migliorare l'anno prossimo.",
        icon: "📚",
        color: "#5a5a8a",
        props: { focus: "Un libro al mese" },
      },
    ],
    projects: [
      {
        title: "Rilancio del sito web",
        body: "Nuova pagina iniziale e una struttura più chiara.\n\nVedi [[Lavoro]].",
        props: { stato: "Attivo", area: "[[Lavoro]]", inizio: "{{today-6}}", fine: "{{today+9}}" },
      },
      {
        title: "Trasloco dell'ufficio",
        body: "Stanza più piccola, stessa scrivania.",
        props: { stato: "Pianificato", area: "[[Lavoro]]", inizio: "{{today+4}}", fine: "{{today+13}}" },
      },
      {
        title: "Dichiarazione dei redditi",
        body: "In attesa di due ricevute.",
        props: { stato: "In attesa", area: "[[Casa]]", inizio: "{{today-3}}", fine: "{{today+6}}" },
      },
      {
        title: "Piano per la maratona",
        body: "Dodici settimane, tre corse a settimana.\n\nAppartiene a [[Salute]].",
        props: { stato: "Concluso", area: "[[Salute]]", inizio: "{{today-12}}", fine: "{{today-2}}" },
      },
    ],
    tasks: [
      {
        title: "Abbozzare la pagina iniziale",
        body: "Due varianti, poi decidere.",
        props: { fatto: false, stato: "In corso", progetto: "[[Rilancio del sito web]]", scadenza: "{{today+1}}", priorita: "Alta" },
      },
      {
        title: "Raccogliere i feedback",
        body: "Tre persone, un quarto d'ora ciascuna.",
        props: {
          fatto: false,
          stato: "Aperta",
          progetto: "[[Rilancio del sito web]]",
          scadenza: "{{today+5}}",
          priorita: "Media",
          parent: "[[Abbozzare la pagina iniziale]]",
        },
      },
      {
        title: "Scrivere i testi",
        body: "Frasi brevi.",
        props: { fatto: false, stato: "Aperta", progetto: "[[Rilancio del sito web]]", scadenza: "{{today+7}}", priorita: "Media" },
      },
      {
        title: "Sistemare le vecchie pagine",
        body: "",
        props: { fatto: true, stato: "Fatta", progetto: "[[Rilancio del sito web]]", scadenza: "{{today-2}}", priorita: "Bassa" },
      },
      {
        title: "Misurare la nuova stanza",
        body: "La scrivania è di 160 cm.",
        props: { fatto: false, stato: "Aperta", progetto: "[[Trasloco dell'ufficio]]", scadenza: "{{today+3}}", priorita: "Media" },
      },
      {
        title: "Ordinare gli scatoloni",
        body: "",
        props: { fatto: false, stato: "Aperta", progetto: "[[Trasloco dell'ufficio]]", scadenza: "{{today+8}}", priorita: "Bassa" },
      },
      {
        title: "Richiedere le ricevute",
        body: "Via mail, breve.",
        props: { fatto: false, stato: "In corso", progetto: "[[Dichiarazione dei redditi]]", scadenza: "{{today}}", priorita: "Alta" },
      },
      {
        title: "Prenotare la fisioterapia",
        body: "",
        props: { fatto: true, stato: "Fatta", progetto: "[[Piano per la maratona]]", scadenza: "{{today-4}}", priorita: "Media" },
      },
      {
        title: "Pianificare la prossima stagione",
        body: "Distanze più brevi, più sonno.",
        props: { fatto: false, stato: "Aperta", scadenza: "{{today+11}}", priorita: "Bassa" },
      },
    ],
    quickNotes: [
      {
        title: "Leggimi per primo",
        body: "Le schede su questa bacheca sono note normali. Trascinale, appuntale, coloriale — oppure eliminale tutte.\n\n#tour",
        pinned: true,
        color: "#2a7f7b",
      },
      { title: "Spesa", body: "- [ ] Caffè\n- [ ] Olio d'oliva\n- [x] Pane\n\n#casa", color: "#8a6d3b" },
      { title: "Idea per una serata di lettura", body: "Una volta al mese, un libro, niente slide.\n\n#idea" },
      {
        title: "Citazione",
        body: "> Una nota che non ritrovi mai più non è mai stata scritta.\n\n#citazione",
        color: "#5a5a8a",
      },
      {
        title: "Schizzo",
        body: "L'immagine qui sotto si trova nella cartella allegati.\n\n![[Allegati/skizze.svg]]\n\n#tour",
        pinned: true,
      },
      { title: "Tastiera", body: "`Mod+P` apre la palette dei comandi, `F1` elenca tutte le scorciatoie.\n\n#tour" },
    ],
    journal: [
      {
        title: "{{today}}",
        body: "Iniziato il tour. La board ha più senso di una lista.\n\nHo lavorato su [[Abbozzare la pagina iniziale]].",
        props: { data: "{{today}}", umore: "Produttivo", parolechiave: ["tour"] },
      },
      {
        title: "{{today-1}}",
        body: "Giornata tranquilla. Sistemate le carte della [[Dichiarazione dei redditi]].",
        props: { data: "{{today-1}}", umore: "Neutro", parolechiave: ["casa"] },
      },
    ],
    resources: [
      {
        title: "Guida rapida Markdown",
        body: CHEAT_SHEET_IT,
        props: { tipo: "Riferimento", stato: "Letto", cover: "Allegati/cover.svg" },
      },
      {
        title: "Manuale di Plainva",
        body: "La guida completa si trova su plainva.com/docs.",
        props: { tipo: "Riferimento", url: "https://plainva.com/docs", stato: "Nuovo" },
      },
      {
        title: "Lavoro concentrato",
        body: "Cal Newport. Il capitolo sulla pianificazione è quello utile.",
        props: { tipo: "Libro", stato: "Nuovo", area: "[[Apprendimento]]" },
      },
      {
        title: "Scorciatoie da tastiera",
        body: "Premi `F1` in Plainva — l'elenco è ricercabile.",
        props: { tipo: "Riferimento", stato: "Letto", area: "[[Apprendimento]]" },
      },
    ],
    archive: [
      {
        title: "Vecchio sito web",
        body: "Sostituito da [[Rilancio del sito web]]. Conservato per i testi.",
        props: { concluso: "{{today-20}}" },
      },
    ],
  },
};

/** Italian template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/umlaut-free; option VALUES, view names and `.base` file names are fully
 * localized. Relation columns and their reverse counterparts are wired here so
 * the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_IT),
    buildPara(PARA_STRINGS_IT),
    buildZettelkasten(ZK_STRINGS_IT),
    buildAce(ACE_STRINGS_IT),
    buildJd(JD_STRINGS_IT),
    buildGtd(GTD_STRINGS_IT),
    buildJournal(JOURNAL_STRINGS_IT),
    buildProject(PROJECT_STRINGS_IT),
  ];
}
