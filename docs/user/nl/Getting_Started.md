# Aan de slag

Laatst bijgewerkt: 2026-08-10

Deze pagina brengt je van de installatie naar je eerste echte werk: een vault openen of aanmaken, de interface leren kennen en de drie editormodi begrijpen.

## Systeemvereisten

Plainva tekent zijn venster met de webengine van het systeem — de engine, niet de processor, bepaalt de ondergrens:

- **Windows** 10 of nieuwer met de WebView2-runtime (Windows 11 heeft die al; op 10 installeert het installatieprogramma hem)
- **macOS 12 (Monterey)** of nieuwer met een actuele Safari, Apple Silicon of Intel
- **Linux** met WebKitGTK 2.40 of nieuwer (controleer met `pkg-config --modversion webkit2gtk-4.1`)

Op macOS is de echte ondergrens **Safari 16.4**, omdat de engine met Safari meekomt en niet met het systeem: Ventura 13.0 verscheen onder die grens, terwijl een Monterey met actuele updates erboven zit. Start Plainva niet op een Mac, dan is Safari bijwerken het eerste om te proberen.

Op een systeem daaronder zegt Plainva dat bij het starten, in plaats van een leeg venster te openen.

## Wat is een vault?

Een vault is een gewone map op je computer met daarin je Markdown-notities. Plainva voegt een verborgen submap `.plainva/` toe voor de zoekindex en instellingen — je notities zelf blijven onaangetaste `.md`-bestanden. Je kunt meerdere vaults hebben (bijv. "Privé" en "Werk") en ertussen wisselen.

## Een vault openen of aanmaken

Bij de **allereerste** start — voordat je ooit een vault hebt geopend — toont Plainva eenmalig een kort welkomstbericht. Het legt in drie zinnen uit waarop Plainva is gebouwd, toont ernaast een kleine preview van de interface en biedt meteen de drie manieren om te beginnen: **Vault openen**, **Nieuwe vault** en **Importeren uit een andere app**. Met **Later** sla je het over en kom je op het gewone welkomstscherm terecht; het verschijnt daarna niet meer — tenzij je het opnieuw oproept onder **Instellingen → Opstarten en gedrag → Welkomstscherm**.

Na een update laat dezelfde plek zien wat er is veranderd: de belangrijkste wijziging van die release met een eigen kop, en de rest als telkens één regel. Dit verschijnt eenmaal per release — je kunt het op elk moment opnieuw oproepen onder **Instellingen → Opstarten en gedrag → Toon de hoogtepunten van de release opnieuw**.

Bij het opstarten begroet het welkomstscherm je:

- **Vault openen** — Plainva vraagt eerst **"Waar staat je vault?"**: **Lokale map** opent een bestaande map met Markdown-bestanden op deze computer (ook Obsidian-vaults werken direct); **Online vault** synchroniseert een bestaande vault uit de cloud naar een lokale map — bij elke provider dezelfde drie stappen (**Verbinden**, **de map in de cloud kiezen**, **de lokale map kiezen**; zie [Sync instellen](Sync_Setup.md)).
- **Nieuwe vault** — de eerste vraag is **"Waar moet je vault komen te staan?"** (**Op deze computer** of **Bij een onlinedienst**), daarna kies je de startstructuur: begin leeg of met een voorbereide mappenstructuur; beide zijn altijd aan te passen. De **Lege vault** bevat alleen een `index.md`-overzicht. Als sjablonen zijn beschikbaar: **Plainva-tour**, **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** en **Journal** — elk maakt mappen, een welkomstnotitie met korte handleiding en automatisch bijgehouden `index.md`-overzichten in het [OKF-formaat](OKF.md) aan (map- en bestandsnamen volgen de app-taal). De **Plainva-tour** is de aanbevolen plek om te beginnen: deze vult negen mappen en zeven databases met voorbeelden, zodat je elke weergave één keer in actie ziet — Prikbord, Kalender, Galerij, Bord, Tijdlijn, Tabel en de Boomstructuur-weergave met subitems — plus notitiesjablonen, mapregels en een Markdown-spiekbriefje. Niets daarin is kostbaar: verwijder wat je niet nodig hebt en hernoem de rest. Het **Journal**-sjabloon stelt bovendien meteen de dagelijkse-notities-instellingen van de vault in. De sjablonen **Plainva-tour**, **PARA**, **GTD**, **Zettelkasten** en **Journal** leveren ook kant-en-klaar gekoppelde [databases](Databases_Base.md) mee met bijpassende notitiesjablonen — bijvoorbeeld projecten met een statusbord en een gebiedslink, of taken die naar hun project verwijzen. Bij het online pad volgt de verbinding op het sjabloon: kies de provider, verbind, kies de map in de cloud of maak er via **Nieuwe map** een nieuwe aan, kies de lokale map — de gekozen structuur wordt in de lokale map aangemaakt en bij de eerste synchronisatie naar de cloud geüpload.

Onder **Recente vaults** vind je alles wat je al eerder hebt geopend. Met **Uit lijst verwijderen** verdwijnt een item alleen uit Plainva — de bestanden blijven op schijf staan. De optie **Laatste vault automatisch openen bij het starten** slaat het welkomstscherm voortaan over. Bij het verwijderen vraagt Plainva of daarnaast alle app-gegevens van de vault vergeten moeten worden (zoekindex, instellingen, vensterindeling, synchronisatie-inloggegevens; automatische ZIP-back-ups alleen via het extra selectievakje) — je vault-map blijft in elk geval onaangetast.

## De interface

- **Linkerzijbalk** — drie weergaven: **Bestanden** (de bestandsboom), **Tags** (alle `#tags` in de vault) en **Databases** (elke `.base` in de vault, gegroepeerd per map — klik om te openen); Bladwijzers en Recent geopend zijn secties boven de boom. Helemaal bovenaan staat het zoekveld, met ernaast een **+** voor Nieuwe notitie, Nieuwe map, Nieuwe base en Dagnotitie. De placeholdertekst van het zoekveld laat zien waarnaar wordt gezocht, en de tabbladen tonen hun naam zolang het paneel breed genoeg is — naarmate het smaller wordt, behoudt eerst alleen het actieve tabblad zijn naam, en blijven daarna alleen de iconen over. Onderaan: vault-wisselaar, **Dagnotitie openen** en **Instellingen**. De dubbele-pijl-knop naast de drie weergaven vouwt alle mappen in één keer in of uit, en **Tonen in bestandsboom** in het ⋮-menu van de editor toont de geopende notitie direct in de boom. In de weergave **Bestanden** toont een header de naam en het icoon van de huidige vault, en een balk **Onlangs geopend** boven de boom biedt met één klik toegang tot de notities die je het laatst hebt geopend.
- **Titelbalk** — je geopende tabbladen. Tabbladen kun je verslepen om te herordenen en tussen editorpanelen te verplaatsen.
- **Editorgebied** — hier lees en schrijf je. Via het tabbladmenu (**Rechts splitsen** / **Onder splitsen**) of de sneltoetsen `Ctrl+Alt+V` / `Ctrl+Alt+S` splits je de editor in twee panelen, bijv. een notitie naast een database.
- **Rechterzijbalk** — vier secties, herordenbaar door slepen: **Kalender** (dagelijkse notities), **Structuur** (koppen van de actieve notitie), **Backlinks** (wie hierheen linkt) en **Eigenschappen** (de frontmatter van de notitie).
- **Statusbalk** — woord-/tekenaantal, sync-status (Lokaal/Online/Offline) en opslagstatus (**Opslaan...** / **Opgeslagen**).

## De drie editormodi

Wissel van modus rechtsboven in de editor:

| Modus | Waarvoor |
|---|---|
| **Leesmodus** | Volledig gerenderde weergave om te lezen en navigeren. Links openen rechtstreeks in Plainva. |
| **Live-voorbeeld** | De standaard om te schrijven: Markdown wordt gerenderd terwijl je typt; opmaaktekens verschijnen alleen waar je aan het werk bent. |
| **Markdown-bron** | De ruwe tekst zonder rendering — voor volledige controle. |

In welke modus notities openen, bepaal je zelf: kies de **Standaardweergave** onder **Instellingen → App → Editor en notities** (lezen, live of bron). Wisselen van modus in de editor geldt per bestand voor de huidige sessie.

Je kunt ook wisselen tussen **Leesbare breedte** en **Volledige breedte**.

## Basisprincipes van de bestandsboom

- **Aanmaken:** rechtsklik op een map → **Nieuwe notitie hier**, **Nieuwe map** of **Nieuwe database (.base)**. De grote **Nieuw**-knop maakt aan in de op dat moment geselecteerde map (of de bovenliggende map van een geselecteerd bestand).
- **Selecteren:** klik selecteert, `Ctrl`+klik voegt individueel toe/verwijdert, `Shift`+klik selecteert een bereik, middelklik opent in een nieuw tabblad.
- **Contextmenu:** bevat onder meer **Hernoemen** (werkt links vault-breed bij), **Dupliceren**, **In split openen (rechts)** / **In split openen (onder)**, **Bladwijzer toevoegen**, **Pad kopiëren**, **Tonen in bestandsbeheer**, **Verwijderen**.
- **Dezelfde acties in de secties boven de boom:** rechtsklikken op een item in **Onlangs geopend** of **Bladwijzers** opent hetzelfde menu — zonder de mapvermeldingen, met wel **Uit de lijst verwijderen** erbij (dat haalt alleen het item uit de lijst, nooit het bestand). Hernoemen verloopt daar via een dialoogvenster in plaats van een invoerveld in de rij. Ook de agenda- en takenweergave kunnen in **Onlangs geopend** staan; ze kunnen worden geopend en uit de lijst verwijderd, maar niet hernoemd of verwijderd — het zijn weergaven, geen bestanden.
- **Meervoudige selectie:** verwijderen vraagt één keer bevestiging voor alle items, dupliceren en verplaatsen door slepen werken op de hele selectie. Verwijderde items belanden in de prullenbak van het besturingssysteem.
- Nieuwe notities beginnen automatisch met een `# Kop` afgeleid van de bestandsnaam.
- De eigen `index.md` van een map (het overzicht ervan) sorteert in de boom naar de **bovenkant** van die map, boven de submappen en bestanden — niet alfabetisch tussen de overige notities.
- **Opnieuw inlezen:** de ronde pijl in de header van de boom (of **F5**) leest de vault opnieuw in — Plainva brengt de index in overeenstemming met de map en haalt bij online vaults ook de cloudbestanden op. Een kort rapport toont vervolgens wat nieuw, gewijzigd, verwijderd of overgeslagen was. Voor één map is er **Deze map opnieuw inlezen** in het rechtsklikmenu.

## Dagelijkse notities

De knop **Dagnotitie** in de actiebalk links opent of maakt de notitie van vandaag. Stel de basismap, het datumformaat en een optioneel sjabloon in onder **Instellingen → Vault → Inhoud en structuur** (met **Map kiezen…** naast het veld kies je de map direct in de vault).

Het datumformaat gebruikt dezelfde tokens als Obsidian: `YYYY` jaar, `MM` maand, `DD` dag, `dddd` naam van de weekdag — `YYYY-MM-DD dddd` geeft `2026-07-29 Wednesday`. Tekst die onveranderd moet blijven hoort tussen vierkante haken: `[Dagboek] YYYY-MM-DD`. Maand- en dagnamen zijn altijd Engels, zodat het wisselen van de app-taal je bestaande dagelijkse notities nooit onvindbaar maakt.

De **Kalender** rechts is een dagoverzicht: een **klik** op een datum opent het [agenda-tabblad](Calendar_and_Tasks.md) op die dag; een **rechtsklik** opent een menu dat de dag bovenaan noemt en **Agenda openen**, **Dagnotitie** en de afspraken en taken met vervaldatum van die dag aanbiedt. Dagen met een dagnotitie dragen een klein **zonsymbool**, dagen met afspraken kleurpunten per agenda. De knop **Vandaag** brengt je terug naar de huidige maand; een klik op het maandlabel opent een snelkeuze voor maand en jaar. Daar schakel je ook **Weeknummers tonen** in om een ISO-weekkolom toe te voegen — de instelling wordt onthouden.

## Instellingen

**Instellingen** (tandwielicoon onderaan de actiebalk uiterst links, of `Ctrl+,`) sluit je via de **X** rechtsboven, `Esc` of een klik buiten het venster. Wijzigingen worden direct en automatisch opgeslagen — alleen cloudtoegangsgegevens pas je bewust toe via **Aanmelden** in het gebied **Cloudaccounts** (zie [Sync instellen](Sync_Setup.md)). Instellingen bestaan uit twee delen; elk gebied in de linkerbalk opent zijn eigen pagina, waar de instellingen in benoemde groepskaarten staan:

- **App** — alles wat app-breed geldt, in vijf gebieden. **Weergave**: de **Thema**-kiezer als voorbeeldkaarten — naast **Petrol** (de standaard) krijg je **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (E-Ink-achtig, maximaal rustig), **Sepia** (warm papier), **Bos**, **Middernacht** (OLED-zwart), **Hoog contrast** en **Fosforgroen**/**Fosforamber** (retroterminal met subtiele scanlines); daarnaast de **Modus** (**Licht**/**Donker**/**Systeemstandaard**; thema's met één modus zoals **Middernacht** leggen de modus vast, de licht/donker-schakelaar in de titelbalk pauzeert dan), **Taal**, **Week begint op**, **Dichtheid** en **Interfacezoom**. **Editor en notities**: **Standaardweergave**, **Lettergrootte van inhoud** en **Lettertype van inhoud**. **Opstarten en gedrag**: laatste vault automatisch openen, compatibiliteitswaarschuwingen. **Updates**: Plainva controleert bij het opstarten stilletjes op nieuwe versies en toont een melding zodra er een gevonden wordt — een klik erop downloadt en installeert de update meteen (de melding blijft staan tot Plainva opnieuw opstart). Uitschakelbaar via **Bij het starten op updates controleren**. **Over & diagnose**: versiedetails, de status van de **OS-sleutelhanger**, **Prestatiemetingen**, **Diagnose exporteren…** (geen notitie-inhoud) en **Probleem melden**. De sneltoetsen bereik je op elk moment via `F1` of **Sneltoetsen tonen** linksonder.
- **Vault** — de gekozen vault staat als kleine kaart in de balk (de actieve vault draagt een stip); bij meerdere vaults opent **Wisselen** daaronder een keuzelijst. Daaronder de gebieden per vault: **Cloudaccounts** is de ene plek voor elke cloudaanmelding — **Account verbinden…** kiest de provider (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV of een e-mailpostvak) en de diensten (**Bestanden**, **Agenda en taken**, **E-mail**) die dat account moet dragen. De dienstgebieden **Synchronisatie** (zie [Sync instellen](Sync_Setup.md)), **Agenda** (zie [Agenda & taken](Calendar_and_Tasks.md)) en **E-mail** (zie [E-mail vastleggen](Email_Capture.md)) verschijnen pas zodra een verbonden account die dienst draagt. Altijd aanwezig: **Inhoud en structuur** (**Dagnotities**, **Sjablonen & taken** incl. de **Sjablonenmap** en de koppelingen **map → sjabloon** en **notitietype → sjabloon** (die ook op de telefoon gelden), de **Inbox-map**, de **Bijlagenmap**, **OKF (Open Knowledge Format)** — zie [OKF](OKF.md) — en **Uitgebreide databases**), **Backup & versiegeschiedenis** en **Onderhoud** (**Index opnieuw opbouwen**, verwijderde bestanden herstellen, vault-statistieken).

## Tabbladen

- **Rechtsklik op een tabblad** voor het menu: **Vastzetten**, **Vernieuwen**, **In split openen (rechts)**, **Pad kopiëren**, **Tonen in bestandsbeheer** en de sluitgroep.
- **Vastzetten** houdt een tabblad op zijn plek: het verplaatst naar het begin van de balk, toont een pin in plaats van het sluitkruisje en overleeft elke **Andere sluiten** / **Links sluiten** / **Rechts sluiten** / **Alles sluiten**. Om het te sluiten, eerst **Losmaken**.
- **Vernieuwen** verwerpt de weergave en leest het bestand opnieuw van de schijf — handig wanneer een ander programma het heeft gewijzigd. Heeft het tabblad niet-opgeslagen wijzigingen, dan weigert Plainva te vernieuwen in plaats van je werk te overschrijven.

## Balken en gebieden

De actiebalk helemaal links, de tabbladen van de linkerzijbalk, de secties boven de bestandsboom en de secties van de rechterzijbalk werken allemaal op dezelfde manier.

De actiebalk biedt **Nieuwe notitie**, **Nieuwe map** en **Nieuwe base** aan. Alle drie maken het item aan in de **geselecteerde map** van de bestandsboom; bij een geselecteerd bestand in de map van dat bestand; bij niets geselecteerd op het hoogste niveau. De **Dagnotitie** houdt zich daar niet aan — die hoort altijd in de map die je daarvoor in de instellingen hebt ingesteld. Heb je een van de drie niet nodig, verberg hem dan.

**Precies waar ze staan:** **houd** een knop of een sectiekop **ingedrukt** en sleep hem naar zijn nieuwe plek — een gewone klik activeert hem nog gewoon, en als je scrolt terwijl je vasthoudt, scrol je (het slepen wordt geannuleerd). `Esc` breekt een lopende sleepbeweging af. Een **rechtsklik** biedt dezelfde acties zonder vasthouden: **Omhoog**, **Verbergen** en **Balken aanpassen…**.

**Op één plek:** onder **Instellingen → Vault → Balken en gebieden** staan alle vijf de balken onder elkaar — ook de navigatiebalk van de telefoon, die je zo op het grote scherm kunt indelen. Elke balk is **één** lijst met een scheidingslijn: alles erboven is zichtbaar, alles eronder is verborgen. Hier verplaats je items met de sleepgreep — op deze pagina wordt namelijk een lijst geordend, en daar is een greep precies voor bedoeld. Sleep je naar de boven- of onderrand, dan scrollt de pagina mee, zodat een item ook van helemaal onderaan naar helemaal bovenaan in één beweging kan reizen.

Twee dingen kunnen bewust niet worden verborgen: **Sneltoetsen tonen** en **Instellingen** onderaan de actiebalk, en het tabblad **Bestanden** van de linkerzijbalk. Al het overige mag je verbergen; verborgen acties van de balk blijven bereikbaar via het **opdrachtenpalet** (`Ctrl+P`). Secties van de rechterzijbalk die niets te tonen hebben voor de geopende notitie verschijnen sowieso nooit.

Deze indeling hoort bij de vault en reist mee naar je andere apparaten via [Sync instellen](Sync_Setup.md). Een vault die je niet hebt aangepast, volgt je **standaard** — stel die in met **Als standaard opslaan**, en **Terugzetten op standaard** brengt een aangepaste vault terug naar die standaard.

## De interface aanpassen

- **Zijbalken tonen/verbergen** via de twee knoppen in de titelbalk of `Ctrl+Alt+B` (links) / `Ctrl+Alt+R` (rechts) — ideaal om geconcentreerd te schrijven. Plainva onthoudt de status.
- **Opdrachtenpalet**: `Ctrl+P` opent **Opdrachten** — typ en druk op `Enter` om uit te voeren (nieuwe notitie, dagnotitie, splitsen, zijbalken, **Nu back-uppen**, en meer).
- **Dichtheid**: onder **Instellingen → App → Weergave** kies je tussen **Comfortabel** en **Compact** — Compact maakt lijsten, menu's en tabelrijen krapper; notitie-inhoud blijft ongewijzigd.
- **Lettertype van inhoud**: onder **Instellingen → App → Editor en notities** stel je de **Lettergrootte van inhoud** in (12–24 px) en het **Lettertype van inhoud** (**Themastandaard**, **Serif**, **Sans-serif**, **Monospace** of **Aangepast…** met de naam van een geïnstalleerd lettertype) — dit schaalt alleen editor en leesweergave; de interface blijft ongewijzigd.
- **Interfacezoom**: schaalt de HELE interface tussen 80 % en 150 % — onder **Instellingen → App → Weergave** of via `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` herstelt).
- **Native-vrije dialoogvensters**: bevestigingen verschijnen als Plainva-dialoogvensters in de stijl van je thema (destructieve acties krijgen een rode knop), korte meldingen als subtiele toasts rechtsonder — geen systeempopups meer.

## Zie ook

- [Notities & Markdown](Notes_and_Markdown.md) — alles over het schrijven
- [Sneltoetsen](Keyboard_Shortcuts.md)
- [FAQ & probleemoplossing](FAQ.md)

## De graaf

Via **Ctrl/Cmd+Shift+G** (of de sectie **Graaf** in de rechterzijbalk) zie je je vault als een kaart: mappen als bubbels, notities als nodes, relaties als gelabelde edges — inclusief een opruimmodus en tijdreis. Details: [Graaf](Graph.md).

## Geheugen van de rechterzijbalk

Secties die niets te tonen hebben voor de geopende notitie — **Structuur**, **Backlinks**, **Eigenschappen**, **Databases** — verschijnen helemaal niet, in plaats van grijs weergegeven te blijven staan. De hele rechterzijbalk onthoudt één globale voorkeur voor notities; weergaven op volledig scherm zonder notitiecontext sluiten hem alleen tijdelijk.

**Als je het paneel smal sleept**, verandert het in drie stappen, zodat er niets breekt:

- **280 px en meer** — zoals gebruikelijk.
- **232–280 px** — eigenschappen zetten de naam boven de waarde in plaats van ernaast, lange waarden lopen door naar een nieuwe regel, de secties worden compacter.
- **onder 232 px** — de kalender toont **één week in plaats van de maand** (zeven dagen, weeknummer rechtsonder); een maandraster zou hier cellen van 14 pixel hebben en geen kalender meer zijn. De graaf wordt korter, en backlinks tonen de bestandsnaam zonder de padregel.

De rechterzijbalk kan niet onder **200 px** komen — geen enkele sectie is daaronder nog bruikbaar. De linker gaat nog wel terug tot 150 px, omdat bestandsnamen gewoon worden afgekapt.
