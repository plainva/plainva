/**
 * OKF 0.2 trust signals — the read-side contract shared by both shells.
 *
 * OKF v0.2 (Google Cloud, 2026-07-25; spec pinned at
 * https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/3fcbb9f8/okf/SPEC.md)
 * added five opt-in frontmatter families:
 *
 * - `generated: {by, at}` — who produced the current content (actor + ISO-8601)
 * - `verified: [{by, at}]` — independent confirmations; a bare mapping is
 *   treated as a one-element list
 * - `sources: [{resource, id?, title?, author?, usage_count?, last_modified?}]`
 * - `stale_after: YYYY-MM-DD` — absolute freshness date
 * - `status: draft | stable | deprecated` — lifecycle; missing means stable
 *
 * Actor convention for every `by`/`author`: `human:<id>` for people,
 * `<producer>/<version>` for tools and agents, `process:<id>` for processes.
 *
 * Everything here is FORM-CHECKED and TOTAL (never throws). A key is claimed
 * as a trust signal only when its value has the spec shape; anything else
 * stays an ordinary property. That rule carries real weight in Plainva: task
 * databases use `status` with their own values (Offen / In Arbeit / Erledigt),
 * and such a note must neither get a lifecycle badge nor lose its column. The
 * spec forbids rejecting a document over a field's shape — so do we.
 */

export type OkfStatus = "draft" | "stable" | "deprecated";

export const OKF_STATUS_VALUES: readonly OkfStatus[] = ["draft", "stable", "deprecated"];

/** Derived per spec from `verified` (advisory, never access control). */
export type OkfTrustLevel = "unverified" | "machine-confirmed" | "human-reviewed";

export interface OkfActorStamp {
  /** Actor per convention: `human:<id>`, `<producer>/<version>`, `process:<id>`. */
  by: string;
  /** ISO-8601 timestamp (kept verbatim — the form check only requires it to parse). */
  at: string;
}

export interface OkfSource {
  resource: string;
  id?: string;
  title?: string;
  author?: string;
  usage_count?: number;
  last_modified?: string;
}

export interface OkfTrustSignals {
  generated: OkfActorStamp | null;
  /** Normalised list (a bare mapping becomes a one-element list). */
  verified: OkfActorStamp[];
  sources: OkfSource[];
  /** Spec-shaped lifecycle value, or null when absent or foreign-shaped. */
  status: OkfStatus | null;
  /**
   * True when the note carries a `status` key whose value is NOT one of the
   * spec values — i.e. the key is in use for something else (task databases).
   * Consumers must then neither show lifecycle UI nor offer the lifecycle editor.
   */
  statusForeign: boolean;
  /** `YYYY-MM-DD` when spec-shaped, else null. */
  staleAfter: string | null;
  /** v0.1 `timestamp` (superseded by `generated.at`) — read fallback only. */
  timestamp: string | null;
  /** Frontmatter keys this parse claimed (spec-shaped values only). */
  claimedKeys: string[];
}

/** The frontmatter keys the trust-signal families occupy. */
export const OKF_TRUST_KEYS = ["generated", "verified", "sources", "status", "stale_after"] as const;
export type OkfTrustKey = (typeof OKF_TRUST_KEYS)[number];

const HUMAN_ACTOR_PREFIX = "human:";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function isHumanActor(actor: string): boolean {
  return actor.startsWith(HUMAN_ACTOR_PREFIX) && actor.length > HUMAN_ACTOR_PREFIX.length;
}

/** Builds the `human:<id>` actor for a user-chosen name (trimmed, never empty). */
export function humanActor(name: string): string {
  return `${HUMAN_ACTOR_PREFIX}${name.trim()}`;
}

/** Builds the `<producer>/<version>` actor for a Plainva write path. */
export function producerActor(producer: string, version: string): string {
  return `${producer.trim()}/${version.trim()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** ISO-8601-ish timestamp: a parseable string (kept verbatim) or a Date. */
function timestampString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = nonEmptyString(value);
  if (!text) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** `{by, at}` with a non-empty actor and a parseable timestamp; null otherwise. */
export function parseOkfActorStamp(value: unknown): OkfActorStamp | null {
  if (!isRecord(value)) return null;
  const by = nonEmptyString(value.by);
  const at = timestampString(value.at);
  if (!by || !at) return null;
  return { by, at };
}

/**
 * `verified` normalised to a list. Returns null when the key is absent or any
 * element is malformed (all-or-nothing: a partially malformed list stays a
 * plain property, so no entry silently disappears from the generic list).
 */
export function parseOkfVerified(value: unknown): OkfActorStamp[] | null {
  if (value === undefined || value === null) return null;
  const items = Array.isArray(value) ? value : [value];
  const stamps: OkfActorStamp[] = [];
  for (const item of items) {
    const stamp = parseOkfActorStamp(item);
    if (!stamp) return null;
    stamps.push(stamp);
  }
  return stamps;
}

/** `sources` as a list of `{resource, …}`; null when absent or any entry lacks `resource`. */
export function parseOkfSources(value: unknown): OkfSource[] | null {
  if (value === undefined || value === null) return null;
  const items = Array.isArray(value) ? value : [value];
  const sources: OkfSource[] = [];
  for (const item of items) {
    if (!isRecord(item)) return null;
    const resource = nonEmptyString(item.resource);
    if (!resource) return null;
    const source: OkfSource = { resource };
    const id = nonEmptyString(item.id);
    if (id) source.id = id;
    const title = nonEmptyString(item.title);
    if (title) source.title = title;
    const author = nonEmptyString(item.author);
    if (author) source.author = author;
    if (typeof item.usage_count === "number" && Number.isFinite(item.usage_count)) {
      source.usage_count = item.usage_count;
    }
    const lastModified = timestampString(item.last_modified);
    if (lastModified) source.last_modified = lastModified;
    sources.push(source);
  }
  return sources;
}

/** Exact spec value (trimmed); anything else — including `Offen` — is foreign. */
export function parseOkfStatus(value: unknown): OkfStatus | null {
  const text = nonEmptyString(value);
  if (!text) return null;
  return (OKF_STATUS_VALUES as readonly string[]).includes(text) ? (text as OkfStatus) : null;
}

/** `YYYY-MM-DD` (a leading date of a longer string or a Date instance is accepted). */
export function parseOkfStaleAfter(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = nonEmptyString(value);
  if (!text) return null;
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const [, y, m, d] = match;
  return isValidCalendarDate(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
}

/** Parses the trust-signal families out of a parsed frontmatter object. */
export function parseOkfTrustSignals(frontmatter: Record<string, unknown> | null | undefined): OkfTrustSignals {
  const fm = frontmatter ?? {};
  const claimedKeys: string[] = [];

  const generated = parseOkfActorStamp(fm.generated);
  if (generated) claimedKeys.push("generated");

  const verified = parseOkfVerified(fm.verified);
  if (verified) claimedKeys.push("verified");

  const sources = parseOkfSources(fm.sources);
  if (sources) claimedKeys.push("sources");

  const status = parseOkfStatus(fm.status);
  const statusPresent = fm.status !== undefined && fm.status !== null;
  if (status) claimedKeys.push("status");

  const staleAfter = parseOkfStaleAfter(fm.stale_after);
  if (staleAfter) claimedKeys.push("stale_after");

  return {
    generated,
    verified: verified ?? [],
    sources: sources ?? [],
    status,
    statusForeign: statusPresent && status === null,
    staleAfter,
    timestamp: timestampString(fm.timestamp),
    claimedKeys,
  };
}

/** Spec derivation: no confirmations → unverified; any `human:` → human-reviewed. */
export function deriveOkfTrustLevel(signals: Pick<OkfTrustSignals, "verified">): OkfTrustLevel {
  if (signals.verified.length === 0) return "unverified";
  return signals.verified.some((v) => isHumanActor(v.by)) ? "human-reviewed" : "machine-confirmed";
}

/** Local calendar date of `now` as `YYYY-MM-DD` (the spec date is a plain date, not an instant). */
export function localDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True once today's local date lies past `stale_after` (the date itself is still fresh). */
export function isOkfStale(staleAfter: string | null, now: Date): boolean {
  if (!staleAfter) return false;
  return localDateString(now) > staleAfter;
}
