import { chunkNote } from "@plainva/core";
import { markdownToPlainText } from "../lib/markdownToPlainText";

/**
 * Related notes as both shells show them (plan KI-Harness P2b-4, mockup
 * chapter 11): the answer for one note, the pair of sections that says why,
 * and the words for it. The vectors and the reader's word live in the
 * controller (`LocalEmbeddings.related`); this is what a surface needs.
 */

/** A section of a pair: where it is and how it starts. */
export interface RelatedSection {
  /** The heading chain, " › " between the levels; "" before the first heading. */
  chain: string;
  /** 1-based line where the section's text starts (the editors' line numbers). */
  line: number;
  /** That line's text, for the read view, which has no lines. */
  lineText: string;
  /** The start of the section's text as plain text, one line, cut at a word. */
  excerpt: string;
}

export interface RelatedNote {
  path: string;
  title: string;
  /** How far it stands out of the note's neighbourhood (robust deviations). */
  prominence: number;
  /** The pair: this note's section and the hint's. */
  from: RelatedSection;
  to: RelatedSection;
  /** Notes both link to. */
  shared: { path: string; title: string }[];
}

/**
 * What a surface shows for one note: nothing to compute with (search by
 * meaning off or not ready, the setting off), the vault or the note paused,
 * the note's vectors not current yet, or the hints — possibly none.
 */
export type RelatedAnswer =
  | { kind: "off" }
  | { kind: "vaultPaused" }
  | { kind: "paused" }
  | { kind: "pending" }
  | { kind: "hints"; hints: RelatedNote[] };

/** Where a jump from a hint lands: the note and the line, the line's text for the read view. */
export interface RelatedJump {
  path: string;
  line: number;
  term: string;
}

type T = (key: string, options?: Record<string, unknown>) => string;

const EXCERPT_CHARS = 110;
/** From here on a hint is "very close in meaning". */
const VERY_CLOSE = 6;

/** Plain text on one line, cut at a word. */
export function relatedExcerpt(markdown: string, max = EXCERPT_CHARS): string {
  const flat = markdownToPlainText(markdown).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.lastIndexOf(" ", max);
  return `${flat.slice(0, cut > max * 0.6 ? cut : max).trimEnd()} …`;
}

/** The section a stored vector was computed from, cut the way the pipeline cuts (`chunkNote`). */
export function relatedSection(content: string, ordinal: number): RelatedSection {
  const chunk = chunkNote("", content).find((c) => c.ordinal === ordinal);
  if (!chunk || chunk.to <= chunk.from) return { chain: "", line: 1, lineText: "", excerpt: "" };
  return {
    chain: chunk.chain.split(" > ").join(" › "),
    line: content.slice(0, chunk.from).split("\n").length,
    lineText: content.slice(chunk.from).split("\n", 1)[0]!.trim(),
    excerpt: relatedExcerpt(content.slice(chunk.from, chunk.to)),
  };
}

const chainOr = (t: T, chain: string) => chain || t("ai.related.start");

/** "Production ↔ Shooting days › Split", with the links both notes set. */
export function relatedPairLine(t: T, hint: RelatedNote): string {
  const pair = t("ai.related.pair", { from: chainOr(t, hint.from.chain), to: chainOr(t, hint.to.chain) });
  const first = hint.shared[0];
  if (!first) return pair;
  const shared = hint.shared.length > 1 ? t("ai.related.sharedMore", { link: first.title, count: hint.shared.length - 1 }) : t("ai.related.shared", { link: first.title });
  return `${pair} · ${shared}`;
}

export function relatedFromLine(t: T, hint: RelatedNote): string {
  return t("ai.related.fromSection", { section: chainOr(t, hint.from.chain), text: hint.from.excerpt });
}

export function relatedToLine(t: T, hint: RelatedNote): string {
  return t("ai.related.toSection", { title: hint.title, section: chainOr(t, hint.to.chain), text: hint.to.excerpt });
}

/** "very close in meaning · not linked yet · computed on this device". */
export function relatedFactsLine(t: T, hint: RelatedNote): string {
  return [hint.prominence >= VERY_CLOSE ? t("ai.related.veryClose") : t("ai.related.close"), t("ai.related.notLinked"), t("ai.related.onDevice")].join(" · ");
}

/** A state's line where a surface shows it (the phone's tab, a paused note in the sidebar); null for hints. */
export function relatedStateLine(t: T, answer: RelatedAnswer): string | null {
  switch (answer.kind) {
    case "off":
      return t("ai.related.off");
    case "vaultPaused":
      return t("ai.related.vaultPaused");
    case "paused":
      return t("ai.related.notePaused");
    case "pending":
      return t("ai.related.pending");
    case "hints":
      return answer.hints.length ? null : t("ai.related.none");
  }
}
