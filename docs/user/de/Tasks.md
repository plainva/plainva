# Aufgaben

Stand: 2026-09-20

Die Aufgabenansicht sammelt jede Checkbox Deines Vaults an einem Ort: alle `- [ ]`- und `- [x]`-Listeneinträge über alle Notizen hinweg, gruppiert nach der Notiz, in der sie stehen. Sie ist die „Was habe ich noch zu tun?"-Ansicht über reines Markdown — kein Plugin, keine Sonderdatei.

## Warum eine eigene Ansicht (und keine `.base`)

Eine [Datenbank (`.base`)](Databases_Base.md) arbeitet auf ganzen Notizen — eine Zeile pro Notiz. Eine Checkbox ist eine einzelne *Zeile* innerhalb einer Notiz, und eine Notiz kann viele davon enthalten, deshalb kann eine `.base` sie nicht auflisten. Die Aufgabenansicht ist zeilenbasiert: Sie liest die Aufgabenzeilen direkt, sodass eine einzelne Projektnotiz mit zehn Unteraufgaben alle zehn zeigt.

## Aufgabenansicht öffnen

- Klicke auf das **Checklisten-Symbol** in der Aktionsleiste ganz links, oder
- öffne die **Befehls-Palette** (`Strg/Cmd+P`) und führe **Aufgaben öffnen** aus.

Sie öffnet sich als Tab, wie jede Notiz.

## Auf dem Telefon

Die Aufgabenansicht gibt es auch mobil. Du öffnest sie über das **▾** neben dem Titel in der oberen Leiste und kannst sie in der Navigationsleiste ablegen (**Einstellungen** → **Navigationsleiste**).

Sie zeigt dieselben zwei Bereiche wie am Desktop: oben die **Aufgaben-Datenbank**, darunter **Aus Notizen** die Checkbox-Liste, mit den Filtern **Offen**/**Erledigt**/**Alle** und der Freitext-Suche. Abhaken, **Status ändern**, eine Checkbox **zur Datenbank verschieben**, **+ Neue Aufgabe**, **Zeit blocken** und die **Wiederholung** funktionieren wie beschrieben und schreiben dieselben Dateien: dieselbe Notiz mit Frontmatter, derselbe `[[Wiki-Link]]` in der Ursprungszeile, dieselbe Regel unter `plainva.repeat`.

Welche Datenbank Dein Vault als Aufgaben-Datenbank nutzt, stellst Du mobil unter **Einstellungen** → **Inhalt & Struktur** ein. Die Einstellung reist über die [Einstellungs-Synchronisation](Sync_Setup.md) mit — Du legst sie also nur einmal fest, auf dem Gerät Deiner Wahl.

Die vier Filter der Desktop-Leiste stehen mobil als Chips über der Liste: **Ordner**, **Tag**, **Nur mit Fälligkeit** und **Ausgeblendete anzeigen**. Als Chips statt als Auswahlfelder, weil eine Filterleiste über einer ohnehin schmalen Liste mehr Platz kostet als sie einbringt — ein Tipp öffnet die Auswahl, ein zweiter räumt sie wieder weg.

## Die Liste lesen

Aufgaben sind nach Notiz gruppiert; der Notiztitel ist eine Überschrift, die Du anklicken kannst, um die Notiz zu öffnen. Jede Aufgabe zeigt ihre Checkbox und ihren Text, durchgestrichen, sobald sie erledigt ist. Eine **Fälligkeit**, die als `📅 2026-08-01` in der Aufgabenzeile steht, erscheint als kleines Abzeichen.

## Filtern

Die Leiste oben grenzt die Liste ein:

- **Offen / Erledigt / Alle** — nach Checkbox-Zustand (startet bei **Offen**). Dieser Filter gehört zur Liste **Alle**; die Planer-Listen **Heute**, **Demnächst**, **Eingang** und **Erledigt** beantworten diese Frage selbst.
- **Aufgaben filtern…** — Freitext; passt auf den Aufgabentext.
- **Alle Ordner** — nur Aufgaben im gewählten Ordner (und seinen Unterordnern).
- **Alle Tags** — nur Aufgaben mit einem gewählten Inline-`#tag`.
- **Nur mit Fälligkeit** — nur Aufgaben mit einem `📅`-Datum.

Tags und Fälligkeiten werden direkt aus der Aufgabenzeile gelesen — zum Beispiel `- [ ] Rechnung bezahlen #finanzen 📅 2026-08-01`.

## Aufgaben abhaken

Klicke auf die **Checkbox** einer Aufgabe, um sie zwischen offen und erledigt umzuschalten. Die Änderung wird direkt in die Notiz zurückgeschrieben (als normaler, sicherer Dateischreibvorgang — nur das einzelne `[ ]`/`[x]`-Zeichen ändert sich), sodass die Notiz, Obsidian und jede Synchronisation im Gleichschritt bleiben. Klicke stattdessen auf den **Text** der Aufgabe, um die Notiz zu öffnen und zu dieser Zeile zu springen.

Hat sich eine Notiz seit dem Aufbau der Liste geändert, wird ein veraltetes Umschalten übersprungen und die Liste aktualisiert — mit dem **Aktualisieren**-Knopf oben rechts kannst Du jederzeit neu laden.

## Standard-Aufgabendatenbank

Checkboxen sind schnell notiert, aber manchmal wächst eine Zeile zu einer „richtigen" Aufgabe heran — mit Status, Fälligkeit und eigener Notiz. Dafür legst Du in den Einstellungen unter **Inhalt & Struktur** eine **Standard-Aufgabendatenbank** fest: eine [Datenbank (`.base`)](Databases_Base.md), in der solche Aufgaben als eigene Notizen leben. Mit **Neue Datenbank anlegen…** erstellt Plainva eine fertige Datenbank (Ablage-Ordner plus `.base` mit einer **Erledigt-Checkbox-Spalte** (`erledigt`), Status-Spalte, Fälligkeits-Spalte sowie Tabellen-, Board- und Zeitleisten-Ansicht — die Zeitleiste setzt jede Aufgabe auf ihren Fälligkeitstag); genauso kannst Du eine bestehende Datenbank auswählen. Die Checkbox-Eigenschaft ist die Erledigt-Wahrheit einer Aufgabe (an/aus, wie bei den Anbietern); die Status-Spalte wird beim Abhaken konsistent mitgeführt. Hat eine Datenbank keine Checkbox-Spalte, gilt die Status-Konvention: erste Option = offen, letzte = erledigt.

Ist sie festgelegt, zeigt die Aufgabenansicht zwei Bereiche: oben die Einträge der **Aufgaben-Datenbank**, darunter **Aus Notizen** — die gewohnte Checkbox-Liste. Der Status lässt sich direkt in der Übersicht ändern: das Kästchen ist die Erledigt-Checkbox-Eigenschaft der Notiz und schaltet sie um (die Status-Spalte folgt); ein Klick auf den Status-Chip öffnet ein Menü mit allen Optionen (**Status ändern**). Die Filter **Offen**/**Erledigt**/**Alle** wirken auf beide Bereiche, und **Als Datenbank öffnen** springt zur vollen Datenbank-Ansicht mit Board und Filtern. **Aktualisieren** stößt bei verbundenen Konten zusätzlich einen echten Abgleich mit dem Anbieter an.

## Eine Checkbox zur Datenbank-Aufgabe machen

Jede Checkbox-Zeile trägt ein Datenbank-Symbol: **Zur Aufgaben-Datenbank verschieben**. Ein Klick

- erstellt eine neue Notiz im Ablage-Ordner der Datenbank (mit deren Standard-Vorlage, falls eine eingestellt ist),
- übernimmt ein `📅`-Datum in die Fälligkeits-Spalte, setzt bei offenen Aufgaben die erste Status-Option und trägt die `#tags` der Zeile als Tags der Notiz ein,
- verlinkt die neue Notiz über eine `source`-Eigenschaft zurück auf die Ursprungsnotiz und
- ersetzt die Checkbox-Zeile in der Ursprungsnotiz durch einen Wiki-Link auf die neue Aufgaben-Notiz — der Eintrag bleibt an Ort und Stelle lesbar, die Aufgabe lebt ab jetzt in der Datenbank.

Mit einem **Rechtsklick** auf das Symbol wählst Du stattdessen eine andere Datenbank als Ziel; ohne festgelegte Standard-Datenbank öffnet schon der Klick diese Auswahl. Alles bleibt reines Markdown: Die neue Aufgabe ist eine gewöhnliche Notiz mit Frontmatter, der Link in der Ursprungsnotiz ein normaler `[[Wiki-Link]]`.

**+ Neue Aufgabe** in der Kopfzeile der Sektion setzt den Cursor in das Erfassungsfeld über den Listen (siehe unten *Planer, Schnellerfassung, Priorität und Zustände*). Die Aufgabe entsteht direkt in der Aufgaben-Datenbank — gleicher Ablage-Ordner, gleiche Vorlage und Vorbelegung wie beim Verschieben einer Checkbox —, und ein Hinweis bietet **Öffnen** an. In einer Notiz geschriebene Checkboxen bleiben in dieser Notiz — zu Datenbank-Aufgaben werden sie erst, wenn Du sie verschiebst.

## Zeit für eine Aufgabe blocken

Eine Aufgabe hat ein Fälligkeitsdatum und kann eine **Uhrzeit** tragen (`2026-09-21T14:00`) — zu ihr erinnert Dich Plainva. Eine Uhrzeit ist ein Zeitpunkt, kein Zeitraum. Wenn Du Dir für eine Aufgabe ein Zeitfenster reservieren willst, legt Plainva dafür einen **Termin** an — das ist das Objekt, das einen Zeitraum kennt, im Raster mit Überschneidungen dargestellt wird und mit Deinem Kalender-Konto synchronisiert.

Das Kalender-Symbol an einer Aufgabenzeile öffnet **Zeit blocken**: Datum (mit der Fälligkeit vorbelegt), Beginn und **Dauer** (15 min, 30 min, 1 h, 2 h oder **Eigene**), bei mehreren beschreibbaren Kalendern zusätzlich die Kalenderauswahl. Der Termin trägt den Titel der Aufgabe und verlinkt zurück auf die Notiz. Ein **Rechtsklick** auf die Zeile zeigt dieselben Aktionen wie das Blatt am Telefon: Erledigt/Offen, In Datenbank verschieben, Wiederholung, Zeit blocken.

Bei einer Aufgabe aus der Datenbank merkt sich die Notiz den Block zusätzlich im Frontmatter (`plainva.blocks`), sodass die Verknüpfung von beiden Seiten sichtbar ist. Eine Checkbox-Zeile hat keine eigene Notiz — dort entsteht nur der Termin, der auf die Notiz zeigt, in der die Zeile steht. Das Symbol erscheint nur, wenn ein Kalender-Konto verbunden ist.

## Wiederkehrende Aufgaben

Eine Aufgabe, die regelmäßig wiederkommt, bekommt über das Wiederhol-Symbol in der Sektion **Aufgaben-Datenbank** eine **Wiederholung**. Plainva legt dabei **keine Serie** an: Beim Abhaken entsteht die **nächste** Aufgabe als eigene Notiz neben der erledigten, mit der neuen Fälligkeit. Damit ist immer genau eine offene Aufgabe da, die erledigte bleibt als Nachweis liegen, und es gibt keine unsichtbare Serie, aus der man versehentlich alles löscht — löschst Du eine Aufgabe, endet die Kette.

Im Dialog stellst Du drei Dinge ein:

- **Rhythmus** — Täglich, Wöchentlich, Monatlich oder Jährlich, dazu unter **Alle** das Intervall (z. B. „Alle 3" + „Täglich" = alle drei Tage).
- **Gezählt ab: Fälligkeit** — fester Takt („jeden Montag"). Hakst Du eine überfällige Aufgabe spät ab, springt Plainva auf die nächste Fälligkeit **in der Zukunft** und legt nicht die verpassten Termine nach.
- **Gezählt ab: Erledigung** — der Takt beginnt an dem Tag, an dem Du abhakst („alle drei Tage, nachdem ich gegossen habe").

**Nicht wiederholen** entfernt die Wiederholung wieder. Monatliche Aufgaben rutschen nie über das Monatsende: Der 31. Januar plus ein Monat ist der 28. bzw. 29. Februar, nicht der 3. März.

Im **Kalender** erscheint eine wiederkehrende Aufgabe deshalb nur **einmal**, nämlich an ihrem aktuellen Fälligkeitstag; ein Wiederhol-Symbol an der Zeile weist darauf hin. Das ist kein Fehler, sondern die Kehrseite des Generators: Es gibt keine Serie, aus der der Kalender weitere Vorkommen zeichnen könnte, und Zeilen ohne dahinterliegende Notiz wären nicht anklickbar. Setzt Du dagegen die Wiederholung am **verknüpften Termin** (über **Zeit blocken**), ist das eine echte Terminserie: Dein Anbieter klappt sie auf, Du siehst viele Vorkommen — es entstehen dabei aber **keine Aufgaben**, nur Termine.

Die Regel steht im Frontmatter der Notiz (`plainva.repeat`) und wandert damit über die Synchronisation mit — nicht in einer versteckten App-Einstellung und auch nicht als Datenbank-Spalte, denn sie gehört zu **dieser** Aufgabe, nicht zu jedem Eintrag der Datenbank. Aufgaben, die aus einer Aufgabenliste Deines Anbieters gespiegelt sind, bieten die Wiederholung nicht an: Sie wiederholen sich dort, und ein zweiter Rhythmus darüber würde dem Anbieter Dubletten zurückschieben.

## Notizen aus der Aufgabenansicht ausblenden

Manche Notizen enthalten Checkboxen, die nie „echte" Aufgaben sind — allen voran **Vorlagen**. Damit sie die Liste nicht füllen, kann eine Notiz sich selbst ausschließen. Die Wahrheit bleibt dabei in der Datei: der Ausschluss steht als Frontmatter-Feld in der Notiz, nicht in einer versteckten App-Einstellung. Er synchronisiert mit, ist in Obsidian sichtbar und lässt sich mit jedem Texteditor prüfen:

```yaml
---
plainva:
  tasks: false
---
```

Dieses Feld musst Du nicht von Hand schreiben:

- **Aus Aufgaben ausblenden** — Am rechten Rand jeder Notiz-Kopfzeile sitzt ein Augen-Symbol; ein Klick schreibt den Marker in genau diese Notiz und blendet sie aus.
- **Ausgeblendete anzeigen** — Diese Option in der Filterleiste zeigt die ausgeblendeten Notizen wieder an (gedimmt), jeweils mit einem Symbol zum **Wiedereinblenden** (das den Marker entfernt).
- **Vorlagen ausblenden** — Enthält Dein Vorlagen-Ordner Notizen mit Checkboxen, erscheint oben rechts ein Knopf **Vorlagen ausblenden**, der den Marker in einem Rutsch in alle diese Notizen schreibt.

Neu erstellte Vorlagen tragen den Marker automatisch. Erstellst Du eine Notiz **aus** einer Vorlage, wird er wieder entfernt — die neue Notiz ist echter Inhalt und zeigt ihre Aufgaben ganz normal.

## Obsidian-Kompatibilität

Aufgaben sind gewöhnliche GFM-Checkboxen (GitHub Flavored Markdown). Plainva fügt nie eine Sondersyntax hinzu: Dieselben `- [ ]`-Zeilen werden in Obsidian als Checkboxen dargestellt und lesen sich in jedem Editor sauber. Die Konventionen `📅 Datum` und `#tag` sind der übliche Obsidian-Tasks-Stil, aber sie sind nur Text in Deiner Notiz.

## Siehe auch

- [Notizen & Markdown](Notes_and_Markdown.md) — Aufgabenlisten im Editor schreiben
- [Suche](Search.md) — Volltextsuche über den Vault
- [Datenbanken (.base)](Databases_Base.md) — Datenbanken auf Notiz-Ebene

## Abhaken in der Übersicht

Wenn Du eine Aufgabe in der Übersicht abhakst, schreibt Plainva den Haken in die Quellnotiz und aktualisiert diese Notiz im Suchindex, bevor die Liste erneut abgefragt wird. Die Aufgabe verschwindet dadurch sofort aus **Offen** und erscheint nicht aus einem veralteten Index erneut.

<!-- accounts-tasks-2026-09-11 -->
## Gleichnamige Aufgaben sicher trennen

Aufgaben vom Anbieter werden anhand ihrer Identität zugeordnet. Verschiedene Wiederholungen bekommen eigene Dateien. Vorhandene Fehlkonflikte lassen sich als getrennte Aufgaben behalten.

Diese Dateien gehören zu unterschiedlichen Aufgaben. Gleiche Titel bedeuten bei wiederkehrenden Aufgaben nicht dieselbe Instanz. Beide Inhalte bleiben als getrennte Aufgaben erhalten.

**Als getrennte Aufgaben behalten** — Diese Datei bleibt unverändert: Aktuelle Datei  Die Konfliktkopie bleibt als separate Datei erhalten: Konfliktkopie

<!-- tasks-jex-2026-09-14 -->
## Tasks-Metadaten und Wiederholungen

Desktop, Mobil und Live-Vorschau verstehen ➕ erstellt, ✅ erledigt, 📅 fällig, ⏳ geplant, 🛫 Start, 🆔 ID und 🔁 Wiederholung. Datumswerte haben das Format YYYY-MM-DD. Vorhandene IDs bleiben bestehen; sie identifizieren die Aufgabe auch nach einem Zeilenwechsel. Unbekannte Angaben bleiben im Markdown.

Automatisch unterstützt sind ausschließlich die englischen Regeln `every [N] day/week/month/year[s] [when done]` mit N von 1 bis 999. Ein Abschluss erzeugt genau die nächste Periode, auch wenn sie noch überfällig ist; `when done` zählt ab dem Erledigungstag. Relative Datumsabstände bleiben erhalten, Monatsenden werden begrenzt. Ohne Termin entsteht eine Folge ohne Termin. Komplexe Regeln, Abhängigkeiten, Block-IDs, doppelte IDs, ungültige Daten und eingerückte Inhalte werden nicht automatisch fortgesetzt. Notizen mit einer nativen Plainva-Wiederholung oder Anbieterbindung erhalten keine zweite Wiederholung aus Tasks.

Das Abhaken ergänzt bei Tasks-Metadaten das Erledigt-Datum. Eine unterstützte Wiederholung ergänzt nötigenfalls eine ID; die Folge erhält eine eigene `pv-…`-ID. Checkbox und Folge sind eine Markdown-Änderung. Erneutes Öffnen der alten Aufgabe löscht eine vorhandene Folge nicht; erneutes Abhaken erhält sie einschließlich Deiner Änderungen. Editor-Rückgängig nimmt die gesamte Änderung zurück.

Native Datenbankaufgaben behalten ihr eigenes Verhalten: überfällige Perioden werden übersprungen. Ein dauerhaft gespeicherter Zielplan verhindert doppelte Folgen beim erneuten Abhaken. Meldet Plainva einen unbestätigten Folgeschritt, prüfe den Aufgabenordner. Nach einem Schreibfehler kann erneutes Öffnen und Abhaken den gespeicherten Plan fortsetzen. Wurde die Quelle inzwischen geändert, wird keine abweichende Kopie geschrieben; prüfe dann die vorhandenen Notizen und lege die gewünschte Folge bei Bedarf manuell an. Eine bereits bestätigte und später gelöschte Folge wird nicht wiederhergestellt.

## Filter wiederherstellen

Status, Suchtext, Ordner, Tag, „Nur mit Fälligkeit“ und die Anzeige ausgeblendeter Aufgaben bleiben pro Vault auf diesem Gerät erhalten, auch nach dem Öffnen einer Notiz oder einem Neustart. „Filter zurücksetzen“ zeigt wieder offene Aufgaben ohne weitere Filter. Nicht mehr verfügbare Ordner und Tags bleiben als solche sichtbar und können über die Ordner-/Tag-Auswahl entfernt werden. „Vault vergessen“ entfernt diesen Ansichtszustand. Die Standard-Aufgabendatenbank bleibt die bestehende Vault-Einstellung; Filter werden nicht synchronisiert.

<!-- planner-capture-2026-09-20 -->
## Planer, Schnellerfassung, Priorität und Zustände

Die Aufgabenansicht öffnet sich auf **Heute**. Die Listen — am Desktop eine Leiste links, am Telefon ein Segment über der Liste — sind **Heute** (was heute fällig ist, mit **Überfällig** obenauf), **Demnächst** (die nächsten 14 Tage, nach Tag), **Eingang** (offene Aufgaben ohne Datum), **Alle** (die beiden oben beschriebenen Sektionen mit dem Filter **Offen**/**Erledigt**/**Alle**) und **Erledigt**. Jede Liste schöpft aus beiden Quellen, der Aufgaben-Datenbank und den Checkboxen in Deinen Notizen, geordnet nach Priorität, dann Uhrzeit, dann Titel. Die übrigen Filter wirken auf jede Liste, und die gewählte Liste merkt sich Plainva je Vault. Am Desktop führt die Leiste außerdem die häufigsten Tags als Ein-Klick-Filter; am Telefon führt der Bildschirm **Heute** in die Planer-Liste **Heute**.

Über den Listen steht das Erfassungsfeld; am Telefon öffnen **+ Neue Aufgabe** und der **＋**-Knopf es als Blatt. Tippe eine Zeile — `Angebot abschicken morgen 14 Uhr !!! #kunde wöchentlich` — und drücke Enter: Plainva legt die Aufgabe in der Aufgaben-Datenbank an. Es versteht heute, morgen, übermorgen, Wochentage, „in 3 Tagen“, „nächste Woche“, Datumsangaben in Ziffern, eine Uhrzeit (`14:30`, `14 Uhr`), einen Rhythmus (täglich, wöchentlich, monatlich, jährlich, „jeden Montag“, „alle 2 Wochen“), `!`, `!!` und `!!!` für niedrige, mittlere und hohe Priorität sowie `#tags` — die Wörter in der Sprache der App, Ziffern und Zeichen in jeder Sprache. Alles Erkannte ist im Feld hinterlegt und steht darunter als abwählbarer Baustein, **bevor** etwas gespeichert wird; nimmst Du einen Baustein weg, zählen seine Wörter einfach wieder zum Titel. Am Telefon schreiben Schnellknöpfe dieselben Wörter für Dich. Nennt die Aufgaben-Datenbank eine Anbieter-Liste, entscheidet ein Chip, ob die Aufgabe auch dort angelegt wird.

**Priorität setzen** im Menü einer Zeile (Rechtsklick am Desktop, gedrückt halten am Telefon) bietet **hoch**, **mittel**, **niedrig** und **keine**; eine Fahne vor dem Titel zeigt sie. In der Aufgaben-Datenbank ist die Priorität eine Auswahl-Spalte: eine jetzt angelegte Datenbank hat sie, eine ältere bekommt sie, wenn Du zum ersten Mal eine Priorität setzt — nie durch bloßes Öffnen. Eine Checkbox trägt das Zeichen des Obsidian-Tasks-Plugins in ihrer Zeile: Plainva liest 🔺 und ⏫ als hoch, 🔼 als mittel, 🔽 und ⏬ als niedrig und schreibt ⏫, 🔼 oder 🔽.

`- [/]` (**In Arbeit**) und `- [-]` (**Abgebrochen**) sind ebenfalls Aufgaben. Sie bekommen im Editor, im Lesemodus und in jeder Liste ein eigenes Kästchen; „in Arbeit“ zählt als offen, „abgebrochen“ als geschlossen. Ein Klick schaltet weiterhin nur zwischen offen und erledigt — er erledigt eine Aufgabe in Arbeit und öffnet eine abgebrochene wieder. **Zustand setzen** im Zeilenmenü setzt die beiden Zustände; von sich aus schreibt Plainva sie nie.

Weitere Wege hinein: **Neue Aufgabe** im Tray-Menü am Desktop (wenn Plainva im Hintergrund weiterläuft), unter Android der Startmenü-Eintrag **Neue Aufgabe** (App-Symbol gedrückt halten) und am Telefon **Als Aufgabe anlegen**, wenn Du etwas an Plainva teilst — Text und Anhänge landen in der Notiz der Aufgabe. Wie eine Aufgabe mit Uhrzeit erinnert, steht unter [Kalender & externe Aufgaben](Calendar_and_Tasks.md).
