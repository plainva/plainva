# Aan de slag

Laatst bijgewerkt: 2026-07-13

Deze pagina brengt je van de installatie naar je eerste echte werk: een vault openen of aanmaken, de interface leren kennen en de drie editormodi begrijpen.

## Wat is een vault?

Een vault is een gewone map op je computer met daarin je Markdown-notities. Plainva voegt een verborgen submap `.plainva/` toe voor de zoekindex en instellingen — je notities zelf blijven onaangetaste `.md`-bestanden. Je kunt meerdere vaults hebben (bijv. "Privé" en "Werk") en ertussen wisselen.

## Een vault openen of aanmaken

Bij het opstarten begroet het welkomstscherm je:

- **Lokale vault openen** — kies een bestaande map met Markdown-bestanden (ook Obsidian-vaults werken direct).
- **Nieuwe vault aanmaken** — begin leeg of met een voorbereide mappenstructuur; beide zijn altijd aan te passen. De **Lege vault** bevat alleen een `index.md`-overzicht. Als sjablonen zijn beschikbaar: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** en **Journal** — elk maakt mappen, een welkomstnotitie met korte handleiding en automatisch bijgehouden `index.md`-overzichten in het [OKF-formaat](OKF.md) aan (map- en bestandsnamen volgen de app-taal). Het **Journal**-sjabloon stelt bovendien meteen de dagelijkse-notities-instellingen van de vault in. De sjablonen **PARA**, **GTD**, **Zettelkasten** en **Journal** leveren ook kant-en-klaar gekoppelde [databases](Databases_Base.md) mee met bijpassende notitiesjablonen — bijvoorbeeld projecten met een statusbord en een gebiedslink, of taken die naar hun project verwijzen.
- **Online vault openen** — kies je cloudprovider: **WebDAV / Nextcloud** verbindt rechtstreeks (voer de server-URL, gebruikersnaam en wachtwoord of app-token in, dan **Server doorbladeren**); voor **Google Drive**, **OneDrive**, **Dropbox** en **S3-compatibele opslag** kies je eerst een lokale sync-map — de installatie opent daarna automatisch in de instellingen (zie [Sync instellen](Sync_Setup.md)).

Onder **Recente vaults** vind je alles wat je al eerder hebt geopend. Met **Uit lijst verwijderen** verdwijnt een item alleen uit Plainva — de bestanden blijven op schijf staan. De optie **Laatste vault automatisch openen bij het starten** slaat het welkomstscherm voortaan over. Bij het verwijderen vraagt Plainva of daarnaast alle app-gegevens van de vault vergeten moeten worden (zoekindex, instellingen, vensterindeling, synchronisatie-inloggegevens; automatische ZIP-back-ups alleen via het extra selectievakje) — je vault-map blijft in elk geval onaangetast.

## De interface

- **Linkerzijbalk** — vier weergaven: **Bestanden** (de bestandsboom), **Tags** (alle `#tags` in de vault), **Bladwijzers** en **Databases** (elke `.base` in de vault, gegroepeerd per map — klik om te openen). Bovenaan staat de grote **Nieuw**-knop (Nieuwe notitie, met **Meer opties** voor Nieuwe map, Nieuwe base, Dagnotitie). Onderaan: vault-wisselaar, **Dagnotitie openen** en **Instellingen**. De dubbele-pijl-knop naast de vier weergaven vouwt alle mappen in één keer in of uit, en **Tonen in bestandsboom** in het ⋮-menu van de editor toont de geopende notitie direct in de boom.
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
- **Meervoudige selectie:** verwijderen vraagt één keer bevestiging voor alle items, dupliceren en verplaatsen door slepen werken op de hele selectie. Verwijderde items belanden in de prullenbak van het besturingssysteem.
- Nieuwe notities beginnen automatisch met een `# Kop` afgeleid van de bestandsnaam.

## Dagelijkse notities

**Dagnotitie openen** (of een klik op een datum in de **Kalender** rechts) opent of maakt de notitie van vandaag. Stel de basismap, het datumformaat en een optioneel sjabloon in onder **Instellingen → Vault → Inhoud en structuur** (met **Map kiezen…** naast het veld kies je de map direct in de vault).

In de kalender brengt de knop **Vandaag** je terug naar de huidige maand; een klik op het maandlabel opent een snelkeuze voor maand en jaar. Daar schakel je ook **Weeknummers tonen** in om een ISO-weekkolom toe te voegen — de instelling wordt onthouden.

## Instellingen

**Instellingen** (tandwielicoon onderaan de actiebalk uiterst links, of `Ctrl+,`) sluit je via de **X** rechtsboven, `Esc` of een klik buiten het venster. Wijzigingen worden direct en automatisch opgeslagen — alleen sync-toegangsgegevens pas je bewust toe via **Opslaan**/**Verbinden** (zie [Sync instellen](Sync_Setup.md)). Instellingen bestaan uit twee delen:

- **App** — alles wat app-breed geldt, in vijf gebieden. **Weergave**: de **Thema**-kiezer als voorbeeldkaarten — naast **Petrol** (de standaard) krijg je **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (E-Ink-achtig, maximaal rustig), **Sepia** (warm papier), **Bos**, **Middernacht** (OLED-zwart), **Hoog contrast** en **Fosforgroen**/**Fosforamber** (retroterminal met subtiele scanlines); daarnaast de **Modus** (**Licht**/**Donker**/**Systeemstandaard**; thema's met één modus zoals **Middernacht** leggen de modus vast, de licht/donker-schakelaar in de titelbalk pauzeert dan), **Taal**, **Dichtheid** en **Interfacezoom**. **Editor en notities**: **Standaardweergave**, **Lettergrootte van inhoud** en **Lettertype van inhoud**. **Opstarten en gedrag**: laatste vault automatisch openen, compatibiliteitswaarschuwingen. **Updates**: Plainva controleert bij het opstarten stilletjes op nieuwe versies en toont een melding zodra er een gevonden wordt — uitschakelbaar via **Bij het starten op updates controleren**. **Over & diagnose**: versiedetails, de status van de **OS-sleutelhanger**, **Prestatiemetingen**, **Diagnose exporteren…** (geen notitie-inhoud) en **Probleem melden**. De sneltoetsen bereik je op elk moment via `F1` of **Sneltoetsen tonen** linksonder.
- **Vault** — de vault-keuze staat als keuzelijst erboven; daaronder vier gebieden per vault: **Synchronisatie** (zie [Sync instellen](Sync_Setup.md)), **Inhoud en structuur** (**Dagelijkse notities & sjablonen** incl. de **Sjablonenmap**, **OKF (Open Knowledge Format)** — zie [OKF](OKF.md) — en **Uitgebreide databases**), **Backup & versiegeschiedenis** en **Onderhoud** (**Index opnieuw opbouwen**, verwijderde bestanden herstellen, vault-statistieken).

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
