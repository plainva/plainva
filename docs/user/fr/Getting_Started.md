# Prise en main

Dernière mise à jour : 2026-07-18

Cette page vous accompagne de l'installation à votre premier vrai travail : ouvrir ou créer un vault, découvrir l'interface et comprendre les trois modes de l'éditeur.

## Qu'est-ce qu'un vault ?

Un vault est un dossier ordinaire sur votre ordinateur qui contient vos notes Markdown. Plainva y ajoute un sous-dossier caché `.plainva/` pour l'index de recherche et les paramètres — vos notes elles-mêmes restent de simples fichiers `.md` intacts. Vous pouvez avoir plusieurs vaults (par exemple « Personnel » et « Travail ») et basculer entre eux.

## Ouvrir ou créer un vault

Au démarrage, l'écran d'accueil vous accueille :

- **Ouvrir un vault** — Plainva demande d'abord **« Où se trouve votre vault ? »** : **Dossier local** ouvre un dossier existant de fichiers Markdown sur cet ordinateur (les vaults Obsidian fonctionnent aussi directement) ; **Vault en ligne** synchronise un vault existant depuis le cloud dans un dossier local — les mêmes trois étapes pour chaque fournisseur (**Se connecter**, **choisir le dossier dans le cloud**, **choisir le dossier local** ; voir [Configurer la synchronisation](Sync_Setup.md)).
- **Nouveau vault** — la première question est **« Où votre vault doit-il se trouver ? »** (**Sur cet ordinateur** ou **Chez un service en ligne**), puis vous choisissez la structure de départ : commencez à vide ou à partir d'une structure de dossiers prête à l'emploi ; les deux sont modifiables à tout moment. Le **Vault vide** ne contient qu'un aperçu `index.md`. Modèles disponibles : **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** et **Journal** — chacun crée des dossiers, une note de bienvenue avec un guide rapide et des aperçus `index.md` maintenus automatiquement au [format OKF](OKF.md) (les noms de dossiers et de fichiers suivent la langue de l'application). Le modèle **Journal** configure en plus les paramètres de notes quotidiennes du vault. Les modèles **PARA**, **GTD**, **Zettelkasten** et **Journal** fournissent aussi des [bases de données](Databases_Base.md) déjà reliées avec des modèles de notes assortis — par exemple des projets avec un board de statut et un lien vers un domaine, ou des tâches qui pointent vers leur projet. Sur la voie en ligne, la connexion vient après la structure de départ : choisir le fournisseur, se connecter, choisir le dossier dans le cloud ou en créer un nouveau via **Nouveau dossier**, choisir le dossier local — la structure choisie est créée dans le dossier local et envoyée dans le cloud lors de la première synchronisation.

**Vaults récents** liste tout ce que vous avez déjà ouvert. **Retirer de la liste** supprime une entrée uniquement de Plainva — les fichiers restent sur le disque. Activez **Ouvrir automatiquement le dernier vault au démarrage** pour ignorer l'écran d'accueil à l'avenir. Lors du retrait, Plainva demande s'il faut en plus oublier toutes les données d'application du vault (index de recherche, réglages, disposition de la fenêtre, identifiants de synchronisation ; sauvegardes ZIP automatiques uniquement via la case dédiée) — votre dossier de vault reste dans tous les cas intact.

## L'interface

- **Barre latérale gauche** — quatre vues : **Fichiers** (l'arborescence de fichiers), **Tags** (tous les `#tags` du vault), **Signets** et **Bases de données** (chaque `.base` du vault, regroupée par dossier — un clic l'ouvre). En haut se trouve le grand bouton **Nouveau** (Nouvelle note, avec **Plus d'options** pour Nouveau dossier, Nouvelle base, Note quotidienne). En bas : le sélecteur de vault, **Ouvrir la note quotidienne** et **Paramètres**. Le bouton à double chevron à côté des quatre vues replie ou déplie tous les dossiers d'un coup, et **Afficher dans l'arborescence de fichiers** dans le menu ⋮ de l'éditeur affiche directement la note ouverte dans l'arborescence. Dans la vue **Fichiers**, un en-tête affiche le nom et l'icône du vault actuel, et un bandeau **Ouverts récemment** au-dessus de l'arborescence donne un accès en un clic aux notes que vous avez ouvertes le plus récemment.
- **Barre de titre** — vos onglets ouverts. Les onglets peuvent être réordonnés par glisser-déposer et déplacés entre les volets de l'éditeur.
- **Zone de l'éditeur** — où vous lisez et écrivez. Via le menu de l'onglet (**Scinder à droite** / **Scinder en bas**) ou les raccourcis `Ctrl+Alt+V` / `Ctrl+Alt+S`, vous scindez l'éditeur en deux volets, par exemple une note à côté d'une base de données.
- **Barre latérale droite** — quatre sections, réorganisables par glisser-déposer : **Calendrier** (notes quotidiennes), **Plan** (titres de la note active), **Backlinks** (qui renvoie ici) et **Propriétés** (le frontmatter de la note).
- **Barre d'état** — nombre de mots/caractères, statut de synchronisation (Local/En ligne/Hors ligne) et statut d'enregistrement (**Enregistrement...** / **Enregistré**).

## Les trois modes de l'éditeur

Changez de mode en haut à droite de l'éditeur :

| Mode | À quoi ça sert |
|---|---|
| **Mode lecture** | Vue entièrement rendue pour lire et naviguer. Les liens s'ouvrent directement dans Plainva. |
| **Aperçu en direct** | Le mode par défaut pour écrire : le Markdown se rend au fur et à mesure que vous tapez ; les caractères de mise en forme n'apparaissent que là où vous travaillez. |
| **Source Markdown** | Le texte brut sans rendu — pour un contrôle total. |

Le mode dans lequel les notes s'ouvrent est votre choix : choisissez la **Vue par défaut** sous **Paramètres → App → Éditeur et notes** (lecture, direct ou source). Changer de mode dans l'éditeur s'applique au fichier pour la session en cours.

Vous pouvez aussi basculer entre **Largeur de lecture** et **Pleine largeur**.

## Bases de l'arborescence de fichiers

- **Créer :** clic droit sur un dossier → **Nouvelle note ici**, **Nouveau dossier** ou **Nouvelle base de données (.base)**. Le grand bouton **Nouveau** crée dans le dossier actuellement sélectionné (ou le dossier parent d'un fichier sélectionné).
- **Sélectionner :** un clic sélectionne, `Ctrl`+clic ajoute/retire individuellement, `Shift`+clic sélectionne une plage, un clic central ouvre dans un nouvel onglet.
- **Menu contextuel :** comprend **Renommer** (met à jour les liens dans tout le vault), **Dupliquer**, **Ouvrir dans la vue scindée (droite)** / **Ouvrir dans la vue scindée (bas)**, **Ajouter un signet**, **Copier le chemin**, **Afficher dans le gestionnaire de fichiers**, **Supprimer**.
- **Sélection multiple :** la suppression ne demande qu'une seule confirmation pour tous les éléments, la duplication et le déplacement par glisser-déposer fonctionnent sur toute la sélection. Les éléments supprimés vont dans la corbeille du système d'exploitation.
- Les nouvelles notes commencent automatiquement par un `# Titre` dérivé du nom du fichier.
- La propre `index.md` d'un dossier (son aperçu) se trie en **haut** de ce dossier dans l'arborescence, au-dessus de ses sous-dossiers et fichiers — pas alphabétiquement parmi les autres notes.

## Notes quotidiennes

Le bouton **Note quotidienne** dans la barre d'actions à gauche ouvre ou crée la note du jour. Configurez le dossier de base, le format de date et un modèle facultatif sous **Paramètres → Vault → Contenu et structure** (**Choisir un dossier…** à côté du champ permet de choisir le dossier directement dans le vault).

Le **Calendrier** à droite est un aperçu du jour : cliquer sur une date ouvre un petit aperçu avec les événements et les tâches à échéance de ce jour-là, plus l'action **Note quotidienne** ; un clic droit propose la même chose sous forme de menu. Les jours avec une note quotidienne portent une petite icône de lever de soleil, les jours avec des événements des points colorés par calendrier. Le bouton **Aujourd'hui** revient au mois en cours ; cliquer sur le libellé du mois ouvre un sélecteur rapide de mois/année. Vous pouvez aussi y activer **Afficher les numéros de semaine** pour ajouter une colonne de semaine ISO — le réglage est mémorisé.

## Paramètres

**Paramètres** (icône d'engrenage en bas de la barre d'actions tout à gauche, ou `Ctrl+,`) se ferment via le **X** en haut à droite, `Esc` ou un clic en dehors de la fenêtre. Les modifications sont enregistrées immédiatement et automatiquement — seuls les identifiants de synchronisation sont appliqués délibérément via **Enregistrer**/**Se connecter** (voir [Configurer la synchronisation](Sync_Setup.md)). Les paramètres se composent de deux parties ; chaque zone dans le panneau de gauche ouvre sa propre page, où les paramètres se trouvent dans des cartes de groupe nommées :

- **App** — tout ce qui s'applique à toute l'application, réparti en cinq zones. **Apparence** : le sélecteur de **Thème** sous forme de cartes d'aperçu — en plus de **Pétrole** (par défaut), vous avez **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (façon e-ink, maximalement calme), **Sépia** (papier chaud), **Forêt**, **Minuit** (noir OLED), **Contraste élevé** et **Phosphore vert**/**Phosphore ambre** (terminal rétro avec de subtils effets de balayage) ; plus le **Mode** (**Clair**/**Sombre**/**Par défaut du système** ; les thèmes à mode unique comme **Minuit** imposent le mode, et le bascule clair/sombre de la barre de titre se met en pause pendant qu'ils sont actifs), **Langue**, **Début de la semaine**, **Densité** et **Zoom de l'interface**. **Éditeur et notes** : **Vue par défaut**, **Taille de police du contenu** et **Police du contenu**. **Démarrage et comportement** : l'ouverture automatique du dernier vault, les avertissements de compatibilité. **Mises à jour** : Plainva vérifie discrètement la disponibilité de nouvelles versions au démarrage et affiche un avis lorsqu'il en trouve une — cliquer dessus télécharge et installe la mise à jour immédiatement (l'avis reste affiché jusqu'au redémarrage de Plainva). Désactivable via **Rechercher des mises à jour au démarrage**. **À propos et diagnostic** : les informations de version, le statut du **Trousseau du système**, **Mesures de performance**, **Exporter le diagnostic…** (sans contenu de note) et **Signaler un problème**. Les raccourcis clavier restent accessibles à tout moment via `F1` ou **Afficher les raccourcis clavier** en bas à gauche.
- **Vault** — le vault sélectionné se trouve sous forme de petite carte dans le panneau (le vault actif porte un point) ; avec plusieurs vaults, **Changer** en dessous ouvre une liste de sélection. En dessous, cinq zones par vault : **Synchronisation** (voir [Configurer la synchronisation](Sync_Setup.md)), **Calendrier et comptes** (calendrier et comptes e-mail, voir [Calendrier & tâches](Calendar_and_Tasks.md) et [Capture d'e-mails](Email_Capture.md)), **Contenu et structure** (**Notes quotidiennes**, **Modèles et tâches** y compris le **Dossier de modèles**, **OKF (Open Knowledge Format)** — voir [OKF](OKF.md) — et **Bases de données étendues**), **Sauvegarde & historique des versions** et **Maintenance** (**Reconstruire l'index**, restaurer les fichiers supprimés, statistiques du vault).

## Personnaliser l'interface

- **Basculer les barres latérales** via les deux boutons de la barre de titre ou `Ctrl+Alt+B` (gauche) / `Ctrl+Alt+R` (droite) — idéal pour écrire en pleine concentration. Plainva se souvient de l'état.
- **Palette de commandes** : `Ctrl+P` ouvre **Commandes** — tapez et appuyez sur `Entrée` pour exécuter (nouvelle note, note quotidienne, scission, barres latérales, **Sauvegarder maintenant**, et bien plus).
- **Densité** : sous **Paramètres → App → Apparence**, choisissez entre **Confortable** et **Compact** — Compact resserre les listes, menus et lignes de tableau ; le contenu des notes n'est pas affecté.
- **Police du contenu** : sous **Paramètres → App → Éditeur et notes**, réglez la **Taille de police du contenu** (12–24 px) et la **Police du contenu** (défaut du thème, serif, sans-serif, monospace ou le nom d'une police installée) — cela ne redimensionne que l'éditeur et la vue de lecture ; l'interface reste inchangée.
- **Zoom de l'interface** : redimensionne TOUTE l'interface entre 80 % et 150 % — sous **Paramètres → App → Apparence** ou via `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` réinitialise).
- **Boîtes de dialogue et notifications natives-free** : les confirmations apparaissent comme des boîtes de dialogue Plainva stylées selon votre thème (les actions destructrices ont un bouton rouge), les brefs avis comme des toasts discrets en bas à droite — plus de fenêtres système.

## Voir aussi

- [Notes & Markdown](Notes_and_Markdown.md) — tout sur l'écriture
- [Raccourcis clavier](Keyboard_Shortcuts.md)
- [FAQ & dépannage](FAQ.md)

## Le graphe

Via **Ctrl/Cmd+Shift+G** (ou la section **Graphe** dans la barre latérale droite), vous voyez votre coffre comme une carte : les dossiers sous forme de bulles, les notes sous forme de nœuds, les relations sous forme d'arêtes étiquetées — avec un mode de nettoyage et un voyage dans le temps. Détails : [Graphe](Graph.md).
