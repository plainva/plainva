# Database-referentie (.base)

Laatst bijgewerkt: 2026-11-03

Deze pagina somt op wat een `.base`-bestand allemaal kan bevatten en wat Plainva met elk onderdeel doet: elke sleutel op het hoogste niveau, elke filtervorm, elk weergavetype met zijn opties, samenvattingen, sortering, beperkingen, wat er gebeurt met sleutels die Plainva niet kent, en waar Plainva zich anders gedraagt dan Obsidian Bases. De pagina beschrijft wat de code van Plainva vandaag leest, evalueert en schrijft — niet de documentatie van Obsidian.

Lees voor dagelijks gebruik eerst [Databases (.base)](Databases_Base.md). De regels die een tool moet aanhouden wanneer hij vaultbestanden rechtstreeks schrijft, en het volledige relatievoorbeeld, staan in de [Bestandsformaat-referentie](File_Format_Reference.md).

## In één oogopslag

| Onderdeel van het bestand | Wat Plainva doet |
|---|---|
| `filters` | Leest en past de bronnen (map, tag) en de voorwaarden toe die onder [Filters](#filters) staan |
| `views` | Leest alle acht weergavetypen, hun volgorde, sortering, filters en samenvattingen |
| `properties` | Leest het kolomschema, de weergavenaam en het `plainva`-blok van Plainva |
| `summaries` (weergave) | Berekent de veertien ingebouwde samenvattingen |
| `formulas` | Bewaart ze in het bestand, berekent ze niet |
| `summaries` (hoogste niveau) | Bewaart eigen samenvattingsformules, berekent ze niet |
| `this` | Nog niet ondersteund |
| Andere sleutels | Bewaart ze in het bestand (zie [Sleutels die Plainva niet kent](#sleutels-die-plainva-niet-kent)) |

## Sleutels op het hoogste niveau

Een `.base`-bestand is YAML met deze sleutels op het hoogste niveau. Ze zijn allemaal optioneel; een bestand zonder `views` opent met één tabel.

| Sleutel | Inhoud | In Plainva |
|---|---|---|
| `filters` | Welke notities bij de database horen (bronnen) | Gelezen en toegepast |
| `properties` | Eén item per kolom, met de eigenschaps-id als sleutel | Gelezen; de toevoegingen van Plainva staan in zijn `plainva`-blok |
| `views` | De lijst met weergaven | Gelezen; elke weergave heeft een `name` nodig |
| `formulas` | Obsidian-formules, `name: expression` | Ongewijzigd bewaard, niet berekend |
| `summaries` | Eigen samenvattingsformules van Obsidian | Ongewijzigd bewaard, niet berekend |

Plainva schrijft nooit een andere sleutel op het hoogste niveau: Obsidian weigert een `.base` te openen met een sleutel die het niet kent. Een sleutel `columns:` op het hoogste niveau, zoals zeer oude Plainva-versies die schreven, wordt nog steeds gelezen en bij het volgende opslaan van het bestand naar `properties` verplaatst.

## Eigenschappen (`properties`)

### Eigenschaps-id's

Een eigenschaps-id geeft een kolom een naam. Er zijn drie soorten:

| Id | Betekent | Voorbeeld |
|---|---|---|
| `note.<key>` | Een sleutel van de frontmatter van de notities | `note.status` |
| `file.<field>` | Een feit over het bestand (zie [Bestandsvelden](#bestandsvelden-file)) | `file.mtime` |
| `formula.<name>` | Een Obsidian-formule uit `formulas` | `formula.price_per_unit` |

De sleutels van `properties`, de `order` van een weergave en `sort[].property` gebruiken deze id's. In een filteruitdrukking en in een `plainva`-blok wordt een frontmattersleutel kaal geschreven (`status`); een filteruitdrukking begrijpt ook `note.status`.

Schrijft een notitie een sleutel in een andere schrijfwijze dan de kolom (`Due` tegenover de kolom `due`), dan toont Plainva de waarde toch in die kolom en schrijft het wijzigingen terug onder de eigen schrijfwijze van de notitie.

### Weergavenaam

`properties.<id>.displayName` is het kolomlabel van Obsidian. Plainva toont het als kolomkop en bewaart het. Zonder dit label toont een frontmattersleutel een hoofdletter vooraan (alleen op het scherm); de bestandsvelden hebben hun eigen namen, bijvoorbeeld **Naam**, **Gewijzigd**, **Grootte**, **Pad**, **Takenlijst** en **Dag uit de bestandsnaam**.

### Het `plainva`-blok van een kolom

Alles wat Plainva aan een kolom toevoegt, staat onder `properties.<id>.plainva`. Obsidian negeert het.

| Sleutel | Waarde | Betekenis |
|---|---|---|
| `input` | een veldtype (lijst hieronder) | Het veldtype van de kolom |
| `ratingMax` | getal, 1 tot 10 | Uit hoeveel tekens een beoordeling bestaat (standaard 5) |
| `ratingGlyph` | één teken | Het teken dat een beoordeling tekent (standaard een punt) |
| `options` | lijst met opties | Vaste waarden voor selectie, status en multiselectie |
| `relationBase` | `.base`-pad ten opzichte van de vault | De database waarnaar een relatie verwijst |
| `relationLimit` | `one` | Een relatie bevat precies één link; ontbreekt de sleutel, dan is er geen limiet |
| `reverseOf` | `{ base, property }` | Een berekende kolom voor een omgekeerde relatie |
| `rollup` | `{ through, of, fn, where }` | Een berekende aggregatiekolom (zie [Aggregaties](#aggregaties)) |
| `previousKeys` | lijst met maximaal 8 vroegere namen | Laat opmerkingen een hernoemde kolom terugvinden |

### Veldtypen (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Twee oudere schrijfwijzen worden ook gelezen: `multi-select` als `multiselect` en `link` als `relation`. Een kolom zonder `input` — of met een waarde die niet in deze lijst staat — krijgt zijn type uit de waarden in de notities: `true`/`false` is een selectievakje, een getal een getal, een lijst met `[[links]]` een relatie, `2026-07-03` een datum, een webadres een URL, enzovoort. Een kolom voor een omgekeerde relatie en een aggregatiekolom hebben geen `input`.

### Opties en kleuren

Een optie is `{ value, label, color, group }`; alleen `value` is verplicht. `color` is een van de paletnamen `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — een onbekende naam valt terug op een kleur die van de waarde wordt afgeleid. `group` wordt alleen door **Status** gebruikt: opties met dezelfde groep vormen een fase. Een gewone tekenreeks wordt gelezen als een optie met die waarde.

### Aggregaties

Een aggregatiekolom berekent een waarde uit de notities waar een linkkolom van deze database naar verwijst. De waarde staat in geen enkel bestand.

- `through` — een relatie- of omgekeerde-relatiekolom van deze database.
- `of` — een eigenschap van de gelinkte notities; niet nodig voor `count`.
- `fn` — een van `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, verplicht voor `countWhere` en `percentWhere`; `op` is een van `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, en een lege `value` betekent "is leeg".

Een aggregatie waarvan een verplicht onderdeel ontbreekt, of die een functie noemt die niet in deze lijst staat, wordt genegeerd: de kolom blijft leeg en de database opent gewoon. Een aggregatie via een andere berekende kolom blijft ook leeg.

## Bestandsvelden (`file.*`)

Deze waarden komen uit het bestand, niet uit de frontmatter. Elke rij van een database draagt het volgende:

| Veld | Waarde |
|---|---|
| `file.name` | De eigenschap `title` van de notitie als die er is, anders de bestandsnaam zonder `.md` |
| `file.path` | Het pad ten opzichte van de vault |
| `file.mtime` | Laatst gewijzigd, in milliseconden |
| `file.ctime` | Aangemaakt, in milliseconden, als het bestandssysteem dat meldt |
| `file.size` | Grootte in bytes |
| `file.tags` | Alle tags van de notitie, uit frontmatter en tekst, elk met `#`; gevuld wanneer een filter, een prikbord of een weergave die de kolom toont of erop sorteert ze nodig heeft |
| `file.tasks` | Voortgang van de selectievakjes als `done/total`; gevuld voor borden en voor een weergave die de kolom toont |
| `file.day` | De dag waar de bestandsnaam van een dagnotitie voor staat, volgens de map en het formaat van de vault; alleen-lezen, en alleen het datumveld van een kalender of tijdlijn kan het gebruiken |
| `file.revision` | Een interne wijzigingsmarkering; reken er niet op |

`file.folder` werkt als bron (zie [Bronnen](#bronnen)) maar is geen kolom. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` en `file.file` worden niet geleverd: een kolom met een van deze velden blijft leeg, en een filter leest ze als leeg.

## Filters

### Waar filters staan

De `filters` op het hoogste niveau bevatten de **bronnen** — welke notities bij de database horen. Elke weergave kan haar eigen `filters` dragen met voorwaarden die alleen die weergave verder beperken; Plainva schrijft de voorwaarden daar. Beide niveaus gelden samen. Voorwaarden die een bestand op het hoogste niveau bewaart, werken nog steeds; bij het volgende opslaan in Plainva worden ze naar elke weergave verplaatst.

### Bronnen

| Bron | Uitdrukking |
|---|---|
| Map | `file.folder == "Projects/Active"` — de map en al haar submappen; `""` en `"/"` zijn de hele vault |
| Tag | `file.hasTag("project")` — de notitie draagt precies deze tag; een voorafgaande `#` wordt genegeerd |

Meerdere bronnen worden met `and` of `or` gecombineerd, net als elke andere voorwaarde. Een database zonder bronnen bevat elke notitie van de vault. Bijlagen, de gereserveerde `index.md` en `log.md`, en bestanden of mappen waarvan de naam met een punt begint, zijn nooit rijen.

### Voorwaarden

Een voorwaarde is een tekenreeks. Waarden staan tussen dubbele aanhalingstekens; `\"` en `\\` escapen een aanhalingsteken en een backslash. De eigenschap wordt kaal of met `note.` geschreven.

| Voorwaarde | Uitdrukking |
|---|---|
| is | `status == "Done"` |
| is niet | `status != "Done"` |
| bevat | `contains(labels, "urgent")` of `labels.contains("urgent")` |
| bevat niet | `!contains(labels, "urgent")` of `!labels.contains("urgent")` |
| groter dan, kleiner dan | `effort > "3"`, `effort < "8"` |
| minstens, hoogstens | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| is leeg | `status == ""` of `status.isEmpty()` |
| is niet leeg | `status != ""` of `!status.isEmpty()` |
| heeft een tag | `file.tags.contains("#work")`, met `!` ontkend |
| headerkleur, pictogram | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### Hoe waarden worden vergeleken

- **is** en **is niet** vergelijken tekst. Bij een lijst (tags, multiselectie, relatie) betekent **is** "de lijst heeft dit item", **is niet** "ze heeft het niet". Een notitie zonder de eigenschap komt nooit overeen met **is** en altijd met **is niet**.
- **bevat** zoekt de tekst binnen de waarde, of binnen elk item van een lijst. `labels.contains("x")` bij een lijst wil een item dat precies `x` is; bij `file.tags` willen beide vormen de hele tag, dus `#work` komt niet overeen met `#workshop` of `#work/child`.
- **groter dan**, **kleiner dan**, **minstens**, **hoogstens** vergelijken als getallen wanneer beide kanten getallen zijn, anders als tekst — zo staan ISO-datums (`2026-07-03`) in de juiste volgorde. Een notitie zonder waarde komt er nooit mee overeen.
- **is leeg** komt overeen met een ontbrekende eigenschap, een lege waarde en een lege lijst.
- Een selectievakje wordt vergeleken als `"true"` of `"false"`.

### `and`, `or`, `not`

Een `filters`-object heeft op elk niveau precies één van `and`, `or` en `not`; de items zijn voorwaardetekenreeksen of verdere filterobjecten.

| Sleutel | Komt overeen wanneer |
|---|---|
| `and` | elk item overeenkomt |
| `or` | minstens één item overeenkomt |
| `not` | geen enkel item overeenkomt |

Plainva evalueert elke diepte. Het filterpaneel bewerkt één niveau groepen onder **Alle** of **Minstens één** (**Groep toevoegen**); een diepere structuur verschijnt als **Complex filter (niet bewerkbaar)**, blijft in het bestand staan en wordt toegepast — een voorwaarde daarin die Plainva niet kan lezen, wordt eronder als niet toegepast genoemd. Een ouder bestand met `and` en `or` naast elkaar op één niveau wordt gelezen als "alles van `and` en één van `or`" en bij het volgende opslaan in de geldige vorm geschreven.

### Wat Plainva niet kan lezen

Alleen de vormen in de twee tabellen hierboven worden begrepen. Al het andere — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, een getal zonder aanhalingstekens (`price > 2`), `&&` en `||` binnen één tekenreeks, rekenkunde, datumfuncties zoals `now()`, of `this` — blijft in het bestand staan en wordt in het filterpaneel getoond zoals het er staat, met de opmerking **Niet toegepast: Plainva kan deze voorwaarde niet lezen, dus ze filtert niets.** De weergave toont dan meer notities dan hetzelfde filter in Obsidian.

## Formules

Plainva berekent geen Obsidian-formules. `formulas` blijft ongewijzigd in het bestand staan, en een kolom `formula.<name>` in de `order` van een weergave wordt zonder waarden getoond. **Tabel exporteren** → **Formules (.base)** schrijft sommige aggregaties als formules, zodat Obsidian ze kan berekenen (zie [Databases](Databases_Base.md)).

## Weergaven

### Sleutels van elke weergave

| Sleutel | Waarde | In Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | Het weergavetype; zie de volgende tabel |
| `name` | tekst | Verplicht; Plainva geeft een weergave zonder naam er bij het opslaan een |
| `order` | lijst met eigenschaps-id's | De zichtbare kolommen, in deze volgorde |
| `sort` | lijst met `{ property, direction }` | Sorteerregels, `ASC` of `DESC` |
| `filters` | filterobject | De eigen voorwaarden van de weergave |
| `summaries` | map van eigenschaps-id → naam van de samenvatting | De kolomvoet van elke kolom |
| `plainva` | map | De weergaveopties van Plainva, hieronder |

### De acht weergavetypen

Obsidian kent `table`, `list` en `cards`. De andere weergavetypen van Plainva worden opgeslagen als `type: table` plus `plainva.render`, zodat Obsidian ze als tabel toont.

| Weergavetype | `type` op schijf | `plainva.render` |
|---|---|---|
| **Tabel** (`table`) | `table` | — |
| **Lijst** (`list`) | `list` | — |
| **Galerij** (`gallery`) | `cards` | — |
| **Bord** (`board`) | `table` | `board` |
| **Kalender** (`calendar`) | `table` | `calendar` |
| **Tijdlijn** (`timeline`) | `table` | `timeline` |
| **Graaf** (`graph`) | `table` | `graph` |
| **Prikbord** (`pinboard`) | `table` | `pinboard` |

Bord, Kalender, Tijdlijn, Graaf en Prikbord worden alleen als **Weergavetype** aangeboden zolang **Plainva-extensies voor .base-bestanden toestaan** aan staat. Een `type` dat Plainva niet kent, wordt als tabel getoond en blijft zoals het er staat in het bestand totdat je een ander **Weergavetype** kiest.

### Weergaveopties (`views[i].plainva`)

Binnen het `plainva`-blok wordt een eigenschap kaal geschreven (`status`), niet als `note.status`.

| Sleutel | Weergavetypen | Waarde |
|---|---|---|
| `render` | Bord, Kalender, Tijdlijn, Graaf, Prikbord | Het weergavetype, zie hierboven |
| `groupBy` | Bord | De eigenschap waaruit de kolommen bestaan; zonder deze de eigenschap van de eigen `groupBy` van Obsidian voor de weergave |
| `boardLaneBy` | Bord | Een tweede eigenschap voor **Banen op** |
| `boardWipLimits` | Bord | Map van kolomwaarde → maximaal aantal kaarten (**WIP-limiet**), gehele getallen boven 0 |
| `boardColorMode` | Bord | `column` tint de hele kolom; ontbreekt de sleutel, dan alleen de chip in de kop |
| `boardColumnOrder` | Bord | Handmatige kolomvolgorde; `__UNGROUPED__` is de kolom zonder waarde |
| `colorBy` | Bord, Tijdlijn | Kaarten en balken nemen de optiekleur van deze eigenschap over (**Kleur op**) |
| `dateField` | Kalender, Tijdlijn | De startdatum (**Datumveld**, **Startdatum**); een datumeigenschap of `file.day` |
| `endField` | Kalender, Tijdlijn | De **Einddatum** |
| `coverImage` | Galerij | De eigenschap met de **Omslagafbeelding** |
| `subItemsProperty` | Tabel | De bovenliggende relatie voor **Subitems** |
| `widths` | Tabel | Map van kolom → breedte in pixels |
| `dateFormat` | alle | `long`, `iso` of `relative`; ontbreekt de sleutel, dan de standaard korte vorm |
| `graphEdges` | Graaf | Relatie-eigenschappen die als randen worden getekend |
| `graphColorBy` | Graaf | Een selectie- of statuseigenschap die de knooppunten kleurt |
| `graphSizeBy` | Graaf | Een getaleigenschap die de grootte van de knooppunten bepaalt |
| `graphShowExternal` | Graaf | `true` toont ook linkdoelen buiten de weergave |
| `graphShowIncoming` | Graaf | `true` toont ook links die uit andere databases binnenkomen |
| `pinboardOrder` | Prikbord | Paden van de niet-vastgezette kaarten, in handmatige volgorde |
| `pinboardPinned` | Prikbord | Paden van de vastgezette kaarten, in volgorde |
| `pinboardFilterBy` | Prikbord | **Labelbron**: een multiselectie-eigenschap; ontbreekt de sleutel, dan tags |

### Bestandsbrede opties (alleen eerste weergave)

Deze sleutels horen bij de hele database. Plainva schrijft ze alleen in het `plainva`-blok van de eerste weergave en leest van elke sleutel de eerste geldige waarde.

| Sleutel | Waarde |
|---|---|
| `fileIconColor` | Hex-kleur van het databasepictogram (**Icoonkleur van de database**) |
| `newItemFolder` | Map waarin **Item** nieuwe items opslaat |
| `newItemTemplate` | Sjabloon voor nieuwe items |
| `contextFilters` | Eigenschappen die een ingesloten database beperken tot de notitie waarin hij is ingesloten (**Deze notitie**) |
| `taskList` | Account en lijst (`"<account id> <list id>"`) waarin een nieuwe taak ook wordt aangemaakt |

## Samenvattingen

`views[i].summaries` koppelt een kolom aan een van deze namen; de kolomvoet berekent het over de rijen die de weergave toont.

| Naam | In Plainva | Resultaat |
|---|---|---|
| `Average` | **Gemiddelde** | Gemiddelde van de getallen |
| `Min` | **Min** | Kleinste getal |
| `Max` | **Max** | Grootste getal |
| `Sum` | **Som** | Totaal van de getallen |
| `Range` | **Bereik** | Grootste min kleinste getal; bij datums de spanne in dagen |
| `Median` | **Mediaan** | Middelste waarde van de getallen |
| `Stddev` | **Std.afw.** | Standaardafwijking van alle getallen (populatie) |
| `Earliest` | **Vroegste** | Vroegste datum |
| `Latest` | **Laatste** | Laatste datum |
| `Checked` | **Aangevinkt** | Rijen waarvan de waarde `true` of `yes` is |
| `Unchecked` | **Niet aangevinkt** | Alle andere rijen |
| `Empty` | **Zonder waarde** | Rijen zonder waarde |
| `Filled` | **Met waarde** | Rijen met een waarde |
| `Unique` | **Verschillend** | Aantal verschillende waarden; items van een lijst tellen één voor één |

Getallen worden op twee decimalen afgerond, en een decimale komma wordt ook gelezen. Een kolom zonder bruikbare waarde toont geen kolomvoet in plaats van 0. Elke andere naam is een eigen formule uit de `summaries` op het hoogste niveau: Plainva bewaart hem en toont **Aangepast: …** in het menu, maar berekent geen waarde.

## Sorteren en groeperen

- **Sortering** — `sort` is een lijst met regels; de eerste regel beslist eerst, de volgende alleen tussen gelijke rijen. Getallen sorteren als getallen, al het andere als tekst (ISO-datums in de juiste volgorde). Rijen zonder waarde komen in beide richtingen laatst. Zonder regel komen de recentst gewijzigde notities eerst. Plainva leest ook `field` voor `property`, en `asc`/`desc` in elke schrijfwijze met hoofd- of kleine letters.
- **Groepering** — het bord groepeert op `plainva.groupBy`, met banen op `plainva.boardLaneBy`. Een weergave die in plaats daarvan de eigen `groupBy` van Obsidian heeft, groepeert haar bord op die eigenschap, en een wijziging van de groepering wordt daarin geschreven (de `direction` ervan blijft). Plainva groepeert een tabel er niet mee.

## Een database insluiten, en `this`

`![[Projects.base]]` in een notitie toont de database in de notitie, in de leesweergave en in de editor. Een deel na `#` (een weergavenaam, zoals in `![[Projects.base#Board]]`) wordt genegeerd: de insluiting toont de weergave die voor deze database het laatst is gebruikt. Een codeblok ` ```base ` in een notitie wordt als code getoond, niet als database.

**`this` wordt nog niet ondersteund.** Een filter of formule die `this` gebruikt, blijft in het bestand staan, maar Plainva evalueert het niet. Twee dingen dekken het meest voorkomende geval, "toon de items die bij deze notitie horen": `contextFilters` (**Deze notitie** in het filterpaneel) beperkt een ingesloten database via een relatie-eigenschap tot de notitie waarin hij is ingesloten, en een ingesloten database die een relatie heeft met de database van zijn hostnotitie biedt zelf **Deze database op de huidige notitie filteren** aan. Beide werken alleen binnen Plainva; Obsidian toont alle rijen.

## Beperkingen

- De `limit` van Obsidian voor een weergave wordt bewaard maar niet toegepast: een weergave toont al haar rijen.
- Het filterpaneel bewerkt één niveau filtergroepen; diepere worden toegepast maar kunnen daar alleen worden verwijderd.
- Een filterwaarde moet tussen dubbele aanhalingstekens staan (zie [Wat Plainva niet kan lezen](#wat-plainva-niet-kan-lezen)).
- Een mapbron omvat altijd de submappen.
- `ratingMax` wordt tussen 1 en 10 getekend, `previousKeys` bewaart maximaal 8 namen, een **WIP-limiet** neemt alleen gehele getallen boven 0 aan, en `relationLimit` kent alleen `one`.
- Een aggregatie kan niet rekenen over een andere berekende kolom.

## Sleutels die Plainva niet kent

Plainva leest een `.base`, wijzigt alleen wat je in de app hebt gewijzigd, en schrijft het hele bestand opnieuw — als YAML met LF-regeleinden en zonder BOM, dus opmerkingen en de opmaak van een met de hand geschreven bestand blijven niet behouden. Van wat het niet kent:

- **Bewaard:** elke andere sleutel op het hoogste niveau, `formulas`, de `summaries` op het hoogste niveau, `displayName` en elke andere sleutel van een item in `properties`, onbekende sleutels in het `plainva`-blok van een kolom of een weergave, een aggregatie die Plainva niet kan lezen, de sleutels van een weergave die Plainva niet gebruikt (`limit`, `image`, …), een weergavetype dat het niet kent, en filtervoorwaarden die het niet kan lezen. Een waarde die Plainva begrijpt maar die je niet hebt gewijzigd, behoudt de schrijfwijze van het bestand (`status` of `note.status`, een optie geschreven als platte tekst).
- **Herschreven:** alleen Plainva's eigen oude vormen — een `columns:`-map op het hoogste niveau verhuist naar `properties`, `and` en `or` naast elkaar op één niveau krijgen de geldige vorm, en een weergave die heel oude versies als `type: board` opsloegen, wordt `type: table` met `plainva.render`.
- **Positie:** de sleutels die een weergave bewaart, horen bij die weergave. Het verwijderen of verplaatsen van een weergave in Plainva neemt ze mee, en **Dupliceren** kopieert ze naar de nieuwe weergave.

## Verschillen met Obsidian Bases

| Onderwerp | Obsidian | Plainva |
|---|---|---|
| Formules, eigen samenvattingen | Berekend | Bewaard, niet berekend |
| `this` | Ondersteund | Nog niet ondersteund |
| Filteruitdrukkingen | De volledige uitdrukkingstaal | De vormen onder [Voorwaarden](#voorwaarden) |
| `file.folder == "X"` | Alleen notities direct in `X` | `X` en al haar submappen |
| `file.hasTag("x")` | Ook `#x/child` | Precies `#x` |
| `file.name` | De bestandsnaam | De eigenschap `title` als de notitie die heeft |
| `limit`, `groupBy` van een weergave | Toegepast | `limit` bewaard, niet toegepast; `groupBy` groepeert een bord, geen tabel |
| Weergavetypen | `table`, `list`, `cards` en plug-intypen | Acht typen; een onbekend type wordt als tabel getoond en blijft in het bestand |
| `![[db.base#View]]` | Opent die weergave | De laatst gebruikte weergave |
| Codeblok ` ```base ` | Een database | Een codeblok |
| De `plainva`-blokken van Plainva | Genegeerd | Bord, kalender, tijdlijn, graaf, prikbord, relaties, aggregaties, veldtypen |

## Zie ook

- [Databases (.base)](Databases_Base.md) — databases in dagelijks gebruik
- [Bestandsformaat-referentie](File_Format_Reference.md) — de regels op schijf voor tools, relaties in beide richtingen, `index.md`
- [Notities & Markdown](Notes_and_Markdown.md) — eigenschappen in een notitie
