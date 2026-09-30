# Assistant IA (Bêta)

Dernière mise à jour : 2026-09-30

Plainva peut répondre à des questions sur vos notes avec un modèle d'IA de votre choix. Il lit votre vault, cite les notes sur lesquelles il s'appuie, ouvre des notes et des vues pour vous et propose des modifications d'un passage sélectionné sous forme de propositions — il ne modifie jamais une note lui-même. L'assistant est **expérimental** et désactivé jusqu'à ce que vous l'activiez, séparément sur chaque appareil.

## Activer l'IA

Ouvrez **Paramètres → IA & automatisation** (la partie Application) et activez **Utiliser l'IA sur cet appareil**. Sans cet interrupteur, il n'y a ni bouton IA, ni onglet IA, ni compagnon. Rien n'est envoyé nulle part tant que vous n'avez rien demandé.

## Choisir un fournisseur

Plainva n'apporte pas son propre service d'IA : vous utilisez un fournisseur de votre choix, avec votre propre clé. Tous les fournisseurs sont proposés au choix ; Plainva indique leurs conditions et leur politique de conservation, pour que vous décidiez — il n'en exclut aucun.

| Type | Fournisseurs |
|---|---|
| Fournisseurs cloud | Anthropic, OpenAI, Google Gemini |
| Passerelles et serveurs personnels | OpenRouter, tout **serveur compatible OpenAI** |
| Sur cet ordinateur (bureau) | Ollama, LM Studio |

1. Dans **IA & automatisation**, choisissez **Ajouter un fournisseur** et sélectionnez-en un. Chaque entrée porte une brève remarque sur ses conditions — par exemple que l'accès gratuit de Google peut laisser des personnes lire vos saisies.
2. Saisissez la clé avec **Saisir la clé**. La clé va dans le stockage sécurisé de cet appareil ; Plainva ne l'affiche plus jamais — ni à l'IA, ni à l'écran.
3. **Tester la connexion** charge la propre liste de modèles du fournisseur. En cas d'échec, le message indique pourquoi (une clé rejetée, aucune connexion, un modèle inconnu).

Un **serveur compatible OpenAI** s'ajoute par son adresse. Plainva redemande confirmation avant de l'ajouter, dans une fenêtre du système d'exploitation, et n'envoie qu'à l'adresse que vous avez confirmée. Le `http` non chiffré ne fonctionne que pour un serveur sur cet appareil ; tout le reste exige `https`.

Si vous n'avez pas encore de clé : un modèle sur cet ordinateur (Ollama, LM Studio) ne coûte rien, et la console de chaque fournisseur délivre des clés.

## Modèles et profils

Quatre profils — **Rapide**, **Équilibré**, **Puissant** et **Local** — sont votre attribution de modèles. Choisissez un fournisseur et un modèle pour chacun, depuis la liste du fournisseur ou en saisissant l'identifiant du modèle exactement comme le fournisseur le nomme. **Par défaut pour les nouvelles conversations** décide avec quel profil commence une nouvelle conversation. Plainva ne désigne aucun modèle comme « le meilleur ».

Un cinquième emplacement, **Audio**, contient le modèle qui transcrit les notes vocales ; il n'est jamais celui par défaut d'une conversation.

Un sixième emplacement, **Embeddings**, contient le modèle avec lequel la recherche par sens calcule quand vous choisissez **Fournisseur personnel** sous **Recherche sémantique** — voir [Recherche](Search.md).

## Poser des questions

- **Ordinateur :** le bouton IA dans la barre d'actions, **Ctrl+J** (⌘J sous macOS) ou **Demander à l'IA** dans la palette de commandes ouvre le compagnon — une petite fenêtre au-dessus de votre travail. **Ouvrir en onglet** déplace la même conversation dans l'onglet IA, où vos conversations sont listées.
- **Téléphone :** **Demander à l'IA** dans le menu ⋮ d'une note ouvre la feuille IA au-dessus de cette note. La rubrique **IA** (dans « Rubriques », ou dans la barre de navigation si vous l'y placez) affiche la conversation en plein écran ; **Conversations** liste les précédentes.
- **À côté de la note :** sur l'ordinateur, la même conversation est la dernière section de la barre latérale droite, **IA**. Sur un téléphone ou une tablette, c'est l'onglet **IA** du contexte de la note — à côté de **Propriétés** et **Backlinks** —, qu'une tablette affiche à côté de la note.

La note que vous avez ouverte est jointe automatiquement ; retirez-la du contexte avec son ✕ si vous le souhaitez. **Épingler une note…** ajoute d'autres notes. L'assistant peut aussi chercher par lui-même : il parcourt le vault, lit des notes et leurs sections, des bases de données, des backlinks et des notes liées, liste des tâches, des rendez-vous et les notes ouvertes ou modifiées récemment, et ouvre des notes et des vues. Il ne peut rien modifier, créer ou supprimer.

Chaque conversation commence par la ligne « Les réponses sont rédigées par une IA — ⟨modèle⟩ via ⟨fournisseur⟩ ». Sous chaque réponse, une ligne indique ce qui a été envoyé où : combien de notes, environ combien de jetons et — là où le fournisseur publie ses prix — le coût approximatif. **Arrêter** met fin à une réponse à tout moment.

Un lien dans une réponse ne s'ouvre qu'après confirmation de son adresse, et les images dans les réponses ne sont jamais chargées.

## Ce qui part avec une question

À chaque question, Plainva rassemble ce qui peut compter — sur cet appareil, avant tout envoi :

- **Où vous en êtes :** la date et l'heure, la note ou la base ouverte et votre sélection, vos onglets ouverts, les tâches à échéance dans la semaine, les prochains rendez-vous et la note du jour.
- **Les notes qui peuvent compter :** trouvées à partir de vos mots, des liens de la note ouverte et de ce que vous avez ouvert ou modifié récemment. Vos règles de confidentialité décident d'abord ; seules les notes qu'elles autorisent sont évaluées. Quelques-unes partent sous forme de sections — pas de notes entières —, d'autres seulement avec leur titre et un extrait de recherche, ou leur seul nom ; l'assistant en lit davantage s'il en a besoin.

Une note que la conversation contient déjà et qui n'a pas changé depuis est nommée, pas renvoyée. Les lieux de votre journal et les valeurs d'humeur ne partent jamais d'eux-mêmes.

## Avant tout envoi

La première requête d'une session affiche un aperçu : où elle part (fournisseur et modèle), quelles notes et quelle partie de chacune, ce qui part en plus (votre sélection, des rendez-vous, des tâches), ce qui a été retenu et environ combien de jetons. **Envoyer** l'envoie ; **Annuler** n'envoie rien et vous rend vos mots dans le champ de saisie ; le − à côté d'une note la retire. Dans les limites de ce que vous avez approuvé, les requêtes suivantes partent sans question. L'aperçu revient dès que la portée s'élargit : un autre modèle ou fournisseur, un nouveau type de données, des notes d'un autre dossier, de nouveaux outils ou une requête bien plus grande. Un modèle sur cet appareil ne demande jamais rien.

Pour voir l'aperçu avant chaque requête, activez **Demander avant chaque requête** — dans l'aperçu lui-même ou dans **Paramètres → IA & automatisation**, sous **Envoi**.

La ligne sous chaque réponse ouvre l'aperçu de ce qui est parti avec elle. Si une réponse ne cite aucune des notes envoyées, un avis au-dessus de cette ligne le signale ; vérifiez alors la réponse à partir des notes.

## Voir le contexte

L'œil sous le champ de saisie, **Voir le contexte**, montre ce que la prochaine requête emporterait — avant son départ, pour le modèle choisi maintenant. Pour chaque note : pourquoi elle a été choisie (ouverte maintenant, épinglée, correspond à vos mots, liée, échéance proche…), quelle partie part et environ combien de jetons. Chaque note peut être

- retirée de la prochaine requête (**Réintégrer** la remet),
- épinglée à la conversation,
- gardée sur cet appareil pour de bon : cela écrit la règle `cloud: deny` dans la note (voir plus bas).

Les notes que vos règles retiennent sont aussi listées, pour que vous sachiez ce qui manque ; elles ne sont jamais évaluées ni envoyées. **Envoyer avec ce contexte** envoie ce que vous avez tapé. Dans un onglet IA large, la vue reste ouverte en colonne à côté de la conversation.

## Avec une sélection

Sélectionnez du texte dans une note : l'IA travaille uniquement sur ce passage.

- **Ordinateur :** pendant l'édition, **IA** dans la barre de sélection propose **Comme proposition** — **Réécrire**, **Raccourcir**, **Traduire…**, **En faire des tâches** — et **Dans le compagnon** — **Expliquer** et **Question sur la sélection…** (**Ctrl+J**, ⌘J sous macOS).
- **Téléphone :** **IA** dans la barre au-dessus d'une sélection — en lecture comme en édition — ouvre la feuille IA.
- **Dans chaque conversation :** tant que du texte est sélectionné dans la note ouverte, la ligne **Avec la sélection** au-dessus de la saisie propose les mêmes actions.

Une action de proposition envoie uniquement le passage sélectionné — ni le reste de la note, ni les notes épinglées, ni les outils — et demande avec le même aperçu qu'une question. La réponse revient dans la note sous forme de série de propositions, comme celle d'une personne : sous **Propositions**, vous acceptez ou refusez chaque modification ou toute la série, et rien ne change dans la note avant. La ligne d'auteur de la série indique **Plainva IA · ⟨modèle⟩**, pour qu'on voie toujours quel passage une IA a écrit. **En faire des tâches** ajoute les tâches sous le passage au lieu de le remplacer. Chaque action garde sa conversation dans l'historique.

Un passage d'une note que vos règles tiennent à l'écart du cloud — ou un passage avec des liens vers de telles notes ou avec des indications de lieu — ne part vers aucun modèle cloud. Dans un espace chiffré, les actions de proposition ne sont pas encore disponibles : ses propositions ne peuvent pas encore nommer l'IA comme auteur.

## Compétences

Trois compétences lancent des questions courantes en un clic : **Orientation du jour** (ce qui compte aujourd'hui — tâches à échéance, rendez-vous et ce sur quoi vous avez travaillé récemment), **Bilan de la semaine** (les sept derniers jours et la semaine à venir) et **État du projet** (objectif, avancement, points ouverts et prochaine étape du projet de la note ouverte). Vous les trouvez sous forme de puces dans une conversation vide, sous **Compétences** dans l'onglet IA — sur le téléphone dans **Conversations** — et dans la palette de commandes. Une compétence envoie sa question comme votre message : dans votre langue, visible dans la conversation comme tout ce que vous tapez, et via le même aperçu. L'assistant cherche ensuite avec ses outils habituels.

## Transcrire une note vocale

Sur chaque note vocale — dans l'éditeur, en mode lecture, dans le journal et sur les cartes —, **Transcrire** transforme l'enregistrement en texte. Il part tel quel vers le modèle du profil **Audio**, via le même aperçu qu'une question ; un enregistrement est un type de données à part, l'aperçu demande donc la première fois. La transcription revient comme proposition sous l'enregistrement, avec l'auteur **Plainva IA · ⟨modèle⟩** — acceptez-la ou refusez-la sous **Propositions**.

**Audio** nécessite un fournisseur avec une voie audio : OpenAI (par exemple `gpt-4o-transcribe` ou `whisper-1`), Gemini ou votre propre serveur compatible — un serveur sur cet ordinateur garde l'enregistrement sur l'appareil. Les enregistrements jusqu'à 11 Mo peuvent être transcrits. Un enregistrement dans une note que vos règles tiennent à l'écart du cloud ne part vers aucun modèle cloud, et les espaces chiffrés ne le proposent pas encore.

## Règles de confidentialité

Certaines notes ne doivent jamais atteindre un fournisseur cloud. Une règle peut se trouver dans le frontmatter d'une note :

```yaml
plainva:
  ai:
    cloud: deny
```

ou, pour un dossier entier, dans **Paramètres → IA & automatisation** (la partie Vault), qui écrit les règles dans `.agent/policy.yml`. Une note tenue à l'écart du cloud n'apporte rien — ni texte, ni titre —, et les liens vers elle dans d'autres notes sont retenus. Les modèles sur cet appareil restent autorisés. Les espaces chiffrés tiennent le cloud à l'écart, sauf si vous l'y autorisez. Le format exact se trouve dans la [Référence du format de fichier](File_Format_Reference.md).

## Historique et utilisation

Les conversations restent sur cet appareil, par vault — jamais dans le vault et jamais synchronisées. **Conserver les conversations** détermine la durée ; vous pouvez supprimer une conversation isolée dans la liste, ou toutes celles d'un vault d'un coup. **Utilisation ce mois-ci** additionne les jetons par fournisseur et par modèle.

## Limites de la bêta

- Sur l'ordinateur, l'IA s'exécute uniquement dans la fenêtre principale.
- Sur le téléphone, une réponse n'arrive que si l'application est ouverte.
- L'assistant ne modifie rien lui-même : il propose des modifications d'un passage sélectionné et des transcriptions de notes vocales, sous forme de propositions que vous acceptez ou refusez.

Les retours sur la bêta vont dans les discussions du projet sur GitHub : **Retour sur l'IA (bêta)** dans les réglages en ouvre une.
