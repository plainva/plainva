# Die mobile App

Stand: 2026-07-29

Plainva gibt es auch als App für Android und iOS. Sie arbeitet mit denselben Markdown-Dateien, demselben **OKF**-Format und derselben Sync-Technik wie die Desktop-App — Dein Vault bleibt in beiden Welten identisch.

## Die App installieren

Die mobile App steckt im **geschlossenen Beta-Test**. Unter **Android** kommst Du in zwei Schritten hinein: über [plainva.com/de/android-beta](https://plainva.com/de/android-beta) der Tester-Gruppe beitreten und danach bei Google Play zustimmen. Auf dem **iPhone** läuft die Verteilung über TestFlight; die Warteliste steht auf [plainva.com](https://plainva.com).

Google gibt die App erst dann für den öffentlichen Play Store frei, wenn 12 Tester 14 Tage am Stück dabeibleiben — beitreten und die App einfach installiert lassen hilft also schon.

## Aufbau

- **Untere Leiste:** **zwei bis vier** Arbeitsflächen Deiner Wahl und ganz rechts der feste Eintrag **Bereiche** — zusammen die drei bis fünf Ziele, die auf eine Leiste gehören. **Notizen** bleibt immer sichtbar: darüber erreichst Du Deine Dateien.
- **Alle Bereiche** (Notizen, Heute, Aufgaben, Kalender, E-Mail, Graph) erreichst Du jederzeit über das **Bereichs-Blatt**: über **Bereiche** in der Leiste, das **▾ neben dem Titel** oder **langes Drücken auf die Leiste**. Das Blatt markiert den aktuellen Bereich und führt unten direkt zu **Navigationsleiste anpassen…**. Tags, Lesezeichen und Zuletzt geöffnet sind keine eigenen Bereiche mehr — sie liegen unter **Notizen**.
- **Navigationsleiste einstellen:** **Einstellungen** → **Navigationsleiste**. Dort legst Du mit **−**/**+** fest, wie viele Arbeitsflächen die Leiste zeigt (2–4, mit Live-Vorschau), und ordnest die Liste per **Zieh-Griff**: die oberen Einträge bilden die Leiste (im Rahmen markiert), nach oben ziehen befördert einen Bereich hinein. Am oberen oder unteren Rand scrollt die Liste beim Ziehen mit — so reicht eine Bewegung auch über die ganze Liste. Ausgeblendet wird nichts — was nicht in der Leiste steht, bleibt über **Bereiche** erreichbar. Verlässt der gerade offene Bereich die Leiste, springt die App auf den ersten sichtbaren. Dieselbe Leiste kannst Du auch **am Desktop** anordnen (Einstellungen → Vault → Leisten & Bereiche); mit eingeschaltetem Einstellungs-Sync reist die Anordnung zwischen Deinen Geräten mit.
- **＋** schwebt als runder Knopf über der Leiste und öffnet die Schnellanlage: Notiz, Tagesnotiz, Ordner, Datenbank, „Aus Vorlage…".
- **Kopfzeile:** überall dieselbe — links Zurück (auf einer Arbeitsfläche entfällt es), in der Mitte Titel und eine Zeile Kontext, rechts Suche und ⋮. Beim Scrollen hebt sie sich vom Inhalt ab, und die Navigationsleiste zieht sich auf ihre Symbole zurück; scrollst Du zurück, geht sie wieder auf.
- **Ein ⋮ bedeutet immer dasselbe:** Aktionen auf dem Objekt, das gerade offen ist. App-Einstellungen liegen nicht dahinter.
- **Einstellungen:** ganz unten unter **Notizen**, dort wo sie auch am Desktop stehen. Sie öffnen zuerst die Bereichsliste (wie die linke Seite der Desktop-Einstellungen) — ein Tipp öffnet die jeweilige Seite. Ganz oben führt **Aktiver Vault** zur Vault-Verwaltung: Vault wechseln (Häkchen = aktiv), **Neuen Vault erstellen** und **Mit Cloud verbinden**.

## Notizen lesen und bearbeiten

Notizen öffnen **gerendert und schreibgeschützt**; der Stift oben rechts wechselt ins Bearbeiten (mit Werkzeugleiste über der Tastatur: Formatierung, Listen, Wiki-Link, Slash-Befehle, Foto einfügen). `![[Notiz]]`-Einbettungen erscheinen als antippbare Vorschau-Karten.

Das **Notiz-Details**-Symbol in der Kopfzeile (zwischen Lesezeichen und ⋮-Menü) öffnet das Kontext-Blatt der Notiz: Eigenschaften (direkt editierbar), Backlinks, Gliederung, Graph und der **Versionsverlauf** — jede Bearbeitung erzeugt automatisch Snapshots, die Du ansehen, vergleichen und wiederherstellen kannst. Markdown-Quelltext und die Suche in der Notiz erreichst Du über das ⋮-Menü.

## Vorlagen

Vorlagen wirken auf dem Telefon genauso wie am Desktop: Die Platzhalter (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) werden beim Anlegen ersetzt, **alle** Fragen einer Vorlage erscheinen zusammen in **einem** Blatt — brichst Du es ab, entsteht nichts — und `{{cursor}}` setzt die Schreibmarke, sobald die Notiz aufgeht.

Die Zuordnungen **Ordner → Vorlage** und **Notiztyp → Vorlage** legst Du am Desktop fest; sie reisen über die Einstellungs-Synchronisation mit und greifen hier ebenso — eine Notiz in `Projekte/` beginnt also auf beiden Geräten gleich, auch beim `＋`-Erfassen und bei **+ Eintrag** in einer Datenbank. Zwei Feinheiten: `{{weekday:…}}` rechnet auf dem Telefon immer ab Montag (die Einstellung für den Wochenbeginn gibt es dort noch nicht), und `{{clipboard}}` fragt den Inhalt der Zwischenablage im selben Blatt ab, statt ihn ungefragt zu lesen. Alle Platzhalter stehen in [Notizen und Markdown](Notes_and_Markdown.md).

## Datenbanken (`.base`)

`.base`-Datenbanken funktionieren wie am Desktop: alle Ansichten (Tabelle, Liste, Galerie, Board, Kalender, Zeitachse), typgerechtes Bearbeiten der Zellen, Karten im Board per Gedrückthalten verschieben. Über **Konfigurieren** verwaltest Du Ansichten, Spalten, Filter (auch Gruppen), Sortierung und Eigenschaften. Relationen-Schema (Ziele, Kardinalität) pflegst Du weiterhin am Desktop.

Eine **Pinnwand**-Ansicht zeigt die Notizen als zweispaltiges Brett aus Zetteln: Tippen öffnet die Notiz, langes Drücken zeigt die Aktionen (Anpinnen, Labels, Farbe, Löschen), Ziehen nach langem Drücken ordnet um, und Kontrollkästchen lassen sich direkt auf der Karte abhaken. Das Eingabefeld oben erfasst einen neuen Zettel. Tipp: Zeigt die Datenbank auf Deinen Eingangsordner (**Einstellungen** → **Inhalt & Struktur**), landen auch die ＋-Schnellnotizen und aus anderen Apps geteilte Texte direkt auf dem Brett.

## Aufgaben

Der Bereich **Aufgaben** sammelt jede Checkbox Deines Vaults — alle `- [ ]`- und `- [x]`-Zeilen über alle Notizen hinweg, nach Notiz gruppiert. Das ist die zeilenbasierte Übersicht, die eine Datenbank nicht liefern kann, weil eine Datenbank mit ganzen Notizen arbeitet.

Tippen auf eine Aufgabe öffnet die Notiz **an dieser Zeile**; das Kästchen hakt ab und schreibt genau das eine `[ ]`/`[x]`-Zeichen zurück. Fälligkeit (`📅`) und `#tags` erscheinen als Chips, damit sie nicht doppelt im Text stehen.

Hat Dein Vault eine **Aufgaben-Datenbank** (**Einstellungen** → **Inhalt & Struktur**), zeigt der Bereich sie darüber als eigene Sektion: abhaken, Status wechseln, **+ Neue Aufgabe** und **Als Datenbank öffnen**. Jede Checkbox-Zeile bekommt dann zusätzlich einen Knopf, der sie **in die Datenbank verschiebt** — die Zeile bleibt als Wiki-Link stehen, die Aufgabe lebt ab dann als eigene Notiz.

Über der Liste stehen dieselben Filter wie am Desktop: **Ordner**, **Tag**, **Nur mit Fälligkeit** und **Ausgeblendete anzeigen**. Ausblenden ist eine Eigenschaft der **Notiz**, nicht der einzelnen Aufgabe — das Augen-Symbol an einer Notiz-Überschrift trägt `plainva.tasks: false` in deren Frontmatter ein und nimmt sie damit aus der Übersicht; **Vorlagen ausblenden** macht das in einem Zug für den ganzen Vorlagen-Ordner. Die Datei behält die Aufgaben, sie zählen nur nicht mehr mit. Ein langes Drücken auf den Verschieben-Knopf wählt die **Ziel-Datenbank** aus, wenn Dein Vault mehrere hat.

Zwei weitere Aktionen an einer Datenbank-Aufgabe: **Zeit blocken** legt bei verbundenem Kalender einen Termin für die Aufgabe an (Datum, Beginn, Dauer, bei mehreren beschreibbaren Kalendern die Auswahl), und die **Wiederholung** legt beim Abhaken die nächste Aufgabe mit neuer Fälligkeit an. Details zu beidem stehen unter [Aufgaben](Tasks.md).

## Heute

**Heute** ist die Tagesfläche. Der Streifen oben wählt einen Tag — er läuft **in beide Richtungen**, zwei Wochen zurück und zwei Wochen voraus, ein Punkt markiert jeden Tag, an dem schon eine Tagesnotiz liegt. Darunter steht die **Tagesnotiz** des gewählten Tages (mit Vorlage und Ordner, zum Öffnen oder Anlegen), dann **Termine und Fälligkeiten** dieses Tages und zuletzt, was Du an dem Tag bearbeitet hast.

Die mittlere Sektion führt zusammen, was sonst auf zwei Flächen liegt: ganztägige Termine zuerst, danach die zeitgebundenen in Uhrzeit-Reihenfolge, zum Schluss die Aufgaben, die an dem Tag fällig sind. Ein Tipp auf eine Aufgabe öffnet ihre Notiz. Ohne verbundenen Kalender und ohne Aufgaben-Datenbank fehlt die Sektion einfach.

## Tags

Die Tag-Liste liegt unter **Notizen**. Ein Tipp öffnet die Notizen eines Tags, das Chevron klappt verschachtelte Tags auf. **Langes Drücken** auf einen Tag bietet **Tag umbenennen** — vault-weit, wie am Desktop: Plainva schreibt jede Notiz um, die den Tag trägt (im Frontmatter und als `#tag` im Text, samt seiner `tag/unter`-Kinder) und nennt Dir danach, in wie vielen Notizen der Tag ersetzt wurde. Eine Notiz, die sich nicht lesen oder schreiben lässt, wird übersprungen — die übrigen werden trotzdem umbenannt.

## Graph

Die **Vault-Karte** zeigt Deinen Vault als Knoten und Kanten. Ein Tipp auf eine Ordner-Blase klappt sie auf, ein Tipp auf eine Notiz öffnet sie; die Chips darüber filtern nach Notiztyp, Tag und Kantenart. Ziehst Du einen Knoten, **merkt sich die Karte, wohin Du ihn gelegt hast** — die gemerkte Anordnung liegt in `.plainva/graph.json` und bleibt bewusst auf diesem Gerät, wie der Suchindex.

**Langes Drücken** auf einen Knoten setzt den **Fokus** auf ihn: die Karte zeigt dann nur noch seine Nachbarschaft bis zur gewählten Tiefe (1 bis 3). Der Chip mit der Tiefe hebt den Fokus wieder auf. Zwei weitere Chips lesen die Karte nach Alter: **Heatmap** färbt jeden Knoten danach, wie kürzlich er sich geändert hat, und **Zeitreise** blendet alles aus, was neuer ist als der Regler — so lässt sich zusehen, wie der Vault gewachsen ist.

## Kalender und Termine

Der **Kalender** (unterer Tab bzw. über „Mehr") zeigt Deine Tagesnotizen als Monatsraster. Das Uhr-Symbol oben rechts öffnet den **Termin-Kalender** mit den Ansichten **Tag**, **3 Tage** und **Agenda** — Deine verbundenen Kalender laufen über dasselbe Konten-Modell wie am Desktop. Ein Tipp auf einen Termin zeigt die Details; bei einer Einladung kannst Du direkt **zusagen**, **vorläufig** annehmen oder **absagen**.

Konten verwaltest Du über das Zahnrad-Symbol im Termin-Kalender: **CalDAV** verbindest Du direkt auf dem Gerät mit einem App-Passwort (z. B. Fastmail, Nextcloud, iCloud); Google und Microsoft folgen über die Browser-Anmeldung. Je Konto lassen sich einzelne Kalender ein- und ausblenden.

Aus einem Termin heraus legst Du über **Besprechungsnotiz** die zugehörige Notiz an — dieselbe Notiz, die auch der Desktop findet: sie trägt einen Anker auf den Termin, wird beim zweiten Aufruf wieder geöffnet statt doppelt angelegt und landet im **Meeting-Ordner**. Diesen Ordner und den **Standardkalender für Termine** (in dem ein neuer Termin startet) stellst Du im Konten-Bereich unter **Kalender-Einstellungen** ein; beides gilt für den Vault und reist über die Einstellungs-Synchronisation mit. Ebendort wählst Du je Konto auch die **Aufgabenlisten**, die in Deine Aufgaben-Datenbank gespiegelt werden.

**Anmelden gilt pro Gerät.** Synchronisiert werden Deine Konto-*Einstellungen*, nie die Anmeldung selbst — das ist Absicht: Zugangsdaten sollen das Gerät nicht verlassen. Ein Konto, das über die Einstellungs-Synchronisation kam, taucht deshalb in der Liste auf, trägt aber die Markierung **anmelden**; darunter steht, was zu tun ist. Solange kein Konto auf diesem Gerät angemeldet ist, erklärt der Kalender das an Ort und Stelle, statt einfach leer zu bleiben, und führt Dich mit **Auf diesem Gerät anmelden** zu den Konten. Angemeldete Konten zeigen **aktiv**. Läuft eine Anmeldung später ab oder wird sie widerrufen, steht dort **Anmeldung abgelaufen** samt Grund — und **Neu anmelden** setzt sie wieder in Gang, ohne das Konto zu entfernen: es bleibt dasselbe Konto mit denselben Kalendern.

**Ein Login für alle Dienste — auch hier.** Trägt ein Microsoft- oder Google-Konto mehrere Dienste (etwa Dateien und Kalender), bietet die Übersicht **Cloud-Konten** an, sie in einer einzigen Anmeldung zusammenzuführen. Danach hält eine Anmeldung jeden Dienst am Leben statt nur einen — vorher konnte ein Dienst weiterlaufen, während ein anderer desselben Kontos still abgelaufen war. Ein Gmail-Postfach bleibt außen vor: es läuft über IMAP mit App-Passwort und braucht keine Zustimmung.

## E-Mail

Unter **Einstellungen → E-Mail** verbindest Du ein **Microsoft-Postfach** (Outlook.com, Microsoft 365) direkt über die Anmeldung im Browser — ohne App-Passwort. Wie beim Kalender gilt: Anmelden geschieht pro Gerät.

Danach kannst Du **E-Mail** über das ▾ am Titel als eigenen Bereich öffnen und in der Navigationsleiste ablegen. Die Zeile unter dem Titel zeigt Ordner, ungelesene Anzahl und Konto und öffnet die Ordnerauswahl. Eine Nachricht öffnest Du per Tipp; **Als Notiz speichern** legt sie im Ordner **Mail** Deines Vaults ab (zweimal erfassen öffnet dieselbe Notiz). Externe Bilder bleiben blockiert, bis Du sie für die Nachricht freigibst — ein nachgeladenes Bild verrät dem Absender, wann und wo Du gelesen hast.

**IMAP-Postfächer funktionieren auf dem Telefon ebenfalls.** Leg eines unter **Einstellungen → E-Mail** an: Anbieter wählen, Adresse und App-Passwort eintragen, die Server füllt Plainva aus. Ist Dein Anbieter nicht dabei, trägst Du unter **Erweitert** IMAP- und SMTP-Server, Ports und einen abweichenden Benutzernamen selbst ein; ein bestehendes Konto lässt sich später bearbeiten. Mehrere Nachrichten wählst Du aus, indem Du eine davon gedrückt hältst; danach schaltet ein Tipp weitere hinzu. In der Konversations-Ansicht wählt das ganze Gespräch aus, wer die Konversationszeile hält oder antippt — jede Nachricht darin behält dabei ihren eigenen Ordner, eine Antwort aus **Gesendet** wird also auch dort markiert.

Eine geöffnete Nachricht bietet **Antworten**, **Allen antworten** und **Weiterleiten**. Antworten zitiert das Original unter Deinem Text; „Allen antworten" nimmt zusätzlich die übrigen Empfänger auf und lässt Deine eigene Adresse dabei weg. Beim **Verfassen** hängst Du über **Datei anhängen** eine Datei aus dem Vault an — auf dem Telefon ist der Vault der erreichbare Speicher, und alles, was auf dem Gerät ankommt (ein gespeicherter Anhang, ein eingefügtes Foto), liegt ohnehin dort. Jeder Anhang steht als eigene Zeile mit **Anhang entfernen**, solange die Nachricht noch nicht raus ist.

Schicken musst Du eine begonnene Nachricht nicht: **Als Entwurf** legt sie im Entwurfsordner Deines Kontos ab — also dort, wo jedes Mailprogramm auf diesem Postfach sie findet, nicht in einer Ablage nur auf dem Telefon. Welcher Ordner das ist, sagt der Server; nur wenn er dazu schweigt, wird der Name geraten. In der Liste blenden zwei Schalter neben der Ordnerzeile ein: **Ungelesen** verkleinert das, was gerade geladen ist (der Zähler und **Mehr laden** bleiben also erreichbar), **Markiert** fragt dagegen den Server nach allen markierten Nachrichten des Ordners — auch nach solchen weit unterhalb der geladenen Seite. In **Alle Posteingänge** fehlt der Markiert-Schalter mit Absicht: die Abfrage gilt genau einem Postfach.

Aus einer geöffneten Nachricht führen drei Wege in den Vault: **Als Notiz speichern**, im ⋮-Menü **→ Aufgabe** (legt einen Eintrag in Deiner Standard-Aufgabendatenbank an — mit Vorlage, Status und dem Datum der Mail) und **+ .eml**, das zusätzlich die Originalnachricht sichert und aus der Notiz darauf verlinkt. Alle drei sind verankert: dieselbe Mail zweimal zu erfassen öffnet, was schon da ist. **Löschen** liegt jetzt ebenfalls im ⋮-Menü statt neben dem Zurück-Pfeil; in der Liste genügt ein Wisch. Verschieben in den Papierkorb bietet **Rückgängig** an, weil es umkehrbar ist — endgültiges Löschen aus dem Papierkorb fragt weiterhin nach, weil es das nicht ist. Und statt mehrerer Hinweisbalken übereinander steht jetzt **eine** Zeile: der Fehler, sonst die nicht erreichbaren Konten (ab zwei als Anzahl), sonst der Hinweis auf die gespeicherte Kopie.

Eine Notiz kannst Du aus deren ⋮-Menü verschicken: **Notiz per E-Mail senden (mailto)** übergibt sie der Mail-App des Telefons — dafür braucht Plainva selbst kein Konto —, **Per Mail verschicken** öffnet Plainvas eigenes Verfassen-Fenster mit Betreff und Text.

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

Der Foto-Knopf im Editor fragt jetzt **Foto aufnehmen** oder **Aus Mediathek wählen**, behält die Einfügeposition und meldet Berechtigungs- oder Dateifehler sichtbar. Fotos landen im Anhänge-Ordner des Vaults — demselben, den auch Dein Rechner benutzt.

**Kalender** öffnet jetzt direkt den verbundenen Provider-Kalender. Tagesnotizen bleiben in der eigenen **Heute**-Ansicht; die frühere lokale Monats-Zwischenansicht wurde entfernt, ohne bestehende Notizen oder Kalenderdaten zu verändern.
