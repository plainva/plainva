# ADR 0020: Local inference, embeddings and platform models

Status: Accepted

Date: 2026-09-24

## Context

Plainva promises that sensitive areas can stay fully local and that a user
without an API key still gets useful answers. Local models are large, change
quickly and differ by device class; platform models (Apple Foundation Models,
Gemini Nano) are free but small and not available everywhere. Retrieval
quality, compaction and privacy checks benefit from local models even when
the answer itself comes from a cloud provider (the recommended hybrid mode).

## Decision

1. **No model in the app download.** Local models are optional, versioned
   model packs, offered after a device and storage check, with download,
   update, rollback and delete. The app is fully usable without any pack.
   Packs prefer Apache- or MIT-licensed weights that can be downloaded
   anonymously; the licence is named in the download dialog.
2. **Tiers.** No model (FTS, graph, recency, deterministic extraction such as
   `parse_task`) → context pack (embeddings, semantic search, clustering) →
   platform model on the device (gists, query rewrite, simple answers) →
   platform cloud (Apple Private Cloud Compute) → Local Plus (gists,
   redaction, offline answers, the quarantined processor for tier-3 content)
   → desktop power models → the user's cloud provider. Profiles (Fast,
   Balanced, Strong, Local) are updatable data; no vendor is written in as
   "the best model".
3. **Embeddings: one implementation for all shells if it holds the budgets.**
   The embedding package starts with a spike across candidates (compared on
   Plainva's own golden queries in ten languages) and runtimes —
   Transformers.js in a web worker (WebGPU with WASM fallback, detected at run
   time), `candle`, `llama-server --embedding` with mean pooling and task
   prefixes. If the web worker meets the device budgets, no native embedding
   path is built on mobile.
4. **Vectors in the existing index database.** Embedding BLOBs
   (`Float32Array`) in the per-vault SQLite, brute-force cosine in TypeScript
   or a small Rust command following the `db_batch` pattern (own short
   connection, BEGIN/COMMIT, no second SQLite driver). Trigger for
   `sqlite-vec`: measured retrieval latency above 100 ms p95 on real vaults.
   Raw vectors never leave the device, not even through MCP.
5. **Platform models behind the same egress rules.** iOS: Foundation Models
   as "Apple (on this device)" and, with Apple's managed entitlement, "Apple
   (Private Cloud Compute)" — PCC is a server with Apple's assurances, so it
   appears in the send overview as a recipient and passes the hard gate.
   Android: Gemini Nano through the ML Kit prompt API on supported devices as
   "Local Plus (system)"; elsewhere the choice stays local or cloud. Desktop:
   no platform model; the equivalent is a local server (Ollama, LM Studio,
   `llama-server`). Context size and languages are read at run time.
6. **Local generators speak the OpenAI-compatible protocol.** Desktop: a
   `llama-server` sidecar (prebuilt per architecture) or a user-run local
   server, addressed through the same adapter as Ollama and LM Studio — no FFI
   binding. Android: LiteRT-LM through a Capacitor plugin. iOS: third-party
   models through the Foundation Models `LanguageModel` protocol.
7. **Measured per device class before a pack ships:** download and disk size,
   peak and steady memory, load time, prefill and decode speed, battery and
   temperature, crash and OOM behaviour, quality of gists, redaction and tool
   JSON, offline behaviour, update and rollback, cleanup, licence texts.
8. **Transcription** in the beta goes through the user's provider with audio
   support, under the send overview, and lands as a proposal with author under
   the recording; offline transcription (platform speech recognition on
   mobile, whisper class on the desktop) comes with the local package.

## Consequences

- The app size stays as it is; the privacy promise of a fully local mode is
  real where the device can carry it, and the UI says where it cannot.
- Two platform model integrations and a desktop sidecar are three native
  surfaces; they all sit behind `LocalAIBackend` (`embed`, `rerank`,
  `summarizeStructured`, `redact`, `classifySensitivity`, `generate`,
  `tokenize`, capability and device queries, cancellation, progress, thermal
  and energy signals).

## Alternatives

- **Bundle a small model.** Rejected: hundreds of megabytes for every user,
  and a licence and update burden the app store review then carries.
- **A vector extension from day one.** Rejected until the latency trigger:
  `sqlx` loads no SQLite extensions, and a second driver or platform binaries
  cost more than brute force costs at vault sizes.

## Links

- ADR 0016, ADR 0017; `packages/core/src/db/Schema.ts`; `db_batch.rs`.
