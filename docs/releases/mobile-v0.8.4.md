# Plainva Mobile 0.8.4

A journal for your day — on Android and iOS. This coordinated update includes the shared journal, task, database and writing improvements since 0.8.3, widgets for the home and lock screen, and fixes for synced vaults.

If you sync a vault across devices, please update all of them (see *Move and rename without loss* below).

- **A journal for your day.** Entries with a time go into the daily note — from the **＋** button, the share sheet (**Into the journal**), an Android launcher shortcut or iOS quick actions. The journal view shows every day as a list or a card wall, with your mood; **The day ends at** lets a day run past midnight.
- **Plan your tasks.** **Today**, **Upcoming**, **Inbox**, **All** and **Done**; one sentence sets date, time, priority and tags in ten languages. Reminders offer **In 1 hour** and **Tomorrow morning**; `[/]` marks a task in progress and `[-]` a cancelled one. **New task** is also in the Android launcher and the share sheet.
- **Widgets.** **Today** with appointments and tasks and **Quick capture** for a task or the journal, on Android and iPhone; the iPhone adds two lock-screen widgets. A widget holds no note text or path, and a locked encrypted workspace shows an empty widget. Ticking a task off in a widget is applied the next time Plainva opens (iOS 17 or later).
- **Voice notes and location (experimental).** Record voice notes into the attachments folder and play them in the editor, reading mode, on the pinboard and in the journal. An optional location stamp adds your approximate position; it is off by default and set per device. Plainva asks for the microphone or location permission only when you use these features.
- **Databases and pinboards.** A search field in every database view, ratings as an input type, `file.day` for daily notes in calendar and timeline, kanban cards in the note colour, and pinboard entries written in the full editor.
- **Every script, every direction.** Arabic, Hebrew and Persian run right to left, paragraph by paragraph. Search finds Japanese, Chinese and Thai words in the middle of a sentence. Thanks for [#111](https://github.com/plainva/plainva/issues/111).
- **Reading and navigation.** Tags show as pills that open the notes with that tag, search results and backlinks can be sorted, callouts render as one card, and the calendar swipes in both directions.
- **Fixes on the phone.** A new note is named in the language of the app ([#105](https://github.com/plainva/plainva/issues/105)). On the iPhone the rows in **Bars & areas** can be used and the folder screen tells loading, unreadable and empty apart ([#104](https://github.com/plainva/plainva/issues/104)). Text fields in the settings keep their cursor, and the Gmail app-password help is available on the phone.
- **Accounts and meetings.** Saving an account again keeps its calendar and task lists. Events with an online meeting show **Join**; meeting notes can start from a template.
- **Move and rename without loss.** Moving or renaming a synced note no longer deletes it at the next sync. The sync checks every deletion file by file, folders with accented names no longer turn up twice, and new folders are created inside the vault. Thanks for [#113](https://github.com/plainva/plainva/issues/113) and [#112](https://github.com/plainva/plainva/issues/112). A device still on 0.8.3 can delete a synced note after it is moved or renamed there, and it mirrors deletions without asking. If a note went missing that way, the [FAQ](https://github.com/plainva/plainva/blob/main/docs/user/en/FAQ.md#a-note-disappeared-after-i-moved-or-renamed-it) shows where to find it.

On first start Plainva converts its internal paths once and updates the search index; only notes that need it are re-read. Encrypted workspaces, the on-device calendar, voice notes and the location stamp remain experimental.

The APK is attached to this release. The AAB is the signed Google Play delivery artifact. This mobile GitHub release is marked as a pre-release so that it does not replace the desktop updater release.

[Desktop release](https://github.com/plainva/plainva/releases/tag/v0.8.4) · [iOS TestFlight](https://testflight.apple.com/join/ZRSEfZBn)

On iOS, the native marketing version remains 1.0; the TestFlight build number identifies the new delivery.
