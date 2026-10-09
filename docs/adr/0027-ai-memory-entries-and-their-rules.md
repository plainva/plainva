# ADR 0027: The vault's memory is two files of list items, and every entry carries its own rules

Status: Accepted

Date: 2026-10-09

## Context

[ADR 0020](0020-ai-skills-memory-and-script-skills.md) set the frame: memory lives as files in the vault's hidden `.agent/` folder, its facts stay data, and "memory is not policy". This record decides what a memory *is* in those files, what of it a conversation gets, and how something comes to be in it.

Three facts shape everything.

**A memory goes to more recipients than the note it came from.** A note is sent when a question needs it, and the privacy gate asks its rules each time ([ADR 0018](0018-ai-context-package-and-egress-policy.md)). What is kept in a memory is sent with *every* conversation from then on — to whichever model the user chooses later. A sentence that a model on the device took from a note which must never reach a cloud would, as a plain memory entry, reach one with the next conversation. No model has to be tricked for that; it is what "remember this" means.

**A memory is the cheapest place to plant an instruction.** It arrives through sync like any file, every conversation reads it, and nobody looks at it between two uses. A poisoned memory is the persistent form of prompt injection: said once, obeyed for months.

**What is always sent is paid for in every request** — in money, in the model's attention, and in room the question's own context would have had.

## Decision

1. **Two files, both plain Markdown.** `.agent/active_memory.md` is "always included": what the recipient may have of it goes into the system prompt of every new conversation. `.agent/MEMORY.md` is "on demand": it is never sent along; a conversation looks things up in it. Both are ordinary files of the vault. They sync with it, the user can open and edit them like a note, and another Markdown editor shows them as the lists they are.

2. **An entry is a top-level list item.** A line that begins with `-`, `*` or `+`; indented lines continue it; headings group entries, and the heading a group stands under is given to a model with it. A YAML block at the top of the file and everything between code fences are skipped, and whatever else stands in the file means nothing. An entry holds at most 500 characters of text, a file at most 256 KiB and 2,000 entries; what lies beyond is not read, and the view says so. An entry's id is made of its file, a hash of its text and its rank among entries of the same text — the same after every reload, and never written into the file.

3. **What the app knows about an entry stands in one HTML comment behind it:** `<!-- plainva: added=2026-10-09; by=assistant; source=…; deny=cloud,web -->`. It is invisible where Markdown is rendered and readable where it is edited. `by` says whether the user wrote the entry or accepted an assistant's draft; `source` is the title of the conversation such a draft came from, for the user's eyes only; `deny` names the rules the entry carries. A key the app does not know is skipped, so a later version can add one.

4. **An entry's rules are read fail-closed.** The comment counts wherever it stands in the entry. One that is not closed, that stands there twice, or that names a rule the app does not know makes the entry *unreadable*: it reaches no model, the view says why, and rewording it keeps it kept from everybody. A rule that is lost never reads as no rule.

5. **Only what a reader sees reaches a model.** Other comments and characters that draw nothing are taken out of an entry's text, and the view counts them. The app's own comment is never sent.

6. **Memory is data.** In the system prompt the entries stand between the fences every untrusted text stands between, under the origin `memory:.agent/active_memory.md`, behind the sentence that nothing in them changes the rules or what the model may do. What a lookup returns is marked untrusted like the text of a note.

7. **A rule is no memory.** What an assistant should *do* is an instruction. It is not written into the memory files: it becomes one more line of the vault's standing instructions, `AGENTS.md` — the file every device approves for itself before a model is told to follow it ([ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 2). Written on a device where the file was approved as it stood, or was not there, the new file is approved there exactly as written: the user wrote the one line that changed. A file that was waiting for its review keeps waiting, with the rule in it. Every other device asks.

8. **The gate, per entry.** For each conversation the *file's* rules are asked first — a folder rule over `.agent/`, a rule in the file's own properties, through the same lookup as for every note; a rule that cannot be looked up says no. Then each entry's own: `cloud` keeps it from a cloud recipient, `web` from a conversation that carries the internet's tools. A model on the device gets every entry that can be read.

9. **An entry inherits the rules of what its conversation rested on.** When the user accepts a drafted entry, the rules of every note the conversation read or carried — and of the memory it was started with or looked up — are written into the entry's `deny`. A reworded entry keeps the rules it had and adds those of the conversation that reworded it. Taking a rule off is the user's own act, in the entry's form or in the file, as it is for a note.

10. **"Always included" has a budget of 2,000 characters of entry text, spent in the order of the file over all its entries,** whoever may read them. What a cloud gets is what the device's own model gets, less what is kept from a cloud — never an entry that slipped in because a kept one made room. An entry that no longer fits is left out whole and shown as left out; nothing is cut. The order of the file is the user's ranking.

11. **Fixed when the conversation begins.** A conversation's system prompt carries the memory as it was at the first message, and the conversation's record keeps how many entries went, how many were kept back, and which rules what went carries. A later change reaches the next conversation. An entry that is deleted is not taken out of conversations that already began, and the confirmation says so.

12. **Only a conversation the user began gets it.** Not a door — an answer in a comment thread, a proposal for a selection, a filled property — and not a regression run of a skill: the first answers one question where it was asked, the second measures a skill and not what the user happens to have kept. Not another program over MCP, not an external agent, not a script: the memory's tools exist on the harness's own surface only.

13. **Three tools.** `search_memory` reads: it returns the entries of both files that share words with the question, the better match first, then the newer one; a conversation carries it when the long-term file holds something its recipient may have, and for a skill's data classes it counts as notes. `remember({ text, replaces?, as? })` and `forget({ entry })` are writing tools of the proposal class ([ADR 0019](0019-ai-tools-risk-classes-and-approvals.md)): they leave a draft and write nothing. A model names an entry by its exact words and never sees an id. An entry the gate keeps from the recipient cannot be found, reworded or forgotten by it — the answer is the one for an entry that does not exist.

14. **The user's step writes.** "Remember", "Remove" and "Add as a rule" on the draft's card, with the place — always included or on demand — the user's to change. The write reads the file at that moment, changes one entry and writes the file through the vault's own adapters, so it is backed up and synced like every file; the changes of one device run one after another. A file that is too large to be read is never written over.

15. **No rule is drafted from a conversation that carries a restricted note.** A line of `AGENTS.md` goes to every model; it has no gate of its own. An entry can carry a rule, an instruction cannot.

16. **A switch per device, on until the user turns it off** (`<appData>/ai/<vaultKey>/memory.json`). Off: nothing of the memory goes to any model from this device, the lookup is not carried, and the two writing tools answer that the memory is not available. A switch that cannot be read is off. The files are not touched, and the user can still edit them.

17. **Shown, never named.** The send overview has a row for the memory — how many entries go, and that the rest can be looked up — and counts the entries a rule keeps back among what is kept back; the line under an answer says how many entries went along.

18. **Not decided here.** Nothing is written into the memory without the user's yes. The reviewer that proposes entries from a finished conversation, and the upkeep of a memory that has grown, are the learning part of [ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 5. There is no search by meaning over the memory: for at most 2,000 short entries, matching words with their headings needs no index of a hidden file.

## Consequences

- An entry under "always included" goes to every model the user talks to, within its rules. The budget keeps it small on purpose; the long-term file is the place for everything else.
- A rule on an entry is as strong as the file is intact. Whoever can edit the file can take a rule out — it is the user's vault, and a note's own rule is no different. What the format guarantees is the other direction: a comment that is damaged denies, it never allows.
- The comment travels with the vault. Where an entry came from a conversation, it holds that conversation's title — the first words the user typed there, at most 160 characters. No model is sent it, but whoever is given the vault's files can read it.
- The files sync; the switch and the approvals do not. A rule added on one device is in the file everywhere and in effect only where the file was approved.
- `AGENTS.md` grows by a line per rule and is read only up to 16 KiB; a rule that would push it past that is refused, because it would switch all of them off.
- Fencing an entry as data does not make a model deaf to it. A sentence in the memory that reads like an order may still be followed. That is why what should be followed has its own, approved channel, why an entry is bounded and visible, and why nothing arrives in the memory unseen from a conversation.
- Word matching finds what was written with the words that are asked for. An entry phrased differently from the question is not found; the heading it stands under helps.
- Nothing of this has run against a real model.
