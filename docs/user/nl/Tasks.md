# Taken

Laatst bijgewerkt: 2026-07-15

De Taken-weergave verzamelt elk selectievakje in je vault op één plek: alle `- [ ]`- en `- [x]`-lijstitems uit al je notities, gegroepeerd per notitie waarin ze staan. De Taken-weergave is de "wat moet ik nog doen?"-weergave over gewone Markdown — geen plugin, geen speciaal bestand.

## Waarom een aparte weergave (en geen `.base`)

Een [database (`.base`)](Databases_Base.md) werkt met hele notities — één rij per notitie. Een selectievakje is een enkele *regel* binnen een notitie, en een notitie kan er veel bevatten, dus een `.base` kan ze niet weergeven. De Taken-weergave is regelgebaseerd: de taakregels worden rechtstreeks gelezen, zodat één projectnotitie met tien subtaken alle tien laat zien.

## Taken-weergave openen

- Klik op het **checklist-icoon** in de actiebalk uiterst links, of
- open het **opdrachtenpalet** (`Ctrl/Cmd+P`) en voer **Taken openen** uit.

De weergave opent als tab, net als elke notitie.

## De lijst lezen

Taken zijn gegroepeerd per notitie; de notitietitel is een kop waarop je kunt klikken om de notitie te openen. Elke taak toont het selectievakje en de tekst, doorgestreept zodra de taak is voltooid. Een **vervaldatum**, geschreven als `📅 2026-08-01` in de taakregel, verschijnt als klein label.

## Filteren

De balk bovenaan beperkt de lijst:

- **Open / Voltooid / Alle** — op selectievakjestatus (start bij **Open**).
- **Taken filteren…** — vrije tekst; komt overeen met de taaktekst.
- **Alle mappen** — alleen taken in de gekozen map (en de submappen daarvan).
- **Alle tags** — alleen taken met een gekozen inline-`#tag`.
- **Met vervaldatum** — alleen taken met een `📅`-datum.

Tags en vervaldatums worden rechtstreeks uit de taakregel gelezen — bijvoorbeeld `- [ ] Factuur betalen #finance 📅 2026-08-01`.

## Taken afvinken

Klik op het **selectievakje** van een taak om te wisselen tussen open en voltooid. De wijziging wordt direct teruggeschreven naar de notitie (als een normale, veilige bestandsschrijfactie — alleen het ene teken `[ ]`/`[x]` verandert), zodat de notitie, Obsidian en elke synchronisatie gelijke tred houden. Klik in plaats daarvan op de **tekst** van de taak om de notitie te openen en naar die regel te springen.

Is een notitie gewijzigd sinds de lijst is opgebouwd, dan wordt een verouderde wisseling overgeslagen en wordt de lijst vernieuwd — gebruik de knop **vernieuwen** rechtsboven om op elk moment opnieuw te laden.

## Notities uit de Taken-weergave verbergen

Sommige notities bevatten selectievakjes die nooit "echte" taken zijn — vooral **sjablonen**. Om ze buiten de lijst te houden, kan een notitie zichzelf uitsluiten. De waarheid blijft in het bestand: de uitsluiting is een frontmatter-veld in de notitie, geen verborgen app-instelling. Het synchroniseert mee, is zichtbaar in Obsidian en is met elke teksteditor te controleren:

```yaml
---
plainva:
  tasks: false
---
```

Je hoeft dit veld niet met de hand te schrijven:

- **Verbergen uit taken** — rechts in de kopregel van elke notitie staat een oog-icoon; met één klik wordt de marker in de notitie geschreven en wordt deze verborgen.
- **Verborgen tonen** — deze optie in de balk bovenaan brengt de verborgen notities terug (gedimd), elk met een icoon **Weer in taken tonen** dat de marker verwijdert.
- **Sjablonen verbergen** — als je sjabloonmap notities met selectievakjes bevat, verschijnt rechtsboven een knop **Sjablonen verbergen** die de marker in één keer bij al deze notities aanbrengt.

Nieuw aangemaakte sjablonen dragen de marker automatisch. Maak je een notitie **vanuit** een sjabloon, dan wordt de marker weer verwijderd — de nieuwe notitie is echte inhoud en de taken erin worden gewoon getoond.

## Obsidian-compatibiliteit

Taken zijn gewone GFM-selectievakjes (GitHub-Flavored Markdown). Plainva voegt nooit een speciale syntax toe: dezelfde `- [ ]`-regels worden in Obsidian weergegeven als selectievakjes en zijn in elke editor gewoon leesbaar. De conventies `📅 datum` en `#tag` zijn de gangbare Obsidian-Tasks-stijl, maar ze zijn gewoon tekst in je notitie.

## Zie ook

- [Notities & Markdown](Notes_and_Markdown.md) — takenlijsten schrijven in de editor
- [Zoeken](Search.md) — volledige-tekstzoekfunctie over de hele vault
- [Databases (.base)](Databases_Base.md) — databases op notitieniveau
