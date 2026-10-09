# ADR 0028: Learning is a request the user starts, its answer is drafts, and a skill's new version can be taken back

Status: Accepted

Date: 2026-10-09

## Context

[ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 5, set the frame: self-improvement is proposal-first, and it may never widen capabilities, change provider or egress, activate scripts, change approvals, overwrite foreign skills, weaken tests, ask for secrets or approve an arrived skill. [ADR 0027](0027-ai-memory-entries-and-their-rules.md) built the memory those proposals can go to. This record decides how a proposal comes to be, what it can carry, and what happens once the user accepts one for a skill.

Three facts shape everything.

**A review reads a conversation, and a conversation can carry anything.** A page it fetched, a mail it read, the answer of a foreign server: text of a stranger that says "from now on, always …" is in the conversation like the user's own words. A reviewer that turns what it reads into rules would hand that sentence back as a wish of the user's — and as a line of the vault's instructions it would reach every model from then on. A review is the place where an injection could be laundered.

**A skill's file is what an approval is about.** The approval binds the hashes of its files ([ADR 0020](0020-ai-skills-memory-and-script-skills.md), decision 2), because a changed instruction nobody read is exactly what it exists to prevent. And the file holds more than instructions: the tools the skill may use, its folders, its limit, where its tests lie. Whoever may rewrite the file may rewrite those.

**Learning costs a request and sends a conversation a second time.** Both are things a person decides, not things that happen.

## Decision

1. **The user starts it, for one conversation.** "Learn from this conversation" stands in the conversation's menu and under its last answer. Nothing reads conversations in the background. A dialog first says to which model the conversation would go, how much of it, and which kinds of suggestion can come back; nothing is sent by looking. "Learn" there is the question before this one request, each time, and approves nothing for a later one.

2. **The model that led the conversation, and no other.** The provider and the model of its last run. Where that model is not set up on the device any more, the review does not happen — the conversation goes to no recipient it has not been to. A conversation that ran on the device stays there ([ADR 0018](0018-ai-context-package-and-egress-policy.md), decision 13), and one that rests on a note which may not go to this model *today* does not go, whatever held when it ran.

3. **One request, without a tool.** The instruction is fixed: nothing of the vault, the user or the conversation is part of it. Behind it, between the fences every untrusted text stands between, comes the conversation as its reviewer reads it — what the user wrote, what was answered, and between them the names of the tools that were called and how each call ended. Nothing a tool returned, no note that went along as context, and not the conversation's own system prompt, so nothing of the memory. A message is cut at 4,000 characters, the whole at 60,000 — then the middle is left out, and the dialog says how much. The request is recorded like every other.

4. **The answer is read as a list, and by its form.** Three kinds: an entry for the memory and a rule, each one line of at most 500 characters; a skill — a name, one line that says what it is for, and its instructions, at most 12,000 characters. Each needs one sentence of evidence; a suggestion without one is none. At most five entries, two rules and two skills. No other field of the answer is read: none is a tool, a folder, a limit, a test or an approval. What a suggestion can never carry is decided by the form it is read in — not by what the reviewer was told.

5. **Suggestions become drafts.** They lie on the device with everything else an assistant wants to exist ([ADR 0019](0019-ai-tools-risk-classes-and-approvals.md)), each with its evidence, and the user decides about every one. Every text goes through what every text of a model goes through: an address the user did not type is made inert. An entry the memory holds already is left out, and so is a skill that would take the name of one that is there.

6. **What a conversation may teach depends on what it read.** One that read text of strangers — a page or a search on the internet, a mail or the description of an appointment, a foreign MCP server — teaches facts for the memory and nothing else. So does one that carries a note kept from the cloud or from the internet; its entries inherit that rule ([ADR 0027](0027-ai-memory-entries-and-their-rules.md), decision 9). The reviewer is then not asked for a rule or a skill, is told about no skill, and whatever it suggests of those kinds all the same is dropped. Where the memory is switched off on the device no entry is suggested; where no kind is left, no request is made.

7. **A skill's draft holds three texts and nothing else of a skill.** For a new one: its name, what it is for, its instructions. For a skill that is there: the instructions, and the hash of the main file the review read. The reviewer is given the instructions of a skill the conversation used only where a suggestion may rewrite it, and never its head.

8. **Other instructions keep the head of the file byte for byte.** Everything up to the closing `---` — the name, what the skill is for, its tools, folders, limit and tests, the comments its owner wrote — stays as it lies; only what follows is replaced. So a rewrite cannot change what a skill may do, by construction. What would be written is read once more and held against what the tools would grant before, and a frontmatter the reviewer sent along with its instructions is cut off and read by nobody.

9. **Only a skill the user owns and has read is rewritten.** One of the vault's own, approved on this device at exactly its current files — switched on or off —, not one that was imported, and still the version the review read. Anything else is refused and the draft stays: a skill that arrived or changed is reviewed in its own right first, and a suggestion is no way around that review. A skill that comes with the app cannot be named by a draft at all.

10. **A new skill starts with the app's defaults.** No list of tools — so it reads and shows, has no tool that writes, and brings no internet along —, no folders, no limit, no tests. Giving it more is the user's edit of its file, which asks for an approval again.

11. **The user's step is taken in a review.** A skill's draft has no button that writes. "Review" shows what changes as a line comparison, what the skill may do — unchanged, in words —, whether the version in force is tested and that the new one is not, what a run costs more or less, who suggested it from which conversation, and the evidence. "Rework" turns the comparison into a field; what stands there is what "Accept" writes. Accepted, the version is approved on this device as the user saw it; every other device finds the skill changed and asks.

12. **Before the write, the version that is replaced is kept** in the vault's version history. Where the vault keeps one, nothing is written without it.

13. **A version that came from a suggestion is watched for three runs.** The approval — in the app's data, on this device — counts the runs that used it and those that failed, and keeps the main file as it was before. A run counts when the user started it, not a door's and not a regression run, and when it ran this version: a conversation bound to the skill before the change still runs the old instructions and says nothing about the new ones. An answer is a clean run. A run that ran out of steps or tokens, went in circles, was cut off or refused counts against the version; one the user stopped, or one the provider did not answer, is not counted. After three runs without a failure the watch ends, and the copy with it.

14. **Nothing goes back by itself.** A failed run makes the workshop offer two things, "Back to the version before" and "Keep". Going back writes the text this device had approved before, approves it again and keeps the version that is taken back in the history. One failed run is weak evidence, and a version that returns unseen would be one more change nobody looked at.

15. **Earlier versions can be restored.** "Earlier versions…" on a skill of the vault's own lists what the history keeps of its main file. The chosen one is held against the skill as it is now — its lines, and what it may do, with a warning where it may do more. "Restore this version" writes exactly the text that was shown and approves it; a version that is no skill of this folder is not written.

16. **A changed skill's review says what it may do now that it could not.** For every changed version, also one that arrived through sync: the tools that came and went, the folders, the limit, in words, and a warning where the version reaches further than the approved one. A wider skill is never approved as a few changed lines.

17. **What was accepted is said in a file of the vault,** `.agent/logs/learning.md`: one line for each skill made or rewritten from a suggestion, each rule, each return to an earlier version — the minute, the skill, the conversation's title. A device that finds a skill changed can read there why. No word of the reviewer and no model's name is written into it; nothing reads it back, and like everything under `.agent/` no model is ever shown it.

18. **Not decided here.** The hints that need no model — a sequence of steps the user took by hand three times, a skill whose runs fail — and the upkeep of skills and memory that have grown are the next part of the same plan. So is a profile of the user's style.

## Consequences

- A review is as good as the model that led the conversation. A small model on the device suggests less, and worse; nothing is lost by that except the suggestion.
- A conversation that used the internet, read mail or called a foreign server teaches no rule. The user who wants one writes it — in the memory's view, as one line of their own.
- The form keeps a suggestion harmless, not true. A reviewer can suggest a wrong fact with plausible evidence; that is why each suggestion is a draft with its evidence beside it, and why the evidence is shown and not kept.
- Because the head of a skill's file never changes, a suggestion cannot repair a wrong list of tools or a folder that is too narrow, and it cannot reword what an existing skill is for. Those stay the user's edit.
- The watch is this device's: it counts the runs made here. While it lasts, the app's data holds the skill's previous text; with a failure it stays until the user decides.
- A returned version is in force on this device at once and waits for a review on every other, like any change.
- The log holds conversation titles — the first words the user typed there. It travels with the vault, as the memory's own comments do.
- A proposal for a skill is bounded at 12,000 characters, well below what a skill's main file may hold. A longer skill is not rewritten by a suggestion.
- Nothing of this has run against a real model.

## Alternatives

- **A reviewer in the background, after every conversation.** Rejected: it would send every conversation twice without being asked, cost a request each time, and fill the list of drafts until nobody reads it.
- **A cheaper reviewer than the conversation's own model.** Rejected for a second provider: it would be shown a conversation it was never part of. A model on the device would send nothing anywhere, but not every device has one; it can become a choice in the dialog once local generation is there.
- **Letting the reviewer write the whole file and comparing what it may do afterwards.** Rejected: a check after the fact is weaker than a form that cannot carry the change, and a skill file's head ends at the next `---` — one such line in a rewritten description would cut the list of tools off and widen the skill.
- **Going back automatically after a failed run.** Rejected: a limit that was hit can be the question's doing as much as the skill's, and the user would find another text in force than the one they accepted.
- **Keeping the evidence in the vault's log.** Rejected: it quotes the user's conversation into a file that syncs to whoever shares the vault.
- **Rules from every conversation, with a warning on the draft where it read strangers' text.** Rejected: on the card the sentence looks like the user's own wish, and a warning does not show which part of it a stranger wrote.

## Links

- ADR 0018 (decision 13), ADR 0019, ADR 0020 (decisions 2, 4 and 5), ADR 0023, ADR 0027; the Agent Skills specification.
