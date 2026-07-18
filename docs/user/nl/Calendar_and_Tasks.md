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

Open het via de actiebalk uiterst links (agenda-icoon) of het opdrachtenpalet (**Agenda openen**). Via de omschakelaar in de kop zijn vijf weergaven beschikbaar: **Dag**, **3 dagen** en **Week** tonen een **tijdraster** met een uurkolom aan de linkerkant; afspraken staan als blokken op hun starttijd, hun hoogte komt overeen met de duur, overlappende afspraken staan naast elkaar, en een rode lijn markeert "nu". Hele-dag-afspraken en (met de takenoverlay ingeschakeld) taken met vervaldatum staan in de strook boven het raster. **Maand** toont het maandraster (één kleurpunt per agenda) plus rechts een tijdraster van één dag voor de gekozen dag. **Agenda** toont de komende weken gegroepeerd per dag. **Vandaag** springt terug; de pijlen bladeren steeds een periode verder of terug (een dag, drie dagen, een week of een maand). De eerste dag van de week volgt de instelling **Week begint op** (Instellingen → App → Weergave: Maandag, Zaterdag of Zondag) — dit geldt ook voor de kalender in de zijbalk. De weergave wordt elke paar minuten automatisch ververst; de knop Nu verversen dwingt dit af.

- **Afspraak aanmaken**: een **klik op een lege plek in het tijdraster** opent een klein snelaanmaakvenster (titel, tijd, agenda, locatie) — **Opslaan** legt meteen aan, **Meer opties** opent de volledige afspraakdialoog. **Slepen** over het raster bepaalt de duur. De **+** in de kop opent de volledige dialoog: titel, agenda, datum/tijd of een hele-dag-periode, locatie, beschrijving, kleur en optioneel een eenvoudige **herhaling** (Dagelijks/Wekelijks/Maandelijks/Jaarlijks). De kleur overschrijft de kleur van de agenda voor die ene afspraak (geen effect op Microsoft-accounts — Outlook heeft geen kleuren per afspraak).
- **Bewerken / verwijderen**: een **klik op een afspraak** in het tijdraster opent de dialoog, vooraf ingevuld met de bestaande waarden en met de acties **Vergadernotitie** en **Verwijderen**. Wijzigingen gaan met een veiligheidscontrole naar de provider: is de afspraak intussen extern gewijzigd, dan vernieuwt Plainva de weergave in plaats van te overschrijven.
- **Verplaatsen / grootte wijzigen**: je kunt een afspraak rechtstreeks in het tijdraster **verslepen** — het lichaam verslepen verzet de afspraak (ook naar een andere dag in de week-/3-dagenweergave), het slepen aan de **onderrand** wijzigt de duur. De nieuwe tijd wordt meteen naar de provider geschreven (terugkerende afspraken zijn voorlopig alleen via de dialoog te bewerken).
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
