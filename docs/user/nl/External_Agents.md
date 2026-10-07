# Externe agents (Beta)

Laatst bijgewerkt: 2026-10-07

Een externe agent is een AI-programma van een andere maker — een agent die je op je computer hebt geïnstalleerd en waarbij je je zelf hebt aangemeld, met je eigen abonnement of sleutel. Plainva kan zo'n agent in de map van een vault starten en zijn sessie in het AI-tabblad tonen. Dit hoort bij de experimentele AI-functies en werkt alleen op de desktop.

Een externe agent is niet de assistent van Plainva. De [AI-assistent](AI_Assistant.md) verzendt alleen wat zijn overzicht je heeft getoond, en nooit wat je privacyregels achterhouden. Een agent leest en verzendt zelf. Deze pagina zegt wat Plainva in zo'n sessie beheerst — en wat niet.

## Wat Plainva niet beheerst

- **Het programma.** Een agent is het programma van iemand anders. Het draait op deze computer met jouw rechten, in de map van de vault, en het is niet afgeschermd: het kan alles lezen en wijzigen wat jij kunt lezen en wijzigen.
- **Wat hij leest en verzendt.** Hij leest bestanden zelf — ook notities die je van de cloud weghoudt — en verzendt wat hij kiest naar zijn eigen dienst. Je privacyregels en het overzicht vóór het verzenden bereiken hem niet, en niets vraagt je iets voordat hij verzendt.
- **Wat hij zelf schrijft.** Een wijziging die de agent zelf maakt, staat meteen in de vault, zonder voorstel. De sessie zegt het je wanneer de agent zo'n wijziging meldt; een wijziging die hij niet meldt, ziet Plainva niet.
- **Zijn aanmelding.** De agent meldt zich zelf aan. Plainva ziet zijn inloggegevens nooit en bewaart er geen.

Start een agent alleen in een vault waarvan de inhoud de dienst van de agent mag bereiken.

## Wat Plainva beheerst

- **Zijn eigen hulpmiddelen.** Waar **AI-apps op deze computer deze vault laten lezen** aanstaat, worden de hulpmiddelen van Plainva aan de agent aangeboden — dezelfde als voor elke app in [AI-apps koppelen](Connect_AI_Apps.md): alleen de mappen die je toestaat, nooit een notitie die van de cloud of van internet wordt weggehouden, en alleen lezen — tenzij je hem daar toestaat wijzigingen voor te stellen.
- **Wat de agent Plainva vraagt te lezen.** Een notitie die van de cloud of van internet wordt weggehouden en de eigen mappen van Plainva worden niet afgegeven. De agent krijgt dat te horen, en jij ook.
- **Wat de agent Plainva vraagt te schrijven.** Er wordt niets geschreven. Een wijziging in een notitie wordt een ronde voorstellen onder de naam van de agent, en een nieuwe notitie wacht als concept tot je haar aanmaakt.
- **Geen terminal.** Plainva biedt een agent geen eigen terminal aan.

## Een agent toevoegen

1. Installeer de agent zelf, zoals zijn maker het beschrijft, en meld je in zijn eigen programma bij hem aan.
2. Open **Instellingen → AI & automatisering** (het App-deel). Onder **Externe agents** markeert **Gevonden op deze computer** de agents die Plainva bij naam kent en geïnstalleerd vindt; **Toevoegen** voegt er een toe. Kies voor elk ander programma dat het Agent Client Protocol spreekt onder **Een andere agent** voor **Agent toevoegen…** en vul **Naam**, **Programma** en **Argumenten, één per regel** in.
3. Je systeem toont de hele opdracht nog een keer voordat ze wordt onthouden.

Plainva installeert geen agent en downloadt er geen. Het start precies het programma dat je hebt bevestigd, rechtstreeks en zonder shell. De opdracht wordt op dit apparaat onthouden, nooit in de vault. **Verwijderen** laat Plainva vergeten hoe een agent wordt gestart; het programma zelf en zijn aanmelding blijven zoals ze zijn.

## Een sessie starten

Open het AI-tabblad en kies **Agent**. Voordat er iets start, somt **Voordat je ⟨agent⟩ start** op wat de agent zelf doet en wat Plainva beheerst, en zegt het of de hulpmiddelen van Plainva worden aangeboden. **Sessie starten** start het programma van de agent in de map van de vault. De eerste keer dat je een agent in een vault start sinds Plainva is geopend, vraagt je systeem het nog een keer en toont het de map en de hele opdracht.

Er draait één sessie tegelijk, en ze hoort bij de vault waarin ze is gestart: **Sessie beëindigen** stopt het programma van de agent, en het sluiten van de vault of van Plainva doet dat ook. Zolang ze draait, zegt de eerste regel van de sessie wie de agent is en dat je privacyregels niet voor hem gelden. In een versleutelde workspace wordt geen agent gestart.

## Aanmelden

Een agent die niet is aangemeld, zegt dat, en de sessie toont **⟨agent⟩ vraagt om aanmelding** met de manieren die de agent noemt. Afhankelijk van de agent opent je keuze een terminalvenster met het eigen programma van de agent, of brengt de agent je zelf naar zijn aanmelding. Plainva wacht en start de agent daarna opnieuw. Waar geen terminal kan worden geopend, toont Plainva de opdracht die je in een eigen terminal uitvoert; kies daarna **Opnieuw proberen**. Van de aanmelding ziet Plainva niets.

## In een sessie

Typ wat de agent moet doen. De notitie die je open hebt, wordt aan de agent genoemd — haar naam en waar ze staat, niet haar tekst —, tenzij je haar boven het invoerveld weghaalt; een notitie die je van de cloud of van internet weghoudt, wordt nooit genoemd. De sessie toont wat de agent zegt, zijn plan en elk van zijn stappen, met de bestanden van de vault die hij noemt.

Als de agent je toestemming voor een stap wil, toont **⟨agent⟩ vraagt** die. De woorden zijn van de agent, en de keuzes zijn de keuzes die de agent aanbiedt — **Toestaan**, **Altijd toestaan**, **Afwijzen**, **Altijd afwijzen**. Je antwoord gaat alleen naar de agent: wat hij na een ja doet, is zijn eigen zaak, en een 'altijd' is een belofte die de agent houdt, niet Plainva.

**Stoppen** beëindigt het antwoord waaraan de agent werkt.

## Wat de agent schrijft

**Via Plainva.** Een wijziging die de agent aan Plainva geeft, wordt nooit in de notitie geschreven. Als het antwoord van de agent klaar is, draagt elke notitie die hij heeft gewijzigd één ronde voorstellen, ondertekend met **⟨naam⟩ (externe agent)**: onder **Voorstellen** accepteer of wijs je elke wijziging of de hele ronde af, net als bij de ronde van een persoon. Een eigenschap die de tekst van de agent wijzigt, staat in die ronde als voorgestelde waarde, zoals een waarde die de eigen AI van Plainva voorstelt. Een notitie die nog niet bestaat, wacht als concept — als kaart **Concept · Notitie** in de sessie, en als dezelfde kaart in de lijst **Open** van het AI-tabblad, waar ze ook na het einde van de sessie blijft staan. **Aanmaken** schrijft haar op precies de plek die de agent noemde — gemarkeerd met `generated`, met de agent als auteur —, en **Verwerpen** laat haar vallen. Webadressen die de agent heeft meegebracht, worden zo geschreven dat niets ze opent of laadt (`https[://]…`).

Plainva neemt niet alles aan: alleen Markdown-notities; geen AI-regels, geen vertrouwensvelden en geen eigen eigenschappen van Plainva; geen eigenschapswaarde die geen tekst, getal, ja of nee, of lijst daarvan is; niets wat van de cloud of van internet wordt weggehouden; niet meer dan 150 wijzigingen in één notitie tegelijk; en geen verdere nieuwe notitie zolang er te veel concepten wachten. Wat het niet heeft aangenomen, zegt de sessie, en de agent krijgt het te horen.

**Zelf.** Een agent kan ook zelf bestanden schrijven, zoals elk programma. Als hij zo'n wijziging meldt, zegt de sessie **De agent heeft ⟨notitie⟩ zelf gewijzigd: het staat zonder voorstel in de vault.** Welke weg een agent neemt, kan Plainva niet beloven: het hangt af van de agent en van hoe hij is ingesteld. In de instellingen toont elke agent wat er op deze computer voor het laatst is gezien — hoeveel wijzigingen via Plainva kwamen en hoeveel hij er zelf heeft geschreven.

## Wat Plainva bewaart

- **Op dit apparaat:** de opdracht die je hebt bevestigd, je naam voor de agent en wat er voor het laatst van zijn wijzigingen is gezien — in de eigen gegevens van Plainva, nooit in de vault.
- **Per vault:** **Laatste sessies in deze vault** noemt wanneer een sessie liep, met welke agent, en hoeveel berichten, wijzigingen via Plainva en eigen wijzigingen er waren — nooit wat er is gezegd.
- **Niet de sessie zelf:** wat jij en de agent hebben gezegd, is weg zodra de sessie is gesloten. Wat de agent aan zijn kant bewaart, is de zaak van de agent.

Als het programma van de agent vanzelf eindigt, zegt de sessie dat, en **Zijn laatste regels tonen** toont het einde van wat het programma heeft geschreven.

## Grenzen

- Alleen op de desktop en alleen in het hoofdvenster. Op de telefoon is er de eigen assistent van Plainva.
- Niet in een versleutelde workspace.
- Eén sessie tegelijk, en geen geschiedenis: een beëindigde sessie kan niet opnieuw worden geopend.
- De eigen modi, modellen en opdrachten van een agent kunnen niet vanuit Plainva worden gekozen, en er kunnen geen afbeeldingen naar hem worden gestuurd.
- Tot nu toe is dit alleen met een eigen testagent van Plainva geprobeerd. Welke agents hier werken, en welke hun wijzigingen aan Plainva geven, blijkt als je ze probeert — feedback is welkom.
