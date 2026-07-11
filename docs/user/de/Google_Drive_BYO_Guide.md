# Google Drive Sync einrichten (Bring Your Own Credentials)

Um in Plainva einen lokalen Vault mit Deinem Google Drive zu synchronisieren, kannst Du eigene Google API Zugangsdaten ("Credentials") verwenden. Da Plainva (noch) keine zentrale CASA-Verifizierung durch Google durchlaufen hat, bietet dieser **Bring Your Own Credentials (BYO)** Ansatz eine sichere Methode, um Deine privaten Dateien zu synchronisieren.

Du richtest Dir hierbei quasi ein eigenes "Entwicklerprojekt" bei Google ein, das ausschließlich Dir gehört und auf das nur Du Zugriff hast.

## Schritt-für-Schritt Anleitung

### 1. Projekt in der Google Cloud Console erstellen
1. Gehe zur [Google Cloud Console](https://console.cloud.google.com/).
2. Melde Dich mit Deinem Google-Konto an.
3. Klicke oben links (neben dem Google Cloud Logo) auf das Dropdown-Menü für Projekte und wähle **Neues Projekt**.
4. Gib einen Namen ein (z.B. "Plainva Sync") und klicke auf **Erstellen**.

### 2. Google Drive API aktivieren
1. Wähle Dein neu erstelltes Projekt oben im Dropdown aus.
2. Suche in der oberen Suchleiste nach **Google Drive API** und wähle den Eintrag unter "Marketplace" aus.
3. Klicke auf **Aktivieren**.

### 3. OAuth-Zustimmungsbildschirm konfigurieren
Damit Plainva Deine Credentials nutzen kann, muss ein Zustimmungsbildschirm ("OAuth Consent Screen") angelegt werden. Da nur Du die App nutzt, bleibt dieser im "Testmodus".

1. Gehe im linken Seitenmenü unter **APIs & Dienste** auf **OAuth-Zustimmungsbildschirm**.
2. Wähle unter "User Type" **Extern** aus (es sei denn, Du nutzt Google Workspace) und klicke auf **Erstellen**.
3. **App-Informationen:**
   - App-Name: z.B. "Plainva"
   - Nutzersupport-E-Mail: Deine eigene E-Mail
   - Kontaktdaten des Entwicklers: Deine eigene E-Mail
   - Klicke auf **Speichern und fortfahren**.
4. **Bereiche (Scopes):**
   - Klicke auf **Bereiche hinzufügen oder entfernen**.
   - Suche nach `.../auth/drive` (Google Drive API, voller Zugriff) und setze das Häkchen. 
   - *Hintergrund: Der volle Zugriff wird benötigt, damit Plainva auch Dateien synchronisieren kann, die Du direkt über die Google Drive Weboberfläche in Deinen Sync-Ordner legst.*
   - Klicke auf Aktualisieren, dann auf **Speichern und fortfahren**.
5. **Testnutzer:**
   - Klicke auf **Users hinzufügen**.
   - Trage exakt die Google-Mailadresse ein, mit der Du später den Sync in Plainva nutzen willst.
   - Klicke auf **Speichern und fortfahren**, dann zurück zum Dashboard.

*Wichtig: Belasse den Status auf "Testing" (Testing-Modus). Du musst die App NICHT veröffentlichen. Im Testing-Modus laufen die Tokens nach 7 Tagen ab – Plainva erneuert diese automatisch im Hintergrund, allerdings musst Du Dich bei signifikanten Änderungen oder Scope-Wechseln gegebenenfalls neu einloggen.*

### 4. Zugangsdaten (Client ID & Secret) erstellen
1. Gehe links im Menü auf **Zugangsdaten** (Credentials).
2. Klicke oben auf **Zugangsdaten erstellen** und wähle **OAuth-Client-ID**.
3. Als "Anwendungstyp" wähle **Desktop-Anwendung** (oder "Sonstige UI").
4. Name: z.B. "Plainva Desktop Client".
5. Klicke auf **Erstellen**.
6. Ein Popup öffnet sich und zeigt Dir Deine **Client-ID** und Dein **Client-Secret** an.

### 5. In Plainva eintragen
1. Öffne Plainva und wechsle in die Vault-Einstellungen (Zahnrad-Symbol für den jeweiligen Vault).
2. Gehe in den Bereich **Synchronisation**.
3. Wähle als Anbieter **Google Drive** aus.
4. Trage die kopierte **Client-ID** und das **Client-Secret** in die vorgesehenen Felder ein.
5. Klicke auf **Verbinden**.
6. Es öffnet sich ein Browserfenster von Google. Melde Dich mit dem Account an, den Du unter "Testnutzer" eingetragen hast.
7. Google zeigt ggf. eine Warnung an, dass die App nicht verifiziert ist. Klicke auf **Erweitert** und dann auf **Weiter zu Plainva (unsicher)**.
8. Bestätige die angeforderten Berechtigungen.

Dein Vault wird nun sicher über Deine eigenen Credentials mit Google Drive synchronisiert.
