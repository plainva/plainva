# Capture d'e-mails

Dernière mise à jour : 2026-07-20

Plainva peut lire votre boîte aux lettres pour faire passer la connaissance de vos e-mails dans votre vault, et — depuis la 0.4.0 — aussi rédiger et envoyer des e-mails. L'accent reste sur la **capture** de messages sous forme de notes ; une boîte connectée via **IMAP** n'est lue que pour la capture (rien n'y change, pas même les marqueurs de lecture) tant que vous ne configurez pas l'envoi.

> **Expérimental.** Le client de messagerie communique avec de vrais comptes externes (IMAP/SMTP et Microsoft) qu'il n'est pas possible d'exercer dans les tests automatisés de Plainva. Il fonctionne et est utilisé quotidiennement, mais traitez-le comme un aperçu : gardez une sauvegarde, et merci de signaler tout ce qui semble anormal.

## Connecter une boîte aux lettres

**Paramètres → Vault → Comptes cloud → Connecter un compte…** et choisissez le fournisseur :

- **Microsoft** — pour Outlook.com et Microsoft 365 : cochez **E-mail** à l'étape des services (sur demande avec **Fichiers** et **Calendrier et tâches** — un compte, une connexion) et connectez-vous directement dans le navigateur, sans mot de passe d'application ni IMAP. Plainva utilise l'enregistrement d'application central de Plainva (vous pouvez éventuellement fournir votre propre ID d'application dans les détails du compte). Lire, capturer et **envoyer directement** passent tous par la connexion Microsoft.
- **Serveur e-mail (IMAP)** — pour tout autre fournisseur : hôte, port et un **mot de passe d'application**. Pour Gmail, c'est `imap.gmail.com`, port `993`, avec un mot de passe d'application depuis [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (nécessite l'authentification à deux facteurs) — pas d'OAuth, pas de vérification ; l'assistant le signale lui-même pour les adresses Gmail. Des préréglages tout prêts sont disponibles pour **web.de** et **GMX**. Ajoutez un hôte SMTP pour envoyer directement.

Connecter le compte valide l'identification avant que quoi que ce soit ne soit enregistré ; les identifiants vont dans le trousseau de votre système d'exploitation. Les boîtes connectées et les réglages de capture se trouvent ensuite dans la zone **E-mail** : le réglage **Dossier e-mail** choisit où les e-mails capturés sont stockés (par défaut `Mail`).

## Lire les e-mails

Ouvrez l'onglet e-mail depuis la barre d'actions à gauche (icône enveloppe) ou la palette de commandes (**Ouvrir les e-mails**). La liste montre votre boîte de réception du plus récent au plus ancien (non lus en gras, **Charger plus** charge la suite). Sélectionner un message l'ouvre dans une **visionneuse cloisonnée** :

- **Le contenu distant est bloqué** — pixels de suivi, images distantes et chargeurs de style sont retirés et comptés (« Contenu distant bloqué (n) »). Seules les images intégrées s'affichent. **Afficher les images**, à côté du compteur, révèle une fois les images https d'un message ; **Toujours charger les images distantes**, dans les paramètres e-mail, transforme cela en option permanente. Attention : charger les images distantes permet à l'expéditeur de voir votre adresse IP et le moment où vous avez ouvert le message — c'est pourquoi le blocage est activé par défaut.
- Les liens apparaissent en texte brut et ne sont pas cliquables dans la visionneuse.
- Les scripts et les formulaires ne s'exécutent jamais. Le message est affiché dans un cadre isolé avec une politique de contenu stricte.

Les pièces jointes sont listées avec leur nom et leur taille ; l'original `.eml` (voir plus bas) les contient en entier.

## Faire entrer un message dans le vault

Trois boutons sur chaque message :

- **Enregistrer comme note** — crée une note dans votre dossier e-mail (`AAAA-MM-JJ Objet.md`) avec l'expéditeur et la date dans le frontmatter et le corps en texte brut sous le titre de l'objet. Capturer le même message deux fois ouvre la note existante au lieu de la dupliquer.
- **+ .eml** — stocke en plus l'original brut à côté de la note et le lie. Le `.eml` contient tout, y compris les pièces jointes, et s'ouvre dans n'importe quel programme de messagerie.
- **→ Tâche** — crée une entrée dans votre [base de tâches par défaut](Tasks.md) avec l'objet comme titre, la date du jour comme échéance et le statut ouvert préremplis.

## Rédiger et envoyer

Dès qu'un compte peut envoyer — un compte **Microsoft**, ou un compte **IMAP** avec un **hôte SMTP** configuré —, vous pouvez écrire et envoyer des e-mails depuis Plainva :

- **Rédiger** (dans l'onglet e-mail) ouvre une fenêtre flottante avec des lignes étiquetées **De / À / Cc / Cci**. Tapez une adresse et appuyez sur Entrée ou une virgule pour la transformer en puce ; **Cc/Cci** s'affichent à la demande. Le corps est un éditeur Markdown avec une barre d'outils de mise en forme et un menu de commandes « / ».
- **Répondre**, **Répondre à tous** et **Transférer** sur n'importe quel message ouvrent la même fenêtre avec l'original cité et les destinataires préremplis ; un transfert emporte les pièces jointes.
- **Envoyer** part par SMTP (comptes IMAP) ou Microsoft Graph (comptes Microsoft).
- **Cette note par e-mail** (menu `⋮` d'une note ou palette de commandes) démarre un message avec la note actuelle en pièce jointe, ou intégrée en texte.

## Transmettre une note sans le client de messagerie

Vous n'êtes pas obligé d'envoyer depuis Plainva. Ceci fonctionne sur n'importe quelle note et ne nécessite aucun SMTP :

- **Répondre comme note** (sur un message) : crée une note adressée à l'expéditeur (`to:` dans le frontmatter) avec l'original cité — rédigez votre réponse dans Plainva.
- **Enregistrer la note comme brouillon dans la boîte** (palette de commandes, sur n'importe quelle note ouverte) : stocke la note comme **brouillon dans votre propre boîte aux lettres** via IMAP — choisissez le compte, le destinataire et le dossier des brouillons, puis ouvrez votre programme de messagerie habituel, relisez et envoyez depuis là-bas. La mise en forme est préservée.
- **Envoyer la note par e-mail (mailto)** (palette de commandes) : ouvre votre programme de messagerie par défaut avec la note en texte brut (les notes longues sont raccourcies).
- **Copier la note comme texte d'e-mail** (palette de commandes) : place la note dans le presse-papiers avec sa mise en forme — collez-la dans n'importe quel éditeur de message.
