# MCP client security review

Last reviewed: 2026-10-07

Status: **internal review, by the people who built it — not an independent one.** It records what was looked at, what was found and changed, what holds and by which proof, and what nobody has checked yet. It replaces no outside review; where it says "holds", it means "holds in the tests named", not "cannot be broken".

Scope: Plainva as an MCP **client** — the assistant using tools and prompts of servers the user connects, the sign-in to such a server included ([architecture](MCP_Client_Architecture.md), [ADR 0024](../adr/0024-mcp-client-foreign-servers.md), threat model T10, T25–T29 and T36 in [AI_Threat_Model.md](AI_Threat_Model.md)). Plainva as an MCP server is ADR 0022 and not part of this review.

## What was reviewed

| Layer | Code | How |
|---|---|---|
| The rules | `packages/core/src/ai/mcp/` — `listing`, `pin`, `names`, `grants`, `results`, `offer`, `schemaView`, `headerValues` | read line by line against the specification of 2026-07-28 and the earlier revisions; unit tests |
| The protocol client | `wire`, `httpWire`, `stdioWire`, `client` | read; tests against a scripted server in both generations over both ports |
| The native side | `apps/desktop/src-tauri/src/mcp_client/`, `AiMcpPlugin.java`, `AiMcpPlugin.swift` and their rule files | read; Rust and Java unit tests; a source-level contract test over all three (`aiMcpBoundary.test.ts`) |
| Stores, session, call | `packages/ui/src/ai/mcpStores.ts`, `mcpRuntime.ts`, `mcpSession.ts`, `mcpTools.ts`, the wiring in `aiSession.ts` | read; unit tests; the gate's cases against the whole session (`aiMcpGate.test.ts`) |
| The sign-in | `oauth.ts`, `oauthRules.ts` (the reference of the native rules), `mcp_client/oauth.rs`, `AiMcpAuthPlugin.java`, `AiMcpAuthPlugin.swift` and their rule files, the two shells' browser ports | read against the protocol's authorization chapter and its security best practices; one list of cases per rule on all four implementations (`MCP_OAUTH_*_CASES`); a scripted authorization server through the whole session (`aiMcpSignIn.test.ts`) |
| Surfaces | the settings card, both dialogs and sheets, the question card, the prompt card | tests in jsdom with the real session; one end-to-end test per shell |

## The questions asked, and the answers

**1. Can a server put text in front of a model that the user did not approve?**
No path was found. A model reads of a server: tool names and descriptions through `find_tools` — built from the approved snapshot in the device's record, never from a connection —, and tool results. A listing is compared with the pin at the review and before every use; a difference blocks the server before the question about a call is asked. A server's `instructions` are shown to the user and go to no model. Prompt expansions are compared with their pin at the moment of use; one nobody approved is shown in full first. Proof: `aiMcpSession.test.ts` ("is found through the tool search…", "is blocked at the call"), `aiMcpGate.test.ts` ("three honest calls, then other texts").
*Limit:* the description the user approved may itself be hostile. It is shown at the review as the server's words and reaches the model only as data in the fence; what an obedient model does with it is bounded by questions 3 and 4, not by this one.

**2. Can text a server supplies act as an instruction, or leave the place it was put?**
Descriptions, results and a server's own error texts are tier 3: one bounded piece each, inside the untrusted-data block, with invisible characters stripped and a forged closing tag escaped. They are rendered as text everywhere a person reads them. Proof: `mcp.test.ts`, `aiMcpGate.test.ts` ("its description reaches the model only as data…", "is cut where it is too long…"), `AiExternalSurfaces.test.tsx` ("shows arguments as text").
*Limit:* a fence is a statement to a model, not a mechanism. The harness does not rely on the model honouring it: every effect a model can cause through a foreign tool passes questions 3 and 4.

**3. Can a call carry something out of the vault that the user did not allow?**
A call goes out only if every note the conversation has read — its context, its pins, what its tools read, in this run and all before — lies in folders the vault allowed this server (none by default), and none of them is kept from the cloud; a foreign server counts as a cloud recipient wherever it runs. Where the record cannot name everything that was read, nothing is sent. Then the user sees the arguments in full. Proof: `mcpTools.test.ts`, `aiMcpSession.test.ts` ("what a call may carry"), `aiMcpGate.test.ts`.
*Limits:* (a) what the user typed is not part of this rule — it is theirs to send, and it is in the arguments they are shown; (b) a model that has read a note in an allowed folder can put its text into arguments, and the user's look at the arguments is then the only check: allowing a folder is allowing its content to go to that server; (c) no folder rule covers what a conversation read that is not a note — the user's mail and appointments (as the report of the reader in quarantine), a page, another server's result. A model can write any of it into arguments; the user's look at them is the only check. Mail is the user's private data, and this is the place where that weighs most.

**4. Can a call go out without the user?**
No. Every call asks, with the server, the tool and the arguments; a yes is for one call. Conversations nobody watches — a skill's, a door's, a regression run — get no foreign tool at all. Proof: `aiMcpSession.test.ts` ("asks every time"), `aiMcpGate.test.ts` ("one server that tries to use another").
*Limit:* a user who says yes to everything is not protected by a question. The design keeps the number of questions honest (one per call, none for looking) instead of offering an "always".

**5. Can one server reach through another, or pass for the app?**
Foreign tools exist only under `mcp_<server>_<tool>`, with the server id chosen by the user. A name that imitates a built-in tool is reported at the review and stays the server's; a name with characters a person cannot tell apart is withheld; two tools that would share a name are withheld. A yes for one server says nothing about another. Proof: `mcp.test.ts`, `aiMcpGate.test.ts` ("a name that imitates one of the app's own tools…").

**6. Can the web view redirect a request, start something, or read a credential?**
The web view names a server by its id. Address, command and credentials live natively: a server is registered only through a native dialog that shows the address or the whole command line; requests follow no redirect and carry only allow-listed protocol headers; credentials are write-only; a program is started without a shell, with a short environment, and ends with the app. Proof: `aiMcpBoundary.test.ts`, the Rust tests of `mcp_client`, `AiMcpRulesTest.java`.
*Limits:* see "Not verified" — the Swift side has never been compiled by this review, and the sandbox has only run on the machine it was written on.

**7. Can a server ask the user for something in Plainva's voice?**
Plainva declares no elicitation capability and answers no such request: a server that asks gets an error, and nothing is shown. The system's own dialog at registration is the only dialog a server's address appears in, and its words are the app's. Proof: `client.test.ts`, `aiMcpGate.test.ts` ("a server that asks the user for something…").

**8. Does a stored approval survive what it should not?**
An approval and a vault's choice are bound to the registration (address or command line). A server registered anew under an old id is new everywhere. A damaged record reads as "never approved"; a damaged vault entry switches a server off. Records live in the app's data, never in the vault. Proof: `mcpStores.test.ts`, `mcpRuntime.test.ts` ("holds an approval to the registration…").

**9. Can the web view get a token, or decide where one goes?**
No path was found. A sign-in is OAuth 2.1 with PKCE. The native side makes the verifier and the state, checks what the browser came back with, exchanges the code, keeps the tokens, renews them and puts the access token into requests to the registered address; no command answers with a token, a verifier or an endpoint. The endpoints a code and a token are sent to come from a document the native side fetched itself — from an address on the authorization server's own origin under `/.well-known/`, whose `issuer` is the one it was asked as — so the web view cannot pair a real authorization endpoint with a token endpoint of its own. Who answered is checked against who was asked (RFC 9207) before anything of the answer is used, an error included; a sign-in that was begun is used once. A token is asked for the registered address or the part of it the server names as itself, and is sent there only; a sign-in and a stored token replace each other, and removing or re-registering a server forgets both. Addresses a server names are asked only if they are on its own host or public (https, default port, public addresses); no redirect is followed. Proof: `oauthRules.test.ts` and its three mirrors (`oauth.rs`, `AiMcpOAuthRulesTest.java`, `AiMcpOAuthRulesTests.swift`), `oauth.test.ts`, `aiMcpSignIn.test.ts` ("keeps everything a token is or could be had with on the native side"), `aiMcpBoundary.test.ts`.
*Limits:* (a) what the browser comes back with passes through the web view: it sees the code and the state. A code cannot be redeemed without the verifier — unless an authorization server says it does PKCE and does not; Plainva refuses the ones that do not even say so, and can do no more. (b) The web view reads the server's description and so chooses which authorization server is asked: a web view that was taken over can make the browser open at a sign-in page of its choosing. It could open any page before; what it cannot have is the token of the real one. (c) A server names its own authorization server — that is the protocol. Plainva shows the host before the browser opens, and the browser shows where the user is. (d) iOS cannot connect to exactly the addresses it checked; it checks before the request and again where the answer came from.

**10. Can a yes to reading become a yes to changing?**
No path was found. A tool may be ticked whatever it says it does; the tick records what it said — reads, may change, or may change, overwrite or delete, where a tool that says nothing counts as the last — and a call is held to that. A tool whose claim grew reaches a vault only through a new approval of the changed listing (question 1), and then shows unticked with the reason; a stored grant allows more than reading only by one of two fixed words and only for a ticked tool. A call of a tool that does not only read passes questions 3 and 4 unchanged and is asked under a heading of its own, with the sentence that Plainva cannot undo it and without an obvious button for "yes". Proof: `mcp.test.ts` ("reads what a tool says it can do at its service the cautious way round", "a tick covers what the tool said it does when it was ticked…", "a stored grant allows a tool more than reading only by one of the two words…"), `offer.test.ts`, `externalTools.test.ts`, `mcpTools.test.ts`, `aiMcpSession.test.ts` ("a tool that may change something there is found only once it is ticked for it…"), `AiExternalSurfaces.test.tsx`, `ExternalToolsDialogs.test.tsx`.
*Limits:* (a) the declaration is a claim. A tool that says it only reads and deletes on its own side is asked about in the ordinary words; what protects there is what protected before — the look at the tool, its description and the arguments. (b) What a tool changed at its service is not Plainva's to undo, to list or to show afterwards; the vault's log names the call and how it ended, never what was said. (c) A model can be talked into asking for such a call by a note, a page or another server's result. It cannot be talked past the question, and the question shows the arguments in full.

## Found by the review, and changed

| Finding | Change |
|---|---|
| An opening several callers waited for was cancelled for all of them when one gave up — a closed review dialog could fail a conversation's call with "cancelled" | the opening is shared work now (`shareMcpWork`): a caller's signal ends that caller's wait, and the work is called off only when the last one has gone |
| A program started for a review kept running until the vault closed | a connection nobody used for ten minutes is ended (`MCP_IDLE_MS`) |
| The question about a call had an id of its own, so the step it stood for showed as running beside it | the question carries the call's id, like every other question about a call |
| A step of an earlier run lost its name ("External tool") when its server was switched off or blocked later | labels come from the approved snapshot, whatever the server's standing |
| The text for one part left out of a result was ungrammatical model-facing English | rewritten |
| A sign-in's token would not have fitted an entry of the Windows credential store (2,560 bytes) | a long value is kept in parts, and the longest token fits the parts there are (a compile-time assertion) |
| A lifetime no whole number holds (`expires_in: 1e300`) would have ended the iOS app | capped before it is converted, on every platform; a case of the shared list |
| The account sign-ins' loopback listener reported a provider's error as a failure without its `state` and `iss` | a caller that asks is told who answered even for an error (`report_errors`); what every account sign-in gets is unchanged |

## Residual risks, accepted and written down

- **Approved hostile text.** The user can approve a description that is an attack. Mitigations are structural (questions 3, 4), not preventive.
- **The freshness window.** A server's own promise that its lists are fresh is believed for at most five minutes. Within it a changed listing is not noticed. What a model reads still comes from the snapshot, and every call is still asked; what a server *does* with a call was never visible to a listing anyway.
- **Behaviour is not text.** A pin covers what a server says, not what it does. A tool that claims to only read can do anything on its own side with what it is sent. The grant of folders and the look at the arguments are the control.
- **A program is the user's code execution.** A stdio server runs with the user's rights unless the sandbox holds, and on Windows there is none. The command line is shown natively in full; a command that starts a shell is pointed out and not forbidden.
- **A token is as strong as the server.** A fixed token the user stores is sent to the registered address on every request, whatever it allows. A sign-in's token is made out to this one server and for the scopes the server asked for; what the server does with it on its own side is not Plainva's to see.
- **The way back on a computer is a local port.** Any program on this computer can send something to it while a sign-in waits. A forged answer is told apart by its state and ends that attempt; it cannot produce a token.
- **Plainva's description as a client is a document on the project's website.** Whoever can change it can add ways back for "Plainva" at authorization servers that read it. It lists four, and a test pins them.
- **A sign-in is not revoked at the server.** Signing out forgets the tokens on this device; the authorization server is not asked to end them.
- **Volume.** Nothing limits how often a model may ask to call; the user's patience is the limit, and the vault's log shows the count.

## Not verified

- No **real** MCP server was at the other end of any test: the protocol client has only met the scripted server of this repository. Interoperability with deployed servers is unproven.
- **iOS:** `AiMcpPlugin.swift`, `AiMcpAuthPlugin.swift` and their rules compile only in the iOS workflows; this review has not seen them run.
- **A real sign-in:** every test signs in to the scripted authorization server of this repository. The round trip through a browser, the port on this computer and the app's own address as a way back have run on no device, and no deployed authorization server has met this client.
- **Sandbox:** `sandbox-exec` (macOS) and `bwrap` (Linux) were not exercised on those systems by this review; the self-test decides at run time whether "in a sandbox" is said.
- **On a device:** the native dialogs, the keychain slots and the start of a program have run in no build a person used.
- **An independent review** has not taken place.
