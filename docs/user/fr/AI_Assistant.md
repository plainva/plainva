# Assistant IA (Bêta)

Dernière mise à jour : 2026-10-08

Plainva peut répondre à des questions sur vos notes avec un modèle d'IA de votre choix. Il lit votre vault, cite les notes sur lesquelles il s'appuie, ouvre des notes et des vues pour vous et propose des modifications — sous forme de propositions sur une note, de brouillons pour ce qui est nouveau, ou d'un plan que vous confirmez. Il ne modifie jamais une note lui-même. L'assistant est **expérimental** et désactivé jusqu'à ce que vous l'activiez, séparément sur chaque appareil.

## Activer l'IA

Ouvrez **Paramètres → IA & automatisation** (la partie Application) et activez **Utiliser l'IA sur cet appareil**. Sans cet interrupteur, il n'y a ni bouton IA, ni onglet IA, ni compagnon. Rien n'est envoyé nulle part tant que vous n'avez rien demandé.

## Choisir un fournisseur

Plainva n'apporte pas son propre service d'IA : vous utilisez un fournisseur de votre choix, avec votre propre clé. Tous les fournisseurs sont proposés au choix ; Plainva indique leurs conditions et leur politique de conservation, pour que vous décidiez — il n'en exclut aucun.

| Type | Fournisseurs |
|---|---|
| Fournisseurs cloud | Anthropic, OpenAI, Google Gemini |
| Passerelles et serveurs personnels | OpenRouter, tout **serveur compatible OpenAI** |
| Sur cet ordinateur (bureau) | Ollama, LM Studio |
| Sur ce téléphone | Apple (iPhone), Gemini Nano (Android) |

1. Dans **IA & automatisation**, choisissez **Ajouter un fournisseur** et sélectionnez-en un. Chaque entrée porte une brève remarque sur ses conditions — par exemple que l'accès gratuit de Google peut laisser des personnes lire vos saisies.
2. Saisissez la clé avec **Saisir la clé**. La clé va dans le stockage sécurisé de cet appareil ; Plainva ne l'affiche plus jamais — ni à l'IA, ni à l'écran.
3. **Tester la connexion** charge la propre liste de modèles du fournisseur. En cas d'échec, le message indique pourquoi (une clé rejetée, aucune connexion, un modèle inconnu).

Un **serveur compatible OpenAI** s'ajoute par son adresse. Plainva redemande confirmation avant de l'ajouter, dans une fenêtre du système d'exploitation, et n'envoie qu'à l'adresse que vous avez confirmée. Le `http` non chiffré ne fonctionne que pour un serveur sur cet appareil ; tout le reste exige `https`.

Si vous n'avez pas encore de clé : un modèle sur cet ordinateur (Ollama, LM Studio) ne coûte rien, et la console de chaque fournisseur délivre des clés.

**Le modèle du système sur le téléphone.** Sur un iPhone avec Apple Intelligence (à partir de l'iPhone 15 Pro), **Ajouter un fournisseur** propose d'abord **Apple**, sur certains téléphones Android **Gemini Nano**. Il ne demande aucune clé, ne coûte rien et rien ne quitte l'appareil — aucun aperçu ne demande donc avant l'envoi. Sa fenêtre est petite, environ 4 000 jetons pour les notes, la question et la réponse ensemble : moins de notes partent, les échanges précédents sont raccourcis, et il n'utilise aucun outil. La ligne indique s'il est prêt et, sinon, pourquoi — Apple Intelligence désactivée, un appareil qui ne peut pas le faire tourner, un modèle que le système prépare encore ; sous Android, **Charger le modèle** demande au système de le télécharger. Le modèle d'Apple ne parle pas toutes les langues (pas le polonais). Si le profil **Local** le désigne, il écrit aussi les résumés sur le téléphone.

## Modèles et profils

Quatre profils — **Rapide**, **Équilibré**, **Puissant** et **Local** — sont votre attribution de modèles. Choisissez un fournisseur et un modèle pour chacun, depuis la liste du fournisseur ou en saisissant l'identifiant du modèle exactement comme le fournisseur le nomme. **Par défaut pour les nouvelles conversations** décide avec quel profil commence une nouvelle conversation. Plainva ne désigne aucun modèle comme « le meilleur ».

Un cinquième emplacement, **Audio**, contient le modèle qui transcrit les notes vocales ; il n'est jamais celui par défaut d'une conversation.

Un sixième emplacement, **Embeddings**, contient le modèle avec lequel la recherche par sens calcule quand vous choisissez **Fournisseur personnel** sous **Recherche sémantique** — voir [Recherche](Search.md).

## Poser des questions

- **Ordinateur :** le bouton IA dans la barre d'actions, **Ctrl+J** (⌘J sous macOS) ou **Demander à l'IA** dans la palette de commandes ouvre le compagnon — une petite fenêtre au-dessus de votre travail. **Ouvrir en onglet** déplace la même conversation dans l'onglet IA, où vos conversations sont listées.
- **Téléphone :** **Demander à l'IA** dans le menu ⋮ d'une note ouvre la feuille IA au-dessus de cette note. La rubrique **IA** (dans « Rubriques », ou dans la barre de navigation si vous l'y placez) affiche la conversation en plein écran ; **Conversations** liste les précédentes.
- **À côté de la note :** sur l'ordinateur, la même conversation est la dernière section de la barre latérale droite, **IA**. Sur un téléphone ou une tablette, c'est l'onglet **IA** du contexte de la note — à côté de **Propriétés** et **Backlinks** —, qu'une tablette affiche à côté de la note.

La note que vous avez ouverte est jointe automatiquement ; retirez-la du contexte avec son ✕ si vous le souhaitez. **Épingler une note…** ajoute d'autres notes. L'assistant peut aussi chercher par lui-même : il parcourt le vault, lit des notes et leurs sections, des bases de données, des backlinks et des notes liées, liste des tâches, des rendez-vous et les notes ouvertes ou modifiées récemment, et ouvre des notes et des vues. Il ne peut rien modifier, créer ou supprimer lui-même ; ce qu'il peut proposer à la place est décrit plus bas, sous « Proposer des modifications ».

L'assistant peut aussi vous montrer des choses : ouvrir une note à un titre, afficher une note dans le graphe, placer le calendrier sur un jour, ouvrir des vues, afficher et masquer les barres latérales. Il utilise pour cela les commandes de la palette de commandes — et, parmi elles, seulement celles qui montrent quelque chose : il ne peut pas déclencher celles qui créent, modifient, suppriment, exportent ou ouvrent une fenêtre.

Chaque conversation commence par la ligne « Les réponses sont rédigées par une IA — ⟨modèle⟩ via ⟨fournisseur⟩ ». Sous chaque réponse, une ligne indique ce qui a été envoyé où : combien de notes, environ combien de jetons et — là où le fournisseur publie ses prix — le coût approximatif. **Arrêter** met fin à une réponse à tout moment.

Un lien dans une réponse ne s'ouvre qu'après confirmation de son adresse, et les images dans les réponses ne sont jamais chargées.

## Ce qui part avec une question

À chaque question, Plainva rassemble ce qui peut compter — sur cet appareil, avant tout envoi :

- **Où vous en êtes :** la date et l'heure, la note ou la base ouverte et votre sélection, vos onglets ouverts, les tâches à échéance dans la semaine, les prochains rendez-vous et la note du jour.
- **Les notes qui peuvent compter :** trouvées à partir de vos mots, des liens de la note ouverte et de ce que vous avez ouvert ou modifié récemment. Vos règles de confidentialité décident d'abord ; seules les notes qu'elles autorisent sont évaluées. Quelques-unes partent sous forme de sections — pas de notes entières —, d'autres seulement avec leur titre et une fiche — la première phrase de leur section et chaque phrase contenant des nombres, des dates, des tâches, des négations ou des liens, mot pour mot —, ou leur seul nom ; l'assistant en lit davantage s'il en a besoin.

Une note que la conversation contient déjà et qui n'a pas changé depuis est nommée, pas renvoyée. Les lieux de votre journal et les valeurs d'humeur ne partent jamais d'eux-mêmes.

## Avant tout envoi

La première requête d'une session affiche un aperçu : où elle part (fournisseur et modèle), quelles notes et quelle partie de chacune, ce qui part en plus (votre sélection, des rendez-vous, des tâches), ce qui a été retenu et environ combien de jetons. **Envoyer** l'envoie ; **Annuler** n'envoie rien et vous rend vos mots dans le champ de saisie ; le − à côté d'une note la retire. Dans les limites de ce que vous avez approuvé, les requêtes suivantes partent sans question. L'aperçu revient dès que la portée s'élargit : un autre modèle ou fournisseur, un nouveau type de données, des notes d'un autre dossier, de nouveaux outils ou une requête bien plus grande. Un modèle sur cet appareil ne demande jamais rien.

Pour voir l'aperçu avant chaque requête, activez **Demander avant chaque requête** — dans l'aperçu lui-même ou dans **Paramètres → IA & automatisation**, sous **Envoi**.

La ligne sous chaque réponse ouvre l'aperçu de ce qui est parti avec elle. Si une réponse ne cite aucune des notes envoyées, un avis au-dessus de cette ligne le signale ; vérifiez alors la réponse à partir des notes. Quand des notes sont parties, la ligne indique aussi la couverture : **couverture élevée** quand presque chaque affirmation de la réponse cite une note, **couverture partielle** ou **couverture faible** quand c'est moins le cas.

## Voir le contexte

L'œil sous le champ de saisie, **Voir le contexte**, montre ce que la prochaine requête emporterait — avant son départ, pour le modèle choisi maintenant. Pour chaque note : pourquoi elle a été choisie (ouverte maintenant, épinglée, correspond à vos mots, proche par le sens, liée, échéance proche…), quelle partie part et environ combien de jetons. Chaque note peut être

- retirée de la prochaine requête (**Réintégrer** la remet),
- épinglée à la conversation,
- gardée sur cet appareil pour de bon : cela écrit la règle `cloud: deny` dans la note (voir plus bas).

Les notes que vos règles retiennent sont aussi listées, pour que vous sachiez ce qui manque ; elles ne sont jamais évaluées ni envoyées. **Envoyer avec ce contexte** envoie ce que vous avez tapé. Dans un onglet IA large, la vue reste ouverte en colonne à côté de la conversation.

Au-dessus des notes, **Envoyé** indique la part de ces notes qui part — par exemple ~870 sur 3 460 jetons — et **Économisé** combien c'est de moins que d'envoyer entières toutes les notes proposées ; la première fois, il indique aussi combien de jetons cela aurait représenté. **Afficher comme piste dans le graphe** ouvre le graphe avec la note ouverte et les sources entourées, et les liens entre elles.

Quand le texte qui partirait vers un cloud semble contenir un mot de passe ou une clé, un numéro de compte ou de carte, un numéro d'identité ou fiscal, ou des données de santé, une ligne sous la note indique **Peut-être sensible** et ce qui a été repéré — dans **Voir le contexte** et dans l'aperçu avant l'envoi. **Garder sur cet appareil** écrit la règle `cloud: deny` dans la note. Pour les numéros et les secrets, **Masquer dans cette conversation** les remplace par un espace réservé comme `⟦withheld account⟧` dans chaque message de cette conversation, y compris quand le modèle lit la note lui-même, jusqu'à ce que vous choisissiez **Envoyer sans masquer** ; l'aperçu les compte sous **Retenu**. Les tâches et les rendez-vous offrent le même choix dans la ligne **Tâches, rendez-vous et détails de la note ouverte**. La première fois dans une session que quelque chose de ce genre partirait sans être masqué, l'aperçu demande avant l'envoi. La vérification a lieu sur cet appareil ; c'est une indication, pas un filtre : elle peut laisser passer des choses et n'arrête jamais une requête. Un passage sélectionné part tel quel ; avec un modèle sur cet appareil, aucune indication n'apparaît.

## Résumés

Avec **Résumés avec le modèle local** (dans **Paramètres → IA & automatisation**, désactivé jusqu'à ce que vous l'activiez), un modèle sur votre ordinateur écrit de courts résumés des sections longues de vos notes, des notes entières, des dossiers de premier niveau et du vault. Il ne fonctionne que si le profil **Local** désigne un serveur sur cet ordinateur (Ollama, LM Studio ; sur le téléphone, le modèle du système) — jamais un cloud en arrière-plan — et seulement quand Plainva est inactif ; sur le téléphone, seulement tant qu'il est ouvert. Chaque résumé est vérifié : le résumé d'une section doit garder mot pour mot chaque nombre, date, montant, lien, tag et chaque négation, sinon ce sont les phrases de la section qui partent. Un résumé est lié au texte exact qu'il représente ; si vous modifiez la section, il n'est plus utilisé avant d'avoir été réécrit. Les résumés de dossiers et du vault ne sont écrits qu'à partir des notes que vos règles laissent partir vers un cloud. Dans **Voir le contexte**, une source envoyée sous forme de résumé l'indique, et **Original** envoie ses propres phrases avec le message suivant.

## Avec une sélection

Sélectionnez du texte dans une note : l'IA travaille uniquement sur ce passage.

- **Ordinateur :** pendant l'édition, **IA** dans la barre de sélection propose **Comme proposition** — **Réécrire**, **Raccourcir**, **Traduire…**, **En faire des tâches** — et **Dans le compagnon** — **Expliquer** et **Question sur la sélection…** (**Ctrl+J**, ⌘J sous macOS).
- **Téléphone :** **IA** dans la barre au-dessus d'une sélection — en lecture comme en édition — ouvre la feuille IA.
- **Dans chaque conversation :** tant que du texte est sélectionné dans la note ouverte, la ligne **Avec la sélection** au-dessus de la saisie propose les mêmes actions.

Une action de proposition envoie uniquement le passage sélectionné — ni le reste de la note, ni les notes épinglées, ni les outils — et demande avec le même aperçu qu'une question. La réponse revient dans la note sous forme de série de propositions, comme celle d'une personne : sous **Propositions**, vous acceptez ou refusez chaque modification ou toute la série, et rien ne change dans la note avant. La ligne d'auteur de la série indique **Plainva IA · ⟨modèle⟩**, pour qu'on voie toujours quel passage une IA a écrit. **En faire des tâches** ajoute les tâches sous le passage au lieu de le remplacer. Chaque action garde sa conversation dans l'historique.

Un passage d'une note que vos règles tiennent à l'écart du cloud — ou un passage avec des liens vers de telles notes ou avec des indications de lieu — ne part vers aucun modèle cloud. Dans un espace chiffré, les actions de proposition ne sont pas encore disponibles : ses propositions ne peuvent pas encore nommer l'IA comme auteur.

## Dans un fil de commentaires

Adressez-vous à l'assistant dans un commentaire, et il répond dans le fil. Tapez un **@** dans le champ de commentaire et choisissez **IA** — l'entrée qui porte le symbole de l'IA — ou écrivez le nom vous-même : **@IA**, **@AI** et **@KI** l'atteignent tous, quelle que soit la langue de l'application. Dès que votre commentaire est envoyé, le fil affiche sous **IA** la ligne **rédige une réponse…** ; **Arrêter** y met fin. La réponse apparaît comme réponse dans le même fil, avec la ligne d'auteur **Plainva IA · ⟨modèle⟩**. Contrairement à une proposition, elle n'attend pas d'être acceptée — c'est une remarque à côté de la note, jamais du texte dans celle-ci — et, sur l'appareil qui a posé la question, vous la supprimez comme l'une des vôtres.

Le fil part vers le modèle comme une question : ses commentaires, le passage auquel il est rattaché et la note elle-même, via le même aperçu. Un fil de commentaires est un type de données à part, l'aperçu demande donc la première fois. Là où vos règles tiennent la note à l'écart du cloud, ses commentaires n'y vont pas non plus, et les liens qu'ils contiennent vers de telles notes sont retenus. Seul un commentaire que vous envoyez sur cet appareil appelle l'assistant ; un commentaire arrivé par la synchronisation ne le fait jamais, quoi qu'il dise. Les adresses web que l'IA apporte d'elle-même — dans une réponse, une proposition ou une transcription — sont écrites de façon que rien ne les ouvre ni ne les charge (`https[://]…`) ; les adresses que votre propre texte contenait déjà restent telles quelles. Dans un espace chiffré, on ne peut pas encore s'adresser à l'assistant : ses commentaires ne peuvent pas encore nommer l'IA comme auteur.

## Compétences

Les compétences sont des instructions pour un travail récurrent. Douze sont fournies avec Plainva — dont **Orientation du jour**, **Bilan de la semaine** et **État du projet** sous forme de puces dans une conversation vide — et vous pouvez écrire ou importer les vôtres. Lancez-en une en un clic, ou demandez simplement : l'IA charge d'elle-même une compétence adaptée. Vos propres compétences ne s'exécutent qu'après votre approbation sur cet appareil. Tout à leur sujet : [Compétences](AI_Skills.md).

Les scripts sont de petits programmes que vous écrivez pour ce qu'un modèle fait mal — compter, trier, additionner. Ils s'exécutent dans une boîte fermée et lisent votre vault avec les mêmes outils que l'IA, mais seulement après que vous les avez approuvés sur cet appareil. Tout ce qui les concerne : [Scripts](AI_Scripts.md).

## Transcrire une note vocale

Sur chaque note vocale — dans l'éditeur, en mode lecture, dans le journal et sur les cartes —, **Transcrire** transforme l'enregistrement en texte. Il part tel quel vers le modèle du profil **Audio**, via le même aperçu qu'une question ; un enregistrement est un type de données à part, l'aperçu demande donc la première fois. La transcription revient comme proposition sous l'enregistrement, avec l'auteur **Plainva IA · ⟨modèle⟩** — acceptez-la ou refusez-la sous **Propositions**.

**Audio** nécessite un fournisseur avec une voie audio : OpenAI (par exemple `gpt-4o-transcribe` ou `whisper-1`), Gemini ou votre propre serveur compatible — un serveur sur cet ordinateur garde l'enregistrement sur l'appareil. Les enregistrements jusqu'à 11 Mo peuvent être transcrits. Un enregistrement dans une note que vos règles tiennent à l'écart du cloud ne part vers aucun modèle cloud, et les espaces chiffrés ne le proposent pas encore.

## Expliquer une image

Sur chaque image du vault, **Expliquer l'image** demande à l'IA ce que montre l'image.

- **Ordinateur :** dans la barre d'outils d'une image ouverte, et dans le menu qu'ouvre un clic droit sur une image dans une note — en édition comme en mode lecture.
- **Téléphone :** sous une image ouverte (sur une image dans une note, **Ouvrir l’image** y mène).

L'image part, avec la question, vers le modèle avec lequel commencent les nouvelles conversations — dans une conversation à part, où vous pouvez continuer à poser des questions : ce que dit un tableau, ce qui figure dans la deuxième colonne, ce que signifie un diagramme. L'aperçu montre l'image avant son envoi ; une image est un type de données à part, l'aperçu demande donc la première fois.

**Ce qui part n'est pas le fichier.** Plainva dessine l'image, la réduit à 1 568 pixels au plus sur son côté le plus long et l'enregistre à nouveau pour l'envoi. Elle part donc sans ce que le fichier consigne à son sujet : le lieu où une photo a été prise, la date, l'appareil photo. L'aperçu montre exactement l'image qui part, avec sa taille. Cette copie reste avec la conversation sur cet appareil, pour que vous puissiez voir plus tard ce que le fournisseur a reçu ; si vous supprimez la conversation, elle disparaît.

**Règles.** Une image dans un dossier que vos règles tiennent à l'écart du cloud ne part vers aucun modèle cloud. Il en va de même d'une image affichée dans une note portant la règle `cloud: deny` — peu importe où vous appuyez sur **Expliquer l'image**, y compris sur l'image ouverte : avant l'envoi, Plainva cherche quelles notes intègrent l'image et, s'il ne peut pas le déterminer, l'image reste sur l'appareil. Un modèle sur cet appareil reste autorisé. Ce qui est écrit dans une image est du contenu, comme le texte d'une note, jamais une instruction : la conversation de **Expliquer l'image** peut chercher dans votre vault, mais elle ne peut pas utiliser Internet et ne déclenche rien dans l'application.

**Quels modèles lisent les images.** La plupart des modèles cloud le font. Le modèle du système sur le téléphone ne le fait pas, et **Expliquer l'image** le signale. Quand la liste d'un fournisseur indique qu'un modèle ne lit pas les images, l'aperçu vous le dit avant l'envoi. Si un fournisseur refuse la requête, choisissez un autre modèle sous la conversation et posez de nouveau la question — l'image y est toujours.

## Sur Internet

L'assistant ne peut pas utiliser Internet tant que vous ne l'autorisez pas — et il faut l'autoriser trois fois :

1. **Pour le vault.** Dans **Paramètres → IA & automatisation** (la partie Vault), activez **L'IA peut utiliser Internet dans ce vault**. Cet interrupteur est désactivé pour chaque vault tant que vous n'avez pas décidé, et il ne vaut que pour cet appareil.
2. **Pour une conversation.** Avant le premier message d'une nouvelle conversation, appuyez sur le globe sous le champ de saisie — **Laisser cette conversation utiliser Internet**. C'est au début d'une conversation que se décide si elle peut utiliser Internet ; pour le changer, commencez une nouvelle conversation. Une conversation qui peut l'utiliser le dit dans sa première ligne. Lancer la compétence **Se documenter** revient au même choix : sa conversation peut utiliser Internet — voir [Compétences](AI_Skills.md).
3. **Pour chaque requête.** Tant que vos notes sont dans la conversation, chaque page que l'assistant veut lire et chaque recherche qu'il veut faire demandent d'abord, avec l'adresse complète ou les mots recherchés — c'est tout ce qui quitte votre appareil pour cela. **Lire la page** ou **Rechercher** laisse passer cette seule requête ; **Ne pas lire** ou **Ne pas rechercher** l'écarte, et l'assistant continue sans elle.

**Ce qu'est une requête.** Lire une page est une requête de cet appareil vers le site, comme ouvrir la page dans un navigateur — sans cookies, sans connexion et sans rien de vos notes ; comme pour toute visite, le site voit votre adresse IP. Seules les pages publiques en `https` sont lues ; les adresses de votre réseau domestique ou d'entreprise sont refusées. Une recherche part vers le fournisseur de votre modèle — Anthropic, OpenAI, Google Gemini ou OpenRouter —, qui cherche exactement avec les mots qui vous ont été montrés ; les fournisseurs peuvent facturer les recherches séparément. Un modèle sur cet appareil peut lire des pages mais ne peut pas chercher, et le modèle du système sur le téléphone ne peut pas du tout utiliser Internet.

**D'où vient une adresse.** La question indique si vous avez nommé l'adresse, si une note ou un résultat l'a nommée — ou si le modèle l'a construite lui-même. Une adresse construite par le modèle pourrait contenir quelque chose de vos notes : lisez-la avant de la laisser passer.

**Sites sans confirmation.** Avec **Toujours pour ⟨site⟩** dans une question, ou sous **Sites sans confirmation** dans les paramètres du vault, les pages d'un site sont lues sans demander — tant que l'adresse a été nommée par vous, par une note ou par un résultat. Une adresse construite par le modèle demande toujours.

**Ce que lit l'assistant.** Jamais la page elle-même. Une seconde requête au même modèle, sans aucun outil, lit la page et rédige un court rapport : un résumé, des affirmations avec le passage sur lequel elles reposent, et des liens qui figurent réellement sur la page. Une page qui tente de donner des instructions à l'assistant lui parvient donc comme un rapport sur une page — jamais comme une page avec laquelle il travaille. Sous la réponse, **Lu sur le web** liste les pages lues, et la ligne en dessous ouvre tout ce qui a été demandé.

**Notes qui restent dehors.** Une note ou un dossier avec **Accès web: jamais** (voir Règles de confidentialité plus bas) n'existe pas pour une conversation qui peut utiliser Internet : ni dans son contexte, ni pour ses outils, et les liens vers elle sont retenus.

Un lien dans une réponse dont l'adresse a été construite par le modèle lui-même est signalé, et la question avant l'ouverture le dit. Si aucune réponse ne revient — pas de connexion, le fournisseur ne répond pas —, la conversation liste à la place les notes qui correspondent le mieux à votre question.

## E-mails et rendez-vous

**Rendez-vous.** L'assistant liste les rendez-vous de vos calendriers connectés — jour, heure et titre, sur demande aussi le lieu et les participants — et lit un rendez-vous précis en détail : l'organisateur, les participants avec leurs réponses, et la vôtre. Il ne reçoit jamais le lien d'une réunion en ligne ; celui-ci reste dans le calendrier.

**E-mail.** Si des comptes de messagerie sont connectés dans ce vault, l'assistant peut chercher et lire des messages. L'e-mail ne fait pas partie des outils avec lesquels une conversation commence : l'assistant ne le cherche que lorsque votre question en a besoin, et au premier accès Plainva demande — **Lire vos e-mails ?** **Autoriser** vaut pour ce fournisseur jusqu'à ce que vous fermiez Plainva ; un autre modèle ou un autre fournisseur redemande. **Ne pas autoriser** laisse l'accès de côté, et l'assistant continue sans lui. Un modèle sur cet appareil ne demande pas, car rien ne quitte l'appareil pour lui.

**Ce que l'assistant en lit.** D'une recherche, il voit la date, l'expéditeur et l'objet des messages — jamais leur texte. Il ne lit jamais lui-même le texte d'un message ni la description d'un rendez-vous : d'autres personnes les ont écrits, et celui qui écrit un e-mail ou une invitation peut l'écrire précisément pour ce lecteur. Un second lecteur sans aucun outil les lit et rédige un court rapport — un résumé, des affirmations avec le passage sur lequel elles reposent, et des liens qui figurent réellement dedans. Si un modèle sur cet appareil est défini comme **Local** sous **Modèles et profils**, c'est ce modèle qui lit, et le texte lui-même ne quitte pas l'appareil ; seul le rapport part vers le fournisseur. Sinon, c'est le fournisseur de la conversation qui lit, dans une requête à part et sans outils. La question vous dit d'avance qui lit.

**Ce qui ne change pas.** L'assistant ne fait que lire : un message qu'il a lu reste non lu, il ne déplace rien, ne répond à rien et ne supprime rien, et il n'ouvre pas les pièces jointes — il se contente de les nommer. Sous la réponse, vous voyez combien de messages ont été lus, et la ligne en dessous dit qui a lu le texte. Un e-mail ou un rendez-vous qu'il rédige pour vous n'est jamais qu'un brouillon que vous envoyez ou enregistrez vous-même — voir **Proposer des modifications** plus bas.

## Outils externes (MCP)

L'assistant peut utiliser les outils de serveurs que vous connectez vous-même, par le Model Context Protocol (MCP) — un système de tickets, un wiki, une base de données de votre équipe. C'est le sens inverse de [Connecter des apps d'IA](Connect_AI_Apps.md) : là, d'autres apps lisent votre vault à travers Plainva ; ici, l'assistant de Plainva interroge d'autres serveurs. Rien d'un serveur n'est utilisé avant que vous ayez regardé ce qu'il propose, et chaque appel vous est montré avant son envoi.

**Ajouter un serveur.** Dans **Paramètres → IA & automatisation** (la partie Vault), sous **Outils externes (MCP)**, choisissez **Ajouter un serveur…**. Donnez-lui un nom à vous et son adresse (`https://…`), ainsi qu'un jeton d'accès si le serveur en demande un — il va dans le stockage sécurisé de cet appareil et n'est plus jamais affiché. Sur l'ordinateur, un serveur peut aussi être un **Programme sur cet ordinateur** : le fichier à démarrer, ses arguments et les valeurs de son environnement. Plainva le démarre directement, sans shell, et dans un bac à sable lorsque votre ordinateur en a un que Plainva peut utiliser. Votre système affiche encore une fois l'adresse ou la commande entière avant qu'elle soit mémorisée. Sur le téléphone, un serveur est toujours une adresse.

**Se connecter.** Certains serveurs demandent une connexion plutôt qu'un jeton. Sa vérification indique alors **Le serveur demande une connexion.** Choisissez **Se connecter…** : Plainva demande au serveur où se trouve sa connexion, ouvre cette page dans votre navigateur et attend votre retour. Ce qu'il reçoit reste dans le stockage sécurisé de cet appareil et ne va qu'à ce serveur ; ni vous ni l'IA ne le voyez jamais. Il est renouvelé sans vous tant que le serveur le permet et, lorsqu'il a pris fin, la vérification vous demande de vous reconnecter. Lorsque le service de connexion ne laisse pas les applications s'enregistrer elles-mêmes, Plainva demande l'**ID client** que l'exploitant du serveur vous a donné. **Se déconnecter** oublie la connexion ; une connexion et un jeton d'accès enregistré se remplacent l'un l'autre.

**Le vérifier.** Un serveur qui vient d'être ajouté ne propose encore rien. Sa vérification montre ce qui est enregistré et ce que le serveur énumère : sa propre description, ses outils avec leurs descriptions — les mots du serveur lui-même — et ses prompts. **Approuver** autorise exactement ces textes, sur cet appareil. Avant qu'un serveur soit utilisé, Plainva charge de nouveau ce qu'il énumère et le compare à ce que vous avez approuvé ; si quelque chose diffère, le serveur est bloqué jusqu'à ce que vous le regardiez de nouveau, et la vérification dit ce qui a changé.

**Ce qu'un vault autorise.** Chaque vault décide pour lui-même : s'il utilise le serveur (**Utiliser ⟨serveur⟩ dans ce vault**), lesquels de ses outils l'assistant peut appeler — aucun n'est coché —, et sous **Notes qui peuvent accompagner un appel**, soit **Aucune**, soit **Dossiers choisis**, soit **Tout le vault**. Un outil qui n'indique pas qu'il se contente de lire peut être coché lui aussi ; sa ligne précise ce qu'un appel peut alors faire chez le serveur : modifier quelque chose, ou modifier, écraser ou supprimer quelque chose. Une coche vaut pour ce que l'outil indiquait au moment où vous l'avez posée : s'il indique plus tard pouvoir en faire davantage, il n'est de nouveau proposé qu'une fois recoché.

**Dans une conversation.** Les outils de vos serveurs ne font pas partie des outils avec lesquels une conversation commence : l'assistant ne les cherche que lorsque votre question en a besoin, et l'aperçu avant l'envoi nomme les serveurs auxquels ils appartiennent. Chaque appel demande d'abord — **Appeler ⟨serveur⟩ ?** — avec l'outil et exactement ce qui serait envoyé. **Appeler** laisse passer ce seul appel, **Ne pas appeler** l'écarte, et il n'existe pas de « toujours ». Un outil qui peut modifier quelque chose pose la question autrement — **Laisser ⟨serveur⟩ modifier quelque chose ?** —, précise que Plainva ne peut pas l'annuler, et son bouton s'intitule **Exécuter**. Un appel ne part pas du tout si la conversation a lu une note située hors de ce que le vault autorise à ce serveur, ou une note que vous tenez à l'écart du cloud. Ce qui revient est traité comme le texte d'un inconnu : l'assistant le lit et n'en reçoit aucune instruction.

**Prompts.** Un serveur peut proposer des prompts — des requêtes toutes faites. Ils se trouvent sous une conversation vide, et vous seul les lancez. La première fois, Plainva montre ce qu'un prompt devient avant qu'il soit envoyé comme votre message ; ensuite, exactement ce texte part sans demander, et un autre texte bloque le serveur.

**Ce que Plainva conserve.** L'adresse ou la commande est mémorisée sur cet appareil, les valeurs enregistrées dans son stockage sécurisé ; votre approbation se trouve dans les données de Plainva, jamais dans le vault — quiconque peut écrire dans le vault ne peut donc pas approuver un serveur. Sous **Appels récents dans ce vault**, la vérification indique quand un outil a été appelé, lequel et comment cela s'est terminé — jamais ce qui a été dit. **Retirer le serveur** supprime le serveur de cet appareil, pour chaque vault.

Une conversation lancée par une compétence, une action sur une sélection et une réponse dans un fil de commentaires n'atteignent pas les outils externes, pas plus que le modèle du système sur le téléphone.

## Agents externes

Sur l'ordinateur, Plainva peut aussi démarrer un agent d'IA d'un autre éditeur dans le dossier du vault — un programme que vous avez installé et auquel vous vous êtes connecté vous-même. Un tel agent n'est pas l'assistant : il lit et envoie de lui-même, et vos règles de confidentialité et l'aperçu avant l'envoi ne l'atteignent pas. Ce que Plainva contrôle dans sa session et ce qu'il ne contrôle pas : [Agents externes](External_Agents.md).

## Proposer des modifications

L'assistant peut proposer plus qu'une réponse — et rien de ce qu'il propose n'est dans votre vault avant que vous ne le disiez. Il existe trois formes, et chacune attend là où vous en décidez.

- **Une proposition sur une note.** Si vous demandez une modification d'une note qui existe, l'assistant la dépose sur la note sous forme de propositions : dans la marge, signées « Plainva IA · ⟨modèle⟩ », chaque modification à accepter ou à refuser séparément — comme les propositions d'une personne, voir [Commentaires et suggestions](Comments_and_Suggestions.md). À l'acceptation, la note telle qu'elle était est d'abord conservée comme une version : l'historique des versions garde toujours le chemin du retour. Sous la réponse, une ligne nomme la note ; un appui l'ouvre. Une valeur pour une propriété de la note se propose de la même façon : la carte montre la propriété avec ce qu'elle dit actuellement, barré, et ce qu'elle dirait, et signale comme nouvelle une propriété que la note n'a pas encore. Si la propriété dit autre chose au moment où vous décidez, la carte indique que la proposition ne convient plus. L'assistant ne peut proposer ni qui a créé une note ni qui s'en porte garant (voir [OKF](OKF.md)), pas plus que les propriétés que Plainva tient pour lui-même. Dans une base de données, une valeur proposée pour une entrée figure aussi dans la cellule de cette entrée, où vous l'acceptez ou la refusez sans ouvrir la note — voir [Bases de données (.base)](Databases_Base.md).
- **Un brouillon.** Une nouvelle note, une tâche ou une entrée de journal reste un brouillon : une carte sous la réponse indique ce qu'il deviendrait et où il irait. **Créer** le réalise — la note dans le dossier que nomme la carte (le **Dossier de la boîte de réception**, si l'assistant n'en a pas nommé d'autre), la tâche lue à partir de ses mots comme si vous les aviez saisis dans le champ de saisie, l'entrée dans le journal du jour indiqué sur la carte. **Afficher** déplie d'abord le texte d'une note ; **Abandonner** jette le brouillon. Une note créée à partir d'un brouillon dit qui l'a écrite (`generated`, voir [OKF](OKF.md)) et nomme les notes sur lesquelles reposait la conversation. Là où vos nouvelles tâches vont aussi dans une liste de tâches de votre fournisseur, la carte d'une tâche porte l'interrupteur du champ de saisie, **Créer aussi dans « … »** : il est activé, et la tâche est créée là aussi, sauf si vous le désactivez. Une entrée d'une base de données se prépare de la même façon : sa carte nomme la base de données et les propriétés qu'aurait l'entrée, et **Créer** l'écrit comme note dans le dossier où cette base de données range ses entrées — avec ces propriétés et tout ce qui y fait d'une note une entrée. Une base de données qui n'a pas encore de dossier de stockage pour les nouvelles entrées n'accepte un tel brouillon qu'une fois que vous avez créé vous-même sa première entrée.
- **Un plan.** Renommer, déplacer ou supprimer une note ne se vérifie pas morceau par morceau ; l'assistant demande donc : une question au-dessus du champ de saisie montre ce qui se passerait — le nouveau nom et combien de liens dans combien de notes le suivent, ou le dossier cible, avec un avertissement si la note y perdait une règle de confidentialité de son dossier. Après votre oui, Plainva le fait comme lorsque vous le faites vous-même ; l'assistant apprend seulement si cela a été fait. Pour une suppression, la question ouvre simplement la boîte de dialogue de suppression de Plainva : rien ne disparaît avant que vous n'y confirmiez. L'une des règles de confidentialité propres à une note se demande de la même façon et n'est jamais déposée comme proposition : la question nomme la règle et indique si elle serait écrite dans la note ou retirée de celle-ci, avec un avertissement lorsque la note pourrait ensuite être de nouveau envoyée à des modèles dans le cloud ou entrer dans des conversations avec Internet. Après votre oui, Plainva l'écrit ; la règle vaut à partir de ce moment et ne reprend pas ce qu'une conversation a déjà envoyé.

**Un e-mail et un rendez-vous.** Là où un compte de messagerie ou un calendrier acceptant des rendez-vous est connecté dans ce vault, l'assistant peut aussi rédiger un e-mail ou un rendez-vous. Il n'envoie ni n'enregistre aucun des deux. La carte nomme tous les destinataires — **À**, **Cc** et **Cci**, ou les **Participants** — et signale chaque adresse que vous n'avez pas écrite vous-même dans cette conversation : l'assistant peut la tenir d'une note, d'un e-mail ou d'une page web, vérifiez-la donc. **Ouvrir dans Mail** ouvre l'e-mail comme un nouveau message où tout est déjà rempli, **Ouvrir dans le calendrier** ouvre le rendez-vous dans l'éditeur d'événements du calendrier ; vous y modifiez ce que vous voulez, et **Envoyer** ou **Enregistrer** reste votre propre geste. Les participants reçoivent une invitation de votre fournisseur de calendrier à l'enregistrement, comme pour tout rendez-vous que vous saisissez vous-même. Le brouillon reste dans la liste jusqu'à ce que l'e-mail soit réellement parti ou que le calendrier ait accepté le rendez-vous : fermer le message, annuler un envoi pendant ses quelques secondes ou un calendrier qui refuse le laissent où il était. Un e-mail que vous déposez avec **Enregistrer le brouillon** se trouve dès lors dans les brouillons de votre boîte et quitte lui aussi la liste ; sur l'ordinateur, il en va de même d'un message que vous déplacez dans sa propre fenêtre.

Dans une base de données, l'assistant travaille aussi sans conversation : **Remplir « … » avec l'IA…** lit la note de chaque entrée qui n'a pas de valeur dans une colonne et en propose une pour chacune, et dans les réglages de filtre une phrase devient des règles de filtre que vous voyez avant qu'elles ne s'appliquent. Avant tout envoi, l'aperçu montre comme toujours ce qui part — pour une colonne, les notes de ces entrées, chacune dans sa propre requête ; pour un filtre, seulement les colonnes de la base de données avec leurs noms, leurs types et leurs options, et votre phrase, jamais une entrée. Les deux sont décrits dans [Bases de données (.base)](Databases_Base.md).

Tout ce qui attend figure dans une liste : **En attente**, un segment de l'onglet IA sur l'ordinateur et de **Conversations** sur le téléphone. Elle nomme les notes qui portent des propositions d'une IA et les brouillons de cet appareil, chacun avec celui qui l'a déposé. Les brouillons sont conservés sur l'appareil où ils ont été faits, comme les conversations ; les propositions font partie des commentaires de la note et atteignent vos autres appareils avec eux.

Trois limites valent quoi que l'on demande à l'assistant. Une adresse web qu'il apporte dans une proposition ou un brouillon est écrite de façon que rien ne l'ouvre ni ne la charge (`https[://]…`) ; une adresse que vous avez saisie vous-même reste telle quelle. Une conversation qui a lu une note tenue à l'écart du cloud ou d'Internet ne dépose une proposition, une tâche ou une entrée de journal que là où la même règle s'applique — une note ou une entrée de base de données en brouillon emporte la règle avec elle, et un e-mail ou un rendez-vous n'est pas rédigé du tout. Et dans un espace chiffré, rien n'est proposé, rédigé ni planifié.

On demande à l'assistant de nommer une note sous forme de lien ; un lien est donc la seule affirmation de son texte que Plainva peut vérifier : lorsqu'une proposition ou un brouillon renvoie à une note que votre vault ne contient pas, la ligne sous la réponse et la carte du brouillon le disent — **Lié, mais absent de ce vault :** et les noms. Rien n'est retenu pour autant ; vous voulez peut-être d'abord le lien et la note plus tard. Un lien vers une note qui se trouve bien dans votre vault mais que l'IA ne peut pas lire ici — une règle de confidentialité la tient à l'écart de la conversation — reçoit sa propre ligne : **Renvoie à des notes que l'IA ne peut pas lire ici :** et les noms. L'IA elle-même apprend la même chose dans les deux cas ; elle ne peut donc pas découvrir un nom en l'essayant. Plainva ne vérifie pas si une affirmation est vraie.

Une compétence n'a ces capacités que si elle les nomme, et sa vérification le dit — voir [Compétences](AI_Skills.md).

## Conserver une réponse comme note

Sous chaque réponse terminée, **Conserver comme note** transforme la réponse en une note de votre vault. Vous appuyez dessus et Plainva écrit la note — l'assistant lui-même ne modifie toujours rien.

- **Où elle va.** Dans le **Dossier de la boîte de réception** du vault (**Paramètres → Contenu et structure**), sous un nom tiré de votre question — dans une conversation lancée par une compétence, de la compétence et de la note qui était ouverte, ou du jour. Une note déjà présente n'est jamais touchée : la nouvelle reçoit le nom libre suivant. Plainva l'ouvre aussitôt.
- **Qui l'a écrite.** La première ligne le dit en toutes lettres — une réponse de Plainva IA, avec le modèle, l'heure et votre question. Les propriétés de la note disent la même chose pour d'autres outils : `generated`, avec le modèle et l'heure. Rien ne marque la note comme relue ; cela reste à vous de le faire — voir [OKF](OKF.md).
- **Sur quoi elle repose.** Sous la réponse, **Sources** liste ce que l'exécution a réellement utilisé. Plainva écrit cette liste à partir de son propre registre, pas le modèle : les pages lues et quand, les recherches et via quel fournisseur, et vos notes qui ont accompagné la demande ou ont été lues. Les propriétés portent la même liste sous `sources`.
- **Adresses.** Chaque adresse web que le modèle a écrite dans sa réponse est écrite de façon que rien ne l'ouvre ni ne la charge (`https[://]…`), et une image du web n'est jamais une image dans la note. Seules les pages sous **Sources** sont de vrais liens : des adresses que l'exécution a lues avec votre accord. Les liens vers vos propres notes restent des liens.
- **Règles.** Une réponse conservée hérite des règles de confidentialité de ce sur quoi elle repose. Si une note qui était dans la conversation, ou une que l'assistant a lue, est tenue à l'écart du cloud ou d'Internet, la nouvelle note porte la même règle — écrite dans la note elle-même là où son dossier autoriserait davantage. Ainsi, une réponse qu'un modèle sur cet appareil a produite à partir d'une note privée n'atteint pas non plus un cloud sous forme de note.

Dans un espace de travail partagé, ses membres peuvent lire une note — tout comme les lecteurs d'une publication qui couvre le dossier. Plainva demande alors à chaque fois, avec le nom de la note et le dossier : **Conserver comme note** l'écrit, **Ne pas conserver** n'écrit rien.

## Règles de confidentialité

Certaines notes ne doivent jamais atteindre un fournisseur cloud. Une règle peut se trouver dans le frontmatter d'une note :

```yaml
plainva:
  ai:
    cloud: deny
```

ou, pour un dossier entier, dans **Paramètres → IA & automatisation** (la partie Vault), qui écrit les règles dans `.agent/policy.yml`. Une note tenue à l'écart du cloud n'apporte rien — ni texte, ni titre —, et les liens vers elle dans d'autres notes sont retenus. Cela vaut quelle que soit la façon dont un lien écrit la note — par le nom de son fichier, par son titre ou par un chemin — ; et lorsque deux notes portent le même nom et que l'une d'elles est tenue à l'écart, un lien par ce seul nom est retenu lui aussi. Écrivez le dossier dans le lien pour nommer celle que vous visez. Les modèles sur cet appareil restent autorisés. Les espaces chiffrés tiennent le cloud à l'écart, sauf si vous l'y autorisez. Le format exact se trouve dans la [Référence du format de fichier](File_Format_Reference.md).

Une image appartient aux notes qui l'affichent : une image intégrée dans une note tenue à l'écart du cloud ne part pas non plus vers un modèle cloud (voir Expliquer une image plus haut).

Une seconde règle, `web: deny` — **Accès web: jamais** dans les paramètres —, tient une note ou un dossier à l'écart de toute conversation qui peut utiliser Internet.

Sur un iPhone ou un iPad, les deux mêmes règles décident des titres de notes que Siri et Raccourcis peuvent trouver, une fois que vous l'avez activé : une note tenue à l'écart du cloud ou de l'accès web ne leur est jamais nommée. Voir « Siri et Raccourcis » dans [L'application mobile](Mobile_App.md).

## Historique et utilisation

Les conversations restent sur cet appareil, par vault — jamais dans le vault et jamais synchronisées. **Conserver les conversations** détermine la durée ; vous pouvez supprimer une conversation isolée dans la liste, ou toutes celles d'un vault d'un coup. **Utilisation ce mois-ci** additionne les jetons par fournisseur et par modèle.

## Limites de la bêta

- Sur l'ordinateur, l'IA s'exécute uniquement dans la fenêtre principale.
- Sur le téléphone, une réponse n'arrive que si l'application est ouverte.
- L'assistant ne modifie aucune note lui-même : une modification d'une note et la transcription d'une note vocale sont des propositions que vous acceptez ou refusez, ce qui est nouveau est un brouillon jusqu'à ce que vous appuyiez sur **Créer**, un e-mail ou un rendez-vous un brouillon jusqu'à ce que vous l'envoyiez ou l'enregistriez vous-même, et renommer, déplacer ou supprimer attendent votre oui ; dans un fil de commentaires, il écrit une réponse à côté de la note, jamais du texte dans celle-ci. Une réponse ne devient une note que lorsque vous appuyez sur **Conserver comme note** ; Plainva l'écrit alors, pas l'assistant.

Les retours sur la bêta vont dans les discussions du projet sur GitHub : **Retour sur l'IA (bêta)** dans les réglages en ouvre une.
