# Connecter des apps d'IA (bêta)

Dernière mise à jour : 2026-10-07

Les apps d'IA de votre ordinateur — Claude Code, Claude Desktop, Cursor, VS Code et d'autres qui parlent le Model Context Protocol (MCP) — peuvent lire votre vault à travers Plainva : y chercher, lire des notes et leurs sections, des plans, des backlinks, des bases de données, des tâches et les notes récentes, et ouvrir une note dans Plainva. D'elles-mêmes, elles ne modifient rien : une app que vous y autorisez peut proposer des modifications, et celles-ci attendent votre décision (voir plus bas). Cela fait partie des fonctions d'IA expérimentales et ne marche que sur ordinateur.

Le sens inverse — l'assistant de Plainva utilisant les outils de serveurs que vous connectez vous-même — est décrit sous **Outils externes (MCP)** dans [Assistant IA](AI_Assistant.md).

Une troisième voie — Plainva démarre un agent d'IA d'un autre éditeur dans le dossier du vault, avec sa session dans l'onglet IA — est décrite dans [Agents externes](External_Agents.md).

## Comment ça marche

Plainva installe à côté de l'app un petit programme d'assistance, `plainva-mcp`. Une app d'IA le lance, et le programme se connecte à Plainva en cours d'exécution par un canal privé de cet ordinateur — un tube nommé sous Windows, un socket dans un dossier privé sous macOS et Linux. Aucun port réseau n'est jamais ouvert. Plainva doit être ouvert avec le vault ; sinon, l'app reçoit un message clair.

## L'activer

1. Ouvrez **Paramètres → IA & automatisation** et activez **Utiliser l'IA sur cet appareil**.
2. Activez **Laisser les apps d'IA de cet ordinateur lire ce vault**.
3. Configurez l'app (voir plus bas). À sa première connexion, Plainva demande de quelle app il s'agit, quel programme l'a lancée et quels dossiers elle peut lire. Rien n'est coché : choisissez des dossiers ou **Tout le vault**, puis **Autoriser**. **Refuser** écarte l'app, et Plainva ne redemande pas pour elle pendant dix minutes. Sous les dossiers se trouve **Peut proposer des modifications** — désactivé tant que vous ne le cochez pas ; ce qu'il permet est décrit plus bas.

L'app garde un secret dans le trousseau du système pour la prochaine fois. Les dossiers sont accordés par app et par vault : dans un autre vault, l'app redemande.

## Configurer une app

- **Claude Code :** copiez la **Commande pour Claude Code** depuis les paramètres et exécutez-la dans un terminal.
- **Claude Desktop :** **Créer le paquet…** écrit un fichier `plainva.mcpb` ; ouvrez-le, et Claude Desktop installe Plainva.
- **Autres apps (JSON) :** copiez la configuration et ajoutez-la aux réglages MCP de l'app, par exemple au `mcp.json` de Cursor.

## Ce qu'une app voit

Uniquement les dossiers que vous avez autorisés, et uniquement ce que vos règles de confidentialité laissent partir vers un modèle cloud qui peut accéder à Internet — une app est traitée comme tel, car Plainva ne voit pas ce qu'elle fait de ce qu'elle lit : les notes avec `cloud: deny` ou `web: deny`, ou dans un dossier avec l'une de ces règles, n'existent pas pour une app — ni leur texte ni leurs titres —, les liens vers elles sont retenus, et les lieux du journal ne partent jamais. Les dossiers propres à Plainva (`.plainva`, `.agent`) et les règles elles-mêmes ne sont jamais lisibles. Chaque chemin d'une requête et d'une réponse est vérifié deux fois : dans la fenêtre de l'app et dans la partie native de Plainva.

Les paramètres listent les apps autorisées avec leurs dossiers et les dernières requêtes. **Retirer** reprend l'autorisation d'une app dans tous les vaults. Cela vaut aussitôt — y compris pour une app connectée à ce moment-là.

En plus des outils, Plainva propose ses trois compétences comme prompts, dans la langue de l'app : `daily-orientation`, `weekly-review` et `project-status`, qui demande le nom du projet. Une app qui prend en charge les prompts les affiche parmi ses commandes.

## Laisser une app proposer des modifications

Lire n'est jamais une autorisation d'écrire. Qu'une app puisse aussi proposer des modifications est une réponse à part : **Peut proposer des modifications** dans la question posée à sa première connexion, ou plus tard l'interrupteur **… peut proposer des modifications** dans les paramètres — par app et par vault, et désactivé tant que vous ne l'activez pas. Il vaut dès la prochaine requête de l'app ; les outils supplémentaires apparaissent dans l'app dès qu'elle se reconnecte.

Une app que vous y avez autorisée reçoit six outils de plus, et aucun ne modifie le vault :

- **Une modification d'une note** — de son texte ou de l'une de ses propriétés — devient une proposition dans la marge de la note, signée du nom de l'app et de « (app d'IA) ». Vous y acceptez ou refusez chaque modification, comme pour toute proposition (voir [Commentaires et suggestions](Comments_and_Suggestions.md)).
- **Une nouvelle note** devient un brouillon sous **En attente**, dans l'onglet IA. Elle existe dès que vous y choisissez **Créer**.
- **Renommer, déplacer et supprimer** demandent d'abord. Plainva montre dans sa propre fenêtre ce qui se passerait — pour un renommage, aussi les notes dont les liens suivraient —, et l'app affiche un message indiquant que Plainva attend. Ce n'est qu'après **Autoriser** dans Plainva, et une fois que l'app continue, que Plainva le fait comme lorsque vous le faites à la main ; l'app apprend seulement si cela a été fait. Pour une suppression, Plainva ouvre alors sa propre boîte de dialogue de suppression, et rien ne disparaît avant que vous n'y confirmiez. Une app qui ne peut pas afficher un tel message ne se voit pas proposer ces trois outils.

Une adresse web qu'une app apporte est écrite de façon que rien ne l'ouvre ni ne la charge (`https[://]…`), comme pour l'assistant. Les règles de confidentialité propres à une note (`plainva.ai`) ne sont définies par aucune app, et dans un espace de travail chiffré rien n'est proposé, rédigé ni planifié. **Demandes récentes** dans les paramètres indique pour chaque requête ce qu'elle est devenue — y compris que Plainva vous a posé la question, ou que vous avez dit non.

## Limites

- Ordinateur uniquement : les téléphones n'exécutent pas ces apps, et ni iOS ni Android ne laissent une app offrir à une autre un canal privé.
- ChatGPT et claude.ai dans le navigateur ne peuvent pas l'atteindre : ils ne se connectent qu'à des serveurs sur internet, et Plainva n'en exploite pas.
- Une app ne modifie jamais le vault d'elle-même : ce qu'elle écrit attend sous forme de proposition ou de brouillon, et renommer, déplacer ou supprimer demande votre oui dans Plainva.
