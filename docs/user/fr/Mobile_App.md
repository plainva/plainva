# L'application mobile

Dernière mise à jour : 2026-07-26

Plainva est aussi disponible sous forme d'application pour Android et iOS. Elle fonctionne sur les mêmes fichiers Markdown, le même format **OKF** et le même moteur de synchronisation que l'application de bureau — votre coffre reste identique dans les deux mondes.

## Disposition

- **Barre inférieure :** **trois à cinq** zones de votre choix — il n'y a plus d'onglet fixe **Plus** ; l'espace appartient à vos zones.
- **Chaque zone** (Notes, Aujourd'hui, Tags, Signets, Calendrier, Bases de données, Graphe) reste accessible en une pression via la **fiche des zones** : soit le **▾ à côté du titre** dans la barre supérieure, soit un **appui long sur la barre inférieure**. La fiche marque la zone actuelle et mène directement, en bas, à **Organiser la barre de navigation…**.
- **Configurer la barre :** **Paramètres** → **Barre de navigation**. Utilisez **−**/**+** pour définir combien de zones la barre affiche (3 à 5, avec un aperçu en direct) et la **poignée de glisser** pour organiser la liste : les entrées du haut forment la barre (indiquées par un cadre), faire glisser une zone vers le haut la fait passer dans la barre. Rien n'est jamais masqué — ce qui n'est pas dans la barre reste accessible via la fiche des zones. Si la zone où vous vous trouvez quitte la barre, l'application passe à la première zone visible.
- **＋** flotte sous forme de bouton rond au-dessus de la barre et ouvre la création rapide : note, note quotidienne, dossier, base de données, « À partir d'un modèle… ».
- **Barre supérieure :** le titre avec **▾** (ouvre la fiche des zones), la recherche et les **Paramètres** (⋮) ; l'écran d'accueil affiche en plus « Ouverts récemment » et vos signets.
- **Paramètres :** le bouton ⋮ ouvre d'abord la liste des zones (comme le panneau gauche des paramètres de bureau) — une pression ouvre la page correspondante. Tout en haut, **Vault actif** mène à la gestion des vaults : changer de vault (coche = actif), **Créer un vault** et **Connecter un coffre cloud**.

## Lire et modifier les notes

Les notes s'ouvrent **rendues et en lecture seule** ; le crayon en haut à droite bascule en mode d'édition (avec une barre d'outils au-dessus du clavier : mise en forme, listes, lien wiki, commandes slash, insertion de photo). Les inclusions `![[Note]]` apparaissent sous forme de cartes d'aperçu à toucher.

Le bouton **Détails de la note** dans l'en-tête (entre le marque-page et le menu ⋮) ouvre la fiche contextuelle de la note : propriétés (directement modifiables), liens entrants, plan, graphe et l'**historique des versions** — chaque modification crée automatiquement des instantanés que vous pouvez consulter, comparer et restaurer. La source Markdown et la recherche dans la note se trouvent dans le menu ⋮.

## Bases de données (`.base`)

Les bases de données `.base` fonctionnent comme dans l'application de bureau : chaque vue (**Tableau**, **Liste**, **Galerie**, **Kanban**, **Calendrier**, **Chronologie**), l'édition typée des cellules, les cartes du **Kanban** se déplacent par appui long. **Configurer** gère les vues, les colonnes, les filtres (y compris les groupes), le tri et les propriétés. Les schémas de relation (cibles, cardinalité) restent gérés dans l'application de bureau.

Une vue **Tableau d'affichage** montre les notes sous forme d'un tableau à deux colonnes de cartes autocollantes : une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), faire glisser après un appui long réordonne, et les cases à cocher se cochent directement sur la carte. Le champ de saisie en haut capture une nouvelle note. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Contenu et structure**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

## Calendrier et événements

Le **Calendrier** (onglet du bas ou via « Plus ») affiche vos notes quotidiennes sous forme de grille mensuelle. L'icône d'horloge en haut à droite ouvre le **calendrier des événements** avec les vues **Jour**, **3 jours** et **Agenda** — vos calendriers connectés utilisent le même modèle de compte que l'application de bureau. Toucher un événement affiche ses détails ; pour une invitation, vous pouvez directement **accepter**, la marquer **provisoire** ou **refuser**.

Gérez les comptes depuis l'icône en forme d'engrenage dans le calendrier des événements : connectez **CalDAV** sur l'appareil avec un mot de passe d'application (p. ex. Fastmail, Nextcloud, iCloud) ; Google et Microsoft suivent via une connexion par navigateur. Par compte, vous pouvez afficher ou masquer certains calendriers.

**La connexion se fait par appareil.** Ce qui se synchronise, ce sont les *réglages* de votre compte, jamais la connexion elle-même — c'est voulu : les identifiants ne doivent pas quitter l'appareil. Un compte arrivé ainsi par la synchronisation des paramètres apparaît donc dans la liste, mais porte la marque **se connecter**, avec une ligne en dessous qui indique quoi faire. Tant qu'aucun compte n'est connecté sur cet appareil, le calendrier l'explique à cet endroit au lieu de simplement rester vide, et **Se connecter sur cet appareil** vous mène aux comptes. Les comptes connectés affichent **actif**.

## Synchronisation

Dans les **Paramètres** (⋮), **Vault actif** mène à la gestion des vaults ; c'est là que vous connectez un espace de stockage cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connecter un coffre cloud** récupère un coffre cloud existant sur l'appareil ; **Créer un vault** demande d'abord **Sur cet appareil** ou **Chez un service en ligne**, puis la structure de départ (vide ou un modèle comme PARA) — sur la voie en ligne, la connexion suit ensuite : le dossier cible dans le cloud peut être créé à neuf via **Nouveau dossier** dans la fiche de sélection, et la structure est envoyée lors de la première synchronisation. Le premier lancement (« Connecter un coffre cloud ») propose le même choix entre un coffre cloud existant et un nouveau coffre cloud. Chaque connexion obtient son propre coffre séparé sur l'appareil. La page du coffre affiche le statut, la progression, les transferts en attente et propose **Exporter le coffre** (ZIP via le menu de partage du système).

La page du coffre indique aussi si vos **paramètres** vous suivent — sous forme de carte avec un état clair plutôt qu'un simple bouton :

- **Ne sont pas synchronisés** : la synchronisation des paramètres est désactivée pour ce vault. Activez-la depuis l'application de bureau.
- **Pas encore déverrouillé sur cet appareil** : vos paramètres sont stockés chiffrés dans le cloud. Saisissez la phrase de passe que vous avez choisie lors de la configuration sur le bureau — cet appareil les déverrouille une fois grâce à elle.
- **Sont synchronisés** : cet appareil est déverrouillé ; les dossiers, les vues et les règles de sauvegarde restent au diapason de vos autres appareils.

Chaque carte précise aussi ce qui *ne* voyage *pas* : les connexions restent toujours sur l'appareil (voir [Calendrier et événements](#calendrier-et-événements)).

**Paramètres** → **Sécurité et partage** indique ce qu'est réellement la connexion — et pour un vault cloud ordinaire, il configure l'espace de travail chiffré directement sur le téléphone (identité → fichier de récupération et code → activation). Sans connexion cloud, il n'y a rien à chiffrer, et la section le dit.

## Filet de sécurité

Les instantanés (historique des versions), un journal des brouillons (après un plantage, la note propose votre dernier état non enregistré) et des copies en conflit avec une vue de comparaison protègent vos données. La rétention se configure dans **Paramètres** → **Sauvegarde & historique des versions**.

## Partage et raccourcis

Sur Android et iOS, le texte et les URL partagés deviennent une nouvelle note dans la boîte de réception ; les images et fichiers sont importés comme pièces jointes (25 Mo maximum par fichier). Sur Android, un appui long sur l’icône ajoute les raccourcis **Nouvelle note** et **Aujourd’hui**. La page du vault permet d’activer **Synchroniser les réglages** et de déverrouiller ou verrouiller en toute sécurité un vault chiffré avec sa phrase de passe.

## Dossiers, photos et calendrier

Le bouton flottant **Plus** reste disponible dans les dossiers imbriqués et chaque création vise le dossier ouvert. Dans l’en-tête du dossier, le **menu à trois points** ouvre les réglages ; la création d’un dossier se trouve dans le bouton **Plus**.

Le bouton photo propose maintenant **Prendre une photo** ou **Choisir dans la photothèque**, conserve la position d’insertion et affiche les erreurs d’autorisation ou de fichier.

**Calendrier** ouvre directement le calendrier du fournisseur connecté. Les notes quotidiennes restent dans **Aujourd’hui** ; l’ancien écran mensuel intermédiaire a été supprimé sans modifier les données existantes.
