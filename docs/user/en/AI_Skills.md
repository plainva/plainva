# Skills (Beta)

Last reviewed: 2026-10-09

A skill is a set of instructions for work that comes back: preparing a meeting, sorting your tasks, a weekly review. Plainva comes with thirteen of them, and you can write your own. Skills use the open Agent Skills format — a folder with a `SKILL.md` — so they also work in other AI apps that read the format.

## Using a skill

Start a skill with one click: as a chip in an empty conversation (the three used most), under **Skills** in the AI tab, on the phone under **Conversations → Skills**, or from the command palette. The conversation then runs with the skill: its instructions go along, and it uses only the tools and folders the skill names.

You can also simply ask. In every conversation the AI knows the names and descriptions of your active skills and loads one when your question matches — "prepare my next meeting" is enough.

## The skills that come with Plainva

| Skill | What it does |
|---|---|
| **Daily orientation** | What matters today: due tasks, appointments and what you worked on lately. |
| **Weekly review** | The past seven days and the week ahead, with three suggestions. |
| **Project status** | Goal, progress, open points and the next step of a project. |
| **Meeting preparation** | Prepares a meeting from earlier notes and open points, or writes one up afterwards. |
| **Task triage** | Sorts your open tasks: what now, what can wait, what to drop. |
| **Research** | Researches a question on the web and in your notes, with every source named. |
| **Mail and calendar** | Goes through recent mail and the coming appointments: what needs an answer, what to prepare, which tasks follow. |
| **Write and rewrite** | Summarises, shortens or rewrites a note — as text you take over. |
| **Knowledge upkeep** | Finds notes that say the same, are out of date or are connected to nothing. |
| **Link cleanup** | Checks the links of a note: leading nowhere, missing, one-way. |
| **Memory care** | Looks through the memory: entries that say the same, contradict each other or are out of date — and drafts what to merge and what to take out. |
| **Privacy check** | Finds what in a note should stay on this device, and suggests a rule. |
| **Reflection** | Looks back on the notes of a day or a week with you — kindly, never a diagnosis. |

All of them only read: none changes a note or sends anything. The one that drafts is **Memory care**: what it suggests for the memory waits until you accept it. Only **Research** uses the internet, and only **Mail and calendar** reads your mail — see below. The privacy check and reflection are meant for a model on this device; with a cloud model the send overview says so. Switch any skill off under **Skills** — the switch holds for this vault on this device. **Make your own version** copies one into your vault, where you can change it.

## On the internet and in your mail

**Research** is the one skill that comes with Plainva and uses the internet. Starting it is your choice for its conversation, like the globe under the input field: where you switched on **The AI may use the internet in this vault**, it searches and reads pages — and while your notes are in the conversation, every page and every search still asks first, as described under **On the internet** in [AI Assistant](AI_Assistant.md). Where the switch is off, it researches in your notes only and says so. The same holds when the AI loads the skill by itself in a conversation you started without the internet.

**Mail and calendar** reads mail through the same question as any conversation: **Read your mail?** the first time. It never reads the text of a message itself; a second reader without tools writes a report about it. Both are described in [AI Assistant](AI_Assistant.md).

A skill of your own uses the internet only when its `allowed-tools` line names `web_search` or `fetch_url`. **Review and approve** then says **Uses the internet where you allowed it for this vault.** before you approve it. A skill that names no tools never brings the internet along.

A test run never uses the internet, and it never asks: mail it was not allowed to read in this session stays unread.

## Proposing changes

A skill of your own proposes changes only when its `allowed-tools` line names the tools for it: `propose_edit` and `set_property` for suggestions on a note's text and on its properties, `create_note`, `create_entry`, `create_task` and `add_journal_entry` for drafts, `rename_note`, `move_note` and `delete_note` for plans. **Review and approve** then names each of them and says **May suggest changes, leave drafts and lay out plans. Nothing in the vault changes before you accept, create or confirm.** A skill that names no tools proposes nothing — one you approved earlier gains nothing either — and a test run leaves nothing behind. What the three forms are: **Proposing changes** in [AI Assistant](AI_Assistant.md).

## Your own skills

**New skill** asks for a name, a description — the AI chooses a skill by it — and the instructions. Plainva writes them as `.agent/skills/<name>/SKILL.md` into your vault, where they travel with it like any note. **Edit** opens the file like a note.

**Import…** takes a skill as a `.zip` or `.skill` file. Before anything is written, Plainva checks it: exactly one skill in the format, no path outside its folder, the size limits. It names the licence, scripts it will not run and tools it does not have. Hidden files — names that begin with a dot — are not part of a skill and are left out.

## Nothing runs before you approve it

A skill in your vault that is new or changed — through sync, an import, or an edit on this or another device — does not run until you approve it **on this device**. Such skills wait at the top of **Skills** under **Waiting for your approval**, and in **Settings → AI & automation** (the Vault part). **Review and approve** shows what the skill may do, what changed since your last approval, its instructions, files and where it lies. The approval holds for exactly this version; any change lifts it again. Approvals are stored on this device, never in the vault.

The same holds for an `AGENTS.md` at the top of your vault: once approved, its standing instructions go into every new conversation. Neither a skill nor `AGENTS.md` can lift your privacy rules, and a skill never gets more than a conversation has — it can only narrow it. A rule you add in the memory, or accept from the AI, is one more line of this file; see [Memory](AI_Memory.md).

## Testing skills with a model

A skill can bring test scenarios: a message that starts it, and what a good run does. The skills that come with Plainva have them; for your own, write them into `tests/scenarios.json` in the skill's folder:

```json
{
  "version": 1,
  "scenarios": [
    {
      "id": "rates",
      "message": "Check the offer against last year's rates.",
      "tools": { "required": ["read_note"], "forbidden": ["run_command"] },
      "cites": ["Offer"],
      "never": ["internal margin"]
    }
  ]
}
```

`tools` names the tools a good run uses and those it must leave alone, `cites` the notes its answer names, `never` text that must not appear in it. A skill has at most eight scenarios.

**Test with ⟨model⟩** — at the bottom of **Skills**, or in a skill's menu — runs the scenarios against the model a new conversation would use. Nothing starts by itself: the dialog first says how many scenarios would run and against which model, and you set a **Ceiling** in US dollars; the run ends between two scenarios once it is reached. Where no price is known for the model, the run ends after a fixed number of tokens instead; a model on this device needs no ceiling.

Each scenario is an ordinary run of its skill: it reads your vault like a run by hand, passes the same overview before sending, counts towards your usage and leaves its conversation in the history, where its next run replaces it. Afterwards every scenario shows its verdict in words, and the skill's row says how its last run went. A result is about one model and one version of the skill: once you choose another model or change the skill, the row says so instead of showing a result that no longer counts. Some scenarios that come with Plainva ask about notes of Plainva's own test vault; in your vault they do not apply, and the dialog counts them apart instead of failing them.

## Learning from a conversation

A conversation can leave something behind: a fact worth knowing, a rule, or a skill that did not go far enough. **Learn from this conversation** — in a conversation's menu in the list, and under its last answer — asks for that. Nothing reads your conversations in the background.

A dialog first says what would happen: the conversation goes once more to the model that led it, and to no other — what you wrote and what was answered, with the names of the tools that were used. Nothing a tool returned goes along, and no note. Where a skill of your own ran in the conversation, its instructions go along, so that a better version can be suggested. **Learn** starts the review; it costs one request.

What comes back are drafts, each with the **Evidence** the review gives for it, and none of it counts before you accept it. An entry for the memory and a rule are decided on their cards, as described in [Memory](AI_Memory.md). The draft of a skill has the button **Review** instead.

A conversation that read a web page, an e-mail or an external tool suggests entries for the memory only: what a stranger wrote does not become a rule or a skill. The same holds where the conversation rests on notes that are kept from the cloud or from the internet, and entries from it carry that rule. A conversation that ran with a model on this device is reviewed on this device.

### Accepting a suggestion for a skill

**Review** shows what would change, line by line, and what the skill may do — which stays as it is: a suggestion changes a skill's instructions and nothing else. Its tools, folders and limits are never set by a model. The dialog also says whether the current version was tested, what a run costs more or less, and which conversation the suggestion came from. **Rework** turns the comparison into a field you can type in.

**Accept** writes the new version and approves it on this device, because you saw it here. On your other devices the skill then waits for their own approval, like any change. A suggestion for a new skill starts with Plainva's defaults: it reads and shows, and changes nothing. A skill you imported and the skills that come with Plainva are never rewritten by a suggestion.

### Watched versions and the way back

A version that came from a suggestion is watched for three runs, and its row counts them. If a run does not end with an answer, the skills view names the skill under **Watched versions** and offers two things: **Back to the version before**, or **Keep**. Nothing goes back by itself.

**Earlier versions…** in a skill's menu lists what the vault's version history keeps of the skill's file. The dialog holds the version you choose against the skill as it is now — its lines, and what it may do — and warns where the earlier version may do more. **Restore this version** writes it back and approves it on this device. The versions are kept on this device.

For a skill that changed in any other way — through sync, or an edit on another device — **Review and approve** says the same under **Compared with the approved version**: which tools came and went, the folders, the limit.

Under **What was learned** the skills view opens `.agent/logs/learning.md`: one line for each skill and each rule that was accepted from a suggestion, with the day and the conversation. The file travels with your vault.

## Tidying up

Skills pile up. Under **Tidy up**, the skills view names what this device noticed by itself. No model is asked for it and nothing is sent, and each line is a question, not a finding:

- Two skills that say almost the same, so that the AI picks one or the other. **Compare** puts them side by side.
- A skill of your own that has not run for more than 90 days. **Switch off** takes it out of the catalog; it stays in the vault.
- A skill whose list names a tool Plainva does not have. It runs without that tool.
- A skill that did not pass its test with the model chosen now.
- A skill whose runs keep ending without an answer, and a way you went by hand in three conversations. For both, a review of the last such conversation can suggest something — as described under "Learning from a conversation": it costs one request and asks first.

Each line offers one step, and none is taken for you. **Don't show again** puts a line away on this device; it comes back when the matter itself has changed.

## What goes to the provider

The send overview lists the instructions that go along under **Instructions**: the skill of the conversation, the list of skills the AI may load, and `AGENTS.md`. Instructions from your vault going to a cloud for the first time bring the overview back. Invisible characters in a skill never reach a model.

## Limits of the beta

A skill runs no scripts of its own; for small programs that read your vault, see [Scripts](AI_Scripts.md). Your own skills are not offered to AI apps connected through the MCP server; only the skills that come with Plainva are.
