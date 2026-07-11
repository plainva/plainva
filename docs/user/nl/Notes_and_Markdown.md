# Notities & Markdown

Laatst bijgewerkt: 2026-07-11

Elke notitie in Plainva is een gewoon Markdown-bestand (`.md`). Deze pagina legt uit hoe je comfortabel schrijft en wat er daadwerkelijk in het bestand terechtkomt — want juist dat maakt je notities draagbaar: elke teksteditor, Obsidian of een git-diff kan ze lezen.

## Het grondbeginsel: alles is tekst

Wat je in Plainva ziet — opgemaakte tekst, tabellen, eigenschappen, iconen — wordt opgeslagen als open tekst:

```markdown
---
type: Note
okf_version: "0.1"
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
- **Lijsten zetten zichzelf voort** (Enter voegt het volgende lijstteken in), codeblokken krijgen taalbewuste kleuraccentuering, geplakte inhoud wordt omgezet naar Markdown (smart paste), en koppen kunnen worden ingeklapt.
- **Zoeken & vervangen** binnen de huidige notitie: `Ctrl+F` (zie [Zoeken](Search.md)).

## Links en backlinks

- **Interne links**: `[[Notitienaam]]` (wiki-link) — via het slash-menu of `@` met ingebouwde notitiezoekfunctie. Klassieke Markdown-links `[tekst](pad.md)` werken ook.
- **Backlinks**: De sectie **Backlinks** in de rechterzijbalk toont welke notities naar de actieve notitie linken — gegroepeerd per bronbestand, met een teller bij meerdere voorkomens.
- **Hernoemen met linkzorg**: Wanneer je een bestand hernoemt in de bestandsboom, werkt Plainva elke link ernaartoe bij in de hele vault (ankers zoals `#Sectie` blijven behouden) en meldt: "N link(s) in M bestand(en) zijn bijgewerkt naar de nieuwe naam."

## Eigenschappen (frontmatter)

De sectie **Eigenschappen** in de rechterzijbalk toont de frontmatter van de notitie als formulier. Met **Eigenschap toevoegen** maak je nieuwe aan; elke eigenschap heeft een **Veldtype**:

| Groep | Typen |
|---|---|
| **Basis** | Tekst, Getal, Selectievakje, Datum, Datum & tijd |
| **Keuze** | Selectie, Status, Multiselectie |
| **Lijsten & relaties** | Lijst, Tags, Relatie |
| **Web & contact** | URL, E-mail, Telefoon |

Keuzetypen kunnen vaste opties dragen met een **Kleur** en (bij **Status**) een **Groep**/fase — deze optielijsten worden beheerd in databases (`.base`), zie [Databases (.base)](Databases_Base.md).

Twee velden zijn beschermd: `type` en `okf_version` zijn **OKF-systeemvelden** die door Plainva worden beheerd — de `type`-waarde is kiesbaar uit een vervolgkeuzelijst met bekende typen, terwijl naam/veldtype/verwijderen vergrendeld zijn (achtergrond: [OKF](OKF.md)).

## Documenticoon en headerkleur

Elke notitie kan een icoon dragen (Notion-achtig boven de titel, ook zichtbaar in tabbladen en de bestandsboom) en een kleurstreep over de volledige breedte:

- In Live-voorbeeld, ga met de muis boven de titel hangen: **Icoon toevoegen** / **Headerkleur toevoegen** (later: **Icoon wijzigen** / **Headerkleur wijzigen**) — of gebruik de slash-commando's **Documenticoon** en **Headerkleur**.
- De icoonkiezer kent twee modi: **Emoji** en **Iconen** (de Lucide-iconenset, met kiesbare kleur).
- Beide worden opgeslagen in de frontmatter onder `plainva:` (`icon`, `icon_color`, `header_color`) — pure weergave die andere programma's niet stoort.

## Sjablonen

Stel een **Sjablonenmap** in onder **Instellingen → Vault → Inhoud en structuur** (met **Map kiezen…** naast het veld kies je de map direct in de vault). Voeg sjablonen dan in via `Ctrl+Alt+T` of het slash-commando **Sjabloon invoegen**. Sjablonen bepalen de inhoud van nieuwe bestanden volledig — inclusief frontmatter: als een sjabloon een eigen `type` meebrengt, wint het sjabloon. Bij invoegen in een bestaande notitie blijft de frontmatter van het sjabloon achterwege — alleen de inhoud wordt ingevoegd.

Sjablonen maken kan overal vandaan: de opdrachtenpalet (`Ctrl+P`) biedt **Nieuw sjabloon maken** (een nieuw sjabloon opent om te bewerken) en **Huidige notitie opslaan als sjabloon** (kopieert de open notitie naar de sjablonenmap). Sjablonen zijn gewone Markdown-bestanden — bewerk, hernoem of verwijder ze direct in de bestandsboom.

## Dagelijkse notities

**Dagnotitie openen** (zijbalk) of een klik in de **Kalender** maakt de notitie van vandaag aan volgens je datumformaat in de ingestelde map voor dagelijkse notities, optioneel vanuit een sjabloon.

## Taken, formules, diagrammen en voetnoten

- **Taakvakjes**: `- [ ] taak` wordt overal weergegeven als selectievakje — en in **leesmodus** kun je erop klikken: Plainva schrijft `[x]` of `[ ]` terug in het bestand.
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

- **Exporteren als Markdown…** (**⋮**-menu van de editor of opdrachtenpalet): slaat via het systeemdialoogvenster een kopie van de notitie op naar een locatie naar keuze — bijvoorbeeld om de notitie aan een ander programma te geven. Gekoppelde bijlagen (afbeeldingen) worden niet meegekopieerd; als de notitie daarnaar verwijst, toont Plainva een korte melding.
- **PDF**: gebruik **Afdrukken / Opslaan als PDF…** (hierboven) en kies in het systeemdialoogvenster "Opslaan als PDF".

## Notitie openen in een andere editor

Je notities zijn gewone `.md`-bestanden, dus elke Markdown-editor kan ze openen. Het **⋮**-menu van de editor bevat **Openen in standaardapp**, waarmee de huidige notitie wordt doorgegeven aan het programma dat je systeem gebruikt voor Markdown-bestanden (Byword, MacDown, VS Code enzovoort). Plainva blijft het bestand in de gaten houden, zodat wijzigingen die je daar aanbrengt hier automatisch verschijnen.

## Afbeeldingen en bijlagen

- **Invoegen**: slash-commando's **Interne afbeelding** (zoeken & insluiten vanuit de vault) of **Afbeelding (web)** (via URL). Ook: **plak** eenvoudig een afbeelding vanuit het klembord (Ctrl+V) — die wordt naast de notitie opgeslagen en ingesloten. En je kunt **bestanden vanuit de bestandsverkenner naar de editor slepen**: afbeeldingen worden ingesloten (`![[…]]`), andere bestanden worden gekopieerd en gekoppeld (`[[…]]`).
- **Bekijken**: afbeeldingsbestanden (PNG, JPG, GIF, WebP, SVG, BMP, AVIF) openen in de ingebouwde afbeeldingsviewer met **Inzoomen**/**Uitzoomen**, **Passend** en **Ware grootte (1:1)**.
- **Bewerken**: de knop **Bewerken** opent de afbeeldingseditor met **Bijsnijden**, draaien/spiegelen, **Formaat wijzigen**, tekenhulpmiddelen (**Pen**, **Pijl**, **Rechthoek**, **Tekst**) plus **Ongedaan maken**/**Opnieuw**. Sla direct op of gebruik **Als kopie opslaan…**. Bewerkbare formaten zijn PNG, JPG en WebP; andere formaten openen alleen ter weergave.
- Overige bijlagen openen bij dubbelklik in het standaardprogramma van het systeem.

## En Obsidian?

Alles blijft standaard Markdown met standaard frontmatter. Obsidian opent de bestanden volledig; het toont de gebundelde `plainva:`-sleutel als niet-bewerkbaar object in het eigenschappenpaneel — dat is bewust en onschadelijk.

## Zie ook

- [Databases (.base)](Databases_Base.md) — notities als tabel, bord of kalender
- [OKF](OKF.md) — wat `type` en `okf_version` betekenen
- [Zoeken](Search.md) en [Sneltoetsen](Keyboard_Shortcuts.md)
