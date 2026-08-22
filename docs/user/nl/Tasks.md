# Taken

Laatst bijgewerkt: 2026-08-07

De Taken-weergave verzamelt elk selectievakje in je vault op één plek: alle `- [ ]`- en `- [x]`-lijstitems uit al je notities, gegroepeerd per notitie waarin ze staan. De Taken-weergave is de "wat moet ik nog doen?"-weergave over gewone Markdown — geen plugin, geen speciaal bestand.

## Waarom een aparte weergave (en geen `.base`)

Een [database (`.base`)](Databases_Base.md) werkt met hele notities — één rij per notitie. Een selectievakje is een enkele *regel* binnen een notitie, en een notitie kan er veel bevatten, dus een `.base` kan ze niet weergeven. De Taken-weergave is regelgebaseerd: de taakregels worden rechtstreeks gelezen, zodat één projectnotitie met tien subtaken alle tien laat zien.

## Taken-weergave openen

- Klik op het **checklist-icoon** in de actiebalk uiterst links, of
- open het **opdrachtenpalet** (`Ctrl/Cmd+P`) en voer **Taken openen** uit.

De weergave opent als tab, net als elke notitie.

## Op de telefoon

De Taken-weergave bestaat ook mobiel. Je opent deze via de **▾** naast de titel in de bovenbalk, en je kunt deze in de navigatiebalk plaatsen (**Instellingen** → **Navigatiebalk**).

De weergave toont dezelfde twee secties als op de desktop: bovenaan de **Takendatabase**, daaronder **Uit notities** de selectievakjeslijst, met de filters **Open**/**Klaar**/**Alle** en het vrijetekstveld. Afvinken, **Status wijzigen**, een selectievakje **naar de database verplaatsen**, **+ Nieuwe taak**, **Tijd blokkeren** en **Herhaling** werken zoals hierboven beschreven en schrijven dezelfde bestanden: dezelfde notitie met frontmatter, dezelfde `[[wiki-link]]` in de oorspronkelijke regel, dezelfde regel onder `plainva.repeat`.

Welke database je vault als takendatabase gebruikt, stel je mobiel in onder **Instellingen** → **Inhoud en structuur**. De instelling reist mee via de [instellingensynchronisatie](Sync_Setup.md), dus je hoeft hem maar één keer te kiezen, op het apparaat van je keuze.

De vier filters van de desktopbalk verschijnen op de telefoon als chips boven de lijst: **Map**, **Tag**, **Met einddatum** en **Verborgen tonen**. Chips in plaats van keuzelijsten, omdat een filterbalk boven een toch al smalle lijst meer ruimte kost dan hij oplevert — één tik opent de keuze, een tweede wist hem weer.

## De lijst lezen

Taken zijn gegroepeerd per notitie; de notitietitel is een kop waarop je kunt klikken om de notitie te openen. Elke taak toont het selectievakje en de tekst, doorgestreept zodra de taak is voltooid. Een **vervaldatum**, geschreven als `📅 2026-08-01` in de taakregel, verschijnt als klein label.

## Filteren

De balk bovenaan beperkt de lijst:

- **Open / Voltooid / Alle** — op selectievakjestatus (start bij **Open**).
- **Taken filteren…** — vrije tekst; komt overeen met de taaktekst.
- **Alle mappen** — alleen taken in de gekozen map (en de submappen daarvan).
- **Alle tags** — alleen taken met een gekozen inline-`#tag`.
- **Met einddatum** — alleen taken met een `📅`-datum.

Tags en vervaldatums worden rechtstreeks uit de taakregel gelezen — bijvoorbeeld `- [ ] Factuur betalen #finance 📅 2026-08-01`.

## Taken afvinken

Klik op het **selectievakje** van een taak om te wisselen tussen open en voltooid. De wijziging wordt direct teruggeschreven naar de notitie (als een normale, veilige bestandsschrijfactie — alleen het ene teken `[ ]`/`[x]` verandert), zodat de notitie, Obsidian en elke synchronisatie gelijke tred houden. Klik in plaats daarvan op de **tekst** van de taak om de notitie te openen en naar die regel te springen.

Is een notitie gewijzigd sinds de lijst is opgebouwd, dan wordt een verouderde wisseling overgeslagen en wordt de lijst vernieuwd — gebruik de knop **vernieuwen** rechtsboven om op elk moment opnieuw te laden.

## Standaard takendatabase

Selectievakjes zet je snel neer, maar soms groeit een regel uit tot een "echte" taak — met een status, een vervaldatum en een eigen notitie. Kies daarvoor in Instellingen onder **Inhoud en structuur** een **Standaard takendatabase**: een [database (`.base`)](Databases_Base.md) waarin zulke taken als eigen notities leven. **Nieuwe database maken…** zet meteen een kant-en-klare op (opslagmap plus een `.base` met een **selectievakjekolom voor voltooid** (`klaar`), een statuskolom, een vervaldatumkolom, een tabelweergave en een bordweergave); je kunt net zo goed een bestaande database kiezen. De selectievakje-eigenschap is de voltooiingswaarheid van een taak (aan/uit, net als bij de providers); de statuskolom blijft consistent wanneer je afvinkt. Heeft een database geen selectievakjekolom, dan geldt de statusconventie: eerste optie = open, laatste = voltooid.

Eenmaal ingesteld, toont de Taken-weergave twee secties: bovenaan de items van de **Takendatabase**, daaronder **Uit notities** — de vertrouwde lijst met selectievakjes. De status is direct in het overzicht te wijzigen: het selectievakje IS de voltooid-eigenschap van de notitie en wisselt deze (de statuskolom volgt mee), en een klik op de statuschip opent een menu met alle opties (**Status wijzigen**). De filters **Open**/**Klaar**/**Alle** gelden voor beide secties, en **Als database openen** springt naar de volledige databaseweergave met bord en filters. **Vernieuwen** start bij verbonden accounts bovendien een echte synchronisatie met de provider.

## Een selectievakje omzetten in een databasetaak

Elke taakregel draagt een database-icoon: **Naar de takendatabase verplaatsen**. Eén klik

- maakt een nieuwe notitie aan in de opslagmap van de database (met het standaardsjabloon, als daar een is ingesteld),
- neemt een `📅`-datum over in de vervaldatumkolom, zet de eerste statusoptie voor open taken en slaat de `#tags` van de regel op als tags van de notitie,
- koppelt de nieuwe notitie terug aan de oorspronkelijke notitie via een eigenschap `source`, en
- vervangt de selectievakjeregel in de oorspronkelijke notitie door een wiki-link naar de nieuwe taaknotitie — het item blijft leesbaar op de plek waar het geschreven werd, en de taak leeft nu in de database.

**Rechtsklik** op het icoon om in plaats daarvan een andere database als doel te kiezen; zonder standaard takendatabase opent de klik die kiezer meteen. Alles blijft gewoon Markdown: de nieuwe taak is een gewone notitie met frontmatter, en de link in de oorspronkelijke notitie is een normale `[[wiki-link]]`.

**+ Nieuwe taak** in de sectiekop maakt direct een item in de takendatabase aan (dezelfde opslagmap, sjabloon en standaardwaarden als bij het verplaatsen van een vinkje) en opent het. Vinkjes die je in een notitie schrijft blijven daar — ze worden pas databasetaken als je ze verplaatst.

## Tijd blokkeren voor een taak

Taken zijn in Plainva **dagnauwkeurig**: een taak heeft een vervaldatum, geen tijdstip. Wil je er tijd voor vrijmaken, dan maakt Plainva daarvoor een **afspraak** aan — dat is het object met een tijdsbereik, dat overlappingen in het raster toont en met je agenda-account synchroniseert.

Het agendapictogram op een taakregel opent **Tijd blokkeren**: de datum (vooringevuld met de vervaldatum), de starttijd en de **Duur** (15 min, 30 min, 1 u, 2 u of **Aangepast**), plus een agendakeuze als meerdere agenda's schrijfbaar zijn. De afspraak krijgt de titel van de taak en verwijst terug naar de notitie.

Bij een taak uit de database onthoudt de notitie het blok ook in haar frontmatter (`plainva.blocks`), zodat de koppeling van beide kanten zichtbaar is. Een regel met selectievakje heeft geen eigen notitie — daar ontstaat alleen de afspraak, die verwijst naar de notitie waarin de regel staat. Het pictogram verschijnt alleen als er een agenda-account is verbonden.

## Taken herhalen

Een taak die regelmatig terugkomt, krijgt een **herhaling** via het herhalingsicoon in de sectie **Takendatabase**. Plainva maakt geen **reeks** aan: het afvinken van de taak maakt de **volgende** taak aan als eigen notitie naast de voltooide, met de nieuwe vervaldatum. Zo staat er altijd precies één taak open, blijft de voltooide taak staan als bewijs van wat is gedaan, en is er geen onzichtbare reeks waaruit je per ongeluk alles kunt verwijderen — verwijder je een taak, dan stopt de keten.

Het dialoogvenster biedt drie dingen:

- **Ritme** — Dagelijks, Wekelijks, Maandelijks of Jaarlijks, plus het interval onder **Elke** (bijvoorbeeld "Elke 3" + "Dagelijks" = om de drie dagen).
- **Geteld vanaf: Vervaldatum** — een vast ritme ("elke maandag"). Vink je een verlopen taak laat af, dan springt Plainva naar de eerstvolgende vervaldatum **in de toekomst**, in plaats van de lijst te vullen met de gemiste data.
- **Geteld vanaf: Afvinken** — het ritme begint op de dag dat je de taak afvinkt ("om de drie dagen nadat ik de planten water heb gegeven").

**Niet herhalen** verwijdert de herhaling weer. Maandelijkse taken schuiven nooit voorbij het einde van een maand: 31 januari plus één maand is 28 of 29 februari, niet 3 maart.

In de **agenda** verschijnt een herhalende taak daarom maar **eenmaal**, op de actuele vervaldatum, met een herhalingspictogram bij de regel. Dat is geen gebrek, maar de keerzijde van de generator: er is geen reeks waaruit de agenda meer voorkomens zou kunnen tekenen, en regels zonder notitie erachter zouden niet te openen zijn. Zet je de herhaling in plaats daarvan op de **gekoppelde afspraak** (via **Tijd blokkeren**), dan is dat wél een echte afsprakenreeks: je provider vouwt hem uit en je ziet veel voorkomens — maar dat maakt **geen taken** aan, alleen afspraken.

De regel staat in de frontmatter van de notitie (`plainva.repeat`) en reist dus mee met je synchronisatie — niet in een verborgen app-instelling, en ook niet als databasekolom, omdat de regel bij **deze ene** taak hoort, niet bij elk item van de database. Taken die gespiegeld zijn vanuit een takenlijst van je provider bieden de herhaling niet aan: ze herhalen daar al, en een tweede ritme erbovenop zou dubbele taken terugduwen naar de provider.

## Notities uit de Taken-weergave verbergen

Sommige notities bevatten selectievakjes die nooit "echte" taken zijn — vooral **sjablonen**. Om ze buiten de lijst te houden, kan een notitie zichzelf uitsluiten. De waarheid blijft in het bestand: de uitsluiting is een frontmatter-veld in de notitie, geen verborgen app-instelling. Het synchroniseert mee, is zichtbaar in Obsidian en is met elke teksteditor te controleren:

```yaml
---
plainva:
  tasks: false
---
```

Je hoeft dit veld niet met de hand te schrijven:

- **Verbergen uit taken** — rechts in de kopregel van elke notitie staat een oog-icoon; met één klik wordt de marker in de notitie geschreven en wordt deze verborgen.
- **Verborgen tonen** — deze optie in de balk bovenaan brengt de verborgen notities terug (gedimd), elk met een icoon **Weer in taken tonen** dat de marker verwijdert.
- **Sjablonen verbergen** — als je sjabloonmap notities met selectievakjes bevat, verschijnt rechtsboven een knop **Sjablonen verbergen** die de marker in één keer bij al deze notities aanbrengt.

Nieuw aangemaakte sjablonen dragen de marker automatisch. Maak je een notitie **vanuit** een sjabloon, dan wordt de marker weer verwijderd — de nieuwe notitie is echte inhoud en de taken erin worden gewoon getoond.

## Obsidian-compatibiliteit

Taken zijn gewone GFM-selectievakjes (GitHub-Flavored Markdown). Plainva voegt nooit een speciale syntax toe: dezelfde `- [ ]`-regels worden in Obsidian weergegeven als selectievakjes en zijn in elke editor gewoon leesbaar. De conventies `📅 datum` en `#tag` zijn de gangbare Obsidian-Tasks-stijl, maar ze zijn gewoon tekst in je notitie.

## Zie ook

- [Notities & Markdown](Notes_and_Markdown.md) — takenlijsten schrijven in de editor
- [Zoeken](Search.md) — volledige-tekstzoekfunctie over de hele vault
- [Databases (.base)](Databases_Base.md) — databases op notitieniveau

## Afvinken in het overzicht

Een taak afvinken in het overzicht schrijft het vakje naar de bronnotitie en vernieuwt die notitie in de zoekindex voordat de lijst opnieuw wordt gelezen. De taak verdwijnt direct uit **Open** en komt niet terug uit een verouderde index.
