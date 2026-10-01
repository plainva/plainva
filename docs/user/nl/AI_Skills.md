# Vaardigheden (Beta)

Laatst bijgewerkt: 2026-10-01

Een vaardigheid is een set instructies voor werk dat terugkomt: een vergadering voorbereiden, je taken ordenen, een weekoverzicht. Plainva levert er tien mee, en je kunt je eigen schrijven. Vaardigheden gebruiken het open formaat Agent Skills — een map met een `SKILL.md` — en werken daardoor ook in andere AI-apps die dat formaat lezen.

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
| **Schrijven en herschrijven** | Vat een notitie samen, kort haar in of herschrijft haar — als tekst die je overneemt. |
| **Kennis onderhouden** | Vindt notities die hetzelfde zeggen, verouderd zijn of nergens mee verbonden. |
| **Links opschonen** | Controleert de links van een notitie: die nergens heen leiden, ontbrekende, eenrichting. |
| **Privacycontrole** | Vindt wat uit een notitie beter op dit apparaat blijft, en stelt een regel voor. |
| **Reflectie** | Blikt met je terug op de notities van een dag of een week — vriendelijk, nooit een diagnose. |

Ze lezen allemaal alleen: geen enkele verandert een notitie, verstuurt iets of gaat het internet op. Privacycontrole en Reflectie zijn bedoeld voor een model op dit apparaat; met een cloudmodel zegt het verzendoverzicht dat. Zet elke vaardigheid uit onder **Vaardigheden** — de schakelaar geldt voor deze vault op dit apparaat. **Eigen versie maken** kopieert er een naar je vault, waar je haar kunt aanpassen.

## Je eigen vaardigheden

**Nieuwe vaardigheid** vraagt om een naam, een beschrijving — daarop kiest de AI de vaardigheid — en de instructies. Plainva schrijft ze als `.agent/skills/<naam>/SKILL.md` in je vault, waar ze meereizen zoals elke notitie. **Bewerken** opent het bestand als een notitie.

**Importeren…** neemt een vaardigheid aan als `.zip`- of `.skill`-bestand. Voordat er iets wordt geschreven, controleert Plainva haar: precies één vaardigheid in het formaat, geen pad buiten haar map, de groottelimieten. Het noemt de licentie, scripts die het niet uitvoert en hulpmiddelen die het niet heeft.

## Niets draait voordat je het goedkeurt

Een vaardigheid in je vault die nieuw is of veranderd — via sync, een import of een bewerking op dit of een ander apparaat — draait pas wanneer je haar **op dit apparaat** goedkeurt. Zulke vaardigheden wachten bovenaan in **Vaardigheden** onder **Wachten op je goedkeuring**, en in **Instellingen → AI & automatisering** (het Vault-deel). **Controleren en goedkeuren** toont wat de vaardigheid mag, wat er sinds je laatste goedkeuring veranderde, haar instructies, bestanden en waar ze staat. De goedkeuring geldt precies voor deze versie; elke wijziging heft haar weer op. Goedkeuringen worden op dit apparaat bewaard, nooit in de vault.

Hetzelfde geldt voor een `AGENTS.md` bovenaan in je vault: eenmaal goedgekeurd gaan de vaste instructies mee in elk nieuw gesprek. Noch een vaardigheid noch `AGENTS.md` kan je privacyregels opheffen, en een vaardigheid krijgt nooit meer dan een gesprek heeft — ze kan het alleen beperken.

## Wat er naar de aanbieder gaat

Het verzendoverzicht noemt onder **Instructies** wat er meegaat: de vaardigheid van het gesprek, de lijst met vaardigheden die de AI mag laden, en `AGENTS.md`. Gaan instructies uit je vault voor het eerst naar een cloud, dan komt het overzicht terug. Onzichtbare tekens in een vaardigheid bereiken nooit een model.

## Grenzen van de beta

Vaardigheden voeren geen scripts uit, en vaardigheden die het web of je e-mail nodig hebben komen later. Je eigen vaardigheden worden niet aangeboden aan AI-apps die via de MCP-server verbonden zijn; alleen de meegeleverde.
