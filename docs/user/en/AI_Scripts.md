# Scripts (Beta)

Last reviewed: 2026-10-08

A script is a small program for what a model does badly and a program does the same way every time: counting, sorting, comparing, adding up. You write it in JavaScript. It runs in a closed box inside Plainva: it cannot open a file, reach the network or wait for later. It only calls the tools you ticked for it: they read your vault the way the AI's tools do, or leave a suggestion that you decide about. A script changes nothing by itself.

## Running a script

Your scripts stand under **Skills** in the AI tab — on the phone under **Conversations → Skills** — in the group **Scripts**. **Run** opens the script: fill in what it asks for and press **Run**. While it runs you see each tool it calls, and **Stop** ends it. Afterwards the dialog shows the **Calls**, the **Result** — which you can copy — and the **Log**, and what the run used of its limits.

A run you start here stays on this device: nothing of it goes to a model, so it also reads notes you keep from the cloud. **Dry run** calls the tools that read, and only writes down a call that would show something in the app or leave a suggestion.

## In a conversation

In an ordinary conversation the AI can find your active scripts and run one when it fits; the step then reads **Running the script “word-count”**. The script reads only what that conversation may read: a note you keep from the cloud stays kept, and every note the script reads counts among what the run read. What it returns goes to the model as data, never as instructions. A conversation started with a skill is offered no scripts, and neither is an AI app connected through the MCP server.

## Suggesting changes

A script can also be given tools that suggest. The tools **Suggesting changes to a note** and **Suggesting a property value** leave a suggestion in the margin of a note; **Drafting a note**, **Drafting a database entry**, **Drafting a task** and **Drafting a journal entry** leave a draft. Both carry the script's name, and nothing in your vault changes before you accept a suggestion or create a draft — exactly as with a suggestion of the AI. After a run the dialog lists them under **Suggestions and drafts**; a run started with **Dry run** leaves nothing.

What a script read decides where it may write: a suggestion or a draft that rests on a note you keep from the cloud is taken only by a place under the same rule. In a conversation the AI is offered a script that suggests only where the conversation can suggest itself, and what the script leaves there carries the name of the conversation's model.

## Writing a script

**New script** asks for:

- **Name** — lower-case letters, digits and hyphens; it becomes the folder.
- **Description** — what the script is for; you and the AI recognise it by this.
- **Tools** — tick what the script may call: under **Reading** what reads, under **Suggesting** what leaves a suggestion or a draft. Nothing else exists for it.
- **Inputs** — what the script asks for when it starts: a name, whether it is text, a number or yes or no, and whether it is required.
- **Limits** — seconds of computing, tool calls and memory.
- **Code** — the program.

**Create and approve** writes the script into your vault as `.agent/scripts/<name>/` — a `manifest.json` and a `main.js` — and approves it on this device. **Edit** in a script's menu opens the same form; **Save and approve** replaces the files.

The code is the body of a function. `input` holds the inputs by name, `tools.<name>(…)` calls a tool and is awaited, `return` hands back the result, and `console.log(…)` writes a line into the log:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

The language is JavaScript as of ES2020. There is no `fetch`, no timer, no `import` and no file access, and what a script returns must be data that can be written as JSON. A tool that refuses — a note that does not exist, a note the conversation may not read — throws an error the script can catch.

## What a tool returns

**What a tool returns** in the form opens this page. Every tool takes one object and returns one; `cursor` takes the `next` of the call before and continues its list.

| Tool | You pass | You get |
|---|---|---|
| `search_vault` — **Searching the vault** | `query`; optional `folder`, `limit` (up to 25), `cursor` | `results`: a list of `{ title, path, snippet }`; `next` |
| `read_note` — **Reading a note** | `path`; optional `section`, `maxChars` (200 to 20,000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Reading the outline** | `path` | `path`; `properties`: name and value; `sections`: a list of `{ level, text, section }` |
| `query_base` — **Reading a database** | `base`, the path of the `.base` file; optional `view`, `limit` (up to 50), `cursor` | `base`, `view`, `views`; `rows`: a list of `{ title, path, properties }`; `next` |
| `get_tasks` — **Reading tasks** | optional `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (up to 50), `cursor` | `tasks`: a list of `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Reading backlinks** | `path`; optional `limit` (up to 50), `cursor` | `path`; `notes`: a list of `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Following links** | `path`; optional `depth` (1 or 2), `limit` (up to 50) | `path`; `notes`: a list of `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Looking at recent notes** | optional `kind` (`opened` or `edited`), `limit` (up to 20) | `kind`; `notes`: a list of `{ title, path, at }` |
| `get_calendar` — **Reading appointments** | `from` and `to` as `YYYY-MM-DD`; optional `details`, `limit` (up to 100) | `events`: a list of `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Using the app** | `id`, a command of the app such as `open-note`, `show-in-graph` or `open-calendar`; optional `args` with `path`, `section` or `date` | `done`, `command` |
| `propose_edit` — **Suggesting changes to a note** | `path`; `edits`, a list of `{ find, replace }`, or `append`; optional `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Suggesting a property value** | `path`, `key`, `value`; optional `note` | `proposed`, `path`, `property` |
| `create_note` — **Drafting a note** | `title`, `content`; optional `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Drafting a database entry** | `base`, `title`; optional `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Drafting a task** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Drafting a journal entry** | `text`; optional `task` | `drafted`, `kind` |

## Limits

A script carries its limits in its manifest. The form sets three of them:

| Limit | Default | Range |
|---|---|---|
| **Seconds of computing** | 5 | 1 to 30 |
| **Tool calls** | 20 | 0 to 50 |
| **Memory in MB** | 32 | 8 to 128 |

Only the time a script computes counts, not the time a tool takes. A script that goes over a limit is ended, the dialog says which limit it was, and an ended script returns nothing. The arguments of one call and the result may each be 64 KB at most.

## Nothing runs before you approve it

A script that is new or changed — through sync, or written by another program — does not run until you approve it **on this device**. It waits at the top of **Skills** under **Waiting for your approval**. **Review and approve** shows **What it may do**, its **Limits**, its **Input** and the whole **Code**, and says whether the code can be read as JavaScript; code that cannot is not approved.

With **Approve**, this device signs exactly these files. The key for that is made on this device and kept in its keychain. Any change to a file lifts the approval, and on each of your other devices the script waits for an approval of its own — an approval cannot be carried from one device to another. **Withdraw approval** in a script's menu takes it back, and **Show code** shows the review again.

## Limits of the beta

A script suggests and drafts; it never renames, moves or deletes a note, and it writes no e-mail and no appointment. A skill cannot start a script, and a skill's own `scripts/` folder is not run. Mail, the internet and the tools of external servers are not available to scripts.
