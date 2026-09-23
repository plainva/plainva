# Taken

Laatst bijgewerkt: 2026-09-20

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

- **Open / Klaar / Alle** — op basis van de status van het selectievakje (begint bij **Open**). Dit filter hoort bij de lijst **Alle**; de plannerlijsten **Vandaag**, **Binnenkort**, **Inbox** en **Klaar** beantwoorden die vraag zelf al.
- **Taken filteren…** — vrije tekst; komt overeen met de taaktekst.
- **Alle mappen** — alleen taken in de gekozen map (en de submappen daarvan).
- **Alle tags** — alleen taken met een gekozen inline-`#tag`.
- **Met einddatum** — alleen taken met een `📅`-datum.

Tags en vervaldatums worden rechtstreeks uit de taakregel gelezen — bijvoorbeeld `- [ ] Factuur betalen #finance 📅 2026-08-01`.

## Taken afvinken

Klik op het **selectievakje** van een taak om te wisselen tussen open en voltooid. De wijziging wordt direct teruggeschreven naar de notitie (als een normale, veilige bestandsschrijfactie — alleen het ene teken `[ ]`/`[x]` verandert), zodat de notitie, Obsidian en elke synchronisatie gelijke tred houden. Klik in plaats daarvan op de **tekst** van de taak om de notitie te openen en naar die regel te springen.

Is een notitie gewijzigd sinds de lijst is opgebouwd, dan wordt een verouderde wisseling overgeslagen en wordt de lijst vernieuwd — gebruik de knop **vernieuwen** rechtsboven om op elk moment opnieuw te laden.

## Standaard takendatabase

Selectievakjes zet je snel neer, maar soms groeit een regel uit tot een "echte" taak — met een status, een vervaldatum en een eigen notitie. Kies daarvoor in Instellingen onder **Inhoud en structuur** een **Standaard takendatabase**: een [database (`.base`)](Databases_Base.md) waarin zulke taken als eigen notities leven. **Nieuwe database maken…** zet meteen een kant-en-klare op (opslagmap plus een `.base` met een **selectievakjekolom voor voltooid** (`klaar`), een statuskolom, een vervaldatumkolom, en een tabelweergave, een bordweergave en een tijdlijnweergave — de tijdlijn zet elke taak op haar vervaldag); je kunt net zo goed een bestaande database kiezen. De selectievakje-eigenschap is de voltooiingswaarheid van een taak (aan/uit, net als bij de providers); de statuskolom blijft consistent wanneer je afvinkt. Heeft een database geen selectievakjekolom, dan geldt de statusconventie: eerste optie = open, laatste = voltooid.

Eenmaal ingesteld, toont de Taken-weergave twee secties: bovenaan de items van de **Takendatabase**, daaronder **Uit notities** — de vertrouwde lijst met selectievakjes. De status is direct in het overzicht te wijzigen: het selectievakje IS de voltooid-eigenschap van de notitie en wisselt deze (de statuskolom volgt mee), en een klik op de statuschip opent een menu met alle opties (**Status wijzigen**). De filters **Open**/**Klaar**/**Alle** gelden voor beide secties, en **Als database openen** springt naar de volledige databaseweergave met bord en filters. **Vernieuwen** start bij verbonden accounts bovendien een echte synchronisatie met de provider.

## Een selectievakje omzetten in een databasetaak

Elke taakregel draagt een database-icoon: **Naar de takendatabase verplaatsen**. Eén klik

- maakt een nieuwe notitie aan in de opslagmap van de database (met het standaardsjabloon, als daar een is ingesteld),
- neemt een `📅`-datum over in de vervaldatumkolom, zet de eerste statusoptie voor open taken en slaat de `#tags` van de regel op als tags van de notitie,
- koppelt de nieuwe notitie terug aan de oorspronkelijke notitie via een eigenschap `source`, en
- vervangt de selectievakjeregel in de oorspronkelijke notitie door een wiki-link naar de nieuwe taaknotitie — het item blijft leesbaar op de plek waar het geschreven werd, en de taak leeft nu in de database.

**Rechtsklik** op het icoon om in plaats daarvan een andere database als doel te kiezen; zonder standaard takendatabase opent de klik die kiezer meteen. Alles blijft gewoon Markdown: de nieuwe taak is een gewone notitie met frontmatter, en de link in de oorspronkelijke notitie is een normale `[[wiki-link]]`.

**+ Nieuwe taak** in de sectiekop plaatst de cursor in het invoerveld boven de lijsten (zie hieronder *Planner, snel vastleggen, prioriteit en statussen*). De taak wordt direct aangemaakt in de takendatabase — dezelfde opslagmap, hetzelfde sjabloon en dezelfde standaardwaarden als bij het verplaatsen van een selectievakje — en een melding biedt **Openen** aan. Selectievakjes die in een notitie zijn geschreven, blijven in die notitie — ze worden pas databasetaken wanneer je ze verplaatst.

## Tijd blokkeren voor een taak

Een taak heeft een vervaldatum en kan een **tijdstip** dragen (`2026-09-21T14:00`) — dat is het moment waarop Plainva je eraan herinnert. Een tijdstip is een moment, geen periode. Wil je er tijd voor vrijmaken, dan maakt Plainva daarvoor een **afspraak** aan — dat is het object met een tijdsbereik, dat overlappingen in het raster toont en met je agenda-account synchroniseert.

Het agendapictogram op een taakregel opent **Tijd blokkeren**: de datum (vooringevuld met de vervaldatum), de starttijd en de **Duur** (15 min, 30 min, 1 u, 2 u of **Aangepast**), plus een agendakeuze als meerdere agenda's schrijfbaar zijn. De afspraak krijgt de titel van de taak en verwijst terug naar de notitie. Een **rechtsklik** op de regel toont dezelfde acties als het blad op de telefoon: afgerond/open, naar database verplaatsen, herhaling, tijd blokkeren.

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

<!-- accounts-tasks-2026-09-11 -->
## Taken met dezelfde titel apart houden

Taken van de aanbieder worden op identiteit gekoppeld. Afzonderlijke herhalingen krijgen eigen bestanden. Bestaande onterechte conflicten kunnen als aparte taken bewaard worden.

Deze bestanden horen bij verschillende taken. Terugkerende taken met dezelfde titel kunnen aparte instanties zijn. Beide inhouden blijven als aparte taken bewaard.

**Als aparte taken behouden** — Dit bestand blijft ongewijzigd: Huidig bestand  De conflictkopie blijft bewaard als apart bestand: conflictkopie

<!-- tasks-jex-2026-09-14 -->
## Tasks-metagegevens en herhaling

Desktop, mobiel en Live Preview herkennen ➕ aangemaakt, ✅ voltooid, 📅 vervaldatum, ⏳ gepland, 🛫 start, 🆔 ID en 🔁 herhaling. Datums: YYYY-MM-DD. Bestaande ID’s blijven bij verplaatste regels; onbekende gegevens blijven in Markdown.

Alleen de Engelse regels `every [N] day/week/month/year[s] [when done]` (N: 1–999) zijn automatisch. Voltooien schuift één periode op, ook als die nog verlopen is; `when done` telt vanaf voltooiing. Afstanden tussen datums blijven behouden, begrensd op het maandeinde. Zonder datum blijft de opvolger ongedateerd. Complexe regels, afhankelijkheden, blok-ID’s, dubbele ID’s, ongeldige datums, ingesprongen inhoud, native herhaling en providertaken schakelen deze generator uit.

Afvinken voegt bij taken met metagegevens de voltooiingsdatum toe. Ondersteunde herhaling voegt zo nodig een ID toe en geeft de opvolger een eigen `pv-…`-ID. Het geheel is één Markdown-bewerking; Ongedaan maken herstelt die volledig. Heropenen en opnieuw afvinken behoudt de opvolger en zijn wijzigingen.

Native databasetaken slaan verlopen perioden nog steeds over. Een opgeslagen doelplan voorkomt dubbele opvolgers. Controleer bij een onbevestigde opvolger de takenmap; heropenen en afvinken kan een schrijffout hervatten. Bij een gewijzigde bron wordt geen afwijkende kopie geschreven: controleer de notities en maak de opvolger zo nodig handmatig. Een bevestigde en later verwijderde opvolger wordt niet hersteld.

## Taakfilters herstellen

Status, zoektekst, map, tag, vervaldatumfilter en zichtbaarheid van verborgen taken blijven per kluis op dit apparaat bewaard, ook na het openen van een notitie of opnieuw starten. “Filters herstellen” toont weer open taken zonder extra filters. Niet-beschikbare mappen en tags blijven zichtbaar en kunnen via hun keuzelijst worden verwijderd. De kluis vergeten wist deze weergavestatus. De standaard taakdatabase blijft de bestaande kluisinstelling; filters worden niet gesynchroniseerd.

<!-- planner-capture-2026-09-20 -->
## Planner, snel vastleggen, prioriteit en statussen

De takenweergave opent op **Vandaag**. De lijsten — op de desktop een balk links, op de telefoon een segment boven de lijst — zijn **Vandaag** (wat vandaag moet, met **Te laat** bovenaan), **Binnenkort** (de komende 14 dagen, per dag), **Inbox** (open taken zonder datum), **Alle** (de twee hierboven beschreven secties, met het filter **Open**/**Klaar**/**Alle**) en **Klaar**. Elke lijst put uit beide bronnen, de takendatabase en de selectievakjes in je notities, gesorteerd op prioriteit, dan tijd, dan titel. De overige filters gelden voor elke lijst, en de gekozen lijst wordt per vault onthouden. Op de desktop toont de balk ook de meest gebruikte tags als filters met één klik; op de telefoon leidt het scherm **Vandaag** naar de plannerlijst **Vandaag**.

Boven de lijsten staat het invoerveld; op de telefoon openen **+ Nieuwe taak** en de **＋**-knop het als een blad. Typ één regel — `Offerte versturen morgen 14:00 !!! #klant wekelijks` — en druk op Enter: Plainva maakt de taak aan in de takendatabase. Het herkent vandaag, morgen, overmorgen, dagen van de week, ‘over 3 dagen’, ‘volgende week’, datums in cijfers, een tijdstip (`14:30`, `2pm`), een ritme (dagelijks, wekelijks, maandelijks, jaarlijks, ‘elke maandag’, ‘elke 2 weken’), `!`, `!!` en `!!!` voor lage, gemiddelde en hoge prioriteit, en `#tags` — de woorden in de taal van de app, cijfers en tekens in elke taal. Alles wat herkend is, wordt in het veld gemarkeerd en eronder als verwijderbaar blokje getoond **voordat** er iets wordt opgeslagen; haal je een blokje weg, dan telt de tekst ervan gewoon weer mee als titel. Op de telefoon schrijven snelknoppen dezelfde woorden voor je. Noemt de takendatabase een providerlijst, dan bepaalt een chip of de taak ook daar wordt aangemaakt.

**Prioriteit instellen** in het menu van een rij (rechtsklikken op de desktop, ingedrukt houden op de telefoon) biedt **hoog**, **gemiddeld**, **laag** en **geen**; een vlaggetje voor de titel toont dit. In de takendatabase is prioriteit een keuzekolom: een nu aangemaakte database heeft hem al, een oudere krijgt hem zodra je voor het eerst een prioriteit instelt — nooit door hem enkel te openen. Een selectievakje draagt op zijn regel het teken van de Obsidian Tasks-plugin: Plainva leest 🔺 en ⏫ als hoog, 🔼 als gemiddeld, 🔽 en ⏬ als laag, en schrijft ⏫, 🔼 of 🔽.

`- [/]` (**Bezig**) en `- [-]` (**Geannuleerd**) zijn ook taken. Ze krijgen een eigen vakje in de editor, in de leesmodus en in elke lijst; bezig telt als open, geannuleerd als afgerond. Een klik wisselt nog steeds alleen tussen open en klaar — hij rondt een taak die bezig is af en heropent een geannuleerde. **Status instellen** in het rijmenu zet de twee statussen; Plainva schrijft ze nooit uit zichzelf.

Meer manieren om een taak toe te voegen: **Nieuwe taak** in het systeemvakmenu op de desktop (wanneer Plainva op de achtergrond actief blijft), op Android de launcher-snelkoppeling **Nieuwe taak** (app-icoon ingedrukt houden), en op de telefoon **Als taak aanmaken** wanneer je iets met Plainva deelt — de tekst en de bijlagen komen terecht in de notitie van de taak. Hoe een taak met een tijdstip je eraan herinnert, staat beschreven onder [Agenda & externe taken](Calendar_and_Tasks.md).

<!-- widgets-2026-09-23 -->
## Afvinken vanuit een widget

Het vakje in de widget **Vandaag** neemt een verzoek op: het vinkje verschijnt meteen, de notitie verandert bij het volgende openen van Plainva, en dan gebeuren ook de herhaling en de synchronisatie. Tot dan zegt de regel **wordt toegepast bij het openen van Plainva**. Een taak die je intussen hebt afgerond, verwijderd of verplaatst blijft ongemoeid. Op de iPhone vereist dit iOS 17; daaronder opent een tik op de regel de taak. Details: [De mobiele app](Mobile_App.md).
