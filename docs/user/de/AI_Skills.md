# Skills (Beta)

Stand: 2026-10-09

Ein Skill ist eine Anleitung für Arbeit, die wiederkommt: ein Meeting vorbereiten, die Aufgaben sortieren, ein Wochenrückblick. Plainva bringt zwölf davon mit, und Du kannst eigene schreiben. Skills nutzen das offene Format Agent Skills — ein Ordner mit einer `SKILL.md` — und funktionieren deshalb auch in anderen KI-Apps, die das Format lesen.

## Einen Skill benutzen

Starte einen Skill mit einem Klick: als Chip in einem leeren Gespräch (die drei meistgenutzten), unter **Skills** im KI-Tab, am Telefon unter **Gespräche → Skills** oder aus der Befehlspalette. Das Gespräch läuft dann mit dem Skill: seine Anweisungen gehen mit, und er benutzt nur die Werkzeuge und Ordner, die er nennt.

Du kannst auch einfach fragen. In jedem Gespräch kennt die KI Namen und Beschreibungen Deiner aktiven Skills und lädt einen, wenn Deine Frage passt — „Bereite mein nächstes Meeting vor“ genügt.

## Die mitgelieferten Skills

| Skill | Was er tut |
|---|---|
| **Tagesorientierung** | Was heute wichtig ist: fällige Aufgaben, Termine und woran Du zuletzt gearbeitet hast. |
| **Wochenrückblick** | Die letzten sieben Tage und die Woche, die kommt, mit drei Vorschlägen. |
| **Projektstatus** | Ziel, Fortschritt, offene Punkte und der nächste Schritt eines Projekts. |
| **Meeting vorbereiten** | Bereitet ein Meeting aus früheren Notizen und offenen Punkten vor oder fasst es hinterher zusammen. |
| **Aufgaben sichten** | Ordnet Deine offenen Aufgaben: was jetzt, was warten kann, was weg kann. |
| **Recherche** | Recherchiert eine Frage im Web und in Deinen Notizen, mit jeder Quelle beim Namen. |
| **E-Mail und Kalender** | Geht die letzten E-Mails und die nächsten Termine durch: was eine Antwort braucht, was vorzubereiten ist, welche Aufgaben folgen. |
| **Schreiben und überarbeiten** | Fasst eine Notiz zusammen, kürzt sie oder schreibt sie um — als Text, den Du übernimmst. |
| **Wissen pflegen** | Findet Notizen, die dasselbe sagen, veraltet sind oder mit nichts verbunden. |
| **Links bereinigen** | Prüft die Links einer Notiz: ins Leere, fehlend, einseitig. |
| **Datenschutz prüfen** | Findet, was aus einer Notiz besser auf diesem Gerät bleibt, und schlägt eine Regel vor. |
| **Reflexion** | Blickt mit Dir auf die Notizen eines Tages oder einer Woche zurück — freundlich, nie eine Diagnose. |

Alle lesen nur: keiner ändert eine Notiz oder sendet etwas. Nur **Recherche** benutzt das Internet, und nur **E-Mail und Kalender** liest Deine E-Mails — siehe unten. Datenschutz prüfen und Reflexion sind für ein Modell auf diesem Gerät gedacht; mit einem Cloud-Modell sagt die Sende-Übersicht das. Jeden Skill schaltest Du unter **Skills** aus — der Schalter gilt für diesen Vault auf diesem Gerät. **Eigene Fassung anlegen** kopiert einen in Deinen Vault, wo Du ihn ändern kannst.

## Im Internet und in Deinen E-Mails

**Recherche** ist der eine mitgelieferte Skill, der das Internet benutzt. Ihn zu starten ist Deine Wahl für sein Gespräch, wie die Weltkugel unter dem Eingabefeld: Wo Du **Die KI darf in diesem Vault ins Internet** eingeschaltet hast, sucht er und liest Seiten — und solange Deine Notizen im Gespräch sind, fragt weiterhin jede Seite und jede Suche vorher, wie unter **Im Internet** in [KI-Assistent](AI_Assistant.md) beschrieben. Wo der Schalter aus ist, recherchiert er nur in Deinen Notizen und sagt das. Dasselbe gilt, wenn die KI den Skill von sich aus in einem Gespräch lädt, das Du ohne Internet begonnen hast.

**E-Mail und Kalender** liest E-Mails über dieselbe Frage wie jedes Gespräch: beim ersten Mal **E-Mails lesen?** Den Text einer Nachricht liest er nie selbst; ein zweiter Leser ohne Werkzeuge schreibt einen Bericht darüber. Beides steht in [KI-Assistent](AI_Assistant.md).

Ein eigener Skill benutzt das Internet nur, wenn seine Zeile `allowed-tools` `web_search` oder `fetch_url` nennt. **Prüfen und freigeben** sagt dann **Nutzt das Internet, wo Du es für diesen Vault erlaubt hast.**, bevor Du ihn freigibst. Ein Skill, der keine Werkzeuge nennt, bringt das Internet nie mit.

Ein Testlauf benutzt das Internet nie, und er fragt nie: E-Mails, die er in dieser Sitzung nicht lesen durfte, bleiben ungelesen.

## Änderungen vorschlagen

Ein eigener Skill schlägt Änderungen nur vor, wenn seine Zeile `allowed-tools` die Werkzeuge dafür nennt: `propose_edit` und `set_property` für Vorschläge am Text und an den Eigenschaften einer Notiz, `create_note`, `create_entry`, `create_task` und `add_journal_entry` für Entwürfe, `rename_note`, `move_note` und `delete_note` für Pläne. **Prüfen und freigeben** nennt dann jedes von ihnen und sagt **Kann Änderungen vorschlagen, Entwürfe hinlegen und Pläne vorlegen. Im Vault ändert sich nichts, bevor Du übernimmst, anlegst oder bestätigst.** Ein Skill, der keine Werkzeuge nennt, schlägt nichts vor — auch einer, den Du früher freigegeben hast, gewinnt nichts dazu —, und ein Testlauf legt nichts hin. Was die drei Formen sind, steht unter **Änderungen vorschlagen** in [KI-Assistent](AI_Assistant.md).

## Eigene Skills

**Neuer Skill** fragt nach einem Namen, einer Beschreibung — daran wählt die KI den Skill — und den Anweisungen. Plainva schreibt sie als `.agent/skills/<name>/SKILL.md` in Deinen Vault, wo sie wie jede Notiz mitreisen. **Bearbeiten** öffnet die Datei wie eine Notiz.

**Importieren …** nimmt einen Skill als `.zip`- oder `.skill`-Datei. Bevor etwas geschrieben wird, prüft Plainva ihn: genau ein Skill im Format, kein Pfad außerhalb seines Ordners, die Größengrenzen. Es nennt die Lizenz, Skripte, die es nicht ausführt, und Werkzeuge, die es nicht hat. Versteckte Dateien — Namen, die mit einem Punkt beginnen — gehören nicht zu einem Skill und bleiben außen vor.

## Nichts läuft, bevor Du es freigibst

Ein Skill in Deinem Vault, der neu ist oder sich geändert hat — per Sync, durch einen Import oder eine Bearbeitung auf diesem oder einem anderen Gerät —, läuft erst, wenn Du ihn **auf diesem Gerät** freigibst. Solche Skills warten oben unter **Skills** bei **Warten auf Deine Freigabe** und in **Einstellungen → KI & Automatisierung** (Teil Vault). **Prüfen und freigeben** zeigt, was der Skill darf, was sich seit Deiner letzten Freigabe geändert hat, seine Anweisungen, Dateien und wo er liegt. Die Freigabe gilt genau dieser Fassung; jede Änderung hebt sie wieder auf. Freigaben liegen auf diesem Gerät, nie im Vault.

Dasselbe gilt für eine `AGENTS.md` oben in Deinem Vault: freigegeben, gehen ihre stehenden Anweisungen in jedes neue Gespräch. Weder ein Skill noch die `AGENTS.md` kann Deine Datenschutzregeln aufheben, und ein Skill bekommt nie mehr, als ein Gespräch hat — er kann es nur enger machen. Eine Regel, die Du im Gedächtnis hinzufügst oder von der KI annimmst, ist eine weitere Zeile dieser Datei; siehe [Gedächtnis](AI_Memory.md).

## Skills mit einem Modell prüfen

Ein Skill kann Testszenarien mitbringen: eine Nachricht, die ihn startet, und was ein guter Lauf tut. Die mitgelieferten Skills haben welche; für eigene schreibst Du sie in `tests/scenarios.json` im Ordner des Skills:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` nennt die Werkzeuge, die ein guter Lauf benutzt, und die, die er nicht anrühren darf; `cites` die Notizen, die seine Antwort nennt; `never` Text, der darin nicht erscheinen darf. Ein Skill hat höchstens acht Szenarien.

**Mit ⟨Modell⟩ prüfen** — unten in **Skills** oder im Menü eines Skills — lässt die Szenarien gegen das Modell laufen, das ein neues Gespräch benutzen würde. Nichts startet von selbst: der Dialog sagt zuerst, wie viele Szenarien gegen welches Modell laufen würden, und Du setzt eine **Obergrenze** in US-Dollar; der Lauf endet zwischen zwei Szenarien, sobald sie erreicht ist. Ist für das Modell kein Preis bekannt, endet der Lauf stattdessen nach einer festen Zahl von Token; ein Modell auf diesem Gerät braucht keine Obergrenze.

Jedes Szenario ist ein gewöhnlicher Lauf seines Skills: es liest Deinen Vault wie ein Lauf von Hand, geht durch dieselbe Übersicht vor dem Senden, zählt zu Deinem Verbrauch und hinterlässt sein Gespräch im Verlauf, wo sein nächster Lauf es ersetzt. Danach zeigt jedes Szenario sein Ergebnis in Worten, und die Zeile des Skills sagt, wie sein letzter Lauf ausging. Ein Ergebnis gilt für ein Modell und eine Fassung des Skills: wählst Du ein anderes Modell oder änderst den Skill, sagt die Zeile das, statt ein Ergebnis zu zeigen, das nicht mehr zählt. Einige der mitgelieferten Szenarien fragen nach Notizen aus Plainvas eigenem Test-Vault; in Deinem Vault gelten sie nicht, und der Dialog zählt sie gesondert, statt sie als nicht bestanden zu werten.

## Aus einem Gespräch lernen

Ein Gespräch kann etwas hinterlassen: einen Fakt, der sich zu wissen lohnt, eine Regel oder einen Skill, der nicht weit genug ging. **Aus diesem Gespräch lernen** — im Menü eines Gesprächs in der Liste und unter seiner letzten Antwort — fragt danach. Nichts liest Deine Gespräche im Hintergrund.

Ein Dialog sagt zuerst, was geschehen würde: das Gespräch geht noch einmal an das Modell, das es geführt hat, und an kein anderes — was Du geschrieben hast und was geantwortet wurde, mit den Namen der benutzten Werkzeuge. Nichts, was ein Werkzeug zurückgab, geht mit, und keine Notiz. Wo ein eigener Skill im Gespräch lief, gehen seine Anweisungen mit, damit eine bessere Fassung vorgeschlagen werden kann. **Lernen** startet die Durchsicht; sie kostet eine Anfrage.

Zurück kommen Entwürfe, jeder mit dem **Beleg**, den die Durchsicht dafür nennt, und nichts davon gilt, bevor Du es übernimmst. Über einen Eintrag fürs Gedächtnis und über eine Regel entscheidest Du auf ihrer Karte, wie unter [Gedächtnis](AI_Memory.md) beschrieben. Der Entwurf eines Skills hat stattdessen den Knopf **Ansehen**.

Ein Gespräch, das eine Webseite, eine E-Mail oder ein externes Werkzeug gelesen hat, schlägt nur Einträge fürs Gedächtnis vor: was ein Fremder geschrieben hat, wird keine Regel und kein Skill. Dasselbe gilt, wo das Gespräch auf Notizen beruht, die nicht in die Cloud oder nicht ins Internet dürfen, und Einträge daraus tragen diese Regel. Ein Gespräch, das mit einem Modell auf diesem Gerät lief, wird auf diesem Gerät durchgesehen.

### Einen Vorschlag für einen Skill übernehmen

**Ansehen** zeigt Zeile für Zeile, was sich ändern würde, und was der Skill darf — das bleibt, wie es ist: ein Vorschlag ändert die Anweisungen eines Skills und sonst nichts. Seine Werkzeuge, Ordner und Grenzen setzt nie ein Modell. Der Dialog sagt außerdem, ob die jetzige Fassung geprüft ist, was ein Lauf mehr oder weniger kostet und aus welchem Gespräch der Vorschlag stammt. **Überarbeiten** macht aus dem Vergleich ein Feld, in dem Du schreiben kannst.

**Übernehmen** schreibt die neue Fassung und gibt sie auf diesem Gerät frei, denn Du hast sie hier gesehen. Auf Deinen anderen Geräten wartet der Skill dann auf die eigene Freigabe, wie nach jeder Änderung. Ein Vorschlag für einen neuen Skill beginnt mit den Vorgaben von Plainva: er liest und zeigt, und ändert nichts. Einen Skill, den Du importiert hast, und die Skills, die mit Plainva kommen, schreibt ein Vorschlag nie um.

### Fassungen unter Beobachtung und der Weg zurück

Eine Fassung, die aus einem Vorschlag stammt, steht drei Läufe lang unter Beobachtung, und ihre Zeile zählt sie. Endet ein Lauf ohne Antwort, nennt die Skills-Ansicht den Skill unter **Fassungen unter Beobachtung** und bietet zweierlei an: **Zurück zur vorigen Fassung** oder **Behalten**. Zurückgegangen wird nie von selbst.

**Frühere Fassungen …** im Menü eines Skills zeigt, was der Versionsverlauf des Vaults von der Datei des Skills aufbewahrt. Der Dialog hält die gewählte Fassung gegen den Skill, wie er jetzt ist — seine Zeilen und was er darf —, und warnt, wo die frühere Fassung mehr darf. **Diese Fassung wiederherstellen** schreibt sie zurück und gibt sie auf diesem Gerät frei. Die Fassungen liegen auf diesem Gerät.

Für einen Skill, der sich auf andere Weise geändert hat — durch Sync oder eine Bearbeitung auf einem anderen Gerät —, sagt **Prüfen und freigeben** dasselbe unter **Gegenüber der freigegebenen Fassung**: welche Werkzeuge dazukamen und wegfielen, die Ordner, die Grenze.

Unter **Was gelernt wurde** öffnet die Skills-Ansicht `.agent/logs/learning.md`: eine Zeile für jeden Skill und jede Regel, die aus einem Vorschlag übernommen wurden, mit Tag und Gespräch. Die Datei reist mit Deinem Vault.

## Was an den Anbieter geht

Die Sende-Übersicht nennt unter **Anweisungen**, was mitgeht: den Skill des Gesprächs, die Liste der Skills, die die KI laden darf, und die `AGENTS.md`. Gehen Anweisungen aus Deinem Vault zum ersten Mal an eine Cloud, kommt die Übersicht wieder. Unsichtbare Zeichen in einem Skill erreichen nie ein Modell.

## Grenzen der Beta

Ein Skill führt keine eigenen Skripte aus; für kleine Programme, die Deinen Vault lesen, siehe [Skripte](AI_Scripts.md). Deine eigenen Skills werden KI-Apps, die über den MCP-Server verbunden sind, nicht angeboten; nur die mitgelieferten.
