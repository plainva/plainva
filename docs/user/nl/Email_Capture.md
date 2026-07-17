# E-mail vastleggen

Laatst bijgewerkt: 2026-07-18

Plainva kan je mailbox lezen — en alleen lezen —, om kennis uit e-mail naar je vault te halen. Het is bewust **geen** mailprogramma: de verbinding loopt via IMAP in alleen-lezen-modus, er verandert niets in de mailbox (zelfs de ongelezen-markeringen niet), en Plainva verstuurt zelf nooit mail.

## Een mailbox verbinden

**Instellingen → Vault → Agenda en accounts → E-mail (IMAP, alleen-lezen) → Account toevoegen…**: host, poort en een **app-wachtwoord**. Voor Gmail is dat `imap.gmail.com`, poort `993`, met een app-wachtwoord van [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (vereist tweefactorauthenticatie) — geen OAuth, geen verificatie. Bij het verbinden wordt de aanmelding gevalideerd voordat er iets wordt opgeslagen; het wachtwoord komt terecht in de sleutelhanger van het besturingssysteem. De instelling **E-mailmap** bepaalt waar vastgelegde e-mails worden opgeslagen (standaard `Mail`).

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

## Inhoud naar buiten krijgen — zonder te versturen

Plainva spreekt nooit SMTP. In plaats daarvan:

- **Beantwoorden als notitie** (bij een bericht): maakt een notitie aan die aan de afzender is geadresseerd (`to:` in de frontmatter) met het origineel geciteerd — schrijf je antwoord in Plainva.
- **Notitie als e-mailconcept in de mailbox opslaan** (opdrachtenpalet, bij elke geopende notitie): bewaart de notitie via IMAP als **concept in je eigen mailbox** — kies het account, de ontvanger en de conceptenmap, open dan je gewone mailprogramma, controleer en verstuur van daaruit. De opmaak blijft behouden.
- **Notitie per e-mail versturen (mailto)** (opdrachtenpalet): opent je standaard mailprogramma met de notitie als platte tekst (lange notities worden ingekort).
- **Notitie als e-mailtekst kopiëren** (opdrachtenpalet): zet de notitie met opmaak op het klembord — plak hem in elk venster waarin je een e-mail opstelt.
