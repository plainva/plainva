import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

/** Dutch template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */

// ---------------------------------------------------------------------------
// Plainva Tour — shared structure (plainvaTour.ts), Dutch strings.
// ---------------------------------------------------------------------------

const CHEAT_SHEET_NL = `Alles hieronder is gewoon Markdown. Schakel tussen lezen en bewerken met de werkbalk — de editor toont de opmaaktekens alleen daar waar je cursor staat.

> [!tip] Callouts
> Begin een citaat met \`> [!tip]\`. Er zijn meer soorten: note, warning, danger, example, question.

## Een tabel

| Sneltoets | Actie |
| --- | --- |
| \`Mod+P\` | Opdrachtenpalet |
| \`Mod+O\` | Snelkiezer |
| \`F1\` | Alle sneltoetsen |

## Een diagram

\`\`\`mermaid
flowchart LR
  A[Snelle notitie] --> B[Taak]
  B --> C[Project]
  C --> D[Domein]
\`\`\`

## Een formule

In de tekst: $E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Een afbeelding

![[Bijlagen/skizze.svg]]

## Taken en markeringen

- [x] Iets afgeronds
- [ ] Iets ==vermeldenswaardigs== #tour

Links verwijzen naar notities: [[Website-relaunch]] en [[Werk]].

Voetnoten werken ook.[^1]

[^1]: Zoals deze.
`;

const TOUR_STRINGS_NL: TourStrings = {
  name: "Plainva-tour",
  description: "Een begeleide vault: prikbord, dagelijkse notities, domeinen, projecten en taken — elke weergave die Plainva biedt, gevuld met voorbeelden.",
  folders: {
    quickNotes: "Snelle notities",
    journal: "Journal",
    areas: "Domeinen",
    projects: "Projecten",
    tasks: "Taken",
    resources: "Bronnen",
    archive: "Archief",
    attachments: "Bijlagen",
    templates: "Sjablonen",
  },
  folderHints: {
    quickNotes: "Alles wat nog geen plek heeft — als prikbord.",
    journal: "Eén notitie per dag, op een kalender.",
    areas: "Blijvende verantwoordelijkheden, als galerij.",
    projects: "Zaken met een einde, op een bord en een tijdlijn.",
    tasks: "De standaard-taakdatabase — bord en tabel.",
    resources: "Materiaal dat je wilt bewaren.",
    archive: "Afgerond werk; een notitie hierheen verplaatsen haalt haar uit de actieve weergaven.",
    attachments: "Afbeeldingen en bestanden.",
    templates: "Notitiesjablonen, elk gekoppeld aan zijn database.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom bij Plainva",
    intro: "Deze vault is een tour. Elke map hieronder is gevuld met voorbeelden, en elke database toont een andere weergave — open ze en verander iets: hier is niets kostbaars.",
    outro: "Alles wat je ziet is gewoon Markdown in deze map. Verwijder wat je niet nodig hebt, hernoem de rest — dan is de vault van jou.",
  },
  templates: {
    project: { file: "Project.md", body: "# {{title}}\n\n## Doel\n\n## Volgende stappen\n\n- [ ] \n" },
    task: { file: "Taak.md", body: "# {{title}}\n\n" },
    area: { file: "Domein.md", body: "# {{title}}\n\n## Hoe ziet het eruit als het goed gaat\n\n" },
    resource: { file: "Bron.md", body: "# {{title}}\n\n## Waarom dit het bewaren waard is\n\n" },
    quickNote: { file: "Snelle notitie.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Dagnotitie.md",
      description: "Sjabloon voor nieuwe dagelijkse notities — {{date}}, {{time}} en {{daily±1}} worden vervangen wanneer de notitie wordt aangemaakt.",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## Taken\n\n- [ ] \n\n## Notities\n\n{{cursor}}\n",
    },
    meeting: {
      file: "Vergadering.md",
      description: "Niet aan een database gekoppeld — verschijnt onder “Alle sjablonen tonen”. Stelt drie vragen in ÉÉN dialoogvenster.",
      body: "# {{title}}\n\n**Soort:** {{select:Soort|Wekelijks,1-op-1,Workshop,Terugblik}}\n**Datum:** {{date_prompt:Vergaderdatum}}\n**Aanwezig:** {{prompt:Aanwezig|ik}}\n\n## Agenda\n\n{{cursor}}\n\n## Beslissingen\n\n## Taken\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Domeinen.base",
    projects: "Projecten.base",
    tasks: "Taken.base",
    resources: "Bronnen.base",
    quickNotes: "Snelle notities.base",
    journal: "Journal.base",
    archive: "Archief.base",
  },
  keys: {
    focus: "focus", cover: "cover", projects: "projecten",
    status: "status", area: "domein", start: "start", end: "einde", tasks: "taken",
    done: "afgerond", project: "project", due: "deadline", priority: "prioriteit",
    date: "datum", mood: "stemming", topics: "trefwoorden",
    kind: "soort", url: "url", readStatus: "status",
    finished: "afgesloten",
  },
  options: {
    projectStatus: ["Gepland", "Actief", "Wachtend", "Afgerond"],
    taskStatus: ["Open", "Bezig", "Afgerond"],
    priority: ["Hoog", "Gemiddeld", "Laag"],
    mood: ["Goed", "Neutraal", "Zwaar", "Productief"],
    resourceKind: ["Boek", "Artikel", "Video", "Hulpmiddel", "Referentie"],
    resourceStatus: ["Nieuw", "Gelezen"],
  },
  views: {
    table: "Tabel", board: "Bord", timeline: "Tijdlijn", gallery: "Galerij",
    list: "Lijst", tree: "Boomstructuur", calendar: "Kalender", pinboard: "Prikbord",
  },
  subItems: { parent: "Bovenliggend item", children: "Subitems" },
  welcomeSections: { databases: "Jouw databases", start: "Om te beginnen" },
  samples: {
    areas: [
      { title: "Werk", body: "Alles waarvoor ik betaald word. Projecten hier hebben deadlines.", icon: "💼", color: "#2a7f7b", props: { focus: "Leveren zonder overuren", cover: "Bijlagen/cover.svg" } },
      { title: "Thuis", body: "De woning, de administratie, de dingen die moeten blijven draaien.", icon: "🏠", color: "#8a6d3b", props: { focus: "Niets te laat", cover: "Bijlagen/cover.svg" } },
      { title: "Gezondheid", body: "Slaap, beweging, eten — het saaie dat over al het andere beslist.", icon: "🌱", color: "#3d7f4a", props: { focus: "Drie keer per week" } },
      { title: "Leren", body: "Waar ik volgend jaar beter in wil worden.", icon: "📚", color: "#5a5a8a", props: { focus: "Eén boek per maand" } },
    ],
    projects: [
      { title: "Website-relaunch", body: "Nieuwe startpagina en een duidelijkere structuur.\n\nZie [[Werk]].", props: { status: "Actief", domein: "[[Werk]]", start: "{{today-6}}", einde: "{{today+9}}" } },
      { title: "Kantoor verhuizen", body: "Kleinere ruimte, hetzelfde bureau.", props: { status: "Gepland", domein: "[[Werk]]", start: "{{today+4}}", einde: "{{today+13}}" } },
      { title: "Belastingaangifte", body: "Wacht nog op twee bonnetjes.", props: { status: "Wachtend", domein: "[[Thuis]]", start: "{{today-3}}", einde: "{{today+6}}" } },
      { title: "Marathonplan", body: "Twaalf weken, drie keer per week hardlopen.\n\nHoort bij [[Gezondheid]].", props: { status: "Afgerond", domein: "[[Gezondheid]]", start: "{{today-12}}", einde: "{{today-2}}" } },
    ],
    tasks: [
      { title: "Startpagina ontwerpen", body: "Twee varianten, dan beslissen.", props: { afgerond: false, status: "Bezig", project: "[[Website-relaunch]]", deadline: "{{today+1}}", prioriteit: "Hoog" } },
      { title: "Feedback verzamelen", body: "Drie mensen, elk een kwartier.", props: { afgerond: false, status: "Open", project: "[[Website-relaunch]]", deadline: "{{today+5}}", prioriteit: "Gemiddeld", parent: "[[Startpagina ontwerpen]]" } },
      { title: "Teksten schrijven", body: "Korte zinnen.", props: { afgerond: false, status: "Open", project: "[[Website-relaunch]]", deadline: "{{today+7}}", prioriteit: "Gemiddeld" } },
      { title: "Oude pagina's opruimen", body: "", props: { afgerond: true, status: "Afgerond", project: "[[Website-relaunch]]", deadline: "{{today-2}}", prioriteit: "Laag" } },
      { title: "Nieuwe ruimte opmeten", body: "Bureau is 160 cm.", props: { afgerond: false, status: "Open", project: "[[Kantoor verhuizen]]", deadline: "{{today+3}}", prioriteit: "Gemiddeld" } },
      { title: "Dozen bestellen", body: "", props: { afgerond: false, status: "Open", project: "[[Kantoor verhuizen]]", deadline: "{{today+8}}", prioriteit: "Laag" } },
      { title: "Bonnetjes opvragen", body: "Per mail, kort houden.", props: { afgerond: false, status: "Bezig", project: "[[Belastingaangifte]]", deadline: "{{today}}", prioriteit: "Hoog" } },
      { title: "Afspraak bij de fysio maken", body: "", props: { afgerond: true, status: "Afgerond", project: "[[Marathonplan]]", deadline: "{{today-4}}", prioriteit: "Gemiddeld" } },
      { title: "Volgend seizoen plannen", body: "Kortere afstanden, meer slaap.", props: { afgerond: false, status: "Open", deadline: "{{today+11}}", prioriteit: "Laag" } },
    ],
    quickNotes: [
      { title: "Lees mij eerst", body: "De kaarten hier zijn heel gewone notities. Versleep ze, zet ze vast, geef ze een kleur — of verwijder ze allemaal.\n\n#tour", pinned: true, color: "#2a7f7b" },
      { title: "Boodschappen", body: "- [ ] Koffie\n- [ ] Olijfolie\n- [x] Brood\n\n#thuis", color: "#8a6d3b" },
      { title: "Idee voor een leesavond", body: "Eén keer per maand, één boek, geen slides.\n\n#idee" },
      { title: "Citaat", body: "> Een notitie die je nooit meer terugvindt, heb je nooit geschreven.\n\n#citaat", color: "#5a5a8a" },
      { title: "Schets", body: "De afbeelding hieronder staat in de bijlagenmap.\n\n![[Bijlagen/skizze.svg]]\n\n#tour", pinned: true },
      { title: "Toetsenbord", body: "`Mod+P` opent het opdrachtenpalet, `F1` toont alle sneltoetsen.\n\n#tour" },
    ],
    journal: [
      { title: "{{today}}", body: "Met de tour begonnen. Het bord is duidelijker dan een lijst.\n\nGewerkt aan [[Startpagina ontwerpen]].", props: { datum: "{{today}}", stemming: "Productief", trefwoorden: ["tour"] } },
      { title: "{{today-1}}", body: "Rustige dag. De papieren voor de [[Belastingaangifte]] gesorteerd.", props: { datum: "{{today-1}}", stemming: "Neutraal", trefwoorden: ["thuis"] } },
    ],
    resources: [
      { title: "Markdown-spiekbriefje", body: CHEAT_SHEET_NL, props: { soort: "Referentie", status: "Gelezen", cover: "Bijlagen/cover.svg" } },
      { title: "Plainva-handleiding", body: "De volledige handleiding staat op plainva.com/docs.", props: { soort: "Referentie", url: "https://plainva.com/docs", status: "Nieuw" } },
      { title: "Deep work", body: "Cal Newport. Het hoofdstuk over planning is het nuttigste.", props: { soort: "Boek", status: "Nieuw", domein: "[[Leren]]" } },
      { title: "Sneltoetsen", body: "Druk in Plainva op `F1` — de lijst is doorzoekbaar.", props: { soort: "Referentie", status: "Gelezen", domein: "[[Leren]]" } },
    ],
    archive: [
      { title: "Oude website", body: "Vervangen door [[Website-relaunch]]. Bewaard vanwege de teksten.", props: { afgesloten: "{{today-20}}" } },
    ],
  },
};

const PARA_STRINGS_NL: ParaStrings = {
  name: "PARA",
  description: "Projecten, Domeinen, Bronnen, Archief — gesorteerd naar actiegerichtheid (Tiago Forte).",
  folders: {
    projects: "Projecten",
    tasks: "Taken",
    areas: "Domeinen",
    resources: "Bronnen",
    archive: "Archief",
    templates: "Sjablonen",
  },
  folderHints: {
    projects: "Initiatieven met een duidelijk doel en einddatum (Projecten.base).",
    tasks: "Losse volgende stappen — elke taak verwijst naar haar project (Taken.base).",
    areas: "Blijvende verantwoordelijkheidsgebieden zonder einddatum.",
    resources: "Onderwerpen, materiaal en naslagwerk om te bewaren.",
    archive: "Afgerond of inactief materiaal uit de andere mappen.",
  },
  welcome: {
    file: "Welkom.md",
    description: "Startpunt en korte handleiding voor deze vault.",
    title: "Welkom",
    intro:
      "Deze vault is georganiseerd volgens de PARA-methode (Tiago Forte): inhoud wordt gesorteerd naar actiegerichtheid, niet naar onderwerp. De voorbeelden hieronder zijn echte notities — wijzig ze, verplaats ze, verwijder ze.",
    outro:
      "Open de databases om projecten op status te zien, er taken aan toe te wijzen en ze aan hun domeinen te koppelen — afgeronde zaken verhuizen naar Archief, terwijl links en de index.md-overzichten automatisch worden bijgehouden.",
  },
  welcomeSections: { databases: "Jouw databases", start: "Om te beginnen" },
  baseFiles: { projects: "Projecten.base", tasks: "Taken.base", areas: "Domeinen.base" },
  keys: { status: "status", area: "domein", due: "deadline", tasks: "taken", project: "project", projects: "projecten" },
  options: {
    projectStatus: ["Gepland", "Actief", "Wachtend", "Afgerond"],
    taskStatus: ["Open", "Bezig", "Afgerond"],
  },
  views: { table: "Tabel", byStatus: "Op status" },
  templates: {
    project: { file: "Project.md", body: "# {{title}}\n\n## Doel\n\n## Volgende stappen\n\n- [ ] \n" },
    task: { file: "Taak.md", body: "# {{title}}\n\n## Notities\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Team",
        body: "Een domein is een blijvende verantwoordelijkheid zonder einddatum. Projecten koppelen zich via de eigenschap Domein eraan — in de tabel van Domeinen.base zie je ze teruggespiegeld.",
      },
      { title: "Financiën", body: "Boekhouding, contracten, verzekeringen. Loopt door, ook als er net geen project openstaat." },
      { title: "Gezondheid", body: "Alles wat blijvende aandacht vraagt in plaats van een eindpunt te hebben." },
    ],
    projects: [
      {
        title: "Belastingaangifte 2026",
        body: "Een project heeft een duidelijk doel en een voorzienbaar einde. Dit project is gepland, maar nog niet begonnen — daarom staat het in de eerste kolom van het bord.",
        props: { status: "Gepland", domein: "[[Financiën]]", deadline: "{{today+45}}" },
      },
      {
        title: "Verhuizing naar het nieuwe kantoor",
        body: "Het actieve voorbeeld: de taken hieronder verwijzen via hun eigenschap Project hierheen, en Projecten.base spiegelt ze terug in de kolom Taken.\n\n- [ ] Doel van het project noteren\n- [ ] Volgende stap bepalen",
        props: { status: "Actief", domein: "[[Team]]", deadline: "{{today+21}}" },
      },
      {
        title: "Rugprogramma",
        body: "Wacht op iets buiten jouw controle — hier op een afspraak. Precies daarvoor is de derde kolom bedoeld.",
        props: { status: "Wachtend", domein: "[[Gezondheid]]", deadline: "{{today+10}}" },
      },
      {
        title: "Website-relaunch",
        body: "Afgerond. Een afgerond project blijft zichtbaar tot je het naar Archief verplaatst — de database volgt het bestand.",
        props: { status: "Afgerond", domein: "[[Team]]", deadline: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Offertes van verhuisbedrijven opvragen",
        body: "Een taak is één enkele, concrete volgende stap.",
        props: { status: "Open", project: "[[Verhuizing naar het nieuwe kantoor]]", deadline: "{{today+3}}" },
      },
      {
        title: "Opzegtermijn van de oude ruimtes controleren",
        body: "Begonnen, maar nog niet klaar — in het bord de middelste kolom.",
        props: { status: "Bezig", project: "[[Verhuizing naar het nieuwe kantoor]]", deadline: "{{today+1}}" },
      },
      {
        title: "Plattegrond afstemmen met het team",
        body: "Sleep de kaart in het bord naar een andere kolom: Plainva schrijft de nieuwe status naar de notitie.",
        props: { status: "Bezig", project: "[[Verhuizing naar het nieuwe kantoor]]", deadline: "{{today+7}}" },
      },
      {
        title: "Bonnetjes sorteren",
        body: "Hoort bij een project dat nog helemaal niet begonnen is — dat mag, en is vaak nuttig.",
        props: { status: "Open", project: "[[Belastingaangifte 2026]]", deadline: "{{today+14}}" },
      },
      {
        title: "Afspraak bij de fysio maken",
        body: "Afgerond. De taak blijft als notitie bestaan; alleen haar status is veranderd.",
        props: { status: "Afgerond", project: "[[Rugprogramma]]", deadline: "{{today-2}}" },
      },
      {
        title: "Oude domein doorverwijzen",
        body: "De laatste stap van het afgeronde project.",
        props: { status: "Afgerond", project: "[[Website-relaunch]]", deadline: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Checklist kantoorverhuizing",
        body: "Bronnen zijn materiaal om op te zoeken — geen doel, geen einddatum. Ze staan bewust in geen enkele database: niet alles hoeft rijen en kolommen te hebben.\n\n- [ ] Adreswijziging bij bank en verzekeraar\n- [ ] Netwerk en printers inmeten",
      },
      {
        title: "Wat PARA onderscheidt van mappen",
        body: "PARA sorteert naar actiegerichtheid: projecten hebben een einde, domeinen blijven doorlopen, bronnen zijn naslagwerk, het archief is al het overige. Verplaats een notitie tussen de mappen zodra haar rol verandert.",
      },
    ],
    archive: [
      {
        title: "Beursstand 2025",
        body: "Zo ziet gearchiveerd eruit: een heel gewone notitie, alleen in een andere map. Er gaat niets verloren — ze duikt alleen niet meer op in de actieve databases.",
      },
    ],
  },
};

const GTD_STRINGS_NL: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — inbox, taken, projecten, referentie en ooit-misschienlijst.",
  folders: {
    inbox: "Inbox",
    tasks: "Taken",
    projects: "Projecten",
    reference: "Referentie",
    someday: "Ooit misschien",
    templates: "Sjablonen",
  },
  folderHints: {
    inbox: "Verzamelpunt voor alles wat binnenkomt — regelmatig leegmaken.",
    tasks: "Losse volgende acties — georganiseerd op status en context (Taken.base).",
    projects: "Alles wat meer dan één stap vraagt (Projecten.base).",
    reference: "Naslagmateriaal zonder actie nodig.",
    someday: "Ideeën en projecten voor later.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    description: "Startpunt en korte handleiding voor deze vault.",
    intro:
      "Deze vault volgt Getting Things Done (David Allen): alles komt eerst in de inbox terecht en wordt van daaruit tot concrete taken en projecten verwerkt. De voorbeelden hieronder zijn echte notities — verwerk ze, verplaats ze, verwijder ze.",
    outro:
      "In Taken.base koppel je elke taak via de eigenschap Project aan een project; Projecten.base laat vervolgens in de kolom Taken automatisch zien wat bij elk project hoort. De wekelijkse review houdt het systeem betrouwbaar.",
  },
  welcomeSections: { databases: "Jouw databases", start: "Om te beginnen" },
  baseFiles: { tasks: "Taken.base", projects: "Projecten.base" },
  keys: { status: "status", context: "context", project: "project", due: "deadline", tasks: "taken" },
  options: {
    taskStatus: ["Inbox", "Volgende", "Wachtend", "Ooit", "Afgerond"],
    context: ["@Thuis", "@Werk", "@Onderweg", "@Telefoon"],
    projectStatus: ["Actief", "Wachtend", "Ooit", "Afgerond"],
  },
  views: { table: "Tabel", byStatus: "Op status", byContext: "Op context" },
  templates: {
    task: { file: "Taak.md", body: "# {{title}}\n\n## Notities\n\n- [ ] \n" },
    project: { file: "Project.md", body: "# {{title}}\n\n## Gewenst resultaat\n\n## Volgende stappen\n\n- [ ] \n" },
  },
  review: {
    title: "Wekelijkse review",
    description: "Checklist voor de wekelijkse GTD-review.",
    body: "- [ ] Inbox tot nul terugbrengen\n- [ ] Projectenlijst doorlopen en volgende acties controleren\n- [ ] Ooit misschien-lijst doornemen\n- [ ] Agenda van de komende twee weken bekijken",
  },
  samples: {
    projects: [
      {
        title: "Keuken renoveren",
        body: "Gewenst resultaat: wat is er klaar als dit klaar is? In GTD is alles wat meer dan één stap vraagt een project — ook dingen die niet aanvoelen als een project.",
        props: { status: "Actief" },
      },
      {
        title: "Auto naar de garage",
        body: "Wacht op iemand anders — hier op een telefoontje van de garage. Daarom staat dit project in de tweede kolom van het bord.",
        props: { status: "Wachtend" },
      },
      {
        title: "Spaans leren",
        body: "Ooit, misschien. Het staat in het systeem zodat het niet in je hoofd blijft rondspoken — maar het vraagt nu geen aandacht.",
        props: { status: "Ooit" },
      },
      {
        title: "Belastingpapieren sorteren",
        body: "Afgerond. Een afgerond project blijft zichtbaar tot je het opruimt — de database volgt het bestand.",
        props: { status: "Afgerond" },
      },
    ],
    tasks: [
      {
        title: "Ideeën verzamelen",
        body: "Net in de inbox beland en nog niet verwerkt — daarom zonder context en zonder project. Bij de volgende review krijgt ze allebei.",
        props: { status: "Inbox" },
      },
      {
        title: "Keuken opmeten",
        body: "Een taak is één enkele, concrete volgende actie. Via de eigenschap Project hoort ze bij de renovatie.",
        props: { status: "Volgende", context: "@Thuis", project: "[[Keuken renoveren]]", deadline: "{{today+2}}" },
      },
      {
        title: "Offerte van de timmerman controleren",
        body: "Sleep de kaart in het bord naar een andere kolom: Plainva schrijft de nieuwe status naar de notitie.",
        props: { status: "Volgende", context: "@Werk", project: "[[Keuken renoveren]]", deadline: "{{today+5}}" },
      },
      {
        title: "Garage terugbellen",
        body: "Wacht op iemand anders. De context @Telefoon verzamelt alles wat je in één keer kunt afhandelen zodra je de telefoon in je hand hebt.",
        props: { status: "Wachtend", context: "@Telefoon", project: "[[Auto naar de garage]]" },
      },
      {
        title: "Taalcursus in de buurt zoeken",
        body: "Hoort bij een ooit-project en wacht met dat project mee. Ook dat is een keuze — alleen tegen nu.",
        props: { status: "Ooit", context: "@Onderweg", project: "[[Spaans leren]]" },
      },
      {
        title: "Bonnetjes van vorig jaar inscannen",
        body: "Afgerond. De taak blijft als notitie bestaan; alleen haar status is veranderd.",
        props: { status: "Afgerond", context: "@Thuis", project: "[[Belastingpapieren sorteren]]", deadline: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "De twee GTD-vragen",
        body: "Referentie is materiaal zonder actie nodig — het staat bewust in geen enkele database.\n\nBij het verwerken van de inbox beantwoord je twee vragen: is het uitvoerbaar? En zo ja — wat is de ene, concrete volgende actie? Al het andere is referentie, ooit misschien, of de prullenbak.",
      },
    ],
    someday: [
      {
        title: "Fotoboek van afgelopen zomer",
        body: "Ooit betekent niet nooit, maar niet nu. Tijdens de wekelijkse review neem je deze lijst door — wat je twee keer aanspreekt, wordt een project.",
      },
    ],
  },
};

const ZK_STRINGS_NL: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Eén idee per notitie, dicht gelinkt — vluchtige, literatuur- en permanente notities (Luhmann).",
  folders: {
    fleeting: "Vluchtige notities",
    literature: "Literatuurnotities",
    permanent: "Permanente notities",
    templates: "Sjablonen",
  },
  folderHints: {
    fleeting: "Snelle, ruwe gedachten — kortstondig, worden later verwerkt.",
    literature: "Samenvattingen van wat je gelezen hebt, in je eigen woorden, met bron.",
    permanent: "Uitgewerkte, blijvende ideeën — één per notitie, sterk gelinkt.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    description: "Startpunt en korte handleiding voor deze vault.",
    intro:
      "Deze vault volgt de Zettelkasten-methode (Niklas Luhmann): één idee per notitie — verbanden ontstaan via links, niet via mapstructuren. De notities hieronder verwijzen naar elkaar; volg ze en bekijk daarna de graaf.",
    outro:
      "Gebruik Literatuur.base om je bronnen op leesstatus bij te houden; Notities.base koppelt permanente notities via de eigenschap Bron aan de literatuur waar ze vandaan komen.",
  },
  welcomeSections: { databases: "Jouw databases", start: "Om te beginnen" },
  baseFiles: { literature: "Literatuur.base", slips: "Notities.base" },
  keys: { author: "auteur", year: "jaar", kind: "soort", status: "status", url: "url", slips: "notities", source: "bron" },
  options: {
    kind: ["Boek", "Artikel", "Video", "Podcast", "Website"],
    status: ["Te lezen", "Gelezen", "Verwerkt"],
  },
  views: { table: "Tabel", byStatus: "Op status" },
  templates: {
    literature: { file: "Literatuurnotitie.md", body: "# {{title}}\n\n## Samenvatting\n\n## Bron\n" },
    slip: { file: "Notitie.md", body: "# {{title}}\n\nEén idee, in volledige zinnen.\n\n## Verwante notities\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Eén gedachte per notitie",
        body: "Een permanente notitie bevat precies één idee, in volledige zinnen en in je eigen woorden. Alleen dan kun je haar later in een andere context hergebruiken zonder het origineel te hoeven opzoeken.\n\nVerder: [[Linken in plaats van indelen]] en [[Schrijven is denken]].",
        props: { bron: ["[[Luhmann - Communiceren met zettelkasten]]"] },
      },
      {
        title: "Linken in plaats van indelen",
        body: "Een map dwingt elke notitie in precies één lade. Een link laat haar in zoveel contexten staan als waar ze bij hoort — daarom wint een zettelkasten met de tijd aan waarde, in plaats van onoverzichtelijk te worden.\n\nTegenhanger: [[Eén gedachte per notitie]]. Praktisch gevolg: [[De instapnotitie]].",
        props: { bron: ["[[Luhmann - Communiceren met zettelkasten]]"] },
      },
      {
        title: "Schrijven is denken",
        body: "Als je een idee in je eigen woorden kunt opschrijven, heb je het begrepen; kun je dat niet, dan nog niet. Een literatuurnotitie omzetten in een permanente notitie is dus geen overschrijven — het is het eigenlijke werk.\n\nZie ook [[Eén gedachte per notitie]].",
        props: { bron: ["[[Ahrens - Slim aantekeningen maken]]"] },
      },
      {
        title: "De instapnotitie",
        body: "Een zettelkasten heeft deuren nodig. Een instapnotitie verzamelt links naar de draden waar je op dat moment aan werkt — ze vervangt geen inhoudsopgave, maar is zelf een notitie die blijft veranderen.\n\nDraden: [[Linken in plaats van indelen]] · [[Schrijven is denken]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Communiceren met zettelkasten",
        body: "Vat samen wat je gelezen hebt in je eigen woorden en leg de bron vast. Permanente notities verwijzen via hun eigenschap Bron terug hierheen — de kolom Notities laat zien welke dat zijn.",
        props: { auteur: "Niklas Luhmann", jaar: 1981, soort: "Artikel", status: "Verwerkt" },
      },
      {
        title: "Ahrens - Slim aantekeningen maken",
        body: "Gelezen, maar nog niet omgezet in permanente notities. Daar is de status voor: bij de volgende blik zie je meteen waar het werk is blijven liggen.",
        props: { auteur: "Sönke Ahrens", jaar: 2017, soort: "Boek", status: "Gelezen" },
      },
      {
        title: "Podcast over aantekeningen maken",
        body: "Nog niet gelezen — of beluisterd. In het bord staat deze bron in de eerste kolom tot je haar aanraakt.",
        props: { soort: "Podcast", status: "Te lezen" },
      },
    ],
    fleeting: [
      {
        title: "Aantekeningen van een wandeling",
        body: "Vluchtige notities zijn ruw materiaal: gekrabbeld, onvolledig, kortstondig. Bij het verwerken wordt er een permanente notitie van — of niets, en dat is ook prima.\n\n- Idee: links zijn meer waard dan mappen\n- Nakijken: klopt dat Luhmann-citaat wel?",
      },
    ],
  },
};

const ACE_STRINGS_NL: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Kalender en Inspanningen — MOC-gecentreerd werken volgens Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Kalender", efforts: "Inspanningen" },
  folderHints: {
    atlas: "Kaarten van je kennis — MOC's en overzichtsnotities.",
    calendar: "Tijdgebonden zaken — dagelijkse notities, journaals, terugblikken.",
    efforts: "Inspanningen — alles waar je actief aan werkt.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    description: "Startpunt en korte handleiding voor deze vault.",
    intro:
      "Deze vault gebruikt het ACE-schema uit „Linking Your Thinking” (Nick Milo): kennis wordt gekoppeld via Maps of Content (MOC's) in plaats van diep genest. Alle voorbeelden hieronder hangen aan de Home-notitie — klik erdoorheen en bekijk daarna de graaf.",
    outro:
      "Begin in de Atlas met de Home-notitie en link vandaar naar je kennis. Een MOC is zelf ook maar een notitie: hij mag groeien, zich opsplitsen en weer verdwijnen.",
  },
  welcomeSections: { start: "Om te beginnen" },
  home: {
    title: "Home",
    description: "Je hoogste Map of Content.",
    lead: "De Home-notitie is je startpunt: link hier naar je belangrijkste Maps of Content en lopende inspanningen. Geen map kan dat — een map kan een notitie maar op één plek onderbrengen.",
    mapsHeading: "Kaarten",
    effortsHeading: "Huidige inspanningen",
  },
  maps: [
    {
      title: "Schrijven MOC",
      body: "Een Map of Content verzamelt wat bij een onderwerp hoort en ordent het in je eigen woorden. Het vervangt geen inhoudsopgave — het is jouw kijk op een onderwerp, op een bepaald moment.",
      leads: "Vanaf hier:",
    },
    {
      title: "Tuin MOC",
      body: "Een MOC mag ook buiten de Atlas wijzen: deze kaart verwijst naar een lopende inspanning. Precies dat kriskras verwijzen is het hele punt.",
      leads: "Vanaf hier:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Waarom kaarten in plaats van mappen",
        body: "Een map beantwoordt de vraag „waar ligt dit?”. Een kaart beantwoordt „wat hoort bij elkaar en waarom?” — en dezelfde notitie mag op meerdere kaarten staan.\n\nTerug naar de kaart: [[Schrijven MOC]].",
      },
    ],
    efforts: [
      {
        title: "Hoogbed bouwen",
        body: "Een inspanning (effort) is iets waar je op dit moment aan werkt — met een voorzienbaar einde. Het staat bewust niet in de Atlas: de Atlas is voor wat blijft.\n\n- [ ] Afmetingen bepalen\n- [ ] Hout kopen\n\nHoort bij [[Tuin MOC]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Tijdgebonden materiaal hoort in de map Kalender: dagelijkse notities, terugblikken, alles wat aan een datum is gekoppeld in plaats van aan een onderwerp.\n\nVandaag bekeken: [[Waarom kaarten in plaats van mappen]].",
      },
    ],
  },
};

const JD_STRINGS_NL: JdStrings = {
  name: "Johnny.Decimal",
  description: "Genummerde gebieden en categorieën (10-19 / 11 / 11.01) voor gegarandeerde vindbaarheid.",
  folders: {
    system: "00-09 Systeem",
    systemIndex: "00 Index",
    personal: "10-19 Privé",
    finance: "11 Financiën",
    health: "12 Gezondheid",
    work: "20-29 Werk",
    projects: "21 Projecten",
    meetings: "22 Vergaderingen",
  },
  folderHints: {
    system: "Beheer van het systeem zelf — index en afspraken.",
    personal: "Voorbeeldgebied voor persoonlijke onderwerpen.",
    work: "Voorbeeldgebied voor werkgerelateerde onderwerpen.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    description: "Startpunt en korte handleiding voor deze vault.",
    intro:
      "Deze vault is georganiseerd volgens Johnny.Decimal: maximaal tien gebieden (10-19, 20-29, …), per gebied maximaal tien categorieën (11, 12, …) — en elke notitie krijgt een ID zoals 11.01. De voorbeelden hieronder laten zien hoe dat eruitziet.",
    outro:
      "Hernoem gebieden en categorieën naar je eigen onderwerpen — de bewust beperkte diepte (gebied → categorie → ID) is de kern van de methode. Een nummer wordt nooit opnieuw uitgegeven, ook niet als de notitie verdwijnt.",
  },
  welcomeSections: { start: "Om te beginnen" },
  index: {
    id: "00.00",
    title: "Index",
    description: "De Johnny.Decimal-index: alle nummers op één plek.",
    lead: "Houd hier de lijst bij van alle gebieden, categorieën en ID's. Wie een nummer zoekt, kijkt hier eerst — staat hij niet in de index, dan bestaat hij niet.",
  },
  samples: [
    {
      id: "11.01",
      title: "Huishoudbudget",
      body: "De eerste notitie in categorie 11 krijgt 01 — de volgende 02, enzovoort. Het nummer blijft bij de notitie, ook als je haar hernoemt.",
    },
    {
      id: "21.01",
      title: "Website-relaunch",
      body: "Ook een heel project krijgt precies één nummer. Alles wat erbij hoort, verwijst naar dat nummer in plaats van te verdwijnen in een eigen submap.",
    },
    {
      id: "22.01",
      title: "Kick-off website",
      body: "Vergaderingsnotities vormen een eigen categorie, zodat ze het projectnummer niet verstoppen. Deze hoort bij [[21.01 Website-relaunch]].",
    },
  ],
};

const JOURNAL_STRINGS_NL: JournalStrings = {
  name: "Journal",
  description: "Dagelijkse notities met een kant-en-klaar sjabloon en een journaal-database — dagnotities zijn meteen ingericht.",
  folders: { journal: "Journal", templates: "Sjablonen" },
  folderHints: {
    journal: "Je dagelijkse notities, één per dag.",
    templates: "Sjablonen voor nieuwe notities — het sjabloon voor de dagnotitie is al ingesteld.",
  },
  welcome: {
    file: "Welkom.md",
    title: "Welkom",
    description: "Startpunt en korte handleiding voor deze vault.",
    intro:
      "Deze vault is gemaakt voor dagelijks schrijven: dagelijkse notities komen in de map Journal en worden aangemaakt vanuit het sjabloon in de map Sjablonen. Er staan al twee voorbeelddagen klaar — vandaag en gisteren.",
    outro:
      "Open de kalender in de rechterzijbalk en klik op een dag om de volgende dagnotitie aan te maken. Journal.base laat je items zien als tabel en op een kalender — met datum, stemming en trefwoorden.",
  },
  welcomeSections: { databases: "Jouw databases", start: "Om te beginnen" },
  baseFile: "Journal.base",
  keys: { date: "datum", mood: "stemming", tags: "trefwoorden" },
  moods: ["Goed", "Neutraal", "Slecht", "Productief", "Moe"],
  views: { table: "Tabel", calendar: "Kalender" },
  template: {
    file: "Dagnotitie.md",
    description: "Sjabloon voor nieuwe dagelijkse notities — {{date}}, {{time}} en {{title}} worden vervangen.",
    body: "# {{title}}\n\n## Notities\n\n## Taken\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Productief",
      tags: ["werk", "schrijven"],
      body: "Zo ziet een item eruit. Stemming en trefwoorden staan in de frontmatter — daarom kan Journal.base erop sorteren en filteren zonder dat je iets dubbel bijhoudt.\n\n## Notities\n\n- De kalender in de rechterzijbalk brengt je naar elke dag.\n\n## Taken\n\n- [x] Eerste dagnotitie schrijven\n- [ ] Morgen terugkomen",
    },
    {
      offset: -1,
      mood: "Moe",
      tags: ["dagelijks"],
      body: "Ook een kort item is een item. Op de lange termijn is niet de losse dag interessant, maar de reeks — daarvoor is de tabelweergave op datum bedoeld.\n\n## Notities\n\n- Weinig gedaan, maar wel vroeg klaar.",
    },
  ],
};

export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_NL),
    buildPara(PARA_STRINGS_NL),
    buildZettelkasten(ZK_STRINGS_NL),
    buildAce(ACE_STRINGS_NL),
    buildJd(JD_STRINGS_NL),
    buildGtd(GTD_STRINGS_NL),
    buildJournal(JOURNAL_STRINGS_NL),
  ];
}
