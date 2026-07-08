# Compatibilité de synchronisation de Plainva

Dernière mise à jour : 2026-07-04 (mise à jour après les intégrations OneDrive, Dropbox et S3)

Plainva synchronise les vaults via des adaptateurs de synchronisation interchangeables. Cette page montre quels services vous pouvez utiliser aujourd'hui — directement intégrés, via le protocole WebDAV, ou via le propre client de synchronisation de bureau du fournisseur.

## Directement intégrés

| Fournisseur | Statut | Remarques |
|---|---|---|
| Dossier local | Disponible | Aucune configuration nécessaire ; les modifications externes (p. ex. par d'autres outils de synchronisation) sont détectées automatiquement. |
| WebDAV / Nextcloud | Disponible, vérifié avec Nextcloud | URL du serveur, nom d'utilisateur et (recommandé) un mot de passe d'application. |
| Google Drive | Disponible (identifiants BYO) | Nécessite votre propre projet Google Cloud, voir le [guide Google Drive BYO](Google_Drive_BYO_Guide.md). |
| OneDrive | Disponible (nouveau 2026-07-04, acceptation native en attente) | Connexion via navigateur (PKCE, sans secret). Jusqu'à ce que Plainva fournisse sa propre inscription d'application, vous avez besoin de votre propre (gratuite) inscription d'application Entra : type « Applications mobiles et de bureau », URI de redirection `http://localhost`. |
| Dropbox | Disponible (nouveau 2026-07-04, acceptation native en attente) | Connexion via navigateur (PKCE, sans secret). Jusqu'à ce que Plainva fournisse sa propre application, vous avez besoin de votre propre (gratuite) application Dropbox : accès Full Dropbox, URI de redirection exactement `http://127.0.0.1:41953`. |
| Stockage objet compatible S3 | Disponible (nouveau 2026-07-04, acceptation native en attente) | AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner et d'autres — juste un endpoint, un bucket, une région et une paire de clés API ; pas de connexion via navigateur. |

## Services utilisables via WebDAV

L'adaptateur WebDAV parle le WebDAV standard, donc les services suivants devraient fonctionner, entre autres. Ils n'ont pas encore été vérifiés individuellement — les retours sont les bienvenus. Les adresses sont des modèles typiques ; vérifiez-les dans la documentation de votre fournisseur et utilisez un mot de passe d'application au lieu de votre mot de passe principal dès que possible.

| Service | Adresse WebDAV typique |
|---|---|
| Nextcloud (auto-hébergé ou chez un fournisseur) | `https://<server>/remote.php/dav/files/<user>/` |
| ownCloud | `https://<server>/remote.php/dav/files/<user>/` |
| Koofr | `https://app.koofr.net/dav/Koofr` |
| Strato HiDrive | `https://webdav.hidrive.strato.com` |
| MagentaCLOUD (Telekom) | `https://magentacloud.de/remote.php/dav/files/<user>/` |
| GMX Mediacenter | `https://webdav.mc.gmx.net` |
| WEB.DE online storage | `https://webdav.smartdrive.web.de` |
| Hetzner Storage Box | `https://<user>.your-storagebox.de` |
| Synology NAS | Activez le paquet WebDAV Server, puis `https://<nas>:5006` |
| QNAP NAS | Activez WebDAV dans le système ; adresse selon la documentation QNAP |
| Seafile | Activez SeafDAV, puis `https://<server>/seafdav` |

## Via le client de synchronisation de bureau du fournisseur (dossier local)

En attendant l'arrivée des intégrations natives, vous pouvez utiliser n'importe quel service dont le client de bureau maintient un dossier local synchronisé. Plainva traite alors le vault comme un dossier local et détecte automatiquement les modifications externes.

**Important :** réglez le dossier du vault sur « toujours conserver sur cet appareil » / « disponible hors ligne ». Les fichiers d'espace réservé en ligne uniquement (Files On-Demand, en ligne uniquement, mode streaming) peuvent perturber l'indexation et la synchronisation.

- **OneDrive** (intégration à l'Explorateur ; désactivez Files On-Demand pour le dossier du vault)
- **Dropbox** (client de bureau ; évitez « en ligne uniquement » pour le dossier du vault)
- **Google Drive for Desktop** (mode « Miroir » plutôt que « Streaming » pour le dossier du vault)
- **iCloud Drive** (iCloud pour Windows ou macOS ; réglez le dossier sur « Garder téléchargé »)
- **Syncthing / Resilio Sync** (P2P, sans aucun fournisseur cloud)

## Remarque sur les nouvelles intégrations (2026-07-04)

OneDrive, Dropbox et le stockage compatible S3 sont directement intégrés depuis le 2026-07-04 (voir le tableau ci-dessus) — plus tôt que prévu dans l'échelonnement du plan directeur (§13.3). Dès que Plainva fournira des inscriptions d'application centrales pour OneDrive et Dropbox, l'étape avec votre propre ID client ou clé d'application disparaîtra ; les champs seront alors préremplis. La voie du client de synchronisation de bureau (voir ci-dessus) reste disponible comme alternative.

## Délibérément non prévu

- **iCloud comme intégration API :** Apple n'offre pas d'API tierce officielle pour iCloud Drive. Utilisez plutôt le dossier iCloud local (voir ci-dessus).
- **Proton Drive / Mega :** pas d'API officielle, ou seulement des API difficiles à intégrer (chiffrement E2E, SDK C++). Reste sous observation.
- **Liste de surveillance** (sur demande) : pCloud, Box, Filen, SFTP.
