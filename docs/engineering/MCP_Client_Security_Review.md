# MCP client security review

Last reviewed: 2026-10-07

Status: **internal review, by the people who built it — not an independent one.** It records what was looked at, what was found and changed, what holds and by which proof, and what nobody has checked yet. It replaces no outside review; where it says "holds", it means "holds in the tests named", not "cannot be broken".

Scope: Plainva as an MCP **client** — the assistant using tools and prompts of servers the user connects ([architecture](MCP_Client_Architecture.md), [ADR 0024](../adr/0024-mcp-client-foreign-servers.md), threat model T10 and T25–T28 in [AI_Threat_Model.md](AI_Threat_Model.md)). Plainva as an MCP server is ADR 0022 and not part of this review.

## What was reviewed

| Layer | Code | How |
|---|---|---|
| The rules | `packages/core/src/ai/mcp/` — `listing`, `pin`, `names`, `grants`, `results`, `offer`, `schemaView`, `headerValues` | read line by line against the specification of 2026-07-28 and the earlier revisions; unit tests |
| The protocol client | `wire`, `httpWire`, `stdioWire`, `client` | read; tests against a scripted server in both generations over both ports |
| The native side | `apps/desktop/src-tauri/src/mcp_client/`, `AiMcpPlugin.java`, `AiMcpPlugin.swift` and their rule files | read; Rust and Java unit tests; a source-level contract test over all three (`aiMcpBoundary.test.ts`) |
| Stores, session, call | `packages/ui/src/ai/mcpStores.ts`, `mcpRuntime.ts`, `mcpSession.ts`, `mcpTools.ts`, the wiring in `aiSession.ts` | read; unit tests; the gate's cases against the whole session (`aiMcpGate.test.ts`) |
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

## Found by the review, and changed

| Finding | Change |
|---|---|
| An opening several callers waited for was cancelled for all of them when one gave up — a closed review dialog could fail a conversation's call with "cancelled" | the opening is shared work now (`shareMcpWork`): a caller's signal ends that caller's wait, and the work is called off only when the last one has gone |
| A program started for a review kept running until the vault closed | a connection nobody used for ten minutes is ended (`MCP_IDLE_MS`) |
| The question about a call had an id of its own, so the step it stood for showed as running beside it | the question carries the call's id, like every other question about a call |
| A step of an earlier run lost its name ("External tool") when its server was switched off or blocked later | labels come from the approved snapshot, whatever the server's standing |
| The text for one part left out of a result was ungrammatical model-facing English | rewritten |

## Residual risks, accepted and written down

- **Approved hostile text.** The user can approve a description that is an attack. Mitigations are structural (questions 3, 4), not preventive.
- **The freshness window.** A server's own promise that its lists are fresh is believed for at most five minutes. Within it a changed listing is not noticed. What a model reads still comes from the snapshot, and every call is still asked; what a server *does* with a call was never visible to a listing anyway.
- **Behaviour is not text.** A pin covers what a server says, not what it does. A tool that claims to only read can do anything on its own side with what it is sent. The grant of folders and the look at the arguments are the control.
- **A program is the user's code execution.** A stdio server runs with the user's rights unless the sandbox holds, and on Windows there is none. The command line is shown natively in full; a command that starts a shell is pointed out and not forbidden.
- **A token is as strong as the server.** A static bearer token the user stores is sent to the registered address on every request. Tokens bound to audience and scope come with OAuth, which is not built yet.
- **Volume.** Nothing limits how often a model may ask to call; the user's patience is the limit, and the vault's log shows the count.

## Not verified

- No **real** MCP server was at the other end of any test: the protocol client has only met the scripted server of this repository. Interoperability with deployed servers is unproven.
- **iOS:** `AiMcpPlugin.swift` and its rules compile only in the iOS workflows; this review has not seen it run.
- **Sandbox:** `sandbox-exec` (macOS) and `bwrap` (Linux) were not exercised on those systems by this review; the self-test decides at run time whether "in a sandbox" is said.
- **On a device:** the native dialogs, the keychain slots and the start of a program have run in no build a person used.
- **An independent review** has not taken place.
