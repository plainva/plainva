# AI-assistent (Beta)

Laatst bijgewerkt: 2026-10-07

Plainva kan vragen over je notities beantwoorden met een AI-model van jouw keuze. Het leest je vault, noemt de notities waarop het zich baseert, opent notities en weergaven voor je en stelt wijzigingen aan een geselecteerde passage voor als voorstellen — een notitie verandert het nooit zelf. De assistent is **experimenteel** en staat uit totdat je hem inschakelt, apart op elk apparaat.

## Inschakelen

Open **Instellingen → AI & automatisering** (het App-deel) en zet **AI op dit apparaat gebruiken** aan. Zonder de schakelaar is er geen AI-knop, geen AI-tabblad en geen begeleider. Er wordt pas iets verzonden zodra je iets vraagt.

## Een provider kiezen

Plainva brengt geen eigen AI-dienst mee: je gebruikt een provider van jouw keuze, met je eigen sleutel. Elke provider is te kiezen; Plainva noemt hun voorwaarden en bewaartermijn, zodat jij beslist — het sluit er geen enkele uit.

| Soort | Providers |
|---|---|
| Cloudproviders | Anthropic, OpenAI, Google Gemini |
| Gateways en eigen servers | OpenRouter, elke **OpenAI-compatibele server** |
| Op deze computer (desktop) | Ollama, LM Studio |
| Op deze telefoon | Apple (iPhone), Gemini Nano (Android) |

1. Kies in **AI & automatisering** voor **Provider toevoegen** en kies er een. Elk item draagt een korte opmerking over de voorwaarden — bijvoorbeeld dat bij de gratis toegang van Google mensen je invoer kunnen lezen.
2. Voer de sleutel in met **Sleutel invoeren**. De sleutel gaat naar de beveiligde opslag van dit apparaat; Plainva toont hem nooit meer — niet aan de AI en niet op het scherm.
3. **Verbinding testen** laadt de eigen modellijst van de provider. Mislukt dit, dan vermeldt de melding waarom (een geweigerde sleutel, geen verbinding, een onbekend model).

Een **OpenAI-compatibele server** voeg je toe via het adres ervan. Plainva vraagt vlak voor het toevoegen nog een keer om bevestiging, in een venster van het besturingssysteem, en verzendt alleen naar het adres dat je hebt bevestigd. Onversleuteld `http` werkt alleen voor een server op dit apparaat; voor al het andere is `https` nodig.

Heb je nog geen sleutel: een model op deze computer (Ollama, LM Studio) kost niets, en de console van elke provider geeft sleutels uit.

**Het model van het systeem op de telefoon.** Op een iPhone met Apple Intelligence (vanaf iPhone 15 Pro) biedt **Provider toevoegen** eerst **Apple** aan, op sommige Android-telefoons **Gemini Nano**. Het heeft geen sleutel nodig, kost niets en er verlaat niets het apparaat — daarom vraagt geen overzicht vóór het verzenden. Het venster is klein, ongeveer 4.000 tokens voor notities, vraag en antwoord samen: er gaan minder notities mee, eerdere beurten worden ingekort en het gebruikt geen hulpmiddelen. De regel zegt of het klaar is en zo niet, waarom — Apple Intelligence uit, een apparaat dat het niet kan draaien, een model dat het systeem nog voorbereidt; op Android vraagt **Model laden** het systeem om het te downloaden. Het model van Apple spreekt niet elke taal (geen Pools). Noemt het profiel **Lokaal** het, dan schrijft het op de telefoon ook de samenvattingen.

## Modellen en profielen

Vier profielen — **Snel**, **Gebalanceerd**, **Sterk** en **Lokaal** — zijn jouw toewijzing van modellen. Kies voor elk een provider en een model, uit de lijst van de provider of door de model-ID precies zo in te typen als de provider die noemt. **Standaard voor nieuwe gesprekken** bepaalt met welk profiel een nieuw gesprek begint. Plainva noemt geen enkel model “het beste”.

Een vijfde plek, **Audio**, bevat het model dat spraaknotities uitschrijft; het is nooit de standaard voor een gesprek.

Een zesde plek, **Embeddings**, bevat het model waarmee zoeken op betekenis rekent als je onder **Semantisch zoeken** **Eigen provider** kiest — zie [Zoeken](Search.md).

## Vragen

- **Desktop:** de AI-knop in de actiebalk, **Ctrl+J** (⌘J onder macOS) of **AI vragen** in het opdrachtenpalet opent de begeleider — een klein venster boven je werk. **Als tabblad openen** verplaatst hetzelfde gesprek naar het AI-tabblad, waar je gesprekken staan vermeld.
- **Telefoon:** **AI vragen** in het ⋮-menu van een notitie opent het AI-blad over die notitie. Het onderdeel **AI** (in het onderdelenblad, of in de navigatiebalk als je het daar neerzet) toont het gesprek op volledig scherm; **Gesprekken** toont de eerdere gesprekken.
- **Naast de notitie:** op de desktop is hetzelfde gesprek de laatste sectie van de rechterzijbalk, **AI**. Op een telefoon of tablet is het het tabblad **AI** in de context van de notitie — naast **Eigenschappen** en **Backlinks** —, die een tablet naast de notitie toont.

De notitie die je open hebt staan, gaat automatisch mee; verwijder haar met het kruisje ✕ uit de context als je wilt. **Notitie vastzetten…** voegt nog meer notities toe. De assistent kan ook zelf dingen opzoeken: hij doorzoekt de vault, leest notities en de secties ervan, databases, backlinks en gelinkte notities, somt taken, afspraken en de onlangs geopende of gewijzigde notities op en opent notities en weergaven. Hij kan niets veranderen, aanmaken of verwijderen.

De assistent kan je ook dingen laten zien: een notitie openen bij een kop, een notitie in de graaf tonen, de kalender op een dag zetten, weergaven openen, de zijbalken tonen en verbergen. Hij gebruikt daarvoor de opdrachten van het opdrachtenpalet — en daarvan alleen die iets tonen: wat iets aanmaakt, wijzigt, verwijdert, exporteert of een venster opent, kan hij niet in gang zetten.

Elk gesprek begint met de regel “Antwoorden worden geschreven door een AI — ⟨model⟩ via ⟨provider⟩”. Onder elk antwoord staat een regel die zegt wat waarheen is verzonden: hoeveel notities, ongeveer hoeveel tokens en — waar de provider prijzen publiceert — de geschatte kosten. **Stoppen** beëindigt een antwoord op elk moment.

Een link in een antwoord opent pas nadat je het adres ervan hebt bevestigd, en afbeeldingen in antwoorden worden nooit geladen.

## Wat er meegaat

Bij elke vraag stelt Plainva samen wat ertoe kan doen — op dit apparaat, voordat er iets wordt verzonden:

- **Waar je bent:** datum en tijd, de notitie of database die je open hebt en je selectie daarin, je open tabbladen, taken die in de komende week vervallen, de volgende afspraken en de dagnotitie van vandaag.
- **Notities die ertoe kunnen doen:** gevonden via je woorden, de links van de open notitie en wat je onlangs hebt geopend of gewijzigd. Eerst beslissen je privacyregels; alleen de notities die zij toestaan, worden überhaupt beoordeeld. Een paar gaan mee als secties — niet als hele notities —, andere alleen met hun titel en een kaart — de eerste zin van hun sectie en elke zin met getallen, datums, taken, ontkenningen of links, woord voor woord — of alleen met hun naam; de assistent leest er meer van als hij dat nodig heeft.

Een notitie die het gesprek al bevat en die sindsdien niet is veranderd, wordt genoemd, niet opnieuw verzonden. Plaatsen uit je journaal en stemmingswaarden worden nooit uit zichzelf verzonden.

## Voordat er iets wordt verzonden

Het eerste verzoek van een sessie toont een overzicht: waar het heen gaat (provider en model), welke notities en welk deel ervan, wat er verder meegaat (je selectie, afspraken, taken), wat is achtergehouden en ongeveer hoeveel tokens. **Verzenden** verzendt het; **Annuleren** verzendt niets en geeft je woorden terug in het invoerveld; de − naast een notitie laat haar weg. Binnen wat je hebt goedgekeurd, gaan de volgende verzoeken zonder vraag. Het overzicht komt terug zodra de reikwijdte groeit: een ander model of een andere provider, een nieuw soort gegevens, notities uit een andere map, nieuwe hulpmiddelen of een veel groter verzoek. Een model op dit apparaat vraagt nooit.

Wil je het overzicht vóór elk verzoek zien, zet dan **Vragen vóór elk verzoek** aan — in het overzicht zelf of in **Instellingen → AI & automatisering** onder **Verzenden**.

De regel onder elk antwoord opent het overzicht van wat ermee meeging. Noemt een antwoord geen van de verzonden notities, dan zegt een melding boven die regel dat; controleer het antwoord dan aan de notities. Gingen er notities mee, dan noemt de regel ook de dekking: **dekking hoog** als bijna elke uitspraak van het antwoord een notitie noemt, **dekking gedeeltelijk** of **dekking laag** als dat er minder zijn.

## Context bekijken

Het oog onder het invoerveld, **Context bekijken**, toont wat het volgende verzoek zou meenemen — voordat het gaat, voor het model dat nu is gekozen. Bij elke notitie: waarom ze is gekozen (nu open, vastgezet, past bij je woorden, verwant in betekenis, gelinkt, binnenkort …), welk deel meegaat en ongeveer hoeveel tokens. Elke notitie kun je

- weglaten uit het volgende verzoek (**Weer opnemen** haalt haar terug),
- aan het gesprek vastzetten,
- voorgoed op dit apparaat houden: dat schrijft de regel `cloud: deny` in de notitie (zie hieronder).

Notities die je regels achterhouden, staan er ook, zodat je weet wat er ontbreekt; ze worden nooit beoordeeld en nooit verzonden. **Met deze context verzenden** verzendt wat je hebt getypt. In een breed AI-tabblad blijft de weergave als kolom naast het gesprek open.

Boven de notities zegt **Verstuurd** hoeveel van deze notities meegaat — bijvoorbeeld ~870 van 3.460 tokens — en **Bespaard** hoeveel minder dat is dan elke voorgestelde notitie helemaal te versturen; de eerste keer staat er ook bij hoeveel tokens dat zou zijn geweest. **Als spoor in de graaf tonen** opent de graaf met de open notitie en de bronnen gemarkeerd, en de links ertussen.

Lijkt de tekst die naar een cloud zou gaan een wachtwoord of sleutel, een rekening- of kaartnummer, een identiteits- of fiscaal nummer of gezondheidsgegevens te bevatten, dan staat onder de notitie **Mogelijk gevoelig** en wat er herkend is — in **Context bekijken** en in het overzicht vóór het verzenden. **Op dit apparaat houden** schrijft de regel `cloud: deny` in de notitie. Nummers en geheimen vervangt **In dit gesprek weglakken** door een plaatshouder zoals `⟦withheld account⟧` in elk bericht van dit gesprek, ook als het model de notitie zelf leest, totdat je **Zonder weglakken versturen** kiest; het overzicht telt ze onder **Achtergehouden**. Taken en afspraken hebben dezelfde keuze in de regel **Taken, afspraken en gegevens van de open notitie**. Zou in een sessie voor het eerst iets van zo'n soort onweggelakt meegaan, dan vraagt het overzicht vóór het verzenden. De controle gebeurt op dit apparaat; het is een hint, geen filter: ze kan iets missen en houdt nooit een verzoek tegen. Een geselecteerde passage gaat zoals ze is; bij een model op dit apparaat verschijnt geen hint.

## Samenvattingen

Met **Samenvattingen met het lokale model** (onder **Instellingen → AI & automatisering**, uit totdat je het aanzet) schrijft een model op je computer korte samenvattingen van de lange secties van je notities, van hele notities, van de mappen op het hoogste niveau en van de vault. Het werkt alleen als het profiel **Lokaal** een server op deze computer noemt (Ollama, LM Studio; op de telefoon het model van het systeem) — nooit een cloud op de achtergrond — en alleen terwijl Plainva niets anders te doen heeft; op de telefoon alleen zolang die open is. Elke samenvatting wordt gecontroleerd: de samenvatting van een sectie moet elk getal, elke datum, elk bedrag, elke link, tag en ontkenning woordelijk behouden, anders gaan de zinnen van de sectie zelf. Een samenvatting is gebonden aan precies de tekst waarvoor ze staat; wijzig je de sectie, dan wordt ze niet gebruikt totdat ze opnieuw is geschreven. Samenvattingen van mappen en van de vault ontstaan alleen uit notities die je regels naar een cloud laten gaan. In **Context bekijken** zegt een bron die als samenvatting ging dat, en **Origineel** stuurt bij het volgende bericht haar eigen zinnen.

## Met een selectie

Selecteer tekst in een notitie, en de AI werkt alleen met die passage.

- **Desktop:** tijdens het bewerken biedt **AI** in de selectiebalk **Als voorstel** — **Herschrijven**, **Inkorten**, **Vertalen…**, **Taken ervan maken** — en **In de begeleider** — **Uitleggen** en **Vraag over de selectie…** (**Ctrl+J**, ⌘J onder macOS).
- **Telefoon:** **AI** in de balk boven een selectie — bij lezen en bij bewerken — opent het AI-blad.
- **In elk gesprek:** zolang er in de geopende notitie tekst is geselecteerd, biedt de rij **Met de selectie** boven de invoer dezelfde acties.

Een voorstelactie verzendt alleen de geselecteerde passage — niet de rest van de notitie, geen vastgezette notities, geen tools — en vraagt met hetzelfde overzicht als een vraag. Het antwoord komt als een ronde voorstellen in de notitie, net als die van een persoon: onder **Voorstellen** accepteer of wijs je elke wijziging of de hele ronde af, en daarvoor verandert er niets in de notitie. De auteursregel van de ronde luidt **Plainva AI · ⟨model⟩**, zodat zichtbaar blijft welke passage een AI schreef. **Taken ervan maken** zet de taken onder de passage in plaats van die te vervangen. Elke actie bewaart haar gesprek in de geschiedenis.

Een passage uit een notitie die je regels bij de cloud weghouden — of een met links naar zulke notities of met plaatsgegevens — gaat naar geen enkel cloudmodel. In een versleutelde workspace zijn de voorstelacties nog niet beschikbaar: de voorstellen daarin kunnen de AI nog niet als auteur noemen.

## In een draad met opmerkingen

Spreek de assistent aan in een opmerking, en hij antwoordt in de draad. Typ een **@** in het opmerkingsveld en kies **AI** — het item met het AI-teken — of schrijf de naam zelf: **@AI**, **@KI** en **@IA** bereiken hem allemaal, in welke taal de app ook staat. Zodra je opmerking is verzonden, toont de draad onder **AI** de regel **schrijft een antwoord…**; **Stoppen** beëindigt dat. Het antwoord verschijnt als antwoord in dezelfde draad, met de auteursregel **Plainva AI · ⟨model⟩**. Anders dan een voorstel wacht het niet tot het wordt geaccepteerd — het is een aantekening naast de notitie, nooit tekst erin — en op het apparaat dat de vraag stelde verwijder je het zoals een eigen opmerking.

De draad gaat naar het model zoals een vraag: de opmerkingen erin, de passage waaraan hij hangt en de notitie zelf, via hetzelfde overzicht. Een draad met opmerkingen is een eigen soort gegevens, dus het overzicht vraagt het de eerste keer. Waar je regels de notitie weghouden van de cloud, gaan ook haar opmerkingen daar niet heen, en links daarin naar zulke notities worden achtergehouden. Alleen een opmerking die je op dit apparaat verzendt, roept de assistent; een opmerking die via synchronisatie binnenkomt doet dat nooit, wat er ook in staat. Webadressen die de AI zelf meebrengt — in een antwoord, een voorstel of een transcriptie — worden zo geschreven dat niets ze opent of laadt (`https[://]…`); adressen die je eigen tekst al bevatte, blijven zoals ze zijn. In een versleutelde workspace kun je de assistent nog niet aanspreken: de opmerkingen daarin kunnen de AI nog niet als auteur noemen.

## Vaardigheden

Vaardigheden zijn instructies voor terugkerend werk. Twaalf komen met Plainva mee — waaronder **Dagoriëntatie**, **Weekoverzicht** en **Projectstatus** als chips in een leeg gesprek — en je kunt je eigen schrijven of importeren. Start er een met één klik, of vraag het gewoon: de AI laadt zelf een passende vaardigheid. Je eigen vaardigheden draaien pas nadat je ze op dit apparaat hebt goedgekeurd. Alles erover: [Vaardigheden](AI_Skills.md).

## Een spraaknotitie uitschrijven

Bij elke spraaknotitie — in de editor, in de leesmodus, in het journaal en op kaarten — maakt **Uitschrijven** van de opname tekst. Die gaat ongewijzigd naar het model van het profiel **Audio**, via hetzelfde overzicht als een vraag; een opname is een eigen soort gegevens, dus het overzicht vraagt het de eerste keer. De transcriptie komt terug als voorstel onder de opname, met de auteur **Plainva AI · ⟨model⟩** — accepteer of wijs haar af onder **Voorstellen**.

**Audio** vereist een provider met een audioroute: OpenAI (bijvoorbeeld `gpt-4o-transcribe` of `whisper-1`), Gemini of een eigen compatibele server — een server op deze computer houdt de opname op het apparaat. Opnamen tot 11 MB kunnen worden uitgeschreven. Een opname in een notitie die je regels bij de cloud weghouden, gaat naar geen enkel cloudmodel, en versleutelde workspaces bieden het nog niet aan.

## Een afbeelding uitleggen

Bij elke afbeelding in de vault vraagt **Afbeelding uitleggen** de AI wat erop te zien is.

- **Desktop:** in de werkbalk van een geopende afbeelding en in het menu dat een rechtsklik op een afbeelding in een notitie opent — tijdens het bewerken en in de leesmodus.
- **Telefoon:** onder een geopende afbeelding (bij een afbeelding in een notitie brengt **Afbeelding openen** je erheen).

De afbeelding gaat, met de vraag, naar het model waarmee nieuwe gesprekken beginnen — in een eigen gesprek, waarin je verder kunt vragen: wat een tabel zegt, wat er in de tweede kolom staat, wat een diagram betekent. Het overzicht toont de afbeelding voordat ze wordt verzonden; een afbeelding is een eigen soort gegevens, dus het overzicht vraagt het de eerste keer.

**Wat meegaat is niet het bestand.** Plainva tekent de afbeelding, verkleint haar tot hooguit 1.568 pixels aan de langste zijde en slaat haar opnieuw op om te verzenden. Zo gaat ze zonder wat het bestand erover vastlegt: de plaats waar een foto is genomen, de datum, de camera. Het overzicht toont precies de afbeelding die meegaat, met haar grootte. Die kopie blijft bij het gesprek op dit apparaat, zodat je later nog kunt zien wat de provider heeft gekregen; verwijder je het gesprek, dan is ze weg.

**Regels.** Een afbeelding in een map die je regels bij de cloud weghouden, gaat naar geen enkel cloudmodel. Dat geldt ook voor een afbeelding die in een notitie met de regel `cloud: deny` staat — waar je ook op **Afbeelding uitleggen** drukt, ook bij de geopende afbeelding: voordat ze wordt verzonden, zoekt Plainva uit welke notities de afbeelding insluiten, en als dat niet te achterhalen is, blijft de afbeelding hier. Een model op dit apparaat blijft toegestaan. Wat er in een afbeelding geschreven staat, is inhoud, net als de tekst van een notitie, nooit een instructie: het gesprek van **Afbeelding uitleggen** kan dingen opzoeken in je vault, maar kan internet niet gebruiken en zet in de app niets in gang.

**Welke modellen afbeeldingen lezen.** De meeste cloudmodellen doen dat. Het model van het systeem op de telefoon niet, en **Afbeelding uitleggen** zegt dat. Zegt de lijst van een provider dat een model geen afbeeldingen leest, dan vertelt het overzicht je dat voordat je verzendt. Wijst een provider het verzoek af, kies dan onder het gesprek een ander model en vraag het opnieuw — de afbeelding zit er nog in.

## Op internet

De assistent kan internet pas gebruiken als jij dat toestaat — en wel drie keer:

1. **Voor de vault.** Zet in **Instellingen → AI & automatisering** (het Vault-deel) **De AI mag internet gebruiken in deze vault** aan. De schakelaar staat voor elke vault uit totdat je beslist, en geldt alleen op dit apparaat.
2. **Voor een gesprek.** Druk vóór het eerste bericht van een nieuw gesprek op de wereldbol onder het invoerveld — **Laat dit gesprek internet gebruiken**. Of een gesprek internet mag gebruiken, wordt bepaald wanneer het begint; om dat te wijzigen begin je een nieuw gesprek. Een gesprek dat het mag, zegt dat in zijn eerste regel. De vaardigheid **Onderzoek** starten is dezelfde keuze: haar gesprek mag internet gebruiken — zie [Vaardigheden](AI_Skills.md).
3. **Voor elk verzoek.** Zolang je notities in het gesprek zitten, vraagt elke pagina die de assistent wil lezen en elke zoekopdracht die hij wil doen eerst, met het volledige adres of de zoekwoorden — dat is alles wat daarvoor je apparaat verlaat. **Pagina lezen** of **Zoeken** laat dit ene verzoek door; **Niet lezen** of **Niet zoeken** laat het achterwege, en de assistent gaat zonder verder.

**Wat een verzoek is.** Een pagina lezen is één verzoek van dit apparaat aan de website, zoals het openen van de pagina in een browser — zonder cookies, zonder inlog en zonder iets uit je notities; zoals bij elk bezoek ziet de website je IP-adres. Alleen openbare pagina's via `https` worden gelezen; adressen in je thuis- of bedrijfsnetwerk worden geweigerd. Een zoekopdracht gaat naar de provider van je model — Anthropic, OpenAI, Google Gemini of OpenRouter —, die precies zoekt met de woorden die je te zien kreeg; providers kunnen zoekopdrachten apart in rekening brengen. Een model op dit apparaat kan pagina's lezen maar niet zoeken, en het model van het systeem op de telefoon kan helemaal geen internet gebruiken.

**Waar een adres vandaan komt.** De vraag zegt of jij het adres hebt genoemd, of een notitie of een resultaat het heeft genoemd — of dat het model het zelf heeft samengesteld. Een adres dat het model heeft samengesteld, kan iets uit je notities bevatten: lees het voordat je het doorlaat.

**Websites zonder bevestiging.** Met **Altijd voor ⟨website⟩** in een vraag, of onder **Websites zonder bevestiging** in de instellingen van de vault, worden pagina's van een website gelezen zonder eerst te vragen — zolang het adres door jou, een notitie of een resultaat is genoemd. Een adres dat het model heeft samengesteld, vraagt altijd.

**Wat de assistent leest.** Nooit de pagina zelf. Een tweede verzoek aan hetzelfde model, een verzoek zonder hulpmiddelen, leest de pagina en schrijft een kort verslag: een samenvatting, uitspraken met de passage waarop ze berusten, en links die echt op de pagina staan. Een pagina die de assistent instructies probeert te geven, bereikt hem dus als verslag over een pagina — nooit als pagina waarmee hij werkt. Onder het antwoord toont **Gelezen op het web** de pagina's die zijn gelezen, en de regel eronder opent alles wat is opgevraagd.

**Notities die erbuiten blijven.** Een notitie of map met **Webtoegang: nooit** (zie Privacyregels hieronder) bestaat niet voor een gesprek dat internet mag gebruiken: niet in de context, niet voor de hulpmiddelen, en links ernaartoe worden achtergehouden.

Een link in een antwoord waarvan het model het adres zelf heeft samengesteld, is gemarkeerd, en de vraag voordat hij opent, zegt dat. Komt er helemaal geen antwoord terug — geen verbinding, de provider reageert niet —, dan toont het gesprek in plaats daarvan de notities die het best bij je vraag passen.

## E-mail en afspraken

**Afspraken.** De assistent somt afspraken uit je verbonden agenda's op — dag, tijd en titel, op verzoek ook de locatie en wie er deelneemt — en leest één afspraak in detail: de organisator, de deelnemers met hun antwoorden en jouw eigen antwoord. De link van een onlinevergadering krijgt hij nooit; die blijft in de agenda.

**E-mail.** Zijn er in deze vault mailaccounts verbonden, dan kan de assistent berichten zoeken en lezen. E-mail hoort niet bij de hulpmiddelen waarmee een gesprek begint: de assistent zoekt er pas naar wanneer je vraag dat nodig heeft, en bij de eerste toegang vraagt Plainva — **Je e-mail lezen?** **Toestaan** geldt voor deze provider totdat je Plainva sluit; een ander model of een andere provider vraagt opnieuw. **Niet toestaan** laat de toegang achterwege, en de assistent gaat zonder verder. Een model op dit apparaat vraagt niet, omdat er voor dat model niets het apparaat verlaat.

**Wat de assistent ervan leest.** Van een zoekopdracht ziet hij de datum, de afzender en het onderwerp van de berichten — nooit hun tekst. De tekst van een bericht en de beschrijving van een afspraak leest hij nooit zelf: anderen hebben ze geschreven, en wie een e-mail of een uitnodiging schrijft, kan die precies voor deze lezer schrijven. Een tweede lezer zonder enig hulpmiddel leest ze en schrijft een kort verslag — een samenvatting, uitspraken met de passage waarop ze berusten, en links die er echt in staan. Is onder **Modellen en profielen** een model op dit apparaat ingesteld als **Lokaal**, dan is dat model die lezer, en verlaat de tekst zelf het apparaat niet; alleen het verslag gaat naar de provider. Anders leest de provider van het gesprek, in een apart verzoek zonder hulpmiddelen. De vraag zegt je vooraf wie er leest.

**Wat niet verandert.** De assistent leest alleen: een bericht dat hij las, blijft ongelezen, er wordt niets verplaatst, beantwoord of verwijderd, en bijlagen opent hij niet — hij noemt alleen hun namen. Onder het antwoord zie je hoeveel berichten zijn gelezen, en de regel eronder zegt wie de tekst las.

## Externe hulpmiddelen (MCP)

De assistent kan hulpmiddelen gebruiken van servers die je zelf koppelt, via het Model Context Protocol (MCP) — een ticketsysteem, een wiki, een database van je team. Het is de omgekeerde richting van [AI-apps koppelen](Connect_AI_Apps.md): daar lezen andere apps je vault via Plainva; hier vraagt de assistent van Plainva iets aan andere servers. Van een server wordt niets gebruikt voordat je hebt bekeken wat hij aanbiedt, en elke aanroep krijg je te zien voordat hij vertrekt.

**Een server toevoegen.** Kies in **Instellingen → AI & automatisering** (het Vault-deel) onder **Externe hulpmiddelen (MCP)** voor **Server toevoegen…**. Geef hem een eigen naam en zijn adres (`https://…`), en een toegangstoken als de server erom vraagt — het gaat naar de beveiligde opslag van dit apparaat en wordt nooit meer getoond. Op de desktop kan een server ook een **Programma op deze computer** zijn: het bestand dat wordt gestart, de argumenten en de waarden voor zijn omgeving. Plainva start het rechtstreeks, zonder shell, en in een sandbox wanneer je computer er een heeft die Plainva kan gebruiken. Je systeem toont het adres of de hele opdracht nog één keer voordat het wordt onthouden. Op de telefoon is een server altijd een adres.

**Aanmelden.** Sommige servers vragen een aanmelding in plaats van een token. Zijn controle zegt dan **De server vraagt om aanmelding.** Kies **Aanmelden…**: Plainva vraagt de server waar zijn aanmelding staat, opent die pagina in je browser en wacht tot je terug bent. Wat het daarbij krijgt, blijft in de beveiligde opslag van dit apparaat en gaat alleen naar deze server; jij en de AI krijgen het nooit te zien. Het wordt zonder jou vernieuwd zolang de server dat toestaat, en als het is beëindigd, vraagt de controle je om je opnieuw aan te melden. Laat de aanmelddienst apps zichzelf niet registreren, dan vraagt Plainva om de **Client-ID** die de beheerder van de server je heeft gegeven. **Afmelden** vergeet de aanmelding; een aanmelding en een opgeslagen toegangstoken vervangen elkaar.

**Hem controleren.** Een server die net is toegevoegd, biedt nog niets aan. Zijn controle toont wat er is geregistreerd en wat de server opsomt: zijn eigen beschrijving, zijn hulpmiddelen met hun beschrijvingen — de eigen woorden van de server — en zijn prompts. **Goedkeuren** staat precies deze teksten toe, op dit apparaat. Voordat een server wordt gebruikt, laadt Plainva opnieuw wat hij opsomt en vergelijkt het met wat je hebt goedgekeurd; wijkt er iets af, dan is de server geblokkeerd totdat je opnieuw kijkt, en de controle zegt wat er is veranderd.

**Wat een vault toestaat.** Elke vault beslist voor zichzelf: of hij de server gebruikt (**⟨server⟩ in deze vault gebruiken**), welke van zijn hulpmiddelen de assistent mag aanroepen — er is er geen aangevinkt, en alleen hulpmiddelen die zeggen dat ze alleen lezen kunnen worden aangevinkt —, en onder **Notities die met een aanroep mee mogen** of dat **Geen**, **Gekozen mappen** of **De hele vault** is.

**In een gesprek.** De hulpmiddelen van je servers horen niet bij de hulpmiddelen waarmee een gesprek begint: de assistent zoekt ze pas wanneer je vraag ze nodig heeft, en het overzicht vóór het verzenden noemt de servers waarbij ze horen. Elke afzonderlijke aanroep vraagt eerst — **⟨server⟩ aanroepen?** — met het hulpmiddel en precies wat er zou worden verstuurd. **Aanroepen** laat deze ene aanroep door, **Niet aanroepen** laat hem achterwege, en een “altijd” bestaat niet. Een aanroep vertrekt helemaal niet als het gesprek een notitie heeft gelezen die buiten valt wat de vault deze server toestaat, of een notitie die je uit de cloud houdt. Wat terugkomt wordt behandeld als de tekst van een vreemde: de assistent leest het en neemt er geen instructies uit aan.

**Prompts.** Een server kan prompts aanbieden — kant-en-klare verzoeken. Ze staan onder een leeg gesprek, en alleen jij start ze. De eerste keer toont Plainva waartoe een prompt uitgroeit voordat hij als jouw bericht wordt verstuurd; daarna gaat precies die tekst zonder te vragen, en een andere tekst blokkeert de server.

**Wat Plainva bewaart.** Het adres of de opdracht wordt op dit apparaat onthouden, de opgeslagen waarden in zijn beveiligde opslag; jouw goedkeuring staat in de eigen gegevens van Plainva, nooit in de vault — wie in de vault kan schrijven, kan dus geen server goedkeuren. Onder **Recente aanroepen in deze vault** somt de controle op wanneer een hulpmiddel is aangeroepen, welk en hoe het afliep — nooit wat er is gezegd. **Server verwijderen** verwijdert de server van dit apparaat, voor elke vault.

Een gesprek dat door een vaardigheid is gestart, een actie op een selectie en een antwoord in een draad met opmerkingen bereiken geen externe hulpmiddelen, en het eigen model van het systeem op de telefoon evenmin.

## Een antwoord als notitie bewaren

Onder elk afgerond antwoord maakt **Bewaren als notitie** van het antwoord een notitie in je vault. Jij drukt erop en Plainva schrijft de notitie — de assistent zelf verandert nog steeds niets.

- **Waar de notitie terechtkomt.** In de **Inbox-map** van de vault (**Instellingen → Inhoud en structuur**), onder een naam die uit je vraag is afgeleid — in een gesprek dat door een vaardigheid is gestart, uit de vaardigheid en de notitie die openstond, of de dag. Een notitie die daar al staat, wordt nooit aangeraakt: de nieuwe krijgt de eerstvolgende vrije naam. Plainva opent haar meteen.
- **Wie de notitie schreef.** De eerste regel zegt het in woorden — een antwoord van Plainva AI, met het model, het tijdstip en je vraag. De eigenschappen van de notitie zeggen hetzelfde voor andere hulpmiddelen: `generated`, met het model en het tijdstip. Niets markeert de notitie als gecontroleerd; dat blijft aan jou — zie [OKF](OKF.md).
- **Waarop de notitie berust.** Onder het antwoord somt **Bronnen** op wat de uitvoering echt heeft gebruikt. Plainva schrijft deze lijst uit zijn eigen logboek, niet het model: de gelezen pagina's en wanneer, de zoekopdrachten en via welke provider, en je notities die meegingen of zijn gelezen. De eigenschappen dragen dezelfde lijst als `sources`.
- **Adressen.** Elk webadres dat het model in zijn antwoord heeft geschreven, wordt zo geschreven dat niets het opent of laadt (`https[://]…`), en een afbeelding van het web is in de notitie nooit een afbeelding. Alleen de pagina's onder **Bronnen** zijn echte links: adressen die de uitvoering met jouw toestemming heeft gelezen. Links naar je eigen notities blijven links.
- **Regels.** Een bewaard antwoord erft de privacyregels van datgene waarop het berust. Als een notitie die in het gesprek zat, of een die de assistent las, van de cloud of van internet wordt weggehouden, draagt de nieuwe notitie dezelfde regel — in de notitie zelf geschreven, waar haar map meer zou toestaan. Zo komt een antwoord dat een model op dit apparaat uit een privénotitie heeft gemaakt, ook als notitie niet bij een cloud terecht.

In een gedeelde workspace kunnen de leden een notitie lezen — en ook de lezers van een publicatie die de map omvat. Daar vraagt Plainva elke keer, met de naam van de notitie en de map: **Bewaren als notitie** schrijft haar, **Niet bewaren** schrijft niets.

## Privacyregels

Sommige notities mogen nooit bij een cloudprovider terechtkomen. Een regel kan in de frontmatter van een notitie staan:

```yaml
plainva:
  ai:
    cloud: deny
```

of, voor een hele map, in **Instellingen → AI & automatisering** (het Vault-deel), dat de regels naar `.agent/policy.yml` schrijft. Een notitie die van de cloud wordt weggehouden draagt niets bij — geen tekst en geen titel —, en links ernaartoe in andere notities worden achtergehouden. Modellen op dit apparaat blijven toegestaan. Versleutelde workspaces sluiten de cloud uit, tenzij je die daar toestaat. Het exacte formaat staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

Een afbeelding hoort bij de notities die haar tonen: een afbeelding die is ingesloten in een notitie die van de cloud wordt weggehouden, gaat ook naar geen enkel cloudmodel (zie Een afbeelding uitleggen hierboven).

Een tweede regel, `web: deny` — in de instellingen **Webtoegang: nooit** —, houdt een notitie of map buiten elk gesprek dat internet mag gebruiken.

## Geschiedenis en verbruik

Gesprekken blijven op dit apparaat, per vault — nooit in de vault en nooit gesynchroniseerd. **Gesprekken bewaren** bepaalt hoe lang; je kunt losse gesprekken in de lijst verwijderen, of alle gesprekken van een vault in één keer. **Verbruik deze maand** telt de tokens per provider en model op.

## Grenzen van de beta

- Op de desktop werkt de AI alleen in het hoofdvenster.
- Op de telefoon komt een antwoord alleen terwijl de app open staat.
- De assistent verandert zelf geen notitie: hij stelt wijzigingen aan een geselecteerde passage en transcripties van spraaknotities voor, als voorstellen die je accepteert of afwijst; in een draad met opmerkingen schrijft hij een antwoord naast de notitie, nooit tekst erin. Een antwoord wordt pas een notitie wanneer je op **Bewaren als notitie** drukt; dan schrijft Plainva haar, niet de assistent.

Feedback over de bèta gaat naar de discussies van het project op GitHub: **Feedback over de AI (bèta)** in de instellingen begint er een.
