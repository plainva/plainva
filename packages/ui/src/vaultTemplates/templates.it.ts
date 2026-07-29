import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";

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
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Un'idea per nota, densamente collegate — note fugaci, di lettura e permanenti (Luhmann).",
      folders: ["Note fugaci", "Note di lettura", "Note permanenti", "Modelli"],
      bases: [
        defineBase({
          path: "Lettura.base",
          sourceFolder: "Note di lettura",
          columns: [
            { key: "autore", input: "text" },
            { key: "anno", input: "number" },
            { key: "tipo", input: "select", options: ["Libro", "Articolo", "Video", "Podcast", "Sito web"] },
            { key: "stato", input: "status", options: ["Da leggere", "Letto", "Elaborato"] },
            { key: "url", input: "url" },
            { key: "note", reverseOf: { base: "Note.base", property: "fonte" } },
          ],
          views: [
            { name: "Tabella", type: "table" },
            { name: "Per stato", type: "board", groupBy: "stato" },
          ],
          newItemTemplate: "Modelli/Nota di lettura.md",
        }),
        defineBase({
          path: "Note.base",
          sourceFolder: "Note permanenti",
          columns: [{ key: "fonte", input: "relation", relationBase: "Lettura.base" }],
          views: [{ name: "Tabella", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault segue il metodo Zettelkasten (Niklas Luhmann): un'idea per nota — le connessioni nascono dai link, non dalle gerarchie di cartelle.",
            [
              { name: "Note fugaci", description: "Pensieri grezzi e rapidi — effimeri, da elaborare più avanti." },
              { name: "Note di lettura", description: "Riassunti di ciò che hai letto, con parole tue, con la fonte." },
              { name: "Note permanenti", description: "Idee durature e ben formulate — una per nota, fortemente collegate." },
            ],
            "Usa Lettura.base per tenere traccia delle tue fonti per stato di lettura; Note.base collega le note permanenti alla letteratura da cui provengono tramite la loro proprietà Fonte."
          ),
        },
        {
          path: "Note permanenti/Nota di esempio.md",
          description: "Un esempio di nota permanente.",
          properties: { fonte: ["[[Nota di lettura di esempio]]"] },
          body: "# Nota di esempio\n\nUna nota permanente contiene esattamente un'idea, scritta in frasi complete e con parole tue.\n\nCollega le note correlate direttamente nel testo — è così che cresce la rete di idee.\n",
        },
        {
          path: "Note di lettura/Nota di lettura di esempio.md",
          description: "Un esempio di nota di lettura.",
          properties: { autore: "Niklas Luhmann", anno: 1992, tipo: "Libro", stato: "Letto" },
          body: "# Nota di lettura di esempio\n\nRiassumi con parole tue ciò che hai letto e annota la fonte. Le note permanenti rimandano a questa nota di lettura tramite la loro proprietà Fonte.\n",
        },
        {
          path: "Modelli/Nota di lettura.md",
          properties: { stato: "Da leggere" },
          body: "# {{title}}\n\n## Riassunto\n\n## Fonte\n",
        },
      ],
      settings: { templateFolder: "Modelli" },
    },
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
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — posta in arrivo, attività, progetti, riferimenti ed elenco Un giorno forse.",
      folders: ["Posta in arrivo", "Attività", "Progetti", "Riferimenti", "Un giorno forse", "Modelli"],
      bases: [
        defineBase({
          path: "Attività.base",
          sourceFolder: "Attività",
          columns: [
            { key: "stato", input: "status", options: ["Posta in arrivo", "Prossima", "In attesa", "Un giorno forse", "Fatto"] },
            { key: "contesto", input: "select", options: ["@Casa", "@Lavoro", "@Commissioni", "@Telefono"] },
            { key: "progetto", input: "relation", relationBase: "Progetti.base", relationLimit: "one" },
            { key: "scadenza", input: "date" },
          ],
          views: [
            { name: "Tabella", type: "table" },
            { name: "Per stato", type: "board", groupBy: "stato" },
            { name: "Per contesto", type: "board", groupBy: "contesto" },
          ],
          newItemTemplate: "Modelli/Attività.md",
        }),
        defineBase({
          path: "Progetti.base",
          sourceFolder: "Progetti",
          columns: [
            { key: "stato", input: "status", options: ["Attivo", "In attesa", "Un giorno forse", "Concluso"] },
            { key: "attivita", reverseOf: { base: "Attività.base", property: "progetto" } },
          ],
          views: [
            { name: "Tabella", type: "table" },
            { name: "Per stato", type: "board", groupBy: "stato" },
          ],
          newItemTemplate: "Modelli/Progetto.md",
        }),
      ],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault segue Getting Things Done (David Allen): tutto arriva prima nella posta in arrivo e da lì viene smistato in attività e progetti concreti.",
            [
              { name: "Posta in arrivo", description: "Il punto di raccolta di tutto ciò che arriva — svuotala regolarmente." },
              { name: "Attività", description: "Singole prossime azioni — organizzate per stato e contesto (Attività.base)." },
              { name: "Progetti", description: "Tutto ciò che richiede più di un passo (Progetti.base)." },
              { name: "Riferimenti", description: "Materiale di consultazione, senza bisogno di alcuna azione." },
              { name: "Un giorno forse", description: "Idee e progetti per più avanti." },
            ],
            "In Attività.base assegni ogni attività a un progetto tramite la sua proprietà Progetto; Progetti.base mostra poi automaticamente ciò che appartiene a ciascun progetto nella colonna Attività. La revisione settimanale mantiene affidabile il sistema."
          ),
        },
        {
          path: "Revisione settimanale.md",
          description: "Lista di controllo per la revisione settimanale GTD.",
          body: "# Revisione settimanale\n\n- [ ] Azzerare la posta in arrivo\n- [ ] Scorrere la lista dei progetti e controllare le prossime azioni\n- [ ] Scorrere la lista Un giorno forse\n- [ ] Guardare il calendario delle prossime due settimane\n",
        },
        {
          path: "Progetti/Progetto di esempio.md",
          description: "Un esempio di nota di progetto GTD.",
          properties: { stato: "Attivo" },
          body: "# Progetto di esempio\n\nRisultato desiderato: come si presenta \"fatto\"?\n\nProssima azione:\n\n- [ ] Annotare l'unico, concreto prossimo passo\n",
        },
        {
          path: "Attività/Attività di esempio.md",
          description: "Un esempio di attività collegata a un progetto.",
          properties: { stato: "Prossima", contesto: "@Lavoro", progetto: "[[Progetto di esempio]]" },
          body: "# Attività di esempio\n\nUn'attività è una singola, concreta prossima azione. Tramite la sua proprietà Progetto appartiene al Progetto di esempio.\n",
        },
        {
          path: "Attività/Raccogliere idee.md",
          description: "Un esempio di elemento appena arrivato nella posta in arrivo.",
          properties: { stato: "Posta in arrivo" },
          body: "# Raccogliere idee\n\nAppena arrivato nella posta in arrivo e non ancora elaborato. Alla prossima revisione questa attività riceve un contesto e un progetto.\n",
        },
        {
          path: "Modelli/Attività.md",
          properties: { stato: "Posta in arrivo" },
          body: "# {{title}}\n\n## Note\n\n- [ ] \n",
        },
        {
          path: "Modelli/Progetto.md",
          properties: { stato: "Attivo" },
          body: "# {{title}}\n\n## Risultato desiderato\n\n## Prossimi passi\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Modelli" },
    },
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
