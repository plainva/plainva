# Sicherheit & Freigaben

## Sicherheitszentrale, Neuverschlüsselung und veröffentlichte Slices

**Sicherheit & Freigaben** hat zwei Ebenen. Die **Übersicht** (erste Ebene) zeigt den Schutzstatus, **Migration abschließen** (wenn noch Klartext-Reste bestehen), **Verbindung zur verschlüsselten Cloud entfernen** und zwei Karten, die die zweite Ebene öffnen — **Geräte & Wiederherstellung** und **Mit anderen teilen**. Auf der zweiten Ebene ersetzt die Bereichs-Navigation die linke Einstellungs-Spalte, gruppiert in **Dein Zugang** (Geräte, Wiederherstellung) und **Teilen** (Mitglieder, Gruppen, Slices, Veröffentlichungen); **‹ Übersicht** führt zurück. Sichtbare Aktionen bleiben benutzbar: Fehlt eine Voraussetzung, öffnet Plainva den ausgewählten Vault, die Verbindungsverwaltung, die Einrichtung oder die Entsperrung. Beim Entfernen eines Geräts oder Mitglieds kann eine dauerhafte vollständige Neuverschlüsselung starten; ihr Fortschritt überlebt Pause, Absturz und Neustart. Die schnelle Rotation betrifft nur künftige Schreibvorgänge.

Ein Vault Slice entsteht in **Details → Inhalt → Berechtigungen → Prüfen**. Externe Veröffentlichungen verwenden einen getrennten verschlüsselten Workspace-Namensraum. Bereinigte Projektionen entfernen private Frontmatter-Eigenschaften, neutralisieren Links auf ausgeschlossene Notizen und lassen ausgeschlossene Einbettungen weg. Anbieterrechte bei Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV und S3 sind Zusatzschutz. Eine öffentliche Freigabe bleibt gesperrt, bis unabhängige Kryptoprüfung und reale Zwei-Geräte-Nachweise für Android/iOS dokumentiert sind.

Zuletzt geprüft: 2026-07-23

Plainva kann einen Vault auf Deinem Gerät als normal lesbare Dateien belassen und die Cloud-Kopie als undurchsichtige verschlüsselte Objekte speichern. Öffne nach dem Verbinden eines Cloud-Kontos **Einstellungen → Dein Vault → Sicherheit & Freigaben**.

## Erste Einrichtung

1. Wähle einen Owner- und Gerätenamen. Geräteschlüssel bleiben im System-Schlüsselbund; ist er nicht verfügbar, fragt Plainva nach einer lokalen Passphrase.
2. Speichere die `.pvrecovery`-Datei und bewahre den angezeigten Wiederherstellungscode getrennt auf. Jeder Codeblock trägt eine sichtbare Gruppennummer; gib die Werte der zwei markierten Gruppen ein, um die Lesbarkeit der Sicherung zu bestätigen. Zur Wiederherstellung werden beide Teile benötigt; keiner enthält Cloud-Zugangsdaten.
3. Aktiviere den Workspace. Plainva veröffentlicht die signierte Owner-Policy und verschlüsselt alle lokalen Dateien nach `.pvws/`. Der lokale Vault bleibt lesbar; Unterbrechungen werden fortgesetzt.

Bestehender Klartext bleibt während der Migration beim Anbieter neben `.pvws/` erhalten. Erst beim Status **Geschützt** kannst Du ihn ausdrücklich entfernen. Lokale Dateien werden dabei nie gelöscht.

## Im Alltag

Offline-Änderungen bleiben in einer dauerhaften Queue. Jede Änderung ist signiert; bloßes Remote-Fehlen löscht lokal nichts, ein signierter Tombstone dagegen schon. Parallele Offline-Bearbeitungen bleiben als `.CONFLICT-…`-Kopien erhalten. **Sperren** entfernt Workspace-Schlüssel aus der Sitzung; **Entsperren** nutzt Schlüsselbund oder lokale Passphrase.

## Geräte und Wiederherstellung

Um **Dein eigenes** Zweitgerät hinzuzufügen, öffne **Geräte & Wiederherstellung → Geräte → Weiteres Gerät hinzufügen**: Plainva zeigt einen Einladungscode, der an Deine eigene Mitgliedschaft gebunden ist — er legt **kein** neues Mitglied an. Füge ihn auf dem Zweitgerät ein (**Sicherheit & Freigaben → beitreten**) und genehmige ihn auf einem bereits verbundenen Gerät; vergleiche zuerst den Fingerprint auf beiden Geräten. Um stattdessen eine andere Person aufzunehmen, nutze **Mit anderen teilen → Mitglieder → Person einladen** (siehe unten). Entfernte Geräte können keine neuen gültigen Änderungen mehr signieren.

Die Wiederherstellung liegt unter **Geräte & Wiederherstellung → Wiederherstellung**, getrennt in **Aktueller Status** (ist ein Recovery-Paket gesichert, plus der Workspace-Fingerprint) und den **Wiederherstellungs-Workflow**. Sind alle Geräte verloren, wähle dort **Zugriff wiederherstellen** und öffne die `.pvrecovery`-Datei mit ihrem getrennten Code; Plainva erstellt ein neues Owner-Gerät, kann die alten Geräte sperren und schreibt dabei keine Inhaltsobjekte um. Mit **Recovery erneuern** ersetzt eine doppelt signierte Ankerkette das alte Recovery-Set. Speichere die neue Datei und den neuen Code wieder getrennt; das alte Set ist danach ungültig.

## Mitglieder, Rollen und Vault Slices

Owner und Admins können Mitglieder einladen, Gruppen anlegen und Rollen auf den gesamten Workspace, einen Slice oder ein einzelnes Objekt begrenzen. **Editor** darf lesen und bearbeiten, **Commenter** lesen und kommentieren, **Reader** nur lesen und **Contributor** nur neue Inhalte im zugewiesenen Bereich einreichen. Die Prüfung erfolgt vor jedem lokalen Schreibzugriff und erneut vor dem Signieren; sie gilt dadurch auch für Import, Wiederherstellung, Automationen, KI-Aktionen und Änderungen anderer lokaler Programme.

Ein Slice kann einen Ordner, eine explizite Objektauswahl oder eine dynamische Regel über Pfad, Typ, Tags und Properties enthalten. Nutze vor dem Erstellen immer **Vorschau**. Nur die angezeigten stabilen Objekt-IDs werden materialisiert; Dateien können für mehrere Gruppen verschlüsselte Umschläge besitzen. Nicht berechtigte Objekte werden weder materialisiert noch in Suche, Graph oder Vorschau aufgenommen.

## Kommentare, Versionen und Sicherheitsprüfung

Commenter sehen einen schreibgeschützten Editor mit Kommentarbereich. Kommentare und Erledigt-Markierungen sind selbst verschlüsselte, signierte Workspace-Objekte. **Versionsverlauf** liest die verschlüsselten Workspace-Revisionen und stellt eine ältere Revision als neue signierte Änderung oder als Kopie wieder her.

Fehlerhafte Remote-Artefakte landen einzeln unter **Integrität & lokale Forks**. Du kannst sie erneut prüfen, als Ciphertext exportieren, nach externer Reparatur als repariert markieren oder bewusst ignorieren. Eine fehlerhafte Datei hält gültige Synchronisationen nicht an; bloße Remote-Abwesenheit wird niemals als Löschung interpretiert. Änderungen eines lokalen Programms ohne Schreibrecht bleiben als private Fork-Kopie erhalten.

## Einen verschlüsselten Vault richtig entfernen

Wenn Du einen verschlüsselten Vault nicht mehr brauchst, lege ihn in Plainva still, **bevor** Du den Cloud-Ordner löschst. Die Reihenfolge ist wichtig: Der fail-closed-Schutz hält den Sync gestoppt, wenn die Cloud-Kopie verschwindet, während Plainva die Verbindung noch als verschlüsselt erwartet — das schützt Dich davor, dass jemand die Verschlüsselung abstreift, um Klartext zu erzwingen.

1. Öffne **Einstellungen → Dein Vault → Security & Sharing**.
2. Wähle auf der Übersicht in der **Verschlüsselung**-Karte **Verbindung zur verschlüsselten Cloud entfernen**. Plainva löscht die lokalen Schlüssel und Workspace-Daten auf diesem Gerät und öffnet den Vault als normalen Vault neu. (Das ist geräte-lokal; ein globales „Verschlüsselung aufheben", das auch die Cloud-Kopie wieder zu Klartext macht, ist eine spätere, eigene Aktion.)
3. Lösche erst jetzt den Cloud-Ordner (die `.pvws/`-Objekte) bei Deinem Anbieter, falls Du ihn loswerden willst. Plainva löscht die verschlüsselten Cloud-Objekte nicht für Dich.

Hast Du die Cloud-Kopie schon gelöscht und der Sync bricht jetzt mit „Workspace fehlt" oder „Manifest fehlt" ab, ist die Lösung derselbe Reset — dort angeboten, wo der Fehler erscheint:

- Bei einem verschlüsselten **Workspace** öffnest Du **Sicherheit & Freigaben**. Der Status zeigt einen Fehler mit einem Hinweis; wähle in der **Verschlüsselung**-Karte **Verbindung zur verschlüsselten Cloud entfernen**, um den Workspace auf diesem Gerät zurückzusetzen, damit der Sync wieder läuft.
- Bei einer inhalts-verschlüsselten **Sync-Verbindung** klickst Du auf den Sync-Status, öffnest den Sync-Fehler-Dialog und wählst **Verschlüsselung zurücksetzen**. Dieser Knopf erscheint nur, wenn die Verschlüsselungsdaten in der Cloud fehlen oder ungültig sind.

Beide Aktionen sind ausdrücklich und werden bestätigt. Plainva stuft eine verschlüsselte Verbindung nie still auf Klartext herab, und keine der Aktionen löscht lokale Dateien. Trägt die Cloud noch verschlüsselte Inhalte, die Du wirklich willst, brich stattdessen ab — ein Reset würde den Klartext-Sync wieder aufnehmen.

Ein Vault, den Du über **App-Daten vergessen** entfernst (Splash → Vault entfernen → auch App-Daten vergessen), räumt diese Verschlüsselungs-Merker ebenfalls ab; so bleibt von einem so entfernten Vault nichts zurück, das eine spätere Neu-Verbindung blockieren könnte.
