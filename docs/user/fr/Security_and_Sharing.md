# Sécurité et partage

## Centre de sécurité, rechiffrement et slices publiés

Le tableau reprend les cartes récupération, appareils et équipe des maquettes ; une action ouvre le vault, la connexion, la configuration ou le déverrouillage requis. Une révocation peut lancer un rechiffrement complet reprenable. Créez un Vault Slice via **Détails → Contenu → Autorisations → Vérification**. Les publications externes occupent un workspace chiffré séparé ; la projection nettoyée retire propriétés privées, liens exclus et inclusions. La diffusion publique attend l’audit crypto indépendant et les essais Android/iOS réels.

Dernière vérification : 2026-07-22

Plainva conserve le vault sous forme de fichiers lisibles sur l’appareil et stocke sa copie cloud comme objets chiffrés opaques. Après avoir connecté un compte, ouvrez **Paramètres → votre vault → Sécurité et partage**.

## Configuration

1. Choisissez les noms du propriétaire et de l’appareil. Les clés restent dans le trousseau système ou, s’il est indisponible, sous une phrase secrète locale.
2. Enregistrez le fichier `.pvrecovery` et conservez le code affiché séparément. Chaque bloc porte un numéro de groupe visible ; saisissez les valeurs des deux groupes surlignés pour confirmer que la sauvegarde est lisible. Les deux parties sont nécessaires et ne contiennent aucun identifiant cloud.
3. Activez l’espace. Plainva publie la politique signée et chiffre tous les fichiers dans `.pvws/`. Le vault local reste lisible et la migration reprend après une interruption.

L’ancien contenu en clair reste à côté de `.pvws/` pendant la migration. Il ne peut être supprimé explicitement qu’à l’état **Protégé** ; les fichiers locaux ne sont jamais supprimés.

Les modifications hors ligne restent dans une file durable. Les suppressions exigent des tombstones signés et les modifications parallèles sont conservées dans des copies `.CONFLICT-…`.

## Appareils et récupération

Un nouvel appareil mobile crée une demande QR/code. Saisissez le code court sur un ordinateur déjà approuvé et comparez les empreintes avant validation. Un appareil retiré ne peut plus signer de nouvelles modifications. Si tous les appareils sont perdus, **Restaurer l’accès** crée un nouvel appareil propriétaire depuis le fichier `.pvrecovery` et son code séparé, sans réécrire le contenu. **Renouveler la récupération** ancre une nouvelle identité à double signature et invalide l’ancien jeu.

## Membres, rôles et slices

Les propriétaires et administrateurs peuvent inviter des membres, créer des groupes et limiter un rôle à tout l’espace, un slice ou un objet. Editor peut modifier, Commenter commenter, Reader seulement lire et Contributor seulement créer dans sa portée. Le contrôle s’applique avant l’écriture locale et avant la signature, y compris aux imports, restaurations, automatisations et actions IA.

Un slice couvre un dossier, une sélection ou une règle dynamique sur chemin, type, tags et propriétés. Vérifiez toujours **Aperçu** avant publication. Les objets non autorisés ne sont ni matérialisés ni ajoutés à la recherche, au graphe ou aux aperçus.

## Commentaires, versions et quarantaine

Commentaires et marqueurs de résolution sont chiffrés et signés. **Historique des versions** lit les révisions chiffrées et restaure une version comme nouvelle modification signée ou copie. Un artefact distant invalide est isolé sous **Intégrité et forks locaux** : réessayez, exportez le ciphertext, marquez-le réparé ou ignorez-le. Il ne bloque pas le reste de la synchronisation et une absence distante ne vaut jamais suppression.
