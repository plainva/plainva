# E-mail vastleggen

Laatst bijgewerkt: 2026-08-12

Plainva kan je mailbox lezen om kennis uit e-mail naar je vault te halen, en — sinds 0.4.0 — ook mail opstellen en versturen. De focus blijft op het **vastleggen** van berichten als notities; een via **IMAP** verbonden mailbox wordt alleen gelezen om vast te leggen (er verandert niets in, zelfs de ongelezen-markeringen niet) zolang je het verzenden niet instelt.

> **Experimenteel.** De mailclient praat met echte externe accounts (IMAP/SMTP en Microsoft) die niet doorlopen kunnen worden in Plainva's geautomatiseerde tests. Het werkt en wordt dagelijks gebruikt, maar behandel het als een preview: bewaar een back-up en meld alsjeblieft alles wat vreemd overkomt.

## Een mailbox verbinden

**Instellingen → Vault → Cloudaccounts → Account verbinden…** en kies de provider:

- **Microsoft** — voor Outlook.com en Microsoft 365: vink **E-mail** aan bij de stap diensten (desgewenst samen met **Bestanden** en **Agenda en taken** — één account, één aanmelding) en meld je rechtstreeks aan in de browser, zonder app-wachtwoord en zonder IMAP. Plainva gebruikt de centrale app-registratie van Plainva (je kunt optioneel je eigen app-ID opgeven in de accountdetails). Lezen, vastleggen en **direct verzenden** lopen allemaal via de Microsoft-aanmelding.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — eigen tegels: e-mailadres plus een **app-wachtwoord**, de servers zijn al ingevuld (bij de meeste van deze tegels kun je in dezelfde stap ook **Agenda en taken** aanvinken — één app-wachtwoord voor alle gekozen diensten). De assistent linkt telkens naar de officiële handleiding van de provider voor het aanmaken van het app-wachtwoord.
- **E-mailserver (IMAP)** — voor elke andere provider: host, poort en een wachtwoord of **app-wachtwoord**. Er zijn kant-en-klare voorinstellingen voor providers uit de hele wereld — van **web.de**/**GMX** en **T-Online** via **Orange**, **Libero**, **WP**, **Seznam** en **Comcast** tot **QQ Mail**, **NetEase**, **Naver** en **Yahoo! JAPAN**; de keuzelijst **Provider** heeft daarvoor een zoekregel, en bij het intypen van je adres wordt de bijpassende voorinstelling automatisch gekozen. Waar een provider bijzonderheden heeft, wijst de assistent daar direct onder het formulier op: sommige vereisen een **app-wachtwoord** of een **autorisatiecode** in plaats van het accountwachtwoord, bij andere moet IMAP eerst in de instellingen van de provider worden ingeschakeld — telkens met een link naar de officiële handleiding. Voor Gmail is dat `imap.gmail.com`, poort `993`, met een app-wachtwoord van [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (vereist tweefactorauthenticatie) — geen OAuth, geen verificatie; de assistent wijst hier bij Gmail-adressen zelf op. **Outlook.com-mailboxen** kunnen niet meer via app-wachtwoord-IMAP verbinden (Microsoft heeft die weg uitgeschakeld) — de voorinstelling verwijst naar de tegel **Microsoft**. **Proton Mail** werkt alleen via de lokaal draaiende, betaalde Proton Mail Bridge (eigen voorinstelling). Voeg een SMTP-host toe om direct te verzenden.

Bij het verbinden wordt de aanmelding gevalideerd voordat er iets wordt opgeslagen; de toegangsgegevens komen terecht in de sleutelhanger van je besturingssysteem. De verbonden mailboxen en de vastleginstellingen vind je daarna in het gebied **E-mail**: de instelling **E-mailmap** bepaalt waar vastgelegde e-mails worden opgeslagen (standaard `Mail`).

**Aanmelden op een tweede apparaat.** Komt een postbus mee via de instellingensynchronisatie, dan reist het wachtwoord niet automatisch mee — aanmeldingen worden alleen overgedragen als je de synchronisatie van inloggegevens zelf inschakelt. Zo'n postbus toont in het gebied **E-mail** de knop **Op dit apparaat aanmelden**: voer het wachtwoord in, Plainva controleert het bij de provider en bewaart het pas daarna in de sleutelhanger. Bij een Microsoft-postbus leidt dezelfde knop naar **Cloudaccounts**, want daar verloopt de aanmelding in de browser.

## E-mails lezen

Open het e-mailtabblad via de actiebalk uiterst links (brief-icoon) of het opdrachtenpalet (**E-mail openen**). De lijst toont je inbox, nieuwste eerst (ongelezen vetgedrukt, met **Meer laden** blader je verder). Een geselecteerd bericht opent in een **sandbox-viewer**:

- **Externe inhoud wordt geblokkeerd** — tracking-pixels, externe afbeeldingen en extern geladen stijlen worden verwijderd en geteld ("Externe inhoud geblokkeerd (n)"). Alleen zelfstandige inline-afbeeldingen worden getoond. **Afbeeldingen tonen** naast de teller toont de https-afbeeldingen van een bericht eenmalig; **Externe afbeeldingen altijd laden** in de e-mailinstellingen maakt daar een blijvende opt-in van. Let op: bij het laden van externe afbeeldingen ziet de afzender je IP-adres en wanneer je de mail opende — daarom is blokkeren de standaardinstelling.
- **Gelezen is gelezen** — een bericht dat je opent, telt na drie seconden als gelezen. Markeer je het ondertussen **met de hand als ongelezen**, dan blijft het ongelezen zolang het open staat; pas als je het verlaat en opnieuw opent, begint de aftelling weer. Hetzelfde op beide apparaten — voorheen zette de timer op de desktop de markering drie seconden later terug, en de telefoon markeerde een bericht meteen als gelezen zodra het werd geopend.
- Links worden als platte tekst getoond en zijn in de viewer niet aanklikbaar.
- Scripts en formulieren worden nooit uitgevoerd. Het bericht wordt weergegeven in een geïsoleerd frame met een strikt inhoudsbeleid.
- **Gesprekken** — de schakelaar boven de lijst (tekstballon-pictogram) vouwt bij elkaar horende berichten samen tot één regel: deelnemers, aantal en het onderwerp waarmee de uitwisseling begon. Een tik vouwt hem open; elk bericht houdt zijn map en noemt die wanneer het niet de geopende is. Plainva leest daarvoor ook **Verzonden** mee, zodat je eigen antwoorden deel van het gesprek zijn. Uitgeschakeld blijft alles zoals het was — een platte lijst — en de keuze wordt per vault onthouden, op beide apparaten. Het groeperen volgt de antwoordketen van de berichten (bij Microsoft het gesprek dat de provider zelf bijhoudt); alleen wanneer een antwoord die keten niet meestuurt, helpt het onderwerp uit — en dan alleen bij een herkenbaar antwoord (“Re:”, “Antw:”) en binnen 30 dagen, zodat twee berichten die alleen een onderwerp delen niet samenvallen.
- **Alle postvakken IN** — de eerste regel boven de mappenlijst toont de postvakken IN van **alle** accounts in één lijst, nieuwste eerst, en elke regel noemt het account waarbij hij hoort. Gelezen/ongelezen en markeren werken hier ook; verplaatsen en verwijderen blijven bij het afzonderlijke postvak, want elk account heeft zijn eigen doelmap — open het bericht en je handelt in zijn postvak. Een account zonder geldige aanmelding wordt bij naam genoemd en maakt de lijst van de andere niet leeg.
- **Meerdere selecteren** — Ctrl+klik (macOS: ⌘+klik) kiest losse berichten, Shift+klik een reeks; in de gespreksweergave kiest een Ctrl+klik op het gesprek de hele uitwisseling, en elk bericht behoudt daarbij zijn eigen map.

Bijlagen worden vermeld met naam en grootte; de originele `.eml` (hieronder) bevat ze volledig.

Open je een map die je eerder al hebt geopend, dan verschijnt de lijst **direct** uit de lokale cache terwijl het verversen op de achtergrond loopt; zolang dat duurt zegt een hint “bijwerken” — bevestigd is alleen wat de server heeft gestuurd. Hetzelfde geldt voor een bericht dat je al hebt gelezen. Op de telefoon wordt het **nieuwste** bericht in een map op de achtergrond vooraf geladen — het opent dan zonder wachten, ook als je het nog nooit had geopend.

Op de desktop kun je de drie kolommen (mappen · lijst · lezer) aan de scheidingslijnen versleepen; de breedtes worden **per vault** bewaard en overleven een herstart. Elke kolom houdt een minimumbreedte, zodat de lezer nooit wordt weggedrukt.

Mislukt een verversing — geen netwerk, of de provider knijpt af —, dan blijft de lijst de laatste kopie van dit apparaat tonen, met een melding daarover, in plaats van een leeg venster. Een bericht dat je al gelezen hebt, blijft op dezelfde manier leesbaar. Het is en blijft een cache: de server wint altijd, niets hiervan is de enige kopie van iets, en met de vault verdwijnt ook de cache.

## Een bericht in de vault krijgen

Drie knoppen bij elk bericht:

- **Opslaan als notitie** — maakt een notitie aan in je e-mailmap (`JJJJ-MM-DD Onderwerp.md`) met de afzender en de datum in de frontmatter en de platte tekst onder de onderwerpkop. Hetzelfde bericht een tweede keer vastleggen opent de bestaande notitie in plaats van hem te dupliceren.
- **+ .eml** — bewaart bovendien het ruwe origineel naast de notitie en linkt ernaar. De `.eml` bevat alles, ook de bijlagen, en opent in elk mailprogramma.
- **→ Taak** — maakt een item aan in je [standaard takendatabase](Tasks.md) met het onderwerp als titel, de datum van vandaag als vervaldatum en de open status vooraf ingevuld.

## Opstellen en verzenden

Zodra een account kan verzenden — een **Microsoft**-account, of een **IMAP**-account met een ingestelde **SMTP-host** —, kun je vanuit Plainva mail schrijven en versturen:

- **Opstellen** (in het e-mailtabblad) opent een zwevend venster met beschreven regels **Van / Aan / Cc / Bcc**. Typ een adres en druk op Enter of komma om er een chip van te maken; **Cc/Bcc** klappen open op aanvraag. De inhoud is een Markdown-editor met een opmaakwerkbalk en een "/"-opdrachtmenu. Een link `[tekst](https://…)` verschijnt als een kant-en-klare link terwijl je typt — de Markdown-tekens komen terug zodra de cursor erin staat, en een klik opent het doel in je browser. Bij het verzenden wordt de tekst hoe dan ook naar HTML omgezet: de ontvanger krijgt altijd een echte link, ongeacht hoe hij er in het venster uitzag.
- **Sjabloon invoegen…** zet een notitiesjabloon in de berichttekst. De vragen van het sjabloon (`{{prompt:…}}`) worden **één keer, in één dialoogvenster** gesteld in plaats van als tijdelijke aanduiding mee te reizen; de frontmatter blijft erbuiten — een mailtekst heeft er geen, en de ontvanger zou anders YAML krijgen. Annuleer je, dan wordt er niets ingevoegd.
- **Beantwoorden**, **Allen beantwoorden** en **Doorsturen** bij elk bericht openen hetzelfde venster met het origineel geciteerd en de ontvangers vooraf ingevuld; bij doorsturen gaan de bijlagen mee.
- **Verzenden** gaat via SMTP (IMAP-accounts) of Microsoft Graph (Microsoft-accounts).
- **Deze notitie per e-mail** (⋮-menu van een notitie, of het opdrachtenpalet) start een bericht met de huidige notitie als bijlage, of inline als tekst.

## Een notitie doorgeven zonder de mailclient

Je hoeft niet vanuit Plainva te verzenden. Dit werkt bij elke notitie en heeft geen SMTP nodig:

- **Beantwoorden als notitie** (bij een bericht): maakt een notitie aan die aan de afzender is geadresseerd (`to:` in de frontmatter) met het origineel geciteerd — schrijf je antwoord in Plainva.
- **Notitie als e-mailconcept in de mailbox opslaan** (opdrachtenpalet, bij elke geopende notitie): bewaart de notitie via IMAP als **concept in je eigen mailbox** — kies het account, de ontvanger en de conceptenmap, open dan je gewone mailprogramma, controleer en verstuur van daaruit. De opmaak blijft behouden.
- **Notitie per e-mail versturen (mailto)** (opdrachtenpalet): opent je standaard mailprogramma met de notitie als platte tekst (lange notities worden ingekort).
- **Notitie als e-mailtekst kopiëren** (opdrachtenpalet): zet de notitie met opmaak op het klembord — plak hem in elk venster waarin je een e-mail opstelt.

## Handtekening en afzenderadressen

Onder **Instellingen → E-mail → Verzenden** heeft elke mailbox twee eigen instellingen:

- **Handtekening** — Markdown, wordt bij het opstellen onder je tekst gezet (en boven een geciteerd of doorgestuurd origineel, waar een lezer hem verwacht). Wissel je in het opstelvenster van afzender, dan wordt de handtekening vervangen in plaats van er een tweede bij te zetten. Het veld is dezelfde editor als het opstelvenster, dus je ziet de handtekening zoals hij verstuurd wordt.
- **Handtekening per adres** — heb je meer afzenderadressen, dan verschijnt boven het veld de keuze **Handtekening voor**. “Standaard (alle adressen)” is de handtekening van het account; kies een adres om er een te schrijven die alleen voor dat adres geldt. Adressen zonder eigen handtekening blijven de standaard gebruiken, en van afzender wisselen tijdens het schrijven zet de juiste erin — ook tussen twee adressen van hetzelfde account. Maak je het veld van een adres leeg, dan valt het terug op de standaard.
- **Extra afzenderadressen** — één per regel, bijv. `Naam <alias@example.org>`. Het veld **Van** toont dan adressen in plaats van accounts: eerst dat van de mailbox zelf, daarna de aliassen. Of een adres echt wordt geaccepteerd, bepaalt je provider — een server die weigeren te verzenden onder een alias zegt dat, en Plainva toont die fout in plaats van stilletjes onder een andere naam te verzenden.

## Mailboxacties

Sterren/markeringen synchroniseren via IMAP en Microsoft; **Gemarkeerd** toont de serverselectie. Berichten kunnen afzonderlijk of in bulk worden verplaatst. Buiten de prullenbak betekent **Verwijderen** altijd “naar de prullenbak”; alleen daar is **Definitief verwijderen** na bevestiging beschikbaar. Bij Gmail is verplaatsen een labelwijziging en kunnen acties in **Alle e-mail** het bericht in alle labels raken; Plainva waarschuwt vooraf.

## Afmelden en verzenden ongedaan maken

Draagt een bericht de kopregel `List-Unsubscribe`, dan toont Plainva in de lezer een knop **Afmelden**. Wat daarna gebeurt, heeft de **afzender zelf** opgegeven: Plainva raadt niets uit de tekst en klikt niets namens jou. Een webadres opent na een bevestiging in je browser; een mailadres belandt in het opstelvenster, zodat je ziet wat er uitgaat. Onversleutelde `http://`-routes worden weggelaten, want afmelden daarover verstuurt je adres in het open.

**Verzenden ongedaan maken** is een **vertraging, geen terughaling**: na het verzenden wacht Plainva een paar seconden voordat het bericht echt naar de server gaat, en zolang houdt een melding de knop **Ongedaan maken** klaar. Daarna is het onderweg en niet meer te stoppen — geen enkel mailprogramma kan een afgeleverd bericht terughalen. Verlaat je Plainva op dat moment (op de telefoon: schakel je naar een andere app), dan wordt **direct verzonden** in plaats van geannuleerd: een bericht dat je wilde versturen mag niet verdwijnen omdat de app naar de achtergrond ging.

## Uitstellen

Sommige post is niet dringend, maar ook niet afgehandeld. **Uitstellen** haalt een bericht uit de lijst tot een moment dat je kiest — later vandaag, morgenochtend, dit weekend of volgende week. Op de computer staat de optie in het contextmenu van de rij, op de telefoon is het bovendien een veegactie. De knop **Uitgesteld** brengt ze weer in beeld; van daaruit zet **Nu terughalen** een bericht meteen terug in de lijst.

Twee dingen die eerlijk gezegd moeten worden. Ten eerste is uitstellen een **eigen markering van Plainva**, geen serverfunctie: IMAP noch Microsoft kent zoiets. De markering reist mee met de instellingensynchronisatie, dus een op de telefoon uitgesteld bericht rust ook op de computer — in een ander mailprogramma staat het gewoon in het postvak IN. Ten tweede verbergt uitstellen alleen de **lijst van de map** waarin je het deed: zoeken en "Alle postvakken" tonen het bericht nog steeds. Uitgesteld betekent "niet in de weg", niet "weg".

## Spam melden

**Spam** verplaatst een bericht naar de spammap van het account en markeert het, waar de server dat kent, met het trefwoord `$Junk`. In de spammap heet dezelfde knop **Geen spam** en haalt het bericht terug naar de inbox. Beide zijn beschikbaar in de lezer, in de meervoudige selectie en op de telefoon bovendien als veegactie van de rij.

Eerlijk daarover: **alleen verplaatsen traint het filter niet per se.** Sommige servers leren ervan, andere bewaren alleen het trefwoord, en weer andere wijzen het af. Na de actie vertelt Plainva wat er werkelijk is gebeurd — “als spam gemarkeerd en verplaatst” of alleen “verplaatst”. Heeft je account helemaal geen spammap, dan biedt Plainva aan een map **Junk** aan te maken in plaats van post in een verzonnen mapnaam te duwen.

## Afwezigheidsbericht

Een afwezigheidsbericht hoort op de server, niet in een programma dat toevallig open staat. Plainva biedt het daarom **alleen aan waar het het uitzetten van de computer overleeft** — bij Microsoft-accounts en bij postvakken met een Sieve-server (mailbox.org, Fastmail, Nextcloud, Mailcow en andere). Heeft een postvak geen van beide, dan verschijnt er geen schakelaar maar een zin die dat uitlegt.

Je vindt het onder **Instellingen → E-mail** en op de telefoon in het accountgedeelte: onderwerp, tekst en een periode. Zonder periode blijft het bericht actief tot je het uitzet; met een periode begint en eindigt het vanzelf — ook als je Plainva nooit meer opent.

**Je eigen filterregels blijven onaangeroerd.** In een Sieve-script schrijft Plainva uitsluitend zijn eigen gedeelte, gemarkeerd met `# --- BEGIN PLAINVA`, en laat al het andere teken voor teken staan. Vindt het daar een gedeelte dat het niet veilig kan lezen, dan verandert het **niets** en zegt het dat.

## Regels

Een regel kijkt naar afzender, ontvanger of onderwerp en doet dan iets: verplaatsen, als gelezen markeren, markeren, als spam melden of naar de prullenbak verplaatsen. Je vindt ze onder **Instellingen → E-mail**.

**En dit is het belangrijke:** regels draaien voorlopig **alleen terwijl Plainva open is**, en alleen over berichten die Plainva heeft opgehaald. Op de telefoon betekent dat bovendien: alleen terwijl de app op de voorgrond stond. Een regel filtert dus niets terwijl de computer uit staat — de kaart zegt dat ter plekke, in plaats van een serverfilter te suggereren dat hier nog niet bestaat.

Kijkt een regel naar de **berichttekst**, dan werkt hij pas als je het bericht opent: die tekst staat niet in het overzicht. Ook dat staat op de kaart.

**Bij de provider opslaan.** Heeft je postbus een Sieve-server, dan maakt de knop **Bij de provider opslaan** van je regels een serverfilter: dat werkt dan ook als Plainva gesloten is. Plainva schrijft alleen zijn eigen gemarkeerde deel en laat je handgeschreven regels ongewijzigd staan — dezelfde toezegging als bij de afwezigheidsmelding, want beide delen dat ene deel.

Een regel die je server niet kan uitdrukken — bijvoorbeeld een controle van de berichttekst op een server zonder de bijbehorende uitbreiding — blijft **lokaal**, en Plainva noemt hem. Hij wordt bewust niet meegestuurd: een script met een vereiste die de server niet kent, wordt **in zijn geheel** geweigerd, en daarmee zou ook de afwezigheidsmelding verdwijnen.

Gmail-regels stel je nog steeds in Googles eigen instellingen in.

**Bij Microsoft** is geen extra server nodig: dezelfde knop slaat je regels als Outlook-regels in de postbus op. Plainva vervangt alleen de regels die het zelf heeft aangemaakt en laat die van jou ongemoeid — en het zet ze *achter* de jouwe, want een handgeschreven regel was er eerst. Microsoft vergelijkt alleen met “bevat”: “is precies”, “begint met”, “eindigt op”, een regel op cc-ontvangers en het markeren blijven daarom lokaal, en worden je genoemd.

**Op de telefoon** maak je regels volledig zelf: tik in de mailinstellingen op een regel en je krijgt hem als **Als** en **Dan** — elke voorwaarde en elke actie is een rij, en een tik vraagt veld, vergelijking en waarde op eigen bladen. Dat is bewust geen gekrompen formulier: vijf bedieningselementen naast elkaar op telefoonbreedte is hoe een regel verkeerd wordt ingetikt. De laatste voorwaarde kun je niet verwijderen — een regel zonder voorwaarde zou op elk bericht passen.

**Als notitie opslaan** is de actie die geen enkel mailprogramma heeft: de regel legt het bericht als notitie in je kluis vast, met afzender, datum en tekst — dezelfde vastlegging als de knop in de lezer, maar automatisch. Dezelfde mail twee keer levert **dezelfde** notitie op, en het bericht blijft in zijn map: er wordt een kopie vastgelegd, er wordt niets verplaatst. Een regel met deze actie blijft **altijd** lokaal, ook bij een postbus die regels zou kunnen uitvoeren. Dat is met opzet: de rest van de regel bij de provider opslaan zou de server het bericht laten verplaatsen voordat er iets vast te leggen viel.
