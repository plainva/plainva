# Graph

Stand: 2026-07-10

Plainvas Graph ist kein Poster, sondern ein Arbeitswerkzeug: Er zeigt Dir, wo Du bist, was zusammenhängt, was fehlt — und Du kannst direkt darin arbeiten. Es gibt EINE Graph-Engine mit drei Erscheinungsformen.

## Kontext-Graph (rechte Seitenleiste)

Öffne in der rechten Seitenleiste die Sektion **Graph**. Sie zeigt die aktive Notiz in der Mitte, die Ordner-Struktur oben, bei Ordner-Übersichten (index.md) die enthaltenen Notizen unten, eingehende Verweise links und ausgehende rechts. Relationen aus Datenbanken tragen ihren Eigenschaftsnamen als Beschriftung.

- Klick auf einen Knoten öffnet die Notiz (der Fokus wandert mit).
- Strg/Cmd+Klick öffnet im Split, Mittelklick in einem neuen Tab.
- Ziehst Du einen Knoten an eine andere Stelle, bleibt er dort (kleiner Punkt) und wird pro Notiz gemerkt — beim nächsten Öffnen dieser Notiz findest Du Deine Anordnung wieder. Die aktive Notiz bleibt in der Mitte. Die **Pin-Nadel** oben rechts schaltet das Merken an und aus; schaltest Du es aus, wird die gemerkte Anordnung dieser Notiz verworfen.
- Darunter erscheinen bis zu drei **Vorschläge**: Notizen, die Deine aktive Notiz erwähnen (aber nicht verlinken), oft gemeinsam verlinkt werden, eine ähnliche Nachbarschaft haben oder einen seltenen Tag teilen. Kommt der Titel als Text in der betroffenen Notiz vor, zeigt der Vorschlag eine **Vorschau der Textstelle**, die verlinkt würde; **Verlinken** verwandelt genau diese Stelle in einen Wiki-Link (als `[[Ziel|Text]]`, wenn der sichtbare Text vom Ziel abweicht). Gibt es keine passende Stelle, wird der Link am Ende der Notiz angehängt (die Vorschau weist darauf hin). **Vorschlag verwerfen** merkt sich die Entscheidung.

## Vault-Karte (eigener Tab)

Öffne die Karte mit **Strg/Cmd+Umschalt+G**, über das Graph-Symbol in der **Aktionsleiste** ganz links oder über die Befehls-Palette (**Graph öffnen**). Sie öffnet sich in einem eigenen Tab. Statt eines Wollknäuels siehst Du Deine echte Ordnerstruktur als Blasen — ein Doppelklick auf eine Blase entfaltet ihre Notizen, **Alle Ordner einklappen** kehrt zurück. Das Layout ist deterministisch: Dieselbe Karte sieht bei jedem Öffnen gleich aus. **Verschiebe die Karte** mit der mittleren Maustaste oder Strg/Cmd+Ziehen, **zoome** mit dem Mausrad. Verschiebst Du einen Knoten, bleibt er gepinnt (kleiner Punkt). Oben rechts schaltet die **Pin-Nadel** das Merken an und aus: Schaltest Du es aus, wird die gemerkte Anordnung dieser Ansicht verworfen und das automatische Layout kehrt zurück (dasselbe bewirkt **Layout zurücksetzen** im Rechtsklickmenü). Pins werden pro Gerät gespeichert.

Werkzeuge in der Kopfleiste:

- Kantenstile auf einen Blick (Legende unten links): **Relationen** sind durchgezogene Akzent-Linien mit Beschriftung, **Links** gestrichelt, **Embeds** gepunktet.
- **Suchen** dimmt alles, was nicht passt. Filter nach **Typ** (OKF) und **Tag**; Kantenarten (**Links**, **Relationen**, **Embeds**) sind einzeln zuschaltbar.
- **Fokus auf Auswahl** reduziert die Karte auf eine gewählte Notiz plus 1–3 Nachbarschafts-Sprünge.
- **Heatmap** hellt zuletzt bearbeitete Notizen auf (7/30/90 Tage) — „Woran habe ich zuletzt gearbeitet?"
- **Zeitreise** blendet Notizen nach ihrem Entstehungsdatum ein; der Schieberegler spielt das Wachstum Deines Vaults ab. Das Datum stammt aus einer `date`-/`datum`-Eigenschaft, sonst aus dem Datei-Erstelldatum (bei reinen Cloud-Vaults eine Näherung).

Arbeiten auf der Karte:

- Ziehe einen Knoten **auf** einen anderen: Plainva bietet an, einen Text-Link zu schreiben — oder direkt eine passende **Relation** aus Deinen Datenbanken (erlaubt die Relation genau einen Eintrag, fragt Plainva vor dem Ersetzen).
- Rechtsklick auf einen Knoten: Öffnen, Peek, Im Split öffnen, **Neue verbundene Notiz**, Umbenennen (mit vault-weitem Link-Update), Lesezeichen, Löschen.
- Rechtsklick auf freie Fläche: **Neue Notiz**, Layout zurücksetzen, **Als PNG/SVG exportieren**.
- Klick auf ein Kanten-Bündel zwischen Ordnern listet die einzelnen Verknüpfungen; beim Überfahren einer Kante zeigt ein Tooltip den Satz, in dem der Link steht.
- **Ziehen auf freier Fläche** spannt ein Auswahlrechteck auf und markiert mehrere Notizen (Umschalt+Ziehen erweitert eine bestehende Auswahl); ziehst Du danach einen der markierten Knoten, verschieben sich alle gemeinsam. Die Fußzeile bietet Lesezeichen/Löschen für die Auswahl.

## Aufräumen

Der Knopf **Aufräumen** öffnet eine Arbeitsliste mit drei Reitern: **Waisen** (Notizen ohne Verbindungen), **Kaputte Links** (Ziele, die es nicht gibt — **Notiz erstellen** legt sie an) und **Erwähnungen** (**Vault scannen** findet Stellen, an denen eine Notiz beim Namen genannt, aber nicht verlinkt ist; **Verlinken** macht aus der Fundstelle einen Wiki-Link). Die Fußzeile der Karte zeigt die Waisen-Zahl — ein Klick darauf öffnet das Panel.

## Graph als Datenbank-Ansicht

Jede `.base`-Datenbank kann eine **Graph**-Ansicht bekommen (Ansicht hinzufügen → **Graph**): Die Zeilen der Datenbank werden zu Knoten, Deine **Relationen** zu beschrifteten Kanten. In der Kopfleiste wählst Du die Kanten-Eigenschaften, **Farbe nach** einer Auswahl-Eigenschaft, **Größe nach** einer Zahl und ob **externe Ziele** (Relationen aus der Datenbank hinaus) oder **eingehende Relationen** (Relationen aus anderen Datenbanken, die auf diese Einträge zeigen — z. B. die Aufgaben eines Projekts) erscheinen. Die Ansicht wird Obsidian-kompatibel gespeichert — Obsidian zeigt dieselbe Datei als Tabelle.

## Grenzen

- Der Graph zeigt Notizen (Dateien), keine einzelnen Absätze.
- Pins und verworfene Vorschläge liegen unter `.plainva/` und wandern nicht mit dem Sync — das Grund-Layout ist auf jedem Gerät identisch.
- Vorschläge sind reine Vault-Analysen; nichts verlässt Deinen Rechner.
