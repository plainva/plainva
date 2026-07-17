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

Open it from the left action rail (calendar icon) or the command palette (**Open calendar**). You get a month grid with your events (one colored dot per calendar) and a day pane listing the selected day — all-day events first, then timed ones with time, calendar name and location. The view refreshes automatically every few minutes; the refresh button forces it.

- **New event**: the **+** in the day pane — title, calendar, date/time or an all-day range, location, and an optional simple **repeat** (daily/weekly/monthly/yearly).
- **Edit / delete**: the pencil and trash icons on an event. Changes are written to the provider with a safety check: if the event changed remotely in the meantime, Plainva refreshes instead of overwriting.
- **Recurring events** carry a repeat badge. Editing or deleting an instance asks **"Only this event"** (creates an exception / skips just that occurrence) or **"All events"** (changes the whole series). Plainva never rewrites an existing recurrence rule.
- **Show tasks** (next to the refresh button, when a standard task database is set): overlays the due-dated entries of your [standard task database](Tasks.md) onto the month grid and day pane; completed tasks appear struck through. Off by default, the choice is remembered per device.

## Event → meeting note

The note icon on any event creates (or re-opens) its **meeting note** — a normal note in your meetings folder named `YYYY-MM-DD Title.md`, pre-filled with the date, location and attendees, plus a small `plainva.pim` marker in the frontmatter that ties it to the event. Clicking the same event again always opens the same note; a note of yours that happens to share the name is never touched.

## External task lists in your task database

Tick a **task list** on a connected account and its tasks appear as notes in your [standard task database](Tasks.md): the title becomes the note (H1), the due date lands in the database's date column, and completion maps to the status column (first option = open, last option = done). The sync is two-way and field-wise:

- Edit the note (title, due, status) → the change is pushed to the provider.
- Change the task remotely → the note follows.
- If both sides changed, your local edit wins for that field; the rest follows the remote.

Two safety rules protect your data: **deleting the note never deletes the remote task** (it just stops syncing and is not re-imported), and **a remotely deleted task never deletes your note** (it simply becomes a normal note). Renaming or moving a task note is fine — the frontmatter marker keeps the link.

Current limits: tasks created as plain notes are not pushed to the provider (create them remotely or via the task database), and everything on this page is desktop-first for now.
