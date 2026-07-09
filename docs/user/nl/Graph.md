# Graaf

Laatst bijgewerkt: 2026-07-09

De **Graaf** van Plainva is een werkinstrument, geen poster: hij laat zien waar je bent, wat er verbonden is, wat er ontbreekt — en je kunt er rechtstreeks op inspelen. Er is ÉÉN graaf-engine met drie gezichten.

## Contextgraaf (rechterzijbalk)

Open de sectie **Graaf** in de rechterzijbalk. Deze toont de actieve notitie in het midden, de mapstructuur erboven, voor mapoverzichten (index.md) de bijbehorende notities eronder, inkomende verwijzingen links en uitgaande rechts. Relaties uit databases dragen hun eigenschapsnaam als label.

- Klikken op een node opent de notitie (de focus draait mee).
- Ctrl/Cmd+klik opent in een split, middelklik in een nieuw tabblad.
- Sleep je een node naar een andere plek, dan blijft hij daar vastgezet (klein puntje) en wordt dat per notitie onthouden — open je die notitie opnieuw, dan is je indeling er weer. De actieve notitie blijft altijd in het midden.
- Daaronder verschijnen tot drie **suggesties**: notities die je actieve notitie noemen (maar er niet naar linken), er vaak samen mee worden gelinkt, een vergelijkbare buurt delen of een zeldzame tag delen. Staat de titel als tekst in de notitie die je bewerkt, dan toont de suggestie een **voorbeeld van het fragment** dat gelinkt zou worden; **Koppelen** maakt precies dat fragment tot een wiki-link (als `[[Doel|tekst]]` wanneer de zichtbare tekst van het doel afwijkt). Is er geen overeenkomend fragment, dan wordt de link aan het einde van de notitie toegevoegd (het voorbeeld geeft dat aan). **Suggestie negeren** onthoudt je keuze.

## Vault-kaart (eigen tabblad)

Open de kaart met **Ctrl/Cmd+Shift+G**, via het graaf-icoon in de **actiebalk** helemaal links, of via het opdrachtenpalet (**Graaf openen**). Ze opent in een eigen tabblad. In plaats van een kluwen zie je je echte mapstructuur als bubbels — dubbelklik op een bubbel om de bijbehorende notities uit te vouwen, **Alle mappen invouwen** gaat terug. De lay-out is deterministisch: dezelfde kaart ziet er elke keer dat je hem opent hetzelfde uit. Sleep je een node, dan blijft hij vastgezet (klein puntje); **Lay-out herstellen** verwijdert alle vastzettingen. Vastzettingen worden per apparaat opgeslagen.

Hulpmiddelen in de kopbalk:

- Edge-stijlen in één oogopslag (legenda, linksonder): **relaties** zijn doorgetrokken accentlijnen met een label, **koppelingen** zijn gestreept, **insluitingen** gestippeld.
- **Zoeken (dimt de rest)** dimt alles wat niet overeenkomt. **Filteren op type** (OKF) en **Filteren op tag**; edge-soorten (**Koppelingen**, **Relaties**, **Insluitingen**) schakel je individueel in of uit.
- **Focus op selectie** beperkt de kaart tot een geselecteerde notitie plus 1–3 stappen in de buurt.
- **Warmtekaart** laat recent bewerkte notities oplichten (7/30/90 dagen) — "waar werkte ik aan?"
- **Tijdreis** toont notities op hun aanmaakdatum; de schuifregelaar speelt de groei van je vault opnieuw af. De datum komt uit een `date`/`datum`-eigenschap, anders uit de bestandsaanmaakdatum (een benadering voor alleen-cloud-vaults).

Werken op de kaart:

- Sleep één node **op** een andere: Plainva stelt voor om een tekstlink te schrijven — of rechtstreeks een bijpassende **relatie** uit je databases (als de relatie precies één item toestaat, vraagt Plainva voordat het wordt vervangen).
- Rechtsklik op een node: **Openen**, **Peek**, **In split openen**, **Nieuwe gekoppelde notitie**, **Hernoemen** (met vault-brede linkupdates), **Bladwijzer wisselen**, **Verwijderen**.
- Rechtsklik op lege ruimte: **Nieuwe notitie**, **Lay-out herstellen**, **Exporteren als PNG/SVG**.
- Klikken op een edge-bundel tussen mappen toont de afzonderlijke links; hoveren over een edge toont de zin waarin de link staat.
- Shift+slepen selecteert meerdere notities (voettekst: bladwijzer/verwijder de selectie).

## Opruimen

De knop **Opruimen** opent een werklijst met drie tabbladen: **Wezen** (notities zonder verbindingen), **Kapotte links** (doelen die niet bestaan — **Notitie maken** maakt ze aan) en **Vermeldingen** (**Vault scannen** vindt plekken waar een notitie wordt genoemd maar niet gelinkt; **Koppelen** maakt van de vermelding een wiki-link). De voettekst van de kaart toont het aantal wezen — erop klikken opent het paneel.

## Graaf als databaseweergave

Elke `.base`-database kan een **Graaf**-weergave krijgen (weergave toevoegen → **Graaf**): de rijen van de database worden nodes, je **relaties** worden gelabelde edges. In de kopbalk kies je de edge-eigenschappen, kleur op een selectie-eigenschap, grootte op een getal en of externe doelen (relaties die buiten de database wijzen) of **Inkomende relaties** (relaties uit andere databases die naar deze items verwijzen — bijv. de taken van een project) verschijnen. De weergave wordt Obsidian-compatibel opgeslagen — Obsidian toont hetzelfde bestand als een tabel.

## Grenzen

- De graaf toont notities (bestanden), geen afzonderlijke alinea's.
- Vastzettingen en genegeerde suggesties staan onder `.plainva/` en reizen niet mee met sync — de basislay-out is op elk apparaat identiek.
- Suggesties zijn pure vault-analyses; er verlaat niets je machine.
