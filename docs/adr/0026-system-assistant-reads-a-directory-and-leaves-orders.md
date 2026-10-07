# ADR 0026: The system's assistant reads a directory the app wrote, and leaves orders the app redeems

Status: Accepted

Date: 2026-10-07

## Context

On an iPhone or iPad, Siri, Shortcuts and Apple Intelligence reach an app through App Intents. The harness plan names them as the phone's counterpart to the MCP server of the desktop ([ADR 0022](0022-mcp-server-without-a-network-port.md)): finding a note, opening it, and capturing a journal entry or a task, "under the same hard gate, through the write paths the app already has".

Two facts shape everything.

**No JavaScript runs while Plainva is closed.** An intent runs natively, in a process the system starts for it, often without a scene and without the web view. The vault, its index, its privacy rules, the journal, the task database and the sync all live in the web layer. This is the fact the home-screen widgets are built on, and the answer is the same: what a native surface needs has to be written down while the app runs, and what it wants done has to wait until the app runs again.

**The system's assistant is somebody else.** What it does with a title it was given — on the device, in its maker's cloud, in another assistant it hands a request to, in a search — is not Plainva's to know. For Plainva's own assistant the send overview shows what leaves and the privacy gate decides it ([ADR 0018](0018-ai-context-package-and-egress-policy.md)); an intent has no overview and nobody to ask.

Android's counterpart, AppFunctions (Android 16), is an experimental preview: its library is an alpha and only apps admitted to an early access program reach the assistant (Android developer documentation, read on 2026-10-07).

## Decision

1. **An intent reads one file and appends to another. It reads no note and writes nothing into the vault.** The app writes a *directory* of titles while it runs; an intent leaves an *order* — what was asked for, and when — which the app redeems when it next comes to the front. Writing a journal entry or a task in Swift would be a second truth about the daily note, the task database, the capture grammar and the sync.

2. **At the privacy gate the system's assistant is a cloud recipient that may use the internet.** A note kept from the cloud *or* from web access is not in the directory, whatever the device the assistant runs on. The directory asks the core's own gate (`gateDecision` over `effectivePolicy`, with each note's own rule from the index and the folder rules of `.agent/policy.yml`); there is no second reading of a rule.

3. **Where the app cannot tell, it names nobody.** The folder rules cannot be read, or the file has a line the parser does not understand; the index does not answer; the notes' own rules cannot be asked; the vault in memory is not the one that is open; there is no secret for the keys: the directory is empty. Inside the app a misspelled rule is skipped and reported where the context is shown. A directory can report nothing, so a rule with a mistake in it keeps every title back until the file reads cleanly.

4. **Nothing of an encrypted workspace, locked or open.** Its titles are what it seals.

5. **Off until chosen, per device, on top of the opt-in of the AI itself — and off means no file.** Until the switch is on there is no directory at all, not an empty one and not a hidden full one. *Capturing* needs no switch: it tells the system nothing about the vault.

6. **A row is a title, the name of the note's folder and a key. Never a path, never text.** The key is SipHash-2-4 of the path under a secret of this device, sixteen hex digits. The secret and the table from key to path stay in the app's own storage. A key is the same for as long as the note stays where it is, so a shortcut somebody saved keeps meaning its note. A key the table does not know any more — the note moved, or may no longer be named — becomes a search for the title that was chosen; no note is opened by guess.

7. **Bounded.** At most 2,000 notes, the ones changed last, and less than a megabyte; a title is one line of at most 120 characters with nothing invisible in it; of the folder only its own name.

8. **Two files in the App Group, protected differently.** `intents-v1/notes.json` cannot be read while the device is locked. `intents-v1/orders.json` is protected until the first unlock only. Neither is part of a backup.

9. **An order is words and a moment.** Four kinds: open, search, journal, task. What somebody asked to have *written* is never dropped for its age — it is written when the app next opens, into the day it was said on — and a queue that is full of such words takes no more and says so. Somewhere to *go* is about now: only the last place counts, a new one replaces the one before, and after two minutes it moves no screen.

10. **Redeemed through the app's own paths, one by one.** A journal entry through the journal's planned entry, which finds its own entry again on a retry. A task through the task database's creator, read with the capture grammar of the app's language, "tomorrow" counted from the day it was said; the provider's list after the note, where the database names one; without a task database, a line with an open box in the journal. Each order is cleared the moment it is written. What the vault cannot take now — a sealed workspace, another vault — waits.

11. **Redeem first, then write the directory.** An order names the directory it was read from.

12. **When the directory is written.** At start; on every return to the front; as the app leaves, not debounced; a moment after a note was saved and indexed, files came, went or moved, the index was rebuilt or the folder rules were saved. It is wiped *first* where another vault is open, a vault went away, a vault became an encrypted workspace, a workspace was locked or the switch went off. A directory that could not be written is wiped, because the older one may name what the newer one no longer does; a wipe that failed is not reported as "nothing".

13. **The intents ask for an authenticated person.** What is dictated ends up in the vault as the person's own words, so it is not taken from any voice near a locked phone.

14. **One switch, and what it does is shown.** Below it: how many titles the system can read right now, or why there are none. An intent that captures answers honestly that Plainva writes it down when it is next opened.

15. **Android is a recorded gap, the desktop a decision.** Parity catalog `ai-system-intents`: AppFunctions follow when they are open to every app; the desktop's way for another program to use the vault is the MCP server.

## Consequences

- What the system does with a title is outside Plainva. The system also keeps copies of its own — of the notes it offers for a spoken phrase, of a note a saved shortcut names. Plainva tells it when the directory changed and cannot see whether it forgot.
- The directory follows the vault by one pass. A note marked as private a moment ago is still named until the directory is written again — a moment after the save, and at the latest as the app leaves.
- Titles and folder names lie in the App Group container, readable by the app and its extensions and not while the device is locked. Keys travel further — the system keeps one as a note's identity, a shortcut that is shared carries it together with the title its author chose. Without the device's secret a key says nothing about where a note lies.
- What is said to the system's assistant is the system's to process, by the person's own act. It then lies as text in the orders file until the app opens.
- A task is created from words alone: no list is chosen, no date is confirmed. It is read exactly like a line typed into the capture field, and the result is an ordinary task note.
- Which rows somebody means by what they said is matched in Swift, over titles: without case, accents or width, the title itself first. It is a second, small matcher, not the app's search — the search intent opens the app's own.
- Nothing of this has run on a device. The Swift store and the matcher are tested by a standalone compiler run in CI, the web layer by unit tests and a production-bundle test with a fixture bridge.

## Alternatives

- **Read and write the vault natively in the intent.** Rejected: see decision 1.
- **Start the web view in the background to run the app's code for an intent.** Rejected: an intent has seconds, the vault's boot does not fit into them reliably, and a half-run sync or index is worse than an order that waits.
- **Hand the notes to the system's own index (Core Spotlight) instead of a file of Plainva's.** Rejected for now: it is a second, broader recipient with its own retention, and it would need its own answer to every question above.
- **The path as a row's identity.** Rejected: it would put the vault's structure into every saved and shared shortcut.
- **A plain hash of the path as the key.** Rejected: anybody could check a guessed path against it.
- **No switch — "a title is only a name".** Rejected: a title is content; the privacy rules already treat it as such ([ADR 0018](0018-ai-context-package-and-egress-policy.md)).
- **Apply `cloud: deny` only.** Rejected: `web: deny` keeps a note out of every run that may use the internet, and nobody can say that this recipient does not.
- **Skip a rule the parser does not understand, as the app does.** Rejected: see decision 3.
- **Let an order expire after a month.** Rejected: words somebody asked to have written down are not Plainva's to drop.
- **Take a capture from anybody, also at a locked phone.** Rejected: see decision 13.

## Deferred, and why

- **Android AppFunctions.** Trigger: the interface is open to every app. Then the same directory and the same orders, behind a second native bridge.
- **An intent that asks Plainva's own assistant.** It needs a run while the app is closed: a provider call, the gate and the overview without the web view. Trigger: a native path for runs.
- **The system's assistant schemas** (the journaling and search domains of App Intents). They change how the system understands an intent, not what the intent may do. Trigger: a device test that shows what the plain intents leave open.
- **Changing or completing a task, reading a note aloud.** Each is more than a title: a write with a choice in it, or text handed to the system.

## Links

- [ADR 0017](0017-ai-harness-architecture-and-native-boundary.md), [ADR 0018](0018-ai-context-package-and-egress-policy.md), [ADR 0022](0022-mcp-server-without-a-network-port.md)
- [System assistant — architecture](../engineering/System_Assistant.md), [AI harness threat model](../engineering/AI_Threat_Model.md) (T33, T34)
