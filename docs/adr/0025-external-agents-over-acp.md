# ADR 0025: External agents — started and named, not governed; what they ask Plainva for follows Plainva's rules

Status: Accepted

Date: 2026-10-07

## Context

People who pay for an AI agent — a program for the command line that reads, writes and runs things on their behalf — want to use it on their notes. No provider lets another app sign in with a user's subscription (the decision table of the harness plan), so the only permitted way is the agent's own program with its own sign-in. The Agent Client Protocol (ACP, protocol version 1) lets an editor host such a program: the editor starts it, speaks JSON-RPC over its standard input and output, shows its session, and answers what it asks the editor for — files, permissions, a terminal.

An agent hosted this way is a different kind of thing from everything else in the harness. For Plainva's own assistant, the send overview and the privacy gate decide what leaves the device ([ADR 0018](0018-ai-context-package-and-egress-policy.md)), and writing means proposing ([ADR 0019](0019-ai-tools-risk-classes-and-approvals.md)). An agent is a process with the user's rights in the vault's folder: it reads any file, sends what it likes to its own service, and writes files directly. Nothing Plainva does changes that. The question was therefore not how to govern an agent, but how to be exact about what is governed and what is not — and how to keep "writing means proposing" for the part that does pass through Plainva.

**Checked before building (2026-10-07).** The plan asked for the terms of the most widely used agent's maker to be read again first. Its legal page allows an end user to sign in to the unmodified program with their own subscription also where a product hosts it, forbids a third party to offer that sign-in or to collect, store or pass on its credentials, and allows naming the product in text. Decisions 1 and 2 are that reading turned into rules. Whether the maker's commercial terms ask anything more of a desktop app that starts the user's own installation is a question for the maintainer before a public release; nothing in the design depends on one maker.

## Decision

1. **Plainva hosts. It does not ship, fetch, install or sign in.** An agent is a command the user registered: a program that is already on the computer, and its arguments. Plainva starts exactly that, unmodified. It knows the usual start command of some agents by name and looks for their program on the search path — looking starts nothing. It never downloads an agent, never runs a package manager, never offers a provider's sign-in and never holds a credential of an agent. An agent signs in by itself: through the protocol's `authenticate`, or in a terminal window that runs the same registered program with the few extra arguments the agent named, after which the agent is started anew. Agents are named in plain text and shown without logos.

2. **Registered natively, and started only after a yes in the system's dialog.** As with a program that is an MCP server ([ADR 0024](0024-mcp-client-foreign-servers.md) §3), the whole command is shown in the system's own dialog and remembered natively on a yes (`ai-acp-agents.json` in the app's data); afterwards the WebView names an agent by an id, and no command takes a program. An agent is started without a shell, in a folder that is an open vault and never the app's own data. The first start of an agent in a folder since the app started is confirmed in the system's dialog as well, with the folder and the command; a sign-in in a terminal is opened only after that yes. The WebView speaks the protocol and could name a registered agent by itself — it cannot answer that dialog.

3. **No sandbox, and the environment of the user's session — said, not hidden.** Unlike a program that is an MCP server, an agent is not fenced in: it has to find its own configuration, its sign-in and the tools it starts, and it has to write in the vault's folder. A fence that allows all of that fences nothing in. This is the trust level "external agent": before a session starts, and in the session's first line for as long as it runs, the surface says that the agent reads and sends on its own, that the privacy rules and the send overview do not reach it, that what it writes itself is in the vault at once, and that Plainva controls only its own side.

4. **What an agent asks Plainva for follows Plainva's rules.** Plainva offers file access through the host (`fs/read_text_file`, `fs/write_text_file`) and no terminal.
   - *Reading:* a file of the open vault; never one of Plainva's own folders; never a note the privacy gate keeps back — at the gate an agent is a cloud recipient (`acp:<id>`) that may reach the internet, a program on this computer included: a note kept from the cloud **or** from web access does not exist for it. A refusal is one fixed English sentence that names nothing the agent did not name.
   - *Writing:* nothing is written. A change to an existing note becomes one suggestion round per note and turn, laid on the note when the turn ends and against the note as it is then, with the agent as its author — `acp:<id>`, shown under the user's name for the agent, never under what the agent calls itself. The round carries the passages of the text and, for every property that would SAY something else, a proposed value in the form Plainva's own assistant proposes one ([ADR 0019](0019-ai-tools-risk-classes-and-approvals.md) §2): what the properties say is compared, so an agent that writes them in another order or with other quotes changes nothing. A note that does not exist yet becomes a draft in the vault's list of drafts on this device — the list every draft waits in, shown in the session and in the list of everything that waits, also after the session ended; one draft per agent and path, written again in place. The user creates it on its card, at exactly the path the agent named and never over a file that is there by then, through the vault's own write path and stamped `generated` ([ADR 0023](0023-marking-ai-generated-content.md)). Refused: a file that is no Markdown note; a note's own AI rules, its trust fields and Plainva's own property names, on a note that is there and on a new one; a property value that is no text, number, yes/no or list of those; anything the gate keeps back; more than 150 blocks in one round; a further new note while the list of drafts is full; and any write inside an encrypted workspace. Addresses the agent brought along are made inert like those in any AI-written text, in a property's value too.
   - The agent reads back what it wrote through the host in this session, so that its next step works on what it believes is there.

5. **Which way an agent writes is observed, not promised.** Whether an agent hands its changes to the host is the agent's choice, and can change with its version or its configuration. Plainva lists no such claim per agent. It reports what happened: a tool call of the kind edit, delete or move that the agent reports as completed for a file of the vault it did not hand to the host is named in the session as a change the agent made itself, and counted; the last observation is kept per agent on the device and shown in the settings. This replaces the plan's static column "writes through the host".

6. **An agent's questions are the agent's.** A permission request is shown under a heading of Plainva's with the agent's own words and options. The answer goes to the agent and decides nothing in Plainva: no approval of Plainva's own chain is opened by it, and an "always" is the agent's to keep.

7. **Plainva's tools are offered as to every client.** Where the user switched Plainva's MCP server on ([ADR 0022](0022-mcp-server-without-a-network-port.md)), a session hands the agent the helper program as an MCP server it may start. That grants nothing: the first connection asks the user which folders this client may read, and the privacy gate holds as for any client. Where the server is off, the session says so, and the agent works with the files alone.

8. **One session, of the vault, on the desktop — and none in an encrypted workspace.** A session belongs to the vault it was started in and ends with it, with the app, or when the user ends it; the agent's process tree ends with it. No agent is started inside an encrypted workspace: suggestions there cannot carry an author yet ([ADR 0017](0017-ai-harness-architecture-and-native-boundary.md)), and an agent would read plaintext the workspace exists to guard. A phone starts no programs (parity catalog `ai-external-agents`, a decision).

9. **What is kept.** Per device, in the app's data: the user's name for an agent, and the last observation of how it wrote. Per vault, in the app's data: one line per session, with counts — never a word of what was said. A session's thread is not stored.

10. **An own protocol client, behind a native port** — as for MCP ([ADR 0024](0024-mcp-client-foreign-servers.md) §1). `packages/core/src/ai/acp/` speaks the protocol and never starts a process; the shell implements the port. A scripted agent in the same folder is the test bed.

## Consequences

- Plainva cannot make an agent safe, and says so. Whoever starts an agent in a vault with notes kept from the cloud has let a program read them. The surfaces say this before the start; no setting changes it.
- "Writing means proposing" holds for what passes through Plainva and for nothing else. An agent that writes by itself goes past the suggestion mode, the linter and the stamp. Plainva names such a change when the agent reports it, and sees nothing of one it does not report.
- A round per turn means one round per note however often the agent rewrote the note in that turn — and a turn that was stopped still leaves its last write as a round, because the agent was told the write was taken.
- Registering an agent changes what a script in the WebView could reach: the protocol is spoken there, so it can speak to an agent that runs, and an agent runs commands. The two dialogs of decision 2 are what stands before that; the threat model names what stays (T32 and the residual risks).
- Three systems have three ways to open a terminal for a sign-in: a console of its own on Windows, a script opened by the system on macOS, a list of terminal programs on Linux. Where none opens, the user is shown the command to run by hand.
- The protocol client is Plainva's to maintain.

## Alternatives

- **A sign-in with the user's subscription inside Plainva.** Rejected: no provider permits it.
- **Ship or install agents — a registry with one-click install.** Rejected: it would make Plainva the distributor of other makers' programs and of their updates.
- **A sandbox around the agent.** Rejected for this trust level; see decision 3. A fenced mode could come later, as a mode of its own with its own name.
- **Offer a terminal through the host.** Rejected: it would be command execution under Plainva's name, outside every approval. An agent has its own way to run commands.
- **Write an agent's host writes directly once the user said "always allow".** Rejected: the "always" is the agent's. Plainva's rule for writing has none.
- **A static list of which agents write through the host.** Rejected: see decision 5.
- **Refuse to start an agent in a vault that has notes kept from the cloud.** Rejected: it would be the one place where a rule blocks a program the user can start in a terminal in the same folder anyway. It is said plainly instead.
- **Speak the protocol natively, so that the WebView cannot.** Rejected: the WebView is where the user types and answers. A native client would still take its prompts and its answers from there.

## Deferred, and why

- Images and audio in a prompt. An agent's thoughts are not shown. (Its modes, models, configuration options and commands, deferred here at first, came with plan P9-7 — see the addendum.)
- Keeping a session's choice of mode or model for the agent's next session.
- A history of sessions and loading an earlier one (`session/load`).
- Withdrawing an agent's earlier round when a later turn changes the same note: today both stand, and the later one is against the note as it is.
- Deleting and moving through the host, for which the protocol has no request. (Proposals for a note's properties, deferred here at first, came with the writing classes of the plan — decision 4.)
- A fenced mode (see Alternatives).

## Addendum 2026-10-26: settings, modes and commands (plan P9-7)

An agent may offer the user settings for its session — a mode, a model, a
level of thought, its own — and commands of its own. The desktop shows them,
under the same rule as everything else the agent says: they are its words,
and they change what the agent does, never what Plainva does at its side.

1. **What is read.** A session's settings come from `session/new`
   (`configOptions`), from the agent's answer to a change and from its
   reports (`config_option_update`), always as the whole list, in the
   agent's order. Plainva reads a choice among values (flat or in groups)
   and a switch, and declares that it can show a switch
   (`clientCapabilities.session.configOptions.boolean`). A setting of a kind
   it does not know, or whose current value is not among its values, is
   left out — the agent keeps its own. Where an agent sends settings, the
   older modes (`modes`, `session/set_mode`, `current_mode_update`) are
   ignored, as the protocol says; only where it sends none do they stand in.
   Names, values and descriptions are a stranger's text: cleaned, cut, one
   line each; a name the agent left empty falls back to its id, cleaned the
   same way. Reports that arrive before the answer to `session/new` wait
   until its id is known — of the settings, the commands and the mode only
   the newest of each kind, since each carries the whole of it; no other
   report takes their place, and reports for more than a few sessions are
   not kept. The answer's settings reach the session where the answer is
   read, before what the agent reports right behind it.
2. **What is sent.** A change goes to the agent only for a setting and a
   value it offered — like an option of its question, nothing else is a
   choice (`setConfigOption`, `setMode` refuse without asking). What the
   agent answers is what the session shows, and it counts where the agent's
   messages put it: a report the agent sends right behind its answer comes
   after it, also when both are read at once (the connection hands an answer
   over where it reads it, `onResult`). A change has no time limit — the
   protocol cannot withdraw one. Where the agent refuses, the setting stays
   as it said and the thread names its refusal in its words; where it
   answers and leaves the setting as it was, the thread says that it did not
   change it; where it wants a sign-in first, the thread says so in
   Plainva's words. A change Plainva did not send — a value no longer offered
   — is nothing the agent declined, and no line. A report of exactly the
   asked value answers it for what goes along, also before the answer
   proper; the answer proper alone judges the asked setting — where it leaves
   it where it stood, the agent did not make the change.
3. **What changes.** A mode, a model or any other setting changes how the
   agent works. What Plainva lets through at its side — a file read through
   it under the vault's rules, a write that becomes a suggestion or a draft,
   no terminal — it decides at every request, the same in every mode; a mode
   in which the agent asks nothing more saves none of Plainva's own steps.
   The mode and model buttons say so in their tip, every button in its
   description — read after its name, which says already whose setting it
   is —, the guide in words, and all of them say that what the agent does
   with its own tools is outside Plainva in every mode. Each menu and the
   list of commands begin with Plainva's own heading — "⟨setting⟩ of
   ⟨agent⟩", "More settings of ⟨agent⟩", "Commands of ⟨agent⟩" —, and each
   button's name begins with what it shows and says whose setting it is
   ("Mode: Ask, a setting of ⟨agent⟩"). No word passes through the
   interpolation of a sentence of Plainva's in the agent's place — a
   heading, a button's name or tip, a line of the thread, a step's line, the
   reason a session ended, the hint under the field —: words go in as parts
   of their own, numbers as they are, for the plural; the agent's are drawn
   apart in quiet italics and isolated in their direction, never in a
   heading's capitals, a note's name is isolated in its direction, and
   Plainva's and the user's words are the sentence's text — i18next puts a
   value that holds a placeholder of the same sentence in the wrong place. A
   name with "{{agent}}" in it stays a name, and a name that closes
   Plainva's quote stays inside it: the agent's words stand beside
   Plainva's, never in their place. Where an agent offers its modes in the
   older way, Plainva names the setting in its own word. A question's files
   stand each in its own direction. The command a sign-in shows to be
   copied, where no terminal opens, is what the native script runs — into
   the vault's folder, the method's values set, every part quoted so that
   sh, bash, zsh and fish read it alike and nothing in it expands —, each
   part in its own direction; a sign-in in a terminal whose arguments or
   values hold a character a person cannot see or one that turns text
   around is not offered.
4. **What the agent does itself.** A setting the agent changes on its own —
   reported, not asked for — is named in the thread in its words ("The
   agent set … itself"), so that a mode that waives a question of the
   agent's own does not pass unseen; so is the asked setting where the
   agent answers with another value than asked. What changes in its answer
   beside the asked setting goes with the user's change and is named as
   such ("With it, the agent set …"). A setting turned back and forth with
   nothing between — nothing else in the thread, no text, thought, step,
   plan, question or file of the agent's, no change of the user's — leaves
   one line, its last word, kept apart from others by the setting's id: two
   settings of the same name stay two.
5. **Commands.** The agent's commands (`available_commands_update`, each
   report the whole list) are offered while a message begins with "/" and
   the name is being typed — at most twelve, the rest counted —; a command
   is the message itself, sent as text. Where the agent says what goes after
   a command (`input.hint`), that stands under the field once it is taken,
   in the agent's words, until the user types on. A name is one word of
   letters and digits in any script, then also marks and `_ . : -`, at most
   64 characters; one a message cannot begin with — a blank, a control,
   invisible or ignorable character, a symbol, more than three marks in a
   row, more than one word — is left out. A name is judged and told apart
   in NFC and kept as the agent spells it: that is the name it recognises,
   and a message that begins with it in another spelling goes in the
   agent's. What a command does is the agent's.
6. **Not kept.** Every session starts with the agent's own defaults; a choice
   is not remembered for the agent's next session (a deferred point).

The phone has no external agents (the parity catalog's decision); nothing
of this exists there.

## Links

- [External agents — architecture](../engineering/External_Agents.md), [AI threat model](../engineering/AI_Threat_Model.md) T30–T32 and T86.
- ADR 0017, 0018, 0019, 0022, 0023, 0024; Agent Client Protocol, protocol version 1.
