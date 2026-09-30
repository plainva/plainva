# AI-assistent (Beta)

Laatst bijgewerkt: 2026-09-30

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

1. Kies in **AI & automatisering** voor **Provider toevoegen** en kies er een. Elk item draagt een korte opmerking over de voorwaarden — bijvoorbeeld dat bij de gratis toegang van Google mensen je invoer kunnen lezen.
2. Voer de sleutel in met **Sleutel invoeren**. De sleutel gaat naar de beveiligde opslag van dit apparaat; Plainva toont hem nooit meer — niet aan de AI en niet op het scherm.
3. **Verbinding testen** laadt de eigen modellijst van de provider. Mislukt dit, dan vermeldt de melding waarom (een geweigerde sleutel, geen verbinding, een onbekend model).

Een **OpenAI-compatibele server** voeg je toe via het adres ervan. Plainva vraagt vlak voor het toevoegen nog een keer om bevestiging, in een venster van het besturingssysteem, en verzendt alleen naar het adres dat je hebt bevestigd. Onversleuteld `http` werkt alleen voor een server op dit apparaat; voor al het andere is `https` nodig.

Heb je nog geen sleutel: een model op deze computer (Ollama, LM Studio) kost niets, en de console van elke provider geeft sleutels uit.

## Modellen en profielen

Vier profielen — **Snel**, **Gebalanceerd**, **Sterk** en **Lokaal** — zijn jouw toewijzing van modellen. Kies voor elk een provider en een model, uit de lijst van de provider of door de model-ID precies zo in te typen als de provider die noemt. **Standaard voor nieuwe gesprekken** bepaalt met welk profiel een nieuw gesprek begint. Plainva noemt geen enkel model “het beste”.

## Vragen

- **Desktop:** de AI-knop in de actiebalk, **Ctrl+J** (⌘J onder macOS) of **AI vragen** in het opdrachtenpalet opent de begeleider — een klein venster boven je werk. **Als tabblad openen** verplaatst hetzelfde gesprek naar het AI-tabblad, waar je gesprekken staan vermeld.
- **Telefoon:** **AI vragen** in het ⋮-menu van een notitie opent het AI-blad over die notitie. Het onderdeel **AI** (in het onderdelenblad, of in de navigatiebalk als je het daar neerzet) toont het gesprek op volledig scherm; **Gesprekken** toont de eerdere gesprekken.
- **Naast de notitie:** op de desktop is hetzelfde gesprek de laatste sectie van de rechterzijbalk, **AI**. Op een telefoon of tablet is het het tabblad **AI** in de context van de notitie — naast **Eigenschappen** en **Backlinks** —, die een tablet naast de notitie toont.

De notitie die je open hebt staan, gaat automatisch mee; verwijder haar met het kruisje ✕ uit de context als je wilt. **Notitie vastzetten…** voegt nog meer notities toe. De assistent kan ook zelf dingen opzoeken: hij doorzoekt de vault, leest notities en de secties ervan, databases, backlinks en gelinkte notities, somt taken, afspraken en de onlangs geopende of gewijzigde notities op en opent notities en weergaven. Hij kan niets veranderen, aanmaken of verwijderen.

Elk gesprek begint met de regel “Antwoorden worden geschreven door een AI — ⟨model⟩ via ⟨provider⟩”. Onder elk antwoord staat een regel die zegt wat waarheen is verzonden: hoeveel notities, ongeveer hoeveel tokens en — waar de provider prijzen publiceert — de geschatte kosten. **Stoppen** beëindigt een antwoord op elk moment.

Een link in een antwoord opent pas nadat je het adres ervan hebt bevestigd, en afbeeldingen in antwoorden worden nooit geladen.

## Wat er meegaat

Bij elke vraag stelt Plainva samen wat ertoe kan doen — op dit apparaat, voordat er iets wordt verzonden:

- **Waar je bent:** datum en tijd, de notitie of database die je open hebt en je selectie daarin, je open tabbladen, taken die in de komende week vervallen, de volgende afspraken en de dagnotitie van vandaag.
- **Notities die ertoe kunnen doen:** gevonden via je woorden, de links van de open notitie en wat je onlangs hebt geopend of gewijzigd. Eerst beslissen je privacyregels; alleen de notities die zij toestaan, worden überhaupt beoordeeld. Een paar gaan mee als secties — niet als hele notities —, andere alleen met hun titel en een zoekfragment of alleen met hun naam; de assistent leest er meer van als hij dat nodig heeft.

Een notitie die het gesprek al bevat en die sindsdien niet is veranderd, wordt genoemd, niet opnieuw verzonden. Plaatsen uit je journaal en stemmingswaarden worden nooit uit zichzelf verzonden.

## Voordat er iets wordt verzonden

Het eerste verzoek van een sessie toont een overzicht: waar het heen gaat (provider en model), welke notities en welk deel ervan, wat er verder meegaat (je selectie, afspraken, taken), wat is achtergehouden en ongeveer hoeveel tokens. **Verzenden** verzendt het; **Annuleren** verzendt niets en geeft je woorden terug in het invoerveld; de − naast een notitie laat haar weg. Binnen wat je hebt goedgekeurd, gaan de volgende verzoeken zonder vraag. Het overzicht komt terug zodra de reikwijdte groeit: een ander model of een andere provider, een nieuw soort gegevens, notities uit een andere map, nieuwe hulpmiddelen of een veel groter verzoek. Een model op dit apparaat vraagt nooit.

Wil je het overzicht vóór elk verzoek zien, zet dan **Vragen vóór elk verzoek** aan — in het overzicht zelf of in **Instellingen → AI & automatisering** onder **Verzenden**.

De regel onder elk antwoord opent het overzicht van wat ermee meeging. Noemt een antwoord geen van de verzonden notities, dan zegt een melding boven die regel dat; controleer het antwoord dan aan de notities.

## Context bekijken

Het oog onder het invoerveld, **Context bekijken**, toont wat het volgende verzoek zou meenemen — voordat het gaat, voor het model dat nu is gekozen. Bij elke notitie: waarom ze is gekozen (nu open, vastgezet, past bij je woorden, gelinkt, binnenkort …), welk deel meegaat en ongeveer hoeveel tokens. Elke notitie kun je

- weglaten uit het volgende verzoek (**Weer opnemen** haalt haar terug),
- aan het gesprek vastzetten,
- voorgoed op dit apparaat houden: dat schrijft de regel `cloud: deny` in de notitie (zie hieronder).

Notities die je regels achterhouden, staan er ook, zodat je weet wat er ontbreekt; ze worden nooit beoordeeld en nooit verzonden. **Met deze context verzenden** verzendt wat je hebt getypt. In een breed AI-tabblad blijft de weergave als kolom naast het gesprek open.

## Met een selectie

Selecteer tekst in een notitie, en de AI werkt alleen met die passage.

- **Desktop:** tijdens het bewerken biedt **AI** in de selectiebalk **Als voorstel** — **Herschrijven**, **Inkorten**, **Vertalen…**, **Taken ervan maken** — en **In de begeleider** — **Uitleggen** en **Vraag over de selectie…** (**Ctrl+J**, ⌘J onder macOS).
- **Telefoon:** **AI** in de balk boven een selectie — bij lezen en bij bewerken — opent het AI-blad.
- **In elk gesprek:** zolang er in de geopende notitie tekst is geselecteerd, biedt de rij **Met de selectie** boven de invoer dezelfde acties.

Een voorstelactie verzendt alleen de geselecteerde passage — niet de rest van de notitie, geen vastgezette notities, geen tools — en vraagt met hetzelfde overzicht als een vraag. Het antwoord komt als een ronde voorstellen in de notitie, net als die van een persoon: onder **Voorstellen** accepteer of wijs je elke wijziging of de hele ronde af, en daarvoor verandert er niets in de notitie. De auteursregel van de ronde luidt **Plainva AI · ⟨model⟩**, zodat zichtbaar blijft welke passage een AI schreef. **Taken ervan maken** zet de taken onder de passage in plaats van die te vervangen. Elke actie bewaart haar gesprek in de geschiedenis.

Een passage uit een notitie die je regels bij de cloud weghouden — of een met links naar zulke notities of met plaatsgegevens — gaat naar geen enkel cloudmodel. In een versleutelde workspace zijn de voorstelacties nog niet beschikbaar: de voorstellen daarin kunnen de AI nog niet als auteur noemen.

## Privacyregels

Sommige notities mogen nooit bij een cloudprovider terechtkomen. Een regel kan in de frontmatter van een notitie staan:

```yaml
plainva:
  ai:
    cloud: deny
```

of, voor een hele map, in **Instellingen → AI & automatisering** (het Vault-deel), dat de regels naar `.agent/policy.yml` schrijft. Een notitie die van de cloud wordt weggehouden draagt niets bij — geen tekst en geen titel —, en links ernaartoe in andere notities worden achtergehouden. Modellen op dit apparaat blijven toegestaan. Versleutelde workspaces sluiten de cloud uit, tenzij je die daar toestaat. Het exacte formaat staat in de [Bestandsformaat-referentie](File_Format_Reference.md).

## Geschiedenis en verbruik

Gesprekken blijven op dit apparaat, per vault — nooit in de vault en nooit gesynchroniseerd. **Gesprekken bewaren** bepaalt hoe lang; je kunt losse gesprekken in de lijst verwijderen, of alle gesprekken van een vault in één keer. **Verbruik deze maand** telt de tokens per provider en model op.

## Grenzen van de beta

- Op de desktop werkt de AI alleen in het hoofdvenster.
- Op de telefoon komt een antwoord alleen terwijl de app open staat.
- De assistent verandert zelf niets: hij stelt alleen wijzigingen voor aan een geselecteerde passage, als voorstellen die je accepteert of afwijst.
