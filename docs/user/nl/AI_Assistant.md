# AI-assistent (Beta)

Laatst bijgewerkt: 2026-09-24

Plainva kan vragen over je notities beantwoorden met een AI-model van jouw keuze. Het leest je vault, noemt de notities waarop het zich baseert en kan notities en weergaven voor je openen — het verandert niets. De assistent is **experimenteel** en staat uit totdat je hem inschakelt, apart op elk apparaat.

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

De notitie die je open hebt staan, gaat automatisch mee; verwijder haar met het kruisje ✕ uit de context als je wilt. **Notitie vastzetten…** voegt nog meer notities toe. De assistent kan ook zelf dingen opzoeken: hij doorzoekt de vault, leest notities en de secties ervan, somt taken op en opent notities en weergaven. Hij kan niets veranderen, aanmaken of verwijderen.

Elk gesprek begint met de regel “Antwoorden worden geschreven door een AI — ⟨model⟩ via ⟨provider⟩”. Onder elk antwoord staat een regel die zegt wat waarheen is verzonden: hoeveel notities, ongeveer hoeveel tokens en — waar de provider prijzen publiceert — de geschatte kosten. **Stoppen** beëindigt een antwoord op elk moment.

Een link in een antwoord opent pas nadat je het adres ervan hebt bevestigd, en afbeeldingen in antwoorden worden nooit geladen.

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
- De assistent leest; wijzigingen voorstellen als suggesties komt in een latere versie.
