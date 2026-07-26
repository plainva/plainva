# Die mobile App

Stand: 2026-07-26

Plainva gibt es auch als App für Android und iOS. Sie arbeitet mit denselben Markdown-Dateien, demselben **OKF**-Format und derselben Sync-Technik wie die Desktop-App — Dein Vault bleibt in beiden Welten identisch.

## Aufbau

- **Untere Leiste:** **drei bis fünf** Bereiche Deiner Wahl — einen festen **Mehr**-Tab gibt es nicht mehr, der Platz gehört Deinen Bereichen.
- **Alle Bereiche** (Notizen, Heute, Tags, Lesezeichen, Kalender, Datenbanken, Graph) erreichst Du jederzeit über das **Bereichs-Blatt**: entweder über das **▾ neben dem Titel** in der oberen Leiste oder durch **langes Drücken auf die untere Leiste**. Das Blatt markiert den aktuellen Bereich und führt unten direkt zu **Navigationsleiste anpassen…**.
- **Navigationsleiste einstellen:** **Einstellungen** → **Navigationsleiste**. Dort legst Du mit **−**/**+** fest, wie viele Bereiche die Leiste zeigt (3–5, mit Live-Vorschau), und ordnest die Liste per **Zieh-Griff**: die oberen Einträge bilden die Leiste (im Rahmen markiert), nach oben ziehen befördert einen Bereich hinein. Ausgeblendet wird nichts — was nicht in der Leiste steht, bleibt über das Bereichs-Blatt erreichbar. Verlässt der gerade offene Bereich die Leiste, springt die App auf den ersten sichtbaren.
- **＋** schwebt als runder Knopf über der Leiste und öffnet die Schnellanlage: Notiz, Tagesnotiz, Ordner, Datenbank, „Aus Vorlage…".
- **Obere Leiste:** der Titel mit **▾** (öffnet das Bereichs-Blatt), Suche und die **Einstellungen** (⋮); auf dem Startbildschirm zusätzlich „Zuletzt geöffnet" und Deine Lesezeichen.
- **Einstellungen:** Der ⋮-Knopf öffnet zuerst die Bereichsliste (wie die linke Seite der Desktop-Einstellungen) — ein Tipp öffnet die jeweilige Seite. Ganz oben führt **Aktiver Vault** zur Vault-Verwaltung: Vault wechseln (Häkchen = aktiv), **Neuen Vault erstellen** und **Mit Cloud verbinden**.

## Notizen lesen und bearbeiten

Notizen öffnen **gerendert und schreibgeschützt**; der Stift oben rechts wechselt ins Bearbeiten (mit Werkzeugleiste über der Tastatur: Formatierung, Listen, Wiki-Link, Slash-Befehle, Foto einfügen). `![[Notiz]]`-Einbettungen erscheinen als antippbare Vorschau-Karten.

Das **Notiz-Details**-Symbol in der Kopfzeile (zwischen Lesezeichen und ⋮-Menü) öffnet das Kontext-Blatt der Notiz: Eigenschaften (direkt editierbar), Backlinks, Gliederung, Graph und der **Versionsverlauf** — jede Bearbeitung erzeugt automatisch Snapshots, die Du ansehen, vergleichen und wiederherstellen kannst. Markdown-Quelltext und die Suche in der Notiz erreichst Du über das ⋮-Menü.

## Datenbanken (`.base`)

`.base`-Datenbanken funktionieren wie am Desktop: alle Ansichten (Tabelle, Liste, Galerie, Board, Kalender, Zeitachse), typgerechtes Bearbeiten der Zellen, Karten im Board per Gedrückthalten verschieben. Über **Konfigurieren** verwaltest Du Ansichten, Spalten, Filter (auch Gruppen), Sortierung und Eigenschaften. Relationen-Schema (Ziele, Kardinalität) pflegst Du weiterhin am Desktop.

Eine **Pinnwand**-Ansicht zeigt die Notizen als zweispaltiges Brett aus Zetteln: Tippen öffnet die Notiz, langes Drücken zeigt die Aktionen (Anpinnen, Labels, Farbe, Löschen), Ziehen nach langem Drücken ordnet um, und Kontrollkästchen lassen sich direkt auf der Karte abhaken. Das Eingabefeld oben erfasst einen neuen Zettel. Tipp: Zeigt die Datenbank auf Deinen Eingangsordner (**Einstellungen** → **Inhalt & Struktur**), landen auch die ＋-Schnellnotizen und aus anderen Apps geteilte Texte direkt auf dem Brett.

## Kalender und Termine

Der **Kalender** (unterer Tab bzw. über „Mehr") zeigt Deine Tagesnotizen als Monatsraster. Das Uhr-Symbol oben rechts öffnet den **Termin-Kalender** mit den Ansichten **Tag**, **3 Tage** und **Agenda** — Deine verbundenen Kalender laufen über dasselbe Konten-Modell wie am Desktop. Ein Tipp auf einen Termin zeigt die Details; bei einer Einladung kannst Du direkt **zusagen**, **vorläufig** annehmen oder **absagen**.

Konten verwaltest Du über das Zahnrad-Symbol im Termin-Kalender: **CalDAV** verbindest Du direkt auf dem Gerät mit einem App-Passwort (z. B. Fastmail, Nextcloud, iCloud); Google und Microsoft folgen über die Browser-Anmeldung. Je Konto lassen sich einzelne Kalender ein- und ausblenden.

**Anmelden gilt pro Gerät.** Synchronisiert werden Deine Konto-*Einstellungen*, nie die Anmeldung selbst — das ist Absicht: Zugangsdaten sollen das Gerät nicht verlassen. Ein Konto, das über die Einstellungs-Synchronisation kam, taucht deshalb in der Liste auf, trägt aber die Markierung **anmelden**; darunter steht, was zu tun ist. Solange kein Konto auf diesem Gerät angemeldet ist, erklärt der Kalender das an Ort und Stelle, statt einfach leer zu bleiben, und führt Dich mit **Auf diesem Gerät anmelden** zu den Konten. Angemeldete Konten zeigen **aktiv**.

## E-Mail

Unter **Einstellungen → E-Mail** verbindest Du ein **Microsoft-Postfach** (Outlook.com, Microsoft 365) direkt über die Anmeldung im Browser — ohne App-Passwort. Wie beim Kalender gilt: Anmelden geschieht pro Gerät.

Danach kannst Du **E-Mail** über das ▾ am Titel als eigenen Bereich öffnen und in der Navigationsleiste ablegen. Die Zeile unter dem Titel zeigt Ordner, ungelesene Anzahl und Konto und öffnet die Ordnerauswahl. Eine Nachricht öffnest Du per Tipp; **Als Notiz speichern** legt sie im Ordner **Mail** Deines Vaults ab (zweimal erfassen öffnet dieselbe Notiz). Externe Bilder bleiben blockiert, bis Du sie für die Nachricht freigibst — ein nachgeladenes Bild verrät dem Absender, wann und wo Du gelesen hast.

**IMAP-Postfächer funktionieren auf dem Telefon ebenfalls.** Leg eines unter **Einstellungen → E-Mail** an: Anbieter wählen, Adresse und App-Passwort eintragen, die Server füllt Plainva aus. Ist Dein Anbieter nicht dabei, trägst Du unter **Erweitert** IMAP- und SMTP-Server, Ports und einen abweichenden Benutzernamen selbst ein; ein bestehendes Konto lässt sich später bearbeiten. Mehrere Nachrichten wählst Du aus, indem Du eine davon gedrückt hältst.

## Synchronisation

In den **Einstellungen** (⋮) führt **Aktiver Vault** zur Vault-Verwaltung; dort verbindest Du Cloud-Speicher (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Mit Cloud verbinden** holt einen bestehenden Cloud-Vault aufs Gerät; **Neuen Vault erstellen** fragt zuerst **Auf diesem Gerät** oder **Bei einem Online-Dienst** und danach die Startstruktur (leer oder eine Vorlage wie PARA) — beim Online-Weg folgt das Verbinden, der Ziel-Ordner in der Cloud lässt sich im Auswahl-Blatt über **Neuer Ordner** frisch anlegen, und die Struktur wird beim ersten Sync hochgeladen. Dieselbe Wahl zwischen bestehendem und neuem Cloud-Vault bietet auch der erste Start („Mit Cloud verbinden"). Jede Verbindung bekommt einen eigenen, getrennten Vault auf dem Gerät. Die Vault-Seite zeigt Status, Fortschritt, ausstehende Übertragungen und bietet **Vault exportieren** (ZIP über das Teilen-Menü).

Wie oft dieser Vault nach Änderungen der Gegenstelle schaut, legst Du auf derselben Seite fest (**Sync-Intervall**, mindestens 5 Sekunden) — lokale Speicherungen gehen unabhängig davon sofort raus. Bei Google Drive, OneDrive, Dropbox und S3 lässt sich der **Cloud-Ordner** auch nachträglich wechseln; bei WebDAV steckt der Ordner in der Serveradresse, dort verbindest Du stattdessen neu. Ist der Einstellungs-Sync verschlüsselt, kannst Du zusätzlich **Bei jedem Start nach der Passphrase fragen** einschalten: der Schlüssel wird dann nicht auf dem Gerät gespeichert. Und **Sicherheit & Freigaben** sagt jetzt offen, dass verschlüsselte Workspaces experimentell und noch nicht unabhängig geprüft sind — bewahre Wiederherstellungsdatei und -code sicher auf.

Auf der Vault-Seite steht außerdem, ob Deine **Einstellungen** mitreisen — als Karte mit klarem Zustand statt als nackter Knopf:

- **Werden nicht synchronisiert**: Der Einstellungs-Sync ist für diesen Vault aus. Am Desktop schaltest Du ihn ein.
- **Noch nicht verschlüsselt**: Für diesen Vault gibt es noch keine Sync-Passphrase. Du kannst sie jetzt **am Telefon** vergeben: Der Assistent zeigt den Wiederherstellungscode und lässt Dich zwei zufällig gewählte Gruppen daraus zurücktippen, bevor überhaupt etwas geschrieben wird. Liegt in der Cloud bereits eine Passphrase, sagt das Telefon Dir das und legt keine zweite an — sonst würden alle anderen Geräte ausgesperrt.
- **Auf diesem Gerät noch nicht entsperrt**: Die Einstellungen liegen verschlüsselt in der Cloud. Gib die Passphrase ein, die beim Einrichten vergeben wurde — am Desktop oder hier am Telefon; dieses Gerät entsperrt sie damit einmalig.
- **Werden synchronisiert**: Dieses Gerät ist entsperrt; Ordner, Ansichten und Backup-Regeln bleiben mit Deinen anderen Geräten im Gleichschritt.

Jede Karte sagt auch, was *nicht* mitreist: Anmeldungen bleiben immer auf dem Gerät (siehe [Kalender und Termine](#kalender-und-termine)).

**Einstellungen** → **Sicherheit & Freigaben** benennt, was die Verbindung tatsächlich ist — und richtet bei einem normalen Cloud-Vault den verschlüsselten Workspace direkt auf dem Telefon ein (Identität → Wiederherstellungsdatei und Code → Aktivierung). Ohne Cloud-Verbindung gibt es nichts zu verschlüsseln; der Bereich sagt das auch so.

## Sicherheitsnetz

Snapshots (Versionsverlauf), ein Entwurfs-Journal (nach einem Absturz bietet die Notiz den letzten ungespeicherten Stand an) und Konflikt-Kopien mit Vergleichsansicht schützen Deine Daten. Die Aufbewahrung stellst Du unter **Einstellungen** → **Backup & Versionierung** ein.

## Teilen und Verknüpfungen

Auf Android und iOS landen geteilter Text und URLs als neue Notiz im Eingangsordner; geteilte Bilder und Dateien werden als Anhänge übernommen (maximal 25 MB pro Datei). Auf Android bietet das gedrückt gehaltene App-Symbol zusätzlich **Neue Notiz** und **Heute**. Auf der Vault-Seite kannst Du **Einstellungen synchronisieren** aktivieren und verschlüsselte Vaults sicher per Passphrase entsperren oder wieder sperren.

## Ordner, Fotos und Kalender

Der schwebende **Plus**-Knopf bleibt auch in verschachtelten Ordnern verfügbar; alle Schnellaktionen erstellen im aktuell geöffneten Ordner. Im Ordnerkopf führt das **Drei-Punkte-Menü** zu den Einstellungen, während neue Ordner über den **Plus**-Knopf angelegt werden.

Der Foto-Knopf im Editor fragt jetzt **Foto aufnehmen** oder **Aus Mediathek wählen**, behält die Einfügeposition und meldet Berechtigungs- oder Dateifehler sichtbar.

**Kalender** öffnet jetzt direkt den verbundenen Provider-Kalender. Tagesnotizen bleiben in der eigenen **Heute**-Ansicht; die frühere lokale Monats-Zwischenansicht wurde entfernt, ohne bestehende Notizen oder Kalenderdaten zu verändern.
