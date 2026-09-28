# ADR 0016: AI harness architecture and the native enforcement boundary

Status: Accepted

Date: 2026-09-24

## Context

Plainva gets an AI harness: a vault assistant that answers from the user's
notes, navigates the app and proposes changes. The vault already is the memory
— notes, `.base` databases, tasks, calendar, mail, links, versions and sync
exist. The harness must select the right context, send it only where the user
agreed, and act only through Plainva's own write paths.

Three facts about the current app shape every decision below:

- The WebView holds deliberately broad rights: the fs scope is `**`
  (ADR 0007), SQL `execute` is unscoped, `http:allow-fetch` allows
  `https://**` and `http://**`, and `keychain_get(key)` takes any key (the slot
  names are documented). A capability that is only checked in TypeScript runs
  in the same trust space as the untrusted content the model reads.
- Every window runs in one process; the owner window holds all write paths
  (`windowBus.ts`, `RemoteVaultAdapter.ts`). Writes go through
  `BackupVaultAdapter` → `QueueingVaultAdapter` → `ConflictAwareVaultAdapter`.
- Suggestions already have one approval surface: the suggestion mode with
  author, word diff and apply/decline (`suggestMode.ts`, `commentActions.ts`,
  `CommentStore`), in both shells.

## Decision

1. **The vault is the memory, the model is an exchangeable engine.** Memory,
   skills, conversation notes and policy live as files in the vault
   (`.agent/`, frontmatter `plainva.ai`); indexes, gists and embeddings are
   rebuildable caches. No provider account holds state the user needs.
2. **Package split, no `packages/ai`.** Platform-neutral logic (policy
   evaluation, context package, ranking, tool manifests, prompt templates,
   provider request/stream codecs) lives in `packages/core/src/ai/`;
   presentational, provider-free UI in `packages/ui/src/ai/`
   (`sharedUiPurity.test.ts` keeps Tauri, Capacitor and providers out);
   transport, key access and DI in `apps/desktop/src/services/ai/` and
   `apps/mobile/src/services/ai/`.
3. **One native AI egress per shell.** Every cloud call of the harness runs
   through a native command — `ai_http(providerId, request)` in Rust on the
   desktop, the Capacitor plugin `AiNet` on Android and iOS. The egress
   (a) reads the provider key from the keychain or `SecureStore` by a fixed,
   purpose-bound slot and inserts it itself — the WebView never holds a
   provider key, not as a return value, event or error text;
   (b) checks the recipient against the provider allowlist and the egress
   decision — no free URL, local servers only after the user added them;
   (c) streams (SSE) and aborts on STOP;
   (d) enforces the provider rules (`store:false` and friends, ADR 0017).
   Mobile streams from the first package on; there is no "streaming later".
4. **Own thin provider adapters, no provider SDK.** Anthropic Messages,
   OpenAI (Responses and Chat Completions), Gemini `generateContent` and one
   OpenAI-compatible adapter (OpenRouter, Ollama, LM Studio, `llama-server`,
   any user endpoint) are request builders and stream decoders in
   `packages/core/src/ai/providers.ts`. Each is pinned by a conformance suite
   with fake transport: append-only history, a stable tool list, no forced
   `tool_choice`, `store:false`, no gateway model strings, no telemetry.
5. **Tools are typed and enforced at the native boundary.** Every tool has a
   manifest in `packages/core/src/ai/tools` (the shared contract of harness and
   MCP server, ADR 0018) and, where it touches files or secrets, a narrow
   native counterpart shaped like `write_file_atomic(root_id, rel_path, …)`.
   The AI surface gets no new blanket scope. Native path checks resolve
   symlinks and Windows junctions before checking and reject NUL, `..` and
   mixed separators.
6. **Writing means proposing.** A text change by the AI is a suggestion round
   with the author `plainva-ai/<model-id>` in the existing suggestion mode; a
   new note is a parked draft; deletion only through the deletion guard. There
   is no second diff or approval grammar, and undo is the version history.
7. **Free choice of provider and model.** Plainva recommends, explains terms
   and retention, and sets data-minimising defaults, but excludes no provider
   and no model. It only refuses what would break a provider's terms
   (unofficial subscription logins).
8. **Encrypted workspaces:** cloud egress is off by default for the whole
   workspace; AI suggestions there only once the sealed comment path carries
   the author field.

## Consequences

- The key never enters the WebView, so a prompt injection that runs script in
  the WebView cannot read it; it can still misuse the session, which the
  egress allowlist, the send overview and the Rule of Two bound.
- Two native implementations of the egress (Rust, Kotlin/Swift) must behave
  identically; the conformance suite runs against the shared codecs, and each
  native side gets its own transport tests.
- Own adapters mean following provider API changes ourselves. In exchange the
  request bodies are exactly what the conformance suite pins, the bundle stays
  small, and no dependency with daily releases sits on the key path.

## Alternatives

- **Vercel AI SDK 7 with an injected `fetch`.** Rejected in P0: `ai` depends
  hard on `@ai-sdk/gateway` (a bare model string routes through the Vercel AI
  Gateway), 287 releases of the 7.x line between 2026-03-05 and 2026-09-23
  put a daily-moving dependency on the key path, `ai` alone unpacks to 7.7 MB
  (about 112 KB gzipped plus about 44 KB per provider), and the conformance
  rules would have to be proven against its internals instead of our bodies.
  Re-evaluate if the adapters grow beyond what the suite can pin.
- **Provider calls from the WebView with the key in memory.** Rejected: the
  WebView is where untrusted content is rendered.
- **A Plainva relay server.** Rejected: Plainva runs no servers that see user
  content.

## Links

- Plan (maintainer workspace): AI harness plan v5, §5, §6, §11, §12.
- ADR 0007 (fs scope), ADR 0014 (encrypted workspace protocol),
  ADR 0015 (installation-local OAuth), ADR 0017–0021.
