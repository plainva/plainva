# MCP client architecture

Status: rules and protocol client built, in `packages/core/src/ai/mcp/` with tests. The native transports, the stores, the session and the settings surface are built on top of them and add no rule of their own.

Plainva speaks MCP in two directions. As a **server** it lets AI apps on the same computer read the vault ([ADR 0022](../adr/0022-mcp-server-without-a-network-port.md)). As a **client**, described here, it lets the assistant use tools of servers the user added: an issue tracker, a calendar service, a search API. The two share the tool manifest idea and nothing else; the trust runs in opposite directions.

## Where a foreign server stands

A server the user added is somebody else's program or somebody else's service. Plainva believes nothing it says about itself. It speaks to the model through four channels, and each is a place to put instructions:

| Channel | What it is | Why it matters |
|---|---|---|
| `instructions` | the server's "how to use me" text | read by the model like a part of the system prompt |
| tool descriptions | `tools/list` | decide which tool the model picks, and how |
| prompts | `prompts/list`, `prompts/get` | templates the user starts; their text becomes a message |
| tool results | `tools/call` | the answer to a call, in the middle of a conversation |

It is also a recipient: whatever a call carries as arguments has left the app.

The threat model lists the client-side case as T10 ([AI_Threat_Model.md](AI_Threat_Model.md)). The incident behind it: a server spread through unsolicited pull requests answered three calls honestly and then rewrote its tool list and a prompt so that the agent went looking for credentials (Pillar Security, 2026-08-12).

## The rules, and where they live

| Rule | Module | Functions |
|---|---|---|
| An approval covers texts, not a server | `pin.ts` | `pinMcpListing`, `compareMcpPin`, `reviewMcpListing`, `reviewMcpPromptBody`, `approveMcpListing` |
| Server-supplied text is cleaned and cut before anyone reads it | `listing.ts` | `capMcpText`, `readMcpListing` |
| A foreign tool never has a built-in tool's name | `names.ts` | `mcpExposedToolName`, `findMcpNameIssues`, `withheldMcpTools` |
| Nothing is callable that the user did not allow | `grants.ts` | `mcpCallDecision`, `mcpRecipient`, `mcpHostAllowed` |
| A result is data | `results.ts` | `mcpResultView` |
| A token belongs to one server | `tokenBroker.ts` | `McpTokenBroker`, `mcpTokenRequestProblem`, `mcpTokenUsableFor` |

All of it is pure and platform-neutral, so both shells and every transport get the same answers. The tests are in `mcp.test.ts` next to the modules.

### An approval covers texts

When the user approves a server, Plainva stores a **pin**: one SHA-256 per tool descriptor, per prompt descriptor, per prompt expansion that was looked at, and one for the instructions. Every listing the server sends later — on connect and on each reload — is compared with the pin. **Any** difference blocks the server until the user looks again: a changed description, a new tool, a tool that went away, different instructions, a prompt that now expands to something else.

- The hash is taken over canonical JSON (sorted keys, no whitespace), so reordering keys hides nothing.
- It covers the **full** text. Texts are cut for display afterwards, so a change beyond the cut still counts.
- `_meta` is left out at every depth: it carries protocol bookkeeping that legitimately changes. That is only safe because Plainva never shows `_meta` to a model — the two halves belong together, and the code that builds the model's view must keep it that way.
- **Blocked is sticky.** A server that flips back to the approved listing stays blocked. Only a new approval of what is there now lifts the block.
- A prompt expansion is checked at the moment it is used. One that matches its pin may go to the model; one that differs blocks the server; one nobody approved yet (a prompt asked with new arguments) is shown to the user first.
- A damaged stored review reads as "new", never as "approved".

The review is stored in app data on the device, not in the vault: whoever can write the vault could otherwise write the approval ([ADR 0020](../adr/0020-ai-skills-memory-and-script-skills.md) makes the same decision for skills).

### Text is cleaned and cut

Instructions and descriptions lose Unicode format characters first (zero-width characters, bidirectional overrides, the tag block — text that renders as nothing), then are cut at 2,048 characters, in whole code points. The order matters: thousands of invisible characters could otherwise push a visible sentence past the cut, or carry one nobody sees. A listing is read defensively and bounded (200 tools, 100 prompts); a malformed entry is dropped, not an error.

### Names

A model picks a tool by name and description. A server that calls its tool `read_note` is asking to be picked instead of Plainva's own.

- **A namespace.** A foreign tool reaches the model as `mcp_<server>_<tool>`, in the alphabet every provider accepts. The server id is chosen by the user when adding the server, not by the server. A name that is not already in that alphabet is folded and gets six hex digits of its hash, so `Search.Issues` and `search-issues` stay two tools. The mapping is deterministic: a conversation's tool list does not change from request to request.
- **Withheld:** a name that appears twice in one listing, a name with characters outside letters, digits, `_`, `-` and `.` (a Cyrillic letter in `read_note` is a different name that looks the same), and two tools that would end up under one name.
- **Reported at the review:** a tool that reads like a built-in one (`get_tasks` on a to-do server is legitimate, and worth a look), and the same tool name on two servers.

### Grants

An approved listing says "these texts are what I saw". A **grant** says which of these tools may be called and with what. They are separate on purpose: approving a changed listing does not silently grant the tools that are new in it.

A call goes out only if the server is approved, the tool's name is not withheld, the user granted the tool, the tool declares itself read-only, and every vault path in the arguments lies in a folder the grant names. Otherwise the decision names the reason. Every allowed call is shown before it goes out: server, tool, data.

- `readOnlyHint` is the server's own claim. It is **necessary** — a tool that does not even claim to only read is not offered while writing through MCP is closed — and never **sufficient**: the call is previewed, its result is tier 3, and nothing a foreign tool returns can change the vault.
- A grant names folders. By default it names none: the server only ever sees what the user typed.
- To the privacy gate ([ADR 0018](../adr/0018-ai-context-package-and-egress-policy.md)) every MCP server is a **cloud recipient**, a local stdio server included. It runs on this computer, but it is someone else's program with the user's network access. A note marked `cloud: deny` therefore reaches no MCP server.
- A remote server is reached only at a host the grant names, over HTTPS.

### Results

A result becomes one text of bounded length, tier 3, with server and tool as its origin; the prompt renders it inside an untrusted-data block like any note, and the text cannot close that block or open one of its own. Text and embedded text resources are kept, links are kept as inert lines, images and audio are counted and left out. Reading text in images is a separate decision.

### Tokens

A remote server that needs the user's account gets a token made for that server: bound to its address, limited to the scopes the user granted, and alive for at most ten minutes. The broker that issues such tokens is the one the account connections use; `McpTokenBroker` is the contract. Two checks do not depend on the implementation: a request is served only for the server's own address and granted scopes, and a token is sent only to its audience and only before it expires — checked at the moment of use, so a redirect carries no token along. This is what keeps a token issued for one server from being accepted by another.

## The protocol client

How a server is asked is separate from what it may do. The protocol lives in the modules below, next to the rules, and it is Plainva's own code, not the official SDK. Four reasons: both shells need the same protocol code over **native** transports (a web view starts no program, and a request has to pass the native side, because only there can an address, a redirect and a credential be enforced — the SDK's transports use `fetch` and `child_process`); a server's credential never enters the web view ([ADR 0017](../adr/0017-ai-harness-architecture-and-native-boundary.md) keeps SDKs off the key path); pinning needs a listing exactly as the server sent it, not as a schema filtered it; and a reading client speaks seven methods.

| Module | What it does |
|---|---|
| `wire.ts` | revisions, the request metadata, how an answer is read, how a failure is named, and the two ports a shell implements |
| `headerValues.ts` | the mirrored request headers of the stateless revision: `Mcp-Name`, and arguments a tool marks with `x-mcp-header` |
| `httpWire.ts` | Streamable HTTP: one POST per message, a JSON or event-stream answer, the handshake and session of an earlier revision |
| `stdioWire.ts` | a program on this computer: one message per line, which answer belongs to which request, giving up, telling the generations apart |
| `client.ts` | what Plainva asks: what the server is, its lists (all pages, bounded), one call, one prompt |
| `schemaView.ts` | a tool's arguments as a model reads them: cleaned, cut, bounded |
| `scripted.ts` | a server in a script, for tests in every package |

### Two generations

The current revision (`2026-07-28`) is stateless: every request names its revision and the client in `_meta`, and `server/discover` says what the server speaks. Earlier revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`) want an `initialize` handshake, and over HTTP may hand out a session id. Plainva asks the modern way first and falls back to the handshake — on any answer that is not a recognised modern one, never on one error code alone, as the specification demands. A program gets four seconds to answer the first question; then the handshake is sent as well and whichever answer arrives decides, so a modern program that is slow to come up is not mistaken for an old one. The deprecated HTTP+SSE transport is not spoken.

### What Plainva offers a server: nothing

The capabilities in every request are empty. No roots, no sampling, no logging — the specification deprecates all three — and **no questions to the user**: a server that may put its own text into Plainva's dialogs has a phishing channel. A result that says "come back with this state" is retried, at most three times. A result that asks for input (`inputRequests`) breaks the protocol, since nothing was offered; the call fails and none of what the server asked is shown. Plainva opens no long-lived notification stream either (`subscriptions/listen`); instead a listing is loaded again before it is used.

### Freshness

A server may say how long its lists stay fresh (`ttlMs`). Plainva takes the shortest hint of the lists it loaded, never more than five minutes, and nothing where a list gives none. While a listing is fresh a call goes out without loading it again; otherwise the lists are loaded and compared with the pin first. The hint shortens round trips. It never replaces the comparison: every listing that is loaded is compared.

### The two ports

A shell implements two small interfaces, and everything a web view should not be able to do stays behind them:

- **`McpHttpPort`** — one exchange with the server the port is bound to. The web view names protocol headers and a body. The address and the credential are the native side's; it follows no redirect, cuts the answer, and hands back the status, the content type and two response headers (`Mcp-Session-Id`, `WWW-Authenticate`).
- **`McpStdioPort`** — the approved program of the server the port is bound to: start, write a line, stop. The command is never named from the web view.

### Headers from arguments

Over HTTP the name of a tool travels in `Mcp-Name`, and a tool's schema may mark arguments (`x-mcp-header`) whose values travel in `Mcp-Param-<Name>`. Both are text that a server and a model supply, placed into a header: a value goes as it is only if it is visible ASCII, otherwise as the Base64 form of the specification, so a line break in an argument never becomes one in a request. A tool whose marks break the specification's rules (an empty or invalid header name, two arguments asking for one header, an argument that is no string, integer or boolean, a mark that is not reached through `properties` alone) is not offered over HTTP.

### Arguments as a model reads them

A tool's input schema is another place a server writes text a model reads: every argument can carry a description, and a schema can be as large as its author likes. The pin covers the schema as sent; `mcpSchemaView` is the reading copy — only keywords that say what an argument is, every text cleaned and cut at 300 characters, depth and width bounded, at most 4,000 characters of JSON, shallower and at last without descriptions if that is what it takes. An argument is offered only under its exact name. Nothing is resolved and nothing is fetched: `$ref` stays a name, and only one that points into the schema itself.

## The life of a server on a device

```text
added ──► new ──(the user reviews the listing)──► approved
                                                    │
                          (any listing or prompt expansion that differs)
                                                    ▼
          approved ◄──(the user reviews what is there now)── blocked
```

Nothing of a `new` or `blocked` server is offered to a model.

## The life of a call

1. The model names `mcp_<server>_<tool>`.
2. `mcpCallDecision` answers; a refusal goes back to the model as a structured error with the reason.
3. The arguments pass the privacy gate with the server as a cloud recipient.
4. The call is shown: server, tool, data. The user confirms.
5. The transport sends it; a token, where one is needed, is checked against the address.
6. `mcpResultView` turns the answer into a tier 3 payload; the conversation continues.

## What the client does not do

- It starts no stdio server on its own. Each server is started after an approval; where the platform offers a sandbox, the server runs in one.
- It does not offer roots, sampling or logging to servers.
- It loads no instructions from the network on behalf of a skill. A skill a server offers goes through the same content-bound approval as a skill from the vault.
- It calls no tool that changes something before writing through MCP opens with the approval chain of [ADR 0019](../adr/0019-ai-tools-risk-classes-and-approvals.md).
- It never passes `_meta` to a model.

## Decided with the parts that follow

Two questions belong to parts that are built after the protocol client, and are answered there rather than fixed here: the OAuth flow for remote servers (PKCE, issuer and audience checks, client metadata documents), and which sandbox each desktop platform offers for a server that is a program.
