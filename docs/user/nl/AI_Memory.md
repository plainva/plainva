# Geheugen (Beta)

Laatst bijgewerkt: 2026-10-09

Het geheugen bewaart wat de AI over jou en je werk moet weten zonder dat je het opnieuw hoeft te vertellen: wat je doet, hoe je je antwoorden het liefst wilt hebben, wie je klanten zijn. Het zijn twee bestanden in je vault. Er komt niets in zonder jouw ja, en je kunt elk item lezen, wijzigen en verwijderen.

## Twee plekken

**Altijd erbij** gaat mee in elk nieuw gesprek. Houd het kort: er is plaats voor 2.000 tekens, en een balk laat zien hoe vol het is. Een item dat niet meer past, wordt gemarkeerd met **Geen plaats meer — gaat niet mee** — het is opgeslagen, maar wordt niet meegestuurd. Items gaan mee in de volgorde waarin ze staan, dus wat het belangrijkst is, hoort bovenaan; de volgorde wijzig je in het bestand.

**Om op te zoeken** wordt niet meegestuurd. Kan een vraag afhangen van iets wat je de AI eerder hebt verteld, dan zoekt de AI daar, en het gesprek toont **Zoekt in het geheugen**. Dit is de plek voor wat maar soms van belang is: de voorwaarden van één klant, een besluit en de reden ervan.

## Het geheugen openen

Kies op de desktop **Geheugen** in het AI-tabblad, naast **Vaardigheden**. Op de telefoon is dat **Gesprekken → Geheugen**. Ook **Instellingen → AI & automatisering** (het Vault-deel) leidt erheen: **Geheugen openen** onder **Vaardigheden en geheugen**.

## Zelf een item toevoegen

**Nieuw item** vraagt om drie dingen: de tekst — één ding per item, een enkele regel van hoogstens 500 tekens —, de plek (**Altijd erbij** of **Om op te zoeken**) en of het bedoeld is voor **Alleen modellen op dit apparaat**. Vink dat aan voor alles wat geen cloudmodel mag weten.

De ⋯-knop van een item — op de telefoon een tik op het item — biedt **Bewerken**, het verplaatsen naar de andere plek (**Altijd meegeven** of **Alleen nog opzoeken**) en **Verwijderen**.

## De AI iets laten onthouden

Zeg het in een gesprek: “Onthoud dat ik per dag factureer, niet per uur.” De AI maakt een concept van een item en schrijft er nooit zelf een. Onder het antwoord toont een kaart **Concept · Geheugenitem** de volledige tekst. Kies de plek en daarna **Onthouden** — of **Verwerpen**. Een concept waarover je nog niet hebt beslist, wacht onder **Open**, en het geheugen laat zien hoeveel er wachten.

“Vergeet dat …” werkt op dezelfde manier: op de kaart staat **Concept · Uit het geheugen verwijderen**, en **Verwijderen** haalt het item eruit. Als je de AI vertelt dat er iets is veranderd, toont de kaart onder **Vervangt** welk item de nieuwe formulering vervangt.

Ook een afgerond gesprek kan items voorstellen: **Leren van dit gesprek** leest het nog één keer door en laat concepten achter, elk met zijn onderbouwing. Hoe dat werkt, en wat er bij het doornemen van een gesprek mag worden voorgesteld, staat beschreven in [Vaardigheden](AI_Skills.md).

## Een regel is geen geheugenitem

“Antwoord altijd in het Duits” is niets om te weten — het is iets om te doen. Zo'n regel komt niet in het geheugen, maar wordt een regel van de **Instructies van de vault** (`AGENTS.md`), die elk model als instructie krijgt. Voeg er een toe met **Regel toevoegen** onder **Regels voor de AI**, of vraag het aan de AI; op de kaart staat dan **Concept · Regel voor de AI**, met de knop **Als regel toevoegen**.

Zoals alle instructies moet het bestand op elk apparaat worden goedgekeurd voordat het daar geldt (zie [Vaardigheden](AI_Skills.md)). Een regel die je toevoegt op een apparaat waar het bestand al is goedgekeurd, geldt daar meteen; je andere apparaten vragen je eerst om goedkeuring.

## Privacy

- Een item kan een eigen regel dragen: **Niet naar cloudmodellen**, **Niet in gesprekken met internet**. Een model op dit apparaat krijgt elk item.
- Een item dat de AI heeft opgesteld in een gesprek waarin notities met een privacyregel zijn gelezen, krijgt dezelfde regels — op de kaart staat **Het item krijgt de privacyregels van de notities waarop dit gesprek berustte.** Wat afkomstig is uit een notitie die op dit apparaat moet blijven, komt via het geheugen niet bij een cloud terecht.
- Je [privacyregels](AI_Assistant.md) gelden ook voor de twee bestanden: een mapregel voor `.agent/` houdt het hele geheugen van de cloud weg.
- Het verzendoverzicht heeft een rij **Geheugen** — hoeveel items er meegaan — en telt de items die je regels achterhouden onder **Achtergehouden**. Het noemt nooit een item.
- Voor de AI is een item informatie, geen instructie: een zin in het geheugen geeft geen rechten.
- Een gesprek behoudt het geheugen waarmee het is begonnen. Een item dat je verwijdert, gaat naar geen enkel nieuw gesprek; gesprekken die al zijn begonnen, behouden wat ze hebben meegekregen.

## Uitschakelen

**Het geheugen op dit apparaat gebruiken** staat aan totdat je het uitzet. Staat het uit, dan krijgt een gesprek op dit apparaat niets uit het geheugen en voegt er niets aan toe. De bestanden blijven zoals ze zijn, en elk apparaat beslist voor zichzelf.

## De twee bestanden

`.agent/active_memory.md` (altijd erbij) en `.agent/MEMORY.md` (om op te zoeken) zijn gewone Markdown. Elk item is een lijstitem, en koppen groeperen items. Wat Plainva over een item weet, staat in een HTML-commentaar erachter:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` en `by` zeggen wanneer het item is toegevoegd en of je het zelf hebt geschreven of een concept hebt geaccepteerd, `source` noemt het gesprek waaruit een concept afkomstig is, en `deny` bevat de regels ervan (`cloud`, `web`). Je kunt de bestanden in elke editor bewerken. In Plainva opent **Bestand openen** elk van de twee.

Plainva gaat niet raden. Een item waarvan het commentaar beschadigd is, wordt gemarkeerd met **Regels onleesbaar — gaat naar geen enkel model** totdat je het commentaar herstelt of het item opnieuw toevoegt. Tekst die verborgen is in een commentaar of in onzichtbare tekens, wordt nooit verzonden; het item toont dan hoeveel verborgen delen zijn weggelaten. Een bestand bevat hoogstens 2.000 items en 256 KB.
