# Journal

Last updated: 2026-09-20

The journal is the quick way to write something down without opening a note: a thought, a phone call, a line about the day. Every entry is a plain list line with a time — `- 14:05 Router is in the basement` — under a heading of **today's daily note**. There is no new file format and no database: the entries live in your daily notes, readable in any editor and compatible with the journal plugins of Obsidian (Thino, Knomo).

## Writing an entry

One field, one **Enter**. Plainva stamps the time; you only type the text. Tags, links and a second line are simply typed — the text is ordinary Markdown.

- **On the desktop:** `Ctrl+Shift+J` opens the **Journal entry** field from anywhere in Plainva. The same field is in the **＋** menu of the sidebar, in the command palette and in the tray menu (**Journal entry**). `Enter` saves, `Shift+Enter` starts a new line, `Esc` discards.
- **On the phone:** the **＋** button offers **Journal entry**; the journal screen has its own pen button. A long press on the app icon offers **Journal entry** as well — as an app shortcut on Android, as a quick action on iOS. `Enter` stays a line break there; **Save entry** saves.
- **From the share sheet (phone):** choose Plainva and tick **Into the journal** — text and link become the entry, shared files land in the attachments folder and are embedded.
- **With a picture:** the phone's field has **Add a photo**; on the desktop you paste an image from the clipboard into the field. The picture goes where attachments go and is embedded in the entry.

If today's daily note does not exist yet, it is created on the way — from your daily-note template, without asking its questions. After saving, a notice says **Entry saved** and offers **Undo**.

The field has two kinds, **Task** and **Journal**. **Task** hands what you typed over to the [task view](Tasks.md), where a task is created the usual way. The chip **As a task** is something else: it keeps the entry in the journal and gives it a checkbox (`- [ ] 14:05 Order the spare part`), so it also shows up in the task view under **From notes**.

## The journal view

**Open journal** (action rail on the desktop, **Areas** on the phone, or the command palette) shows all days as one stream: the newest day on top, within a day the newest entry first. Links open, tags are pills, an embedded image shows as a preview, and a long entry is folded — **More** opens it.

- **Search and filter:** the search field looks through the loaded days; the chips **All**, **Tasks only** and the most frequent tags narrow the stream. A click on a tag in an entry filters by it.
- **Older days:** Plainva loads the last 14 days that have entries. **Load older** fetches the next stretch; **Go to a day** opens the date picker, in which days with entries are marked, and loads as far back as the day you pick.
- **Open note** in a day's heading opens that daily note; a click on an entry opens the note at that line.
- **Checkboxes** of task entries can be ticked right in the stream. They behave as in the task view, including the completion date and the next occurrence of a repeating task.

Each entry has a menu (right-click or **⋯** on the desktop; **⋯**, a long press or a swipe on the phone): **Edit** changes the text in place and keeps the time, **Copy** copies the text, **Turn into a task** adds the checkbox and **Turn back into an entry** removes it, **Show in the note** jumps to the line, **Delete** removes the entry — with **Undo** in the notice that follows.

The entries of a single day also appear where you look at that day: under the calendar in the desktop's right sidebar (for the open daily note's day, otherwise today), and on the phone's **Today** screen for the selected day. Both have a small field that writes into exactly that day, and **All days** leads to the stream.

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
