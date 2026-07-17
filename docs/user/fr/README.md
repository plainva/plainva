# Guide utilisateur de Plainva

Dernière mise à jour : 2026-07-06

Cette traduction a été générée automatiquement — les corrections sont les bienvenues.

Plainva est un éditeur de vault Markdown : vos notes sont de simples fichiers Markdown dans un dossier (un « vault ») sur votre ordinateur — pas de silo de base de données, pas de compte cloud imposé. Ce guide explique comment travailler avec Plainva et comment fonctionnent les formats de fichiers.

## Sommaire

| Page | Ce qu'elle couvre |
|---|---|
| [Prise en main](Getting_Started.md) | Ouvrir ou créer un vault, l'interface, les modes de l'éditeur, les onglets et la vue scindée |
| [Notes & Markdown](Notes_and_Markdown.md) | Comment fonctionnent les fichiers Markdown : écriture, mise en forme, propriétés (frontmatter), icônes, liens, modèles, images |
| [Bases de données (.base)](Databases_Base.md) | Afficher des notes comme une base de données — vues, filtres, propriétés, relations, nouveaux éléments (semblable à Notion, mais basé sur des fichiers) |
| [OKF](OKF.md) | L'Open Knowledge Format : `type`, `okf_version`, la gestion des index.md et la conversion facultative du vault |
| [Référence du format de fichier](File_Format_Reference.md) | Le format exact sur le disque de chaque fichier du vault — pour des outils, des scripts ou une IA qui modifient directement des notes et des fichiers `.base` |
| [Automatisation & scripts](Automation_and_Scripts.md) | Étendre Plainva sans plugins : comment les scripts, les outils CLI et les agents IA lisent et écrivent un vault en toute sécurité |
| [Sauvegardes & historique des versions](Backups_and_Versioning.md) | Versions de fichiers automatiques, restauration (y compris des fichiers supprimés) et sauvegardes ZIP quotidiennes du vault |
| [L'application mobile](Mobile_App.md) | Plainva sur Android et iOS : structure, édition, bases de données, synchronisation et filet de sécurité |
| [Configurer la synchronisation](Sync_Setup.md) | Étape par étape selon le fournisseur : WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3 |
| [Compatibilité de synchronisation](Sync_Compatibility.md) | Quels services fonctionnent aujourd'hui — directement, via WebDAV, ou via le client de bureau du fournisseur |
| [Google Drive (BYO)](Google_Drive_BYO_Guide.md) | Configurer la synchronisation Google Drive avec vos propres identifiants |
| [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md) | Configurer la synchronisation OneDrive et Dropbox avec votre propre inscription d'application |
| [Recherche](Search.md) | Recherche en texte intégral, sélecteur rapide, rechercher & remplacer, tags |
| [Tâches](Tasks.md) | La vue des tâches à l'échelle du vault : chaque case à cocher de vos notes, avec des filtres par état, étiquette, dossier et échéance, et une bascule en un clic |
| [Calendrier & tâches externes](Calendar_and_Tasks.md) | Connecter des calendriers CalDAV/Google/Microsoft, l'onglet calendrier, les notes de réunion, et synchroniser des listes de tâches externes dans la base de tâches |
| [Capture d'e-mails](Email_Capture.md) | IMAP en lecture seule : la visionneuse cloisonnée, enregistrer des e-mails comme notes/.eml/tâches, et faire sortir du contenu sans envoyer |
| [Graphe](Graph.md) | Graphe contextuel, carte du coffre avec mode de nettoyage et voyage dans le temps, le graphe comme vue de base de données |
| [Raccourcis clavier](Keyboard_Shortcuts.md) | Tous les raccourcis clavier en un coup d'œil |
| [FAQ & dépannage](FAQ.md) | Questions courantes : compatibilité Obsidian, fichiers en conflit, sauvegardes et plus |

## Principes fondamentaux

- **Vos fichiers vous appartiennent.** Un vault est un simple dossier de fichiers Markdown. Vous pouvez l'ouvrir, le copier ou le sauvegarder avec n'importe quel autre programme à tout moment.
- **Le Markdown pur est le format canonique.** Même les fonctionnalités supplémentaires (propriétés, icônes, bases de données) sont stockées dans des formats texte ouverts et lisibles.
- **Compatible Obsidian.** Les vaults Obsidian existants ne sont jamais endommagés ni reformatés ; Obsidian peut ouvrir chaque fichier créé par Plainva.
