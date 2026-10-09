# ADR 0021: Local inference, embeddings and platform models

Status: Accepted

Date: 2026-09-24 (decisions 3 and 4 revised 2026-09-30 after the embedding spike)

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
3. **Embeddings: native ONNX Runtime behind one interface** (revised
   2026-09-30). The spike ran the candidates on 308 notes (the AI test vault
   and the user guide in ten languages, 5,675 chunks) against 90 questions:
   full text found the right note among the first five for 62 % of them and
   for none of the Japanese and Chinese ones; Granite Embedding Multilingual
   R2 97M for 80 % alone and 88 % fused with full text, the 311M model for
   86 % and 93 %. In a WebView a single thread embeds 0.8–0.9 chunks per
   second (1.5–1.7 hours for 5,000 chunks); more threads need cross-origin
   isolation, which the Android WebView cannot have and WebKit only with
   `require-corp`, and WebGPU was slower than WASM on the reference laptop.
   The native runtime embeds 6.7 chunks per second there. So every shell
   runs the official ONNX Runtime packages (desktop: the Rust `ort` crate
   loading Microsoft's library; Android: the Maven package; iOS: the
   xcframework) behind one interface — `OnnxEmbeddingRunner`: load a model,
   run a padded batch, return pooled vectors — while tokenizing stays in
   TypeScript for all shells (`@huggingface/tokenizers`). Model packs are
   catalog data pinned by commit, size and SHA-256
   (`packages/core/src/ai/embeddings/catalog.ts`); any other model is
   reachable through the user's own provider, behind the same
   `EmbeddingEngine` seam.
4. **Vectors in the existing index database** (revised 2026-09-30).
   Feature-owned tables in the per-vault SQLite (`ai_embedding_engine`,
   `ai_embedding_note`, `ai_embedding`), one vector space per engine — model
   and revision, so a new revision never mixes with the old one. Vectors are
   int8 with one scale each (a quarter of `Float32Array`, ranking unchanged in
   the spike) and stored as base64 text, because neither SQL bridge binds a
   BLOB. Notes are cut into heading sections of at most 1,200 budget units,
   led by title and heading chain (characters of scripts without spaces
   count three, so no chunk runs past the model's 512 tokens); a chunk's hash
   is its text's, so an edit re-embeds only the chunks it touched. Search is
   brute force over an in-memory int8 matrix in TypeScript, fused with full
   text by reciprocal rank. Trigger for `sqlite-vec`: measured retrieval
   latency above 100 ms p95 on real vaults. Raw vectors never leave the
   device, not even through MCP, and are not synced.
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

- **Transformers.js in a web worker for all shells** (this ADR's first
  choice). Rejected by the spike's numbers: one thread in a WebView takes
  hours for a vault, and the threads that would fix it need cross-origin
  isolation the phone WebViews cannot give.

## Links

- ADR 0017, ADR 0018; `packages/core/src/ai/embeddings/`;
  `packages/core/src/db/Schema.ts`; `db_batch.rs`.
- [ADR 0030](0030-ai-fully-local-and-models-on-this-device.md): the fully local mode as one switch with one
  promise, and what a user states about a model on a server of this device.
