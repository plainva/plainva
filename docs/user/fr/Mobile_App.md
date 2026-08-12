# L'application mobile

Dernière mise à jour : 2026-08-12

Plainva est aussi disponible sous forme d'application pour Android et iOS. Elle fonctionne sur les mêmes fichiers Markdown, le même format **OKF** et le même moteur de synchronisation que l'application de bureau — votre coffre reste identique dans les deux mondes.

## Installer l’application

L’application mobile est en **bêta fermée**. Sous **Android**, tu y accèdes en deux étapes : rejoins le groupe de testeurs via [plainva.com/android-beta](https://plainva.com/android-beta), puis accepte l’invitation sur Google Play. Sur **iPhone**, la distribution passe par TestFlight ; la liste d’attente se trouve sur [plainva.com](https://plainva.com).

Google ne publie l’application sur le Play Store public qu’une fois que 12 testeurs restent inscrits pendant 14 jours d’affilée — s’inscrire et simplement la laisser installée aide donc déjà.

## Disposition

- **Barre inférieure :** **deux à quatre** surfaces de travail de votre choix, plus l'entrée fixe **Rubriques** à la fin — au total, de trois à cinq destinations pour une barre. **Notes** reste toujours visible : c'est ainsi que vous accédez à vos fichiers.
- **Chaque zone** (Notes, Aujourd'hui, Tâches, Calendrier, E-mail, Graphe) reste à une pression près grâce à la **fiche des zones** : **Rubriques** dans la barre, le **▾ à côté du titre**, ou un **appui long sur la barre**. La fiche marque la zone actuelle et mène directement, en bas, à **Personnaliser la barre de navigation…**. Les tags, les signets et les éléments ouverts récemment ne sont plus des zones à part entière — ils se trouvent désormais sous **Notes**.
- **Configurer la barre :** **Paramètres** → **Barre de navigation**. Utilisez **−**/**+** pour définir combien de surfaces de travail la barre affiche (2 à 4, avec un aperçu en direct) et la **poignée de glisser** pour organiser la liste : les entrées du haut forment la barre (indiquées par un cadre), faire glisser une zone vers le haut la fait passer dans la barre. Faire glisser jusqu'au bord supérieur ou inférieur fait défiler la liste en même temps, de sorte qu'un seul mouvement suffit pour toute la liste. Rien n'est jamais masqué — ce qui n'est pas dans la barre reste accessible via **Rubriques**. Si la zone où vous vous trouvez quitte la barre, l'application passe à la première zone visible. Vous pouvez aussi organiser la même barre **sur le bureau** (Paramètres → Vault → Barres et zones) ; avec la synchronisation des paramètres activée, l'organisation voyage entre vos appareils.
- **＋** flotte sous forme de bouton rond au-dessus de la barre et ouvre la création rapide : note, note quotidienne, dossier, base de données, « À partir d'un modèle… ».
- **En-tête :** le même partout — à gauche Retour (absent sur une surface de travail), au centre le titre et une ligne de contexte, à droite la recherche et ⋮. Lorsque vous faites défiler, il se détache du contenu et la barre de navigation se replie sur ses icônes ; en remontant, elle s'ouvre de nouveau.
- **Un ⋮ signifie toujours la même chose :** des actions sur l'objet actuellement ouvert. Les paramètres de l'application ne se trouvent pas derrière lui.
- **Paramètres :** tout en bas de **Notes**, là où le bureau les garde aussi. Ils ouvrent d'abord la liste des zones (comme le panneau gauche des paramètres de bureau) — une pression ouvre la page correspondante. Tout en haut, **Vault actif** mène à la gestion des vaults : changer de vault (coche = actif), **Créer un vault** et **Connecter un coffre cloud**. La liste affiche **les mêmes zones que sur le bureau** — dont **Démarrage et comportement** (réafficher la bienvenue et les nouveautés), **Barres et zones** (la barre de navigation) et **Maintenance** (Statistiques du vault, reconstruire l’index, restaurer les fichiers supprimés). Seul **Mises à jour** manque : l’application ne se met pas à jour toute seule, Google Play et TestFlight s’en chargent. **Maintenance** contient aussi l’**import depuis d’autres applications** : sur le téléphone, il écrit toujours dans un sous-dossier du vault ouvert, montre d’abord ce qu’il créerait, peut être interrompu en cours de route et laisse un rapport.

## Lire et modifier les notes

Les notes s'ouvrent **rendues et en lecture seule** ; le crayon en haut à droite bascule en mode d'édition (avec une barre d'outils au-dessus du clavier : mise en forme, listes, lien wiki, commandes slash, insertion de photo). Les inclusions `![[Note]]` apparaissent sous forme de cartes d'aperçu à toucher.

Le bouton **Détails de la note** dans l'en-tête (entre le marque-page et le menu ⋮) ouvre la fiche contextuelle de la note : propriétés (directement modifiables), liens entrants, plan, graphe et l'**historique des versions** — chaque modification crée automatiquement des instantanés que vous pouvez consulter, comparer et restaurer. La source Markdown et la recherche dans la note se trouvent dans le menu ⋮.

## Modèles

Les modèles se comportent exactement comme sur le bureau : les espaces réservés (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) sont remplis à la création de la note, **toutes** les questions d'un modèle arrivent ensemble dans **une seule** feuille — l'annuler ne crée rien — et `{{cursor}}` place le curseur à l'ouverture de la note.

Les règles **dossier → modèle** et **type de note → modèle** sont définies sur le bureau ; elles voyagent avec la synchronisation des paramètres et s'appliquent ici aussi — de sorte qu'une note dans `Projekte/` démarre de la même façon sur les deux appareils, y compris pour la capture `＋` et **+ Entrée** dans une base de données. Deux détails : `{{weekday:…}}` compte toujours à partir du lundi sur le téléphone (le réglage du premier jour de la semaine n'y existe pas encore), et `{{clipboard}}` demande le contenu du presse-papiers dans la même feuille au lieu de le lire sans le demander. La liste complète des espaces réservés se trouve dans [Notes & Markdown](Notes_and_Markdown.md).

## Bases de données (`.base`)

Les bases de données `.base` fonctionnent comme dans l'application de bureau : chaque vue (**Tableau**, **Liste**, **Galerie**, **Kanban**, **Calendrier**, **Chronologie**), l'édition typée des cellules, les cartes du **Kanban** se déplacent par appui long. **Configurer** gère les vues, les colonnes, les filtres (y compris les groupes), le tri et les propriétés.

La **vue calendrier** propose trois périodes : **mois**, **semaine**, **jour**. Le mois reste le point d'entrée — c'est le seul qui garde une forme lisible sur l'écran d'un téléphone ; semaine et jour sont des listes, car sept colonnes de contenu cessent d'être lisibles à cette largeur. Une entrée sur plusieurs jours apparaît comme une **barre** au lieu de se répéter chaque jour, et les heures précèdent le titre. La **frise** affiche une **ligne par entrée** avec une barre du début à la fin : les deux extrémités se **tirent au doigt**, ce qui écrit le champ de date de la note. Sous **Configurer**, tu choisis le champ de date, celui de fin et **couleur selon** — même réglage, même fichier que sur l'ordinateur. Les schémas de relation (cibles, cardinalité) restent gérés dans l'application de bureau.

Une vue **Tableau d'affichage** montre les notes sous forme d'un tableau à deux colonnes de cartes autocollantes : une pression simple ouvre la note, un appui long affiche les actions (épingler, libellés, couleur, supprimer), faire glisser après un appui long réordonne, et les cases à cocher se cochent directement sur la carte. Le champ de saisie en haut capture une nouvelle note. Astuce : pointez la base de données vers votre dossier de boîte de réception (**Paramètres** → **Contenu et structure**) et les notes rapides du ＋ ainsi que les textes partagés depuis d'autres applications atterrissent directement sur le tableau.

## Tâches

La zone **Tâches** rassemble chaque case à cocher de votre vault — toutes les lignes `- [ ]` et `- [x]` de toutes les notes, regroupées par note. C'est l'aperçu basé sur les lignes qu'une base de données ne peut pas vous donner, car une base de données travaille sur des notes entières.

Toucher une tâche ouvre la note **à cette ligne** ; la case la coche et réécrit exactement le caractère `[ ]`/`[x]`. Les échéances (`📅`) et les `#tags` apparaissent sous forme de puces, afin de ne pas être répétés dans le texte.

Si votre vault a une **base de tâches** (**Paramètres** → **Contenu et structure**), la zone l'affiche au-dessus comme sa propre section : cocher, changer le statut, **+ Nouvelle tâche** et **Ouvrir comme base**. Chaque ligne de case à cocher porte alors aussi **Vers la base** dans sa ligne méta — la ligne reste sous forme de lien wiki, et la tâche continue de vivre comme sa propre note.

Au-dessus de la liste, vous retrouvez les mêmes filtres qu'au bureau : **Dossier**, **Étiquette**, **Avec échéance** et **Afficher les masqués**. Masquer est une propriété de la **note**, pas de la tâche individuelle — l'icône en forme d'œil sur l'en-tête d'une note inscrit `plainva.tasks: false` dans le frontmatter de cette note et la retire de l'aperçu ; **Masquer les modèles** fait la même chose en une fois pour tout le dossier de modèles. Le fichier garde ses tâches, elles cessent simplement d'être comptées. Un appui long sur **Vers la base** choisit la **base cible** quand votre vault en a plusieurs.

Une ligne de tâche affiche son titre sur toute la largeur ; le statut, l'échéance, la répétition et les tags se trouvent en dessous, et une seule action se trouve à droite. **Bloquer du temps** (l'icône de calendrier à droite) crée un événement d'agenda pour la tâche lorsqu'un agenda est connecté (date, début, durée, plus le sélecteur d'agenda quand plusieurs acceptent l'écriture) ; la **Répétition** dans la ligne méta crée la tâche suivante avec une nouvelle échéance quand vous cochez celle-ci. Les deux sont décrites dans [Tâches](Tasks.md).

## Aujourd'hui

**Aujourd'hui** est la surface du jour. Le bandeau en haut sélectionne un jour — il s'étend **dans les deux sens**, deux semaines en arrière et deux semaines à venir, et un point marque chaque jour qui a déjà une note quotidienne. En dessous se trouve la **note quotidienne** du jour sélectionné (avec son modèle et son dossier, à ouvrir ou à créer), puis les **rendez-vous et échéances** de ce jour, et enfin ce que vous avez modifié ce jour-là.

La section du milieu réunit ce qui se trouve autrement sur deux zones distinctes : d'abord les événements sur toute la journée, puis ceux à heure fixe dans l'ordre chronologique, et enfin les tâches dues ce jour-là. Toucher une tâche ouvre sa note. Sans calendrier connecté et sans base de tâches, la section est simplement absente.

## Tags

La liste des tags se trouve sous **Notes**. Toucher ouvre les notes d'un tag ; le chevron développe les tags imbriqués. Un **appui long** sur un tag propose **Renommer l’étiquette** — dans tout le vault, comme sur le bureau : Plainva réécrit chaque note qui le porte (dans le frontmatter et sous forme de `#tag` dans le texte, y compris ses enfants `tag/child`), puis vous indique dans combien de notes il a été remplacé. Une note qui ne peut être ni lue ni écrite est ignorée — les autres sont tout de même renommées.

## Graphe

La **carte du coffre** montre votre coffre sous forme de nœuds et d'arêtes. Toucher une bulle de dossier la déplie, toucher une note l'ouvre ; les puces au-dessus filtrent par type de note, tag et type d'arête. Faites glisser un nœud et **la carte se souvient de l'endroit où vous l'avez placé** — la disposition mémorisée se trouve dans `.plainva/graph.json` et reste volontairement sur cet appareil, comme l'index de recherche.

Un **appui long** sur un nœud ouvre son menu : ouvrir (ou déplier/replier pour un dossier), **Focus sur la sélection** et, si le nœud est épinglé, **Détacher**. Un appui long sur une **arête** indique les deux extrémités et ouvre l'une ou l'autre note. Faites glisser une note **sur une autre** et Plainva propose de les **lier** — comme un lien texte à la fin de la note, ou via une relation de la base de données correspondante ; une relation qui n'autorise qu'une seule entrée demande confirmation au préalable, car elle remplace la valeur actuelle. La puce **Sélectionner** transforme un glissement sur une zone vide en rectangle de sélection (un téléphone n'a pas de touche de modification) ; les notes sélectionnées peuvent être supprimées ensemble, avec la même confirmation qu'une seule. **Exporter en SVG…** transmet la carte au menu de partage de votre appareil.

Le même nettoyage à petite échelle, c'est ce que fait le **graphe dans la fiche contextuelle d'une note** : il montre le voisinage de la note ouverte et, en dessous, des suggestions de ce qui pourrait encore lui appartenir. **Lier** place le lien à l'endroit précis du texte — pas à la fin de la note —, et une suggestion ignorée reste ignorée, même après la fermeture de la note.

La puce **Nettoyer** ouvre la liste de nettoyage : les **orphelines** (des notes vers lesquelles rien ne pointe), les **liens cassés** (des références qui ne mènent nulle part) et les **mentions** — des endroits où une note est nommée sans être liée. Vous supprimez une orpheline avec la même confirmation que partout ailleurs, vous créez la note manquante pour un lien cassé, et vous liez une mention exactement **à l'endroit du passage** plutôt qu'à la fin de la note. Ce que vous ignorez reste ignoré : cela ne revient pas au passage suivant. L'analyse des mentions lit chaque note et ne démarre donc que sur votre demande — elle peut être arrêtée à tout moment.

Le **Focus** se règle aussi depuis le menu du nœud : la carte ne montre alors plus que son voisinage, jusqu'à la profondeur que vous choisissez (1 à 3). La puce qui porte la profondeur efface de nouveau le focus. Deux autres puces lisent la carte selon son ancienneté : la **Carte de chaleur** teinte chaque nœud selon la date de sa dernière modification, et le **Voyage dans le temps** masque tout ce qui est plus récent que le curseur — pour regarder le coffre grandir.

## Calendrier et événements

La zone **Calendrier** affiche vos calendriers connectés dans les vues **Jour**, **3 jours** et **Agenda** — le même modèle de compte que sur le bureau. Vous y accédez depuis la barre de navigation ou via **Rubriques**. Toucher un événement ouvre l'**aperçu de l'événement** sous forme de feuille — la même surface que la fenêtre flottante du bureau : plage horaire, lieu, description, participants avec leurs réponses, et pour une série son rythme ainsi que la prochaine occurrence. Pour une invitation, elle propose **Accepter**, **Provisoire** et **Refuser**, puis **Modifier l'événement**, **Note de réunion** et **Supprimer l'événement**. Un balayage vers le bas ferme la feuille. Les notes quotidiennes ne se trouvent pas ici : elles vivent dans **Aujourd'hui**.

Gérez les comptes depuis l'icône en forme d'engrenage dans le calendrier des événements : connectez **CalDAV** sur l'appareil avec un mot de passe d'application (p. ex. Fastmail, Nextcloud, iCloud) ; Google et Microsoft suivent via une connexion par navigateur. Par compte, vous pouvez afficher ou masquer certains calendriers.

Depuis un événement, **Note de réunion** crée la note qui lui correspond — la même note que retrouve aussi le bureau : elle reste reliée à l'événement, de sorte que l'appeler de nouveau la rouvre au lieu d'en créer une seconde, et elle atterrit dans le **Dossier des réunions**. Ce dossier et l'**Agenda par défaut** (celui où démarre un nouvel événement) se règlent dans la zone des comptes, sous **Paramètres du calendrier** ; les deux appartiennent au coffre et voyagent avec la synchronisation des paramètres. Le même endroit vous permet de choisir, par compte, quelles **Listes de tâches** se reflètent dans votre base de tâches.

**La connexion se fait par appareil.** Ce qui se synchronise, ce sont les *réglages* de votre compte, jamais la connexion elle-même — c'est voulu : les identifiants ne doivent pas quitter l'appareil. Un compte arrivé ainsi par la synchronisation des paramètres apparaît donc dans la liste, mais porte la marque **se connecter**, avec une ligne en dessous qui indique quoi faire. Tant qu'aucun compte n'est connecté sur cet appareil, le calendrier et la boîte de réception l'expliquent à cet endroit au lieu de simplement rester vides, et **Se connecter sur cet appareil** vous mène aux comptes. Les comptes connectés affichent **actif**. Si une connexion expire plus tard ou est révoquée, la ligne indique **connexion expirée** avec le motif — et **Se reconnecter** la relance sans supprimer le compte : même compte, mêmes agendas.

**Une connexion pour tous les services — ici aussi.** Si un compte Microsoft ou Google porte plusieurs services (fichiers et calendrier, par exemple), l'aperçu **Comptes cloud** propose de les fusionner en une seule connexion. Ensuite, une seule connexion maintient chaque service actif au lieu d'un seul — auparavant, un service pouvait continuer à fonctionner pendant qu'un autre du même compte avait discrètement expiré. Une boîte Gmail reste en dehors : elle fonctionne via IMAP avec un mot de passe d'application et ne nécessite aucun consentement.

**Rappels.** Sous **Paramètres du calendrier → Rappels**, activez **Rappeler les rendez-vous** ; le téléphone demande alors une fois l'autorisation d'envoyer des notifications. Le rappel porté par le rendez-vous lui-même l'emporte — ce n'est que s'il ne dit rien que Plainva rappelle 15 minutes avant, et la veille au soir à 19h00 pour les journées entières. Un rendez-vous qui ne veut expressément aucun rappel n'en reçoit pas. Les 14 prochains jours sont planifiés, avec 64 rappels d'avance au maximum — c'est ce qu'iOS autorise ; Plainva remplit cette fenêtre à chaque ouverture et après chaque actualisation du calendrier, et vous dit à partir de quand une période n'y tient plus au lieu d'avaler des rendez-vous en silence. **La limite qui demeure :** le téléphone ne peut annoncer que ce qu'il a vu lors de la dernière synchronisation — une invitation arrivant dix minutes avant le début n'atteint plus aucune notification.

**Ce que vous réglez au passage.** Le **Délai de rappel** s'applique aux rendez-vous sans rappel propre ; **Journées entières** décide du soir ou du matin où ils se manifestent. **Tâches à échéance** ajoute les tâches de votre base de tâches — avec heure comme un rendez-vous, sans heure selon la règle des journées entières. **Uniquement ces agendas** limite la provenance des rappels ; si vous ne sélectionnez rien, il est indiqué **Tous**, et un agenda ajouté plus tard en fait partie d'office. La notification porte deux gestes : pour un rendez-vous **Note de réunion** (elle la crée ou ouvre celle qui existe), pour une tâche **Cocher** — ce qui la termine sur place et, pour une tâche récurrente, crée la suivante sans que vous ouvriez l'application.

## E-mail

Dans **Réglages → E-mail**, connecte une **boîte Microsoft** (Outlook.com, Microsoft 365) directement via la connexion dans le navigateur — sans mot de passe d’application. Comme pour le calendrier, la connexion se fait par appareil.

Ensuite, tu peux ouvrir **E-mail** comme domaine à part entière via le ▾ à côté du titre et le placer dans la barre de navigation. La ligne sous le titre indique le dossier, le nombre de messages non lus et le compte, et ouvre le sélecteur de dossiers. Touche un message pour le lire ; **Enregistrer comme note** le range dans le dossier **Mail** de ton coffre (capturer deux fois ouvre la même note). Les images distantes restent bloquées jusqu’à ce que tu les autorises pour ce message — une image chargée révèle à l’expéditeur quand et où tu as lu.

**Les boîtes IMAP fonctionnent aussi sur le téléphone.** Ajoutes-en une dans **Réglages → E-mail** : choisis le fournisseur, saisis l’adresse et le mot de passe d’application, et Plainva renseigne les serveurs. Si ton fournisseur ne figure pas dans la liste, **Avancé** te permet de saisir toi-même les serveurs IMAP et SMTP, les ports et un nom d’utilisateur différent, et un compte existant peut être modifié par la suite. Pour sélectionner plusieurs messages, il suffit d’un appui long sur l’un d’eux ; ensuite, une simple pression en ajoute d’autres. Dans la vue conversations, un appui long ou une pression sur la ligne de conversation sélectionne tout l’échange — et chaque message y conserve son propre dossier, une réponse issue d’**Envoyés** est donc marquée là-bas.

Un message ouvert propose **Répondre**, **Répondre à tous** et **Transférer**. Une réponse cite l'original sous ton texte ; « Répondre à tous » reprend en plus les autres destinataires et omet ta propre adresse. Lors de la **rédaction**, **Joindre un fichier** ajoute un fichier depuis le coffre — sur le téléphone, le coffre est le stockage auquel tu as accès, et tout ce qui arrive sur l'appareil (une pièce jointe enregistrée, une photo insérée) s'y trouve déjà. Chaque pièce jointe a sa propre ligne avec **Supprimer la pièce jointe**, tant que le message n'est pas encore parti.

Un message que tu as commencé n'a pas besoin d'être envoyé : **Enregistrer le brouillon** le range dans le dossier des brouillons de ton compte — là où n'importe quel programme de messagerie sur cette boîte le trouvera, pas dans un espace propre au téléphone. Le dossier concerné est indiqué par le serveur ; ce n'est que lorsqu'il reste muet que le nom est deviné. Dans la liste, deux interrupteurs se trouvent à côté de la ligne du dossier : **Non lus** réduit ce qui est actuellement chargé (le compteur et **Charger plus** restent donc accessibles), tandis que **Marqués** interroge le serveur sur tous les messages marqués du dossier — y compris ceux bien en dessous de la page chargée. Dans **Toutes les boîtes de réception**, l'interrupteur des marqués est volontairement absent : cette requête désigne exactement une seule boîte.

Depuis un message ouvert, trois chemins mènent vers le coffre : **Enregistrer comme note**, **→ Tâche** dans le menu ⋮ (crée une entrée dans ta base de tâches par défaut — avec son modèle, son statut et la date du message) et **+ .eml**, qui conserve en plus le message d'origine et y renvoie depuis la note. Les trois sont ancrés : capturer deux fois le même message ouvre ce qui existe déjà. **Supprimer** se trouve désormais lui aussi dans le menu ⋮ plutôt qu'à côté de la flèche de retour ; dans la liste, un glissement suffit. Déplacer vers la corbeille propose **Annuler**, car c'est réversible — la suppression définitive depuis la corbeille demande toujours confirmation, car elle ne l'est pas. Et au lieu de plusieurs bandeaux empilés les uns sur les autres, il n'y a désormais plus qu'**une seule** ligne : l'erreur, sinon les comptes inaccessibles (à partir de deux, sous forme de nombre), sinon la note à propos de la copie enregistrée.

Tu peux envoyer une note depuis son propre menu ⋮ : **Envoyer la note par e-mail (mailto)** la transmet à l'application de messagerie du téléphone — Plainva n'a besoin d'aucun compte pour cela —, tandis que **Envoyer par e-mail** ouvre la fenêtre de rédaction propre à Plainva, avec objet et texte.

## Synchronisation

Les **Paramètres** (tout en bas de **Notes**) mènent, via **Vault actif**, à la gestion des vaults ; c'est là que vous connectez un espace de stockage cloud (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connecter un coffre cloud** récupère un coffre cloud existant sur l'appareil ; **Créer un vault** demande d'abord **Sur cet appareil** ou **Chez un service en ligne**, puis la structure de départ (vide ou un modèle comme PARA) — sur la voie en ligne, la connexion suit ensuite, le dossier cible dans le cloud peut être créé à neuf via **Nouveau dossier** dans la fiche de sélection, et la structure est envoyée lors de la première synchronisation. Le premier lancement propose le même choix entre un coffre cloud existant et un nouveau coffre cloud (« Connecter un coffre cloud »). Chaque connexion obtient son propre coffre séparé sur l'appareil. La page du coffre affiche le statut, la progression, les transferts en attente et propose **Exporter le coffre** (un ZIP via le menu de partage de l'appareil).

La page du coffre est organisée selon ce à quoi servent ses commandes : en haut, une **carte de statut** répond à la seule question avec laquelle on ouvre cette page — est-ce que ça tourne ? (état, dernière exécution, transferts en attente et intervalle sur une seule ligne). En dessous, des groupes nommés — **Connexion**, **Contenu** — et tout en bas, séparée par son propre bord, la **Zone de danger** avec **Déconnecter la synchronisation** et **Supprimer le coffre**. Avant, jusqu'à neuf boutons identiques s'alignaient sur une même rangée, avec **Restaurer les fichiers supprimés** juste à côté de **Supprimer le coffre**.

Sous **Contenu**, à côté d'**Exporter le coffre**, se trouve désormais la **sauvegarde automatique du vault** : un ZIP de tout le coffre chaque jour, dont les **sept** dernières sont conservées (**Sauvegardes à conserver**) ; **Sauvegarder maintenant** en crée une immédiatement. Les archives se trouvent dans les documents de l'appareil, pas dans le cache — ce que le système d'exploitation peut vider à tout moment n'est pas une archive. Un téléphone n'a pas d'alarme en arrière-plan : la vérification se fait à l'ouverture de l'application et à chaque retour dans celle-ci, la sauvegarde rattrape donc son retard au lieu de s'exécuter à heure fixe. La ligne sous l'interrupteur indique donc quand elle s'est exécutée pour la dernière fois — c'est ainsi qu'une sauvegarde qui, en silence, ne se produit jamais, devient visible. Jusqu'ici, le mobile ne proposait que l'export manuel — un coffre dont personne ne pensait à faire l'export n'avait donc aucune archive du tout.

La fréquence à laquelle ce coffre vérifie les changements distants se règle sur la même page (**intervalle de synchronisation**, au moins 5 secondes) — les enregistrements locaux partent immédiatement de toute façon. Pour Google Drive, OneDrive, Dropbox et S3, le **dossier cloud** peut aussi être changé après coup ; avec WebDAV, le dossier fait partie de l'adresse du serveur, il faut donc se reconnecter. Si la synchronisation des réglages est chiffrée, vous pouvez activer **Demander la phrase secrète à chaque démarrage** : la clé n'est alors jamais stockée sur l'appareil. Enfin, **Sécurité et partage** indique désormais clairement que les espaces chiffrés sont expérimentaux et n'ont pas fait l'objet d'un audit indépendant — conservez votre fichier et votre code de récupération en lieu sûr.

La page du coffre indique aussi si vos **paramètres** vous suivent — sous forme de carte avec un état clair plutôt qu'un simple bouton :

- **Ne sont pas synchronisés** : la synchronisation des paramètres est désactivée pour ce vault. Activez-la depuis l'application de bureau.
- **Pas encore chiffré** : ce vault n'a pas encore de phrase secrète de synchronisation. Vous pouvez désormais en définir une **sur le téléphone** : l'assistant affiche le code de récupération et vous fait retaper deux groupes choisis au hasard avant que quoi que ce soit ne soit écrit. Si une phrase secrète existe déjà dans le cloud, le téléphone vous le signale et n'en crée jamais une seconde — cela empêcherait tous les autres appareils d'y accéder.
- **Pas encore déverrouillé sur cet appareil** : vos paramètres sont stockés chiffrés dans le cloud. Saisissez la phrase secrète choisie lors de la configuration — sur le bureau ou ici, sur le téléphone ; cet appareil les déverrouille une fois grâce à elle.
- **Sont synchronisés** : cet appareil est déverrouillé ; les dossiers, les vues et les règles de sauvegarde restent au diapason de vos autres appareils.

Chaque carte précise aussi ce qui *ne* voyage *pas* : les connexions restent toujours sur l'appareil (voir [Calendrier et événements](#calendrier-et-événements)).

**Paramètres** → **Sécurité et partage** indique ce qu'est réellement la connexion — et pour un vault cloud ordinaire, il configure l'espace de travail chiffré directement sur le téléphone (identité → fichier de récupération et code → activation). Sans connexion cloud, il n'y a rien à chiffrer, et la section le dit.

Les deux configurations — l'espace de travail chiffré et la phrase secrète de synchronisation — s'exécutent désormais comme **leur propre parcours, sans barre de navigation** : tant que l'une des deux est en cours, il n'y a qu'une seule sortie, et elle demande confirmation d'abord. Ce n'est pas un ornement. Jusqu'à la dernière étape, votre clé n'existe qu'en mémoire, et quitter la supprime ; auparavant, un simple appui sur la barre pouvait le faire sans un mot. La dernière étape affiche une barre de progression là où il y a quelque chose à compter — l'espace de travail rechiffre chaque fichier, tandis que la phrase secrète de synchronisation représente deux écritures, et inventer un pourcentage pour cette dernière serait un mensonge en forme de barre.

**Les partages se gèrent désormais ici**, et plus seulement sur le bureau : dans **Personnes et droits**, vous invitez un membre avec un rôle (**Inviter** le crée — son appareil est appairé ensuite), vous créez un groupe et vous changez le rôle d'un groupe directement dans sa ligne. Dans **Slices**, vous créez un partage pour un **Dossier**. Délibérément absents du téléphone : les slices issus d'une sélection libre ou d'une règle dynamique — les deux exigeraient des surfaces qui n'existent pas ici — ainsi que le changement de clés, le transfert de propriété et la mise hors service, qui restent pour l'instant sur le bureau.

## Filet de sécurité

Les instantanés (historique des versions), un journal des brouillons (après un plantage, la note propose votre dernier état non enregistré) et des copies en conflit avec une vue de comparaison protègent vos données. La rétention se configure dans **Paramètres** → **Sauvegarde & historique des versions**.

**Si quelqu'un modifie la même note ailleurs** pendant que tu écris ici, Plainva conserve ta version dans une copie à côté et adopte celle qui vient d'arriver. Cela apparaît désormais **sur la note** et y reste jusqu'à ce que tu le résolves : un avis au-dessus du texte indique le chemin de la copie, l'ouvre et affiche au besoin les **différences**. Auparavant, c'était un message qui disparaissait après quelques secondes — et l'enregistrement continuait de réessayer, écrivant une copie de plus à chaque tour. Il n'en existe plus qu'une seule.

**Lors de la suppression d'un dossier**, la boîte de dialogue indique combien de fichiers il contient — le nombre figure aussi sur le bouton. Plainva crée d'abord un instantané de chaque fichier qu'il contient, que vous pouvez récupérer sous **Paramètres** → **Maintenance** → **Restaurer les fichiers supprimés**. Elle énonce aussi une limite ouvertement : **seul ce que ce téléphone a écrit au moins une fois peut être conservé.** Une note simplement arrivée par synchronisation et jamais modifiée ici ne figure dans aucun instantané. Contrairement au bureau, un téléphone n'a pas de corbeille du système pour la rattraper. Si la suppression concerne plus de dix fichiers, ou plus d'un cinquième du vault, Plainva demande une seconde fois — exactement comme sur le bureau.

## Partage et raccourcis

Sur Android et iOS, le texte et les URL partagés deviennent une nouvelle note dans la boîte de réception ; les images et les fichiers partagés sont importés comme pièces jointes (25 Mo maximum par fichier). Sur Android, un appui long sur l'icône de l'application ajoute les raccourcis **Nouvelle note** et **Aujourd'hui**.

## Dossiers, photos et calendrier

Le bouton flottant **Plus** reste disponible dans les dossiers imbriqués, et chaque action de création rapide crée dans le dossier que vous avez ouvert — nouveaux dossiers compris. Le ⋮ dans l'en-tête appartient en revanche à l'objet ouvert : il affiche les actions de cet objet, jamais les paramètres de l'application.

Le bouton photo de l'éditeur propose **Prendre une photo** ou **Choisir dans la photothèque**, conserve la position d'insertion et signale visiblement les erreurs d'autorisation ou de fichier. Les photos atterrissent dans le dossier des pièces jointes du coffre — celui-là même qu'utilise votre ordinateur.

Les événements et les notes quotidiennes sont délibérément séparés : **Calendrier** affiche les calendriers connectés (voir [Calendrier et événements](#calendrier-et-événements)), **Aujourd'hui** affiche la note quotidienne d'un jour choisi. Il n'existe pas de vue mensuelle locale des notes quotidiennes — c'est le bandeau dans **Aujourd'hui** qui joue ce rôle.

## Pièces jointes et images

Outre les notes et les bases, le navigateur affiche désormais les **pièces jointes** : images, PDF, tout ce qui se trouve dans le dossier. Une image s’ouvre dans Plainva ; le reste est confié au système, qui sait ce qu’est un PDF et Plainva non. **Partager** transmet un fichier à n’importe quelle autre application.

Le menu ⋮ d’une note propose **Exporter en Markdown…** : le fichier lui-même passe à la feuille de partage du système, où vous trouvez Imprimer, « Enregistrer dans Fichiers » et tous les éditeurs installés. **Partager**, au-dessus, n’envoie que le texte de la note.

## Glissement

**Faites glisser une ligne vers la gauche** pour révéler ses actions : **Signet** et **Supprimer** pour une note, **Renommer** et **Supprimer le dossier** pour un dossier, **Supprimer** pour une base de données et dans la boîte mail. Ce sont les mêmes actions que la ligne propose dans son menu (appui long) — le glissement est simplement le chemin le plus court pour y arriver, jamais le seul. La première fois, un bandeau au-dessus de la liste vous le signale ; vous le faites disparaître d’un tapotement, et il n’apparaît qu’une seule fois par vault.

Supprimer redemande confirmation par la même boîte de dialogue que partout ailleurs. Pendant que vous sélectionnez plusieurs lignes, le glissement est désactivé — un geste qui désigne exactement une ligne n’a pas de sens clair à côté d’une sélection que vous êtes encore en train de constituer. Lorsque les **conversations** sont activées dans la boîte mail, un glissement sur une conversation concerne la conversation **entière** (au lieu d’une annulation, elle vous indique ensuite combien de messages elle contenait) ; un message individuel déplié se glisse quant à lui toujours à part. Les lignes de tâche n’ont pas d’actions de glissement — elles portent leurs commandes visiblement sur la ligne.

## Sur les grands écrans

L’application s’adapte à la largeur de la fenêtre, pas au nom de l’appareil :

- **en dessous de 600 px** — une surface après l’autre, comme sur le téléphone.
- **de 600 à 839 px** — la barre de navigation devient un **rail sur le côté** ; il reste une seule surface.
- **à partir de 840 px** — le navigateur et la surface de travail se placent **côte à côte**. C’est le même navigateur que la zone **Notes**, simplement à côté de votre travail plutôt que devant lui.

Sur une tablette, ou un grand téléphone tourné à l’horizontale, vous obtenez le même modèle spatial que sur le bureau — naviguer à gauche, travailler au centre — au lieu d’un téléphone agrandi.


## Bases de données dans le calendrier

Au-dessus des vues du calendrier se trouve une rangée de puces : toute vue `.base` de type **calendrier** ou **chronologie** qui nomme une colonne de date peut y être affichée. Les entrées affichées apparaissent parmi les rendez-vous dans les listes du jour et de l'agenda — avec un **losange et un bord en pointillés**, pour qu'une note ne ressemble jamais à un rendez-vous ; dans la grille mensuelle sous forme de **point creux**. Un appui ouvre la note.

**Le choix appartient au coffre**, pas à l'appareil : ce que vous affichez sur l'ordinateur se retrouve ici dès que la synchronisation des réglages a eu lieu. Sur le téléphone, on planifie via la feuille de l'entrée — le glisser reste réservé à l'ordinateur.

Inversement, la vue calendrier d'une base de données peut afficher le **nombre de vrais rendez-vous** du jour dans le coin de la cellule — vous voyez face à quoi vous planifiez.
