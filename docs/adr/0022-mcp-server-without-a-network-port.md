# ADR 0022: MCP server without a network port, and the MCP client

Status: Accepted

Date: 2026-09-24

## Context

Other AI applications (Claude Code, Claude Desktop, Cursor, VS Code, Codex,
Hermes) speak the Model Context Protocol. Plainva can become the personal,
vendor-independent memory layer for them — if it does not open a door that
local malware, a web page or a confused client can walk through. Most note
apps shipped MCP servers in 2026; several listen on loopback ports with
bearer tokens, and one had a path traversal in its write tool
(GHSA-j9qv-qgpv-345g). For stdio servers the specification itself says they
"SHOULD NOT follow this [authorization] specification, and instead retrieve
credentials from the environment".

## Decision

### Server

1. **Stage 0, without a server.** The app repository ships a vault
   `SKILL.md`, an `AGENTS.md` template and the file format contract — the
   [File Format Reference](../user/en/File_Format_Reference.md) of the user
   guide: frontmatter, the `plainva:` namespace, the `.base` format, wikilink
   rules, and what a foreign harness must never touch (`.plainva/`, sync
   state, encrypted workspaces, `.agent/policy.yml`). Direct writes by another agent bypass backup, sync queue and
   conflict detection; the server is the safe path.
2. **No listening port.** The server lives in the desktop app. A small native
   shim `plainva-mcp`, shipped with the app, is what the client starts as its
   stdio server. The shim connects to the running app over a **named pipe
   (Windows) or a Unix socket (macOS, Linux)** that only the signed-in user can
   open (pipe ACL, file mode `0600`). DNS rebinding, browser CSRF and foreign
   processes on loopback ports are excluded as a class. "Plainva must be
   running" is a condition, not an error. Desktop-only, recorded in the
   parity catalog; the mobile counterpart are App Intents and AppFunctions.
   Claude Desktop gets an `.mcpb` bundle (manifest v0.3, native `binary`
   server type) — no npm package.
3. **The protocol is parsed in Rust with `rmcp`** (3.4.1, Apache-2.0,
   MSRV 1.88), so malformed or hostile requests never reach the WebView. The
   shim speaks MCP to the client; between shim and app runs a small framed
   request protocol. The app's Rust side checks the pairing, the client's
   folder allowlist and every path (symlinks and junctions resolved first;
   NUL, `..` and mixed separators rejected) before it hands a typed request to
   the owner window over the window bus (`windowBus.ts`), where the index
   queries and the adapter chain live. Rust does not read the index database
   itself — search syntax and `.base` filters exist once, in TypeScript.
   Specification 2026-07-28, also serving 2025-11-25 clients; no sessions;
   `ttlMs`/`cacheScope` on lists.
4. **Pairing instead of OAuth.** A client's first contact raises a pairing
   confirmation in the app ("Claude Desktop wants to read: folders … — Allow /
   Deny", naming the starting program). After that the shim presents a
   **per-client device secret** from the keychain. Grants are per client and
   folder, deny by default, revocable at any time; an audit (which client read
   what, when) is visible in the app.
5. **A small tool surface from the shared manifests** (ADR 0019):
   `search_vault`, `read_note` (section handles), `get_outline`,
   `get_backlinks`, `query_base`, `get_tasks`, `get_recent`, `open_in_app`.
   Resources: the format contracts. Prompts: the core skills. Never exposed:
   `plainva.ai` and policy files, `.agent/` internals, secrets, raw embedding
   vectors, file system access, `.plainva/` internals; results are checked for
   `file://` and internal endpoints. Read-only first.
6. **Writes are proposals.** A text write by a client becomes a suggestion
   round with author `mcp:<client>` and is answered "proposal created, waiting
   for acceptance in Plainva". Critical classes (rename, move, delete as a
   plan) and external effects use the blocking multi-round trip
   (`input_required` → approval in the app → the client retries with
   `inputResponses`).
7. An HTTP listener exists only on a trigger — then with a token, an explicit
   `Host`/`Origin` check and a bind to `127.0.0.1`. ChatGPT and claude.ai in a
   browser reach only remote HTTPS servers; the user guide says so.

### Client

*The client was built in October 2026 and is recorded in
[ADR 0024](0024-mcp-client-foreign-servers.md), which replaces the three
points below where they differ: an own protocol client behind native ports
instead of the SDK (§8), the pin checked before every use (§9), and OAuth as
the part that follows (§10).*

8. Official TypeScript SDK, specification 2026-07-28 (also 2025-11-25
   servers); stdio and Streamable HTTP; Roots, Sampling and Logging are
   deprecated and not offered. Deny by default; no stdio process starts
   without an approval per server, in a sandbox where one exists.
9. **Pinning.** Tool descriptions, prompts and server `instructions` are
   hashed on connect and compared on every reload; any difference is a
   security event that blocks the server until reviewed. Descriptions and
   instructions are capped (2,048 characters). Tool results pass the tier-3
   wrapper. Capability, folder and domain scoping per server and tool; tool
   shadowing is detected.
10. Remote servers: OAuth 2.1 with PKCE, issuer check (RFC 9207), CIMD
    instead of dynamic client registration, audience check; secrets only
    through a broker with consumer-bound short-lived tokens.

### Implementation (read-only stage, 2026-09-29)

- **Where the protocol is parsed.** The helper `plainva-mcp` (a second binary
  of the desktop crate, `src/bin/plainva-mcp.rs`, console subsystem) does not
  speak MCP itself: it reads the client's `initialize` line for the client's
  name, sends one JSON *hello* line (client, version, starting program,
  secret) and, once admitted, passes bytes in both directions. MCP is parsed
  by `rmcp` 3.5 in the app process (`src/mcp/`), still in Rust and still never
  in the WebView — the "small framed request protocol" of point 3 is that
  hello line plus the typed call the app hands to the main window.
- **Endpoint.** Windows: `\\.\pipe\plainva-mcp-<identifier>`, created with
  `first_pipe_instance` (no one else may hold the name), `reject_remote_clients`
  and a DACL that grants only the signed-in user. macOS/Linux: a socket
  `plainva-mcp-<identifier>.sock` in a per-user folder (`0700`;
  `plainva-mcp` in the per-user temporary folder on macOS,
  `/run/user/<uid>/plainva-mcp` or `/tmp/plainva-mcp-<uid>` on Linux), the
  socket itself `0600`. Nothing listens until the user switches the
  server on (Settings → AI & automation), and it closes with the switch; when
  another vault opens, the connections of the one before end (see the
  implementation of lists that change, 2026-10-25, below).
- **Pairing and grants.** The app keeps `mcp/clients.json` (name, program,
  SHA-256 of the secret, last use) and `mcp/grants-<vault>.json` (folders per
  client and vault) in its data folder, never in the vault; the helper keeps
  its secret in the OS keychain (`plainva-mcp`, `<identifier>/<client>`).
  Nothing is ticked in the pairing question; a refusal silences that client for
  ten minutes; one question at a time. The audit is
  `mcp/audit-<vault>.jsonl` (last 500 calls: client, tool, success, how many
  notes) and is shown in the settings.
- **Two walls.** Every path argument is checked natively — string rules
  (NUL, `..`, backslashes, drive letters, trailing dots and spaces, Plainva's
  own folders), then the real path with symlinks and junctions resolved must
  lie in the vault and in the client's folders — before the call reaches the
  main window. There the tools run with the assistant's own executor as a
  cloud-like recipient (`plainva.ai` rules hold), narrowed to the same
  folders; every path that passed is reported back, and one path outside the
  folders refuses the whole answer. `file://` and loopback addresses are
  withheld from answers.
- **Surface.** The tools are the manifests with surface `mcp`, served as the
  web view registers them (one source of names, descriptions and schemas).
  One resource: the format contract (`plainva://format`). The core skills as
  prompts follow with the skills themselves (plan P1.5).
- **Claude Desktop.** The settings write an `.mcpb` (manifest 0.3, `binary`
  server) that carries the installed helper; no package is built in CI.

### Implementation (stage 2: a client may propose changes, 2026-10-07)

- **A grant of its own.** Whether a client may propose changes is a second
  answer of the pairing question and a switch per client in the settings —
  per client and vault, kept beside its folders in `mcp/grants-<vault>.json`
  (`writes`), off by default, and worth nothing without a folder to read.
  The native side reads the grants **at every request**, not once per
  connection: folders that changed, a grant that was taken back and a client
  that was removed hold from the next call of a connection that is already
  open. (Until this stage a connection kept the folders it was admitted
  with, so a client removed in the settings could go on reading until it
  reconnected.)
- **Six more tools on the `mcp` surface** — `propose_edit`, `set_property`,
  `create_note` (kind `propose`: answered at once) and `rename_note`,
  `move_note`, `delete_note` (kind `plan`). The web view registers each tool
  with its kind; the native side lists a tool that writes only to a client
  with the grant and refuses a call without it in the words of a tool that
  does not exist, before anything reaches the main window. The main window
  checks the flag it is handed once more.
- **Nothing a client writes changes the vault.** The tools are the
  assistant's own (ADR 0019 §2), run for a writer outside every conversation:
  a change to a note is a suggestion round signed `mcp:<client id>` under the
  name the user paired the client with, a new note is a draft on this device
  that belongs to no conversation, and every address the client brings is
  written inert — nothing the user typed is known here. One of a note's own
  `plainva.ai` rules is nobody's to set from outside: such a call is answered
  that nobody confirmed it, and the user is not asked. A program can call in a
  loop where a run of the assistant ends by itself: a client with 300 changes
  waiting on the vault's notes is told that the user has to decide first, as a
  full list of drafts tells its writer; the user hears of what a client left
  once per note and minute.
- **A plan goes by the protocol's round trip** (`input_required`,
  specification 2026-07-28). The first call only computes what would happen
  and lays it before the user in a dialog of the main window — with what the
  user needs to judge it and the client is never told (the notes whose links
  would change). The client gets `input_required` with an elicitation for its
  own user and an opaque request state: a random handle, valid for that
  client, that vault, that very call, and ten minutes. A retry without the
  client user's answer is answered `input_required` again natively and never
  reaches the main window. With it, the tool runs again and is told yes only
  if the user said yes **in Plainva** and what it would do now equals what
  they were shown; otherwise nothing happens. What a client writes into
  `inputResponses` approves nothing by itself. A deletion is the app's own
  delete dialog, opened after both answers — it decides. Plan tools exist
  only for a client that speaks 2026-07-28 and declares form elicitation: a
  client that could not come back with an answer is not offered them.
- **The gate, tightened.** An outside client is at the gate a cloud recipient
  **that may reach the internet** (`webTools: true`): Plainva cannot see what
  a client does with what it reads, so a note under `cloud: deny` or under
  `web: deny` does not exist for it — for reading as for writing. This also
  changed the read-only stage, which had held only the cloud rule. A
  consequence the writing tools rely on: nothing a client can read carries a
  rule that the place of its proposal could lack.
- **The record.** A line of the audit may carry one fixed word — `asked` (a
  plan waits for the user) or `declined` — and still never a path or a text.

### Implementation (lists that change, 2026-10-25)

Plan P9-5. What a client sees can change while it is connected — its
folders, its grant to propose changes, its access taken back, the app's own
lists of tools and prompts (another language). The server declares
`listChanged` for tools and for prompts and tells the client so, instead of
leaving it to the next connection or to the list's time to live:

- **A session with a handshake** (`initialize`: 2025-11-25 and earlier)
  hears `notifications/tools/list_changed` or
  `notifications/prompts/list_changed` on its own stream.
- **A client of 2026-07-28** has no session: it hears them on the
  subscription it opened (`subscriptions/listen`), and only what it asked
  for — tools, prompts; the one resource does not change. A connection holds
  four subscriptions at most.
- **What is news:** a grant whose effect on the client's list changed —
  reading or not, proposing or not, by the settings or by a pairing (the
  same app in a second window) —, access taken back, and the app's lists
  differing from the ones before while the vault stays; that last one is
  told to every connection, whatever part of the lists a client sees.
  Another client's change is no news for this one, and a grant change that
  leaves the client's list as it was is not said.
- **Nothing more is said.** A notification carries no list, no folder and no
  name: the client asks for its list as before, and every request is still
  checked against the grants of that moment. A connection that fell behind is
  told that both lists may have changed.
- **A connection belongs to one vault.** Its vault, the server's
  generation and whether the server is on are read together the moment it is
  taken, and checked again after the user was asked; a vault switch — or the
  server switched off — ends every open connection wherever it is (while its
  hello is read, in the handshake, serving, with a subscription open) and a
  question that waits for the user, in the main window too, and serves nobody
  for the vault that is gone; a change after a client's grant was saved ends
  its connection right after the ok line. A client is kept, and its grant
  saved, only while that vault and those settings hold — read again and
  written as one step with every other change of the store (clients, grants,
  the audit), so that what the user changed while a client was asked stays.
- **A call belongs to it too.** It carries the vault its connection was
  admitted for: the main window runs it only while that vault is open, its
  paths are checked in that vault's folder, a call still waiting for the main
  window is not waited for after a change, and an answer that comes back after
  one is withheld. (Until this stage an admission read the vault twice: a
  switch while the user was asked could let a connection read the new vault
  under a grant saved for the old one; a connection that had not begun its
  handshake stayed open; and a call under way during a switch was answered
  from the vault open then.)
- **The listener stays through a vault switch** and serves the vault that is
  open when a client comes; only the switch stops it. Switched off and on,
  the next listener takes the endpoint once the one before is gone — its
  socket removed, its pipe instance closed. On Windows `first_pipe_instance`
  refuses the name while any instance of it is open: a connection of the
  listener before whose app has not let go yet, or another program's. The
  listener tries again until the name is free and never serves beside it;
  `mcp_status` counts it as running only while it holds the endpoint. A
  connection that could not be taken — out of file handles, gone before it
  was taken — ends nothing but itself: the listener goes on after a pause;
  ten in a row end it, and the status says so.
  (Until this stage a vault switch restarted the listener, and on Windows the
  restart failed while an app was connected: nothing listened any more, and
  the status still said it did.)
- Both lists carry a `ttlMs` of 60 s: a client that ignores the
  notification sees the change at its next list after that. A change in the
  instant between a subscription's acknowledgment and its start is not sent;
  the time to live covers it.

## Consequences

- One more native binary per desktop platform (built and signed with the
  app).
- The WebView is not on the path of hostile protocol input; it only sees typed
  requests that already passed pairing and path checks.
- Clients that cannot start a local program (browser chat apps) cannot use
  the server; that is stated, not worked around.

## Alternatives

- **Streamable HTTP on loopback with a token.** Rejected as the default: a
  listening port is reachable by every local process and, through rebinding
  and CSRF, by web pages; the token then carries all the security.
- **The TypeScript SDK in the WebView.** Rejected: hostile JSON would be parsed
  in the most exposed process.
- **Rust reads the index directly.** Rejected until the round trip measurably
  hurts: two implementations of search and filters would drift.

## Links

- ADR 0017, ADR 0019, ADR 0020; `apps/desktop/src/services/windowBus.ts`,
  `apps/desktop/src/adapters/RemoteVaultAdapter.ts`; MCP specification
  2026-07-28; MCP security best practices.
