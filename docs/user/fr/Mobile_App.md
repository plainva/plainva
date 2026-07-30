# L'application mobile

Dernière mise à jour : 2026-07-29

Plainva est aussi disponible sous forme d'application pour Android et iOS. Elle fonctionne sur les mêmes fichiers Markdown, le même format **OKF** et le même moteur de synchronisation que l'application de bureau — votre coffre reste identique dans les deux mondes.

## Installer l’application

L’application mobile est en **bêta fermée**. Sous **Android**, tu y accèdes en deux étapes : rejoins le groupe de testeurs via [plainva.com/android-beta](https://plainva.com/android-beta), puis accepte l’invitation sur Google Play. Sur **iPhone**, la distribution passe par TestFlight ; la liste d’attente se trouve sur [plainva.com](https://plainva.com).

Google ne publie l’application sur le Play Store public qu’une fois que 12 testeurs restent inscrits pendant 14 jours d’affilée — s’inscrire et simplement la laisser installée aide donc déjà.

## Disposition

- **Barre inférieure :** **trois à cinq** zones de votre choix — il n'y a plus d'onglet fixe **Plus** ; l'espace appartient à vos zones.
- **Chaque zone** (Notes, Aujourd'hui, Tags, Signets, Calendrier, Bases de données, Tâches, E-mail, Graphe) reste accessible en une pression via la **fiche des zones** : soit le **▾ à côté du titre** dans la barre supérieure, soit un **appui long sur la barre inférieure**. La fiche marque la zone actuelle et mène directement, en bas, à **Organiser la barre de navigation…**.
- **Configurer la barre :** **Paramètres** → **Barre de navigation**. Utilisez **−**/**+** pour définir combien de zones la barre affiche (3 à 5, avec un aperçu en direct) et la **poignée de glisser** pour organiser la liste : les entrées du haut forment la barre (indiquées par un cadre), faire glisser une zone vers le haut la fait passer dans la barre. Faire glisser jusqu'au bord supérieur ou inférieur fait défiler la liste en même temps, de sorte qu'un seul mouvement suffit pour toute la liste. L'aperçu affiche exactement les libellés qu'utilise la barre elle-même. Rien n'est jamais masqué — ce qui n'est pas dans la barre reste accessible via la fiche des zones. Si la zone où vous vous trouvez quitte la barre, l'application passe à la première zone visible.
- **＋** flotte sous forme de bouton rond au-dessus de la barre et ouvre la création rapide : note, note quotidienne, dossier, base de données, « À partir d'un modèle… ».
- **Barre supérieure :** le titre avec **▾** (ouvre la fiche des zones), la recherche et les **Paramètres** (⋮) ; l'écran d'accueil affiche en plus « Ouverts récemment » et vos signets.
- **Paramètres :** le bouton ⋮ ouvre d'abord la liste des zones (comme le panneau gauche des paramètres de bureau) — une pression ouvre la page correspondante. Tout en haut, **Vault actif** mène à la gestion des vaults : changer de vault (coche = actif), **Créer un vault** et **Connecter un coffre cloud**.

## Lire et modifier les notes

Les notes s'ouvrent **rendues et en lecture seule** ; le crayon en haut à droite bascule en mode d'édition (avec une barre d'outils au-dessus du clavier : mise en forme, listes, lien wiki, commandes slash, insertion de photo). Les inclusions `![[Note]]` apparaissent sous forme de cartes d'aperçu à toucher.

Le bouton **Détails de la note** dans l'en-tête (entre le marque-page et le menu ⋮) ouvre la fiche contextuelle de la note : propriétés (directement modifiables), liens entrants, plan, graphe et l'**historique des versions** — chaque modification crée automatiquement des instantanés que vous pouvez consulter, comparer et restaurer. La source Markdown et la recherche dans la note se trouvent dans le menu ⋮.

## Modèles

Les modèles se comportent exactement comme sur le bureau : les espaces réservés (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) sont remplis à la création de la note, **toutes** les questions d'un modèle arrivent ensemble dans **une seule** feuille — l'annuler ne crée rien — et `{{cursor}}` place le curseur à l'ouverture de la note.

Les règles **dossier → modèle** et **type de note → modèle** sont définies sur le bureau ; elles voyagent avec la synchronisation des paramètres et s'appliquent ici aussi — de sorte qu'une note dans `Projekte/` démarre de la même façon sur les deux appareils, y compris pour la capture `＋` et **+ Entrée** dans une base de données. Deux détails : `{{weekday:…}}` compte toujours à partir du lundi sur le téléphone (le réglage du premier jour de la semaine n'y existe pas encore), et `{{clipboard}}` demande le contenu du presse-papiers dans la même feuille au lieu de le lire sans le demander. La liste complète des espaces réservés se trouve dans [Notes & Markdown](Notes_and_Markdown.md).

## Bases de données (`.base`)

Les bases de données `.base` fonctionnent comme dans l'application de bureau : chaque vue (**Tableau**, **Liste**, **Galerie**, **Kanban**, **Calendrier**, **Chronologie**), l'édition typée des cellules, les cartes du **Kanban** se déplacent par appui long. **Configurer** gère les vues, les colonnes, les filtres (y compris les groupes), le tri et les propriétés. Les schémas de relation (cibles, cardinalité) restent gérés dans l'application de bureau.

Une vue **Tableau d'affichage** montre les notes sous forme d'un tableau à deux colonnes de cartes autocollantes : une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), faire glisser après un appui long réordonne, et les cases à cocher se cochent directement sur la carte. Le champ de saisie en haut capture une nouvelle note. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Contenu et structure**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

## Tâches

La zone **Tâches** rassemble chaque case à cocher de votre vault — toutes les lignes `- [ ]` et `- [x]` de toutes les notes, regroupées par note. C'est l'aperçu basé sur les lignes qu'une base de données ne peut pas vous donner, car une base de données travaille sur des notes entières.

Toucher une tâche ouvre la note **à cette ligne** ; la case la coche et réécrit exactement le caractère `[ ]`/`[x]`. Les échéances (`📅`) et les `#tags` apparaissent sous forme de puces, afin de ne pas être répétés dans le texte.

Si votre vault a une **base de tâches** (**Paramètres** → **Contenu et structure**), la zone l'affiche au-dessus comme sa propre section : cocher, changer le statut, **+ Nouvelle tâche** et **Ouvrir comme base**. Chaque ligne de case à cocher porte alors en plus un bouton qui **la déplace vers la base de données** — la ligne reste sous forme de lien wiki, et la tâche continue de vivre comme sa propre note.

Deux autres actions sur une tâche de la base de données : **Bloquer du temps** crée un événement d'agenda pour la tâche lorsqu'un agenda est connecté (date, début, durée, plus le sélecteur d'agenda quand plusieurs acceptent l'écriture), et la **Répétition** crée la tâche suivante avec une nouvelle échéance quand vous cochez celle-ci. Les deux sont décrites dans [Tâches](Tasks.md).

## Calendrier et événements

Le **Calendrier** (onglet du bas ou via « Plus ») affiche vos notes quotidiennes sous forme de grille mensuelle. L'icône d'horloge en haut à droite ouvre le **calendrier des événements** avec les vues **Jour**, **3 jours** et **Agenda** — vos calendriers connectés utilisent le même modèle de compte que l'application de bureau. Toucher un événement affiche ses détails ; pour une invitation, vous pouvez directement **accepter**, la marquer **provisoire** ou **refuser**.

Gérez les comptes depuis l'icône en forme d'engrenage dans le calendrier des événements : connectez **CalDAV** sur l'appareil avec un mot de passe d'application (p. ex. Fastmail, Nextcloud, iCloud) ; Google et Microsoft suivent via une connexion par navigateur. Par compte, vous pouvez afficher ou masquer certains calendriers.

**La connexion se fait par appareil.** Ce qui se synchronise, ce sont les *réglages* de votre compte, jamais la connexion elle-même — c'est voulu : les identifiants ne doivent pas quitter l'appareil. Un compte arrivé ainsi par la synchronisation des paramètres apparaît donc dans la liste, mais porte la marque **se connecter**, avec une ligne en dessous qui indique quoi faire. Tant qu'aucun compte n'est connecté sur cet appareil, le calendrier l'explique à cet endroit au lieu de simplement rester vide, et **Se connecter sur cet appareil** vous mène aux comptes. Les comptes connectés affichent **actif**. Si une connexion expire plus tard ou est révoquée, la ligne indique **connexion expirée** avec le motif — et **Se reconnecter** la relance sans supprimer le compte : même compte, mêmes agendas.

**Une connexion pour tous les services — ici aussi.** Si un compte Microsoft ou Google porte plusieurs services (fichiers et calendrier, par exemple), l'aperçu **Comptes cloud** propose de les fusionner en une seule connexion. Ensuite, une seule connexion maintient chaque service actif au lieu d'un seul — auparavant, un service pouvait continuer à fonctionner pendant qu'un autre du même compte avait discrètement expiré. Une boîte Gmail reste en dehors : elle fonctionne via IMAP avec un mot de passe d'application et ne nécessite aucun consentement.

## E-mail

Dans **Réglages → E-mail**, connecte une **boîte Microsoft** (Outlook.com, Microsoft 365) directement via la connexion dans le navigateur — sans mot de passe d’application. Comme pour le calendrier, la connexion se fait par appareil.

Ensuite, tu peux ouvrir **E-mail** comme domaine à part entière via le ▾ à côté du titre et le placer dans la barre de navigation. La ligne sous le titre indique le dossier, le nombre de messages non lus et le compte, et ouvre le sélecteur de dossiers. Touche un message pour le lire ; **Enregistrer comme note** le range dans le dossier **Mail** de ton coffre (capturer deux fois ouvre la même note). Les images distantes restent bloquées jusqu’à ce que tu les autorises pour ce message — une image chargée révèle à l’expéditeur quand et où tu as lu.

**Les boîtes IMAP fonctionnent aussi sur le téléphone.** Ajoutes-en une dans **Réglages → E-mail** : choisis le fournisseur, saisis l’adresse et le mot de passe d’application, et Plainva renseigne les serveurs. Si ton fournisseur ne figure pas dans la liste, **Avancé** te permet de saisir toi-même les serveurs IMAP et SMTP, les ports et un nom d’utilisateur différent, et un compte existant peut être modifié par la suite. Pour sélectionner plusieurs messages, il suffit d’un appui long sur l’un d’eux.

## Synchronisation

Dans les **Paramètres** (⋮), **Vault actif** mène à la gestion des vaults ; c'est là que vous connectez un espace de stockage cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connecter un coffre cloud** récupère un coffre cloud existant sur l'appareil ; **Créer un vault** demande d'abord **Sur cet appareil** ou **Chez un service en ligne**, puis la structure de départ (vide ou un modèle comme PARA) — sur la voie en ligne, la connexion suit ensuite : le dossier cible dans le cloud peut être créé à neuf via **Nouveau dossier** dans la fiche de sélection, et la structure est envoyée lors de la première synchronisation. Le premier lancement (« Connecter un coffre cloud ») propose le même choix entre un coffre cloud existant et un nouveau coffre cloud. Chaque connexion obtient son propre coffre séparé sur l'appareil. La page du coffre affiche le statut, la progression, les transferts en attente et propose **Exporter le coffre** (ZIP via le menu de partage du système).

La fréquence à laquelle ce coffre vérifie les changements distants se règle sur la même page (**intervalle de synchronisation**, au moins 5 secondes) — les enregistrements locaux partent immédiatement de toute façon. Pour Google Drive, OneDrive, Dropbox et S3, le **dossier cloud** peut aussi être changé après coup ; avec WebDAV, le dossier fait partie de l'adresse du serveur, il faut donc se reconnecter. Si la synchronisation des réglages est chiffrée, vous pouvez activer **Demander la phrase secrète à chaque démarrage** : la clé n'est alors jamais stockée sur l'appareil. Enfin, **Sécurité et partage** indique désormais clairement que les espaces chiffrés sont expérimentaux et n'ont pas fait l'objet d'un audit indépendant — conservez votre fichier et votre code de récupération en lieu sûr.

La page du coffre indique aussi si vos **paramètres** vous suivent — sous forme de carte avec un état clair plutôt qu'un simple bouton :

- **Ne sont pas synchronisés** : la synchronisation des paramètres est désactivée pour ce vault. Activez-la depuis l'application de bureau.
- **Pas encore chiffré** : ce vault n'a pas encore de phrase secrète de synchronisation. Vous pouvez désormais en définir une **sur le téléphone** : l'assistant affiche le code de récupération et vous fait retaper deux groupes choisis au hasard avant que quoi que ce soit ne soit écrit. Si une phrase secrète existe déjà dans le cloud, le téléphone vous le signale et n'en crée jamais une seconde — cela empêcherait tous les autres appareils d'y accéder.
- **Pas encore déverrouillé sur cet appareil** : vos paramètres sont stockés chiffrés dans le cloud. Saisissez la phrase secrète choisie lors de la configuration — sur le bureau ou ici, sur le téléphone ; cet appareil les déverrouille une fois grâce à elle.
- **Sont synchronisés** : cet appareil est déverrouillé ; les dossiers, les vues et les règles de sauvegarde restent au diapason de vos autres appareils.

Chaque carte précise aussi ce qui *ne* voyage *pas* : les connexions restent toujours sur l'appareil (voir [Calendrier et événements](#calendrier-et-événements)).

**Paramètres** → **Sécurité et partage** indique ce qu'est réellement la connexion — et pour un vault cloud ordinaire, il configure l'espace de travail chiffré directement sur le téléphone (identité → fichier de récupération et code → activation). Sans connexion cloud, il n'y a rien à chiffrer, et la section le dit.

## Filet de sécurité

Les instantanés (historique des versions), un journal des brouillons (après un plantage, la note propose votre dernier état non enregistré) et des copies en conflit avec une vue de comparaison protègent vos données. La rétention se configure dans **Paramètres** → **Sauvegarde & historique des versions**.

## Partage et raccourcis

Sur Android et iOS, le texte et les URL partagés deviennent une nouvelle note dans la boîte de réception ; les images et fichiers sont importés comme pièces jointes (25 Mo maximum par fichier). Sur Android, un appui long sur l’icône ajoute les raccourcis **Nouvelle note** et **Aujourd’hui**. La page du vault permet d’activer **Synchroniser les réglages** et de déverrouiller ou verrouiller en toute sécurité un vault chiffré avec sa phrase secrète.

## Dossiers, photos et calendrier

Le bouton flottant **Plus** reste disponible dans les dossiers imbriqués et chaque création vise le dossier ouvert. Dans l’en-tête du dossier, le **menu à trois points** ouvre les réglages ; la création d’un dossier se trouve dans le bouton **Plus**.

Le bouton photo propose maintenant **Prendre une photo** ou **Choisir dans la photothèque**, conserve la position d’insertion et affiche les erreurs d’autorisation ou de fichier. Les photos atterrissent dans le dossier des pièces jointes du coffre, celui-là même qu'utilise votre ordinateur.

**Calendrier** ouvre directement le calendrier du fournisseur connecté. Les notes quotidiennes restent dans **Aujourd’hui** ; l’ancien écran mensuel intermédiaire a été supprimé sans modifier les données existantes.
