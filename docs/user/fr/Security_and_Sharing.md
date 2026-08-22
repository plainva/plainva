# Sécurité et partage

> **Expérimental — pas encore audité de manière indépendante.** Les espaces de travail chiffrés sont proposés en avant-première. La conception cryptographique n’a pas encore été auditée par un examinateur indépendant, et les tests sur deux appareils avec du matériel Android et iOS réel sont encore en cours. Essayez-le, mais conservez une sauvegarde de tout ce que vous ne pouvez pas vous permettre de perdre, et ne vous y fiez pas encore pour du contenu qui doit impérativement être protégé.

## Centre de sécurité, rechiffrement et slices publiés

**Sécurité et partage** comporte deux niveaux. L’**Aperçu** (premier niveau) affiche l’état de protection, **Terminer la migration** lorsqu’il reste du texte en clair, **Supprimer la connexion au cloud chiffré**, et deux cartes qui ouvrent le second niveau — **Appareils et récupération** et **Partager avec d’autres**. Au second niveau, la navigation par zones remplace la colonne de gauche des paramètres, regroupée en **Votre accès** (Appareils, récupération) et **Partage** (Membres, groupes, slices, publications) ; **‹ Aperçu** revient au premier niveau. Les actions visibles restent disponibles : une action ouvre le vault, la connexion, la configuration ou le déverrouillage requis. Une révocation peut lancer un rechiffrement complet reprenable. Créez un Vault Slice via **Détails → Contenu → Autorisations → Vérification**. Les publications externes occupent un workspace chiffré séparé ; la projection nettoyée retire propriétés privées, liens exclus et inclusions. La diffusion publique attend l’audit crypto indépendant et les essais Android/iOS réels.

Créez un Vault Slice avec les quatre étapes **Détails → Contenu → Autorisations → Vérification**. Les publications externes utilisent un espace de noms de workspace chiffré séparé. Les projections nettoyées suppriment les propriétés privées du frontmatter, neutralisent les liens vers les notes exclues et omettent les inclusions exclues. Les autorisations Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV et S3 sont une protection supplémentaire, jamais un substitut aux rôles chiffrés. La diffusion publique reste bloquée jusqu’à ce que l’audit crypto indépendant et des preuves réelles sur deux appareils Android/iOS soient enregistrés.

Dernière vérification : 2026-08-20

Plainva conserve le vault sous forme de fichiers lisibles sur l’appareil et stocke sa copie cloud comme objets chiffrés opaques. Après avoir connecté un compte, ouvrez **Paramètres → votre vault → Sécurité et partage**.

Sur mobile, la section indique d'abord l'état réel de ce vault : **Sur cet appareil uniquement** sans connexion cloud, **Cette connexion n'est pas chiffrée** pour un vault cloud ordinaire — **Configurer le chiffrement** y déroule les mêmes trois étapes que sur ordinateur (identité → fichier de récupération et code → activation avec une progression reprenable) — ou les étapes d'adhésion dès que la connexion porte un espace de travail chiffré.

## Configuration

1. Choisissez les noms du propriétaire et de l’appareil. Les clés restent dans le trousseau système ou, s’il est indisponible, sous une phrase secrète locale.
2. Enregistrez le fichier `.pvrecovery` et conservez le code affiché séparément. Chaque bloc porte un numéro de groupe visible ; saisissez les valeurs des deux groupes surlignés pour confirmer que la sauvegarde est lisible. Les deux parties sont nécessaires et ne contiennent aucun identifiant cloud.
3. Activez l’espace. Plainva publie la politique signée et chiffre tous les fichiers dans `.pvws/`. Le vault local reste lisible et la migration reprend après une interruption.

L’ancien contenu en clair reste à côté de `.pvws/` pendant la migration. Il ne peut être supprimé explicitement qu’à l’état **Protégé** ; les fichiers locaux ne sont jamais supprimés.

## Au quotidien

Les modifications hors ligne restent dans une file d’attente durable. Chaque modification est signée ; une suppression distante seule n’efface jamais un fichier local, alors qu’une pierre tombale signée le peut. Les modifications parallèles hors ligne sont conservées sous forme de copies `.CONFLICT-…`. **Verrouiller** retire les clés du workspace de la session en cours ; **Déverrouiller** utilise le trousseau système ou la phrase secrète locale.

## Appareils et récupération

Pour ajouter **votre propre** deuxième appareil, ouvrez **Appareils et récupération → Appareils → Ajouter un autre appareil** : Plainva affiche un code d’invitation lié à votre propre appartenance — il ne crée **pas** de nouveau membre. Collez-le sur le deuxième appareil (**Sécurité et partage → rejoindre**) et approuvez-le sur un appareil déjà membre ; comparez d’abord l’empreinte sur les deux appareils. Pour intégrer plutôt une autre personne, utilisez **Partager avec d’autres → Membres → Inviter une personne** (voir ci-dessous). Un appareil retiré ne peut plus signer de nouvelles modifications valides. L’invitation et la demande d’appairage d’un appareil qui rejoint s’affichent aussi sous forme de codes QR scannables — sur mobile, **Scanner l’invitation** lit un code avec l’appareil photo au lieu de coller du texte.

Supprimer un appareil ou un membre propose deux coûts, et le téléphone propose lui aussi les deux. **Seulement à venir** met fin immédiatement à l’accès aux nouvelles clés et va vite. **Tout rechiffrer** réécrit aussi tout ce qui est déjà chiffré ; c’est un travail long, qui continue en arrière-plan et reprend après un redémarrage — la carte d’état compte les objets pendant l’exécution. Aucune des deux options ne peut reprendre ce que l’autre partie a déjà téléchargé, c’est pourquoi la question le précise avant que vous ne fassiez votre choix. Vous ne pouvez jamais supprimer l’appareil que vous avez en main : cela vous en exclurait, avec pour seul recours le paquet de récupération.

La récupération se trouve sous **Appareils et récupération → Récupération**, répartie entre **État actuel** (un paquet de récupération est-il enregistré, et l’empreinte de l’espace) et le **Processus de récupération**. Si tous les appareils sont perdus, choisissez-y **Restaurer l’accès** et ouvrez le fichier `.pvrecovery` avec son code conservé séparément ; Plainva crée un nouvel appareil propriétaire, peut révoquer les appareils perdus et ne réécrit pas les objets de contenu. **Renouveler la récupération** remplace l’ancien jeu de récupération via une chaîne d’ancrage à double signature. Conservez de nouveau le nouveau fichier et le code séparément ; l’ancien jeu est ensuite invalide. Plainva pose la question avant, car le fichier que vous avez en main cesse de fonctionner à cet instant.

## Membres, rôles et slices

Les propriétaires et administrateurs peuvent inviter des membres, créer des groupes et limiter un rôle à tout l’espace, un slice ou un objet. Editor peut modifier, Commenter commenter, Reader seulement lire et Contributor seulement créer dans sa portée. Le contrôle s’applique avant l’écriture locale et avant la signature, y compris aux imports, restaurations, automatisations et actions IA.

La propriété peut être transférée à un autre membre actif. Ouvrez **Partager avec d’autres → Membres** (sur mobile : la section **Team**) et choisissez **Transférer la propriété** à côté de cette personne. Cette action nécessite le fichier de récupération actuel et son code, car la propriété et le jeu de récupération sont liés : Plainva crée d’abord un paquet de récupération de remplacement et ne le transmet qu’après que vous l’avez enregistré. Donnez ce fichier et le nouveau code au nouveau propriétaire par des canaux séparés — vous devenez Admin, et cette personne devient ensuite la seule Owner.

Un slice couvre un dossier, une sélection ou une règle dynamique sur chemin, type, tags et propriétés. Vérifiez toujours **Aperçu** avant publication. Les objets non autorisés ne sont ni matérialisés ni ajoutés à la recherche, au graphe ou aux aperçus.

## Commentaires, versions et quarantaine

Commenter obtient un éditeur en lecture seule avec une zone de commentaires. Les commentaires et les marqueurs de résolution sont eux-mêmes des objets chiffrés et signés du workspace. **Historique des versions** lit les révisions chiffrées du workspace et restaure une révision plus ancienne comme nouvelle modification signée ou comme copie.

Les artefacts distants invalides sont isolés individuellement sous **Intégrité et forks locaux**. Vous pouvez les réessayer, exporter leur ciphertext, marquer un artefact réparé en externe comme réparé, ou l’ignorer délibérément. Un fichier invalide ne bloque pas le reste de la synchronisation valide, et une absence distante seule ne vaut jamais suppression. Une modification apportée par un programme local sans droit d’écriture est conservée comme une copie de fork privée.

## Supprimer correctement un vault chiffré

Lorsque vous n’avez plus besoin d’un vault chiffré, mettez-le hors service dans Plainva **avant** de supprimer le dossier cloud. L’ordre compte : la protection fail-closed maintient la synchronisation arrêtée si la copie cloud disparaît alors que Plainva attend encore une connexion chiffrée — cela vous protège d’un attaquant qui retirerait le chiffrement pour forcer le texte en clair.

1. Ouvrez **Paramètres → votre vault → Security & Sharing**.
2. Dans l’aperçu, dans la carte **Chiffrement**, choisissez **Supprimer la connexion au cloud chiffré**. Plainva efface les clés locales et les données du workspace sur cet appareil et rouvre le vault comme un vault normal. (Ceci est local à l’appareil : la copie cloud reste chiffrée. Pour la récupérer en texte clair, la voie est **Lever le chiffrement** — voir le paragraphe ci-dessous.)
3. Ce n’est qu’ensuite que vous supprimez le dossier cloud (les objets `.pvws/`) chez votre fournisseur si vous voulez vous en débarrasser. Plainva ne supprime pas pour vous les objets chiffrés du cloud.

Sur mobile, la même étape se trouve au même endroit, à une différence près : vous la confirmez en saisissant le nom du vault. Tout le reste est identique — les clés locales et les données du workspace disparaissent, le vault se rouvre comme un vault normal, et les objets chiffrés dans le cloud restent jusqu’à ce que vous les supprimiez vous-même. Cela fonctionne sans connexion, car rien de tout cela ne se passe à distance.

Pour au contraire **mettre fin au chiffrement entièrement et conserver le vault dans le cloud sous forme de fichiers ordinaires**, choisissez **Supprimer le chiffrement** dans la même carte **Chiffrement** : Plainva rouvre le vault comme un vault cloud normal et téléverse à nouveau toutes vos notes vers le même cloud sous forme de fichiers en clair, puis cesse de chiffrer. Les fichiers locaux ne sont jamais modifiés et rien n’est supprimé ; l’ancien dossier chiffré `.pvws/` reste jusqu’à ce que vous le supprimiez chez votre fournisseur (Plainva ne peut pas retirer pour vous ces objets immuables). Confirmez d’abord l’avertissement — les notes quittent le stockage chiffré en texte clair.

Si vous avez déjà supprimé la copie cloud et que la synchronisation échoue désormais avec une erreur « espace de travail manquant » ou « manifeste manquant », la solution est la même réinitialisation, proposée là où l’erreur apparaît :

- Pour un **workspace** chiffré, ouvrez **Security & Sharing**. Le statut affiche une erreur avec une note de récupération ; dans la carte **Chiffrement**, choisissez **Supprimer la connexion au cloud chiffré** pour réinitialiser le workspace sur cet appareil afin que la synchronisation refonctionne.
- Pour une **connexion de synchronisation** à contenu chiffré, cliquez sur le statut de synchronisation pour ouvrir la boîte de dialogue d’erreur et choisissez **Réinitialiser le chiffrement**. Ce bouton n’apparaît que lorsque les données de chiffrement distantes sont manquantes ou invalides.

Les deux actions sont explicites et confirmées. Plainva ne rétrograde jamais silencieusement une connexion chiffrée en texte clair, et aucune des deux actions ne supprime de fichiers locaux. Si le cloud contient encore du contenu chiffré que vous voulez réellement, annulez plutôt — réinitialiser reprendrait la synchronisation en clair.

Supprimer un vault avec **Oublier les données d’application** (Splash → retirer un vault → oublier aussi les données d’application) efface aussi ces marqueurs de chiffrement, de sorte qu’un vault retiré ainsi ne laisse rien qui pourrait bloquer une reconnexion ultérieure.
