import { canonicalJson } from "../../settingsSync/canonicalJson.js";
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import type { McpListing } from "./listing.js";

/**
 * Pinning (plan §17.2, threat T10 "rug pull"): what the user approved of a
 * server is remembered as hashes, and every later listing is compared with
 * them. ANY difference blocks the server until the user looks again — a
 * changed description, a new tool, a tool that went away, different
 * instructions, a prompt that now expands to something else.
 *
 * The case this exists for (Pillar Security, 2026-08-12): a server spread
 * through unsolicited pull requests answered three calls honestly and then
 * rewrote `tools/list` and `prompts/get` to make the agent look for
 * credentials. An approval that covers "this server" instead of "these texts"
 * approves the rewrite along with the original.
 *
 * Three decisions:
 * - The hash covers a descriptor as canonical JSON (keys sorted, no
 *   whitespace), so a server cannot hide a change behind key order, and the
 *   FULL text — the cut for display happens after pinning, so a change beyond
 *   the cut still counts.
 * - `_meta` is left out at every depth. It carries protocol bookkeeping that
 *   legitimately changes between listings, and Plainva never shows `_meta` to
 *   a model. Both halves matter: leaving it out is only safe because nothing
 *   reads it.
 * - Blocked is sticky. A server that flips back to the approved listing stays
 *   blocked; only a new approval of what is there now lifts it.
 */

export interface McpPin {
  v: 1;
  pinnedAt: string;
  /** SHA-256 of the instructions text. */
  instructions: string;
  /** Tool name -> SHA-256 of its descriptor. */
  tools: Record<string, string>;
  /** Prompt name -> SHA-256 of its descriptor. */
  prompts: Record<string, string>;
  /** `mcpPromptKey` -> SHA-256 of what the prompt expanded to when it was approved. */
  promptBodies: Record<string, string>;
}

function withoutMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutMeta);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key !== "_meta" && inner !== undefined) out[key] = withoutMeta(inner);
    }
    return out;
  }
  // A listing is JSON; what JSON cannot carry becomes null instead of an exception.
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return null;
  return value;
}

/** The hash a descriptor, an instructions text or a prompt expansion is pinned by. */
export function mcpHash(value: unknown): string {
  return sha256Hex(utf8Encode(canonicalJson(withoutMeta(value ?? null))));
}

function hashByName(items: readonly { name: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  // A name that appears twice is pinned with both descriptors: either changing is a change.
  const groups = new Map<string, unknown[]>();
  for (const item of items) groups.set(item.name, [...(groups.get(item.name) ?? []), item]);
  for (const [name, group] of groups) out[name] = mcpHash(group.length === 1 ? group[0] : group);
  return out;
}

export function pinMcpListing(listing: McpListing, now: Date): McpPin {
  return {
    v: 1,
    pinnedAt: now.toISOString(),
    instructions: mcpHash(listing.instructions),
    tools: hashByName(listing.tools),
    prompts: hashByName(listing.prompts),
    promptBodies: Object.fromEntries(Object.entries(listing.promptBodies).map(([key, body]) => [key, mcpHash(body)])),
  };
}

export interface McpNameDrift {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface McpDrift {
  instructions: boolean;
  tools: McpNameDrift;
  prompts: McpNameDrift;
  /** Expansions that differ from the approved ones. A new expansion is not drift: see `checkMcpPromptBody`. */
  promptBodies: string[];
}

function nameDrift(pinned: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): McpNameDrift {
  const names = (record: Readonly<Record<string, string>>) => Object.keys(record).sort();
  return {
    added: names(current).filter((name) => !(name in pinned)),
    removed: names(pinned).filter((name) => !(name in current)),
    changed: names(current).filter((name) => name in pinned && pinned[name] !== current[name]),
  };
}

export function compareMcpPin(pin: McpPin, listing: McpListing): McpDrift {
  const current = pinMcpListing(listing, new Date(0));
  return {
    instructions: pin.instructions !== current.instructions,
    tools: nameDrift(pin.tools, current.tools),
    prompts: nameDrift(pin.prompts, current.prompts),
    promptBodies: Object.keys(current.promptBodies)
      .filter((key) => key in pin.promptBodies && pin.promptBodies[key] !== current.promptBodies[key])
      .sort(),
  };
}

export function hasMcpDrift(drift: McpDrift): boolean {
  const any = (d: McpNameDrift) => d.added.length + d.removed.length + d.changed.length > 0;
  return drift.instructions || any(drift.tools) || any(drift.prompts) || drift.promptBodies.length > 0;
}

/**
 * One prompt expansion against the pin, at the moment it is about to be used:
 * `match` may go to the model; `changed` is the rug pull and blocks the
 * server; `unpinned` (a prompt asked with arguments nobody approved yet) is
 * shown to the user first, like any text that reaches a model as an
 * instruction.
 */
export function checkMcpPromptBody(pin: McpPin, key: string, body: unknown): "match" | "changed" | "unpinned" {
  const approved = pin.promptBodies[key];
  if (approved === undefined) return "unpinned";
  return approved === mcpHash(body) ? "match" : "changed";
}

/**
 * Where a server stands on this device. Stored in app data, never in the
 * vault: whoever can write the vault could write the approval (ADR 0020).
 */
export type McpServerReview =
  /** Added, never approved: nothing of it is offered. */
  | { status: "new" }
  | { status: "approved"; pin: McpPin }
  /** Its listing differed from the approved one. `drift` is the first difference seen. */
  | { status: "blocked"; pin: McpPin; drift: McpDrift; blockedAt: string };

export const NEW_MCP_SERVER: McpServerReview = { status: "new" };

/** The user looked at this listing and allowed it. The only way out of `new` and `blocked`. */
export function approveMcpListing(listing: McpListing, now: Date): McpServerReview {
  return { status: "approved", pin: pinMcpListing(listing, now) };
}

/** Every listing a server sends passes through here — on connect and on each reload. */
export function reviewMcpListing(review: McpServerReview, listing: McpListing, now: Date): McpServerReview {
  if (review.status !== "approved") return review;
  const drift = compareMcpPin(review.pin, listing);
  return hasMcpDrift(drift) ? { status: "blocked", pin: review.pin, drift, blockedAt: now.toISOString() } : review;
}

/** A prompt expansion that differs from the approved one blocks the server like a changed listing. */
export function reviewMcpPromptBody(review: McpServerReview, key: string, body: unknown, now: Date): McpServerReview {
  if (review.status !== "approved" || checkMcpPromptBody(review.pin, key, body) !== "changed") return review;
  const none: McpNameDrift = { added: [], removed: [], changed: [] };
  return { status: "blocked", pin: review.pin, drift: { instructions: false, tools: none, prompts: none, promptBodies: [key] }, blockedAt: now.toISOString() };
}

export function mcpOffersTools(review: McpServerReview): boolean {
  return review.status === "approved";
}

const HEX64 = /^[0-9a-f]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hashes = (value: unknown): Record<string, string> | null => {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value)) {
    if (typeof hash !== "string" || !HEX64.test(hash)) return null;
    out[key] = hash;
  }
  return out;
};
const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function readPin(raw: unknown): McpPin | null {
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.pinnedAt !== "string" || typeof raw.instructions !== "string" || !HEX64.test(raw.instructions)) return null;
  const tools = hashes(raw.tools);
  const prompts = hashes(raw.prompts);
  const promptBodies = hashes(raw.promptBodies);
  if (!tools || !prompts || !promptBodies) return null;
  return { v: 1, pinnedAt: raw.pinnedAt, instructions: raw.instructions, tools, prompts, promptBodies };
}

/**
 * Reads a stored review. A damaged record is `new`, never `approved`: what
 * cannot be read was not approved.
 */
export function readMcpServerReview(raw: unknown): McpServerReview {
  if (!isRecord(raw)) return NEW_MCP_SERVER;
  const pin = readPin(raw.pin);
  if (!pin) return NEW_MCP_SERVER;
  if (raw.status === "approved") return { status: "approved", pin };
  if (raw.status === "blocked" && typeof raw.blockedAt === "string") {
    const d = isRecord(raw.drift) ? raw.drift : {};
    const part = (value: unknown): McpNameDrift => {
      const v = isRecord(value) ? value : {};
      return { added: names(v.added), removed: names(v.removed), changed: names(v.changed) };
    };
    return {
      status: "blocked",
      pin,
      drift: { instructions: d.instructions === true, tools: part(d.tools), prompts: part(d.prompts), promptBodies: names(d.promptBodies) },
      blockedAt: raw.blockedAt,
    };
  }
  return NEW_MCP_SERVER;
}
