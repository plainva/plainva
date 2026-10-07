# System assistant — architecture

Status: built for iPhone and iPad (AI harness P4.7, 2026-10-07); nothing of it has run on a device yet. The rules both sides share are in `packages/ui/src/lib/systemIntents.ts`; the phone's side is `apps/mobile/src/services/intentService.ts` and `apps/mobile/src/platform/intentBridge.ts`; the native side is `apps/mobile/ios/App/Shared/IntentStore.swift`, `apps/mobile/ios/App/App/PlainvaIntents.swift` and `IntentBridgePlugin.swift`. The decisions are [ADR 0026](../adr/0026-system-assistant-reads-a-directory-and-leaves-orders.md).

Siri, Shortcuts and Apple Intelligence reach Plainva through four App Intents: **Open Note**, **Search Notes**, **Add Journal Entry**, **Add Task**. An intent runs natively, also while the app is closed, and no JavaScript runs then. So an intent works nothing out and writes nothing into the vault. It reads a *directory* the app wrote and leaves an *order* the app redeems.

## Who decides what

| | Who decides | Where |
|---|---|---|
| Whether the system is told any title | the user, per device | the switch `systemFind` in the AI settings of the device; off by default, and only with the AI switched on |
| Which notes may be named | the vault's privacy rules | `gatherIntentDirectory`: the core's gate, the system's assistant as a cloud recipient that may use the internet |
| What a row holds | `systemIntents.ts` | a title, the folder's name, a key; bounds and cleaning |
| Which note a key means | the app | a table in the app's own storage, never beside the directory |
| Which rows a phrase means | the native matcher | `IntentSearch.matches` over the titles in the directory |
| What becomes of an order | the app | `redeemIntentOrdersWith`: the journal's planned entry, the task database's creator, the shell's navigation |
| Who may leave an order | the system | every intent asks for an authenticated person (`authenticationPolicy`) |

## The two files

Both lie in the App Group container under `intents-v1/`, excluded from backups. `IntentStore` takes one lock around every public method (`flock` on `.lock`), and writes through a temporary file, a sync and a rename.

**`notes.json` — the directory.** Written whole or removed; file protection *complete*, so it cannot be read while the device is locked.

```json
{ "version": 1, "writtenAt": 1759831200000, "vault": "Studio",
  "notes": [ { "k": "5f1c0a94d27be386", "t": "Plan", "f": "Projects" }, { "k": "0b1d77aa93c4e210", "t": "Welcome" } ] }
```

- `k` — the key: SipHash-2-4 of the note's path under this device's secret (sixteen random bytes in the app's storage), as sixteen lowercase hex digits. Pinned to the reference vectors in `apps/desktop/src/lib/systemIntents.test.ts`.
- `t` — the title: one line, nothing invisible, at most 120 characters. Where the index names a note by its path, the file's name.
- `f` — the name of the folder the note lies in; absent at the vault's top.
- At most 2,000 rows, the notes changed last first, and less than 900 KiB as the app counts it; the native reader refuses a file over a megabyte, more than 2,000 rows, another version, a row without a key or a title — and refuses to *write* any of these, so nothing half-understood is ever on disk.

**`orders.json` — the queue.** Protected until the first unlock.

```json
{ "version": 1, "nextId": 4,
  "orders": [ { "id": 2, "kind": "journal", "at": 1759831300000, "text": "Called the dentist" },
              { "id": 3, "kind": "open", "at": 1759831320000, "text": "Plan", "key": "5f1c0a94d27be386" } ] }
```

- `kind` — `open`, `search`, `journal` or `task`. `text` is the words (for `open`, the title that was chosen): line breaks kept, nothing invisible, at most 2,000 characters. `key` only on `open`, and only when it is a key.
- Ids are never used twice. Clearing is by id, never wholesale.
- At most 99 things to write wait; a hundredth is refused and the intent says so. They are never dropped for their age. A place to go always fits: a new one replaces the one before.

## The directory's moments

`initIntentService` wires them; `refreshIntentDirectory` runs one pass at a time and repeats once for what arrived meanwhile.

| Moment | What happens |
|---|---|
| start, return to the front | redeem the orders, then write |
| the app leaves | write, not debounced — the file is read while the app is closed |
| a note was saved and indexed, files came, went or moved, the index was rebuilt, the folder rules were saved | write a moment later; the file on disk stays until the new one replaces it |
| another vault is open, a vault went away, a vault became an encrypted workspace | wipe, then write |
| a workspace was locked, the switch or the AI went off | wipe |
| the write failed | wipe: the older file may name what the newer one no longer does |
| the wipe failed | the status keeps saying what is there, and the next pass tries again |

A pass that names nobody leaves no file at all. Why it names nobody is kept for the settings (`IntentDirectoryStatus`): off, an encrypted workspace, rules that cannot be read in full, or nothing that may be named.

After every change the bridge calls `updateAppShortcutParameters()`, so that the system learns the names for "Open ⟨note⟩ in Plainva" again.

## Redeeming

`planIntentOrders` sorts what waits: captures oldest first, the last place to go while it is younger than two minutes, and what is moot — words that are none, an older place. `redeemIntentOrdersWith` clears the moot first, then writes each capture and clears it, then resolves the place.

- **A journal entry** goes through `appendPlannedJournalEntry` with the day and the minute it was said. The plan is the same on every try, so a retry after a kill finds its own entry and writes nothing.
- **A task** goes through `createTaskInDatabase`, its words read by `parseTaskCapture` with the vocabulary of the app's language and the day it was said as "today". The provider's list is asked after the note exists, where the database names one. Without a task database it is a journal entry with an open box.
- **What cannot be written now** — a workspace that is locked, a vault in memory that is not the open one, a database that refuses — stays in the queue and is counted as waiting.
- **A place** is parked and signalled (`m-intent-nav`), because an intent can be what started the app; `PendingIntentRunner` opens the note, or the search with the words.

## Testing

- `systemIntents.test.ts` (desktop suite) — the key and its vectors, the directory's bounds and cleaning, what is and is not an order, the plan, where an order leads.
- `intentService.test.ts` (mobile suite) — the gate with a note's own rule, a folder's rule in either spelling and the rule about the internet; every "cannot tell"; when the file is written and wiped; redeeming through the app's paths.
- `ios/App/tests/IntentStoreTests.swift` — compiled and run by `swiftc` in the iOS workflow, against a temporary directory: what counts as a directory, the matcher, the queue.
- `e2e-prod/ai-system-assistant.spec.ts` — the production bundle with a bridge of the test's own (`globalThis.__plainvaFixtureIntents`, honoured only where no native platform answers): no file until the switch is on, no trace of a note a rule keeps back, the switch empties the file, a dictated entry and task are in the daily note after the app opened, a key opens its note, and a key the list no longer names opens the search.

## Not verified

No intent has run on a device or in a simulator with Siri: what the system understands of the phrases in ten languages, how it asks for the missing words, and what it shows for a note are unseen. The Labs build is called "Plainva Labs", and its phrases carry that name. Whether iOS resolves the string catalogs' `zh-CN` for a device set to Simplified Chinese is the same open question as for the share extension's catalog.

## Not built

AppFunctions on Android (parity catalog `ai-system-intents`); an intent that asks Plainva's own assistant; the system's assistant schemas; completing or changing a task; reading a note's text to the system.
