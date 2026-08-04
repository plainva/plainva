# Importeren uit een andere app

Laatst bijgewerkt: 2026-07-28

Plainva kan notities overnemen uit andere notitie-apps. De import schrijft altijd naar de vault die je op dat moment hebt geopend, in een submap die je zelf benoemt — zo raakt hij de rest van je vault nooit aan, en kun je de geïmporteerde map achteraf verplaatsen of verwijderen als elke andere map.

**Importeren werkt op beide apparaten.** De desktop biedt alle bronnen; op de telefoon vind je het onder **Instellingen → Onderhoud → Importeren uit een andere app**. Daar schrijft het altijd in een submap van de geopende vault — bronnen die een account bij een dienst nodig hebben (Notion via de API bijvoorbeeld) blijven voorbehouden aan de desktop.

## Import starten

Drie manieren:

- **Startscherm** → **Importeren uit een andere app** — de manier als je nog geen vault hebt, wat de normale situatie is wanneer je van app wisselt.
- **Opdrachtenpalet** (`Mod+P`) → **Importeren uit een andere app...**
- **Rechtsklik op een map** in de bestandsboom → **Importeren uit een andere app...**

De eerste stap vraagt om je export — **Bestanden kiezen...** of **Map kiezen...**, wat je ook hebt. Daarna noemt de wizard de app die hij herkend heeft, en bepaal je zelf waar de import naartoe schrijft. Er volgt een voorbeeld met de cijfers van de uitvoering, de grenzen van deze import en de schakelaars voor de bron. Er wordt pas iets geschreven zodra je op **Import starten** klikt.

**Je hoeft niet te weten welke optie bij je export past.** Kies de bestanden, en Plainva herkent de bron — een Notion-export aan de lange ID's in zijn paden, een Logseq-graph aan zijn mappen `journals/` en `pages/`, een Keep- of Simplenote-export aan de inhoud van de JSON. De wizard laat zien wat hij herkend heeft; als hij het mis had, wijzig je het in de lijst hierboven en blijft je keuze staan.

## Waar de import naartoe schrijft

Precies een van de twee per import — nooit beide:

- **Nieuwe vault**: je kiest een lege map, Plainva maakt daarin een nieuwe vault aan en importeert daarnaartoe. Niets van wat je al hebt kan worden aangeraakt, en de hele import ongedaan maken betekent die map verwijderen. Dit is de juiste keuze als je Plainva uitprobeert.
- **Submap van de geopende vault**: alles komt terecht in één nieuw aangemaakte submap die je benoemt. De rest van je vault blijft onaangeroerd.

De doelregel onder de keuze noemt altijd de exacte map, zodat waar dingen terechtkomen nooit gissen is.

## Opties voor deze import

Het voorbeeld toont, onder de cijfers, de schakelaars **die bij de herkende bron passen** — elke bron brengt zijn eigen schakelaars mee, en wat een bron niet kan, verschijnt daar ook nooit. Ze staan daar en niet eerder, omdat de vragen pas zin hebben zodra je ziet wat eraan komt; een schakelaar die de cijfers verandert, laat ze meteen opnieuw tellen.

- **Datums van de bron overnemen** (aan) — geïmporteerde notities behouden de aanmaak- en wijzigingsdatum van de bron. Zonder deze optie krijgt alles de datum van vandaag.
- **Ook verwijderde notities importeren** (uit) — voor Google Keep en Simplenote, waarvan de export de prullenbak meelevert. Standaard blijft liggen wat daar ligt; het rapport noemt het bij naam.

## Wat het voorbeeld laat zien

Het voorbeeld is het laatste station voordat er iets wordt geschreven, en het noemt alles wat anders achteraf een verrassing zou zijn:

- de cijfers van de uitvoering — notities en databases, plus **bijlagen** en **checklists**, voor zover de bron die heeft,
- de exacte doelmap,
- wat deze import **niet** kan meenemen, en, apart vermeld, wat er in het archief werd overgeslagen,
- bij een vault met een cloudverbinding de melding dat de geïmporteerde notities daarna worden **geüpload**,
- bij zeer grote bronnen de melding dat de zoekindex en de eerste synchronisatie daarna even zullen duren.

## Een uitvoering stoppen

Een grote werkruimte kan even duren, dus een import kan worden gestopt: **Import stoppen** tijdens de uitvoering. Wat al in de vault is aangekomen, blijft daar staan, en het rapport beschrijft het — een gedeeltelijke import is geen kapotte import. Net als bij een voltooide import is de map het ongedaan maken.

## Wat je kunt importeren

| Bron | Wat je selecteert | Wat wordt overgenomen |
|---|---|---|
| **Notion (API)** | Een integratietoken | Pagina's, mapstructuur, databases met rijen, relaties, 21 eigenschapstypen |
| **Notion (ZIP-export)** | Het ZIP-bestand of de uitgepakte map | Pagina’s en mapstructuur; een database krijgt zijn kolommen en rijwaarden uit de CSV ernaast |
| **Evernote (ENEX)** | Een of meer `.enex`-bestanden | Notities, tags, checklists (aangevinkt en niet aangevinkt), aanmaakdatum en wijzigingsdatum |
| **Google Keep (Takeout)** | Het Takeout-ZIP of de `.json`-bestanden | Notities, checklists, labels als tags, kleur in de notitiekop, vastgezette notities als prikbord |
| **Simplenote** | Het geëxporteerde `.json`-bestand | Actieve notities en hun tags |
| **Logseq** | Je graph-map | De bestanden, ongewijzigd gekopieerd |
| **Joplin** | De map of ZIP van de Markdown-export | Notities met hun notitieboeken, frontmatter, tags en bronnen |
| **Bear (TextBundle)** | De geëxporteerde `.textbundle`-mappen | Notities met hun afbeeldingen |
| **Notesnook** | De Markdown-export | Notities en hun notitieboekmappen; een notitie in twee notitieboeken wordt één keer geïmporteerd |
| **Capacities** | De map of ZIP van de export | Notities met hun eigenschappen als frontmatter, plus media |
| **Amplenote** | De ZIP van de export | Notities met hun frontmatter en afbeeldingen |
| **Supernotes** | De Markdown-export | Kaarten als Markdown, met de metadatabestanden ernaast |
| **Heptabase** | De Markdown-export | Kaarten met hun frontmatter; de whiteboard-indeling komt niet mee |
| **UpNote** | De Markdown-export | Notities met hun notitieboeken en bijlagen |
| **Craft** | De Markdown-export | Documenten met hun assets |
| **Anytype** | De Markdown-export | Objecten met hun relaties als frontmatter |
| **Standard Notes** | De ontsleutelde JSON-back-up | Notities met hun titels en tags |
| **Workflowy / Dynalist** | De OPML-export | Eén notitie per item op het hoogste niveau, de kinderen als geneste lijsten |
| **Trilium** | De subtree-export | De notitieboom en zijn bijlagen; HTML-notities worden Markdown |
| **Roam Research** | De JSON-export | Pagina’s als notities, outlines als geneste lijsten; blokverwijzingen worden de tekst waarnaar ze verwezen |
| **Reflect** | De Markdown-export | Notities met hun wiki-links en dagnotities |
| **TiddlyWiki** | De JSON-export | Tiddlers als notities met hun tags en datums; WikiText blijft zoals geschreven |
| **Tana** | Een Tana Paste-tekst | Elk knooppunt op het hoogste niveau wordt een notitie, de onderliggende blijven opsommingstekens |
| **RemNote** | De Markdown-export | Documenten met hun geneste rems |
| **HTML-map / ZIP** | Een map, bestanden of een ZIP met HTML-pagina’s | De pagina’s als Markdown-notities, met de links ertussen omgeleid |
| **Markdown-map / ZIP** | Een map, bestanden of een ZIP | De `.md`-bestanden en hun mapstructuur |

**Obsidian** staat ook in de lijst, maar start geen import — en heeft er ook geen nodig. Plainva werkt met dezelfde Markdown-bestanden: het item legt dat uit en biedt je **Vault openen** aan. Wiki-links, tags, frontmatter en `.base`-bestanden blijven werken, en je vault blijft bruikbaar in Obsidian. Eerlijk gezegd: er is geen plugin-ecosysteem, geen Canvas en geen Dataview — daarvoor in de plaats krijg je filters in `.base`, en plugin-syntax in je notities blijft daar gewoon als platte tekst staan.

## Waarom ontbreekt mijn app?

Sommige apps staan niet in de lijst, en de reden is telkens een andere — dat is van belang, want twee ervan ontbreken alleen voorlopig.

- **OneNote** — er is geen bulkexport die iets bruikbaars oplevert. De weg zou lopen via Microsofts Graph-API met een gedelegeerde aanmelding: één aanroep per pagina, nog een voor elke afbeelding, plus de beslissing hoe een vrij invulbaar canvas ooit Markdown wordt. Het staat genoteerd als toekomstig project, niet als uitgesloten — de API zelf is vrij beschikbaar.
- **Apple Notes** — ook Apple biedt geen bulkexport, en de notities lezen betekent een SQLite-database terugontwikkelen, en dat alleen onder macOS. Gevestigde exporttools doen dat al. Exporteer met een daarvan naar Markdown en breng de map daarna binnen via **Markdown-map / ZIP**.
- **Zoho Notebook**, **Turtl**, **Nimbus/FuseBase** — geen gedocumenteerde export om vanuit te importeren.
- **Confluence** — de API levert Confluences eigen storage-formaat, een XHTML-dialect rond macro’s dat een eigen omzetter zou vragen; en het is een teamwiki, geen persoonlijke verzameling. De weg naar binnen is vandaag de ruimte-export: exporteer de ruimte als **HTML** en haal de map binnen via **HTML-map / ZIP**. De links tussen de geëxporteerde pagina’s blijven werken.

Voor alles wat niet in de lijst staat, is de weg hetzelfde: als je app Markdown-bestanden kan schrijven, neemt het item **Markdown-map / ZIP** ze aan, en hun mapstructuur komt mee.

## Notion in detail

Notion is de enige bron waarbij de twee wegen sterk verschillen.

**Met een integratietoken (aanbevolen).** Maak een token aan op `notion.so/my-integrations` — de wizard noemt de drie stappen en opent de pagina voor je. Open daarna elke Notion-pagina die je wilt importeren, kies rechtsboven **"..."** → **Verbindingen**, en voeg je integratie toe — Notion geeft alleen pagina's vrij die je uitdrukkelijk hebt verbonden.

**Plainva bewaart het token niet.** Het geldt voor die ene keer en is daarna weg; er ontstaat geen gekoppeld account. Voor de volgende import plak je het opnieuw.

Via de API ziet Plainva de structuur, niet alleen de tekst:

- De paginahiërarchie wordt een mapstructuur.
- Elke database wordt een `.base`-bestand plus een map met **één notitie per rij**.
- **Relaties worden wiki-links** tussen die notities, in beide richtingen.
- 21 eigenschapstypen worden overgenomen — selectie, status, multiselectie, datum, getal, selectievakje, URL, e-mail, telefoon, formule, rollup, relatie, personen, unieke ID en meer.
- Tabel-, bord-, kalender- en lijstweergaven worden gegenereerd uit het databaseschema.
- Databases die in een pagina zijn ingesloten, worden live `![[Database.base]]`-embeds.

**Vanuit een ZIP-export.** Dit werkt offline en heeft geen token nodig, maar Notions export bevat geen databaseschema en geen pagina-ID's. Pagina's en hun mappen komen over, en **links tussen de geïmporteerde pagina's blijven werken** — Notion schrijft ze met een lang ID in elk padsegment, en Plainva wijst ze naar de notities die daadwerkelijk zijn geschreven. De `.csv` naast elke databasemap wordt gelezen voor wat de pagina’s zelf niet dragen: de kolommen, hun types en de waarden van elke rij als frontmatter. Rijen waarvoor de export geen pagina heeft, worden als notities geschreven. Koppelen gebeurt op titel — de API-route is die met echte ID’s en blijft de betere keuze voor een werkruimte die op relaties is gebouwd.

## Wat imports niet kunnen meenemen

Elke importer noemt zijn grenzen in het voorbeeld en nogmaals in het rapport. De belangrijkste:

- **Bijlagen komen mee.** Uit een ZIP of map behouden ze de plek die ze in de export hadden, zodat een relatieve afbeeldingslink in een notitie blijft werken. Uit Notion via de API worden ze tijdens de import gedownload — Notion ondertekent die links en ze verlopen binnen een uur — en belanden in een map `Attachments`; afbeeldingen die een pagina ergens anders van het web haalt, blijven links. Twee uitzonderingen blijven in je export en worden een voor een in het rapport genoemd: bijlagen binnen een Evernote-`.enex` en Google Keep-afbeeldingen.
- **Sommige onderdelen van het archief worden bewust overgeslagen:** zeer grote bestanden, symbolische links en onderdelen met een onveilig pad. Ze verschijnen met een reden in het voorbeeld, voordat je de import start.
- **Zeer lange Notion-pagina's** worden volledig gelezen, maar inhoud genest in toggles, kolommen of sublijsten wordt niet meegenomen.
- **Logseq-bestanden worden ongewijzigd gekopieerd** — `key:: value`-eigenschappen en blokverwijzingen worden niet omgezet naar Plainva-eigenschappen of -links.
- **Verwijderde notities blijven verwijderd.** De prullenbak van Simplenote en Google Keep wordt overgeslagen — je hebt ooit besloten om die notities los te laten, en een import moet ze niet stilletjes teruggeven. Ze worden met naam genoemd in het rapport, zodat je ziet wat is achtergebleven.
- **Notion-ZIP-exports** koppelen rijen aan pagina’s op titel (zie hierboven) en nemen geen relaties tussen databases mee.
- **HTML-tabellen en codeblokken verliezen hun structuur.** De omzetting leest koppen, lijsten, opmaak, links en afbeeldingen; een tabel wordt de tekst van haar cellen. Elke pagina waar dat gebeurde staat in het rapport.

## Datums worden ook overgenomen

Een collectie die jarenlang is gegroeid, verliest zijn tijdlijn als na een import alles van vandaag lijkt te dateren. Plainva neemt daarom de datums van de bron over:

- Ze komen terecht als `created` en `updated` in de frontmatter van de geïmporteerde notitie — dat is ook waar de tijdlijn van de graaf ze leest.
- Het bestand zelf krijgt ook de wijzigingsdatum van de bron, zodat sorteren op datum en **Onlangs geopend** kloppen. De aanmaakdatum van een bestand kan alleen onder Windows worden ingesteld; op de andere systemen is de frontmatter de drager.
- Als een bron geen datums meelevert, gebruikt Plainva de datum van het exportbestand. Er wordt nooit een verzonnen: zonder enig aanknopingspunt blijft het veld leeg.

## Eén mislukking beëindigt niet de hele import

Als één notitie niet kan worden geschreven, gaat de import gewoon door en staat ze met de reden in het rapport. Het rapport wordt geschreven, ook als de uitvoering vroegtijdig stopt — zo zie je altijd wat er al in je vault staat.

## Er wordt niets overschreven

De import schrijft naar de geopende vault en is daarom bewust niet-destructief opgezet:

- Als een notitienaam al bezet is, krijgt de geïmporteerde notitie een **nummer** (`Meeting (2).md`) in plaats van de bestaande te vervangen. Dit geldt ook wanneer twee bronnotities dezelfde naam delen.
- Geïmporteerde notities krijgen de gebruikelijke OKF-frontmatter (`type`, `okf_version`), zodat ze zich in `.base`-filters en -weergaven gedragen als elke andere Plainva-notitie.
- Buiten de doelsubmap wordt niets aangepast.

Als je de import liever helemaal apart wilt houden, maak dan eerst een nieuwe vault aan (**Nieuwe vault** op het startscherm) en importeer daarin.

## Het importrapport

Elke uitvoering schrijft een **importrapport** naar de doelmap. Het vermeldt:

- hoeveel notities en databases zijn geïmporteerd,
- wat deze importer helemaal niet kan meenemen,
- alles wat **onvolledig** aankwam of werd **overgeslagen**, met de reden,
- en elk bestand, met zijn status.

Het rapport is het eerlijke verslag van de uitvoering — als iets is afgekapt of weggelaten, staat het daar, in plaats van stilzwijgend als geslaagd te worden geteld. De moeite waard om te lezen voordat je de export verwijdert.

Helemaal onderaan staat hoe je de import **ongedaan maakt**: alles uit één uitvoering staat in één enkele map — verwijder je die, dan is de import weg. Bij de bestemming **Nieuwe vault** is dat de map van de nieuwe vault zelf. Daarvoor is geen apart ongedaan-maken-commando nodig. Het rapport zelf is een gewone notitie en mag worden verwijderd zodra je het hebt gelezen.

## Zie ook

- [Databases (.base)](Databases_Base.md) — wat er gebeurt met geïmporteerde Notion-databases
- [OKF](OKF.md) — de frontmatter die geïmporteerde notities krijgen
- [Aan de slag](Getting_Started.md) — een aparte vault aanmaken voor een import
