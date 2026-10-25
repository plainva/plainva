# ADR 0034: A run's snapshot is its own line, kept as versions — and the same question can go to another model

Status: Accepted

Date: 2026-10-25

## Context

The plan's "context snapshot" (§ 18) asks for what made an answer — the request, the context package, the sources with hashes, the skill's version, provider and model, the tools, the rules, the result and what it changed — and for a **provider replay**: the same context asked of another model.

Most of it is kept already. Each run of a conversation has a record (`RunMeta`): its user turn, provider and model, the notes its context carried and the ones a rule kept back, its usage, its steps, its send overview (the manifest: each source by path, section, tier and reasons), the skills it used, what it asked of the internet, of mail, of foreign servers, the notes its tools read, the rules that passed and what it left for the user — suggestion rounds, drafts, plans. The line under each answer already opens that record as the send overview (ADR 0018). What is not kept is the version of what went: whether a note still reads as it did for the answer cannot be told.

## Decision

1. **The snapshot is the line that is already there.** Opened, the line under an answer shows the send overview as before, and beside it the run's snapshot: when it was asked, each source with its version and how it reads now, the notes the run's tools read with theirs, the tools it called and how often, the version of each skill it used, and what it left. No surface of its own: the same component in both shells (`AiSendOverview`, filled by `AiRunOverview`).

2. **Versions, never text.** A version is the SHA-256 of a note's text as the run read it — for the context package, every note it read for evidence or a card (`PackageRef.hash`, carried into the manifest's sources); for the tools, every note a tool was given whole (`RunMeta.readHashes`, through the gate's `passed`, which now gets the text where the tool had it). A handle of the context map read nothing and has none; a note a search only found has none. A skill's version is the SHA-256 of its `SKILL.md` as the scan saw it, for the bound skill and for every one the model loaded. The record keeps these hashes and paths, never a word of a note; read back, anything that is no hash is dropped.

3. **"Changed since" is asked when the line opens, on this device.** Each kept version against the note as it is then: **unchanged**, **changed since**, **no longer there**; a skill against its `SKILL.md` now. Nothing is sent, nothing is stored. A changed line end is a changed text: the version is what the run read.

4. **Asking another model is a new conversation, begun as the user would begin it.** "Ask another model…" asks the run's words again of a model the user picks from the profiles of this device — not the one that answered, and while the device is fully local only one on it. The new conversation pins exactly the notes the run's context read, takes nothing a search would find besides them (`pinsOnly`), leaves the note that happens to be open out, binds the skill the original was bound to where it is still active, carries the vault's memory and tools as any conversation does and the internet where the original had it and the vault allows it now. It says where it comes from (`ConversationRecord.replayOf`: the conversation, the run, when, which model, how many of its notes changed since) and offers the way back to it.

5. **The gate holds as it holds now, and the send overview asks as always.** A note the rules keep from the chosen model now does not go, even if it went then; the overview counts it as kept back. A different provider or model is a growing scope (ADR 0018): the overview asks before anything is sent.

6. **Two limits.** Only the **first question** of a conversation is asked again: a later one rests on what was said before, and that history carries text that was put together for the original's reader — a model's answers that quote notes, results of tools — which a replay could not gate again without rebuilding it. And only a question that brought **nothing but notes** beside the user's words: the material of a door (a selection, a picture, a recording, a comment thread, a database's columns) and of a folder's log is not kept to bring again. The line says why where it offers nothing.

7. **No verdict.** Plainva does not compare the two answers; both conversations stand side by side in the history, and the replay names its original.

## Consequences

- A snapshot costs a hash per source and per note a tool read — a few dozen bytes each, bounded like the paths of what was read (`RUN_READ_CAP`). Older records have no versions; their lines show what they always showed.
- "Changed since" reads each kept note once when a line opens. A conversation with many sources opens a little slower; nothing happens before the line is opened.
- A replay sends the notes as they are now, not as they were: the record keeps no text to send. A source that changed is said in the line before the replay and in the replay's head.
- The model chosen for a replay is one of the device's profiles: a model that is set up but not in a profile is not offered.

## Alternatives

- **Keep the texts that went.** It would make a replay exact — and the history a second copy of every note a model was shown, kept beside the vault and outside its rules. Rejected: versions tell whether something changed; the vault keeps the texts.
- **Replay the whole conversation.** It would ask later questions too. The history holds answers and tool results put together for the original's reader; sending them to another model would need every one of them gated anew for that model, and an answer that quotes a note the new model may not see cannot be cut without changing it. Rejected for now; the first question of a conversation is what most comparisons need.
- **A comparison view.** Two answers side by side, with what differs marked. Not built: two conversations already stand side by side, and a mark of "what differs" in prose would be one more judgment the app makes.
- **The skill's whole folder as its version.** A skill's other files are loaded one by one and seldom; `SKILL.md` is what every bound run carries. The version is that file's.

## Links

- ADR 0018 (the context package and the send overview), ADR 0019 (the Rule of Two), ADR 0020 (skills and their approval), ADR 0030 (fully local), ADR 0033 (its addendum of 2026-10-25: how notes developed).
- `packages/core/src/ai/runSnapshot.ts` (the version of a note, its state now); `PackageRef.hash` in `packages/core/src/ai/context/package.ts`; `RunMeta.readHashes`, `RunMeta.skills[].sha256`, `ConversationRecord.replayOf` in `packages/core/src/ai/history.ts`.
- `packages/ui/src/ai/runReplay.ts` (what can be asked again, with which notes, which tools a run used); `AiSession.snapshotStates`, `AiSession.replay` and the `replay` start of a run in `packages/ui/src/ai/aiSession.ts`; `AiRunOverview.tsx`, `AiSendOverview.tsx`.
- [AI threat model](../engineering/AI_Threat_Model.md), T82.
