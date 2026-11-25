# Plainva Mobile 0.9.0 — an assistant in your vault

Plainva 0.9.0 brings **Plainva AI (Beta)**, an assistant that reads, searches, drafts and answers inside your vault. It is **off on every device until you switch it on** under **Settings › AI**. It talks to a provider you set up yourself with your own key (Anthropic, OpenAI, Google Gemini, OpenRouter or your own OpenAI-compatible server), or to a model on this device. Plainva runs no server for it and receives nothing. Before the first request it shows what goes out; **Ask before every request** shows it every time, and **Fully local** lets only models on this device answer. The AI is experimental.

**Please update every device that uses the same vault.** An older version opens no `plainva://` links and creates no next task for a recurring task with a block link. If you use an encrypted workspace, update every desktop that syncs that folder. And: a device on 0.8.7 no longer receives a password through sync from an updated device. Until then, enter the password yourself on the device that is not yet updated.

## Plainva AI (Beta)

- **Beside the note** — on the desktop, the AI button, **Ctrl+J** (⌘J on macOS) or **Ask AI** opens the conversation in the right sidebar at its full height, and the calendar above it becomes the current week. **Pop out** makes it a small window; **Dock in the column** brings it back. On the phone, **Ask AI** opens the AI sheet over the note, and the **AI** area has a start page.
- **Where an answer comes from** — a calm line under every answer names the notes that went along and where the request went. Plainva warns only when an answer names a note as a source that was neither sent nor read.
- **Conversations about your vault** — the open note, a selection, search results and, if you allow it, your appointments, tasks and mail as context. Notes whose privacy rule keeps them off the cloud stay out.
- **Suggestions first** — changes to a passage, a property or a database cell wait as suggestions; a new note is a draft. **Apply directly** (per conversation) and the folder rule **Change without asking** let it write at once, and a version is kept before every write. Deleting, renaming and moving always ask.
- **Skills, routines and memory** — fourteen skills come with the app, and you can write, review and import your own. **Routines** run a skill at a set time while Plainva is open. The vault's **memory** holds what you accept from a conversation.
- **Search by meaning** — finds notes through related words, computed on this device with a model you download once, or with your provider if you choose so explicitly.
- **The internet, per vault** — reading pages and searching, switched on per vault and chosen per conversation.
- **External tools (MCP)** — connect MCP servers you trust; each call asks.
- **iPhone and iPad:** Siri and Shortcuts find notes by title; off by default.
- **Settings › AI** is arranged in groups, with the answering profile first; a vault's folder rules show as named columns.
- Every answer is marked as written by an AI; **Feedback on the AI (Beta)** is under **Settings › AI**.

## Links to a note, a heading or a block

**Copy link** and **Copy block link** give any place in a note an address (`plainva://open…`) that opens it from an event, a mail, a task, a bookmark or another app — in both shells.

## More new things

- **First start:** on the desktop, **Welcome to Plainva** leads with **Try it with the tour**, and **Open an existing folder** goes straight to your notes. On the phone, a new vault offers the tour first, and **I already have a vault** guides you to your folder or your cloud. A new vault that fails takes back only what it created.
- **On start**: open as you left it, or start fresh.
- **A default mailbox per vault**; on the phone, every mail row names its mailbox, and snoozed mail has its list.
- **Version history** for any file, images included.
- **Tasks:** a task with subtasks shows how many are done; the due date picker writes a time and a reminder for a checkbox task; a new task without a task database lands in today's daily note.
- **Phone:** Today jumps to any day from the date under its title; **About & diagnostics** shows why the app last ended.
- An embedded file that is not a note shows as a card with **Open**.
- **Rebuild index:** when a vault cannot open because its index database is damaged, the start screen of both shells offers to rebuild it — the old database is set aside and no note is deleted. When only the search index is damaged, the vault opens anyway and search offers the same way.

## Known limitations

- The AI is experimental. Encrypted workspaces stay experimental until an independent review.
- The AI texts in eight languages are translations that no native speaker has read yet.
- **Mail and the AI:** words that are invisible only because other boxes cover them or cut them off can still reach the AI when it reads a mail. Text that an element hides itself does not.
- **Passwords between devices:**
  - If you change a password on a device shortly before or shortly after its secure storage was cleared or restored from a backup, and that device does not sync in between, Plainva cannot tell the new password from the old one; it may then be replaced by the state of your other devices.
  - If an account has a different address on each device (for example the home-network address at home and the public one on the road) and you correct the address on one device, the other devices may lose their password for this account. Sign in there once again.
  - If you set a device back from 0.9.0 to 0.8.7, be aware: the passwords for calendar, mail and sync stored there may count as newly entered on other devices and be taken over there. That has always been so between devices on 0.8.7.
- If a save or a sync hangs without an answer (on a network drive, for example), closing or switching a vault can hang; then the only way out is to quit the app and start it again.
- As in 0.8.7, an extremely large note can make the app crash on the phone.

## Security

- **No passwords or sign-in data in the settings file any more.** Until now, your saved passwords and sign-in data were also stored readably in Plainva's settings file, because the sync between your devices kept a note there of what it already knew. From 0.9.0 on, none of it is stored there; the credentials themselves stay where they were saved. Backups of the profile folder (on the phone: device backups) made before the update still contain this file with the passwords and sign-in data. If such backups have left your hands, change the passwords concerned.
- **A question before a password goes to an unconfirmed address.** If an account has an address in your home network or one without encryption (`http`), and its password came to a device through sync from another device, Plainva asks once on that device after the update before it sends the password there: under **Cloud accounts**, the account shows **Confirm address** with the address. If it is yours, choose **Confirm**, and the account carries on at once. If you entered the password on the device yourself, Plainva does not ask — unless it cannot tell for sure; then it would rather ask once too often.
- **One view per reader:** a reader with a narrower view (an AI app, an agent, a skill) searches, reads and changes a note only as it may see it — properties, backlinks, summaries and memory included.

## Fixes

- An error in one area shows in that area instead of taking the whole app down (both shells).
- A deletion happens only with a backup snapshot; without one, Plainva asks first — once for everything selected, not once per file.
- A second phone can join an encrypted vault.
- **Android:** the automatic ZIP backup of a large vault could close the app shortly after start, again on every opening (since 0.8.2); the backup now writes in parts. Files of 8 MB and more reach OneDrive (Dropbox: 150 MB and more), and a local model downloads. On-device calendar (experimental): deleting a single event no longer deletes the whole series, and events keep their time.
- **Phone, picked folder:** writes, deletions and renames keep their order, across folders too.
- **Sync:** a deletion or move goes out only against the version the device expects, so another device's change is no longer lost; an empty folder deleted outside the app stays deleted; a file in the Google Drive trash counts as deleted, and Plainva deletes there for good again; nothing unencrypted reaches a folder that holds an encrypted workspace; Google Drive files that stay unresolved are named.
- **Encrypted workspaces:** no text is lost when two devices change the same thing at once; another device's mass deletion is held as a question; a refused write is kept and reported; two devices that keep deleted files agree without a duplicate conflict copy.
- **Saving:** a failed save is tried again for about five minutes in both shells; the status bar says **Not saved — trying again**.
- **Databases:** a change to a view is merged into the `.base` file instead of overwriting it, in the auxiliary window too; a hidden column of a board keeps its place.
- **Search index:** a file that changes during the index run is read again, and search shows the new text after quick saves.
- **Large tables:** a very large table no longer slows down the index and reading view; formulas in reading view look as before.
- **Calendar:** an all-day event on the device lies on its day west of UTC; an event ending at midnight keeps its end; a recurring CalDAV task with exceptions is one task; a fetch with nothing new no longer reloads an open view.
- **Pinboard:** the search in a database's header no longer takes cards out of a board's arrangement (since 0.8.4).
- Files with unusual names open, embed, import and serve as templates again.
- Issues of 14 November: the template dialog (#170), task lists that cannot reach their notes say why (#172), start on Home (#173), code blocks (#175).
- **iPhone and iPad:** Plainva's own files and databases no longer show in the Files app, the databases stay in the backup, and moving the drafts loses nothing.
- What opens while a session is being restored stays open (phone), and a note link that arrives during the restore keeps its tab (desktop).
- `{{vault}}` in a template is the vault's name in Plainva, on both shells; auxiliary windows follow the daily-note naming; on the phone, a deleted note leaves the navigation.
- **Mail:** subjects in several encoded parts or rare charsets read the same on both shells; a nameless attachment saves with its type; the phone lists every file of an IMAP message, as the desktop does; the AI reads exactly what the mail reader shows.
- **Accounts:** one Nextcloud stays one account on every device and every connect (#174); two connections at once no longer undo each other, and a calendar no longer takes the sign-in of an account being connected; two users whose names differ only in case stay two accounts with their own passwords; the guided repair offers duplicate rows of a password account; a password typed on one device reaches the others even after changes elsewhere; a sign-in that **Remove account** could not delete is deleted later.
- **Reading view:** links, formulas and tables read as the note writes them; a block ID on a line of its own no longer breaks it, and at the end of a line it is faint in the live preview.
- **Properties:** a date under `!!timestamp` keeps its tag when it changes; removing a `|+` entry no longer takes the indented comment behind it along; a value a YAML anchor refers to is refused with a readable hint instead of an unreadable block.
- **Templates:** a template with a placeholder title is indexed under its file name.
- **Sync:** when the app ends in the middle of a step, the next start takes over what sync had already removed or written instead of taking it for your change.
- **AI:** a request too large to send says so instead of reporting the device as offline.

The AI, encrypted workspaces, the on-device calendars, voice notes and the location stamp remain experimental. These are specific corrections and improvements, not an independent security audit.

The APK is attached to this release. The AAB is the signed Google Play delivery artifact. This mobile GitHub release is marked as a pre-release so that it does not replace the desktop updater release.

[Desktop release](https://github.com/plainva/plainva/releases/tag/v0.9.0) · [iOS TestFlight](https://testflight.apple.com/join/ZRSEfZBn)

On iOS, the native marketing version remains 1.0; the TestFlight build number identifies the new delivery.
