# Google Drive Sync instellen (Bring Your Own Credentials)

Laatst bijgewerkt: 2026-10-26

Plainva meldt zich aan bij Google met **Aanmelding op dit apparaat**. Als je build de **Standaardaanmelding** voor Google bevat, voer je niets in en heb je deze pagina niet nodig. Anders — of als je liever een eigen project gebruikt — gebruik je je eigen Google API-toegangsgegevens ("credentials"): deze **Bring Your Own Credentials (BYO)**-aanpak biedt een veilige manier om je privébestanden te synchroniseren.

Je richt hierbij als het ware een eigen "ontwikkelaarsproject" bij Google in, dat uitsluitend van jou is en waartoe alleen jij toegang hebt.

## Stap-voor-stap-handleiding

### 1. Een project aanmaken in de Google Cloud Console
1. Ga naar de [Google Cloud Console](https://console.cloud.google.com/).
2. Meld je aan met je Google-account.
3. Klik linksboven (naast het Google Cloud-logo) op het projecten-dropdownmenu en kies **Nieuw project**.
4. Voer een naam in (bijv. "Plainva Sync") en klik op **Maken**.

### 2. De Google Drive API inschakelen
1. Selecteer je nieuw aangemaakte project bovenaan in het dropdownmenu.
2. Zoek in de bovenste zoekbalk naar **Google Drive API** en kies het item onder "Marketplace".
3. Klik op **Inschakelen**.

### 3. Het OAuth-toestemmingsscherm configureren
Om Plainva je credentials te laten gebruiken, moet een toestemmingsscherm ("OAuth Consent Screen") worden ingesteld. Omdat alleen jij de app gebruikt, blijft dit in "testmodus".

1. Ga in het linker zijmenu onder **API's en services** naar **OAuth-toestemmingsscherm**.
2. Kies onder "Gebruikerstype" **Extern** (tenzij je Google Workspace gebruikt) en klik op **Maken**.
3. **App-informatie:**
   - App-naam: bijv. "Plainva"
   - E-mailadres voor gebruikersondersteuning: je eigen e-mailadres
   - Contactgegevens ontwikkelaar: je eigen e-mailadres
   - Klik op **Opslaan en doorgaan**.
4. **Bereiken (scopes):**
   - Klik op **Bereiken toevoegen of verwijderen**.
   - Zoek naar `.../auth/drive` (Google Drive API, volledige toegang) en vink het aan.
   - *Achtergrond: volledige toegang is nodig zodat Plainva ook bestanden kan synchroniseren die je rechtstreeks via de Google Drive-webinterface in je sync-map plaatst.*
   - Klik op Bijwerken, dan op **Opslaan en doorgaan**.
5. **Testgebruikers:**
   - Klik op **Gebruikers toevoegen**.
   - Voer precies het Google-e-mailadres in dat je later voor sync in Plainva zult gebruiken.
   - Klik op **Opslaan en doorgaan**, ga dan terug naar het dashboard.

*Belangrijk: je hoeft de app NIET te publiceren — in de status "Testing" werkt ze volledig. Houd er dan wel rekening mee dat Google de aanmelding na **7 dagen** laat verlopen, en wel definitief: in deze modus verloopt ook het vernieuwingstoken, Plainva kan het op de achtergrond dus niet verversen. Plainva zegt je dat dan in gewone taal ("Aanmelding verlopen"), en **Opnieuw verbinden** in de accountdetails herstelt haar in één doorloop voor alle diensten van dit account.*

**In productie** verwijdert de vaste vervaltijd van de testmodus. Dit garandeert geen blijvende aanmelding: Google kan toegang nog steeds laten verlopen of intrekken. De eisen voor publicatie en verificatie hangen af van het gebruik en de gevraagde rechten. [Google: vervallen van vernieuwingstokens](https://developers.google.com/identity/protocols/oauth2#expiration).

### 4. Credentials (Client-ID & secret) aanmaken
1. Ga links in het menu naar **Credentials**.
2. Klik bovenaan op **Credentials maken** en kies **OAuth-client-ID**.
3. Kies als "Toepassingstype" **Desktopapp** voor Plainva op een computer. Maak voor de telefoon (Android en iPhone) in plaats daarvan een client van het type **iOS** — zie het einde van deze pagina.
4. Naam: bijv. "Plainva Desktop Client".
5. Klik op **Maken**.
6. Er verschijnt een pop-up met je **Client-ID** en **Client secret**.

### 5. Invoeren in Plainva
1. Open **Instellingen → Vault → Cloudaccounts**.
2. Kies voor een nieuw account **Account verbinden…** → de tegel **Google** en vink de diensten aan; open voor een account dat je al hebt dat account en kies **Wijzigen** bij **Aanmelding op dit apparaat**.
3. Kies **Eigen client-ID** en plak de gekopieerde **Client-ID** en het **Client secret** — op de telefoon alleen de **Client-ID** van de iOS-client; die heeft geen secret. Kies daarna **Opslaan**.
4. Klik op **Aanmelden met Google…** (bij een account dat je al hebt: **Opnieuw verbinden**).
5. Er opent een Google-browservenster. Meld je aan met het account dat je onder "Testgebruikers" hebt toegevoegd.
6. Google waarschuwt mogelijk dat de app niet is geverifieerd. Klik op **Geavanceerd** en dan op **Doorgaan naar Plainva (onveilig)**.
7. Bevestig de gevraagde machtigingen — één toestemming dekt elke dienst die je hebt aangevinkt.
8. De eigen client-ID geldt alleen voor dit apparaat; andere apparaten behouden hun instelling. Voer die in op elk apparaat dat je project moet gebruiken.

Je vault synchroniseert nu veilig met Google Drive via je eigen credentials.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

De desktopinstructies hierboven vereisen een desktopclient met client-ID en bijbehorend clientgeheim. Op de telefoon, op Android net als op iOS, meldt Plainva zich in de browser aan bij Google: maak in je Google-project een OAuth-client van het type **iOS**, ook voor Android, met de bundel-ID `com.plainva.app`. Plainva keert terug via `com.plainva.app:/oauth2redirect`; er is geen clientgeheim. Voer de client-ID op de telefoon in onder **Aanmelding op dit apparaat** → **Eigen client-ID**. Maak geen client van het type Android: Google staat de pakketnaam en de certificaatvingerafdruk van de Play-build wereldwijd in precies één project toe en weigert elk ander (‘de Android-pakketnaam en vingerafdruk zijn al in gebruik’). Een Android-client die voor Plainva 0.8.3 of 0.8.4 is ingericht, werkt niet voor een nieuwe aanmelding; accounts die al zijn aangemeld blijven werken. Een desktopclient vervangt de mobiele registratie niet. Schakel voor agenda's ook Google Calendar API en Google Tasks API in. Toont Google op de telefoon “Fout 400: redirect_uri_mismatch”, dan is de client-ID van het type “Desktop-app”: maak zoals hier beschreven een client van het type **iOS** aan en voer in plaats daarvan diens client-ID in. Onder het veld voor de client-ID leidt **Google-gids openen** naar dit gedeelte.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Voeg bestanden, agenda of e-mail direct toe aan het account dat ze moet dragen. Bij Google en Microsoft is dat één toestemming voor alles wat het account draagt plus de nieuwe dienst.

De Google-registratie past niet bij het terugkeerpad van dit apparaat. Controleer het clienttype en de mobiele instelling in de Google-handleiding.

<!-- account-grants-destination-2026-09-14 -->
Een algemene aanmeldfout vertelt Plainva niets over de publicatiestatus of testgebruikers van je Google-project. Controleer deze instellingen in Google Cloud en lees de specifieke melding. Een desktopclient vereist de client-ID en bijbehorende secretwaarde; mobiele registratie hangt af van het platform en de geïnstalleerde build.
