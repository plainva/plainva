# Automatisering & scripts

Laatst bijgewerkt: 2026-07-15

Plainva heeft geen pluginsysteem dat code van derden uitvoert. In plaats daarvan is de vault zelf de uitbreidingsinterface: je notities zijn gewone Markdown, databases zijn gewone YAML (`.base`), en de [OKF-conventies](OKF.md) geven elk bestand een voorspelbare structuur. Alles wat bestanden kan lezen en schrijven — een shellscript, een Python-programma, een CLI-tool, een geplande taak of een KI-agent — kan je vault uitbreiden, genereren of herstructureren zonder ook maar één Plainva-specifieke API.

Deze pagina legt uit hoe je dat **veilig** doet. Het exacte bestandsformaat, tot op byte-niveau, is voor elk bestand apart gedocumenteerd in de [Bestandsformaat-referentie](File_Format_Reference.md); deze pagina is de praktische aanvulling: de regels, de werkwijze, en wat je een KI-assistent moet meegeven.

## Waarom bestanden in plaats van een plugin-sandbox

- **Beveiliging.** Een systeem voor code-plugins voert het programma van iemand anders uit binnen je editor, met toegang tot je notities. Gewone bestanden vragen geen zulk vertrouwen: een script raakt alleen de map aan waar je het naartoe wijst, met de normale rechten van je besturingssysteem.
- **Levensduur.** Het formaat overleeft de app. Een Markdown-bestand dat je vijf jaar geleden met een script hebt gegenereerd, opent vandaag nog gewoon — in Plainva, in Obsidian, in elke teksteditor. Er is geen plugin-API die kan verouderen.
- **Het formaat is het contract.** Omdat het formaat op schijf open en gedocumenteerd is, is de "API" stabiel en inspecteerbaar. Je kunt hem diffen, in Git versioneren en erover redeneren.

Wil je iets wat Plainva niet standaard doet, dan wacht je niet op een plugin — je schrijft een klein script tegen de bestanden.

## Een vault veilig lezen

Alles is UTF-8-tekst:

- **Notities (`.md`)** — een optioneel YAML-frontmatterblok (tussen twee `---`-regels, helemaal bovenaan) bevat de eigenschappen; daarna volgt de Markdown-tekst. Parse de frontmatter met een willekeurige YAML-bibliotheek.
- **Databases (`.base`)** — gewone YAML die weergaven over notities beschrijft. De *waarden* staan nooit in de `.base`; die staan in de frontmatter van de notities.
- **Structuur** — tags zijn `#tag` in de tekst of `tags:` in de frontmatter; links zijn `[[Note]]` (wiki-links) of `[text](path.md)`. Taken zijn lijstitems `- [ ]` / `- [x]`.

Lezen vraagt nooit om voorzichtigheid — tekstbestanden kunnen niet "beschadigd" raken door ze te lezen. De regels hieronder gaan allemaal over *schrijven*.

## Een vault veilig schrijven

Volg deze regels en Plainva (en Obsidian) accepteren je wijzigingen probleemloos. Plainva houdt de vaultmap in de gaten: een externe schrijfactie wordt automatisch opgemerkt en opnieuw geïndexeerd, meestal binnen een seconde.

1. **Schrijf UTF-8 zonder BOM, met LF-regeleinden.** Windows-tools die standaard UTF-16 of CRLF gebruiken, produceren bestanden die Plainva bij elke sync als gewijzigd beschouwt.
2. **Schrijf atomair.** Schrijf naar een tijdelijk bestand in dezelfde map en hernoem dat vervolgens naar de doelnaam. Een half geschreven notitie (bijvoorbeeld na een crash) is erger dan helemaal geen wijziging. Plainva schrijft zelf elke notitie op deze manier.
3. **Bewaar de OKF-frontmatter en onbekende sleutels.** Behoud `type` en `okf_version` wanneer je een notitie herschrijft, en laat nooit frontmattersleutels vallen die je niet herkent — ze moeten een lees-/schrijfronde ongewijzigd doorstaan. "Ruim" geen sleutels op die je niet begrijpt.
4. **Raak `.plainva/` nooit aan.** Die map bevat Plainva's lokale (per-apparaat) index, back-ups, vastzettingen in de graaf en sync-status. Het is geen onderdeel van je inhoud en mag door je scripts nooit worden beschreven, gesynchroniseerd of naar Git gecommit.
5. **Houd je aan de `.base`-regels.** Een `.base` gebruikt alleen Obsidians vier top-level sleutels (`filters`, `formulas`, `properties`, `views`); elke weergave heeft een `name` nodig; filters zijn eenwortelig. Alle Plainva-specifieke data staat onder geneste `plainva:`-subsleutels. De [Bestandsformaat-referentie](File_Format_Reference.md#databases-base) bevat het volledige contract, inclusief een tweezijdig relatievoorbeeld.
6. **Werk niet tegen de editor in.** Is een notitie open *en* heeft ze niet-opgeslagen wijzigingen in Plainva, herschrijf haar dan liever niet op datzelfde moment vanuit een script. Plainva heeft een conflictoplosser als vangnet, maar de schoonste weg is de app eerst te laten opslaan (of notities te bewerken die op dat moment niet open staan).

## Patronen

Een paar veelvoorkomende taken, allemaal gewoon bestandsbewerkingen:

- **Notities in bulk aanmaken** — genereer `.md`-bestanden met een OKF-frontmatterblok (`type`, `okf_version`, plus je eigen eigenschappen) en een Markdown-tekst. Plainva indexeert ze zodra ze verschijnen.
- **Generatoren voor dagelijkse notities of rapporten** — een geplande taak die een gedateerde notitie in je map voor dagelijkse notities schrijft, gevuld vanuit een andere bron.
- **Eigenschappen doorlopen** — lees de frontmatter van elke notitie, transformeer een veld en schrijf het terug (atomair, met behoud van onbekende sleutels).
- **Exporteren / publiceren** — lees de vault en render hem naar HTML, een statische site of een PDF. Alleen lezen — geen regels om je zorgen over te maken.
- **Linkonderhoud** — scan `[[Note]]`-links en `tags:` opnieuw en maak een rapport, of herstel ze ter plekke.

Houd scripts waar mogelijk idempotent: twee keer draaien mag geen inhoud verdubbelen.

## De vault overdragen aan een KI-assistent

Een KI-agent met lees-/schrijftoegang tot een vaultmap is precies het scenario waarvoor dit ontwerp is gemaakt. Om hem correct te laten werken:

1. **Geef hem de [Bestandsformaat-referentie](File_Format_Reference.md).** Die is geschreven voor een machinale lezer: het OKF-frontmattercontract, de eigenschap→YAML-serialisatie, het volledige `.base`-schema met de harde Obsidian-regels, het `index.md`-contract en de veiligheidsregels — alles wat een agent nodig heeft om bestanden te bewerken zonder ze te breken.
2. **Wijs hem naar de vaultmap, niet naar de map `.plainva/`.** Maak duidelijk dat `.plainva/` verboden terrein is.
3. **Vraag om atomaire, minimale wijzigingen.** Een agent die een hele notitie herschrijft om één eigenschap te wijzigen, moet de rest van de frontmatter en de tekst woordelijk bewaren.

Omdat het contract een document is en geen live API, werken dezelfde instructies met elke assistent, offline of online.

## Veiligheidsregels op een rij

- UTF-8, geen BOM, LF.
- Schrijf atomair (tijdelijk bestand + hernoemen).
- Bewaar `type`, `okf_version` en onbekende sleutels.
- Schrijf nooit naar `.plainva/`.
- `.base`: vier top-level sleutels, benoemde weergaven, eenwortelige filters, `plainva:`-subsleutels voor al het andere.
- De vault wordt in de gaten gehouden — externe wijzigingen verschijnen automatisch in Plainva.

## Zie ook

- [Bestandsformaat-referentie](File_Format_Reference.md) — het exacte bestandsformaat op schijf van elk bestand
- [OKF](OKF.md) — het Open Knowledge Format dat bestanden hun voorspelbare structuur geeft
- [Databases (.base)](Databases_Base.md) — hoe `.base`-weergaven werken
