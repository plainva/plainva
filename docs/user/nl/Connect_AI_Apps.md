# AI-apps koppelen (bèta)

Laatst bijgewerkt: 2026-09-29

AI-apps op je computer — Claude Code, Claude Desktop, Cursor, VS Code en andere die het Model Context Protocol (MCP) spreken — kunnen je kluis via Plainva lezen: erin zoeken, notities en hun secties lezen, structuren, backlinks, databases, taken en recente notities, en een notitie in Plainva openen. Ze kunnen niets wijzigen. Dit hoort bij de experimentele AI-functies en werkt alleen op de desktop.

## Zo werkt het

Plainva levert naast de app een klein hulpprogramma mee, `plainva-mcp`. Een AI-app start het, en het hulpprogramma verbindt via een privékanaal van deze computer met het draaiende Plainva — een named pipe op Windows, een socket in een privémap op macOS en Linux. Er wordt nooit een netwerkpoort geopend. Plainva moet draaien met de kluis open; anders krijgt de app een duidelijke melding.

## Inschakelen

1. Open **Instellingen → AI & automatisering** en zet **AI op dit apparaat gebruiken** aan.
2. Zet **AI-apps op deze computer deze kluis laten lezen** aan.
3. Stel de app in (zie hieronder). Bij de eerste verbinding vraagt Plainva welke app het is, welk programma haar startte en welke mappen ze mag lezen. Er is niets aangevinkt: kies mappen of **De hele kluis**, dan **Toestaan**. **Weigeren** wijst de app af, en Plainva vraagt tien minuten lang niet opnieuw naar haar.

De app bewaart voor de volgende keer een geheim in de sleutelhanger van het systeem. Mappen gelden per app en per kluis: in een andere kluis vraagt de app opnieuw.

## Een app instellen

- **Claude Code:** kopieer de **Opdracht voor Claude Code** uit de instellingen en voer die uit in een terminal.
- **Claude Desktop:** **Pakket maken…** schrijft een bestand `plainva.mcpb`; open het, en Claude Desktop installeert Plainva.
- **Andere apps (JSON):** kopieer de configuratie en voeg die toe aan de MCP-instellingen van de app, bijvoorbeeld aan de `mcp.json` van Cursor.

## Wat een app ziet

Alleen de mappen die je hebt toegestaan, en alleen wat je privacyregels naar een cloudmodel laten gaan: notities met `cloud: deny`, of in een map met die regel, bestaan niet voor een app — noch hun tekst noch hun titels —, links ernaar worden achtergehouden, en plaatsen uit het journaal gaan nooit mee. Plainva's eigen mappen (`.plainva`, `.agent`) en de regels zelf zijn nooit leesbaar. Elk pad in een verzoek en in een antwoord wordt twee keer gecontroleerd: in het app-venster en in het native deel van Plainva.

De instellingen tonen de toegestane apps met hun mappen en de laatste verzoeken. **Verwijderen** trekt de toestemming van een app in elke kluis in.

## Grenzen

- Alleen desktop: telefoons draaien zulke apps niet, en iOS noch Android laat een app een andere een privékanaal aanbieden.
- ChatGPT en claude.ai in de browser kunnen er niet bij: ze verbinden alleen met servers op internet, en Plainva draait er geen.
- Alleen lezen; een app wijzigingen laten voorstellen komt in een latere versie.
