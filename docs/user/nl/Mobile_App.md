# De mobiele app

Laatst bijgewerkt: 2026-08-03

Plainva is ook beschikbaar als app voor Android en iOS. Ze werkt met dezelfde Markdown-bestanden, hetzelfde **OKF**-formaat en dezelfde synchronisatie-engine als de desktop-app — je kluis blijft in beide werelden identiek.

## De app installeren

De mobiele app zit in **gesloten bèta**. Op **Android** kom je er in twee stappen in: word lid van de testersgroep via [plainva.com/android-beta](https://plainva.com/android-beta) en ga daarna akkoord in Google Play. Op de **iPhone** loopt de verspreiding via TestFlight; de wachtlijst staat op [plainva.com](https://plainva.com).

Google zet de app pas in de openbare Play Store zodra 12 testers 14 dagen achter elkaar blijven — meedoen en hem gewoon geïnstalleerd laten helpt dus al.

## Indeling

- **Onderbalk:** **twee tot vier** werkoppervlakken naar keuze, plus het vaste item **Onderdelen** aan het eind — samen goed voor drie tot vijf bestemmingen op een balk. **Notities** blijft altijd zichtbaar: zo bereik je je bestanden.
- **Elk onderdeel** (Notities, Vandaag, Taken, Kalender, E-mail, Graaf) is altijd één tik verwijderd via het **onderdelenblad**: **Onderdelen** in de balk, de **▾ naast de titel**, of door **lang te drukken op de balk**. Het blad markeert het huidige onderdeel en leidt onderaan direct naar **Navigatiebalk aanpassen…**. Tags, bladwijzers en recent geopende items zijn geen eigen onderdelen meer — ze staan nu onder **Notities**.
- **De balk instellen:** **Instellingen** → **Navigatiebalk**. Met **−**/**+** stel je in hoeveel werkoppervlakken de balk toont (2–4, met live voorbeeld), en met de **sleepgreep** orden je de lijst: de bovenste items vormen de balk (gemarkeerd met een kader), een item omhoog slepen bevordert het. Sleep je naar de boven- of onderrand, dan scrollt de lijst mee, zodat één beweging de hele lijst dekt. Er wordt nooit iets verborgen — wat niet in de balk staat, blijft bereikbaar via **Onderdelen**. Verlaat het onderdeel waar je je bevindt de balk, dan springt de app naar het eerste zichtbare onderdeel. Dezelfde balk kun je ook **op de desktop** ordenen (Instellingen → Vault → Balken en gebieden); met ingeschakelde instellingensynchronisatie reist de indeling mee tussen je apparaten.
- **＋** zweeft als ronde knop boven de balk en opent snel aanmaken: notitie, dagnotitie, map, database, "Vanuit sjabloon…".
- **Kopbalk:** overal dezelfde — links Terug (ontbreekt op een werkoppervlak), in het midden de titel en één regel context, rechts zoeken en ⋮. Tijdens het scrollen komt hij los van de inhoud en trekt de navigatiebalk zich terug tot de iconen; scroll je weer omhoog, dan gaat hij opnieuw open.
- **Een ⋮ betekent altijd hetzelfde:** acties op het object dat open staat. App-instellingen zitten daar niet achter.
- **Instellingen:** helemaal onderaan **Notities**, net als op de desktop. Ze openen eerst de onderdelenlijst (zoals de linkerkant van de desktopinstellingen) — een tik opent die pagina. Bovenaan leidt **Actieve vault** naar het vaultbeheer: van vault wisselen (vinkje = actief), **Een vault maken** en **Cloudkluis verbinden**.

## Notities lezen en bewerken

Notities openen **weergegeven en alleen-lezen**; de pen rechtsboven schakelt over naar bewerken (met een werkbalk boven het toetsenbord: opmaak, lijsten, wiki-link, slash-commando's, foto invoegen). `![[Notitie]]`-embeds verschijnen als aantikbare voorbeeldkaarten.

De knop **Notitiedetails** in de kopbalk (tussen de bladwijzer en het ⋮-menu) opent de contextkaart van de notitie: eigenschappen (direct bewerkbaar), backlinks, structuur, graaf en de **versiegeschiedenis** — elke bewerking maakt automatisch snapshots aan die je kunt bekijken, vergelijken en herstellen. De Markdown-bron en zoeken binnen de notitie vind je in het ⋮-menu.

## Sjablonen

Sjablonen werken op de telefoon precies zoals op de desktop: de plaatshouders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) worden ingevuld zodra de notitie wordt aangemaakt, **alle** vragen van een sjabloon verschijnen samen in **één** blad — annuleer je het, dan wordt er niets aangemaakt — en `{{cursor}}` plaatst de cursor zodra de notitie opengaat.

De koppelingen **map → sjabloon** en **notitietype → sjabloon** stel je in op de desktop; ze reizen mee via de instellingensynchronisatie en gelden ook hier — een notitie in `Projekte/` begint dus op beide apparaten hetzelfde, ook bij snelle `＋`-notities en bij **+ Item** in een database. Twee bijzonderheden: `{{weekday:…}}` rekent op de telefoon altijd vanaf maandag (de instelling voor het begin van de week bestaat daar nog niet), en `{{clipboard}}` vraagt in hetzelfde blad om de inhoud van het klembord, in plaats van hem ongevraagd te lezen. Alle plaatshouders staan in [Notities & Markdown](Notes_and_Markdown.md).

## Databases (`.base`)

`.base`-databases werken zoals op de desktop: elke weergave (tabel, lijst, galerij, bord, kalender, tijdlijn), celbewerking per veldtype, kaarten op het bord verplaats je door ze ingedrukt te houden. **Configureren** beheert weergaven, kolommen, filters (inclusief groepen), sortering en eigenschappen. Relatieschema's (doelen, kardinaliteit) worden nog steeds op de desktop onderhouden.

Een weergave van het type **Prikbord** toont de notities als een bord met kleefbriefjes in twee kolommen: een tik opent de notitie, een lange druk toont de acties (vastzetten, labels, kleur, verwijderen), slepen na een lange druk herschikt, en selectievakjes vink je direct op de kaart af. Het invoerveld bovenaan legt een nieuwe notitie vast. Tip: richt de database op je inbox-map (**Instellingen** → **Inhoud en structuur**) en zowel de snelle ＋-notities als tekst die vanuit andere apps wordt gedeeld, belanden meteen op het bord.

## Taken

Het onderdeel **Taken** verzamelt elk selectievakje in je vault — alle `- [ ]`- en `- [x]`-regels uit alle notities, gegroepeerd per notitie. Dat is het regelgebaseerde overzicht dat een database je niet kan geven, omdat een database met hele notities werkt.

Tikken op een taak opent de notitie **op die regel**; het vakje haakt af en schrijft precies dat ene `[ ]`/`[x]`-teken terug. Vervaldatums (`📅`) en `#tags` verschijnen als chips, zodat ze niet dubbel in de tekst staan.

Heeft je vault een **takendatabase** (**Instellingen** → **Inhoud en structuur**), dan toont het onderdeel deze erboven als eigen sectie: afvinken, status wijzigen, **+ Nieuwe taak** en **Als database openen**. Elke selectievakjeregel krijgt dan ook een knop die het **naar de database verplaatst** — de regel blijft als wiki-link staan, en de taak leeft voortaan als eigen notitie verder.

Twee acties extra bij een databasetaak: **Tijd blokkeren** maakt bij een gekoppelde agenda een afspraak voor de taak aan (datum, starttijd, duur, plus de agendakeuze als er meerdere schrijfbaar zijn), en **Herhaling** maakt bij het afvinken de volgende taak aan met een nieuwe vervaldatum. Beide worden beschreven onder [Taken](Tasks.md).

## Kalender en afspraken

De **Kalender** (onderste tabblad of via "Meer") toont je dagnotities als maandrooster. Het klokicoon rechtsboven opent de **afsprakenkalender** met de weergaven **Dag**, **3 dagen** en **Agenda** — je gekoppelde kalenders gebruiken hetzelfde accountmodel als de desktop-app. Een tik op een afspraak toont de details; bij een uitnodiging kun je meteen **accepteren**, als **voorlopig** markeren of **afwijzen**.

Beheer accounts via het tandwielicoon in de afsprakenkalender: verbind **CalDAV** op het apparaat met een app-wachtwoord (bijv. Fastmail, Nextcloud, iCloud); Google en Microsoft volg je via aanmelden in de browser. Per account kun je losse kalenders tonen of verbergen.

Vanuit een afspraak maakt **Vergadernotitie** de bijbehorende notitie aan — dezelfde notitie die ook de desktop vindt: ze blijft aan de afspraak gekoppeld, dus opnieuw aanroepen opent haar weer in plaats van een tweede aan te maken, en ze belandt in de **Vergadermap**. Die map en de **Standaardagenda** (degene waarin een nieuwe afspraak start) stel je in bij de accounts, onder **Agenda-instellingen**; beide horen bij de kluis en reizen mee met de instellingensynchronisatie. Op dezelfde plek kies je, per account, welke **Takenlijsten** worden gespiegeld naar je takendatabase.

**Aanmelden geldt per apparaat.** Wat wordt gesynchroniseerd, zijn je account-*instellingen*, nooit de aanmelding zelf — dat is bewust zo: inloggegevens mogen het apparaat niet verlaten. Een account dat via de instellingensynchronisatie is binnengekomen, verschijnt daarom wel in de lijst, maar draagt de markering **aanmelden**, met eronder een regel die vertelt wat je moet doen. Zolang er geen account op dit apparaat is aangemeld, legt de agenda dat ter plekke uit in plaats van gewoon leeg te blijven, en brengt **Op dit apparaat aanmelden** je naar de accounts. Aangemelde accounts tonen **actief**. Verloopt een aanmelding later of wordt zij ingetrokken, dan staat er **aanmelding verlopen** met de reden erbij — en **Opnieuw aanmelden** zet haar weer in gang zonder het account te verwijderen: hetzelfde account, dezelfde agenda's.

**Een login voor alle diensten — ook hier.** De telefoon biedt dezelfde samenvoeging als de desktop: een account dat nog los per dienst is aangemeld (Microsoft, Google) toont in Cloudaccounts de sectie **Een login voor alle diensten** — één aanmelding voor al zijn diensten, waarna die ene aanmelding elke dienst in leven houdt in plaats van maar één.

## E-mail

Bij **Instellingen → E-mail** verbind je een **Microsoft-postbus** (Outlook.com, Microsoft 365) rechtstreeks via het inloggen in de browser — zonder app-wachtwoord. Net als bij de agenda geldt: inloggen gebeurt per apparaat.

Daarna open je **E-mail** als eigen gebied via het ▾ naast de titel en zet je het desgewenst in de navigatiebalk. De regel onder de titel toont map, ongelezen aantal en account, en opent de mapkiezer. Tik op een bericht om het te lezen; **Als notitie opslaan** plaatst het in de map **Mail** van je kluis (twee keer vastleggen opent dezelfde notitie). Externe afbeeldingen blijven geblokkeerd tot je ze voor dat bericht toestaat — een geladen afbeelding verklapt de afzender wanneer en waar je hebt gelezen.

**IMAP-postbussen werken ook op de telefoon.** Voeg er een toe bij **Instellingen → E-mail**: kies de provider, vul het adres en het app-wachtwoord in, en Plainva vult de servers aan. Staat je provider er niet bij, dan kun je bij **Geavanceerd** zelf de IMAP- en SMTP-server, de poort en een afwijkende gebruikersnaam invullen, en een bestaand account kan later worden bewerkt. Meerdere berichten selecteer je door er een ingedrukt te houden; daarna voegt een tik meer toe. In de gespreksweergave kiest lang indrukken of tikken op de gespreksregel de hele uitwisseling — en elk bericht behoudt zijn eigen map, dus een antwoord uit **Verzonden** wordt daar gemarkeerd.

Een geopend bericht biedt **Beantwoorden**, **Allen beantwoorden** en **Doorsturen**. Een antwoord citeert het origineel onder je tekst; "Allen beantwoorden" neemt bovendien de overige ontvangers mee en laat je eigen adres weg. Bij het **opstellen** voeg je met **Bestand bijvoegen** een bestand uit de kluis toe — op de telefoon is de kluis de opslag die je kunt bereiken, en alles wat op het apparaat binnenkomt (een opgeslagen bijlage, een ingevoegde foto) staat daar al. Elke bijlage krijgt een eigen regel met **Bijlage verwijderen**, zolang het bericht nog niet is verstuurd.

## Synchronisatie

In **Instellingen** (⋮) leidt **Actieve vault** naar het vaultbeheer; daar verbind je cloudopslag (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Cloudkluis verbinden** haalt een bestaande cloudkluis naar het apparaat; **Een vault maken** vraagt eerst **Op dit apparaat** of **Bij een onlinedienst** en daarna de startstructuur (leeg of een sjabloon zoals PARA) — bij het online pad volgt het verbinden, de doelmap in de cloud kun je meteen vers aanmaken via **Nieuwe map**, en de structuur wordt bij de eerste synchronisatie geüpload. Dezelfde keuze tussen een bestaande en een nieuwe cloudkluis biedt ook de eerste start ("Cloudkluis verbinden"). Elke verbinding krijgt een eigen, gescheiden kluis op het apparaat. De kluispagina toont status, voortgang, openstaande overdrachten en biedt **Kluis exporteren** (ZIP via het deelvenster).

Hoe vaak deze kluis op wijzigingen op afstand controleert stel je op dezelfde pagina in (**synchronisatie-interval**, minstens 5 seconden) — lokaal opgeslagen wijzigingen gaan sowieso meteen omhoog. Bij Google Drive, OneDrive, Dropbox en S3 kun je de **cloudmap** ook achteraf wijzigen; bij WebDAV zit de map in het serveradres, daar maak je in plaats daarvan opnieuw verbinding. Is de instellingen-sync versleuteld, dan kun je bovendien **Bij elke start om de wachtwoordzin vragen** aanzetten: de sleutel wordt dan niet op het apparaat bewaard. En **Beveiliging en delen** zegt nu ronduit dat versleutelde workspaces experimenteel zijn en nog niet onafhankelijk zijn beoordeeld — bewaar je herstelbestand en -code op een veilige plek.

De vaultpagina vermeldt ook of je **instellingen** meereizen — als kaart met een duidelijke status in plaats van een kale knop:

- **worden niet gesynchroniseerd**: de instellingensynchronisatie staat uit voor deze vault. Zet hem aan op de desktop.
- **Nog niet versleuteld**: deze vault heeft nog geen synchronisatiewachtwoordzin. Je kunt er nu **op de telefoon** een instellen: de wizard toont de herstelcode en laat je twee willekeurig gekozen groepen ervan terugtypen voordat er ook maar iets wordt weggeschreven. Bestaat er al een wachtwoordzin in de cloud, dan meldt de telefoon dat en maakt er nooit een tweede aan — dat zou alle andere apparaten buitensluiten.
- **Nog niet ontgrendeld op dit apparaat**: je instellingen staan versleuteld opgeslagen in de cloud. Voer de wachtwoordzin in die bij het instellen is gekozen — op de desktop of hier, op de telefoon; dit apparaat ontgrendelt ze daarmee eenmalig.
- **worden gesynchroniseerd**: dit apparaat is ontgrendeld; mappen, weergaven en back-upregels blijven synchroon met je andere apparaten.

Elke kaart vermeldt ook wat *niet* meereist: aanmeldingen blijven altijd op het apparaat (zie [Kalender en afspraken](#kalender-en-afspraken)).

**Instellingen** → **Beveiliging en delen** noemt wat de verbinding werkelijk is — en bij een gewone cloudkluis stelt het de versleutelde werkruimte direct op de telefoon in (identiteit → herstelbestand en code → activering). Zonder cloudverbinding is er niets te versleutelen, en dat staat er ook.

## Vangnet

Snapshots (versiegeschiedenis), een conceptlogboek (na een crash biedt de notitie je laatste niet-opgeslagen staat aan) en conflictkopieën met een vergelijkingsweergave beschermen je gegevens. De bewaartermijn stel je in bij **Instellingen** → **Backup & versiegeschiedenis**.

## Delen en snelkoppelingen

Op Android en iOS worden gedeelde tekst en URL’s een nieuwe notitie in de inbox-map; afbeeldingen en bestanden worden als bijlage geïmporteerd (maximaal 25 MB per bestand). Houd op Android het app-pictogram ingedrukt voor de extra snelkoppelingen **Nieuwe notitie** en **Vandaag**. Op de vaultpagina kun je **Instellingen synchroniseren** inschakelen en een versleutelde vault veilig met de wachtwoordzin ontgrendelen of vergrendelen.

## Mappen, foto’s en agenda

De zwevende knop **Plus** blijft beschikbaar in geneste mappen en elke snelle actie gebruikt de geopende map. In de mapkop opent het **driepuntenmenu** de instellingen; nieuwe mappen maak je via de knop **Plus**.

De fotoknop vraagt **Foto maken** of **Uit fotobibliotheek kiezen**, behoudt de invoegpositie en toont toestemmings- of bestandsfouten. Foto's komen in de bijlagenmap van de kluis terecht, dezelfde die je computer gebruikt.

**Agenda** opent direct de agenda van de verbonden provider. Dagnotities blijven in **Vandaag**; het voormalige lokale maandoverzicht is verwijderd zonder bestaande gegevens te wijzigen.
