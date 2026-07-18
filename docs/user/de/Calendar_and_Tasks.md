# Kalender & externe Aufgaben

Stand: 2026-07-18

Plainva kann Deine bestehenden Kalender- und Aufgaben-Konten verbinden — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Kalender + Tasks) und **Microsoft** (Outlook-Kalender + To Do) — und in beide Richtungen damit arbeiten. Deine Notizen bleiben das Zentrum: Termine werden zu Meeting-Notizen, und externe Aufgabenlisten spiegeln sich als normale Notizen in Deine [Standard-Aufgabendatenbank](Tasks.md).

## Ein Konto verbinden

Öffne **Einstellungen → Dein Vault → Kalender & Konten → Konto hinzufügen…** und wähle den Anbieter:

- **CalDAV**: Server-URL, Benutzername und ein **App-Passwort** (in Nextcloud: Einstellungen → Sicherheit → Geräte & Sitzungen). Keine Registrierung, keine Keys.
- **Google**: braucht Deine eigene OAuth-Client-ID (dasselbe BYO-Modell wie beim Google-Drive-Sync — siehe die [Drive-Anleitung](Google_Drive_BYO_Guide.md)). Aktiviere in Deinem Google-Cloud-Projekt zusätzlich die *Google Calendar API* und die *Google Tasks API* und ergänze ihre Scopes im Consent-Screen. Der Browser öffnet sich zur Zustimmung; beim Verbinden wird das Konto geprüft, bevor irgendetwas gespeichert wird.
- **Microsoft**: einfach auf **Verbinden** klicken und im Browser bestätigen — keine Einrichtung nötig.

Jedes Konto zeigt seine **Kalender** (angehakte erscheinen im Kalender-Tab) und seine **Aufgabenlisten** (bewusst standardmäßig abgewählt — ein Häkchen startet den unten beschriebenen Aufgaben-Sync). Passwörter und Tokens liegen im Schlüsselbund Deines Betriebssystems. Die Einstellung **Meeting-Ordner** unter den Konten bestimmt, wo Meeting-Notizen entstehen.

## Der Kalender-Tab

Öffne ihn über die linke Aktionsleiste (Kalender-Symbol) oder die Befehlspalette (**Kalender öffnen**). Über den Umschalter im Kopf stehen fünf Ansichten bereit: **Tag**, **3 Tage** und **Woche** zeigen ein **Zeitraster** mit einer Uhrzeit-Leiste links; Termine sitzen als Blöcke an ihrer Startzeit, ihre Höhe entspricht der Dauer, überlappende Termine stehen nebeneinander, und eine rote Linie markiert „jetzt". Ganztägige Termine und (bei eingeschaltetem Aufgaben-Overlay) fällige Aufgaben sitzen im Streifen über dem Raster. **Monat** zeigt das Monatsraster (ein Farbpunkt je Kalender) plus rechts ein Tages-Zeitraster für den gewählten Tag. **Agenda** listet die kommenden Wochen nach Tagen gruppiert. **Heute** springt zurück; die Pfeile blättern um die jeweilige Periode (einen Tag, drei Tage, eine Woche oder einen Monat). Der erste Wochentag folgt der Einstellung **Wochenbeginn** (Einstellungen → App → Erscheinungsbild: Montag, Samstag oder Sonntag) — sie gilt auch für den Seitenleisten-Kalender. Die Ansicht aktualisiert sich alle paar Minuten von selbst; **Jetzt aktualisieren** erzwingt es.

- **Termin anlegen**: Ein **Klick auf eine leere Stelle im Zeitraster** öffnet ein kleines Schnell-Erfassungs-Fenster (Titel, Zeit, Kalender, Ort) — **Speichern** legt sofort an, **Weitere Optionen** öffnet den vollen Termin-Dialog. **Ziehen** über das Raster gibt die Dauer vor. Das **+** im Kopf öffnet den vollen Dialog: Titel, Kalender, Datum/Uhrzeit oder ganztägiger Zeitraum, Ort, eine **Beschreibung**, eine **Farbe** und optional eine einfache **Wiederholung** (Täglich/Wöchentlich/Monatlich/Jährlich). Die Farbe überschreibt für diesen einen Termin die Kalenderfarbe (bei Microsoft-Konten ohne Wirkung — Outlook kennt keine Termin-Farben).
- **Bearbeiten / Löschen**: Ein **Klick auf einen Termin** im Zeitraster öffnet den Dialog, vorbefüllt mit seinen Werten und mit den Aktionen **Meeting-Notiz** und **Löschen**. Änderungen gehen mit einer Sicherheitsprüfung an den Anbieter: hat sich der Termin zwischenzeitlich extern geändert, aktualisiert Plainva die Ansicht, statt zu überschreiben.
- **Verschieben / Verlängern**: Einen Termin kannst Du im Zeitraster direkt **ziehen** — den Block verschieben (auch auf einen anderen Tag in der Wochen-/3-Tage-Ansicht) legt ihn auf eine neue Zeit, die **Unterkante** ziehen ändert seine Dauer. Der neue Zeitpunkt wird sofort beim Anbieter gespeichert (Serientermine bleiben vorerst nur per Dialog änderbar).
- **Serientermine** tragen ein Wiederholungs-Symbol. Beim Bearbeiten oder Löschen einer Instanz fragt Plainva **„Nur diesen Termin"** (erzeugt eine Ausnahme bzw. lässt genau diesen Termin ausfallen) oder **„Alle Termine"** (ändert die ganze Serie). Eine bestehende Wiederholungs-Regel schreibt Plainva nie um.
- **Aufgaben anzeigen** (neben dem Aktualisieren-Knopf, sobald eine Standard-Aufgabendatenbank festgelegt ist): blendet die mit Fälligkeit versehenen Einträge Deiner [Standard-Aufgabendatenbank](Tasks.md) im Zeitraster-Streifen und im Monatsraster ein; erledigte Aufgaben erscheinen durchgestrichen. Standardmäßig aus, die Wahl wird pro Gerät gemerkt.

## Termin → Meeting-Notiz

Das Notiz-Symbol an einem Termin erstellt (oder öffnet erneut) seine **Meeting-Notiz** — eine normale Notiz im Meeting-Ordner mit dem Namen `JJJJ-MM-TT Titel.md`, vorbefüllt mit Datum, Ort und Teilnehmern, plus einer kleinen `plainva.pim`-Markierung im Frontmatter, die sie mit dem Termin verknüpft. Ein zweiter Klick auf denselben Termin öffnet immer dieselbe Notiz; eine zufällig gleichnamige eigene Notiz wird nie angetastet.

## Externe Aufgabenlisten in Deiner Aufgabendatenbank

Hake bei einem verbundenen Konto eine **Aufgabenliste** an, und ihre Aufgaben erscheinen als Notizen in Deiner [Standard-Aufgabendatenbank](Tasks.md): der Titel wird die Notiz (H1), die Fälligkeit landet in der Datums-Spalte, und „erledigt" bildet sich über die **Erledigt-Checkbox-Eigenschaft** der Datenbank ab (die Status-Spalte folgt ihr; eine Datenbank ohne Checkbox-Spalte nutzt die Status-Konvention — erste Option = offen, letzte = erledigt). Der Abgleich läuft in beide Richtungen, Feld für Feld:

- Bearbeitest Du die Notiz (Titel, Fälligkeit, Status) → die Änderung geht an den Anbieter.
- Ändert sich die Aufgabe extern → die Notiz zieht nach.
- Haben sich beide Seiten geändert, gewinnt für das jeweilige Feld Deine lokale Änderung; der Rest folgt der externen Seite.

Zwei Sicherheitsregeln schützen Deine Daten: **das Löschen der Notiz löscht nie die Aufgabe beim Anbieter** (sie wird nur nicht mehr synchronisiert und auch nicht erneut importiert), und **eine extern gelöschte Aufgabe löscht nie Deine Notiz** (sie wird einfach eine normale Notiz). Umbenennen oder Verschieben einer Aufgaben-Notiz ist unproblematisch — die Frontmatter-Markierung hält die Verbindung.

Aktuelle Grenzen: als normale Notizen angelegte Aufgaben werden nicht zum Anbieter gepusht (lege sie extern oder über die Aufgabendatenbank an), und alles auf dieser Seite ist vorerst Desktop-first.
