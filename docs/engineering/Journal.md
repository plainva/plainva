# Journal: entries in the daily note, one write path, merge by time

Updated: 2026-09-20

The journal is not a data type of its own. An entry is a list line with a time under a heading of the daily note; everything else is a way in (capture) and a way to read across days (the stream). `packages/core/src/journal.ts` owns the format, `packages/ui/src/lib/journalWrite.ts` the write path, `packages/ui/src/lib/journalFeed.ts` the stream model, and `packages/core/src/conflict-resolver.ts` the merge rule. Both shells are wiring around these: no journal rule lives in `apps/desktop` or `apps/mobile`.

## Format

Written: `- HH:mm Text` (24-hour local time), continuation lines indented to the text, a task entry as `- [ ] HH:mm Text`. Read as well: `HH:mm:ss`, a single-digit hour, the bullets `*` and `+`, every checkbox state, and loose lists (blank lines between the items). A list line without a time is not an entry.

The section is found by the TEXT of its heading (setting `journalHeading`, default `Journal`, normalised by `normalizeJournalHeading`), whatever its level, and ends at the next heading among the note's TOP-LEVEL blocks. That is why `analyzeNoteOutline` exists beside `analyzeNoteSource`: the latter also reports headings inside list items and quotes, and a multi-line entry with a `# …` continuation line must stay one entry. Fenced code and HTML comments never yield entries.

`JournalEntry` carries `line` (0-based), `lineCount`, `time` as written, `seconds` since midnight (the sort key), `text` without marker, box and time, `task` (`TaskBoxState | null`), `tags`, and `source` — the exact source lines. `source` is what finds an entry again after the file changed: every mutation takes a `JournalEntryRef` (`line` + `source`) and refuses with `missing` when the lines are no longer there.

## Every edit is verified before it is returned

`insertJournalEntry`, `replaceJournalEntry`, `setJournalEntryTask`, `toggleJournalTask`, `removeJournalEntry` and `restoreJournalEntry` are pure string transforms. Each one re-parses its own result and requires the entry at the place it was written to. If the section ends inside a fence or comment that was never closed, an appended line would be swallowed; the insert then goes directly under the heading, and if that fails too the edit is refused (`unplaceable`) instead of written where nobody can read it. Nothing existing is reformatted: the list continues with the bullet and the spacing the note already uses, line endings and frontmatter stay.

A task entry's box goes through `setChecklistTaskDone` — the task view's own mutation — so completion date and the successor of a repeating task behave as they do there.

## The write path

`JournalFiles` is the shell's seam: `ensureDailyNote(date)`, `readTextFile`, `writeTextFile`. The desktop implements it over the vault adapter with a targeted index update (`hooks/useJournal.ts`), the phone over `vaultOps.save` with a sync nudge (`services/journalService.ts`). `ensureDailyNote` is the shared daily-note creator (`lib/dailyNoteCreate.ts`) in its HEADLESS mode: a capture never stops for a template's `{{prompt:…}}` questions; they stay empty and `{{cursor}}` is removed.

A change runs read → transform → re-read → write. If the note moved between the two reads, the transform is redone on the new text; after four lost races the path gives up with `changed` rather than overwrite a note that does not hold still.

Undo is a token with the text before and after. While the note still reads `after`, `before` goes back byte for byte. Once somebody else wrote, only the entry itself is taken out (or put back by `restoreJournalEntry`, at the place its time gives it) — a foreign state is never overwritten.

`appendPlannedJournalEntry` exists for the share target: the import plan fixes day, time and text, so a resumed import finds its own entry and writes nothing twice.

## Appending is not a conflict

Two devices that append to the same section before they synced produce a diff3 conflict: two insertions at the same place have no order — except that journal lines do have one, the time. `mergeText` therefore gets a pre-stage that runs ONLY when diff3 reports a conflict, and only when both sides are pure insertions of journal lines at that place. It unites them by time, identical lines once, the local side first on equal times.

The unit is the ENTRY, not the line. A line-wise merge may align the blank line inside a multi-line entry with a blank line of the ancestor and put half an entry in front of the other device's entry. `journalUnits` makes an entry with its continuation lines indivisible; an indented child entry stays with its parent; the order in which ONE device wrote is never changed.

`mergeWithoutBase(yours, theirs)` covers the case that is more frequent in practice than appending to a known note: both devices CREATE the day's note before either has seen the other's. There is no common ancestor, and the sync used to write a `.CONFLICT` copy. Two versions that differ in journal entries only (including the section only one side had to add) are united the same way; any other difference — a template timestamp in the frontmatter, say — stays a conflict. `SyncWorker.reconcileWithoutBase` calls it in both no-base branches.

The merged text is written with LF, as `mergeText` documents; the pre-stage follows that instead of changing it.

## The stream

`journalCandidates` picks the daily notes out of the vault's note paths with `parseDailyNoteDate` (folder and format of the daily-note setting). `loadJournalWindow` reads them newest first until 14 days WITH entries are found, bounded by 60 reads per window; "Load older" continues from `through`. There is no list virtualisation in the project, and a year of daily notes in one go would be too much on a phone.

`useJournalFeed` keeps three rules: the list stays while it reloads (a new filter replaces the days when the new ones are there, never with an empty list in between; only another vault empties it, by identity), a changed note re-reads only its day, and a late answer never wins (every load carries a ticket). Text and tag filters scan the loaded windows; they do not query the index.

What a row can do is `journalRowActions` (`lib/rowActions.ts`), how it is done is `useJournalActions` — the desktop tab, the phone screen and both "journal of this day" sections run on the same two.

## Global quick capture (desktop)

Opt-in, off by default. `services/quickCapture.ts` registers ONE system-wide shortcut through `tauri-plugin-global-shortcut`; the plugin is not even loaded while the feature is off. The old shortcut is released before a new one is taken, changes are queued, and a refusal — taken by another application, a key the system does not know, a Wayland session (`desktop_session_kind`) — is reported instead of left half-on.

The capture window is its own client role (`?win=capture`, label `capture-main`) that belongs to no vault. Its capability (`capabilities/capture-window.json`) grants the settings store, close, focus and dragging — no filesystem, SQL, HTTP, dialogs or window creation. It hands `{ text, task }` to the central window over the bus (`journal-capture`, app-scoped); the shell with the open vault takes it through a sink (`setQuickCaptureSink`) and answers with `{ ok }` or a sentence in the app's language, which the window shows while keeping the text. `captureWindow.test.ts` pins role, label and the exact permission list the way `fullWindow.test.ts` does for the full second window.

The shortcut is a device setting and deliberately outside the settings profile. Parity: decision `global-quick-capture` — a phone gives an app no system-wide key and reaches the same end through the launcher shortcut, the quick action and the share target.

## What no suite has seen

The real system-wide key press, the undecorated always-on-top window on the three desktop platforms, the iOS quick actions (compiled by the CI build only) and two real devices appending at the same time. The merge rule is covered by diff3 cases and two-device runs of the `SyncWorker` against the mock target.
