# OKF — Open Knowledge Format

Stand: 2026-09-04

OKF (Open Knowledge Format) ist eine offene Konvention für Markdown-Wissenssammlungen: reine Markdown-Dateien mit einem kleinen, einheitlichen Frontmatter-Kopf. Diese Seite erklärt, was OKF ist, was Plainva dafür automatisch tut — und warum Du nichts davon nutzen *musst*.

## Was ist OKF?

Die Idee: Jedes Dokument im Vault sagt selbst, was es ist. Dafür genügt ein Minimalkopf im Frontmatter:

```markdown
---
type: Note
---
# Meine Notiz
```

- **`type`** — welche Art Dokument das ist (z. B. `Note`, `Daily Note`, `Projekt`). Das einzige Pflichtfeld der Konvention.
- **`okf_version`** — die Version der Konvention, der der Vault folgt. Sie steht **einmal** in der Wurzel-`index.md` (aktuell `"0.2"`), nicht in jeder Notiz.
- **`index.md`** — pro Ordner darf eine `index.md` als Inhaltsverzeichnis liegen; die Namen `index.md` und `log.md` sind dafür reserviert und sollten nicht für normale Notizen verwendet werden.

> Schreibst Du Dateien mit einem Werkzeug oder Skript? Der genaue Feldvertrag — erlaubte Werte, wie jeder Eigenschaftstyp serialisiert wird und die Reservname-Regeln — steht in der [Dateiformat-Referenz](File_Format_Reference.md).

**Woher OKF kommt:** OKF ist eine offene Spezifikation von Google Cloud ([`GoogleCloudPlatform/knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), Apache-2.0-Lizenz). Plainva folgt **OKF 0.2** (veröffentlicht am 25. Juli 2026). Neu in 0.2 sind fünf optionale Felder, mit denen eine Notiz sagt, woher sie stammt, ob jemand sie geprüft hat und ob sie noch gilt — `generated`, `verified`, `sources`, `stale_after` und `status`. Was Plainva davon zeigt und schreibt, steht unten unter „Herkunft, Prüfung und Lebenszyklus".

## Warum nutzt Plainva OKF?

Reines Markdown ist wunderbar portabel — hat für sich genommen aber keine verlässliche Struktur. OKF ergänzt genau so viel davon wie nötig, und alles bleibt gewöhnliches Markdown mit Standard-Frontmatter:

- **Datenbanken, Filter und Vorlagen können sich auf Struktur verlassen.** Jede Notiz trägt einen `type` — so bleiben `.base`-Ansichten über reine Dateien robust.
- **Ordner bleiben navigierbar.** Eine `index.md` als Inhaltsverzeichnis pro Ordner funktioniert für Menschen wie für Werkzeuge.
- **Skripte und KI-Assistenten können sicher mit Deinem Vault arbeiten**, weil das Format auf der Platte einheitlich und dokumentiert ist.
- **Kein Lock-in.** OKF ist eine offene Konvention über reinem Markdown — auch andere OKF-Werkzeuge verstehen Deine Dateien, heute und in zehn Jahren.

## Was Plainva automatisch macht

**Neue Dateien** bekommen den OKF-Kopf automatisch: Jede in Plainva angelegte Notiz erhält `type` ins Frontmatter — die Versionsangabe `okf_version` steht seit OKF 0.2 nur noch einmal in der Wurzel-`index.md`, nicht mehr in jeder Notiz. Welche Werte, stellst Du pro Vault ein: **Einstellungen → Vault → Inhalt & Struktur → OKF (Open Knowledge Format)** → **type für neue Notizen** (Standard `Note`) und **type für Daily Notes** (Standard `Daily Note`). Bringt eine Vorlage ein eigenes `type` mit, gewinnt die Vorlage.

**Bestehende Dateien werden nie ungefragt verändert.** Plainva ergänzt OKF-Felder nur beim Anlegen neuer Dateien oder wenn Du die Konvertierung ausdrücklich startest.

**Geschützte Systemfelder:** Im **Eigenschaften**-Panel sind `type` und — wo es in älteren Notizen noch steht — `okf_version` als OKF-Systemfelder gekennzeichnet („OKF-Systemfeld – wird von Plainva verwaltet"): Der `type`-Wert ist per Dropdown bekannter Typen wählbar, `okf_version` ist reine Anzeige; Umbenennen, Typwechsel und Löschen sind gesperrt, damit die Konvention nicht versehentlich bricht.

**Das Erklärmodal:** **Was ist OKF?** in den Einstellungen gibt Dir die Kurzfassung in drei Sätzen und einen Link auf diese Seite. Es öffnet sich nicht mehr von selbst; enthält ein Vault Dateien, die dem OKF nicht folgen, sagt Plainva das einmalig in einer kleinen Meldung mit einem Knopf, der direkt zur Umwandlung führt.

## Herkunft, Prüfung und Lebenszyklus (OKF 0.2)

Seit OKF 0.2 kann eine Notiz sagen, woher sie stammt, wer sie geprüft hat und ob sie noch gilt. Plainva macht daraus drei Dinge:

**Was Plainva zeigt.**

- Eine Notiz mit `status: draft` oder `status: deprecated` trägt im Dokumentkopf ein Abzeichen — **Entwurf** bzw. **Eingestellt**. `stable` bleibt still; eine eigene `status`-Spalte mit anderen Werten (etwa `Offen` in einer Aufgaben-Datenbank) ist kein Lebenszyklus-Zustand und bekommt kein Abzeichen.
- Ist `stale_after` überschritten, steht über der Notiz der Hinweis **Als veraltet markiert (seit …)** mit einem Sprung zu den Eigenschaften. Der Hinweis ist reine Anzeige — Plainva ändert an der Notiz nichts.
- Der Abschnitt **Vertrauen & Herkunft** im Eigenschaften-Bereich (am Telefon: im Kontext-Blatt der Notiz) fasst die Felder zusammen und leitet daraus eine Vertrauensstufe ab: **Nicht geprüft**, **Maschinell bestätigt** oder **Von einer Person geprüft** — dazu Erzeugt-von, die Geprüft-Liste, Quellen als anklickbare Links, Status und Veraltet-ab. Die Zeilen **Status**, **Veraltet ab** und **OKF-Version** tragen übersetzte Beschriftungen; der Schlüssel, der in der Datei steht (`status`, `stale_after`, `okf_version`), erscheint als Hinweis am Schloss-Symbol und bleibt unverändert.

**Was Plainva schreibt.**

- `generated` (und, wo eine Quelle vorliegt, `sources`) setzen genau drei maschinelle Schreibwege: der **Import** (`plainva-import/<Version>`, ein Zeitpunkt je Lauf — auch der Import-Bericht trägt ihn), die **E-Mail-Erfassung** (`plainva-mail-capture/<Version>`, mit der Message-ID der Nachricht als Quelle) und der **Aufgaben-Abgleich** (`plainva-task-sync/<Version>`, nur beim Anlegen einer Notiz).
- `verified` schreibt nur **Als geprüft markieren** im Abschnitt **Vertrauen & Herkunft**: Plainva hängt `human:<Dein Name>` mit dem aktuellen Zeitpunkt an die Liste an — eine zweite Prüfung überschreibt die erste nie. Deinen Namen fragt Plainva einmal pro Vault ab; er bleibt auf diesem Gerät und ist unter **Einstellungen → Vault → Inhalt & Struktur → Prüfername** änderbar.
- Der Editor rührt keines dieser Felder von sich aus an, und bestehende Notizen werden nie nachträglich bestempelt. `status` und `stale_after` setzt Du selbst, als Eigenschaft oder im Frontmatter.

**Bundle-Version anheben.** Die Version der Konvention steht einmal in der Wurzel-`index.md`. Ein Vault, der noch `"0.1"` deklariert, funktioniert unverändert weiter — unter **Einstellungen → Vault → Inhalt & Struktur → Bundle-Version** (am Telefon: **Einstellungen → Vault → Wartung → Bundle-Version**) hebst Du ihn mit **Anheben…** auf 0.2. Der Dialog zeigt vorher, was sich ändert: die Zeile in der Wurzel-`index.md` und, als Häkchen (standardmäßig an), das Entfernen des veralteten `okf_version`-Feldes aus den Notizen, die es noch tragen. Vor jeder Änderung wird ein Backup angelegt; **Aufräumen…** erledigt nur den zweiten Teil. Die Feldtabelle und die Schreibregeln im Einzelnen stehen in der [Dateiformat-Referenz](File_Format_Reference.md).

## index.md: das Inhaltsverzeichnis je Ordner

Eine `index.md` ist das Inhaltsverzeichnis eines Ordners: eine Liste der enthaltenen Notizen und Unterordner mit Beschreibungen und relativen Links.

- **Erzeugen** — immer auf Deine Aktion hin, nie automatisch aus dem Nichts: Rechtsklick auf einen Ordner → **index.md erzeugen/aktualisieren**, oder gesammelt über die **index.md-Verwaltung** (**Einstellungen → Vault → Inhalt & Struktur**).
- **Übernehmen statt erzeugen** — hast Du bereits Überblicksnotizen (MOC, Übersicht, Folder-Note, README …), schlägt die Verwaltung sie als Kandidaten vor. **Übernehmen** benennt die Datei zu `index.md` um (Links werden vault-weit aktualisiert) und kann sie optional OKF-konform aufbereiten.
- **Automatische Pflege** — von Plainva *erzeugte* Listings tragen am Dateiende eine unsichtbare Markierung (ein HTML-Kommentar). Nur solche markierten Dateien hält Plainva automatisch aktuell, sobald sich im Ordner etwas ändert — und nur in OKF-Vaults (erkennbar an `okf_version` in der Wurzel-`index.md`).
- **Schreibgeschützt mit Ausweg** — verwaltete index.md-Dateien öffnen im Lesemodus mit dem Banner „Diese index.md wird von Plainva verwaltet und automatisch aktualisiert." Dort kannst Du **Aktualisieren** — oder **Trotzdem bearbeiten**: Das entfernt die Markierung, und die Datei gehört wieder ganz Dir (keine automatischen Updates mehr).
- **Alle auf einmal** — **Alle index.md aktualisieren** gibt es im Kontextmenü des Vault-Stamms und in den Einstellungen; Dateien ohne Markierung werden dabei übersprungen.
- **Lücken füllen** — im index.md-Manager wählt der Knopf **In allen Ordnern ohne index.md erzeugen** jeden Ordner vor, der noch keine index.md hat, sodass Du sie in einem Durchgang anlegst.
- **Am Telefon** — dasselbe mit zwei Türen: Beim Halten eines Ordners bietet das Blatt **Übersicht erzeugen** bzw. **Übersicht aktualisieren** an — je nachdem, was der Ordner braucht. Für den seltenen Aufräum-Durchgang über alles gibt es **Einstellungen → Vault → Wartung → Übersichten**: Ordner ohne Übersicht stehen oben, und **In allen N Ordnern ohne index.md erzeugen** legt sie in einem Zug an. Ein Ordner, dessen `index.md` Du selbst geschrieben hast, wird gelistet und in Ruhe gelassen — Übernehmen ist eine benannte Entscheidung in dieser Liste, kein Nebeneffekt eines Fingertipps. Auch die automatische Pflege läuft jetzt am Telefon: Ein dort bearbeiteter Vault veraltet nicht mehr, bis ein Desktop ihn öffnet.
- In der Leseansicht erscheinen verwaltete Listings als Karten mit Datei-/Ordner-Icons; Links öffnen direkt in Plainva.

## Einen bestehenden Vault konvertieren (Opt-in)

Wenn Dateien im Vault nicht dem OKF-Format entsprechen (fehlendes `type`-Feld oder reservierte Namen als normale Notiz), bietet Plainva die Konvertierung an — einmalig beim Öffnen des Vaults und dauerhaft unter **Einstellungen → Vault → Inhalt & Struktur** (der Eintrag erscheint nur, solange es etwas zu tun gibt).

Der Wizard **In OKF-Format überführen** arbeitet in klaren Schritten:

1. **Scan** — zeigt, wie viele Dateien betroffen sind (Vorlagen- und Systemordner sind ausgenommen; Dateien mit unlesbarem Frontmatter werden übersprungen, nie „repariert").
2. **Entscheidungen** — Standard-`type` für Dateien ohne `type`; bestehende `type`-Werte kannst Du **übernehmen** (empfohlen — sie sind bereits gültige OKF-Typen) oder in ein anderes Feld umbenennen lassen.
3. **Vorschau (ohne Änderungen)** — ein Dry-Run zeigt vorab, was sich ändern würde.
4. **Konvertieren** — vor jeder Änderung wird die Datei nach `.plainva/backups/` gesichert; ein Bericht fasst Geändertes, Übersprungenes und den Backup-Ordner zusammen. Danach geht es optional **weiter zur index.md-Verwaltung**.

Tipp aus dem Wizard: Die Änderungen laufen normal durch die Synchronisation — bei Git-Vaults vorher committen.

### Am Telefon

Denselben Weg gibt es auch mobil: **Einstellungen → Vault → Wartung → In OKF-Format überführen**. Der Ablauf ist derselbe — Scan, Entscheidungen, Vorschau, Konvertieren —, und die Vorschau nennt die betroffenen Notizen namentlich, bevor etwas geschrieben wird.

Zwei Dinge kommen dazu, weil ein Telefon eine App jederzeit aus dem Speicher nehmen darf:

- **Anhalten und Fortsetzen.** Der Lauf hört an der nächsten Datei auf, wenn Du **Anhalten** tippst oder die App in den Hintergrund geht. Fortsetzen schreibt in denselben Backup-Ordner weiter — es entsteht kein zweiter.
- **Beim Start gefragt.** Bleibt ein Lauf unvollendet, sagt Plainva das beim nächsten Öffnen und bietet **Fortsetzen** oder **Zurückrollen** an; **Später** ist eine gültige Antwort. Ein unterbrochener Lauf lässt einen unvollständig konvertierten Vault zurück, keinen kaputten: Es werden nur Frontmatter-Felder ergänzt, jede Notiz bleibt gültiges Markdown.

**Zurückrollen** stellt die Dateien aus dem Backup-Ordner wieder her — auch am Desktop, dort im Bericht am Ende des Laufs. Der Backup-Ordner bleibt danach liegen; er ist die einzige Kopie des Zustands vor der Konvertierung.

## Muss ich OKF nutzen?

Nein. OKF ist ein sanfter Standard:

- Neue Dateien bekommen den Kopf automatisch — das stört nirgends und kostet nichts.
- Bestehende Vaults (z. B. aus Obsidian) funktionieren unverändert weiter; die Konvertierung ist strikt Opt-in.
- Ein fehlendes `okf_version` — oder eines, das in älteren Notizen noch steht — gilt nicht als Verstoß; Du kannst Plainva und Obsidian dauerhaft parallel nutzen, ohne Dauer-Hinweise.
- Obsidian und jeder andere Editor können alle Dateien weiterhin öffnen: Es ist und bleibt normales Markdown.

## Siehe auch

- [Dateiformat-Referenz](File_Format_Reference.md) — der genaue Formatvertrag für jede Vault-Datei
- [Notizen & Markdown](Notes_and_Markdown.md) — Frontmatter und Eigenschaften
- [Datenbanken (.base)](Databases_Base.md) — was ein einheitlicher `type` praktisch bringt
- [FAQ & Fehlerbehebung](FAQ.md) — u. a. Backups und schreibgeschützte index.md
