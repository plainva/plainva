# L'application mobile

Dernière mise à jour : 2026-07-17

Plainva est aussi disponible sous forme d'application pour Android et iOS. Elle fonctionne sur les mêmes fichiers Markdown, le même format **OKF** et le même moteur de synchronisation que l'application de bureau — votre coffre reste identique dans les deux mondes.

## Disposition

- **Barre inférieure :** jusqu'à quatre écrans de votre choix (**Notes**, **Aujourd'hui**, **Tags**, **Signets**, **Calendrier**, **Bases de données**) autour du bouton fixe **＋**. Modifiez la sélection sous **Paramètres** → **Barre d’onglets**.
- **＋** : une pression simple crée aussitôt une nouvelle note (dans le dossier visible, sinon dans le dossier de la boîte de réception). Un appui long ouvre la création rapide : note, note quotidienne, dossier, base de données, « À partir d'un modèle… ».
- **Barre supérieure :** recherche et le menu **Plus** ; l'écran d'accueil affiche aussi « Récents » et vos signets.

## Lire et modifier les notes

Les notes s'ouvrent **rendues et en lecture seule** ; le crayon en haut à droite bascule en mode d'édition (avec une barre d'outils au-dessus du clavier : mise en forme, listes, lien wiki, commandes slash, insertion de photo). Les inclusions `![[Note]]` apparaissent sous forme de cartes d'aperçu à toucher.

Le bouton **Détails de la note** dans l'en-tête (entre le marque-page et le menu ⋮) ouvre la fiche contextuelle de la note : propriétés (directement modifiables), liens entrants, plan, graphe et l'**historique des versions** — chaque modification crée automatiquement des instantanés que vous pouvez consulter, comparer et restaurer. La source Markdown et la recherche dans la note se trouvent dans le menu ⋮.

## Bases de données (`.base`)

Les bases de données `.base` fonctionnent comme dans l'application de bureau : chaque vue (**Tableau**, **Liste**, **Galerie**, **Kanban**, **Calendrier**, **Chronologie**), l'édition typée des cellules, les cartes du **Kanban** se déplacent par appui long. **Configurer** gère les vues, les colonnes, les filtres (y compris les groupes), le tri et les propriétés. Les schémas de relation (cibles, cardinalité) restent gérés dans l'application de bureau.

Une vue **Tableau d'affichage** montre les notes sous forme d'un tableau à deux colonnes de cartes autocollantes : une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), faire glisser après un appui long réordonne, et les cases à cocher se cochent directement sur la carte. Le champ de saisie en haut capture une nouvelle note. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Dossiers**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

## Synchronisation

Sous **Plus** → **Coffres**, vous connectez un espace de stockage cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connecter un coffre cloud** récupère un coffre cloud existant sur l'appareil ; **Créer un vault** demande d'abord **Sur cet appareil** ou **Chez un service en ligne**, puis la structure de départ (vide ou un modèle comme PARA) — sur la voie en ligne, la connexion suit ensuite : le dossier cible dans le cloud peut être créé à neuf via **Nouveau dossier** dans la fiche de sélection, et la structure est envoyée lors de la première synchronisation. Le premier lancement (« Connecter un coffre cloud ») propose le même choix entre un coffre cloud existant et un nouveau coffre cloud. Chaque connexion obtient son propre coffre séparé sur l'appareil. La page du coffre affiche le statut, la progression, les transferts en attente et propose **Exporter le coffre** (ZIP via le menu de partage du système).

## Filet de sécurité

Les instantanés (historique des versions), un journal des brouillons (après un plantage, la note propose votre dernier état non enregistré) et des copies en conflit avec une vue de comparaison protègent vos données. La rétention se configure dans **Paramètres**.

## Partage et raccourcis (Android)

Un texte partagé depuis d'autres applications atterrit comme nouvelle note dans le dossier de la boîte de réception. Maintenez l'icône de l'application appuyée pour les raccourcis **Nouvelle note** et **Aujourd'hui**.
