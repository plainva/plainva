# Kalender & externe Aufgaben

Stand: 2026-08-12
Plainva kann Deine bestehenden Kalender- und Aufgaben-Konten verbinden — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Kalender + Tasks) und **Microsoft** (Outlook-Kalender + To Do) — und in beide Richtungen damit arbeiten. Deine Notizen bleiben das Zentrum: Termine werden zu Meeting-Notizen, und externe Aufgabenlisten spiegeln sich als normale Notizen in Deine [Standard-Aufgabendatenbank](Tasks.md).

> **Experimentell.** Der Kalender spricht mit echten externen Konten (CalDAV, Google, Microsoft), die sich in Plainvas automatisierten Tests nicht durchspielen lassen. Er funktioniert und wird täglich genutzt, aber behandle ihn als Vorschau: Behalte ein Backup, und melde bitte alles, was seltsam aussieht.

## Ein Konto verbinden

Öffne **Einstellungen → Dein Vault → Cloud-Konten → Konto verbinden…**, wähle den Anbieter und hake im Dienste-Schritt **Kalender & Aufgaben** an:

- **Nextcloud / CalDAV**: Server-Adresse, Benutzername und ein **App-Passwort** (in Nextcloud: Einstellungen → Sicherheit → Geräte & Sitzungen). Keine Registrierung, keine Keys — bei Nextcloud leitet Plainva die CalDAV-Adresse aus der Server-Adresse selbst ab (für andere CalDAV-Server nimmst Du die Kachel **WebDAV / CalDAV** bzw. **Erweitert: Endpunkte einzeln festlegen**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: eigene Kacheln mit hinterlegten Kalender-Adressen — E-Mail-Adresse plus **App-Passwort** genügen, ohne Server-Feld (bei Apple ist das App-Passwort Pflicht; der Assistent verlinkt die Anleitung des Anbieters). Hinweis: Yahoos CalDAV-Dienst gilt laut Yahoo selbst als wackelig — wenn er zickt, liegt es nicht an Plainva.
- **Google**: braucht Deine eigene OAuth-Client-ID (dasselbe BYO-Modell wie beim Google-Drive-Sync — siehe die [Drive-Anleitung](Google_Drive_BYO_Guide.md)). Aktiviere in Deinem Google-Cloud-Projekt zusätzlich die *Google Calendar API* und die *Google Tasks API* und ergänze ihre Scopes im Consent-Screen. Der Browser öffnet sich zur Zustimmung; beim Verbinden wird das Konto geprüft, bevor irgendetwas gespeichert wird.
- **Microsoft**: einfach **Bei Microsoft anmelden…** klicken und im Browser bestätigen — keine Einrichtung nötig. Ein Microsoft-Konto kann im selben Durchgang auch **Dateien** (OneDrive) und **E-Mail** tragen.

Der Assistent zeigt je Dienst den Status („Verbunden — n Kalender gefunden"). Die **Kalender**-Auswahl (angehakte erscheinen im Kalender-Tab) und die **Aufgabenlisten** (bewusst standardmäßig abgewählt — ein Häkchen startet den unten beschriebenen Aufgaben-Sync) verwaltest Du danach im Bereich **Kalender**; dort sitzen auch der **Meeting-Ordner** (wo Meeting-Notizen entstehen) und der **Standardkalender**. Passwörter und Tokens liegen im Schlüsselbund Deines Betriebssystems.

**Jedes Gerät meldet sich selbst an.** Wenn Du die [Einstellungs-Synchronisation](Sync_Setup.md#sync-verschlüsselung-passphrase) nutzt, reisen die Konto-*Angaben* mit, die Anmeldung aber nie — sie bleibt bewusst auf dem Gerät. Ein so übernommenes Konto erscheint auf dem anderen Gerät also in der Liste, ist dort aber noch nicht angemeldet; in der [mobilen App](Mobile_App.md) trägt es dann die Markierung **anmelden** und der Kalender erklärt es statt leer zu bleiben. Einmal verbinden genügt.

**Wenn eine Anmeldung abläuft.** Der Kalender-Bereich zeigt den Fehler dann direkt am betroffenen Konto und sagt, was zu tun ist: Ist die Anmeldung abgelaufen oder wurde sie widerrufen, steht dort **Erneut anmelden** — ein Durchgang, der bei Microsoft und Google **alle** Dienste dieses Kontos wieder in Gang setzt (Dateien, Kalender, E-Mail). Liegt es an der Anbieter-Konfiguration (falsche oder gelöschte Client-ID, fehlende API im Projekt), verweist der Hinweis dorthin statt eine neue Anmeldung anzubieten; bei einem Netzwerkfehler genügt ein späterer Versuch. Bei einem Google-Projekt im **Testing**-Modus ist der häufigste Fall die 7-Tage-Grenze — Details in der [Drive-Anleitung](Google_Drive_BYO_Guide.md). Solange ein Konto nicht erreichbar ist, behauptet Plainva nicht mehr, es biete keine Aufgabenlisten an: die Liste bleibt leer, mit dem Fehler darüber. In der mobilen App gilt dasselbe: Die Kontozeile nennt den Grund, und **Neu anmelden** repariert das Konto an seinem Platz.

## Der Kalender-Tab

**Googles Statuseinträge** — Arbeitsort, Fokuszeit und Abwesenheit — erscheinen in Plainva als eigene Zeile beziehungsweise als ruhiges Band hinter dem Tag, nicht als weiterer Terminblock: „Homeoffice" ist kein Termin, und ein Tag mit drei solchen Einträgen und einer Besprechung darf nicht wie vier Besprechungen aussehen. Plainva **liest** sie und schreibt sie nie — eine Abwesenheit bei Google anzulegen sagt dort automatisch Einladungen ab, und das ist keine Nebenwirkung, die eine Kalenderansicht auslösen sollte.

Öffne ihn über die linke Aktionsleiste (Kalender-Symbol) oder die Befehlspalette (**Kalender öffnen**). Über den Umschalter im Kopf stehen fünf Ansichten bereit: **Tag**, **3 Tage** und **Woche** zeigen ein **Zeitraster** mit einer Uhrzeit-Leiste links; Termine sitzen als Blöcke an ihrer Startzeit, ihre Höhe entspricht der Dauer, überlappende Termine stehen nebeneinander, und eine rote Linie markiert „jetzt". Ganztägige Termine und (bei eingeschaltetem Aufgaben-Overlay) fällige Aufgaben sitzen im Streifen über dem Raster. **Monat** zeigt das Monatsraster (ein Farbpunkt je Kalender) plus rechts ein Tages-Zeitraster für den gewählten Tag. **Agenda** listet die kommenden Wochen nach Tagen gruppiert. **Heute** springt zurück; die Pfeile blättern um die jeweilige Periode (einen Tag, drei Tage, eine Woche oder einen Monat). Der erste Wochentag folgt der Einstellung **Wochenbeginn** (Einstellungen → App → Erscheinungsbild: Montag, Samstag oder Sonntag) — sie gilt auch für den Seitenleisten-Kalender. Die Ansicht aktualisiert sich alle paar Minuten von selbst; **Jetzt aktualisieren** erzwingt es. Bereits vergangene Termine erscheinen **blasser** (wie im Google Calendar), damit die verbleibende Agenda des Tages hervorsticht. Ein **mehrtägiger Termin** ist ein durchgehender **Balken** über die Tage, die er berührt — eine Beschriftung, ein Klickziel, statt eines Eintrags je Tag. Reicht er über das Wochenende hinaus, wird er an der Wochenkante gerade abgeschnitten und läuft in der nächsten Zeile ohne wiederholten Titel weiter. Dasselbe gilt im Ganztags-Streifen der Tages-, Drei-Tage- und Wochenansicht.

- **Termin anlegen**: Ein **Klick auf eine leere Stelle im Zeitraster** öffnet ein kleines Schnell-Erfassungs-Fenster (Titel, Zeit, Kalender, Ort) — **Speichern** legt sofort an, **Weitere Optionen** öffnet den vollen Termin-Dialog. **Ziehen** über das Raster gibt die Dauer vor. Das **+** im Kopf öffnet den vollen Dialog: Titel, Kalender, Datum/Uhrzeit oder ganztägiger Zeitraum, Ort, eine **Beschreibung** (ein Formatier-Editor — Markdown, „/" für Befehle; formatierte Beschreibungen von Google/Outlook erscheinen lesbar statt als roher HTML-Code, und eine formatierte Beschreibung wird auch formatiert verschickt), eine **Farbe**, **Teilnehmer** und optional eine Outlook-artige **Wiederholung**. Die Farbe überschreibt für diesen einen Termin die Kalenderfarbe (bei Microsoft-Konten ohne Wirkung — Outlook kennt keine Termin-Farben).
- **Teilnehmer**: Tippe eine E-Mail-Adresse und drücke **Enter** (oder Komma), um sie als **Chip** hinzuzufügen; das × entfernt sie. Die Wiederholung sitzt direkt neben Datum/Uhrzeit — wähle Frequenz, Intervall, die Wochentage (wöchentlich) und das Ende (Nie / Am Datum / Nach N Terminen); auch bestehende Termine können nachträglich eine Wiederholung bekommen oder ändern.
- **Ansehen**: Ein **Klick auf einen Termin** öffnet die **Termin-Vorschau** — ein freischwebendes Fenster, das den Termin zeigt, statt ihn zu bearbeiten: Zeitraum, Ort, Beschreibung, Teilnehmende mit ihren Antworten, dazu **Zusagen / Vorläufig / Absagen**, **Meeting-Notiz** und über das **⋮** alle übrigen Aktionen (Farbe, in anderen Kalendern blockieren, per Mail versenden, löschen). Das Fenster dunkelt die App nicht ab, lässt sich verschieben und in der Größe ändern; **Esc** schließt es. Gehört der Termin zu einer **Serie**, sagt die Vorschau das — mit dem Rhythmus und, sofern geladen, dem nächsten Termin. Gefragt wird nichts: „Nur diesen oder alle?“ ist eine Frage übers Ändern, nicht übers Ansehen.
- **Bearbeiten / Löschen**: **Termin bearbeiten** in der Vorschau öffnet den Dialog, vorbefüllt mit seinen Werten und mit den Aktionen **Meeting-Notiz** und **Löschen**. Änderungen gehen mit einer Sicherheitsprüfung an den Anbieter: hat sich der Termin zwischenzeitlich extern geändert, aktualisiert Plainva die Ansicht, statt zu überschreiben. Bei einem **Einzeltermin** hat der Dialog zusätzlich eine **Kalender-Auswahl** — wählst Du einen anderen Kalender, wird der Termin dorthin **verschoben** (im Zielkalender neu angelegt, im Quellkalender gelöscht; er bekommt dabei eine neue Anbieter-Kennung).
- **Serientermine**: Ein Termin aus einer Serie öffnet sich zum Bearbeiten wie jeder andere — gefragt wird erst beim **Speichern**, und nur, wenn Du wirklich etwas geändert hast. Der Dialog nennt die Änderung („Zeit: 09:00 → 09:15") und fragt dann, ob sie **nur für diesen Termin** oder **für alle Termine der Serie** gelten soll. Bei „alle" wandert nur das Geänderte zur Serie; ihr eigenes Startdatum und alles, was Du nicht angefasst hast, bleibt. Schließt Du das Formular unverändert, passiert gar nichts — kein Dialog, kein Schreibvorgang beim Anbieter. Beim **Löschen** kommt die Frage weiterhin vorn: dort ist der Klick schon die Änderung.
- **Verschieben / Verlängern**: Einen Termin kannst Du im Zeitraster direkt **ziehen** — den Block verschieben (auch auf einen anderen Tag in der Wochen-/3-Tage-Ansicht) legt ihn auf eine neue Zeit, die **Unterkante** ziehen ändert seine Dauer. Der neue Zeitpunkt wird sofort beim Anbieter gespeichert (Serientermine bleiben vorerst nur per Dialog änderbar).
- **Wie ein Termin aussieht**: Ein **abgesagter** Termin bleibt sichtbar, erscheint aber nur als **Umriss** mit **durchgestrichenem Titel** — Du siehst, dass der Slot frei geworden ist, statt ihn stillschweigend zu verlieren. Eine **Einladung, die Du noch nicht beantwortet hast**, ist ebenfalls ein Umriss (es ist noch nicht Dein Termin); ein **vorläufiger** Termin — vom Veranstalter so markiert oder von Dir mit „Vielleicht“ beantwortet — ist **schraffiert**. Alles Bestätigte bleibt gefüllt. In der Agenda steht zusätzlich das Wort (**Abgesagt**, **Offen**, **Vielleicht**). Hast Du selbst **abgesagt**, wird der Termin ein **abgeblendeter Umriss** mit durchgestrichenem Titel (in der Agenda **Du hast abgesagt**): Er findet für die anderen statt, gehört aber nicht mehr zu Deinem Tag. Die Absage des Veranstalters bleibt kräftiger — sie betrifft alle.
- **Zu-/Absagen & Antworten**: Wurdest Du zu einem Termin eingeladen, kannst Du im Dialog **Zusagen**, **Vorläufig** oder **Absagen** — Plainva sendet Deine Antwort über den Anbieter (Google/Microsoft/CalDAV). Die **Teilnehmerliste** zeigt, wer zu- oder abgesagt hat (der Rückkanal).
- **Einladungen per E-Mail**: Hat ein Termin Teilnehmer, setze **Teilnehmer per E-Mail benachrichtigen**. Bei Google bittet Plainva dann Google, seine native Einladung zu senden (derselbe Termin, sodass die Antworten der Empfänger in Deinen Termin zurücksynchronisieren); Microsoft benachrichtigt automatisch. Für CalDAV — oder um eine Kopie aus dem eigenen Postfach zu senden — öffnet die Kalender-Aktion **Per Mail versenden** das Verfassen-Fenster mit einer standardkonformen iCalendar-Einladung; so zeigt Gmail (und andere) sie als Termin mit Ja/Vielleicht/Nein.
- **In anderen Kalendern blockieren**: Die **Kopier**-Aktion an einem Termin (oder der Knopf **In anderen Kalendern blockieren** im Dialog) übernimmt ihn in einen oder mehrere Deiner anderen beschreibbaren Kalender — entweder als **Beschäftigt**-Platzhalter oder **mit Details** (im Notion-Calendar-Stil). Ein Serientermin wird mit seiner Wiederholung übernommen, sodass der Block ebenfalls wiederkehrt.
- **Serientermine** tragen ein Wiederholungs-Symbol. Beim Bearbeiten oder Löschen einer Instanz fragt Plainva **„Nur diesen Termin"** (erzeugt eine Ausnahme bzw. lässt genau diesen Termin ausfallen) oder **„Alle Termine"** (ändert die ganze Serie). Eine bestehende Wiederholungs-Regel schreibt Plainva nie um.
- **Aufgaben anzeigen** (neben dem Aktualisieren-Knopf, sobald eine Standard-Aufgabendatenbank festgelegt ist): blendet die mit Fälligkeit versehenen Einträge Deiner [Standard-Aufgabendatenbank](Tasks.md) im Zeitraster-Streifen und im Monatsraster ein. Standardmäßig aus, die Wahl wird pro Gerät gemerkt. Trägt die Fälligkeits-Spalte eine **Uhrzeit** (Spaltentyp „Datum und Uhrzeit“), steht die Aufgabe an ihrer Stelle **im Tagesraster** statt im Ganztags-Streifen — gestrichelt umrandet, weil eine Frist kein Zeitraum ist, mit Häkchen direkt im Block. Ohne Uhrzeit bleibt alles wie bisher.
  - Ein Klick auf das **Kästchen** hakt die Aufgabe direkt hier ab — Du musst die Notiz nicht öffnen. Ein Klick auf den **Titel** öffnet sie weiterhin. Das Abhaken schreibt dieselbe Datei wie in der Aufgabenübersicht: Trägt die Aufgabe eine **Wiederholung**, entsteht dabei die nächste.
  - **Aufgaben werden anders eingefärbt als Termine.** Ein vergangener Termin ist vorbei und erscheint blass; eine **überfällige** Aufgabe ist dagegen dringlicher und wird **hervorgehoben**. Heute fällige Aufgaben stehen normal, künftige gedämpft, erledigte durchgestrichen.
  - Ein **Wiederhol-Symbol** an der Zeile zeigt, dass diese Aufgabe eine Wiederholung trägt. Sie erscheint trotzdem nur **einmal** im Kalender — siehe [Aufgaben](Tasks.md) dazu, warum das so ist.

## Termin → Meeting-Notiz

Das Notiz-Symbol an einem Termin erstellt (oder öffnet erneut) seine **Meeting-Notiz** — eine normale Notiz im Meeting-Ordner mit dem Namen `JJJJ-MM-TT Titel.md`, vorbefüllt mit Datum, Ort und Teilnehmern, plus einer kleinen `plainva.pim`-Markierung im Frontmatter, die sie mit dem Termin verknüpft. Ein zweiter Klick auf denselben Termin öffnet immer dieselbe Notiz; eine zufällig gleichnamige eigene Notiz wird nie angetastet.

## Externe Aufgabenlisten in Deiner Aufgabendatenbank

Erinnerungslisten (Apple Erinnerungen über iCloud-CalDAV, Nextcloud-Aufgabenlisten) sind auf dem Server eigene Sammlungen und erscheinen deshalb unter **Aufgabenlisten** — nie unter **Kalender**. Findet ein verbundenes Konto keine Aufgabenlisten, sagt der Bereich das und bietet **Erneut suchen** an; ist die Suche selbst fehlgeschlagen, steht dort der Grund und Deine bisherige Auswahl bleibt erhalten.

Hake bei einem verbundenen Konto eine **Aufgabenliste** an, und ihre Aufgaben erscheinen als Notizen in Deiner [Standard-Aufgabendatenbank](Tasks.md): der Titel wird die Notiz (H1), die Fälligkeit landet in der Datums-Spalte, und „erledigt" bildet sich über die **Erledigt-Checkbox-Eigenschaft** der Datenbank ab (die Status-Spalte folgt ihr; eine Datenbank ohne Checkbox-Spalte nutzt die Status-Konvention — erste Option = offen, letzte = erledigt). Der Abgleich läuft in beide Richtungen, Feld für Feld:

- Bearbeitest Du die Notiz (Titel, Fälligkeit, Status) → die Änderung geht an den Anbieter.
- Ändert sich die Aufgabe extern → die Notiz zieht nach.
- Haben sich beide Seiten geändert, gewinnt für das jeweilige Feld Deine lokale Änderung; der Rest folgt der externen Seite.

Zwei Sicherheitsregeln schützen Deine Daten: **das Löschen der Notiz löscht nie die Aufgabe beim Anbieter** (sie wird nur nicht mehr synchronisiert und auch nicht erneut importiert), und **eine extern gelöschte Aufgabe löscht nie Deine Notiz** (sie wird einfach eine normale Notiz). Umbenennen oder Verschieben einer Aufgaben-Notiz ist unproblematisch — die Frontmatter-Markierung hält die Verbindung.

Aktuelle Grenzen: als normale Notizen angelegte Aufgaben werden nicht zum Anbieter gepusht (lege sie extern oder über die Aufgabendatenbank an), und alles auf dieser Seite ist vorerst Desktop-first.

Von **In anderen Kalendern blockieren** erzeugte Kopien tragen eine anbieterspezifische Plainva-Verknüpfung (Google, Microsoft und CalDAV). Die Kalenderansichten zeigen diese Verbindung mit einem Kettensymbol; beim erneuten Laden werden Quelle und Block wieder zuverlässig zugeordnet, statt unverbundene Duplikate zu erzeugen.

## Erinnerungen am Rechner

Unter **Einstellungen → Kalender → Erinnerungen** schaltest Du **Termine erinnern** ein; beim ersten Mal fragt das System einmal nach der Berechtigung. Was der Termin selbst an Erinnerung mitbringt, gilt — erst wenn er nichts sagt, greift die **Vorlaufzeit**, und ganztägige Termine melden sich zu der unter **Ganztägige Termine** gewählten Zeit. **Fällige Aufgaben** nimmt zusätzlich die Aufgaben Deiner Aufgaben-Datenbank auf, **Nur diese Kalender** grenzt ein, woher erinnert wird (nichts angehakt heißt: alle, und ein später verbundener Kalender ist von sich aus dabei).

**Der Unterschied zum Telefon steht in der Einstellung, nicht im Kleingedruckten.** Auf dem Telefon übernimmt das Betriebssystem die Erinnerung und weckt sie auch bei geschlossener App. Am Rechner gibt es diese Übergabe nicht: **Plainva weckt selbst und muss dafür laufen.** Ist die App zu, fällt die Erinnerung aus und wird nicht nachgeholt. Dafür gibt es hier keine Obergrenze.

Die Benachrichtigung selbst trägt keinen Knopf — das gibt der Rechner nicht her. Die Aktion liegt stattdessen im Hinweis in der App: bei einem Termin **Im Kalender zeigen**, bei einer Aufgabe **Aufgabe öffnen**. Das Fenster drängt sich dabei nie in den Vordergrund.

### Im Hintergrund weiterlaufen

Weil eine Erinnerung am Rechner nur ankommt, solange Plainva läuft, gibt es unter **Einstellungen → Start & Verhalten → Hintergrund** zwei Schalter — getrennt, weil es zwei verschiedene Wünsche sind, und beide **standardmäßig aus**:

- **Mit dem System starten** trägt Plainva beim Anmelden ein.
- **Beim Schließen im Infobereich weiterlaufen** legt ein Plainva-Symbol in den Infobereich; das Schließen des Fensters beendet die App dann nicht mehr, sondern legt sie dorthin ab. Über das Symbol kommst Du mit **Öffnen** zurück, siehst den **nächsten Termin** und beendest Plainva mit **Beenden**.

**Der zweite Schalter weist sich selbst nach.** Nicht jede Arbeitsumgebung zeigt einen Infobereich — und ob ein Symbol wirklich erscheint, lässt sich nicht zuverlässig vorhersagen. Plainva legt es deshalb an und **fragt Dich, ob Du es siehst**. Nur ein Ja behält die Einstellung; sagst Du Nein, wird das Symbol wieder entfernt und der Schalter bleibt aus. So kann das Fenster nie verschwinden, ohne dass es einen Weg zurück gibt. Dieselbe Sicherung greift beim nächsten Start: lässt sich das Symbol dann nicht mehr anlegen, schaltet sich die Einstellung ab.

Die Zeile **Erinnerungen erscheinen** darunter sagt jederzeit, was gerade gilt — *solange Plainva läuft* oder *auch bei geschlossenem Fenster*.

**Zu wissen:** Läuft Plainva im Hintergrund weiter, laufen auch **Synchronisierung, Kalender-Abgleich und die Backup-Prüfung** weiter. Der Vault ist beim nächsten Öffnen aktuell — dafür arbeitet die App, während Du sie nicht siehst.


## Datenbanken im Kalender einblenden

Der Kalender kann **Einträge aus Deinen Datenbanken** mitzeigen. Über der Ansicht steht dafür die Leiste **Einblenden:** — sie listet jede `.base`-Ansicht vom Typ **Kalender** oder **Zeitachse**, die ein Datumsfeld benannt hat. Ein Klick blendet sie ein, ein zweiter wieder aus.

Ein so eingeblendeter Eintrag bleibt **als Notiz erkennbar**: gestrichelte Kante, Raute davor, nie die gefüllte Form eines Termins. Ein Klick öffnet dieselbe Vorschau, die eine Datenbankzeile ohnehin hat. **Ziehen auf einen anderen Tag schreibt das Datumsfeld** der Notiz — genau das, was das Bearbeiten der Zelle in der Tabelle tut. Trägt das Feld eine Uhrzeit, steht der Eintrag im Tagesraster an seiner Stunde; ohne Uhrzeit steht er oben im Ganztags-Streifen.

**Welche Ansichten eingeblendet sind, gehört zum Vault** und reist über die Einstellungs-Synchronisation mit: Dein Kalender sieht am Rechner und am Telefon gleich aus.

**Und umgekehrt:** In der Kalenderansicht einer Datenbank blendet der Knopf **Termine im Hintergrund** die echten Termine des Tages als leise Zeile ein — Du siehst, wogegen Du planst. Sie sind bewusst nur Hintergrund: keine Zeilen dieser Datenbank, nicht anklickbar.

## Einen Datenbank-Eintrag in den Kalender eintragen

Ein Eintrag mit Datum kann ein **echter Termin** bei Deinem Anbieter werden. Im Menü der Eintragszeile (bzw. im Aktions-Blatt am Telefon) steht dafür **In Kalender eintragen**. Der Termin übernimmt das Datum des Eintrags — mit Uhrzeit, wenn die Spalte eine trägt, sonst als ganztägiger Termin — und trägt einen Link zurück auf die Notiz.

Danach bleiben beide verknüpft, und zwar nach drei festen Regeln:

* **Verschiebst Du den Termin** bei Google, Outlook oder auf dem CalDAV-Server, **zieht das Datumsfeld der Notiz nach.**
* **Löschst Du die Notiz,** zeigt der Lösch-Dialog, dass sie mit einem Termin verknüpft ist. Der Termin bleibt bei Deinem Anbieter — Plainva löscht ihn nie nebenbei.
* **Löschst Du den Termin,** verschwindet nur die Verknüpfung. Die Notiz und ihr Datum bleiben unangetastet.

Das ist etwas anderes als **Zeit blocken** bei einer Aufgabe: dort reservierst Du Zeit für etwas, und das Datum der Aufgabe bleibt, wo es ist. Hier sagst Du: *dieser Eintrag ist dieser Termin.*

