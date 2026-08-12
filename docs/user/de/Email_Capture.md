# E-Mail-Capture

Stand: 2026-08-12
Plainva kann Dein Postfach lesen, um Wissen aus E-Mails in Deinen Vault zu holen — und seit 0.4.0 auch Mails verfassen und senden. Der Schwerpunkt bleibt das **Ablegen** von Nachrichten als Notizen; ein über **IMAP** verbundenes Postfach wird für das Ablegen nur gelesen (im Postfach ändert sich nichts, nicht einmal die Ungelesen-Markierungen), solange Du den Versand nicht einrichtest.

> **Experimentell.** Der Mail-Client spricht mit echten externen Konten (IMAP/SMTP und Microsoft), die sich in Plainvas automatisierten Tests nicht durchspielen lassen. Er funktioniert und wird täglich genutzt, aber behandle ihn als Vorschau: Behalte ein Backup, und melde bitte alles, was seltsam aussieht.

## Ein Postfach verbinden

**Einstellungen → Dein Vault → Cloud-Konten → Konto verbinden…** und den Anbieter wählen:

- **Microsoft** — für Outlook.com und Microsoft 365: im Dienste-Schritt **E-Mail** anhaken (auf Wunsch zusammen mit **Dateien** und **Kalender & Aufgaben** — ein Konto, eine Anmeldung) und Dich direkt im Browser anmelden, ganz ohne App-Passwort oder IMAP. Plainva nutzt dafür die zentrale Plainva-App-Registrierung (Deine eigene App-ID kannst Du optional in den Konto-Details hinterlegen). Postfach lesen, ablegen und **direkt senden** laufen über die Microsoft-Anmeldung.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — eigene Kacheln: E-Mail-Adresse plus **App-Passwort**, die Server sind bereits hinterlegt (bei den meisten dieser Kacheln lässt sich im selben Schritt auch **Kalender & Aufgaben** anhaken — ein App-Passwort für alle gewählten Dienste). Der Assistent verlinkt jeweils die offizielle Anleitung des Anbieters zum Erstellen des App-Passworts.
- **E-Mail-Server (IMAP)** — für alle anderen Anbieter: Host, Port und ein Passwort bzw. **App-Passwort**. Fertige Voreinstellungen gibt es für Anbieter aus aller Welt — von **web.de**/**GMX** und **T-Online** über **Orange**, **Libero**, **WP**, **Seznam** und **Comcast** bis **QQ Mail**, **NetEase**, **Naver** und **Yahoo! JAPAN**; die Auswahl **Anbieter** hat dafür eine Suchzeile, und beim Eintippen der Adresse wird die passende Voreinstellung automatisch gewählt. Wo ein Anbieter Besonderheiten hat, sagt es der Assistent direkt unter dem Formular: manche verlangen ein **App-Passwort** oder einen **Autorisierungscode** statt des Konto-Passworts, bei anderen muss IMAP zuerst in den Einstellungen des Anbieters aktiviert werden — jeweils mit Link auf die offizielle Anleitung. Für Gmail ist das `imap.gmail.com`, Port `993`, mit einem App-Passwort von [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (setzt Zwei-Faktor-Anmeldung voraus) — kein OAuth, keine Verifizierung; der Assistent weist bei Gmail-Adressen selbst darauf hin. **Outlook.com-Postfächer** lassen sich nicht mehr per Passwort-IMAP verbinden (Microsoft hat diesen Weg abgeschaltet) — die Voreinstellung verweist auf die **Microsoft**-Kachel. **Proton Mail** funktioniert nur über die lokal laufende, kostenpflichtige Proton Mail Bridge (eigene Voreinstellung). Für den Direktversand kann ein SMTP-Host hinterlegt werden.

Beim Verbinden wird die Anmeldung geprüft, bevor irgendetwas gespeichert wird; die Zugangsdaten landen im Schlüsselbund Deines Betriebssystems. Die verbundenen Postfächer und die Ablage-Einstellungen findest Du danach im Bereich **E-Mail**: die Einstellung **E-Mail-Ordner** bestimmt, wo abgelegte E-Mails gespeichert werden (Standard `Mail`).

**Auf einem zweiten Gerät anmelden.** Reist ein Postfach über die Einstellungs-Synchronisation mit, kommt sein Passwort nicht automatisch mit — Anmeldungen werden nur übertragen, wenn Du den Zugangsdaten-Sync ausdrücklich einschaltest. Ein solches Postfach zeigt im Bereich **E-Mail** den Knopf **Auf diesem Gerät anmelden**: Passwort eingeben, Plainva prüft es beim Anbieter und legt es erst danach im Schlüsselbund ab. Bei einem Microsoft-Postfach führt derselbe Knopf zu **Cloud-Konten**, weil dort die Anmeldung im Browser läuft. Bleibt die Nachrichtenliste deswegen leer, steht derselbe Hinweis mit demselben Knopf auch dort — Du musst die Einstellungen dafür nicht selbst suchen.

## Mails lesen

Öffne den Mail-Tab über die linke Aktionsleiste (Brief-Symbol) oder die Befehlspalette (**E-Mail öffnen**). Die Liste zeigt Deinen Posteingang, Neueste zuerst (Ungelesene fett, **Mehr laden** blättert weiter). Eine ausgewählte Nachricht öffnet sich im **Sandbox-Viewer**:

- **Externe Inhalte sind blockiert** — Tracking-Pixel, externe Bilder und Stil-Nachlader werden entfernt und gezählt („Externe Inhalte blockiert (n)"). Nur eingebettete Inline-Bilder werden angezeigt. **Bilder anzeigen** neben dem Zähler blendet die https-Bilder einer Nachricht einmalig ein; **Externe Bilder immer laden** in den Mail-Einstellungen macht daraus ein dauerhaftes Opt-in. Wichtig: Beim Laden externer Bilder sieht der Absender Deine IP-Adresse und wann Du die Mail geöffnet hast — deshalb ist Blockieren der Standard.
- **Gelesen heißt gelesen** — eine geöffnete Nachricht gilt nach drei Sekunden als gelesen. Markierst Du sie dabei **von Hand als ungelesen**, bleibt sie ungelesen, solange sie offen ist; erst wenn Du sie verlässt und erneut öffnest, läuft die Frist wieder. Auf beiden Geräten gleich — vorher holte der Zeitgeber am Desktop die Markierung nach drei Sekunden zurück, und das Telefon markierte sofort beim Öffnen.
- Links erscheinen als reiner Text und sind im Viewer nicht klickbar.
- Skripte und Formulare laufen nie. Die Nachricht wird in einem isolierten Rahmen mit strikter Inhalts-Richtlinie dargestellt.
- **Konversationen** — der Schalter über der Liste (Sprechblasen-Symbol) fasst zusammengehörende Nachrichten zu einer Zeile zusammen: Beteiligte, Anzahl und der Betreff, mit dem das Gespräch begann. Ein Tipp klappt sie auf; jede Nachricht behält ihren Ordner und nennt ihn, wenn er nicht der geöffnete ist. Plainva liest dafür auch **Gesendet** mit, damit Deine eigenen Antworten im Gespräch stehen. Ausgeschaltet bleibt alles wie bisher — eine flache Liste —, und der Schalter wird pro Vault gemerkt, auf beiden Geräten. Zusammengefasst wird nach der Antwort-Kette der Nachrichten (bei Microsoft nach der Konversation, die der Anbieter selbst führt); nur wenn eine Antwort diese Kette nicht mitschickt, hilft der Betreff aus — und dann nur bei einer erkennbaren Antwort („Re:“, „AW:“) und innerhalb von 30 Tagen, damit zwei gleichnamige Mails nicht zusammenrutschen.
- **Alle Posteingänge** — die erste Zeile über der Ordnerliste zeigt die Posteingänge **aller** Konten in einer Liste, neueste zuerst, und jede Zeile nennt das Konto, zu dem sie gehört. Gelesen/ungelesen und Markieren wirken auch hier; Verschieben und Löschen bleiben dem einzelnen Postfach vorbehalten, weil jedes Konto seinen eigenen Zielordner hat — öffne die Nachricht, dann handelst Du in ihrem Postfach. Ein Konto, dessen Anmeldung fehlt, wird beim Namen genannt und leert die Liste der anderen nicht.
- **Mehrere auswählen** — Strg-Klick (macOS: ⌘-Klick) wählt einzelne Nachrichten, Umschalt-Klick einen Bereich; in der Konversations-Ansicht wählt ein Strg-Klick auf die Konversation gleich das ganze Gespräch, und jede Nachricht darin behält dabei ihren eigenen Ordner.

Anhänge werden mit Name und Größe gelistet; die Original-`.eml` (siehe unten) enthält sie vollständig.

Beim Öffnen eines Ordners, den Du schon einmal geöffnet hast, erscheint die Liste **sofort** aus dem lokalen Zwischenspeicher, während im Hintergrund aktualisiert wird; solange das läuft, sagt ein Hinweis „wird aktualisiert“ — bestätigt ist erst, was der Server geliefert hat. Dasselbe gilt für eine Nachricht, die Du schon gelesen hast. Auf dem Telefon wird die **neueste** Nachricht eines Ordners im Hintergrund vorgeladen — sie öffnet sich dann ohne Wartezeit, auch wenn Du sie noch nie geöffnet hattest.

Am Desktop lassen sich die drei Spalten (Ordner · Liste · Leser) an den Trennlinien mit der Maus verschieben; die Breiten werden **pro Vault** gemerkt und überleben einen Neustart. Jede Spalte behält eine Mindestbreite, damit der Leser nicht verdrängt werden kann.

Schlägt eine Aktualisierung fehl — kein Netz, oder der Anbieter drosselt —, zeigt die Liste weiterhin den zuletzt auf diesem Gerät gesehenen Stand, mit einem entsprechenden Hinweis, statt einer leeren Fläche. Eine bereits gelesene Nachricht bleibt auf demselben Weg lesbar. Das ist immer nur ein Zwischenspeicher: Der Server gewinnt, nichts davon ist die einzige Kopie, und mit dem Vault verschwindet auch er.

## Eine Nachricht in den Vault holen

Drei Knöpfe an jeder Nachricht:

- **Als Notiz ablegen** — erstellt eine Notiz im E-Mail-Ordner (`JJJJ-MM-TT Betreff.md`) mit Absender und Datum im Frontmatter und dem Text der Mail unter der Betreff-Überschrift. Dieselbe Nachricht ein zweites Mal abzulegen öffnet die vorhandene Notiz, statt sie zu duplizieren.
- **+ .eml** — legt zusätzlich das rohe Original neben die Notiz und verlinkt es. Die `.eml` enthält alles, auch die Anhänge, und öffnet sich in jedem Mail-Programm.
- **→ Aufgabe** — erstellt einen Eintrag in Deiner [Standard-Aufgabendatenbank](Tasks.md) mit dem Betreff als Titel, dem heutigen Datum als Fälligkeit und dem offenen Status vorbefüllt.

## Verfassen und senden

Sobald ein Konto senden kann — ein **Microsoft**-Konto oder ein **IMAP**-Konto mit hinterlegtem **SMTP-Host** —, kannst Du in Plainva Mails schreiben und senden:

- **Verfassen** (im Mail-Tab) öffnet ein freischwebendes Fenster mit beschrifteten Zeilen **Von / An / Cc / Bcc**. Tipp eine Adresse und drück Enter oder Komma, um sie in einen Chip zu verwandeln; **Cc/Bcc** blenden sich bei Bedarf ein. Der Textkörper ist ein Markdown-Editor mit Formatierungsleiste und „/"-Befehlsmenü. Ein Link `[Text](https://…)` erscheint beim Schreiben als fertiger Link — die Markdown-Zeichen tauchen wieder auf, sobald der Cursor hineinfährt, und ein Klick öffnet das Ziel im Browser. Beim Versand wird der Text ohnehin in HTML umgewandelt: Der Empfänger bekommt immer einen echten Link, unabhängig davon, wie er im Fenster aussieht.
- **Vorlage einfügen…** setzt eine Notiz-Vorlage in den Textkörper. Fragen der Vorlage (`{{prompt:…}}`) werden **einmal in einem Dialog** gestellt, nicht als Platzhalter mitgeschickt; das Frontmatter der Vorlage bleibt draußen — ein Mail-Text hat keins, und der Empfänger bekäme sonst YAML. Bricht der Dialog ab, wird nichts eingefügt.
- **Antworten**, **Allen antworten** und **Weiterleiten** an jeder Nachricht öffnen dasselbe Fenster mit zitiertem Original und vorbelegten Empfängern; beim Weiterleiten kommen die Anhänge mit.
- **Senden** läuft über SMTP (IMAP-Konten) oder Microsoft Graph (Microsoft-Konten).
- **Diese Notiz per Mail** (⋮-Menü einer Notiz oder Befehlspalette) startet eine Nachricht mit der aktuellen Notiz als Anhang oder inline als Text.

## Eine Notiz ohne den Mail-Client weitergeben

Du musst nicht aus Plainva heraus senden. Das hier funktioniert an jeder Notiz und braucht kein SMTP; das YAML-Frontmatter der Notiz wird dabei nie mitgeschickt — nur ihr Text:

- **Antwort als Notiz** (an einer Nachricht): erstellt eine Notiz an den Absender (`to:` im Frontmatter) mit dem zitierten Original — schreib Deine Antwort in Plainva. Versendest Du diese Notiz später (oder legst sie als Entwurf ab), wird die `to:`-Adresse automatisch ins **An**-Feld übernommen.
- **Notiz als E-Mail-Entwurf ins Postfach** (Befehlspalette, an jeder offenen Notiz): legt die Notiz per IMAP als **Entwurf in Dein eigenes Postfach** — Konto, Empfänger und Entwurfsordner wählen, dann im normalen Mail-Programm öffnen, prüfen und von dort senden. Die Formatierung bleibt erhalten.
- **Notiz per E-Mail senden (mailto)** (Befehlspalette): öffnet Dein Standard-Mail-Programm mit der Notiz als reinem Text (lange Notizen werden gekürzt).
- **Notiz als E-Mail-Text kopieren** (Befehlspalette): legt die Notiz mit Formatierung in die Zwischenablage — in jeden Editor einfügbar.

## Signatur und Absender-Adressen

Unter **Einstellungen → E-Mail → Senden** hat jedes Postfach zwei eigene Einstellungen:

- **Signatur** — Markdown, wird beim Verfassen unter Deinen Text gesetzt (und über einem zitierten oder weitergeleiteten Original, wo ein Leser sie erwartet). Wechselst Du im Verfassen-Fenster den Absender, wird die Signatur ausgetauscht statt eine zweite anzuhängen. Das Feld ist derselbe Editor wie im Verfassen-Fenster — Du siehst die Signatur also so, wie sie verschickt wird.
- **Signatur je Adresse** — hast Du weitere Absender-Adressen hinterlegt, erscheint über dem Feld die Auswahl **Signatur für**. „Standard (alle Adressen)" ist die Signatur des Kontos; wählst Du eine Adresse, schreibst Du eine eigene nur für sie. Adressen ohne eigene Signatur nutzen weiter die Standard-Signatur, und ein Wechsel des Absenders im Verfassen-Fenster tauscht die richtige ein — auch zwischen zwei Adressen desselben Kontos. Leerst Du das Feld einer Adresse, fällt sie auf den Standard zurück.
- **Weitere Absender-Adressen** — eine pro Zeile, z. B. `Name <alias@example.org>`. Das Feld **Von** im Verfassen-Fenster listet dann Adressen statt Konten: zuerst die eigene des Postfachs, danach die Aliasse. Ob eine Adresse tatsächlich akzeptiert wird, entscheidet Dein Anbieter — ein Server, der das Senden unter einem Alias verweigert, sagt das, und Plainva zeigt diesen Fehler, statt still unter anderem Namen zu senden.

## Postfachaktionen

Sterne/Markierungen werden mit IMAP und Microsoft synchronisiert; **Markiert** zeigt die serverseitige Auswahl. Nachrichten lassen sich einzeln oder gesammelt verschieben. Außerhalb des Papierkorbs bedeutet **Löschen** immer „in den Papierkorb verschieben“; nur im Papierkorb ist **Endgültig löschen** nach einer Bestätigung verfügbar. Bei Gmail entspricht Verschieben einem Labelwechsel, und Aktionen in **Alle Nachrichten** können die Nachricht in allen Labels betreffen – Plainva weist vor der Aktion darauf hin.

## Abmelden und Senden zurücknehmen

Trägt eine Nachricht die Kopfzeile `List-Unsubscribe`, zeigt Plainva im Leser einen Knopf **Abmelden**. Was dahinter passiert, hat der **Absender selbst** angegeben — Plainva rät nichts aus dem Text und klickt nichts heimlich: eine Web-Adresse öffnet sich nach Rückfrage im Browser, eine Mail-Adresse landet im Verfassen-Fenster, damit Du siehst, was hinausgeht. Unverschlüsselte `http://`-Adressen werden verworfen, weil eine Abmeldung darüber Deine Adresse offen überträgt.

**Senden rückgängig** ist eine **Verzögerung, keine Rücknahme**: Nach dem Absenden wartet Plainva ein paar Sekunden, bevor die Nachricht wirklich an den Server geht — in dieser Zeit hält ein Hinweis den Knopf **Rückgängig** bereit. Danach ist sie unterwegs und nicht mehr aufzuhalten; kein Mailprogramm der Welt kann eine zugestellte Nachricht zurückholen. Verlässt Du Plainva in dem Moment (am Telefon: wechselst in eine andere App), wird **sofort gesendet** statt abgebrochen — eine Nachricht, die Du abschicken wolltest, darf nicht verschwinden, nur weil die App in den Hintergrund geht.

## Zurückstellen

Manche Post ist nicht dringend, aber auch nicht erledigt. **Zurückstellen** nimmt eine Nachricht bis zu einem Zeitpunkt aus der Liste — später heute, morgen früh, am Wochenende oder nächste Woche. Am Rechner steht der Punkt im Rechtsklickmenü der Zeile, am Telefon zusätzlich als Wischaktion. Der Knopf **Zurückgestellte** holt sie sichtbar zurück; von dort bringt **Jetzt zurückholen** eine Nachricht sofort in die Liste.

Zwei Dinge dazu, die ehrlich gesagt sein wollen. Erstens ist Zurückstellen **Plainvas eigener Merker**, keine Server-Funktion: weder IMAP noch Microsoft kennen so etwas. Der Merker reist über die Einstellungs-Synchronisation mit, also ruht eine am Telefon zurückgestellte Nachricht auch am Rechner — in einem anderen Mailprogramm liegt sie dagegen ganz normal im Posteingang. Zweitens versteckt Zurückstellen nur die **Liste des Ordners**, in dem Du es getan hast: die Suche und „Alle Posteingänge" zeigen die Nachricht weiterhin. Zurückgestellt heißt „nicht im Weg", nicht „weg".

## Spam melden

**Spam** verschiebt eine Nachricht in den Spam-Ordner des Kontos und markiert sie dort, wo der Server das kennt, mit dem Schlüsselwort `$Junk`. Im Spam-Ordner heißt derselbe Knopf **Kein Spam** und holt die Nachricht in den Posteingang zurück. Beides gibt es im Leser, in der Mehrfachauswahl und am Telefon zusätzlich als Wischaktion der Zeile.

Ehrlich dazu: **Verschieben allein trainiert den Filter nicht zwingend.** Manche Server lernen daraus, andere speichern das Schlüsselwort nur, wieder andere lehnen es ab. Plainva sagt Dir nach der Aktion, was tatsächlich passiert ist — „als Spam markiert und verschoben“ oder nur „verschoben“. Hat Dein Konto gar keinen Spam-Ordner, bietet Plainva an, einen Ordner **Junk** anzulegen, statt Post in einen erfundenen Ordnernamen zu schieben.

## Abwesenheitsnotiz

Eine Abwesenheitsnotiz gehört auf den Server, nicht in ein Programm, das gerade offen ist. Plainva bietet sie deshalb **nur dort an, wo sie den ausgeschalteten Rechner überlebt** — bei Microsoft-Konten und bei Postfächern mit einem Sieve-Server (mailbox.org, Fastmail, Nextcloud, Mailcow und andere). Hat ein Postfach beides nicht, erscheint kein Schalter, sondern ein Satz, der das erklärt.

Du findest sie unter **Einstellungen → E-Mail** und am Telefon im Konten-Bereich: Betreff, Text und ein Zeitraum. Ohne Zeitraum läuft die Notiz, bis Du sie ausschaltest; mit Zeitraum beginnt und endet sie von selbst — auch wenn Du Plainva nie wieder öffnest.

**Deine eigenen Filterregeln bleiben unangetastet.** Plainva schreibt in ein Sieve-Skript ausschließlich seinen eigenen, mit `# --- BEGIN PLAINVA` gekennzeichneten Abschnitt und lässt alles andere Zeichen für Zeichen stehen. Findet es dort einen Abschnitt vor, den es nicht sicher lesen kann, ändert es **nichts** und sagt Dir das.

## Regeln

Eine Regel prüft Absender, Empfänger oder Betreff und tut dann etwas: verschieben, als gelesen markieren, markieren, als Spam melden oder in den Papierkorb legen. Du findest sie unter **Einstellungen → E-Mail**.

**Und jetzt das Wichtige daran:** Regeln laufen zurzeit **nur, während Plainva geöffnet ist**, und nur über Nachrichten, die Plainva abgerufen hat. Am Telefon heißt das zusätzlich: nur, während die App im Vordergrund war. Eine Regel filtert also nichts, während der Rechner aus ist — die Karte sagt das an Ort und Stelle, statt einen Serverfilter anzudeuten, den es an dieser Stelle noch nicht gibt.

Prüft eine Regel den **Nachrichtentext**, greift sie erst, wenn Du die Nachricht öffnest: der Text steht nicht in der Übersicht. Auch das steht in der Karte.

**Beim Anbieter hinterlegen.** Hat Dein Postfach einen Sieve-Server, macht der Knopf **Beim Anbieter hinterlegen** aus Deinen Regeln ein Serverfilter: er läuft dann auch, wenn Plainva geschlossen ist. Plainva schreibt dabei nur seinen eigenen gekennzeichneten Abschnitt und lässt Deine handgeschriebenen Regeln unverändert stehen — dieselbe Zusage wie bei der Abwesenheitsnotiz, denn beide teilen sich diesen einen Abschnitt.

Eine Regel, die Dein Server nicht ausdrücken kann — etwa eine Prüfung des Nachrichtentexts auf einem Server ohne die passende Erweiterung —, bleibt **lokal** und wird Dir genannt. Sie wird bewusst nicht mit hochgeladen: ein Skript mit einer Anforderung, die der Server nicht kennt, weist er **als Ganzes** zurück, und damit wäre auch die Abwesenheitsnotiz weg.

Regeln bei Gmail richtest Du weiterhin in Googles eigenen Einstellungen ein.

**Bei Microsoft** braucht es keinen zusätzlichen Server: derselbe Knopf legt Deine Regeln als Outlook-Regeln im Postfach ab. Plainva ersetzt dabei ausschließlich die Regeln, die es selbst angelegt hat, und lässt Deine eigenen unangetastet — es setzt sie außerdem **hinter** Deine, denn eine von Hand geschriebene Regel war zuerst da. Microsoft vergleicht nur mit „enthält“; „ist genau“, „beginnt mit“, „endet mit“, eine Regel auf Kopie-Empfänger und das Markieren bleiben deshalb dort lokal — und werden Dir genannt.

**Am Telefon** legst Du Regeln vollständig selbst an: In den Mail-Einstellungen tippst Du auf eine Regel und bekommst sie als **Wenn** und **Dann** — jede Bedingung und jede Aktion ist eine Zeile, und ein Tipp darauf fragt in einzelnen Blättern nach Feld, Vergleich und Wert. Das ist bewusst kein geschrumpftes Formular: fünf Bedienelemente nebeneinander auf Handybreite sind der Weg, auf dem man eine Regel vertippt. Die letzte Bedingung lässt sich nicht entfernen — eine Regel ohne Bedingung würde auf jede Nachricht passen.

**Als Notiz ablegen** ist die Aktion, die kein Mail-Programm hat: die Regel legt die Nachricht als Notiz in Deinem Vault ab, mit Absender, Datum und Text — dieselbe Erfassung wie der Knopf im Leser, nur automatisch. Dieselbe Mail zweimal ergibt **dieselbe** Notiz, und die Nachricht bleibt im Ordner liegen: abgelegt wird eine Kopie, nichts wird verschoben. Eine Regel mit dieser Aktion bleibt **immer lokal** — auch bei einem Postfach, das Regeln könnte. Das ist Absicht: würde Plainva den Rest der Regel hinterlegen, verschöbe der Server die Nachricht, bevor überhaupt etwas abzulegen wäre.
