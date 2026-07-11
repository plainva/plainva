# OneDrive & Dropbox einrichten (eigene App-Registrierung)

Stand: 2026-07-11

**Normalerweise brauchst Du diese Seite nicht:** Plainva liefert für OneDrive und Dropbox eigene App-IDs mit — Du wählst den Anbieter, klickst **Verbinden** und meldest Dich an. Diese Anleitung ist nur für den **optionalen** Fall, dass Du freiwillig eine **eigene** (kostenlose) App-Registrierung verwenden willst (z. B. bei Firmen-Sperren). In den Sync-Einstellungen blendest Du die ID-Felder über **Eigene App-ID verwenden** ein und trägst dann genau einen öffentlichen Wert ein:

- **OneDrive** → eine **Client-ID** (Format `00000000-0000-0000-0000-000000000000`)
- **Dropbox** → einen **App-Key** (kurze Zeichenkette)

Beide Registrierungen sind gratis, ohne Kreditkarte und ohne Bezahl-Abo. Ein geheimes Passwort (Client-Secret) brauchst Du **nicht** — die genannten Werte sind öffentlich und dürfen gefahrlos gespeichert werden.

Diese Seite ist die ausführliche Ergänzung zu den Kurzfassungen unter [Sync einrichten](Sync_Setup.md).

> Die von Plainva mitgelieferten IDs sind bereits vorbefüllt — die folgenden Teile A/B brauchst Du nur für eine **eigene** Registrierung.

---

## Teil A — OneDrive (Microsoft Entra)

**Voraussetzung:** ein Microsoft-Konto (dasselbe, dessen OneDrive Du synchronisieren willst). Beim ersten Anmelden legt Microsoft automatisch ein kostenloses Verzeichnis für Dich an — ein Azure-Abo ist nicht nötig.

### 1. Portal öffnen

1. Öffne **[entra.microsoft.com](https://entra.microsoft.com)** (alternativ funktioniert auch `portal.azure.com`).
2. Melde Dich mit Deinem Microsoft-Konto an.

### 2. Neue App-Registrierung anlegen

1. Menü **Identität → Anwendungen → App-Registrierungen**, dann **+ Neue Registrierung**.
2. **Name:** frei wählbar, z. B. `Plainva` (nur eine Anzeige).
3. **Unterstützte Kontotypen:** wähle **„Konten in einem beliebigen Organisationsverzeichnis … und persönliche Microsoft-Konten"**. Nur diese Option passt zu Plainvas Anmelde-Endpunkt; „nur dieses Verzeichnis" lässt private OneDrive-Konten scheitern.
4. **Umleitungs-URI (Redirect URI)** gleich hier mit erledigen:
   - Plattform: **„Öffentlicher Client/nativ (mobil und Desktop)"**.
   - Wert: `http://localhost` (genau so — ohne Port, ohne Schrägstrich am Ende).

   > ⚠️ Nicht „Web" oder „SPA" wählen. „Web" verlangt ein Client-Secret, und die Anmeldung schlägt fehl.
5. **Registrieren**.

### 3. Client-ID kopieren

Auf der **Übersicht** der App den Wert **„Anwendungs-(Client-)ID"** kopieren — das ist Dein Wert für Plainva. (Die „Verzeichnis-/Tenant-ID" brauchst Du nicht.)

### 4. Öffentliche Client-Flows erlauben

1. Menü **Authentifizierung**.
2. Ganz unten **„Öffentliche Clientflows zulassen"** auf **Ja** stellen.
3. **Speichern**.

### 5. Berechtigungen setzen

1. Menü **API-Berechtigungen → + Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**.
2. Beide anhaken:
   - `Files.ReadWrite`
   - `offline_access` (liefert das dauerhafte Anmelde-Token — **ohne** dieses verweigert Plainva die Verbindung)
3. **Hinzufügen**. Eine Administratorzustimmung ist bei privaten Konten nicht nötig; Du stimmst bei der Anmeldung selbst zu.

### In Plainva eintragen

1. **Einstellungen → Vault → Synchronisation**.
2. **Sync Provider** auf **OneDrive** stellen.
3. Ins Feld **Client ID** die kopierte Anwendungs-ID einfügen; optional **OneDrive-Ordner (Name)** (Standard `Plainva`).
4. **Mit Microsoft verbinden** → im Browser anmelden und Zugriff bestätigen. Der Browser meldet danach, dass Du das Fenster schließen kannst.

---

## Teil B — Dropbox

**Voraussetzung:** ein Dropbox-Konto.

### 1. App-Konsole öffnen

1. Öffne **[dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** und melde Dich an.
2. Klicke **Create app**.

### 2. App-Typ wählen

1. **Choose an API:** **Scoped access**.
2. **Type of access:** **Full Dropbox** — nicht „App folder".

   > ⚠️ **Full Dropbox** ist Pflicht: „App folder" sieht nur einen isolierten Unterordner und findet bestehende Vaults im Rest Deiner Dropbox nicht.
3. **Name:** ein weltweit eindeutiger Name, z. B. `Plainva-Sync-<Deinname>` (rein technisch, sieht sonst niemand).
4. **Create app**.

### 3. Redirect-URI eintragen

Reiter **Settings → OAuth 2 → Redirect URIs**: **exakt** `http://127.0.0.1:41953` eintragen und **Add** klicken.

> ⚠️ Muss zeichengenau stimmen: `127.0.0.1` (nicht `localhost`), Port `41953`, kein Schrägstrich am Ende. Plainva bindet genau diesen Port; jede Abweichung bricht die Anmeldung ab.

### 4. Berechtigungen setzen

Reiter **Permissions** — folgende anhaken und unten **Submit** klicken:

- `files.metadata.read`
- `files.content.read`
- `files.content.write`

> ⚠️ Änderst Du die Berechtigungen später, musst Du Dich in Plainva **neu verbinden**, sonst gelten die alten Rechte weiter.

### 5. App-Key kopieren

Reiter **Settings**: den Wert **App key** kopieren — das ist Dein Wert für Plainva. (Das „App secret" brauchst Du nicht.)

> Deine App bleibt im Status „Development". Für die private Nutzung reicht das; „Apply for production" ist nur nötig, wenn viele fremde Nutzer denselben App-Key verwenden sollen.

### In Plainva eintragen

1. **Einstellungen → Vault → Synchronisation**.
2. **Sync Provider** auf **Dropbox** stellen.
3. Ins Feld **App-Key** den kopierten App-Key einfügen; optional **Dropbox-Ordner (Pfad)** (Standard `/Plainva`).
4. **Mit Dropbox verbinden** → im Browser anmelden und Zugriff bestätigen.

---

## Wenn etwas klemmt

| Symptom | Ursache | Lösung |
|---|---|---|
| OneDrive: „Microsoft hat keinen refresh_token geliefert" | `offline_access` fehlt | Schritt A5: `offline_access` ergänzen, dann **Neu verbinden** |
| OneDrive: Login verlangt ein Secret / schlägt fehl | Plattform „Web" statt „Mobil und Desktop" | Schritt A2: Plattform **Öffentlicher Client/nativ**, Redirect `http://localhost` |
| OneDrive: privates Konto wird abgelehnt | falscher Kontotyp | Schritt A2: „… und persönliche Microsoft-Konten" wählen |
| Dropbox: Anmeldung hängt / „redirect_uri mismatch" | Redirect nicht exakt | Schritt B3: genau `http://127.0.0.1:41953` |
| Dropbox: „Port 41953 ist belegt" | anderes Programm blockiert den Port | blockierende Anwendung schließen, erneut verbinden |
| Dropbox: findet Vault nicht / Rechte fehlen | „App folder" statt „Full Dropbox", oder Permissions nicht **Submit** | Schritt B2 / B4 prüfen, dann **Neu verbinden** |

## Siehe auch

- [Sync einrichten](Sync_Setup.md) — Kurzfassung und die übrigen Anbieter
- [Sync-Kompatibilität](Sync_Compatibility.md) — welche Dienste wie funktionieren
- [FAQ & Fehlerbehebung](FAQ.md)
