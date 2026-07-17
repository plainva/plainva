# E-Mail-Capture

Stand: 2026-07-18

Plainva kann Dein Postfach lesen — und nur lesen —, um Wissen aus E-Mails in Deinen Vault zu holen. Es ist bewusst **kein** Mail-Client: die Verbindung läuft über IMAP im Nur-Lesen-Modus, im Postfach ändert sich nichts (nicht einmal die Ungelesen-Markierungen), und Plainva versendet nie selbst.

## Ein Postfach verbinden

**Einstellungen → Dein Vault → Kalender & Konten → E-Mail (IMAP, nur Lesen) → Konto hinzufügen…**: Host, Port und ein **App-Passwort**. Für Gmail ist das `imap.gmail.com`, Port `993`, mit einem App-Passwort von [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (setzt Zwei-Faktor-Anmeldung voraus) — kein OAuth, keine Verifizierung. Beim Verbinden wird die Anmeldung geprüft, bevor irgendetwas gespeichert wird; das Passwort landet im Schlüsselbund Deines Betriebssystems. Die Einstellung **E-Mail-Ordner** bestimmt, wo abgelegte E-Mails gespeichert werden (Standard `Mail`).

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

## Inhalte hinausgeben — ohne zu senden

Plainva spricht nie SMTP. Stattdessen:

- **Antwort als Notiz** (an einer Nachricht): erstellt eine Notiz an den Absender (`to:` im Frontmatter) mit dem zitierten Original — schreib Deine Antwort in Plainva.
- **Notiz als E-Mail-Entwurf ins Postfach** (Befehlspalette, an jeder offenen Notiz): legt die Notiz per IMAP als **Entwurf in Dein eigenes Postfach** — Konto, Empfänger und Entwurfsordner wählen, dann im normalen Mail-Programm öffnen, prüfen und von dort senden. Die Formatierung bleibt erhalten.
- **Notiz per E-Mail senden (mailto)** (Befehlspalette): öffnet Dein Standard-Mail-Programm mit der Notiz als reinem Text (lange Notizen werden gekürzt).
- **Notiz als E-Mail-Text kopieren** (Befehlspalette): legt die Notiz mit Formatierung in die Zwischenablage — in jeden Editor einfügbar.
