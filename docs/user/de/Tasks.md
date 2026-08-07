# Aufgaben

Stand: 2026-08-07
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

- **Offen / Erledigt / Alle** — nach Checkbox-Zustand (startet bei **Offen**).
- **Aufgaben filtern…** — Freitext; passt auf den Aufgabentext.
- **Alle Ordner** — nur Aufgaben im gewählten Ordner (und seinen Unterordnern).
- **Alle Tags** — nur Aufgaben mit einem gewählten Inline-`#tag`.
- **Nur mit Fälligkeit** — nur Aufgaben mit einem `📅`-Datum.

Tags und Fälligkeiten werden direkt aus der Aufgabenzeile gelesen — zum Beispiel `- [ ] Rechnung bezahlen #finanzen 📅 2026-08-01`.

## Aufgaben abhaken

Klicke auf die **Checkbox** einer Aufgabe, um sie zwischen offen und erledigt umzuschalten. Die Änderung wird direkt in die Notiz zurückgeschrieben (als normaler, sicherer Dateischreibvorgang — nur das einzelne `[ ]`/`[x]`-Zeichen ändert sich), sodass die Notiz, Obsidian und jede Synchronisation im Gleichschritt bleiben. Klicke stattdessen auf den **Text** der Aufgabe, um die Notiz zu öffnen und zu dieser Zeile zu springen.

Hat sich eine Notiz seit dem Aufbau der Liste geändert, wird ein veraltetes Umschalten übersprungen und die Liste aktualisiert — mit dem **Aktualisieren**-Knopf oben rechts kannst Du jederzeit neu laden.

## Standard-Aufgabendatenbank

Checkboxen sind schnell notiert, aber manchmal wächst eine Zeile zu einer „richtigen" Aufgabe heran — mit Status, Fälligkeit und eigener Notiz. Dafür legst Du in den Einstellungen unter **Inhalt & Struktur** eine **Standard-Aufgabendatenbank** fest: eine [Datenbank (`.base`)](Databases_Base.md), in der solche Aufgaben als eigene Notizen leben. Mit **Neue Datenbank anlegen…** erstellt Plainva eine fertige Datenbank (Ablage-Ordner plus `.base` mit einer **Erledigt-Checkbox-Spalte** (`erledigt`), Status-Spalte, Fälligkeits-Spalte, Tabellen- und Board-Ansicht); genauso kannst Du eine bestehende Datenbank auswählen. Die Checkbox-Eigenschaft ist die Erledigt-Wahrheit einer Aufgabe (an/aus, wie bei den Anbietern); die Status-Spalte wird beim Abhaken konsistent mitgeführt. Hat eine Datenbank keine Checkbox-Spalte, gilt die Status-Konvention: erste Option = offen, letzte = erledigt.

Ist sie festgelegt, zeigt die Aufgabenansicht zwei Bereiche: oben die Einträge der **Aufgaben-Datenbank**, darunter **Aus Notizen** — die gewohnte Checkbox-Liste. Der Status lässt sich direkt in der Übersicht ändern: das Kästchen ist die Erledigt-Checkbox-Eigenschaft der Notiz und schaltet sie um (die Status-Spalte folgt); ein Klick auf den Status-Chip öffnet ein Menü mit allen Optionen (**Status ändern**). Die Filter **Offen**/**Erledigt**/**Alle** wirken auf beide Bereiche, und **Als Datenbank öffnen** springt zur vollen Datenbank-Ansicht mit Board und Filtern. **Aktualisieren** stößt bei verbundenen Konten zusätzlich einen echten Abgleich mit dem Anbieter an.

## Eine Checkbox zur Datenbank-Aufgabe machen

Jede Checkbox-Zeile trägt ein Datenbank-Symbol: **Zur Aufgaben-Datenbank verschieben**. Ein Klick

- erstellt eine neue Notiz im Ablage-Ordner der Datenbank (mit deren Standard-Vorlage, falls eine eingestellt ist),
- übernimmt ein `📅`-Datum in die Fälligkeits-Spalte, setzt bei offenen Aufgaben die erste Status-Option und trägt die `#tags` der Zeile als Tags der Notiz ein,
- verlinkt die neue Notiz über eine `source`-Eigenschaft zurück auf die Ursprungsnotiz und
- ersetzt die Checkbox-Zeile in der Ursprungsnotiz durch einen Wiki-Link auf die neue Aufgaben-Notiz — der Eintrag bleibt an Ort und Stelle lesbar, die Aufgabe lebt ab jetzt in der Datenbank.

Mit einem **Rechtsklick** auf das Symbol wählst Du stattdessen eine andere Datenbank als Ziel; ohne festgelegte Standard-Datenbank öffnet schon der Klick diese Auswahl. Alles bleibt reines Markdown: Die neue Aufgabe ist eine gewöhnliche Notiz mit Frontmatter, der Link in der Ursprungsnotiz ein normaler `[[Wiki-Link]]`.

**+ Neue Aufgabe** in der Kopfzeile der Sektion legt einen Eintrag direkt in der Aufgaben-Datenbank an (gleicher Ablage-Ordner, gleiche Vorlage und Vorbelegungen wie beim Verschieben einer Checkbox) und öffnet ihn. In einer Notiz geschriebene Checkboxen bleiben in dieser Notiz — sie werden erst zu Datenbank-Aufgaben, wenn Du sie verschiebst.

## Zeit für eine Aufgabe blocken

Aufgaben sind in Plainva **taggenau**: Eine Aufgabe hat ein Fälligkeitsdatum, keine Uhrzeit. Wenn Du Dir für eine Aufgabe ein Zeitfenster reservieren willst, legt Plainva dafür einen **Termin** an — das ist das Objekt, das einen Zeitraum kennt, im Raster mit Überschneidungen dargestellt wird und mit Deinem Kalender-Konto synchronisiert.

Das Kalender-Symbol an einer Aufgabenzeile öffnet **Zeit blocken**: Datum (mit der Fälligkeit vorbelegt), Beginn und **Dauer** (15 min, 30 min, 1 h, 2 h oder **Eigene**), bei mehreren beschreibbaren Kalendern zusätzlich die Kalenderauswahl. Der Termin trägt den Titel der Aufgabe und verlinkt zurück auf die Notiz.

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
