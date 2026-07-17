# Calendrier & tâches externes

Dernière mise à jour : 2026-07-18

Plainva peut connecter vos comptes de calendrier et de tâches existants — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendrier + Tasks) et **Microsoft** (calendrier Outlook + To Do) — et travailler avec eux dans les deux sens. Vos notes restent le centre : les événements peuvent devenir des notes de réunion, et les listes de tâches externes se reflètent comme des notes ordinaires dans votre [base de tâches par défaut](Tasks.md).

## Connecter un compte

Ouvrez **Paramètres → Vault → Calendrier et comptes → Ajouter un compte…** et choisissez un fournisseur :

- **CalDAV** : URL du serveur, nom d'utilisateur et un **mot de passe d'application** (dans Nextcloud : Paramètres → Sécurité → Appareils et sessions). Aucune inscription, aucune clé.
- **Google** : nécessite votre propre ID client OAuth (le même modèle BYO que pour la synchronisation Google Drive — voir le [guide Drive](Google_Drive_BYO_Guide.md)). Dans votre projet Google Cloud, activez en plus les API *Google Calendar* et *Google Tasks* et ajoutez leurs portées à l'écran de consentement. Le navigateur s'ouvre pour le consentement ; connecter le compte le valide avant que quoi que ce soit ne soit enregistré.
- **Microsoft** : cliquez simplement sur **Connecter** et confirmez dans le navigateur — aucune configuration nécessaire.

Chaque compte liste ses **calendriers** (ceux cochés apparaissent dans l'onglet calendrier) et ses **listes de tâches** (délibérément décochées par défaut — en cocher une démarre la synchronisation des tâches décrite ci-dessous). Les mots de passe et les jetons résident dans le trousseau de votre système d'exploitation. Le paramètre **Dossier des réunions** sous les comptes détermine où sont créées les notes de réunion.

## L'onglet calendrier

Ouvrez-le depuis la barre d'actions à gauche (icône calendrier) ou la palette de commandes (**Ouvrir le calendrier**). Trois vues sont disponibles via le sélecteur dans l'en-tête : **Mois** affiche une grille avec vos événements (un point coloré par calendrier) plus un panneau du jour listant le jour sélectionné — les événements toute la journée d'abord, puis ceux avec horaire, indiquant l'heure, le nom du calendrier et le lieu. **Semaine** affiche sept colonnes de jours avec les événements (et, si la superposition des tâches est activée, les tâches à échéance) directement dans les colonnes — sans panneau du jour supplémentaire ; le **+** dans l'en-tête d'une colonne crée un événement ce jour-là. **Agenda** liste les semaines à venir regroupées par jour, avec les mêmes cartes d'action que le panneau du jour. Le premier jour de la semaine suit le paramètre **Début de la semaine** (Paramètres → App → Apparence : Lundi, Samedi ou Dimanche) — il s'applique aussi au calendrier de la barre latérale. La vue s'actualise automatiquement toutes les quelques minutes ; le bouton d'actualisation la force.

- **Nouvel événement** : le **+** dans le panneau du jour — titre, calendrier, date/heure ou plage toute la journée, lieu, et une **répétition** simple optionnelle (Quotidien/Hebdomadaire/Mensuel/Annuel).
- **Modifier / supprimer** : les icônes crayon et corbeille sur un événement. Les modifications sont envoyées au fournisseur avec une vérification de sécurité : si l'événement a changé à distance entre-temps, Plainva actualise la vue au lieu d'écraser.
- **Les événements récurrents** portent un badge de répétition. Modifier ou supprimer une occurrence demande « Seulement cet événement » (crée une exception / ignore juste cette occurrence) ou « Tous les événements » (modifie toute la série). Plainva ne réécrit jamais une règle de récurrence existante.
- **Afficher les tâches** (à côté du bouton d'actualisation, quand une base de tâches par défaut est définie) : superpose les entrées à échéance de votre [base de tâches par défaut](Tasks.md) sur la grille mensuelle et le panneau du jour ; les tâches terminées apparaissent barrées. Désactivé par défaut, le choix est mémorisé par appareil.

## Événement → note de réunion

L'icône de note sur n'importe quel événement crée (ou rouvre) sa **note de réunion** — une note normale dans votre dossier des réunions nommée `AAAA-MM-JJ Titre.md`, pré-remplie avec la date, le lieu et les participants, plus un petit marqueur `plainva.pim` dans le frontmatter qui la lie à l'événement. Cliquer à nouveau sur le même événement ouvre toujours la même note ; une de vos notes qui porte par hasard le même nom n'est jamais touchée.

## Listes de tâches externes dans votre base de tâches

Cochez une **liste de tâches** sur un compte connecté, et ses tâches apparaissent comme des notes dans votre [base de tâches par défaut](Tasks.md) : le titre devient la note (H1), la date d'échéance atterrit dans la colonne de date de la base de données, et l'état terminé se reflète dans la **propriété de case à cocher terminé** de la base de données (la colonne de statut la suit ; une base de données sans colonne de case à cocher utilise la convention de statut — première option = ouvert, dernière = terminé). La synchronisation est bidirectionnelle, champ par champ :

- Modifiez la note (titre, échéance, statut) → la modification est poussée vers le fournisseur.
- Modifiez la tâche à distance → la note suit.
- Si les deux côtés ont changé, votre modification locale l'emporte pour ce champ ; le reste suit le côté distant.

Deux règles de sécurité protègent vos données : **supprimer la note ne supprime jamais la tâche distante** (la synchronisation s'arrête simplement, sans réimportation), et **une tâche supprimée à distance ne supprime jamais votre note** (elle devient simplement une note normale). Renommer ou déplacer une note de tâche ne pose pas de problème — le marqueur du frontmatter conserve le lien.

Limites actuelles : les tâches créées comme notes ordinaires ne sont pas poussées vers le fournisseur (créez-les à distance ou via la base de tâches), et tout sur cette page est pour l'instant pensé d'abord pour le bureau.
