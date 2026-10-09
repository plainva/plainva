# Vaardigheden (Beta)

Laatst bijgewerkt: 2026-10-09

Een vaardigheid is een set instructies voor werk dat terugkomt: een vergadering voorbereiden, je taken ordenen, een weekoverzicht. Plainva levert er dertien mee, en je kunt je eigen schrijven. Vaardigheden gebruiken het open formaat Agent Skills — een map met een `SKILL.md` — en werken daardoor ook in andere AI-apps die dat formaat lezen.

## Een vaardigheid gebruiken

Start een vaardigheid met één klik: als chip in een leeg gesprek (de drie meest gebruikte), onder **Vaardigheden** in het AI-tabblad, op de telefoon onder **Gesprekken → Vaardigheden**, of vanuit het opdrachtenpalet. Het gesprek loopt dan met de vaardigheid: haar instructies gaan mee, en ze gebruikt alleen de hulpmiddelen en mappen die ze noemt.

Je kunt ook gewoon vragen. In elk gesprek kent de AI de namen en beschrijvingen van je actieve vaardigheden en laadt er een wanneer je vraag past — ‘bereid mijn volgende vergadering voor’ is genoeg.

## De vaardigheden die met Plainva meekomen

| Vaardigheid | Wat ze doet |
|---|---|
| **Dagoriëntatie** | Wat vandaag telt: taken die aflopen, afspraken en waar je laatst aan werkte. |
| **Weekoverzicht** | De afgelopen zeven dagen en de week die komt, met drie voorstellen. |
| **Projectstatus** | Doel, voortgang, open punten en de volgende stap van een project. |
| **Vergadering voorbereiden** | Bereidt een vergadering voor uit eerdere notities en open punten, of werkt haar achteraf uit. |
| **Taken ordenen** | Ordent je open taken: wat nu, wat kan wachten, wat kan weg. |
| **Onderzoek** | Onderzoekt een vraag op het web en in je notities, met elke bron genoemd. |
| **E-mail en agenda** | Neemt de recente e-mail en de komende afspraken door: wat een antwoord nodig heeft, wat voor te bereiden is, welke taken volgen. |
| **Schrijven en herschrijven** | Vat een notitie samen, kort haar in of herschrijft haar — als tekst die je overneemt. |
| **Kennis onderhouden** | Vindt notities die hetzelfde zeggen, verouderd zijn of nergens mee verbonden. |
| **Links opschonen** | Controleert de links van een notitie: die nergens heen leiden, ontbrekende, eenrichting. |
| **Geheugen onderhouden** | Neemt het geheugen door: items die hetzelfde zeggen, elkaar tegenspreken of verouderd zijn — en stelt een concept op van wat samengevoegd moet worden en wat eruit moet. |
| **Privacycontrole** | Vindt wat uit een notitie beter op dit apparaat blijft, en stelt een regel voor. |
| **Reflectie** | Blikt met je terug op de notities van een dag of een week — vriendelijk, nooit een diagnose. |

Ze lezen allemaal alleen: geen enkele verandert een notitie of verstuurt iets. De enige die concepten opstelt, is **Geheugen onderhouden**: wat ze voor het geheugen voorstelt, wacht tot je het overneemt. Alleen **Onderzoek** gebruikt internet, en alleen **E-mail en agenda** leest je e-mail — zie hieronder. Privacycontrole en Reflectie zijn bedoeld voor een model op dit apparaat; met een cloudmodel zegt het verzendoverzicht dat. Zet elke vaardigheid uit onder **Vaardigheden** — de schakelaar geldt voor deze vault op dit apparaat. **Eigen versie maken** kopieert er een naar je vault, waar je haar kunt aanpassen.

## Op internet en in je e-mail

**Onderzoek** is de enige meegeleverde vaardigheid die internet gebruikt. Haar starten is jouw keuze voor het gesprek, net als de wereldbol onder het invoerveld: waar je **De AI mag internet gebruiken in deze vault** hebt aangezet, zoekt ze en leest ze pagina's — en zolang je notities in het gesprek zitten, vraagt elke pagina en elke zoekopdracht nog steeds eerst, zoals beschreven onder **Op internet** in [AI-assistent](AI_Assistant.md). Waar de schakelaar uit staat, onderzoekt ze alleen in je notities en zegt ze dat. Hetzelfde geldt wanneer de AI de vaardigheid zelf laadt in een gesprek dat je zonder internet begon.

**E-mail en agenda** leest e-mail via dezelfde vraag als elk gesprek: de eerste keer **Je e-mail lezen?** Ze leest nooit zelf de tekst van een bericht; een tweede lezer zonder hulpmiddelen schrijft er een verslag over. Beide staan beschreven in [AI-assistent](AI_Assistant.md).

Een eigen vaardigheid gebruikt internet alleen als haar `allowed-tools`-regel `web_search` of `fetch_url` noemt. **Controleren en goedkeuren** zegt dan **Gebruikt internet waar je dat voor deze vault hebt toegestaan.** voordat je haar goedkeurt. Een vaardigheid die geen hulpmiddelen noemt, brengt internet nooit mee.

Een testuitvoering gebruikt nooit internet en vraagt nooit: e-mail die ze in deze sessie niet mocht lezen, blijft ongelezen.

## Wijzigingen voorstellen

Een eigen vaardigheid stelt alleen wijzigingen voor als haar `allowed-tools`-regel de hulpmiddelen daarvoor noemt: `propose_edit` en `set_property` voor voorstellen bij de tekst en de eigenschappen van een notitie, `create_note`, `create_entry`, `create_task` en `add_journal_entry` voor concepten, `rename_note`, `move_note` en `delete_note` voor plannen. **Controleren en goedkeuren** noemt ze dan elk afzonderlijk en zegt **Kan wijzigingen voorstellen, concepten klaarzetten en plannen voorleggen. In de vault verandert niets voordat je overneemt, aanmaakt of bevestigt.** Een vaardigheid die geen hulpmiddelen noemt, stelt niets voor — ook een vaardigheid die je eerder hebt goedgekeurd, krijgt er niets bij —, en een testuitvoering laat niets achter. Wat de drie vormen zijn: **Wijzigingen voorstellen** in [AI-assistent](AI_Assistant.md).

## Je eigen vaardigheden

**Nieuwe vaardigheid** vraagt om een naam, een beschrijving — daarop kiest de AI de vaardigheid — en de instructies. Plainva schrijft ze als `.agent/skills/<naam>/SKILL.md` in je vault, waar ze meereizen zoals elke notitie. **Bewerken** opent het bestand als een notitie.

**Importeren…** neemt een vaardigheid aan als `.zip`- of `.skill`-bestand. Voordat er iets wordt geschreven, controleert Plainva haar: precies één vaardigheid in het formaat, geen pad buiten haar map, de groottelimieten. Het noemt de licentie, scripts die het niet uitvoert en hulpmiddelen die het niet heeft. Verborgen bestanden — namen die met een punt beginnen — horen niet bij een vaardigheid en blijven achterwege.

## Niets draait voordat je het goedkeurt

Een vaardigheid in je vault die nieuw is of veranderd — via sync, een import of een bewerking op dit of een ander apparaat — draait pas wanneer je haar **op dit apparaat** goedkeurt. Zulke vaardigheden wachten bovenaan in **Vaardigheden** onder **Wachten op je goedkeuring**, en in **Instellingen → AI & automatisering** (het Vault-deel). **Controleren en goedkeuren** toont wat de vaardigheid mag, wat er sinds je laatste goedkeuring veranderde, haar instructies, bestanden en waar ze staat. De goedkeuring geldt precies voor deze versie; elke wijziging heft haar weer op. Goedkeuringen worden op dit apparaat bewaard, nooit in de vault.

Hetzelfde geldt voor een `AGENTS.md` bovenaan in je vault: eenmaal goedgekeurd gaan de vaste instructies mee in elk nieuw gesprek. Noch een vaardigheid noch `AGENTS.md` kan je privacyregels opheffen, en een vaardigheid krijgt nooit meer dan een gesprek heeft — ze kan het alleen beperken. Een regel die je in het geheugen toevoegt of van de AI accepteert, wordt een extra regel in dit bestand; zie [Geheugen](AI_Memory.md).

## Vaardigheden testen met een model

Een vaardigheid kan testscenario's meebrengen: een bericht dat haar start, en wat een goede uitvoering doet. De meegeleverde vaardigheden hebben ze; voor je eigen schrijf je ze in `tests/scenarios.json` in de map van de vaardigheid:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` noemt de hulpmiddelen die een goede uitvoering gebruikt en die ze niet mag aanraken; `cites` de notities die haar antwoord noemt; `never` tekst die er niet in mag voorkomen. Een vaardigheid heeft hoogstens acht scenario's.

**Testen met ⟨model⟩** — onderaan **Vaardigheden** of in het menu van een vaardigheid — laat de scenario's draaien tegen het model dat een nieuw gesprek zou gebruiken. Niets start vanzelf: het dialoogvenster zegt eerst hoeveel scenario's tegen welk model zouden draaien, en jij stelt een **Plafond** in Amerikaanse dollars in; de test eindigt tussen twee scenario's zodra het is bereikt. Is er voor het model geen prijs bekend, dan eindigt de test na een vast aantal tokens; een model op dit apparaat heeft geen plafond nodig.

Elk scenario is een gewone uitvoering van zijn vaardigheid: het leest je vault zoals een uitvoering met de hand, gaat door hetzelfde overzicht vóór het verzenden, telt mee in je verbruik en laat zijn gesprek achter in de geschiedenis, waar zijn volgende uitvoering het vervangt. Daarna toont elk scenario zijn uitkomst in woorden, en de rij van de vaardigheid zegt hoe haar laatste uitvoering verliep. Een uitkomst geldt voor één model en één versie van de vaardigheid: kies je een ander model of wijzig je de vaardigheid, dan zegt de rij dat in plaats van een uitkomst te tonen die niet meer telt. Sommige meegeleverde scenario's vragen naar notities uit Plainva's eigen testvault; in jouw vault gelden ze niet, en het dialoogvenster telt ze apart in plaats van ze als mislukt te rekenen.

## Leren van een gesprek

Een gesprek kan iets achterlaten: een feit dat het weten waard is, een regel of een vaardigheid die niet ver genoeg ging. Dat vraag je met **Leren van dit gesprek**: in het menu van een gesprek in de lijst en onder zijn laatste antwoord. Op de achtergrond leest niets je gesprekken.

Een dialoogvenster zegt eerst wat er zou gebeuren: het gesprek gaat nog één keer naar het model dat het heeft gevoerd, en naar geen ander — wat je hebt geschreven en wat er is geantwoord, met de namen van de gebruikte hulpmiddelen. Niets wat een hulpmiddel teruggaf, gaat mee, en ook geen notitie. Draaide er een eigen vaardigheid in het gesprek, dan gaan haar instructies mee, zodat een betere versie kan worden voorgesteld. **Leren** start het doornemen van het gesprek; dat kost één verzoek.

Er komen concepten terug, elk met de **Onderbouwing** die het model ervoor geeft; niets daarvan geldt voordat je het overneemt. Over een item voor het geheugen en over een regel beslis je op hun kaarten, zoals beschreven in [Geheugen](AI_Memory.md). Het concept van een vaardigheid heeft in plaats daarvan de knop **Controleren**.

Een gesprek dat een webpagina, een e-mail of een extern hulpmiddel heeft gelezen, kan alleen items voor het geheugen voorstellen: wat een vreemde heeft geschreven, wordt geen regel en geen vaardigheid. Hetzelfde geldt als het gesprek berust op notities die niet naar de cloud of niet samen met internet mogen, en items daaruit krijgen die regel mee. Een gesprek dat met een model op dit apparaat is gevoerd, wordt op dit apparaat doorgenomen.

### Een voorstel voor een vaardigheid overnemen

**Controleren** toont regel voor regel wat er zou veranderen, en wat de vaardigheid mag — dat blijft zoals het is: een voorstel wijzigt de instructies van een vaardigheid en verder niets. De hulpmiddelen, mappen en grenzen van een vaardigheid worden nooit door een model ingesteld. Het dialoogvenster zegt ook of de huidige versie is getest, wat een uitvoering meer of minder kost en uit welk gesprek het voorstel komt. **Aanpassen** maakt van de vergelijking een veld waarin je kunt typen.

**Overnemen** schrijft de nieuwe versie weg en keurt haar op dit apparaat goed, omdat je haar hier hebt gezien. Op je andere apparaten wacht de vaardigheid dan op een eigen goedkeuring, zoals na elke wijziging. Een voorstel voor een nieuwe vaardigheid begint met de standaardinstellingen van Plainva: ze leest en toont, en verandert niets. Een vaardigheid die je hebt geïmporteerd en de vaardigheden die met Plainva meekomen, worden nooit door een voorstel herschreven.

### Versies onder observatie en de weg terug

Een versie die uit een voorstel stamt, staat drie uitvoeringen lang onder observatie, en de rij van de vaardigheid telt ze. Eindigt een uitvoering zonder antwoord, dan noemt het vaardighedenscherm de vaardigheid onder **Versies onder observatie** en biedt het twee mogelijkheden aan: **Terug naar de vorige versie** of **Behouden**. Er gaat niets uit zichzelf terug.

**Eerdere versies…** in het menu van een vaardigheid toont de versies van haar bestand die de versiegeschiedenis van de vault bewaart. Het dialoogvenster vergelijkt de versie die je kiest met de vaardigheid zoals ze nu is — haar tekstregels en wat ze mag — en waarschuwt waar de eerdere versie meer mag. **Deze versie herstellen** schrijft haar terug en keurt haar op dit apparaat goed. De versies worden op dit apparaat bewaard.

Voor een vaardigheid die op een andere manier is veranderd — via sync of een bewerking op een ander apparaat — toont **Controleren en goedkeuren** hetzelfde onder **Vergeleken met de goedgekeurde versie**: welke hulpmiddelen erbij kwamen en welke wegvielen, de mappen, de grens.

Onder **Wat er is geleerd** opent het vaardighedenscherm `.agent/logs/learning.md`: één tekstregel voor elke vaardigheid en elke regel die uit een voorstel is overgenomen, met de dag en het gesprek. Het bestand reist met je vault mee.

## Opruimen

Vaardigheden stapelen zich op. Onder **Opruimen** noemt de vaardighedenweergave wat dit apparaat zelf heeft opgemerkt. Daarvoor wordt geen model geraadpleegd en niets verstuurd, en elke regel is een vraag, geen bevinding:

- Twee vaardigheden die bijna hetzelfde zeggen, zodat de AI de ene of de andere kiest. **Vergelijken** zet ze naast elkaar.
- Een eigen vaardigheid die al meer dan 90 dagen niet heeft gedraaid. **Uitzetten** haalt haar uit de catalogus; ze blijft in de vault.
- Een vaardigheid waarvan de lijst een hulpmiddel noemt dat Plainva niet heeft. Ze draait zonder dat hulpmiddel.
- Een vaardigheid die haar test niet heeft doorstaan met het nu gekozen model.
- Een vaardigheid waarvan de uitvoeringen steeds zonder antwoord eindigen, en een weg die je in drie gesprekken met de hand bent gegaan. Voor beide kan het doornemen van het laatste gesprek van dat soort iets voorstellen — zoals beschreven onder “Leren van een gesprek”: het kost één verzoek en vraagt eerst.

Elke regel biedt één stap aan, en geen enkele wordt voor je gezet. **Niet meer tonen** legt een regel op dit apparaat weg; hij komt terug als de zaak zelf is veranderd.

## Wat er naar de aanbieder gaat

Het verzendoverzicht noemt onder **Instructies** wat er meegaat: de vaardigheid van het gesprek, de lijst met vaardigheden die de AI mag laden, en `AGENTS.md`. Gaan instructies uit je vault voor het eerst naar een cloud, dan komt het overzicht terug. Onzichtbare tekens in een vaardigheid bereiken nooit een model.

## Grenzen van de beta

Een vaardigheid voert geen eigen scripts uit; voor kleine programma's die je vault lezen, zie [Scripts](AI_Scripts.md). Je eigen vaardigheden worden niet aangeboden aan AI-apps die via de MCP-server verbonden zijn; alleen de meegeleverde.
