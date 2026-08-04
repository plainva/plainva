/**
 * Moved to `@plainva/ui` (S33): the store is a plain `IVaultAdapter` reader —
 * nothing about pins, focus depth or the map overlay is desktop-specific, and
 * the phone needed exactly the same three. Re-exported here so the existing
 * call sites keep their import path.
 */
export { GraphStateStore, getGraphState, suggestionKey, type GraphPin } from "@plainva/ui";
