# Beveiliging en delen

## Beveiligingscentrum, hercodering en gepubliceerde slices

**Beveiliging en delen** heeft twee niveaus. Het **Overzicht** (eerste niveau) toont de beschermingsstatus, **Migratie afronden** wanneer er nog platte tekst overblijft, **Verbinding met de versleutelde cloud verwijderen**, en twee kaarten die het tweede niveau openen — **Apparaten en herstel** en **Delen met anderen**. Op het tweede niveau vervangt de gebiedsnavigatie de linkerkolom met instellingen, gegroepeerd in **Jouw toegang** (Apparaten, herstel) en **Delen** (Leden, groepen, slices, publicaties); **‹ Overzicht** keert terug naar het eerste niveau. Zichtbare acties blijven bruikbaar: een actie opent zo nodig de vault, verbinding, configuratie of ontgrendeling. Intrekken kan een hervatbare volledige hercodering starten. Maak een Vault Slice via **Details → Inhoud → Rechten → Controleren**. Externe publicaties leven in een aparte versleutelde workspace; de opgeschoonde projectie verwijdert privé-eigenschappen, uitgesloten links en embeds. Publieke release wacht op onafhankelijke cryptobeoordeling en echte Android/iOS-tests.

Laatst gecontroleerd: 2026-07-23

Plainva houdt de vault als leesbare bestanden op je apparaat en bewaart de cloudkopie als ondoorzichtige versleutelde objecten. Open na het verbinden van een account **Instellingen → je vault → Beveiliging en delen**.

## Instellen

1. Kies een eigenaar- en apparaatnaam. Sleutels blijven in de systeemsleutelhanger of, als die ontbreekt, onder een lokale wachtzin.
2. Sla het `.pvrecovery`-bestand op en bewaar de getoonde herstelcode afzonderlijk. Elk codeblok heeft een zichtbaar groepsnummer; voer de waarden van de twee gemarkeerde groepen in om te bevestigen dat de back-up leesbaar is. Beide delen zijn nodig en bevatten geen cloudgegevens.
3. Activeer de workspace. Plainva publiceert het ondertekende beleid en versleutelt alle bestanden naar `.pvws/`. De lokale vault blijft leesbaar en migratie wordt na onderbrekingen hervat.

Oude platte tekst blijft tijdens migratie naast `.pvws/` staan. Pas bij **Beveiligd** kun je die expliciet verwijderen; lokale bestanden worden nooit verwijderd.

Offline wijzigingen blijven in een duurzame wachtrij. Verwijderingen vereisen ondertekende tombstones en parallelle wijzigingen blijven als `.CONFLICT-…`-kopieën bewaard.

## Apparaten en herstel

Om **je eigen** tweede apparaat toe te voegen, open je **Apparaten en herstel → Apparaten → Nog een apparaat toevoegen**: Plainva toont een uitnodigingscode die aan je eigen lidmaatschap is gekoppeld — het maakt **geen** nieuw lid aan. Plak die op het tweede apparaat (**Beveiliging en delen → deelnemen**) en keur hem goed op een apparaat dat al lid is; vergelijk eerst de vingerafdruk op beide apparaten. Wil je in plaats daarvan iemand anders toevoegen, gebruik dan **Delen met anderen → Leden → Iemand uitnodigen** (zie hieronder). Een verwijderd apparaat kan geen nieuwe geldige wijzigingen ondertekenen. De uitnodiging en het koppelingsverzoek van een deelnemend apparaat worden ook als scanbare QR-codes getoond — op mobiel leest **Uitnodiging scannen** een code met de camera in plaats van tekst te plakken.

Herstel staat onder **Apparaten en herstel → Herstel**, verdeeld over **Huidige status** (is er een herstelpakket opgeslagen, en de vingerafdruk van de workspace) en het **Herstelproces**. Als alle apparaten verloren zijn, kies daar dan **Toegang herstellen** en open het `.pvrecovery`-bestand met de apart bewaarde code; Plainva maakt een nieuw eigenaarsapparaat, kan de verloren apparaten intrekken en herschrijft geen inhoudsobjecten. **Herstel vernieuwen** vervangt de oude herstelset via een dubbel ondertekende ankerketen. Bewaar het nieuwe bestand en de code opnieuw apart; de oude set is daarna ongeldig.

## Leden, rollen en slices

Eigenaren en beheerders kunnen leden uitnodigen, groepen maken en een rol beperken tot de hele workspace, een slice of één object. Editor bewerkt, Commenter reageert, Reader leest alleen en Contributor maakt alleen nieuwe inhoud in het toegewezen bereik. De controle gebeurt vóór elke lokale schrijfactie en opnieuw vóór ondertekening, ook bij import, herstel, automatisering en AI-acties.

Een slice bevat een map, een selectie of een dynamische regel op pad, type, tags en eigenschappen. Gebruik altijd **Preview** vóór publicatie. Onbevoegde objecten worden niet gematerialiseerd en komen niet in zoeken, grafiek of previews terecht.

## Opmerkingen, versies en quarantaine

Opmerkingen en oplossingsmarkeringen zijn versleuteld en ondertekend. **Versiegeschiedenis** leest versleutelde revisies en herstelt een versie als nieuwe ondertekende wijziging of kopie. Een ongeldig extern artefact wordt geïsoleerd onder **Integriteit en lokale forks**: probeer opnieuw, exporteer ciphertext, markeer gerepareerd of negeer. Het blokkeert de overige synchronisatie niet en externe afwezigheid betekent nooit verwijdering.

## Een versleutelde vault correct verwijderen

Wanneer je een versleutelde vault niet meer nodig hebt, stel je hem in Plainva buiten gebruik **voordat** je de cloudmap verwijdert. De volgorde is belangrijk: de fail-closed-bescherming houdt de synchronisatie gestopt als de cloudkopie verdwijnt terwijl Plainva de verbinding nog als versleuteld verwacht — dat beschermt je tegen een aanvaller die de versleuteling weghaalt om platte tekst af te dwingen.

1. Open **Instellingen → je vault → Security & Sharing**.
2. Kies in het overzicht, in de kaart **Versleuteling**, **Verbinding met de versleutelde cloud verwijderen**. Plainva wist de lokale sleutels en workspacegegevens op dit apparaat en heropent de vault als een gewone vault. (Dit is apparaatlokaal; een globale actie "versleuteling opheffen" die ook de cloudkopie terugschrijft naar platte tekst is een aparte actie die later wordt toegevoegd.)
3. Pas daarna verwijder je de cloudmap (de `.pvws/`-objecten) bij je provider als je die weg wilt hebben. Plainva verwijdert de versleutelde cloudobjecten niet voor je.

Als je de cloudkopie al hebt verwijderd en de synchronisatie nu faalt met een fout "workspace ontbreekt" of "manifest ontbreekt", is de oplossing dezelfde reset, aangeboden waar de fout verschijnt:

- Voor een versleutelde **workspace** open je **Security & Sharing**. De status toont een fout met een herstelnotitie; kies in de kaart **Versleuteling** de optie **Verbinding met de versleutelde cloud verwijderen** om de workspace op dit apparaat te resetten zodat de synchronisatie weer werkt.
- Voor een inhoud-versleutelde **synchronisatieverbinding** klik je op de synchronisatiestatus om het foutdialoogvenster te openen en kies je **Versleuteling opnieuw instellen**. Deze knop verschijnt alleen wanneer de externe versleutelingsgegevens ontbreken of ongeldig zijn.

Beide acties zijn expliciet en worden bevestigd. Plainva zet een versleutelde verbinding nooit stilzwijgend terug naar platte tekst, en geen van beide acties verwijdert lokale bestanden. Als de cloud nog versleutelde inhoud bevat die je echt wilt, annuleer dan juist — resetten zou de synchronisatie in platte tekst hervatten.

Een vault verwijderen met **App-gegevens vergeten** (Splash → een vault verwijderen → ook app-gegevens vergeten) wist ook deze versleutelingsmarkeringen, zodat een zo verwijderde vault niets achterlaat dat een latere herverbinding kan blokkeren.
