# ADR 0024: The MCP client — foreign servers approved by content, used per vault, asked per call

Status: Accepted

Date: 2026-10-07

## Context

[ADR 0022](0022-mcp-server-without-a-network-port.md) decided both directions of MCP in outline and built the first: Plainva as a server for AI apps on the same computer. This ADR records the second as it was built — Plainva's assistant using tools and prompts of servers the user connects — and replaces §8–10 of ADR 0022 where the two differ.

A foreign server is somebody else's program or service. It speaks to a model through four channels — its instructions, its tool descriptions, its prompts and its results — and every call hands it data. The incident that shaped the design: a server answered three calls honestly and then rewrote its tool list and a prompt, so that the agent went looking for credentials (Pillar Security, 2026-08-12).

Three constraints came from the rest of the harness. Keys and addresses never live in the WebView ([ADR 0017](0017-ai-harness-architecture-and-native-boundary.md)). A conversation's tool list is fixed when it starts, and everything else is reached through the tool search ([ADR 0019](0019-ai-tools-risk-classes-and-approvals.md)). And nothing becomes active by arriving: an approval is per device, bound to content, and stored outside the vault ([ADR 0020](0020-ai-skills-memory-and-script-skills.md)).

## Decision

1. **An own protocol client, behind native ports.** The protocol — both generations, the stateless revision of 2026-07-28 and the earlier ones with a handshake — is a thin client in `packages/core/src/ai/mcp/`. It never opens a socket or starts a process: requests and programs are two ports the shells implement natively. This replaces "the official TypeScript SDK" of ADR 0022 §8. The SDK would have put the transport, the address and the credentials into the WebView and brought capabilities Plainva deliberately does not offer; the part of the protocol a client needs that offers a server nothing is small enough to own and to test against a scripted server.

2. **Plainva offers a server nothing.** No roots, no sampling, no logging, no elicitation, no subscription stream. A server that asks the user for something gets an error and no dialog. A list is loaded again before a use instead of being pushed.

3. **Three places for three decisions.**
   - *Native, per device:* where a request goes or what is started, and the credentials. A server is registered only through the system's own dialog, which shows the address or the whole command line; afterwards the WebView names it by an id.
   - *App data, per device:* the user's name for the server, the approved listing and its pin.
   - *App data, per vault:* whether the vault uses the server, which tools it granted, which folders it allowed, and a log of calls.
   Nothing is stored in the vault. An approval and a vault's choice are bound to the registration; a server registered anew under the same id is new everywhere.

4. **An approval covers texts, and is checked before every use.** The pin of ADR 0022 §9 is enforced at two points: the review, and a reload before each call or prompt (a server's own freshness hint counts for at most five minutes). Any difference blocks the server until the user looks again; flipping back does not unblock. What a conversation reads of a server comes from the approved snapshot, never from a connection.

5. **Foreign tools are never a provider's tools.** They are names in the conversation's list of further tools (`mcp_<server>_<tool>`, the server id chosen by the user), found through the tool search and called through the dispatcher. What the search says of them is built from the snapshot and stands in the untrusted-data block. A server's `instructions` are shown at the review and go to no model.

6. **One call, decided in the order of trust.** The server and the tool as they stand now; the listing against the pin; everything the conversation has read from the vault against the folders the vault allowed this server — none by default — and against the privacy gate, where every foreign server is a cloud recipient, a local program included; and last the user, who sees the server, the tool and the arguments in full. A yes is for one call. There is no "always".

7. **Only reading, for now.** A tool that does not declare itself read-only is not offered. The declaration is the server's own claim: necessary, never sufficient. Writing through a foreign server opens, if at all, with the approval chain of ADR 0019.

8. **Nobody's conversation gets none.** A conversation bound to a skill, a door, a regression run and the system's own model reach no foreign tool.

9. **Prompts are the user's step.** A prompt is started by the user from an empty conversation. An expansion nobody approved is shown in full and pinned when it is sent; the same one goes directly afterwards; another one blocks the server.

10. **Programs only on the desktop, without a shell.** A stdio server is started from the registry's entry, with a short environment, in a sandbox where a self-test on this computer says it holds, and it ends with the app or after ten minutes without use. A phone starts no programs.

## Consequences

- The protocol client is Plainva's to maintain: a new revision of the specification is work in `wire.ts` and its neighbours, with the scripted server as the test bed.
- A user answers a question for every call. That is the price of not having an "always", and it is why looking for tools asks nothing.
- A conversation that has read notes outside a server's folders cannot use that server at all, until the user allows the folders or starts a new conversation. The refusal says so.
- Servers that need a sign-in work only with a token the user stores. OAuth for remote servers (ADR 0022 §10: PKCE, issuer and audience checks, client metadata documents) is the next part; it needs a client metadata document under an https address of the project.
- Three native implementations hold one contract. A source-level test keeps them aligned; only CI compiles all three.

## Alternatives

- **The official SDK in the WebView.** Rejected: see decision 1.
- **Foreign tools in the provider's tool list.** Rejected: a tool list is part of every request, so a description a server controls would sit beside the system prompt in every turn, and adding a server would change the cache key and the approved scope of every conversation.
- **Approve a server once, by its address.** Rejected: an address says who answers, not what they say. The incident above was a server whose address never changed.
- **"Always allow" per tool.** Rejected for now: with private notes in a conversation and a stranger's text in the same run, a standing approval for a way out is the third leg of the Rule of Two.
- **Check only the paths that appear in the arguments.** Rejected: arguments are text a model wrote, and a model can write anything it has read into them. What counts is what the conversation could carry.

## Deferred, and why

- **Elicitation** (a server asking the user). A server that may put its own words into Plainva's dialogs has a phishing channel; this needs a design of its own, with the approval chain.
- **Skills offered by a server.** They would go through the content-bound approval of ADR 0020; nothing reads the extension yet.
- **A stream of notifications.** Reloading before use covers the security case; a stream is an optimisation.
- **OAuth.** See Consequences.

## Links

- [MCP client architecture](../engineering/MCP_Client_Architecture.md), [MCP client security review](../engineering/MCP_Client_Security_Review.md), [AI threat model](../engineering/AI_Threat_Model.md) T10, T25–T28.
- ADR 0017, 0018, 0019, 0020, 0022; MCP specification 2026-07-28 and 2025-11-25.
