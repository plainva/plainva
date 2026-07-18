# Calendar & external tasks

Last reviewed: 2026-07-18

Plainva can connect your existing calendar and task accounts — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendar + Tasks) and **Microsoft** (Outlook calendar + To Do) — and work with them in both directions. Your notes stay the center: events can become meeting notes, and external task lists mirror into your [standard task database](Tasks.md) as ordinary notes.

## Connecting an account

Open **Settings → your vault → Calendar & accounts → Add account…** and pick a provider:

- **CalDAV**: server URL, user name and an **app password** (in Nextcloud: Settings → Security → Devices & sessions). No registration, no keys.
- **Google**: needs your own OAuth client ID (the same BYO model as the Google Drive sync — see the [Drive guide](Google_Drive_BYO_Guide.md)). In your Google Cloud project, additionally enable the *Google Calendar API* and *Google Tasks API* and add their scopes to the consent screen. The browser opens for consent; connecting validates the account before anything is saved.
- **Microsoft**: just click **Connect** and confirm in the browser — no setup needed.

Each account lists its **calendars** (checked ones appear in the calendar tab) and its **task lists** (deliberately unchecked by default — ticking one starts the task sync described below). Passwords and tokens live in your operating system's keychain. The **Meetings folder** setting below the accounts chooses where meeting notes are created.

## The calendar tab

Open it from the left action rail (calendar icon) or the command palette (**Open calendar**). Five views are available via the switch in the header: **Day**, **3 days** and **Week** show a **time grid** with an hour gutter on the left; events sit as blocks at their start time, their height is the duration, overlapping events sit side by side, and a red line marks "now". All-day events and (with the task overlay on) due tasks sit in the strip above the grid. **Month** shows the month grid (one colored dot per calendar) plus a single-day time grid for the selected day on the right. **Agenda** lists the upcoming weeks grouped by day. **Today** jumps back; the arrows page by the current period (a day, three days, a week or a month). The first day of the week follows the **Week starts on** setting (Settings → App → Appearance: Monday, Saturday or Sunday) — it also applies to the sidebar calendar. The view refreshes automatically every few minutes; the refresh button forces it.

- **Create an event**: **clicking an empty slot in the time grid** opens a small quick-create popover (title, time, calendar, location) — **Save** creates it right away, **More options** opens the full event dialog. **Dragging** across the grid sets the duration. The **+** in the header opens the full dialog: title, calendar, date/time or an all-day range, location, a **description**, and an optional simple **repeat** (daily/weekly/monthly/yearly).
- **Edit / delete**: **clicking an event** in the time grid opens the dialog prefilled with its values and with **Meeting note** and **Delete** actions. Changes are written to the provider with a safety check: if the event changed remotely in the meantime, Plainva refreshes instead of overwriting.
- **Move / resize**: you can **drag** an event straight in the time grid — dragging the body reschedules it (across to another day in the week/3-day view too), dragging its **bottom edge** changes its duration. The new time is written to the provider right away (recurring events stay editable only via the dialog for now).
- **Recurring events** carry a repeat badge. Editing or deleting an instance asks **"Only this event"** (creates an exception / skips just that occurrence) or **"All events"** (changes the whole series). Plainva never rewrites an existing recurrence rule.
- **Show tasks** (next to the refresh button, when a standard task database is set): overlays the due-dated entries of your [standard task database](Tasks.md) onto the time-grid strip and the month grid; completed tasks appear struck through. Off by default, the choice is remembered per device.

## Event → meeting note

The note icon on any event creates (or re-opens) its **meeting note** — a normal note in your meetings folder named `YYYY-MM-DD Title.md`, pre-filled with the date, location and attendees, plus a small `plainva.pim` marker in the frontmatter that ties it to the event. Clicking the same event again always opens the same note; a note of yours that happens to share the name is never touched.

## External task lists in your task database

Tick a **task list** on a connected account and its tasks appear as notes in your [standard task database](Tasks.md): the title becomes the note (H1), the due date lands in the database's date column, and completion maps to the database's **done checkbox property** (the status column follows it; a database without a checkbox column uses the status convention — first option = open, last = done). The sync is two-way and field-wise:

- Edit the note (title, due, status) → the change is pushed to the provider.
- Change the task remotely → the note follows.
- If both sides changed, your local edit wins for that field; the rest follows the remote.

Two safety rules protect your data: **deleting the note never deletes the remote task** (it just stops syncing and is not re-imported), and **a remotely deleted task never deletes your note** (it simply becomes a normal note). Renaming or moving a task note is fine — the frontmatter marker keeps the link.

Current limits: tasks created as plain notes are not pushed to the provider (create them remotely or via the task database), and everything on this page is desktop-first for now.
