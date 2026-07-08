import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

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
    {
      id: "para",
      name: "PARA",
      description: "Progetti, Aree, Risorse, Archivio — ordinati per prossimità operativa (Tiago Forte).",
      folders: ["Progetti", "Attività", "Aree", "Risorse", "Archivio", "Modelli"],
      bases: [
        defineBase({
          path: "Progetti.base",
          sourceFolder: "Progetti",
          columns: [
            { key: "stato", input: "status", options: ["Pianificato", "Attivo", "In attesa", "Concluso"] },
            { key: "area", input: "relation", relationBase: "Aree.base", relationLimit: "one" },
            { key: "scadenza", input: "date" },
            { key: "attivita", reverseOf: { base: "Attività.base", property: "progetto" } },
          ],
          views: [
            { name: "Tabella", type: "table" },
            { name: "Per stato", type: "board", groupBy: "stato" },
          ],
          newItemTemplate: "Modelli/Progetto.md",
        }),
        defineBase({
          path: "Attività.base",
          sourceFolder: "Attività",
          columns: [
            { key: "stato", input: "status", options: ["Aperta", "In corso", "Fatta"] },
            { key: "progetto", input: "relation", relationBase: "Progetti.base", relationLimit: "one" },
            { key: "scadenza", input: "date" },
          ],
          views: [
            { name: "Tabella", type: "table" },
            { name: "Per stato", type: "board", groupBy: "stato" },
          ],
          newItemTemplate: "Modelli/Attività.md",
        }),
        defineBase({
          path: "Aree.base",
          sourceFolder: "Aree",
          columns: [{ key: "progetti", reverseOf: { base: "Progetti.base", property: "area" } }],
          views: [{ name: "Tabella", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Benvenuto.md",
          description: "Punto di partenza e guida rapida per questo vault.",
          body: welcomeBody(
            "Benvenuto",
            "Questo vault è organizzato secondo il metodo PARA (Tiago Forte): i contenuti sono ordinati per prossimità operativa, non per argomento.",
            [
              { name: "Progetti", description: "Iniziative con un obiettivo chiaro e una data di fine (Progetti.base)." },
              { name: "Attività", description: "Singoli prossimi passi — ognuna rimanda al proprio progetto (Attività.base)." },
              { name: "Aree", description: "Responsabilità continuative, senza una data di fine." },
              { name: "Risorse", description: "Argomenti, materiali e riferimenti da conservare." },
              { name: "Archivio", description: "Ciò che è concluso o inattivo, proveniente dalle altre cartelle." },
            ],
            "Apri i database Progetti.base, Attività.base e Aree.base per vedere i progetti per stato, assegnare loro delle attività e collegarli alle loro aree — ciò che è concluso passa nell'Archivio, mentre i link e le panoramiche index.md vengono mantenuti automaticamente."
          ),
        },
        {
          path: "Progetti/Progetto di esempio.md",
          description: "Un esempio di nota di progetto.",
          properties: { stato: "Attivo", area: "[[Area di esempio]]" },
          body: "# Progetto di esempio\n\nUn progetto ha un obiettivo chiaro e una fine prevedibile. Annota qui lo scopo, i prossimi passi e i risultati.\n\n- [ ] Annotare l'obiettivo del progetto\n- [ ] Decidere il prossimo passo\n",
        },
        {
          path: "Attività/Attività di esempio.md",
          description: "Un esempio di attività collegata al proprio progetto.",
          properties: { stato: "Aperta", progetto: "[[Progetto di esempio]]" },
          body: "# Attività di esempio\n\nUn'attività è un singolo, concreto prossimo passo. Tramite la sua proprietà Progetto appartiene al Progetto di esempio.\n",
        },
        {
          path: "Aree/Area di esempio.md",
          description: "Un esempio di area di responsabilità.",
          body: "# Area di esempio\n\nUn'area è una responsabilità continuativa senza data di fine — per esempio \"Salute\" o \"Finanze\". I progetti vi si collegano tramite la loro proprietà Area.\n",
        },
        {
          path: "Modelli/Progetto.md",
          properties: { stato: "Pianificato" },
          body: "# {{title}}\n\n## Obiettivo\n\n## Prossimi passi\n\n- [ ] \n",
        },
        {
          path: "Modelli/Attività.md",
          properties: { stato: "Aperta" },
          body: "# {{title}}\n\n## Note\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Modelli" },
    },
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
