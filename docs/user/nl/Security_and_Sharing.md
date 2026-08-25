# Beveiliging en delen

> **Experimenteel — nog niet onafhankelijk beoordeeld.** Versleutelde workspaces worden als preview uitgeleverd. Het cryptografische ontwerp is nog niet door een onafhankelijke beoordelaar geauditeerd, en het bewijs met twee apparaten op echte Android- en iOS-hardware wordt nog verzameld. Probeer het gerust, maar houd een back-up van alles wat je niet kwijt mag raken, en vertrouw er nog niet op voor materiaal dat echt beschermd moet zijn.

## Beveiligingscentrum, hercodering en gepubliceerde slices

**Beveiliging en delen** heeft twee niveaus. Het **Overzicht** (eerste niveau) toont de beschermingsstatus, **Migratie afronden** wanneer er nog platte tekst overblijft, **Verbinding met de versleutelde cloud verwijderen**, en twee kaarten die het tweede niveau openen — **Apparaten en herstel** en **Delen met anderen**. Op het tweede niveau vervangt de gebiedsnavigatie de linkerkolom met instellingen, gegroepeerd in **Jouw toegang** (Apparaten, herstel) en **Delen** (Leden, groepen, slices, publicaties); **‹ Overzicht** keert terug naar het eerste niveau. Zichtbare acties blijven bruikbaar: een actie opent zo nodig de vault, verbinding, configuratie of ontgrendeling. Intrekken kan een hervatbare volledige hercodering starten. Maak een Vault Slice via **Details → Inhoud → Rechten → Controleren**. Externe publicaties leven in een aparte versleutelde workspace; de opgeschoonde projectie verwijdert privé-eigenschappen, uitgesloten links en embeds. Publieke release wacht op onafhankelijke cryptobeoordeling en echte Android/iOS-tests.

Maak een Vault Slice met de vier stappen **Details → Inhoud → Rechten → Controleren**. **Een slice publiceren naar andere mensen is gepland en nog niet beschikbaar:** de wizard toont de opties zodat je ziet wat eraan komt, maar ze zijn uitgeschakeld en er verlaat niets de vault. Zodra publiceren er is, leeft een externe publicatie in een eigen versleutelde workspace-naamruimte, verwijderen opgeschoonde projecties privé-eigenschappen uit de frontmatter, neutraliseren ze links naar uitgesloten notities en laten ze uitgesloten embeds weg, en zijn rechten van Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV en S3 extra bescherming, nooit een vervanging voor versleutelde rollen. Publieke release blijft geblokkeerd totdat de onafhankelijke cryptobeoordeling en echt bewijs met twee apparaten op Android/iOS zijn vastgelegd.

Laatst gecontroleerd: 2026-08-25

Plainva houdt de vault als leesbare bestanden op je apparaat en bewaart de cloudkopie als ondoorzichtige versleutelde objecten. Open na het verbinden van een account **Instellingen → je vault → Beveiliging en delen**.

Op mobiel noemt het onderdeel eerst de werkelijke staat van deze kluis: **Alleen op dit apparaat** zonder cloudverbinding, **Deze verbinding is niet versleuteld** bij een gewone cloudkluis — **Versleuteling instellen** doorloopt daar dezelfde drie stappen als op de desktop (identiteit → herstelbestand en code → activering met hervatbare voortgang) — of de stappen om lid te worden zodra de verbinding een versleutelde werkruimte bevat.

## Instellen

1. Kies een eigenaar- en apparaatnaam. Sleutels blijven in de systeemsleutelhanger of, als die ontbreekt, onder een lokale wachtzin.
2. Sla het `.pvrecovery`-bestand op en bewaar de getoonde herstelcode afzonderlijk. Elk codeblok heeft een zichtbaar groepsnummer; voer de waarden van de twee gemarkeerde groepen in om te bevestigen dat de back-up leesbaar is. Beide delen zijn nodig en bevatten geen cloudgegevens.
3. Activeer de workspace. Plainva publiceert het ondertekende beleid en versleutelt alle bestanden naar `.pvws/`. De lokale vault blijft leesbaar en migratie wordt na onderbrekingen hervat.

Oude platte tekst blijft tijdens migratie naast `.pvws/` staan. Pas bij **Beveiligd** kun je die expliciet verwijderen; lokale bestanden worden nooit verwijderd.

## Dagelijks gebruik

Offline wijzigingen blijven in een duurzame wachtrij staan. Elke wijziging wordt ondertekend; een verwijdering op afstand alleen wist nooit een lokaal bestand, een ondertekende grafsteen wel. Parallelle offline bewerkingen blijven bewaard als `.CONFLICT-…`-kopieën. **Vergrendelen** haalt de workspace-sleutels uit de huidige sessie; **Ontgrendelen** gebruikt de systeemsleutelhanger of de lokale wachtwoordzin.

## Apparaten en herstel

Om **je eigen** tweede apparaat toe te voegen, open je **Apparaten en herstel → Apparaten → Nog een apparaat toevoegen**: Plainva toont een uitnodigingscode die aan je eigen lidmaatschap is gekoppeld — het maakt **geen** nieuw lid aan. Plak die op het tweede apparaat (**Beveiliging en delen → deelnemen**) en keur hem goed op een apparaat dat al lid is; vergelijk eerst de vingerafdruk op beide apparaten. Wil je in plaats daarvan iemand anders toevoegen, gebruik dan **Delen met anderen → Leden → Iemand uitnodigen** (zie hieronder). Een verwijderd apparaat kan geen nieuwe geldige wijzigingen ondertekenen. De uitnodiging en het koppelingsverzoek van een deelnemend apparaat worden ook als scanbare QR-codes getoond — op mobiel leest **Uitnodiging scannen** een code met de camera in plaats van tekst te plakken.

Een apparaat of een lid verwijderen heeft twee mogelijke kosten, en de telefoon biedt ze allebei ook. **Alleen voortaan** beëindigt meteen de toegang tot nieuwe sleutels en is snel. **Alles opnieuw versleutelen** herschrijft ook alles wat al versleuteld is; dat is langdurig werk, gaat door op de achtergrond en pakt zichzelf weer op na een herstart — de statuskaart telt ondertussen de objecten. Geen van beide kan iets terughalen wat de andere kant al heeft gedownload, en daarom staat dat er al bij voordat je kiest. Je kunt het apparaat dat je in handen hebt nooit verwijderen: dat zou dit apparaat buitensluiten, met alleen het herstelpakket over.

Herstel staat onder **Apparaten en herstel → Herstel**, verdeeld over **Huidige status** (is er een herstelpakket opgeslagen, en de vingerafdruk van de workspace) en het **Herstelproces**. Als alle apparaten verloren zijn, kies daar dan **Toegang herstellen** en open het `.pvrecovery`-bestand met de apart bewaarde code; Plainva maakt een nieuw eigenaarsapparaat, kan de verloren apparaten intrekken en herschrijft geen inhoudsobjecten. **Herstel vernieuwen** vervangt de oude herstelset via een dubbel ondertekende ankerketen. Bewaar het nieuwe bestand en de code opnieuw apart; de oude set is daarna ongeldig. Plainva vraagt het eerst, want het bestand dat je in handen hebt, werkt vanaf dat moment niet meer.

## Leden, rollen en slices

Eigenaren en beheerders kunnen leden uitnodigen, groepen maken en een rol beperken tot de hele workspace, een slice of één object. Editor bewerkt, Commenter reageert, Reader leest alleen en Contributor maakt alleen nieuwe inhoud in het toegewezen bereik. De controle gebeurt vóór elke lokale schrijfactie en opnieuw vóór ondertekening, ook bij import, herstel, automatisering en AI-acties.

Eigendom kan overgaan naar een ander actief lid. Open **Delen met anderen → Leden** (op mobiel: het onderdeel **Team**) en kies **Eigendom overdragen** naast die persoon. Dat vereist het huidige herstelbestand en de bijbehorende code, omdat eigendom en de herstelset samen verhuizen: Plainva maakt eerst een vervangend herstelpakket en draagt het pas over nadat je het hebt opgeslagen. Geef dat bestand en de nieuwe code via gescheiden kanalen aan de nieuwe eigenaar — je wordt Admin, en die persoon wordt daarna de enige Owner.

Een slice bevat een map, een selectie of een dynamische regel op pad, type, tags en eigenschappen. Gebruik altijd **Preview** vóór publicatie. Onbevoegde objecten worden niet gematerialiseerd en komen niet in zoeken, grafiek of previews terecht.

## Opmerkingen, versies en quarantaine

Commenter krijgt een alleen-lezen editor met een opmerkingengebied. Opmerkingen en oplossingsmarkeringen zijn zelf versleutelde, ondertekende workspace-objecten. **Versiegeschiedenis** leest versleutelde workspace-revisies en herstelt een oudere revisie als nieuwe ondertekende wijziging of als kopie.

Ongeldige externe artefacten worden afzonderlijk geïsoleerd onder **Integriteit en lokale forks**. Je kunt ze opnieuw proberen, hun ciphertext exporteren, een extern gerepareerd artefact als gerepareerd markeren, of het bewust negeren. Eén ongeldig bestand blokkeert de rest van een geldige synchronisatie niet, en externe afwezigheid alleen betekent nooit verwijdering. Een wijziging van een lokaal programma zonder schrijfrecht blijft bewaard als een privé-forkkopie.

## Een versleutelde vault correct verwijderen

Wanneer je een versleutelde vault niet meer nodig hebt, stel je hem in Plainva buiten gebruik **voordat** je de cloudmap verwijdert. De volgorde is belangrijk: de fail-closed-bescherming houdt de synchronisatie gestopt als de cloudkopie verdwijnt terwijl Plainva de verbinding nog als versleuteld verwacht — dat beschermt je tegen een aanvaller die de versleuteling weghaalt om platte tekst af te dwingen.

1. Open **Instellingen → je vault → Security & Sharing**.
2. Kies in het overzicht, in de kaart **Versleuteling**, **Verbinding met de versleutelde cloud verwijderen**. Plainva wist de lokale sleutels en workspacegegevens op dit apparaat en heropent de vault als een gewone vault. (Dit is apparaatlokaal: de cloudkopie blijft versleuteld. Wil je die weer als platte tekst, dan is **Versleuteling opheffen** de weg — zie de alinea hieronder.)
3. Pas daarna verwijder je de cloudmap (de `.pvws/`-objecten) bij je provider als je die weg wilt hebben. Plainva verwijdert de versleutelde cloudobjecten niet voor je.

Op mobiel zit dezelfde stap op dezelfde plek, met één verschil: je bevestigt hem door de naam van de vault te typen. De rest is identiek — de lokale sleutels en workspacegegevens verdwijnen, de vault heropent als een gewone vault, en de versleutelde objecten in de cloud blijven staan tot je ze zelf verwijdert. Het werkt zonder verbinding, omdat er niets op afstand gebeurt.

Om in plaats daarvan **de versleuteling volledig op te heffen en de vault als gewone bestanden in de cloud te bewaren**, kies je **Versleuteling opheffen** in dezelfde kaart **Versleuteling**: Plainva opent de vault weer als een normale cloud-vault en uploadt al je notities opnieuw naar dezelfde cloud als platte bestanden, en stopt daarna met versleutelen. Lokale bestanden worden nooit gewijzigd en er wordt niets verwijderd; de oude versleutelde map `.pvws/` blijft staan totdat je die bij je provider verwijdert (Plainva kan die onveranderlijke objecten niet voor je verwijderen). Bevestig eerst de waarschuwing — de notities verlaten de versleutelde opslag als platte tekst.

Als je de cloudkopie al hebt verwijderd en de synchronisatie nu faalt met een fout "workspace ontbreekt" of "manifest ontbreekt", is de oplossing dezelfde reset, aangeboden waar de fout verschijnt:

- Voor een versleutelde **workspace** open je **Security & Sharing**. De status toont een fout met een herstelnotitie; kies in de kaart **Versleuteling** de optie **Verbinding met de versleutelde cloud verwijderen** om de workspace op dit apparaat te resetten zodat de synchronisatie weer werkt.
- Voor een inhoud-versleutelde **synchronisatieverbinding** klik je op de synchronisatiestatus om het foutdialoogvenster te openen en kies je **Versleuteling opnieuw instellen**. Deze knop verschijnt alleen wanneer de externe versleutelingsgegevens ontbreken of ongeldig zijn.

Beide acties zijn expliciet en worden bevestigd. Plainva zet een versleutelde verbinding nooit stilzwijgend terug naar platte tekst, en geen van beide acties verwijdert lokale bestanden. Als de cloud nog versleutelde inhoud bevat die je echt wilt, annuleer dan juist — resetten zou de synchronisatie in platte tekst hervatten.

Een vault verwijderen met **App-gegevens vergeten** (Splash → een vault verwijderen → ook app-gegevens vergeten) wist ook deze versleutelingsmarkeringen, zodat een zo verwijderde vault niets achterlaat dat een latere herverbinding kan blokkeren.
