# Connecter des apps d'IA (bêta)

Dernière mise à jour : 2026-10-07

Les apps d'IA de votre ordinateur — Claude Code, Claude Desktop, Cursor, VS Code et d'autres qui parlent le Model Context Protocol (MCP) — peuvent lire votre vault à travers Plainva : y chercher, lire des notes et leurs sections, des plans, des backlinks, des bases de données, des tâches et les notes récentes, et ouvrir une note dans Plainva. Elles ne peuvent rien modifier. Cela fait partie des fonctions d'IA expérimentales et ne marche que sur ordinateur.

Le sens inverse — l'assistant de Plainva utilisant les outils de serveurs que vous connectez vous-même — est décrit sous **Outils externes (MCP)** dans [Assistant IA](AI_Assistant.md).

Une troisième voie — Plainva démarre un agent d'IA d'un autre éditeur dans le dossier du vault, avec sa session dans l'onglet IA — est décrite dans [Agents externes](External_Agents.md).

## Comment ça marche

Plainva installe à côté de l'app un petit programme d'assistance, `plainva-mcp`. Une app d'IA le lance, et le programme se connecte à Plainva en cours d'exécution par un canal privé de cet ordinateur — un tube nommé sous Windows, un socket dans un dossier privé sous macOS et Linux. Aucun port réseau n'est jamais ouvert. Plainva doit être ouvert avec le vault ; sinon, l'app reçoit un message clair.

## L'activer

1. Ouvrez **Paramètres → IA & automatisation** et activez **Utiliser l'IA sur cet appareil**.
2. Activez **Laisser les apps d'IA de cet ordinateur lire ce vault**.
3. Configurez l'app (voir plus bas). À sa première connexion, Plainva demande de quelle app il s'agit, quel programme l'a lancée et quels dossiers elle peut lire. Rien n'est coché : choisissez des dossiers ou **Tout le vault**, puis **Autoriser**. **Refuser** écarte l'app, et Plainva ne redemande pas pour elle pendant dix minutes.

L'app garde un secret dans le trousseau du système pour la prochaine fois. Les dossiers sont accordés par app et par vault : dans un autre vault, l'app redemande.

## Configurer une app

- **Claude Code :** copiez la **Commande pour Claude Code** depuis les paramètres et exécutez-la dans un terminal.
- **Claude Desktop :** **Créer le paquet…** écrit un fichier `plainva.mcpb` ; ouvrez-le, et Claude Desktop installe Plainva.
- **Autres apps (JSON) :** copiez la configuration et ajoutez-la aux réglages MCP de l'app, par exemple au `mcp.json` de Cursor.

## Ce qu'une app voit

Uniquement les dossiers que vous avez autorisés, et uniquement ce que vos règles de confidentialité laissent partir vers un modèle cloud : les notes avec `cloud: deny`, ou dans un dossier avec cette règle, n'existent pas pour une app — ni leur texte ni leurs titres —, les liens vers elles sont retenus, et les lieux du journal ne partent jamais. Les dossiers propres à Plainva (`.plainva`, `.agent`) et les règles elles-mêmes ne sont jamais lisibles. Chaque chemin d'une requête et d'une réponse est vérifié deux fois : dans la fenêtre de l'app et dans la partie native de Plainva.

Les paramètres listent les apps autorisées avec leurs dossiers et les dernières requêtes. **Retirer** reprend l'autorisation d'une app dans tous les vaults.

En plus des outils, Plainva propose ses trois compétences comme prompts, dans la langue de l'app : `daily-orientation`, `weekly-review` et `project-status`, qui demande le nom du projet. Une app qui prend en charge les prompts les affiche parmi ses commandes.

## Limites

- Ordinateur uniquement : les téléphones n'exécutent pas ces apps, et ni iOS ni Android ne laissent une app offrir à une autre un canal privé.
- ChatGPT et claude.ai dans le navigateur ne peuvent pas l'atteindre : ils ne se connectent qu'à des serveurs sur internet, et Plainva n'en exploite pas.
- Lecture seule ; laisser une app proposer des modifications viendra dans une version ultérieure.
