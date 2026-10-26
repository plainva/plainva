# Google Drive Sync einrichten (Bring Your Own Credentials)

Stand: 2026-10-26

Plainva meldet sich mit der **Anmeldung auf diesem Gerät** bei Google an. Enthält Dein Build die **Standard-Anmeldung** für Google, trägst Du nichts ein und brauchst diese Seite nicht. Andernfalls — oder wenn Du lieber ein eigenes Projekt nutzt — verwendest Du eigene Google API Zugangsdaten ("Credentials"): Dieser **Bring Your Own Credentials (BYO)** Ansatz bietet eine sichere Methode, um Deine privaten Dateien zu synchronisieren.

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
3. Als "Anwendungstyp" wähle **Desktop-Anwendung** für Plainva am Rechner. Für das Telefon (Android und iPhone) legst Du stattdessen einen Client vom Typ **iOS** an — siehe das Ende dieser Seite.
4. Name: z.B. "Plainva Desktop Client".
5. Klicke auf **Erstellen**.
6. Ein Popup öffnet sich und zeigt Dir Deine **Client-ID** und Dein **Client-Secret** an.

### 5. In Plainva eintragen
1. Öffne **Einstellungen → Dein Vault → Cloud-Konten**.
2. Für ein neues Konto wähle **Konto verbinden…** → die Kachel **Google** und hake die Dienste an; bei einem Konto, das Du schon hast, öffne es und wähle **Ändern** bei **Anmeldung auf diesem Gerät**.
3. Wähle **Eigene Client-ID** und trage die kopierte **Client ID** und das **Client Secret** ein — am Telefon nur die **Client ID** des iOS-Clients; er hat kein Secret. Dann **Speichern**.
4. Klicke auf **Bei Google anmelden…** (bei einem Konto, das Du schon hast: **Erneut anmelden**).
5. Es öffnet sich ein Browserfenster von Google. Melde Dich mit dem Account an, den Du unter "Testnutzer" eingetragen hast.
6. Google zeigt ggf. eine Warnung an, dass die App nicht verifiziert ist. Klicke auf **Erweitert** und dann auf **Weiter zu Plainva (unsicher)**.
7. Bestätige die angeforderten Berechtigungen — eine Zustimmung deckt alle angehakten Dienste ab.
8. Die eigene Client-ID gilt nur für dieses Gerät; andere Geräte behalten ihre Einstellung. Trag sie auf jedem Gerät ein, das Dein Projekt nutzen soll.

Dein Vault wird nun sicher über Deine eigenen Credentials mit Google Drive synchronisiert.

<!-- accounts-tasks-2026-09-11 -->
## Google OAuth — Desktop / Android / iOS

Die Desktop-Anleitung oben benötigt einen Desktop-Client mit Client-ID und zugehörigem Client-Secret. Am Telefon, unter Android wie unter iOS, meldet sich Plainva im Browser bei Google an: Lege in Deinem Google-Projekt einen OAuth-Client vom Typ **iOS** an, auch für Android, mit der Bundle-ID `com.plainva.app`. Plainva kehrt über `com.plainva.app:/oauth2redirect` zurück; ein Client-Secret gibt es nicht. Trage die Client-ID am Telefon unter **Anmeldung auf diesem Gerät** → **Eigene Client-ID** ein. Lege keinen Client vom Typ Android an: Google lässt Paketname und Zertifikatfingerabdruck des Play-Builds weltweit in genau einem Projekt zu und lehnt jedes weitere ab („der Android-Paketname und der Fingerabdruck werden bereits verwendet“). Ein Android-Client, der für Plainva 0.8.3 oder 0.8.4 eingerichtet wurde, funktioniert für eine neue Anmeldung nicht; bereits angemeldete Konten laufen weiter. Ein Desktop-Client ersetzt die mobile Registrierung nicht. Für Kalender aktiviere zusätzlich die Google Calendar API und die Google Tasks API. Zeigt Google am Telefon „Fehler 400: redirect_uri_mismatch“, ist die Client-ID vom Typ „Desktop-App“: Lege wie hier beschrieben einen Client vom Typ **iOS** an und trage stattdessen dessen Client-ID ein. Unter dem Feld für die Client-ID führt **Anleitung von Google öffnen** zu diesem Abschnitt.

[Google: iOS / Desktop](https://developers.google.com/identity/protocols/oauth2/native-app) · [Google: Android](https://developer.android.com/identity/authorization)



Füge Dateien, Kalender oder E-Mail direkt bei dem Konto hinzu, das sie tragen soll. Bei Google und Microsoft ist das eine Zustimmung für alles, was das Konto trägt, und den neuen Dienst.

Die Google-Registrierung passt nicht zum Rückkehrweg dieses Geräts. Prüfe den Client-Typ und die mobile Einrichtung in der Google-Anleitung.

<!-- account-grants-destination-2026-09-14 -->
Plainva kann aus einem allgemeinen Anmeldefehler weder den Veröffentlichungsstatus noch die Testnutzerliste Deines Google-Projekts erkennen. Prüfe diese Angaben in Google Cloud und beachte die konkrete Anbietermeldung. Der Desktop-Client benötigt Client-ID und den zugehörigen Client-Secret-Wert; die mobile Registrierung richtet sich nach Plattform und installiertem Build.
