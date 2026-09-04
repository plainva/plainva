# OKF — Open Knowledge Format

Dernière mise à jour : 2026-09-04

OKF (Open Knowledge Format) est une convention ouverte pour les collections de connaissances en Markdown : des fichiers Markdown purs avec un petit en-tête frontmatter uniforme. Cette page explique ce qu'est l'OKF, ce que Plainva fait automatiquement pour lui — et pourquoi vous n'êtes *obligé* d'utiliser rien de tout cela.

## Qu'est-ce que l'OKF ?

L'idée : chaque document du vault dit lui-même ce qu'il est. Un en-tête frontmatter minimal suffit :

```markdown
---
type: Note
---
# Ma note
```

- **`type`** — quel genre de document c'est (p. ex. `Note`, `Daily Note`, `Projet`). Le seul champ obligatoire de la convention.
- **`okf_version`** — la version de la convention que suit le vault. Elle vit **une seule fois**, dans l'`index.md` racine (actuellement `"0.2"`), pas dans chaque note.
- **`index.md`** — chaque dossier peut contenir une `index.md` comme table des matières ; les noms `index.md` et `log.md` sont réservés à cet usage et ne devraient pas être utilisés pour des notes normales.

> Vous écrivez des fichiers avec un outil ou un script ? Le contrat de champ exact — quelles valeurs sont autorisées, comment chaque type de propriété se sérialise, et les règles de noms réservés — vit dans la [Référence du format de fichier](File_Format_Reference.md).

**D'où vient l'OKF :** l'OKF est une spécification ouverte de Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), licence Apache-2.0). Plainva suit **OKF 0.2** (publiée le 25 juillet 2026). Nouveaux dans la 0.2 : cinq champs facultatifs avec lesquels une note dit d'où elle vient, si quelqu'un l'a relue et si elle tient toujours — `generated`, `verified`, `sources`, `stale_after` et `status`. Ce que Plainva en affiche et en écrit est décrit plus bas sous « Provenance, relecture et cycle de vie ».

## Pourquoi Plainva utilise-t-il l'OKF ?

Le Markdown pur est merveilleusement portable — mais à lui seul, il n'a aucune structure fiable. L'OKF en ajoute juste ce qu'il faut, et tout reste du Markdown ordinaire avec un frontmatter standard :

- **Les bases de données, les filtres et les modèles peuvent s'appuyer sur une structure.** Chaque note porte un `type`, ce qui permet aux vues `.base` sur de simples fichiers de rester robustes.
- **Les dossiers restent navigables.** Une table des matières `index.md` par dossier fonctionne aussi bien pour les personnes que pour les outils.
- **Les scripts et les assistants IA peuvent travailler avec votre vault en toute sécurité**, car le format sur le disque est uniforme et documenté.
- **Aucun verrouillage propriétaire.** L'OKF est une convention ouverte au-dessus du Markdown pur — d'autres outils OKF comprennent vos fichiers, aujourd'hui comme dans dix ans.

## Ce que Plainva fait automatiquement

**Les nouveaux fichiers** reçoivent l'en-tête OKF automatiquement : chaque note créée dans Plainva reçoit `type` dans son frontmatter — depuis l'OKF 0.2, le marqueur de version `okf_version` vit une seule fois dans l'`index.md` racine, et non plus dans chaque note. Vous configurez les valeurs par vault : **Paramètres → Vault → Contenu et structure → OKF (Open Knowledge Format)** → **type pour les nouvelles notes** (par défaut `Note`) et **type pour les notes quotidiennes** (par défaut `Daily Note`). Si un modèle apporte son propre `type`, le modèle l'emporte.

**Les fichiers existants ne sont jamais modifiés sans votre accord.** Plainva n'ajoute des champs OKF qu'à la création de nouveaux fichiers ou lorsque vous démarrez explicitement la conversion.

**Champs système protégés :** dans le panneau **Propriétés**, `type` et — là où d'anciennes notes le portent encore — `okf_version` sont marqués comme champs système OKF (« Champ système OKF – géré par Plainva ») : la valeur de `type` se choisit dans une liste déroulante de types connus, `okf_version` est en affichage seul ; le renommage, le changement de type et la suppression sont verrouillés pour que la convention ne puisse pas se casser par accident.

**Le modal explicatif :** **Qu'est-ce que l'OKF ?** dans les paramètres vous donne la version courte en trois phrases, plus un lien vers cette page. Il ne s'ouvre plus tout seul ; si un vault contient des fichiers qui ne sont pas conformes au format OKF, Plainva le signale une fois dans un petit message avec un bouton qui vous mène directement à la conversion.

## Provenance, relecture et cycle de vie (OKF 0.2)

Depuis l'OKF 0.2, une note peut dire d'où elle vient, qui l'a relue et si elle tient toujours. Plainva en fait trois choses :

**Ce que Plainva affiche.**

- Une note avec `status: draft` ou `status: deprecated` porte un badge dans l'en-tête du document — **Brouillon** ou **Obsolète**. `stable` reste silencieux ; une colonne `status` à vous avec d'autres valeurs (disons `Open` dans une base de tâches) n'est pas un état de cycle de vie et ne reçoit aucun badge.
- Une fois `stale_after` dépassé, l'avis **Marquée comme périmée (depuis le …)** apparaît au-dessus de la note avec un saut vers les propriétés. L'avis est un simple affichage — Plainva ne change rien dans la note.
- La section **Confiance et provenance** du panneau des propriétés (sur le téléphone : dans la fiche contextuelle de la note) résume les champs et en déduit un niveau de confiance : **Non vérifiée**, **Confirmée par la machine** ou **Relue par une personne** — plus l'auteur de la génération, la liste verified, les sources en liens cliquables, le statut et la péremption. Les lignes **Statut**, **Périmée après** et **Version OKF** portent des libellés traduits ; la clé écrite dans le fichier (`status`, `stale_after`, `okf_version`) apparaît en infobulle sur l'icône de cadenas et ne change jamais.

**Ce que Plainva écrit.**

- `generated` (et, quand une source est connue, `sources`) n'est défini que par exactement trois chemins d'écriture automatiques : l'**importeur** (`plainva-import/<version>`, un instant par exécution — le rapport d'import le porte aussi), la **capture d'e-mails** (`plainva-mail-capture/<version>`, avec le Message-ID du message comme source) et la **synchronisation des tâches** (`plainva-task-sync/<version>`, uniquement quand elle crée une note).
- `verified` n'est écrit que par **Marquer comme relue** dans la section **Confiance et provenance** : Plainva ajoute `human:<votre nom>` avec l'instant actuel à la liste — une seconde relecture n'écrase jamais la première. Votre nom est demandé une fois par vault ; il reste sur cet appareil et peut être modifié sous **Paramètres → Vault → Contenu et structure → Nom du relecteur**.
- L'éditeur ne touche jamais lui-même à ces champs, et les notes existantes ne sont jamais tamponnées après coup. `status` et `stale_after` sont à vous de définir, comme une propriété ou dans le frontmatter.

**Faire évoluer la version du bundle.** La version de la convention vit une seule fois dans l'`index.md` racine. Un vault qui déclare encore `"0.1"` continue de fonctionner sans changement — sous **Paramètres → Vault → Contenu et structure → Version du bundle** (sur le téléphone : **Réglages → Vault → Maintenance → Version du bundle**), vous la faites passer à 0.2 avec **Mettre à niveau…**. La boîte de dialogue montre au préalable ce qui change : la ligne dans l'`index.md` racine et, via une case à cocher (activée par défaut), la suppression du champ hérité `okf_version` des notes qui le portent encore. Chaque fichier est sauvegardé avant d'être modifié ; **Nettoyer…** ne fait que la seconde partie. Le tableau des champs et les règles d'écriture en détail se trouvent dans la [Référence du format de fichier](File_Format_Reference.md).

## index.md : la table des matières par dossier

Une `index.md` est la table des matières d'un dossier : une liste des notes et sous-dossiers qu'il contient, avec des descriptions et des liens relatifs.

- **Générer** — toujours sur votre action, jamais spontanément : clic droit sur un dossier → **Créer un aperçu** / **Actualiser l’aperçu**, ou en bloc via le **gestionnaire d'index.md** (**Paramètres → Vault → Contenu et structure → Ouvrir…**).
- **Adopter plutôt que générer** — si vous avez déjà des notes de synthèse (MOC, Overview, note de dossier, README…), le gestionnaire les suggère comme candidates. **Adopter** renomme le fichier en `index.md` (les liens sont mis à jour dans tout le vault) et peut éventuellement le préparer pour l'OKF.
- **Entretien automatique** — les listings *générés* par Plainva portent un marqueur invisible à la fin du fichier (un commentaire HTML). Seuls ces fichiers marqués sont maintenus à jour automatiquement à chaque changement dans le dossier — et uniquement dans les vaults OKF (reconnaissables par `okf_version` dans l'`index.md` racine).
- **Lecture seule avec une échappatoire** — les fichiers index.md gérés s'ouvrent en mode lecture avec la bannière « Cet index.md est géré par Plainva et mis à jour automatiquement. » Vous pouvez y **Actualiser** — ou choisir **Modifier quand même** : cela retire le marqueur et le fichier redevient entièrement le vôtre (plus de mises à jour automatiques).
- **Tout en une fois** — **Mettre à jour tous les index.md** est disponible dans le menu contextuel de la racine du vault et dans les paramètres ; les fichiers sans marqueur sont ignorés.
- **Combler les lacunes** — dans le gestionnaire d'index.md, le bouton **Générer index.md dans tous les dossiers qui n'en ont pas** présélectionne chaque dossier qui n'a pas encore d'index.md, afin que vous puissiez tous les créer en une seule fois.
- **Sur le téléphone** — la même chose, par deux portes : un appui long sur un dossier propose **Créer un aperçu** ou **Actualiser l’aperçu**, selon ce dont ce dossier a besoin. Pour la passe rare sur l’ensemble du coffre, il y a **Paramètres → Vault → Maintenance → Aperçus** : les dossiers sans aperçu figurent en tête, et **Générer index.md dans les N dossiers qui n'en ont pas** les crée d’un seul coup. Un dossier dont vous avez écrit l’`index.md` vous-même est listé et laissé tel quel — l’adoption est une décision nommée dans cette liste, jamais l’effet secondaire d’une pression. La mise à jour automatique fonctionne désormais aussi sur le téléphone : un coffre modifié là ne se périme plus jusqu’à ce qu’un ordinateur l’ouvre.
- En mode lecture, les listings gérés se rendent comme des cartes avec des icônes de fichier/dossier ; les liens s'ouvrent directement dans Plainva.

## Convertir un vault existant (opt-in)

Si des fichiers du vault ne sont pas conformes au format OKF (champ `type` manquant, ou noms réservés utilisés comme notes normales), Plainva propose la conversion — une fois à l'ouverture du vault, et en permanence sous **Paramètres → Vault → Contenu et structure → Conversion OKF** (l'entrée n'apparaît que tant qu'il y a quelque chose à faire).

L'assistant **Convertir au format OKF** fonctionne en étapes claires :

1. **Analyse** — montre combien de fichiers sont concernés (les dossiers de modèles et système sont exclus ; les fichiers avec un frontmatter illisible sont ignorés, jamais « réparés »).
2. **Décisions** — un `type` par défaut pour les fichiers qui n'en ont pas ; les valeurs `type` existantes peuvent être **conservées** (recommandé — ce sont déjà des types OKF valides) ou renommées vers un autre champ.
3. **Aperçu (sans modifications)** — un essai à blanc montre à l'avance ce qui changerait.
4. **Convertir** — chaque fichier est sauvegardé dans `.plainva/backups/` avant d'être modifié ; un rapport résume ce qui a changé, ce qui a été ignoré, et le dossier de sauvegarde. Ensuite, vous pouvez éventuellement **continuer vers le gestionnaire d'index.md**.

Un conseil de l'assistant : les modifications passent normalement par la synchronisation — pour les vaults git, committez d'abord.

### Sur le téléphone

Le même chemin existe sur mobile : **Réglages → Vault → Maintenance → Convertir au format OKF**. Les étapes sont identiques — analyse, décisions, aperçu, conversion — et l'aperçu nomme les notes concernées avant que quoi que ce soit ne soit écrit.

Deux choses s'y ajoutent, parce qu'un téléphone peut retirer une application de la mémoire à tout moment :

- **Mettre en pause et continuer.** L'exécution s'arrête au fichier suivant lorsque vous touchez **Pause** ou que l'application passe en arrière-plan. La reprise écrit dans le même dossier de sauvegarde — il n'en apparaît pas un second.
- **La question au démarrage.** Si une exécution reste inachevée, Plainva le signale à la prochaine ouverture et propose **Continuer** ou **Revenir en arrière** ; **Plus tard** est une réponse valable. Une exécution interrompue laisse un vault partiellement converti, pas cassé : seuls des champs de frontmatter sont ajoutés, et chaque note reste du Markdown valide.

**Revenir en arrière** restaure les fichiers depuis le dossier de sauvegarde — sur le bureau aussi, depuis le rapport de fin d'exécution. Le dossier de sauvegarde reste ensuite en place ; c'est la seule copie de l'état d'avant la conversion.

## Dois-je utiliser l'OKF ?

Non. L'OKF est une norme douce :

- Les nouveaux fichiers reçoivent l'en-tête automatiquement — cela ne gêne jamais et ne coûte rien.
- Les vaults existants (p. ex. venant d'Obsidian) continuent de fonctionner sans changement ; la conversion est strictement opt-in.
- Un `okf_version` manquant — ou encore présent dans d'anciennes notes — ne compte pas comme une violation ; vous pouvez utiliser Plainva et Obsidian côte à côte en permanence sans avertissements incessants.
- Obsidian et tout autre éditeur peuvent toujours ouvrir chaque fichier : c'est et cela reste du Markdown pur.

## Voir aussi

- [Référence du format de fichier](File_Format_Reference.md) — le contrat exact sur le disque de chaque fichier du vault
- [Notes & Markdown](Notes_and_Markdown.md) — frontmatter et propriétés
- [Bases de données (.base)](Databases_Base.md) — ce qu'un `type` uniforme apporte concrètement
- [FAQ & dépannage](FAQ.md) — sauvegardes et index.md en lecture seule, entre autres
