# Google Drive Sync instellen (Bring Your Own Credentials)

Om in Plainva een lokale vault te synchroniseren met je Google Drive, kun je eigen Google API-toegangsgegevens ("credentials") gebruiken. Omdat Plainva (nog) geen centrale CASA-verificatie door Google heeft doorlopen, biedt deze **Bring Your Own Credentials (BYO)**-aanpak een veilige manier om je privébestanden te synchroniseren.

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

*Belangrijk: laat de status op "Testing" staan. Je hoeft de app NIET te publiceren. In testmodus verlopen tokens na 7 dagen — Plainva vernieuwt die automatisch op de achtergrond, maar na significante wijzigingen of scope-wisselingen moet je je mogelijk opnieuw aanmelden.*

### 4. Credentials (Client-ID & secret) aanmaken
1. Ga links in het menu naar **Credentials**.
2. Klik bovenaan op **Credentials maken** en kies **OAuth-client-ID**.
3. Kies als "Toepassingstype" **Desktopapp** (of "Overige UI").
4. Naam: bijv. "Plainva Desktop Client".
5. Klik op **Maken**.
6. Er verschijnt een pop-up met je **Client-ID** en **Client secret**.

### 5. Invoeren in Plainva
1. Open Plainva en ga naar de vault-instellingen (tandwielicoon voor de betreffende vault).
2. Open de sectie **Cloud Sync**.
3. Kies **Google Drive** als provider.
4. Plak de gekopieerde **Client-ID** en het **Client secret** in de bijbehorende velden.
5. Klik op **Verbinden met Google**.
6. Er opent een Google-browservenster. Meld je aan met het account dat je onder "Testgebruikers" hebt toegevoegd.
7. Google waarschuwt mogelijk dat de app niet is geverifieerd. Klik op **Geavanceerd** en dan op **Doorgaan naar Plainva (onveilig)**.
8. Bevestig de gevraagde machtigingen.

Je vault synchroniseert nu veilig met Google Drive via je eigen credentials.
