# OKF — Open Knowledge Format

Laatst bijgewerkt: 2026-07-07

OKF (Open Knowledge Format) is een open conventie voor Markdown-kenniscollecties: pure Markdown-bestanden met een kleine, uniforme frontmatter-kop. Deze pagina legt uit wat OKF is, wat Plainva daarvoor automatisch doet — en waarom je er niets van *hoeft* te gebruiken.

## Wat is OKF?

Het idee: elk document in de vault zegt zelf wat het is. Daarvoor volstaat een minimale kop in de frontmatter:

```markdown
---
type: Note
okf_version: "0.1"
---
# Mijn notitie
```

- **`type`** — welk soort document dit is (bijv. `Note`, `Daily Note`, `Project`). Het enige verplichte veld van de conventie.
- **`okf_version`** — de versie van de conventie waartegen het bestand is geschreven.
- **`index.md`** — elke map mag één `index.md` bevatten als inhoudsopgave; de namen `index.md` en `log.md` zijn hiervoor gereserveerd en mogen niet worden gebruikt voor gewone notities.

> Schrijf je bestanden met een tool of script? Het exacte veldcontract — toegestane waarden, hoe elk eigenschapstype serialiseert, en de regels voor gereserveerde namen — staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

## Waarom gebruikt Plainva OKF?

Gewone Markdown is fantastisch draagbaar — maar heeft op zichzelf geen betrouwbare structuur. OKF voegt daar precies genoeg van toe, en alles blijft gewoon Markdown met standaard frontmatter:

- **Databases, filters en sjablonen kunnen op structuur vertrouwen.** Elke notitie heeft een `type`, waardoor `.base`-weergaven over gewone bestanden robuust blijven.
- **Mappen blijven navigeerbaar.** Een `index.md`-inhoudsopgave per map werkt voor mensen én tools.
- **Scripts en AI-assistenten kunnen veilig met je vault werken**, omdat het formaat op schijf uniform en gedocumenteerd is.
- **Geen lock-in.** OKF is een open conventie bovenop gewone Markdown — andere OKF-tools begrijpen je bestanden, vandaag en over tien jaar.

## Wat Plainva automatisch doet

**Nieuwe bestanden** krijgen de OKF-kop automatisch: elke in Plainva aangemaakte notitie krijgt `type` en `okf_version` in de frontmatter. Welke waarden, stel je per vault in: **Instellingen → Vault-instellingen → OKF (Open Knowledge Format)** → **type voor nieuwe notities** (standaard `Note`) en **type voor dagelijkse notities** (standaard `Daily Note`). Brengt een sjabloon een eigen `type` mee, dan wint het sjabloon.

**Bestaande bestanden worden nooit ongevraagd gewijzigd.** Plainva voegt OKF-velden alleen toe bij het aanmaken van nieuwe bestanden of wanneer je de conversie expliciet start.

**Beschermde systeemvelden:** in het paneel **Eigenschappen** zijn `type` en `okf_version` gemarkeerd als OKF-systeemvelden ("OKF-systeemveld – wordt beheerd door Plainva"): de `type`-waarde is kiesbaar uit een vervolgkeuzelijst met bekende typen, `okf_version` is alleen ter weergave; hernoemen, typewijziging en verwijderen zijn vergrendeld zodat de conventie niet per ongeluk kan breken.

**Het uitlegvenster:** wanneer je een vault voor het eerst opent, toont Plainva eenmalig **Wat is OKF?** — dezelfde samenvatting is altijd beschikbaar in de instellingen.

## index.md: de inhoudsopgave per map

Een `index.md` is de inhoudsopgave van een map: een lijst van de bevatte notities en submappen, met beschrijvingen en relatieve links.

- **Genereren** — altijd op jouw actie, nooit zomaar uit het niets: rechtsklik op een map → **index.md genereren/vernieuwen**, of gebundeld via het **index.md-beheer** (**Instellingen → OKF → Openen…**).
- **Overnemen in plaats van genereren** — heb je al overzichtsnotities (MOC, Overzicht, mapnotitie, README …), dan stelt het beheer ze voor als kandidaten. **Overnemen** hernoemt het bestand naar `index.md` (links worden vault-breed bijgewerkt) en kan het optioneel voorbereiden voor OKF.
- **Automatisch bijhouden** — listings die door Plainva *gegenereerd* zijn, dragen aan het einde van het bestand een onzichtbare markering (een HTML-commentaar). Alleen zulke gemarkeerde bestanden houdt Plainva automatisch actueel zodra er iets in de map verandert — en alleen in OKF-vaults (herkenbaar aan `okf_version` in de root-`index.md`).
- **Alleen-lezen met een uitweg** — beheerde index.md-bestanden openen in leesmodus met de banner "Deze index.md wordt beheerd door Plainva en automatisch bijgewerkt." Daar kun je **Vernieuwen** — of kiezen voor **Toch bewerken**: dat verwijdert de markering en het bestand is weer helemaal van jou (geen automatische updates meer).
- **Alles tegelijk** — **Alle index.md bijwerken** is beschikbaar in het contextmenu van de vault-hoofdmap en in de instellingen; bestanden zonder markering worden daarbij overgeslagen.
- In leesmodus worden beheerde listings weergegeven als kaarten met bestands-/mapiconen; links openen rechtstreeks in Plainva.

## Een bestaande vault converteren (opt-in)

Als bestanden in de vault niet voldoen aan het OKF-formaat (ontbrekend `type`-veld, of gereserveerde namen gebruikt als gewone notitie), biedt Plainva de conversie aan — eenmalig bij het openen van de vault en permanent onder **Instellingen → OKF → OKF-conversie** (het item verschijnt alleen zolang er iets te doen is).

De wizard **Naar OKF-formaat converteren** werkt in duidelijke stappen:

1. **Scannen** — toont hoeveel bestanden zijn betrokken (sjabloon- en systeemmappen zijn uitgezonderd; bestanden met onleesbare frontmatter worden overgeslagen, nooit "gerepareerd").
2. **Beslissingen** — een standaard-`type` voor bestanden zonder één; bestaande `type`-waarden kun je **behouden** (aanbevolen — ze zijn al geldige OKF-typen) of hernoemen naar een ander veld.
3. **Voorbeeld (geen wijzigingen)** — een dry run toont vooraf wat er zou veranderen.
4. **Converteren** — van elk bestand wordt vóór de wijziging een back-up gemaakt naar `.plainva/backups/`; een rapport vat samen wat er is gewijzigd, overgeslagen en waar de back-upmap staat. Daarna kun je optioneel **verdergaan naar het index.md-beheer**.

Een tip uit de wizard: wijzigingen lopen zoals gebruikelijk via de synchronisatie — bij git-vaults eerst committen.

## Moet ik OKF gebruiken?

Nee. OKF is een zachte standaard:

- Nieuwe bestanden krijgen de kop automatisch — dat stoort nergens en kost niets.
- Bestaande vaults (bijv. uit Obsidian) blijven ongewijzigd werken; de conversie is strikt opt-in.
- Een ontbrekende `okf_version` alleen telt niet als overtreding — je kunt Plainva en Obsidian permanent naast elkaar gebruiken zonder gezeur.
- Obsidian en elke andere editor kunnen alle bestanden nog steeds openen: het is en blijft gewoon Markdown.

## Zie ook

- [Bestandsformaat-referentie](File_Format_Reference.md) — het exacte contract op schijf voor elk vault-bestand
- [Notities & Markdown](Notes_and_Markdown.md) — frontmatter en eigenschappen
- [Databases (.base)](Databases_Base.md) — wat een uniform `type` je in de praktijk oplevert
- [FAQ & probleemoplossing](FAQ.md) — onder meer back-ups en alleen-lezen index.md
