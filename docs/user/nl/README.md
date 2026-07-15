# Plainva-gebruikershandleiding

Laatst bijgewerkt: 2026-07-06

Deze vertaling is automatisch gegenereerd — correcties zijn welkom.

Plainva is een Markdown-vault-editor: je notities zijn gewone Markdown-bestanden in een map (een "vault") op je computer — geen database-silo, geen verplicht cloudaccount. Deze handleiding legt uit hoe je met Plainva werkt en hoe de bestandsformaten werken.

## Inhoud

| Pagina | Waar het over gaat |
|---|---|
| [Aan de slag](Getting_Started.md) | Een vault openen of aanmaken, de interface, editormodi, tabbladen en gesplitste weergave |
| [Notities & Markdown](Notes_and_Markdown.md) | Hoe Markdown-bestanden werken: schrijven, opmaak, eigenschappen (frontmatter), iconen, links, sjablonen, afbeeldingen |
| [Databases (.base)](Databases_Base.md) | Notities als database bekijken — weergaven, filters, eigenschappen, relaties, nieuwe items (vergelijkbaar met Notion, maar bestandsgebaseerd) |
| [OKF](OKF.md) | Het Open Knowledge Format: `type`, `okf_version`, index.md-beheer en de optionele vault-conversie |
| [Bestandsformaat-referentie](File_Format_Reference.md) | Het exacte bestandsformaat van elk vault-bestand op schijf — voor tools, scripts of een KI die notities en `.base`-bestanden rechtstreeks bewerkt |
| [Automatisering & scripts](Automation_and_Scripts.md) | Plainva uitbreiden zonder plugins: hoe scripts, CLI-tools en KI-agents een vault veilig lezen en schrijven |
| [Back-ups & versiegeschiedenis](Backups_and_Versioning.md) | Automatische bestandsversies, herstellen (ook van verwijderde bestanden) en dagelijkse ZIP-back-ups van de vault |
| [De mobiele app](Mobile_App.md) | Plainva op Android en iOS: opbouw, bewerken, databases, synchronisatie en het vangnet |
| [Sync instellen](Sync_Setup.md) | Stap voor stap per provider: WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Sync-compatibiliteit](Sync_Compatibility.md) | Welke diensten vandaag werken — rechtstreeks, via WebDAV, of via de desktop-client van de provider |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Google Drive-sync instellen met je eigen toegangsgegevens |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | OneDrive- en Dropbox-sync instellen met je eigen app-registratie |
| [Zoeken](Search.md) | Volledige-tekstzoekfunctie, snelkiezer, zoeken & vervangen, tags |
| [Graaf](Graph.md) | Contextgraaf, vault-kaart met opruimmodus en tijdreis, graaf als databaseweergave |
| [Sneltoetsen](Keyboard_Shortcuts.md) | Alle sneltoetsen in één oogopslag |
| [FAQ & probleemoplossing](FAQ.md) | Veelgestelde vragen: Obsidian-compatibiliteit, conflictbestanden, back-ups en meer |

## Kernprincipes

- **Je bestanden zijn van jou.** Een vault is gewoon een map met Markdown-bestanden. Je kunt hem op elk moment openen, kopiëren of back-uppen met elk ander programma.
- **Puur Markdown is het canonieke formaat.** Zelfs extra functies (eigenschappen, iconen, databases) worden opgeslagen in open, leesbare tekstformaten.
- **Obsidian-compatibel.** Bestaande Obsidian-vaults worden nooit beschadigd of geherformatteerd; Obsidian kan elk bestand openen dat Plainva aanmaakt.
