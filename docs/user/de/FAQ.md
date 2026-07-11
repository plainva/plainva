# FAQ & Fehlerbehebung

Stand: 2026-07-11

Antworten auf die häufigsten Fragen — von Obsidian-Kompatibilität über Konfliktdateien bis zu Backups.

## Grundsätzliches

### Wo liegen meine Daten?

Ausschließlich bei Dir: Ein Vault ist ein normaler Ordner mit Markdown-Dateien auf Deinem Rechner. Plainva betreibt keinen eigenen Server und legt keine Kopien irgendwo ab. Synchronisierst Du, dann direkt zwischen Deinem Rechner und *Deinem* Speicher (Dein Nextcloud, Dein OneDrive, Dein Bucket …). Zugangsdaten liegen im Schlüsselbund des Betriebssystems.

### Kann ich Plainva und Obsidian parallel nutzen?

Ja — das ist ein Kernversprechen, mit einer ehrlichen Einschränkung. Plainva schreibt reines Markdown mit Standard-Frontmatter; alles Plainva-Spezifische liegt gebündelt unter `plainva:`-Schlüsseln (in Notizen und `.base`-Dateien), die Obsidian beim Öffnen einfach ignoriert. Obsidian zeigt den `plainva`-Schlüssel als nicht editierbares Objekt in den Properties — das ist harmlos. Plainva-Ansichten wie Board oder Kalender erscheinen in Obsidian als einfache Tabelle.

Die Einschränkung: **Öffnen ist immer sicher, Bearbeiten nicht immer.** Ein bestehender Obsidian-Vault lässt sich in Plainva gefahrlos öffnen und bearbeiten — nichts wird migriert oder umformatiert. Nutzt ein Vault aber Plainva-Funktionen (Datenbank-Erweiterungen wie Boards, Relationen oder Rückspalten, verwaltete `index.md`-Dateien), kann das Bearbeiten genau dieser Dateien in Obsidian die Plainva-Funktionalität beschädigen, weil Obsidian die `plainva:`-Erweiterungen nicht kennt. Notizen ohne Plainva-Erweiterungen kannst Du jederzeit überall bearbeiten. Beim ersten Einsatz einer solchen Erweiterung erinnert ein Hinweis-Dialog (**Plainva-Erweiterung**) daran; abschaltbar unter **Einstellungen → App → Start & Verhalten**.

### Verändert Plainva meinen bestehenden Vault?

Nicht ungefragt. Bestehende Dateien werden nur angefasst, wenn Du eine Aktion ausdrücklich startest (z. B. die [OKF-Konvertierung](OKF.md) — mit Vorschau und Backups). Nur neu angelegte Dateien bekommen automatisch den kleinen OKF-Frontmatter-Kopf.

## Dateien & Bearbeiten

### Ich habe etwas gelöscht — ist es weg?

Nein, gleich doppelt nicht: Vor jedem Löschen sichert Plainva die Datei als Snapshot — per Rechtsklick auf den Vault-Namen → **Gelöschte Dateien wiederherstellen…** holst Du sie in der App zurück. Zusätzlich landen gelöschte Dateien und Ordner im Papierkorb des Betriebssystems (bei ganzen Ordnern ist der Papierkorb der erste Weg). Details: [Backups & Versionsverlauf](Backups_and_Versioning.md).

### Gibt es ältere Fassungen meiner Notizen?

Ja: Plainva legt beim Bearbeiten automatisch Datei-Versionen an. Rechtsklick auf die Datei → **Versionsverlauf…** zeigt alle Snapshots mit Vergleichsansicht und **Wiederherstellen**. Zusätzlich sichert Plainva den ganzen Vault täglich als ZIP außerhalb des Vault-Ordners. Details: [Backups & Versionsverlauf](Backups_and_Versioning.md).

### Warum ist meine index.md schreibgeschützt?

Sie wurde von Plainva erzeugt und wird automatisch aktuell gehalten (erkennbar am Banner „Diese index.md wird von Plainva verwaltet…"). Mit **Trotzdem bearbeiten** übernimmst Du sie dauerhaft in eigene Pflege — sie wird dann nicht mehr automatisch aktualisiert. Details: [OKF](OKF.md).

### Was passiert beim Umbenennen einer Eigenschaft in einer Datenbank?

Der neue Name wird in das Frontmatter **aller passenden Notizen** geschrieben (nach Bestätigung, mit Fortschrittsanzeige). Gleiches Prinzip beim Löschen: Die Checkbox **Auch aus dem Frontmatter der Notizen entfernen** bereinigt die Quell-Notizen gleich mit. Beides wirkt also auf Deine Dateien — genau dafür ist es da.

### Kann ich die OKF-Konvertierung rückgängig machen?

Vor jeder Änderung sichert der Wizard die Datei nach `.plainva/backups/okf-conversion-<zeitstempel>/`. Der Abschlussbericht nennt den genauen Ordner; von dort kannst Du einzelne Dateien zurückkopieren. Nutze außerdem die **Vorschau (ohne Änderungen)**, bevor Du konvertierst.

## Sync

### Was ist eine .CONFLICT-Datei?

Wurde dieselbe Datei gleichzeitig hier und auf einem anderen Gerät geändert, versucht Plainva zuerst, beide Fassungen automatisch zusammenzuführen. Geht das nicht, wird **Deine** Fassung sicher als `.CONFLICT`-Datei neben dem Original gespeichert — es geht nie etwas verloren. Konfliktdateien sind im Dateibaum markiert; per Rechtsklick wählst Du **Diese Version übernehmen** (die Konfliktfassung ersetzt das Original) oder **Konflikt verwerfen**.

### Meine Google-Anmeldung läuft ständig ab

Beim „Bring Your Own"-Setup bleibt Dein Google-Projekt im Testing-Modus; Google beendet die Anmeldung dann nach 7 Tagen. Plainva erneuert Tokens automatisch im Hintergrund, aber nach Ablauf hilft **Neu verbinden** in den Sync-Einstellungen. Details: [Google Drive (BYO)](Google_Drive_BYO_Guide.md).

### Mein Vault liegt in einem OneDrive-/Dropbox-/iCloud-Ordner und Plainva verhält sich seltsam

Stelle den Vault-Ordner im Sync-Client des Anbieters auf „immer auf diesem Gerät behalten" / „offline verfügbar". Online-only-Platzhalterdateien (Files On-Demand, „online-only") stören Indexierung und Sync. Details: [Sync-Kompatibilität](Sync_Compatibility.md).

### Ich bin offline — was passiert mit meinen Änderungen?

Sie werden ganz normal lokal gespeichert und in einer Warteschlange gesammelt; sobald wieder Verbindung besteht, überträgt Plainva sie automatisch. Die Statusleiste zeigt **Online**/**Offline**.

### Die Statusleiste zeigt Offline, obwohl ich Internet habe

Dann ist die Sync-Verbindung selbst gestört — häufig, weil die Anmeldung abgelaufen ist oder sich Zugangsdaten geändert haben (z. B. bei Google Drive). Klicke auf **Offline** in der Statusleiste oder auf das Warndreieck neben dem Vault-Namen: Der Dialog zeigt die genaue Fehlermeldung, und **Sync-Einstellungen öffnen** führt direkt zum passenden Anbieter-Formular, wo Du die Verbindung neu herstellst (z. B. **Neu verbinden**). Jeder Klick stößt außerdem sofort einen neuen Sync-Versuch an.

## App

### Warum lädt F5 nicht neu, und wo ist das Rechtsklick-Menü des Browsers?

Plainva ist eine Desktop-App, keine Webseite. Neu-laden-Tasten (F5, Strg+R) sind bewusst deaktiviert — ein Neuladen würde Deine offenen Tabs und ungespeicherten Änderungen verwerfen. Das eingebaute Rechtsklick-Menü der WebView ist ebenfalls ausgeblendet; ein Rechtsklick auf markierten Text bietet weiterhin **Kopieren**, und Dateibaum, Tabs und Tabellen behalten ihre eigenen Rechtsklick-Menüs.

### Wie ändere ich die Sprache?

**Einstellungen → App → Erscheinungsbild → Sprache** (derzeit Deutsch und Englisch).

### „Nach Updates suchen" findet nichts

Solange es noch keine öffentlichen Releases gibt, meldet die Update-Suche: „Aktuell sind noch keine öffentlichen Updates (Releases) verfügbar." Das ist kein Fehler.

### Gibt es versteckte Funktionen?

Die Sternenflotte kommentiert Gerüchte grundsätzlich nicht. Aber es heißt, das Logo in der Titelleiste reagiere auf beharrliches Klopfen — und wer dann die richtigen Worte kennt, sieht Plainva danach in einem völlig neuen Licht. Manche sagen: in vieren.

## Siehe auch

- [Sync einrichten](Sync_Setup.md) und [Sync-Kompatibilität](Sync_Compatibility.md)
- [OKF](OKF.md) — Konvertierung, index.md, Systemfelder
