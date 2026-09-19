import { renameFrontmatterTag } from "../frontmatter-surgical.js";
import { findInlineTagsInSource } from "../tagRule.js";

const SENTINEL = "\u0000pv-tag-probe";

/**
 * Vault-wide tag rename (B6) — pure text side, following the renameProperty
 * pattern: rewrite both the frontmatter `tags:`/`tag:` entries (format-preserving)
 * and the inline `#tag` occurrences in the body, for the exact tag and its
 * children (`old/sub` -> `new/sub`). Never touches an unrelated tag whose later
 * segment happens to be the old name (`#parent/old` stays). The caller writes the
 * changed notes back through the atomic + backup chain.
 */

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** True when a string is usable as a fresh tag name (no `#`, no whitespace). */
export function isValidTagName(name: string): boolean {
  const n = name.replace(/^#/, "").trim();
  return n.length > 0 && !/\s/.test(n);
}

export function renameTagInText(
  content: string,
  oldTag: string,
  newTag: string
): { content: string; changed: boolean } {
  const o = oldTag.replace(/^#/, "").trim();
  const n = newTag.replace(/^#/, "").trim();
  if (!o || !n || o === n) return { content, changed: false };

  // 1. Frontmatter tags — format-preserving, via the YAML document.
  const fm = renameFrontmatterTag(content, o, n);
  let out = fm.content;
  let changed = fm.changed;

  // 2. Inline `#tag` in the BODY only (a frontmatter string value that contains
  //    "#old" is not a tag and stays untouched). What counts as a tag is the
  //    index's rule (tagRule.ts): until 2026-09-19 this step had its own, which
  //    also rewrote `[[#old]]` and `[text](#old)` - links to a heading - and
  //    code. The old name must be the tag or its full first segment(s): `old`
  //    and `old/sub`, never `parent/old` and never `older`.
  const m = out.match(FRONTMATTER_RE);
  const fmPart = m ? m[0] : "";
  const body = m ? out.slice(m[0].length) : out;
  let newBody = body;
  const tags = findInlineTagsInSource(body);
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (tag.name !== o && !tag.name.startsWith(o + "/")) continue;
    const at = tag.from + 1;
    newBody = newBody.slice(0, at) + n + newBody.slice(at + o.length);
  }
  if (newBody !== body) {
    out = fmPart + newBody;
    changed = true;
  }

  return { content: out, changed };
}

/** True when the note carries the tag (exact or a `tag/sub` child), in the body
 *  or the frontmatter — used to pick the candidate notes to rewrite. */
export function contentHasTag(content: string, tag: string): boolean {
  const o = tag.replace(/^#/, "").trim();
  if (!o) return false;
  return renameTagInText(content, o, o + SENTINEL).changed;
}
