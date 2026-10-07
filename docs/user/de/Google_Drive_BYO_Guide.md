# Google Drive Sync einrichten (Bring Your Own Credentials)

Stand: 2026-10-07

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

*Wichtig: Du musst die App NICHT veröffentlichen — im Status "Testing" funktioniert sie vollständig. Rechne dann aber damit, dass Google die Anmeldung nach **7 Tagen** verfallen lässt, und zwar endgültig: In diesem Modus läuft auch der Erneuerungs-Token ab, Plainva kann ihn im Hintergrund also nicht auffrischen. Plainva sagt Dir das dann im Klartext („Anmeldung abgelaufen"), und **Erneut anmelden** in den Konto-Details stellt sie in einem Durchgang für alle Dienste dieses Kontos wieder her.*

Der Status **In Produktion** beseitigt die feste Ablaufzeit des Testmodus. Er garantiert keine dauerhafte Anmeldung: Google kann Zugänge weiterhin ablaufen lassen oder widerrufen. Die Anforderungen für Veröffentlichung und Verifizierung hängen von der Nutzung und den angeforderten Rechten ab. [Google: Ablauf von Erneuerungs-Tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

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

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

Die Desktop-Anleitung oben benötigt einen Desktop-Client mit Client-ID und zugehörigem Client-Secret. Android verwendet Google Identity Services: Registriere das Paket `com.plainva.app` mit dem SHA-1-Zertifikat des tatsächlich installierten Builds. Bei Play-Builds zählt das App-Signing-Zertifikat; ein lokal signierter Build kann ein anderes haben. Android verwendet keinen Browser-Rücksprung und kein Client-Secret. Unter iOS verwende einen iOS-Client mit Bundle-ID `com.plainva.app` und dem Rücksprung `com.plainva.app:/oauth2redirect`. Ein Desktop-Client ersetzt keine mobile Registrierung. Aktiviere für den Kalender auch Google Calendar API und Google Tasks API.

**Android seit Plainva 0.8.3:** Frühere Versionen meldeten sich im Browser mit einer Client-ID bei Google an. Ein Google-Projekt, das dafür eingerichtet wurde, hat keinen Android-Client, und die Anmeldung scheitert jetzt direkt nach der Kontoauswahl. Dort, wo Du ein Google-Konto hinzufügst, zeigt Plainva **Paketname** und **SHA-1-Zertifikatfingerabdruck** des installierten Builds, jeweils mit **Kopieren**. Lege im selben Google-Projekt einen OAuth-Client vom Typ Android mit genau diesen beiden Werten an. Fehlt er, meldet Plainva, dass Google diese Installation nicht akzeptiert; „**Anmeldung abgebrochen.**“ erscheint nur, wenn Du Googles Dialog selbst schließt. Ein Build aus Google Play und eine Installationsdatei von GitHub können mit verschiedenen Zertifikaten signiert sein; dann braucht jeder seinen eigenen Android-Client.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Füge Dateien, Kalender oder E-Mail direkt beim passenden Konto hinzu. Plainva prüft die gewählte Anmeldung und fragt fehlende Rechte gezielt an.

Die Google-Registrierung passt nicht zum Rückkehrweg dieses Geräts. Prüfe den Client-Typ und die mobile Einrichtung in der Google-Anleitung.

<!-- account-grants-destination-2026-09-14 -->
Plainva kann aus einem allgemeinen Anmeldefehler weder den Veröffentlichungsstatus noch die Testnutzerliste Deines Google-Projekts erkennen. Prüfe diese Angaben in Google Cloud und beachte die konkrete Anbietermeldung. Der Desktop-Client benötigt Client-ID und den zugehörigen Client-Secret-Wert; die mobile Registrierung richtet sich nach Plattform und installiertem Build.
