import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";

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
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_IT),
    buildZettelkasten(ZK_STRINGS_IT),
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlante, Calendario e Impegni — lavoro sulla conoscenza centrato sulle MOC, secondo Nick Milo.",
      folders: ["Atlante", "Calendario", "Impegni"],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault usa lo schema ACE di \"Linking Your Thinking\" (Nick Milo): la conoscenza è collegata tramite Maps of Content (MOC) invece che con un annidamento profondo.",
            [
              { name: "Atlante", description: "Le mappe della tua conoscenza — MOC e note di sintesi." },
              { name: "Calendario", description: "Ciò che è legato al tempo — note giornaliere, diari, retrospettive." },
              { name: "Impegni", description: "Tutto ciò su cui stai lavorando attivamente." },
            ],
            "Inizia nell'Atlante con la nota Home e collega da lì verso la tua conoscenza."
          ),
        },
        {
          path: "Atlante/Home.md",
          description: "La tua Map of Content di livello più alto.",
          body: "# Home\n\nLa nota Home è il tuo punto di ingresso: collega qui le tue Maps of Content più importanti e gli impegni in corso.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Aree e categorie numerate (10-19 / 11 / 11.01) per ritrovare tutto con certezza.",
      folders: [
        "00-09 Sistema",
        "00-09 Sistema/00 Indice",
        "10-19 Personale",
        "10-19 Personale/11 Finanze",
        "10-19 Personale/12 Salute",
        "20-29 Lavoro",
        "20-29 Lavoro/21 Progetti",
        "20-29 Lavoro/22 Riunioni",
      ],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault è organizzato secondo Johnny.Decimal: al massimo dieci aree (10-19, 20-29, …), al massimo dieci categorie per area (11, 12, …) — e ogni nota riceve un ID come 11.01.",
            [
              { name: "00-09 Sistema", description: "La gestione del sistema stesso — indice e convenzioni." },
              { name: "10-19 Personale", description: "Area di esempio per argomenti personali." },
              { name: "20-29 Lavoro", description: "Area di esempio per argomenti di lavoro." },
            ],
            "Rinomina le aree e le categorie in base ai tuoi argomenti — la profondità volutamente limitata (area → categoria → ID) è il cuore del metodo."
          ),
        },
        {
          path: "00-09 Sistema/00 Indice/00.00 Indice.md",
          description: "L'indice Johnny.Decimal: tutti i numeri in un unico posto.",
          body: "# 00.00 Indice\n\nTieni qui l'elenco di tutte le aree, categorie e ID. Chi cerca un numero controlla prima questa nota.\n\n## 10-19 Personale\n\n- 11 Finanze\n- 12 Salute\n\n## 20-29 Lavoro\n\n- 21 Progetti\n- 22 Riunioni\n",
        },
      ],
    },
    buildGtd(GTD_STRINGS_IT),
    {
      id: "journal",
      name: "Journal",
      description: "Note giornaliere con un modello già pronto e un database del diario — le note giornaliere sono configurate fin da subito.",
      folders: ["Diario", "Modelli"],
      bases: [
        defineBase({
          path: "Diario.base",
          sourceFolder: "Diario",
          columns: [
            { key: "data", input: "date" },
            { key: "umore", input: "select", options: ["Buono", "Neutro", "Cattivo", "Produttivo", "Stanco"] },
            { key: "parolechiave", input: "tags" },
          ],
          views: [
            { name: "Tabella", type: "table", sort: [{ property: "data", direction: "DESC" }] },
            { name: "Calendario", type: "calendar", dateField: "data" },
          ],
        }),
      ],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault è pensato per la scrittura quotidiana: le note giornaliere vivono nella cartella Diario e vengono create a partire dal modello nella cartella Modelli.",
            [
              { name: "Diario", description: "Le tue note giornaliere, una al giorno." },
              { name: "Modelli", description: "I modelli per le nuove note — il modello di nota giornaliera è già configurato." },
            ],
            "Apri il calendario nella barra laterale destra e clicca su un giorno per creare la tua prima nota giornaliera. Diario.base mostra le tue voci come tabella e su un calendario — con data, umore e parole chiave."
          ),
        },
        {
          path: "Modelli/Nota giornaliera.md",
          description: "Modello per le nuove note giornaliere — {{date}}, {{time}} e {{title}} vengono sostituiti.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { data: "{{date}}" },
          body: "# {{title}}\n\n## Note\n\n## Attività\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Diario", templateFolder: "Modelli", dailyNoteTemplate: "Nota giornaliera.md" },
    },
  ];
}
