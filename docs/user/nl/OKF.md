# OKF — Open Knowledge Format

Laatst bijgewerkt: 2026-08-21

OKF (Open Knowledge Format) is een open conventie voor Markdown-kenniscollecties: pure Markdown-bestanden met een kleine, uniforme frontmatter-kop. Deze pagina legt uit wat OKF is, wat Plainva daarvoor automatisch doet — en waarom je er niets van *hoeft* te gebruiken.

## Wat is OKF?

Het idee: elk document in de vault zegt zelf wat het is. Daarvoor volstaat een minimale kop in de frontmatter:

```markdown
---
type: Note
---
# Mijn notitie
```

- **`type`** — welk soort document dit is (bijv. `Note`, `Daily Note`, `Project`). Het enige verplichte veld van de conventie.
- **`okf_version`** — de versie van de conventie die de vault volgt. Ze staat **eenmalig**, in de root-`index.md` (momenteel `"0.2"`), niet in elke notitie.
- **`index.md`** — elke map mag één `index.md` bevatten als inhoudsopgave; de namen `index.md` en `log.md` zijn hiervoor gereserveerd en mogen niet worden gebruikt voor gewone notities.

> Schrijf je bestanden met een tool of script? Het exacte veldcontract — toegestane waarden, hoe elk eigenschapstype serialiseert, en de regels voor gereserveerde namen — staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

**Waar OKF vandaan komt:** OKF is een open specificatie van Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), Apache-2.0-licentie). Plainva volgt **OKF 0.2** (gepubliceerd op 25 juli 2026). Nieuw in 0.2 zijn vijf optionele velden waarmee een notitie kan zeggen waar ze vandaan komt, of iemand haar heeft gecontroleerd en of ze nog geldig is — `generated`, `verified`, `sources`, `stale_after` en `status`. Wat Plainva daarvan toont en schrijft, staat hieronder beschreven onder "Herkomst, controle en levenscyclus".

## Waarom gebruikt Plainva OKF?

Gewone Markdown is fantastisch draagbaar — maar heeft op zichzelf geen betrouwbare structuur. OKF voegt daar precies genoeg van toe, en alles blijft gewoon Markdown met standaard frontmatter:

- **Databases, filters en sjablonen kunnen op structuur vertrouwen.** Elke notitie heeft een `type`, waardoor `.base`-weergaven over gewone bestanden robuust blijven.
- **Mappen blijven navigeerbaar.** Een `index.md`-inhoudsopgave per map werkt voor mensen én tools.
- **Scripts en AI-assistenten kunnen veilig met je vault werken**, omdat het formaat op schijf uniform en gedocumenteerd is.
- **Geen lock-in.** OKF is een open conventie bovenop gewone Markdown — andere OKF-tools begrijpen je bestanden, vandaag en over tien jaar.

## Wat Plainva automatisch doet

**Nieuwe bestanden** krijgen de OKF-kop automatisch: elke in Plainva aangemaakte notitie krijgt `type` in de frontmatter — sinds OKF 0.2 staat de versiemarkering `okf_version` eenmalig in de root-`index.md`, niet meer in elke notitie. Welke waarden, stel je per vault in: **Instellingen → Vault → Inhoud en structuur → OKF (Open Knowledge Format)** → **type voor nieuwe notities** (standaard `Note`) en **type voor dagelijkse notities** (standaard `Daily Note`). Brengt een sjabloon een eigen `type` mee, dan wint het sjabloon.

**Bestaande bestanden worden nooit ongevraagd gewijzigd.** Plainva voegt OKF-velden alleen toe bij het aanmaken van nieuwe bestanden of wanneer je de conversie expliciet start.

**Beschermde systeemvelden:** in het paneel **Eigenschappen** zijn `type` en — waar oudere notities het nog dragen — `okf_version` gemarkeerd als OKF-systeemvelden ("OKF-systeemveld – wordt beheerd door Plainva"): de `type`-waarde is kiesbaar uit een vervolgkeuzelijst met bekende typen, `okf_version` is alleen ter weergave; hernoemen, typewijziging en verwijderen zijn vergrendeld zodat de conventie niet per ongeluk kan breken.

**Het uitlegvenster:** **Wat is OKF?** in de instellingen geeft je de korte versie in drie zinnen plus een link naar deze pagina. Het opent niet meer vanzelf; bevat een vault bestanden die niet aan het OKF-formaat voldoen, dan meldt Plainva dat eenmalig in een klein bericht met een knop die je direct naar de conversie brengt.

## Herkomst, controle en levenscyclus (OKF 0.2)

Sinds OKF 0.2 kan een notitie zeggen waar ze vandaan komt, wie haar heeft gecontroleerd en of ze nog geldig is. Plainva maakt daar drie dingen van:

**Wat Plainva toont.**

- Een notitie met `status: draft` of `status: deprecated` draagt een badge in de header van de notitie — **Concept** of **Afgeschaft**. `stable` blijft stil; een eigen `status`-kolom met andere waarden (zeg `Open` in een takendatabase) is geen levenscyclusstatus en krijgt geen badge.
- Zodra `stale_after` is verstreken, staat de melding **Gemarkeerd als verouderd (sinds …)** boven de notitie, met een sprong naar de eigenschappen. De melding is alleen ter weergave — Plainva verandert niets in de notitie.
- De sectie **Vertrouwen en herkomst** van het eigenschappenpaneel (op de telefoon: in de contextkaart van de notitie) vat de velden samen en leidt daaruit een vertrouwensniveau af: **Niet geverifieerd**, **Door de machine bevestigd** of **Door een persoon beoordeeld** — plus wie het genereerde, de verified-lijst, bronnen als klikbare links, status en verouderd-na.

**Wat Plainva schrijft.**

- `generated` (en, waar een bron bekend is, `sources`) wordt gezet door precies drie machinale schrijfpaden: de **import** (`plainva-import/<versie>`, één moment per run — het importrapport draagt het ook), **e-mail vastleggen** (`plainva-mail-capture/<versie>`, met het Message-ID van het bericht als bron) en de **takensynchronisatie** (`plainva-task-sync/<versie>`, alleen wanneer die een notitie aanmaakt).
- `verified` wordt alleen geschreven door **Markeren als gecontroleerd** in de sectie **Vertrouwen en herkomst**: Plainva voegt `human:<jouw naam>` met het huidige moment toe aan de lijst — een tweede controle overschrijft de eerste nooit. Je naam wordt eenmaal per vault gevraagd; hij blijft op dit apparaat en is wijzigbaar onder **Instellingen → Vault → Inhoud en structuur → Naam van de controleur**.
- De editor raakt geen van deze velden ooit uit zichzelf aan, en bestaande notities krijgen nooit achteraf een stempel. `status` en `stale_after` stel je zelf in, als eigenschap of in de frontmatter.

**De bundleversie bijwerken.** De versie van de conventie staat eenmalig in de root-`index.md`. Een vault die nog `"0.1"` declareert, blijft ongewijzigd werken — onder **Instellingen → Vault → Inhoud en structuur → Bundleversie** (op de telefoon: **Instellingen → Vault → Onderhoud → Bundleversie**) til je hem met **Bijwerken…** naar 0.2. Het dialoogvenster toont vooraf wat er verandert: de regel in de root-`index.md` en, als selectievakje (standaard aan), het verwijderen van het verouderde `okf_version`-veld uit de notities die het nog dragen. Elk bestand krijgt eerst een back-up voordat het verandert; **Opschonen…** doet alleen het tweede deel. De veldtabel en de schrijfregels in detail staan in de [Bestandsformaat-referentie](File_Format_Reference.md).

## index.md: de inhoudsopgave per map

Een `index.md` is de inhoudsopgave van een map: een lijst van de bevatte notities en submappen, met beschrijvingen en relatieve links.

- **Genereren** — altijd op jouw actie, nooit zomaar uit het niets: rechtsklik op een map → **index.md genereren/vernieuwen**, of gebundeld via het **index.md-beheer** (**Instellingen → Vault → Inhoud en structuur**).
- **Overnemen in plaats van genereren** — heb je al overzichtsnotities (MOC, Overzicht, mapnotitie, README …), dan stelt het beheer ze voor als kandidaten. **Overnemen** hernoemt het bestand naar `index.md` (links worden vault-breed bijgewerkt) en kan het optioneel voorbereiden voor OKF.
- **Automatisch bijhouden** — listings die door Plainva *gegenereerd* zijn, dragen aan het einde van het bestand een onzichtbare markering (een HTML-commentaar). Alleen zulke gemarkeerde bestanden houdt Plainva automatisch actueel zodra er iets in de map verandert — en alleen in OKF-vaults (herkenbaar aan `okf_version` in de root-`index.md`).
- **Alleen-lezen met een uitweg** — beheerde index.md-bestanden openen in leesmodus met de banner "Deze index.md wordt beheerd door Plainva en automatisch bijgewerkt." Daar kun je **Vernieuwen** — of kiezen voor **Toch bewerken**: dat verwijdert de markering en het bestand is weer helemaal van jou (geen automatische updates meer).
- **Alles tegelijk** — **Alle index.md bijwerken** is beschikbaar in het contextmenu van de vault-hoofdmap en in de instellingen; bestanden zonder markering worden daarbij overgeslagen.
- **Gaten opvullen** — in het index.md-beheer selecteert **index.md maken in de mappen zonder** vooraf elke map die nog geen index.md heeft, zodat je ze allemaal in één keer kunt aanmaken.
- **Op de telefoon** — hetzelfde, via twee deuren: een map lang indrukken biedt **Overzicht maken** of **Overzicht bijwerken**, al naar gelang wat die map nodig heeft. Voor de zeldzame ronde over de hele kluis is er **Instellingen → Vault → Onderhoud → Overzichten**: mappen zonder overzicht staan bovenaan, en **index.md maken in de N mappen zonder** maakt ze in één keer aan. Een map waarvan je de `index.md` zelf hebt geschreven staat in de lijst en wordt met rust gelaten — overnemen is een benoemde keuze in die lijst, nooit het neveneffect van een tik. Het automatisch bijhouden draait nu ook op de telefoon: een kluis die daar bewerkt wordt, veroudert niet meer tot een desktop hem opent.
- In leesmodus worden beheerde listings weergegeven als kaarten met bestands-/mapiconen; links openen rechtstreeks in Plainva.

## Een bestaande vault converteren (opt-in)

Als bestanden in de vault niet voldoen aan het OKF-formaat (ontbrekend `type`-veld, of gereserveerde namen gebruikt als gewone notitie), biedt Plainva de conversie aan — eenmalig bij het openen van de vault en permanent onder **Instellingen → Vault → Inhoud en structuur** (het item verschijnt alleen zolang er iets te doen is).

De wizard **Naar OKF-formaat converteren** werkt in duidelijke stappen:

1. **Scannen** — toont hoeveel bestanden zijn betrokken (sjabloon- en systeemmappen zijn uitgezonderd; bestanden met onleesbare frontmatter worden overgeslagen, nooit "gerepareerd").
2. **Beslissingen** — een standaard-`type` voor bestanden zonder één; bestaande `type`-waarden kun je **behouden** (aanbevolen — ze zijn al geldige OKF-typen) of hernoemen naar een ander veld.
3. **Voorbeeld (geen wijzigingen)** — een dry run toont vooraf wat er zou veranderen.
4. **Converteren** — van elk bestand wordt vóór de wijziging een back-up gemaakt naar `.plainva/backups/`; een rapport vat samen wat er is gewijzigd, overgeslagen en waar de back-upmap staat. Daarna kun je optioneel **verdergaan naar het index.md-beheer**.

Een tip uit de wizard: wijzigingen lopen zoals gebruikelijk via de synchronisatie — bij git-vaults eerst committen.

### Op de telefoon

Dezelfde weg bestaat ook mobiel: **Instellingen → Vault → Onderhoud → Naar OKF-formaat omzetten**. De stappen zijn dezelfde — scan, keuzes, voorbeeld, omzetten — en het voorbeeld noemt de betrokken notities met naam voordat er iets wordt geschreven.

Er komen twee dingen bij, omdat een telefoon een app op elk moment uit het geheugen mag halen:

- **Pauzeren en doorgaan.** De run stopt bij het volgende bestand wanneer je op **Pauze** tikt of de app naar de achtergrond gaat. Doorgaan schrijft in dezelfde back-upmap — er komt geen tweede bij.
- **Bij de start gevraagd.** Blijft een run onafgemaakt, dan zegt Plainva dat de volgende keer dat je de vault opent en biedt **Doorgaan** of **Terugdraaien** aan; **Later** is een geldig antwoord. Een onderbroken run laat een deels omgezette vault achter, geen kapotte: er worden alleen frontmatter-velden toegevoegd en elke notitie blijft geldige Markdown.

**Terugdraaien** zet de bestanden terug uit de back-upmap — op de desktop ook, vanuit het rapport aan het eind van de run. De back-upmap blijft daarna staan; het is de enige kopie van de toestand vóór de omzetting.

## Moet ik OKF gebruiken?

Nee. OKF is een zachte standaard:

- Nieuwe bestanden krijgen de kop automatisch — dat stoort nergens en kost niets.
- Bestaande vaults (bijv. uit Obsidian) blijven ongewijzigd werken; de conversie is strikt opt-in.
- Een ontbrekende `okf_version` — of een die oudere notities nog dragen — telt niet als overtreding; je kunt Plainva en Obsidian permanent naast elkaar gebruiken zonder gezeur.
- Obsidian en elke andere editor kunnen alle bestanden nog steeds openen: het is en blijft gewoon Markdown.

## Zie ook

- [Bestandsformaat-referentie](File_Format_Reference.md) — het exacte contract op schijf voor elk vault-bestand
- [Notities & Markdown](Notes_and_Markdown.md) — frontmatter en eigenschappen
- [Databases (.base)](Databases_Base.md) — wat een uniform `type` je in de praktijk oplevert
- [FAQ & probleemoplossing](FAQ.md) — onder meer back-ups en alleen-lezen index.md
