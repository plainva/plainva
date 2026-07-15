import React from "react";
import { VaultQueryService } from "@plainva/core";

/**
 * Safe rendering for search snippets/titles (plan Suche P4): the core wraps
 * matches in char(1)/char(2) sentinels (never HTML). This module splits on the
 * sentinels and builds React nodes — note content that LOOKS like HTML
 * (`<b>`, `<script>`, …) therefore stays literal text.
 */

// Read the sentinels LAZILY (not at module top level): in the production bundle
// this module can evaluate before VaultQueryService is initialized, and a
// top-level `VaultQueryService.SNIPPET_MARK_START` read then throws and
// white-screens the whole app at startup. Module ordering differs from the dev
// server, so dev never hit it. Reading at call time is immune to the ordering.
const marks = () => ({
  START: VaultQueryService.SNIPPET_MARK_START,
  END: VaultQueryService.SNIPPET_MARK_END,
});

/** True when the string carries at least one match marker — used to tell
 *  "file name" hits (marker in the highlighted title) from content hits. */
export function hasSnippetMark(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes(marks().START);
}

/** Removes stray sentinels (defense in depth for pathological content). */
export function stripSnippetMarks(text: string): string {
  const { START, END } = marks();
  return text.split(START).join("").split(END).join("");
}

/** Sentinel-marked string -> React nodes with <mark> around the matches. */
export function renderSnippetNodes(text: string): React.ReactNode[] {
  const { START, END } = marks();
  const nodes: React.ReactNode[] = [];
  const parts = text.split(START);
  if (parts[0]) nodes.push(stripSnippetMarks(parts[0]));
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const endIdx = part.indexOf(END);
    if (endIdx === -1) {
      // Unbalanced marker — render the rest as plain text.
      if (part) nodes.push(stripSnippetMarks(part));
      continue;
    }
    const marked = part.slice(0, endIdx);
    const rest = stripSnippetMarks(part.slice(endIdx + 1));
    if (marked) {
      nodes.push(
        <mark className="pv-search-mark" key={`m${i}`}>
          {marked}
        </mark>
      );
    }
    if (rest) nodes.push(rest);
  }
  return nodes;
}
