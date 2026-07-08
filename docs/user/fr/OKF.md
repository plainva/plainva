# OKF — Open Knowledge Format

Dernière mise à jour : 2026-07-07

OKF (Open Knowledge Format) est une convention ouverte pour les collections de connaissances en Markdown : des fichiers Markdown purs avec un petit en-tête frontmatter uniforme. Cette page explique ce qu'est l'OKF, ce que Plainva fait automatiquement pour lui — et pourquoi vous n'êtes *obligé* d'utiliser rien de tout cela.

## Qu'est-ce que l'OKF ?

L'idée : chaque document du vault dit lui-même ce qu'il est. Un en-tête frontmatter minimal suffit :

```markdown
---
type: Note
okf_version: "0.1"
---
# Ma note
```

- **`type`** — quel genre de document c'est (p. ex. `Note`, `Daily Note`, `Projet`). Le seul champ obligatoire de la convention.
- **`okf_version`** — la version de la convention selon laquelle le fichier a été écrit.
- **`index.md`** — chaque dossier peut contenir une `index.md` comme table des matières ; les noms `index.md` et `log.md` sont réservés à cet usage et ne devraient pas être utilisés pour des notes normales.

> Vous écrivez des fichiers avec un outil ou un script ? Le contrat de champ exact — quelles valeurs sont autorisées, comment chaque type de propriété se sérialise, et les règles de noms réservés — vit dans la [Référence du format de fichier](File_Format_Reference.md).

## Pourquoi Plainva utilise-t-il l'OKF ?

Le Markdown pur est merveilleusement portable — mais à lui seul, il n'a aucune structure fiable. L'OKF en ajoute juste ce qu'il faut, et tout reste du Markdown ordinaire avec un frontmatter standard :

- **Les bases de données, les filtres et les modèles peuvent s'appuyer sur une structure.** Chaque note porte un `type`, ce qui permet aux vues `.base` sur de simples fichiers de rester robustes.
- **Les dossiers restent navigables.** Une table des matières `index.md` par dossier fonctionne aussi bien pour les personnes que pour les outils.
- **Les scripts et les assistants IA peuvent travailler avec votre vault en toute sécurité**, car le format sur le disque est uniforme et documenté.
- **Aucun verrouillage propriétaire.** L'OKF est une convention ouverte au-dessus du Markdown pur — d'autres outils OKF comprennent vos fichiers, aujourd'hui comme dans dix ans.

## Ce que Plainva fait automatiquement

**Les nouveaux fichiers** reçoivent l'en-tête OKF automatiquement : chaque note créée dans Plainva reçoit `type` et `okf_version` dans son frontmatter. Vous configurez les valeurs par vault : **Paramètres → Paramètres du vault → OKF (Open Knowledge Format)** → **type pour les nouvelles notes** (par défaut `Note`) et **type pour les notes quotidiennes** (par défaut `Daily Note`). Si un modèle apporte son propre `type`, le modèle l'emporte.

**Les fichiers existants ne sont jamais modifiés sans votre accord.** Plainva n'ajoute des champs OKF qu'à la création de nouveaux fichiers ou lorsque vous démarrez explicitement la conversion.

**Champs système protégés :** dans le panneau **Propriétés**, `type` et `okf_version` sont marqués comme champs système OKF (« Champ système OKF – géré par Plainva ») : la valeur de `type` se choisit dans une liste déroulante de types connus, `okf_version` est en affichage seul ; le renommage, le changement de type et la suppression sont verrouillés pour que la convention ne puisse pas se casser par accident.

**Le modal explicatif :** à la première ouverture d'un vault, Plainva affiche une fois **Qu'est-ce que l'OKF ?** — le même résumé est toujours disponible dans les paramètres.

## index.md : la table des matières par dossier

Une `index.md` est la table des matières d'un dossier : une liste des notes et sous-dossiers qu'il contient, avec des descriptions et des liens relatifs.

- **Générer** — toujours sur votre action, jamais spontanément : clic droit sur un dossier → **Générer/actualiser index.md**, ou en bloc via le **gestionnaire d'index.md** (**Paramètres → OKF → Ouvrir…**).
- **Adopter plutôt que générer** — si vous avez déjà des notes de synthèse (MOC, Overview, note de dossier, README…), le gestionnaire les suggère comme candidates. **Adopter** renomme le fichier en `index.md` (les liens sont mis à jour dans tout le vault) et peut éventuellement le préparer pour l'OKF.
- **Entretien automatique** — les listings *générés* par Plainva portent un marqueur invisible à la fin du fichier (un commentaire HTML). Seuls ces fichiers marqués sont maintenus à jour automatiquement à chaque changement dans le dossier — et uniquement dans les vaults OKF (reconnaissables par `okf_version` dans l'`index.md` racine).
- **Lecture seule avec une échappatoire** — les fichiers index.md gérés s'ouvrent en mode lecture avec la bannière « Cet index.md est géré par Plainva et mis à jour automatiquement. » Vous pouvez y **Actualiser** — ou choisir **Modifier quand même** : cela retire le marqueur et le fichier redevient entièrement le vôtre (plus de mises à jour automatiques).
- **Tout en une fois** — **Mettre à jour tous les index.md** est disponible dans le menu contextuel de la racine du vault et dans les paramètres ; les fichiers sans marqueur sont ignorés.
- En mode lecture, les listings gérés se rendent comme des cartes avec des icônes de fichier/dossier ; les liens s'ouvrent directement dans Plainva.

## Convertir un vault existant (opt-in)

Si des fichiers du vault ne sont pas conformes au format OKF (champ `type` manquant, ou noms réservés utilisés comme notes normales), Plainva propose la conversion — une fois à l'ouverture du vault, et en permanence sous **Paramètres → OKF → Conversion OKF** (l'entrée n'apparaît que tant qu'il y a quelque chose à faire).

L'assistant **Convertir au format OKF** fonctionne en étapes claires :

1. **Analyse** — montre combien de fichiers sont concernés (les dossiers de modèles et système sont exclus ; les fichiers avec un frontmatter illisible sont ignorés, jamais « réparés »).
2. **Décisions** — un `type` par défaut pour les fichiers qui n'en ont pas ; les valeurs `type` existantes peuvent être **conservées** (recommandé — ce sont déjà des types OKF valides) ou renommées vers un autre champ.
3. **Aperçu (sans modifications)** — un essai à blanc montre à l'avance ce qui changerait.
4. **Convertir** — chaque fichier est sauvegardé dans `.plainva/backups/` avant d'être modifié ; un rapport résume ce qui a changé, ce qui a été ignoré, et le dossier de sauvegarde. Ensuite, vous pouvez éventuellement **continuer vers le gestionnaire d'index.md**.

Un conseil de l'assistant : les modifications passent normalement par la synchronisation — pour les vaults git, committez d'abord.

## Dois-je utiliser l'OKF ?

Non. L'OKF est une norme douce :

- Les nouveaux fichiers reçoivent l'en-tête automatiquement — cela ne gêne jamais et ne coûte rien.
- Les vaults existants (p. ex. venant d'Obsidian) continuent de fonctionner sans changement ; la conversion est strictement opt-in.
- Un `okf_version` manquant seul ne compte pas comme une violation — vous pouvez utiliser Plainva et Obsidian côte à côte en permanence sans avertissements incessants.
- Obsidian et tout autre éditeur peuvent toujours ouvrir chaque fichier : c'est et cela reste du Markdown pur.

## Voir aussi

- [Référence du format de fichier](File_Format_Reference.md) — le contrat exact sur le disque de chaque fichier du vault
- [Notes & Markdown](Notes_and_Markdown.md) — frontmatter et propriétés
- [Bases de données (.base)](Databases_Base.md) — ce qu'un `type` uniforme apporte concrètement
- [FAQ & dépannage](FAQ.md) — sauvegardes et index.md en lecture seule, entre autres
