# External agents — architecture

Status: built for the desktop (AI harness P4.6, 2026-10-07). The protocol client is in `packages/core/src/ai/acp/`; the native side is `apps/desktop/src-tauri/src/acp/`; the files' rules, the stores, the session and the view are in `packages/ui/src/ai/` (`acpFiles`, `acpStores`, `acpSession`, `agentView`, `AiAgentView`); the desktop wires them in `services/ai/desktopAcp.ts`, `services/ai/desktopAi.ts`, `components/ai/AiTabView.tsx` and `components/settings/ExternalAgentsCard.tsx`. The decisions are [ADR 0025](../adr/0025-external-agents-over-acp.md); the threats are T30–T32 in the [AI threat model](AI_Threat_Model.md).

An external agent is an AI program of another maker that the user installed and signed in to themselves. Plainva starts it in the folder of the open vault and speaks the Agent Client Protocol (ACP, protocol version 1) with it over its standard input and output. It is the third way an AI program meets a vault, next to Plainva's own assistant and to AI apps that read the vault through Plainva's MCP server.

## Where an agent stands

Everything else in the harness is governed: the assistant sends what the send overview showed and what the privacy gate lets through, and it writes by proposing. An agent is a process with the user's rights. The design does not pretend otherwise; it draws the line and says where it is.

| | Who decides | How |
|---|---|---|
| Which program is an agent | the user, natively | the system's dialog shows the file and every argument; the registry is a file in the app's data |
| That an agent starts, and where | the user, natively | the system's dialog before the first start in a folder since the app started; the folder is an open vault |
| What the agent reads and sends on its own | the agent | nothing of Plainva applies — said before the start and in the session's head |
| What the agent writes on its own | the agent | in the vault at once; named in the session when the agent reports it |
| What the agent reads through Plainva | Plainva | the privacy gate with the agent as a cloud recipient that may reach the internet; never Plainva's own folders |
| What the agent writes through Plainva | the user | a suggestion round per note — passages and proposed values of properties; a new note waits as a draft to be created |
| The agent's sign-in | the agent | by itself or in a terminal of its own; no credential in Plainva |
| What the agent may do next | the agent, asking the user | its question, its words, its options; the answer goes to the agent |

## The protocol, as far as Plainva speaks it

`protocol.ts` reads and writes the messages, `connection.ts` is JSON-RPC over a port of lines, `client.ts` is a session's life. A scripted agent (`scripted.ts`) plays the other side in tests.

Plainva sends `initialize` — protocol version 1, its name and version, and what it offers: `fs.readTextFile`, `fs.writeTextFile`, `auth.terminal`, and `terminal: false` —, then `authenticate` where the agent wants it, `session/new` with the vault's folder and, where the user switched it on, Plainva's own helper as the one MCP server, `session/prompt` per turn and the notification `session/cancel` to stop one.

It answers three requests of an agent — `session/request_permission`, `fs/read_text_file`, `fs/write_text_file` — and every other one with "method not found", `terminal/*` included. Of the updates of a session it shows the agent's text, its tool calls and its plan; the agent's thoughts, its echo of the user's words, modes, commands, configuration and usage are read past.

Everything an agent sends is read as a stranger's: one message is at most 4 MiB, a text piece 200,000 characters, a title 300; lists are cut (8 options, 20 locations, 100 plan entries, 10 ways to sign in); a session id of another session is refused; at most 16 requests of the agent are answered at a time. A turn has no time limit, opening an agent has 60 seconds, a session and a sign-in five minutes each.

## The native side

Ten commands, all of which answer the central window only (`aiAcpBoundary.test.ts` holds the list and what each takes from the web view).

- **The registry** (`registry.rs`). `acp_agent_add` resolves the program's name to a file, shows the file and every argument on a line of its own in the system's dialog, and writes `ai-acp-agents.json` on a yes: at most 32 agents, 32 arguments of 4,096 characters each, nothing that cannot be shown. `acp_detect` looks for bare program names on the search path and starts nothing. `acp_agents` lists, `acp_agent_remove` forgets; both changes end an agent that runs.
- **A start** (`process.rs`). `acp_start` takes an agent's id, a folder and the wording of a dialog. The entry must exist and its file must still be where it was confirmed; the folder must be one the app registered as a vault and not lie in the app's own data. The first start of an agent in a folder since the app started asks in the system's dialog, with the folder and the command written natively below the web view's words; a no is answered with the word `declined`, which the session takes as "nothing happened". Then the file is started directly — no shell —, with the registered arguments, in that folder, with the environment of the user's session and a search path that puts the program's own folder first. Its output goes to the web view line by line; the end of its error stream is kept for the session to show (`acp_log`), also after it ended. `acp_write` sends one line, `acp_stop` closes the agent's input, waits a moment and ends its process tree. Every agent ends with the app.
- **The sign-in** (`login.rs`). `acp_login` opens the registered program in a terminal, with the registered arguments first and the few the agent named after them, and answers with the number the program ended with — 0 is the protocol's word for "signed in". It runs only for an agent whose start in that folder was confirmed. The additions are restricted: 16 arguments, 16 values, each one text that can be shown, and no name that changes how a program is found or loaded (`PATH`, `PATHEXT`, `COMSPEC`, `LD_*`, `DYLD_*`). On Windows the program gets a console of its own and is waited for; on macOS a script the app wrote is opened by the system; on Linux the first terminal of a fixed list that is installed runs that script. The script quotes every part it did not write and leaves the program's number in a file. Where no terminal opens, the session shows the command to run by hand. One sign-in at a time, fifteen minutes at most; Plainva reads nothing that is typed or printed there.

What the module does not do is part of its contract and tested on its source: it reaches no network, starts no package runner, writes nothing to the keychain and has no field for a credential.

## A session

`AiAcp` (`acpSession.ts`) holds the agents of the device and the one session of the open vault; the assistant's session publishes its state as `agents`.

1. **Start.** Not without a vault, not in an encrypted workspace, not while another session is open. The client is opened; the agent says who it is and how it signs in.
2. **Sign-in, where asked for.** "Authentication required" on `session/new` shows the agent's ways. One of the kind "agent" is the agent's own business behind `authenticate`; one of the kind "terminal" goes to `acp_login`, and afterwards the agent is started anew, as the protocol asks.
3. **A turn.** The user's words, and the open note as a link where the user left it in and the gate lets it go — its name and address, never its text. Updates fill the thread; a question waits for the user; file requests go to `acpFiles.ts`.
4. **The end of a turn** (`settle`), also when it was stopped or the program ended: every note the agent wrote through the host in the turn is planned again against the note as it is now and gets one round, or is left as a draft where it does not exist yet (`AcpDrafts`, the assistant's session's list of drafts for the vault the session runs in).
5. **The end of a session:** by the user, with the vault, or with the program. One line goes to the vault's log, and what was seen of the agent's ways of writing goes to its record on the device.

## Files through the host

`acpFiles.ts` holds the rules; nothing in it writes.

- A path an agent names is absolute. It is mapped into the vault by the rules of the MCP server's paths (`files.ts`: inside the root, no `..`, no hidden root such as `.plainva` or `.agent`, NFC) and then spelled the way the vault spells it, part by part — a suggestion belongs to a note by its exact path.
- **The gate** (`acpGate`): an agent is the recipient `acp:<id>`, a cloud that may reach the internet — the same reading as a program at Plainva's own MCP server. A note kept from the cloud or from web access does not exist for it: not to read, not to name, not to change.
- **Read:** the file's text as it is now, the editor's unsaved keystrokes included, up to a million characters; a note the gate keeps back is refused. Where the agent wrote to that path earlier in the session and nobody decided about it yet, it reads its own text back.
- **Write to a note that exists:** two comparisons, one round.
  - *The properties* are compared by what they SAY (`changedProperties` in `packages/core/src/ai/writes/properties.ts`): another order, other quotes and other spacing are no change. Every property that would say something else is judged like a value the assistant proposes (`propertyTarget`): an ordinary one becomes a block of the round with the hint that says which property (`planPropertyChange`, the form of [ADR 0019](../adr/0019-ai-tools-risk-classes-and-approvals.md) §2); a note's own AI rules, its trust fields and Plainva's own names refuse the whole write (`rules`), and so does a value that is no text, number, yes/no or list of those (`properties`). Where a change is not one entry — properties written in one line, the only property removed, the last two removed together — the properties as they would read are compared like text instead, so that a round never holds two blocks one decision could not take.
  - *The text* below them is linted (addresses the note does not already carry are made inert), then compared with the note.
  Refused besides: more than 150 blocks, an encrypted workspace. The write is planned at once, so that the agent hears a refusal where it happens, and proposed when the turn ends, so that a note gets one round.
- **Write to a note that does not exist:** refused where it carries one of its own AI rules or a trust field (judged as a proposed value is: `status: open` is a task's, `status: stable` the note's lifecycle), where its folder is kept from the agent, where its properties cannot be read, where it is longer than a draft may be, or while the list of drafts is full. Otherwise it becomes a draft (`WriteDraftBody` of the kind `note` with a `path`): one per agent and path, written again under the same id, signed `acp:<id>` with the user's name for the agent, inheriting no rule. "Create" on its card is the assistant's session's `createDraft`: the shell's `DraftCreator.noteAt` writes it at exactly that path through the vault's own write path, with the stamp `generated: { by: acp:<id>, at }` (`namedNoteContent`); a file that appeared there in the meantime is not overwritten, and the draft stays. The agent's session hears what became of a draft it left (`draftsChanged`) and stops reading its own text back for that path.
- **Anything that is no Markdown note** is refused.

A refusal is one fixed English sentence for the agent's model and a word for the session, which says it in the user's language.

## What is said, and what is observed

The five sentences before a start, and the head of a running session, are part of the gate of the package: they are tested in every language (`AiAgentSurfaces.test.tsx`) and end to end.

Plainva cannot know how an agent writes, so it reports what it saw. A tool call of the kind edit, delete or move that the agent reports as completed, for a file of the vault it did not hand to the host in that turn, becomes the line "The agent changed ⟨note⟩ itself". The counts of a session — changes through Plainva, changes of its own — go to the vault's log, and the last ones to the agent's row in the settings.

## What Plainva remembers, and where

| What | Where | Who can change it |
|---|---|---|
| The command of an agent | native: `ai-acp-agents.json` in the app's data | the user, through the system's dialog |
| The yes to a start, per agent and folder | native, in memory until the app closes | the user, through the system's dialog |
| The user's name for an agent; what was last seen of how it writes | app data, per device: `acp/agents.json` | the web view |
| One line per session: when, which agent, counts | app data, per vault: `acp-sessions.json`, the last 50 | the web view |
| A session's thread | memory, until the session is closed | — |
| A note an agent wrote that does not exist yet | app data, per vault and device: the vault's list of drafts (`drafts.json`), until the user creates it or throws it away | the web view |

Nothing is stored in the vault. A device record belongs to the command it was made for: another command under the same id starts without a name and without a past.

## Plainva's tools for the agent

Where "Let AI apps on this computer read this vault" is on, `session/new` names Plainva's helper (`plainva-mcp --app <identifier>`) as an MCP server. The agent starts it like any client would; the first connection asks the user which folders it may read ([ADR 0022](../adr/0022-mcp-server-without-a-network-port.md)). The session's head says whether the tools were offered.

## What it does not do

No agent's modes, models, configuration or commands; no images or audio in a prompt; no history and no reloading of a session; no withdrawal of an earlier round when a later turn changes the same note; no fence around the process. The reasons are in ADR 0025 under "Deferred".

While "Fully local" is on ([ADR 0030](../adr/0030-ai-fully-local-and-models-on-this-device.md), decision 4) no agent is started and none signs in: the session refuses before it asks anything, `acp_start` and `acp_login` refuse on the native side, and switching it on ends the sessions that run. The card and the agent's view say that it rests; what is registered stays.

## Verified, and not

- The protocol client, the files' rules, the session and the surfaces run against the scripted agent: unit tests in `packages/core/src/ai/acp/` and `apps/desktop/src/ai/`, one end-to-end test (`apps/desktop/e2e/smoke.spec.ts`, "AI external agents").
- The native side has unit tests for its pure parts and for starting and ending a real process; its contract is checked on the source.
- **Not verified:** no agent of another maker has been run against it. The system's dialogs and the terminal for a sign-in were not exercised by hand in a build. The Linux terminal path is compiled and its parts are tested in CI; the macOS path is first compiled by a release build.
