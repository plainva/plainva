/**
 * Local embeddings (plan KI-Harness §10, P2a; ADR 0021): the model catalog,
 * notes as chunks, the tokenizer, the engine seam to the native runtime, the
 * vector store in the index database, search by meaning, and the pipeline
 * that keeps the vectors in step with the notes.
 */
export * from "./catalog.js";
export * from "./chunks.js";
export * from "./vectors.js";
export * from "./tokenizer.js";
export * from "./engine.js";
export * from "./store.js";
export * from "./search.js";
export * from "./pipeline.js";
export * from "./schedule.js";
