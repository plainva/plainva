# Beveiliging en delen

Laatst gecontroleerd: 2026-07-22

Plainva houdt de vault als leesbare bestanden op je apparaat en bewaart de cloudkopie als ondoorzichtige versleutelde objecten. Open na het verbinden van een account **Instellingen → je vault → Beveiliging en delen**.

## Instellen

1. Kies een eigenaar- en apparaatnaam. Sleutels blijven in de systeemsleutelhanger of, als die ontbreekt, onder een lokale wachtzin.
2. Sla het `.pvrecovery`-bestand op, bewaar de herstelcode apart en voer de twee gevraagde groepen in. Beide delen zijn nodig en bevatten geen cloudgegevens.
3. Activeer de workspace. Plainva publiceert het ondertekende beleid en versleutelt alle bestanden naar `.pvws/`. De lokale vault blijft leesbaar en migratie wordt na onderbrekingen hervat.

Oude platte tekst blijft tijdens migratie naast `.pvws/` staan. Pas bij **Beveiligd** kun je die expliciet verwijderen; lokale bestanden worden nooit verwijderd.

Offline wijzigingen blijven in een duurzame wachtrij. Verwijderingen vereisen ondertekende tombstones en parallelle wijzigingen blijven als `.CONFLICT-…`-kopieën bewaard. Extra apparaten, herstel, teams en slices volgen later.
