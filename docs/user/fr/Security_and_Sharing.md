# Sécurité et partage

Dernière vérification : 2026-07-22

Plainva conserve le vault sous forme de fichiers lisibles sur l’appareil et stocke sa copie cloud comme objets chiffrés opaques. Après avoir connecté un compte, ouvrez **Paramètres → votre vault → Sécurité et partage**.

## Configuration

1. Choisissez les noms du propriétaire et de l’appareil. Les clés restent dans le trousseau système ou, s’il est indisponible, sous une phrase secrète locale.
2. Enregistrez le fichier `.pvrecovery`, conservez le code séparément et saisissez les deux groupes demandés. Les deux parties sont nécessaires et ne contiennent aucun identifiant cloud.
3. Activez l’espace. Plainva publie la politique signée et chiffre tous les fichiers dans `.pvws/`. Le vault local reste lisible et la migration reprend après une interruption.

L’ancien contenu en clair reste à côté de `.pvws/` pendant la migration. Il ne peut être supprimé explicitement qu’à l’état **Protégé** ; les fichiers locaux ne sont jamais supprimés.

Les modifications hors ligne restent dans une file durable. Les suppressions exigent des tombstones signés et les modifications parallèles sont conservées dans des copies `.CONFLICT-…`. Appareils supplémentaires, restauration, équipes et slices arriveront dans les phases suivantes.
