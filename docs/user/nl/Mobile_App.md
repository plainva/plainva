# De mobiele app

Laatst bijgewerkt: 2026-08-26

Plainva is ook beschikbaar als app voor Android en iOS. Ze werkt met dezelfde Markdown-bestanden, hetzelfde **OKF**-formaat en dezelfde synchronisatie-engine als de desktop-app — je kluis blijft in beide werelden identiek.

## De app installeren

De mobiele app draait als **open test** in Google Play. Op **Android** kom je er direct in: open de testlink via [plainva.com/android-beta](https://plainva.com/android-beta), tik op **Tester worden** en installeer de app vanuit Google Play — geen uitnodiging en geen groep nodig. Plainva staat ook gewoon in de Play Store. Op de **iPhone** loopt de verspreiding via TestFlight; de wachtlijst staat op [plainva.com](https://plainva.com).

**Systeemvereisten:** op iPhone en iPad heeft Plainva **iOS 16.4** of nieuwer nodig — daar hoort de engine die de interface tekent bij het systeem, en een nieuwere Safari verandert daar niets aan. Op Android is Android 7 genoeg, maar **Android System WebView** moet actueel zijn; is die te oud, dan zegt Plainva dat bij het starten en wijst de weg via de Play Store.

Het is een vroege build: houd een back-up van je vault en laat me weten wat er misgaat.

## Indeling

- **Onderbalk:** **twee tot vier** werkoppervlakken naar keuze, plus het vaste item **Onderdelen** aan het eind — samen goed voor drie tot vijf bestemmingen op een balk. **Notities** blijft altijd zichtbaar: zo bereik je je bestanden.
- **Elk onderdeel** (Notities, Vandaag, Taken, Kalender, E-mail, Graaf, Openstaande opmerkingen) is altijd één tik verwijderd via het **onderdelenblad**: **Onderdelen** in de balk of door **lang te drukken op de balk**. Het blad markeert het huidige onderdeel en leidt onderaan direct naar **Navigatiebalk aanpassen…**. Tags, bladwijzers en recent geopende items zijn geen eigen onderdelen meer — ze staan nu onder **Notities**.
- **De balk instellen:** **Instellingen** → **Navigatiebalk**. Met **−**/**+** stel je in hoeveel werkoppervlakken de balk toont (2–4, met live voorbeeld), en met de **sleepgreep** orden je de lijst: de bovenste items vormen de balk (gemarkeerd met een kader), een item omhoog slepen bevordert het. Sleep je naar de boven- of onderrand, dan scrollt de lijst mee, zodat één beweging de hele lijst dekt. Er wordt nooit iets verborgen — wat niet in de balk staat, blijft bereikbaar via **Onderdelen**. Verlaat het onderdeel waar je je bevindt de balk, dan springt de app naar het eerste zichtbare onderdeel. Dezelfde balk kun je ook **op de desktop** ordenen (Instellingen → Vault → Balken en gebieden); met ingeschakelde instellingensynchronisatie reist de indeling mee tussen je apparaten.
- **Een mapregel telt alles eronder**, niet alleen de notities die er rechtstreeks in liggen — een map met alleen submappen zegt niet langer ‘0 notities’ naast een pijl die naar honderden leidt.
- **＋** zweeft als ronde knop boven de balk en opent snel aanmaken: notitie, dagnotitie, map, database, "Vanuit sjabloon…".
- **Een rij ingedrukt houden laat zien wat die rij kan** — notitie, map, database en taak antwoorden hetzelfde, en **Meerdere selecteren** is de eerste regel in dat blad. Naar links vegen voert de twee meest gebruikte acties direct uit; blad en veegbeweging bieden hetzelfde in dezelfde volgorde.
- **Kopbalk:** overal dezelfde — links Terug (ontbreekt op een werkoppervlak), in het midden de titel en één regel context, rechts zoeken en ⋮. Tijdens het scrollen komt hij los van de inhoud en trekt de navigatiebalk zich terug tot de iconen; scroll je weer omhoog, dan gaat hij opnieuw open.
- **Een ⋮ betekent altijd hetzelfde:** acties op het object dat open staat. App-instellingen zitten daar niet achter.
- **Instellingen:** helemaal onderaan **Notities**, net als op de desktop. Ze openen eerst de onderdelenlijst (zoals de linkerkant van de desktopinstellingen) — een tik opent die pagina. Bovenaan leidt **Actieve vault** naar het vaultbeheer: van vault wisselen (vinkje = actief), **Een vault maken** en **Cloudkluis verbinden**. De lijst toont **dezelfde gebieden als op de desktop** — waaronder **Opstarten en gedrag** (welkom en nieuwtjes opnieuw tonen), **Balken en gebieden** (de navigatiebalk) en **Onderhoud** (Vault-statistieken, index opnieuw opbouwen, verwijderde bestanden herstellen). Alleen **Updates** ontbreekt: de app werkt zichzelf niet bij, dat doen Google Play en TestFlight. **Onderhoud** bevat ook het **importeren uit andere apps** — op de telefoon schrijft dat altijd in een submap van de geopende vault, laat vooraf zien wat het zou aanmaken, kan tijdens het draaien worden gestopt en laat een rapport achter.

## Notities lezen en bewerken

Notities openen **weergegeven en alleen-lezen**; de pen rechtsboven schakelt over naar bewerken (met een werkbalk boven het toetsenbord: opmaak, lijsten, wiki-link, slash-commando's, foto invoegen). `![[Notitie]]`-embeds verschijnen als aantikbare voorbeeldkaarten.

De knop **Notitiedetails** in de kopbalk (tussen de bladwijzer en het ⋮-menu) opent de contextkaart van de notitie: eigenschappen (direct bewerkbaar), backlinks, structuur, graaf en de **versiegeschiedenis** — elke bewerking maakt automatisch snapshots aan die je kunt bekijken, vergelijken en herstellen. De Markdown-bron en zoeken binnen de notitie vind je in het ⋮-menu.

Op een breed scherm (een tablet vanaf 1024 px) kan die kaart als **derde kolom** naast de notitie open blijven, in plaats van telkens te openen en te sluiten. De schakelaar heet **Contextpaneel vastzetten** en staat onder **Instellingen → Weergave → Indeling**; hij geldt voor dit apparaat. Staat hij uit — of is het venster smaller — dan opent dezelfde knop de kaart zoals voorheen.

## Sjablonen

Sjablonen werken op de telefoon precies zoals op de desktop: de plaatshouders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) worden ingevuld zodra de notitie wordt aangemaakt, **alle** vragen van een sjabloon verschijnen samen in **één** blad — annuleer je het, dan wordt er niets aangemaakt — en `{{cursor}}` plaatst de cursor zodra de notitie opengaat.

De koppelingen **map → sjabloon** en **notitietype → sjabloon** stel je in op de desktop; ze reizen mee via de instellingensynchronisatie en gelden ook hier — een notitie in `Projekte/` begint dus op beide apparaten hetzelfde, ook bij snelle `＋`-notities en bij **+ Item** in een database. Twee bijzonderheden: `{{weekday:…}}` rekent op de telefoon altijd vanaf maandag (de instelling voor het begin van de week bestaat daar nog niet), en `{{clipboard}}` vraagt in hetzelfde blad om de inhoud van het klembord, in plaats van hem ongevraagd te lezen. Alle plaatshouders staan in [Notities & Markdown](Notes_and_Markdown.md).

## Databases (`.base`)

`.base`-databases werken zoals op de desktop: elke weergave (tabel, lijst, galerij, bord, kalender, tijdlijn), celbewerking per veldtype, kaarten op het bord verplaats je door ze ingedrukt te houden. **Configureren** beheert weergaven, kolommen, filters (inclusief groepen), sortering en eigenschappen.

De **agendaweergave** kent drie perioden: **maand**, **week**, **dag**. De maand blijft de ingang — het is de enige die op een telefoonscherm nog een vorm laat zien; week en dag zijn lijsten, omdat zeven kolommen inhoud op die breedte niet meer leesbaar zijn. Een item over meerdere dagen verschijnt als **balk** in plaats van elke dag opnieuw, en tijden staan vóór de titel. De **tijdlijn** toont een **rij per item** met een balk van begin tot eind: beide uiteinden zijn **met de vinger te slepen**, en dat schrijft het datumveld van de notitie. Onder **Configureren** kies je het datum- en einddatumveld en **kleur op** — dezelfde instelling, hetzelfde bestand als op de computer. Relatieschema's (doelen, kardinaliteit) worden nog steeds op de desktop onderhouden.

**Meerdere items tegelijk**: houd een rij ingedrukt en kies **Meerdere selecteren** — de eerste regel in dat blad. Daarna selecteert een tik in plaats van te openen, en een balk onderaan laat zien hoeveel er zijn. Vanaf daar kun je de selectie **verwijderen** (één vraag, geen twaalf — met hetzelfde overzicht van verbanden dat een enkele verwijdering geeft) of **Waarde instellen…** gebruiken om één eigenschap voor allemaal tegelijk in te stellen: kies eerst de eigenschap, dan de waarde. Waar bij een eigenschap **momenteel gemengd** staat, dragen de geselecteerde items verschillende waarden. Een lege waarde verwijdert de eigenschap. Terwijl het loopt zie je de voortgang en kun je annuleren; wat al is weggeschreven, blijft staan. Tags, lijsten, meervoudige selectie en relaties zijn bewust niet meegenomen — daar zou "ze allemaal op X zetten" betekenen dat elke bestaande waarde verdwijnt.

Een weergave van het type **Prikbord** toont de notities als een bord met kleefbriefjes in twee kolommen: een tik opent de notitie, een lange druk toont de acties (vastzetten, labels, kleur, verwijderen), slepen na een lange druk herschikt, en selectievakjes vink je direct op de kaart af. Het invoerveld bovenaan legt een nieuwe notitie vast. Tip: richt de database op je inbox-map (**Instellingen** → **Inhoud en structuur**) en zowel de snelle ＋-notities als tekst die vanuit andere apps wordt gedeeld, belanden meteen op het bord.

## Taken

Het onderdeel **Taken** verzamelt elk selectievakje in je vault — alle `- [ ]`- en `- [x]`-regels uit alle notities, gegroepeerd per notitie. Dat is het regelgebaseerde overzicht dat een database je niet kan geven, omdat een database met hele notities werkt.

Tikken op een taak opent de notitie **op die regel**; het vakje haakt af en schrijft precies dat ene `[ ]`/`[x]`-teken terug. Vervaldatums (`📅`) en `#tags` verschijnen als chips, zodat ze niet dubbel in de tekst staan.

Heeft je vault een **takendatabase** (**Instellingen** → **Inhoud en structuur**), dan toont het onderdeel deze erboven als eigen sectie: afvinken, status wijzigen, **+ Nieuwe taak** en **Als database openen**. Noemt de database een taaklijst van een provider (**Configureren** → **Gegevensbron** → **Nieuwe taken ook aanmaken in** — hier net zo instelbaar als op de desktop), dan draagt het aanmaakblad ook een schakelaar **Ook aanmaken in “…”**: aan, omdat de keuze van de lijst al de beslissing is, en uit voor die ene taak die in de vault moet blijven. Een verplaatst selectievakje en een als taak vastgelegd bericht volgen dezelfde weg. Elke selectievakjeregel krijgt dan ook **Naar database** in de metaregel — de regel blijft als wiki-link staan, en de taak leeft voortaan als eigen notitie verder.

De **Takenlijsten** die je voor je accounts hebt gekozen, worden door de telefoon zelf in die database gespiegeld — hij importeert nieuwe taken, herkent een bestaande notitie aan haar anker (in plaats van een tweede aan te maken) en stuurt je wijzigingen naar de provider. Verwijder je een taaknotitie bewust, dan wordt de taak ook bij de provider verwijderd — met acht seconden **Ongedaan maken**; stuur je de app binnen die tijd naar de achtergrond, dan blijft de taak staan. Een louter ontbrekend bestand verwijdert daarentegen nooit iets. De regels in detail staan onder [Agenda & taken](Calendar_and_Tasks.md). Wanneer dat gebeurt, staat onder [Kalender en afspraken](#kalender-en-afspraken): een telefoon houdt op de achtergrond geen synchronisatie draaiende, dus haalt Plainva die in bij terugkeer in de app en bij het openen van dit gedeelte.

Boven de lijst vind je dezelfde filters als op de desktop: **Map**, **Tag**, **Met einddatum** en **Verborgen tonen**. Verbergen is een eigenschap van de **notitie**, niet van de losse taak — het oog-icoon op de kopregel van een notitie schrijft `plainva.tasks: false` in de frontmatter van die notitie en haalt haar uit het overzicht; **Sjablonen verbergen** doet hetzelfde in één keer voor de hele sjablonenmap. Het bestand behoudt zijn taken, ze tellen alleen niet meer mee. Lang drukken op **Naar database** kiest de **doeldatabase** als je vault er meer dan één heeft.

Een taakregel toont de titel over de volle breedte; status, vervaldatum, herhaling en tags staan eronder, en precies één actie staat rechts. **Tijd blokkeren** (het kalenderpictogram rechts) maakt bij een gekoppelde agenda een afspraak voor de taak aan (datum, starttijd, duur, plus de agendakeuze als er meerdere schrijfbaar zijn); **Herhaling** in de metaregel maakt bij het afvinken de volgende taak aan met een nieuwe vervaldatum. Beide worden beschreven onder [Taken](Tasks.md).

## Vandaag

**Vandaag** is het dagoppervlak. De strip bovenaan kiest een dag — hij loopt **in beide richtingen**, twee weken terug en twee weken vooruit, en een stip markeert elke dag die al een dagnotitie heeft. Daaronder staat de **dagnotitie** van de gekozen dag (met sjabloon en map, om te openen of aan te maken), daarna de **afspraken en einddatums** van die dag, en ten slotte wat je die dag hebt bewerkt.

Het middelste gedeelte brengt samen wat anders op twee onderdelen zou staan: eerst de hele-dag-afspraken, dan de afspraken met een tijdstip in chronologische volgorde, en ten slotte de taken die die dag vervallen. Tikken op een taak opent de bijbehorende notitie. Zonder gekoppelde agenda en zonder takendatabase ontbreekt de sectie gewoon.

## Tags

De taglijst staat onder **Notities**. Tikken opent de notities van een tag; de pijl klapt geneste tags open. **Lang drukken** op een tag biedt **Tag hernoemen** — in de hele vault, net als op de desktop: Plainva herschrijft elke notitie die de tag draagt (in de frontmatter en als `#tag` in de tekst, inclusief de `tag/child`-subtags), en vertelt je daarna in hoeveel notities de tag is vervangen. Een notitie die niet gelezen of geschreven kan worden, wordt overgeslagen — de rest wordt toch hernoemd.

## Zoeken en vervangen in de hele vault

De weg erheen is het vergrootglas in de kopregel, daarna `>` en **Zoeken en vervangen in de vault**. Het scherm doorzoekt alle notities tegelijk. Voer een term in, tik **Zoeken** en de treffers verschijnen per notitie gegroepeerd met hun aantal; een tik opent de regels van één notitie, en er blijft er steeds maar één open. Vink notities uit die je wilt overslaan — per notitie, nooit per regel, want een notitie wordt in zijn geheel vervangen of helemaal niet. **Vervangen in N notities** schrijft de rest om, met een voortgangsbalk en een **Annuleren** dat bij de volgende notitie stopt. Elke notitie wordt vlak voor het schrijven opnieuw gelezen, zodat een verouderd voorbeeld nooit nieuwere inhoud overschrijft; een notitie die intussen is gewijzigd wordt overgeslagen en dat wordt gemeld. Hoofdlettergevoelig, heel woord en regex werken hier ook.
## Overzichten (index.md)

In een OKF-kluis is de `index.md` de inhoudsopgave van een map. De telefoon biedt twee ingangen, bedoeld voor twee verschillende momenten.

**Voor het moment waarop het opvalt:** druk een map lang in — het blad biedt **Overzicht maken** als er geen is en **Overzicht bijwerken** als Plainva het bestaande bijhoudt. De regel benoemt dus haar effect in plaats van je te laten kiezen. Heb je de `index.md` van die map zelf geschreven, dan verschijnt de regel helemaal niet: jouw bestand is van jou.

**Voor de opruimronde:** **Instellingen → Vault → Onderhoud → Overzichten** toont elke map met het aantal notities en de status — gesorteerd op *waar iets ontbreekt*, niet alfabetisch, zodat de paar mappen die aandacht vragen niet ondersneeuwen tussen de mappen die in orde zijn. Bovenaan maakt **index.md maken in de N mappen zonder** de ontbrekende in één keer aan. Staat er in een map zonder `index.md` al een overzichtsnotitie (MOC, overzicht, README …), dan kun je die hier **overnemen** — dat hernoemt het bestand en neemt de links kluisbreed mee, en daarom wordt het eerst gevraagd.

**Vanzelf actueel.** Overzichten die Plainva heeft gemaakt dragen een onzichtbare markering. Alleen die bestanden worden bijgehouden — en voortaan houdt de telefoon ze ook bij: maak, verplaats of verwijder notities daar en Plainva schrijft de betrokken overzichten kort daarna opnieuw. Vroeger deed alleen de desktop dat, dus een kluis die op de telefoon werd verzorgd, verouderde stilletjes.

**Alleen-lezen, met een uitweg.** Een bijgehouden overzicht opent als leesweergave met een balk erboven: **Vernieuwen** schrijft het opnieuw, **Toch bewerken** verwijdert de markering — daarna is het bestand helemaal van jou en wordt het niet meer automatisch overschreven. Zonder die bescherming zou de volgende ronde stilletjes over alles heen schrijven wat je erin hebt getypt.


## Naar OKF-formaat omzetten

Een hele vault naar het [OKF-formaat](OKF.md) tillen werkt nu ook vanaf de telefoon: **Instellingen → Vault → Onderhoud → Naar OKF-formaat omzetten**. De wizard scant, laat je het standaard-`type` kiezen, **noemt de betrokken notities** en schrijft pas daarna — elk bestand gaat vóór de wijziging naar de back-upmap.

Omdat een telefoon een lopende app op elk moment mag afsluiten, stopt de run hier bovendien bij het volgende bestand wanneer je op **Pauze** tikt of de app naar de achtergrond gaat. Dat Plainva de volgende keer dat je de vault opent vraagt of een onderbroken run moet worden **voortgezet** of **teruggedraaid**, geldt voor beide apparaten; **Later** is een geldig antwoord, de vraag komt terug en gaat niet verloren.

Een onderbroken run laat een deels omgezette vault achter, geen kapotte: er worden alleen frontmatter-velden toegevoegd, elke notitie blijft geldige Markdown en elke andere editor kan haar nog lezen.

### OKF 0.2 op de telefoon

De velden van [OKF 0.2](OKF.md) — herkomst, controle, status, verouderd-na — worden op de telefoon precies zo gelezen en getoond als op de desktop: de badge **Concept**/**Afgeschaft** in de header van de notitie, de melding **Gemarkeerd als verouderd** boven de notitie, en de sectie **Vertrouwen en herkomst** in de contextkaart van de notitie, met het vertrouwensniveau. **Markeren als gecontroleerd** staat daar ook: het voegt `human:<jouw naam>` toe aan de verified-lijst; Plainva vraagt de naam eenmaal per vault, bewaart hem op het apparaat en laat je hem wijzigen onder **Instellingen → Vault → Inhoud en structuur → Naam van de controleur**. De bundleversie van een vault wordt onder **Instellingen → Vault → Onderhoud → Bundleversie** naar 0.2 getild — met een voorbeeld, een back-up en het selectievakje dat het verouderde `okf_version`-veld uit de notities verwijdert.

## Graaf

De **vault-kaart** toont je vault als nodes en edges. Tikken op een mapbubbel vouwt hem uit, tikken op een notitie opent hem; de chips erboven filteren op notitietype, tag en edge-soort. Sleep een node en **de kaart onthoudt waar je hem hebt neergezet** — de onthouden indeling staat in `.plainva/graph.json` en blijft bewust op dit apparaat, net als de zoekindex.

**Lang drukken** op een node opent het menu ervan: openen (of een map uit-/invouwen), **Focus op selectie** en, als de node is vastgezet, **Losmaken**. Lang drukken op een **edge** noemt beide uiteinden en opent de ene of de andere notitie. Sleep een notitie **op een andere** en Plainva biedt aan ze te **koppelen** — als een tekstlink aan het einde van de notitie, of via een relatie van de bijbehorende database; een relatie die precies één invoer toestaat, vraagt eerst om bevestiging, omdat hij de huidige waarde vervangt. De chip **Selecteren** maakt van slepen op een lege plek een selectierechthoek (een telefoon heeft geen modificatietoets); geselecteerde notities kun je samen verwijderen, via dezelfde bevestiging als bij één losse notitie. **Exporteren als SVG…** geeft de kaart door aan het deelvenster van je apparaat.

Datzelfde opruimen in het klein doet de **graaf in de contextkaart van een notitie**: hij toont de buurt van de geopende notitie en daaronder suggesties voor wat er nog meer bij zou kunnen horen. **Koppelen** plaatst de link op de plek in de tekst — niet aan het einde van de notitie —, en een genegeerde suggestie blijft genegeerd, ook nadat de notitie is gesloten.

De chip **Opruimen** opent de opruimlijst: **wezen** (notities waar niets naar verwijst), **kapotte links** (verwijzingen die nergens naartoe leiden) en **vermeldingen** — plekken waar een notitie wordt genoemd maar niet gelinkt. Je verwijdert een wees via dezelfde bevestiging als overal elders, je maakt de ontbrekende notitie aan voor een kapotte link, en je koppelt een vermelding precies **op de plek van het fragment** in plaats van aan het einde van de notitie. Wat je negeert, blijft genegeerd: het komt bij de volgende ronde niet terug. De scan van vermeldingen leest elke notitie en start daarom pas als jij dat vraagt — en kan op elk moment worden gestopt.

De **focus** kun je ook vanuit het menu van de node instellen: de kaart toont dan alleen nog de buurt tot de diepte die je kiest (1–3). De chip met de diepte heft de focus weer op. Twee andere chips lezen de kaart naar ouderdom: **Warmtekaart** kleurt elke node naar hoe recent hij is gewijzigd, en **Tijdreis** verbergt alles wat nieuwer is dan de schuifregelaar — zo kun je de vault zien groeien.

## Kalender en afspraken

Het onderdeel **Kalender** toont je gekoppelde kalenders in de weergaven **Dag**, **3 dagen** en **Agenda** — hetzelfde accountmodel als op de desktop. Je bereikt het via de navigatiebalk of via **Onderdelen**. Elke dagkolom toont bovenaan zijn **weekdag en datum**, en daaronder een balk voor de **hele-dag-afspraken** van die dag; beide scrollen mee met het rooster in plaats van blijvend ruimte in te nemen. Een tik op een afspraak opent het **afspraakvoorbeeld** als blad — hetzelfde vlak als het zwevende venster op de desktop: tijdvak, locatie, beschrijving, deelnemers met hun antwoorden en, bij een reeks, het ritme met de volgende afspraak. Bij een uitnodiging staan daar **Accepteren**, **Voorlopig** en **Weigeren**, daaronder **Afspraak bewerken**, **Vergadernotitie** en **Afspraak verwijderen**. Naar beneden vegen sluit het blad. Dagnotities staan hier niet — die vind je in **Vandaag**.

**Wanneer de telefoon kijkt.** Op de achtergrond loopt op een telefoon geen klok: de regelmatige synchronisatie staat dus stil zolang de app weg is. Daarom kijkt Plainva uit zichzelf zodra je **terugkeert in de app** en zodra je **Agenda's**, **Taken** of de **Agenda-accounts** opent — hoogstens één keer per minuut, zodat veel heen en weer schakelen geen reeks synchronisaties in gang zet. Bij terugkeer worden meteen ook de **herinneringen opnieuw ingepland**, ook als er niets nieuws bij is gekomen: de klok is immers toch doorgelopen. Wil je niet wachten, dan zijn **Nu verversen** en het naar beneden trekken van de lijst er nog steeds.

Beheer accounts via het tandwielicoon in de afsprakenkalender: verbind **CalDAV** op het apparaat met een app-wachtwoord (bijv. Fastmail, Nextcloud, iCloud); Google en Microsoft volg je via aanmelden in de browser. Per account kun je losse kalenders tonen of verbergen.

Vanuit een afspraak maakt **Vergadernotitie** de bijbehorende notitie aan — dezelfde notitie die ook de desktop vindt: ze blijft aan de afspraak gekoppeld, dus opnieuw aanroepen opent haar weer in plaats van een tweede aan te maken, en ze belandt in de **Vergadermap**. Die map kies je bij de accounts, onder **Agenda-instellingen**, met een **mappenbrowser** in plaats van het pad te typen; daar staat ook de **Standaardagenda** (degene waarin een nieuwe afspraak start); beide horen bij de kluis en reizen mee met de instellingensynchronisatie. Op dezelfde plek kies je, per account, welke **Takenlijsten** worden gespiegeld naar je takendatabase.

**Aanmelden geldt per apparaat.** Wat wordt gesynchroniseerd, zijn je account-*instellingen*, nooit de aanmelding zelf — dat is bewust zo: inloggegevens mogen het apparaat niet verlaten. Een account dat via de instellingensynchronisatie is binnengekomen, verschijnt daarom wel in de lijst, maar draagt de markering **aanmelden**, met eronder een regel die vertelt wat je moet doen. Zolang er geen account op dit apparaat is aangemeld, leggen de agenda en de postbus dat ter plekke uit in plaats van gewoon leeg te blijven, en brengt **Op dit apparaat aanmelden** je naar de accounts. Aangemelde accounts tonen **actief**. Verloopt een aanmelding later of wordt zij ingetrokken, dan staat er **aanmelding verlopen** met de reden erbij — en **Opnieuw aanmelden** zet haar weer in gang zonder het account te verwijderen: hetzelfde account, dezelfde agenda's. Voor Google en Microsoft zoekt Plainva de benodigde app-registratie op het apparaat zelf — bij het account, bij de bestandssynchronisatie van hetzelfde account, of bij een ander account van dezelfde aanbieder. Dat geldt zowel voor **Opnieuw aanmelden** als voor het **toevoegen** van een account: vindt Plainva er een, dan staat er in het formulier **Client-ID overgenomen van dit apparaat** met **Bewerken** ernaast. Alleen wanneer er echt geen is, gaat het formulier open en vraagt erom.

**Een login voor alle diensten — ook hier.** De telefoon biedt dezelfde samenvoeging als de desktop: een account dat nog los per dienst is aangemeld (Microsoft, Google) toont in Cloudaccounts de sectie **Een login voor alle diensten** — één aanmelding voor al zijn diensten, waarna die ene aanmelding elke dienst in leven houdt in plaats van maar één. Het aanbod blijft zolang de gedeelde aanmelding niet alle diensten van het account dekt. Ontbreekt er een dienst, dan bieden de accountgegevens twee uitwegen: **Gedeelde aanmelding opnieuw instellen** laat elke dienst weer zijn eigen aanmelding gebruiken, en **Wizard verlaten** annuleert een verbindingspoging die nooit is afgerond.

**Herinneringen.** Onder **Agenda-instellingen → Herinneringen** zet je **Aan afspraken herinneren** aan; de telefoon vraagt dan eenmalig toestemming voor meldingen. Wat de afspraak zelf aan herinnering meebrengt, geldt — pas als die niets zegt, herinnert Plainva 15 minuten vooraf, en afspraken van een hele dag de avond ervoor om 19:00 uur. Een afspraak die uitdrukkelijk geen herinnering wil, krijgt er ook geen. De komende 14 dagen worden gepland, hoogstens 64 herinneringen vooruit — zoveel staat iOS toe; Plainva vult dat venster bij elke keer openen en na elke agenda-vernieuwing weer aan, en zegt je vanaf wanneer een periode er niet meer in past in plaats van afspraken stilzwijgend te verzwelgen. **De grens die blijft:** de telefoon kan alleen aankondigen wat hij bij de laatste synchronisatie zag — een uitnodiging die tien minuten voor aanvang binnenkomt, bereikt geen melding meer.

**Wat je daarbij instelt.** De **Aanlooptijd** geldt voor afspraken zonder eigen herinnering; **Afspraken van een hele dag** bepaalt op welke avond of ochtend ze zich melden. **Vervallen taken** neemt daarnaast de taken uit je takendatabase mee — met tijd als een afspraak, zonder tijd volgens de regel **Taken zonder tijd** direct eronder, die standaard **op de vervaldag om 09:00** herinnert. **Alleen deze agenda's** beperkt waar herinneringen vandaan komen; kies je niets, dan staat er **Alle**, en een later toegevoegde agenda doet vanzelf mee; het blad blijft open totdat je klaar bent, zodat je meerdere agenda's in één keer aanvinkt. Op de melding zelf liggen twee handelingen: bij een afspraak **Vergadernotitie** (die maakt hem aan of opent de bestaande), bij een taak **Afvinken** — dat rondt hem ter plekke af en maakt bij een terugkerende taak de volgende aan, zonder dat je de app opent. Onder de instellingen zegt een regel bovendien **wat er daadwerkelijk gepland is** — bijvoorbeeld «Gepland: 12 afspraken · 3 taken» — of waarom er niets gepland is, bijvoorbeeld omdat er op dit apparaat geen takendatabase is ingesteld. Valt er nog helemaal niets te kiezen, dan zegt de regel dat in plaats van **Alle** te beweren: **Nog geen agenda’s** wanneer er een account is verbonden maar er nog geen agenda’s zijn binnengekomen — een tik biedt daar **Nu verversen** aan — en **Geen account verbonden** zolang er helemaal geen agenda-account is ingesteld.

## E-mail

Bij **Instellingen → E-mail** verbind je een **Microsoft-postbus** (Outlook.com, Microsoft 365) rechtstreeks via het inloggen in de browser — zonder app-wachtwoord. Net als bij de agenda geldt: inloggen gebeurt per apparaat.

Daarna open je **E-mail** als eigen gebied via het **onderdelenblad** en zet je het desgewenst in de navigatiebalk. De regel onder de titel toont map, ongelezen aantal en account, en opent de mapkiezer. Tik op een bericht om het te lezen; **Opslaan als notitie** plaatst het in de map **Mail** van je kluis (twee keer vastleggen opent dezelfde notitie). Externe afbeeldingen blijven geblokkeerd tot je ze voor dat bericht toestaat — een geladen afbeelding verklapt de afzender wanneer en waar je hebt gelezen. De vier acties — **Beantwoorden**, **Allen beantwoorden**, **Doorsturen** en **Opslaan als notitie** — staan in een verankerde rij langs de onderrand; zolang een bericht open is, treedt de navigatiebalk terug en geeft haar de ruimte.

**IMAP-postbussen werken ook op de telefoon.** Voeg er een toe bij **Instellingen → E-mail**: kies de provider, vul het adres en het app-wachtwoord in, en Plainva vult de servers aan. Staat je provider er niet bij, dan kun je bij **Geavanceerd** zelf de IMAP- en SMTP-server, de poort en een afwijkende gebruikersnaam invullen, en een bestaand account kan later worden bewerkt. Meerdere berichten selecteer je door er een ingedrukt te houden; daarna voegt een tik meer toe. In de gespreksweergave kiest lang indrukken of tikken op de gespreksregel de hele uitwisseling — en elk bericht behoudt zijn eigen map, dus een antwoord uit **Verzonden** wordt daar gemarkeerd.

Een geopend bericht biedt **Beantwoorden**, **Allen beantwoorden** en **Doorsturen**. Een antwoord citeert het origineel onder je tekst; "Allen beantwoorden" neemt bovendien de overige ontvangers mee en laat je eigen adres weg. Bij het **opstellen** voeg je met **Bestand bijvoegen** een bestand uit de kluis toe — op de telefoon is de kluis de opslag die je kunt bereiken, en alles wat op het apparaat binnenkomt (een opgeslagen bijlage, een ingevoegde foto) staat daar al. Elke bijlage krijgt een eigen regel met **Bijlage verwijderen**, zolang het bericht nog niet is verstuurd.

Een bericht dat je bent begonnen hoeft niet verstuurd te worden: **Concept opslaan** plaatst het in de conceptenmap van je account — daar waar elk mailprogramma op die postbus het vindt, niet op een plek die alleen op de telefoon bestaat. Welke map dat is, geeft de server aan; pas als die zwijgt, wordt de naam geraden. In de lijst staan twee schakelaars naast de mapregel: **Ongelezen** beperkt wat op dit moment geladen is (zo blijven de teller en **Meer laden** bereikbaar), terwijl **Gemarkeerd** de server naar alle gemarkeerde berichten in de map vraagt — ook die ver onder de geladen pagina. Bij **Alle postvakken IN** ontbreekt de gemarkeerd-schakelaar met opzet: die zoekopdracht wijst precies één postbus aan.

Vanuit een geopend bericht leiden drie wegen naar de kluis: **Opslaan als notitie**, **→ Taak** in het ⋮-menu (maakt een item aan in je standaard takendatabase — met sjabloon, status en de datum van het bericht) en **+ .eml**, dat bovendien het oorspronkelijke bericht bewaart en er vanuit de notitie naar verwijst. Alle drie zijn verankerd: hetzelfde bericht twee keer vastleggen opent wat er al is. **Verwijderen** staat nu ook in het ⋮-menu in plaats van naast de terugpijl; in de lijst volstaat een veeg. Naar de prullenbak verplaatsen biedt **Ongedaan maken**, omdat het terug te draaien is — definitief verwijderen uit de prullenbak vraagt nog steeds om bevestiging, omdat dat niet kan. En in plaats van meerdere meldingen boven elkaar staat er nu **één** regel: de fout, anders de onbereikbare accounts (vanaf twee, als aantal), anders de melding over de opgeslagen kopie.

Een notitie kun je vanuit haar eigen ⋮-menu versturen: **Notitie per e-mail versturen (mailto)** geeft haar door aan de mail-app van de telefoon — daarvoor heeft Plainva zelf geen account nodig —, terwijl **Verzenden per e-mail** Plainva's eigen opstelvenster opent met onderwerp en tekst.

## Importeren uit een andere app

Onder **Instellingen → Onderhoud → Importeren uit een andere app** haal je notities uit een andere app naar dit apparaat — met dezelfde bronnen als op de desktop.

Je kiest eerst waar het schrijft: in een **submap** van de geopende vault of in een **nieuwe vault** op dit apparaat. De nieuwe vault is de juiste keuze als hier nog niets staat; je geeft er alleen een naam aan, en de hele import maak je ongedaan door hem onder **Meer → Vaults** te verwijderen.

Bronnen die toegang nodig hebben — Notion via de API — vragen in de assistent om een token. Dat geldt voor die ene run en wordt niet bewaard.

De details van elke bron staan in [Importeren uit een andere app](Import.md).

## Synchronisatie

De **Instellingen** (helemaal onderaan **Notities**) leiden via **Actieve vault** naar het vaultbeheer; daar verbind je cloudopslag (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Cloudkluis verbinden** haalt een bestaande cloudkluis naar het apparaat; **Een vault maken** vraagt eerst **Op dit apparaat** of **Bij een onlinedienst** en daarna de startstructuur (leeg of een sjabloon zoals PARA) — bij het online pad volgt daarna het verbinden, de doelmap in de cloud kun je meteen vers aanmaken via **Nieuwe map** in het keuzeblad, en de structuur wordt bij de eerste synchronisatie geüpload. Ook de eerste start biedt dezelfde keuze tussen een bestaande en een nieuwe cloudkluis ("Cloudkluis verbinden"). Elke verbinding krijgt een eigen, gescheiden kluis op het apparaat. De kluispagina toont status, voortgang, openstaande overdrachten en biedt **Kluis exporteren** (een ZIP via het deelvenster).

De kluispagina is ingedeeld naar waar de bedieningselementen voor zijn: bovenaan beantwoordt een **statuskaart** de ene vraag waarmee je deze pagina opent — draait het? (status, laatste run, openstaande overdrachten en interval op één regel). Daaronder genoemde groepen — **Verbinding**, **Inhoud** — en helemaal onderaan, afgezet met een eigen rand, de **Gevarenzone** met **Synchronisatie ontkoppelen** en **Kluis verwijderen**. Vroeger stonden er tot negen identiek ogende knoppen op één rij, met **Verwijderde bestanden herstellen** direct naast **Kluis verwijderen**.

Onder **Inhoud** staat naast **Kluis exporteren** nu ook de **automatische vault-back-up**: eenmaal per dag een ZIP van de hele kluis, waarvan de laatste **zeven** worden bewaard (**Te bewaren back-ups**); **Nu back-uppen** maakt er meteen een. De archieven staan in de documenten van het apparaat, niet in de cache — iets wat het besturingssysteem op elk moment mag leegmaken, is geen archief. Een telefoon krijgt geen achtergrondwekker: de controle gebeurt bij het openen en telkens wanneer je terugkeert naar de app, dus haalt de back-up dat in plaats van op een vast tijdstip te draaien. De regel onder de schakelaar geeft daarom aan wanneer de laatste back-up is gemaakt — zo wordt een back-up die stilletjes nooit plaatsvindt, alsnog zichtbaar. Tot nu toe had mobiel alleen de handmatige export — een kluis waarvan niemand aan exporteren dacht, had daardoor helemaal geen archief.

Hoe vaak deze kluis op wijzigingen op afstand controleert stel je op dezelfde pagina in (**synchronisatie-interval**, minstens 5 seconden) — lokaal opgeslagen wijzigingen gaan sowieso meteen omhoog. Bij Google Drive, OneDrive, Dropbox en S3 kun je de **cloudmap** ook achteraf wijzigen; bij WebDAV zit de map in het serveradres, daar maak je in plaats daarvan opnieuw verbinding. Is de instellingen-sync versleuteld, dan kun je bovendien **Bij elke start om de wachtwoordzin vragen** aanzetten: de sleutel wordt dan niet op het apparaat bewaard. En **Beveiliging en delen** zegt nu ronduit dat versleutelde workspaces experimenteel zijn en nog niet onafhankelijk zijn beoordeeld — bewaar je herstelbestand en -code op een veilige plek.

De vaultpagina vermeldt ook of je **instellingen** meereizen — als kaart met een duidelijke status in plaats van een kale knop:

- **worden niet gesynchroniseerd**: de instellingensynchronisatie staat uit voor deze vault. Zet hem aan op de desktop.
- **Nog niet versleuteld**: deze vault heeft nog geen synchronisatiewachtwoordzin. Je kunt er nu **op de telefoon** een instellen: de wizard toont de herstelcode en laat je twee willekeurig gekozen groepen ervan terugtypen voordat er ook maar iets wordt weggeschreven. Bestaat er al een wachtwoordzin in de cloud, dan meldt de telefoon dat en maakt er nooit een tweede aan — dat zou alle andere apparaten buitensluiten.
- **Nog niet ontgrendeld op dit apparaat**: je instellingen staan versleuteld opgeslagen in de cloud. Voer de wachtwoordzin in die bij het instellen is gekozen — op de desktop of hier, op de telefoon; dit apparaat ontgrendelt ze daarmee eenmalig.
- **worden gesynchroniseerd**: dit apparaat is ontgrendeld; mappen, weergaven en back-upregels blijven synchroon met je andere apparaten.

Elke kaart vermeldt ook wat *niet* meereist: aanmeldingen blijven altijd op het apparaat (zie [Kalender en afspraken](#kalender-en-afspraken)).

**Instellingen** → **Beveiliging en delen** noemt wat de verbinding werkelijk is — en bij een gewone cloudkluis stelt het de versleutelde werkruimte direct op de telefoon in (identiteit → herstelbestand en code → activering). Zonder cloudverbinding is er niets te versleutelen, en dat staat er ook.

Beide instellingen — de versleutelde werkruimte en de synchronisatiewachtwoordzin — verlopen nu als **een eigen traject, zonder navigatiebalk**: zolang een ervan open staat, is er precies één uitweg, en die vraagt eerst om bevestiging. Dat is geen versiering. Tot de laatste stap bestaat je sleutel alleen in het geheugen, en verlaten verwerpt hem; voorheen kon een tik op de balk dat zonder iets te zeggen doen. De laatste stap toont een voortgangsbalk zodra er iets te tellen valt — de werkruimte versleutelt elk bestand opnieuw, terwijl de synchronisatiewachtwoordzin twee schrijfacties is, en voor die laatste een percentage verzinnen zou een leugen in balkvorm zijn.

**Deelrechten beheer je nu hier**, niet meer alleen op de desktop: onder **Personen en rechten** nodig je een lid met een rol uit (**Uitnodigen** maakt het aan — het apparaat koppel je daarna), maak je een groep aan en wijzig je de rol van een groep direct in de regel zelf. Onder **Slices** maak je een deelrecht voor een **Map**. Bewust niet op de telefoon: slices op basis van een vrije selectie of een dynamische regel — beide zouden schermen vereisen die hier niet bestaan.

## Vangnet

Snapshots (versiegeschiedenis), een conceptlogboek (na een crash biedt de notitie je laatste niet-opgeslagen staat aan) en conflictkopieën met een vergelijkingsweergave beschermen je gegevens. De bewaartermijn stel je in bij **Instellingen** → **Backup & versiegeschiedenis**.

**Wijzigt iemand dezelfde notitie elders** terwijl jij hier typt, dan bewaart Plainva jouw versie als kopie ernaast en neemt de binnengekomen versie over. Dat staat nu **bij de notitie** en blijft daar tot je het oplost: een melding boven de tekst noemt het pad van de kopie, opent die en toont desgewenst de **verschillen**. Voorheen was het een melding die na seconden verdween — en het opslaan bleef het proberen, zodat elke ronde nog een kopie schreef. Nu ontstaat er precies één.

**Als je een map verwijdert**, noemt het dialoogvenster hoeveel bestanden erin zitten — het aantal staat ook op de knop. Plainva maakt eerst van elk bestand daarin een snapshot, die je terughaalt onder **Instellingen** → **Onderhoud** → **Verwijderde bestanden herstellen**. Het noemt daarbij ook één grens openlijk: **alleen wat deze telefoon al minstens één keer heeft geschreven, kan worden bewaard.** Een notitie die alleen via synchronisatie is binnengekomen en hier nooit is bewerkt, staat in geen enkele snapshot. Anders dan op de desktop heeft een telefoon geen prullenbak van het besturingssysteem die dat opvangt. Raakt de verwijdering meer dan tien bestanden, of meer dan een vijfde van de vault, dan vraagt Plainva een tweede keer — precies zoals op de desktop.

## Delen en snelkoppelingen

Op Android en iOS worden gedeelde tekst en URL's een nieuwe notitie in de inbox-map; gedeelde afbeeldingen en bestanden worden overgenomen als bijlage (maximaal 25 MB per bestand). Houd op Android het app-pictogram ingedrukt voor de extra snelkoppelingen **Nieuwe notitie** en **Vandaag**.

## Mappen, foto’s en agenda

De zwevende knop **Plus** blijft beschikbaar in geneste mappen, en elke snelle-aanmaakactie maakt aan in de map die je open hebt staan — nieuwe mappen inbegrepen. De ⋮ in de kopbalk hoort daarentegen bij het object dat open staat: hij toont de acties van dat object, nooit de app-instellingen.

De fotoknop van de editor biedt **Foto maken** of **Uit fotobibliotheek kiezen**, behoudt de invoegpositie en toont toestemmings- of bestandsfouten duidelijk zichtbaar. Foto's komen terecht in de bijlagenmap van de kluis — dezelfde die je computer gebruikt.

Afspraken en dagnotities zijn bewust gescheiden: **Kalender** toont de gekoppelde kalenders (zie [Kalender en afspraken](#kalender-en-afspraken)), **Vandaag** toont de dagnotitie van een gekozen dag. Er is geen lokaal maandoverzicht van dagnotities — de strip in **Vandaag** doet dat werk.

## Bijlagen en afbeeldingen

Naast notities en databases toont de navigator nu ook **bijlagen** — afbeeldingen, pdf’s, alles wat verder in de map ligt. Een afbeelding opent in Plainva; de rest geeft de app door aan het systeem, dat weet wat een pdf is en Plainva niet. Via **Delen** gaat een bestand naar elke andere app.

In het ⋮-menu van een notitie staat **Exporteren als Markdown…**: dat geeft het bestand zelf aan het deelvenster van het systeem, waar je Afdrukken, ‘Bewaar in Bestanden’ en elke geïnstalleerde editor vindt. **Delen** daarboven verstuurt alleen de tekst van de notitie.

## Vegen

**Veeg een regel naar links** om de acties te tonen: **Bladwijzer** en **Verwijderen** bij een notitie, **Naam wijzigen** en **Map verwijderen** bij een map, **Verwijderen** bij een database en in de postbus. Het zijn dezelfde acties die de regel ook in haar menu biedt (lang drukken) — vegen is alleen de kortere weg ernaartoe, nooit de enige. De eerste keer meldt een balk boven de lijst dat; je tikt hem weg, en hij verschijnt precies één keer per vault.

Verwijderen vraagt via hetzelfde dialoogvenster als overal elders om bevestiging. Terwijl je meerdere regels selecteert, staat vegen uit — een gebaar dat precies één regel betekent, heeft naast een selectie die je nog aan het samenstellen bent geen eenduidige betekenis. Staan **gesprekken** in de postbus aan, dan geldt een veeg op een gesprek voor het **hele** gesprek (in plaats van ongedaan maken vertelt hij je daarna hoeveel berichten het waren); een uitgeklapt los bericht veeg je nog steeds apart. Taakregels hebben geen veegacties — ze dragen hun bedieningselementen zichtbaar op de regel.

## Op brede schermen

De app volgt de vensterbreedte, niet de naam van het apparaat:

- **onder 600 px** — het ene oppervlak na het andere, zoals op de telefoon.
- **600 tot 839 px** — de navigatiebalk wordt een **balk aan de zijkant**; het blijft één oppervlak.
- **vanaf 840 px** — navigator en werkoppervlak staan **naast elkaar**. Het is dezelfde navigator als het onderdeel **Notities**, alleen naast je werk in plaats van ervoor.

**De balk aan de zijkant toont alle onderdelen.** Op een telefoon biedt de onderbalk drie tot vijf bestemmingen — meer haalt een duim niet betrouwbaar, dus de rest zit achter **Onderdelen**. Langs de rand van een breed oppervlak geldt die grens niet: de **hele** lijst staat daar in jouw volgorde (**Instellingen → Navigatiebalk**), de omweg via **Onderdelen** vervalt, en **Instellingen** staat helemaal onderaan. De balk begint onder de statusbalk — op een tablet met een camera-uitsparing zat het eerste icoon daar voorheen onder.

**De navigator klapt weg.** Terwijl je een notitie zoekt, hoort de linkerkolom bij haar; terwijl je er een schrijft, hoort hij bij de notitie. Het icoon onderaan de balk — net boven **Instellingen** — klapt hem weg en weer open, waarna het werkoppervlak de volle breedte inneemt. De schakelaar verschijnt alleen waar er sowieso een tweede kolom is (vanaf 840 px), geldt voor dit apparaat en zijn stand overleeft een herstart. Op de desktop is het dezelfde beweging — daar heet de schakelaar **Linkerzijbalk tonen/verbergen**.

Op een tablet, of een groot omgedraaid gehouden telefoon, krijg je hetzelfde ruimtelijke model als op de desktop — links navigeren, in het midden werken — in plaats van een opgeblazen telefoon.


## Databases in de agenda

Boven de agendaweergaven staat een rij chips: elke `.base`-weergave van het type **agenda** of **tijdlijn** die een datumkolom noemt, kan daar getoond worden. Getoonde items verschijnen tussen de afspraken in de dag- en agendalijst — met een **ruit en streepjesrand**, zodat een notitie er nooit uitziet als een afspraak; in het maandraster als **holle stip**. Eén tik opent de notitie.

**De keuze hoort bij de kluis**, niet bij het apparaat: wat je op de computer toont, staat hier zodra de instellingensynchronisatie is gelopen. Op de telefoon plan je via het blad van het item — slepen blijft aan de computer.

Andersom kan de agendaweergave van een database het **aantal echte afspraken** van een dag in de hoek van de cel tonen — je ziet waartegen je plant.
