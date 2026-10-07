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
   - *Reading:* a file of the open vault; never one of Plainva's own folders; never a note the privacy gate keeps from the cloud — at the gate an agent is a cloud recipient (`acp:<id>`), a program on this computer included. A refusal is one fixed English sentence that names nothing the agent did not name.
   - *Writing:* nothing is written. A change to an existing note becomes one suggestion round per note and turn, laid on the note when the turn ends and against the note as it is then, with the agent as its author — `acp:<id>`, shown under the user's name for the agent, never under what the agent calls itself. A note that does not exist yet waits in the session until the user creates it; it is then written through the vault's own write path and stamped `generated` ([ADR 0023](0023-marking-ai-generated-content.md)). Refused: a file that is no Markdown note, a change to a note's properties, a new note that carries `plainva.ai` or the OKF trust fields, anything the gate keeps from the cloud, more than 150 blocks in one round, and any write inside an encrypted workspace. Addresses the agent brought along are made inert like those in any AI-written text.
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

- An agent's modes, models, configuration options and slash commands; images and audio in a prompt. An agent's thoughts are not shown.
- A history of sessions and loading an earlier one (`session/load`).
- Withdrawing an agent's earlier round when a later turn changes the same note: today both stand, and the later one is against the note as it is.
- Proposals for a note's properties, which come with the writing classes of the plan; deleting and moving through the host, for which the protocol has no request.
- A fenced mode (see Alternatives).

## Links

- [External agents — architecture](../engineering/External_Agents.md), [AI threat model](../engineering/AI_Threat_Model.md) T30–T32.
- ADR 0017, 0018, 0019, 0022, 0023, 0024; Agent Client Protocol, protocol version 1.
