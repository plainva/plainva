# Back-ups & versiegeschiedenis

Laatst bijgewerkt: 2026-07-11

Plainva beschermt je werk op twee niveaus: **bestandsversies** (automatische snapshots van elk afzonderlijk bestand terwijl je bewerkt en verwijdert) en **vault-back-ups** (regelmatige ZIP-archieven van de hele vault, opgeslagen buiten de vault-map). Beide draaien op de achtergrond zonder enige instelling en zijn af te stemmen in de instellingen onder **Backup & versiegeschiedenis**.

## Bestandsversies (snapshots)

Vóór elke opslagactie bewaart Plainva een snapshot van de vorige staat — als gewone tekstkopie onder `.plainva/backups/` binnen de vault (deze map is verborgen voor de bestandsboom, het zoeken en de sync). Om te voorkomen dat er honderden kopieën ontstaan terwijl je typt, geldt een **Snapshot-interval** (standaard: hoogstens één nieuwe versie per 2 minuten). **Verwijderen maakt altijd een snapshot**, ongeacht het interval.

Bewaartermijn (per vault instelbaar):

- **Snapshot-interval**: Bij elke wijziging / 30 s / 2 min / 5 min / 10 min
- **Versies per bestand**: standaard 100 — daarboven worden de oudste verwijderd
- **Maximale leeftijd**: standaard 90 dagen — oudere versies worden **permanent** verwijderd door een dagelijkse opschoning ("Onbeperkt" schakelt dit uit)

Wanneer je een bestand hernoemt of verplaatst, verhuist de versiegeschiedenis mee.

## Versies bekijken en herstellen

Rechtsklik op een bestand in de bestandsboom (of op het bijbehorende tabblad), of gebruik het **⋮**-menu rechtsboven in de editor → **Versiegeschiedenis…** opent de versielijst:

- Aan de linkerkant staan alle snapshots gegroepeerd per dag, met tijd en grootte.
- Aan de rechterkant zie je een voorbeeld; bij tekstbestanden toont **Vergelijken met huidige versie** de gekozen versie naast de huidige inhoud (oude versie links, huidige staat rechts).
- **Herstellen** vervangt de huidige inhoud door de gekozen versie. Geen zorgen: de huidige staat wordt zelf eerst als snapshot opgeslagen — een herstelactie kan dus altijd ongedaan worden gemaakt.
- **Als kopie herstellen** maakt de versie aan als nieuw bestand naast het origineel (`Name (Version 2026-07-05 14-30).md`) zonder dat bestand aan te raken.

Ook afbeeldingen hebben versies (met voorbeeld); andere binaire bestanden kunnen zonder voorbeeld worden hersteld.

## Verwijderde bestanden herstellen

Omdat elke verwijdering eerst een snapshot van het bestand maakt, kan Plainva verwijderde bestanden terughalen: rechtsklik op de vaultnaam bovenaan de bestandsboom → **Verwijderde bestanden herstellen…** (ook bereikbaar via de instellingen). De lijst toont alle bestanden waarvan de snapshots nog bestaan terwijl het origineel weg is — **Herstellen** maakt de nieuwste staat opnieuw aan op de oorspronkelijke locatie (mappen worden zo nodig opnieuw aangemaakt), **Versies…** opent de volledige geschiedenis van het verwijderde bestand.

Let op: het verwijderen van een **hele map** verplaatst deze naar de prullenbak van het besturingssysteem — in dat geval is de systeemprullenbak de eerste weg terug; in Plainva vind je dan mogelijk alleen oudere snapshots van de bevatte bestanden.

## Automatische vault-back-ups (ZIP)

Daarnaast maakt Plainva een back-up van de hele vault als ZIP-bestand — standaard **dagelijks** op de achtergrond (bij het openen van de vault, als de laatste back-up ouder is dan 24 uur). Dit beschermt je zelfs als de vault-map zelf verloren gaat of beschadigd raakt, omdat de ZIP's **buiten** de vault staan:

- De standaardbestemming is de app-datamap (te zien onder **Doelmap** in de instellingen; **Map openen** brengt je er direct heen).
- Via **Map kiezen…** kun je in plaats daarvan een externe schijf of een NAS kiezen; **Standaard** schakelt terug naar de app-datamap. Is de bestemming momenteel onbereikbaar (NAS uit), dan meldt de statusbalk dit rustig en probeert Plainva het later opnieuw.
- **Te bewaren back-ups** (standaard: 7) begrenst het aantal; oudere ZIP's van dezelfde vault worden automatisch verwijderd. Bestanden van derden in de doelmap worden nooit aangeraakt.
- **Nu back-uppen** start op elk moment handmatig een back-up; de statusbalk toont het verloop en het resultaat.

De ZIP-bestanden heten `VaultName_2026-07-05_14-30-00.zip` en bevatten alle notities, bijlagen en je `.obsidian`-configuratie — ze bevatten **niet** de interne `.plainva`-map (de zoekindex wordt bij de volgende keer openen opnieuw opgebouwd; bestandsversies maken bewust geen deel uit van de ZIP).

**Herstellen vanuit een ZIP:** de ZIP is een heel gewoon archief. Pak hem uit op een willekeurige locatie en open de uitgepakte map in Plainva als vault — klaar.

## Instellingen in één oogopslag

Instellingen → **Vault** → **Backup & versiegeschiedenis**:

| Instelling | Standaard | Betekenis |
|---|---|---|
| **Automatische vault-back-up (ZIP)** | Aan | Dagelijkse ZIP op de achtergrond |
| **Doelmap** | App-datamap | Waar de ZIP's worden opgeslagen, vrij te kiezen |
| **Te bewaren back-ups** | 7 | Zoveel ZIP's blijven bewaard |
| **Snapshot-interval** | 2 min | Hoogstens zo vaak ontstaat er tijdens het typen een nieuwe bestandsversie |
| **Versies per bestand** | 100 | Bovengrens per bestand |
| **Maximale leeftijd** | 90 dagen | Oudere versies worden permanent verwijderd |

## Goed om te weten

- Bestandsversies zijn gewone kopieën onder `.plainva/backups/` — in geval van nood kun je ze ook zonder Plainva openen in elke bestandsbeheerder.
- Plainva's eigen sync draagt `.plainva` nooit over. Synchroniseer je de vault-map met een externe client (bijv. de Nextcloud-app), dan gaan de snapshots wel mee — dat kost wat opslagruimte, maar is verder onschadelijk.
- Sync-conflicten zijn bovendien beschermd via `.CONFLICT`-bestanden (zie de [FAQ](FAQ.md)); de versiegeschiedenis vult dit aan met de tijdlijn van elk bestand.
