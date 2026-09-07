/**
 * Grouping model of the backlinks panel: the query returns one row per link
 * occurrence, the panel shows one row per linking FILE with an occurrence
 * count (maintainer request 2026-07-04 — repeated links no longer duplicate).
 * Shared with the phone since the Build-91 feedback round (P7), where each
 * occurrence also carries its line and its outline context.
 */
export { groupBacklinks, backlinkContexts, contextChain, type BacklinkOccurrence, type GroupedBacklink, type BacklinkContext } from "@plainva/ui";
