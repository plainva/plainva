# Agenda & externe taken

Laatst bijgewerkt: 2026-07-21

Plainva kan je bestaande agenda- en takenaccounts verbinden — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Agenda + Taken) en **Microsoft** (Outlook-agenda + To Do) — en in beide richtingen ermee werken. Je notities blijven het middelpunt: afspraken worden vergadernotities, en externe takenlijsten spiegelen zich als gewone notities in je [standaard takendatabase](Tasks.md).

> **Experimenteel.** De agenda praat met echte externe accounts (CalDAV, Google, Microsoft) die niet doorlopen kunnen worden in Plainva's geautomatiseerde tests. Het werkt en wordt dagelijks gebruikt, maar behandel het als een preview: bewaar een back-up en meld alsjeblieft alles wat vreemd overkomt.

## Een account verbinden

Open **Instellingen → Vault → Cloudaccounts → Account verbinden…**, kies een provider en vink **Agenda en taken** aan bij de stap diensten:

- **Nextcloud / CalDAV**: serveradres, gebruikersnaam en een **app-wachtwoord** (in Nextcloud: Instellingen → Beveiliging → Apparaten & sessies). Geen registratie, geen keys — voor Nextcloud leidt Plainva het CalDAV-adres zelf af uit het serveradres (voor andere CalDAV-servers gebruik je de tegel **WebDAV / CalDAV** of **Geavanceerd: endpoints afzonderlijk instellen**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: eigen tegels met de agenda-adressen al ingevuld — een e-mailadres plus een **app-wachtwoord** volstaat, zonder serverveld (bij Apple is het app-wachtwoord verplicht; de assistent linkt naar de handleiding van de provider). Let op: Yahoo geeft zelf aan dat zijn CalDAV-dienst onbetrouwbaar is — als die vreemd doet, ligt het niet aan Plainva.
- **Google**: heeft je eigen OAuth-client-ID nodig (hetzelfde BYO-model als bij de Google Drive-sync — zie de [Drive-handleiding](Google_Drive_BYO_Guide.md)). Schakel in je Google Cloud-project bovendien de *Google Calendar API* en *Google Tasks API* in en voeg hun scopes toe aan het toestemmingsscherm. De browser opent voor toestemming; bij het verbinden wordt het account gevalideerd voordat er iets wordt opgeslagen.
- **Microsoft**: klik gewoon op **Aanmelden met Microsoft…** en bevestig in de browser — geen instelling nodig. Eén Microsoft-account kan in dezelfde stap ook **Bestanden** (OneDrive) en **E-mail** dragen.

De assistent toont per dienst een status ("verbonden — n agenda's gevonden"). Je beheert daarna de **agenda's** (aangevinkte verschijnen in het agenda-tabblad) en de **takenlijsten** (bewust standaard niet aangevinkt — een vinkje start de hieronder beschreven takensynchronisatie) in het gebied **Agenda**; daar staan ook de **Vergadermap** (waar vergadernotities worden aangemaakt) en de **Standaardagenda**. Wachtwoorden en tokens komen terecht in de sleutelhanger van het besturingssysteem.

## Het agenda-tabblad

Open het via de actiebalk uiterst links (agenda-icoon) of het opdrachtenpalet (**Agenda openen**). Via de omschakelaar in de kop zijn vijf weergaven beschikbaar: **Dag**, **3 dagen** en **Week** tonen een **tijdraster** met een uurkolom aan de linkerkant; afspraken staan als blokken op hun starttijd, hun hoogte komt overeen met de duur, overlappende afspraken staan naast elkaar, en een rode lijn markeert "nu". Hele-dag-afspraken en (met de takenoverlay ingeschakeld) taken met vervaldatum staan in de strook boven het raster. **Maand** toont het maandraster (één kleurpunt per agenda) plus rechts een tijdraster van één dag voor de gekozen dag. **Agenda** toont de komende weken gegroepeerd per dag. **Vandaag** springt terug; de pijlen bladeren steeds een periode verder of terug (een dag, drie dagen, een week of een maand). De eerste dag van de week volgt de instelling **Week begint op** (Instellingen → App → Weergave: Maandag, Zaterdag of Zondag) — dit geldt ook voor de kalender in de zijbalk. De weergave wordt elke paar minuten automatisch ververst; de knop Nu verversen dwingt dit af. Afspraken die al zijn afgelopen, zien er **vager** uit (zoals in Google Agenda), zodat de resterende agenda van vandaag opvalt.

- **Afspraak aanmaken**: een **klik op een lege plek in het tijdraster** opent een klein snelaanmaakvenster (titel, tijd, agenda, locatie) — **Opslaan** legt meteen aan, **Meer opties** opent de volledige afspraakdialoog. **Slepen** over het raster bepaalt de duur. De **+** in de kop opent de volledige dialoog: titel, agenda, datum/tijd of een hele-dag-periode, locatie, een **beschrijving**, een **kleur**, **deelnemers** en optioneel een Outlook-achtige **herhaling**. De kleur overschrijft de kleur van de agenda voor die ene afspraak (geen effect op Microsoft-accounts — Outlook heeft geen kleuren per afspraak).
- **Deelnemers**: typ een e-mailadres en druk op **Enter** (of komma) om het als **chip** toe te voegen; het × verwijdert er één. De herhaling staat direct naast de datum/tijd — kies een frequentie, een interval, de weekdagen (wekelijks) en hoe deze eindigt (nooit / op een datum / na N keer); je kunt ook de herhaling van een bestaande afspraak toevoegen of wijzigen.
- **Bewerken / verwijderen**: een **klik op een afspraak** in het tijdraster opent de dialoog, vooraf ingevuld met de bestaande waarden en met de acties **Vergadernotitie** en **Verwijderen**. Wijzigingen gaan met een veiligheidscontrole naar de provider: is de afspraak intussen extern gewijzigd, dan vernieuwt Plainva de weergave in plaats van te overschrijven.
- **Verplaatsen / grootte wijzigen**: je kunt een afspraak rechtstreeks in het tijdraster **verslepen** — het lichaam verslepen verzet de afspraak (ook naar een andere dag in de week-/3-dagenweergave), het slepen aan de **onderrand** wijzigt de duur. De nieuwe tijd wordt meteen naar de provider geschreven (terugkerende afspraken zijn voorlopig alleen via de dialoog te bewerken).
- **RSVP en reacties**: ben je voor een afspraak uitgenodigd, dan kun je in de dialoog **Accepteren**, als **Voorlopig** markeren of **Weigeren** — Plainva stuurt je reactie via de provider (Google/Microsoft/CalDAV). De **deelnemerslijst** toont wie heeft geaccepteerd of geweigerd (het terugkanaal).
- **Uitnodigingen per e-mail**: heeft een afspraak deelnemers, vink dan **Deelnemers per e-mail op de hoogte stellen** aan. Bij Google vraagt Plainva Google vervolgens om zijn eigen uitnodiging te versturen (dezelfde afspraak, zodat de reacties van de ontvanger terugsynchroniseren naar je afspraak); Microsoft stelt deelnemers automatisch op de hoogte. Voor CalDAV — of om een kopie vanuit je eigen postvak te versturen — opent de agenda-actie **Verzenden per e-mail** het opstelvenster met een standaardconforme iCalendar-uitnodiging als bijlage, zodat Gmail en andere mailprogramma's hem als afspraak met Ja/Misschien/Nee tonen.
- **Blokkeren in andere agenda's**: de actie **Kopiëren** bij een afspraak (of de knop **Blokkeren in andere agenda's** in de dialoog) neemt hem over in een of meer van je andere beschrijfbare agenda's — als **Bezet**-plaatshouder of **met details** (in Notion-Calendar-stijl). Een terugkerende afspraak wordt met zijn herhaling overgenomen, zodat de blokkering ook terugkeert.
- **Terugkerende afspraken** dragen een herhalingsbadge. Het bewerken of verwijderen van één exemplaar vraagt **"Alleen deze afspraak"** (maakt een uitzondering, of laat precies dat ene exemplaar vervallen) of **"Alle afspraken"** (wijzigt de hele reeks). Een bestaande herhalingsregel herschrijft Plainva nooit.
- **Taken tonen** (naast de knop Nu verversen, wanneer een standaard takendatabase is ingesteld): legt de items met een vervaldatum uit je [standaard takendatabase](Tasks.md) over de strook van het tijdraster en het maandraster heen; voltooide taken verschijnen doorgestreept. Standaard uit; de keuze wordt per apparaat onthouden.

## Afspraak → vergadernotitie

Het notitie-icoon bij een afspraak maakt zijn **vergadernotitie** aan (of opent hem opnieuw) — een gewone notitie in je vergadermap met de naam `JJJJ-MM-DD Titel.md`, vooraf ingevuld met datum, locatie en deelnemers, plus een kleine `plainva.pim`-markering in de frontmatter die hem koppelt aan de afspraak. Nogmaals klikken op dezelfde afspraak opent altijd dezelfde notitie; een eigen notitie die toevallig dezelfde naam draagt, wordt nooit aangeraakt.

## Externe takenlijsten in je takendatabase

Vink bij een verbonden account een **takenlijst** aan, en de taken erin verschijnen als notities in je [standaard takendatabase](Tasks.md): de titel wordt de notitie (H1), de vervaldatum belandt in de datumkolom van de database, en voltooiing wordt afgebeeld op de **voltooid-selectievakje-eigenschap** van de database (de statuskolom volgt mee; een database zonder selectievakjekolom gebruikt de statusconventie — eerste optie = open, laatste = voltooid). De synchronisatie verloopt in beide richtingen, per veld:

- Bewerk je de notitie (titel, vervaldatum, status) → de wijziging wordt naar de provider gepusht.
- Verandert de taak extern → de notitie volgt.
- Zijn beide kanten gewijzigd, dan wint voor dat veld je lokale wijziging; de rest volgt de externe kant.

Twee veiligheidsregels beschermen je gegevens: **het verwijderen van de notitie verwijdert nooit de externe taak** (de synchronisatie stopt gewoon en de taak wordt ook niet opnieuw geïmporteerd), en **een extern verwijderde taak verwijdert nooit je notitie** (die wordt gewoon een gewone notitie). Een taaknotitie hernoemen of verplaatsen is geen probleem — de frontmatter-markering houdt de koppeling in stand.

Huidige beperkingen: als gewone notities aangemaakte taken worden niet naar de provider gepusht (maak ze extern aan of via de takendatabase), en alles op deze pagina is voorlopig desktop-first.

Kopieën van **Blokkeren in andere agenda’s** krijgen bij Google, Microsoft en CalDAV een providerspecifieke Plainva-koppeling. Agendaweergaven tonen die relatie met een kettingpictogram; na vernieuwen worden bron en blokkade opnieuw gekoppeld in plaats van losse duplicaten te worden.
