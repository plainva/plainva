# Bestandsformaat-referentie

Laatst bijgewerkt: 2026-07-15

Deze pagina is het exacte, op-de-schijf-contract voor **elk bestand in een Plainva-vault**. Ze is zo geschreven dat een tool — een ander programma, script of KI-assistent — vault-bestanden rechtstreeks kan lezen en veilig bewerken, zonder de omweg via Plainva's gebruikersinterface. Gebruik je alleen de app, dan heb je deze pagina nooit nodig; de [overige handleidingpagina's](README.md) behandelen normaal gebruik.

Alles hier is puur UTF-8-tekst. Notities zijn Markdown met YAML-frontmatter; databases zijn YAML. Niets is eigendomsrechtelijk, niets is verborgen.

## Grondregels (eerst lezen)

1. **De notitie is de bron van waarheid. Een `.base` is alleen een weergave.** Eigenschaps-*waarden* staan in de frontmatter van de individuele notities — nooit in de `.base`. Om een waarde te wijzigen, bewerk je de notitie.
2. **Notities blijven Obsidian-native.** Schrijf in notitie-frontmatter uitsluitend eenvoudige scalars en lijsten (string, getal, boolean, ISO-datum, YAML-lijst). Schrijf nooit een genest object of een "actief/geselecteerd"-vlag in een notitie.
3. **Een `.base` gebruikt alleen Obsidians vier top-level sleutels** (`filters`, `formulas`, `properties`, `views`). Elke andere top-level sleutel zorgt ervoor dat Obsidian het hele bestand afwijst. Alle Plainva-specifieke data staat onder geneste `plainva:`-subsleutels.
4. **Bewaar wat je niet begrijpt.** Onbekende sleutels moeten een lees-/schrijfronde ongewijzigd doorstaan. "Ruim" geen sleutels op die je niet herkent.
5. **Schrijf UTF-8 zonder BOM, met LF-regeleinden.**

## De vault in vogelvlucht

Een vault is een gewone map. De bestandstypen die je tegenkomt:

| Bestand | Wat het is | Bewerkbaar als tekst |
|---|---|---|
| `*.md` | Een notitie: YAML-frontmatter + Markdown-tekst | Ja |
| `*.base` | Een databaseweergave over notities (YAML) | Ja |
| `index.md` | Het beheerde inhoudsoverzicht van een map (gereserveerde naam) | Ja, met zorg — zie [index.md](#indexmd-map-inhoudsopgave) |
| `log.md` | Gereserveerde naam, momenteel ongebruikt | Met rust laten |
| afbeeldingen, PDF's, … | Bijlagen | Nee (binair) |
| `.plainva/` | Plainva's interne map (back-ups, status) | **Nee — nooit aanraken** |

De gereserveerde namen `index.md` en `log.md` zijn nooit gewone notities; maak onder die namen geen gewone inhoud aan.

---

## Notities (`.md`)

Een notitie is een Markdown-bestand. Een optioneel YAML-frontmatterblok (tussen twee `---`-regels) helemaal bovenaan bevat de eigenschappen; daarna volgt de Markdown-tekst.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### OKF-frontmattervelden

Plainva volgt OKF (Open Knowledge Format), een minimale conventie. Twee top-level velden:

| Veld | Type | Betekenis |
|---|---|---|
| `type` | string | Welk soort document dit is (`Note`, `Daily Note`, `Project`, …). Het enige veld dat OKF daadwerkelijk vereist. |
| `okf_version` | string | De conventieversie waartegen het bestand is geschreven, bijv. `"0.1"`. Zet het tussen aanhalingstekens zodat YAML het als string behoudt. |

Een bestand **zonder** `type` opent nog steeds prima; het is alleen "niet OKF-conform". Een ontbrekende `okf_version` alleen is geen overtreding. Als je een nieuwe notitie aanmaakt, is het goede praktijk om `type` (en `okf_version`) toe te voegen. Zie [OKF](OKF.md) voor de volledige onderbouwing.

### Serialisatie van eigenschapswaarden

Elke frontmatter-sleutel is één eigenschap. Schrijf de waarde in de native YAML-vorm voor het type ervan:

| Eigenschapstype | YAML-vorm | Voorbeeld |
|---|---|---|
| Tekst | scalar string | `title: Hello` |
| Getal | getal | `priority: 3` |
| Selectievakje | boolean | `done: true` |
| Datum | ISO-datumstring | `due: 2026-07-20` |
| Datum & tijd | ISO-datetimestring | `at: 2026-07-20T14:30:00` |
| Lijst | YAML-lijst van strings | `authors: [Ada, Alan]` |
| Tags | YAML-lijst van strings | `tags: [project, active]` |
| Selectie / Status | enkele scalar string | `status: Done` |
| Multiselectie | YAML-lijst van strings | `labels: [urgent, later]` |
| URL / E-mail / Telefoon | scalar string | `site: https://example.org` |
| Relatie (enkel) | wiki-link-**string** | `project: "[[Project Alpha]]"` |
| Relatie (meervoudig) | YAML-lijst van wiki-link-strings | `related: ["[[A]]", "[[B]]"]` |

De "actieve" waarde van een Selectie-/Status-eigenschap is precies die platte scalar. Het *palet van toegestane opties* en hun kleuren staan **niet** in de notitie — ze staan in de regerende `.base` (zie [Opties en kleuren](#opties-en-kleuren)). Zo blijft de notitie 100% Obsidian-native.

> Zet wiki-linkwaarden tussen aanhalingstekens (`"[[X]]"`). Ongequote `[[X]]` is in YAML een flow-sequence en wordt niet geparst zoals bedoeld.

### De `plainva:`-namespace in notities

Plainva-specifieke extra's voor notities zijn gebundeld onder één enkele `plainva:`-sleutel, zodat andere editors ze kunnen negeren:

| Sleutel | Waarde | Betekenis |
|---|---|---|
| `icon` | emoji-grafeem, of `lucide:<kebab-naam>` | Documenticoon (Notion-stijl) |
| `icon_color` | hexkleur (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tint voor een `lucide:`-icoon (emoji's negeren dit) |
| `header_color` | hexkleur | Headerstreep over de volle breedte |
| `tasks` | `false` | Sluit de selectievakjes van deze notitie uit van de [Taken-weergave](Tasks.md) |

Ze zijn allemaal optioneel. Schrijf je er geen enkele, laat dan de `plainva:`-sleutel helemaal weg. Ongeldige waarden worden bij het lezen genegeerd, nooit als fout behandeld.

### Links

- **Wiki-link:** `[[Notitienaam]]` — vault-breed opgelost via de notitienaam. Met een kop-anker: `[[Notitie#Sectie]]`. Met weergavetekst: `[[Notitie|getoonde tekst]]`.
- **Markdown-link:** `[tekst](relatief/pad.md)` werkt ook.
- **Backlinks** worden automatisch afgeleid, ook uit frontmatter-wiki-links (dat is wat relaties als backlinks laat verschijnen).

---

## Databases (`.base`)

Een `.base`-bestand is YAML. Het bewaart een *weergave* over notities — welke notities (bronnen), hoe ze worden getoond (weergaven), hoe er wordt gefilterd en gesorteerd, en het kolomschema. Het bewaart **geen notitiewaarden**. Het formaat is compatibel met Obsidians Bases-plugin.

### Harde regels — bij een overtreding wijst Obsidian het hele bestand af

- **Alleen deze top-level sleutels:** `filters`, `formulas`, `properties`, `views`. Voeg nooit een andere top-level sleutel toe. (Historisch brak een top-level `columns:`-sleutel elk bestand — herintroduceer dat patroon niet.)
- **Elke weergave heeft een niet-lege string-`name`.**
- **Een `filters`-object draagt op elk niveau exact één van `and` / `or` / `not`** — nooit twee naast elkaar.

Plainva zelf herstelt oudere bestanden die tegen de laatste twee regels ingaan de volgende keer dat ze worden opgeslagen, maar een tool die rechtstreeks schrijft moet ze meteen goed hebben.

### Eigenschaps-identifiers: wanneer het `note.`-voorvoegsel gebruiken

Dit is de bekende valkuil, dus expliciet:

| Waar | Vorm | Voorbeeld |
|---|---|---|
| Sleutels van de `properties:`-map | met voorvoegsel | `note.status`, `file.name` |
| De `order:`-lijst van een weergave | met voorvoegsel | `[file.name, note.status]` |
| `sort[].property` van een weergave | met voorvoegsel | `note.due` |
| Binnen **filter**-expressies | **bare** | `status == "Done"` |
| Binnen `plainva`-subsleutels (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **bare** | `groupBy: status` |

Vuistregel: de *Obsidian-gerichte* structurele velden gebruiken `note.<key>` (en `file.<x>` voor ingebouwde velden zoals `file.name`, `file.folder`, `file.mtime`); alles binnen een **filterformule** of een **`plainva`-blok** gebruikt de bare frontmatter-sleutel.

### Top-level sleutels

- **`filters`** — welke notities tot deze database behoren. In Plainva staan hier alleen de **bronnen** (map/tag); eigenschaps-filtervoorwaarden worden per weergave opgeslagen onder `views[i].filters`. Zie [Filters](#filters).
- **`properties`** — het kolomschema, geïndexeerd op eigenschaps-id. Native Obsidian-subsleutels zoals `displayName` (kolomkoplabel) zijn toegestaan en blijven behouden; alle Plainva-rijkdom staat onder `properties[id].plainva`.
- **`views`** — een geordende lijst van weergaven. Elke heeft een `name` en een `type` nodig.
- **`formulas`** — een Obsidian-functie. Plainva maakt deze niet aan, maar bewaart ze ongewijzigd.

### De `plainva:`-subsleutelkaart

Alles wat Plainva-specifiek is, is namespaced. Drie plekken:

**`properties[<note.key>].plainva`** — per kolom:

| Sleutel | Waarde | Betekenis |
|---|---|---|
| `input` | een van de invoertypen hieronder | Het veldtype van de kolom |
| `options` | lijst van optie-objecten | Gecureerde waarden voor selectie/status/multiselectie |
| `relationBase` | vault-relatief `.base`-pad | Doeldatabase van de relatie (zie [Relaties](#relaties-het-tweezijdige-contract)) |
| `relationLimit` | `one` | Kardinaliteit: één enkele link. Weglaten = onbeperkt. |
| `reverseOf` | `{ base, property }` | Kenmerkt een **berekende omgekeerde-relatie**kolom (geen `input`) |

**`views[i].plainva`** — per weergave:

| Sleutel | Waarde | Betekenis |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Plainva-only weergavesoort (zie hieronder) |
| `groupBy` | bare eigenschapssleutel | Groeperingskolom van het bord |
| `dateField` | bare eigenschapssleutel | Startdatum voor kalender/tijdlijn |
| `endField` | bare eigenschapssleutel | Einddatum van de tijdlijn |
| `coverImage` | bare eigenschapssleutel | Omslagafbeelding-eigenschap van de galerij |
| `subItemsProperty` | bare eigenschapssleutel | Bovenliggende kolom (zelf-relatie) voor de subitem-verschachteling |
| `widths` | map van id → px | Kolombreedtes |
| `dateFormat` | string | Datumformaat per weergave (`default` is impliciet — weglaten) |

Naast het `plainva`-blok kan een weergave een native **`views[i].filters`**-object dragen — de **filters per weergave** (dezelfde eenwortelige `and`/`or`/`not`-grammatica als het dossierwijde `filters`). Plainva slaat hier eigenschaps-filterregels op, één set per weergave, zodat elke weergave onafhankelijk filtert; het dossierwijde `filters` behoudt dan alleen de bronnen. Obsidian past `views[i].filters` native per weergave toe.

**`views[0].plainva`** — dossierwijde sleutels, alleen toegestaan op de **eerste** weergave:

| Sleutel | Waarde | Betekenis |
|---|---|---|
| `fileIconColor` | hexkleur | Tint van het database-icoon (boom/tabbladen/header) |
| `newItemFolder` | vault-relatieve map | Waar de "Nieuw"-knop nieuwe items opslaat |
| `newItemTemplate` | vault-relatief `.md`-pad | Standaardsjabloon voor nieuwe items |
| `contextFilters` | lijst van kale eigenschapssleutels | Zelfreferentie-filters ("Deze notitie") — zie hieronder |

`contextFilters` is Plainva's equivalent van Notions "this page"-filter. Elk item is een eigenschapssleutel; wanneer de database in een notitie is ingesloten, worden de rijen ervan via die eigenschap afgestemd op die host-notitie (opgelost via de linkindex — een eigenschap die de link bezit of een gewone linkeigenschap komt overeen met rijen die naar de host verwijzen, een berekende omgekeerde kolom komt overeen met waarnaar de host zelf verwijst). Het wordt bewust **niet** in de native `filters` geschreven, dus negeert Obsidian het en toont alle rijen; ook los geopend in Plainva wordt het genegeerd (geen host) en toont de weergave alle rijen. Meerdere items worden met EN gecombineerd.

### Invoertypen

`plainva.input` is een van:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

Een berekende **omgekeerde** kolom heeft **geen** `input` — ze wordt uitsluitend gekenmerkt door `reverseOf`.

### Opties en kleuren

Selectie-/Status-/Multiselectie-kolommen kunnen een gecureerde optielijst dragen. Elke optie:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` is een **paletnaam**, geen CSS-kleur. Geldige namen: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. Een onbekende kleur valt terug op een uit de waarde afgeleide kleur.

### Weergavetypen

`views[i].type` is op de schijf een native Obsidian-type. Plainva-only weergaven worden geschreven als `type: table` plus een `plainva.render`-hint, zodat Obsidian ze degradeert tot een gewone tabel:

| Je wilt | `type` op de schijf | `plainva.render` |
|---|---|---|
| Tabel | `table` | — |
| Lijst | `list` | — |
| Galerij | `cards` | — |
| Bord | `table` | `board` |
| Kalender | `table` | `calendar` |
| Tijdlijn | `table` | `timeline` |

### Filters

`filters` selecteert welke notities in de database zitten en grenst ze af.

**Bronvoorwaarden** bepalen het lidmaatschap:

- Map: `file.folder == "Path/To/Folder"` (vault-relatief; de rootmap is `""`).
- Tag: `file.hasTag("project")` (zonder voorloop-`#`).

Meerdere bronnen zijn gewoon meerdere items. Helemaal geen `filters` = elke notitie in de vault.

**Waar eigenschapsvoorwaarden staan:** op dossierniveau geldt `filters` voor elke weergave. Plainva slaat eigenschaps-filterregels in plaats daarvan **per weergave** op in `views[i].filters` (dezelfde eenwortelige structuur) en behoudt op dossierniveau alleen de bronnen, zodat elke weergave onafhankelijk kan filteren. Beide zijn geldig voor Obsidian; een tool mag beide schrijven. Een ouder bestand met eigenschapsvoorwaarden op dossierniveau blijft werken — Plainva verdeelt ze de volgende keer dat het wordt opgeslagen over elke weergave.

**Eigenschapsvoorwaarden** gebruiken bare eigenschapsnamen en deze operatoren:

| Operator | Expressie |
|---|---|
| is gelijk aan | `status == "Done"` |
| is niet gelijk aan | `status != "Done"` |
| bevat | `contains(labels, "urgent")` |
| bevat niet | `!contains(labels, "urgent")` |
| groter / kleiner | `priority > "2"`, `priority < "5"` |
| minstens / hoogstens | `priority >= "2"`, `priority <= "5"` |
| is leeg | `status == ""` |
| is niet leeg | `status != ""` |

**Structuur (eenwortelig!):** een van `and` / `or` / `not`, waarvan de items voorwaarde-strings zijn — of één niveau van geneste `{and:[...]}` / `{or:[...]}`-groepobjecten (Notion-stijl groepen). Voorbeeld met een bron, een voorwaarde en een OF-groep:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### Een volledige, geannoteerde `.base`

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## Relaties (het tweezijdige contract)

Een relatie koppelt notities aan elkaar. Dit is het meest foutgevoelige om met de hand te schrijven, omdat het zich over **drie** plekken uitstrekt. Zorg dat alle drie consistent zijn.

1. **De waarde staat in de frontmatter van de bronnotitie**, als wiki-link (of een lijst daarvan):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **De bron-`.base` declareert de relatiekolom** (`relationBase` = de doeldatabase; `relationLimit: one` voor een enkele link):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **De doel-`.base` kan de omgekeerde richting tonen** met een **berekende** kolom. De waarden ervan worden **nergens** opgeslagen — ze worden afgeleid uit de links van de bronnotities:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Uitgewerkt voorbeeld: Taken ↔ Projecten

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Resultaat: in `Projects.base` toont de berekende `tasks`-kolom van **Project Alpha** "Write proposal", omdat het `project`-veld van die taak ernaar terugverwijst. Merk op dat `Project Alpha.md` **geen** `tasks:`-sleutel heeft — de omgekeerde kant is berekend, nooit opgeslagen.

### Relatie-DON'Ts

- **Schrijf geen omgekeerde waarden in notities.** Een `reverseOf`-kolom is berekend. Een `tasks:`-sleutel in `Project Alpha.md` schrijven is fout en overleeft geen roundtrip.
- **Zorg dat linkdoelen resolven.** `"[[Project Alpha]]"` moet overeenkomen met een bestaande notitienaam, anders toont de link als defect.
- **Houd paden vault-relatief** met schuine strepen en zonder voorloop-`./` (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` is de bare bronsleutel** (`project`), niet `note.project`.

### Zelf-relaties en subitems

Voor een relatie waarvan het doel dezelfde database is, wijst `relationBase` naar diezelfde `.base`. Om kinderen onder ouders in een tabelweergave te nesten, zet je `views[i].plainva.subItemsProperty` op de bare bovenliggende-relatiesleutel. Cycli worden afgehandeld; met subitems uit blijven de rijen plat en de waarden behouden.

---

## `index.md` (map-inhoudsopgave)

`index.md` is een gereserveerde naam voor het inhoudsoverzicht van een map.

- **Alleen de root-`index.md` mag frontmatter dragen**, en alleen `okf_version` (het markeert de vault als OKF-actief). Een niet-root-`index.md` moet **frontmatter-vrij** zijn — frontmatter daar is een schending van de gereserveerde naam.
- Een Plainva-**beheerde** `index.md` eindigt met de marker `<!-- plainva:index generated -->` (een HTML-commentaar, onzichtbaar in de leesmodus). De aanwezigheid ervan betekent dat Plainva het bestand automatisch actueel houdt. Bewerk je zo'n bestand met de hand, bewaar dan ofwel de marker (en houd de gegenereerde vorm aan) of verwijder hem bewust om het bestand permanent over te nemen.
- Gegenereerde listings zijn secties van links in de vorm `* [Titel](relatief/url) - beschrijving`.

Genereer je een mapoverzicht met de hand, dan is de veilige keuze om de marker **niet** toe te voegen — dan zal Plainva het nooit overschrijven.

---

### Graaf-weergaven (`plainva.render: "graph"`)

Een graaf-weergave wordt opgeslagen zoals elke niet-native weergave: `type: table` plus de render-hint. De opties ervan staan in DEZELFDE `views[i].plainva`-namespace:

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # relation property keys drawn as edges
      graphColorBy: status         # select/status property -> node color
      graphSizeBy: prio            # number property -> node size
      graphShowExternal: true      # include relation targets outside the view
      graphShowIncoming: true      # relaties uit ANDERE databases die hiernaar verwijzen (bijv. de taken van een project)
```

Alle graaf-optiesleutels zijn optioneel; laat ze helemaal weg als ze niet zijn ingesteld. Obsidian rendert hetzelfde bestand als een gewone tabel en mag geen fout geven.

Een **Bord**-weergave (`plainva.render: "board"`) kan daarnaast `views[i].plainva.boardColumnOrder` dragen — een lijst van groep-kolomsleutels (`__UNGROUPED__` markeert de kolom zonder waarde) die een handmatige kolomvolgorde onthoudt. Selectie-/Status-borden ordenen in plaats daarvan de `options` van de eigenschap opnieuw. Weglaten als niet ingesteld.

## Niet-aanraken en veiligheid

- **`.plainva/`** bevat back-ups en interne status. Lees er nooit programmalogica uit en schrijf er nooit naar.
- **Onbekende sleutels zijn heilig.** Als je een `.base` of een notitie herschrijft, draag dan elke sleutel mee die je niet van plan was te wijzigen. Plainva zelf bewaart onbekende `.base`-sleutels via een interne rauwe kopie; een externe schrijver zou hetzelfde moeten doen (parsen → alleen wijzigen wat je bedoelt → serialiseren).
- **Waarden veranderen in de notitie, niet in de `.base`.** Om een cel te zetten, bewerk je de frontmatter van de notitie. De `.base` bepaalt alleen welke notities en kolommen worden getoond.
- **Voeg geen top-level `.base`-sleutels toe** boven `filters` / `formulas` / `properties` / `views`.
- **Encoding:** UTF-8 zonder BOM, LF-regeleinden, overal.

## Zie ook

- [Notities & Markdown](Notes_and_Markdown.md) — hetzelfde materiaal vanuit de hoek van handmatig schrijven in de app
- [Databases (.base)](Databases_Base.md) — databases uitgelegd voor alledaags gebruik
- [OKF](OKF.md) — `type`, `okf_version`, index.md en de vault-conversie
