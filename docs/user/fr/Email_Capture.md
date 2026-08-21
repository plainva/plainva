# Capture d'e-mails

Dernière mise à jour : 2026-08-21

Plainva peut lire votre boîte aux lettres pour faire passer la connaissance de vos e-mails dans votre vault, et — depuis la 0.4.0 — aussi rédiger et envoyer des e-mails. L'accent reste sur la **capture** de messages sous forme de notes ; une boîte connectée via **IMAP** n'est lue que pour la capture (rien n'y change, pas même les marqueurs de lecture) tant que vous ne configurez pas l'envoi.

> **Expérimental.** Le client de messagerie communique avec de vrais comptes externes (IMAP/SMTP et Microsoft) qu'il n'est pas possible d'exercer dans les tests automatisés de Plainva. Il fonctionne et est utilisé quotidiennement, mais traitez-le comme un aperçu : gardez une sauvegarde, et merci de signaler tout ce qui semble anormal.

## Connecter une boîte aux lettres

**Paramètres → Vault → Comptes cloud → Connecter un compte…** et choisissez le fournisseur :

- **Microsoft** — pour Outlook.com et Microsoft 365 : cochez **E-mail** à l'étape des services (sur demande avec **Fichiers** et **Calendrier et tâches** — un compte, une connexion) et connectez-vous directement dans le navigateur, sans mot de passe d'application ni IMAP. Plainva utilise l'enregistrement d'application central de Plainva (vous pouvez éventuellement fournir votre propre ID d'application dans les détails du compte). Lire, capturer et **envoyer directement** passent tous par la connexion Microsoft.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — des tuiles dédiées : adresse e-mail plus un **mot de passe d'application**, les serveurs sont déjà renseignés (la plupart de ces tuiles permettent aussi de cocher **Calendrier et tâches** à la même étape — un seul mot de passe d'application pour tous les services choisis). L'assistant renvoie à chaque fois vers le guide officiel du fournisseur pour créer le mot de passe d'application.
- **Serveur e-mail (IMAP)** — pour tout autre fournisseur : hôte, port et un mot de passe ou un **mot de passe d'application**. Des préréglages tout prêts couvrent des fournisseurs du monde entier — de **web.de**/**GMX** et **T-Online** en passant par **Orange**, **Libero**, **WP**, **Seznam** et **Comcast** jusqu'à **QQ Mail**, **NetEase**, **Naver** et **Yahoo! JAPAN** ; la liste **Fournisseur** propose pour cela une ligne de recherche, et taper votre adresse sélectionne automatiquement le préréglage correspondant. Quand un fournisseur a des particularités, l'assistant le signale juste sous le formulaire : certains demandent un **mot de passe d'application** ou un **code d'autorisation** au lieu du mot de passe du compte, d'autres nécessitent d'abord d'activer IMAP dans les paramètres du fournisseur — chacun avec un lien vers le guide officiel. Pour Gmail, c'est `imap.gmail.com`, port `993`, avec un mot de passe d'application depuis [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (nécessite l'authentification à deux facteurs) — pas d'OAuth, pas de vérification ; l'assistant le signale lui-même pour les adresses Gmail. **Les boîtes Outlook.com** ne peuvent plus se connecter par IMAP avec mot de passe (Microsoft a désactivé cette voie) — le préréglage renvoie vers la tuile **Microsoft**. **Proton Mail** ne fonctionne que via le Proton Mail Bridge local et payant (son propre préréglage). Ajoutez un hôte SMTP pour envoyer directement.

Connecter le compte valide l'identification avant que quoi que ce soit ne soit enregistré ; les identifiants vont dans le trousseau de votre système d'exploitation. Les boîtes connectées et les réglages de capture se trouvent ensuite dans la zone **E-mail** : le réglage **Dossier e-mail** choisit où les e-mails capturés sont stockés (par défaut `Mail`).

**Se connecter sur un deuxième appareil.** Lorsqu'une boîte aux lettres arrive par la synchronisation des réglages, son mot de passe ne suit pas automatiquement — les connexions ne sont transférées que si vous activez vous-même la synchronisation des identifiants. Une telle boîte affiche le bouton **Se connecter sur cet appareil** dans la zone **E-mail** : saisissez le mot de passe, Plainva le vérifie auprès du fournisseur avant de l'enregistrer dans le trousseau. Pour une boîte Microsoft, le même bouton mène à **Comptes cloud**, car la connexion s'y fait dans le navigateur. Si cela laisse la liste des messages vide, le même avis et le même bouton y apparaissent aussi — vous n'êtes pas obligé d'aller chercher les paramètres vous-même.

## Lire les e-mails

Ouvrez l'onglet e-mail depuis la barre d'actions à gauche (icône enveloppe) ou la palette de commandes (**Ouvrir les e-mails**). La liste montre votre boîte de réception du plus récent au plus ancien (non lus en gras, **Charger plus** charge la suite). Sélectionner un message l'ouvre dans une **visionneuse cloisonnée** :

- **Le contenu distant est bloqué** — pixels de suivi, images distantes et chargeurs de style sont retirés et comptés (« Contenu distant bloqué (n) »). Seules les images intégrées s'affichent. **Afficher les images**, à côté du compteur, révèle une fois les images https d'un message ; **Toujours charger les images distantes**, dans les paramètres e-mail, transforme cela en option permanente. Attention : charger les images distantes permet à l'expéditeur de voir votre adresse IP et le moment où vous avez ouvert le message — c'est pourquoi le blocage est activé par défaut.
- **Lu veut dire lu** — un message que vous ouvrez est considéré comme lu au bout de trois secondes. Si vous le marquez **non lu à la main**, il reste non lu tant qu'il est ouvert ; le décompte ne repart que lorsque vous le quittez et l'ouvrez de nouveau. Pareil sur les deux appareils — auparavant, la minuterie du bureau annulait le marquage trois secondes plus tard, et le téléphone marquait un message comme lu dès son ouverture.
- Les liens apparaissent en texte brut et ne sont pas cliquables dans la visionneuse.
- Les scripts et les formulaires ne s'exécutent jamais. Le message est affiché dans un cadre isolé avec une politique de contenu stricte.
- **Les messages larges sont adaptés** — beaucoup de lettres d’information sont conçues pour une largeur de colonne fixe et ne peuvent pas être redisposées. Plutôt que de couper un tel message sur le bord gauche, Plainva le réduit à la largeur du cadre ; sur le téléphone, le cadre grandit avec lui, et tu fais défiler la page comme d’habitude.
- **Conversations** — l'interrupteur au-dessus de la liste (icône bulle) regroupe les messages liés en une seule ligne : participants, nombre et le sujet par lequel l'échange a commencé. Un appui la déplie ; chaque message garde son dossier et l'indique quand ce n'est pas celui ouvert. Plainva lit aussi **Envoyés** pour cela, afin que tes propres réponses fassent partie de la conversation. Désactivé, tout reste comme avant — une liste plate — et le choix est retenu par coffre, sur les deux appareils. Le regroupement suit la chaîne de réponses des messages (chez Microsoft, la conversation que le fournisseur tient lui-même) ; ce n'est que si une réponse ne transporte pas cette chaîne que le sujet prend le relais, et seulement pour une réponse reconnaissable (« Re: », « Tr: ») dans les 30 jours, pour que deux messages qui partagent seulement un sujet ne fusionnent pas.
- **Toutes les boîtes de réception** — la première entrée au-dessus de la liste des dossiers affiche les boîtes de réception de **tous** les comptes en une seule liste, les plus récents d'abord, et chaque ligne nomme le compte auquel elle appartient. Lu/non lu et le marquage fonctionnent aussi ici ; le déplacement et la suppression restent propres à chaque boîte, car chaque compte a son propre dossier cible — ouvre le message et tu agis dans sa boîte. Un compte dont la connexion manque est nommé et ne vide pas la liste des autres.
- **Sélectionner plusieurs messages** — Ctrl+clic (macOS : ⌘+clic) sélectionne des messages isolés, Maj+clic une plage ; dans la vue conversations, un Ctrl+clic sur la conversation sélectionne tout l'échange, et chaque message y conserve son propre dossier.

Les pièces jointes sont listées avec leur nom et leur taille ; l'original `.eml` (voir plus bas) les contient en entier.

Lorsque tu ouvres un dossier déjà ouvert auparavant, la liste apparaît **immédiatement** depuis le cache local pendant que l'actualisation se fait en arrière-plan ; un indice dit « mise à jour » jusqu'à ce qu'elle arrive — seul ce que le serveur a envoyé est confirmé. Il en va de même pour un message déjà lu. Sur le téléphone, le message **le plus récent** d'un dossier est préchargé en arrière-plan : il s'ouvre alors sans attente, même si tu ne l'avais jamais ouvert.

Sur le bureau, les trois colonnes (dossiers · liste · lecteur) se redimensionnent en tirant sur les séparateurs ; les largeurs sont mémorisées **par coffre** et survivent à un redémarrage. Chaque colonne conserve une largeur minimale, pour que le lecteur ne puisse jamais être évincé.

Lorsqu'une actualisation échoue — pas de réseau, ou le fournisseur limite les requêtes —, la liste continue d'afficher la dernière copie vue sur cet appareil, avec une mention le signalant, plutôt qu'un volet vide. Un message déjà lu reste lisible de la même façon. Ce n'est jamais qu'un cache : le serveur fait toujours foi, rien ici n'est l'unique copie de quoi que ce soit, et supprimer le vault le supprime aussi.

## Faire entrer un message dans le vault

Trois boutons sur chaque message :

- **Enregistrer comme note** — crée une note dans votre dossier e-mail (`AAAA-MM-JJ Objet.md`) avec l'expéditeur et la date dans le frontmatter et le corps en texte brut sous le titre de l'objet. Capturer le même message deux fois ouvre la note existante au lieu de la dupliquer.
- **+ .eml** — stocke en plus l'original brut à côté de la note et le lie. Le `.eml` contient tout, y compris les pièces jointes, et s'ouvre dans n'importe quel programme de messagerie. Si la note existe déjà, la copie brute y est ajoutée — sauf si une copie est déjà liée.
- **→ Tâche** — crée une entrée dans votre [base de tâches par défaut](Tasks.md) avec l'objet comme titre, la date du jour comme échéance et le statut ouvert préremplis.

## Rédiger et envoyer

Dès qu'un compte peut envoyer — un compte **Microsoft**, ou un compte **IMAP** avec un **hôte SMTP** configuré —, vous pouvez écrire et envoyer des e-mails depuis Plainva :

- **Rédiger** (dans l'onglet e-mail) ouvre une fenêtre flottante avec des lignes étiquetées **De / À / Cc / Cci**. Tapez une adresse et appuyez sur Entrée ou une virgule pour la transformer en puce ; **Cc/Cci** s'affichent à la demande. Le corps est un éditeur Markdown avec une barre d'outils de mise en forme et un menu de commandes « / ». Un lien `[texte](https://…)` s'affiche comme un lien fini pendant que vous écrivez — les caractères Markdown réapparaissent dès que le curseur y entre, et un clic ouvre la cible dans votre navigateur. À l'envoi, le corps est de toute façon converti en HTML : le destinataire reçoit toujours un vrai lien, quelle que soit son apparence dans la fenêtre.
- **Insérer un modèle…** place un modèle de note dans le corps du message. Les questions du modèle (`{{prompt:…}}`) sont posées **une fois, dans une seule boîte de dialogue**, au lieu de partir telles quelles ; son frontmatter reste dehors — un corps de mail n'en a pas, et le destinataire recevrait sinon du YAML. Si tu annules, rien n'est inséré.
- **Répondre**, **Répondre à tous** et **Transférer** sur n'importe quel message ouvrent la même fenêtre avec l'original cité et les destinataires préremplis ; un transfert emporte les pièces jointes.
- **Envoyer** part par SMTP (comptes IMAP) ou Microsoft Graph (comptes Microsoft).
- **Cette note par e-mail** (menu `⋮` d'une note ou palette de commandes) démarre un message avec la note actuelle en pièce jointe, ou intégrée en texte.

## Transmettre une note sans le client de messagerie

Vous n'êtes pas obligé d'envoyer depuis Plainva. Ceci fonctionne sur n'importe quelle note et ne nécessite aucun SMTP :

- **Répondre comme note** (sur un message) : crée une note adressée à l'expéditeur (`to:` dans le frontmatter) avec l'original cité — rédigez votre réponse dans Plainva.
- **Enregistrer la note comme brouillon dans la boîte** (palette de commandes, sur n'importe quelle note ouverte) : stocke la note comme **brouillon dans votre propre boîte aux lettres** via IMAP — choisissez le compte, le destinataire et le dossier des brouillons, puis ouvrez votre programme de messagerie habituel, relisez et envoyez depuis là-bas. La mise en forme est préservée.
- **Envoyer la note par e-mail (mailto)** (palette de commandes) : ouvre votre programme de messagerie par défaut avec la note en texte brut (les notes longues sont raccourcies).
- **Copier la note comme texte d'e-mail** (palette de commandes) : place la note dans le presse-papiers avec sa mise en forme — collez-la dans n'importe quel éditeur de message.

## Signature et adresses d'expéditeur

Dans **Paramètres → E-mail → Envoi**, chaque boîte aux lettres dispose de deux réglages propres :

- **Signature** — en Markdown, ajoutée sous votre texte lors de la rédaction (et au-dessus d'un original cité ou transféré, là où un lecteur l'attend). Changer d'expéditeur dans la fenêtre de rédaction remplace la signature au lieu d'en empiler une seconde. Le champ utilise le même éditeur que la fenêtre de rédaction : vous voyez donc la signature telle qu'elle sera envoyée.
- **Signature par adresse** — dès que tu as d'autres adresses d'expéditeur, un sélecteur **Signature pour** apparaît au-dessus du champ. « Par défaut (toutes les adresses) » est la signature du compte ; choisis une adresse pour en écrire une rien que pour elle. Les adresses sans signature propre continuent d'utiliser celle par défaut, et changer d'expéditeur pendant la rédaction met la bonne en place — y compris entre deux adresses d'un même compte. Vide le champ d'une adresse et elle revient à la signature par défaut.
- **Adresses d'expéditeur supplémentaires** — une par ligne, p. ex. `Nom <alias@example.org>`. Le champ **De** liste alors des adresses plutôt que des comptes : d'abord celle de la boîte, puis ses alias. Qu'une adresse soit réellement acceptée relève de votre fournisseur — un serveur qui refuse l'envoi sous un alias le dit, et Plainva affiche cette erreur au lieu d'envoyer discrètement sous un autre nom.

## Actions sur la boîte aux lettres

Les étoiles/marqueurs sont synchronisés via IMAP et Microsoft ; **Marqués** affiche la sélection du serveur. Les messages peuvent être déplacés seuls ou en groupe. Hors de la corbeille, **Supprimer** signifie toujours « déplacer vers la corbeille » ; seule la corbeille propose **Supprimer définitivement** après confirmation. Avec Gmail, un déplacement change les libellés et une action dans **Tous les messages** peut toucher le message dans tous ses libellés ; Plainva vous prévient avant l’action.

## Se désabonner et annuler un envoi

Lorsqu'un message porte l'en-tête `List-Unsubscribe`, Plainva affiche un bouton **Se désabonner** dans le lecteur. Ce qui suit est ce que l'**expéditeur** a indiqué : Plainva ne devine rien à partir du corps et ne clique rien à ta place. Une adresse web s'ouvre dans le navigateur après confirmation ; une adresse e-mail arrive dans la fenêtre de rédaction, pour que tu voies ce qui part. Les chemins `http://` non chiffrés sont écartés, car s'y désabonner transmet ton adresse en clair.

**Annuler l'envoi** est un **délai, pas un rappel** : après l'envoi, Plainva attend quelques secondes avant de remettre le message au serveur, et pendant ce temps une notification garde le bouton **Annuler** à portée. Ensuite le message est parti et rien ne l'arrête — aucun logiciel de messagerie ne peut récupérer un message remis. Si tu quittes Plainva à cet instant (sur le téléphone : tu passes à une autre application), l'envoi part **immédiatement** au lieu d'être annulé : un message que tu as demandé à envoyer ne doit pas disparaître parce que l'application est passée en arrière-plan.

## Reporter

Certains courriers ne sont pas urgents sans être réglés pour autant. **Reporter** retire un message de la liste jusqu'à un moment que tu choisis : plus tard aujourd'hui, demain matin, ce week-end ou la semaine prochaine. Sur l'ordinateur, l'entrée se trouve dans le menu contextuel de la ligne ; sur le téléphone, c'est en plus un geste de balayage. Le bouton **Reportés** les fait réapparaître ; de là, **Ramener maintenant** remet un message dans la liste sur-le-champ.

Deux points à dire franchement. D'abord, reporter est un **marqueur propre à Plainva**, pas une fonction du serveur : ni IMAP ni Microsoft ne connaissent cela. Le marqueur voyage avec la synchronisation des réglages, donc un message reporté sur le téléphone se repose aussi sur l'ordinateur — dans un autre logiciel de messagerie, il est simplement dans la boîte de réception. Ensuite, reporter ne masque que la **liste du dossier** où tu l'as fait : la recherche et « Toutes les boîtes » affichent toujours le message. Reporté veut dire « pas dans mes pattes », pas « disparu ».

## Signaler un spam

**Spam** déplace un message vers le dossier spam du compte et, lorsque le serveur le permet, le marque avec le mot-clé `$Junk`. Dans le dossier spam, le même bouton devient **Pas un spam** et ramène le message vers la boîte de réception. Les deux sont disponibles dans le lecteur, dans la sélection multiple et, sur le téléphone, comme action de balayage de la ligne.

En toute franchise : **le seul déplacement n'entraîne pas nécessairement le filtre.** Certains serveurs en tirent un apprentissage, d'autres se contentent d'enregistrer le mot-clé, d'autres encore le refusent. Après l'action, Plainva vous dit ce qui s'est réellement passé — « marqué comme spam et déplacé » ou simplement « déplacé ». Si votre compte n'a aucun dossier spam, Plainva propose de créer un dossier **Junk** plutôt que de pousser du courrier vers un nom de dossier inventé.

## Message d’absence

Un message d’absence a sa place sur le serveur, pas dans un programme qui se trouve être ouvert. Plainva ne le propose donc **que là où il survit à l’extinction de l’ordinateur** — pour les comptes Microsoft et pour les boîtes disposant d’un serveur Sieve (mailbox.org, Fastmail, Nextcloud, Mailcow et d’autres). Lorsqu’une boîte n’a ni l’un ni l’autre, il n’y a pas d’interrupteur, mais une phrase qui l’explique.

Vous le trouverez sous **Paramètres → E-mail**, et sur le téléphone dans la zone des comptes : objet, texte et une période. Sans période, le message reste actif jusqu’à ce que vous le désactiviez ; avec une période, il commence et s’arrête tout seul — même si vous n’ouvrez plus jamais Plainva.

**Vos propres règles de filtrage restent intactes.** Dans un script Sieve, Plainva n’écrit que sa propre section, balisée par `# --- BEGIN PLAINVA`, et laisse tout le reste caractère pour caractère. S’il y trouve une section qu’il ne peut pas lire en toute sécurité, il ne change **rien** et vous le dit.

## Règles

Une règle examine l’expéditeur, le destinataire ou l’objet, puis fait quelque chose : déplacer, marquer comme lu, marquer, signaler comme spam ou mettre à la corbeille. Vous les trouverez sous **Paramètres → E-mail**.

**Et voici le point important :** les règles ne s’exécutent pour l’instant **que lorsque Plainva est ouvert**, et uniquement sur les messages que Plainva a récupérés. Sur le téléphone cela signifie en plus : uniquement lorsque l’application était au premier plan. Une règle ne filtre donc rien pendant que l’ordinateur est éteint — la carte le dit sur place, au lieu de laisser croire à un filtre côté serveur qui n’existe pas encore ici.

Si une règle examine le **texte du message**, elle ne s’applique qu’à l’ouverture du message : le texte ne figure pas dans la liste. Cela aussi est indiqué sur la carte.

**Enregistrer chez le fournisseur.** Si votre boîte dispose d'un serveur Sieve, le bouton **Enregistrer chez le fournisseur** transforme vos règles en filtre côté serveur : il s'applique alors aussi quand Plainva est fermé. Plainva n'écrit que sa propre section balisée et laisse vos règles écrites à la main telles quelles — la même promesse que pour le message d'absence, car les deux partagent cette unique section.

Une règle que votre serveur ne peut pas exprimer — par exemple un test du corps du message sur un serveur dépourvu de l'extension correspondante — reste **locale**, et Plainva vous le dit. Elle n'est volontairement pas envoyée : un script comportant une exigence inconnue du serveur est rejeté **dans son ensemble**, ce qui emporterait aussi le message d'absence.

Les règles Gmail se configurent toujours dans les propres réglages de Google.

**Avec Microsoft**, aucun serveur supplémentaire n'est nécessaire : le même bouton enregistre vos règles comme règles Outlook dans la boîte. Plainva ne remplace que les règles qu'il a créées lui-même et laisse les vôtres intactes — et il les place *après* les vôtres, car une règle écrite à la main était là en premier. Microsoft ne compare qu'avec « contient » : « est exactement », « commence par », « finit par », une règle sur les destinataires en copie et le marquage restent donc locaux, et vous sont signalés.

**Sur le téléphone**, vous créez les règles de bout en bout : dans les réglages de messagerie, touchez une règle et elle s'affiche en **Si** et **Alors** — chaque condition et chaque action est une ligne, et un appui demande le champ, la comparaison et la valeur sur des feuilles distinctes. Ce n'est volontairement pas un formulaire réduit : cinq contrôles côte à côte sur la largeur d'un téléphone, c'est ainsi qu'on saisit une règle de travers. La dernière condition ne peut pas être supprimée — une règle sans condition s'appliquerait à tous les messages.

**Classer comme note** est l'action qu'aucun logiciel de messagerie n'a : la règle enregistre le message comme note dans votre coffre, avec l'expéditeur, la date et le texte — la même capture que le bouton du lecteur, en automatique. Le même courriel deux fois donne la **même** note, et le message reste dans son dossier : c'est une copie qui est classée, rien n'est déplacé. Une règle avec cette action reste **toujours locale**, même sur une boîte capable d'exécuter des règles. C'est voulu : enregistrer le reste de la règle chez le fournisseur laisserait le serveur déplacer le message avant qu'il n'y ait quoi que ce soit à classer.
