# Vaardigheden (Beta)

Laatst bijgewerkt: 2026-10-07

Een vaardigheid is een set instructies voor werk dat terugkomt: een vergadering voorbereiden, je taken ordenen, een weekoverzicht. Plainva levert er twaalf mee, en je kunt je eigen schrijven. Vaardigheden gebruiken het open formaat Agent Skills — een map met een `SKILL.md` — en werken daardoor ook in andere AI-apps die dat formaat lezen.

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
| **Privacycontrole** | Vindt wat uit een notitie beter op dit apparaat blijft, en stelt een regel voor. |
| **Reflectie** | Blikt met je terug op de notities van een dag of een week — vriendelijk, nooit een diagnose. |

Ze lezen allemaal alleen: geen enkele verandert een notitie of verstuurt iets. Alleen **Onderzoek** gebruikt internet, en alleen **E-mail en agenda** leest je e-mail — zie hieronder. Privacycontrole en Reflectie zijn bedoeld voor een model op dit apparaat; met een cloudmodel zegt het verzendoverzicht dat. Zet elke vaardigheid uit onder **Vaardigheden** — de schakelaar geldt voor deze vault op dit apparaat. **Eigen versie maken** kopieert er een naar je vault, waar je haar kunt aanpassen.

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

Hetzelfde geldt voor een `AGENTS.md` bovenaan in je vault: eenmaal goedgekeurd gaan de vaste instructies mee in elk nieuw gesprek. Noch een vaardigheid noch `AGENTS.md` kan je privacyregels opheffen, en een vaardigheid krijgt nooit meer dan een gesprek heeft — ze kan het alleen beperken.

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

## Wat er naar de aanbieder gaat

Het verzendoverzicht noemt onder **Instructies** wat er meegaat: de vaardigheid van het gesprek, de lijst met vaardigheden die de AI mag laden, en `AGENTS.md`. Gaan instructies uit je vault voor het eerst naar een cloud, dan komt het overzicht terug. Onzichtbare tekens in een vaardigheid bereiken nooit een model.

## Grenzen van de beta

Vaardigheden voeren geen scripts uit. Je eigen vaardigheden worden niet aangeboden aan AI-apps die via de MCP-server verbonden zijn; alleen de meegeleverde.
