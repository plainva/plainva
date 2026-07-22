# Sicherheit & Freigaben

## Sicherheitszentrale, Neuverschlüsselung und veröffentlichte Slices

Das Dashboard entspricht jetzt den Mockups mit Statusbereich, Karten für Wiederherstellung/Geräte/Team und einer Verwaltung mit Tabs. Sichtbare Aktionen bleiben benutzbar: Fehlt eine Voraussetzung, öffnet Plainva den ausgewählten Vault, die Verbindungsverwaltung, die Einrichtung oder die Entsperrung. Beim Entfernen eines Geräts oder Mitglieds kann eine dauerhafte vollständige Neuverschlüsselung starten; ihr Fortschritt überlebt Pause, Absturz und Neustart. Die schnelle Rotation betrifft nur künftige Schreibvorgänge.

Ein Vault Slice entsteht in **Details → Inhalt → Berechtigungen → Prüfen**. Externe Veröffentlichungen verwenden einen getrennten verschlüsselten Workspace-Namensraum. Bereinigte Projektionen entfernen private Frontmatter-Eigenschaften, neutralisieren Links auf ausgeschlossene Notizen und lassen ausgeschlossene Einbettungen weg. Anbieterrechte bei Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV und S3 sind Zusatzschutz. Eine öffentliche Freigabe bleibt gesperrt, bis unabhängige Kryptoprüfung und reale Zwei-Geräte-Nachweise für Android/iOS dokumentiert sind.

Zuletzt geprüft: 2026-07-22

Plainva kann einen Vault auf Deinem Gerät als normal lesbare Dateien belassen und die Cloud-Kopie als undurchsichtige verschlüsselte Objekte speichern. Öffne nach dem Verbinden eines Cloud-Kontos **Einstellungen → Dein Vault → Sicherheit & Freigaben**.

## Erste Einrichtung

1. Wähle einen Owner- und Gerätenamen. Geräteschlüssel bleiben im System-Schlüsselbund; ist er nicht verfügbar, fragt Plainva nach einer lokalen Passphrase.
2. Speichere die `.pvrecovery`-Datei, bewahre den angezeigten Wiederherstellungscode getrennt auf und gib die zwei abgefragten Codegruppen ein. Zur Wiederherstellung werden beide Teile benötigt; keiner enthält Cloud-Zugangsdaten.
3. Aktiviere den Workspace. Plainva veröffentlicht die signierte Owner-Policy und verschlüsselt alle lokalen Dateien nach `.pvws/`. Der lokale Vault bleibt lesbar; Unterbrechungen werden fortgesetzt.

Bestehender Klartext bleibt während der Migration beim Anbieter neben `.pvws/` erhalten. Erst beim Status **Geschützt** kannst Du ihn ausdrücklich entfernen. Lokale Dateien werden dabei nie gelöscht.

## Im Alltag

Offline-Änderungen bleiben in einer dauerhaften Queue. Jede Änderung ist signiert; bloßes Remote-Fehlen löscht lokal nichts, ein signierter Tombstone dagegen schon. Parallele Offline-Bearbeitungen bleiben als `.CONFLICT-…`-Kopien erhalten. **Sperren** entfernt Workspace-Schlüssel aus der Sitzung; **Entsperren** nutzt Schlüsselbund oder lokale Passphrase.

## Geräte und Wiederherstellung

Ein neues Gerät erstellt mobil eine QR-/Code-Anfrage. Gib den Kurzcode am bereits freigegebenen Desktop ein und vergleiche den Fingerprint auf beiden Geräten, bevor Du bestätigst. Entfernte Geräte können keine neuen gültigen Änderungen mehr signieren. Sind alle Geräte verloren, wähle **Zugriff wiederherstellen** und öffne die `.pvrecovery`-Datei mit ihrem getrennten Code; Plainva erstellt ein neues Owner-Gerät, kann die alten Geräte sperren und schreibt dabei keine Inhaltsobjekte um. Mit **Recovery erneuern** ersetzt eine doppelt signierte Ankerkette das alte Recovery-Set. Speichere die neue Datei und den neuen Code wieder getrennt; das alte Set ist danach ungültig.

## Mitglieder, Rollen und Vault Slices

Owner und Admins können Mitglieder einladen, Gruppen anlegen und Rollen auf den gesamten Workspace, einen Slice oder ein einzelnes Objekt begrenzen. **Editor** darf lesen und bearbeiten, **Commenter** lesen und kommentieren, **Reader** nur lesen und **Contributor** nur neue Inhalte im zugewiesenen Bereich einreichen. Die Prüfung erfolgt vor jedem lokalen Schreibzugriff und erneut vor dem Signieren; sie gilt dadurch auch für Import, Wiederherstellung, Automationen, KI-Aktionen und Änderungen anderer lokaler Programme.

Ein Slice kann einen Ordner, eine explizite Objektauswahl oder eine dynamische Regel über Pfad, Typ, Tags und Properties enthalten. Nutze vor dem Erstellen immer **Vorschau**. Nur die angezeigten stabilen Objekt-IDs werden materialisiert; Dateien können für mehrere Gruppen verschlüsselte Umschläge besitzen. Nicht berechtigte Objekte werden weder materialisiert noch in Suche, Graph oder Vorschau aufgenommen.

## Kommentare, Versionen und Sicherheitsprüfung

Commenter sehen einen schreibgeschützten Editor mit Kommentarbereich. Kommentare und Erledigt-Markierungen sind selbst verschlüsselte, signierte Workspace-Objekte. **Versionsverlauf** liest die verschlüsselten Workspace-Revisionen und stellt eine ältere Revision als neue signierte Änderung oder als Kopie wieder her.

Fehlerhafte Remote-Artefakte landen einzeln unter **Integrität & lokale Forks**. Du kannst sie erneut prüfen, als Ciphertext exportieren, nach externer Reparatur als repariert markieren oder bewusst ignorieren. Eine fehlerhafte Datei hält gültige Synchronisationen nicht an; bloße Remote-Abwesenheit wird niemals als Löschung interpretiert. Änderungen eines lokalen Programms ohne Schreibrecht bleiben als private Fork-Kopie erhalten.
