# Skills (Beta)

Last reviewed: 2026-10-06

A skill is a set of instructions for work that comes back: preparing a meeting, sorting your tasks, a weekly review. Plainva comes with ten of them, and you can write your own. Skills use the open Agent Skills format — a folder with a `SKILL.md` — so they also work in other AI apps that read the format.

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
| **Write and rewrite** | Summarises, shortens or rewrites a note — as text you take over. |
| **Knowledge upkeep** | Finds notes that say the same, are out of date or are connected to nothing. |
| **Link cleanup** | Checks the links of a note: leading nowhere, missing, one-way. |
| **Privacy check** | Finds what in a note should stay on this device, and suggests a rule. |
| **Reflection** | Looks back on the notes of a day or a week with you — kindly, never a diagnosis. |

All of them only read: none changes a note, sends anything or goes on the internet. The privacy check and reflection are meant for a model on this device; with a cloud model the send overview says so. Switch any skill off under **Skills** — the switch holds for this vault on this device. **Make your own version** copies one into your vault, where you can change it.

## Your own skills

**New skill** asks for a name, a description — the AI chooses a skill by it — and the instructions. Plainva writes them as `.agent/skills/<name>/SKILL.md` into your vault, where they travel with it like any note. **Edit** opens the file like a note.

**Import…** takes a skill as a `.zip` or `.skill` file. Before anything is written, Plainva checks it: exactly one skill in the format, no path outside its folder, the size limits. It names the licence, scripts it will not run and tools it does not have. Hidden files — names that begin with a dot — are not part of a skill and are left out.

## Nothing runs before you approve it

A skill in your vault that is new or changed — through sync, an import, or an edit on this or another device — does not run until you approve it **on this device**. Such skills wait at the top of **Skills** under **Waiting for your approval**, and in **Settings → AI & automation** (the Vault part). **Review and approve** shows what the skill may do, what changed since your last approval, its instructions, files and where it lies. The approval holds for exactly this version; any change lifts it again. Approvals are stored on this device, never in the vault.

The same holds for an `AGENTS.md` at the top of your vault: once approved, its standing instructions go into every new conversation. Neither a skill nor `AGENTS.md` can lift your privacy rules, and a skill never gets more than a conversation has — it can only narrow it.

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

## What goes to the provider

The send overview lists the instructions that go along under **Instructions**: the skill of the conversation, the list of skills the AI may load, and `AGENTS.md`. Instructions from your vault going to a cloud for the first time bring the overview back. Invisible characters in a skill never reach a model.

## Limits of the beta

Skills run no scripts, and skills that need the web or your mail come later. Your own skills are not offered to AI apps connected through the MCP server; only the skills that come with Plainva are.
