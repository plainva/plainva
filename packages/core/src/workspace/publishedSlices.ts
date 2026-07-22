import { parseDocument, stringify } from "yaml";
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

function linkTarget(value: string): string {
  const target = value.split("#", 1)[0].trim().replace(/\\/g, "/");
  return target.toLowerCase().endsWith(".md") ? target.slice(0, -3) : target;
}

function isIncluded(target: string, included: Set<string>): boolean {
  const normalized = linkTarget(target);
  return included.has(normalized) || included.has(`${normalized}.md`) || [...included].some((entry) => linkTarget(entry) === normalized);
}

/**
 * Creates a non-round-trippable Markdown projection for an external slice.
 * The source is never modified. Links to excluded objects become plain labels;
 * excluded embeds are removed completely so names cannot leak through markup.
 */
export function projectPublishedMarkdown(input: {
  markdown: string;
  includedPaths: Iterable<string>;
  propertyAllowlist?: string[] | null;
  privateProperties?: string[];
}): PublishedSliceProjection {
  const included = new Set([...input.includedPaths].map((value) => value.replace(/\\/g, "/")));
  const allow = input.propertyAllowlist ? new Set(input.propertyAllowlist) : null;
  const privateKeys = new Set(input.privateProperties ?? []);
  const report: PublishedSliceProjectionReport = { removedProperties: [], neutralizedLinks: [], removedEmbeds: [] };
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
        if (privateKeys.has(key) || (allow && !allow.has(key))) report.removedProperties.push(key);
        else clean[key] = value;
      }
      const yaml = Object.keys(clean).length ? stringify(clean).trimEnd() : "";
      markdown = yaml ? `---${newline}${yaml.replace(/\n/g, newline)}${newline}---${newline}${markdown.slice(bodyStart)}` : markdown.slice(bodyStart);
    }
  }
  markdown = markdown.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (whole, embed: string, rawTarget: string, _anchor: string, alias: string) => {
    if (isIncluded(rawTarget, included)) return whole;
    if (embed) { report.removedEmbeds.push(rawTarget.trim()); return ""; }
    report.neutralizedLinks.push(rawTarget.trim());
    return alias?.trim() || rawTarget.trim().split("/").pop() || "";
  });
  markdown = markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, embed: string, label: string, rawTarget: string) => {
    if (/^(?:https?:|mailto:|#)/i.test(rawTarget) || isIncluded(rawTarget, included)) return whole;
    if (embed) { report.removedEmbeds.push(rawTarget); return ""; }
    report.neutralizedLinks.push(rawTarget);
    return label;
  });
  report.removedProperties.sort(); report.neutralizedLinks.sort(); report.removedEmbeds.sort();
  return { markdown, report };
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
