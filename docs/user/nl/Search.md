# Zoeken

Laatst bijgewerkt: 2026-07-06

Plainva biedt drie manieren om te zoeken: volledige-tekstzoekfunctie over de hele vault, de snelkiezer om bestanden te openen, en zoeken & vervangen binnen een notitie.

## Volledige-tekstzoekfunctie in de vault

Het zoekveld bovenaan de zijbalk doorzoekt de hele vault — titels *en* inhoud. Daarachter zit een lokale volledige-tekstindex (SQLite FTS5), die wordt opgebouwd bij het openen van de vault en bij elke wijziging actueel wordt gehouden; zoeken werkt daarom ook offline en zonder merkbare vertraging.

Zoeken reageert terwijl je typt: woordvoorvoegsels leveren al treffers op ("Projec" vindt "Projectplan") — je hoeft niet op Enter te drukken. De **X** rechts in het veld wist de huidige zoekopdracht (of druk op `Esc`); de zijbalk toont dan weer de normale bestandsboom.

De resultatenlijst toont bovenaan het aantal treffers en groepeert de resultaten: eerst treffers op **Bestandsnaam** (de term komt voor in de naam van de notitie), daarna treffers op **Inhoud**. Elke rij toont het documentpictogram, het mappad en — bij inhoudstreffers — een tekstfragment met de vindplaats gemarkeerd. Klikken op een resultaat opent de notitie en springt meteen naar de eerste vindplaats; die wordt daar geselecteerd. Als er niets overeenkomt, toont de lijst **Geen resultaten**.

Het zoekveld werkt ook op de andere zijbalkweergaven: in **Tags** filtert het de tagslijst, in **Bladwijzers** de bladwijzers.

### Zoekoperatoren

- `"exacte zin"` — aanhalingstekens laten de woordvolgorde exact overeenkomen. Dit werkt ook als zoekopdracht naar een heel woord: `"plan"` vindt "plan" maar niet "planning".
- `-term` — sluit notities uit die de term bevatten (werkt ook met zinnen: `-"oude versie"`).
- `path:map` — alleen bestanden waarvan het pad de tekst bevat (bijv. `path:Projecten`; met spaties: `path:"Mijn Map"`).
- `tag:naam` — alleen notities met die tag, inclusief geneste tags: `tag:project` vindt ook `#project/intern`. `tag:#project` werkt ook.
- Operatoren kunnen ontkend worden (`-path:Archief`, `-tag:klaar`) en vrij gecombineerd worden met zoektermen: `plan tag:project -concept`.
- Meerdere termen worden met EN gecombineerd. Speciale tekens zoals `- ( ) : *` binnen termen zijn onschadelijk — Plainva behandelt de invoer letterlijk.

## Snelkiezer

`Ctrl+O` of `Ctrl+K` opent de snelkiezer: typen, navigeren met de pijltoetsen, openen met `Enter`. Zonder invoer toont hij de lijst **Recente bestanden** — de snelste manier om tussen je huidige notities te springen. Treffers kun je ook direct in een nieuw tabblad openen (de voettekst van het dialoogvenster toont de bijbehorende toetsen).

De overeenkomst is fuzzy: `prjplan` vindt ook "Project Plan" — de letters hoeven alleen in volgorde voor te komen, en woordbegin telt extra. En als de notitie nog niet bestaat, toont de lijst **'…' aanmaken**: `Enter` maakt hem meteen aan (in de vault-root) en opent hem — typ een naam, druk op Enter, begin met schrijven.

Onder de naams-treffers toont de snelkiezer bovendien de groep **Inhoud**: notities waarvan de tekst overeenkomt met je invoer, met een gemarkeerd fragment van de vindplaats. Het openen van zo'n treffer springt meteen naar de vindplaats in de notitie — net als bij de zijbalkzoekfunctie.

## Zoeken & vervangen in de notitie

`Ctrl+F` opent de zoekbalk van de editor (in Live-voorbeeld en broncodemodus):

- **Zoeken** met `Enter`/**volgende** en **vorige** door de treffers; **alle** markeert elke vindplaats.
- Opties: **hoofdlettergevoelig**, **heel woord**, **regex**.
- **Vervangen**: enkele treffers **vervangen** of **alles vervangen**.

## Tags

De zijbalkweergave **Tags** toont alle `#tags` van de vault met trefferaantal; een klik toont de **Bestanden met #tag**. Tags werken in de tekst (`#project`) en in de frontmatter (`tags: [project]`). Het zoekveld van de zijbalk filtert ook de tagslijst.

## Navigeren binnen een notitie

De **Structuur** in de rechterzijbalk toont alle koppen van de actieve notitie — een klik springt naar de plek. Voor het springen tussen notities helpen ook **Backlinks** (wie hierheen linkt) en de knoppen **Terug**/**Vooruit** van de editor.

## Zie ook

- [Sneltoetsen](Keyboard_Shortcuts.md)
- [Databases (.base)](Databases_Base.md) — gestructureerde zoekopdrachten over eigenschappen in plaats van volledige tekst
