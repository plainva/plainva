# Calendar & external tasks

Last reviewed: 2026-08-10
Plainva can connect your existing calendar and task accounts — **CalDAV** (Nextcloud, Fastmail, mailbox.org …), **Google** (Calendar + Tasks) and **Microsoft** (Outlook calendar + To Do) — and work with them in both directions. Your notes stay the center: events can become meeting notes, and external task lists mirror into your [standard task database](Tasks.md) as ordinary notes.

> **Experimental.** The calendar talks to live external accounts (CalDAV, Google, Microsoft) that can't be exercised in Plainva's automated tests. It works and is used daily, but treat it as a preview: keep a backup, and please report anything that looks off.

## Connecting an account

Open **Settings → your vault → Cloud accounts → Connect account…**, pick a provider and tick **Calendar & tasks** in the services step:

- **Nextcloud / CalDAV**: server address, user name and an **app password** (in Nextcloud: Settings → Security → Devices & sessions). No registration, no keys — for Nextcloud, Plainva derives the CalDAV address from the server address itself (for other CalDAV servers use the **WebDAV / CalDAV** tile or **Advanced: set endpoints individually**).
- **Apple iCloud, Yahoo, AOL, Zoho, Fastmail, mailbox.org, Yandex, Mail.ru**: dedicated tiles with the calendar addresses already filled in — email address plus an **app password** is enough, no server field (for Apple the app password is mandatory; the assistant links the provider's guide). Note: Yahoo itself flags its CalDAV service as unreliable — if it acts up, it is not Plainva.
- **Google**: needs your own OAuth client ID (the same BYO model as the Google Drive sync — see the [Drive guide](Google_Drive_BYO_Guide.md)). In your Google Cloud project, additionally enable the *Google Calendar API* and *Google Tasks API* and add their scopes to the consent screen. The browser opens for consent; connecting validates the account before anything is saved.
- **Microsoft**: just click **Sign in with Microsoft…** and confirm in the browser — no setup needed. One Microsoft account can also carry **Files** (OneDrive) and **Email** in the same pass.

The assistant shows a per-service status ("connected — n calendars found"). You then manage the **calendars** (checked ones appear in the calendar tab) and the **task lists** (deliberately unchecked by default — ticking one starts the task sync described below) in the **Calendar** area; the **Meetings folder** (where meeting notes are created) and the **Default calendar** live there too. Passwords and tokens live in your operating system's keychain.

**Every device signs in for itself.** If you use [settings sync](Sync_Setup.md#sync-encryption-passphrase), the account *details* travel with you, but the sign-in never does — it deliberately stays on the device. An account picked up that way appears in the list on the other device but is not signed in there yet; in the [mobile app](Mobile_App.md) it then carries a **sign in** marker and the calendar explains it instead of staying empty. Connecting once is enough.

**When a sign-in expires.** The calendar area then shows the error on the affected account and says what to do about it: if the sign-in expired or was revoked, it offers **Sign in again** — one round trip that brings **every** service of that account back for Microsoft and Google (files, calendar, mail). If the provider configuration is at fault (wrong or deleted client ID, an API missing in the project), the hint points there instead of offering a new sign-in; for a network error, a later attempt is enough. With a Google project in **testing** mode the usual cause is the 7-day limit — details in the [Drive guide](Google_Drive_BYO_Guide.md). While an account cannot be reached, Plainva no longer claims it offers no task lists: the list stays empty, with the error above it. The same holds in the mobile app: the account row names the reason, and **Sign in again** repairs the account in place.

## The calendar tab

**Google's status entries** — working location, focus time and out of office — appear as their own row, or as a quiet band behind the day, rather than as another appointment block: "Working from home" is not a meeting, and a day with three of those and one meeting must not look like four meetings. Plainva **reads** them and never writes them — creating an out-of-office entry in Google automatically declines invitations, and that is not a side effect a calendar view should trigger.

Open it from the left action rail (calendar icon) or the command palette (**Open calendar**). Five views are available via the switch in the header: **Day**, **3 days** and **Week** show a **time grid** with an hour gutter on the left; events sit as blocks at their start time, their height is the duration, overlapping events sit side by side, and a red line marks "now". All-day events and (with the task overlay on) due tasks sit in the strip above the grid. **Month** shows the month grid (one colored dot per calendar) plus a single-day time grid for the selected day on the right. **Agenda** lists the upcoming weeks grouped by day. **Today** jumps back; the arrows page by the current period (a day, three days, a week or a month). The first day of the week follows the **Week starts on** setting (Settings → App → Appearance: Monday, Saturday or Sunday) — it also applies to the sidebar calendar. The view refreshes automatically every few minutes; the refresh button forces it. Events that have already ended read **dimmer** (like Google Calendar), so today's remaining agenda stands out. A **multi-day event** is one continuous **bar** across the days it covers — one label, one click target, instead of an entry per day. Where it runs past the end of the week it is cut straight at the edge and continues in the next row without repeating the title. The all-day strip of the day, three-day and week views works the same way.

- **Create an event**: **clicking an empty slot in the time grid** opens a small quick-create popover (title, time, calendar, location) — **Save** creates it right away, **More options** opens the full event dialog. **Dragging** across the grid sets the duration. The **+** in the header opens the full dialog: title, calendar, date/time or an all-day range, location, a **description** (a formatting editor — Markdown, "/" for commands; formatted descriptions from Google/Outlook read as text rather than raw HTML code, and a formatted description is sent formatted too), a **color**, **attendees**, and an optional Outlook-style **repeat**. The color overrides the calendar's color for that single event (no effect on Microsoft accounts — Outlook has no per-event colors).
- **Attendees**: type an email address and press **Enter** (or comma) to add it as a **chip**; the × removes one. The repeat is set right next to the date/time — pick a frequency, an interval, the weekdays (weekly), and how it ends (never / on a date / after N occurrences); you can also add or change the recurrence of an existing event.
- **Looking**: **clicking an event** opens the **event preview** — a free-floating window that shows the event instead of editing it: when it runs, where, its description, the attendees with their replies, plus **Accept / Tentative / Decline**, **Meeting note**, and every remaining action behind the **⋮** (colour, block in other calendars, send by email, delete). The window does not dim the app, it can be moved and resized, and **Esc** closes it. If the event belongs to a **series**, the preview says so — with the rhythm and, when it is loaded, the next occurrence. It asks nothing: “this one or all?” is a question about changing, not about looking.
- **Edit / delete**: **Edit event** in the preview opens the dialog prefilled with its values and with **Meeting note** and **Delete** actions. Changes are written to the provider with a safety check: if the event changed remotely in the meantime, Plainva refreshes instead of overwriting. For a **single event** the dialog also offers a **calendar picker** — pick a different calendar and the event is **moved** there (created in the target, deleted from the source; it gets a new provider id).
- **Recurring events**: an event from a series opens for editing like any other — the question comes at **save** time, and only if you actually changed something. The dialog names the change (“Time: 09:00 → 09:15”) and then asks whether it should apply to **this event only** or to **all events in the series**. With “all”, only what you changed travels to the series; its own start date and everything you left alone stay put. Close the form unchanged and nothing happens at all — no dialog, no write to the provider. **Deleting** still asks up front: there the click already is the change.
- **Move / resize**: you can **drag** an event straight in the time grid — dragging the body reschedules it (across to another day in the week/3-day view too), dragging its **bottom edge** changes its duration. The new time is written to the provider right away (recurring events stay editable only via the dialog for now).
- **How an event looks**: a **cancelled** event stays visible but reads as an **outline** with a **struck-through title** — you see that the slot has freed up instead of quietly losing it. An **invitation you have not answered** is an outline too (it is not your appointment yet); a **tentative** event — marked so by the organiser or answered “maybe” by you — is **hatched**. Anything confirmed stays filled. The agenda adds the word (**Cancelled**, **Unanswered**, **Tentative**). If you **declined**, the event becomes a **dimmed outline** with a struck-through title (**You declined** in the agenda): it goes ahead for everyone else, but it is no longer part of your day. A cancellation by the organiser stays crisper — that one affects everybody.
- **RSVP & responses**: when you were invited to an event, the dialog lets you **Accept**, mark **Tentative** or **Decline** — Plainva sends your response through the provider (Google/Microsoft/CalDAV). The **attendee list** shows who accepted or declined (the back-channel).
- **Email invitations**: when an event has attendees, tick **Notify attendees by email**. On Google, Plainva then asks Google to send its native invitation (the same event, so the recipient's replies sync back to your event); Microsoft notifies attendees automatically. For CalDAV — or to send a copy from your own mailbox — the calendar's **Send by email** action opens the mail composer with a standards-compliant iCalendar invitation attached, so Gmail and other clients show it as an event with Yes/Maybe/No.
- **Block in other calendars**: the **copy** action on an event (or the **Block in other calendars** button in its dialog) mirrors it into one or more of your other writable calendars — either as an opaque **Busy** placeholder or **with details** (Notion-Calendar style). A recurring event is mirrored with its recurrence, so the block repeats too.
- **Recurring events** carry a repeat badge. Editing or deleting an instance asks **"Only this event"** (creates an exception / skips just that occurrence) or **"All events"** (changes the whole series). Plainva never rewrites an existing recurrence rule.
- **Show tasks** (next to the refresh button, once a standard task database is set): overlays the dated entries of your [standard task database](Tasks.md) onto the time-grid strip and the month grid. Off by default; the choice is remembered per device. When the due column carries a **time** (column type “date and time”), the task stands at its place **in the day grid** instead of the all-day strip — dashed rather than filled, because a deadline is not a span, with its checkbox right in the block. Without a time nothing changes.
  - Clicking the **checkbox** ticks the task off right here — you do not have to open the note. Clicking the **title** still opens it. Ticking off writes the same file the Tasks view does: if the task carries a **repeat**, the next one is created.
  - **Tasks are tinted differently from events.** A past event is over and appears faded; an **overdue** task is more urgent instead and is **emphasised**. Tasks due today appear normal, future ones muted, completed ones struck through.
  - A **repeat glyph** on the row shows that the task carries a repetition. It still appears only **once** in the calendar — see [Tasks](Tasks.md) for why.

## Event → meeting note

The note icon on any event creates (or re-opens) its **meeting note** — a normal note in your meetings folder named `YYYY-MM-DD Title.md`, pre-filled with the date, location and attendees, plus a small `plainva.pim` marker in the frontmatter that ties it to the event. Clicking the same event again always opens the same note; a note of yours that happens to share the name is never touched.

## External task lists in your task database

Reminder lists (Apple Reminders over iCloud CalDAV, Nextcloud task lists) are their own collections on the server, so they appear under **Task lists** — never under **Calendars**. If a connected account shows no task lists, the section says so and offers **Look again**; when the lookup itself failed, the reason is shown instead and your previous selection is kept.

Tick a **task list** on a connected account and its tasks appear as notes in your [standard task database](Tasks.md): the title becomes the note (H1), the due date lands in the database's date column, and completion maps to the database's **done checkbox property** (the status column follows it; a database without a checkbox column uses the status convention — first option = open, last = done). The sync is two-way and field-wise:

- Edit the note (title, due, status) → the change is pushed to the provider.
- Change the task remotely → the note follows.
- If both sides changed, your local edit wins for that field; the rest follows the remote.

Two safety rules protect your data: **deleting the note never deletes the remote task** (it just stops syncing and is not re-imported), and **a remotely deleted task never deletes your note** (it simply becomes a normal note). Renaming or moving a task note is fine — the frontmatter marker keeps the link.

Current limits: tasks created as plain notes are not pushed to the provider (create them remotely or via the task database), and everything on this page is desktop-first for now.

Copies created by **Block in other calendars** carry a provider-specific Plainva link on Google, Microsoft and CalDAV. Calendar views show that relationship with a link icon; after a refresh, source and block are matched again instead of becoming unrelated duplicates.

## Reminders on the computer

Under **Settings → Calendar → Reminders** you switch on **Remind me of appointments**; the first time, the system asks once for permission. Whatever reminder the appointment itself carries wins — only when it says nothing does the **Lead time** apply, and all-day appointments speak up at the time chosen under **All-day appointments**. **Due tasks** additionally takes in the tasks of your task database, and **Only these calendars** narrows down where reminders come from (nothing ticked means all of them, and a calendar connected later is included by itself).

**The difference from the phone is in the setting, not in fine print.** On the phone the operating system takes the reminder over and wakes it even with the app closed. On the computer there is no such handover: **Plainva does the waking itself and therefore has to be running.** With the app closed a reminder is missed and is not made up for later. In exchange there is no ceiling here.

The notification itself carries no button — the desktop does not offer one. The action lives in the in-app message instead: **Show in calendar** for an appointment, **Open task** for a task. The window never pushes itself to the front while doing so.

### Keeping it running in the background

Because a reminder on the computer only arrives while Plainva is running, **Settings → Startup & behavior → Background** offers two switches — separate, because they are two different wishes, and both **off by default**:

- **Start with the system** registers Plainva at sign-in.
- **Keep running in the tray when closed** puts a Plainva icon in the tray; closing the window then no longer quits the app but files it there. The icon brings you back with **Open**, shows the **next appointment**, and ends Plainva with **Quit**.

**The second switch proves itself.** Not every desktop shows a tray — and whether an icon really appears cannot be predicted reliably. So Plainva puts it up and **asks whether you can see it**. Only a yes keeps the setting; say no and the icon is removed again and the switch stays off. That way the window can never vanish without a way back. The same safeguard applies at the next start: if the icon cannot be created then, the setting switches itself off.

The **Reminders appear** line below says at any time what currently holds — *while Plainva is running* or *even with the window closed*.

**Worth knowing:** while Plainva keeps running in the background, so do **syncing, the calendar refresh and the backup check**. The vault is up to date the next time you open it — the app works while you are not looking at it.


## Showing databases in the calendar

The calendar can show **entries from your databases** alongside your appointments. The **Show:** bar above the view lists every `.base` view of type **calendar** or **timeline** that names a date column. One click shows it, another hides it again.

An entry shown this way **stays recognisable as a note**: dashed edge, a diamond in front, never the filled shape of an appointment. Clicking it opens the same preview a database row already has. **Dragging it to another day writes the note's date column** — exactly what editing that cell in the table does. If the column carries a time, the entry sits at its hour in the day grid; without one it sits in the all-day strip.

**Which views are shown belongs to the vault** and travels through settings sync: your calendar looks the same on your computer and on your phone.

**And the other way round:** in a database's calendar view, the **Appointments in the background** button shows the day's real appointments as a quiet line — you can see what you are planning against. They are deliberately backdrop only: not rows of that database, and not clickable.

## Putting a database entry in the calendar

An entry with a date can become a **real appointment** at your provider. The entry's row menu (or its action sheet on the phone) offers **Add to calendar**. The appointment takes the entry's date — with a time if the column carries one, otherwise as an all-day appointment — and carries a link back to the note.

From then on the two stay linked, by three fixed rules:

* **Move the appointment** in Google, Outlook or on the CalDAV server and **the note's date column follows.**
* **Delete the note** and the deletion dialog says that it is linked to an appointment. The appointment stays at your provider — Plainva never deletes it as a side effect.
* **Delete the appointment** and only the link disappears. The note and its date are left untouched.

This is a different thing from **blocking time** on a task: there you reserve time for something, and the task's date stays where it is. Here you say: *this entry IS this appointment.*

## Putting a database entry in the calendar

An entry with a date can become a **real appointment** at your provider. The entry's row menu (or its action sheet on the phone) offers **Add to calendar**. The appointment takes the entry's date — with a time if the column carries one, otherwise as an all-day appointment — and carries a link back to the note.

From then on the two stay linked, by three fixed rules:

* **Move the appointment** in Google, Outlook or on the CalDAV server and **the note's date column follows.**
* **Delete the note** and the deletion dialog says that it is linked to an appointment. The appointment stays at your provider — Plainva never deletes it as a side effect.
* **Delete the appointment** and only the link disappears. The note and its date are left untouched.

This is a different thing from **blocking time** on a task: there you reserve time for something, and the task's date stays where it is. Here you say: *this entry IS this appointment.*
