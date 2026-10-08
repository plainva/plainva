# Scripts (Bêta)

Dernière mise à jour : 2026-10-08

Un script est un petit programme pour ce qu'un modèle fait mal et qu'un programme exécute chaque fois de la même façon : compter, trier, comparer, additionner. Vous l'écrivez en JavaScript. Il s'exécute dans une boîte fermée à l'intérieur de Plainva : il ne peut ni ouvrir un fichier, ni accéder au réseau, ni remettre quoi que ce soit à plus tard. Il n'appelle que les outils que vous avez cochés pour lui, et ceux-ci lisent votre vault comme le font les outils de l'IA. Un script ne modifie rien.

## Exécuter un script

Vos scripts se trouvent sous **Compétences** dans l'onglet IA — sur le téléphone sous **Conversations → Compétences** — dans le groupe **Scripts**. Avec **Exécuter**, vous ouvrez le script : renseignez ce qu'il demande, puis appuyez sur **Exécuter**. Pendant l'exécution, vous voyez chaque outil qu'il appelle, et le bouton **Arrêter** y met fin. Ensuite, la boîte de dialogue affiche les **Appels**, le **Résultat** — que vous pouvez copier — et le **Journal**, ainsi que ce que l'exécution a consommé de ses limites.

Une exécution que vous lancez ici reste sur cet appareil : rien n'en part vers un modèle, elle lit donc aussi les notes que vous tenez à l'écart du cloud. Avec **Essai à blanc**, le script appelle les outils qui lisent et se contente de noter un appel qui afficherait quelque chose dans l'app.

## Dans une conversation

Dans une conversation ordinaire, l'IA peut trouver vos scripts actifs et en exécuter un quand cela convient ; l'étape s'affiche alors ainsi : **Exécution du script « word-count »**. Le script ne lit que ce que cette conversation a le droit de lire : une note que vous tenez à l'écart du cloud le reste, et chaque note que le script lit compte parmi ce que l'exécution a lu. Ce qu'il renvoie va au modèle comme des données, jamais comme des instructions. Aucun script n'est proposé à une conversation lancée avec une compétence, ni à une app d'IA connectée par le serveur MCP.

## Écrire un script

**Nouveau script** demande :

- **Nom** — des minuscules, des chiffres et des tirets ; il devient le nom du dossier.
- **Description** — à quoi sert le script ; c'est à cela que vous le reconnaissez, et l'IA aussi.
- **Outils** — cochez ce que le script peut appeler. Rien d'autre n'existe pour lui.
- **Entrées** — ce que le script demande au démarrage : un nom, s'il s'agit d'un texte, d'un nombre ou d'un choix oui ou non, et si c'est obligatoire.
- **Limites** — secondes de calcul, appels d'outils et mémoire.
- **Code** — le programme.

**Créer et approuver** écrit le script dans `.agent/scripts/<name>/` de votre vault — un `manifest.json` et un `main.js` — et l'approuve sur cet appareil. **Modifier**, dans le menu d'un script, ouvre le même formulaire ; **Enregistrer et approuver** remplace les fichiers.

Le code est le corps d'une fonction. `input` contient les entrées, chacune sous son nom, `tools.<name>(…)` appelle un outil dont il faut attendre la réponse, `return` renvoie le résultat, et `console.log(…)` écrit une ligne dans le journal :

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

Le langage est JavaScript, dans la version ES2020. Il n'y a ni `fetch`, ni minuteur, ni `import`, ni accès aux fichiers, et ce qu'un script renvoie doit être des données qui peuvent s'écrire en JSON. Un outil qui refuse — une note qui n'existe pas, une note que la conversation n'a pas le droit de lire — lève une erreur que le script peut intercepter.

## Ce que renvoie un outil

Dans le formulaire, **Ce que renvoie un outil** ouvre cette page. Chaque outil reçoit un objet et en renvoie un ; `cursor` reprend le `next` de l'appel précédent et poursuit sa liste.

| Outil | Vous transmettez | Vous obtenez |
|---|---|---|
| `search_vault` — **Recherche dans le vault** | `query` ; facultatifs : `folder`, `limit` (jusqu'à 25), `cursor` | `results` : une liste de `{ title, path, snippet }` ; `next` |
| `read_note` — **Lecture d'une note** | `path` ; facultatifs : `section`, `maxChars` (de 200 à 20 000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Lecture du plan** | `path` | `path` ; `properties` : nom et valeur ; `sections` : une liste de `{ level, text, section }` |
| `query_base` — **Lecture d'une base de données** | `base`, le chemin du fichier `.base` ; facultatifs : `view`, `limit` (jusqu'à 50), `cursor` | `base`, `view`, `views` ; `rows` : une liste de `{ title, path, properties }` ; `next` |
| `get_tasks` — **Lecture des tâches** | facultatifs : `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (jusqu'à 50), `cursor` | `tasks` : une liste de `{ state, title, due, priority, path, note, source }` ; `next` |
| `get_backlinks` — **Lecture des backlinks** | `path` ; facultatifs : `limit` (jusqu'à 50), `cursor` | `path` ; `notes` : une liste de `{ title, path, links, places }` ; `next` |
| `graph_neighborhood` — **Suivi des liens** | `path` ; facultatifs : `depth` (1 ou 2), `limit` (jusqu'à 50) | `path` ; `notes` : une liste de `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Consultation des notes récentes** | facultatifs : `kind` (`opened` ou `edited`), `limit` (jusqu'à 20) | `kind` ; `notes` : une liste de `{ title, path, at }` |
| `get_calendar` — **Lecture des rendez-vous** | `from` et `to` au format `YYYY-MM-DD` ; facultatifs : `details`, `limit` (jusqu'à 100) | `events` : une liste de `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }` ; `more` |
| `run_command` — **Utilisation de l'application** | `id`, une commande de l'app comme `open-note`, `show-in-graph` ou `open-calendar` ; facultatif : `args` avec `path`, `section` ou `date` | `done`, `command` |

## Limites

Un script porte ses limites dans son manifeste. Le formulaire en fixe trois :

| Limite | Par défaut | Plage autorisée |
|---|---|---|
| **Secondes de calcul** | 5 | 1 à 30 |
| **Appels d'outils** | 20 | 0 à 50 |
| **Mémoire en Mo** | 32 | 8 à 128 |

Seul compte le temps pendant lequel un script calcule, pas celui qu'un outil met à répondre. Un script qui dépasse une limite est arrêté, la boîte de dialogue dit laquelle, et un script arrêté ne renvoie rien. Les arguments d'un appel et le résultat ne peuvent chacun dépasser 64 Ko.

## Rien ne s'exécute avant votre approbation

Un script nouveau ou modifié — par la synchronisation, ou écrit par un autre programme — ne s'exécute pas tant que vous ne l'avez pas approuvé **sur cet appareil**. Il attend en haut de **Compétences**, sous **En attente de votre approbation**. **Vérifier et approuver** montre **Ce qu'il peut faire**, ses **Limites**, son **Entrée** et tout le **Code**, et indique si le code peut être lu comme du JavaScript ; un code qui ne peut pas l'être n'est pas approuvé.

Avec **Approuver**, cet appareil signe exactement ces fichiers. La clé nécessaire est créée sur cet appareil et conservée dans son trousseau. Toute modification d'un fichier annule l'approbation, et sur chacun de vos autres appareils le script attend sa propre approbation — une approbation ne peut pas passer d'un appareil à un autre. **Retirer l'approbation**, dans le menu d'un script, la révoque, et **Voir le code** affiche de nouveau la vérification.

## Limites de la bêta

Les scripts ne font que lire : ils ne proposent aucune modification. Une compétence ne peut pas lancer de script, et le dossier `scripts/` propre à une compétence n'est pas exécuté. Les e-mails, Internet et les outils des serveurs externes ne sont pas disponibles pour les scripts.
