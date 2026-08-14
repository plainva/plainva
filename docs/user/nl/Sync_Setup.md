# Sync instellen

Laatst bijgewerkt: 2026-08-14
Plainva synchroniseert elke vault optioneel met een opslag naar keuze — rechtstreeks vanuit de app, zonder tussenliggende dienst van Plainva: je gegevens gaan uitsluitend tussen je computer en je eigen account/server. Deze pagina loodst je door de installatie per provider.

Welke diensten in het algemeen werken (ook via WebDAV of de desktop-client van de provider) staat in [Sync-compatibiliteit](Sync_Compatibility.md).

## Basisprincipes

- Installatie vind je onder **Instellingen → Vault → Cloudaccounts**: **Account verbinden…** opent de assistent — kies eerst de **provider**, vink dan de **diensten** aan (voor bestandssync: **Bestanden**), en meld je vervolgens aan. Het tegeloverzicht rangschikt de providers naar werkelijke verspreiding; via **Zoek naar providers…** vind je ook de e-mailproviders die als voorinstelling zijn opgenomen. **Precies één** account per vault draagt de dienst **Bestanden**. Het gebied **Synchronisatie** toont daarna het verbonden account met zijn **Cloudmap** en regelt het gedrag (**Sync-interval**, wachtrij); **Account beheren** leidt terug naar de cloudaccounts.
- Voor de dienst **Bestanden** zijn er naast **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Objectopslag (S3)** en generieke **WebDAV / CalDAV** ook **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** en **pCloud** als eigen tegels: daar volstaat je e-mailadres plus een **app-wachtwoord** — de serveradressen zijn al ingevuld (WebDAV-gebaseerd; te wijzigen via **Geavanceerd: endpoints afzonderlijk instellen**).
- **Een bestaande online vault vanaf het startscherm openen**: **Vault openen** → **Online vault** loodst je voor elke provider door dezelfde drie stappen — **1. Verbinden** (aanmelden of toegangsgegevens invoeren), **2. Map in de cloud kiezen** (daar kun je ook via **Nieuwe map** meteen een nieuwe map aanmaken), **3. Lokale map kiezen of aanmaken**. Je kunt de synchronisatie voor een al geopende vault ook altijd onder Instellingen instellen.
- **Een nieuwe vault in de cloud aanmaken**: **Nieuwe vault** → **Bij een onlinedienst** — kies eerst de startstructuur (leeg of een sjabloon zoals PARA), verbind daarna en kies de doelmap in de cloud of maak deze aan via **Nieuwe map**, ten slotte de lokale map. De structuur wordt in de lokale map aangemaakt en automatisch bij de eerste synchronisatie geüpload.
- Lokale opslagen worden meteen geüpload; op externe wijzigingen controleert Plainva op het ingestelde **Sync-interval (seconden)**.
- Offline wijzigingen worden verzameld in een wachtrij en overgedragen bij het volgende contact; de statusbalk toont **Online**/**Offline** en de sync-indicator de status (**Nu synchroniseren** bij klik). Bij een lange of eerste synchronisatie toont de statusbalk de voortgang als een teller (bijv. **Sync 123/540**), zodat je ziet dat de vault wordt doorgewerkt.
- Wijzigen beide kanten hetzelfde bestand, dan voegt Plainva ze automatisch samen (3-weg-merge). Lukt dat niet, dan wordt jouw versie veilig bewaard als een `.CONFLICT`-bestand — er gaat nooit iets verloren (zie [FAQ](FAQ.md)).
- **Conflicten oplossen**: een banner in de betreffende notitie (en **Conflict oplossen…** in het rechtsklikmenu van het `.CONFLICT`-bestand in de boom) opent het vergelijkingsdialoogvenster — de huidige staat van het bestand links, jouw bewaarde versie rechts, bewerkbaar met overname per blok. **Rechterversie opslaan en oplossen** schrijft het resultaat naar het bestand en ruimt de conflictkopie op; **Andere kant behouden** verwerpt jouw kopie (een versiesnapshot blijft bewaard). Ook het synchronisatiefout-dialoogvenster toont bestaande conflictkopieën en leidt je met één klik naar diezelfde vergelijking.
- **Bescherming tegen massaverwijderingen**: als een ongewoon groot deel van de gesynchroniseerde bestanden in één keer in de cloud verwijderd dreigt te worden (bijvoorbeeld omdat de lokale vault-map is geleegd of verplaatst), houdt Plainva de verwijderingen aan en vraagt eerst: **In de cloud verwijderen** voert ze uit, **Niet verwijderen (herstellen)** verwerpt ze en herstelt de bestanden bij de volgende synchronisatie vanuit de cloud. Verwijderingen die je zelf in Plainva hebt bevestigd, worden niet vastgehouden — bij grote verwijderingen (meer dan 10 bestanden of meer dan 20% van de vault) vraagt Plainva in plaats daarvan vóór het verwijderen een tweede keer om bevestiging.
- Bijlagen (afbeeldingen enz.) worden mee gesynchroniseerd.
- **Lege mappen** worden ook gesynchroniseerd: een map die je in Plainva aanmaakt, verschijnt meteen in de cloud, en lege cloudmappen verschijnen uiterlijk bij de volgende volledige lijst op je andere apparaten.
- Toegangsgegevens en tokens komen terecht in de sleutelhanger van het besturingssysteem (status: **Instellingen → App → Over & diagnose → OS-sleutelhanger**), nooit in bestanden binnen de vault.
- **Opgeslagen toegang** (**Instellingen → Vault → Synchronisatie**) laat zien wat Plainva in de sleutelhanger heeft gezet — ook items uit vaults die je allang niet meer opent. Elke regel noemt de dienst en de vault; **Verwijderen** vraagt eerst. Plainva verwijdert hier nooit iets uit zichzelf.
- De items in de sleutelhanger hebben **leesbare namen** — `plainva · <vault> · <dienst> · <account-id> · #<vingerafdruk>` in plaats van een base64-tekenreeks. Plainva hernoemt bestaande items eenmalig, bij de eerste keer dat een vault wordt geopend; kan een hernoeming niet veilig worden voltooid, dan blijft het oude item staan en probeert Plainva het bij de volgende keer opnieuw.
- **Ontkoppelen** stopt de sync van de vault; er worden hierbij nergens bestanden verwijderd.
- **`http://` is toegestaan, `https://` is de aanbeveling.** Een server die je zelf op je eigen netwerk draait, gebruikt meestal onversleuteld `http` — dat werkt, ook op de telefoon. Over het internet zou je dat niet moeten doen: WebDAV stuurt je wachtwoord bij **elke** aanvraag onversleuteld mee via `http`. Voer je buiten je eigen netwerk een onversleuteld adres in, dan wijst Plainva daarop in het formulier — tegenhouden doet het niet.

## WebDAV / Nextcloud

De eenvoudigste weg voor eigen servers en de meeste cloudopslag:

1. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Nextcloud** (of **WebDAV / CalDAV**).
2. Voer het **Serveradres**, de **Gebruikersnaam** en het **Wachtwoord of app-token** in — gebruik indien mogelijk een app-wachtwoord in plaats van je hoofdwachtwoord (in Nextcloud: Instellingen → Beveiliging → App-wachtwoorden).
3. **Verbinden** controleert de toegangsgegevens; kies daarna de **Cloudmap** via **Map kiezen…**.

Bijzonderheid **Nextcloud**: ÉÉN formulier dekt bestanden **en** agenda — Plainva leidt de WebDAV- en CalDAV-endpoints zelf af uit het serveradres (de afgeleide adressen worden in de assistent getoond; **Geavanceerd: endpoints afzonderlijk instellen** maakt aparte URL's mogelijk). Vink beide diensten aan en één keer verbinden koppelt ze allebei.

Typische serveradressen (Nextcloud, Koofr, MagentaCLOUD, Storage Box en vele andere) vind je in [Sync-compatibiliteit](Sync_Compatibility.md).

Verandert het app-wachtwoord later, voer het dan **één keer** in bij de accountgegevens onder **Inloggegevens**: Plainva controleert het bij elke dienst van dat account en slaat het pas op als ze het allemaal accepteren — zo blijft geen dienst achter met een oud wachtwoord.

## Google Drive

Google Drive draait momenteel met eigen toegangsgegevens ("Bring Your Own"): je maakt eenmalig een gratis eigen Google Cloud-project aan, dat alleen van jou is. De stap-voor-stap-handleiding: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Kort samengevat: kies in **Cloudaccounts** → **Account verbinden…** de tegel **Google**, vink de dienst **Bestanden** aan, voer de **Client-ID** en **Client secret** uit je Google-project in, en dan **Aanmelden met Google…** — de aanmelding opent in je browser. Eenmaal verbonden kies je de **Cloudmap** via **Map kiezen…** rechtstreeks uit je Drive (submappen inbegrepen, standaard "Plainva"). Let op: zolang het Google-project in de testmodus staat, laat Google elke aanmelding na 7 dagen verlopen — een eigenschap van je eigen Google-project, geen intrekking, ook al lijkt het er precies op. **Opnieuw verbinden** in de accountdetails herstelt de toegang in één stap; publiceer je het project, dan stopt het terugkerende verlopen.

Vink je bij het verbinden **Bestanden** en **Agenda** samen aan, dan vraagt Google slechts **één keer** om toestemming — precies voor de rechten van de gekozen diensten. Voeg je later een dienst toe, dan volgt een tweede, aanvullende toestemming.

## OneDrive

Plainva levert een eigen app-registratie mee — je hoeft **geen eigen ID meer aan te maken**:

1. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Microsoft** en vink de dienst **Bestanden** (OneDrive) aan — desgewenst samen met **Agenda en taken** en **E-mail** (één Microsoft-account kan alle drie de diensten dragen).
2. **Aanmelden met Microsoft…** en bevestig de aanmelding in de browser. Klaar — Plainva maakt de map aan (standaard "Plainva") en synchroniseert de volledige inhoud, ook extern toegevoegde bestanden.
3. Optioneel: eenmaal verbonden kies je de **Cloudmap** via **Map kiezen…** rechtstreeks uit je OneDrive (submappen inbegrepen).

Optioneel: via **Eigen app-ID gebruiken** kun je in plaats daarvan een zelf geregistreerde client-ID opgeven (bijv. bij bedrijfsbeperkingen). Uitgebreide handleiding: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Verbind je meerdere Microsoft-diensten tegelijk — bijvoorbeeld **Bestanden** en **Agenda** — dan vraagt Microsoft slechts **één keer** om toestemming en bewaart Plainva één aanmelding voor het hele account. Accounts die nog per dienst aanmelden zijn in de accountlijst gemarkeerd met **Oude aanmelding** en bieden **Een login voor alle diensten** — in de lijst en in de accountgegevens: één stap, en daarna delen alle diensten dezelfde aanmelding.

Hetzelfde geldt inmiddels voor **Google**: een account dat nog los per dienst is aangemeld (Bestanden, Agenda, Taken) biedt net als bij Microsoft **Een login voor alle diensten** in de accountgegevens aan, en een nieuwe aanmelding vernieuwt voortaan meteen het hele account in plaats van maar één dienst. Gmail blijft hierbuiten — dat verbindt via IMAP met een app-wachtwoord, waar niets samen te voegen valt.

## Dropbox

Plainva levert een eigen Dropbox-app mee — **geen eigen app nodig**:

1. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Dropbox** (deze draagt alleen de dienst **Bestanden**).
2. **Aanmelden met Dropbox…** en bevestig in de browser. Klaar (standaardmap `/Plainva`).
3. Optioneel: eenmaal verbonden kies je de **Cloudmap** via **Map kiezen…** rechtstreeks uit je Dropbox (submappen inbegrepen).

Optioneel: via **Eigen app-ID gebruiken** kun je in plaats daarvan een zelf geregistreerde app-key opgeven. Uitgebreide handleiding: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-compatibele opslag

Voor AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner en andere — sleutelgebaseerd, helemaal zonder browseraanmelding. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Objectopslag (S3)** en vul de velden in:

| Veld | Betekenis |
|---|---|
| **Endpoint** | Basis-URL van de S3-API, bijv. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` of `http://127.0.0.1:9000` voor lokale MinIO |
| **Bucket** | Naam van de bucket |
| **Regio** | SigV4-regio; `us-east-1` werkt voor de meeste niet-AWS-opslag, Cloudflare R2 gebruikt `auto` |
| **Access Key ID** / **Secret Access Key** | Een API-sleutelpaar van de provider |
| **Key-prefix (optioneel)** | Submap in de bucket voor de vault; leeg = bucket-root |
| **Path-style-URL's** | Aanbevolen (MinIO, R2 en de meeste compatibele opslag); alleen uitschakelen voor virtual-hosted AWS-buckets |

Je kunt de **Key-prefix** (de cloudmap) via **Map kiezen…** rechtstreeks uit de bucket kiezen zodra je verbonden bent.

Na **Verbinden** start de sync direct.

## Zie ook

- [Sync-compatibiliteit](Sync_Compatibility.md) — welke diensten hoe werken, inclusief de desktop-client-route
- [FAQ & probleemoplossing](FAQ.md) — conflictbestanden, offline-gedrag

## Sync-versleuteling (wachtwoordzin)

> **Vervangen in P3:** De onderstaande instructies gelden niet meer voor vaultinhoud. Gebruik [Beveiliging en delen](Security_and_Sharing.md). De wachtzin hier beschermt alleen optionele instellingen en geheimen.

Plainva kan versleutelen wat je apparaat richting de sync-server verlaat, terwijl je lokale vault altijd platte Markdown blijft die Obsidian kan lezen.

Open **Instellingen → Synchronisatie → Sync-wachtwoordzin en versleuteling**:

1. **Stel een wachtwoordzin in.** Dit maakt een versleutelingssleutel voor de vault aan en toont eenmalig een **herstelcode** — bewaar deze veilig; het is de enige weg terug als je de wachtwoordzin vergeet. Vanaf dat moment reizen de gesynchroniseerde **instellingen** van de vault versleuteld.
2. **Vault-inhoud versleutelen** (optioneel). De knop **Versleutelen** uploadt elke notitie opnieuw als versleutelde tekst naar de sync-server. Je lokale bestanden blijven platte Markdown, dus een lokale vault loopt nooit risico — probeer het eerst op een wegwerpvault. Zodra de upload klaar is, gebruik je **Migratie voltooien** om vanaf dan alleen nog versleutelde tekst te accepteren.
3. **Op een ander apparaat** open je dezelfde gesynchroniseerde vault. Plainva merkt dat de vault versleuteld is en vraagt om de wachtwoordzin (of de herstelcode). Na het ontgrendelen worden de notities ontsleuteld en verschijnen ze lokaal.

De ontgrendelde sleutel wordt op elk apparaat in de cache bewaard. Zet **Wachtwoordzin bij elke start vereisen** aan om deze in plaats daarvan na elke herstart opnieuw in te voeren, en gebruik **Vergrendelen** om de gecachete sleutel op dit apparaat te verwijderen.

**Accounts op al je apparaten** bestaat uit drie stappen. **1 · Instellingen en accounts**: zet kluisinstellingen *en je accounts* (agenda’s, postvakken, agendaselectie) als klein bestand in de kluis — zolang er geen wachtwoordzin is ingesteld is er **geen** nodig; zodra er een is, moet elk apparaat hem invoeren voordat instellingen daarvandaan meereizen. **2 · Sync-wachtwoordzin** (optioneel): alleen nodig als ook aanmeldingen mee moeten reizen; dit versleutelt bovendien de instellingen uit stap 1. **3 · Aanmeldingen meenemen**: neemt daarnaast statische IMAP- en CalDAV-wachtwoorden versleuteld mee en kan pas aan als stap 1 draait en de wachtwoordzin ontgrendeld is — een wachtwoord kan alleen naar een account dat het apparaat al kent. Niet meegenomen: apparaatspecifieke paden en OAuth-aanmeldingen (Microsoft, Google); hun tokens zijn apparaatgebonden, dus het account verschijnt op het nieuwe apparaat en heeft daar één keer **Aanmelden** nodig.

Op de **telefoon** vind je dezelfde keten op de kluispagina — dezelfde drie stappen en dezelfde vergrendeling. Accounts die van een ander apparaat komen, worden daar aangemaakt; je voert ze niet meer handmatig in. Met **Nu overnemen van een ander apparaat** haal je ze meteen op in plaats van op de volgende ronde te wachten.

Als Plainva meldt dat een **oudere versie nog uitgefaseerde accountgegevens publiceert**, werk Plainva dan bij op elk apparaat dat deze kluis gebruikt. Het huidige apparaat negeert oude Google-clientgegevens en behoudt de werkende lokale aanmelding. Bevestig het verwijderen van de oude externe gegevens pas nadat alle deelnemende apparaten zijn bijgewerkt. Plainva biedt daarvoor de knop in de melding onder **Instellingen → Vault → Synchronisatie → Diagnose**: **Uitgefaseerde items verwijderen** — de vraag die daarbij wordt gesteld is precies die bevestiging.

Waar die **aanmelding** plaatsvindt hangt van de dienst af: een postbus toont de knop **Op dit apparaat aanmelden** op de eigen regel in het gebied **E-mail**, een agenda- of bestandsaccount doet dat in **Cloudaccounts**. Een Microsoft-postbus leidt altijd naar **Cloudaccounts**, omdat de aanmelding daar in de browser verloopt.

Zet je de versleuteling **nieuw** op, dan staat stap 3 meteen aan — anders zou elk volgend apparaat blijvend zonder aanmeldingen zitten. Bij een kluis die je al gebruikt verandert er niets stilletjes: Plainva vraagt het één keer en onthoudt je antwoord.

Verschijnt één account als **twee kaarten**, dan kon Plainva de identiteit niet bij de aanbieder ophalen — en gokken mag het niet. Open een van beide onder **Cloudaccounts** en zeg via **Samenvoegen** dat het hetzelfde account is; Plainva laat vooraf zien wat wordt overgenomen.

## Wat meereist en wat hier blijft

Als onder **Cloudaccounts** de sectie **Dubbele accounts controleren** verschijnt, raadt Plainva bewust niet op basis van de naam. Kies **Dit account behouden** bij de juiste kaart. De bevestiging noemt doel, bronnen en betrokken diensten en maakt eerst een back-up op dit apparaat. **Annuleren** wijzigt niets. Samenvoegen verwijdert alleen verweesde lokale accounts, caches en aanmeldgegevens; bij de provider wordt niets verwijderd.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Reist mee met de kluis | Blijft op dit apparaat |
| --- | --- |
| Accounts — agenda's, mailboxen, cloudaccounts, bladwijzers | Absolute paden — locatie van de kluis, back-upbestemming |
| Mappen en sjablonen — dagnotities, sjabloonmap, Inbox-map, bijlagenmap, takendatabase | Aanmeldtokens voor Microsoft en Google |
| Agenda-instellingen — vergadermap, standaardagenda | Welke mailbox en map je het laatst open had |
| E-mailinstellingen — opslagmap, externe afbeeldingen | De startindeling van dit apparaat voor nieuwe kluizen |
| Back-upregels — momentopname-interval, bewaartermijn, archieven | Statische wachtwoorden — tenzij stap 3 aanstaat |
| Synchronisatie-interval |  |
| Indeling van de balken (desktop) |  |

De telefoon draagt hier iets minder van: de indeling van de vier **desktop**-balken blijft op de computer — zijn eigen navigatiebalk reist wél mee, net als de vergadermap. Zijn eigen keten op de kluispagina laat zien wat hij wél draagt, en beide apparaten vertellen daaronder wat de synchronisatie het laatst werkelijk deed — met de namen van de instellingen die meereisden en, bij een ontvangst, die zijn gewijzigd. De melding “Instellingen overgenomen van een ander apparaat” verschijnt hoogstens één keer per sessie en alleen bij een echte wijziging — daarna vertellen deze regels het. Nieuw sinds deze versie neemt de telefoon ook de bestandsnaamopmaak van dagnotities, het OKF-type van nieuwe notities en je bladwijzers over — daarvoor kreeg een kluis met een andere datumopmaak een tweede dagnotitie voor dezelfde dag zodra de telefoon hem aanraakte.

De diagnose toont nu afzonderlijk **laatst gecontroleerd** (lokale profielvelden), **laatst gedownload**, **laatst toegepast** en **laatst daadwerkelijk verstuurd**. ‘Verstuurd’ verandert alleen na een geslaagde cloudschrijfopdracht; ongewijzigde rondes werken dus controle en download bij, maar niet de verzendtijd. Resultaten voor geheimen staan apart als aantallen geïmporteerd, ongewijzigd, geweigerd, verouderd, mislukt of wachtend op een account. Ze bevatten alleen stabiele redencodes — nooit een account-id, wachtwoord, token of ruwe fout. Een melding over een oudere client betekent dat Plainva op alle deelnemende apparaten moet worden bijgewerkt; dit apparaat negeert de uitgefaseerde Google-clientgegevens.

## Fouten en automatisch opnieuw proberen

Het foutvenster bewaart de exacte mislukte poging, ook als een automatische nieuwe poging de live-status al heeft gewijzigd. Het meldt of de poging loopt of is geslaagd. Opnieuw verbinden wordt alleen bij een authenticatiefout aangeraden; netwerk-, time-out- en providerfouten behouden hun details en worden automatisch opnieuw geprobeerd.

## Namen die alleen in schrijfwijze verschillen

Google Drive maakt bij het zoeken geen onderscheid tussen hoofd- en kleine letters, en Windows en macOS bewaren `Notitie.md` en `notitie.md` in hetzelfde bestand. Bevat één map twee notities waarvan de namen alleen daarin verschillen — of alleen in hoe een letter met trema wordt geschreven (`ü` als één teken of als `u` met trema) —, dan kan Plainva ze aan de andere kant niet uit elkaar houden. De synchronisatie wijzigt en verwijdert dan niets en meldt in plaats daarvan een fout met beide namen. Hernoem een van beide notities, dan loopt de synchronisatie verder.
