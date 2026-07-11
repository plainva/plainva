# FAQ & probleemoplossing

Laatst bijgewerkt: 2026-07-11

Antwoorden op de meest gestelde vragen — van Obsidian-compatibiliteit tot conflictbestanden en back-ups.

## Grondbeginselen

### Waar staan mijn gegevens?

Uitsluitend bij jou: een vault is een gewone map met Markdown-bestanden op je computer. Plainva draait geen eigen server en slaat nergens kopieën op. Synchroniseer je, dan gaat dat rechtstreeks tussen je computer en *jouw* opslag (jouw Nextcloud, jouw OneDrive, jouw bucket …). Toegangsgegevens staan in de sleutelhanger van het besturingssysteem.

### Kan ik Plainva en Obsidian naast elkaar gebruiken?

Ja — dat is een kernbelofte, met één eerlijke kanttekening. Plainva schrijft puur Markdown met standaard frontmatter; alles wat Plainva-specifiek is, staat gebundeld onder `plainva:`-sleutels (in notities en `.base`-bestanden), die Obsidian bij het openen van bestanden gewoon negeert. Obsidian toont de `plainva`-sleutel als niet-bewerkbaar object in de eigenschappen — dat is onschadelijk. Plainva-only weergaven zoals Bord of Kalender verschijnen in Obsidian als gewone tabel.

De kanttekening: **openen is altijd veilig, bewerken niet altijd.** Een bestaande Obsidian-vault kan zonder risico in Plainva worden geopend en bewerkt — er wordt niets gemigreerd of geherformatteerd. Maar zodra een vault Plainva-functies gebruikt (database-extensies zoals borden, relaties of omgekeerde kolommen, beheerde `index.md`-bestanden), kan het bewerken van die specifieke bestanden in Obsidian de Plainva-functionaliteit breken, omdat Obsidian de `plainva:`-extensies niet kent. Notities zonder Plainva-extensies kun je overal en altijd bewerken. Bij het eerste gebruik van zo'n uitbreiding wijst een herinneringsdialoog (**Plainva-extensie**) je hierop; uit te schakelen onder **Instellingen → App → Opstarten en gedrag**.

### Wijzigt Plainva mijn bestaande vault?

Niet ongevraagd. Bestaande bestanden worden alleen aangeraakt wanneer je expliciet een actie start (bijv. de [OKF-conversie](OKF.md) — met voorbeeld en back-ups). Alleen nieuw aangemaakte bestanden krijgen automatisch de kleine OKF-frontmatterkop.

## Bestanden & bewerken

### Ik heb iets verwijderd — is het weg?

Nee, zelfs dubbel niet: vóór elke verwijdering slaat Plainva het bestand op als snapshot — rechtsklik op de vaultnaam → **Verwijderde bestanden herstellen…** haalt het terug binnen de app. Daarnaast belanden verwijderde bestanden en mappen in de prullenbak van het besturingssysteem (bij hele mappen is de prullenbak de eerste weg terug). Details: [Back-ups & versiegeschiedenis](Backups_and_Versioning.md).

### Zijn er oudere versies van mijn notities?

Ja: Plainva maakt tijdens het bewerken automatisch bestandsversies aan. Rechtsklik op een bestand → **Versiegeschiedenis…** toont alle snapshots met een vergelijkingsweergave en **Herstellen**. Daarnaast maakt Plainva dagelijks een back-up van de hele vault als ZIP buiten de vault-map. Details: [Back-ups & versiegeschiedenis](Backups_and_Versioning.md).

### Waarom is mijn index.md alleen-lezen?

Ze is door Plainva gegenereerd en wordt automatisch actueel gehouden (herkenbaar aan de banner "Deze index.md wordt beheerd door Plainva…"). Met **Toch bewerken** neem je haar permanent in eigen beheer — ze wordt dan niet meer automatisch bijgewerkt. Details: [OKF](OKF.md).

### Wat gebeurt er bij het hernoemen van een eigenschap in een database?

De nieuwe naam wordt geschreven in de frontmatter van **elke overeenkomende notitie** (na bevestiging, met voortgangsindicator). Hetzelfde principe geldt bij verwijderen: de checkbox **Ook verwijderen uit de frontmatter van de notities** ruimt meteen ook de bronnotities op. Beide werken dus op je bestanden — daar zijn ze precies voor bedoeld.

### Kan ik de OKF-conversie ongedaan maken?

Vóór elke wijziging maakt de wizard een back-up van het bestand naar `.plainva/backups/okf-conversion-<tijdstempel>/`. Het eindrapport noemt de precieze map; van daaruit kun je losse bestanden terugkopiëren. Gebruik daarnaast **Voorbeeld (geen wijzigingen)** voordat je converteert.

## Sync

### Wat is een .CONFLICT-bestand?

Is hetzelfde bestand gelijktijdig hier en op een ander apparaat gewijzigd, dan probeert Plainva eerst beide versies automatisch samen te voegen. Lukt dat niet, dan wordt **jouw** versie veilig opgeslagen als een `.CONFLICT`-bestand naast het origineel — er gaat nooit iets verloren. Conflictbestanden zijn gemarkeerd in de bestandsboom; via rechtsklik kies je **Deze versie behouden** (de conflictversie vervangt het origineel) of **Conflict verwerpen**.

### Mijn Google-aanmelding verloopt steeds

Bij de "Bring Your Own"-installatie blijft je Google-project in testmodus; Google beëindigt de sessie dan na 7 dagen. Plainva vernieuwt tokens automatisch op de achtergrond, maar als de aanmelding is verlopen, gebruik dan **Opnieuw verbinden** in de sync-instellingen. Details: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Mijn vault staat in een OneDrive-/Dropbox-/iCloud-map en Plainva gedraagt zich vreemd

Stel de vault-map in de sync-client van de provider in op "altijd op dit apparaat behouden" / "offline beschikbaar". Online-only-placeholderbestanden (Files On-Demand, "online-only") verstoren indexering en sync. Details: [Sync-compatibiliteit](Sync_Compatibility.md).

### Ik ben offline — wat gebeurt er met mijn wijzigingen?

Ze worden gewoon lokaal opgeslagen en verzameld in een wachtrij; zodra de verbinding terugkeert, draagt Plainva ze automatisch over. De statusbalk toont **Online**/**Offline**.

### De statusbalk toont Offline terwijl ik wel internet heb

Dan is de sync-verbinding zelf verstoord — vaak omdat de aanmelding is verlopen of de toegangsgegevens zijn gewijzigd (bijv. bij Google Drive). Klik op **Offline** in de statusbalk of op de waarschuwingsdriehoek naast de vaultnaam: het dialoogvenster toont de precieze foutmelding, en **Sync-instellingen openen** brengt je direct naar het bijbehorende providerformulier, waar je de verbinding opnieuw tot stand brengt (bijv. **Opnieuw verbinden**). Elke klik start bovendien meteen een nieuwe sync-poging.

## App

### Waarom herlaadt F5 niet, en waar is het rechtsklikmenu van de browser?

Plainva is een desktop-app, geen webpagina. Herlaadtoetsen (F5, Ctrl+R) zijn met opzet uitgeschakeld — herladen zou je open tabbladen en niet-opgeslagen wijzigingen weggooien. Het ingebouwde rechtsklikmenu van de WebView is ook verborgen; rechtsklikken op geselecteerde tekst biedt nog steeds **Kopiëren**, en de bestandsboom, tabbladen en tabellen behouden hun eigen rechtsklikmenu's.

### Waarom zie ik geen animaties?

Plainva respecteert de systeeminstelling "beweging verminderen". Als overgangen en effecten ontbreken (knoppen, menu's en markeringen bewegen niet), staan animaties uit in je besturingssysteem. Onder **Windows**: Instellingen → Toegankelijkheid → Visuele effecten → zet **Animatie-effecten** aan. Onder **macOS**: Systeeminstellingen → Toegankelijkheid → Beeldscherm → zet **Beweging verminderen** uit.

### Hoe verander ik de taal?

**Instellingen → App → Weergave → Taal** (momenteel Duits en Engels).

### "Controleren op updates" vindt niets

Zolang er nog geen openbare releases zijn, meldt de update-check: "Er zijn nog geen openbare updates (releases) beschikbaar." Dat is geen fout.

### Zijn er verborgen functies?

Starfleet becommentarieert geruchten in principe niet. Maar het schijnt dat het logo in de titelbalk reageert op aanhoudend kloppen — en wie vervolgens de juiste woorden kent, ziet Plainva daarna in een heel nieuw licht. Sommigen zeggen: in vieren.

## Zie ook

- [Sync instellen](Sync_Setup.md) en [Sync-compatibiliteit](Sync_Compatibility.md)
- [OKF](OKF.md) — conversie, index.md, systeemvelden
