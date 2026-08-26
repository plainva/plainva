import { parseDocument, stringify } from "yaml";
import { sha256Hex, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import type { WorkspaceCapability } from "./documents.js";
import type { WorkspaceListPage, WorkspaceObjectInfo, WorkspaceObjectStore, WorkspaceRequestOptions } from "./objectStore.js";

export type PublishedSliceAccess = "read" | "comment" | "suggest";
export type PublishedSliceMode = "exact" | "sanitized";
export type PublishedSliceProvider = "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3";

export interface PublishedSliceConfig {
  publicationId: string;
  sliceId: string;
  name: string;
  mode: PublishedSliceMode;
  access: PublishedSliceAccess;
  provider: PublishedSliceProvider;
  propertyAllowlist: string[] | null;
  privateProperties: string[];
  createdAt: string;
}

export interface PublishedSliceProjectionReport {
  removedProperties: string[];
  neutralizedLinks: string[];
  removedEmbeds: string[];
}

export interface PublishedSliceProjection {
  markdown: string;
  report: PublishedSliceProjectionReport;
}

/**
 * Capabilities granted inside an independent published-slice workspace.
 * Suggestions are append-only proposal objects and never grant write/delete
 * access to the projected source content.
 */
export function publishedSliceAccessCapabilities(access: PublishedSliceAccess): WorkspaceCapability[] {
  const capabilities: WorkspaceCapability[] = ["comment.read", "content.read", "history.read"];
  if (access === "comment" || access === "suggest") capabilities.push("comment.create");
  if (access === "suggest") capabilities.push("content.create");
  return capabilities.sort();
}

/**
 * What a published note may carry in its frontmatter (decision E5).
 *
 * Until S3 both shells passed `propertyAllowlist: null` plus the same copied
 * denylist - `["apiKey", "password", "private", "secret", "token"]` - and a
 * denylist is the wrong shape for this job: it has to guess every name a leak
 * could hide behind, and two things PLAINVA ITSELF writes defeat it without
 * containing any of those words.
 *
 * - The `plainva` namespace carries a `ProviderTaskAnchor` whose `identity` is
 *   documented as the verified account identity ("issuer:subject") of the
 *   provider account the task was mirrored from - the publisher's Google or
 *   Microsoft account, in a note that is about to be handed to strangers.
 * - OKF v0.2 `sources` carries the RFC Message-ID of the private mail a note
 *   was captured from.
 *
 * Neither is a secret by name, and neither would ever have been added to a
 * denylist by someone who had not gone looking. An allowlist inverts the
 * failure: a property nobody thought about stays home, and the cost is that a
 * deliberate custom property has to be named - which is why S3 also puts a
 * PREVIEW in front of publishing, so the removals are visible before anything
 * leaves the vault.
 *
 * `verified` is on the list although it can read `human:<name>`: a review note
 * is provenance the author wrote on purpose, and the preview shows it.
 * `sources` is deliberately NOT on the list.
 */
export const DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST: readonly string[] = [
  "aliases",
  "author",
  "category",
  "cover",
  "created",
  "date",
  "description",
  "due",
  "end",
  "generated",
  "lang",
  "language",
  "modified",
  "stale_after",
  "start",
  "status",
  "summary",
  "tags",
  "title",
  "type",
  "updated",
  "verified",
];

/**
 * Compares property names the way a human means them.
 *
 * `stale_after`, `staleAfter` and `Stale-After` are the same field to everyone
 * except a string comparison, and a policy that only matches one spelling is a
 * policy with a hole in it.
 */
export function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

function linkTarget(value: string): string {
  const target = value.split("#", 1)[0].trim().replace(/\\/g, "/");
  return target.toLowerCase().endsWith(".md") ? target.slice(0, -3) : target;
}

/**
 * The slice as a lookup instead of a list.
 *
 * The previous fallback re-materialised and re-normalised the whole slice for
 * every single link (`[...included].some(...)`), which is quadratic in a note
 * with many links. Normalising once on the way in is exactly equivalent:
 * `linkTarget` is idempotent, so the old three branches - raw hit, raw+".md"
 * hit, and the normalised scan - all collapse into one membership test.
 */
function includedIndex(paths: Iterable<string>): Set<string> {
  const index = new Set<string>();
  for (const path of paths) index.add(linkTarget(path.replace(/\\/g, "/")));
  return index;
}

function isIncluded(target: string, index: Set<string>): boolean {
  return index.has(linkTarget(target));
}

/**
 * Where fenced code blocks sit, so the projection can leave them alone.
 *
 * A link inside a fence is almost always a documented EXAMPLE, and rewriting it
 * corrupts the thing the block exists to show. The tradeoff is deliberate and
 * runs the other way for `[[Private|alias]]`: outside a fence the neutralised
 * form shows only "alias", inside one the full target stays visible. A fence is
 * a quotation, and quoting a path is not the same as linking to it.
 *
 * INDENTED code blocks are deliberately not detected: four spaces inside a list
 * item is ordinary content, and a false positive there would silently skip a
 * link that has to be neutralised. A missed example is cosmetic; a missed leak
 * is not.
 */
function fencedRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let open: { char: string; length: number; start: number } | null = null;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length + 1;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      // A backtick fence may not carry a backtick in its info string
      // (CommonMark), which keeps a prose line like "``` and `code`" from
      // opening a block that never closes.
      if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
        open = { char: fence[1][0], length: fence[1].length, start: offset };
      }
    } else if (fence && fence[1][0] === open.char && fence[1].length >= open.length && fence[2].trim() === "") {
      ranges.push([open.start, Math.min(lineEnd, markdown.length)]);
      open = null;
    }
    offset = lineEnd;
  }
  // An unterminated fence runs to the end of the file, exactly as a renderer
  // reads it.
  if (open) ranges.push([open.start, markdown.length]);
  return ranges;
}

/**
 * One replace pass that skips fenced code.
 *
 * The ranges are measured inside, per call, and never hoisted: `String.replace`
 * hands the replacer an offset into the snapshot it was called on, so a pass
 * that ran after an earlier one edited the text needs its own measurement.
 */
function replaceOutsideFences(
  markdown: string,
  pattern: RegExp,
  replacer: (whole: string, groups: Array<string | undefined>) => string,
): string {
  const ranges = fencedRanges(markdown);
  return markdown.replace(pattern, (...args: unknown[]) => {
    // None of the patterns below use named groups, so the last two arguments
    // are the offset and the whole string.
    const whole = args[0] as string;
    const offset = args[args.length - 2] as number;
    if (ranges.some(([from, to]) => offset >= from && offset < to)) return whole;
    return replacer(whole, args.slice(1, -2) as Array<string | undefined>);
  });
}

/** The first of several optional capture groups that actually matched. */
function firstDefined(...values: Array<string | undefined>): string {
  for (const value of values) if (value !== undefined) return value;
  return "";
}

/**
 * Anything that points outside the vault and is therefore none of our business.
 *
 * The scheme needs at least two characters on purpose: a single letter would
 * make a stray absolute Windows path (`C:/notes/private.md`) look like a URI
 * scheme, and "external" means "left untouched" - the leaky direction.
 */
const EXTERNAL_TARGET = /^(?:[a-z][a-z0-9+.-]+:|\/\/|#)/i;

const WIKI_LINK = /(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const INLINE_LINK = /(!?)\[([^\]]*)\]\(\s*(?:<([^>\n]*)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
const REFERENCE_LINK = /(!?)\[([^\]\n]*)\]\[([^\]\n]*)\]/g;
const SHORTCUT_LINK = /(!?)\[([^\]\n]+)\](?![[(:])/g;
const LINK_DEFINITION =
  /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*(?:\r?\n|$)/gm;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
const HTML_ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Creates a non-round-trippable Markdown projection for an external slice.
 *
 * The source is never modified. Links to excluded objects become plain labels;
 * excluded embeds are removed completely so names cannot leak through markup.
 *
 * Six link shapes are covered, because a projection that only understands two
 * of them withholds a path in one place and publishes it in another:
 *
 * - `[[wiki]]` and `![[wiki]]`
 * - `[label](target)`, including the `<...>` destination form
 * - `[label][ref]` and the collapsed `[label][]`
 * - `[ref]` on its own, when `ref` is a known definition
 * - the definition LINES themselves - neutralising `[label][ref]` while leaving
 *   `[ref]: private/path.md` at the bottom publishes exactly what was withheld
 * - `<img src>` and `<a href>`, which pass straight through a Markdown renderer
 *
 * Frontmatter runs through the allowlist above unless the caller names its own
 * (see `DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST` for why an allowlist and not a
 * denylist). `privateProperties` still applies on top: an explicitly named key
 * is removed even when the allowlist would let it through.
 */
export function projectPublishedMarkdown(input: {
  markdown: string;
  includedPaths: Iterable<string>;
  propertyAllowlist?: string[] | null;
  privateProperties?: string[];
}): PublishedSliceProjection {
  const included = includedIndex(input.includedPaths);
  const allow = new Set(
    (input.propertyAllowlist ?? DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST).map((key) => normalizePropertyKey(key)),
  );
  const privateKeys = new Set((input.privateProperties ?? []).map((key) => normalizePropertyKey(key)));
  const removedProperties = new Set<string>();
  const neutralizedLinks = new Set<string>();
  const removedEmbeds = new Set<string>();
  let markdown = input.markdown;

  if (markdown.startsWith("---\n") || markdown.startsWith("---\r\n")) {
    const newline = markdown.startsWith("---\r\n") ? "\r\n" : "\n";
    const end = markdown.indexOf(`${newline}---${newline}`, 4);
    if (end >= 0) {
      const bodyStart = end + (`${newline}---${newline}`).length;
      const doc = parseDocument(markdown.slice(4, end), { uniqueKeys: true });
      protocolAssert(doc.errors.length === 0, "format", "published slice frontmatter is invalid");
      const source = doc.toJS() as Record<string, unknown> | null;
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source ?? {})) {
        const normalized = normalizePropertyKey(key);
        if (privateKeys.has(normalized) || !allow.has(normalized)) removedProperties.add(key);
        else clean[key] = value;
      }
      const yaml = Object.keys(clean).length ? stringify(clean).trimEnd() : "";
      markdown = yaml ? `---${newline}${yaml.replace(/\n/g, newline)}${newline}---${newline}${markdown.slice(bodyStart)}` : markdown.slice(bodyStart);
    }
  }

  markdown = replaceOutsideFences(markdown, WIKI_LINK, (whole, [embed, rawTarget, , alias]) => {
    const target = rawTarget ?? "";
    if (isIncluded(target, included)) return whole;
    if (embed) { removedEmbeds.add(target.trim()); return ""; }
    neutralizedLinks.add(target.trim());
    return alias?.trim() || target.trim().split("/").pop() || "";
  });

  markdown = replaceOutsideFences(markdown, INLINE_LINK, (whole, [embed, label, angled, bare]) => {
    const target = firstDefined(angled, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    if (embed) { removedEmbeds.add(target); return ""; }
    neutralizedLinks.add(target);
    return label ?? "";
  });

  // Definitions are parsed before any reference link is rewritten: a shortcut
  // `[ref]` is only a link when a definition of that name exists, and the same
  // map decides which definition lines have to go at the end.
  const definitions = new Map<string, { target: string; excluded: boolean }>();
  const definitionFences = fencedRanges(markdown);
  for (const match of markdown.matchAll(LINK_DEFINITION)) {
    const offset = match.index ?? 0;
    if (definitionFences.some(([from, to]) => offset >= from && offset < to)) continue;
    const target = firstDefined(match[2], match[3]);
    definitions.set(normalizePropertyKey(match[1] ?? ""), {
      target,
      excluded: !EXTERNAL_TARGET.test(target) && !isIncluded(target, included),
    });
  }

  if (definitions.size > 0) {
    markdown = replaceOutsideFences(markdown, REFERENCE_LINK, (whole, [embed, label, ref]) => {
      // "[label][]" is the collapsed form: the label is its own reference.
      const key = normalizePropertyKey((ref ?? "").trim() || (label ?? "").trim());
      const definition = definitions.get(key);
      if (!definition || !definition.excluded) return whole;
      if (embed) { removedEmbeds.add(definition.target); return ""; }
      neutralizedLinks.add(definition.target);
      return label ?? "";
    });
    markdown = replaceOutsideFences(markdown, SHORTCUT_LINK, (whole, [embed, label]) => {
      const definition = definitions.get(normalizePropertyKey((label ?? "").trim()));
      if (!definition || !definition.excluded) return whole;
      if (embed) { removedEmbeds.add(definition.target); return ""; }
      neutralizedLinks.add(definition.target);
      return label ?? "";
    });
    markdown = replaceOutsideFences(markdown, LINK_DEFINITION, (whole, [label]) => {
      const definition = definitions.get(normalizePropertyKey((label ?? "").trim()));
      if (!definition || !definition.excluded) return whole;
      neutralizedLinks.add(definition.target);
      return "";
    });
  }

  markdown = replaceOutsideFences(markdown, HTML_IMAGE, (whole, [quoted, single, bare]) => {
    const target = firstDefined(quoted, single, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    removedEmbeds.add(target);
    return "";
  });

  markdown = replaceOutsideFences(markdown, HTML_ANCHOR, (whole, [quoted, single, bare, inner]) => {
    const target = firstDefined(quoted, single, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    neutralizedLinks.add(target);
    return inner ?? "";
  });

  return {
    markdown,
    report: {
      // Sets, not arrays: the same withheld path reaching the reader twice in
      // the preview reads as a bug in the preview.
      removedProperties: [...removedProperties].sort(),
      neutralizedLinks: [...neutralizedLinks].sort(),
      removedEmbeds: [...removedEmbeds].sort(),
    },
  };
}

/**
 * The folder a publication lives in, derived rather than stored.
 *
 * The obvious design would be a `publicationId` field on the config - and the
 * config already declares one. It cannot be written: `assertExactKeys` pins the
 * publication document to exactly the five keys it has today, and the protocol
 * has no schema evolution (every document is checked against an exact key set,
 * and `protocolVersion` is compared for equality). Adding a field is a protocol
 * change, and a protocol change is blocked behind the pending crypto review.
 *
 * Deriving it costs nothing and buys something the stored id would not: the
 * folder name under `.pvws/publications/` is visible to the provider and to
 * every recipient. Using the slice id there would tell them which internal row
 * of the main vault this share belongs to, and two shares of the same slice
 * would be recognisably the same slice. A hash over `workspaceId + "/" +
 * sliceId` reveals neither, while staying stable for the same pair - which is
 * what makes a refresh find its own publication again.
 *
 * Thirty-two hex characters - sixteen bytes - because a publication IS a
 * workspace, and this id is its `workspaceId` (S2). The invite code carries a
 * workspace id and nothing else, so making the two the same lets a recipient
 * derive the folder from the code alone; `assertWorkspaceId` demands sixteen
 * bytes, and a shorter namespace would force a second id and a second field to
 * hand over. It also makes a publication folder look like every other workspace
 * id rather than like a distinctly shorter special case.
 *
 * The id is a namespace, not a secret: it is derived from two values the
 * recipient knows nothing about, and the encryption - not the folder name - is
 * what keeps the content closed.
 */
export function derivePublicationId(workspaceId: string, sliceId: string): string {
  protocolAssert(workspaceId.length > 0 && sliceId.length > 0, "format", "publication id needs a workspace and a slice");
  return sha256Hex(utf8Encode(`${workspaceId}/${sliceId}`)).slice(0, 32);
}

/** Namespaces an independently bootstrapped encrypted workspace on one provider. */
export class PublishedSliceObjectStore implements WorkspaceObjectStore {
  private readonly prefix: string;
  constructor(private readonly store: WorkspaceObjectStore, publicationId: string) {
    protocolAssert(/^[a-z0-9][a-z0-9-]{7,127}$/.test(publicationId), "format", "invalid publication id");
    this.prefix = `.pvws/publications/${publicationId}/`;
  }
  private remote(key: string): string { return `${this.prefix}${key.replace(/^\.pvws\//, "")}`; }
  private local(info: WorkspaceObjectInfo): WorkspaceObjectInfo { return { ...info, key: `.pvws/${info.key.slice(this.prefix.length)}` }; }
  async list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> {
    const page = await this.store.list(this.remote(prefix), cursor, options);
    return { items: page.items.map((entry) => this.local(entry)), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  get(key: string, options?: WorkspaceRequestOptions) { return this.store.get(this.remote(key), options); }
  getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions) { return this.store.getRange(this.remote(key), start, endExclusive, options); }
  async head(key: string, options?: WorkspaceRequestOptions) { const info = await this.store.head(this.remote(key), options); return info ? this.local(info) : null; }
  putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions) { return this.store.putImmutable(this.remote(key), bytes, expectedSha256, options); }
  compareAndSwapPointer(key: string, bytes: Uint8Array, previousEtag: string | null, options?: WorkspaceRequestOptions) { return this.store.compareAndSwapPointer(this.remote(key), bytes, previousEtag, options); }
}

/**
 * The one place that constructs a publication store.
 *
 * Everything else - creating, refreshing, joining, retracting - goes through
 * here, so the derivation above exists exactly once. A second caller building
 * the store by hand would be free to pass a different id, and a publication
 * written under one name and refreshed under another is a silent orphan: the
 * old folder keeps serving stale objects to whoever already joined it.
 * `publicationStore.test.ts` pins that with a source-text check.
 */
export function publicationStoreFor(store: WorkspaceObjectStore, workspaceId: string, sliceId: string): PublishedSliceObjectStore {
  return new PublishedSliceObjectStore(store, derivePublicationId(workspaceId, sliceId));
}

/** Provider ACLs are defense in depth and may never replace encrypted access. */
export function publishedSliceProviderInstructions(config: Pick<PublishedSliceConfig, "provider" | "access">): string[] {
  const permission = config.access === "read" ? "viewer" : "commenter";
  switch (config.provider) {
    case "google-drive": return [`Create a dedicated folder and grant ${permission} access only.`, "Do not enable link-wide access."];
    case "onedrive": return [`Create a specific-people link with ${permission} access.`, "Disable download only as an optional policy; encryption remains authoritative."];
    case "dropbox": return [`Invite recipients to a dedicated folder as ${permission}.`, "Do not use a public shared link."];
    case "nextcloud": return ["Create a dedicated share with password and expiry.", "Keep WebDAV credentials outside the publication."];
    case "webdav": return ["Provision a dedicated collection and least-privilege credentials.", "Use TLS and a separate account per publication."];
    case "s3": return ["Use a dedicated prefix with deny-by-default IAM.", "Disable public access and require TLS."];
  }
}
