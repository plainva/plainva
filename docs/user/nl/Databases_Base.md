# Databases (.base)

Laatst bijgewerkt: 2026-07-08

Met `.base`-bestanden verander je notities in databases: tabellen, borden, kalenders — met filters, getypeerde eigenschappen en relaties tussen databases. Het concept lijkt op Notion-databases, met één beslissend verschil: **de data leeft niet in de database, maar in je notities.**

> **Tip:** Als je een nieuwe vault aanmaakt vanaf het sjabloon **PARA**, **GTD**, **Zettelkasten** of **Journal** (zie [Aan de slag](Getting_Started.md)), zijn er al bijpassende databases ingesteld en aan elkaar gekoppeld — een goed startpunt om te zien hoe alles samenhangt.

## Het kernconcept

Een `.base`-bestand slaat alleen de *weergave* van je notities op: welke bronnen (mappen, tags), welke weergaven, welke filters en kolommen. De daadwerkelijke waarden staan in de frontmatter van de individuele Markdown-notities — elke tabelrij *is* een notitie.

Concreet betekent dat:

- Bewerk je een cel in de tabel, dan schrijft Plainva de waarde in de frontmatter van de notitie.
- Verwijder je het `.base`-bestand, dan verlies je alleen de weergave — alle data blijft bewaard in de notities.
- Dezelfde notities kunnen in willekeurig veel databases tegelijk voorkomen.

Het bestandsformaat is compatibel met Obsidians Bases-formaat (details onderaan deze pagina).

## Een database aanmaken

- **Bestandsboom**: rechtsklik → **Nieuwe database (.base)** — of via de **Nieuw**-knop van de zijbalk (**Nieuwe base**).
- De wizard **Nieuwe database** vraagt twee dingen: de **Gegevensbron** (minstens één **Map** of één **Tag**; combineren perkt het resultaat verder in — een teller toont live hoeveel notities overeenkomen) en de kolommen (eigenschappen die in de overeenkomende notities zijn gevonden, klaar om over te nemen). Dan **Database aanmaken**.
- **Binnen een notitie**: slash-commando **Database insluiten** (bestaande `.base` inline tonen) of **Inline-database aanmaken** (nieuwe `.base` in de map aanmaken en insluiten).

Elke database kan een eigen icoon dragen met een **Icoonkleur van de database** — zichtbaar in de bestandsboom, in tabbladen en de header.

## Weergaven

Een database kan willekeurig veel weergaven hebben; elke heeft een **Weergavetype**:

| Weergave | Waarvoor |
|---|---|
| **Tabel** | Klassiek raster, sorteerbaar, met inline-editing en optionele subitems |
| **Lijst** | Compacte rijenlijst |
| **Galerij** | Kaarten met optionele **Omslagafbeelding** |
| **Bord** | Kanban-kolommen, gegroepeerd op een eigenschap (**Groeperen op**) — kaarten tussen kolommen slepen wijzigt de waarde; een **kolomkop** slepen herschikt de kolommen |
| **Kalender** | Items op **Datumveld** op een maandkalender, versleepbaar |
| **Tijdlijn** | Tijdas met **Startdatum** en optionele **Einddatum** |

**Weergave toevoegen** maakt nieuwe aan; via **Weergaveopties** kun je **Hernoemen**, **Dupliceren**, **Verwijderen** en de volgorde per sleep wijzigen. Welke weergave het laatst actief was, onthoudt Plainva per bestand. Kalender en Tijdlijn hebben een datumveld nodig (**Alleen datum** of **Datum & tijd** als **Formaat**); items tonen de velden die zijn ingeschakeld onder **Eigenschappen**.

## Configureren: bronnen, filters, sortering, eigenschappen

De knop **Configureren** (rechtsboven) opent het paneel met vier gebieden:

- **Gegevensbron** — de map- en tagbronnen van de database (ook het **Hoofdmap** is kiesbaar). Geen bron = alle bestanden.
- **Filter** — regelrijen bestaande uit eigenschap, operator en waarde. De operatoren passen zich aan het veldtype aan: **is** / **is niet** / **bevat** / **bevat niet** / **is leeg** / **is niet leeg**, voor getallen **groter dan** / **kleiner dan** / **minstens** / **hoogstens**, voor datumvelden **na** / **voor** / **vanaf** / **tot**. De **Logica** bovenaan bepaalt of **Alle** voorwaarden (EN) of **Minstens één** (OF) moeten kloppen. Met **Groep toevoegen** bouw je Notion-achtige filtergroepen: een kader met eigen EN/OF-logica binnen de hoofdlogica. Sterk geneste filters uit Obsidian toont Plainva als **Complex filter (niet bewerkbaar)** — ze blijven behouden en worden toegepast. Filters worden **per weergave** opgeslagen (het paneel vermeldt **Geldt voor deze weergave**): elke weergave houdt eigen filterregels bij, terwijl de **Gegevensbron** (mappen/tags) voor de hele database gedeeld blijft. Alles staat in het `.base`-bestand, niet in een aparte opslag.
- **Sortering** — meerdere sorteerregels (**Oplopend**/**Aflopend**); de prioriteit wijzig je door slepen.
- **Eigenschappen** — kolommen tonen/verbergen, de volgorde per sleep wijzigen, een **Nieuwe eigenschap** aanmaken.

## Eigenschappen en veldtypen

Een klik op een kolomkop opent de eigenschappeneditor (**Eigenschap: X**):

- **Naam** — hernoemen werkt door op de notities: bij het opslaan wordt de eigenschap in de frontmatter van elke overeenkomende notitie hernoemd (met bevestiging en voortgangsindicator).
- **Veldtype** — Tekst, Getal, Selectievakje, Datum, Datum & tijd, Lijst, Tags, Selectie, Status, Multiselectie, URL, E-mail, Telefoon, Relatie (hetzelfde gegroepeerde typemenu als in het **Eigenschappen**-paneel van de notities).
- **Opties** (bij Selectie/Status/Multiselectie) — vaste waarden met een **Kleur** en, bij **Status**, een **Groep**/fase (bijv. te doen → bezig → klaar); volgorde per sleep. Wanneer je de kolomeditor opent, is de optielijst al vooraf ingevuld met de waarden die in de database voorkomen — zo kun je elke optie een kleur geven zonder die opnieuw te typen.
- **Eigenschap verwijderen** — verwijdert kolom, schema, filters en sorteerregels uit de database. De checkbox **Ook verwijderen uit de frontmatter van de notities** (standaard aan) ruimt bovendien de bronnotities op.

Gedragsopmerkingen:

- Als een eigenschap in sommige notities ontbreekt, biedt Plainva aan om ze (leeg) **toe te voegen aan N bronbestanden**.
- Bij **Selectie**, **Status**, **Multiselectie**, **Lijst** en **Tags** scheidt een komma in een waarde meerdere items; in het type **Tekst** blijft een komma gewone tekst.
- De OKF-systeemvelden `type` en `okf_version` zijn hier ook beschermd: naam, veldtype en verwijderen zijn vergrendeld, en `okf_version`-cellen zijn alleen-lezen (achtergrond: [OKF](OKF.md)).

## Relaties

Relaties koppelen notities aan elkaar — zoals in Notion, maar opgeslagen als heel gewone `[[wiki-links]]` in de frontmatter (in Obsidian zichtbaar als klikbare property-links).

- **Aanmaken**: voeg een eigenschap toe van veldtype **Relatie**. Optioneel kies je een **Doeldatabase (.base)** — de kiezer stelt dan alleen notities uit die database voor (leeg = **Elke notitie**; **Deze database** maakt zelf-relaties mogelijk). De **Kardinaliteit** beperkt tot **Precies 1** of laat **Geen limiet** toe.
- **Waarden instellen**: de kiezer zoekt notities, sluit het huidige item uit en kan direct een doel aanmaken via **Nieuwe notitie aanmaken**. Een chip met "Gelinkte notitie bestaat niet" markeert een verweesde link (doel verwijderd/hernoemd buiten Plainva om).
- **Omgekeerde relatie**: de optie **Tonen op "X"** maakt in de doeldatabase een berekende kolom aan die de koppelingen omgekeerd toont — die is direct bewerkbaar (bewerkingen schrijven in de linkende notities). Het verwijderen van de relatie verwijdert ook de omgekeerde kolom.
- **Subitems**: bij zelf-relaties kun je **Subitems inschakelen** — items met een bovenliggende relatie verschijnen uitklapbaar onder hun bovenliggende item in de tabel (cycli worden opgevangen; uitgeschakeld blijft de lijst plat en de waarden blijven behouden).
- **Bord op relatie**: borden kunnen groeperen op een relatie; kaarten tussen kolommen slepen herschrijft de link.
- **Filteren op relaties**: bevat / bevat niet / is leeg / is niet leeg, met een notitiekiezer.
- Backlinks tellen ook mee: frontmatter-links verschijnen in het **Backlinks**-paneel, en het hernoemen van bestanden werkt relatielinks automatisch bij.

## Nieuwe items aanmaken

De **Item**-knop linksboven (voorheen **Nieuw**; duidelijk gescheiden van de globale **Nieuw**-knop van de zijbalk) maakt een nieuw item aan:

- De bestandsnaam volgt het patroon `{databasenaam}_{volgnummer}` (spaties worden `_`); de notitie start met een passende kop en erft de tagbronnen en eenvoudige filterwaarden van de database, zodat het meteen in de weergave verschijnt. Daarna opent het peek-venster om in te vullen.
- **Opslagmap**: nieuwe items belanden altijd in een vaste map. Heeft de database geen mapbron, dan leidt een dialoogvenster je eenmalig door het aanmaken ervan; bij meerdere mapbronnen kies je eenmaal. Later altijd te wijzigen via het pijlmenu op de knop → **Opslagmap wijzigen…**.
- **Sjablonen**: het pijlmenu (**Sjablonen en opslagmap**) toont de sjablonen uit de sjablonenmap van je vault — eenmalig gebruiken, met een ster **Als standaard instellen** (geldt dan voor elke klik op **Item** bij deze database) of **Nieuw sjabloon maken** (een nieuw sjabloon begint met een `# {{title}}`-kop, dus items die eruit worden aangemaakt erven hun bestandsnaam als de H1). Hetzelfde menu biedt ook **Sjablonenmap openen**, waarmee de sjablonenmap in de bestandsboom wordt getoond — sjablonen zijn gewone notities die je daar kunt bewerken, hernoemen of verwijderen.

## Dagelijks gebruik

- **Inline-editing**: één klik in een cel (of op een kaartwaarde) maakt hem bewerkbaar — in elke weergave.
- **Openen**: een klik op de titel van een item opent de notitie in het peek-venster — een vrij zwevend venster dat je aan de titelbalk kunt verslepen en vanuit de hoek kunt vergroten of verkleinen. Het houdt een eigen **Terug**/**Vooruit**-geschiedenis bij voor de notities die je erin opent, heeft een schakelaar die een **Eigenschappen**-kolom toont voor de weergegeven notitie, en biedt **Als tabblad openen** en **In split openen**. `Ctrl`+klik opent direct in de split; alternatief sleep je een kaart naar de drop-zone **Hier neerzetten: in split openen**.
- **Slepen**: tijdens het slepen van kaarten (Bord, Kalender, Tijdlijn) volgt een spookkaart de muisaanwijzer. In een **Bord** kun je ook een **kolomkop** slepen om de kolommen opnieuw te ordenen — bij **Selectie**/**Status**-borden herschikt dat de opties van de eigenschap (de dropdowns volgen overal mee); relatie- en vrijetekst-borden onthouden de volgorde per weergave.
- **Kolomkleur**: in de **Weergave**-instellingen van een bord laat **Kolomkleur** een kolom de kleur van zijn groep aannemen — **Hele kolom** (de hele kolom wordt gekleurd) of **Alleen chip** (alleen de chip in de kop, standaard). Geldt voor Selectie-/Status-/Multiselectie-groepen.
- **Insluiten**: databases kunnen in notities worden ingesloten (slash-commando **Database insluiten** of `@` → **Databases**) en daar volwaardig worden gebruikt.
- **Automatisch bereik binnen een gerelateerd item**: sluit je een database in binnen één item van een *gerelateerde* database, dan wordt de weergave automatisch gefilterd op dat item — sluit de takendatabase in een projectnotitie in en je ziet alleen de taken van dat project. Dit werkt in beide richtingen (sluit de "veel"-kant in om de items te zien die naar het host-item verwijzen, of sluit de "één"-kant in om te zien waar het host-item naar verwijst) en ook voor zelfverwijzende databases met een hiërarchie van bovenliggende items en subitems (de database insluiten in een item toont de subitems van dat item, genest). Een kleine chip **Filter** in de header van de insluiting toont waarop hij is afgestemd; gebruik hem om de relatie te wijzigen of **Alles tonen** te kiezen. Het bereik wordt nooit in het `.base`-bestand geschreven, dus toont dezelfde database overal waar hij is ingesloten de juiste items.
- **Nieuwe items erven de koppeling**: maak je met **Item** een nieuw item aan binnen zo'n afgestemde insluiting, dan wordt het automatisch gekoppeld aan het host-item (een taak die je aanmaakt in de ingesloten takenlijst van een project hoort meteen bij dat project). In de omgekeerde richting wordt in plaats daarvan het host-item gekoppeld aan het nieuwe item; een relatie die al een waarde heeft en op **Precies 1** staat, blijft ongewijzigd.
- **Expliciet "Deze notitie"-filter (zoals Notions "this page")**: in plaats van te vertrouwen op het automatische bereik, kun je het expliciet en permanent maken. Voeg in **Configureren → Filter** een regel toe op een relatie-eigenschap en kies de waarde **Deze notitie**. De database wordt dan afgestemd op de notitie waarin hij is ingesloten — ideaal voor **sjablonen**: sluit de takendatabase in binnen een projectsjabloon, en elk project dat daaruit wordt aangemaakt toont zijn eigen taken. Het werkt voor elke wiki-link-eigenschap, niet alleen gedetecteerde relaties, en een expliciet **Deze notitie**-filter heeft voorrang op het automatische bereik. Dit filter bestaat alleen in Plainva (het wordt niet als een normaal filter in de `.base` geschreven), dus negeert Obsidian het en toont alle rijen; ook los (zonder host) geopend toont Plainva alle rijen.

## Voorbeeld: hoe een .base-bestand eruitziet

`.base`-bestanden zijn YAML — hier een eenvoudige projectlijst:

```yaml
filters:
  and:
    - 'file.hasTag("project")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: open
          color: teal
          group: Actief
        - value: klaar
          color: gray
          group: Afgerond
views:
  - type: table
    name: Alle projecten
  - type: table
    name: Bord
    plainva:
      render: board
      groupBy: status
```

Alles wat Plainva-specifiek is (kleuren, bordweergave, relaties, opslagmap) staat onder `plainva:`-sleutels.

## .base-bestanden rechtstreeks bewerken (tools en KI)

Als een script of een KI-assistent `.base`-bestanden schrijft zonder de weg via Plainva te gaan, gelden drie harde regels — bij een overtreding weigert Obsidian het hele bestand te openen:

- **Alleen de top-level sleutels `filters`, `formulas`, `properties`, `views`.** Voeg nooit een andere top-level sleutel toe; alle Plainva-extra's staan onder geneste `plainva:`-subsleutels.
- **Elke weergave heeft een niet-lege string-`name`.**
- **Een `filters`-object draagt per niveau exact één van `and` / `or` / `not`** (nooit twee naast elkaar).

Nog een valkuil: eigenschaps-id's zijn `note.`-geprefixt in de `properties:`-map en in de `order`/`sort` van een weergave (`note.status`), maar **bare** binnen filterexpressies (`status == "Done"`) en binnen `plainva`-subsleutels (`groupBy: status`).

Het volledige contract voor op de schijf — elk veld, het complete tweezijdige relatievoorbeeld en de regels voor veilig bewerken — staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

## En Obsidian?

Het formaat komt overeen met Obsidians Bases-formaat; Plainva schrijft zijn uitbreidingen uitsluitend in `plainva:`-subsleutels, die Obsidian negeert ("graceful degradation"):

- Obsidian opent het bestand foutloos; Plainva-only weergaven zoals Bord/Kalender/Tijdlijn verschijnen daar als gewone tabel.
- Omgekeerde-relatiekolommen verschijnen leeg in Obsidian (ze zijn berekend); relatiewaarden in notities zijn daar zichtbaar als klikbare links.
- Bij het eerste gebruik van een Plainva-uitbreiding wijst een dialoogvenster (**Plainva-extensie**) hierop; uit te schakelen onder **Instellingen** via **Uitgebreide databases** of **Waarschuwingen**.

## Zie ook

- [Bestandsformaat-referentie](File_Format_Reference.md) — het exacte `.base`-contract op schijf voor tools en handmatig bewerken
- [Notities & Markdown](Notes_and_Markdown.md) — eigenschappen/frontmatter in detail
- [OKF](OKF.md) — wat een uniform `type` je in de praktijk oplevert
