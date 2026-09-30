# KI-Assistent (Beta)

Stand: 2026-09-30

Plainva kann Fragen zu Deinen Notizen mit einem KI-Modell Deiner Wahl beantworten. Es liest Deinen Vault, nennt die Notizen, auf die es sich stützt, öffnet Notizen und Ansichten für Dich und schlägt Änderungen an einer markierten Stelle als Vorschläge vor — eine Notiz ändert es nie selbst. Der Assistent ist **experimentell** und aus, bis Du ihn einschaltest, auf jedem Gerät für sich.

## Einschalten

Öffne **Einstellungen → KI & Automatisierung** (den App-Teil) und schalte **KI auf diesem Gerät nutzen** ein. Ohne den Schalter gibt es weder den KI-Knopf noch den KI-Tab oder den Begleiter. Gesendet wird erst etwas, wenn Du fragst.

## Einen Anbieter wählen

Plainva bringt keinen eigenen KI-Dienst mit: Du nutzt einen Anbieter Deiner Wahl, mit Deinem eigenen Schlüssel. Jeder Anbieter ist wählbar; Plainva nennt Bedingungen und Aufbewahrung, damit Du entscheidest — es schließt keinen aus.

| Art | Anbieter |
|---|---|
| Cloud-Anbieter | Anthropic, OpenAI, Google Gemini |
| Vermittler und eigene Server | OpenRouter, jeder **OpenAI-kompatibler Server** |
| Auf diesem Rechner (Desktop) | Ollama, LM Studio |

1. Wähle in **KI & Automatisierung** **Anbieter hinzufügen** und einen Anbieter. Jeder Eintrag trägt einen kurzen Hinweis zu seinen Bedingungen — etwa, dass im kostenlosen Zugang von Google Menschen Deine Eingaben lesen dürfen.
2. Gib den Schlüssel mit **Schlüssel eingeben** ein. Er geht in den sicheren Speicher dieses Geräts; Plainva zeigt ihn nie wieder an — weder der KI noch auf dem Bildschirm.
3. **Verbindung testen** lädt die eigene Modellliste des Anbieters. Schlägt der Test fehl, sagt die Meldung warum (ein abgelehnter Schlüssel, keine Verbindung, ein unbekanntes Modell).

Einen **OpenAI-kompatiblen Server** fügst Du über seine Adresse hinzu. Plainva fragt vor dem Hinzufügen noch einmal nach, in einem Fenster des Betriebssystems, und sendet nur an die Adresse, die Du bestätigt hast. Unverschlüsseltes `http` geht nur für einen Server auf diesem Gerät; alles andere braucht `https`.

Wenn Du noch keinen Schlüssel hast: ein Modell auf diesem Rechner (Ollama, LM Studio) kostet nichts, und die Konsole jedes Anbieters gibt Schlüssel aus.

## Modelle und Profile

Vier Profile — **Schnell**, **Ausgewogen**, **Stark** und **Lokal** — sind Deine Zuordnung von Modellen. Wähle für jedes einen Anbieter und ein Modell, aus der Liste des Anbieters oder indem Du die Modellkennung genau so eingibst, wie der Anbieter sie nennt. **Standard für neue Gespräche** legt fest, mit welchem Profil ein neues Gespräch beginnt. Plainva erklärt kein Modell zum „besten“.

Ein fünfter Platz, **Audio**, hält das Modell, das Sprachnotizen transkribiert; er ist nie der Standard für ein Gespräch.

Ein sechster Platz, **Einbettungen**, hält das Modell, mit dem die Suche nach Bedeutung rechnet, wenn Du unter **Semantische Suche** **Eigener Anbieter** wählst — siehe [Suche](Search.md).

## Fragen

- **Desktop:** der KI-Knopf in der Aktionsleiste, **Strg+J** (⌘J unter macOS) oder **KI fragen** in der Befehlspalette öffnet den Begleiter — ein kleines Fenster über Deiner Arbeit. **Als Tab öffnen** holt dasselbe Gespräch in den KI-Tab, wo Deine Gespräche aufgelistet sind.
- **Telefon:** **KI fragen** im ⋮-Menü einer Notiz öffnet das KI-Blatt über dieser Notiz. Der Bereich **KI** (im Bereiche-Blatt oder in der Navigationsleiste, wenn Du ihn dort hinlegst) zeigt das Gespräch im Vollbild; **Gespräche** listet die früheren.
- **Neben der Notiz:** am Desktop ist dasselbe Gespräch die letzte Sektion der rechten Seitenleiste, **KI**. Am Telefon oder Tablet ist es der Reiter **KI** im Kontext der Notiz — neben **Eigenschaften** und **Backlinks** —, den ein Tablet neben der Notiz zeigt.

Die Notiz, die Du offen hast, geht automatisch mit; nimm sie mit ihrem ✕ aus dem Kontext, wenn Du willst. **Notiz anheften …** fügt weitere Notizen hinzu. Der Assistent kann auch selbst nachsehen: er durchsucht den Vault, liest Notizen und ihre Abschnitte, Datenbanken, Backlinks und verlinkte Notizen, listet Aufgaben, Termine und die zuletzt geöffneten oder geänderten Notizen und öffnet Notizen und Ansichten. Ändern, anlegen oder löschen kann er nichts.

Jedes Gespräch beginnt mit der Zeile „Antworten schreibt eine KI — ⟨Modell⟩ über ⟨Anbieter⟩“. Unter jeder Antwort steht, was wohin gesendet wurde: wie viele Notizen, ungefähr wie viele Token und — wo der Anbieter Preise veröffentlicht — die ungefähren Kosten. **Stopp** beendet eine Antwort jederzeit.

Ein Link in einer Antwort öffnet sich erst, nachdem Du seine Adresse bestätigt hast, und Bilder in Antworten werden nie geladen.

## Was mitgeht

Zu jeder Frage stellt Plainva zusammen, was wichtig sein kann — auf diesem Gerät, bevor etwas gesendet wird:

- **Wo Du gerade bist:** Datum und Uhrzeit, die offene Notiz oder Datenbank und Deine Auswahl darin, Deine offenen Tabs, in der kommenden Woche fällige Aufgaben, die nächsten Termine und die heutige Tagesnotiz.
- **Notizen, die wichtig sein können:** gefunden über Deine Worte, die Links der offenen Notiz und was Du zuletzt geöffnet oder geändert hast. Zuerst entscheiden Deine Datenschutzregeln; bewertet werden überhaupt nur die Notizen, die sie erlauben. Einige gehen als Abschnitte mit — nicht als ganze Notizen —, andere nur mit Titel und Suchauszug oder allein mit ihrem Namen; mehr davon liest der Assistent, wenn er es braucht.

Eine Notiz, die das Gespräch schon trägt und die sich seitdem nicht geändert hat, wird genannt, nicht noch einmal gesendet. Ortsangaben aus Deinem Journal und Stimmungswerte werden nie von selbst gesendet.

## Bevor etwas gesendet wird

Die erste Anfrage einer Sitzung zeigt eine Übersicht: wohin sie geht (Anbieter und Modell), welche Notizen und welcher Teil davon, was außerdem mitgeht (Deine Auswahl, Termine, Aufgaben), was zurückgehalten wurde und ungefähr wie viele Token. **Senden** sendet; **Abbrechen** sendet nichts und gibt Dir Deine Worte ins Eingabefeld zurück; das − neben einer Notiz lässt sie weg. Innerhalb dessen, was Du freigegeben hast, gehen die nächsten Anfragen ohne Rückfrage. Die Übersicht kommt wieder, sobald der Umfang wächst: ein anderes Modell oder ein anderer Anbieter, eine neue Art von Daten, Notizen aus einem weiteren Ordner, neue Werkzeuge oder eine deutlich größere Anfrage. Ein Modell auf diesem Gerät fragt nie.

Wenn Du die Übersicht vor jeder Anfrage sehen willst, schalte **Vor jeder Anfrage fragen** ein — in der Übersicht selbst oder unter **Einstellungen → KI & Automatisierung** bei **Senden**.

Die Zeile unter jeder Antwort öffnet die Übersicht dessen, was mit ihr ging. Nennt eine Antwort keine der gesendeten Notizen, sagt ein Hinweis über dieser Zeile das; prüfe die Antwort dann an den Notizen.

## Kontext einsehen

Das Auge unter dem Eingabefeld, **Kontext einsehen**, zeigt, was die nächste Anfrage mitnähme — bevor sie geht, für das gerade gewählte Modell. Zu jeder Notiz: warum sie gewählt wurde (gerade offen, angeheftet, passt zu Deinen Worten, verlinkt, bald fällig …), welcher Teil mitgeht und ungefähr wie viele Token. Jede Notiz kannst Du

- aus der nächsten Anfrage weglassen (**Wieder aufnehmen** holt sie zurück),
- ans Gespräch heften,
- dauerhaft auf diesem Gerät behalten: das schreibt die Regel `cloud: deny` in die Notiz (siehe unten).

Notizen, die Deine Regeln zurückhalten, stehen ebenfalls da, damit Du weißt, was fehlt; sie werden nie bewertet und nie gesendet. **Mit diesem Kontext senden** sendet, was Du geschrieben hast. In einem breiten KI-Tab bleibt die Ansicht als Spalte neben dem Gespräch offen.

## Mit einer Auswahl

Markiere Text in einer Notiz, und die KI arbeitet nur mit dieser Stelle.

- **Desktop:** beim Bearbeiten bietet **KI** in der Auswahlleiste **Als Vorschlag** — **Umschreiben**, **Kürzen**, **Übersetzen …**, **Aufgaben daraus** — und **Im Begleiter** — **Erklären** und **Frage zur Auswahl …** (**Strg+J**, ⌘J unter macOS).
- **Telefon:** **KI** in der Leiste über einer Auswahl — beim Lesen wie beim Bearbeiten — öffnet das KI-Blatt.
- **In jedem Gespräch:** solange in der offenen Notiz Text markiert ist, bietet die Zeile **Mit der Auswahl** über der Eingabe dieselben Aktionen.

Eine Vorschlags-Aktion sendet nur die markierte Stelle — nicht den Rest der Notiz, keine angehefteten Notizen, keine Werkzeuge — und fragt mit derselben Übersicht wie eine Frage. Die Antwort kommt als Vorschlagsrunde in die Notiz, wie die eines Menschen: unter **Vorschläge** übernimmst oder lehnst Du jede Änderung einzeln oder die ganze Runde ab, und vorher ändert sich nichts in der Notiz. Die Autorzeile der Runde lautet **Plainva KI · ⟨Modell⟩**, damit sichtbar bleibt, welche Stelle eine KI geschrieben hat. **Aufgaben daraus** fügt die Aufgaben unter der Stelle ein, statt sie zu ersetzen. Jede Aktion behält ihr Gespräch im Verlauf.

Eine Stelle aus einer Notiz, die Deine Regeln von der Cloud fernhalten — oder eine mit Links auf solche Notizen oder mit Ortsangaben —, geht an kein Cloud-Modell. In einem verschlüsselten Workspace gibt es die Vorschlags-Aktionen noch nicht: seine Vorschläge können die KI noch nicht als Autor nennen.

## Skills

Drei Skills starten häufige Fragen mit einem Klick: **Tagesorientierung** (was heute wichtig ist — fällige Aufgaben, Termine und woran Du zuletzt gearbeitet hast), **Wochenrückblick** (die letzten sieben Tage und die Woche, die kommt) und **Projektstatus** (Ziel, Fortschritt, offene Punkte und der nächste Schritt des Projekts in der offenen Notiz). Du findest sie als Chips in einem leeren Gespräch, unter **Skills** im KI-Tab — am Telefon in **Gespräche** — und in der Befehlspalette. Ein Skill sendet seine Frage als Deine Nachricht: in Deiner Sprache, im Gespräch sichtbar wie alles, was Du tippst, und über dieselbe Übersicht. Der Assistent sucht dann mit seinen üblichen Werkzeugen nach.

## Eine Sprachnotiz transkribieren

An jeder Sprachnotiz — im Editor, im Lesemodus, im Journal und auf Karten — macht **Transkribieren** aus der Aufnahme Text. Sie geht unverändert an das Modell des Profils **Audio**, über dieselbe Übersicht wie eine Frage; eine Aufnahme ist eine eigene Art von Daten, deshalb fragt die Übersicht beim ersten Mal. Das Transkript kommt als Vorschlag unter die Aufnahme, mit dem Autor **Plainva KI · ⟨Modell⟩** — unter **Vorschläge** übernimmst oder lehnst Du es ab.

**Audio** braucht einen Anbieter mit Audio-Weg: OpenAI (etwa `gpt-4o-transcribe` oder `whisper-1`), Gemini oder einen eigenen kompatiblen Server — einer auf diesem Rechner behält die Aufnahme auf dem Gerät. Aufnahmen bis 11 MB lassen sich transkribieren. Eine Aufnahme in einer Notiz, die Deine Regeln von der Cloud fernhalten, geht an kein Cloud-Modell, und verschlüsselte Workspaces bieten es noch nicht an.

## Datenschutzregeln

Manche Notizen sollen nie zu einem Cloud-Anbieter. Eine Regel kann im Frontmatter einer Notiz stehen:

```yaml
plainva:
  ai:
    cloud: deny
```

oder, für einen ganzen Ordner, in **Einstellungen → KI & Automatisierung** (dem Vault-Teil), das die Regeln in `.agent/policy.yml` schreibt. Eine von der Cloud ferngehaltene Notiz trägt nichts bei — weder Text noch Titel —, und Links auf sie in anderen Notizen werden zurückgehalten. Modelle auf diesem Gerät bleiben erlaubt. Verschlüsselte Workspaces halten die Cloud aus, solange Du sie dort nicht erlaubst. Das genaue Format steht in der [Dateiformat-Referenz](File_Format_Reference.md).

## Verlauf und Verbrauch

Gespräche bleiben auf diesem Gerät, je Vault — nie im Vault und nie synchronisiert. **Gespräche aufbewahren** legt fest, wie lange; einzelne Gespräche löschst Du in der Liste, alle eines Vaults auf einmal in den Einstellungen. **Verbrauch diesen Monat** fasst die Token je Anbieter und Modell zusammen.

## Grenzen der Beta

- Am Desktop läuft die KI nur im Hauptfenster.
- Am Telefon kommt eine Antwort nur, solange die App geöffnet ist.
- Der Assistent ändert nichts selbst: Änderungen an einer markierten Stelle und Transkripte von Sprachnotizen schlägt er vor, als Vorschläge, die Du übernimmst oder ablehnst.

Rückmeldungen zur Beta gehen in die Diskussionen des Projekts auf GitHub: **Rückmeldung zur KI (Beta)** in den Einstellungen beginnt eine.
