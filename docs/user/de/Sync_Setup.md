# Sync einrichten

Stand: 2026-08-11
Plainva synchronisiert jeden Vault optional mit einem Speicher Deiner Wahl — direkt aus der App, ohne Zusatzdienst von Plainva: Deine Daten laufen ausschließlich zwischen Deinem Rechner und Deinem eigenen Konto/Server. Diese Seite führt durch die Einrichtung je Anbieter.

Welche Dienste grundsätzlich funktionieren (auch über WebDAV oder den Desktop-Client des Anbieters), steht in der [Sync-Kompatibilität](Sync_Compatibility.md).

## Grundlagen

- Einrichtung unter **Einstellungen → Dein Vault → Cloud-Konten**: **Konto verbinden…** öffnet den Assistenten — erst den **Anbieter** wählen, dann die **Dienste** anhaken (für den Datei-Sync: **Dateien**), dann anmelden. Die Kachel-Übersicht listet die Anbieter nach Verbreitung; über **Anbieter suchen…** findest Du auch E-Mail-Anbieter, die als Voreinstellung hinterlegt sind. Es trägt immer **genau ein** Konto pro Vault den Dienst **Dateien**. Der Bereich **Synchronisation** zeigt danach das verbundene Konto samt **Cloud-Ordner** und regelt das Verhalten (**Sync-Intervall**, Warteschlange); **Konto verwalten** führt zurück zu den Cloud-Konten.
- Für den Dienst **Dateien** stehen neben **Microsoft** (OneDrive), **Google** (Drive), **Dropbox**, **Nextcloud**, **Object Storage (S3)** und generischem **WebDAV / CalDAV** auch **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru**, **Koofr** und **pCloud** als eigene Kacheln bereit: Dort genügt die E-Mail-Adresse plus **App-Passwort** — die Server-Adressen sind bereits hinterlegt (WebDAV-basiert; über **Erweitert: Endpunkte einzeln festlegen** änderbar).
- **Bestehenden Online-Vault vom Startbildschirm öffnen**: **Vault öffnen** → **Online-Vault** führt Dich bei allen Anbietern gleich durch drei Schritte — **1. Verbinden** (Anmeldung bzw. Zugangsdaten eingeben), **2. Ordner in der Cloud wählen** (über **Neuer Ordner** lässt sich dort auch ein frischer Ordner anlegen), **3. lokalen Ordner wählen oder erstellen**. Alternativ richtest Du den Sync für einen bereits offenen Vault jederzeit unter Einstellungen ein.
- **Neuen Vault in der Cloud anlegen**: **Neuer Vault** → **Bei einem Online-Dienst** — erst die Startstruktur wählen (leer oder eine Vorlage wie PARA), dann verbinden und den Ziel-Ordner in der Cloud wählen oder über **Neuer Ordner** anlegen, zuletzt den lokalen Ordner. Die Struktur entsteht im lokalen Ordner und wird beim ersten Sync automatisch hochgeladen.
- Lokale Speicherungen werden sofort hochgeladen; auf Remote-Änderungen prüft Plainva im eingestellten **Sync-Intervall (Sekunden)**.
- Offline-Änderungen werden in einer Warteschlange gesammelt und beim nächsten Kontakt übertragen; die Statusleiste zeigt **Online**/**Offline** und der Sync-Indikator den Zustand (**Jetzt synchronisieren** per Klick). Bei einem langen oder erstmaligen Sync zeigt die Statusleiste den Fortschritt als Zähler (z. B. **Sync 123/540**), damit Du siehst, dass sie den Vault abarbeitet.
- Ändern beide Seiten dieselbe Datei, führt Plainva sie automatisch zusammen (3-Wege-Merge). Geht das nicht, wird Deine Version sicher als `.CONFLICT`-Datei bewahrt — nichts geht verloren (siehe [FAQ](FAQ.md)).
- **Konflikte lösen**: Ein Banner in der betroffenen Notiz (und **Konflikt lösen…** im Rechtsklick-Menü der `.CONFLICT`-Datei im Baum) öffnet den Vergleichsdialog — links der aktuelle Stand der Datei, rechts Deine gesicherte Version zum Bearbeiten und blockweisen Übernehmen. **Rechte Version speichern & auflösen** schreibt das Ergebnis in die Datei und räumt die Konfliktkopie auf; **Andere Seite behalten** verwirft Deine Kopie (ein Versions-Snapshot bleibt). Auch der Sync-Fehler-Dialog listet vorhandene Konfliktkopien und führt mit einem Klick in denselben Vergleich.
- **Schutz vor Massenlöschungen**: Sollen ungewöhnlich viele der synchronisierten Dateien auf einmal in der Cloud gelöscht werden (z. B. weil der lokale Vault-Ordner geleert oder verschoben wurde), hält Plainva die Löschungen an und fragt zuerst nach: **In der Cloud löschen** führt sie aus, **Nicht löschen (wiederherstellen)** verwirft sie und stellt die Dateien beim nächsten Sync aus der Cloud wieder her. Löschungen, die Du in Plainva selbst bestätigt hast, werden nicht angehalten – bei großen Löschungen (mehr als 10 Dateien oder mehr als 20 % des Vaults) fragt Plainva stattdessen schon vor dem Löschen ein zweites Mal nach.
- Anhänge (Bilder etc.) werden mitsynchronisiert.
- Auch **leere Ordner** werden synchronisiert: Ein in Plainva angelegter Ordner erscheint sofort in der Cloud, und leere Cloud-Ordner erscheinen spätestens mit dem nächsten vollständigen Abgleich auf Deinen anderen Geräten.
- Zugangsdaten und Tokens landen im Schlüsselbund des Betriebssystems (Status: **Einstellungen → App → Über & Diagnose → OS-Keychain**), nie in Dateien im Vault.
- **Gespeicherte Zugänge** (**Einstellungen → Vault → Synchronisation**) zeigt, was Plainva im Schlüsselbund abgelegt hat — auch aus Vaults, die Du längst nicht mehr öffnest. Jeder Eintrag nennt Dienst und Vault; **Entfernen** fragt vorher nach. Plainva löscht hier nie von selbst.
- **Trennen** stoppt den Sync des Vaults; Dateien werden dadurch nirgends gelöscht.

## WebDAV / Nextcloud

Der einfachste Weg für eigene Server und die meisten Cloud-Speicher:

1. In **Cloud-Konten** → **Konto verbinden…** die Kachel **Nextcloud** (oder **WebDAV / CalDAV**) wählen.
2. **Server-Adresse**, **Benutzername** und **Passwort oder App-Token** eintragen — nutze wenn möglich ein App-Passwort statt Deines Hauptpassworts (in Nextcloud: Einstellungen → Sicherheit → App-Passwörter).
3. **Verbinden** prüft die Zugangsdaten; danach wählst Du über **Ordner auswählen…** den **Cloud-Ordner**.

Besonderheit **Nextcloud**: EIN Formular reicht für Dateien **und** Kalender — aus der Server-Adresse leitet Plainva die WebDAV- und CalDAV-Endpunkte selbst ab (die abgeleiteten Adressen werden im Assistenten angezeigt; **Erweitert: Endpunkte einzeln festlegen** erlaubt getrennte URLs). Hakst Du beide Dienste an, verbindet ein Durchgang beides.

Typische Server-Adressen (Nextcloud, Koofr, MagentaCLOUD, Storage Box u. v. m.) findest Du in der [Sync-Kompatibilität](Sync_Compatibility.md).

Ändert sich das App-Passwort später, trägst Du es **einmal** in den Konto-Details unter **Zugangsdaten** ein: Plainva prüft es gegen jeden Dienst dieses Kontos und speichert es erst, wenn alle es akzeptieren — so bleibt kein Dienst mit einem alten Passwort zurück.

## Google Drive

Google Drive läuft aktuell mit eigenen Zugangsdaten („Bring Your Own"): Du legst einmalig ein kostenloses eigenes Google-Cloud-Projekt an, das nur Dir gehört. Die Schritt-für-Schritt-Anleitung: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

Kurzfassung: In **Cloud-Konten** → **Konto verbinden…** die Kachel **Google** wählen, den Dienst **Dateien** anhaken, **Client ID** und **Client Secret** aus Deinem Google-Projekt eintragen und **Bei Google anmelden…** — die Anmeldung öffnet sich im Browser. Nach dem Verbinden wählst Du den **Cloud-Ordner** über **Ordner auswählen…** direkt aus Deinem Drive (auch Unterordner, Standard „Plainva"). Hinweis: Solange Dein Google-Projekt im **Testing**-Modus steht, läuft die Anmeldung nach **7 Tagen** ab — endgültig, denn Google lässt in diesem Modus auch den Erneuerungs-Token verfallen; Plainva kann sie im Hintergrund also nicht auffrischen. Der Sync sagt Dir dann, dass die Anmeldung abgelaufen ist, und **Erneut anmelden** in den Konto-Details stellt sie wieder her — ein Durchgang für **alle** Dienste dieses Kontos. Wer das nicht wöchentlich tun möchte, setzt das Google-Projekt in der Konsole auf **In Produktion**: dann bleibt die Anmeldung dauerhaft (bei einer nicht verifizierten App zeigt Google dabei einmal einen Warnbildschirm, den Du als Eigentümer bestätigen kannst).

Hakst Du beim Verbinden **Dateien** und **Kalender** gemeinsam an, fragt Google nur **einmal** nach Deiner Zustimmung — angefordert werden dabei genau die Rechte der gewählten Dienste. Wählst Du später einen weiteren Dienst dazu, kommt eine zweite, ergänzende Zustimmung.

## OneDrive

Plainva liefert eine eigene App-Registrierung mit — Du musst **keine eigene ID mehr anlegen**:

1. In **Cloud-Konten** → **Konto verbinden…** die Kachel **Microsoft** wählen und den Dienst **Dateien** (OneDrive) anhaken — auf Wunsch gleich zusammen mit **Kalender & Aufgaben** und **E-Mail** (ein Microsoft-Konto kann alle drei Dienste tragen).
2. **Bei Microsoft anmelden…** und die Anmeldung im Browser bestätigen. Fertig — Plainva legt den Ordner an (Standard „Plainva") und synchronisiert seinen gesamten Inhalt, auch extern hinzugefügte Dateien.
3. Optional: Nach dem Verbinden wählst Du den **Cloud-Ordner** über **Ordner auswählen…** direkt aus Deinem OneDrive (auch Unterordner).

Optional: Über **Eigene App-ID verwenden** kannst Du stattdessen eine selbst registrierte Client-ID hinterlegen (z. B. bei Firmen-Sperren). Ausführliche Anleitung: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

Verbindest Du mehrere Dienste eines Kontos zusammen — etwa **Dateien** und **Kalender** —, fragt der Anbieter nur **einmal** nach Deiner Zustimmung, und Plainva merkt sich dafür eine einzige Anmeldung für das ganze Konto. Das gilt für **Microsoft** (Dateien, Kalender, E-Mail) ebenso wie für **Google** (Dateien und Kalender; ein Gmail-Postfach bleibt außen vor, weil es über IMAP mit App-Passwort läuft und keine Zustimmung braucht).

Bestehende Konten, die noch je Dienst getrennt angemeldet sind, bieten **Ein Login für alle Dienste** an — in der Konten-Liste und in den Konto-Details, am Rechner wie in der [mobilen App](Mobile_App.md). Ein Durchgang, danach hängen alle Dienste an derselben Anmeldung. Das ist mehr als Bequemlichkeit: getrennte Anmeldungen konnten auseinanderlaufen, sodass ein Dienst weiterlief, während ein anderer desselben Kontos still abgelaufen war. **Erneut anmelden** erneuert bei solchen Konten ebenfalls das ganze Konto statt nur einen Dienst.

## Dropbox

Plainva liefert eine eigene Dropbox-App mit — **keine eigene App nötig**:

1. In **Cloud-Konten** → **Konto verbinden…** die Kachel **Dropbox** wählen (sie trägt nur den Dienst **Dateien**).
2. **Bei Dropbox anmelden…** und im Browser bestätigen. Fertig (Standard-Ordner `/Plainva`).
3. Optional: Nach dem Verbinden wählst Du den **Cloud-Ordner** über **Ordner auswählen…** direkt aus Deiner Dropbox (auch Unterordner).

Optional: Über **Eigene App-ID verwenden** kannst Du stattdessen einen selbst registrierten App-Key hinterlegen. Ausführliche Anleitung: [OneDrive & Dropbox (BYO)](OneDrive_and_Dropbox_BYO_Guide.md).

## S3-kompatibler Speicher

Für AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Hetzner u. a. — schlüsselbasiert, ganz ohne Browser-Anmeldung. In **Cloud-Konten** → **Konto verbinden…** die Kachel **Object Storage (S3)** wählen und die Felder ausfüllen:

| Feld | Bedeutung |
|---|---|
| **Endpoint** | Basis-URL der S3-API, z. B. `https://s3.eu-central-1.amazonaws.com`, `https://<account>.r2.cloudflarestorage.com` oder `http://127.0.0.1:9000` für lokales MinIO |
| **Bucket** | Name des Buckets |
| **Region** | SigV4-Region; `us-east-1` funktioniert für die meisten Nicht-AWS-Speicher, Cloudflare R2 nutzt `auto` |
| **Access Key ID** / **Secret Access Key** | Ein API-Schlüsselpaar des Anbieters |
| **Key-Präfix (optional)** | Unterordner im Bucket für den Vault; leer = Bucket-Wurzel |
| **Path-Style-URLs** | Empfohlen (MinIO, R2 und die meisten Kompatiblen); nur für virtual-hosted AWS-Buckets deaktivieren |

Den **Key-Präfix** (den Cloud-Ordner) kannst Du nach dem Verbinden über **Ordner auswählen…** direkt aus dem Bucket wählen.

Nach **Verbinden** startet der Sync direkt.

## Siehe auch

- [Sync-Kompatibilität](Sync_Compatibility.md) — welche Dienste wie funktionieren, inkl. Desktop-Client-Weg
- [FAQ & Fehlerbehebung](FAQ.md) — Konfliktdateien, Offline-Verhalten

## Sync-Verschlüsselung (Passphrase)

> **Mit P3 ersetzt:** Die folgenden Bedienelemente gelten nicht mehr für Vault-Inhalte. Nutze [Sicherheit & Freigaben](Security_and_Sharing.md) für den aktuellen verschlüsselten Workspace. Die hier verbleibende Passphrase schützt nur den optionalen Einstellungen-/Secrets-Sideband.

Plainva kann verschlüsseln, was Deinen Rechner in Richtung Sync-Server verlässt — Dein lokaler Vault bleibt dabei immer reines Markdown, das Obsidian lesen kann.

Öffne **Einstellungen → Synchronisation → Sync-Passphrase & Verschlüsselung**:

1. **Passphrase festlegen.** Das erzeugt einen Verschlüsselungsschlüssel für den Vault und zeigt einmalig einen **Wiederherstellungscode** — bewahre ihn sicher auf, er ist der einzige Weg zurück, falls Du die Passphrase vergisst. Ab diesem Zeitpunkt reisen die synchronisierten **Einstellungen** des Vaults verschlüsselt.
2. **Vault-Inhalt verschlüsseln** (optional). Der Knopf **Verschlüsseln** lädt jede Notiz erneut als Chiffretext zum Sync-Server hoch. Deine lokalen Dateien bleiben reines Markdown, ein lokaler Vault ist also nie in Gefahr — probier es zuerst an einem Wegwerf-Vault aus. Ist der Upload fertig, nutze **Migration abschließen**, damit ab dann nur noch Chiffretext akzeptiert wird.
3. **Auf einem anderen Gerät** öffnest Du denselben synchronisierten Vault. Plainva erkennt, dass der Vault verschlüsselt ist, und fragt nach der Passphrase (oder dem Wiederherstellungscode). Nach dem Entsperren werden die Notizen entschlüsselt und erscheinen lokal.

Der entsperrte Schlüssel wird auf jedem Gerät zwischengespeichert. Schalte **Passphrase bei jedem Start verlangen** ein, um sie stattdessen nach jedem Neustart erneut einzugeben, und nutze **Sperren**, um den zwischengespeicherten Schlüssel auf diesem Gerät zu entfernen.

**Konten auf all Deinen Geräten** sind drei Schritte. **1 · Einstellungen und Konten**: legt Vault-Einstellungen *und Deine Konten* (Kalender, Postfächer, Kalenderauswahl) als kleine Datei in den Vault — solange keine Passphrase eingerichtet ist, brauchst Du dafür **keine**; sobald es eine gibt, muss jedes Gerät sie eingeben, bevor von dort Einstellungen mitreisen. **2 · Sync-Passphrase** (optional): nur nötig, wenn auch Anmeldungen mitreisen sollen; sie verschlüsselt zusätzlich die Einstellungen aus Schritt 1. **3 · Anmeldungen mitnehmen**: nimmt statische IMAP- und CalDAV-Passwörter verschlüsselt mit und lässt sich erst einschalten, wenn Schritt 1 läuft und die Passphrase entsperrt ist — ein Passwort kann nur zu einem Konto reisen, das das Gerät schon kennt. Nicht mitgenommen werden gerätespezifische Pfade und OAuth-Anmeldungen (Microsoft, Google): deren Tokens sind gerätegebunden, das Konto erscheint auf dem neuen Gerät und braucht dort einmal **Anmelden**.

Auf dem **Telefon** findest Du dieselbe Kette auf der Vault-Seite — mit denselben drei Schritten und derselben Sperre. Konten, die von einem anderen Gerät kommen, werden dort angelegt; Du musst sie nicht erneut von Hand eintragen. Über **Jetzt von einem anderen Gerät übernehmen** holst Du sie sofort, statt auf den nächsten Abgleich zu warten.

Wenn Plainva meldet, dass eine **ältere Version noch ausgemusterte Kontodaten veröffentlicht**, aktualisiere Plainva auf jedem Gerät, das diesen Vault verwendet. Das aktuelle Gerät ignoriert alte Google-Clientdaten und behält seine funktionierende lokale Anmeldung. Bestätige die Entfernung der alten Remote-Daten erst, wenn alle beteiligten Geräte aktualisiert sind. Den Knopf dafür bietet Plainva im Hinweis unter **Einstellungen → Vault → Synchronisation → Diagnose** an: **Ausgemusterte Einträge entfernen** — die Rückfrage ist genau diese Bestätigung.

Wo dieses **Anmelden** stattfindet, hängt vom Dienst ab: ein Postfach zeigt den Knopf **Auf diesem Gerät anmelden** direkt bei sich im Bereich **E-Mail**, ein Kalender- oder Dateien-Konto in **Cloud-Konten**. Ein Microsoft-Postfach führt immer nach **Cloud-Konten**, weil seine Anmeldung im Browser läuft.

Richtest Du die Verschlüsselung **neu** ein, ist Schritt 3 von vornherein an — sonst säße jedes weitere Gerät dauerhaft ohne Anmeldungen da. Bei einem Vault, den Du schon nutzt, wird nichts still umgestellt: Plainva fragt einmal und merkt sich Deine Antwort.

Tauchen für ein Konto **zwei Karten** auf, konnte Plainva die Identität beim Anbieter nicht abrufen — raten darf es nicht. Öffne dann unter **Cloud-Konten** eine der beiden und sage über **Zusammenführen**, dass es dasselbe Konto ist; was übernommen wird, zeigt Plainva vorher an.

## Was mitreist und was hier bleibt

Wenn unter **Cloud-Konten** der Abschnitt **Doppelte Konten prüfen** erscheint, entscheidet Plainva absichtlich nicht anhand des Namens. Wähle **Dieses Konto behalten** bei der richtigen Karte. Die Bestätigung nennt Ziel, Quellen und betroffene Dienste; vorher wird auf diesem Gerät eine Sicherung angelegt. **Abbrechen** verändert nichts. Beim Zusammenführen werden nur verwaiste lokale Konten, Caches und Zugangsdaten entfernt — beim Anbieter wird nichts gelöscht.

<!-- plainva:profile-areas accounts content calendar mail backup sync layout -->

| Reist mit dem Vault | Bleibt auf diesem Gerät |
| --- | --- |
| Konten — Kalender, Postfächer, Cloud-Konten, Lesezeichen | Absolute Pfade — Vault-Ort, Backup-Ziel |
| Ordner und Vorlagen — Tagesnotizen, Vorlagen-, Eingangs- und Anhänge-Ordner, Aufgabendatenbank | Anmelde-Tokens für Microsoft und Google |
| Kalender-Einstellungen — Meeting-Ordner, Standardkalender | Welches Postfach und welchen Ordner Du zuletzt offen hattest |
| Mail-Einstellungen — Ablage-Ordner, externe Bilder | Die Startanordnung dieses Geräts für neue Vaults |
| Backup-Regeln — Snapshot-Intervall, Aufbewahrung, Archive | Statische Passwörter — außer Schritt 3 ist an |
| Sync-Intervall |  |
| Anordnung der Leisten (Desktop) |  |

Das Telefon trägt davon etwas weniger: Die Anordnung der vier **Desktop**-Leisten bleibt am Rechner — seine eigene Navigationsleiste reist dagegen mit, ebenso der Meeting-Ordner. Seine eigene Kette auf der Vault-Seite zeigt, was es trägt, und beide Geräte sagen darunter, was der Sync zuletzt wirklich getan hat — mit den Namen der Einstellungen, die dabei gereist sind, und bei einem Empfang mit denen, die sich geändert haben. Die Meldung „Einstellungen von einem anderen Gerät übernommen" erscheint dabei höchstens einmal je Sitzung und nur, wenn sich wirklich etwas geändert hat — danach steht es in diesen Zeilen. Neu seit dieser Fassung übernimmt das Telefon auch das Dateiformat der Tagesnotizen, den OKF-Typ neuer Notizen und Deine Lesezeichen — vorher bekam ein Vault mit anderem Datumsformat eine zweite Tagesnotiz für denselben Tag, sobald das Telefon ihn anfasste.

Die Diagnose trennt jetzt **zuletzt geprüft** (lokale Profilfelder), **zuletzt heruntergeladen**, **zuletzt übernommen** und **zuletzt tatsächlich gesendet**. „Gesendet“ ändert sich nur nach einem erfolgreichen Schreiben in die Cloud; unveränderte Runden aktualisieren daher Prüfung und Download, aber nicht den Sendezeitpunkt. Secret-Ergebnisse stehen separat als Anzahlen für importiert, unverändert, abgelehnt, veraltet, fehlerhaft oder auf ein Konto wartend. Sie enthalten nur stabile Grundcodes — keine Konto-ID, kein Passwort, keinen Token und keinen Rohfehler. Ein Altclient-Hinweis bedeutet, dass Plainva auf allen beteiligten Geräten aktualisiert werden sollte; dieses Gerät ignoriert die ausgemusterten Google-Clientdaten.

## Fehler und automatische Wiederholung

Der Sync-Fehlerdialog bewahrt den genauen fehlgeschlagenen Versuch, auch wenn ein automatischer Retry den Live-Status bereits verändert hat. Er zeigt an, wenn der erneute Versuch läuft oder erfolgreich war. Eine neue Anmeldung wird nur bei einem Authentifizierungsfehler empfohlen; Netzwerk-, Timeout- und Providerfehler behalten ihre konkrete Ursache und werden automatisch erneut versucht.

## Namen, die sich nur in der Schreibweise unterscheiden

Google Drive unterscheidet beim Suchen keine Groß- und Kleinschreibung, und Windows und macOS legen `Notiz.md` und `notiz.md` in derselben Datei ab. Liegen in einem Ordner zwei Notizen, deren Namen sich nur darin unterscheiden — oder nur in der Schreibweise von Umlauten (`ü` als ein Zeichen oder als `u` mit Trema) —, kann Plainva sie auf der Gegenseite nicht auseinanderhalten. In diesem Fall ändert und löscht der Sync nichts und meldet stattdessen einen Fehler mit beiden Namen. Benenne eine der beiden Notizen um, dann läuft der Sync weiter.
