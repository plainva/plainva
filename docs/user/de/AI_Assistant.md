# KI-Assistent (Beta)

Stand: 2026-10-08

Plainva kann Fragen zu Deinen Notizen mit einem KI-Modell Deiner Wahl beantworten. Es liest Deinen Vault, nennt die Notizen, auf die es sich stützt, öffnet Notizen und Ansichten für Dich und schlägt Änderungen vor — als Vorschläge an einer Notiz, als Entwürfe für Neues oder als Plan, den Du bestätigst. Eine Notiz ändert es nie selbst. Der Assistent ist **experimentell** und aus, bis Du ihn einschaltest, auf jedem Gerät für sich.

## Einschalten

Öffne **Einstellungen → KI & Automatisierung** (den App-Teil) und schalte **KI auf diesem Gerät nutzen** ein. Ohne den Schalter gibt es weder den KI-Knopf noch den KI-Tab oder den Begleiter. Gesendet wird erst etwas, wenn Du fragst.

## Einen Anbieter wählen

Plainva bringt keinen eigenen KI-Dienst mit: Du nutzt einen Anbieter Deiner Wahl, mit Deinem eigenen Schlüssel. Jeder Anbieter ist wählbar; Plainva nennt Bedingungen und Aufbewahrung, damit Du entscheidest — es schließt keinen aus.

| Art | Anbieter |
|---|---|
| Cloud-Anbieter | Anthropic, OpenAI, Google Gemini |
| Vermittler und eigene Server | OpenRouter, jeder **OpenAI-kompatibler Server** |
| Auf diesem Rechner (Desktop) | Ollama, LM Studio |
| Auf diesem Telefon | Apple (iPhone), Gemini Nano (Android) |

1. Wähle in **KI & Automatisierung** **Anbieter hinzufügen** und einen Anbieter. Jeder Eintrag trägt einen kurzen Hinweis zu seinen Bedingungen — etwa, dass im kostenlosen Zugang von Google Menschen Deine Eingaben lesen dürfen.
2. Gib den Schlüssel mit **Schlüssel eingeben** ein. Er geht in den sicheren Speicher dieses Geräts; Plainva zeigt ihn nie wieder an — weder der KI noch auf dem Bildschirm.
3. **Verbindung testen** lädt die eigene Modellliste des Anbieters. Schlägt der Test fehl, sagt die Meldung warum (ein abgelehnter Schlüssel, keine Verbindung, ein unbekanntes Modell).

Einen **OpenAI-kompatiblen Server** fügst Du über seine Adresse hinzu. Plainva fragt vor dem Hinzufügen noch einmal nach, in einem Fenster des Betriebssystems, und sendet nur an die Adresse, die Du bestätigt hast. Unverschlüsseltes `http` geht nur für einen Server auf diesem Gerät; alles andere braucht `https`.

Wenn Du noch keinen Schlüssel hast: ein Modell auf diesem Rechner (Ollama, LM Studio) kostet nichts, und die Konsole jedes Anbieters gibt Schlüssel aus.

**Das Modell des Systems am Telefon.** Auf einem iPhone mit Apple Intelligence (ab iPhone 15 Pro) bietet **Anbieter hinzufügen** zuerst **Apple** an, auf einigen Android-Telefonen **Gemini Nano**. Es braucht keinen Schlüssel und kostet nichts, und nichts verlässt das Gerät — deshalb fragt keine Übersicht vor dem Senden. Sein Fenster ist klein, etwa 4.000 Token für Notizen, Frage und Antwort zusammen: Es gehen weniger Notizen mit, frühere Runden werden gekürzt, und es nutzt keine Werkzeuge. Die Zeile sagt, ob es bereit ist und sonst warum nicht — Apple Intelligence aus, ein Gerät, das es nicht kann, ein Modell, das das System noch vorbereitet; unter Android bittet **Modell laden** das System, es herunterzuladen. Apples Modell spricht nicht jede Sprache (kein Polnisch). Nennt das Profil **Lokal** es, schreibt es am Telefon auch die Gists.

## Modelle und Profile

Vier Profile — **Schnell**, **Ausgewogen**, **Stark** und **Lokal** — sind Deine Zuordnung von Modellen. Wähle für jedes einen Anbieter und ein Modell, aus der Liste des Anbieters oder indem Du die Modellkennung genau so eingibst, wie der Anbieter sie nennt. **Standard für neue Gespräche** legt fest, mit welchem Profil ein neues Gespräch beginnt. Plainva erklärt kein Modell zum „besten“.

Ein fünfter Platz, **Audio**, hält das Modell, das Sprachnotizen transkribiert; er ist nie der Standard für ein Gespräch.

Ein sechster Platz, **Einbettungen**, hält das Modell, mit dem die Suche nach Bedeutung rechnet, wenn Du unter **Semantische Suche** **Eigener Anbieter** wählst — siehe [Suche](Search.md).

## Fragen

- **Desktop:** der KI-Knopf in der Aktionsleiste, **Strg+J** (⌘J unter macOS) oder **KI fragen** in der Befehlspalette öffnet den Begleiter — ein kleines Fenster über Deiner Arbeit. **Als Tab öffnen** holt dasselbe Gespräch in den KI-Tab, wo Deine Gespräche aufgelistet sind.
- **Telefon:** **KI fragen** im ⋮-Menü einer Notiz öffnet das KI-Blatt über dieser Notiz. Der Bereich **KI** (im Bereiche-Blatt oder in der Navigationsleiste, wenn Du ihn dort hinlegst) zeigt das Gespräch im Vollbild; **Gespräche** listet die früheren.
- **Neben der Notiz:** am Desktop ist dasselbe Gespräch die letzte Sektion der rechten Seitenleiste, **KI**. Am Telefon oder Tablet ist es der Reiter **KI** im Kontext der Notiz — neben **Eigenschaften** und **Backlinks** —, den ein Tablet neben der Notiz zeigt.

Die Notiz, die Du offen hast, geht automatisch mit; nimm sie mit ihrem ✕ aus dem Kontext, wenn Du willst. **Notiz anheften …** fügt weitere Notizen hinzu. Der Assistent kann auch selbst nachsehen: er durchsucht den Vault, liest Notizen und ihre Abschnitte, Datenbanken, Backlinks und verlinkte Notizen, listet Aufgaben, Termine und die zuletzt geöffneten oder geänderten Notizen und öffnet Notizen und Ansichten. Ändern, anlegen oder löschen kann er selbst nichts; was er stattdessen vorschlagen kann, steht unten unter „Änderungen vorschlagen“.

Der Assistent kann Dir auch etwas zeigen: eine Notiz an einer Überschrift öffnen, eine Notiz im Graphen zeigen, den Kalender auf einen Tag stellen, Ansichten öffnen, die Seitenleisten ein- und ausblenden. Er benutzt dafür die Befehle der Befehlspalette — und davon nur die, die etwas zeigen: was anlegt, ändert, löscht, exportiert oder ein Fenster öffnet, kann er nicht auslösen.

Jedes Gespräch beginnt mit der Zeile „Antworten schreibt eine KI — ⟨Modell⟩ über ⟨Anbieter⟩“. Unter jeder Antwort steht, was wohin gesendet wurde: wie viele Notizen, ungefähr wie viele Token und — wo der Anbieter Preise veröffentlicht — die ungefähren Kosten. **Stopp** beendet eine Antwort jederzeit.

Ein Link in einer Antwort öffnet sich erst, nachdem Du seine Adresse bestätigt hast, und Bilder in Antworten werden nie geladen.

## Was mitgeht

Zu jeder Frage stellt Plainva zusammen, was wichtig sein kann — auf diesem Gerät, bevor etwas gesendet wird:

- **Wo Du gerade bist:** Datum und Uhrzeit, die offene Notiz oder Datenbank und Deine Auswahl darin, Deine offenen Tabs, in der kommenden Woche fällige Aufgaben, die nächsten Termine und die heutige Tagesnotiz.
- **Notizen, die wichtig sein können:** gefunden über Deine Worte, die Links der offenen Notiz und was Du zuletzt geöffnet oder geändert hast. Zuerst entscheiden Deine Datenschutzregeln; bewertet werden überhaupt nur die Notizen, die sie erlauben. Einige gehen als Abschnitte mit — nicht als ganze Notizen —, andere nur mit Titel und einer Karte — dem ersten Satz ihres Abschnitts und jedem Satz mit Zahlen, Daten, Aufgaben, Verneinungen oder Links, wörtlich — oder allein mit ihrem Namen; mehr davon liest der Assistent, wenn er es braucht.

Eine Notiz, die das Gespräch schon trägt und die sich seitdem nicht geändert hat, wird genannt, nicht noch einmal gesendet. Ortsangaben aus Deinem Journal und Stimmungswerte werden nie von selbst gesendet.

## Bevor etwas gesendet wird

Die erste Anfrage einer Sitzung zeigt eine Übersicht: wohin sie geht (Anbieter und Modell), welche Notizen und welcher Teil davon, was außerdem mitgeht (Deine Auswahl, Termine, Aufgaben), was zurückgehalten wurde und ungefähr wie viele Token. **Senden** sendet; **Abbrechen** sendet nichts und gibt Dir Deine Worte ins Eingabefeld zurück; das − neben einer Notiz lässt sie weg. Innerhalb dessen, was Du freigegeben hast, gehen die nächsten Anfragen ohne Rückfrage. Die Übersicht kommt wieder, sobald der Umfang wächst: ein anderes Modell oder ein anderer Anbieter, eine neue Art von Daten, Notizen aus einem weiteren Ordner, neue Werkzeuge oder eine deutlich größere Anfrage. Ein Modell auf diesem Gerät fragt nie.

Wenn Du die Übersicht vor jeder Anfrage sehen willst, schalte **Vor jeder Anfrage fragen** ein — in der Übersicht selbst oder unter **Einstellungen → KI & Automatisierung** bei **Senden**.

Die Zeile unter jeder Antwort öffnet die Übersicht dessen, was mit ihr ging. Nennt eine Antwort keine der gesendeten Notizen, sagt ein Hinweis über dieser Zeile das; prüfe die Antwort dann an den Notizen. Gingen Notizen mit, nennt die Zeile auch die Abdeckung: **Abdeckung hoch**, wenn fast jede Aussage der Antwort eine Notiz nennt, **Abdeckung teilweise** oder **Abdeckung gering**, wenn es weniger sind.

## Kontext einsehen

Das Auge unter dem Eingabefeld, **Kontext einsehen**, zeigt, was die nächste Anfrage mitnähme — bevor sie geht, für das gerade gewählte Modell. Zu jeder Notiz: warum sie gewählt wurde (gerade offen, angeheftet, passt zu Deinen Worten, ähnlich in der Bedeutung, verlinkt, bald fällig …), welcher Teil mitgeht und ungefähr wie viele Token. Jede Notiz kannst Du

- aus der nächsten Anfrage weglassen (**Wieder aufnehmen** holt sie zurück),
- ans Gespräch heften,
- dauerhaft auf diesem Gerät behalten: das schreibt die Regel `cloud: deny` in die Notiz (siehe unten).

Notizen, die Deine Regeln zurückhalten, stehen ebenfalls da, damit Du weißt, was fehlt; sie werden nie bewertet und nie gesendet. **Mit diesem Kontext senden** sendet, was Du geschrieben hast. In einem breiten KI-Tab bleibt die Ansicht als Spalte neben dem Gespräch offen.

Über den Notizen sagt **Gesendet**, wie viel von diesen Notizen mitgeht — etwa ~870 von 3.460 Token —, und **Gespart**, wie viel weniger das ist, als jede vorgeschlagene Notiz ganz zu senden; beim ersten Mal steht auch dabei, wie viele Token das gewesen wären. **Als Spur im Graph zeigen** öffnet den Graph mit der offenen Notiz und den Quellen, markiert, samt den Links zwischen ihnen.

Sieht der Text, der an eine Cloud ginge, nach einem Passwort oder Schlüssel, einer Konto- oder Kartennummer, einer Ausweis- oder Steuernummer oder nach Gesundheitsangaben aus, steht unter der Notiz **Möglicherweise sensibel** und was erkannt wurde — in **Kontext einsehen** und in der Übersicht vor dem Senden. **Auf diesem Gerät lassen** schreibt die Regel `cloud: deny` in die Notiz. Nummern und Geheimnisse ersetzt **In diesem Gespräch schwärzen** durch einen Platzhalter wie `⟦withheld account⟧` — in jeder Nachricht dieses Gesprächs, auch wenn das Modell die Notiz selbst liest, bis Du **Ungeschwärzt senden** wählst; die Übersicht zählt sie unter **Zurückgehalten**. Aufgaben und Termine haben dieselbe Wahl in der Zeile **Aufgaben, Termine und Angaben der offenen Notiz**. Ginge in einer Sitzung zum ersten Mal etwas dieser Art ungeschwärzt mit, fragt die Übersicht vor dem Senden. Die Prüfung läuft auf diesem Gerät und ist ein Hinweis, kein Filter: Sie kann etwas übersehen und hält nie eine Anfrage auf. Eine ausgewählte Passage geht so, wie sie ist; bei einem Modell auf diesem Gerät erscheint kein Hinweis.

## Gists

Mit **Gists mit dem lokalen Modell** (unter **Einstellungen → KI & Automatisierung**, aus, bis Du es einschaltest) schreibt ein Modell auf Deinem Rechner kurze Zusammenfassungen der längeren Abschnitte Deiner Notizen, ganzer Notizen, der obersten Ordner und des Vaults. Es läuft nur, wenn das Profil **Lokal** einen Server auf diesem Rechner nennt (Ollama, LM Studio; am Telefon das Modell des Systems) — nie eine Cloud im Hintergrund — und nur, während Plainva nichts anderes zu tun hat; am Telefon nur, solange es offen ist. Jeder Gist wird geprüft: der Gist eines Abschnitts muss jede Zahl, jedes Datum, jeden Betrag, Link, Tag und jede Verneinung wörtlich behalten, sonst gehen die Sätze des Abschnitts selbst. Ein Gist ist an genau den Text gebunden, für den er steht; änderst Du den Abschnitt, wird er nicht benutzt, bis er neu geschrieben ist. Gists von Ordnern und vom Vault entstehen nur aus Notizen, die Deine Regeln an eine Cloud lassen. In **Kontext einsehen** sagt eine als Gist gesendete Quelle das, und **Original** schickt mit der nächsten Nachricht ihre eigenen Sätze.

## Mit einer Auswahl

Markiere Text in einer Notiz, und die KI arbeitet nur mit dieser Stelle.

- **Desktop:** beim Bearbeiten bietet **KI** in der Auswahlleiste **Als Vorschlag** — **Umschreiben**, **Kürzen**, **Übersetzen …**, **Aufgaben daraus** — und **Im Begleiter** — **Erklären** und **Frage zur Auswahl …** (**Strg+J**, ⌘J unter macOS).
- **Telefon:** **KI** in der Leiste über einer Auswahl — beim Lesen wie beim Bearbeiten — öffnet das KI-Blatt.
- **In jedem Gespräch:** solange in der offenen Notiz Text markiert ist, bietet die Zeile **Mit der Auswahl** über der Eingabe dieselben Aktionen.

Eine Vorschlags-Aktion sendet nur die markierte Stelle — nicht den Rest der Notiz, keine angehefteten Notizen, keine Werkzeuge — und fragt mit derselben Übersicht wie eine Frage. Die Antwort kommt als Vorschlagsrunde in die Notiz, wie die eines Menschen: unter **Vorschläge** übernimmst oder lehnst Du jede Änderung einzeln oder die ganze Runde ab, und vorher ändert sich nichts in der Notiz. Die Autorzeile der Runde lautet **Plainva KI · ⟨Modell⟩**, damit sichtbar bleibt, welche Stelle eine KI geschrieben hat. **Aufgaben daraus** fügt die Aufgaben unter der Stelle ein, statt sie zu ersetzen. Jede Aktion behält ihr Gespräch im Verlauf.

Eine Stelle aus einer Notiz, die Deine Regeln von der Cloud fernhalten — oder eine mit Links auf solche Notizen oder mit Ortsangaben —, geht an kein Cloud-Modell. In einem verschlüsselten Workspace gibt es die Vorschlags-Aktionen noch nicht: seine Vorschläge können die KI noch nicht als Autor nennen.

## Im Kommentar-Faden

Sprich den Assistenten in einem Kommentar an, und er antwortet im Faden. Tippe im Kommentarfeld ein **@** und wähle **KI** — den Eintrag mit dem KI-Zeichen — oder schreib den Namen selbst: **@KI**, **@AI** und **@IA** erreichen ihn alle, gleich in welcher Sprache die App läuft. Sobald Dein Kommentar gesendet ist, zeigt der Faden unter **KI** die Zeile **schreibt eine Antwort…**; **Stopp** beendet das. Die Antwort erscheint als Antwort im selben Faden, mit der Autorzeile **Plainva KI · ⟨Modell⟩**. Anders als ein Vorschlag wartet sie nicht darauf, übernommen zu werden — sie ist eine Anmerkung neben der Notiz, nie Text in ihr —, und auf dem Gerät, das gefragt hat, löschst Du sie wie eine eigene.

Der Faden geht an das Modell wie eine Frage: seine Kommentare, die Stelle, an der er hängt, und die Notiz selbst, über dieselbe Übersicht. Ein Kommentar-Faden ist eine eigene Art von Daten, deshalb fragt die Übersicht beim ersten Mal. Wo Deine Regeln die Notiz von der Cloud fernhalten, gehen auch ihre Kommentare nicht dorthin, und Links darin auf solche Notizen werden zurückgehalten. Nur ein Kommentar, den Du auf diesem Gerät sendest, ruft den Assistenten; einer, der per Sync ankommt, tut es nie, was auch immer darin steht. Internetadressen, die die KI von sich aus mitbringt — in einer Antwort, einem Vorschlag oder einem Transkript —, werden so geschrieben, dass nichts sie öffnet oder lädt (`https[://]…`); Adressen, die Dein eigener Text schon enthielt, bleiben, wie sie sind. In einem verschlüsselten Workspace lässt sich der Assistent noch nicht ansprechen: seine Kommentare können die KI noch nicht als Autor nennen.

## Skills

Skills sind Anleitungen für wiederkehrende Arbeit. Zwölf kommen mit Plainva — darunter **Tagesorientierung**, **Wochenrückblick** und **Projektstatus** als Chips in einem leeren Gespräch —, eigene kannst Du schreiben oder importieren. Starte einen mit einem Klick oder frag einfach: die KI lädt einen passenden Skill selbst. Eigene Skills laufen erst, wenn Du sie auf diesem Gerät freigegeben hast. Alles dazu: [Skills](AI_Skills.md).

## Eine Sprachnotiz transkribieren

An jeder Sprachnotiz — im Editor, im Lesemodus, im Journal und auf Karten — macht **Transkribieren** aus der Aufnahme Text. Sie geht unverändert an das Modell des Profils **Audio**, über dieselbe Übersicht wie eine Frage; eine Aufnahme ist eine eigene Art von Daten, deshalb fragt die Übersicht beim ersten Mal. Das Transkript kommt als Vorschlag unter die Aufnahme, mit dem Autor **Plainva KI · ⟨Modell⟩** — unter **Vorschläge** übernimmst oder lehnst Du es ab.

**Audio** braucht einen Anbieter mit Audio-Weg: OpenAI (etwa `gpt-4o-transcribe` oder `whisper-1`), Gemini oder einen eigenen kompatiblen Server — einer auf diesem Rechner behält die Aufnahme auf dem Gerät. Aufnahmen bis 11 MB lassen sich transkribieren. Eine Aufnahme in einer Notiz, die Deine Regeln von der Cloud fernhalten, geht an kein Cloud-Modell, und verschlüsselte Workspaces bieten es noch nicht an.

## Ein Bild erklären

An jedem Bild im Vault fragt **Bild erklären** die KI, was es zeigt.

- **Desktop:** in der Werkzeugleiste eines geöffneten Bildes und im Menü, das ein Rechtsklick auf ein Bild in einer Notiz öffnet — beim Bearbeiten wie im Lesemodus.
- **Telefon:** unter einem geöffneten Bild (an einem Bild in einer Notiz führt **Bild öffnen** dorthin).

Das Bild geht mit der Frage an das Modell, mit dem neue Gespräche beginnen — in einem eigenen Gespräch, in dem Du weiterfragen kannst: was in einer Tabelle steht, was in der zweiten Spalte steht, was ein Diagramm bedeutet. Die Übersicht zeigt das Bild, bevor es gesendet wird; ein Bild ist eine eigene Art von Daten, deshalb fragt die Übersicht beim ersten Mal.

**Was geht, ist nicht die Datei.** Plainva zeichnet das Bild, verkleinert es auf höchstens 1.568 Pixel an der längeren Seite und speichert es zum Senden neu. So geht es ohne das, was die Datei über es festhält: den Ort einer Aufnahme, das Datum, die Kamera. Die Übersicht zeigt genau das Bild, das geht, mit seiner Größe. Diese Kopie bleibt beim Gespräch auf diesem Gerät, damit Du auch später siehst, was der Anbieter bekommen hat; löschst Du das Gespräch, ist sie weg.

**Regeln.** Ein Bild in einem Ordner, den Deine Regeln von der Cloud fernhalten, geht an kein Cloud-Modell. Ebenso wenig ein Bild, das eine Notiz mit der Regel `cloud: deny` zeigt — egal, wo Du **Bild erklären** drückst, auch am geöffneten Bild: Plainva schlägt vor dem Senden nach, welche Notizen das Bild einbetten, und lässt es hier, wenn sich das nicht herausfinden lässt. Ein Modell auf diesem Gerät bleibt erlaubt. Was in einem Bild geschrieben steht, ist Inhalt wie der Text einer Notiz, nie eine Anweisung: Das Gespräch von **Bild erklären** kann in Deinem Vault nachschlagen, aber es kann nicht ins Internet und löst in der App nichts aus.

**Welche Modelle Bilder lesen.** Die meisten Cloud-Modelle tun es. Das Modell des Systems am Telefon nicht — **Bild erklären** sagt das dann. Wo die Liste eines Anbieters sagt, dass ein Modell keine Bilder liest, steht es in der Übersicht, bevor Du sendest. Lehnt ein Anbieter die Anfrage ab, wähle unter dem Gespräch ein anderes Modell und frag noch einmal — das Bild ist noch darin.

## Im Internet

Der Assistent kann das Internet erst benutzen, wenn Du es erlaubst — und zwar dreimal:

1. **Für den Vault.** Schalte in **Einstellungen → KI & Automatisierung** (dem Vault-Teil) **Die KI darf in diesem Vault ins Internet** ein. Der Schalter ist für jeden Vault aus, bis Du entscheidest, und gilt nur auf diesem Gerät.
2. **Für ein Gespräch.** Drücke vor der ersten Nachricht eines neuen Gesprächs die Weltkugel unter dem Eingabefeld — **Dieses Gespräch ins Internet lassen**. Ob ein Gespräch ins Internet darf, entscheidet sich bei seinem Beginn; um es zu ändern, beginne ein neues Gespräch. Ein Gespräch, das es darf, sagt das in seiner ersten Zeile. Den Skill **Recherche** zu starten ist dieselbe Wahl: Sein Gespräch darf ins Internet — siehe [Skills](AI_Skills.md).
3. **Für jede Anfrage.** Solange Deine Notizen im Gespräch sind, fragt jede Seite, die der Assistent lesen will, und jede Suche vorher — mit der ganzen Adresse oder den Suchwörtern, denn das ist alles, was Dein Gerät dafür verlässt. **Seite lesen** oder **Suchen** lässt diese eine Anfrage durch; **Nicht lesen** oder **Nicht suchen** lässt sie weg, und der Assistent macht ohne sie weiter.

**Was eine Anfrage ist.** Eine Seite zu lesen ist eine Anfrage von diesem Gerät an die Website, wie das Öffnen der Seite im Browser — ohne Cookies, ohne Anmeldung und ohne etwas aus Deinen Notizen; wie bei jedem Besuch sieht die Website Deine Internet-Adresse. Gelesen werden nur öffentliche Seiten über `https`; Adressen in Deinem Heim- oder Firmennetz werden abgelehnt. Eine Suche geht an den Anbieter Deines Modells — Anthropic, OpenAI, Google Gemini oder OpenRouter —, der genau mit den Wörtern sucht, die Dir gezeigt wurden; Anbieter können Suchen gesondert berechnen. Ein Modell auf diesem Gerät kann Seiten lesen, aber nicht suchen, und das Modell des Systems am Telefon kann das Internet gar nicht benutzen.

**Woher eine Adresse kommt.** Die Frage sagt, ob Du die Adresse genannt hast, ob eine Notiz oder ein Ergebnis sie genannt hat — oder ob das Modell sie selbst zusammengesetzt hat. Eine Adresse, die das Modell gebildet hat, könnte etwas aus Deinen Notizen enthalten: lies sie, bevor Du sie durchlässt.

**Websites ohne Nachfrage.** Mit **Immer für ⟨Website⟩** in einer Frage oder unter **Websites ohne Nachfrage** in den Einstellungen des Vaults werden Seiten einer Website ohne Nachfrage gelesen — solange Du, eine Notiz oder ein Ergebnis die Adresse genannt haben. Eine Adresse, die das Modell selbst gebildet hat, fragt immer.

**Was der Assistent liest.** Nie die Seite selbst. Eine zweite Anfrage an dasselbe Modell, die keine Werkzeuge hat, liest die Seite und schreibt einen kurzen Bericht: eine Zusammenfassung, Aussagen mit der Stelle, auf der sie beruhen, und Links, die wirklich auf der Seite stehen. Eine Seite, die dem Assistenten Anweisungen geben will, erreicht ihn so als Bericht über eine Seite — nie als Seite, mit der er arbeitet. Unter der Antwort listet **Im Web gelesen** die gelesenen Seiten, und die Zeile darunter öffnet alles, was angefragt wurde.

**Notizen, die draußen bleiben.** Eine Notiz oder ein Ordner mit **Webzugriff: nie** (siehe Datenschutzregeln weiter unten) gibt es für ein Gespräch, das ins Internet darf, nicht: nicht in seinem Kontext, nicht für seine Werkzeuge, und Links auf sie werden zurückgehalten.

Ein Link in einer Antwort, dessen Adresse das Modell selbst gebildet hat, ist markiert, und die Frage vor dem Öffnen sagt es. Kommt gar keine Antwort zurück — keine Verbindung, der Anbieter antwortet nicht —, listet das Gespräch stattdessen die Notizen, die am besten zu Deiner Frage passen.

## E-Mail und Termine

**Termine.** Der Assistent listet Termine aus Deinen verbundenen Kalendern — Tag, Uhrzeit und Titel, auf Wunsch auch Ort und Teilnehmer — und liest einen einzelnen Termin im Einzelnen: den Organisator, die Teilnehmer mit ihren Antworten und Deine eigene. Den Link einer Online-Besprechung bekommt er nie; der bleibt im Kalender.

**E-Mail.** Sind in diesem Vault Mail-Konten verbunden, kann der Assistent Nachrichten suchen und lesen. E-Mail gehört nicht zu den Werkzeugen, mit denen ein Gespräch beginnt: der Assistent sucht sie erst, wenn Deine Frage sie braucht, und beim ersten Zugriff fragt Plainva — **E-Mails lesen?** **Erlauben** gilt für diesen Anbieter, bis Du Plainva beendest; ein anderes Modell oder ein anderer Anbieter fragt neu. **Nicht erlauben** lässt den Zugriff weg, und der Assistent macht ohne ihn weiter. Ein Modell auf diesem Gerät fragt nicht, weil dafür nichts das Gerät verlässt.

**Was der Assistent davon liest.** Von einer Suche sieht er Datum, Absender und Betreff der Nachrichten — nie ihren Text. Den Text einer Nachricht und die Beschreibung eines Termins liest er nie selbst: andere haben sie geschrieben, und wer eine Mail oder eine Einladung schreibt, kann sie für genau diesen Leser schreiben. Ein zweiter Leser ohne jedes Werkzeug liest sie und schreibt einen kurzen Bericht — eine Zusammenfassung, Aussagen mit der Stelle, auf der sie beruhen, und Links, die wirklich darin stehen. Ist unter **Modelle und Profile** ein Modell auf diesem Gerät als **Lokal** eingerichtet, ist es dieser Leser, und der Text selbst verlässt das Gerät nicht; an den Anbieter geht nur der Bericht. Sonst liest der Anbieter des Gesprächs, in einer eigenen Anfrage ohne Werkzeuge. Die Frage sagt Dir vorher, wer liest.

**Was sich nicht ändert.** Der Assistent liest nur: eine Nachricht, die er gelesen hat, bleibt ungelesen, nichts wird verschoben, beantwortet oder gelöscht, und Anhänge öffnet er nicht — er nennt nur ihre Namen. Unter der Antwort siehst Du, wie viele Nachrichten gelesen wurden, und die Zeile darunter sagt, wer den Text gelesen hat. Eine E-Mail oder einen Termin, den er für Dich schreibt, gibt es nur als Entwurf, den Du selbst sendest oder speicherst — siehe **Änderungen vorschlagen** weiter unten.

## Externe Werkzeuge (MCP)

Der Assistent kann Werkzeuge von Servern nutzen, die Du selbst anbindest, über das Model Context Protocol (MCP) — ein Ticketsystem, ein Wiki, eine Datenbank Deines Teams. Es ist die Gegenrichtung zu [KI-Apps verbinden](Connect_AI_Apps.md): Dort lesen andere Apps Deinen Vault über Plainva; hier fragt Plainvas Assistent andere Server. Von einem Server wird nichts genutzt, bevor Du angesehen hast, was er anbietet, und jeden Aufruf siehst Du, bevor er hinausgeht.

**Einen Server hinzufügen.** Wähle in **Einstellungen → KI & Automatisierung** (dem Vault-Teil) unter **Externe Werkzeuge (MCP)** den Punkt **Server hinzufügen…**. Gib ihm einen eigenen Namen und seine Adresse (`https://…`), dazu ein Zugangstoken, falls der Server eines verlangt — es geht in den sicheren Speicher dieses Geräts und wird nie wieder angezeigt. Am Desktop kann ein Server auch ein **Programm auf diesem Rechner** sein: die Datei, die gestartet wird, ihre Argumente und die Werte für ihre Umgebung. Plainva startet es direkt, ohne Shell, und in einer Sandbox, wo Dein Rechner eine hat, die Plainva nutzen kann. Dein System zeigt die Adresse oder den ganzen Befehl noch einmal an, bevor sie gemerkt werden. Am Telefon ist ein Server immer eine Adresse.

**Anmelden.** Manche Server verlangen statt eines Tokens eine Anmeldung. Seine Prüfung sagt dann **Der Server verlangt eine Anmeldung.** Wähle **Anmelden…**: Plainva fragt den Server, wo seine Anmeldung liegt, öffnet diese Seite in Deinem Browser und wartet, bis Du zurück bist. Was Plainva dabei erhält, bleibt im sicheren Speicher dieses Geräts und geht nur an diesen Server; weder Du noch die KI bekommen es je zu sehen. Es wird ohne Dein Zutun erneuert, solange der Server das zulässt, und wenn es abgelaufen ist, bittet die Prüfung um eine neue Anmeldung. Lässt der Anmeldedienst Apps sich nicht selbst registrieren, fragt Plainva nach der **Client-ID**, die Dir der Betreiber des Servers gegeben hat. **Abmelden** vergisst die Anmeldung; eine Anmeldung und ein gespeichertes Zugangstoken ersetzen einander.

**Ihn prüfen.** Ein gerade hinzugefügter Server bietet noch nichts an. Seine Prüfung zeigt, was registriert ist und was der Server auflistet: seine eigene Beschreibung, seine Werkzeuge mit ihren Beschreibungen — den eigenen Worten des Servers — und seine Prompts. **Freigeben** erlaubt genau diese Texte, auf diesem Gerät. Bevor ein Server benutzt wird, lädt Plainva erneut, was er auflistet, und vergleicht es mit dem, was Du freigegeben hast; weicht etwas ab, ist der Server gesperrt, bis Du erneut hinsiehst, und die Prüfung sagt, was sich geändert hat.

**Was ein Vault erlaubt.** Jeder Vault entscheidet für sich: ob er den Server nutzt (**⟨Server⟩ in diesem Vault nutzen**), welche seiner Werkzeuge der Assistent aufrufen darf — keines ist angehakt —, und unter **Notizen, die mit einem Aufruf mitgehen dürfen**, ob **Keine**, **Gewählte Ordner** oder **Der ganze Vault**. Auch ein Werkzeug, das nicht sagt, dass es nur liest, lässt sich anhaken; seine Zeile nennt, was ein Aufruf dann beim Server tun kann — etwas ändern oder etwas ändern, überschreiben oder löschen. Ein Haken gilt für das, was das Werkzeug gesagt hat, als Du ihn gesetzt hast: Sagt es später, dass es mehr kann, wird es erst wieder angeboten, wenn Du es neu anhakst.

**Im Gespräch.** Die Werkzeuge Deiner Server gehören nicht zu den Werkzeugen, mit denen ein Gespräch beginnt: Der Assistent sucht sie erst, wenn Deine Frage sie braucht, und die Übersicht vor dem Senden nennt die Server, zu denen sie gehören. Jeder einzelne Aufruf fragt vorher — **⟨Server⟩ aufrufen?** — mit dem Werkzeug und genau dem, was gesendet würde. **Aufrufen** lässt diesen einen Aufruf durch, **Nicht aufrufen** lässt ihn weg, und ein „immer“ gibt es nicht. Ein Werkzeug, das etwas ändern kann, fragt mit anderen Worten — **⟨Server⟩ etwas ändern lassen?** —, sagt dazu, dass Plainva das nicht rückgängig machen kann, und sein Knopf heißt **Ausführen**. Ein Aufruf geht gar nicht hinaus, wenn das Gespräch eine Notiz gelesen hat, die außerhalb dessen liegt, was der Vault diesem Server erlaubt, oder eine, die Du von der Cloud fernhältst. Was zurückkommt, gilt als Text eines Fremden: Der Assistent liest es und nimmt daraus keine Anweisungen an.

**Prompts.** Ein Server kann Prompts anbieten — fertige Anfragen. Sie stehen unter einem leeren Gespräch, und nur Du startest sie. Beim ersten Mal zeigt Plainva, wozu ein Prompt wird, bevor er als Deine Nachricht gesendet wird; von da an geht genau dieser Text ohne Nachfrage, und ein anderer Text sperrt den Server.

**Was Plainva aufbewahrt.** Die Adresse oder der Befehl wird auf diesem Gerät gemerkt, die gespeicherten Werte in seinem sicheren Speicher; Deine Freigabe liegt in Plainvas eigenen Daten, nie im Vault — wer den Vault schreiben kann, kann also keinen Server freigeben. Unter **Letzte Aufrufe in diesem Vault** listet die Prüfung auf, wann ein Werkzeug aufgerufen wurde, welches und wie es ausging — nie, was gesagt wurde. **Server entfernen** löscht den Server von diesem Gerät, für jeden Vault.

Ein Gespräch, das ein Skill begonnen hat, eine Aktion an einer Auswahl und eine Antwort im Kommentar-Faden erreichen keine externen Werkzeuge, ebenso wenig das Modell des Systems am Telefon.

## Externe Agenten

Am Desktop kann Plainva auch den KI-Agenten eines anderen Herstellers im Ordner des Vaults starten — ein Programm, das Du selbst installiert und bei dem Du Dich selbst angemeldet hast. So ein Agent ist nicht der Assistent: er liest und sendet selbst, und Deine Datenschutzregeln und die Übersicht vor dem Senden erreichen ihn nicht. Was Plainva in seiner Sitzung kontrolliert und was nicht: [Externe Agenten](External_Agents.md).

## Änderungen vorschlagen

Der Assistent kann mehr vorschlagen als eine Antwort — und nichts davon ist in Deinem Vault, bevor Du es sagst. Es gibt drei Formen, und jede wartet dort, wo Du über sie entscheidest.

- **Ein Vorschlag an einer Notiz.** Bittest Du um eine Änderung an einer Notiz, die es gibt, legt der Assistent sie als Vorschläge an die Notiz: am Rand, gezeichnet mit „Plainva KI · ⟨Modell⟩“, jede Änderung einzeln zum Übernehmen oder Ablehnen — wie die Vorschläge eines Menschen, siehe [Kommentare & Vorschläge](Comments_and_Suggestions.md). Beim Übernehmen wird die Notiz, wie sie war, vorher als Version festgehalten — der Versionsverlauf kennt also immer den Weg zurück. Unter der Antwort nennt eine Zeile die Notiz; ein Klick darauf öffnet sie. Ein Wert für eine Eigenschaft der Notiz wird auf dieselbe Weise vorgeschlagen: Die Karte zeigt die Eigenschaft mit dem, was sie jetzt sagt, durchgestrichen und dem, was sie sagen würde, und kennzeichnet eine Eigenschaft, die die Notiz noch nicht hat, als neu. Sagt die Eigenschaft inzwischen etwas anderes, wenn Du entscheidest, steht auf der Karte, dass der Vorschlag nicht mehr passt. Wer eine Notiz erstellt hat und wer für sie bürgt, kann der Assistent nicht vorschlagen (siehe [OKF](OKF.md)) — ebenso wenig die Eigenschaften, die Plainva für sich selbst führt. In einer Datenbank steht ein Wert, der für einen Eintrag vorgeschlagen ist, zusätzlich in der Zelle dieses Eintrags; dort übernimmst Du ihn oder lehnst ihn ab, ohne die Notiz zu öffnen — siehe [Datenbanken (.base)](Databases_Base.md).
- **Ein Entwurf.** Eine neue Notiz, eine Aufgabe oder ein Journal-Eintrag bleibt ein Entwurf: Eine Karte unter der Antwort sagt, was daraus würde und wohin es käme. **Anlegen** macht es — die Notiz in dem Ordner, den die Karte nennt (der **Eingangsordner**, wenn der Assistent keinen anderen genannt hat), die Aufgabe aus ihren Worten gelesen, als hättest Du sie ins Erfassungsfeld getippt, den Eintrag im Journal des Tages auf der Karte. **Ansehen** klappt vorher den Text einer Notiz auf; **Verwerfen** wirft den Entwurf weg. Eine Notiz aus einem Entwurf sagt, wer sie geschrieben hat (`generated`, siehe [OKF](OKF.md)), und nennt die Notizen, auf denen das Gespräch beruhte. Wo neue Aufgaben auch in eine Aufgabenliste Deines Anbieters gehen, trägt die Karte einer Aufgabe den Schalter des Erfassungsfelds, **Auch anlegen bei „…“**: Er ist an, und die Aufgabe wird auch dort angelegt, wenn Du ihn nicht ausschaltest. Ein Eintrag einer Datenbank wird auf dieselbe Weise entworfen: Seine Karte nennt die Datenbank und die Eigenschaften, die der Eintrag hätte, und **Anlegen** schreibt ihn als Notiz in den Ordner, in dem diese Datenbank ihre Einträge ablegt — mit diesen Eigenschaften und allem, was eine Notiz dort zum Eintrag macht. Eine Datenbank, die noch keinen Ablage-Ordner für neue Einträge hat, nimmt einen solchen Entwurf erst an, wenn Du ihren ersten Eintrag selbst angelegt hast.
- **Ein Plan.** Umbenennen, Verschieben und Löschen lassen sich nicht Stück für Stück prüfen, also fragt der Assistent: Eine Rückfrage über dem Eingabefeld zeigt, was geschähe — den neuen Namen und wie viele Links in wie vielen Notizen ihm folgen, oder den Zielordner, mit einer Warnung, wenn die Notiz dabei eine Datenschutzregel ihres Ordners verlöre. Nach Deinem Ja erledigt Plainva es so, wie wenn Du es selbst tust; der Assistent erfährt nur, ob es geschehen ist. Beim Löschen öffnet die Rückfrage lediglich Plainvas eigenen Löschdialog: Nichts ist weg, bevor Du dort bestätigst. Auch eine der eigenen Datenschutzregeln einer Notiz wird so erfragt und nie als Vorschlag hinterlegt: Die Rückfrage nennt die Regel und ob sie in die Notiz geschrieben oder aus ihr genommen würde — mit einer Warnung, wenn die Notiz danach wieder an Cloud-Modelle oder in Gespräche mit dem Internet gehen dürfte. Nach Deinem Ja schreibt Plainva sie; die Regel gilt ab dann und holt nicht zurück, was ein Gespräch bereits gesendet hat.

**Eine E-Mail und ein Termin.** Wo in diesem Vault ein Mail-Konto oder ein Kalender verbunden ist, der Termine annimmt, kann der Assistent auch eine E-Mail oder einen Termin entwerfen. Er sendet und speichert keins von beiden. Die Karte nennt alle, an die es ginge — **An**, **Cc** und **Bcc** oder die **Teilnehmer** —, und weist auf jede Adresse hin, die Du in diesem Gespräch nicht selbst geschrieben hast: Der Assistent kann sie aus einer Notiz, einer Mail oder einer Webseite haben, also prüfe sie. **In Mail öffnen** öffnet die Mail als neue Nachricht, in der alles schon eingetragen ist, **Im Kalender öffnen** den Termin im Termin-Editor des Kalenders; dort änderst Du, was Du möchtest, und **Senden** oder **Speichern** ist Dein eigener Schritt. Teilnehmer bekommen beim Speichern eine Einladung von Deinem Kalender-Anbieter, wie bei jedem Termin, den Du selbst einträgst. Der Entwurf bleibt in der Liste, bis die Mail wirklich hinausgegangen ist oder der Kalender den Termin angenommen hat: Die Nachricht zu schließen, ein Senden in seinen wenigen Sekunden zurückzunehmen oder ein Kalender, der ablehnt, lassen ihn, wo er war. Eine Mail, die Du mit **Als Entwurf** ablegst, liegt von da an bei den Entwürfen Deines Postfachs und verlässt die Liste ebenfalls; am Desktop gilt das auch für eine Nachricht, die Du in ein eigenes Fenster verschiebst.

An einer Datenbank arbeitet der Assistent auch ohne Gespräch: **„…“ mit KI füllen …** liest die Notiz jedes Eintrags, der in einer Spalte keinen Wert hat, und schlägt für jeden einen vor, und in den Filter-Einstellungen werden aus einem Satz Filterregeln, die Du siehst, bevor sie gelten. Bevor etwas gesendet wird, zeigt die Übersicht wie immer, was hinausgeht — bei einer Spalte die Notizen dieser Einträge, jede in einer eigenen Anfrage; bei einem Filter nur die Spalten der Datenbank mit Namen, Art und Auswahlwerten und Dein Satz, nie ein Eintrag. Beides ist unter [Datenbanken (.base)](Databases_Base.md) beschrieben.

Alles, was wartet, steht in einer Liste: **Offen**, ein Abschnitt des KI-Tabs am Desktop und von **Gespräche** am Telefon. Sie nennt die Notizen, an denen Vorschläge einer KI liegen, und die Entwürfe dieses Geräts, jeweils mit dem, der sie hingelegt hat. Entwürfe liegen auf dem Gerät, auf dem sie entstanden sind, wie die Gespräche; Vorschläge gehören zu den Kommentaren der Notiz und erreichen mit ihnen Deine anderen Geräte.

Drei Grenzen gelten, worum auch immer der Assistent gebeten wird. Eine Webadresse, die er in einen Vorschlag oder einen Entwurf mitbringt, wird so geschrieben, dass nichts sie öffnet oder lädt (`https[://]…`); eine Adresse, die Du selbst getippt hast, bleibt, wie sie ist. Ein Gespräch, das eine Notiz gelesen hat, die nie in die Cloud oder nie ins Internet darf, legt einen Vorschlag, eine Aufgabe oder einen Journal-Eintrag nur dorthin, wo dieselbe Regel gilt — eine entworfene Notiz oder ein entworfener Datenbank-Eintrag nimmt die Regel stattdessen mit, und eine E-Mail oder ein Termin wird gar nicht entworfen. Und in einem verschlüsselten Workspace wird nichts vorgeschlagen, entworfen oder geplant.

Der Assistent soll eine Notiz als Link nennen; ein Link ist deshalb die eine Behauptung in seinem Text, die Plainva prüfen kann: Verlinkt ein Vorschlag oder ein Entwurf eine Notiz, die es in Deinem Vault nicht gibt, sagen es die Zeile unter der Antwort und die Karte des Entwurfs — **Verlinkt, aber nicht im Vault:** und die Namen. Zurückgehalten wird deshalb nichts; vielleicht willst Du erst den Link und später die Notiz. Ein Link auf eine Notiz, die es in Deinem Vault gibt, die die KI hier aber nicht lesen darf — eine Datenschutzregel hält sie von dem Gespräch fern —, bekommt eine eigene Zeile: **Verlinkt auf Notizen, die die KI hier nicht lesen darf:** und die Namen. Die KI selbst erfährt über beide Fälle dasselbe; sie kann also keinen Namen herausfinden, indem sie ihn ausprobiert. Ob eine Aussage stimmt, prüft Plainva nicht.

Ein Skill hat diese Fähigkeiten nur, wenn er sie nennt, und seine Prüfung sagt das — siehe [Skills](AI_Skills.md).

## Eine Antwort als Notiz festhalten

Unter jeder fertigen Antwort macht **Als Notiz festhalten** aus der Antwort eine Notiz Deines Vaults. Du drückst es, und Plainva schreibt die Notiz — der Assistent selbst ändert weiterhin nichts.

- **Wohin sie kommt.** In den **Eingangsordner** des Vaults (**Einstellungen → Inhalt & Struktur**; am Telefon heißt er **Inbox-Ordner**), unter einem Namen aus Deiner Frage — in einem Gespräch, das ein Skill begonnen hat, aus dem Skill und der geöffneten Notiz oder dem Tag. Eine Notiz, die schon dort liegt, wird nie angerührt: die neue bekommt den nächsten freien Namen. Plainva öffnet sie sofort.
- **Wer sie geschrieben hat.** Die erste Zeile sagt es in Worten — eine Antwort von Plainva KI, mit dem Modell, der Uhrzeit und Deiner Frage. Die Eigenschaften der Notiz sagen dasselbe für andere Werkzeuge: `generated`, mit dem Modell und der Uhrzeit. Nichts kennzeichnet die Notiz als geprüft; das bleibt Deine Sache — siehe [OKF](OKF.md).
- **Worauf sie sich stützt.** Unter der Antwort listet **Quellen** auf, was der Lauf wirklich benutzt hat. Diese Liste schreibt Plainva aus dem eigenen Protokoll, nicht das Modell: die gelesenen Seiten und wann, die Suchen und über welchen Anbieter, und Deine Notizen, die mitgingen oder gelesen wurden. Die Eigenschaften tragen dieselbe Liste als `sources`.
- **Adressen.** Jede Webadresse, die das Modell in seine Antwort geschrieben hat, steht so da, dass nichts sie öffnet oder lädt (`https[://]…`), und ein Bild aus dem Web ist in der Notiz nie ein Bild. Nur die Seiten unter **Quellen** sind echte Links: Adressen, die der Lauf mit Deiner Erlaubnis gelesen hat. Links zu Deinen eigenen Notizen bleiben Links.
- **Regeln.** Eine festgehaltene Antwort erbt die Datenschutzregeln dessen, worauf sie beruht. Ist eine Notiz, die im Gespräch mitging oder die der Assistent gelesen hat, von der Cloud oder vom Internet ausgenommen, trägt die neue Notiz dieselbe Regel — in die Notiz selbst geschrieben, wo ihr Ordner mehr erlauben würde. So erreicht eine Antwort, die ein Modell auf diesem Gerät aus einer privaten Notiz gemacht hat, auch als Notiz keine Cloud.

In einem geteilten Workspace können seine Mitglieder eine Notiz lesen — und ebenso die Leser einer Publikation, die den Ordner umfasst. Dort fragt Plainva jedes Mal, mit dem Namen der Notiz und dem Ordner: **Als Notiz festhalten** schreibt sie, **Nicht festhalten** lässt es.

## Datenschutzregeln

Manche Notizen sollen nie zu einem Cloud-Anbieter. Eine Regel kann im Frontmatter einer Notiz stehen:

```yaml
plainva:
  ai:
    cloud: deny
```

oder, für einen ganzen Ordner, in **Einstellungen → KI & Automatisierung** (dem Vault-Teil), das die Regeln in `.agent/policy.yml` schreibt. Eine von der Cloud ferngehaltene Notiz trägt nichts bei — weder Text noch Titel —, und Links auf sie in anderen Notizen werden zurückgehalten. Das gilt, wie auch immer ein Link die Notiz schreibt — mit ihrem Dateinamen, ihrem Titel oder einem Pfad —; und tragen zwei Notizen denselben Namen und eine davon ist ferngehalten, wird auch ein Link mit dem bloßen Namen zurückgehalten. Schreib den Ordner in den Link, um die gemeinte zu nennen. Modelle auf diesem Gerät bleiben erlaubt. Verschlüsselte Workspaces halten die Cloud aus, solange Du sie dort nicht erlaubst. Das genaue Format steht in der [Dateiformat-Referenz](File_Format_Reference.md).

Ein Bild gehört zu den Notizen, die es zeigen: Eines, das eine von der Cloud ferngehaltene Notiz einbettet, geht ebenfalls an kein Cloud-Modell (siehe Ein Bild erklären weiter oben).

Eine zweite Regel, `web: deny` — in den Einstellungen **Webzugriff: nie** —, hält eine Notiz oder einen Ordner aus jedem Gespräch heraus, das ins Internet darf.

Am iPhone und iPad entscheiden dieselben zwei Regeln, welche Notiztitel Siri und Kurzbefehle finden dürfen, sobald Du das eingeschaltet hast: Eine von der Cloud oder vom Webzugriff ferngehaltene Notiz wird ihnen nie genannt. Siehe „Siri und Kurzbefehle“ in [Die mobile App](Mobile_App.md).

## Verlauf und Verbrauch

Gespräche bleiben auf diesem Gerät, je Vault — nie im Vault und nie synchronisiert. **Gespräche aufbewahren** legt fest, wie lange; einzelne Gespräche löschst Du in der Liste, alle eines Vaults auf einmal in den Einstellungen. **Verbrauch diesen Monat** fasst die Token je Anbieter und Modell zusammen.

## Grenzen der Beta

- Am Desktop läuft die KI nur im Hauptfenster.
- Am Telefon kommt eine Antwort nur, solange die App geöffnet ist.
- Der Assistent ändert keine Notiz selbst: Eine Änderung an einer Notiz und das Transkript einer Sprachnotiz sind Vorschläge, die Du übernimmst oder ablehnst, Neues ist ein Entwurf, bis Du **Anlegen** drückst, eine E-Mail oder ein Termin ein Entwurf, bis Du selbst sendest oder speicherst, und Umbenennen, Verschieben und Löschen warten auf Dein Ja; in einem Kommentar-Faden schreibt er eine Antwort neben die Notiz, nie Text in sie. Eine Antwort wird nur dann zu einer Notiz, wenn Du **Als Notiz festhalten** drückst; dann schreibt Plainva sie, nicht der Assistent.

Rückmeldungen zur Beta gehen in die Diskussionen des Projekts auf GitHub: **Rückmeldung zur KI (Beta)** in den Einstellungen beginnt eine.
