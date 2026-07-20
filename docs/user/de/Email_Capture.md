# E-Mail-Capture

Stand: 2026-07-20

Plainva kann Dein Postfach lesen, um Wissen aus E-Mails in Deinen Vault zu holen — und seit 0.4.0 auch Mails verfassen und senden. Der Schwerpunkt bleibt das **Ablegen** von Nachrichten als Notizen; ein über **IMAP** verbundenes Postfach wird für das Ablegen nur gelesen (im Postfach ändert sich nichts, nicht einmal die Ungelesen-Markierungen), solange Du den Versand nicht einrichtest.

> **Experimentell.** Der Mail-Client spricht mit echten externen Konten (IMAP/SMTP und Microsoft), die sich in Plainvas automatisierten Tests nicht durchspielen lassen. Er funktioniert und wird täglich genutzt, aber behandle ihn als Vorschau: Behalte ein Backup, und melde bitte alles, was seltsam aussieht.

## Ein Postfach verbinden

**Einstellungen → Dein Vault → Cloud-Konten → Konto verbinden…** und den Anbieter wählen:

- **Microsoft** — für Outlook.com und Microsoft 365: im Dienste-Schritt **E-Mail** anhaken (auf Wunsch zusammen mit **Dateien** und **Kalender & Aufgaben** — ein Konto, eine Anmeldung) und Dich direkt im Browser anmelden, ganz ohne App-Passwort oder IMAP. Plainva nutzt dafür die zentrale Plainva-App-Registrierung (Deine eigene App-ID kannst Du optional in den Konto-Details hinterlegen). Postfach lesen, ablegen und **direkt senden** laufen über die Microsoft-Anmeldung.
- **E-Mail-Server (IMAP)** — für alle anderen Anbieter: Host, Port und ein **App-Passwort**. Für Gmail ist das `imap.gmail.com`, Port `993`, mit einem App-Passwort von [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (setzt Zwei-Faktor-Anmeldung voraus) — kein OAuth, keine Verifizierung; der Assistent weist bei Gmail-Adressen selbst darauf hin. Für **web.de** und **GMX** stehen fertige Voreinstellungen bereit. Für den Direktversand kann ein SMTP-Host hinterlegt werden.

Beim Verbinden wird die Anmeldung geprüft, bevor irgendetwas gespeichert wird; die Zugangsdaten landen im Schlüsselbund Deines Betriebssystems. Die verbundenen Postfächer und die Ablage-Einstellungen findest Du danach im Bereich **E-Mail**: die Einstellung **E-Mail-Ordner** bestimmt, wo abgelegte E-Mails gespeichert werden (Standard `Mail`).

## Mails lesen

Öffne den Mail-Tab über die linke Aktionsleiste (Brief-Symbol) oder die Befehlspalette (**E-Mail öffnen**). Die Liste zeigt Deinen Posteingang, Neueste zuerst (Ungelesene fett, **Mehr laden** blättert weiter). Eine ausgewählte Nachricht öffnet sich im **Sandbox-Viewer**:

- **Externe Inhalte sind blockiert** — Tracking-Pixel, externe Bilder und Stil-Nachlader werden entfernt und gezählt („Externe Inhalte blockiert (n)"). Nur eingebettete Inline-Bilder werden angezeigt. **Bilder anzeigen** neben dem Zähler blendet die https-Bilder einer Nachricht einmalig ein; **Externe Bilder immer laden** in den Mail-Einstellungen macht daraus ein dauerhaftes Opt-in. Wichtig: Beim Laden externer Bilder sieht der Absender Deine IP-Adresse und wann Du die Mail geöffnet hast — deshalb ist Blockieren der Standard.
- Links erscheinen als reiner Text und sind im Viewer nicht klickbar.
- Skripte und Formulare laufen nie. Die Nachricht wird in einem isolierten Rahmen mit strikter Inhalts-Richtlinie dargestellt.

Anhänge werden mit Name und Größe gelistet; die Original-`.eml` (siehe unten) enthält sie vollständig.

## Eine Nachricht in den Vault holen

Drei Knöpfe an jeder Nachricht:

- **Als Notiz ablegen** — erstellt eine Notiz im E-Mail-Ordner (`JJJJ-MM-TT Betreff.md`) mit Absender und Datum im Frontmatter und dem Text der Mail unter der Betreff-Überschrift. Dieselbe Nachricht ein zweites Mal abzulegen öffnet die vorhandene Notiz, statt sie zu duplizieren.
- **+ .eml** — legt zusätzlich das rohe Original neben die Notiz und verlinkt es. Die `.eml` enthält alles, auch die Anhänge, und öffnet sich in jedem Mail-Programm.
- **→ Aufgabe** — erstellt einen Eintrag in Deiner [Standard-Aufgabendatenbank](Tasks.md) mit dem Betreff als Titel, dem heutigen Datum als Fälligkeit und dem offenen Status vorbefüllt.

## Verfassen und senden

Sobald ein Konto senden kann — ein **Microsoft**-Konto oder ein **IMAP**-Konto mit hinterlegtem **SMTP-Host** —, kannst Du in Plainva Mails schreiben und senden:

- **Verfassen** (im Mail-Tab) öffnet ein freischwebendes Fenster mit beschrifteten Zeilen **Von / An / Cc / Bcc**. Tipp eine Adresse und drück Enter oder Komma, um sie in einen Chip zu verwandeln; **Cc/Bcc** blenden sich bei Bedarf ein. Der Textkörper ist ein Markdown-Editor mit Formatierungsleiste und „/"-Befehlsmenü.
- **Antworten**, **Allen antworten** und **Weiterleiten** an jeder Nachricht öffnen dasselbe Fenster mit zitiertem Original und vorbelegten Empfängern; beim Weiterleiten kommen die Anhänge mit.
- **Senden** läuft über SMTP (IMAP-Konten) oder Microsoft Graph (Microsoft-Konten).
- **Diese Notiz per Mail** (⋮-Menü einer Notiz oder Befehlspalette) startet eine Nachricht mit der aktuellen Notiz als Anhang oder inline als Text.

## Eine Notiz ohne den Mail-Client weitergeben

Du musst nicht aus Plainva heraus senden. Das hier funktioniert an jeder Notiz und braucht kein SMTP:

- **Antwort als Notiz** (an einer Nachricht): erstellt eine Notiz an den Absender (`to:` im Frontmatter) mit dem zitierten Original — schreib Deine Antwort in Plainva.
- **Notiz als E-Mail-Entwurf ins Postfach** (Befehlspalette, an jeder offenen Notiz): legt die Notiz per IMAP als **Entwurf in Dein eigenes Postfach** — Konto, Empfänger und Entwurfsordner wählen, dann im normalen Mail-Programm öffnen, prüfen und von dort senden. Die Formatierung bleibt erhalten.
- **Notiz per E-Mail senden (mailto)** (Befehlspalette): öffnet Dein Standard-Mail-Programm mit der Notiz als reinem Text (lange Notizen werden gekürzt).
- **Notiz als E-Mail-Text kopieren** (Befehlspalette): legt die Notiz mit Formatierung in die Zwischenablage — in jeden Editor einfügbar.
