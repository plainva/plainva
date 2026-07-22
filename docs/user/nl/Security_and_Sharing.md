# Beveiliging en delen

## Beveiligingscentrum, hercodering en gepubliceerde slices

Het dashboard volgt de mockups met herstel-, apparaat- en teamkaarten; een actie opent zo nodig de vault, verbinding, configuratie of ontgrendeling. Intrekken kan een hervatbare volledige hercodering starten. Maak een Vault Slice via **Details → Inhoud → Rechten → Controleren**. Externe publicaties leven in een aparte versleutelde workspace; de opgeschoonde projectie verwijdert privé-eigenschappen, uitgesloten links en embeds. Publieke release wacht op onafhankelijke cryptobeoordeling en echte Android/iOS-tests.

Laatst gecontroleerd: 2026-07-22

Plainva houdt de vault als leesbare bestanden op je apparaat en bewaart de cloudkopie als ondoorzichtige versleutelde objecten. Open na het verbinden van een account **Instellingen → je vault → Beveiliging en delen**.

## Instellen

1. Kies een eigenaar- en apparaatnaam. Sleutels blijven in de systeemsleutelhanger of, als die ontbreekt, onder een lokale wachtzin.
2. Sla het `.pvrecovery`-bestand op en bewaar de getoonde herstelcode afzonderlijk. Elk codeblok heeft een zichtbaar groepsnummer; voer de waarden van de twee gemarkeerde groepen in om te bevestigen dat de back-up leesbaar is. Beide delen zijn nodig en bevatten geen cloudgegevens.
3. Activeer de workspace. Plainva publiceert het ondertekende beleid en versleutelt alle bestanden naar `.pvws/`. De lokale vault blijft leesbaar en migratie wordt na onderbrekingen hervat.

Oude platte tekst blijft tijdens migratie naast `.pvws/` staan. Pas bij **Beveiligd** kun je die expliciet verwijderen; lokale bestanden worden nooit verwijderd.

Offline wijzigingen blijven in een duurzame wachtrij. Verwijderingen vereisen ondertekende tombstones en parallelle wijzigingen blijven als `.CONFLICT-…`-kopieën bewaard.

## Apparaten en herstel

Een nieuw mobiel apparaat maakt een QR-/codeverzoek. Voer de korte code in op een al goedgekeurde desktop en vergelijk de vingerafdrukken vóór bevestiging. Een verwijderd apparaat kan geen nieuwe geldige wijzigingen ondertekenen. Als alle apparaten verloren zijn, maakt **Toegang herstellen** met het `.pvrecovery`-bestand en de apart bewaarde code een nieuw eigenaarsapparaat zonder inhoud te herschrijven. **Herstel vernieuwen** verankert een nieuwe dubbel ondertekende identiteit en maakt de oude set ongeldig.

## Leden, rollen en slices

Eigenaren en beheerders kunnen leden uitnodigen, groepen maken en een rol beperken tot de hele workspace, een slice of één object. Editor bewerkt, Commenter reageert, Reader leest alleen en Contributor maakt alleen nieuwe inhoud in het toegewezen bereik. De controle gebeurt vóór elke lokale schrijfactie en opnieuw vóór ondertekening, ook bij import, herstel, automatisering en AI-acties.

Een slice bevat een map, een selectie of een dynamische regel op pad, type, tags en eigenschappen. Gebruik altijd **Preview** vóór publicatie. Onbevoegde objecten worden niet gematerialiseerd en komen niet in zoeken, grafiek of previews terecht.

## Opmerkingen, versies en quarantaine

Opmerkingen en oplossingsmarkeringen zijn versleuteld en ondertekend. **Versiegeschiedenis** leest versleutelde revisies en herstelt een versie als nieuwe ondertekende wijziging of kopie. Een ongeldig extern artefact wordt geïsoleerd onder **Integriteit en lokale forks**: probeer opnieuw, exporteer ciphertext, markeer gerepareerd of negeer. Het blokkeert de overige synchronisatie niet en externe afwezigheid betekent nooit verwijdering.
