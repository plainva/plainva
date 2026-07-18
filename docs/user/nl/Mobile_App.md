# De mobiele app

Laatst bijgewerkt: 2026-07-18

Plainva is ook beschikbaar als app voor Android en iOS. Ze werkt met dezelfde Markdown-bestanden, hetzelfde **OKF**-formaat en dezelfde synchronisatie-engine als de desktop-app — je kluis blijft in beide werelden identiek.

## Indeling

- **Onderbalk:** drie vrij te ordenen schermen plus het vaste tabblad **Meer**. **Meer** toont alle schermen (Notities, Vandaag, Tags, Bladwijzers, Kalender, Databases, Graaf) — een tik opent het, de **greep** herordent de lijst: de bovenste drie vormen de balk (gemarkeerd met een kader), een scherm omhoog slepen bevordert het naar de balk.
- **＋** zweeft als ronde knop boven de balk en opent snel aanmaken: notitie, dagnotitie, map, database, "Vanuit sjabloon…".
- **Bovenbalk:** zoeken en de **Instellingen** (⋮); het beginscherm toont bovendien "Recent" en je bladwijzers.
- **Instellingen:** de ⋮-knop opent eerst de gebiedslijst (zoals de linkerkant van de desktopinstellingen) — een tik opent die pagina. Bovenaan leidt **Actieve vault** naar het vaultbeheer: van vault wisselen (vinkje = actief), **Een vault maken** en **Cloudkluis verbinden**.

## Notities lezen en bewerken

Notities openen **weergegeven en alleen-lezen**; de pen rechtsboven schakelt over naar bewerken (met een werkbalk boven het toetsenbord: opmaak, lijsten, wiki-link, slash-commando's, foto invoegen). `![[Notitie]]`-embeds verschijnen als aantikbare voorbeeldkaarten.

De knop **Notitiedetails** in de kopbalk (tussen de bladwijzer en het ⋮-menu) opent de contextkaart van de notitie: eigenschappen (direct bewerkbaar), backlinks, structuur, graaf en de **versiegeschiedenis** — elke bewerking maakt automatisch snapshots aan die je kunt bekijken, vergelijken en herstellen. De Markdown-bron en zoeken binnen de notitie vind je in het ⋮-menu.

## Databases (`.base`)

`.base`-databases werken zoals op de desktop: elke weergave (tabel, lijst, galerij, bord, kalender, tijdlijn), celbewerking per veldtype, kaarten op het bord verplaats je door ze ingedrukt te houden. **Configureren** beheert weergaven, kolommen, filters (inclusief groepen), sortering en eigenschappen. Relatieschema's (doelen, kardinaliteit) worden nog steeds op de desktop onderhouden.

Een weergave van het type **Prikbord** toont de notities als een bord met kleefbriefjes in twee kolommen: een tik opent de notitie, een lange druk toont de acties (vastzetten, labels, kleur, verwijderen), slepen na een lange druk herschikt, en selectievakjes vink je direct op de kaart af. Het invoerveld bovenaan legt een nieuwe notitie vast. Tip: richt de database op je inbox-map (**Instellingen** → **Inhoud en structuur**) en zowel de snelle ＋-notities als tekst die vanuit andere apps wordt gedeeld, belanden meteen op het bord.

## Kalender en afspraken

De **Kalender** (onderste tabblad of via "Meer") toont je dagnotities als maandrooster. Het klokicoon rechtsboven opent de **afsprakenkalender** met de weergaven **Dag**, **3 dagen** en **Agenda** — je gekoppelde kalenders gebruiken hetzelfde accountmodel als de desktop-app. Een tik op een afspraak toont de details; bij een uitnodiging kun je meteen **accepteren**, als **voorlopig** markeren of **afwijzen**.

Beheer accounts via het tandwielicoon in de afsprakenkalender: verbind **CalDAV** op het apparaat met een app-wachtwoord (bijv. Fastmail, Nextcloud, iCloud); Google en Microsoft volg je via aanmelden in de browser. Per account kun je losse kalenders tonen of verbergen.

## Synchronisatie

In **Instellingen** (⋮) leidt **Actieve vault** naar het vaultbeheer; daar verbind je cloudopslag (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Cloudkluis verbinden** haalt een bestaande cloudkluis naar het apparaat; **Een vault maken** vraagt eerst **Op dit apparaat** of **Bij een onlinedienst** en daarna de startstructuur (leeg of een sjabloon zoals PARA) — bij het online pad volgt het verbinden, de doelmap in de cloud kun je meteen vers aanmaken via **Nieuwe map**, en de structuur wordt bij de eerste synchronisatie geüpload. Dezelfde keuze tussen een bestaande en een nieuwe cloudkluis biedt ook de eerste start ("Cloudkluis verbinden"). Elke verbinding krijgt een eigen, gescheiden kluis op het apparaat. De kluispagina toont status, voortgang, openstaande overdrachten en biedt **Kluis exporteren** (ZIP via het deelvenster).

## Vangnet

Snapshots (versiegeschiedenis), een conceptlogboek (na een crash biedt de notitie je laatste niet-opgeslagen staat aan) en conflictkopieën met een vergelijkingsweergave beschermen je gegevens. De bewaartermijn stel je in bij **Instellingen** → **Backup & versiegeschiedenis**.

## Delen en snelkoppelingen (Android)

Tekst die vanuit andere apps wordt gedeeld, komt terecht als nieuwe notitie in de inbox-map. Houd het app-pictogram ingedrukt voor de snelkoppelingen **Nieuwe notitie** en **Vandaag**.
