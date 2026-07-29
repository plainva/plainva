import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";

/** Dutch template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */

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

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_NL),
    buildZettelkasten(ZK_STRINGS_NL),
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Kalender en Inspanningen — MOC-gecentreerd werken volgens Nick Milo.",
      folders: ["Atlas", "Kalender", "Inspanningen"],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault gebruikt het ACE-schema uit „Linking Your Thinking” (Nick Milo): kennis wordt gekoppeld via Maps of Content (MOC's) in plaats van diep genest.",
            [
              { name: "Atlas", description: "Kaarten van je kennis — MOC's en overzichtsnotities." },
              { name: "Kalender", description: "Tijdgebonden zaken — dagelijkse notities, journaals, terugblikken." },
              { name: "Inspanningen", description: "Alles waar je actief aan werkt." },
            ],
            "Begin in de Atlas met de Home-notitie en link vandaar naar je kennis."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Je hoogste Map of Content.",
          body: "# Home\n\nDe Home-notitie is je startpunt: link hier naar je belangrijkste Maps of Content en lopende inspanningen.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Genummerde gebieden en categorieën (10-19 / 11 / 11.01) voor gegarandeerde vindbaarheid.",
      folders: [
        "00-09 Systeem",
        "00-09 Systeem/00 Index",
        "10-19 Privé",
        "10-19 Privé/11 Financiën",
        "10-19 Privé/12 Gezondheid",
        "20-29 Werk",
        "20-29 Werk/21 Projecten",
        "20-29 Werk/22 Vergaderingen",
      ],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault is georganiseerd volgens Johnny.Decimal: maximaal tien gebieden (10-19, 20-29, …), per gebied maximaal tien categorieën (11, 12, …) — en elke notitie krijgt een ID zoals 11.01.",
            [
              { name: "00-09 Systeem", description: "Beheer van het systeem zelf — index en afspraken." },
              { name: "10-19 Privé", description: "Voorbeeldgebied voor persoonlijke onderwerpen." },
              { name: "20-29 Werk", description: "Voorbeeldgebied voor werkgerelateerde onderwerpen." },
            ],
            "Hernoem gebieden en categorieën naar je eigen onderwerpen — de bewust beperkte diepte (gebied → categorie → ID) is de kern van de methode."
          ),
        },
        {
          path: "00-09 Systeem/00 Index/00.00 Index.md",
          description: "De Johnny.Decimal-index: alle nummers op één plek.",
          body: "# 00.00 Index\n\nHoud hier de lijst bij van alle gebieden, categorieën en ID's. Wie een nummer zoekt, kijkt hier eerst.\n\n## 10-19 Privé\n\n- 11 Financiën\n- 12 Gezondheid\n\n## 20-29 Werk\n\n- 21 Projecten\n- 22 Vergaderingen\n",
        },
      ],
    },
    buildGtd(GTD_STRINGS_NL),
    {
      id: "journal",
      name: "Journal",
      description: "Dagelijkse notities met een kant-en-klaar sjabloon en een journaal-database — dagnotities zijn meteen ingericht.",
      folders: ["Journal", "Sjablonen"],
      bases: [
        defineBase({
          path: "Journal.base",
          sourceFolder: "Journal",
          columns: [
            { key: "datum", input: "date" },
            { key: "stemming", input: "select", options: ["Goed", "Neutraal", "Slecht", "Productief", "Moe"] },
            { key: "trefwoorden", input: "tags" },
          ],
          views: [
            { name: "Tabel", type: "table", sort: [{ property: "datum", direction: "DESC" }] },
            { name: "Kalender", type: "calendar", dateField: "datum" },
          ],
        }),
      ],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault is gemaakt voor dagelijks schrijven: dagelijkse notities komen in de map Journal en worden aangemaakt vanuit het sjabloon in de map Sjablonen.",
            [
              { name: "Journal", description: "Je dagelijkse notities, één per dag." },
              { name: "Sjablonen", description: "Sjablonen voor nieuwe notities — het sjabloon voor de dagnotitie is al ingesteld." },
            ],
            "Open de kalender in de rechterzijbalk en klik op een dag om je eerste dagnotitie aan te maken. Journal.base laat je items zien als tabel en op een kalender — met datum, stemming en trefwoorden."
          ),
        },
        {
          path: "Sjablonen/Dagnotitie.md",
          description: "Sjabloon voor nieuwe dagelijkse notities — {{date}}, {{time}} en {{title}} worden vervangen.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { datum: "{{date}}" },
          body: "# {{title}}\n\n## Notities\n\n## Taken\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Journal", templateFolder: "Sjablonen", dailyNoteTemplate: "Dagnotitie.md" },
    },
  ];
}
