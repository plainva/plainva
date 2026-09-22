# Journal

Last updated: 2026-09-22

The journal is the quick way to write something down without opening a note: a thought, a phone call, a line about the day. Every entry is a plain list line with a time — `- 14:05 Router is in the basement` — under a heading of **today's daily note**. There is no new file format and no database: the entries live in your daily notes, readable in any editor and compatible with the journal plugins of Obsidian (Thino, Knomo).

## Writing an entry

One field, one **Enter**. Plainva stamps the time; you only type the text. Tags, links and a second line are simply typed — the text is ordinary Markdown.

- **On the desktop:** `Ctrl+Shift+J` opens the **Journal entry** field from anywhere in Plainva. The same field is in the **＋** menu of the sidebar, in the command palette and in the tray menu (**Journal entry**). `Enter` saves, `Shift+Enter` starts a new line, `Esc` discards.
- **On the phone:** the **＋** button offers **Journal entry**; the journal screen has its own pen button. A long press on the app icon offers **Journal entry** as well — as an app shortcut on Android, as a quick action on iOS. `Enter` stays a line break there; **Save entry** saves.
- **From the share sheet (phone):** choose Plainva and tick **Into the journal** — text and link become the entry, shared files land in the attachments folder and are embedded.
- **With a picture:** the phone's field has **Add a photo**; on the desktop you paste an image from the clipboard into the field. The picture goes where attachments go and is embedded in the entry.

If today's daily note does not exist yet, it is created on the way — from your daily-note template, without asking its questions. After saving, a notice says **Entry saved** and offers **Undo**.

The field has one job: a journal entry. Below it, **Create a task instead** hands what you typed to the [tasks view](Tasks.md), where a task is made as usual, and closes the field. The chip **As a task** is something else: it leaves the entry in the journal and gives it a box (`- [ ] 14:05 order the spare part`), so it also shows up in the tasks view under **From notes**. The chip's box stays empty until you choose it.

## The journal view

**Open journal** (action rail on the desktop, **Areas** on the phone, or the command palette) shows all days as one stream: the newest day on top, within a day the newest entry first. Links open, tags are pills, an embedded image shows as a preview, and a long entry is folded — **More** opens it.

- **Stream or cards:** the switch in the view's header — **Stream** and **Cards** — shows the same entries in two shapes. The stream reads a day downwards, the card wall lets a week be scanned; every day keeps its own wall with a rule above it. Cards can do what rows can: tapping opens the place in the note, right-click or a long press opens the same actions, task boxes tick. The choice is remembered by **the device** — the stream on your phone and the wall on a wide screen, if that is what you want.
- **Search and filter:** the search field looks through the loaded days; the chips **All**, **Tasks only** and the most frequent tags narrow the stream. A click on a tag in an entry filters by it.
- **Older days:** Plainva loads the last 14 days that have entries. **Load older** fetches the next stretch; **Go to a day** opens the date picker, in which days with entries are marked, and loads as far back as the day you pick.
- **Open note** in a day's heading opens that daily note; a click on an entry opens the note at that line.
- **Checkboxes** of task entries can be ticked right in the stream. They behave as in the task view, including the completion date and the next occurrence of a repeating task.

Each entry has a menu (right-click or **⋯** on the desktop; **⋯**, a long press or a swipe on the phone): **Edit** changes the text in place and keeps the time, **Copy** copies the text, **Turn into a task** adds the checkbox and **Turn back into an entry** removes it, **Show in the note** jumps to the line, **Delete** removes the entry — with **Undo** in the notice that follows.

The entries of a single day also appear where you look at that day: as the **Journal** section of the desktop's right sidebar (for the open daily note's day, otherwise today), and on the phone's **Today** screen for the selected day. In the sidebar it is a section like any other — it collapses, remembers that, can be hidden, and starts closed. Its rows are one line each: nothing is operated there, every row begins on the same edge, and a task carries a quiet mark on the right instead of a box (tick it in the stream or in the note). The pen in the heading opens the ordinary **Journal entry** field for exactly that day, and **All days** leads to the stream.

## How an entry is stored

```markdown
## Journal

- 09:12 Called the workshop #client
- [ ] 10:30 Order the spare part
- 14:05 Router is in the basement
  The key is with Mrs Berger.
```

- Entries are appended at the end of the section, so the file reads chronologically; the view shows the newest on top.
- The heading is **Journal** by default and can be changed per vault under **Settings → Vault → Content & structure** (**Journal heading**; on the phone under **Settings → Content & structure**). Its level does not matter. If the heading is missing, Plainva adds `## Journal` at the end of the note. Changing the setting does not rename existing headings.
- **The day ends at** (same place in the settings) moves the edge of the day later: set to **04:00**, everything you write between midnight and four still belongs to the day before — the entry goes into yesterday's daily note and keeps its real time (`- 01:30 …`). The day heading in the journal then says **until 04:00**. The boundary applies to the daily note and the journal, **not** to the calendar and not to when a task is due: an appointment at 01:30 on Wednesday stays on Wednesday. The default is **Midnight**; the setting belongs to the vault and holds on every device.
- **Mood:** when the setting **Mood: property of the daily note** (same place) carries a name — `mood`, say — the day heading in the journal shows five dots and you rate the day there with one press. The daily note then holds `mood: 4`; pressing the current value clears it again. The same property can be a **Rating** column in a database and sorted there. Leave it empty and this vault rates no days, and the day heading shows nothing.
- **Voice memo**: the microphone icon in the capture field records. While it runs you see the elapsed time and have two ways out: **Discard** throws the take away, **Attach** writes it into the attachments folder and adds it to the entry. The file name carries the date and time (`Voice memo 2026-09-22 1430.m4a`). Plainva asks for microphone access on the **first** tap, never at startup, and records nothing unless you start a take; the recording stays in your vault and goes nowhere.
- Plainva also reads `- 14:05:30 Text` (with seconds) and entries with a checkbox, and it continues the list the way your note writes it (`-`, `*` or `+`, with or without blank lines between entries). Existing lines are never reformatted.
- A change that cannot be placed safely — for example because a code block in the section was never closed — is refused with a message, and the field keeps your text.

The exact format is in the [File Format Reference](File_Format_Reference.md).

## Two devices at the same time

If two devices add entries to the same daily note before they have synced, that is **not a conflict**: Plainva merges the entries by time, and every line of both devices is kept. This also holds when both devices created the day's note independently. Any other simultaneous change to the note is handled as carefully as before (see [Sync Compatibility](Sync_Compatibility.md)).

## Global quick capture (desktop, optional)

Under **Settings → Startup & behavior → Global quick capture** you can switch on **Capture from anywhere with a system-wide shortcut**. The shortcut — `Ctrl+Alt+J` by default (`Cmd+Option+J` on macOS) — then opens a small window with the entry field even while another application is in front, as long as Plainva is running (in the tray, too). `Enter` writes the entry into today's daily note of the vault that is open in Plainva and closes the window; `Esc` discards.

- **Change** records a new shortcut: press the combination you want, with `Ctrl`, `Alt` or the Windows/Command key. **Reset to default** brings the default back.
- If another application already uses the shortcut, or the system does not accept it, Plainva says so under the switch instead of leaving a shortcut that does nothing.
- Under **Wayland** (Linux) the system gives applications no system-wide shortcut; Plainva says so and registers nothing. The tray entry and `Ctrl+Shift+J` lead to the same field.
- The shortcut belongs to the device and is not part of the settings profile.
