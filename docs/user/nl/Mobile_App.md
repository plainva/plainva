# De mobiele app

Laatst bijgewerkt: 2026-07-17

Plainva is ook beschikbaar als app voor Android en iOS. Ze werkt met dezelfde Markdown-bestanden, hetzelfde **OKF**-formaat en dezelfde synchronisatie-engine als de desktop-app — je kluis blijft in beide werelden identiek.

## Indeling

- **Onderbalk:** maximaal vier schermen naar keuze (Notities, Vandaag, Tags, Bladwijzers, Kalender, Databases) rond de vaste **＋**-knop. Wijzig de keuze onder **Instellingen** → **Tabbladbalk**.
- **＋**: een tik legt meteen een nieuwe notitie aan (in de zichtbare map, anders in de inbox-map). Ingedrukt houden voor snel aanmaken: notitie, dagnotitie, map, database, "Vanuit sjabloon…".
- **Bovenbalk:** zoeken en het menu Meer; het beginscherm toont bovendien "Recent" en je bladwijzers.

## Notities lezen en bewerken

Notities openen **weergegeven en alleen-lezen**; de pen rechtsboven schakelt over naar bewerken (met een werkbalk boven het toetsenbord: opmaak, lijsten, wiki-link, slash-commando's, foto invoegen). `![[Notitie]]`-embeds verschijnen als aantikbare voorbeeldkaarten.

De knop **Notitiedetails** in de kopbalk (tussen de bladwijzer en het ⋮-menu) opent de contextkaart van de notitie: eigenschappen (direct bewerkbaar), backlinks, structuur, graaf en de **versiegeschiedenis** — elke bewerking maakt automatisch snapshots aan die je kunt bekijken, vergelijken en herstellen. De Markdown-bron en zoeken binnen de notitie vind je in het ⋮-menu.

## Databases (`.base`)

`.base`-databases werken zoals op de desktop: elke weergave (tabel, lijst, galerij, bord, kalender, tijdlijn), celbewerking per veldtype, kaarten op het bord verplaats je door ze ingedrukt te houden. **Configureren** beheert weergaven, kolommen, filters (inclusief groepen), sortering en eigenschappen. Relatieschema's (doelen, kardinaliteit) worden nog steeds op de desktop onderhouden.

Een weergave van het type **Prikbord** toont de notities als een bord met kleefbriefjes in twee kolommen: een tik opent de notitie, een lange druk toont de acties (vastzetten, labels, kleur, verwijderen), slepen na een lange druk herschikt, en selectievakjes vink je direct op de kaart af. Het invoerveld bovenaan legt een nieuwe notitie vast. Tip: richt de database op je inbox-map (**Instellingen** → **Mappen**) en zowel de snelle ＋-notities als tekst die vanuit andere apps wordt gedeeld, belanden meteen op het bord.

## Synchronisatie

Onder **Meer** → **Kluizen** verbind je cloudopslag (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Cloudkluis verbinden** haalt een bestaande cloudkluis naar het apparaat; **Een vault maken** vraagt eerst **Op dit apparaat** of **Bij een onlinedienst** en daarna de startstructuur (leeg of een sjabloon zoals PARA) — bij het online pad volgt het verbinden, de doelmap in de cloud kun je meteen vers aanmaken via **Nieuwe map**, en de structuur wordt bij de eerste synchronisatie geüpload. Dezelfde keuze tussen een bestaande en een nieuwe cloudkluis biedt ook de eerste start ("Cloudkluis verbinden"). Elke verbinding krijgt een eigen, gescheiden kluis op het apparaat. De kluispagina toont status, voortgang, openstaande overdrachten en biedt **Kluis exporteren** (ZIP via het deelvenster).

## Vangnet

Snapshots (versiegeschiedenis), een conceptlogboek (na een crash biedt de notitie je laatste niet-opgeslagen staat aan) en conflictkopieën met een vergelijkingsweergave beschermen je gegevens. De bewaartermijn stel je in bij **Instellingen**.

## Delen en snelkoppelingen (Android)

Tekst die vanuit andere apps wordt gedeeld, komt terecht als nieuwe notitie in de inbox-map. Houd het app-pictogram ingedrukt voor de snelkoppelingen **Nieuwe notitie** en **Vandaag**.
