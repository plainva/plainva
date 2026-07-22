# Sicherheit & Freigaben

Zuletzt geprüft: 2026-07-22

Plainva kann einen Vault auf Deinem Gerät als normal lesbare Dateien belassen und die Cloud-Kopie als undurchsichtige verschlüsselte Objekte speichern. Öffne nach dem Verbinden eines Cloud-Kontos **Einstellungen → Dein Vault → Sicherheit & Freigaben**.

## Erste Einrichtung

1. Wähle einen Owner- und Gerätenamen. Geräteschlüssel bleiben im System-Schlüsselbund; ist er nicht verfügbar, fragt Plainva nach einer lokalen Passphrase.
2. Speichere die `.pvrecovery`-Datei, bewahre den angezeigten Wiederherstellungscode getrennt auf und gib die zwei abgefragten Codegruppen ein. Zur Wiederherstellung werden beide Teile benötigt; keiner enthält Cloud-Zugangsdaten.
3. Aktiviere den Workspace. Plainva veröffentlicht die signierte Owner-Policy und verschlüsselt alle lokalen Dateien nach `.pvws/`. Der lokale Vault bleibt lesbar; Unterbrechungen werden fortgesetzt.

Bestehender Klartext bleibt während der Migration beim Anbieter neben `.pvws/` erhalten. Erst beim Status **Geschützt** kannst Du ihn ausdrücklich entfernen. Lokale Dateien werden dabei nie gelöscht.

## Im Alltag

Offline-Änderungen bleiben in einer dauerhaften Queue. Jede Änderung ist signiert; bloßes Remote-Fehlen löscht lokal nichts, ein signierter Tombstone dagegen schon. Parallele Offline-Bearbeitungen bleiben als `.CONFLICT-…`-Kopien erhalten. **Sperren** entfernt Workspace-Schlüssel aus der Sitzung; **Entsperren** nutzt Schlüsselbund oder lokale Passphrase.

Geräte hinzufügen/sperren, Wiederherstellung aus dem Paket, Teamrollen, Gruppen, Einladungen und selektive Slices folgen in späteren Phasen. Aktuell umgesetzt ist der persönliche Single-Owner-Workspace samt Recovery-Sicherung.
