# Importeren uit een andere app

Laatst bijgewerkt: 2026-07-28

Plainva kan notities overnemen uit andere notitie-apps. De import schrijft altijd naar de vault die je op dat moment hebt geopend, in een submap die je zelf benoemt — zo raakt hij de rest van je vault nooit aan, en kun je de geïmporteerde map achteraf verplaatsen of verwijderen als elke andere map.

**Importeren gebeurt op de desktop.** De mobiele app kan niet importeren: haal de notities op de desktop binnen, dan komen ze via de synchronisatie op je telefoon terecht, net als elk ander bestand.

## Import starten

Drie manieren:

- **Startscherm** → **Importeren uit een andere app** — de manier als je nog geen vault hebt, wat de normale situatie is wanneer je van app wisselt.
- **Opdrachtenpalet** (`Mod+P`) → **Importeren uit een andere app...**
- **Rechtsklik op een map** in de bestandsboom → **Importeren uit een andere app...**

De wizard heeft drie stappen: kies de app waar je vandaan komt, kies de exportbestanden (of voer een Notion-token in), en kies waar de import naartoe schrijft. Daarna krijg je een voorbeeld met de cijfers van de uitvoering en een lijst van alles wat de importer niet kan meenemen. Er wordt pas iets geschreven zodra je op **Import starten** klikt.

**Je hoeft niet te weten welke optie bij je export past.** Kies de bestanden, en Plainva herkent de bron — een Notion-export aan de lange ID's in zijn paden, een Logseq-graph aan zijn mappen `journals/` en `pages/`, een Keep- of Simplenote-export aan de inhoud van de JSON. De wizard laat zien wat hij herkend heeft; als hij het mis had, wijzig je het in de lijst hierboven en blijft je keuze staan.

## Waar de import naartoe schrijft

Precies een van de twee per import — nooit beide:

- **Nieuwe vault**: je kiest een lege map, Plainva maakt daarin een nieuwe vault aan en importeert daarnaartoe. Niets van wat je al hebt kan worden aangeraakt, en de hele import ongedaan maken betekent die map verwijderen. Dit is de juiste keuze als je Plainva uitprobeert.
- **Submap van de geopende vault**: alles komt terecht in één nieuw aangemaakte submap die je benoemt. De rest van je vault blijft onaangeroerd.

De doelregel onder de keuze noemt altijd de exacte map, zodat waar dingen terechtkomen nooit gissen is.

## Opties voor deze import

Onder de bestandsselectie staan de schakelaars **die bij de gekozen bron passen** — elke bron brengt zijn eigen schakelaars mee, en wat een bron niet kan, verschijnt daar ook nooit:

- **Datums van de bron overnemen** (aan) — geïmporteerde notities krijgen de aanmaak- en wijzigingsdatum van de bron. Zet je dit uit, dan krijgt alles de datum van vandaag.
- **Ook verwijderde notities importeren** (uit) — voor Google Keep en Simplenote, waarvan de export de prullenbak meelevert. Uit betekent: verwijderde notities blijven achter en worden met naam genoemd in het rapport.

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
| **Notion (ZIP-export)** | Het ZIP-bestand of de uitgepakte map | Pagina's en mapstructuur. Databases worden **leeg** aangemaakt |
| **Evernote (ENEX)** | Een of meer `.enex`-bestanden | Notities, tags, checklists (aangevinkt en niet aangevinkt), aanmaakdatum en wijzigingsdatum |
| **Google Keep (Takeout)** | Het Takeout-ZIP of de `.json`-bestanden | Notities, checklists, labels als tags, kleur, vastgepind/gearchiveerd |
| **Simplenote** | Het geëxporteerde `.json`-bestand | Actieve notities en hun tags |
| **Logseq** | Je graph-map | De bestanden, ongewijzigd gekopieerd |
| **Markdown-map / ZIP** | Een map, bestanden of een ZIP | De `.md`-bestanden en hun mapstructuur |

**Obsidian** staat ook in de lijst, maar start geen import — en heeft er ook geen nodig. Plainva werkt met dezelfde Markdown-bestanden: het item legt dat uit en biedt je **Vault openen** aan. Wiki-links, tags, frontmatter en `.base`-bestanden blijven werken, en je vault blijft bruikbaar in Obsidian. Eerlijk gezegd: er is geen plugin-ecosysteem, geen Canvas en geen Dataview — daarvoor in de plaats krijg je filters in `.base`, en plugin-syntax in je notities blijft daar gewoon als platte tekst staan.

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

**Vanuit een ZIP-export.** Dit werkt offline en heeft geen token nodig, maar Notions export bevat geen databaseschema en geen pagina-ID's. Pagina's en hun mappen komen over, en **links tussen de geïmporteerde pagina's blijven werken** — Notion schrijft ze met een lang ID in elk padsegment, en Plainva wijst ze naar de notities die daadwerkelijk zijn geschreven. Databases worden aangemaakt als **lege** `.base`-bestanden, en het rapport vermeldt dat. Als je databases belangrijk zijn, gebruik dan de API-weg.

## Wat imports niet kunnen meenemen

Elke importer noemt zijn grenzen in het voorbeeld en nogmaals in het rapport. De belangrijkste:

- **Bijlagen en afbeeldingen worden niet geïmporteerd.** Het rapport vermeldt ze een voor een, zodat je weet wat er in je export achterblijft; Evernote-bijlagen en Keep-afbeeldingen blijven daar ook.
- **Sommige onderdelen van het archief worden bewust overgeslagen:** zeer grote bestanden, symbolische links en onderdelen met een onveilig pad. Ze verschijnen met een reden in het voorbeeld, voordat je de import start.
- **Zeer lange Notion-pagina's** worden volledig gelezen, maar inhoud genest in toggles, kolommen of sublijsten wordt niet meegenomen.
- **Logseq-bestanden worden ongewijzigd gekopieerd** — `key:: value`-eigenschappen en blokverwijzingen worden niet omgezet naar Plainva-eigenschappen of -links.
- **Verwijderde notities blijven verwijderd.** De prullenbak van Simplenote en Google Keep wordt overgeslagen — je hebt ooit besloten om die notities los te laten, en een import moet ze niet stilletjes teruggeven. Ze worden met naam genoemd in het rapport, zodat je ziet wat is achtergebleven.
- **Notion-ZIP-exports** maken lege databases aan (zie hierboven).

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
