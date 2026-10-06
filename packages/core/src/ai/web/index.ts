/**
 * The AI's way onto the internet (plan §17.1, ADR 0019, threat T2): where a
 * request may go, what a fetched page is to a reader, the quarantined calls
 * that read pages and search — everything that can be decided without a
 * network, as functions with tests. The request itself is made natively.
 */
export * from "./rules.js";
export * from "./extract.js";
export * from "./fetch.js";
export * from "./processor.js";
export * from "./search.js";
export * from "./provenance.js";
