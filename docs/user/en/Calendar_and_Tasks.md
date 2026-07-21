# Calendar & external tasks

Last reviewed: 2026-07-21

Plainva can connect your existing calendar and task accounts — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendar + Tasks) and **Microsoft** (Outlook calendar + To Do) — and work with them in both directions. Your notes stay the center: events can become meeting notes, and external task lists mirror into your [standard task database](Tasks.md) as ordinary notes.

> **Experimental.** The calendar talks to live external accounts (CalDAV, Google, Microsoft) that can't be exercised in Plainva's automated tests. It works and is used daily, but treat it as a preview: keep a backup, and please report anything that looks off.

## Connecting an account

Open **Settings → your vault → Cloud accounts → Connect account…**, pick a provider and tick **Calendar & tasks** in the services step:

- **Nextcloud / CalDAV**: server address, user name and an **app password** (in Nextcloud: Settings → Security → Devices & sessions). No registration, no keys — for Nextcloud, Plainva derives the CalDAV address from the server address itself (for other CalDAV servers use the **WebDAV / CalDAV** tile or **Advanced: set endpoints individually**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: dedicated tiles with the calendar addresses already filled in — email address plus an **app password** is enough, no server field (for Apple the app password is mandatory; the assistant links the provider's guide). Note: Yahoo itself flags its CalDAV service as unreliable — if it acts up, it is not Plainva.
- **Google**: needs your own OAuth client ID (the same BYO model as the Google Drive sync — see the [Drive guide](Google_Drive_BYO_Guide.md)). In your Google Cloud project, additionally enable the *Google Calendar API* and *Google Tasks API* and add their scopes to the consent screen. The browser opens for consent; connecting validates the account before anything is saved.
- **Microsoft**: just click **Sign in with Microsoft…** and confirm in the browser — no setup needed. One Microsoft account can also carry **Files** (OneDrive) and **Email** in the same pass.

The assistant shows a per-service status ("connected — n calendars found"). You then manage the **calendars** (checked ones appear in the calendar tab) and the **task lists** (deliberately unchecked by default — ticking one starts the task sync described below) in the **Calendar** area; the **Meetings folder** (where meeting notes are created) and the **Default calendar** live there too. Passwords and tokens live in your operating system's keychain.

## The calendar tab

Open it from the left action rail (calendar icon) or the command palette (**Open calendar**). Five views are available via the switch in the header: **Day**, **3 days** and **Week** show a **time grid** with an hour gutter on the left; events sit as blocks at their start time, their height is the duration, overlapping events sit side by side, and a red line marks "now". All-day events and (with the task overlay on) due tasks sit in the strip above the grid. **Month** shows the month grid (one colored dot per calendar) plus a single-day time grid for the selected day on the right. **Agenda** lists the upcoming weeks grouped by day. **Today** jumps back; the arrows page by the current period (a day, three days, a week or a month). The first day of the week follows the **Week starts on** setting (Settings → App → Appearance: Monday, Saturday or Sunday) — it also applies to the sidebar calendar. The view refreshes automatically every few minutes; the refresh button forces it. Events that have already ended read **dimmer** (like Google Calendar), so today's remaining agenda stands out.

- **Create an event**: **clicking an empty slot in the time grid** opens a small quick-create popover (title, time, calendar, location) — **Save** creates it right away, **More options** opens the full event dialog. **Dragging** across the grid sets the duration. The **+** in the header opens the full dialog: title, calendar, date/time or an all-day range, location, a **description** (a formatting editor — Markdown, "/" for commands; formatted descriptions from Google/Outlook read as text rather than raw HTML code, and a formatted description is sent formatted too), a **color**, **attendees**, and an optional Outlook-style **repeat**. The color overrides the calendar's color for that single event (no effect on Microsoft accounts — Outlook has no per-event colors).
- **Attendees**: type an email address and press **Enter** (or comma) to add it as a **chip**; the × removes one. The repeat is set right next to the date/time — pick a frequency, an interval, the weekdays (weekly), and how it ends (never / on a date / after N occurrences); you can also add or change the recurrence of an existing event.
- **Edit / delete**: **clicking an event** in the time grid opens the dialog prefilled with its values and with **Meeting note** and **Delete** actions. Changes are written to the provider with a safety check: if the event changed remotely in the meantime, Plainva refreshes instead of overwriting. For a **single event** the dialog also offers a **calendar picker** — pick a different calendar and the event is **moved** there (created in the target, deleted from the source; it gets a new provider id).
- **Move / resize**: you can **drag** an event straight in the time grid — dragging the body reschedules it (across to another day in the week/3-day view too), dragging its **bottom edge** changes its duration. The new time is written to the provider right away (recurring events stay editable only via the dialog for now).
- **RSVP & responses**: when you were invited to an event, the dialog lets you **Accept**, mark **Tentative** or **Decline** — Plainva sends your response through the provider (Google/Microsoft/CalDAV). The **attendee list** shows who accepted or declined (the back-channel).
- **Email invitations**: when an event has attendees, tick **Notify attendees by email**. On Google, Plainva then asks Google to send its native invitation (the same event, so the recipient's replies sync back to your event); Microsoft notifies attendees automatically. For CalDAV — or to send a copy from your own mailbox — the calendar's **Send by email** action opens the mail composer with a standards-compliant iCalendar invitation attached, so Gmail and other clients show it as an event with Yes/Maybe/No.
- **Block in other calendars**: the **copy** action on an event (or the **Block in other calendars** button in its dialog) mirrors it into one or more of your other writable calendars — either as an opaque **Busy** placeholder or **with details** (Notion-Calendar style). A recurring event is mirrored with its recurrence, so the block repeats too.
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

Copies created by **Block in other calendars** carry a provider-specific Plainva link on Google, Microsoft and CalDAV. Calendar views show that relationship with a link icon; after a refresh, source and block are matched again instead of becoming unrelated duplicates.
