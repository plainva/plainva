# ADR 0029: Upkeep hints are the device's own arithmetic, each ends in one step the user takes, and memory care is a skill that drafts

Status: Accepted

Date: 2026-10-09

## Context

[ADR 0028](0028-ai-learning-suggestions-and-skill-versions.md), decision 18, left two things open: the hints that need no model, and the upkeep of skills and a memory that have grown. The plan names the signals — a sequence of steps the user took by hand again and again, a skill that shows a weakness — and a skill of the app that curates the memory, and it sets the gate of this part: no live self-change; every change approved and reversible.

Three facts shape everything.

**A hint that costs a request would have to ask first.** Learning costs a request, so it is started by the user for one conversation ([ADR 0028](0028-ai-learning-suggestions-and-skill-versions.md), decision 1). A list of things to tidy that a model had to make would either ask each time it is looked at or be made behind the user's back. What can be known without a model should be said without one.

**The device already holds what there is to know.** The skills and their approvals; the run ledger — which tools a run called, how it ended, which skills it used, and no content; the results of the regression runs; the entries of the memory with the day each was added. Nothing has to be read anew, and nothing has to leave the device.

**A coarse measure is wrong sometimes.** Two descriptions made of nearly the same letters can be about two jobs. A skill nobody ran since spring can be the one for the annual accounts. Whatever such a measure finds can only be a question.

## Decision

1. **Computed on the device, from what it holds.** Arithmetic over the instructions and their approvals, the ledger, the regression results and the memory's entries as the session has them. No model is asked, nothing is sent, nothing is written. A view computes its hints when it opens and whenever one of those changes.

2. **Nine things are said, and no others.**
   - *Two skills say almost the same*: both in force — so a model chooses between them —, at least one of them the vault's own, and their descriptions (0.6) or their instructions (0.75) alike.
   - *A skill nobody ran for 90 days*: one of the vault's own, in force on this device for that long.
   - *A skill names a tool Plainva does not have*: the reading the grant already has ([ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 4).
   - *A skill did not pass its test*: only a result that still stands for the skill as it is and the model chosen now.
   - *A skill's runs end without an answer*: two of the newest five runs of the version in force, counted as the watch counts ([ADR 0028](0028-ai-learning-suggestions-and-skill-versions.md), decision 13). Not while that version is watched and failed — the watch says it already, with the way back.
   - *A way gone by hand*: the same tools, in the order each was first used, in three conversations within 30 days — at least three tools and four calls, every step worked, the run answered, and no skill was used.
   - *Two entries of the memory say almost the same* (0.7), *an entry is older than a year*, and *"always included" holds more than fits*.

   Alike means: made of the same letters. Both texts are folded to their letters and digits, of any script, and compared by the triples they share. The measure knows no language and no meaning.

3. **A hint is a question.** Its row says what was noticed and why it counts — "say almost the same", never "duplicate" — and the card says of itself that no model was asked and that each line is a question, not a finding.

4. **One step, and the user takes it.** Compare, switch off, open the file, test again, edit the entry, or have a conversation reviewed. Each is something the user could do by hand in the list below; none of them writes into the vault. Switching a skill off changes this device's list. A review opens learning's own dialog, which says what would be sent and asks ([ADR 0028](0028-ai-learning-suggestions-and-skill-versions.md), decision 1) — a hint is no consent.

5. **A review is offered only where it could teach what the hint is about.** A run that read text of strangers teaches no skill ([ADR 0028](0028-ai-learning-suggestions-and-skill-versions.md), decision 6), so such a run is no "way gone by hand", and a failing skill is then offered its file instead of a review. A hint never leads to a conversation the history no longer holds.

6. **Not claimed where the device cannot know.** The ledger holds the newest 500 runs. "Not for 90 days" is said only where the ledger reaches back that far or is the whole of what ever ran here. A run nobody typed — a door's answer, an action at a note, a regression run — is marked in the ledger from now on and is no use of a skill, no failure of one and no way gone by hand.

7. **"Don't show again" is the device's own, and holds for the matter as it stands.** Kept in the app's data per vault, never in the vault: what a device wants to be asked is nothing a vault's writers should settle. A hint's key holds the state it was about — a file's hash, an approval's time, a run's — so it returns when the matter itself has changed. Of one kind at most three are shown; the next takes a place once one is settled.

8. **Memory care is the app's one skill that drafts.** Every skill of the app reads and shows ([ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 4). Memory care names three tools — the memory's search and its two drafting tools — because what it finds is only of use as something the user can accept: one entry instead of two, an entry to take out. A draft changes nothing ([ADR 0032](0032-ai-memory-entries-and-their-rules.md), decision 14). Where two entries contradict each other it drafts nothing and asks. A test holds the exception to exactly these three tools, and every other skill of the app to tools that read and show. The skill brings no regression scenarios: a regression run is given no memory.

9. **Nothing tidies by itself.** No skill is switched off, no entry merged or removed, no review started, and no hint acted on without the user's step. Hints are not synced: each device computes its own from its own ledger.

## Consequences

- The measure finds what is nearly word for word the same. Two entries that say the same in other words are not found by it; the skill finds them, with a model, when the user starts it.
- Entries built alike — "Client A wants invoices as PDF", "Client B wants invoices as PDF" — are asked about although they are two facts. "Don't show again" is the answer, and it is remembered.
- A device new to a vault has an empty ledger and fresh approvals: it says nothing about use for a season.
- Runs recorded before this version carry no mark. Until they have left the ledger, a regression run among them counts as a use.
- The ledger knows tools by name. A "way gone by hand" says which tools, not what for; whether it is worth a skill is the review's question and then the user's.
- The hints of two devices differ, and so do what each was told not to show.
- Memory care has run against no real model, and nothing of this has run on a device.

## Alternatives

- **A model that looks through skills and memory when the view opens.** Rejected: a request per look, and a second way a conversation's content would leave the device without having been asked for.
- **Likeness by embeddings.** The device may hold them (search by meaning). Rejected for now: they are an optional package, so the same question would be answered in two ways, and "these two entries are close in meaning" is exactly what the skill is for.
- **Switching a skill off after a season without use.** Rejected: a change nobody saw — the very thing the gate of this part forbids.
- **Dismissals in the vault, so every device has them.** Rejected: a writer of the vault could silence a hint on someone else's device, and the hints themselves differ per device.
- **Memory care without drafting tools, answering in words only.** Rejected: the user would retype what the model found. A draft is the form this app has for what an assistant wants to exist.
- **Counting every run for "a way gone by hand", also those with a skill or with the internet.** Rejected: a run with a skill is no handwork, and for a run that read strangers' text the step offered could not deliver what the hint promises.

## Addendum 2026-10-24 (hints at the open note)

Plan KI-Harness P8-3 brings the same kind of hint to the open note: what the device notices by itself in the note's text, said without a model, each ending in one step the user takes. The decisions above hold for it; these are its own.

10. **Three things, from the note's text, the index and the calendar.** A link of the note that leads nowhere, asked of the index by the rule a click on it follows — a link to a file that is no note (a picture, a recording, a PDF, a database) is no note to create and no hint; a line that begins with `TODO` and is no task yet, outside the properties block and outside a fenced block; and in today's daily note an appointment of tomorrow that no note is anchored to (`plainva.pim`). At most three, one of each kind first, round by round. A mention of another note without a link is the context graph's offer and a note close in meaning the related notes': neither is said a second time.

11. **Each step is the app's own way, on the click.** "Create note" creates the note where the link will find it, as a click on the link does. "As a task" turns exactly that line into `- [ ] …` where it stands, through the chain's one entry for a change, keeping the note's line ends and its byte order mark — and only while the line still reads as it did when the hint was found; otherwise nothing is changed, and the hint says so. "Create meeting note" does what the calendar does, template and its questions included; questions that were cancelled wrote nothing and are no failure. No step is taken by itself, and none is offered that the app does not take elsewhere already.

12. **A change the assistant writes into a note reaches its editor.** The chain counts the app's own write as its own, so no watcher tells an open editor of it. The assistant's host tells it — for the step of a hint, a rule kept on this device and a folder's log, in both shells —, the way the journal tells it on the desktop; the editor adopts the change as it adopts one made outside.

13. **Off is off, and what rests is this device's.** The hints follow the AI's switch and their own (`noteHints`, on once the AI is on). What is hidden, the notes paused and a paused vault are kept in the app's data per vault (decision 7), and the settings bring each back. A hidden hint returns when its link or its line reads differently.

Consequences of the addendum:

- On the desktop the hints are a section of the right sidebar after Related, which disappears where nothing stands out and stays for a paused note; on the phone a tab of the note's sheet after Related, which says why it is empty.
- Which files are no notes is a list of endings in the shared host. A note whose name holds a dot (`[[Plan.v2]]`) is a note.
- Tomorrow's appointments come from the calendar's own store; a calendar that was not synced since yesterday names what it knew then.
- Nothing of it has run on a device.

## Links

- ADR 0019, ADR 0020 (decisions 4 and 5), ADR 0032 (decisions 12 to 14), ADR 0028 (decisions 1, 6, 13 and 18).
