# Externe Agenten (Beta)

Stand: 2026-10-07

Ein externer Agent ist ein KI-Programm eines anderen Herstellers — ein Agent, den Du auf Deinem Rechner installiert und bei dem Du Dich selbst angemeldet hast, mit Deinem eigenen Abo oder Schlüssel. Plainva kann so einen Agenten im Ordner eines Vaults starten und seine Sitzung im KI-Tab zeigen. Das gehört zu den experimentellen KI-Funktionen und geht nur am Desktop.

Ein externer Agent ist nicht Plainvas Assistent. Der [KI-Assistent](AI_Assistant.md) sendet nur, was seine Übersicht Dir gezeigt hat, und nie, was Deine Datenschutzregeln zurückhalten. Ein Agent liest und sendet selbst. Diese Seite sagt, was Plainva in so einer Sitzung kontrolliert — und was nicht.

## Was Plainva nicht kontrolliert

- **Das Programm.** Ein Agent ist das Programm eines anderen. Es läuft auf diesem Rechner mit Deinen Rechten, im Ordner des Vaults, und es ist nicht eingezäunt: es kann lesen und ändern, was Du lesen und ändern kannst.
- **Was er liest und sendet.** Er liest Dateien selbst — auch Notizen, die Du von der Cloud fernhältst — und sendet, was er auswählt, an seinen eigenen Dienst. Deine Datenschutzregeln und die Übersicht vor dem Senden erreichen ihn nicht, und nichts fragt Dich, bevor er sendet.
- **Was er selbst schreibt.** Eine Änderung, die der Agent selbst macht, steht sofort im Vault, ohne Vorschlag. Die Sitzung sagt es Dir, wenn der Agent so eine Änderung meldet; eine Änderung, die er nicht meldet, sieht Plainva nicht.
- **Seine Anmeldung.** Der Agent meldet sich selbst an. Plainva sieht seine Zugangsdaten nie und speichert keine.

Starte einen Agenten nur in einem Vault, dessen Inhalt den Dienst des Agenten erreichen darf.

## Was Plainva kontrolliert

- **Die eigenen Werkzeuge.** Wo **KI-Apps auf diesem Rechner diesen Vault lesen lassen** eingeschaltet ist, werden Plainvas Werkzeuge dem Agenten angeboten — dieselben wie für jede App in [KI-Apps verbinden](Connect_AI_Apps.md): nur die Ordner, die Du freigibst, nie eine von der Cloud oder vom Internet ferngehaltene Notiz, und nur lesend — es sei denn, Du erlaubst ihm dort, Änderungen vorzuschlagen.
- **Was der Agent Plainva zu lesen bittet.** Eine von der Cloud oder vom Internet ferngehaltene Notiz und Plainvas eigene Ordner werden nicht herausgegeben. Der Agent erfährt das, und Du auch.
- **Was der Agent Plainva zu schreiben bittet.** Geschrieben wird nichts. Eine Änderung an einer Notiz wird eine Vorschlagsrunde unter dem Namen des Agenten, und eine neue Notiz wartet als Entwurf, bis Du sie anlegst.
- **Kein Terminal.** Plainva bietet einem Agenten kein eigenes Terminal an.

## Einen Agenten hinzufügen

1. Installiere den Agenten selbst, so wie sein Hersteller es beschreibt, und melde Dich in seinem eigenen Programm bei ihm an.
2. Öffne **Einstellungen → KI & Automatisierung** (den App-Teil). Unter **Externe Agenten** kennzeichnet **Auf diesem Rechner gefunden** die Agenten, die Plainva dem Namen nach kennt und installiert findet; **Hinzufügen** nimmt einen auf. Für jedes andere Programm, das das Agent Client Protocol spricht, wähle unter **Anderer Agent** den Punkt **Agent hinzufügen …** und fülle **Name**, **Programm** und **Argumente, eines je Zeile** aus.
3. Dein System zeigt den ganzen Befehl noch einmal, bevor er gemerkt wird.

Plainva installiert keinen Agenten und lädt keinen herunter. Es startet genau das Programm, das Du bestätigt hast, direkt und ohne Shell. Der Befehl wird auf diesem Gerät gemerkt, nie im Vault. **Entfernen** lässt Plainva vergessen, wie ein Agent gestartet wird; das Programm selbst und seine Anmeldung bleiben, wie sie sind.

## Eine Sitzung starten

Öffne den KI-Tab und wähle **Agent**. Bevor etwas startet, zählt **Bevor Du ⟨Agent⟩ startest** auf, was der Agent selbst tut und was Plainva kontrolliert, und sagt, ob Plainvas Werkzeuge angeboten werden. **Sitzung starten** startet das Programm des Agenten im Ordner des Vaults. Beim ersten Start eines Agenten in einem Vault, seit Plainva geöffnet wurde, fragt Dein System noch einmal und zeigt den Ordner und den ganzen Befehl.

Es läuft eine Sitzung zur selben Zeit, und sie gehört zu dem Vault, in dem sie gestartet wurde: **Sitzung beenden** hält das Programm des Agenten an, und das Schließen des Vaults oder von Plainva tut es auch. Solange sie läuft, sagt die erste Zeile der Sitzung, wer der Agent ist und dass Deine Datenschutzregeln für ihn nicht gelten. In einem verschlüsselten Workspace wird kein Agent gestartet.

## Anmelden

Ein Agent, der nicht angemeldet ist, sagt es, und die Sitzung zeigt **⟨Agent⟩ verlangt eine Anmeldung** mit den Wegen, die der Agent nennt. Je nach Agent öffnet die Wahl ein Terminal-Fenster mit dem eigenen Programm des Agenten, oder der Agent führt Dich selbst zu seiner Anmeldung. Plainva wartet und startet den Agenten danach neu. Wo sich kein Terminal öffnen lässt, zeigt Plainva den Befehl, den Du in einem eigenen Terminal ausführst; wähle danach **Erneut versuchen**. Von der Anmeldung sieht Plainva nichts.

## In einer Sitzung

Schreib, was der Agent tun soll. Die Notiz, die Du offen hast, wird dem Agenten genannt — ihr Name und wo sie liegt, nicht ihr Text —, außer Du nimmst sie über dem Eingabefeld heraus; eine Notiz, die Du von der Cloud oder vom Internet fernhältst, wird nie genannt. Die Sitzung zeigt, was der Agent sagt, seinen Plan und jeden seiner Schritte, mit den Dateien des Vaults, die er nennt.

Will der Agent Deine Erlaubnis für einen Schritt, zeigt **⟨Agent⟩ fragt** ihn. Die Worte sind die des Agenten, und zur Wahl steht, was der Agent anbietet — **Erlauben**, **Immer erlauben**, **Ablehnen**, **Immer ablehnen**. Deine Antwort geht nur an den Agenten: was er nach einem Ja tut, ist seine Sache, und ein „immer“ ist ein Versprechen, das der Agent hält, nicht Plainva.

**Stopp** beendet die Antwort, an der der Agent gerade arbeitet.

## Was der Agent schreibt

**Über Plainva.** Eine Änderung, die der Agent an Plainva gibt, wird nie in die Notiz geschrieben. Ist die Antwort des Agenten fertig, trägt jede Notiz, die er geändert hat, eine Vorschlagsrunde, gezeichnet **⟨Name⟩ (externer Agent)**: unter **Vorschläge** übernimmst oder lehnst Du jede Änderung einzeln oder die ganze Runde ab, wie bei der Runde eines Menschen. Eine Eigenschaft, die der Text des Agenten ändert, steht in dieser Runde als vorgeschlagener Wert, wie einer, den Plainvas eigene KI vorschlägt. Eine Notiz, die es noch nicht gibt, wartet als Entwurf — als Karte **Entwurf · Notiz** in der Sitzung und als dieselbe Karte in der Liste **Offen** des KI-Tabs, wo sie auch nach dem Ende der Sitzung steht. **Anlegen** schreibt sie an genau den Ort, den der Agent genannt hat — gekennzeichnet mit `generated`, mit dem Agenten als Autor —, und **Verwerfen** lässt sie fallen. Web-Adressen, die der Agent mitgebracht hat, werden so geschrieben, dass nichts sie öffnet oder lädt (`https[://]…`).

Plainva nimmt nicht alles an: nur Markdown-Notizen; keine KI-Regeln, keine Vertrauensfelder und keine von Plainvas eigenen Eigenschaften; keinen Eigenschaftswert, der weder Text, Zahl, Ja oder Nein noch eine Liste davon ist; nichts, was von der Cloud oder vom Internet ferngehalten wird; nicht mehr als 150 Änderungen an einer Notiz auf einmal; und keine weitere neue Notiz, solange zu viele Entwürfe warten. Was es nicht angenommen hat, sagt die Sitzung, und der Agent erfährt es.

**Selbst.** Ein Agent kann Dateien auch selbst schreiben, wie jedes Programm. Meldet er so eine Änderung, sagt die Sitzung **Der Agent hat ⟨Notiz⟩ selbst geändert: Die Änderung steht ohne Vorschlag im Vault.** Welchen Weg ein Agent nimmt, kann Plainva nicht zusagen: es hängt vom Agenten ab und davon, wie er eingerichtet ist. In den Einstellungen zeigt jeder Agent, was auf diesem Rechner zuletzt beobachtet wurde — wie viele Änderungen über Plainva kamen und wie viele er selbst geschrieben hat.

## Was Plainva behält

- **Auf diesem Gerät:** den Befehl, den Du bestätigt hast, Deinen Namen für den Agenten und was zuletzt von seinen Änderungen beobachtet wurde — in Plainvas eigenen Daten, nie im Vault.
- **Je Vault:** **Letzte Sitzungen in diesem Vault** nennt, wann eine Sitzung lief, mit welchem Agenten, und wie viele Nachrichten, Änderungen über Plainva und eigene Änderungen es gab — nie, was gesagt wurde.
- **Nicht die Sitzung selbst:** was Du und der Agent gesagt habt, ist weg, sobald die Sitzung geschlossen ist. Was der Agent auf seiner Seite behält, ist Sache des Agenten.

Endet das Programm des Agenten von selbst, sagt die Sitzung das, und **Seine letzten Zeilen zeigen** zeigt das Ende dessen, was das Programm geschrieben hat.

## Grenzen

- Nur am Desktop und nur im Hauptfenster. Am Telefon gibt es Plainvas eigenen Assistenten.
- Nicht in einem verschlüsselten Workspace.
- Eine Sitzung zur selben Zeit, und kein Verlauf: eine beendete Sitzung lässt sich nicht wieder öffnen.
- Die eigenen Modi, Modelle und Befehle eines Agenten lassen sich aus Plainva nicht wählen, und Bilder lassen sich nicht an ihn senden.
- Bisher wurde das nur mit einem eigenen Test-Agenten von Plainva ausprobiert. Welche Agenten hier funktionieren und welche ihre Änderungen an Plainva geben, zeigt sich, wenn Du sie ausprobierst — Rückmeldungen sind willkommen.
