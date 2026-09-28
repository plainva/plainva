# Assistant IA (Bêta)

Dernière mise à jour : 2026-09-24

Plainva peut répondre à des questions sur vos notes avec un modèle d'IA de votre choix. Il lit votre vault, cite les notes sur lesquelles il s'appuie et peut ouvrir des notes et des vues pour vous — il ne change rien. L'assistant est **expérimental** et désactivé jusqu'à ce que vous l'activiez, séparément sur chaque appareil.

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

## Poser des questions

- **Ordinateur :** le bouton IA dans la barre d'actions, **Ctrl+J** (⌘J sous macOS) ou **Demander à l'IA** dans la palette de commandes ouvre le compagnon — une petite fenêtre au-dessus de votre travail. **Ouvrir en onglet** déplace la même conversation dans l'onglet IA, où vos conversations sont listées.
- **Téléphone :** **Demander à l'IA** dans le menu ⋮ d'une note ouvre la feuille IA au-dessus de cette note. La rubrique **IA** (dans « Rubriques », ou dans la barre de navigation si vous l'y placez) affiche la conversation en plein écran ; **Conversations** liste les précédentes.

La note que vous avez ouverte est jointe automatiquement ; retirez-la du contexte avec son ✕ si vous le souhaitez. **Épingler une note…** ajoute d'autres notes. L'assistant peut aussi chercher par lui-même : il parcourt le vault, lit des notes et leurs sections, liste des tâches et ouvre des notes et des vues. Il ne peut rien modifier, créer ou supprimer.

Chaque conversation commence par la ligne « Les réponses sont rédigées par une IA — ⟨modèle⟩ via ⟨fournisseur⟩ ». Sous chaque réponse, une ligne indique ce qui a été envoyé où : combien de notes, environ combien de jetons et — là où le fournisseur publie ses prix — le coût approximatif. **Arrêter** met fin à une réponse à tout moment.

Un lien dans une réponse ne s'ouvre qu'après confirmation de son adresse, et les images dans les réponses ne sont jamais chargées.

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
- L'assistant lit ; proposer des modifications sous forme de suggestions viendra dans une version ultérieure.
