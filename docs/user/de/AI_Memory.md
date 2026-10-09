# Gedächtnis (Beta)

Stand: 2026-10-09

Das Gedächtnis hält fest, was die KI über Dich und Deine Arbeit wissen soll, ohne dass Du es wieder sagst: was Du machst, wie Du Antworten magst, wer Deine Kunden sind. Es sind zwei Dateien in Deinem Vault. Nichts kommt ohne Dein Ja hinein, und Du kannst jeden Eintrag lesen, ändern und löschen.

## Zwei Orte

**Immer dabei** geht in jedes neue Gespräch. Halte es knapp: Es hat Platz für 2.000 Zeichen, und ein Balken zeigt, wie voll es ist. Ein Eintrag, der nicht mehr hineinpasst, trägt die Marke **Kein Platz mehr — wird nicht mitgegeben** — er ist gespeichert, wird aber nicht mitgeschickt. Mitgegeben werden die Einträge in der Reihenfolge, in der sie stehen; das Wichtigste gehört also nach oben, und die Reihenfolge änderst Du in der Datei.

**Zum Nachschlagen** wird nicht mitgeschickt. Hängt eine Frage vielleicht an etwas, das Du der KI früher gesagt hast, sieht sie dort nach, und das Gespräch zeigt **Schlägt im Gedächtnis nach**. Das ist der Ort für alles, was nur manchmal zählt: die Konditionen eines Kunden, eine Entscheidung und ihr Grund.

## Das Gedächtnis öffnen

Am Desktop wählst Du im KI-Tab **Gedächtnis**, neben **Skills**. Am Telefon ist es **Gespräche → Gedächtnis**. Auch **Einstellungen → KI & Automatisierung** (Teil Vault) führt dorthin: **Gedächtnis öffnen** unter **Skills und Gedächtnis**.

## Selbst einen Eintrag anlegen

**Neuer Eintrag** fragt nach drei Dingen: dem Text — eine Sache je Eintrag, eine einzige Zeile mit höchstens 500 Zeichen —, dem Ort (**Immer dabei** oder **Zum Nachschlagen**) und ob er für **Nur Modelle auf diesem Gerät** gedacht ist. Setze den Haken bei allem, was kein Cloud-Modell erfahren soll.

Der Knopf ⋯ an einem Eintrag — am Telefon ein Tipp auf den Eintrag — bietet **Bearbeiten**, das Verschieben an den anderen Ort (**Immer mitgeben** oder **Nur noch nachschlagen**) und **Löschen**.

## Die KI etwas merken lassen

Sag es im Gespräch: „Merk Dir, dass ich nach Tagen abrechne, nicht nach Stunden.“ Die KI entwirft einen Eintrag; sie schreibt nie selbst einen. Unter ihrer Antwort zeigt eine Karte **Entwurf · Gedächtnis-Eintrag** den ganzen Text. Wähle den Ort, dann **Merken** — oder **Verwerfen**. Ein Entwurf, über den Du noch nicht entschieden hast, wartet unter **Offen**, und das Gedächtnis sagt, wie viele warten.

„Vergiss, dass …“ geht genauso: Die Karte heißt **Entwurf · Aus dem Gedächtnis entfernen**, und **Entfernen** nimmt den Eintrag heraus. Sagst Du der KI, dass sich etwas geändert hat, zeigt die Karte unter **Ersetzt**, an wessen Stelle der neue Wortlaut tritt.

## Eine Regel ist kein Gedächtnis

„Antworte immer auf Deutsch“ ist nichts zu wissen — es ist etwas zu tun. So eine Regel kommt nicht ins Gedächtnis: Sie wird eine Zeile der **Anweisungen des Vaults** (`AGENTS.md`), die jedes Modell als Anweisung bekommt. Lege eine über **Regel hinzufügen** unter **Regeln für die KI** an oder bitte die KI darum; ihre Karte heißt dann **Entwurf · Regel für die KI**, mit dem Knopf **Als Regel eintragen**.

Wie alle Anweisungen muss die Datei auf jedem Gerät freigegeben sein, bevor sie dort gilt (siehe [Skills](AI_Skills.md)). Eine Regel, die Du auf einem Gerät hinzufügst, auf dem die Datei schon freigegeben war, gilt dort sofort; Deine anderen Geräte fragen Dich vorher.

## Datenschutz

- Ein Eintrag kann eine eigene Regel tragen: **Nicht an Cloud-Modelle**, **Nicht in Gesprächen mit Internet**. Ein Modell auf diesem Gerät bekommt jeden Eintrag.
- Ein Eintrag, den die KI in einem Gespräch entworfen hat, das Notizen unter einer Datenschutzregel gelesen hat, bekommt dieselben Regeln — die Karte sagt **Der Eintrag bekommt die Datenschutzregeln der Notizen, auf denen dieses Gespräch beruhte.** Was aus einer Notiz stammt, die auf diesem Gerät bleiben muss, erreicht über das Gedächtnis keine Cloud.
- Deine [Datenschutzregeln](AI_Assistant.md) gelten auch für die beiden Dateien: Eine Ordnerregel für `.agent/` hält das ganze Gedächtnis von der Cloud fern.
- Die Sendeübersicht hat eine Zeile **Gedächtnis** — wie viele Einträge mitgehen — und zählt die Einträge, die Deine Regeln zurückhalten, unter **Zurückgehalten**. Sie nennt nie einen Eintrag.
- Für die KI ist ein Eintrag eine Auskunft, keine Anweisung: Ein Satz im Gedächtnis gibt ihr keine Rechte.
- Ein Gespräch behält das Gedächtnis, mit dem es begonnen hat. Ein Eintrag, den Du löschst, geht in kein neues Gespräch mehr; Gespräche, die schon begonnen haben, behalten, was sie bekommen haben.

## Ausschalten

**Gedächtnis auf diesem Gerät nutzen** ist an, bis Du es ausschaltest. Ist es aus, erfährt ein Gespräch auf diesem Gerät nichts aus dem Gedächtnis und trägt nichts hinein. Die Dateien bleiben, wie sie sind, und jedes Gerät entscheidet für sich.

## Die beiden Dateien

`.agent/active_memory.md` (immer dabei) und `.agent/MEMORY.md` (zum Nachschlagen) sind schlichtes Markdown. Jeder Eintrag ist ein Listenpunkt, und Überschriften gruppieren die Einträge. Was Plainva über einen Eintrag weiß, steht in einem Kommentar dahinter:

```markdown
## Clients

- Harbour Studio pays within 14 days.
- I bill per day, not per hour. <!-- plainva: added=2026-10-09; by=assistant; source=Offer for Harbour Studio; deny=cloud -->
```

`added` und `by` sagen, wann der Eintrag hinzukam und ob Du ihn geschrieben oder einen Entwurf angenommen hast, `source` nennt das Gespräch, aus dem ein Entwurf stammt, und `deny` hält seine Regeln (`cloud`, `web`). Du kannst die Dateien in jedem Editor bearbeiten. In Plainva öffnet **Datei öffnen** jede der beiden.

Plainva rät nicht. Ein Eintrag, dessen Kommentar beschädigt ist, trägt die Marke **Regeln nicht lesbar — geht an kein Modell**, bis Du den Kommentar reparierst oder den Eintrag neu anlegst. Text, der in einem Kommentar oder in unsichtbaren Zeichen versteckt ist, wird nie mitgeschickt; der Eintrag zeigt dann, wie viele versteckte Stellen weggelassen wurden. Eine Datei fasst höchstens 2.000 Einträge und 256 KB.
