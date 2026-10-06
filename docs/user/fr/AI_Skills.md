# Compétences (Bêta)

Dernière mise à jour : 2026-10-06

Une compétence est un ensemble d'instructions pour un travail qui revient : préparer une réunion, trier vos tâches, un bilan de la semaine. Plainva en fournit dix, et vous pouvez écrire les vôtres. Les compétences utilisent le format ouvert Agent Skills — un dossier avec un `SKILL.md` — et fonctionnent donc aussi dans d'autres apps d'IA qui lisent ce format.

## Utiliser une compétence

Lancez une compétence en un clic : sous forme de puce dans une conversation vide (les trois plus utilisées), sous **Compétences** dans l'onglet IA, sur le téléphone sous **Conversations → Compétences**, ou depuis la palette de commandes. La conversation se déroule alors avec la compétence : ses instructions l'accompagnent, et elle n'utilise que les outils et les dossiers qu'elle nomme.

Vous pouvez aussi simplement demander. Dans chaque conversation, l'IA connaît les noms et les descriptions de vos compétences actives et en charge une quand votre question s'y prête — « prépare ma prochaine réunion » suffit.

## Les compétences fournies avec Plainva

| Compétence | Ce qu'elle fait |
|---|---|
| **Orientation du jour** | Ce qui compte aujourd'hui : tâches à échéance, rendez-vous et ce sur quoi vous avez travaillé récemment. |
| **Bilan de la semaine** | Les sept derniers jours et la semaine à venir, avec trois suggestions. |
| **État du projet** | Objectif, avancement, points ouverts et prochaine étape d'un projet. |
| **Préparer une réunion** | Prépare une réunion à partir de notes antérieures et de points ouverts, ou en fait le compte rendu ensuite. |
| **Trier les tâches** | Classe vos tâches ouvertes : maintenant, plus tard, à abandonner. |
| **Écrire et réviser** | Résume, raccourcit ou réécrit une note — un texte que vous reprenez. |
| **Entretenir les connaissances** | Trouve les notes qui disent la même chose, sont dépassées ou ne sont reliées à rien. |
| **Nettoyer les liens** | Vérifie les liens d'une note : qui ne mènent nulle part, manquants, à sens unique. |
| **Vérifier la confidentialité** | Trouve ce qui, dans une note, devrait rester sur cet appareil, et propose une règle. |
| **Réflexion** | Revient avec vous sur les notes d'une journée ou d'une semaine — avec bienveillance, jamais un diagnostic. |

Toutes ne font que lire : aucune ne modifie une note, n'envoie quoi que ce soit ni ne va sur internet. Vérifier la confidentialité et Réflexion sont prévues pour un modèle sur cet appareil ; avec un modèle cloud, l'aperçu d'envoi le signale. Désactivez n'importe quelle compétence sous **Compétences** — l'interrupteur vaut pour ce vault sur cet appareil. **Créer votre propre version** en copie une dans votre vault, où vous pouvez la modifier.

## Vos propres compétences

**Nouvelle compétence** demande un nom, une description — l'IA choisit la compétence d'après elle — et les instructions. Plainva les écrit dans `.agent/skills/<nom>/SKILL.md` de votre vault, où elles voyagent avec lui comme n'importe quelle note. **Modifier** ouvre le fichier comme une note.

**Importer…** accepte une compétence sous forme de fichier `.zip` ou `.skill`. Avant d'écrire quoi que ce soit, Plainva la vérifie : exactement une compétence au format, aucun chemin hors de son dossier, les limites de taille. Il indique la licence, les scripts qu'il n'exécutera pas et les outils qu'il n'a pas. Les fichiers cachés — dont le nom commence par un point — ne font pas partie d'une compétence et sont laissés de côté.

## Rien ne s'exécute avant votre approbation

Une compétence de votre vault qui est nouvelle ou modifiée — par la synchronisation, une importation ou une modification sur cet appareil ou un autre — ne s'exécute pas tant que vous ne l'avez pas approuvée **sur cet appareil**. Ces compétences attendent en haut de **Compétences**, sous **En attente de votre approbation**, et dans **Paramètres → IA & automatisation** (la partie Vault). **Vérifier et approuver** montre ce que la compétence peut faire, ce qui a changé depuis votre dernière approbation, ses instructions, ses fichiers et où elle se trouve. L'approbation vaut exactement pour cette version ; toute modification l'annule. Les approbations sont enregistrées sur cet appareil, jamais dans le vault.

Il en va de même pour un `AGENTS.md` à la racine de votre vault : une fois approuvé, ses instructions permanentes accompagnent chaque nouvelle conversation. Ni une compétence ni `AGENTS.md` ne peuvent lever vos règles de confidentialité, et une compétence n'obtient jamais plus que ce dont dispose une conversation — elle ne peut que le restreindre.

## Tester des compétences avec un modèle

Une compétence peut apporter des scénarios de test : un message qui la lance, et ce que fait une bonne exécution. Les compétences fournies en ont ; pour les vôtres, écrivez-les dans `tests/scenarios.json`, dans le dossier de la compétence :

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` nomme les outils qu'une bonne exécution utilise et ceux qu'elle ne doit pas toucher ; `cites`, les notes que sa réponse cite ; `never`, du texte qui ne doit pas y apparaître. Une compétence a au plus huit scénarios.

**Tester avec ⟨modèle⟩** — en bas de **Compétences**, ou dans le menu d'une compétence — exécute les scénarios avec le modèle qu'utiliserait une nouvelle conversation. Rien ne démarre tout seul : la boîte de dialogue indique d'abord combien de scénarios s'exécuteraient et avec quel modèle, et vous fixez un **Plafond** en dollars américains ; le test s'arrête entre deux scénarios dès qu'il est atteint. Si aucun prix n'est connu pour le modèle, le test s'arrête après un nombre fixe de jetons ; un modèle sur cet appareil n'a pas besoin de plafond.

Chaque scénario est une exécution ordinaire de sa compétence : il lit votre vault comme une exécution à la main, passe par le même aperçu avant l'envoi, compte dans votre consommation et laisse sa conversation dans l'historique, où sa prochaine exécution la remplace. Ensuite, chaque scénario affiche son résultat en toutes lettres, et la ligne de la compétence indique comment s'est passée sa dernière exécution. Un résultat vaut pour un modèle et une version de la compétence : si vous choisissez un autre modèle ou modifiez la compétence, la ligne le dit au lieu d'afficher un résultat qui ne compte plus. Certains scénarios fournis portent sur des notes du vault de test de Plainva ; dans votre vault ils ne s'appliquent pas, et la boîte de dialogue les compte à part au lieu de les considérer comme échoués.

## Ce qui part chez le fournisseur

L'aperçu d'envoi indique sous **Instructions** ce qui accompagne la demande : la compétence de la conversation, la liste des compétences que l'IA peut charger, et `AGENTS.md`. Si des instructions de votre vault partent pour la première fois vers un cloud, l'aperçu revient. Les caractères invisibles d'une compétence n'atteignent jamais un modèle.

## Limites de la bêta

Les compétences n'exécutent aucun script, et celles qui ont besoin du web ou de votre courrier viendront plus tard. Vos propres compétences ne sont pas proposées aux apps d'IA connectées par le serveur MCP ; seules celles fournies avec Plainva le sont.
