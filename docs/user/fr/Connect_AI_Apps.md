# Connecter des apps d'IA (bêta)

Dernière mise à jour : 2026-11-18

Les apps d'IA de votre ordinateur — Claude Code, Claude Desktop, Cursor, VS Code et d'autres qui parlent le Model Context Protocol (MCP) — peuvent lire votre vault à travers Plainva : y chercher, lire des notes et leurs sections, des plans, des backlinks, des bases de données, des tâches et les notes récentes, et ouvrir une note dans Plainva. D'elles-mêmes, elles ne modifient rien : une app que vous y autorisez peut proposer des modifications, et celles-ci attendent votre décision (voir plus bas). Cela fait partie des fonctions d'IA expérimentales et ne marche que sur ordinateur.

Le sens inverse — l'assistant de Plainva utilisant les outils de serveurs que vous connectez vous-même — est décrit sous **Outils externes** dans [Assistant IA](AI_Assistant.md).

Une troisième voie — Plainva démarre un agent d'IA d'un autre éditeur dans le dossier du vault, avec sa session dans l'onglet IA — est décrite dans [Agents externes](External_Agents.md).

## Comment ça marche

Plainva installe à côté de l'app un petit programme d'assistance, `plainva-mcp`. Une app d'IA le lance, et le programme se connecte à Plainva en cours d'exécution par un canal privé de cet ordinateur — un tube nommé sous Windows, un socket dans un dossier privé sous macOS et Linux. Aucun port réseau n'est jamais ouvert. Plainva doit être ouvert avec le vault ; sinon, l'app reçoit un message clair.

## L'activer

1. Ouvrez **Paramètres → IA** et activez **Utiliser l'IA sur cet appareil** ; la carte **Apps d'IA sur cet ordinateur** se trouve plus bas sur la page.
2. Activez **Laisser les apps d'IA de cet ordinateur lire ce vault**.
3. Configurez l'app (voir plus bas). À sa première connexion, Plainva demande de quelle app il s'agit, quel programme l'a lancée et quels dossiers elle peut lire. Rien n'est coché : choisissez parmi les dossiers de premier niveau du vault ou **Tout le vault**, puis **Autoriser**. **Refuser** écarte l'app, et Plainva ne redemande pas pour elle pendant dix minutes. Sous les dossiers se trouve **Peut proposer des modifications** — désactivé tant que vous ne le cochez pas ; ce qu'il permet est décrit plus bas.

L'app garde un secret dans le trousseau du système pour la prochaine fois. Les dossiers sont accordés par app et par vault : dans un autre vault, l'app redemande. Si vous ouvrez un autre vault, les apps connectées au précédent sont déconnectées ; elles ne lisent le nouveau qu'après s'être reconnectées. Tant que **Entièrement local** est activé (voir [Assistant IA](AI_Assistant.md)), le serveur est au repos : aucune app ne peut lire le vault, et une app qui se connecte est refusée.

## Configurer une app

- **Claude Code :** copiez la **Commande pour Claude Code** depuis les paramètres et exécutez-la dans un terminal.
- **Claude Desktop :** **Créer le paquet…** écrit un fichier `plainva.mcpb` ; ouvrez-le, et Claude Desktop installe Plainva.
- **Autres apps (JSON) :** copiez la configuration et ajoutez-la aux réglages MCP de l'app, par exemple au `mcp.json` de Cursor.

## Ce qu'une app voit

Uniquement les dossiers que vous avez autorisés, et uniquement ce que vos règles de confidentialité laissent partir vers un modèle cloud qui peut accéder à Internet — une app est traitée comme tel, car Plainva ne voit pas ce qu'elle fait de ce qu'elle lit : les notes avec `cloud: deny` ou `web: deny`, ou dans un dossier avec l'une de ces règles, n'existent pas pour une app — ni leur texte ni leurs titres —, les liens vers elles sont retenus, et les lieux du journal ne partent jamais. Une note d'un dossier autorisé dont le nom ne peut pas être jugé tel quel — il se termine par un espace ou un point, contient un deux-points ou n'est pas en forme Unicode composée — est aussi laissée de côté, et la réponse dit combien de notes ont été laissées de côté. Les dossiers propres à Plainva (`.plainva`, `.agent`) et les règles elles-mêmes ne sont jamais lisibles. Chaque chemin d'une requête et d'une réponse est vérifié deux fois : dans la fenêtre de l'app et dans la partie native de Plainva. Un lien de dossier qui, dans un dossier autorisé, mène ailleurs n'est pas suivi, et une base de données ne répond qu'avec des valeurs calculées à partir de notes que l'app peut lire : un nombre ou une somme sur des liens vers d'autres dossiers laisse ces notes de côté. Un lien dans ce que lit une app n'est conservé que s'il mène à une note que l'app peut lire ; tout autre — même vers une note qui n'existe pas — est retenu. Une recherche ne trouve pas une note par le texte d'un lien retenu et, dans le doute, la laisse de côté ; une modification qui toucherait un lien retenu ou porterait son espace réservé dans une note est refusée.

Les paramètres listent les apps que vous avez autorisées sur cet ordinateur avec leurs dossiers dans ce vault (**aucun dans ce vault** pour une app autorisée seulement ailleurs) et les dernières requêtes. **Retirer** reprend l'autorisation d'une app dans tous les vaults. Cela vaut aussitôt — y compris pour une app connectée à ce moment-là.

Tant que l'espace de travail chiffré du vault ouvert n'est pas ouvert sur cet appareil — il est verrouillé, ou cet appareil ne détient aucune clé pour lui —, Plainva ne répond à aucune app : chaque requête — y compris une liste ou une recherche — est refusée avec un message qui dit lequel des deux cas s'applique, une requête en cours au moment où vous le verrouillez ne reçoit rien de ce qu'elle a trouvé, et une app qui se connecte en est informée aussitôt. Déverrouillez l'espace, ou configurez-le sur cet appareil, et la même connexion répond de nouveau. Une autorisation suit le nom du dossier : si vous renommez un dossier autorisé, l'app ne le voit plus tant que vous ne l'autorisez pas à nouveau, et un nouveau dossier portant l'ancien nom lui serait visible.

En plus des outils, Plainva propose cinq de ses compétences comme prompts, dans la propre langue de Plainva, et la référence du format de fichier comme ressource (`plainva://format`) : les prompts sont `daily-orientation`, `weekly-review`, `project-status`, `meeting-prep` et `task-triage` ; `project-status` demande le nom du projet et `meeting-prep` la réunion. Une app qui prend en charge les prompts les affiche parmi ses commandes.

## Laisser une app proposer des modifications

Lire n'est jamais une autorisation d'écrire. Qu'une app puisse aussi proposer des modifications est une réponse à part : **Peut proposer des modifications** dans la question posée à sa première connexion, ou plus tard l'interrupteur **… peut proposer des modifications** dans les paramètres — par app et par vault, et désactivé tant que vous ne l'activez pas. Il vaut dès la prochaine requête de l'app ; Plainva signale aussitôt à une app connectée que ses outils ont changé (une app qui utilise la révision la plus récente du protocole ne l'apprend que si elle a demandé à en être informée) — qu'elle les affiche alors sans se reconnecter dépend de l'app.

Une app que vous y avez autorisée reçoit six outils de plus, et aucun ne modifie le vault :

- **Une modification d'une note** — de son texte ou de l'une de ses propriétés — devient une proposition dans la marge de la note, signée du nom de l'app et de « (app d'IA) ». Vous y acceptez ou refusez chaque modification, comme pour toute proposition (voir [Commentaires et suggestions](Comments_and_Suggestions.md)).
- **Une nouvelle note** devient un brouillon sous **À décider**, dans l'onglet IA. Elle existe dès que vous y choisissez **Créer**.
- **Renommer, déplacer et supprimer** demandent d'abord. Plainva montre dans sa propre fenêtre ce qui se passerait — pour un renommage, aussi les notes dont les liens suivraient —, et l'app affiche un message indiquant que Plainva attend. Ce n'est qu'après **Autoriser** dans Plainva, et une fois que l'app continue, que Plainva le fait comme lorsque vous le faites à la main ; l'app apprend seulement si cela a été fait. Pour une suppression, Plainva ouvre alors sa propre boîte de dialogue de suppression, et rien ne disparaît avant que vous n'y confirmiez. Une app qui ne peut pas afficher un tel message — il lui faut la révision 2026-07-28 ou plus récente du protocole MCP, et elle doit pouvoir vous poser une question dans un formulaire — ne se voit pas proposer ces trois outils.

Une adresse web qu'une app apporte est écrite de façon que rien ne l'ouvre ni ne la charge (`https[://]…`), comme pour l'assistant. Les règles de confidentialité propres à une note (`plainva.ai`) ne sont définies par aucune app, et dans un espace de travail chiffré rien n'est proposé, rédigé ni planifié. La liste des demandes récentes dans les paramètres montre les huit plus récentes et marque celles pour lesquelles Plainva vous a posé la question (**question posée**), celles que vous avez déclinées (**déclinée**) et celles qui n'ont pas abouti (**refusée**) ; une requête qui a abouti ne porte aucun mot.

## Limites

- Ordinateur uniquement : les téléphones n'exécutent pas ces apps, et ni iOS ni Android ne laissent une app offrir à une autre un canal privé.
- ChatGPT et claude.ai dans le navigateur ne peuvent pas l'atteindre : ils ne se connectent qu'à des serveurs sur internet, et Plainva n'en exploite pas.
- Une app ne modifie jamais le vault d'elle-même : ce qu'elle écrit attend sous forme de proposition ou de brouillon, et renommer, déplacer ou supprimer demande votre oui dans Plainva.
