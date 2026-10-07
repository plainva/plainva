# MCP client architecture

Status: built in three layers. The rules and the protocol client are in `packages/core/src/ai/mcp/`; the native side is in the three shells; the stores, the session and the surfaces are in `packages/ui/src/ai/` (`mcpStores`, `mcpRuntime`, `mcpSession`, `mcpTools`, `externalTools`, `externalReview`, `AiExternalReview`, `AiExternalPrompt`). The layers above the rules apply them and add none of their own. Signing in to a remote server (OAuth 2.1 with PKCE) is built the same way: what the web view does of it is `oauth.ts`, what decides is native.

Plainva speaks MCP in two directions. As a **server** it lets AI apps on the same computer read the vault ([ADR 0022](../adr/0022-mcp-server-without-a-network-port.md)). As a **client**, described here, it lets the assistant use tools of servers the user added: an issue tracker, a calendar service, a search API. The two share the tool manifest idea and nothing else; the trust runs in opposite directions. The decisions are recorded in [ADR 0024](../adr/0024-mcp-client-foreign-servers.md); what was checked, found and left unverified is in the [security review](MCP_Client_Security_Review.md).

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

A call goes out only if the server is approved, the tool's name is not withheld, the user granted the tool, the tool declares itself read-only, and every vault path the call may carry lies in a folder the grant names. Otherwise the decision names the reason. Every allowed call is shown before it goes out: server, tool, data.

The paths the session hands to that decision are **every note the conversation has read** — what its context carried, what was pinned to it, what its tools read, in this run and the ones before. Arguments are text a model wrote, and a model can write anything it has read into them; so what counts is what it could carry, not what a path-shaped argument admits to.

- `readOnlyHint` is the server's own claim. It is **necessary** — a tool that does not even claim to only read is not offered while writing through MCP is closed — and never **sufficient**: the call is previewed, its result is tier 3, and nothing a foreign tool returns can change the vault.
- A grant names folders. By default it names none: the server only ever sees what the user typed.
- To the privacy gate ([ADR 0018](../adr/0018-ai-context-package-and-egress-policy.md)) every MCP server is a **cloud recipient**, a local stdio server included. It runs on this computer, but it is someone else's program with the user's network access. A note marked `cloud: deny` therefore reaches no MCP server.
- A vault's choice belongs to the **registration** it was made for: the address or the command line as the native dialog confirmed it (`mcpServerTarget`). A server registered anew under the same id — another address, another command — starts off, with nothing granted, in every vault, and its approval is void. Where a request goes is the native registry's alone: the web view names a server by its id and never passes an address. `mcpHostAllowed` remains the rule for a caller that holds an address; no path of the app is one.

### Results

A result becomes one text of bounded length, tier 3, with server and tool as its origin; the prompt renders it inside an untrusted-data block like any note, and the text cannot close that block or open one of its own. Text and embedded text resources are kept, links are kept as inert lines, images and audio are counted and left out. Reading text in images is a separate decision.

### Tokens

A remote server that needs the user's account gets a token made for that server: bound to its address, limited to the scopes the user granted, and alive for at most ten minutes. The broker that issues such tokens is the one the account connections use; `McpTokenBroker` is the contract. Two checks do not depend on the implementation: a request is served only for the server's own address and granted scopes, and a token is sent only to its audience and only before it expires — checked at the moment of use, so a redirect carries no token along. This is what keeps a token issued for one server from being accepted by another. No broker issues such tokens yet; what is built is the sign-in a server has of its own (see "Signing in" below), which holds the same two checks natively.

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
| `native.ts` | the contract of the shells' native side, and the address rule both sides of it keep |
| `oauth.ts` | signing in, as far as the web view does it: what a server's refusal says, which addresses to ask, the steps |
| `oauthRules.ts` | the rules the native side of a sign-in keeps, written down once more: the reference the three native sides are tested against |
| `scripted.ts`, `scriptedOAuth.ts` | a server and a sign-in in a script, for tests in every package |

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

## The native side

Everything the web view should not be able to do on its own lives behind `McpNativeHost` (`native.ts`), implemented three times: `apps/desktop/src-tauri/src/mcp_client` in Rust, `AiMcpPlugin.java` on Android, `AiMcpPlugin.swift` on iOS. `aiMcpBoundary.test.ts` holds the three to one contract by reading their sources.

### The registry

A server is registered natively before anything can be sent to it or started. Registering shows a **native** dialog — the address of a remote server, or the whole command line of a program: the file that will be started, every argument on a line of its own, the names of the environment values it gets, and whether it runs in a sandbox. The web view supplies the words around it in the user's language; what is confirmed is written by the native side. From then on a request or a start names a server **id**. No command takes an address or a program.

- An address is printable ASCII (a name in another script is typed in its `xn--` form, so nothing that only looks like a host is connected to), https or plain http to this device, and carries no credentials. One list of cases, `MCP_ADDRESS_CASES`, runs on all four implementations of the rule.
- A program is resolved to a file when it is confirmed, and that file is what is started later. A program that moved is confirmed anew.
- Registering a server anew under an old id forgets the old one's credentials.

### Credentials

A remote server's token and the values a program gets in its environment are stored in the system's keychain (the desktop: slots `ai-mcp:…`, which the generic keychain commands refuse; the phones: a store of the plugin's own). They are write-only for the web view: it can set one, ask whether one is there, and delete it. They go into a request or a process natively.

### A request

https, the registered address, no redirect followed — a redirect could carry the token and the arguments of a call to another host; it is reported as the answer it is. The web view sets only protocol headers from a fixed list (`Content-Type`, `Accept`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `Mcp-Session-Id`, `Mcp-Param-*`), and only values of visible ASCII. The answer is cut at five megabytes. What comes back is the status, the content type, two response headers, the body, and for a request that got no answer one of a fixed set of words — never a text of the network's own.

### Signing in

A remote server may want a sign-in instead of a fixed token. Plainva signs in the way the protocol's authorization chapter asks for: the server says where its sign-in lives (its resource metadata, RFC 9728), that authorization server says how it works (RFC 8414), the user signs in in the system's browser with PKCE, and the token that comes of it is made out to this one server (RFC 8707).

The steps are split by what they could leak.

- **The web view** (`oauth.ts`) reads the line a server refused a request with, decides which addresses to ask, shows the user where the browser will go, opens it and hands back what it returned with. None of that is a secret, and none of it decides where a secret goes.
- **The native side** (`mcp_client/oauth.rs`, `AiMcpAuthPlugin` on the phones) makes the verifier and the state, checks what came back, exchanges the code, keeps the tokens, renews them and puts the access token into requests to the registered address. No command answers with a token, a verifier or an endpoint.

Four rules carry it. `oauthRules.ts` writes them down once; the Rust module and the two phones' rule files decide the same, and one list of cases per rule runs on all four (`MCP_OAUTH_*_CASES` in `oauthRules.test.ts`).

1. **Where a code and a token are sent is read natively.** The endpoints come from a document the native side fetched itself, from an address on the authorization server's own origin under `/.well-known/`, whose `issuer` is the one that was asked for, letter for letter. A web view that was taken over cannot pair a real authorization endpoint with a token endpoint of its own.
2. **An address a server names is asked under a rule.** On the server's own host: what the user confirmed (https, or http to this device). Everywhere else: a public name, https, the default port, resolved to public addresses only. The desktop and Android connect to exactly the addresses they checked; iOS checks before the request and again where the answer came from. No redirect is followed, and an answer is cut at 256 KiB.
3. **Who answered is who was asked.** The state must be the one that was sent, and the `iss` of the answer (RFC 9207) must be the issuer: a name that differs, or one that is missing where the authorization server promised it, ends the sign-in before anything of the answer is used, an error text included. A sign-in that was begun is used once and waits ten minutes at most.
4. **A token is for one server.** It is asked for the registered address, or for the part of it the server names as itself (the same origin, and a path that ends where a segment ends); it is kept under the server's id and sent to the registered address only. A server has one credential: a sign-in removes a stored token, a stored token ends a sign-in, and removing or re-registering a server forgets both.

**Who Plainva is to an authorization server**, in this order: the client it used with this one before; the address of its own description (`MCP_OAUTH_CLIENT_DOCUMENT`, a Client ID Metadata Document on the project's website) where the authorization server takes such an address; a registration it makes itself (RFC 7591: a native app without a secret — a secret the server insists on is kept natively and sent the way the registration said); an id the user got from the server's operator. An authorization server that does not say it does PKCE with SHA-256 is not signed in with. The description itself is a file of the website repository (`public/oauth/client.json`, served as `https://plainva.com/oauth/client.json`); `mcpClientDocument()` is what it says, pinned by a test, and the ways back it lists are the ones the shells can name.

**The way back** is the one every account sign-in of the app uses: a port on this computer on the desktop (`http://127.0.0.1:<port>/callback`; port 43117 where it is free, for authorization servers that compare addresses literally), the app's own address on a phone (`<app id>://mcp/oauth`). What arrives there passes through the web view, and is worth nothing without the verifier.

**Running out.** A request that is refused with 401 asks the native side once for a new token and is sent once more (`renew` of the HTTP wire); the native side renews one at a time and not twice within ten seconds. A token for the next that was refused for good ends the sign-in. The approval of the server's texts stands, and the review asks for a new sign-in.

**What is kept.** On the desktop the tokens are in keychain slots (`ai-mcp:<id>#access`, `#refresh`, `#client`; a long value in parts of 1,000 characters, because the Windows credential store takes 2,560 bytes per entry) and everything that is no secret in `ai-mcp-oauth.json` in the app's data. On the phones there is one entry per server in the MCP plugin's own store, and one for a sign-in that was begun — it survives the system ending the app while the browser is open, and whoever gets the way back then ends the sign-in with it.

### A program (desktop only)

A server that is a program is somebody else's code with the user's rights. It is started from the registry's entry, **without a shell**, with a short list of inherited environment variables instead of the app's own environment, and its process tree ends with the app (a job object on Windows, a process group elsewhere). What it writes to its error stream is kept in a small ring for the settings to show, scrubbed of the values it was given, and never goes to a model. A phone starts no programs; the parity catalog records that as a decision.

### The sandbox

A program gets what it needs through the arguments of a call. It has no business in the user's vaults, keys, browser profiles or Plainva's own data. Where the system can start a program without those folders, Plainva does: `sandbox-exec` on macOS, `bwrap` on Linux. The rest of the system stays as it is, because a program fetched by `npx` needs its own files, a cache and the network to work at all. Windows offers nothing comparable for an arbitrary program, and the approval says so.

Plainva says "in a sandbox" only where a **self-test on this computer** passed with the wrapper a server gets: a program starts, and it cannot read a file in a closed folder. A sandbox that is installed but does not hold counts as none, and a program that was confirmed to run in one is not started without it.

## The life of a server on a device

```text
added ──► new ──(the user reviews the listing)──► approved
                                                    │
                          (any listing or prompt expansion that differs)
                                                    ▼
          approved ◄──(the user reviews what is there now)── blocked
```

Nothing of a `new` or `blocked` server is offered to a model.

## What Plainva remembers, and where

Three places, because three things are decided in three places.

| What | Where | Why there |
|---|---|---|
| Where a request goes or what is started; the credentials | the native registry and the keychain, per device | the web view must not be able to redirect a request or read a credential |
| The user's name for a server, the approved listing and its pin | `mcp/servers.json` in the app's data, per device (`McpDeviceStore`) | the texts are the same whatever vault is open — and whoever can write a vault must not be able to write an approval |
| Whether a vault uses a server, the tools it granted, the folders it allowed; the log of calls | `<vault key>/mcp.json` and `<vault key>/mcp-audit.json` in the app's data (`McpVaultStore`) | a server is off in a vault until the user switches it on, like the internet |

Both files are read defensively, and a damaged one can only take away: an approval without the listing it was given for reads as "new", an entry that cannot be read switches a server off and grants nothing. The log keeps who, what, how it ended and how much — never what was said — and the newest 300 entries.

`McpRuntime` holds the connections and enforces the pin: `inspect` shows a listing for the review, `check` loads it again before a use (unless the server's own `ttlMs` says it is still fresh, for at most five minutes), and both block the server when it differs. What a conversation reads of a server comes from the approved snapshot in the record, never from a connection. A connection nobody used for ten minutes is ended (`MCP_IDLE_MS`), and every connection ends with the vault: a program that was started for a review does not idle beside the app, and the next use starts it again.

## In a conversation

- **Names, not tools.** A new conversation carries the names of the foreign tools this vault offers (`mcp_<server>_<tool>`) in `conversation.more`. They never appear in a provider's tool list: the model finds them through `find_tools` and calls them through `call_tool`, like the app's own further tools (ADR 0019). The system prompt says only that tools of services the user connected exist.
- **The approved words, in the fence.** What `find_tools` answers about a foreign tool is built from the approved snapshot — name, the user's name for the server, the description, a reading copy of the arguments — and that part of the answer stands inside the untrusted-data block. A server's `instructions` are shown in the review and go to no model.
- **Decided at the call.** The names are fixed for the conversation; whether a call goes out is decided on what holds at that moment. A server that was switched off, removed or blocked since brings no tool, and the model is told in the app's own words.
- **Who gets none.** A conversation bound to a skill, a door (an action on a selection, a reply in a comment thread), a regression run and the system's own model reach no foreign tool: nobody chose a service for them. A loaded skill narrows them away as it narrows every tool.
- **Prompts are the user's step.** The prompts of a server that is ready in this vault stand under an empty conversation. Starting one checks the listing, asks the server for the expansion and compares it with the pin: a match is sent as the user's message; one nobody approved yet is shown in full first and pinned when the user sends it; one that differs blocks the server, and nothing is sent.

## The life of a call

`createMcpExecutor` (`mcpTools.ts`) decides one call, in the order of trust. Every way out before the last ends without a question and without a request.

1. **The server and the tool as they stand now.** Registered, approved for this registration, switched on in this vault, the tool granted and offered (`mcpServerStanding`, `mcpOfferedTools`). Arguments larger than a person could read in a question are refused.
2. **The listing again.** `check` loads it unless it is fresh and compares it with the pin. A difference blocks the server here: the user is not asked, and the model is told not to try again.
3. **What the conversation carries.** `mcpCallDecision` with every note the conversation has read as the paths. If the conversation read more than its record keeps by path, or a picture whose notes cannot be looked up, nothing is assumed of the rest and nothing is sent. Then the privacy gate, with the server as a cloud recipient: one note that is kept from the cloud ends it.
4. **The user.** The call is shown above the composer — the server by the user's name for it, the tool, the arguments in full. One yes is for one call; there is no "always".
5. **The request**, through the shell's native port. A failure is told in the app's words; a server's own error text is a stranger's words and goes into the fence.
6. **The result.** `mcpResultView` makes one bounded piece of text of it, tier 3, with server and tool as its origin; the orchestrator fences it. The run records the server, the tool and how it ended, and so does the vault's log.

To the Rule of Two a foreign tool is a way out (`outward`) and its result is untrusted: the manifest says both, and the executor above is where the user is asked.

## The surfaces

One model, two dresses. `useExternalAdd` and `useExternalReview` hold the state of adding and of reviewing a server; `AiExternalReview` is the review's body. The desktop shows them in modals from the card "External tools (MCP)" of the vault's AI settings, the phone in sheets from the same section. The question about a call is a fourth form of the approval card above the composer (`AiEffectApproval`, `data-kind="mcp"`), and a prompt on its way into a conversation is `AiExternalPrompt`, in the same place. The words a person reads are made in `externalTools.ts`: where a server stands, why a tool is not offered, what differs from the approved texts, how a look failed. A server's own error text is never part of them.

## What the client does not do

- It starts no stdio server on its own. Each server is started after an approval; where the platform offers a sandbox, the server runs in one.
- It does not offer roots, sampling or logging to servers.
- It loads no instructions from the network on behalf of a skill, and it does not read a server's skills extension: a skill a server offers reaches nobody. Where that opens, it goes through the same content-bound approval as a skill from the vault.
- It answers no question a server asks of the user (elicitation) and keeps no stream open for a server's notifications; a list is loaded again before a use instead.
- It calls no tool that changes something before writing through MCP opens with the approval chain of [ADR 0019](../adr/0019-ai-tools-risk-classes-and-approvals.md).
- It never passes `_meta` to a model.
- Around a sign-in: it does not ask an authorization server to revoke a token when the user signs out (the tokens are forgotten on the device), does not ask for more scopes on its own when a server answers that a sign-in does not allow something (the user signs in again), and is never a client with a secret of its own.
