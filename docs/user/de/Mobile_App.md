# Die mobile App

Stand: 2026-08-24

Plainva gibt es auch als App für Android und iOS. Sie arbeitet mit denselben Markdown-Dateien, demselben **OKF**-Format und derselben Sync-Technik wie die Desktop-App — Dein Vault bleibt in beiden Welten identisch.

## Die App installieren

Die mobile App läuft als **offener Test** bei Google Play. Unter **Android** kommst Du direkt hinein: über [plainva.com/de/android-beta](https://plainva.com/de/android-beta) den Test-Link öffnen, **Tester werden** antippen und die App aus Google Play installieren — Du brauchst keine Einladung und musst keiner Gruppe beitreten. Plainva steht auch direkt im Play Store. Auf dem **iPhone** läuft die Verteilung über TestFlight; die Warteliste steht auf [plainva.com](https://plainva.com).

**Systemvoraussetzungen:** Auf iPhone und iPad braucht Plainva **iOS 16.4** oder neuer — dort gehört die Engine, mit der die App ihre Oberfläche zeichnet, zum System, und ein neuerer Safari ändert daran nichts. Unter Android genügt Android 7, aber die **Android System WebView** muss aktuell sein; ist sie zu alt, sagt Plainva das beim Start und nennt den Weg über den Play Store.

Es ist eine frühe Version: Halte eine Sicherung Deines Vaults bereit und sag Bescheid, was hakt.

## Aufbau

- **Untere Leiste:** **zwei bis vier** Arbeitsflächen Deiner Wahl und ganz rechts der feste Eintrag **Bereiche** — zusammen die drei bis fünf Ziele, die auf eine Leiste gehören. **Notizen** bleibt immer sichtbar: darüber erreichst Du Deine Dateien.
- **Alle Bereiche** (Notizen, Heute, Aufgaben, Kalender, E-Mail, Graph) erreichst Du jederzeit über das **Bereichs-Blatt**: über **Bereiche** in der Leiste oder **langes Drücken auf die Leiste**. Das Blatt markiert den aktuellen Bereich und führt unten direkt zu **Navigationsleiste anpassen…**. Tags, Lesezeichen und Zuletzt geöffnet sind keine eigenen Bereiche mehr — sie liegen unter **Notizen**.
- **Navigationsleiste einstellen:** **Einstellungen** → **Navigationsleiste**. Dort legst Du mit **−**/**+** fest, wie viele Arbeitsflächen die Leiste zeigt (2–4, mit Live-Vorschau), und ordnest die Liste per **Zieh-Griff**: die oberen Einträge bilden die Leiste (im Rahmen markiert), nach oben ziehen befördert einen Bereich hinein. Am oberen oder unteren Rand scrollt die Liste beim Ziehen mit — so reicht eine Bewegung auch über die ganze Liste. Ausgeblendet wird nichts — was nicht in der Leiste steht, bleibt über **Bereiche** erreichbar. Verlässt der gerade offene Bereich die Leiste, springt die App auf den ersten sichtbaren. Dieselbe Leiste kannst Du auch **am Desktop** anordnen (Einstellungen → Vault → Leisten & Bereiche); mit eingeschaltetem Einstellungs-Sync reist die Anordnung zwischen Deinen Geräten mit.
- **Eine Ordnerzeile zählt alles darunter**, nicht nur die Notizen, die direkt darin liegen — ein Ordner voller Unterordner meldet also nicht mehr „0 Notizen“ neben einem Pfeil, der zu Hunderten führt.
- **＋** schwebt als runder Knopf über der Leiste und öffnet die Schnellanlage: Notiz, Tagesnotiz, Ordner, Datenbank, „Aus Vorlage…".
- **Ein langes Drücken auf eine Zeile zeigt, was diese Zeile kann** — Notiz, Ordner, Datenbank und Aufgabe antworten gleich, und **Mehrere auswählen** ist der erste Eintrag in dem Blatt. Ein Wisch nach links führt die zwei häufigsten Aktionen direkt aus; Blatt und Wisch bieten dasselbe in derselben Reihenfolge.
- **Kopfzeile:** überall dieselbe — links Zurück (auf einer Arbeitsfläche entfällt es), in der Mitte Titel und eine Zeile Kontext, rechts Suche und ⋮. Beim Scrollen hebt sie sich vom Inhalt ab, und die Navigationsleiste zieht sich auf ihre Symbole zurück; scrollst Du zurück, geht sie wieder auf.
- **Ein ⋮ bedeutet immer dasselbe:** Aktionen auf dem Objekt, das gerade offen ist. App-Einstellungen liegen nicht dahinter.
- **Einstellungen:** ganz unten unter **Notizen**, dort wo sie auch am Desktop stehen. Sie öffnen zuerst die Bereichsliste (wie die linke Seite der Desktop-Einstellungen) — ein Tipp öffnet die jeweilige Seite. Ganz oben führt **Aktiver Vault** zur Vault-Verwaltung: Vault wechseln (Häkchen = aktiv), **Neuen Vault erstellen** und **Mit Cloud verbinden**. Die Liste zeigt **dieselben Bereiche wie am Desktop** — dazu gehören **Start & Verhalten** (Willkommen und Neuigkeiten erneut anzeigen), **Leisten & Bereiche** (die Navigationsleiste) und **Wartung** (Vault-Statistik, Index neu aufbauen, gelöschte Dateien wiederherstellen). Nur **Updates** fehlt: die App aktualisiert sich nicht selbst, das übernehmen Google Play und TestFlight. **Wartung** führt zusätzlich den **Import aus anderen Apps** — er schreibt auf dem Telefon immer in einen Unterordner des offenen Vaults, zeigt vorher, was er anlegen würde, lässt sich währenddessen abbrechen und legt am Ende einen Bericht ab.

## Notizen lesen und bearbeiten

Notizen öffnen **gerendert und schreibgeschützt**; der Stift oben rechts wechselt ins Bearbeiten (mit Werkzeugleiste über der Tastatur: Formatierung, Listen, Wiki-Link, Slash-Befehle, Foto einfügen). `![[Notiz]]`-Einbettungen erscheinen als antippbare Vorschau-Karten.

Das **Notiz-Details**-Symbol in der Kopfzeile (zwischen Lesezeichen und ⋮-Menü) öffnet das Kontext-Blatt der Notiz: Eigenschaften (direkt editierbar), Backlinks, Gliederung, Graph und der **Versionsverlauf** — jede Bearbeitung erzeugt automatisch Snapshots, die Du ansehen, vergleichen und wiederherstellen kannst. Markdown-Quelltext und die Suche in der Notiz erreichst Du über das ⋮-Menü.

Auf einem breiten Bildschirm (Tablet ab 1024 px) kann dieses Blatt als **dritte Spalte** neben der Notiz stehenbleiben, statt sich jedes Mal zu öffnen und zu schließen. Der Schalter dafür heißt **Kontext-Panel andocken** und steht unter **Einstellungen → Erscheinungsbild → Layout**; er gilt für dieses Gerät. Ist er aus — oder ist das Fenster schmaler —, öffnet derselbe Knopf wie bisher das Blatt.

## Vorlagen

Vorlagen wirken auf dem Telefon genauso wie am Desktop: Die Platzhalter (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) werden beim Anlegen ersetzt, **alle** Fragen einer Vorlage erscheinen zusammen in **einem** Blatt — brichst Du es ab, entsteht nichts — und `{{cursor}}` setzt die Schreibmarke, sobald die Notiz aufgeht.

Die Zuordnungen **Ordner → Vorlage** und **Notiztyp → Vorlage** legst Du am Desktop fest; sie reisen über die Einstellungs-Synchronisation mit und greifen hier ebenso — eine Notiz in `Projekte/` beginnt also auf beiden Geräten gleich, auch beim `＋`-Erfassen und bei **+ Eintrag** in einer Datenbank. Zwei Feinheiten: `{{weekday:…}}` rechnet auf dem Telefon immer ab Montag (der Wochenbeginn kommt aus **Erscheinungsbild**), und `{{clipboard}}` fragt den Inhalt der Zwischenablage im selben Blatt ab, statt ihn ungefragt zu lesen. Alle Platzhalter stehen in [Notizen und Markdown](Notes_and_Markdown.md).

## Datenbanken (`.base`)

`.base`-Datenbanken funktionieren wie am Desktop: alle Ansichten (Tabelle, Liste, Galerie, Board, Kalender, Zeitachse), typgerechtes Bearbeiten der Zellen, Karten im Board per Gedrückthalten verschieben. Über **Konfigurieren** verwaltest Du Ansichten, Spalten, Filter (auch Gruppen), Sortierung und Eigenschaften.

Die **Kalenderansicht** kennt drei Zeiträume: **Monat**, **Woche**, **Tag**. Der Monat bleibt der Einstieg — er ist der einzige, der auf einem Telefonschirm noch eine Form zeigt; Woche und Tag sind Listen, weil sieben Spalten Inhalt dort nicht mehr lesbar wären. Ein Eintrag über mehrere Tage erscheint als **Balken** statt an jedem Tag erneut, und Uhrzeiten stehen vor dem Titel. Die **Zeitachse** zeigt eine **Zeile je Eintrag** mit einem Balken von Anfang bis Ende: an beiden Enden lässt sich der Balken **mit dem Finger ziehen** und schreibt damit das Datumsfeld der Notiz. Unter **Konfigurieren** wählst Du Datums- und Enddatumsfeld sowie **Farbe nach** — dieselbe Einstellung, dieselbe Datei wie am Rechner. Relationen-Schema (Ziele, Kardinalität) pflegst Du weiterhin am Desktop.

**Mehrere Einträge auf einmal**: Halte eine Zeile gedrückt und wähle **Mehrere auswählen** — der erste Eintrag im Blatt. Danach wählt ein Tipp aus statt zu öffnen, und eine Leiste unten zeigt, wie viele es sind. Dort kannst Du die Auswahl **löschen** (eine Frage, nicht zwölf — mit demselben Überblick über Zusammenhänge wie beim einzelnen Löschen) oder mit **Wert setzen…** eine Eigenschaft für alle auf einmal setzen: erst die Eigenschaft wählen, dann den Wert. Steht neben einer Eigenschaft **derzeit gemischt**, tragen die ausgewählten Einträge verschiedene Werte. Ein leerer Wert entfernt die Eigenschaft. Beim Setzen läuft ein Fortschritt mit, der sich abbrechen lässt; bereits Geschriebenes bleibt. Tags, Listen, Mehrfachauswahl und Relationen sind bewusst nicht dabei — dort hieße „alle auf X setzen", dass jeder bestehende Wert verschwindet.

Eine **Pinnwand**-Ansicht zeigt die Notizen als zweispaltiges Brett aus Zetteln: Tippen öffnet die Notiz, langes Drücken zeigt die Aktionen (Anpinnen, Labels, Farbe, Löschen), Ziehen nach langem Drücken ordnet um, und Kontrollkästchen lassen sich direkt auf der Karte abhaken. Das Eingabefeld oben erfasst einen neuen Zettel. Tipp: Zeigt die Datenbank auf Deinen Eingangsordner (**Einstellungen** → **Inhalt & Struktur**), landen auch die ＋-Schnellnotizen und aus anderen Apps geteilte Texte direkt auf dem Brett.

## Aufgaben

Der Bereich **Aufgaben** sammelt jede Checkbox Deines Vaults — alle `- [ ]`- und `- [x]`-Zeilen über alle Notizen hinweg, nach Notiz gruppiert. Das ist die zeilenbasierte Übersicht, die eine Datenbank nicht liefern kann, weil eine Datenbank mit ganzen Notizen arbeitet.

Tippen auf eine Aufgabe öffnet die Notiz **an dieser Zeile**; das Kästchen hakt ab und schreibt genau das eine `[ ]`/`[x]`-Zeichen zurück. Fälligkeit (`📅`) und `#tags` erscheinen als Chips, damit sie nicht doppelt im Text stehen.

Hat Dein Vault eine **Aufgaben-Datenbank** (**Einstellungen** → **Inhalt & Struktur**), zeigt der Bereich sie darüber als eigene Sektion: abhaken, Status wechseln, **+ Neue Aufgabe** und **Als Datenbank öffnen**. Benennt die Datenbank eine Anbieter-Aufgabenliste (**Konfigurieren** → **Datenquelle** → **Neue Aufgaben auch anlegen bei** — hier genauso einstellbar wie am Desktop), trägt das Anlegen-Blatt zusätzlich einen Schalter **Auch anlegen bei „…“**: eingeschaltet, weil die Wahl der Liste bereits die Entscheidung ist, abschaltbar für die eine Aufgabe, die im Vault bleiben soll. Eine beförderte Checkbox und eine als Aufgabe erfasste E-Mail gehen denselben Weg. Jede Checkbox-Zeile trägt dann in ihrer Meta-Zeile zusätzlich **In Datenbank** — die Zeile bleibt als Wiki-Link stehen, die Aufgabe lebt ab dann als eigene Notiz.

Die ausgewählten **Aufgabenlisten** Deiner Konten spiegelt das Telefon selbst in diese Datenbank — es importiert neue Aufgaben, erkennt eine bereits vorhandene Notiz an ihrem Anker (statt eine zweite anzulegen) und schickt Deine Änderungen an den Anbieter. Löschst Du eine Aufgaben-Notiz bestätigt, wird die Aufgabe beim Anbieter mitgelöscht — mit acht Sekunden **Rückgängig**; schickst Du die App in dieser Zeit in den Hintergrund, bleibt die Aufgabe stehen. Eine bloß fehlende Datei löscht dagegen nie etwas. Die Regeln im Einzelnen stehen unter [Kalender & Aufgaben](Calendar_and_Tasks.md). Wann das geschieht, sagt [Kalender und Termine](#kalender-und-termine): ein Telefon hält im Hintergrund keinen Abgleich am Laufen, deshalb holt Plainva ihn beim Zurückkehren in die App und beim Öffnen dieses Bereichs nach.

Über der Liste stehen dieselben Filter wie am Desktop: **Ordner**, **Tag**, **Nur mit Fälligkeit** und **Ausgeblendete anzeigen**. Ausblenden ist eine Eigenschaft der **Notiz**, nicht der einzelnen Aufgabe — das Augen-Symbol an einer Notiz-Überschrift trägt `plainva.tasks: false` in deren Frontmatter ein und nimmt sie damit aus der Übersicht; **Vorlagen ausblenden** macht das in einem Zug für den ganzen Vorlagen-Ordner. Die Datei behält die Aufgaben, sie zählen nur nicht mehr mit. Ein langes Drücken auf **In Datenbank** wählt die **Ziel-Datenbank** aus, wenn Dein Vault mehrere hat.

Eine Aufgabenzeile zeigt ihren Titel über die volle Breite; Status, Fälligkeit, Wiederholung und Tags stehen darunter, rechts steht genau eine Aktion. **Zeit blocken** (das Kalender-Symbol rechts) legt bei verbundenem Kalender einen Termin für die Aufgabe an (Datum, Beginn, Dauer, bei mehreren beschreibbaren Kalendern die Auswahl); **Wiederholung** in der Meta-Zeile legt beim Abhaken die nächste Aufgabe mit neuer Fälligkeit an. Details zu beidem stehen unter [Aufgaben](Tasks.md).

## Heute

**Heute** ist die Tagesfläche. Der Streifen oben wählt einen Tag — er läuft **in beide Richtungen**, zwei Wochen zurück und zwei Wochen voraus, ein Punkt markiert jeden Tag, an dem schon eine Tagesnotiz liegt. Darunter steht die **Tagesnotiz** des gewählten Tages (mit Vorlage und Ordner, zum Öffnen oder Anlegen), dann **Termine und Fälligkeiten** dieses Tages und zuletzt, was Du an dem Tag bearbeitet hast.

Die mittlere Sektion führt zusammen, was sonst auf zwei Flächen liegt: ganztägige Termine zuerst, danach die zeitgebundenen in Uhrzeit-Reihenfolge, zum Schluss die Aufgaben, die an dem Tag fällig sind. Ein Tipp auf eine Aufgabe öffnet ihre Notiz. Ohne verbundenen Kalender und ohne Aufgaben-Datenbank fehlt die Sektion einfach.

## Tags

Die Tag-Liste liegt unter **Notizen**. Ein Tipp öffnet die Notizen eines Tags, das Chevron klappt verschachtelte Tags auf. **Langes Drücken** auf einen Tag bietet **Tag umbenennen** — vault-weit, wie am Desktop: Plainva schreibt jede Notiz um, die den Tag trägt (im Frontmatter und als `#tag` im Text, samt seiner `tag/unter`-Kinder) und nennt Dir danach, in wie vielen Notizen der Tag ersetzt wurde. Eine Notiz, die sich nicht lesen oder schreiben lässt, wird übersprungen — die übrigen werden trotzdem umbenannt.

## Im ganzen Vault suchen & ersetzen

Der Weg dorthin ist die Lupe in der Kopfzeile, dann `>` und **Im Vault suchen & ersetzen**. Die Fläche durchsucht alle Notizen auf einmal. Suchtext eingeben, **Suchen** tippen — die Treffer erscheinen nach Notiz gruppiert mit ihrer Trefferzahl; ein Tipp öffnet die Zeilen einer Notiz, und es bleibt immer nur eine offen. Notizen, die Du auslassen willst, wählst Du ab — pro Notiz, nie pro Zeile, denn eine Notiz wird ganz oder gar nicht ersetzt. **In N Notizen ersetzen** schreibt den Rest um, mit Fortschrittsbalken und einem **Abbrechen**, das bei der nächsten Notiz hält. Jede Notiz wird unmittelbar vor dem Schreiben neu gelesen, sodass eine veraltete Vorschau nie neueren Inhalt überschreibt; eine Notiz, die sich zwischenzeitlich geändert hat, wird übersprungen und das wird Dir gesagt. Groß/klein, ganzes Wort und Regex gelten auch hier.

## Übersichten (index.md)

In einem OKF-Vault ist die `index.md` das Inhaltsverzeichnis eines Ordners. Am Telefon gibt es zwei Wege dorthin, und sie sind für zwei verschiedene Momente gedacht.

**Für den Moment, in dem es auffällt:** Halte einen Ordner in der Liste — das Blatt bietet **Übersicht erzeugen** an, wenn keine da ist, und **Übersicht aktualisieren**, wenn Plainva die vorhandene führt. Die Zeile benennt also ihre Wirkung, statt Dich wählen zu lassen. Hast Du die `index.md` dieses Ordners selbst geschrieben, erscheint die Zeile gar nicht: Deine Datei gehört Dir.

**Für den Aufräum-Durchgang:** **Einstellungen → Vault → Wartung → Übersichten** listet jeden Ordner mit Notizzahl und Zustand — sortiert nach *wo etwas fehlt*, nicht alphabetisch, damit die paar Ordner, die Aufmerksamkeit brauchen, nicht zwischen lauter erledigten stehen. Oben legt **In allen N Ordnern ohne index.md erzeugen** die fehlenden in einem Zug an. Steht in einem Ordner ohne `index.md` bereits eine Überblicksnotiz (MOC, Übersicht, README …), kannst Du sie hier **übernehmen** — das benennt die Datei um und zieht die Links vault-weit mit, deshalb wird vorher gefragt.

**Automatisch aktuell.** Von Plainva erzeugte Übersichten tragen eine unsichtbare Markierung. Nur solche Dateien hält die App nach — und ab sofort auch am Telefon: legst Du dort Notizen an, verschiebst oder löschst Du welche, schreibt Plainva die betroffenen Übersichten kurz darauf neu. Früher tat das nur der Desktop, ein am Telefon gepflegter Vault veraltete also still.

**Schreibgeschützt mit Ausweg.** Eine verwaltete Übersicht öffnet als Leseansicht mit einem Band darüber: **Aktualisieren** schreibt sie neu, **Trotzdem bearbeiten** entfernt die Markierung — danach gehört die Datei ganz Dir und wird nicht mehr automatisch überschrieben. Ohne diesen Schutz würde der nächste Lauf still über alles schreiben, was Du hineingetippt hast.

## In OKF-Format überführen

Einen ganzen Vault auf das [OKF-Format](OKF.md) zu heben, geht jetzt auch vom Telefon: **Einstellungen → Vault → Wartung → In OKF-Format überführen**. Der Wizard scannt, lässt Dich den Standard-`type` wählen, **zeigt die betroffenen Notizen namentlich** und schreibt erst danach — vor jeder Änderung landet die Datei im Backup-Ordner.

Weil ein Telefon eine laufende App jederzeit beenden darf, hält der Lauf hier zusätzlich an der nächsten Datei an, wenn Du **Anhalten** tippst oder die App in den Hintergrund geht. Dass Plainva beim nächsten Öffnen fragt, ob ein unterbrochener Lauf **fortgesetzt** oder **zurückgerollt** werden soll, gilt auf beiden Geräten; **Später** ist eine gültige Antwort, die Frage kommt wieder und geht nicht verloren.

Ein unterbrochener Lauf lässt einen unvollständig konvertierten Vault zurück, keinen kaputten: Es werden ausschließlich Frontmatter-Felder ergänzt, jede Notiz bleibt gültiges Markdown und in jedem anderen Editor lesbar.

### OKF 0.2 am Telefon

Die Felder aus [OKF 0.2](OKF.md) — Herkunft, Prüfung, Status, Veraltet-ab — liest und zeigt das Telefon genauso wie der Desktop: das Abzeichen **Entwurf**/**Eingestellt** im Notizkopf, der Hinweis **Als veraltet markiert** über der Notiz, und der Abschnitt **Vertrauen & Herkunft** im Kontext-Blatt der Notiz mit der Vertrauensstufe. Dort steht auch **Als geprüft markieren**: Es hängt `human:<Dein Name>` an die Geprüft-Liste an; den Namen fragt Plainva einmal pro Vault ab, er bleibt auf dem Gerät und ist unter **Einstellungen → Vault → Inhalt & Struktur → Prüfername** änderbar. Die Bundle-Version eines Vaults hebst Du unter **Einstellungen → Vault → Wartung → Bundle-Version** auf 0.2 — mit Vorschau, Backup und dem Häkchen, das veraltete `okf_version`-Feld aus den Notizen zu entfernen.

## Graph

Die **Vault-Karte** zeigt Deinen Vault als Knoten und Kanten. Ein Tipp auf eine Ordner-Blase klappt sie auf, ein Tipp auf eine Notiz öffnet sie; die Chips darüber filtern nach Notiztyp, Tag und Kantenart. Ziehst Du einen Knoten, **merkt sich die Karte, wohin Du ihn gelegt hast** — die gemerkte Anordnung liegt in `.plainva/graph.json` und bleibt bewusst auf diesem Gerät, wie der Suchindex.

**Langes Drücken** auf einen Knoten öffnet sein Menü: öffnen (bzw. Ordner entfalten/einklappen), **Fokus auf Auswahl** und, wenn der Knoten festgesteckt ist, **Pin lösen**. Ein langes Drücken auf eine **Kante** nennt beide Enden und öffnet die eine oder andere Notiz. Ziehst Du eine Notiz **auf eine andere**, bietet Plainva an, sie zu **verlinken** — als Text-Link am Notizende oder über eine Relation der zugehörigen Datenbank; eine Relation, die genau einen Eintrag erlaubt, fragt vorher nach, weil sie den bisherigen Wert ersetzt. Der Chip **Auswählen** macht aus dem Ziehen auf freier Fläche ein Auswahlrechteck (auf dem Telefon gibt es keine Zusatztaste); markierte Notizen lassen sich gemeinsam löschen — durch denselben Rückfrage-Dialog wie eine einzelne. **Als SVG exportieren…** gibt die Karte an das Teilen-Menü Deines Geräts weiter.

Dasselbe Aufräumen im Kleinen leistet der **Graph im Notiz-Kontext-Blatt**: Er zeigt die Nachbarschaft der offenen Notiz und darunter Vorschläge, was noch zu ihr gehören könnte. **Verlinken** setzt den Link an der Fundstelle im Text — nicht ans Notizende —, und ein verworfener Vorschlag bleibt verworfen, auch nach dem Schließen der Notiz.

Der Chip **Aufräumen** öffnet die Aufräum-Liste: **Waisen** (Notizen, auf die nichts verweist), **kaputte Links** (Verweise ins Leere) und **Erwähnungen** — Stellen, an denen eine Notiz genannt, aber nicht verlinkt wird. Waisen löschst Du über denselben Rückfrage-Dialog wie überall sonst, zu einem kaputten Link legst Du die fehlende Notiz an, und eine Erwähnung verlinkst Du genau **an der Fundstelle** statt am Notizende. Was Du dabei verwirfst, bleibt verworfen: es taucht beim nächsten Durchlauf nicht wieder auf. Der Erwähnungs-Durchlauf liest jede Notiz und startet deshalb erst auf Deinen Tipp — er lässt sich jederzeit abbrechen.

Der **Fokus** setzt sich auch über das Knotenmenü: die Karte zeigt dann nur noch seine Nachbarschaft bis zur gewählten Tiefe (1 bis 3). Der Chip mit der Tiefe hebt den Fokus wieder auf. Zwei weitere Chips lesen die Karte nach Alter: **Heatmap** färbt jeden Knoten danach, wie kürzlich er sich geändert hat, und **Zeitreise** blendet alles aus, was neuer ist als der Regler — so lässt sich zusehen, wie der Vault gewachsen ist.

## Kalender und Termine

Der Bereich **Kalender** zeigt Deine verbundenen Kalender in den Ansichten **Tag**, **3 Tage** und **Agenda** — dasselbe Konten-Modell wie am Desktop. Du erreichst ihn über die Navigationsleiste oder über **Bereiche**. Jede Tagesspalte trägt oben ihren **Wochentag und das Datum**, darunter einen Streifen für die **ganztägigen Termine** des Tages; beides scrollt mit dem Raster, statt Platz dauerhaft zu belegen. Ein Tipp auf einen Termin öffnet die **Termin-Vorschau** als Blatt — dieselbe Fläche wie das freischwebende Fenster am Desktop: Zeitraum, Ort, Beschreibung, Teilnehmende mit ihren Antworten, und bei einer Serie ihr Rhythmus samt nächstem Termin. Bei einer Einladung stehen dort **Zusagen**, **Vorläufig** und **Absagen**, darunter **Termin bearbeiten**, **Meeting-Notiz** und **Termin löschen**. Wischen nach unten schließt das Blatt. Tagesnotizen liegen nicht hier, sondern in **Heute**.

**Wann das Telefon nachsieht.** Im Hintergrund läuft auf einem Telefon keine Uhr — der regelmäßige Abgleich steht also still, solange die App weg ist. Deshalb fragt Plainva von sich aus nach, sobald Du **in die App zurückkehrst** und sobald Du **Kalender**, **Aufgaben** oder die **Kalenderkonten** öffnest; höchstens einmal pro Minute, damit häufiges Hin- und Herwechseln keine Kette von Abgleichen auslöst. Beim Zurückkehren werden zugleich die **Erinnerungen neu geplant**, auch wenn nichts Neues dazugekommen ist — die Uhr ist ja trotzdem weitergelaufen. Willst Du nicht warten, gibt es weiterhin **Jetzt aktualisieren** und das Herunterziehen der Liste.

Konten verwaltest Du über das Zahnrad-Symbol im Termin-Kalender: **CalDAV** verbindest Du direkt auf dem Gerät mit einem App-Passwort (z. B. Fastmail, Nextcloud, iCloud); Google und Microsoft folgen über die Browser-Anmeldung. Je Konto lassen sich einzelne Kalender ein- und ausblenden.

Aus einem Termin heraus legst Du über **Besprechungsnotiz** die zugehörige Notiz an — dieselbe Notiz, die auch der Desktop findet: sie trägt einen Anker auf den Termin, wird beim zweiten Aufruf wieder geöffnet statt doppelt angelegt und landet im **Meeting-Ordner**. Diesen Ordner wählst Du im Konten-Bereich unter **Kalender-Einstellungen** über einen **Ordner-Browser** aus, statt seinen Pfad zu tippen; dort steht auch der **Standardkalender für Termine** (in dem ein neuer Termin startet); beides gilt für den Vault und reist über die Einstellungs-Synchronisation mit. Ebendort wählst Du je Konto auch die **Aufgabenlisten**, die in Deine Aufgaben-Datenbank gespiegelt werden.

**Anmelden gilt pro Gerät.** Synchronisiert werden Deine Konto-*Einstellungen*, nie die Anmeldung selbst — das ist Absicht: Zugangsdaten sollen das Gerät nicht verlassen. Ein Konto, das über die Einstellungs-Synchronisation kam, taucht deshalb in der Liste auf, trägt aber die Markierung **anmelden**; darunter steht, was zu tun ist. Solange kein Konto auf diesem Gerät angemeldet ist, erklären der Kalender und das Postfach das an Ort und Stelle, statt einfach leer zu bleiben, und führen Dich mit **Auf diesem Gerät anmelden** zu den Konten. Angemeldete Konten zeigen **aktiv**. Läuft eine Anmeldung später ab oder wird sie widerrufen, steht dort **Anmeldung abgelaufen** samt Grund — und **Neu anmelden** setzt sie wieder in Gang, ohne das Konto zu entfernen: es bleibt dasselbe Konto mit denselben Kalendern. Für Google und Microsoft sucht Plainva die dafür nötige App-Registrierung selbst auf dem Gerät — beim Konto, beim Datei-Sync desselben Kontos oder bei einem anderen Konto desselben Anbieters. Das gilt beim **Neu anmelden** wie beim **Anlegen** eines Kontos: findet Plainva eine, steht im Formular **Client-ID von diesem Gerät übernommen** mit **Bearbeiten** daneben. Nur wenn wirklich keine da ist, fragt das Formular danach.

**Ein Login für alle Dienste — auch hier.** Trägt ein Microsoft- oder Google-Konto mehrere Dienste (etwa Dateien und Kalender), bietet die Übersicht **Cloud-Konten** an, sie in einer einzigen Anmeldung zusammenzuführen. Danach hält eine Anmeldung jeden Dienst am Leben statt nur einen — vorher konnte ein Dienst weiterlaufen, während ein anderer desselben Kontos still abgelaufen war. Ein Gmail-Postfach bleibt außen vor: es läuft über IMAP mit App-Passwort und braucht keine Zustimmung. Das Angebot bleibt stehen, solange die gemeinsame Anmeldung nicht alle Dienste des Kontos trägt. Deckt sie einen Dienst nicht ab, findest Du in den Konto-Details zwei Auswege: **Geteilte Anmeldung zurücksetzen** lässt jeden Dienst wieder seine eigene benutzen, **Assistent beenden** räumt einen Verbindungsversuch weg, der nie zu Ende kam.

**Erinnerungen.** Unter **Kalender-Einstellungen → Erinnerungen** schaltest Du **Termine erinnern** ein; dabei fragt das Telefon einmal nach der Berechtigung für Benachrichtigungen. Was der Termin selbst an Erinnerung mitbringt, gilt — erst wenn er nichts sagt, erinnert Plainva 15 Minuten vorher, ganztägige Termine am Abend davor um 19:00 Uhr. Ein Termin, der ausdrücklich keine Erinnerung will, bekommt auch keine. Geplant werden die nächsten 14 Tage und höchstens 64 Erinnerungen im Voraus — so viele lässt iOS zu; Plainva füllt dieses Fenster bei jedem Öffnen und nach jeder Kalender-Aktualisierung neu auf und sagt Dir, ab wann ein Zeitraum nicht mehr hineinpasst, statt Termine still zu verschlucken. **Die Grenze, die bleibt:** Das Telefon kann nur ankündigen, was es beim letzten Abgleich gesehen hat — eine Einladung, die zehn Minuten vor Beginn eintrifft, erreicht keine Benachrichtigung mehr.

**Was Du dabei einstellst.** Die **Vorlaufzeit** gilt für Termine ohne eigene Erinnerung; **Ganztägige Termine** legt fest, an welchem Abend oder Morgen sie sich melden. **Fällige Aufgaben** nimmt zusätzlich die Aufgaben Deiner Aufgaben-Datenbank auf — mit Uhrzeit wie ein Termin, ohne Uhrzeit nach der Zeile **Aufgaben ohne Uhrzeit** direkt darunter, die standardmäßig **am Fälligkeitstag um 09:00** erinnert. **Nur diese Kalender** grenzt ein, woher überhaupt erinnert wird; wählst Du nichts aus, steht dort **Alle**, und ein später hinzugekommener Kalender ist von sich aus dabei. Das Blatt bleibt dabei offen, bis Du fertig bist — Du hakst also mehrere Kalender in einem Zug ab. Auf der Benachrichtigung selbst liegen zwei Handgriffe: bei einem Termin **Besprechungsnotiz** (legt sie an oder öffnet die vorhandene), bei einer Aufgabe **Abhaken** — das hakt sie sofort ab und erzeugt bei einer wiederkehrenden Aufgabe die nächste, ohne dass Du die App öffnen musst. Unter den Einstellungen steht außerdem, **was tatsächlich geplant wurde** — etwa „Geplant: 12 Termine · 3 Aufgaben“ — oder warum nichts geplant wurde, zum Beispiel weil auf diesem Gerät keine Aufgaben-Datenbank hinterlegt ist. Gibt es noch gar nichts auszuwählen, sagt die Zeile das, statt **Alle** zu behaupten: **Noch keine Kalender**, wenn ein Konto verbunden ist, aber noch keine Kalender angekommen sind — ein Tipp bietet dort **Jetzt aktualisieren** an —, und **Kein Konto verbunden**, solange überhaupt kein Kalenderkonto eingerichtet ist.

## E-Mail

Unter **Einstellungen → E-Mail** verbindest Du ein **Microsoft-Postfach** (Outlook.com, Microsoft 365) direkt über die Anmeldung im Browser — ohne App-Passwort. Wie beim Kalender gilt: Anmelden geschieht pro Gerät.

Danach kannst Du **E-Mail** über das **Bereichs-Blatt** als eigenen Bereich öffnen und in der Navigationsleiste ablegen. Die Zeile unter dem Titel zeigt Ordner, ungelesene Anzahl und Konto und öffnet die Ordnerauswahl. Eine Nachricht öffnest Du per Tipp; **Als Notiz ablegen** legt sie im Ordner **Mail** Deines Vaults ab (zweimal erfassen öffnet dieselbe Notiz). Externe Bilder bleiben blockiert, bis Du sie für die Nachricht freigibst — ein nachgeladenes Bild verrät dem Absender, wann und wo Du gelesen hast. Die vier Aktionen — **Antworten**, **Allen antworten**, **Weiterleiten** und **Als Notiz ablegen** — liegen in einer angedockten Zeile am unteren Rand; solange eine Nachricht offen ist, tritt die Navigationsleiste zurück und gibt ihr den Platz.

**IMAP-Postfächer funktionieren auf dem Telefon ebenfalls.** Leg eines unter **Einstellungen → E-Mail** an: Anbieter wählen, Adresse und App-Passwort eintragen, die Server füllt Plainva aus. Ist Dein Anbieter nicht dabei, trägst Du unter **Erweitert** IMAP- und SMTP-Server, Ports und einen abweichenden Benutzernamen selbst ein; ein bestehendes Konto lässt sich später bearbeiten. Mehrere Nachrichten wählst Du aus, indem Du eine davon gedrückt hältst; danach schaltet ein Tipp weitere hinzu. In der Konversations-Ansicht wählt das ganze Gespräch aus, wer die Konversationszeile hält oder antippt — jede Nachricht darin behält dabei ihren eigenen Ordner, eine Antwort aus **Gesendet** wird also auch dort markiert.

Eine geöffnete Nachricht bietet **Antworten**, **Allen antworten** und **Weiterleiten**. Antworten zitiert das Original unter Deinem Text; „Allen antworten" nimmt zusätzlich die übrigen Empfänger auf und lässt Deine eigene Adresse dabei weg. Beim **Verfassen** hängst Du über **Datei anhängen** eine Datei aus dem Vault an — auf dem Telefon ist der Vault der erreichbare Speicher, und alles, was auf dem Gerät ankommt (ein gespeicherter Anhang, ein eingefügtes Foto), liegt ohnehin dort. Jeder Anhang steht als eigene Zeile mit **Anhang entfernen**, solange die Nachricht noch nicht raus ist.

Schicken musst Du eine begonnene Nachricht nicht: **Als Entwurf** legt sie im Entwurfsordner Deines Kontos ab — also dort, wo jedes Mailprogramm auf diesem Postfach sie findet, nicht in einer Ablage nur auf dem Telefon. Welcher Ordner das ist, sagt der Server; nur wenn er dazu schweigt, wird der Name geraten. In der Liste blenden zwei Schalter neben der Ordnerzeile ein: **Ungelesen** verkleinert das, was gerade geladen ist (der Zähler und **Mehr laden** bleiben also erreichbar), **Markiert** fragt dagegen den Server nach allen markierten Nachrichten des Ordners — auch nach solchen weit unterhalb der geladenen Seite. In **Alle Posteingänge** fehlt der Markiert-Schalter mit Absicht: die Abfrage gilt genau einem Postfach.

Aus einer geöffneten Nachricht führen drei Wege in den Vault: **Als Notiz speichern**, im ⋮-Menü **→ Aufgabe** (legt einen Eintrag in Deiner Standard-Aufgabendatenbank an — mit Vorlage, Status und dem Datum der Mail) und **+ .eml**, das zusätzlich die Originalnachricht sichert und aus der Notiz darauf verlinkt. Alle drei sind verankert: dieselbe Mail zweimal zu erfassen öffnet, was schon da ist. **Löschen** liegt jetzt ebenfalls im ⋮-Menü statt neben dem Zurück-Pfeil; in der Liste genügt ein Wisch. Verschieben in den Papierkorb bietet **Rückgängig** an, weil es umkehrbar ist — endgültiges Löschen aus dem Papierkorb fragt weiterhin nach, weil es das nicht ist. Und statt mehrerer Hinweisbalken übereinander steht jetzt **eine** Zeile: der Fehler, sonst die nicht erreichbaren Konten (ab zwei als Anzahl), sonst der Hinweis auf die gespeicherte Kopie.

Eine Notiz kannst Du aus deren ⋮-Menü verschicken: **Notiz per E-Mail senden (mailto)** übergibt sie der Mail-App des Telefons — dafür braucht Plainva selbst kein Konto —, **Per Mail verschicken** öffnet Plainvas eigenes Verfassen-Fenster mit Betreff und Text.

## Aus einer anderen App importieren

Unter **Einstellungen → Wartung → Aus anderer App importieren** holst Du Notizen aus einer anderen App auf dieses Gerät — mit denselben Quellen wie am Desktop.

Du legst zuerst fest, wohin geschrieben wird: in einen **Unterordner** des geöffneten Vaults oder in einen **neuen Vault** auf diesem Gerät. Der neue Vault ist die richtige Wahl, wenn hier noch nichts liegt; Du vergibst nur einen Namen, und rückgängig machst Du den ganzen Import, indem Du ihn unter **Mehr → Vaults** wieder entfernst.

Quellen, die einen Zugang brauchen — Notion über die API —, fragen im Assistenten nach einem Token. Der gilt für diesen einen Lauf und wird nicht gespeichert.

Die Einzelheiten zu jeder Quelle stehen unter [Aus einer anderen App importieren](Import.md).

## Synchronisation

Die **Einstellungen** (ganz unten unter **Notizen**) führen über **Aktiver Vault** zur Vault-Verwaltung; dort verbindest Du Cloud-Speicher (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Mit Cloud verbinden** holt einen bestehenden Cloud-Vault aufs Gerät; **Neuen Vault erstellen** fragt zuerst **Auf diesem Gerät** oder **Bei einem Online-Dienst** und danach die Startstruktur (leer oder eine Vorlage wie PARA) — beim Online-Weg folgt das Verbinden, der Ziel-Ordner in der Cloud lässt sich im Auswahl-Blatt über **Neuer Ordner** frisch anlegen, und die Struktur wird beim ersten Sync hochgeladen. Dieselbe Wahl zwischen bestehendem und neuem Cloud-Vault bietet auch der erste Start („Mit Cloud verbinden"). Jede Verbindung bekommt einen eigenen, getrennten Vault auf dem Gerät. Die Vault-Seite zeigt Status, Fortschritt, ausstehende Übertragungen und bietet **Vault exportieren** (ZIP über das Teilen-Menü).

Die Vault-Seite ist nach dem geordnet, wofür ihre Schalter da sind: oben eine **Statuskarte**, die die eine Frage beantwortet, mit der man diese Seite öffnet — läuft es? (Zustand, letzter Lauf, ausstehende Übertragungen und Intervall in einer Zeile). Darunter benannte Gruppen — **Verbindung**, **Inhalte** — und ganz unten, durch eine eigene Kante abgesetzt, der **Gefahrenbereich** mit **Sync trennen** und **Vault löschen**. Vorher standen bis zu neun gleich aussehende Knöpfe in einer Reihe, in der **Gelöschte Dateien wiederherstellen** direkt neben **Vault löschen** lag.

Unter **Inhalte** steht neben **Vault exportieren** jetzt auch die **automatische Vault-Sicherung**: einmal täglich ein ZIP des ganzen Vaults, von dem standardmäßig die letzten **sieben** behalten werden (**Aufbewahrte Sicherungen**); **Jetzt sichern** erstellt sofort eines. Die Archive liegen in den Dokumenten des Geräts, nicht im Zwischenspeicher — was das Betriebssystem jederzeit leeren darf, ist kein Archiv. Ein Telefon bekommt keinen Hintergrund-Wecker: geprüft wird beim Öffnen und bei jeder Rückkehr in die App, also holt die Sicherung nach, statt zur Uhrzeit zu laufen. Die Zeile unter dem Schalter nennt deshalb, wann sie zuletzt gelaufen ist — daran erkennst Du eine Sicherung, die still nie stattfindet. Bislang gab es mobil nur den Export von Hand — ein Vault, an dessen Export niemand dachte, hatte damit gar kein Archiv.

Wie oft dieser Vault nach Änderungen der Gegenstelle schaut, legst Du auf derselben Seite fest (**Sync-Intervall**, mindestens 5 Sekunden) — lokale Speicherungen gehen unabhängig davon sofort raus. Bei Google Drive, OneDrive, Dropbox und S3 lässt sich der **Cloud-Ordner** auch nachträglich wechseln; bei WebDAV steckt der Ordner in der Serveradresse, dort verbindest Du stattdessen neu. Ist der Einstellungs-Sync verschlüsselt, kannst Du zusätzlich **Bei jedem Start nach der Passphrase fragen** einschalten: der Schlüssel wird dann nicht auf dem Gerät gespeichert. Und **Sicherheit & Freigaben** sagt jetzt offen, dass verschlüsselte Workspaces experimentell und noch nicht unabhängig geprüft sind — bewahre Wiederherstellungsdatei und -code sicher auf.

Auf der Vault-Seite steht außerdem, ob Deine **Einstellungen** mitreisen — als Karte mit klarem Zustand statt als nackter Knopf:

- **Werden nicht synchronisiert**: Der Einstellungs-Sync ist für diesen Vault aus. Am Desktop schaltest Du ihn ein.
- **Noch nicht verschlüsselt**: Für diesen Vault gibt es noch keine Sync-Passphrase. Du kannst sie jetzt **am Telefon** vergeben: Der Assistent zeigt den Wiederherstellungscode und lässt Dich zwei zufällig gewählte Gruppen daraus zurücktippen, bevor überhaupt etwas geschrieben wird. Liegt in der Cloud bereits eine Passphrase, sagt das Telefon Dir das und legt keine zweite an — sonst würden alle anderen Geräte ausgesperrt.
- **Auf diesem Gerät noch nicht entsperrt**: Die Einstellungen liegen verschlüsselt in der Cloud. Gib die Passphrase ein, die beim Einrichten vergeben wurde — am Desktop oder hier am Telefon; dieses Gerät entsperrt sie damit einmalig.
- **Werden synchronisiert**: Dieses Gerät ist entsperrt; Ordner, Ansichten und Backup-Regeln bleiben mit Deinen anderen Geräten im Gleichschritt.

Jede Karte sagt auch, was *nicht* mitreist: Anmeldungen bleiben immer auf dem Gerät (siehe [Kalender und Termine](#kalender-und-termine)).

**Einstellungen** → **Sicherheit & Freigaben** benennt, was die Verbindung tatsächlich ist — und richtet bei einem normalen Cloud-Vault den verschlüsselten Workspace direkt auf dem Telefon ein (Identität → Wiederherstellungsdatei und Code → Aktivierung). Ohne Cloud-Verbindung gibt es nichts zu verschlüsseln; der Bereich sagt das auch so.

Beide Einrichtungen — der verschlüsselte Workspace und die Sync-Passphrase — laufen jetzt als **eigener Ablauf ohne Navigationsleiste**: solange sie läuft, gibt es genau einen Weg hinaus, und der fragt nach. Das ist kein Zierrat. Bis zum letzten Schritt existiert Dein Schlüssel nur im Arbeitsspeicher, und Verlassen verwirft ihn; vorher konnte ein Tipp auf die Leiste das wortlos tun. Der letzte Schritt zeigt einen Fortschrittsbalken, wenn es etwas zu zählen gibt — beim Workspace wird jede Datei neu verschlüsselt, bei der Sync-Passphrase sind es zwei Schreibvorgänge, und dafür eine Prozentzahl zu erfinden wäre eine Lüge in Balkenform.

**Freigaben verwaltest Du jetzt hier**, nicht mehr nur am Desktop: unter **Personen & Rechte** lädst Du ein Mitglied mit einer Rolle ein (**Einladen** legt es an — sein Gerät koppelst Du danach), legst eine Gruppe an und änderst die Rolle einer Gruppe direkt in ihrer Zeile. Unter **Slices** erstellst Du eine Freigabe für einen **Ordner**. Bewusst nicht auf dem Telefon: Slices aus einer freien Auswahl oder einer dynamischen Regel — beide bräuchten Flächen, die es hier nicht gibt.

## Sicherheitsnetz

Snapshots (Versionsverlauf), ein Entwurfs-Journal (nach einem Absturz bietet die Notiz den letzten ungespeicherten Stand an) und Konflikt-Kopien mit Vergleichsansicht schützen Deine Daten. Die Aufbewahrung stellst Du unter **Einstellungen** → **Backup & Versionierung** ein.

**Ändert jemand dieselbe Notiz woanders**, während Du hier tippst, sichert Plainva Deine Fassung als Kopie daneben und übernimmt die eingetroffene. Das steht jetzt **an der Notiz** und bleibt dort, bis Du es auflöst: ein Hinweis über dem Text nennt den Pfad der Kopie, öffnet sie und zeigt auf Wunsch die **Unterschiede**. Vorher war das ein Hinweis, der nach Sekunden verschwand — und der Speicherversuch lief weiter, sodass bei jedem Anlauf eine weitere Kopie entstand. Es entsteht jetzt genau eine.

**Beim Löschen eines Ordners** nennt die Rückfrage, wie viele Dateien darin liegen — die Zahl steht auch auf dem Knopf. Plainva legt vorher von jeder Datei darin einen Snapshot an, den Du unter **Einstellungen** → **Wartung** → **Gelöschte Dateien wiederherstellen** zurückholen kannst. Eine Grenze nennt der Dialog offen: **gesichert werden kann nur, was dieses Telefon schon einmal geschrieben hat.** Eine Notiz, die nur per Synchronisation angekommen und hier nie bearbeitet wurde, liegt in keinem Snapshot. Anders als am Desktop gibt es auf dem Telefon keinen Papierkorb des Systems, der das auffangen würde. Betrifft die Löschung mehr als zehn Dateien oder mehr als ein Fünftel des Vaults, fragt Plainva ein zweites Mal — genau wie am Desktop.

## Teilen und Verknüpfungen

Auf Android und iOS landen geteilter Text und URLs als neue Notiz im Eingangsordner; geteilte Bilder und Dateien werden als Anhänge übernommen (maximal 25 MB pro Datei). Auf Android bietet das gedrückt gehaltene App-Symbol zusätzlich **Neue Notiz** und **Heute**.

## Ordner, Fotos und Kalender

Der schwebende **Plus**-Knopf bleibt auch in verschachtelten Ordnern verfügbar; alle Schnellaktionen erstellen im aktuell geöffneten Ordner — auch neue Ordner. Das ⋮ im Kopf gehört dagegen dem geöffneten Objekt: es zeigt dessen Aktionen, nie die App-Einstellungen.

Der Foto-Knopf im Editor fragt **Foto aufnehmen** oder **Aus Mediathek wählen**, behält die Einfügeposition und meldet Berechtigungs- oder Dateifehler sichtbar. Fotos landen im Anhänge-Ordner des Vaults — demselben, den auch Dein Rechner benutzt.

Termine und Tagesnotizen sind bewusst getrennt: **Kalender** zeigt die verbundenen Kalender (siehe [Kalender und Termine](#kalender-und-termine)), **Heute** die Tagesnotiz eines gewählten Tages. Eine lokale Monatsansicht der Tagesnotizen gibt es nicht — der Streifen in **Heute** übernimmt das.

## Anhänge und Bilder

Der Navigator zeigt neben Notizen und Datenbanken auch **Anhänge** — Bilder, PDFs, alles, was sonst im Ordner liegt. Ein Bild öffnet sich in Plainva; alles andere reicht die App an das System weiter, das mit einem PDF umgehen kann und Plainva nicht. Über **Teilen** geht eine Datei an jede andere App.

Im ⋮-Menü einer Notiz steht **Als Markdown exportieren…**: Das übergibt die Datei selbst an das Teilen-Blatt des Systems — dort findest Du Drucken, „In Dateien sichern“ und jeden installierten Editor. **Teilen** darüber verschickt dagegen nur den Text der Notiz.

## Wischen

Eine Zeile **nach links wischen** legt ihre Aktionen frei: bei einer Notiz **Lesezeichen** und **Löschen**, bei einem Ordner **Umbenennen** und **Ordner löschen**, bei einer Datenbank und im Postfach **Löschen**. Es sind dieselben Aktionen, die die Zeile im Menü anbietet (langer Druck) — der Wisch ist der kürzere Weg dorthin, nie der einzige. Beim ersten Mal sagt Dir das eine Zeile über der Liste, die Du wegtippst; sie erscheint je Vault genau einmal.

Löschen fragt durch denselben Dialog nach wie überall sonst. Solange Du mehrere Zeilen auswählst, ist das Wischen abgeschaltet — eine Geste, die genau eine Zeile meint, hat neben einer Auswahl, die Du gerade erst zusammenstellst, keine eindeutige Bedeutung. Sind im Postfach **Konversationen** eingeschaltet, meint ein Wisch auf einem Gespräch das **ganze** Gespräch (statt eines Rückgängig nennt es Dir danach, wie viele Nachrichten es waren); eine aufgeklappte Einzelnachricht wischst Du weiterhin einzeln. Aufgabenzeilen haben keine Wischaktionen — sie tragen ihre Bedienelemente sichtbar auf der Zeile.

## Auf breiten Bildschirmen

Die App richtet sich nach der Fensterbreite, nicht nach dem Gerätenamen:

- **unter 600 px** — eine Fläche nach der anderen, wie auf dem Telefon.
- **600 bis 839 px** — die Navigationsleiste wird zur **Leiste am Rand**; es bleibt bei einer Fläche.
- **ab 840 px** — Navigator und Arbeitsfläche stehen **nebeneinander**. Es ist derselbe Navigator wie im Bereich **Notizen**, nur neben Deiner Arbeit statt davor.

**Die Leiste am Rand zeigt alle Bereiche.** Auf dem Telefon fasst die untere Leiste drei bis fünf Ziele — mehr trifft ein Daumen nicht zuverlässig, deshalb liegen die übrigen hinter **Bereiche**. Am Rand einer breiten Fläche gilt diese Grenze nicht: dort steht die **ganze** Liste in Deiner Reihenfolge (**Einstellungen → Navigationsleiste**), der Umweg über **Bereiche** entfällt, und ganz unten sitzen die **Einstellungen**. Die Leiste beginnt unter der Statusleiste — auf einem Tablet mit Kamera-Aussparung lag ihr erstes Symbol vorher darunter.

**Den Navigator kannst Du wegklappen.** Solange Du eine Notiz suchst, gehört ihm die linke Spalte; solange Du eine schreibst, gehört sie der Notiz. Das Symbol unten in der Leiste — direkt über den **Einstellungen** — klappt ihn weg und wieder hervor; die Arbeitsfläche nimmt dann die ganze Breite ein. Der Schalter erscheint nur dort, wo es überhaupt eine zweite Spalte gibt (ab 840 px), gilt für dieses Gerät und bleibt über einen Neustart hinweg so, wie Du ihn gelassen hast. Am Desktop ist es derselbe Handgriff — dort heißt er **Linke Seitenleiste umschalten**.

Auf einem Tablet oder einem gedrehten großen Telefon bekommst Du damit dasselbe Raummodell wie am Desktop — links navigieren, in der Mitte arbeiten — statt eines vergrößerten Telefons.


## Datenbanken im Kalender

Über den Kalenderansichten steht eine Reihe von Chips: jede `.base`-Ansicht vom Typ **Kalender** oder **Zeitachse** mit benanntem Datumsfeld lässt sich dort einblenden. Eingeblendete Einträge erscheinen in Tages- und Agenda-Liste zwischen den Terminen — mit **Raute und gestrichelter Kante**, damit eine Notiz nie wie ein Termin aussieht; im Monatsraster als **hohler Punkt**. Ein Tipp öffnet die Notiz.

**Die Auswahl gehört zum Vault**, nicht zum Gerät: Was Du am Rechner einblendest, findest Du hier vor, sobald die Einstellungs-Synchronisation gelaufen ist. Terminieren geht am Telefon über das Blatt des Eintrags — Ziehen bleibt dem Rechner vorbehalten.

Umgekehrt zeigt die Kalenderansicht einer Datenbank auf Wunsch die **Zahl der echten Termine** eines Tages in der Ecke der Zelle — Du siehst, wogegen Du planst.
