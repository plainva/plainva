# AI-apps koppelen (bèta)

Laatst bijgewerkt: 2026-10-07

AI-apps op je computer — Claude Code, Claude Desktop, Cursor, VS Code en andere die het Model Context Protocol (MCP) spreken — kunnen je vault via Plainva lezen: erin zoeken, notities en hun secties lezen, structuren, backlinks, databases, taken en recente notities, en een notitie in Plainva openen. Uit zichzelf wijzigen ze niets: een app die je dat toestaat mag wijzigingen voorstellen, en die wachten tot je beslist (zie hieronder). Dit hoort bij de experimentele AI-functies en werkt alleen op de desktop.

De omgekeerde richting — de assistent van Plainva die hulpmiddelen gebruikt van servers die je zelf koppelt — staat beschreven onder **Externe hulpmiddelen (MCP)** in [AI-assistent](AI_Assistant.md).

Een derde weg — Plainva start een AI-agent van een andere maker in de map van de vault, met zijn sessie in het AI-tabblad — staat beschreven in [Externe agents](External_Agents.md).

## Zo werkt het

Plainva levert naast de app een klein hulpprogramma mee, `plainva-mcp`. Een AI-app start het, en het hulpprogramma verbindt via een privékanaal van deze computer met het draaiende Plainva — een named pipe op Windows, een socket in een privémap op macOS en Linux. Er wordt nooit een netwerkpoort geopend. Plainva moet draaien met de vault open; anders krijgt de app een duidelijke melding.

## Inschakelen

1. Open **Instellingen → AI & automatisering** en zet **AI op dit apparaat gebruiken** aan.
2. Zet **AI-apps op deze computer deze vault laten lezen** aan.
3. Stel de app in (zie hieronder). Bij de eerste verbinding vraagt Plainva welke app het is, welk programma haar startte en welke mappen ze mag lezen. Er is niets aangevinkt: kies mappen of **De hele vault**, dan **Toestaan**. **Weigeren** wijst de app af, en Plainva vraagt tien minuten lang niet opnieuw naar haar. Onder de mappen staat **Mag wijzigingen voorstellen** — uit zolang je het niet aanvinkt; wat het toestaat, staat verderop.

De app bewaart voor de volgende keer een geheim in de sleutelhanger van het systeem. Mappen gelden per app en per vault: in een andere vault vraagt de app opnieuw.

## Een app instellen

- **Claude Code:** kopieer de **Opdracht voor Claude Code** uit de instellingen en voer die uit in een terminal.
- **Claude Desktop:** **Pakket maken…** schrijft een bestand `plainva.mcpb`; open het, en Claude Desktop installeert Plainva.
- **Andere apps (JSON):** kopieer de configuratie en voeg die toe aan de MCP-instellingen van de app, bijvoorbeeld aan de `mcp.json` van Cursor.

## Wat een app ziet

Alleen de mappen die je hebt toegestaan, en alleen wat je privacyregels naar een cloudmodel laten gaan dat het internet op kan — een app geldt als zo'n model, omdat Plainva niet ziet wat ze met het gelezene doet: notities met `cloud: deny` of `web: deny`, of in een map met een van die regels, bestaan niet voor een app — noch hun tekst noch hun titels —, links ernaar worden achtergehouden, en plaatsen uit het journaal gaan nooit mee. Plainva's eigen mappen (`.plainva`, `.agent`) en de regels zelf zijn nooit leesbaar. Elk pad in een verzoek en in een antwoord wordt twee keer gecontroleerd: in het app-venster en in het native deel van Plainva.

De instellingen tonen de toegestane apps met hun mappen en de laatste verzoeken. **Verwijderen** trekt de toestemming van een app in elke vault in. Dat geldt meteen — ook voor een app die op dat moment verbonden is.

Naast de tools biedt Plainva zijn drie vaardigheden aan als prompts, in de taal van de app: `daily-orientation`, `weekly-review` en `project-status`, dat om de naam van het project vraagt. Een app die prompts ondersteunt, toont ze tussen zijn opdrachten.

## Een app wijzigingen laten voorstellen

Lezen is nooit een toestemming om te schrijven. Of een app ook wijzigingen mag voorstellen, is een apart antwoord: **Mag wijzigingen voorstellen** in de vraag bij de eerste verbinding, of later de schakelaar **… mag wijzigingen voorstellen** in de instellingen — per app en per vault, en uit totdat je hem aanzet. Hij geldt vanaf het volgende verzoek van de app; de extra hulpmiddelen verschijnen in de app zodra ze opnieuw verbinding maakt.

Een app die je het hebt toegestaan krijgt zes extra hulpmiddelen, en geen daarvan wijzigt de vault:

- **Een wijziging in een notitie** — in de tekst of in een van de eigenschappen — wordt een voorstel in de marge van de notitie, ondertekend met de naam van de app en “(AI-app)”. Daar neem je elke wijziging apart over of wijs je haar af, zoals bij elk voorstel (zie [Opmerkingen en voorstellen](Comments_and_Suggestions.md)).
- **Een nieuwe notitie** wordt een concept onder **Open** in het AI-tabblad. Ze bestaat zodra je daar **Aanmaken** kiest.
- **Hernoemen, verplaatsen en verwijderen** vragen eerst. Plainva laat in het eigen venster zien wat er zou gebeuren — bij hernoemen ook de notities waarvan de links zouden volgen —, en de app toont een melding dat Plainva wacht. Pas na **Toestaan** in Plainva, en zodra de app verdergaat, doet Plainva het zoals wanneer je het met de hand doet; de app hoort alleen of het is gebeurd. Bij verwijderen opent Plainva dan het eigen verwijdervenster, en er verdwijnt niets voordat je daar bevestigt. Een app die zo'n melding niet kan tonen, krijgt deze drie hulpmiddelen niet aangeboden.

Een webadres dat een app meebrengt, wordt zo geschreven dat niets het opent of laadt (`https[://]…`), net als bij de assistent. De eigen privacyregels van een notitie (`plainva.ai`) stelt geen app in, en in een versleutelde workspace wordt niets voorgesteld, opgesteld of gepland. **Recente verzoeken** in de instellingen zegt bij elk verzoek wat ervan geworden is — ook dat Plainva het aan jou heeft gevraagd, of dat je nee hebt gezegd.

## Grenzen

- Alleen desktop: telefoons draaien zulke apps niet, en iOS noch Android laat een app een andere een privékanaal aanbieden.
- ChatGPT en claude.ai in de browser kunnen er niet bij: ze verbinden alleen met servers op internet, en Plainva draait er geen.
- Een app wijzigt de vault nooit uit zichzelf: wat ze schrijft, wacht als voorstel of concept, en hernoemen, verplaatsen of verwijderen heeft jouw ja in Plainva nodig.
