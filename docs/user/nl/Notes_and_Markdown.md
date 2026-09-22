# Notities & Markdown

Laatst bijgewerkt: 2026-09-20

Elke notitie in Plainva is een gewoon Markdown-bestand (`.md`). Deze pagina legt uit hoe je comfortabel schrijft en wat er daadwerkelijk in het bestand terechtkomt — want juist dat maakt je notities draagbaar: elke teksteditor, Obsidian of een git-diff kan ze lezen.

## Het grondbeginsel: alles is tekst

Wat je in Plainva ziet — opgemaakte tekst, tabellen, eigenschappen, iconen — wordt opgeslagen als open tekst:

```markdown
---
type: Note
tags: [project]
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# Mijn project

Een **vette** gedachte met een link naar [[Andere notitie]].

- [ ] Eerste taak
```

Het blok tussen de `---`-regels heet **frontmatter** (YAML): daar staan de eigenschappen van de notitie. Daaronder volgt de gewone Markdown-tekst. Plainva-eigen weergave (icoon, headerkleur) staat gebundeld onder de sleutel `plainva:` — andere programma's negeren die gewoon.

## Schrijven in Live-voorbeeld

**Live-voorbeeld** is de standaardmodus: Markdown wordt gerenderd terwijl je typt, maar blijft op elk moment bewerkbaar.

### Het slash-menu

Typ `/` aan het begin van een regel om het invoegmenu te openen. Het is gegroepeerd in secties:

- **Basisblokken** — Tekst, Kop 1–6, Opsomming, Genummerde lijst, Takenlijst, Citaat, Codeblok, Tabel, Scheidingslijn, **Formule (LaTeX)**, **Mermaid-diagram**
- **Opmaak** — Vet, Cursief, Doorhalen, Inline-code, Markering, **Emoji**
- **Links & media** — Link, Interne link, Afbeelding (web), Interne afbeelding, Insluiten, Database insluiten, Inline-database aanmaken
- **Document** — Documenticoon, Headerkleur, Sjabloon invoegen
- **Callouts** — 13 varianten (Notitie, Info, To-do, Samenvatting, Tip, Succes, Vraag, Waarschuwing, Mislukking, Gevaar, Bug, Voorbeeld, Citaat)

### Meer schrijfhulpjes

- **Selectie-werkbalk** — selecteer wat tekst en een kleine balk biedt **Vet**, **Cursief**, **Doorhalen**, **Inline-code**, **Markering** en **Link** aan.
- **`@`-vermeldingen** — typ `@` ergens in de tekst om een **Datum** (Vandaag, Morgen, Gisteren of **Kies een datum…**, opgeslagen als ISO-datum), een link naar een **Notitie** of een **Database**-insluiting toe te voegen.
- **Emoji** — het slash-commando **Emoji** (`/emoji`) opent een emojikiezer bij de cursor; of typ `:name` (bijvoorbeeld `:rocket`) voor inline-suggesties. In beide gevallen voegt Plainva het eigenlijke **emojiteken** in (draagbare Unicode), nooit een `:shortcode:` — zodat de notitie leesbaar blijft in Obsidian, op GitHub en overal elders. (Dit is iets anders dan het **Documenticoon** van de notitie, dat wordt opgeslagen in de frontmatter.)
- **Blokgrepen** — bij het overgaan met de muis verschijnt links van elke alinea een greep: sleep hem om het blok te verplaatsen, klik erop om **Blokacties** te openen (**Omzetten in** Tekst/Kop/Lijst/To-do/Citaat/Codeblok, **Dupliceren**, **Omhoog**/**Omlaag**, **Blok verwijderen**). Als je een lijst naast een andere lijst van hetzelfde soort sleept, voegt Plainva een onzichtbare scheidingsregel `<!-- -->` toe zodat beide lijsten gescheiden blijven — in Markdown zouden gelijksoortige lijsten anders ondanks de lege regel samensmelten (ook in Obsidian).
- **Tabellen** — weergegeven als widget met klik-om-te-bewerken-cellen. De celweergave rendert opmaak (**vet**, *cursief*, `code`, markering), klikbare links (`[[Interne link]]`, webadressen) en `<br>` als regeleinde; tijdens het bewerken zie je de ruwe tekst. Het tabelmenu biedt rijen/kolommen invoegen en verwijderen plus uitlijning (**Links uitlijnen**/**Centreren**/**Rechts uitlijnen**).
- **Lijsten zetten zichzelf voort** (Enter voegt het volgende lijstteken in), codeblokken krijgen taalbewuste kleuraccentuering (ook in de leesmodus), geplakte inhoud wordt omgezet naar Markdown (smart paste), en koppen kunnen worden ingeklapt.
- **Lijsten invouwen** — een klik op het opsommingsteken van een item met subitems vouwt ze in; het teken krijgt de accentkleur en een „…” markeert de plek, een tweede klik vouwt weer uit. Het bestand verandert nooit. De tekens wisselen per niveau (• ◦ ▪) en vervolgregels staan precies onder de tekst van hun item — ook op de telefoon, waar het teken de enige vouwknop is.
- **Scrollpositie** — elke notitie opent waar je haar verliet; per apparaat onthouden, niet gesynchroniseerd.
- **Zoeken & vervangen** binnen de huidige notitie: `Ctrl+F` (zie [Zoeken](Search.md)).

## Links en backlinks

- **Interne links**: `[[Notitienaam]]` (wiki-link) — via het slash-menu of `@` met ingebouwde notitiezoekfunctie. Klassieke Markdown-links `[tekst](pad.md)` werken ook.
- **Links naar een sectie**: `[[Notitie#Kop]]` opent de notitie bij die kop, `[[#Kop]]` springt binnen de huidige notitie, en `[tekst](#kop)` in GitHub-stijl doet hetzelfde — zowel de letterlijke koptekst als de slug (`cool-header`) worden opgelost; `[[Notitie#^id]]` bereikt een regel die eindigt op `^id`. Bij het typen van `[[Notitie#` worden de koppen van de notitie aangeboden. Een kop die niet meer bestaat zegt dat in een melding in plaats van niets te doen.
- **Doelen die nog niet bestaan**: Een wiki-link naar een notitie die nog niet is aangemaakt, wordt **gedempt met een gestreepte onderstreping** weergegeven (zowel in het live-voorbeeld als in de leesmodus). **Erop klikken maakt de notitie aan** en opent hem — in de map van de huidige notitie (of op het opgegeven pad als de link er een bevat, bijv. `[[Map/Nieuwe notitie]]`). Om eerst te worden gevraagd, schakel je **Instellingen → App → Editor en notities → Vragen voordat lege links worden aangemaakt** in.
- **Backlinks**: De sectie **Backlinks** in de rechterzijbalk toont welke notities naar de actieve notitie linken — gegroepeerd per bronbestand, met een teller bij meerdere voorkomens. Onder elk bestand staat elk voorkomen met de koppen en lijstitems erboven en de regel zelf; een klik springt er direct heen. Op de telefoon toont het contextblad van de notitie dezelfde plekken. De rijen staan op **Titel**; de sorteerknop erboven wisselt naar **Laatst gewijzigd** of **Aantal links**, dezelfde sleutel nogmaals kiezen keert de richting om, en de keuze wordt op dit apparaat onthouden.
- **Hernoemen met linkzorg**: Wanneer je een bestand hernoemt in de bestandsboom, werkt Plainva elke link ernaartoe bij in de hele vault (ankers zoals `#Sectie` blijven behouden) en meldt: "N link(s) in M bestand(en) zijn bijgewerkt naar de nieuwe naam."
- **Tags**: `#project` — of genest, `#project/website` — ergens in de tekst is een tag. Hij staat er als een kleine pil, tijdens het schrijven en tijdens het lezen, en een klik erop opent de notities die hem dragen (op de telefoon: een tik in de leesmodus). Wat als tag telt en hoe tags een kleur krijgen: [Zoeken](Search.md).

## Eigenschappen (frontmatter)

De sectie **Eigenschappen** in de rechterzijbalk toont de frontmatter van de notitie als formulier. Met **Eigenschap toevoegen** maak je nieuwe aan; elke eigenschap heeft een **Veldtype**:

| Groep | Typen |
|---|---|
| **Basis** | Tekst, Getal, Selectievakje, Datum, Datum & tijd |
| **Keuze** | Selectie, Status, Multiselectie |
| **Lijsten & relaties** | Lijst, Tags, Relatie |
| **Web & contact** | URL, E-mail, Telefoon |

Keuzetypen kunnen vaste opties dragen met een **Kleur** en (bij **Status**) een **Groep**/fase — deze optielijsten worden beheerd in databases (`.base`), zie [Databases (.base)](Databases_Base.md).

Beschermd zijn de **OKF-systeemvelden** die Plainva beheert: `type` (de waarde is kiesbaar uit een vervolgkeuzelijst met bekende typen, naam/veldtype/verwijderen zijn vergrendeld) en — waar oudere notities het nog dragen — `okf_version` (alleen ter weergave; sinds OKF 0.2 hoort het veld alleen nog thuis in de root-`index.md`). Achtergrond: [OKF](OKF.md).

### Status, verouderd-melding en controlemarkering (OKF 0.2)

Vijf optionele eigenschappen uit OKF 0.2 laten een notitie zeggen waar ze vandaan komt en of ze nog geldig is — Plainva toont ze zonder enige instelling:

- **Statusbadge:** draagt een notitie `status: draft` of `status: deprecated`, dan toont de header van de notitie de badge **Concept** of **Afgeschaft**. `stable` blijft stil. Een eigen `status`-kolom met andere waarden (zeg `Open`) blijft ongemoeid — het is een gewone eigenschap en krijgt geen badge.
- **Verouderd-melding:** zodra `stale_after` is verstreken, verschijnt **Gemarkeerd als verouderd (sinds …)** boven de notitie, met **Eigenschappen openen**. De melding verandert niets aan de notitie; ze herinnert alleen.
- **Vertrouwen en herkomst:** een eigen sectie in het eigenschappenpaneel vat `generated` (Gegenereerd), `verified` (Geverifieerd), `sources` (Bronnen, klikbaar), `status` en `stale_after` (Verouderd na) samen en leidt daaruit een niveau af — **Niet geverifieerd**, **Door de machine bevestigd** of **Door een persoon beoordeeld**.
- **Markeren als gecontroleerd:** de knop in die sectie voegt je naam met het huidige moment toe aan de verified-lijst (`human:<naam>`); Plainva vraagt de naam eenmaal per vault en bewaart hem alleen op dit apparaat (wijzigbaar onder **Instellingen → Vault → Inhoud en structuur → Naam van de controleur**). Op de telefoon staat dezelfde actie in de contextkaart van de notitie.

Plainva zet `generated` en `sources` alleen waar het zelf notities aanmaakt — in de import, bij e-mail vastleggen en in de takensynchronisatie; de editor stempelt nooit, en bestaande notities krijgen geen stempel achteraf. Het veldcontract staat in de [Bestandsformaat-referentie](File_Format_Reference.md), de achtergrond onder [OKF](OKF.md).

## Documenticoon en headerkleur

Elke notitie kan een icoon dragen (Notion-achtig boven de titel, ook zichtbaar in tabbladen en de bestandsboom) en een kleurstreep over de volledige breedte:

- In Live-voorbeeld, ga met de muis boven de titel hangen: **Icoon toevoegen** / **Headerkleur toevoegen** (later: **Icoon wijzigen** / **Headerkleur wijzigen**) — of gebruik de slash-commando's **Documenticoon** en **Headerkleur**.
- De icoonkiezer kent twee modi — **Emoji** en **Iconen** — die je op dezelfde manier bedient: één kopzone, één zoekveld, **categorieën** (tabs) in beide modi en een sectie **Recent gebruikt** die een herstart overleeft.
- De set omvat ongeveer **400 geselecteerde iconen** in tien categorieën (Kennis & bestanden, Werk & taken, Techniek, Mensen & contact, Creatief & media, Dagelijks & thuis, Natuur & weer, Reizen & plaatsen, Geld & cijfers, Symbolen & toestanden). Zoeken werkt op namen en trefwoorden.
- In de iconenmodus kies je bovenaan een **kleur** — hetzelfde palet als de kopstrook, **A** voor de standaardkleur en de schijf met de kleurring (**Eigen kleur …**) voor een vrije waarde; die geldt voor het icoon dat je daarna aantikt. Hetzelfde raster zie je overal waar Plainva om een kleur vraagt, ook op de telefoon.
- Beide worden opgeslagen in de frontmatter onder `plainva:` (`icon`, `icon_color`, `header_color`) — pure weergave die andere programma's niet stoort.

## Sjablonen

Stel een **Sjablonenmap** in onder **Instellingen → Vault → Inhoud en structuur** (met **Map kiezen…** naast het veld kies je de map direct in de vault). Voeg sjablonen dan in via `Ctrl+Alt+T` of het slash-commando **Sjabloon invoegen**. Sjablonen bepalen de inhoud van nieuwe bestanden volledig — inclusief frontmatter: als een sjabloon een eigen `type` meebrengt, wint het sjabloon. Bij invoegen in een bestaande notitie blijft de frontmatter van het sjabloon achterwege — alleen de inhoud wordt ingevoegd.

**Plaatshouders**: sjablonen vullen benoemde plaatshouders in — geen scripts, geen expressies; niets daarvan voert code uit.

| Plaatshouder | Wat het invoegt |
| --- | --- |
| `{{title}}` | De titel van de notitie |
| `{{date}}`, `{{time}}` | Datum en tijd; met je eigen opmaak: `{{date:DD.MM.YYYY}}` |
| `{{date+7}}`, `{{date-1}}` | Een verschoven datum, combineerbaar met een opmaak |
| `{{yesterday}}`, `{{tomorrow}}` | De dag ervoor, de dag erna |
| `{{weekday:monday}}`, `{{weekday:next friday}}` | Die weekdag van deze of de volgende week; een opmaak volgt na een tweede dubbele punt: `{{weekday:monday:DD.MM.}}`. Wanneer de week begint, hangt af van je kalenderinstelling |
| `{{daily}}`, `{{daily+1}}`, `{{daily-1}}` | Een link naar de dagnotitie van vandaag, morgen of gisteren; met je eigen label: `{{daily+1:Morgen}}` |
| `{{folder}}`, `{{vault}}` | De map van de notitie, de naam van de vault |
| `{{cursor}}` | Geen tekst — markeert waar de cursor daarna terechtkomt |
| `{{prompt:Label}}`, `{{prompt:Label\|Default}}` | Vraagt je om tekst (weergegeven als *Label*) |
| `{{select:Label\|A,B,C}}` | Vraagt je met een lijst met keuzes |
| `{{date_prompt:Label}}` | Vraagt je om een datum |
| `{{selection}}` | De geselecteerde tekst — bij het invoegen van een sjabloon |
| `{{clipboard}}` | Het klembord — het komt aan als een **vooraf ingevulde vraag**, nooit onopgemerkt in de notitie |
| `\{{date}}` | De plaatshouder zelf, onopgelost |

**Taal van datums**: namen van weekdagen en maanden (`dddd`, `MMMM`) volgen de taal van de app — in een Duitse interface schrijft `{{date:dddd, D. MMMM YYYY}}` dus *Mittwoch, 29. Juli 2026*. De **bestandsnaam** van een dagnotitie blijft bewust Engels: die moet overeenkomen met het formaat waarmee hij is aangemaakt, anders vindt Plainva bestaande dagnotities niet meer terug.

Als een sjabloon iets vraagt, stelt Plainva **alle** vragen in één dialoogvenster, voordat de notitie wordt geschreven — of je nu invoegt of aanmaakt; annuleren maakt niets aan. Alleen bij notities die op de achtergrond ontstaan (bijvoorbeeld bij het synchroniseren van taken) wordt nooit iets gevraagd: daar blijven de antwoorden leeg. Een plaatshouder die Plainva niet kent, blijft zichtbaar staan — zo ziet een typefout eruit als een typefout.

**Op de telefoon** werkt dezelfde engine: de plaatshouders worden ingevuld, de vragen van een sjabloon verschijnen samen in één blad (annuleren maakt niets aan), en de koppelingen map → sjabloon en notitietype → sjabloon gelden ook daar — een notitie in `Projekte/` begint dus op beide apparaten hetzelfde. Twee verschillen: de koppelingen worden op de desktop gemaakt (de telefoon past de regels alleen toe), en `{{weekday:…}}` rekent daar altijd vanaf maandag, omdat de instelling voor het begin van de week op mobiel nog niet bestaat.

**Instellingen die alleen voor het sjabloon gelden**: een sjabloon kan instellingen dragen die alleen op het sjabloon zelf slaan — dat zijn taken buiten het **Taken**-overzicht blijven, of bij welke databases het hoort. Een notitie die eruit ontstaat erft ze niet. Zeer oude dagelijkse notities kunnen ze nog dragen; de [FAQ](FAQ.md) legt uit hoe je ze vindt.

**Sjablonen per map**: onder **Instellingen → Vault → Inhoud en structuur → Sjablonen** koppel je een map aan een sjabloon — elke nieuwe notitie die daar wordt aangemaakt, start dan vanuit dat sjabloon, zonder dat je iets hoeft te kiezen. De koppeling geldt ook voor submappen; komen er meerdere overeen, dan wint het langste pad (`Projecten/Klanten` wint van `Projecten`). Op dezelfde manier koppel je een sjabloon aan een **notitietype**; dat geldt wanneer geen enkele mapregel de notitie dekt — map wint van type. **Nieuwe notitie vanuit sjabloon …** (rechtsklik in de bestandsboom, het opdrachtenpalet of de snelkiezer) laat je er expliciet één kiezen — dat wint van elke koppeling. De koppelingen leven in de instellingen, niet in de notities, en reizen via de instellingensynchronisatie mee naar je andere apparaten.

Sjablonen maken kan overal vandaan: de opdrachtenpalet (`Ctrl+P`) biedt **Nieuw sjabloon maken** (een nieuw sjabloon opent om te bewerken) en **Huidige notitie opslaan als sjabloon** (kopieert de open notitie naar de sjablonenmap). Sjablonen zijn gewone Markdown-bestanden — bewerk, hernoem of verwijder ze direct in de bestandsboom.

## Dagelijkse notities

**Dagnotitie openen** (zijbalk) of een klik in de **Kalender** maakt de notitie van vandaag aan volgens je **datumformaat** in de ingestelde **basismap voor dagelijkse notities**, optioneel vanuit een sjabloon.

Een dagnotitie kan ook een **journaal** bevatten: korte items met een tijdstip (`- 14:05 Tekst`) onder de kop **Journal**, geschreven met `Ctrl+Shift+J` of **Journaalitem** en gelezen over alle dagen heen in de journaalweergave. Het zijn gewone lijstregels — zie [Journaal](Journal.md).

## Taken, formules, diagrammen en voetnoten

- **Taakvakjes**: `- [ ] taak` wordt overal weergegeven als selectievakje — en in **leesmodus** kun je erop klikken: Plainva schrijft `[x]` of `[ ]` terug in het bestand. Een afgeronde taak staat er gedempt en doorgestreept — in de notitie net als in de takenweergave.
- **Callouts**: een citaat dat begint met `> [!tip] Titel` (of een van de 13 varianten uit het slash-menu) staat er als één kaart — een fijne lijn in de kleur van de callout, een lichte tint en de titel in die kleur; zonder titel toont de kaart de naam van haar variant. Het ziet er hetzelfde uit in het live-voorbeeld, in de leesmodus en op de telefoon; een gewoon citaat houdt zijn balk.
- **Geneste lijsten**: vanaf het tweede niveau toont een fijne lijn onder elk bovenliggend punt welke items bij elkaar horen — in het live-voorbeeld en in de leesmodus.
- **Wiskunde (LaTeX)**: `$E = mc^2$` inline en `$$…$$` als blok worden in leesmodus ÉN in het live-voorbeeld als formule weergegeven (KaTeX). Staat de cursor in de formule, dan blijft de syntaxis zichtbaar; klik op een gerenderde formule om hem te bewerken. Alleen de broncodemodus toont altijd de ruwe syntaxis. Je hoeft het `$$…$$`-blok niet uit je hoofd te kennen — het slash-commando **Formule (LaTeX)** (`/katex`) voegt het in en plaatst de cursor erin.
- **Mermaid-diagrammen**: een codeblok met de taal `mermaid` (het snelst via het slash-commando **Mermaid-diagram**, `/mermaid`) wordt in leesmodus en in het live-voorbeeld als diagram getekend — klik op het diagram om de code te bewerken:

  ````markdown
  ```mermaid
  graph TD
    Idea --> Note --> Knowledge
  ```
  ````

- **Voetnoten**: `Tekst[^1]` plus `[^1]: De voetnoot.` aan het einde — leesmodus rendert de verwijzing en het voetnotenapparaat met sprongmarkeringen. Het snelst gaat het via het slash-commando **Voetnoot** (`/footnote`): het voegt de eerstvolgende vrije verwijzing in en springt meteen naar de definitie aan het einde van de notitie.

## Afdrukken en opslaan als PDF

Het **⋮**-menu van de editor en de opdrachtenpalet (`Ctrl+P`) bevatten **Afdrukken / Opslaan als PDF…**: afdrukken gebruikt altijd de leesweergave (vanuit live/bron schakelt Plainva daar eerst naartoe over). In het systeemdialoogvenster kun je in plaats van een printer "Opslaan als PDF" kiezen.

## Notitie exporteren

- **Exporteren als Markdown…** (**⋮**-menu van de editor of opdrachtenpalet): slaat via het systeemdialoogvenster een kopie van de notitie op naar een locatie naar keuze — bijvoorbeeld om de notitie aan een ander programma te geven. Gekoppelde bijlagen (afbeeldingen) worden niet meegekopieerd; als de notitie daarnaar verwijst, toont Plainva een korte melding. Heeft de notitie open annotaties, dan vraagt Plainva eerst **Annotaties meenemen?** — **Als lijst aan het einde (overal leesbaar)** of **Gemarkeerd in de tekst (CriticMarkup)**; de onzichtbare ankermarkeringen verdwijnen in elk geval.
- **PDF**: gebruik **Afdrukken / Opslaan als PDF…** (hierboven) en kies in het systeemdialoogvenster "Opslaan als PDF".

## Notitie openen in een andere editor

Je notities zijn gewone `.md`-bestanden, dus elke Markdown-editor kan ze openen. Het **⋮**-menu van de editor bevat **Openen in standaardapp**, waarmee de huidige notitie wordt doorgegeven aan het programma dat je systeem gebruikt voor Markdown-bestanden (Byword, MacDown, VS Code enzovoort). Plainva blijft het bestand in de gaten houden, zodat wijzigingen die je daar aanbrengt hier automatisch verschijnen.

## Afbeeldingen en bijlagen

- **Invoegen**: slash-commando's **Interne afbeelding** (zoeken & insluiten vanuit de vault) of **Afbeelding (web)** (via URL). Ook: **plak** eenvoudig een bestand vanuit het klembord (Ctrl+V) — een afbeelding net zo goed als een PDF of een spreadsheet. En je kunt **bestanden vanuit de bestandsverkenner naar de editor slepen**: afbeeldingen worden ingesloten (`![[…]]`), andere bestanden worden gekopieerd en gekoppeld (`[[…]]`). Waar deze bestanden terechtkomen is een instelling: **Instellingen → Jouw kluis → Inhoud en structuur → Bijlagenmap** (standaard `Attachments`, met een mappenbrowser). Laat leeg om ze naast de notitie te houden, zoals Plainva deed vóór deze instelling. De map reist mee met de instellingssynchronisatie, dus computer en telefoon bewaren bijlagen op dezelfde plek.
- **Bestand bijvoegen…**: het slash-commando **Bestand bijvoegen…** en dezelfde optie in het **⋮**-menu van de notitie openen het bestandsvenster van je systeem; op de telefoon staat het in het **＋**-blad als **Bestand van apparaat…**. Het bestand wordt naar de bijlagenmap gekopieerd — afbeeldingen worden ingesloten (`![[…]]`), al het andere wordt gekoppeld (`[[…]]`).
- **Geluid speelt af**: een ingesloten audiobestand (`.m4a`, `.mp3`, `.wav`, `.ogg`, `.opus`, `.webm`, `.flac`, `.aac`) toont een speler in plaats van zijn naam — in de editor, in de leesmodus, op prikbordkaarten en in journaalregels. Toegevoegd geluid wordt daarom ingesloten als een afbeelding (`![[…]]`) en niet alleen gelinkt. Plainva speelt geen video af; een `.mp4` blijft een link.
- **Koppelen**: typ `[[` en Plainva stelt eerst notities voor, en daaronder, onder **Bijlagen**, de bestanden uit je kluis.
- **Bekijken**: afbeeldingsbestanden (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) openen in de ingebouwde afbeeldingsviewer met **Inzoomen**/**Uitzoomen**, **Passend** en **Ware grootte (1:1)**.
- **Bewerken**: de knop **Bewerken** opent de afbeeldingseditor met **Bijsnijden**, draaien/spiegelen, **Formaat wijzigen**, tekenhulpmiddelen (**Pen**, **Pijl**, **Rechthoek**, **Tekst**) plus **Ongedaan maken**/**Opnieuw**. Sla direct op of gebruik **Als kopie opslaan…**. Bewerkbare formaten zijn PNG, JPG en WebP; andere formaten openen alleen ter weergave.
- **Tekstbestanden** openen in Plainva zelf: `.txt`, `.csv`, `.json`, `.yaml`, broncode en dergelijke. Heeft je kluis er meer nodig, voeg de extensies dan toe onder **Instellingen → Je kluis → Inhoud en structuur → Meer tekstbestanden** — de lijst kan alleen toevoegen, nooit iets weghalen. Blijkt uit het begin van het bestand dat het toch geen tekst is, dan toont Plainva het niet en biedt het standaardprogramma aan: tonen en opslaan zou het bestand beschadigen. Een zo geopend bestand behoudt bij het opslaan zijn regeleindes en zijn BOM — het is van jou, niet van Plainva. Terwijl je bewerkt, kleurt Plainva de tekst op basis van de bestandsextensie — dezelfde kleuraccentuering die een codeblok in een notitie krijgt. De notitiehulpmiddelen blijven uit: geen Live-voorbeeld, geen eigenschappenheader, geen `[[links]]`, geen "/"-menu. Zoeken en vervangen blijft, want dat is een tekstfunctie en geen notitiefunctie.
- Overige bijlagen openen met één klik in het standaardprogramma van het systeem — in de bestandsboom net zo goed als via een `[[koppeling]]`, een bladwijzer of de zoekfunctie.

## En Obsidian?

Alles blijft standaard Markdown met standaard frontmatter. Obsidian opent de bestanden volledig; het toont de gebundelde `plainva:`-sleutel als niet-bewerkbaar object in het eigenschappenpaneel — dat is bewust en onschadelijk.

## Zie ook

- [Databases (.base)](Databases_Base.md) — notities als tabel, bord of kalender
- [OKF](OKF.md) — wat `type`, de bundleversie en de OKF-0.2-velden betekenen
- [Zoeken](Search.md) en [Sneltoetsen](Keyboard_Shortcuts.md)

## Een selectie opmaken

Als een selectie meerdere regels omvat, worden **vet**, *cursief*, doorhalen, markeren en inline-code afzonderlijk op elke niet-lege regel toegepast. Voorvoegsels voor lijsten, citaten, koppen en taken blijven buiten de markeringen. Links blijven één regel omdat een meerregelig linklabel geen draagbare Markdown is.

Een ATX-kop en een GFM-taak zijn alternatieve bloktypen. Plainva schrijft daarom geen ongeldige combinatie. Inline-opmaak werkt in beide; gebruik `- [ ] **Belangrijke taak**` voor een opvallende taaktitel.

## Secties en blokken insluiten

`![[Notitie#Kop]]` toont de sectie en onderliggende koppen tot de volgende kop van hetzelfde of een hoger niveau. `![[Notitie#^block-id]]` toont de alinea, het lijstitem of het blok vóór een blok-ID op een afzonderlijke regel. Een gewone link `[[Notitie#^block-id]]` springt ook in de leesmodus naar die plek.

Gebruik bij herhaalde koppen een unieke koppenreeks (`#Project#Resultaat`) of een genummerd anker (`#resultaat-1`). Ontbrekende of dubbelzinnige doelen geven een melding; de bron blijft bereikbaar. De nestdiepte is begrensd en codevoorbeelden voeren geen insluitingen uit. Op de telefoon worden secties en blokken niet tot vier regels ingekort zoals de algemene notitievoorvertoning. Bestaande bestanden blijven ongewijzigd.

## Lijsten gebruiken

Een lijstitem klapt pas in na een voltooide tik of klik op het opsommingsteken. Slepen, scrollen, een afgebroken aanraking of een gebaar met meerdere vingers klapt het niet in. De inspringing blijft stabiel bij andere lettertypen en smalle vensters; brontekst, tabs en cursorpositie blijven behouden.

## Selectiewerkbalken blijven zichtbaar

De opmaakwerkbalk volgt je selectie tijdens het scrollen en houdt afstand van de schermranden. Bij weinig ruimte wisselt hij van kant of verdeelt hij de knoppen over meerdere regels. In de mobiele leesmodus worden lange actielabels zo nodig pictogrammen met toegankelijke namen; Kopiëren, Alles selecteren en beschikbare bewerkings- of commentaaracties blijven bereikbaar.

## Eigenschappen aanvullen

Bij het toevoegen verschijnen bekende namen met type en gebruiksaantal. Bestaande en gereserveerde namen worden uitgesloten. Het type van de bijbehorende database gaat voor, daarna het indextype en het lokale typeregister. Suggesties voor tekst en lijsten komen uit de map van de notitie; “In de hele kluis zoeken” vergroot het bereik. Lijsten bieden afzonderlijke waarden. Ingestelde databaseopties blijven exclusief, ook bij een lege lijst. Vrije invoer blijft mogelijk; alleen een bevestigde bewerking verandert de notitie. Tekst en lijsten behouden hun type, in eigenschappen en databasecellen op desktop en mobiel.

### Afbeelding openen

**Afbeelding openen** is beschikbaar voor lokale afbeeldingen in leesmodus, livevoorbeeld en het contextmenu. Gebruik in de mobiele viewer twee vingers, dubbeltikken of de zoomknoppen; **Zoom herstellen** toont de hele afbeelding. Terug brengt je naar de notitie. Lang drukken behoudt de systeemacties en je kunt nog steeds een gebied selecteren voor een opmerking.
