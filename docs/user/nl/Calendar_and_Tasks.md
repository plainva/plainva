# Agenda & externe taken

Laatst bijgewerkt: 2026-07-18

Plainva kan je bestaande agenda- en takenaccounts verbinden — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Agenda + Taken) en **Microsoft** (Outlook-agenda + To Do) — en in beide richtingen ermee werken. Je notities blijven het middelpunt: afspraken worden vergadernotities, en externe takenlijsten spiegelen zich als gewone notities in je [standaard takendatabase](Tasks.md).

## Een account verbinden

Open **Instellingen → Vault → Agenda en accounts → Account toevoegen…** en kies de provider:

- **CalDAV**: server-URL, gebruikersnaam en een **app-wachtwoord** (in Nextcloud: Instellingen → Beveiliging → Apparaten & sessies). Geen registratie, geen keys.
- **Google**: heeft je eigen OAuth-client-ID nodig (hetzelfde BYO-model als bij de Google Drive-sync — zie de [Drive-handleiding](Google_Drive_BYO_Guide.md)). Schakel in je Google Cloud-project bovendien de *Google Calendar API* en *Google Tasks API* in en voeg hun scopes toe aan het toestemmingsscherm. De browser opent voor toestemming; bij het verbinden wordt het account gevalideerd voordat er iets wordt opgeslagen.
- **Microsoft**: klik gewoon op **Verbinden** en bevestig in de browser — geen instelling nodig.

Elk account toont zijn **agenda's** (aangevinkte verschijnen in het agenda-tabblad) en zijn **takenlijsten** (bewust standaard niet aangevinkt — een vinkje start de hieronder beschreven takensynchronisatie). Wachtwoorden en tokens komen terecht in de sleutelhanger van het besturingssysteem. De instelling **Vergadermap** onder de accounts bepaalt waar vergadernotities worden aangemaakt.

## Het agenda-tabblad

Open het via de actiebalk uiterst links (agenda-icoon) of het opdrachtenpalet (**Agenda openen**). Je krijgt een maandraster met je afspraken (één kleurpunt per agenda) en een dagpaneel met de gekozen dag — eerst de hele-dag-afspraken, dan die met tijd, agendanaam en locatie. De weergave wordt elke paar minuten automatisch ververst; de knop **Nu verversen** dwingt dit af.

- **Nieuwe afspraak**: de **+** in het dagpaneel — titel, agenda, datum/tijd of een hele-dag-periode, locatie en optioneel een eenvoudige **herhaling** (Dagelijks/Wekelijks/Maandelijks/Jaarlijks).
- **Bewerken / verwijderen**: het potlood- en prullenbak-icoon bij een afspraak. Wijzigingen gaan met een veiligheidscontrole naar de provider: is de afspraak intussen extern gewijzigd, dan vernieuwt Plainva de weergave in plaats van te overschrijven.
- **Terugkerende afspraken** dragen een herhalingsbadge. Het bewerken of verwijderen van één exemplaar vraagt **"Alleen deze afspraak"** (maakt een uitzondering, of laat precies dat ene exemplaar vervallen) of **"Alle afspraken"** (wijzigt de hele reeks). Een bestaande herhalingsregel herschrijft Plainva nooit.

## Afspraak → vergadernotitie

Het notitie-icoon bij een afspraak maakt zijn **vergadernotitie** aan (of opent hem opnieuw) — een gewone notitie in je vergadermap met de naam `JJJJ-MM-DD Titel.md`, vooraf ingevuld met datum, locatie en deelnemers, plus een kleine `plainva.pim`-markering in de frontmatter die hem koppelt aan de afspraak. Nogmaals klikken op dezelfde afspraak opent altijd dezelfde notitie; een eigen notitie die toevallig dezelfde naam draagt, wordt nooit aangeraakt.

## Externe takenlijsten in je takendatabase

Vink bij een verbonden account een **takenlijst** aan, en de taken erin verschijnen als notities in je [standaard takendatabase](Tasks.md): de titel wordt de notitie (H1), de vervaldatum belandt in de datumkolom van de database, en voltooiing wordt afgebeeld op de statuskolom (eerste optie = open, laatste optie = voltooid). De synchronisatie verloopt in beide richtingen, per veld:

- Bewerk je de notitie (titel, vervaldatum, status) → de wijziging wordt naar de provider gepusht.
- Verandert de taak extern → de notitie volgt.
- Zijn beide kanten gewijzigd, dan wint voor dat veld je lokale wijziging; de rest volgt de externe kant.

Twee veiligheidsregels beschermen je gegevens: **het verwijderen van de notitie verwijdert nooit de externe taak** (de synchronisatie stopt gewoon en de taak wordt ook niet opnieuw geïmporteerd), en **een extern verwijderde taak verwijdert nooit je notitie** (die wordt gewoon een gewone notitie). Een taaknotitie hernoemen of verplaatsen is geen probleem — de frontmatter-markering houdt de koppeling in stand.

Huidige beperkingen: als gewone notities aangemaakte taken worden niet naar de provider gepusht (maak ze extern aan of via de takendatabase), en alles op deze pagina is voorlopig desktop-first.
