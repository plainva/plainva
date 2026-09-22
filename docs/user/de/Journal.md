# Journal

Stand: 2026-09-22

Das Journal ist der schnelle Weg, etwas festzuhalten, ohne eine Notiz zu öffnen: ein Gedanke, ein Telefonat, eine Zeile zum Tag. Jeder Eintrag ist eine gewöhnliche Listenzeile mit Uhrzeit — `- 14:05 Router steht im Keller` — unter einer Überschrift der **heutigen Tagesnotiz**. Es gibt kein neues Dateiformat und keine Datenbank: Die Einträge leben in Deinen Tagesnotizen, lesbar in jedem Editor und verträglich mit den Journal-Plugins von Obsidian (Thino, Knomo).

## Einen Eintrag schreiben

Ein Feld, ein **Enter**. Die Uhrzeit setzt Plainva; Du tippst nur den Text. Tags, Links und eine zweite Zeile tippst Du einfach mit — der Text ist gewöhnliches Markdown.

- **Am Desktop:** `Strg+Umschalt+J` öffnet das Feld **Journal-Eintrag** von überall in Plainva. Dasselbe Feld steht im **＋**-Menü der Seitenleiste, in der Befehlspalette und im Menü des Infobereichs (**Journal-Eintrag**). `Enter` speichert, `Umschalt+Enter` beginnt eine neue Zeile, `Esc` verwirft.
- **Am Telefon:** Der **＋**-Knopf bietet **Journal-Eintrag** an; der Journal-Bildschirm hat einen eigenen Stift-Knopf. Auch ein langer Druck auf das App-Symbol bietet **Journal-Eintrag** an — unter Android als App-Verknüpfung, unter iOS als Schnellaktion. `Enter` bleibt dort ein Zeilenumbruch; **Eintrag speichern** speichert.
- **Aus dem Teilen-Menü (Telefon):** Wähle Plainva und setze **Ins Journal** — Text und Link werden der Eintrag, geteilte Dateien landen im Anhang-Ordner und werden eingebettet.
- **Mit Bild:** Das Feld am Telefon hat **Foto hinzufügen**; am Desktop fügst Du ein Bild aus der Zwischenablage in das Feld ein. Das Bild kommt dorthin, wo Anhänge liegen, und wird im Eintrag eingebettet.

Gibt es die heutige Tagesnotiz noch nicht, wird sie auf dem Weg angelegt — aus Deiner Tagesnotiz-Vorlage, ohne deren Abfragen zu stellen. Nach dem Speichern meldet ein Hinweis **Eintrag gespeichert** und bietet **Rückgängig** an.

Das Feld hat eine Aufgabe: einen Journal-Eintrag. Darunter übergibt **Stattdessen eine Aufgabe anlegen** das Getippte an die [Aufgabenansicht](Tasks.md), wo eine Aufgabe wie gewohnt entsteht, und schließt das Feld. Der Chip **Als Aufgabe** ist etwas anderes: Er lässt den Eintrag im Journal und gibt ihm ein Kästchen (`- [ ] 14:05 Ersatzteil bestellen`), sodass er auch in der Aufgabenansicht unter **Aus Notizen** steht. Das Kästchen des Chips bleibt leer, bis Du ihn wählst.

## Die Journal-Ansicht

**Journal öffnen** (Aktionsleiste am Desktop, **Bereiche** am Telefon oder die Befehlspalette) zeigt alle Tage als einen Strom: der neueste Tag oben, innerhalb eines Tages der neueste Eintrag zuerst. Links öffnen sich, Tags sind Pillen, ein eingebettetes Bild erscheint als Vorschau, und ein langer Eintrag ist eingeklappt — **Mehr** öffnet ihn.

- **Suchen und filtern:** Das Suchfeld durchsucht die geladenen Tage; die Chips **Alle**, **Nur Aufgaben** und die häufigsten Tags engen den Strom ein. Ein Klick auf ein Tag in einem Eintrag filtert danach.
- **Ältere Tage:** Plainva lädt die letzten 14 Tage, die Einträge haben. **Ältere laden** holt den nächsten Abschnitt; **Zu einem Tag springen** öffnet die Datumsauswahl, in der Tage mit Einträgen markiert sind, und lädt so weit zurück, wie der gewählte Tag liegt.
- **Notiz öffnen** im Kopf eines Tages öffnet dessen Tagesnotiz; ein Klick auf einen Eintrag öffnet die Notiz an dieser Zeile.
- **Kästchen** von Aufgaben-Einträgen lassen sich direkt im Strom abhaken. Sie verhalten sich wie in der Aufgabenansicht, samt Erledigt-Datum und dem nächsten Termin einer wiederkehrenden Aufgabe.

Jeder Eintrag hat ein Menü (Rechtsklick oder **⋯** am Desktop; **⋯**, langer Druck oder Wischen am Telefon): **Bearbeiten** ändert den Text an Ort und Stelle und behält die Uhrzeit, **Kopieren** kopiert den Text, **In Aufgabe umwandeln** setzt das Kästchen und **Wieder zum Eintrag machen** nimmt es weg, **In der Notiz zeigen** springt zur Zeile, **Löschen** entfernt den Eintrag — mit **Rückgängig** im Hinweis danach.

Die Einträge eines einzelnen Tages stehen auch dort, wo Du diesen Tag ansiehst: als Bereich **Journal** in der rechten Seitenleiste des Desktops (für den Tag der geöffneten Tagesnotiz, sonst heute) und am Telefon auf dem Bildschirm **Heute** für den gewählten Tag. In der Seitenleiste ist er ein Bereich wie jeder andere — er klappt zu, merkt sich das, lässt sich ausblenden und ist anfangs zugeklappt. Seine Zeilen sind einzeilig: Dort wird nichts bedient, jede Zeile beginnt an derselben Kante, und eine Aufgabe trägt statt eines Kästchens ein ruhiges Zeichen rechts (abhaken im Strom oder in der Notiz). Der Stift in der Überschrift öffnet das gewohnte Feld **Journal-Eintrag** für genau diesen Tag, und **Alle Tage** führt zum Strom.

## Wie ein Eintrag gespeichert wird

```markdown
## Journal

- 09:12 Werkstatt angerufen #kunde
- [ ] 10:30 Ersatzteil bestellen
- 14:05 Router steht im Keller
  Den Schlüssel hat Frau Berger.
```

- Einträge werden ans Ende des Abschnitts angehängt, die Datei liest sich also chronologisch; die Ansicht zeigt das Neueste oben.
- Die Überschrift heißt in der Vorgabe **Journal** und lässt sich je Vault unter **Einstellungen → Vault → Inhalt & Struktur** ändern (**Überschrift des Journals**; am Telefon unter **Einstellungen → Inhalt & Struktur**). Ihre Ebene spielt keine Rolle. Fehlt die Überschrift, legt Plainva `## Journal` am Ende der Notiz an. Eine Änderung der Einstellung benennt bestehende Überschriften nicht um.
- **Der Tag endet um** (gleiche Stelle in den Einstellungen) verschiebt die Grenze des Tages nach hinten: Steht dort **04:00**, gehört alles, was Du zwischen Mitternacht und vier Uhr schreibst, noch zum Vortag — der Eintrag landet in der Tagesnotiz von gestern und trägt weiter seine echte Zeit (`- 01:30 …`). Der Tageskopf im Journal sagt dann **bis 04:00**. Die Grenze gilt für die Tagesnotiz und das Journal, **nicht** für den Kalender und nicht für die Fälligkeit von Aufgaben: ein Termin um 01:30 Uhr am Mittwoch bleibt am Mittwoch. Die Vorgabe ist **Mitternacht**; die Einstellung gehört zum Vault und gilt auf allen Geräten.
- **Sprachnotiz**: Das Mikrofon-Symbol im Erfassungsfeld nimmt auf. Während der Aufnahme siehst Du die laufende Zeit und hast zwei Wege heraus: **Verwerfen** wirft die Aufnahme weg, **Anhängen** legt sie als Datei im Anhänge-Ordner ab und hängt sie an den Eintrag. Der Dateiname trägt Datum und Uhrzeit (`Sprachnotiz 2026-09-22 1430.m4a`). Plainva fragt beim **ersten** Tippen nach der Mikrofon-Freigabe, nie beim Start, und schreibt nichts mit, solange Du nicht selbst aufnimmst; die Aufnahme bleibt im Vault und geht nirgendwohin.
- Plainva liest auch `- 14:05:30 Text` (mit Sekunden) und Einträge mit Kästchen, und es setzt die Liste so fort, wie Deine Notiz sie schreibt (`-`, `*` oder `+`, mit oder ohne Leerzeilen zwischen den Einträgen). Bestehende Zeilen werden nie umformatiert.
- Eine Änderung, die sich nicht sicher unterbringen lässt — etwa weil im Abschnitt ein Code-Block nie geschlossen wurde —, wird mit einer Meldung abgelehnt, und das Feld behält Deinen Text.

Das genaue Format steht in der [Dateiformat-Referenz](File_Format_Reference.md).

## Zwei Geräte gleichzeitig

Hängen zwei Geräte Einträge an dieselbe Tagesnotiz an, bevor sie sich abgeglichen haben, ist das **kein Konflikt**: Plainva vereinigt die Einträge nach Uhrzeit, und jede Zeile beider Geräte bleibt erhalten. Das gilt auch, wenn beide Geräte die Notiz des Tages unabhängig voneinander angelegt haben. Jede andere gleichzeitige Änderung an der Notiz wird so vorsichtig behandelt wie bisher (siehe [Sync-Kompatibilität](Sync_Compatibility.md)).

## Globale Schnellerfassung (Desktop, optional)

Unter **Einstellungen → Start & Verhalten → Globale Schnellerfassung** kannst Du **Von überall mit einem systemweiten Tastenkürzel erfassen** einschalten. Das Tastenkürzel — in der Vorgabe `Strg+Alt+J` (`Cmd+Option+J` unter macOS) — öffnet dann ein kleines Fenster mit dem Eintragsfeld, auch wenn gerade ein anderes Programm vorn liegt, solange Plainva läuft (auch im Infobereich). `Enter` schreibt den Eintrag in die heutige Tagesnotiz des Vaults, der in Plainva geöffnet ist, und schließt das Fenster; `Esc` verwirft.

- **Ändern** nimmt ein neues Tastenkürzel auf: Drücke die gewünschte Kombination mit `Strg`, `Alt` oder der Windows-/Befehlstaste. **Auf Vorgabe zurücksetzen** holt die Vorgabe zurück.
- Benutzt ein anderes Programm das Tastenkürzel bereits oder nimmt das System es nicht an, sagt Plainva das unter dem Schalter, statt ein Tastenkürzel stehen zu lassen, das nichts tut.
- Unter **Wayland** (Linux) gibt das System Programmen kein systemweites Tastenkürzel; Plainva sagt das und registriert nichts. Der Eintrag im Infobereich und `Strg+Umschalt+J` führen zum selben Feld.
- Das Tastenkürzel gehört zum Gerät und ist nicht Teil des Einstellungsprofils.
