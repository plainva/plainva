import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

/** Dutch template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    {
      id: "para",
      name: "PARA",
      description: "Projecten, Domeinen, Bronnen, Archief — gesorteerd naar actiegerichtheid (Tiago Forte).",
      folders: ["Projecten", "Taken", "Domeinen", "Bronnen", "Archief", "Sjablonen"],
      bases: [
        defineBase({
          path: "Projecten.base",
          sourceFolder: "Projecten",
          columns: [
            { key: "status", input: "status", options: ["Gepland", "Actief", "Wachtend", "Afgerond"] },
            { key: "domein", input: "relation", relationBase: "Domeinen.base", relationLimit: "one" },
            { key: "deadline", input: "date" },
            { key: "taken", reverseOf: { base: "Taken.base", property: "project" } },
          ],
          views: [
            { name: "Tabel", type: "table" },
            { name: "Op status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Sjablonen/Project.md",
        }),
        defineBase({
          path: "Taken.base",
          sourceFolder: "Taken",
          columns: [
            { key: "status", input: "status", options: ["Open", "Bezig", "Afgerond"] },
            { key: "project", input: "relation", relationBase: "Projecten.base", relationLimit: "one" },
            { key: "deadline", input: "date" },
          ],
          views: [
            { name: "Tabel", type: "table" },
            { name: "Op status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Sjablonen/Taak.md",
        }),
        defineBase({
          path: "Domeinen.base",
          sourceFolder: "Domeinen",
          columns: [{ key: "projecten", reverseOf: { base: "Projecten.base", property: "domein" } }],
          views: [{ name: "Tabel", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault is georganiseerd volgens de PARA-methode (Tiago Forte): inhoud wordt gesorteerd naar actiegerichtheid, niet naar onderwerp.",
            [
              { name: "Projecten", description: "Initiatieven met een duidelijk doel en einddatum (Projecten.base)." },
              { name: "Taken", description: "Losse volgende stappen — elke taak verwijst naar haar project (Taken.base)." },
              { name: "Domeinen", description: "Blijvende verantwoordelijkheidsgebieden zonder einddatum." },
              { name: "Bronnen", description: "Onderwerpen, materiaal en naslagwerk om te bewaren." },
              { name: "Archief", description: "Afgerond of inactief materiaal uit de andere mappen." },
            ],
            "Open de databases Projecten.base, Taken.base en Domeinen.base om projecten op status te zien, er taken aan toe te wijzen en ze aan hun domeinen te koppelen — afgeronde zaken verhuizen naar Archief, terwijl links en de index.md-overzichten automatisch worden bijgehouden."
          ),
        },
        {
          path: "Projecten/Voorbeeldproject.md",
          description: "Een voorbeeld van een projectnotitie.",
          properties: { status: "Actief", domein: "[[Voorbeelddomein]]" },
          body: "# Voorbeeldproject\n\nEen project heeft een duidelijk doel en een voorzienbaar einde. Leg hier het doel, de volgende stappen en de resultaten vast.\n\n- [ ] Doel van het project noteren\n- [ ] Volgende stap bepalen\n",
        },
        {
          path: "Taken/Voorbeeldtaak.md",
          description: "Een voorbeeld van een taak gekoppeld aan haar project.",
          properties: { status: "Open", project: "[[Voorbeeldproject]]" },
          body: "# Voorbeeldtaak\n\nEen taak is één enkele, concrete volgende stap. Via de eigenschap Project hoort ze bij het Voorbeeldproject.\n",
        },
        {
          path: "Domeinen/Voorbeelddomein.md",
          description: "Een voorbeeld van een verantwoordelijkheidsgebied.",
          body: "# Voorbeelddomein\n\nEen domein is een blijvende verantwoordelijkheid zonder einddatum — bijvoorbeeld „Gezondheid” of „Financiën”. Projecten worden er via de eigenschap Domein aan gekoppeld.\n",
        },
        {
          path: "Sjablonen/Project.md",
          properties: { status: "Gepland" },
          body: "# {{title}}\n\n## Doel\n\n## Volgende stappen\n\n- [ ] \n",
        },
        {
          path: "Sjablonen/Taak.md",
          properties: { status: "Open" },
          body: "# {{title}}\n\n## Notities\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Sjablonen" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Eén idee per notitie, dicht gelinkt — vluchtige, literatuur- en permanente notities (Luhmann).",
      folders: ["Vluchtige notities", "Literatuurnotities", "Permanente notities", "Sjablonen"],
      bases: [
        defineBase({
          path: "Literatuur.base",
          sourceFolder: "Literatuurnotities",
          columns: [
            { key: "auteur", input: "text" },
            { key: "jaar", input: "number" },
            { key: "soort", input: "select", options: ["Boek", "Artikel", "Video", "Podcast", "Website"] },
            { key: "status", input: "status", options: ["Te lezen", "Gelezen", "Verwerkt"] },
            { key: "url", input: "url" },
            { key: "notities", reverseOf: { base: "Notities.base", property: "bron" } },
          ],
          views: [
            { name: "Tabel", type: "table" },
            { name: "Op status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Sjablonen/Literatuurnotitie.md",
        }),
        defineBase({
          path: "Notities.base",
          sourceFolder: "Permanente notities",
          columns: [{ key: "bron", input: "relation", relationBase: "Literatuur.base" }],
          views: [{ name: "Tabel", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault volgt de Zettelkasten-methode (Niklas Luhmann): één idee per notitie — verbanden ontstaan via links, niet via mapstructuren.",
            [
              { name: "Vluchtige notities", description: "Snelle, ruwe gedachten — kortstondig, worden later verwerkt." },
              { name: "Literatuurnotities", description: "Samenvattingen van wat je gelezen hebt, in je eigen woorden, met bron." },
              { name: "Permanente notities", description: "Uitgewerkte, blijvende ideeën — één per notitie, sterk gelinkt." },
            ],
            "Gebruik Literatuur.base om je bronnen op leesstatus bij te houden; Notities.base koppelt permanente notities via de eigenschap Bron aan de literatuur waar ze vandaan komen."
          ),
        },
        {
          path: "Permanente notities/Voorbeeldnotitie.md",
          description: "Een voorbeeld van een permanente notitie.",
          properties: { bron: ["[[Voorbeeld-literatuurnotitie]]"] },
          body: "# Voorbeeldnotitie\n\nEen permanente notitie bevat precies één idee, uitgeschreven in volledige zinnen en in je eigen woorden.\n\nLink verwante notities rechtstreeks in de tekst — zo groeit het netwerk van ideeën.\n",
        },
        {
          path: "Literatuurnotities/Voorbeeld-literatuurnotitie.md",
          description: "Een voorbeeld van een literatuurnotitie.",
          properties: { auteur: "Niklas Luhmann", jaar: 1992, soort: "Boek", status: "Gelezen" },
          body: "# Voorbeeld-literatuurnotitie\n\nVat in je eigen woorden samen wat je gelezen hebt en leg de bron vast. Permanente notities verwijzen via de eigenschap Bron terug naar deze literatuurnotitie.\n",
        },
        {
          path: "Sjablonen/Literatuurnotitie.md",
          properties: { status: "Te lezen" },
          body: "# {{title}}\n\n## Samenvatting\n\n## Bron\n",
        },
      ],
      settings: { templateFolder: "Sjablonen" },
    },
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
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — inbox, taken, projecten, referentie en ooit/misschien-lijst.",
      folders: ["Inbox", "Taken", "Projecten", "Referentie", "Ooit misschien", "Sjablonen"],
      bases: [
        defineBase({
          path: "Taken.base",
          sourceFolder: "Taken",
          columns: [
            { key: "status", input: "status", options: ["Inbox", "Volgende", "Wachtend", "Ooit", "Afgerond"] },
            { key: "context", input: "select", options: ["@Thuis", "@Werk", "@Onderweg", "@Telefoon"] },
            { key: "project", input: "relation", relationBase: "Projecten.base", relationLimit: "one" },
            { key: "deadline", input: "date" },
          ],
          views: [
            { name: "Tabel", type: "table" },
            { name: "Op status", type: "board", groupBy: "status" },
            { name: "Op context", type: "board", groupBy: "context" },
          ],
          newItemTemplate: "Sjablonen/Taak.md",
        }),
        defineBase({
          path: "Projecten.base",
          sourceFolder: "Projecten",
          columns: [
            { key: "status", input: "status", options: ["Actief", "Wachtend", "Ooit", "Afgerond"] },
            { key: "taken", reverseOf: { base: "Taken.base", property: "project" } },
          ],
          views: [
            { name: "Tabel", type: "table" },
            { name: "Op status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Sjablonen/Project.md",
        }),
      ],
      notes: [
        {
          path: "Welkom.md",
          description: "Startpunt en korte handleiding voor deze vault.",
          body: welcomeBody(
            "Welkom",
            "Deze vault volgt Getting Things Done (David Allen): alles komt eerst in de inbox terecht en wordt van daaruit tot concrete taken en projecten verwerkt.",
            [
              { name: "Inbox", description: "Verzamelpunt voor alles wat binnenkomt — regelmatig leegmaken." },
              { name: "Taken", description: "Losse volgende acties — georganiseerd op status en context (Taken.base)." },
              { name: "Projecten", description: "Alles wat meer dan één stap vraagt (Projecten.base)." },
              { name: "Referentie", description: "Naslagmateriaal zonder actie nodig." },
              { name: "Ooit misschien", description: "Ideeën en projecten voor later." },
            ],
            "In Taken.base koppel je elke taak via de eigenschap Project aan een project; Projecten.base laat vervolgens in de kolom Taken automatisch zien wat bij elk project hoort. De wekelijkse review houdt het systeem betrouwbaar."
          ),
        },
        {
          path: "Wekelijkse review.md",
          description: "Checklist voor de wekelijkse GTD-review.",
          body: "# Wekelijkse review\n\n- [ ] Inbox tot nul terugbrengen\n- [ ] Projectenlijst doorlopen en volgende acties controleren\n- [ ] Ooit misschien-lijst doornemen\n- [ ] Agenda van de komende twee weken bekijken\n",
        },
        {
          path: "Projecten/Voorbeeldproject.md",
          description: "Een voorbeeld van een GTD-projectnotitie.",
          properties: { status: "Actief" },
          body: "# Voorbeeldproject\n\nGewenst resultaat: hoe ziet „klaar” eruit?\n\nVolgende actie:\n\n- [ ] De ene, concrete volgende stap noteren\n",
        },
        {
          path: "Taken/Voorbeeldtaak.md",
          description: "Een voorbeeld van een taak gekoppeld aan een project.",
          properties: { status: "Volgende", context: "@Werk", project: "[[Voorbeeldproject]]" },
          body: "# Voorbeeldtaak\n\nEen taak is één enkele, concrete volgende actie. Via de eigenschap Project hoort ze bij het Voorbeeldproject.\n",
        },
        {
          path: "Taken/Ideeën verzamelen.md",
          description: "Een voorbeeld van een vers inbox-item.",
          properties: { status: "Inbox" },
          body: "# Ideeën verzamelen\n\nNet in de inbox beland en nog niet verwerkt. Bij de volgende review krijgt deze taak een context en een project.\n",
        },
        {
          path: "Sjablonen/Taak.md",
          properties: { status: "Inbox" },
          body: "# {{title}}\n\n## Notities\n\n- [ ] \n",
        },
        {
          path: "Sjablonen/Project.md",
          properties: { status: "Actief" },
          body: "# {{title}}\n\n## Gewenst resultaat\n\n## Volgende stappen\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Sjablonen" },
    },
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
