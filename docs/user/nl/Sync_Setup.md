# Sync instellen

Laatst bijgewerkt: 2026-07-21

Plainva synchroniseert elke vault optioneel met een opslag naar keuze — rechtstreeks vanuit de app, zonder tussenliggende dienst van Plainva: je gegevens gaan uitsluitend tussen je computer en je eigen account/server. Deze pagina loodst je door de installatie per provider.

Welke diensten in het algemeen werken (ook via WebDAV of de desktop-client van de provider) staat in [Sync-compatibiliteit](Sync_Compatibility.md).

## Basisprincipes

- Installatie vind je onder **Instellingen → Vault → Cloudaccounts**: **Account verbinden…** opent de assistent — kies eerst de **provider**, vink dan de **diensten** aan (voor bestandssync: **Bestanden**), en meld je vervolgens aan. Het tegeloverzicht rangschikt de providers naar werkelijke verspreiding; via **Zoek naar providers…** vind je ook de e-mailproviders die als voorinstelling zijn opgenomen. **Precies één** account per vault draagt de dienst **Bestanden**. Het gebied **Synchronisatie** toont daarna het verbonden account met zijn **Cloudmap** en regelt het gedrag (**Sync-interval**, wachtrij); **Account beheren** leidt terug naar de cloudaccounts.
- Voor de dienst **Bestanden** zijn er naast **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Objectopslag (S3)** en generieke **WebDAV / CalDAV** ook **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** en **pCloud** als eigen tegels: daar volstaat je e-mailadres plus een **app-wachtwoord** — de serveradressen zijn al ingevuld (WebDAV-gebaseerd; te wijzigen via **Geavanceerd: endpoints afzonderlijk instellen**).
- **Een bestaande online vault vanaf het startscherm openen**: **Vault openen** → **Online vault** loodst je voor elke provider door dezelfde drie stappen — **1. Verbinden** (aanmelden of toegangsgegevens invoeren), **2. Map in de cloud kiezen** (daar kun je ook via **Nieuwe map** meteen een nieuwe map aanmaken), **3. Lokale map kiezen of aanmaken**. Je kunt de synchronisatie voor een al geopende vault ook altijd onder Instellingen instellen.
- **Een nieuwe vault in de cloud aanmaken**: **Nieuwe vault** → **Bij een onlinedienst** — kies eerst de startstructuur (leeg of een sjabloon zoals PARA), verbind daarna en kies de doelmap in de cloud of maak deze aan via **Nieuwe map**, ten slotte de lokale map. De structuur wordt in de lokale map aangemaakt en automatisch bij de eerste synchronisatie geüpload.
- Lokale opslagen worden meteen geüpload; op externe wijzigingen controleert Plainva op het ingestelde **Sync-interval (seconden)**.
- Offline wijzigingen worden verzameld in een wachtrij en overgedragen bij het volgende contact; de statusbalk toont **Online**/**Offline** en de sync-indicator de status (**Nu synchroniseren** bij klik). Bij een lange of eerste synchronisatie toont de statusbalk de voortgang als een teller (bijv. **Sync 123/540**), zodat je ziet dat de vault wordt doorgewerkt.
- Wanneer je voor het eerst een online vault verbindt, wijst een eenmalige melding je erop dat de eerste synchronisatie afhankelijk van de vaultgrootte even kan duren — je kunt ondertussen gewoon doorwerken.
- Wijzigen beide kanten hetzelfde bestand, dan voegt Plainva ze automatisch samen (3-weg-merge). Lukt dat niet, dan wordt jouw versie veilig bewaard als een `.CONFLICT`-bestand — er gaat nooit iets verloren (zie [FAQ](FAQ.md)).
- **Conflicten oplossen**: een banner in de betreffende notitie (en **Conflict oplossen…** in het rechtsklikmenu van het `.CONFLICT`-bestand in de boom) opent het vergelijkingsdialoogvenster — de huidige staat van het bestand links, jouw bewaarde versie rechts, bewerkbaar met overname per blok. **Rechterversie opslaan en oplossen** schrijft het resultaat naar het bestand en ruimt de conflictkopie op; **Andere kant behouden** verwerpt jouw kopie (een versiesnapshot blijft bewaard). Ook het synchronisatiefout-dialoogvenster toont bestaande conflictkopieën en leidt je met één klik naar diezelfde vergelijking.
- **Bescherming tegen massaverwijderingen**: als een ongewoon groot deel van de gesynchroniseerde bestanden in één keer in de cloud verwijderd dreigt te worden (bijvoorbeeld omdat de lokale vault-map is geleegd of verplaatst), houdt Plainva de verwijderingen aan en vraagt eerst: **In de cloud verwijderen** voert ze uit, **Niet verwijderen (herstellen)** verwerpt ze en herstelt de bestanden bij de volgende synchronisatie vanuit de cloud. Verwijderingen die je zelf in Plainva hebt bevestigd, worden niet vastgehouden — bij grote verwijderingen (meer dan 10 bestanden of meer dan 20% van de vault) vraagt Plainva in plaats daarvan vóór het verwijderen een tweede keer om bevestiging.
- Bijlagen (afbeeldingen enz.) worden mee gesynchroniseerd.
- **Lege mappen** worden ook gesynchroniseerd: een map die je in Plainva aanmaakt, verschijnt meteen in de cloud, en lege cloudmappen verschijnen uiterlijk bij de volgende volledige lijst op je andere apparaten.
- Toegangsgegevens en tokens komen terecht in de sleutelhanger van het besturingssysteem (status: **Instellingen → App → Over & diagnose → OS-sleutelhanger**), nooit in bestanden binnen de vault.
- **Ontkoppelen** stopt de sync van de vault; er worden hierbij nergens bestanden verwijderd.

## WebDAV / Nextcloud

De eenvoudigste weg voor eigen servers en de meeste cloudopslag:

1. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Nextcloud** (of **WebDAV / CalDAV**).
2. Voer het **Serveradres**, de **Gebruikersnaam** en het **Wachtwoord of app-token** in — gebruik indien mogelijk een app-wachtwoord in plaats van je hoofdwachtwoord (in Nextcloud: Instellingen → Beveiliging → App-wachtwoorden).
3. **Verbinden** controleert de toegangsgegevens; kies daarna de **Cloudmap** via **Map kiezen…**.

Bijzonderheid **Nextcloud**: ÉÉN formulier dekt bestanden **en** agenda — Plainva leidt de WebDAV- en CalDAV-endpoints zelf af uit het serveradres (de afgeleide adressen worden in de assistent getoond; **Geavanceerd: endpoints afzonderlijk instellen** maakt aparte URL's mogelijk). Vink beide diensten aan en één keer verbinden koppelt ze allebei.

Typische serveradressen (Nextcloud, Koofr, MagentaCLOUD, Storage Box en vele andere) vind je in [Sync-compatibiliteit](Sync_Compatibility.md).

## Google Drive

Google Drive draait momenteel met eigen toegangsgegevens ("Bring Your Own"): je maakt eenmalig een gratis eigen Google Cloud-project aan, dat alleen van jou is. De stap-voor-stap-handleiding: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Kort samengevat: kies in **Cloudaccounts** → **Account verbinden…** de tegel **Google**, vink de dienst **Bestanden** aan, voer de **Client-ID** en **Client secret** uit je Google-project in, en dan **Aanmelden met Google…** — de aanmelding opent in je browser. Eenmaal verbonden kies je de **Cloudmap** via **Map kiezen…** rechtstreeks uit je Drive (submappen inbegrepen, standaard "Plainva"). Let op: zolang het Google-project in de testmodus staat, verloopt de aanmelding na 7 dagen en moet die worden vernieuwd via **Opnieuw verbinden** in de accountdetails.

## OneDrive

Plainva levert een eigen app-registratie mee — je hoeft **geen eigen ID meer aan te maken**:

1. Kies in **Cloudaccounts** → **Account verbinden…** de tegel **Microsoft** en vink de dienst **Bestanden** (OneDrive) aan — desgewenst samen met **Agenda en taken** en **E-mail** (één Microsoft-account kan alle drie de diensten dragen).
2. **Aanmelden met Microsoft…** en bevestig de aanmelding in de browser. Klaar — Plainva maakt de map aan (standaard "Plainva") en synchroniseert de volledige inhoud, ook extern toegevoegde bestanden.
3. Optioneel: eenmaal verbonden kies je de **Cloudmap** via **Map kiezen…** rechtstreeks uit je OneDrive (submappen inbegrepen).

Optioneel: via **Eigen app-ID gebruiken** kun je in plaats daarvan een zelf geregistreerde client-ID opgeven (bijv. bij bedrijfsbeperkingen). Uitgebreide handleiding: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

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

Plainva kan versleutelen wat je apparaat richting de sync-server verlaat, terwijl je lokale vault altijd platte Markdown blijft die Obsidian kan lezen.

Open **Instellingen → Synchronisatie → Sync-wachtwoordzin en versleuteling**:

1. **Stel een wachtwoordzin in.** Dit maakt een versleutelingssleutel voor de vault aan en toont eenmalig een **herstelcode** — bewaar deze veilig; het is de enige weg terug als je de wachtwoordzin vergeet. Vanaf dat moment reizen de gesynchroniseerde **instellingen** van de vault versleuteld.
2. **Vault-inhoud versleutelen** (optioneel). De knop **Versleutelen** uploadt elke notitie opnieuw als versleutelde tekst naar de sync-server. Je lokale bestanden blijven platte Markdown, dus een lokale vault loopt nooit risico — probeer het eerst op een wegwerpvault. Zodra de upload klaar is, gebruik je **Migratie voltooien** om vanaf dan alleen nog versleutelde tekst te accepteren.
3. **Op een ander apparaat** open je dezelfde gesynchroniseerde vault. Plainva merkt dat de vault versleuteld is en vraagt om de wachtwoordzin (of de herstelcode). Na het ontgrendelen worden de notities ontsleuteld en verschijnen ze lokaal.

De ontgrendelde sleutel wordt op elk apparaat in de cache bewaard. Zet **Wachtwoordzin bij elke start vereisen** aan om deze in plaats daarvan na elke herstart opnieuw in te voeren, en gebruik **Vergrendelen** om de gecachete sleutel op dit apparaat te verwijderen.

**Instellingen synchroniseren** draagt gedeelde vault-instellingen en accountmetadata over; lokale paden, indeling en runtimegegevens blijven apparaatspecifiek. **Accountgeheimen synchroniseren** is een afzonderlijke optie voor toegestane statische app-wachtwoorden en BYO-inloggegevens; OAuth-tokens worden nooit gedeeld. De versleutelingsstatus begeleidt **Voorbereiden**, **Migratie**, **Strikt**, **Ontsleutelen** en **Sleutelrotatie**. Mobiele apparaten kunnen dezelfde versleutelde vault met de wachtwoordzin ontgrendelen.
