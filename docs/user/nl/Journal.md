# Journaal

Laatst bijgewerkt: 2026-09-22

Het journaal is de snelle manier om iets vast te leggen zonder een notitie te openen: een gedachte, een telefoongesprek, een regel over de dag. Elk item is een gewone lijstregel met een tijdstip — `- 14:05 Router staat in de kelder` — onder een kop van de **dagnotitie van vandaag**. Er is geen nieuw bestandsformaat en geen database: de items leven in je dagnotities, leesbaar in elke editor en verenigbaar met de journaal-plugins van Obsidian (Thino, Knomo).

## Een item schrijven

Eén veld, één **Enter**. Plainva zet het tijdstip; jij typt alleen de tekst. Tags, links en een tweede regel typ je gewoon mee — de tekst is gewoon Markdown.

- **Op de desktop:** `Ctrl+Shift+J` opent het veld **Journaalitem** vanaf overal in Plainva. Hetzelfde veld staat in het **＋**-menu van de zijbalk, in de opdrachtenpalet en in het systeemvakmenu (**Journaalitem**). `Enter` slaat op, `Shift+Enter` begint een nieuwe regel, `Esc` verwerpt.
- **Op de telefoon:** de **＋**-knop biedt **Journaalitem** aan; het journaalscherm heeft een eigen pen-knop. Ook een lange druk op het app-pictogram biedt **Journaalitem** aan — als app-snelkoppeling onder Android, als snelle actie onder iOS. `Enter` blijft daar een regeleinde; **Item opslaan** slaat op.
- **Vanuit het deelvenster (telefoon):** kies Plainva en vink **Naar het Journaal** aan — tekst en link worden het item, gedeelde bestanden komen in de bijlagenmap terecht en worden ingesloten.
- **Met een foto:** het veld op de telefoon heeft **Foto toevoegen**; op de desktop plak je een afbeelding uit het klembord in het veld. De foto komt terecht waar bijlagen komen en wordt in het item ingesloten.

Bestaat de dagnotitie van vandaag nog niet, dan wordt ze onderweg aangemaakt — vanuit je dagnotitie-sjabloon, zonder de vragen ervan te stellen. Na het opslaan meldt een melding **Item opgeslagen** en biedt **Ongedaan maken** aan.

Het veld doet één ding: een journaalitem. Eronder geeft **In plaats daarvan een taak maken** het getypte door aan de [takenweergave](Tasks.md), waar de taak zoals gewoonlijk ontstaat, en sluit het veld. De chip **Als taak** is iets anders: die laat het item in het journaal staan en geeft het een vakje (`- [ ] 14:05 onderdeel bestellen`), zodat het ook in de takenweergave onder **Uit notities** verschijnt. Het vakje van de chip blijft leeg tot je hem kiest.

## De journaalweergave

**Journaal openen** (actiebalk op de desktop, **Onderdelen** op de telefoon, of de opdrachtenpalet) toont alle dagen als één stroom: de nieuwste dag bovenaan, binnen een dag het nieuwste item eerst. Links openen, tags zijn pillen, een ingesloten afbeelding verschijnt als voorbeeld, en een lang item wordt ingeklapt — **Meer** opent het.

- **Stroom of kaarten:** de schakelaar in de kop van de weergave — **Stroom** en **Kaarten** — toont dezelfde items in twee vormen. De stroom leest een dag naar beneden, de kaartenwand laat een week overzien; elke dag houdt zijn eigen wand met een lijn erboven. Kaarten kunnen wat regels kunnen: tikken opent de plek in de notitie, rechtsklikken of lang drukken opent dezelfde acties, en taakvakjes vink je af. De keuze onthoudt **het apparaat**.
- **Zoeken en filteren:** het zoekveld doorzoekt de geladen dagen; de chips **Alle**, **Alleen taken** en de meest gebruikte tags beperken de stroom. Een klik op een tag in een item filtert daarop.
- **Oudere dagen:** Plainva laadt de laatste 14 dagen die items hebben. **Oudere laden** haalt het volgende stuk op; **Naar een dag springen** opent de datumkiezer, waarin dagen met items zijn gemarkeerd, en laadt zo ver terug als de gekozen dag ligt.
- **Notitie openen** in de kop van een dag opent die dagnotitie; een klik op een item opent de notitie op die regel.
- **Selectievakjes** van taakitems kun je direct in de stroom afvinken. Ze gedragen zich als in de takenweergave, inclusief de voltooiingsdatum en de eerstvolgende vervaldatum van een herhalende taak.

Elk item heeft een menu (rechtsklik of **⋯** op de desktop; **⋯**, een lange druk of een veegbeweging op de telefoon): **Bewerken** wijzigt de tekst ter plekke en behoudt de tijd, **Kopiëren** kopieert de tekst, **Omzetten in een taak** voegt het selectievakje toe en **Weer omzetten in een item** verwijdert het weer, **Tonen in de notitie** springt naar de regel, **Verwijderen** verwijdert het item — met **Ongedaan maken** in de melding die daarna volgt.

De items van één dag staan ook waar je die dag bekijkt: als sectie **Journaal** in de rechter zijbalk van de desktop (voor de dag van de geopende dagnotitie, anders vandaag) en op de telefoon op het scherm **Vandaag** voor de gekozen dag. In de zijbalk is het een sectie als elke andere: hij klapt dicht, onthoudt dat, kan verborgen worden en begint gesloten. De regels zijn één regel hoog: daar bedien je niets, elke regel begint op dezelfde rand, en een taak draagt rechts een rustig teken in plaats van een vakje (afvinken doe je in de stroom of in de notitie). Het potlood in de kop opent het gewone veld **Journaalitem** voor precies die dag, en **Alle dagen** leidt naar de stroom.

## Hoe een item wordt opgeslagen

```markdown
## Journal

- 09:12 Werkplaats gebeld #klant
- [ ] 10:30 Onderdeel bestellen
- 14:05 Router staat in de kelder
  De sleutel ligt bij mevrouw Berger.
```

- Items worden aan het einde van de sectie toegevoegd, zodat het bestand chronologisch leesbaar blijft; de weergave toont het nieuwste bovenaan.
- De kop heet standaard **Journal** en kan per vault worden gewijzigd onder **Instellingen → Vault → Inhoud en structuur** (**Kop van het journaal**; op de telefoon onder **Instellingen → Inhoud en structuur**). Het niveau ervan maakt niet uit. Ontbreekt de kop, dan voegt Plainva `## Journal` toe aan het einde van de notitie. Het wijzigen van de instelling hernoemt bestaande koppen niet.
- **De dag eindigt om** (dezelfde plek in de instellingen) verschuift de grens van de dag naar achteren: staat er **04:00**, dan hoort alles wat je tussen middernacht en vier uur schrijft nog bij de dag ervoor — het item komt in de dagnotitie van gisteren en houdt zijn echte tijd (`- 01:30 …`). De dagkop in het journaal zegt dan **tot 04:00**. De grens geldt voor de dagnotitie en het journaal, **niet** voor de agenda en niet voor de vervaldatum van taken: een afspraak om 01:30 op woensdag blijft op woensdag. De standaard is **Middernacht**; de instelling hoort bij de kluis en geldt op alle apparaten.
- **Stemming:** draagt de instelling **Stemming: eigenschap van de dagnotitie** (dezelfde plek) een naam — bijvoorbeeld `stemming` — dan toont de dagkop in het journaal vijf punten en beoordeel je de dag daar met één druk. De dagnotitie houdt dan `stemming: 4`; op de huidige waarde drukken wist die weer. Dezelfde eigenschap kan in een database een kolom van het type **Beoordeling** zijn en daar gesorteerd worden. Laat het leeg en deze kluis beoordeelt geen dagen.
- **Spraaknotitie**: het microfoonpictogram in het invoerveld neemt op. Tijdens de opname zie je de verstreken tijd en heb je twee uitgangen: **Weggooien** gooit de opname weg, **Toevoegen** schrijft haar naar de bijlagenmap en voegt haar aan het item toe. De bestandsnaam draagt datum en tijd (`Spraaknotitie 2026-09-22 1430.m4a`). Plainva vraagt bij de **eerste** tik om toegang tot de microfoon, nooit bij het starten, en neemt niets op zolang je zelf niet opneemt; de opname blijft in je kluis en gaat nergens heen.
- **Plaats:** standaard uit. Zet **Toestaan een plaats aan journaalitems toe te voegen** aan (Instellingen → Weergave) en het invoerveld krijgt een tweede knop; één druk voegt je coördinaten als eigen regel aan het item toe: `📍 52.5200, 13.4050`. Vier decimalen is ongeveer elf meter — genoeg voor het gebouw, niet voor de kamer. De naam van de plaats kun je zelf erbij schrijven of de regel verwijderen; Plainva vraagt het aan geen enkele onlinedienst. **Er wordt niets stilletjes vastgelegd**: geen geschiedenis, geen kaart, geen achtergrondtracking — alleen die ene positie op het moment dat je drukt. Het systeem vraagt bij de eerste druk om toestemming. Op de telefoon is de knop er altijd; op een computer alleen waar het besturingssysteem de app een positie geeft.
- Plainva leest ook `- 14:05:30 Tekst` (met seconden) en items met een selectievakje, en het zet de lijst voort zoals je notitie ze schrijft (`-`, `*` of `+`, met of zonder lege regels tussen de items). Bestaande regels worden nooit opnieuw opgemaakt.
- Een wijziging die niet veilig kan worden geplaatst — bijvoorbeeld omdat een codeblok in de sectie nooit is gesloten — wordt met een melding geweigerd, en het veld behoudt je tekst.

Het exacte formaat staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

## Twee apparaten tegelijk

Voegen twee apparaten items toe aan dezelfde dagnotitie voordat ze zijn gesynchroniseerd, dan is dat **geen conflict**: Plainva voegt de items samen op tijdstip, en elke regel van beide apparaten blijft behouden. Dat geldt ook wanneer beide apparaten de notitie van de dag onafhankelijk van elkaar hebben aangemaakt. Elke andere gelijktijdige wijziging aan de notitie wordt net zo zorgvuldig behandeld als voorheen (zie [Sync-compatibiliteit](Sync_Compatibility.md)).

## Globale snelle invoer (desktop, optioneel)

Onder **Instellingen → Opstarten en gedrag → Globale snelle invoer** kun je **Overal vastleggen met een systeembrede sneltoets** inschakelen. De sneltoets — standaard `Ctrl+Alt+J` (`Cmd+Option+J` onder macOS) — opent dan een klein venster met het invoerveld, ook als een ander programma op de voorgrond staat, zolang Plainva actief is (ook in het systeemvak). `Enter` schrijft het item in de dagnotitie van vandaag van de vault die in Plainva geopend is, en sluit het venster; `Esc` verwerpt.

- **Wijzigen** legt een nieuwe sneltoets vast: druk de gewenste combinatie in, met `Ctrl`, `Alt` of de Windows-/Command-toets. **Standaard herstellen** brengt de standaard terug.
- Gebruikt een ander programma de sneltoets al, of neemt het systeem hem niet aan, dan zegt Plainva dat onder de schakelaar, in plaats van een sneltoets te laten staan die niets doet.
- Onder **Wayland** (Linux) geeft het systeem programma's geen systeembrede sneltoets; Plainva zegt dat en registreert niets. Het item in het systeemvak en `Ctrl+Shift+J` leiden naar hetzelfde veld.
- De sneltoets hoort bij het apparaat en maakt geen deel uit van het instellingenprofiel.
