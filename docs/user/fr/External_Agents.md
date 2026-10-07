# Agents externes (Bêta)

Dernière mise à jour : 2026-10-07

Un agent externe est un programme d'IA d'un autre éditeur — un agent que vous avez installé sur votre ordinateur et auquel vous vous êtes connecté vous-même, avec votre propre abonnement ou votre propre clé. Plainva peut démarrer un tel agent dans le dossier d'un vault et afficher sa session dans l'onglet IA. Cela fait partie des fonctions d'IA expérimentales et ne marche que sur ordinateur.

Un agent externe n'est pas l'assistant de Plainva. L'[Assistant IA](AI_Assistant.md) n'envoie que ce que son aperçu vous a montré, et jamais ce que vos règles de confidentialité retiennent. Un agent lit et envoie de lui-même. Cette page dit ce que Plainva contrôle dans une telle session — et ce qu'il ne contrôle pas.

## Ce que Plainva ne contrôle pas

- **Le programme.** Un agent est le programme de quelqu'un d'autre. Il s'exécute sur cet ordinateur avec vos droits, dans le dossier du vault, et il n'est pas cloisonné : il peut lire et modifier tout ce que vous pouvez lire et modifier.
- **Ce qu'il lit et envoie.** Il lit les fichiers lui-même — y compris les notes que vous tenez à l'écart du cloud — et envoie ce qu'il choisit à son propre service. Vos règles de confidentialité et l'aperçu avant l'envoi ne l'atteignent pas, et rien ne vous demande avant qu'il n'envoie.
- **Ce qu'il écrit lui-même.** Une modification que l'agent fait lui-même est aussitôt dans le vault, sans proposition. La session vous le dit quand l'agent signale une telle modification ; une modification qu'il ne signale pas, Plainva ne la voit pas.
- **Sa connexion.** L'agent se connecte lui-même. Plainva ne voit jamais ses identifiants et n'en conserve aucun.

Ne démarrez un agent que dans un vault dont le contenu peut atteindre le service de l'agent.

## Ce que Plainva contrôle

- **Ses propres outils.** Là où **Laisser les apps d'IA de cet ordinateur lire ce vault** est activé, les outils de Plainva sont proposés à l'agent — les mêmes que pour toute app de [Connecter des apps d'IA](Connect_AI_Apps.md) : uniquement les dossiers que vous accordez, jamais une note tenue à l'écart du cloud ou d'Internet, et en lecture seule — sauf si vous l'y autorisez à proposer des modifications.
- **Ce que l'agent demande à Plainva de lire.** Une note tenue à l'écart du cloud ou d'internet et les dossiers propres à Plainva ne sont pas remis. L'agent en est informé, et vous aussi.
- **Ce que l'agent demande à Plainva d'écrire.** Rien n'est écrit. Une modification d'une note devient une série de propositions au nom de l'agent, et une nouvelle note attend, comme brouillon, que vous la créiez.
- **Pas de terminal.** Plainva ne propose à un agent aucun terminal à lui.

## Ajouter un agent

1. Installez l'agent vous-même, comme son éditeur le décrit, et connectez-vous à lui dans son propre programme.
2. Ouvrez **Paramètres → IA & automatisation** (la partie Application). Sous **Agents externes**, **Trouvé sur cet ordinateur** signale les agents que Plainva connaît par leur nom et trouve installés ; **Ajouter** en ajoute un. Pour tout autre programme qui parle l'Agent Client Protocol, choisissez **Ajouter un agent…** sous **Autre agent** et remplissez **Nom**, **Programme** et **Arguments, un par ligne**.
3. Votre système affiche la commande entière une fois de plus avant qu'elle ne soit mémorisée.

Plainva n'installe aucun agent et n'en télécharge aucun. Il démarre exactement le programme que vous avez confirmé, directement et sans shell. La commande est mémorisée sur cet appareil, jamais dans le vault. **Retirer** fait oublier à Plainva comment démarrer un agent ; le programme lui-même et sa connexion restent tels quels.

## Démarrer une session

Ouvrez l'onglet IA et choisissez **Agent**. Avant que quoi que ce soit ne démarre, **Avant de démarrer ⟨agent⟩** énumère ce que l'agent fait de lui-même et ce que Plainva contrôle, et dit si les outils de Plainva seront proposés. **Démarrer la session** démarre le programme de l'agent dans le dossier du vault. La première fois que vous démarrez un agent dans un vault depuis l'ouverture de Plainva, votre système demande une fois de plus et affiche le dossier et la commande entière.

Une seule session s'exécute à la fois, et elle appartient au vault dans lequel elle a été démarrée : **Terminer la session** arrête le programme de l'agent, et fermer le vault ou Plainva aussi. Tant qu'elle s'exécute, la première ligne de la session dit qui est l'agent et que vos règles de confidentialité ne s'appliquent pas à lui. Aucun agent n'est démarré dans un espace chiffré.

## Se connecter

Un agent qui n'est pas connecté le dit, et la session affiche **⟨agent⟩ demande une connexion** avec les moyens que l'agent nomme. Selon l'agent, en choisir un ouvre une fenêtre de terminal avec le propre programme de l'agent, ou l'agent vous mène lui-même à sa connexion. Plainva attend, puis démarre l'agent à nouveau. Là où aucun terminal ne peut être ouvert, Plainva affiche la commande à exécuter dans un terminal à vous ; choisissez ensuite **Réessayer**. Plainva ne voit rien de la connexion.

## Dans une session

Écrivez ce que l'agent doit faire. La note que vous avez ouverte est nommée à l'agent — son nom et son emplacement, pas son texte —, sauf si vous la retirez au-dessus du champ de saisie ; une note que vous tenez à l'écart du cloud ou d'internet n'est jamais nommée. La session affiche ce que dit l'agent, son plan et chacune de ses étapes, avec les fichiers du vault qu'il nomme.

Quand l'agent veut votre accord pour une étape, **⟨agent⟩ demande** l'affiche. Les mots sont ceux de l'agent, et les choix sont ceux que l'agent propose — **Autoriser**, **Toujours autoriser**, **Refuser**, **Toujours refuser**. Votre réponse ne va qu'à l'agent : ce qu'il fait après un oui est son affaire, et un « toujours » est une promesse que tient l'agent, pas Plainva.

**Arrêter** met fin à la réponse sur laquelle l'agent travaille.

## Ce que l'agent écrit

**Par Plainva.** Une modification que l'agent remet à Plainva n'est jamais écrite dans la note. Quand la réponse de l'agent est terminée, chaque note qu'il a modifiée porte une série de propositions, signée **⟨nom⟩ (agent externe)** : sous **Propositions**, vous acceptez ou refusez chaque modification ou toute la série, comme pour la série d'une personne. Une propriété que le texte de l'agent modifie figure dans cette série comme valeur proposée, comme celles que propose l'IA de Plainva. Une note qui n'existe pas encore attend comme brouillon — une carte **Brouillon · Note** dans la session, et la même carte dans la liste **En attente** de l'onglet IA, où elle reste une fois la session terminée. **Créer** l'écrit exactement à l'endroit que l'agent a nommé — marquée `generated`, avec l'agent comme auteur —, et **Abandonner** la laisse tomber. Les adresses web que l'agent a apportées sont écrites de façon que rien ne les ouvre ni ne les charge (`https[://]…`).

Plainva n'accepte pas tout : uniquement des notes Markdown ; ni règles d'IA, ni champs de confiance, ni propriétés propres à Plainva ; aucune valeur de propriété qui ne soit ni du texte, ni un nombre, ni oui ou non, ni une liste de ceux-ci ; rien de ce qui est tenu à l'écart du cloud ou d'internet ; pas plus de 150 modifications d'une note à la fois ; et aucune autre nouvelle note tant que trop de brouillons attendent. Ce qu'il n'a pas accepté, la session le dit, et l'agent en est informé.

**De lui-même.** Un agent peut aussi écrire des fichiers de lui-même, comme n'importe quel programme. Quand il signale une telle modification, la session dit **L'agent a modifié ⟨note⟩ lui-même : c'est dans le vault sans proposition.** Quel chemin prend un agent, Plainva ne peut pas le promettre : cela dépend de l'agent et de la façon dont il est configuré. Dans les paramètres, chaque agent montre ce qui a été vu pour la dernière fois sur cet ordinateur — combien de modifications sont passées par Plainva et combien il a écrites lui-même.

## Ce que Plainva conserve

- **Sur cet appareil :** la commande que vous avez confirmée, votre nom pour l'agent et ce qui a été vu pour la dernière fois de ses modifications — dans les données propres à Plainva, jamais dans le vault.
- **Par vault :** **Dernières sessions dans ce vault** indique quand une session a eu lieu, avec quel agent, et combien il y a eu de messages, de modifications par Plainva et de modifications propres — jamais ce qui a été dit.
- **Pas la session elle-même :** ce que vous et l'agent avez dit disparaît une fois la session fermée. Ce que l'agent conserve de son côté est l'affaire de l'agent.

Si le programme de l'agent se termine de lui-même, la session le dit, et **Afficher ses dernières lignes** affiche la fin de ce que le programme a écrit.

## Limites

- Ordinateur uniquement, et uniquement dans la fenêtre principale. Sur le téléphone, il y a l'assistant propre à Plainva.
- Pas dans un espace chiffré.
- Une session à la fois, et pas d'historique : une session terminée ne peut pas être rouverte.
- Les modes, modèles et commandes propres à un agent ne peuvent pas être choisis depuis Plainva, et on ne peut pas lui envoyer d'images.
- Jusqu'ici, cela n'a été essayé qu'avec un agent de test propre à Plainva. Quels agents fonctionnent ici, et lesquels remettent leurs modifications à Plainva, se voit en les essayant — vos retours sont les bienvenus.
