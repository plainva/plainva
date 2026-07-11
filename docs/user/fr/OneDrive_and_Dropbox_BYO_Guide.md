# Configurer OneDrive & Dropbox (votre propre inscription d'application)

Dernière mise à jour : 2026-07-11

**Vous n'avez normalement pas besoin de cette page :** Plainva fournit ses propres IDs d'application pour OneDrive et Dropbox — vous choisissez le fournisseur, cliquez sur **Se connecter** et vous vous connectez. Ce guide concerne uniquement le cas **facultatif** où vous souhaitez utiliser votre propre (gratuite) inscription d'application (p. ex. en cas de restrictions d'entreprise). Dans les paramètres de synchronisation, affichez les champs d'ID via **Utiliser votre propre ID d'application**, puis saisissez une seule valeur publique :

- **OneDrive** → un **ID client** (format `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → une **Clé d'application** (une courte chaîne de caractères)

Les deux inscriptions sont gratuites, sans carte bancaire et sans abonnement payant. Vous n'avez **pas** besoin d'un mot de passe secret (secret client) — les valeurs ci-dessus sont publiques et peuvent être stockées sans risque.

Cette page est le complément détaillé aux versions courtes sous [Configurer la synchronisation](Sync_Setup.md).

> Les IDs fournis par Plainva sont déjà prérenseignés — vous n'avez besoin des parties A/B ci-dessous que pour votre **propre** inscription.

---

## Partie A — OneDrive (Microsoft Entra)

**Prérequis :** un compte Microsoft (celui-là même dont vous voulez synchroniser le OneDrive). À la première connexion, Microsoft crée automatiquement un annuaire gratuit pour vous — aucun abonnement Azure n'est nécessaire.

### 1. Ouvrir le portail

1. Rendez-vous sur **[entra.microsoft.com](https://entra.microsoft.com)** (`portal.azure.com` fonctionne aussi).
2. Connectez-vous avec votre compte Microsoft.

### 2. Créer une nouvelle inscription d'application

1. Menu **Identité → Applications → Inscriptions d'applications**, puis **+ Nouvelle inscription**.
2. **Nom :** libre, p. ex. `Plainva` (affichage uniquement).
3. **Types de comptes pris en charge :** choisissez **« Comptes dans un annuaire organisationnel quelconque … et comptes Microsoft personnels »**. Seule cette option correspond au point de terminaison de connexion de Plainva ; « cet annuaire uniquement » fait échouer les comptes OneDrive personnels.
4. **URI de redirection** — à faire directement ici :
   - Plateforme : **« Client public/natif (mobile et bureau) »**.
   - Valeur : `http://localhost` (exactement ainsi — sans port, sans barre oblique finale).

   > ⚠️ Ne choisissez pas « Web » ni « SPA ». « Web » exige un secret client, et la connexion échouera.
5. **Inscrire**.

### 3. Copier l'ID client

Sur la page **Vue d'ensemble** de l'application, copiez la valeur **« ID d'application (client) »** — c'est votre valeur pour Plainva. (L'« ID de répertoire (locataire) » n'est pas nécessaire.)

### 4. Autoriser les flux de client public

1. Menu **Authentification**.
2. Tout en bas, réglez **« Autoriser les flux de client public »** sur **Oui**.
3. **Enregistrer**.

### 5. Définir les autorisations

1. Menu **Autorisations API → + Ajouter une autorisation → Microsoft Graph → Autorisations déléguées**.
2. Cochez les deux :
   - `Files.ReadWrite`
   - `offline_access` (fournit le jeton de connexion longue durée — **sans lui**, Plainva refuse de se connecter)
3. **Ajouter**. Le consentement de l'administrateur n'est pas requis pour les comptes personnels ; vous y consentez vous-même lors de la connexion.

### Le saisir dans Plainva

1. **Paramètres → Vault → Synchronisation**.
2. Réglez le **Fournisseur de synchronisation** sur **OneDrive**.
3. Collez l'ID d'application copié dans le champ **ID client** ; définissez éventuellement le **Dossier OneDrive (nom)** (par défaut `Plainva`).
4. **Se connecter à Microsoft** → connectez-vous dans le navigateur et confirmez l'accès. Le navigateur vous indique ensuite que vous pouvez fermer la fenêtre.

---

## Partie B — Dropbox

**Prérequis :** un compte Dropbox.

### 1. Ouvrir la console des applications

1. Rendez-vous sur **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** et connectez-vous.
2. Cliquez sur **Create app**.

### 2. Choisir le type d'application

1. **Choose an API :** **Scoped access**.
2. **Type of access :** **Full Dropbox** — pas « App folder ».

   > ⚠️ **Full Dropbox** est requis : « App folder » ne voit qu'un sous-dossier isolé et ne trouvera pas les vaults existants ailleurs dans votre Dropbox.
3. **Name :** un nom unique au niveau mondial, p. ex. `Plainva-Sync-<votrenom>` (purement technique, personne d'autre ne le voit).
4. **Create app**.

### 3. Enregistrer l'URI de redirection

Onglet **Settings → OAuth 2 → Redirect URIs** : saisissez **exactement** `http://127.0.0.1:41953` et cliquez sur **Add**.

> ⚠️ Doit correspondre caractère pour caractère : `127.0.0.1` (pas `localhost`), port `41953`, pas de barre oblique finale. Plainva se lie exactement à ce port ; toute déviation interrompt la connexion.

### 4. Définir les autorisations

Onglet **Permissions** — cochez ce qui suit et cliquez sur **Submit** en bas :

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Si vous modifiez les autorisations plus tard, vous devez **vous reconnecter** dans Plainva, sinon les anciens droits restent appliqués.

### 5. Copier l'App key

Onglet **Settings** : copiez la valeur **App key** — c'est votre valeur pour Plainva. (L'« App secret » n'est pas nécessaire.)

> Votre application reste au statut « Development ». C'est suffisant pour un usage privé ; « Apply for production » n'est nécessaire que si de nombreuses autres personnes utilisent la même App key.

### Le saisir dans Plainva

1. **Paramètres → Vault → Synchronisation**.
2. Réglez le **Fournisseur de synchronisation** sur **Dropbox**.
3. Collez l'App key copiée dans le champ **Clé d'application** ; définissez éventuellement le **Dossier Dropbox (chemin)** (par défaut `/Plainva`).
4. **Se connecter à Dropbox** → connectez-vous dans le navigateur et confirmez l'accès.

---

## En cas de problème

| Symptôme | Cause | Solution |
|---|---|---|
| OneDrive : « Microsoft n'a renvoyé aucun refresh_token » | `offline_access` manquant | Étape A5 : ajoutez `offline_access`, puis **reconnectez-vous** |
| OneDrive : la connexion demande un secret / échoue | Plateforme « Web » au lieu de « Mobile et bureau » | Étape A2 : plateforme **Client public/natif**, redirection `http://localhost` |
| OneDrive : le compte personnel est rejeté | Mauvais type de compte | Étape A2 : choisissez « … et comptes Microsoft personnels » |
| Dropbox : la connexion reste bloquée / « redirect_uri mismatch » | Redirection non exacte | Étape B3 : exactement `http://127.0.0.1:41953` |
| Dropbox : « Port 41953 is in use » | Un autre programme bloque le port | Fermez l'application bloquante, réessayez |
| Dropbox : ne trouve pas le vault / droits manquants | « App folder » au lieu de « Full Dropbox », ou permissions non **Submit**tées | Vérifiez l'étape B2 / B4, puis **reconnectez-vous** |

## Voir aussi

- [Configurer la synchronisation](Sync_Setup.md) — version courte et les autres fournisseurs
- [Compatibilité de synchronisation](Sync_Compatibility.md) — quels services fonctionnent et comment
- [FAQ & dépannage](FAQ.md)
