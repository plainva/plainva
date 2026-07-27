# Prise en main

Dernière mise à jour : 2026-07-27

Cette page vous accompagne de l'installation à votre premier vrai travail : ouvrir ou créer un vault, découvrir l'interface et comprendre les trois modes de l'éditeur.

## Qu'est-ce qu'un vault ?

Un vault est un dossier ordinaire sur votre ordinateur qui contient vos notes Markdown. Plainva y ajoute un sous-dossier caché `.plainva/` pour l'index de recherche et les paramètres — vos notes elles-mêmes restent de simples fichiers `.md` intacts. Vous pouvez avoir plusieurs vaults (par exemple « Personnel » et « Travail ») et basculer entre eux.

## Ouvrir ou créer un vault

Au démarrage, l'écran d'accueil vous accueille :

- **Ouvrir un vault** — Plainva demande d'abord **« Où se trouve votre vault ? »** : **Dossier local** ouvre un dossier existant de fichiers Markdown sur cet ordinateur (les vaults Obsidian fonctionnent aussi directement) ; **Vault en ligne** synchronise un vault existant depuis le cloud dans un dossier local — les mêmes trois étapes pour chaque fournisseur (**Se connecter**, **choisir le dossier dans le cloud**, **choisir le dossier local** ; voir [Configurer la synchronisation](Sync_Setup.md)).
- **Nouveau vault** — la première question est **« Où votre vault doit-il se trouver ? »** (**Sur cet ordinateur** ou **Chez un service en ligne**), puis vous choisissez la structure de départ : commencez à vide ou à partir d'une structure de dossiers prête à l'emploi ; les deux sont modifiables à tout moment. Le **Vault vide** ne contient qu'un aperçu `index.md`. Modèles disponibles : **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** et **Journal** — chacun crée des dossiers, une note de bienvenue avec un guide rapide et des aperçus `index.md` maintenus automatiquement au [format OKF](OKF.md) (les noms de dossiers et de fichiers suivent la langue de l'application). Le modèle **Journal** configure en plus les paramètres de notes quotidiennes du vault. Les modèles **PARA**, **GTD**, **Zettelkasten** et **Journal** fournissent aussi des [bases de données](Databases_Base.md) déjà reliées avec des modèles de notes assortis — par exemple des projets avec un board de statut et un lien vers un domaine, ou des tâches qui pointent vers leur projet. Sur la voie en ligne, la connexion vient après la structure de départ : choisir le fournisseur, se connecter, choisir le dossier dans le cloud ou en créer un nouveau via **Nouveau dossier**, choisir le dossier local — la structure choisie est créée dans le dossier local et envoyée dans le cloud lors de la première synchronisation.

**Vaults récents** liste tout ce que vous avez déjà ouvert. **Retirer de la liste** supprime une entrée uniquement de Plainva — les fichiers restent sur le disque. Activez **Ouvrir automatiquement le dernier vault au démarrage** pour ignorer l'écran d'accueil à l'avenir. Lors du retrait, Plainva demande s'il faut en plus oublier toutes les données d'application du vault (index de recherche, réglages, disposition de la fenêtre, identifiants de synchronisation ; sauvegardes ZIP automatiques uniquement via la case dédiée) — votre dossier de vault reste dans tous les cas intact.

## L'interface

- **Barre latérale gauche** — trois vues : **Fichiers** (l'arborescence de fichiers), **Tags** (tous les `#tags` du vault) et **Bases de données** (chaque `.base` du vault, regroupée par dossier — un clic l'ouvre) ; Signets et Ouverts récemment sont des sections au-dessus de l'arborescence. Tout en haut se trouve le champ de recherche, avec un **+** à côté pour Nouvelle note, Nouveau dossier, Nouvelle base et Note quotidienne. Le texte indicatif du champ de recherche précise ce qui est recherché, et les onglets affichent leur nom tant que le panneau est assez large — à mesure qu'il se rétrécit, seul l'onglet actif garde d'abord son nom, puis seules les icônes restent. En bas : le sélecteur de vault, **Ouvrir la note quotidienne** et **Paramètres**. Le bouton à double chevron à côté des trois vues replie ou déplie tous les dossiers d'un coup, et **Afficher dans l'arborescence de fichiers** dans le menu ⋮ de l'éditeur affiche directement la note ouverte dans l'arborescence. Dans la vue **Fichiers**, un en-tête affiche le nom et l'icône du vault actuel, et un bandeau **Ouverts récemment** au-dessus de l'arborescence donne un accès en un clic aux notes que vous avez ouvertes le plus récemment.
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
- **Les mêmes actions dans les sections au-dessus de l'arborescence :** un clic droit sur une entrée dans **Ouverts récemment** ou **Signets** ouvre le même menu — sans les entrées de dossier, et avec **Retirer de la liste** en plus (cela retire seulement l'entrée de la liste, jamais le fichier). Renommer s'y fait via une boîte de dialogue plutôt que dans le champ de la ligne. Les vues calendrier et tâches peuvent elles aussi apparaître dans **Ouverts récemment** ; elles peuvent être ouvertes et retirées de la liste, mais pas renommées ni supprimées — ce sont des vues, pas des fichiers.
- **Sélection multiple :** la suppression ne demande qu'une seule confirmation pour tous les éléments, la duplication et le déplacement par glisser-déposer fonctionnent sur toute la sélection. Les éléments supprimés vont dans la corbeille du système d'exploitation.
- Les nouvelles notes commencent automatiquement par un `# Titre` dérivé du nom du fichier.
- La propre `index.md` d'un dossier (son aperçu) se trie en **haut** de ce dossier dans l'arborescence, au-dessus de ses sous-dossiers et fichiers — pas alphabétiquement parmi les autres notes.
- **Relire :** la flèche circulaire dans l'en-tête de l'arborescence (ou **F5**) relit le vault — Plainva réconcilie l'index avec le dossier et, pour les vaults en ligne, récupère aussi les fichiers du cloud. Un court rapport indique ensuite ce qui était nouveau, modifié, supprimé ou ignoré. Pour un seul dossier, il y a **Relire ce dossier** dans le menu contextuel.

## Notes quotidiennes

Le bouton **Note quotidienne** dans la barre d'actions à gauche ouvre ou crée la note du jour. Configurez le dossier de base, le format de date et un modèle facultatif sous **Paramètres → Vault → Contenu et structure** (**Choisir un dossier…** à côté du champ permet de choisir le dossier directement dans le vault).

Le **Calendrier** à droite est un aperçu du jour : un **clic** sur une date ouvre l'[onglet calendrier](Calendar_and_Tasks.md) à ce jour ; un **clic droit** ouvre un menu qui indique le jour en haut et propose **Ouvrir le calendrier**, **Note quotidienne** ainsi que les événements et tâches à échéance de ce jour. Les jours avec une note quotidienne portent une petite **icône soleil**, les jours avec des événements des points colorés par calendrier. Le bouton **Aujourd'hui** revient au mois en cours ; cliquer sur le libellé du mois ouvre un sélecteur rapide de mois/année. Vous pouvez aussi y activer **Afficher les numéros de semaine** pour ajouter une colonne de semaine ISO — le réglage est mémorisé.

## Paramètres

**Paramètres** (icône d'engrenage en bas de la barre d'actions tout à gauche, ou `Ctrl+,`) se ferment via le **X** en haut à droite, `Esc` ou un clic en dehors de la fenêtre. Les modifications sont enregistrées immédiatement et automatiquement — seuls les identifiants cloud sont appliqués délibérément via **Connexion** dans la zone **Comptes cloud** (voir [Configurer la synchronisation](Sync_Setup.md)). Les paramètres se composent de deux parties ; chaque zone dans le panneau de gauche ouvre sa propre page, où les paramètres se trouvent dans des cartes de groupe nommées :

- **App** — tout ce qui s'applique à toute l'application, réparti en cinq zones. **Apparence** : le sélecteur de **Thème** sous forme de cartes d'aperçu — en plus de **Pétrole** (par défaut), vous avez **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Papier** (façon e-ink, maximalement calme), **Sépia** (papier chaud), **Forêt**, **Minuit** (noir OLED), **Contraste élevé** et **Phosphore vert**/**Phosphore ambre** (terminal rétro avec de subtils effets de balayage) ; plus le **Mode** (**Clair**/**Sombre**/**Par défaut du système** ; les thèmes à mode unique comme **Minuit** imposent le mode, et le bascule clair/sombre de la barre de titre se met en pause pendant qu'ils sont actifs), **Langue**, **Début de la semaine**, **Densité** et **Zoom de l'interface**. **Éditeur et notes** : **Vue par défaut**, **Taille de police du contenu** et **Police du contenu**. **Démarrage et comportement** : l'ouverture automatique du dernier vault, les avertissements de compatibilité. **Mises à jour** : Plainva vérifie discrètement la disponibilité de nouvelles versions au démarrage et affiche un avis lorsqu'il en trouve une — cliquer dessus télécharge et installe la mise à jour immédiatement (l'avis reste affiché jusqu'au redémarrage de Plainva). Désactivable via **Rechercher des mises à jour au démarrage**. **À propos et diagnostic** : les informations de version, le statut du **Trousseau du système**, **Mesures de performance**, **Exporter le diagnostic…** (sans contenu de note) et **Signaler un problème**. Les raccourcis clavier restent accessibles à tout moment via `F1` ou **Afficher les raccourcis clavier** en bas à gauche.
- **Vault** — le vault sélectionné se trouve sous forme de petite carte dans le panneau (le vault actif porte un point) ; avec plusieurs vaults, **Changer** en dessous ouvre une liste de sélection. En dessous, les zones par vault : **Comptes cloud** est l'endroit unique pour toutes les connexions cloud — **Connecter un compte…** choisit le fournisseur (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV ou une boîte e-mail) et les services (**Fichiers**, **Calendrier et tâches**, **E-mail**) que ce compte doit porter. Les zones de service **Synchronisation** (voir [Configurer la synchronisation](Sync_Setup.md)), **Calendrier** (voir [Calendrier & tâches](Calendar_and_Tasks.md)) et **E-mail** (voir [Capture d'e-mails](Email_Capture.md)) n'apparaissent qu'une fois qu'un compte connecté porte le service correspondant. Toujours présentes : **Contenu et structure** (**Notes quotidiennes**, **Modèles et tâches** y compris le **Dossier de modèles**, **OKF (Open Knowledge Format)** — voir [OKF](OKF.md) — et **Bases de données étendues**), **Sauvegarde & historique des versions** et **Maintenance** (**Reconstruire l'index**, restaurer les fichiers supprimés, statistiques du vault).

## Tabs

- **Clic droit sur un onglet** pour ouvrir son menu : **Épingler**, **Recharger**, **Ouvrir dans la vue scindée (droite)**, **Copier le chemin**, **Afficher dans le gestionnaire de fichiers**, et le groupe de fermeture.
- **Épingler** fixe un onglet en place : il se déplace au début de la barre d'onglets, affiche une épingle à la place de la croix de fermeture et survit à chaque **Fermer les autres** / **Fermer à gauche** / **Fermer à droite** / **Fermer tout**. Pour le fermer, choisissez d'abord **Désépingler**.
- **Recharger** abandonne la vue actuelle et relit le fichier depuis le disque — pratique quand un autre programme l'a modifié. Si l'onglet contient des modifications non enregistrées, Plainva refuse de recharger plutôt que d'écraser votre travail.

## Barres et zones

La barre d'actions tout à gauche, les onglets de la barre latérale gauche, les sections au-dessus de l'arborescence et les sections de la barre latérale droite fonctionnent tous de la même façon.

**Directement à leur emplacement :** **maintenez appuyé** sur un bouton ou un titre de section et faites-le glisser à son nouvel emplacement — un simple clic continue de simplement le déclencher, et si vous faites défiler pendant que vous maintenez, vous faites défiler (le glissement est annulé). `Esc` annule un glissement en cours. Un **clic droit** propose les mêmes actions sans maintien : **Monter**, **Masquer** et **Personnaliser les barres…**.

**À un seul endroit :** sous **Paramètres → Vault → Barres et zones**, les quatre barres se trouvent les unes sous les autres. Chacune forme **une seule** liste avec une ligne de séparation : tout ce qui est au-dessus est visible, tout ce qui est en dessous est masqué. Ici, vous déplacez les entrées avec la poignée de glissement — sur cette page, c'est justement une liste que vous réorganisez, exactement ce à quoi sert une poignée.

Deux éléments ne peuvent délibérément pas être masqués : **Afficher les raccourcis clavier** et **Paramètres** en bas de la barre d'actions, ainsi que l'onglet **Fichiers** de la barre latérale gauche. Tout le reste peut être masqué à votre gré ; les actions masquées de la barre d'actions restent accessibles depuis la **palette de commandes** (`Ctrl+P`). Les sections de la barre latérale droite qui n'ont rien à montrer pour la note ouverte n'apparaissent jamais.

Cet arrangement appartient au vault et se propage à vos autres appareils via [Configurer la synchronisation](Sync_Setup.md). Un vault que vous n'avez pas adapté suit votre **valeur par défaut** — définissez-la avec **Définir par défaut**, et **Rétablir la valeur par défaut** ramène un vault adapté à cette valeur.

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

## Mémoire de la barre latérale droite

Les sections qui n'ont rien à montrer pour la note ouverte — **Plan**, **Backlinks**, **Propriétés**, **Bases de données** — n'apparaissent pas du tout, plutôt que de rester grisées. Toute la barre latérale droite mémorise une seule préférence globale pour les notes ; les vues plein écran sans contexte de note ne la ferment que temporairement.

**Quand vous réduisez le panneau en le faisant glisser**, il change en trois étapes, pour que rien ne se casse :

- **280 px et plus** — comme d'habitude.
- **232–280 px** — les propriétés placent le nom au-dessus de la valeur plutôt qu'à côté, les valeurs longues passent à la ligne, les sections se resserrent.
- **en dessous de 232 px** — le calendrier affiche **une semaine au lieu du mois** (sept jours, numéro de semaine en bas à droite) ; une grille mensuelle aurait ici des cellules de 14 pixels et cesserait d'être un calendrier. Le graphe devient plus court, et les backlinks affichent le nom du fichier sans la ligne de chemin.

La barre latérale droite ne peut pas descendre en dessous de **200 px** — aucune section n'y est utilisable. La gauche descend quant à elle encore jusqu'à 150 px, car les noms de fichiers se tronquent simplement.
