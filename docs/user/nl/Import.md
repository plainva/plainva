# Importeren uit een andere app

Laatst bijgewerkt: 2026-07-28

Plainva kan notities overnemen uit andere notitie-apps. De import schrijft altijd naar de vault die je op dat moment hebt geopend, in een submap die je zelf benoemt — zo raakt hij de rest van je vault nooit aan, en kun je de geïmporteerde map achteraf verplaatsen of verwijderen als elke andere map.

**Importeren gebeurt op de desktop.** De mobiele app kan niet importeren: haal de notities op de desktop binnen, dan komen ze via de synchronisatie op je telefoon terecht, net als elk ander bestand.

## Import starten

Twee manieren:

- **Opdrachtenpalet** (`Mod+P`) → **Importeren uit een andere app...**
- **Rechtsklik op een map** in de bestandsboom → **Importeren uit een andere app...**

De wizard heeft drie stappen: kies de app waar je vandaan komt, kies de exportbestanden (of voer een Notion-token in), en benoem de doelmap. Daarna krijg je een voorbeeld met het aantal notities en databases en een lijst van alles wat de importer niet kan meenemen. Er wordt pas iets geschreven zodra je op **Import starten** klikt.

## Wat je kunt importeren

| Bron | Wat je selecteert | Wat wordt overgenomen |
|---|---|---|
| **Notion (API)** | Een integratietoken | Pagina's, mapstructuur, databases met rijen, relaties, 21 eigenschapstypen |
| **Notion (ZIP-export)** | Het ZIP-bestand of de uitgepakte map | Pagina's en mapstructuur. Databases worden **leeg** aangemaakt |
| **Evernote (ENEX)** | Een of meer `.enex`-bestanden | Notities, tags, checklists, aanmaakdatum en wijzigingsdatum |
| **Google Keep (Takeout)** | Het Takeout-ZIP of de `.json`-bestanden | Notities, checklists, labels als tags, kleur, vastgepind/gearchiveerd |
| **Simplenote** | Het geëxporteerde `.json`-bestand | Actieve notities en hun tags |
| **Logseq** | Je graph-map | De bestanden, ongewijzigd gekopieerd |
| **Markdown-map / ZIP** | Een map, bestanden of een ZIP | De `.md`-bestanden en hun mapstructuur |

Er is geen Obsidian-importer — en die is ook niet nodig. Plainva opent een Obsidian-vault rechtstreeks: **Vault openen** en de map kiezen.

## Notion in detail

Notion is de enige bron waarbij de twee wegen sterk verschillen.

**Met een integratietoken (aanbevolen).** Maak een token aan op `notion.so/my-integrations`. Open daarna elke Notion-pagina die je wilt importeren, kies rechtsboven **"..."** → **Verbindingen**, en voeg je integratie toe — Notion geeft alleen pagina's vrij die je uitdrukkelijk hebt verbonden.

Via de API ziet Plainva de structuur, niet alleen de tekst:

- De paginahiërarchie wordt een mapstructuur.
- Elke database wordt een `.base`-bestand plus een map met **één notitie per rij**.
- **Relaties worden wiki-links** tussen die notities, in beide richtingen.
- 21 eigenschapstypen worden overgenomen — selectie, status, multiselectie, datum, getal, selectievakje, URL, e-mail, telefoon, formule, rollup, relatie, personen, unieke ID en meer.
- Tabel-, bord-, kalender- en lijstweergaven worden gegenereerd uit het databaseschema.
- Databases die in een pagina zijn ingesloten, worden live `![[Database.base]]`-embeds.

**Vanuit een ZIP-export.** Dit werkt offline en heeft geen token nodig, maar Notions export bevat geen databaseschema en geen pagina-ID's. Pagina's en hun mappen komen over; databases worden aangemaakt als **lege** `.base`-bestanden, en het rapport vermeldt dat. Als je databases belangrijk zijn, gebruik dan de API-weg.

## Wat imports niet kunnen meenemen

Elke importer noemt zijn grenzen in het voorbeeld en nogmaals in het rapport. De belangrijkste:

- **Bijlagen en afbeeldingen worden niet geïmporteerd.** Het rapport vermeldt ze een voor een, zodat je weet wat er in je export achterblijft; Evernote-bijlagen en Keep-afbeeldingen blijven daar ook.
- **Sommige onderdelen van het archief worden bewust overgeslagen:** zeer grote bestanden, symbolische links en onderdelen met een onveilig pad. Ze verschijnen met een reden in het voorbeeld, voordat je de import start.
- **Zeer lange Notion-pagina's** worden volledig gelezen, maar inhoud genest in toggles, kolommen of sublijsten wordt niet meegenomen.
- **Logseq-bestanden worden ongewijzigd gekopieerd** — `key:: value`-eigenschappen en blokverwijzingen worden niet omgezet naar Plainva-eigenschappen of -links.
- **De Simplenote-prullenbak** wordt overgeslagen.
- **Notion-ZIP-exports** maken lege databases aan (zie hierboven).

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

## Zie ook

- [Databases (.base)](Databases_Base.md) — wat er gebeurt met geïmporteerde Notion-databases
- [OKF](OKF.md) — de frontmatter die geïmporteerde notities krijgen
- [Aan de slag](Getting_Started.md) — een aparte vault aanmaken voor een import
