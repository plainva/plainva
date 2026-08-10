# Agenda & externe taken

Laatst bijgewerkt: 2026-08-10

Plainva kan je bestaande agenda- en takenaccounts verbinden — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Agenda + Taken) en **Microsoft** (Outlook-agenda + To Do) — en in beide richtingen ermee werken. Je notities blijven het middelpunt: afspraken worden vergadernotities, en externe takenlijsten spiegelen zich als gewone notities in je [standaard takendatabase](Tasks.md).

> **Experimenteel.** De agenda praat met echte externe accounts (CalDAV, Google, Microsoft) die niet doorlopen kunnen worden in Plainva's geautomatiseerde tests. Het werkt en wordt dagelijks gebruikt, maar behandel het als een preview: bewaar een back-up en meld alsjeblieft alles wat vreemd overkomt.

## Een account verbinden

Open **Instellingen → Vault → Cloudaccounts → Account verbinden…**, kies een provider en vink **Agenda en taken** aan bij de stap diensten:

- **Nextcloud / CalDAV**: serveradres, gebruikersnaam en een **app-wachtwoord** (in Nextcloud: Instellingen → Beveiliging → Apparaten & sessies). Geen registratie, geen keys — voor Nextcloud leidt Plainva het CalDAV-adres zelf af uit het serveradres (voor andere CalDAV-servers gebruik je de tegel **WebDAV / CalDAV** of **Geavanceerd: endpoints afzonderlijk instellen**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: eigen tegels met de agenda-adressen al ingevuld — een e-mailadres plus een **app-wachtwoord** volstaat, zonder serverveld (bij Apple is het app-wachtwoord verplicht; de assistent linkt naar de handleiding van de provider). Let op: Yahoo geeft zelf aan dat zijn CalDAV-dienst onbetrouwbaar is — als die vreemd doet, ligt het niet aan Plainva.
- **Google**: heeft je eigen OAuth-client-ID nodig (hetzelfde BYO-model als bij de Google Drive-sync — zie de [Drive-handleiding](Google_Drive_BYO_Guide.md)). Schakel in je Google Cloud-project bovendien de *Google Calendar API* en *Google Tasks API* in en voeg hun scopes toe aan het toestemmingsscherm. De browser opent voor toestemming; bij het verbinden wordt het account gevalideerd voordat er iets wordt opgeslagen.
- **Microsoft**: klik gewoon op **Aanmelden met Microsoft…** en bevestig in de browser — geen instelling nodig. Eén Microsoft-account kan in dezelfde stap ook **Bestanden** (OneDrive) en **E-mail** dragen.

De assistent toont per dienst een status ("verbonden — n agenda's gevonden"). Je beheert daarna de **agenda's** (aangevinkte verschijnen in het agenda-tabblad) en de **takenlijsten** (bewust standaard niet aangevinkt — een vinkje start de hieronder beschreven takensynchronisatie) in het gebied **Agenda**; daar staan ook de **Vergadermap** (waar vergadernotities worden aangemaakt) en de **Standaardagenda**. Wachtwoorden en tokens komen terecht in de sleutelhanger van het besturingssysteem.

**Elk apparaat meldt zich zelf aan.** Als je [instellingensynchronisatie](Sync_Setup.md#sync-versleuteling-wachtwoordzin) gebruikt, reizen de account-*gegevens* mee, maar de aanmelding nooit — die blijft bewust op het apparaat. Een account dat zo is overgenomen, verschijnt dus wel in de lijst op het andere apparaat, maar is daar nog niet aangemeld; in de [mobiele app](Mobile_App.md) draagt het dan de markering **aanmelden** en legt de agenda dat uit in plaats van leeg te blijven. Eenmaal verbinden is genoeg.

**Als een aanmelding verloopt.** Is de autorisatie van een account verlopen of ingetrokken, dan zeggen de agenda- en takenlijst-secties dat rechtstreeks en bieden ze meteen **Opnieuw aanmelden** aan — geen giswerk meer op basis van een rauwe foutmelding van de provider. Bij een eigen Google-client noemt Plainva ook de waarschijnlijke oorzaak: een toestemmingsscherm dat nog op "Testing" staat, laat elke aanmelding na 7 dagen verlopen — een eigenschap van je eigen Google-project, geen intrekking (zie de [Drive-handleiding](Google_Drive_BYO_Guide.md)). Zolang het account zelf onbereikbaar is, melden de takenlijsten dat ze onbekend zijn in plaats van dat er geen zijn — er is dan simpelweg niets over bekend, tot het account weer laadt. In de mobiele app geldt hetzelfde: de accountregel noemt de reden en **Opnieuw aanmelden** repareert het account ter plekke.

## Het agenda-tabblad

Open het via de actiebalk uiterst links (agenda-icoon) of het opdrachtenpalet (**Agenda openen**). Via de omschakelaar in de kop zijn vijf weergaven beschikbaar: **Dag**, **3 dagen** en **Week** tonen een **tijdraster** met een uurkolom aan de linkerkant; afspraken staan als blokken op hun starttijd, hun hoogte komt overeen met de duur, overlappende afspraken staan naast elkaar, en een rode lijn markeert "nu". Hele-dag-afspraken en (met de takenoverlay ingeschakeld) taken met vervaldatum staan in de strook boven het raster. **Maand** toont het maandraster (één kleurpunt per agenda) plus rechts een tijdraster van één dag voor de gekozen dag. **Agenda** toont de komende weken gegroepeerd per dag. **Vandaag** springt terug; de pijlen bladeren steeds een periode verder of terug (een dag, drie dagen, een week of een maand). De eerste dag van de week volgt de instelling **Week begint op** (Instellingen → App → Weergave: Maandag, Zaterdag of Zondag) — dit geldt ook voor de kalender in de zijbalk. De weergave wordt elke paar minuten automatisch ververst; de knop Nu verversen dwingt dit af. Afspraken die al zijn afgelopen, zien er **vager** uit (zoals in Google Agenda), zodat de resterende agenda van vandaag opvalt. Een **meerdaagse afspraak** is één doorlopende **balk** over de dagen die ze beslaat — één label, één klikdoel, in plaats van een item per dag. Loopt ze voorbij het einde van de week, dan wordt ze recht afgesneden aan de rand en gaat ze in de volgende rij verder zonder de titel te herhalen. De strook voor hele dagen in de dag-, driedaagse en weekweergave werkt net zo.

- **Afspraak aanmaken**: een **klik op een lege plek in het tijdraster** opent een klein snelaanmaakvenster (titel, tijd, agenda, locatie) — **Opslaan** legt meteen aan, **Meer opties** opent de volledige afspraakdialoog. **Slepen** over het raster bepaalt de duur. De **+** in de kop opent de volledige dialoog: titel, agenda, datum/tijd of een hele-dag-periode, locatie, een **beschrijving**, een **kleur**, **deelnemers** en optioneel een Outlook-achtige **herhaling**. De kleur overschrijft de kleur van de agenda voor die ene afspraak (geen effect op Microsoft-accounts — Outlook heeft geen kleuren per afspraak).
- **Deelnemers**: typ een e-mailadres en druk op **Enter** (of komma) om het als **chip** toe te voegen; het × verwijdert er één. De herhaling staat direct naast de datum/tijd — kies een frequentie, een interval, de weekdagen (wekelijks) en hoe deze eindigt (nooit / op een datum / na N keer); je kunt ook de herhaling van een bestaande afspraak toevoegen of wijzigen.
- **Bekijken**: een **klik op een afspraak** opent het **afspraakvoorbeeld** — een vrij zwevend venster dat de afspraak toont in plaats van hem te bewerken: het tijdstip, de locatie, de beschrijving, de deelnemers met hun reacties, plus **Accepteren / Voorlopig / Weigeren**, **Vergadernotitie** en, via het **⋮**, alle overige acties (kleur, blokkeren in andere agenda's, verzenden per e-mail, verwijderen). Het venster dimt de app niet, kan worden verplaatst en van grootte veranderd; **Esc** sluit het. Hoort de afspraak bij een **reeks**, dan zegt het voorbeeld dat — met het ritme en, als die geladen is, de eerstvolgende afspraak. Er wordt niets gevraagd: "alleen deze of allemaal?" is een vraag over bewerken, niet over bekijken.
- **Bewerken / verwijderen**: **Afspraak bewerken** in het voorbeeld opent de dialoog, vooraf ingevuld met de bestaande waarden en met de acties **Vergadernotitie** en **Verwijderen**. Wijzigingen gaan met een veiligheidscontrole naar de provider: is de afspraak intussen extern gewijzigd, dan vernieuwt Plainva de weergave in plaats van te overschrijven.
- **Terugkerende afspraken**: een afspraak uit een reeks gaat open om te bewerken als elke andere — de vraag komt pas bij het **opslaan**, en alleen als je echt iets hebt gewijzigd. De dialoog noemt de wijziging ("Tijd: 09:00 → 09:15") en vraagt dan of die moet gelden voor **alleen deze afspraak** of voor **alle afspraken in de reeks**. Bij "alle" reist alleen wat je hebt gewijzigd mee naar de reeks; de eigen startdatum en alles wat je niet hebt aangeraakt, blijft staan. Sluit je het formulier onveranderd, dan gebeurt er helemaal niets — geen dialoog, geen schrijfactie naar de provider. Bij **verwijderen** komt de vraag nog steeds vooraf: daar is de klik al de wijziging.
- **Verplaatsen / grootte wijzigen**: je kunt een afspraak rechtstreeks in het tijdraster **verslepen** — het lichaam verslepen verzet de afspraak (ook naar een andere dag in de week-/3-dagenweergave), het slepen aan de **onderrand** wijzigt de duur. De nieuwe tijd wordt meteen naar de provider geschreven (terugkerende afspraken zijn voorlopig alleen via de dialoog te bewerken).
- **Hoe een afspraak eruitziet**: een **afgezegde** afspraak blijft zichtbaar, maar verschijnt als **omlijning** met een **doorgehaalde titel** — je ziet dat het tijdvak vrij is gekomen in plaats van het stil te verliezen. Een **uitnodiging die je nog niet hebt beantwoord** is ook een omlijning (het is nog niet jouw afspraak); een **voorlopige** afspraak — zo gemarkeerd door de organisator of door jou met “misschien” beantwoord — is **gearceerd**. Alles wat bevestigd is blijft gevuld. De agenda zet het woord erbij (**Afgezegd**, **Onbeantwoord**, **Voorlopig**). Heb je **geweigerd**, dan wordt de afspraak een **gedimde omtrek** met doorgestreepte titel (**Je hebt afgewezen** in de agenda): hij gaat door voor de anderen, maar hoort niet meer bij jouw dag. Een afzegging door de organisator blijft scherper — die geldt voor iedereen.
- **RSVP en reacties**: ben je voor een afspraak uitgenodigd, dan kun je in de dialoog **Accepteren**, als **Voorlopig** markeren of **Weigeren** — Plainva stuurt je reactie via de provider (Google/Microsoft/CalDAV). De **deelnemerslijst** toont wie heeft geaccepteerd of geweigerd (het terugkanaal).
- **Uitnodigingen per e-mail**: heeft een afspraak deelnemers, vink dan **Deelnemers per e-mail op de hoogte stellen** aan. Bij Google vraagt Plainva Google vervolgens om zijn eigen uitnodiging te versturen (dezelfde afspraak, zodat de reacties van de ontvanger terugsynchroniseren naar je afspraak); Microsoft stelt deelnemers automatisch op de hoogte. Voor CalDAV — of om een kopie vanuit je eigen postvak te versturen — opent de agenda-actie **Verzenden per e-mail** het opstelvenster met een standaardconforme iCalendar-uitnodiging als bijlage, zodat Gmail en andere mailprogramma's hem als afspraak met Ja/Misschien/Nee tonen.
- **Blokkeren in andere agenda's**: de actie **Kopiëren** bij een afspraak (of de knop **Blokkeren in andere agenda's** in de dialoog) neemt hem over in een of meer van je andere beschrijfbare agenda's — als **Bezet**-plaatshouder of **met details** (in Notion-Calendar-stijl). Een terugkerende afspraak wordt met zijn herhaling overgenomen, zodat de blokkering ook terugkeert.
- **Terugkerende afspraken** dragen een herhalingsbadge. Het bewerken of verwijderen van één exemplaar vraagt **"Alleen deze afspraak"** (maakt een uitzondering, of laat precies dat ene exemplaar vervallen) of **"Alle afspraken"** (wijzigt de hele reeks). Een bestaande herhalingsregel herschrijft Plainva nooit.
- **Taken tonen** (naast de knop Nu verversen, wanneer een standaard takendatabase is ingesteld): legt de items met een vervaldatum uit je [standaard takendatabase](Tasks.md) over de strook van het tijdraster en het maandraster heen. Standaard uit; de keuze wordt per apparaat onthouden. Draagt de vervalkolom een **tijd** (kolomtype ‘datum en tijd’), dan staat de taak op haar plek **in het dagraster** in plaats van in de strook voor hele dagen — gestippeld in plaats van gevuld, want een deadline is geen tijdsduur, met het vinkje in het blok zelf. Zonder tijd verandert er niets.
  - Een klik op het **selectievakje** vinkt de taak meteen hier af — je hoeft de notitie niet te openen. Een klik op de **titel** opent hem nog steeds. Afvinken schrijft hetzelfde bestand als de Taken-weergave: draagt de taak een **herhaling**, dan wordt de volgende aangemaakt.
  - **Taken krijgen een andere kleur dan afspraken.** Een afgelopen afspraak is voorbij en verschijnt vaag; een **verlopen** taak is juist dringender en wordt **benadrukt**. Vandaag vervallende taken staan normaal, toekomstige gedempt, voltooide doorgestreept.
  - Een **herhalingspictogram** bij de regel toont dat deze taak een herhaling draagt. Toch verschijnt hij maar **eenmaal** in de agenda — zie [Taken](Tasks.md) voor het waarom.

## Afspraak → vergadernotitie

Het notitie-icoon bij een afspraak maakt zijn **vergadernotitie** aan (of opent hem opnieuw) — een gewone notitie in je vergadermap met de naam `JJJJ-MM-DD Titel.md`, vooraf ingevuld met datum, locatie en deelnemers, plus een kleine `plainva.pim`-markering in de frontmatter die hem koppelt aan de afspraak. Nogmaals klikken op dezelfde afspraak opent altijd dezelfde notitie; een eigen notitie die toevallig dezelfde naam draagt, wordt nooit aangeraakt.

## Externe takenlijsten in je takendatabase

Herinneringslijsten (Apple Herinneringen via iCloud-CalDAV, Nextcloud-takenlijsten) zijn eigen collecties op de server en verschijnen daarom onder **Takenlijsten** — nooit onder **Agenda's**. Toont een verbonden account geen takenlijsten, dan zegt de sectie dat en biedt **Opnieuw zoeken** aan; is het zoeken zelf mislukt, dan staat daar de reden en blijft je eerdere selectie behouden.

Vink bij een verbonden account een **takenlijst** aan, en de taken erin verschijnen als notities in je [standaard takendatabase](Tasks.md): de titel wordt de notitie (H1), de vervaldatum belandt in de datumkolom van de database, en voltooiing wordt afgebeeld op de **voltooid-selectievakje-eigenschap** van de database (de statuskolom volgt mee; een database zonder selectievakjekolom gebruikt de statusconventie — eerste optie = open, laatste = voltooid). De synchronisatie verloopt in beide richtingen, per veld:

- Bewerk je de notitie (titel, vervaldatum, status) → de wijziging wordt naar de provider gepusht.
- Verandert de taak extern → de notitie volgt.
- Zijn beide kanten gewijzigd, dan wint voor dat veld je lokale wijziging; de rest volgt de externe kant.

Twee veiligheidsregels beschermen je gegevens: **het verwijderen van de notitie verwijdert nooit de externe taak** (de synchronisatie stopt gewoon en de taak wordt ook niet opnieuw geïmporteerd), en **een extern verwijderde taak verwijdert nooit je notitie** (die wordt gewoon een gewone notitie). Een taaknotitie hernoemen of verplaatsen is geen probleem — de frontmatter-markering houdt de koppeling in stand.

Huidige beperkingen: als gewone notities aangemaakte taken worden niet naar de provider gepusht (maak ze extern aan of via de takendatabase), en alles op deze pagina is voorlopig desktop-first.

Kopieën van **Blokkeren in andere agenda’s** krijgen bij Google, Microsoft en CalDAV een providerspecifieke Plainva-koppeling. Agendaweergaven tonen die relatie met een kettingpictogram; na vernieuwen worden bron en blokkade opnieuw gekoppeld in plaats van losse duplicaten te worden.

## Herinneringen op de computer

Onder **Instellingen → Agenda → Herinneringen** zet je **Afspraken herinneren** aan; de eerste keer vraagt het systeem eenmalig om toestemming. Wat de afspraak zelf aan herinnering meebrengt, geldt — pas als die niets zegt, geldt de **Aanlooptijd**, en afspraken van een hele dag melden zich op het tijdstip dat je onder **Afspraken van een hele dag** kiest. **Vervallen taken** neemt daarnaast de taken uit je takendatabase mee, en **Alleen deze agenda's** beperkt waar herinneringen vandaan komen (niets aangevinkt betekent: alle, en een later verbonden agenda doet vanzelf mee).

**Het verschil met de telefoon staat in de instelling, niet in de kleine lettertjes.** Op de telefoon neemt het besturingssysteem de herinnering over en wekt haar ook met de app dicht. Op de computer bestaat die overdracht niet: **Plainva wekt zelf en moet daarvoor draaien.** Is de app dicht, dan vervalt de herinnering en wordt ze niet ingehaald. Daar staat tegenover dat er hier geen bovengrens is.

De melding zelf draagt geen knop — dat biedt de computer niet. De actie zit in het bericht in de app: **In de agenda tonen** bij een afspraak, **Taak openen** bij een taak. Het venster dringt zich daarbij nooit naar voren.

### Op de achtergrond doorlopen

Omdat een herinnering op de computer alleen aankomt zolang Plainva draait, staan onder **Instellingen → Start & gedrag → Achtergrond** twee schakelaars — apart, want het zijn twee verschillende wensen, en allebei **standaard uit**:

- **Met het systeem starten** meldt Plainva aan bij het inloggen.
- **Bij sluiten in het systeemvak doorlopen** zet een Plainva-pictogram in het systeemvak; het venster sluiten beëindigt de app dan niet meer, maar zet haar daar weg. Via het pictogram kom je terug met **Openen**, zie je de **volgende afspraak** en sluit je Plainva af met **Afsluiten**.

**De tweede schakelaar bewijst zichzelf.** Niet elke werkomgeving toont een systeemvak — en of een pictogram er echt verschijnt, valt niet betrouwbaar te voorspellen. Plainva zet het daarom neer en **vraagt of je het ziet**. Alleen een ja houdt de instelling aan; zeg je nee, dan wordt het pictogram weer verwijderd en blijft de schakelaar uit. Zo kan het venster nooit verdwijnen zonder weg terug. Dezelfde beveiliging geldt bij de volgende start: kan het pictogram dan niet meer worden aangemaakt, dan schakelt de instelling zichzelf uit.

De regel **Herinneringen verschijnen** eronder zegt op elk moment wat er geldt — *zolang Plainva draait* of *ook met het venster dicht*.

**Goed om te weten:** blijft Plainva op de achtergrond draaien, dan lopen ook **de synchronisatie, de agenda-verversing en de back-upcontrole** door. De vault is bij de volgende keer openen actueel — de app werkt terwijl je haar niet ziet.


## Databases tonen in de agenda

De agenda kan **items uit je databases** naast je afspraken tonen. De balk **Tonen:** boven de weergave toont elke `.base`-weergave van het type **agenda** of **tijdlijn** die een datumkolom noemt. Eén klik toont hem, nog een klik verbergt hem weer.

Een zo getoond item **blijft herkenbaar als notitie**: streepjesrand, een ruit ervoor, nooit de gevulde vorm van een afspraak. Klikken opent hetzelfde voorbeeld dat een databaserij toch al heeft. **Naar een andere dag slepen schrijft de datumkolom** van de notitie — precies wat het bewerken van die cel in de tabel doet. Draagt de kolom een tijd, dan staat het item op dat uur in het dagraster; zonder tijd staat het in de strook voor hele dagen.

**Welke weergaven getoond worden hoort bij de kluis** en reist mee via de instellingensynchronisatie: je agenda ziet er op computer en telefoon hetzelfde uit.

**En andersom:** in de agendaweergave van een database toont de knop **Afspraken op de achtergrond** de echte afspraken van die dag als een rustige regel — je ziet waartegen je plant. Ze zijn bewust alleen achtergrond: geen rijen van die database en niet aanklikbaar.

## Een database-item in de agenda zetten

Een item met een datum kan een **echte afspraak** bij je aanbieder worden. Het menu van de rij (of het actieblad op de telefoon) biedt **Aan agenda toevoegen**. De afspraak neemt de datum van het item over — met tijd als de kolom er een heeft, anders als afspraak voor de hele dag — en bevat een link terug naar de notitie.

Daarna blijven ze gekoppeld, volgens drie vaste regels:

* **Verplaats je de afspraak** in Google, Outlook of op de CalDAV-server, dan **volgt de datumkolom van de notitie.**
* **Verwijder je de notitie,** dan meldt het verwijderdialoog dat ze aan een afspraak gekoppeld is. De afspraak blijft bij je aanbieder — Plainva verwijdert die nooit terloops.
* **Verwijder je de afspraak,** dan verdwijnt alleen de koppeling. De notitie en haar datum blijven onaangeroerd.

Dit is iets anders dan **tijd blokkeren** bij een taak: daar reserveer je tijd voor iets, en de datum van de taak blijft staan. Hier zeg je: *dit item IS deze afspraak.*
