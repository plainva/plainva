# Scripts (Beta)

Laatst bijgewerkt: 2026-10-08

Een script is een klein programma voor wat een model slecht kan en een programma elke keer op dezelfde manier doet: tellen, sorteren, vergelijken, optellen. Je schrijft het in JavaScript. Het draait in een afgesloten ruimte binnen Plainva: het kan geen bestand openen, niet het netwerk op en niet wachten tot later. Het roept alleen de hulpmiddelen aan die je ervoor hebt aangevinkt, en die lezen je vault zoals de hulpmiddelen van de AI dat doen. Een script verandert niets.

## Een script uitvoeren

Je scripts staan onder **Vaardigheden** in het AI-tabblad — op de telefoon onder **Gesprekken → Vaardigheden** — in de groep **Scripts**. **Uitvoeren** opent het script: vul in wat het vraagt en druk op **Uitvoeren**. Zolang het draait, zie je elk hulpmiddel dat het aanroept, en **Stoppen** beëindigt het. Daarna toont het dialoogvenster de **Aanroepen**, het **Resultaat** — dat je kunt kopiëren — en het **Logboek**, en wat de uitvoering van zijn grenzen heeft verbruikt.

Een uitvoering die je hier start, blijft op dit apparaat: niets ervan gaat naar een model, dus het script leest ook notities die je van de cloud weghoudt. **Proefrun** roept de hulpmiddelen aan die lezen, en noteert alleen een aanroep die in de app iets zou tonen.

## In een gesprek

In een gewoon gesprek kan de AI je actieve scripts vinden en er een uitvoeren wanneer dat past; dan staat er als stap **Voert het script “word-count” uit**. Het script leest alleen wat dat gesprek mag lezen: een notitie die je van de cloud weghoudt, blijft weggehouden, en elke notitie die het script leest, telt mee bij wat de uitvoering heeft gelezen. Wat het teruggeeft, gaat als gegevens naar het model, nooit als instructies. Een gesprek dat met een vaardigheid is gestart, krijgt geen scripts aangeboden, en een AI-app die via de MCP-server is verbonden ook niet.

## Een script schrijven

**Nieuw script** vraagt om:

- **Naam** — kleine letters, cijfers en koppeltekens; het wordt de naam van de map.
- **Beschrijving** — waar het script voor is; daaraan herken jij het, en de AI ook.
- **Hulpmiddelen** — vink aan wat het script mag aanroepen. Verder bestaat er niets voor het script.
- **Invoer** — waar het script bij het starten om vraagt: een naam, of het tekst, een getal of ja of nee is, en of het verplicht is.
- **Grenzen** — seconden rekentijd, aanroepen van hulpmiddelen en geheugen.
- **Code** — het programma.

**Maken en goedkeuren** schrijft het script als `.agent/scripts/<name>/` in je vault — een `manifest.json` en een `main.js` — en keurt het goed op dit apparaat. **Bewerken** in het menu van een script opent hetzelfde formulier; **Opslaan en goedkeuren** vervangt de bestanden.

De code is de romp van een functie. `input` bevat de invoer per naam, `tools.<name>(…)` roept een hulpmiddel aan en wordt afgewacht, `return` geeft het resultaat terug, en `console.log(…)` schrijft een regel in het logboek:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

De taal is JavaScript op het niveau van ES2020. Er is geen `fetch`, geen timer, geen `import` en geen toegang tot bestanden, en wat een script teruggeeft, moet gegevens zijn die als JSON kunnen worden geschreven. Een hulpmiddel dat weigert — een notitie die niet bestaat, een notitie die het gesprek niet mag lezen — geeft een fout die het script kan opvangen.

## Wat een hulpmiddel teruggeeft

**Wat een hulpmiddel teruggeeft** in het formulier opent deze pagina. Elk hulpmiddel neemt één object aan en geeft er één terug; `cursor` neemt de `next` van de voorgaande aanroep over en gaat verder met de lijst daarvan.

| Hulpmiddel | Je geeft mee | Je krijgt terug |
|---|---|---|
| `search_vault` — **Doorzoekt de vault** | `query`; optioneel `folder`, `limit` (hoogstens 25), `cursor` | `results`: een lijst van `{ title, path, snippet }`; `next` |
| `read_note` — **Leest een notitie** | `path`; optioneel `section`, `maxChars` (200 tot 20.000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Leest de structuur** | `path` | `path`; `properties`: naam en waarde; `sections`: een lijst van `{ level, text, section }` |
| `query_base` — **Leest een database** | `base`, het pad van het `.base`-bestand; optioneel `view`, `limit` (hoogstens 50), `cursor` | `base`, `view`, `views`; `rows`: een lijst van `{ title, path, properties }`; `next` |
| `get_tasks` — **Leest taken** | optioneel `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (hoogstens 50), `cursor` | `tasks`: een lijst van `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Backlinks lezen** | `path`; optioneel `limit` (hoogstens 50), `cursor` | `path`; `notes`: een lijst van `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Links volgen** | `path`; optioneel `depth` (1 of 2), `limit` (hoogstens 50) | `path`; `notes`: een lijst van `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Recente notities bekijken** | optioneel `kind` (`opened` of `edited`), `limit` (hoogstens 20) | `kind`; `notes`: een lijst van `{ title, path, at }` |
| `get_calendar` — **Afspraken lezen** | `from` en `to` als `YYYY-MM-DD`; optioneel `details`, `limit` (hoogstens 100) | `events`: een lijst van `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Gebruikt de app** | `id`, een opdracht van de app zoals `open-note`, `show-in-graph` of `open-calendar`; optioneel `args` met `path`, `section` of `date` | `done`, `command` |

## Grenzen

Een script legt zijn grenzen vast in zijn manifest. Het formulier stelt er drie van in:

| Grens | Standaard | Bereik |
|---|---|---|
| **Seconden rekentijd** | 5 | 1 tot 30 |
| **Aanroepen van hulpmiddelen** | 20 | 0 tot 50 |
| **Geheugen in MB** | 32 | 8 tot 128 |

Alleen de tijd waarin een script rekent telt mee, niet de tijd die een hulpmiddel nodig heeft. Een script dat een grens overschrijdt, wordt beëindigd; het dialoogvenster zegt welke grens het was, en een beëindigd script geeft niets terug. De argumenten van één aanroep en het resultaat mogen elk hoogstens 64 KB groot zijn.

## Niets draait voordat je het goedkeurt

Een script dat nieuw of gewijzigd is — via sync, of geschreven door een ander programma — draait pas wanneer je het **op dit apparaat** goedkeurt. Het wacht bovenaan in **Vaardigheden** onder **Wachten op je goedkeuring**. **Controleren en goedkeuren** toont **Wat het mag**, zijn **Grenzen**, zijn **Invoer** en de hele **Code**, en zegt of de code als JavaScript te lezen is; code die niet te lezen is, wordt niet goedgekeurd.

Met **Goedkeuren** ondertekent dit apparaat precies deze bestanden. De sleutel daarvoor wordt op dit apparaat gemaakt en staat in de sleutelhanger ervan. Elke wijziging aan een bestand heft de goedkeuring op, en op elk van je andere apparaten wacht het script op een eigen goedkeuring — een goedkeuring kan niet van het ene apparaat naar het andere worden meegenomen. **Goedkeuring intrekken** in het menu van een script maakt de goedkeuring ongedaan, en **Code bekijken** toont de controle opnieuw.

## Grenzen van de beta

Scripts lezen alleen: ze stellen geen wijzigingen voor. Een vaardigheid kan geen script starten, en de eigen map `scripts/` van een vaardigheid wordt niet uitgevoerd. E-mail, internet en de hulpmiddelen van externe servers zijn voor scripts niet beschikbaar.
