# KI-Assistent (Beta)

Stand: 2026-09-24

Plainva kann Fragen zu Deinen Notizen mit einem KI-Modell Deiner Wahl beantworten. Es liest Deinen Vault, nennt die Notizen, auf die es sich stützt, und kann Notizen und Ansichten für Dich öffnen — es ändert nichts. Der Assistent ist **experimentell** und aus, bis Du ihn einschaltest, auf jedem Gerät für sich.

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

## Fragen

- **Desktop:** der KI-Knopf in der Aktionsleiste, **Strg+J** (⌘J unter macOS) oder **KI fragen** in der Befehlspalette öffnet den Begleiter — ein kleines Fenster über Deiner Arbeit. **Als Tab öffnen** holt dasselbe Gespräch in den KI-Tab, wo Deine Gespräche aufgelistet sind.
- **Telefon:** **KI fragen** im ⋮-Menü einer Notiz öffnet das KI-Blatt über dieser Notiz. Der Bereich **KI** (im Bereiche-Blatt oder in der Navigationsleiste, wenn Du ihn dort hinlegst) zeigt das Gespräch im Vollbild; **Gespräche** listet die früheren.

Die Notiz, die Du offen hast, geht automatisch mit; nimm sie mit ihrem ✕ aus dem Kontext, wenn Du willst. **Notiz anheften …** fügt weitere Notizen hinzu. Der Assistent kann auch selbst nachsehen: er durchsucht den Vault, liest Notizen und ihre Abschnitte, listet Aufgaben und öffnet Notizen und Ansichten. Ändern, anlegen oder löschen kann er nichts.

Jedes Gespräch beginnt mit der Zeile „Antworten schreibt eine KI — ⟨Modell⟩ über ⟨Anbieter⟩“. Unter jeder Antwort steht, was wohin gesendet wurde: wie viele Notizen, ungefähr wie viele Token und — wo der Anbieter Preise veröffentlicht — die ungefähren Kosten. **Stopp** beendet eine Antwort jederzeit.

Ein Link in einer Antwort öffnet sich erst, nachdem Du seine Adresse bestätigt hast, und Bilder in Antworten werden nie geladen.

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
- Der Assistent liest; Änderungen als Vorschläge anbieten kommt in einer späteren Version.
