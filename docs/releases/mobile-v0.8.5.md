# Plainva Mobile 0.8.5

Forward with attachments — on Android and iOS. This coordinated update includes the shared mail, calendar, writing and link improvements since 0.8.4 and a long list of fixes for synced vaults.

If you sync a vault across devices, please update all of them (see *Sync and files* below).

- **Forward with attachments.** **Forward** brings the files of the original along; each file says whether it is loading, there or staying behind, and Plainva asks once before a message goes out without one of them. From a Microsoft mailbox every file up to 2.8 MB travels; on its own, Plainva brings along at most 18 MB per message. A message the mail server refuses comes back into the compose screen with the reason.
- **Each mailbox signs in as its own account.** With two Microsoft or two Gmail mailboxes in one vault, the second one read and sent with the sign-in of the first. That is fixed. An account that is connected twice with mail in the same vault asks for a sign-in once after the update.
- **More for mail.** A message that is HTML only has a text for a reply, a forward and the filed note. A link says where it leads before you follow it, no image loads on its own in the spam folder, the search keeps its hits, a note sent as an attachment arrives with its file, and the notice that offers **Undo** ends with its window.
- **Blockers follow their event.** When an event is moved, changed or deleted, the blockers that hold its time free in other calendars follow; a blocker you move asks what you meant. An event shows the moment you save it ([#119](https://github.com/plainva/plainva/issues/119)), and a line above the calendar says what has not been synced and since when.
- **Spell checking, one switch.** One switch per device, off until you turn it on, for notes, table cells, emails, comments, journal entries and tasks. Code, keys and passwords are never checked.
- **Tasks in fewer steps.** A task's date opens the date picker, **All to today** moves every overdue task in one step, the checkbox is larger, and the capture field completes `[[` links and `#` tags. Bookmarks can be reordered.
- **On the phone.** The command palette reaches twelve more commands. A large pinboard shows its cards, the find panel in a note stands clear of the status bar, a held kanban card is either the menu or a move, and the Enter key that confirms a Japanese or Chinese composition no longer submits the field. A table cell is edited in a field as tall as its text ([#118](https://github.com/plainva/plainva/issues/118)).
- **Google on Android.** An account connected with a client ID of your own signs in through the browser again. Since 0.8.3 only the system dialog was used, which works with the built-in entry alone. Accounts already connected through the system dialog stay as they are, and a failed sign-in says why.
- **Links that hold.** One rule decides where a wiki link leads — path, then file name, last the `title` in the properties — for taps, embeds, the graph and backlinks. Renaming a note changes only the link target in the notes that link to it.
- **Sync and files.** Two devices working on the same file could lose a change without a conflict being shown; on the phone this also hit settings files, tables and databases. That is fixed. A text file that is not UTF-8 travels byte for byte instead of being written back damaged, and every file keeps its line endings and its byte order mark. Everything the phone writes into an open vault now gets its version, its conflict check and its place in the sync queue. A device on an older version can still upload a damaged version of a text file that is not UTF-8; updated devices then keep the original as a conflict copy.
- A property, a ticked task or a journal entry written into a note with an open conflict no longer replaces your own text; changing one property leaves every other property as it was written (`01067` stays `01067`); and a file whose details cannot be read for a moment is no longer treated as deleted.

Encrypted workspaces, the on-device calendar, voice notes and the location stamp remain experimental.

The APK is attached to this release. The AAB is the signed Google Play delivery artifact. This mobile GitHub release is marked as a pre-release so that it does not replace the desktop updater release.

[Desktop release](https://github.com/plainva/plainva/releases/tag/v0.8.5) · [iOS TestFlight](https://testflight.apple.com/join/ZRSEfZBn)

On iOS, the native marketing version remains 1.0; the TestFlight build number identifies the new delivery.
