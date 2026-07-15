import { parseDocument, Document, YAMLMap, isMap, isScalar, isSeq } from "yaml";
import { OKF_VERSION } from "./metadata.js";

/**
 * Surgical frontmatter edits: unlike updateFrontmatterString (which replaces
 * the whole frontmatter map from a props object), these helpers touch only the
 * keys they are asked to touch. Untouched keys keep their order, formatting
 * and YAML comments; the markdown body is preserved byte-for-byte. This is the
 * only write path allowed for bulk operations over files the user never
 * opened (OKF conversion), where silent reformatting would be unacceptable.
 */

/** Raised when a document cannot be edited safely (caller should skip the file). */
export class FrontmatterSurgicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterSurgicalError";
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

interface SplitDocument {
  doc: Document;
  body: string;
  hadFrontmatter: boolean;
  eol: string;
}

function splitDocument(content: string): SplitDocument {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const match = content.match(FRONTMATTER_RE);

  if (!match) {
    const doc = new Document({});
    return { doc, body: content, hadFrontmatter: false, eol };
  }

  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) {
    throw new FrontmatterSurgicalError(
      `Frontmatter is not parseable YAML: ${doc.errors[0].message}`
    );
  }
  if (doc.contents !== null && !isMap(doc.contents)) {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  }
  return { doc, body: content.slice(match[0].length), hadFrontmatter: true, eol };
}

function ensureMapContents(doc: Document): YAMLMap {
  if (doc.contents === null || doc.contents === undefined) {
    doc.contents = doc.createNode({}) as unknown as Document["contents"];
  }
  if (!isMap(doc.contents)) {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  }
  return doc.contents;
}

function joinDocument(split: SplitDocument): string {
  const { doc, eol } = split;
  let body = split.body;
  if (!body) {
    body = eol;
  }

  let yamlString = doc.toString().trim();
  yamlString = yamlString.replace(/\r?\n/g, eol);

  if (yamlString === "{}" || yamlString === "") {
    return `---${eol}---${eol}${body}`;
  }
  return `---${eol}${yamlString}${eol}---${eol}${body}`;
}

/**
 * Sets the given top-level keys (nested plain objects/arrays allowed as
 * values), leaving every other key untouched. Creates a frontmatter block at
 * the top when none exists.
 */
export function upsertFrontmatterKeys(
  content: string,
  updates: Record<string, unknown>
): string {
  const split = splitDocument(content);
  ensureMapContents(split.doc);
  for (const [key, value] of Object.entries(updates)) {
    split.doc.set(key, value);
  }
  return joinDocument(split);
}

/**
 * Sets a nested value, e.g. setFrontmatterPath(content, ["plainva", "icon"], "🚀").
 * Intermediate maps are created as needed; sibling keys stay untouched.
 */
export function setFrontmatterPath(
  content: string,
  path: readonly string[],
  value: unknown
): string {
  if (path.length === 0) {
    throw new FrontmatterSurgicalError("Path must not be empty");
  }
  const split = splitDocument(content);
  ensureMapContents(split.doc);
  split.doc.setIn(path, value);
  return joinDocument(split);
}

/**
 * Renames a tag value inside the `tags`/`tag` frontmatter key — the exact tag and
 * its children (`old/sub` -> `new/sub`) — mutating the scalar values in place so
 * the list format, order, other keys and comments are preserved. Returns the
 * content unchanged (and changed=false) when there is no parseable frontmatter or
 * no matching tag. The inline `#tag` rewrite in the body is the caller's job.
 */
export function renameFrontmatterTag(
  content: string,
  oldTag: string,
  newTag: string
): { content: string; changed: boolean } {
  const o = oldTag.replace(/^#/, "");
  const n = newTag.replace(/^#/, "");
  if (!o || !n || o === n) return { content, changed: false };
  let split: SplitDocument;
  try {
    split = splitDocument(content);
  } catch {
    return { content, changed: false };
  }
  if (!split.hadFrontmatter || !isMap(split.doc.contents)) return { content, changed: false };

  let changed = false;
  const renamed = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    if (v === o) {
      changed = true;
      return n;
    }
    if (v.startsWith(o + "/")) {
      changed = true;
      return n + v.slice(o.length);
    }
    return v;
  };

  for (const key of ["tags", "tag"]) {
    const node = split.doc.contents.get(key, true);
    if (isSeq(node)) {
      for (const item of node.items) {
        if (isScalar(item)) {
          const nv = renamed(item.value);
          if (nv !== item.value) item.value = nv;
        }
      }
    } else if (isScalar(node)) {
      const nv = renamed(node.value);
      if (nv !== node.value) node.value = nv;
    }
  }

  if (!changed) return { content, changed: false };
  return { content: joinDocument(split), changed: true };
}

/**
 * Deletes a nested key. Parent maps that become empty through this deletion
 * are removed as well (an empty `plainva:` namespace should not linger).
 * Returns the content unchanged if the path does not exist.
 */
export function deleteFrontmatterPath(content: string, path: readonly string[]): string {
  if (path.length === 0) {
    throw new FrontmatterSurgicalError("Path must not be empty");
  }
  const split = splitDocument(content);
  if (!split.hadFrontmatter || split.doc.contents === null) {
    return content;
  }
  ensureMapContents(split.doc);
  if (!split.doc.hasIn(path)) {
    return content;
  }
  split.doc.deleteIn(path);

  for (let depth = path.length - 1; depth > 0; depth--) {
    const parentPath = path.slice(0, depth);
    const parent = split.doc.getIn(parentPath);
    if (isMap(parent) && parent.items.length === 0) {
      split.doc.deleteIn(parentPath);
    } else {
      break;
    }
  }
  return joinDocument(split);
}

/**
 * Renames a top-level key in place (position, value and attached comments are
 * kept). No-op when oldKey is absent; throws when newKey already exists.
 */
export function renameFrontmatterKey(
  content: string,
  oldKey: string,
  newKey: string
): string {
  const split = splitDocument(content);
  if (!split.hadFrontmatter || split.doc.contents === null) {
    return content;
  }
  const map = ensureMapContents(split.doc);

  const pair = map.items.find(
    (item) => (item.key as { value?: unknown } | null)?.value === oldKey
  );
  if (!pair) {
    return content;
  }
  if (map.items.some((item) => (item.key as { value?: unknown } | null)?.value === newKey)) {
    throw new FrontmatterSurgicalError(
      `Cannot rename '${oldKey}' to '${newKey}': target key already exists`
    );
  }
  const newKeyNode = split.doc.createNode(newKey);
  const oldKeyNode = pair.key as { commentBefore?: string | null; comment?: string | null };
  (newKeyNode as { commentBefore?: string | null }).commentBefore = oldKeyNode.commentBefore;
  (newKeyNode as { comment?: string | null }).comment = oldKeyNode.comment;
  pair.key = newKeyNode;
  return joinDocument(split);
}

export interface FrontmatterLinkRename {
  /** Frontmatter key to inspect (from links.property_key). */
  key: string;
  /** Anchor-free link base to replace, as stored in links.target_path. */
  oldTarget: string;
  newTarget: string;
}

const WHOLE_WIKILINK_RE = /^\s*\[\[([^[\]]+)\]\]\s*$/;

/** Split a wiki-link inner text into base, anchor (leading #/^) and alias (leading |). */
function splitWikiInner(inner: string): { base: string; anchor: string; alias: string } {
  const pipeIdx = inner.indexOf("|");
  const targetRaw = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
  const alias = pipeIdx === -1 ? "" : inner.slice(pipeIdx);
  const trimmed = targetRaw.trim();
  const hashIdx = trimmed.indexOf("#");
  const caretIdx = trimmed.indexOf("^");
  let anchorIdx = -1;
  if (hashIdx !== -1 && caretIdx !== -1) anchorIdx = Math.min(hashIdx, caretIdx);
  else if (hashIdx !== -1) anchorIdx = hashIdx;
  else if (caretIdx !== -1) anchorIdx = caretIdx;
  if (anchorIdx !== -1) {
    return { base: trimmed.slice(0, anchorIdx).trim(), anchor: trimmed.slice(anchorIdx).trim(), alias };
  }
  return { base: trimmed, anchor: "", alias };
}

/**
 * Rewrites whole-value wiki links (`"[[T]]"`, `"[[T#a|alias]]"`) in the given
 * frontmatter keys — scalar string values and string items of sequences —
 * preserving anchors, aliases, each scalar's quoting style, YAML comments, key
 * order and the body byte-for-byte. Only the listed keys are inspected;
 * missing keys and non-string items are no-ops. Malformed frontmatter throws
 * FrontmatterSurgicalError (callers keep their body-side fix, see renameNote).
 */
export function renameFrontmatterWikiLinks(
  content: string,
  renames: readonly FrontmatterLinkRename[]
): { content: string; renamed: number } {
  if (renames.length === 0) return { content, renamed: 0 };
  const split = splitDocument(content);
  if (!split.hadFrontmatter || split.doc.contents === null) return { content, renamed: 0 };
  const map = ensureMapContents(split.doc);

  const byKey = new Map<string, Map<string, string>>();
  for (const r of renames) {
    if (!byKey.has(r.key)) byKey.set(r.key, new Map());
    byKey.get(r.key)!.set(r.oldTarget, r.newTarget);
  }

  let renamed = 0;
  const rewriteScalar = (node: unknown, targets: Map<string, string>) => {
    if (!isScalar(node) || typeof node.value !== "string") return;
    const match = WHOLE_WIKILINK_RE.exec(node.value);
    if (!match) return;
    const { base, anchor, alias } = splitWikiInner(match[1]);
    const next = targets.get(base);
    if (next === undefined || next === base) return;
    // In-place value swap keeps the scalar's quoting style and comments.
    node.value = `[[${next}${anchor}${alias}]]`;
    renamed++;
  };

  for (const [key, targets] of byKey) {
    const value = map.get(key, true);
    if (value == null) continue;
    if (isSeq(value)) {
      for (const item of value.items) rewriteScalar(item, targets);
    } else {
      rewriteScalar(value, targets);
    }
  }

  if (renamed === 0) return { content, renamed: 0 };
  return { content: joinDocument(split), renamed };
}

export interface EnsureOkfFrontmatterOptions {
  /** OKF type to set when the document has none (or only a blank string). */
  type: string;
  /** Spec version to record; defaults to the version Plainva targets. */
  okfVersion?: string;
}

export interface EnsureOkfFrontmatterResult {
  content: string;
  changed: boolean;
  setType: boolean;
  setOkfVersion: boolean;
}

/**
 * Guarantees OKF minimum frontmatter (`type` + `okf_version`) on a document.
 * Existing non-blank `type` values are always kept — they are valid OKF types
 * by definition (free string). A non-string `type` is left untouched here;
 * resolving it (rename) is an explicit, user-driven conversion step.
 */
export function ensureOkfFrontmatter(
  content: string,
  options: EnsureOkfFrontmatterOptions
): EnsureOkfFrontmatterResult {
  const okfVersion = options.okfVersion ?? OKF_VERSION;
  const split = splitDocument(content);
  const map = ensureMapContents(split.doc);

  const existingType = map.has("type") ? split.doc.get("type") : undefined;
  const typeIsBlank =
    existingType === undefined ||
    existingType === null ||
    (typeof existingType === "string" && existingType.trim() === "");
  const setType = typeIsBlank;
  if (setType) {
    split.doc.set("type", options.type);
  }

  const setOkfVersion = !map.has("okf_version");
  if (setOkfVersion) {
    split.doc.set("okf_version", okfVersion);
  }

  if (!setType && !setOkfVersion) {
    return { content, changed: false, setType, setOkfVersion };
  }
  return { content: joinDocument(split), changed: true, setType, setOkfVersion };
}
