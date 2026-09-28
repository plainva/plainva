# ADR 0021: MCP server without a network port, and the MCP client

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
5. **A small tool surface from the shared manifests** (ADR 0018):
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

- ADR 0016, ADR 0018, ADR 0019; `apps/desktop/src/services/windowBus.ts`,
  `apps/desktop/src/adapters/RemoteVaultAdapter.ts`; MCP specification
  2026-07-28; MCP security best practices.
