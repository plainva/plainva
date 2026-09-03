import type { AnchorHighlight } from "../components/anchorHighlight";

/**
 * Comment anchors in the RENDERED read view (Sammelplan C28, from Stufe E).
 *
 * The editor tints a range with a CodeMirror mark and lets a widget draw a
 * frame; the read view is a hast tree rendered by react-markdown and knew
 * nothing of anchors — not the tint, not the frame, not the marked region of
 * a picture. This is the same set of three, applied to the tree before it is
 * rendered: text nodes are split and wrapped in `<mark>` where a highlight
 * overlaps them, table cells and pictures under a highlight carry the frame
 * classes, and a picture's marked regions travel as data for the renderer to
 * lay over the image. Offsets come straight from the markdown source, which
 * remark keeps on every node — the same offsets the editor's anchors use.
 *
 * Pure: takes the tree and the highlights, touches nothing else, so it can be
 * pinned without a renderer.
 */

export const READ_ANCHOR_CLASS = "pv-read-anchor";
export const READ_ANCHOR_ACTIVE_CLASS = "pv-read-anchor--active";
export const READ_ANCHOR_FRAME_CLASS = "pv-read-anchor-frame";
export const READ_ANCHOR_FRAME_ACTIVE_CLASS = "pv-read-anchor-frame--active";
/** An open suggestion in the read view (K5): struck passage, inserted proposal. */
export const READ_SUGGESTION_DEL_CLASS = "pv-read-suggestion-del";
export const READ_SUGGESTION_INS_CLASS = "pv-read-suggestion-ins";

/** The subset of hast this needs. */
export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

export interface ReadAnchorRegion {
  commentId: string;
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FRAMED_TAGS = new Set(["td", "th", "img"]);

function overlaps(a: { from: number; to: number }, from: number, to: number): boolean {
  return a.from < to && a.to > from;
}

function addClass(node: HastNode, ...classes: string[]): void {
  const props = (node.properties ??= {});
  const existing = props.className;
  const list = Array.isArray(existing) ? [...existing] : typeof existing === "string" ? existing.split(/\s+/).filter(Boolean) : [];
  for (const c of classes) if (!list.includes(c)) list.push(c);
  props.className = list;
}

/**
 * Splits one text node at the highlight boundaries. A character is marked when
 * any highlight covers it; the strongest highlight (active over quiet) decides
 * the class, the first covering one decides the comment the click opens.
 */
function splitText(node: HastNode, highlights: readonly AnchorHighlight[]): HastNode[] {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  const text = node.value ?? "";
  if (start === undefined || end === undefined || text.length === 0) return [node];
  // remark positions count source characters; the node's value has the same
  // length for plain text. Where it does not (entities, escapes), the marking
  // would drift — so a text whose length disagrees is left untouched rather
  // than tinted in the wrong place.
  if (end - start !== text.length) return [node];
  const covering = highlights.filter((h) => !h.frame && overlaps(h, start, end));
  if (covering.length === 0) return [node];
  const cuts = new Set<number>([0, text.length]);
  for (const h of covering) {
    cuts.add(Math.max(0, h.from - start));
    cuts.add(Math.min(text.length, h.to - start));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: HastNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const piece = text.slice(a, b);
    const here = covering.filter((h) => h.from - start < b && h.to - start > a);
    const textNode: HastNode = { type: "text", value: piece };
    if (here.length === 0) {
      out.push(textNode);
      continue;
    }
    const active = here.some((h) => h.active);
    const first = here.find((h) => h.active) ?? here[0];
    const struck = here.some((h) => h.suggestion);
    out.push({
      type: "element",
      tagName: "mark",
      properties: {
        className: [READ_ANCHOR_CLASS, ...(active ? [READ_ANCHOR_ACTIVE_CLASS] : []), ...(struck ? [READ_SUGGESTION_DEL_CLASS] : [])],
        dataCommentId: first.commentId,
      },
      children: [textNode],
    });
    // The proposal stands where the struck passage ends (K5) - once, at the
    // piece that closes the range, so a passage split by the cuts above still
    // carries exactly one insertion.
    for (const h of here) {
      if (!h.suggestion || h.suggestion.replacement.length === 0 || h.to - start !== b) continue;
      out.push({
        type: "element",
        tagName: "ins",
        properties: { className: [READ_SUGGESTION_INS_CLASS], dataCommentId: h.commentId },
        children: [{ type: "text", value: h.suggestion.replacement }],
      });
    }
  }
  return out;
}

/**
 * Walks the tree once. Returns how many marks and frames were placed, so a
 * caller (or a test) can tell "nothing to draw" from "drew nothing".
 */
export function applyReadAnchors(tree: HastNode, highlights: readonly AnchorHighlight[]): { marks: number; frames: number } {
  const counts = { marks: 0, frames: 0 };
  if (highlights.length === 0) return counts;
  const visit = (node: HastNode): void => {
    if (!node.children) return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        const pieces = splitText(child, highlights);
        counts.marks += pieces.filter((p) => p.type === "element").length;
        next.push(...pieces);
        continue;
      }
      if (child.type === "element" && child.tagName && FRAMED_TAGS.has(child.tagName)) {
        const from = child.position?.start?.offset;
        const to = child.position?.end?.offset;
        if (from !== undefined && to !== undefined) {
          const frames = highlights.filter((h) => h.frame && overlaps(h, from, to));
          if (frames.length > 0) {
            const active = frames.some((h) => h.active);
            addClass(child, READ_ANCHOR_FRAME_CLASS, ...(active ? [READ_ANCHOR_FRAME_ACTIVE_CLASS] : []));
            const props = (child.properties ??= {});
            props.dataCommentId = (frames.find((h) => h.active) ?? frames[0]).commentId;
            if (child.tagName === "img") {
              const regions: ReadAnchorRegion[] = frames
                .filter((h) => h.frame?.rect)
                .map((h) => ({ commentId: h.commentId, active: Boolean(h.active), ...h.frame!.rect! }));
              if (regions.length > 0) props.dataAnchorRegions = JSON.stringify(regions);
            }
            counts.frames += 1;
          }
        }
      }
      visit(child);
      next.push(child);
    }
    node.children = next;
  };
  visit(tree);
  return counts;
}

/** The rehype plugin form, for react-markdown's `rehypePlugins`. */
export function rehypeReadAnchors(highlights: readonly AnchorHighlight[]) {
  return () => (tree: HastNode) => {
    applyReadAnchors(tree, highlights);
  };
}

/** Parses what `applyReadAnchors` put on a picture, for the renderer. */
export function readAnchorRegions(value: unknown): ReadAnchorRegion[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ReadAnchorRegion[]) : [];
  } catch {
    return [];
  }
}
