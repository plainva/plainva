# E-mail vastleggen

Laatst bijgewerkt: 2026-07-21

Plainva kan je mailbox lezen om kennis uit e-mail naar je vault te halen, en — sinds 0.4.0 — ook mail opstellen en versturen. De focus blijft op het **vastleggen** van berichten als notities; een via **IMAP** verbonden mailbox wordt alleen gelezen om vast te leggen (er verandert niets in, zelfs de ongelezen-markeringen niet) zolang je het verzenden niet instelt.

> **Experimenteel.** De mailclient praat met echte externe accounts (IMAP/SMTP en Microsoft) die niet doorlopen kunnen worden in Plainva's geautomatiseerde tests. Het werkt en wordt dagelijks gebruikt, maar behandel het als een preview: bewaar een back-up en meld alsjeblieft alles wat vreemd overkomt.

## Een mailbox verbinden

**Instellingen → Vault → Cloudaccounts → Account verbinden…** en kies de provider:

- **Microsoft** — voor Outlook.com en Microsoft 365: vink **E-mail** aan bij de stap diensten (desgewenst samen met **Bestanden** en **Agenda en taken** — één account, één aanmelding) en meld je rechtstreeks aan in de browser, zonder app-wachtwoord en zonder IMAP. Plainva gebruikt de centrale app-registratie van Plainva (je kunt optioneel je eigen app-ID opgeven in de accountdetails). Lezen, vastleggen en **direct verzenden** lopen allemaal via de Microsoft-aanmelding.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — eigen tegels: e-mailadres plus een **app-wachtwoord**, de servers zijn al ingevuld (bij de meeste van deze tegels kun je in dezelfde stap ook **Agenda en taken** aanvinken — één app-wachtwoord voor alle gekozen diensten). De assistent linkt telkens naar de officiële handleiding van de provider voor het aanmaken van het app-wachtwoord.
- **E-mailserver (IMAP)** — voor elke andere provider: host, poort en een wachtwoord of **app-wachtwoord**. Er zijn kant-en-klare voorinstellingen voor providers uit de hele wereld — van **web.de**/**GMX** en **T-Online** via **Orange**, **Libero**, **WP**, **Seznam** en **Comcast** tot **QQ Mail**, **NetEase**, **Naver** en **Yahoo! JAPAN**; de keuzelijst **Provider** heeft daarvoor een zoekregel, en bij het intypen van je adres wordt de bijpassende voorinstelling automatisch gekozen. Waar een provider bijzonderheden heeft, wijst de assistent daar direct onder het formulier op: sommige vereisen een **app-wachtwoord** of een **autorisatiecode** in plaats van het accountwachtwoord, bij andere moet IMAP eerst in de instellingen van de provider worden ingeschakeld — telkens met een link naar de officiële handleiding. Voor Gmail is dat `imap.gmail.com`, poort `993`, met een app-wachtwoord van [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (vereist tweefactorauthenticatie) — geen OAuth, geen verificatie; de assistent wijst hier bij Gmail-adressen zelf op. **Outlook.com-mailboxen** kunnen niet meer via app-wachtwoord-IMAP verbinden (Microsoft heeft die weg uitgeschakeld) — de voorinstelling verwijst naar de tegel **Microsoft**. **Proton Mail** werkt alleen via de lokaal draaiende, betaalde Proton Mail Bridge (eigen voorinstelling). Voeg een SMTP-host toe om direct te verzenden.

Bij het verbinden wordt de aanmelding gevalideerd voordat er iets wordt opgeslagen; de toegangsgegevens komen terecht in de sleutelhanger van je besturingssysteem. De verbonden mailboxen en de vastleginstellingen vind je daarna in het gebied **E-mail**: de instelling **E-mailmap** bepaalt waar vastgelegde e-mails worden opgeslagen (standaard `Mail`).

## E-mails lezen

Open het e-mailtabblad via de actiebalk uiterst links (brief-icoon) of het opdrachtenpalet (**E-mail openen**). De lijst toont je inbox, nieuwste eerst (ongelezen vetgedrukt, met **Meer laden** blader je verder). Een geselecteerd bericht opent in een **sandbox-viewer**:

- **Externe inhoud wordt geblokkeerd** — tracking-pixels, externe afbeeldingen en extern geladen stijlen worden verwijderd en geteld ("Externe inhoud geblokkeerd (n)"). Alleen zelfstandige inline-afbeeldingen worden getoond. **Afbeeldingen tonen** naast de teller toont de https-afbeeldingen van een bericht eenmalig; **Externe afbeeldingen altijd laden** in de e-mailinstellingen maakt daar een blijvende opt-in van. Let op: bij het laden van externe afbeeldingen ziet de afzender je IP-adres en wanneer je de mail opende — daarom is blokkeren de standaardinstelling.
- Links worden als platte tekst getoond en zijn in de viewer niet aanklikbaar.
- Scripts en formulieren worden nooit uitgevoerd. Het bericht wordt weergegeven in een geïsoleerd frame met een strikt inhoudsbeleid.

Bijlagen worden vermeld met naam en grootte; de originele `.eml` (hieronder) bevat ze volledig.

## Een bericht in de vault krijgen

Drie knoppen bij elk bericht:

- **Opslaan als notitie** — maakt een notitie aan in je e-mailmap (`JJJJ-MM-DD Onderwerp.md`) met de afzender en de datum in de frontmatter en de platte tekst onder de onderwerpkop. Hetzelfde bericht een tweede keer vastleggen opent de bestaande notitie in plaats van hem te dupliceren.
- **+ .eml** — bewaart bovendien het ruwe origineel naast de notitie en linkt ernaar. De `.eml` bevat alles, ook de bijlagen, en opent in elk mailprogramma.
- **→ Taak** — maakt een item aan in je [standaard takendatabase](Tasks.md) met het onderwerp als titel, de datum van vandaag als vervaldatum en de open status vooraf ingevuld.

## Opstellen en verzenden

Zodra een account kan verzenden — een **Microsoft**-account, of een **IMAP**-account met een ingestelde **SMTP-host** —, kun je vanuit Plainva mail schrijven en versturen:

- **Opstellen** (in het e-mailtabblad) opent een zwevend venster met beschreven regels **Van / Aan / Cc / Bcc**. Typ een adres en druk op Enter of komma om er een chip van te maken; **Cc/Bcc** klappen open op aanvraag. De inhoud is een Markdown-editor met een opmaakwerkbalk en een "/"-opdrachtmenu.
- **Beantwoorden**, **Allen beantwoorden** en **Doorsturen** bij elk bericht openen hetzelfde venster met het origineel geciteerd en de ontvangers vooraf ingevuld; bij doorsturen gaan de bijlagen mee.
- **Verzenden** gaat via SMTP (IMAP-accounts) of Microsoft Graph (Microsoft-accounts).
- **Deze notitie per e-mail** (⋮-menu van een notitie, of het opdrachtenpalet) start een bericht met de huidige notitie als bijlage, of inline als tekst.

## Een notitie doorgeven zonder de mailclient

Je hoeft niet vanuit Plainva te verzenden. Dit werkt bij elke notitie en heeft geen SMTP nodig:

- **Beantwoorden als notitie** (bij een bericht): maakt een notitie aan die aan de afzender is geadresseerd (`to:` in de frontmatter) met het origineel geciteerd — schrijf je antwoord in Plainva.
- **Notitie als e-mailconcept in de mailbox opslaan** (opdrachtenpalet, bij elke geopende notitie): bewaart de notitie via IMAP als **concept in je eigen mailbox** — kies het account, de ontvanger en de conceptenmap, open dan je gewone mailprogramma, controleer en verstuur van daaruit. De opmaak blijft behouden.
- **Notitie per e-mail versturen (mailto)** (opdrachtenpalet): opent je standaard mailprogramma met de notitie als platte tekst (lange notities worden ingekort).
- **Notitie als e-mailtekst kopiëren** (opdrachtenpalet): zet de notitie met opmaak op het klembord — plak hem in elk venster waarin je een e-mail opstelt.

## Mailboxacties

Sterren/markeringen synchroniseren via IMAP en Microsoft; **Gemarkeerd** toont de serverselectie. Berichten kunnen afzonderlijk of in bulk worden verplaatst. Buiten de prullenbak betekent **Verwijderen** altijd “naar de prullenbak”; alleen daar is **Definitief verwijderen** na bevestiging beschikbaar. Bij Gmail is verplaatsen een labelwijziging en kunnen acties in **Alle e-mail** het bericht in alle labels raken; Plainva waarschuwt vooraf.
