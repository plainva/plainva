/**
 * Profile-sync document (`.plainva/sync/settings.json`) and its last-writer-wins
 * reconciliation (settings-sync plan P1). The file carries the vault's syncable
 * settings as plain JSON and travels with the vault via a dedicated sideband
 * sync step — never through the file queue/merge/conflict path.
 *
 * Reconciliation is a pure, synchronous function so the whole state machine is
 * unit-testable: value equality uses a stable (key-sorted) serialization, so no
 * async hashing is needed and key order never matters.
 */

/** Remote + local path of the profile file (excluded from the normal file sync). */
export const PROFILE_SYNC_PATH = ".plainva/sync/settings.json";

/**
 * One field's own history (bars plan P6). Whole-document last-writer-wins loses
 * an independent change whenever two devices write between two cycles — the
 * later document simply replaces the earlier one, including the fields it never
 * touched. Per-field revisions remove that class: two devices that change
 * DIFFERENT settings both keep their change.
 *
 * A removed setting is a tombstone rather than an absent key, because absence
 * already means "was never set" and the two must not be confused: the apply
 * side resets a setting to its default when it is absent, so a lost tombstone
 * would silently resurrect an old value.
 */
export interface ProfileEntry {
  /** Absent when the field is a tombstone. */
  value?: unknown;
  deleted?: true;
  /** Lamport-style per-field counter: each write is max(seen revs)+1. */
  rev: number;
  updatedAt: string;
  deviceId: string;
}

export interface ProfileDoc {
  format: "plainva-profile";
  version: 1 | 2;
  /** Lamport-style counter: each write is max(seen revs)+1. */
  rev: number;
  updatedAt: string;
  /** Stable per-device id (LWW tiebreak, "adopted from" notice). */
  deviceId: string;
  /**
   * Logical setting name -> value (re-keyed by the shell to native store keys).
   * In version 2 this is the derived view of `entries` and stays present on
   * purpose: an older Plainva reads it and sees a coherent state instead of an
   * empty profile.
   */
  values: Record<string, unknown>;
  /** Version 2: per-field history. Absent in documents written by version 1. */
  entries?: Record<string, ProfileEntry>;
}

/** Deterministic JSON with recursively sorted object keys (for equality + hashing). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** True when two value maps are semantically equal (order-independent). */
export function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function serializeProfile(doc: ProfileDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Parses and validates a profile document; returns null for anything malformed. */
export function parseProfile(text: string | null): ProfileDoc | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const doc = parsed as ProfileDoc;
  if (
    !doc ||
    doc.format !== "plainva-profile" ||
    (doc.version !== 1 && doc.version !== 2) ||
    typeof doc.rev !== "number" ||
    typeof doc.updatedAt !== "string" ||
    typeof doc.deviceId !== "string" ||
    !doc.values ||
    typeof doc.values !== "object" ||
    Array.isArray(doc.values)
  ) {
    return null;
  }
  if (doc.entries !== undefined && (typeof doc.entries !== "object" || doc.entries === null || Array.isArray(doc.entries))) {
    return null;
  }
  return doc;
}

/**
 * The per-field history of a document. A version-1 document has none, so its
 * whole `values` map is read as one generation stamped with the document's own
 * revision — that is exactly what it meant, and it lets old and new documents
 * meet in the same merge without a migration step.
 */
export function entriesOf(doc: ProfileDoc): Record<string, ProfileEntry> {
  if (doc.entries) return doc.entries;
  const out: Record<string, ProfileEntry> = {};
  for (const [key, value] of Object.entries(doc.values)) {
    out[key] = { value, rev: doc.rev, updatedAt: doc.updatedAt, deviceId: doc.deviceId };
  }
  return out;
}

/** The live values a document describes (tombstones are not values). */
export function valuesOf(entries: Record<string, ProfileEntry>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry.deleted) out[key] = entry.value;
  }
  return out;
}

/** Same tiebreak as whole-document LWW, one field at a time. */
function pickEntry(a: ProfileEntry, b: ProfileEntry): ProfileEntry {
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return a.deviceId >= b.deviceId ? a : b;
}

/** Field-wise merge of two histories — the heart of the multi-person fix. */
export function mergeEntries(
  a: Record<string, ProfileEntry>,
  b: Record<string, ProfileEntry>,
): Record<string, ProfileEntry> {
  const out: Record<string, ProfileEntry> = { ...a };
  for (const [key, entry] of Object.entries(b)) {
    const mine = out[key];
    out[key] = mine ? pickEntry(mine, entry) : entry;
  }
  return out;
}

/** Keeps only the fields this document is responsible for (scope partition). */
export function filterEntries(
  entries: Record<string, ProfileEntry>,
  keep: (logical: string) => boolean,
): Record<string, ProfileEntry> {
  const out: Record<string, ProfileEntry> = {};
  for (const [key, entry] of Object.entries(entries)) if (keep(key)) out[key] = entry;
  return out;
}

/**
 * Picks the winner between our best local doc and the remote doc:
 *  - higher rev wins;
 *  - same rev + same values -> already converged ("equal");
 *  - same rev + different values -> LWW by updatedAt, then a deterministic
 *    deviceId tiebreak so both devices agree on the same winner (heals the
 *    "same rev, different content" race that would otherwise never converge).
 */
function pickWinner(mine: ProfileDoc, remote: ProfileDoc): "mine" | "remote" | "equal" {
  if (mine.rev !== remote.rev) return mine.rev > remote.rev ? "mine" : "remote";
  if (sameValues(mine.values, remote.values)) return "equal";
  if (mine.updatedAt !== remote.updatedAt) return mine.updatedAt > remote.updatedAt ? "mine" : "remote";
  return mine.deviceId >= remote.deviceId ? "mine" : "remote";
}

/**
 * Picks the better of two profile documents by the same rule as `pickWinner`.
 * Used when a vault holds BOTH the sealed and the plaintext variant: whichever
 * is further along wins, so the state of a device that could not seal (locked,
 * no passphrase here) is adopted rather than discarded with its file.
 */
export function preferNewerProfile(a: ProfileDoc | null, b: ProfileDoc | null): ProfileDoc | null {
  if (!a) return b;
  if (!b) return a;
  return pickWinner(a, b) === "mine" ? a : b;
}

export interface ReconcileInput {
  /** Live store values (already re-keyed to logical names). */
  current: Record<string, unknown>;
  /** The profile file we last wrote locally, or null on first participation. */
  local: ProfileDoc | null;
  /** The remote profile file, or null when none exists yet. */
  remote: ProfileDoc | null;
  deviceId: string;
  now: string;
}

export interface ReconcileDecision {
  /** Apply these values to the local store (import from a newer remote). */
  applyToStore?: Record<string, unknown>;
  /** Write this document as the local profile file. */
  writeLocal?: ProfileDoc;
  /** Upload this document to the remote. */
  upload?: ProfileDoc;
  /** deviceId we adopted settings from (for a "settings from device X" notice). */
  adoptedFrom?: string;
}

/**
 * Reconciles the live settings, the local profile file and the remote profile
 * file into a set of actions. Deterministic and side-effect-free.
 *
 * First participation on a device (no local file yet) ADOPTS the shared remote
 * settings rather than overwriting them with local defaults; only with no remote
 * at all does the device publish its own. Steady state is last-writer-wins on
 * the whole document (small, low-stakes values — no field merge in v1).
 */
export function reconcileProfile(input: ReconcileInput): ReconcileDecision {
  const { current, local, remote, deviceId, now } = input;

  if (!local) {
    if (remote) return { applyToStore: remote.values, writeLocal: remote, adoptedFrom: remote.deviceId };
    if (Object.keys(current).length > 0) {
      const doc = fromEntries(stampAll(current, 0, deviceId, now), deviceId);
      return { writeLocal: doc, upload: doc };
    }
    return {};
  }

  const localEntries = entriesOf(local);
  const remoteEntries = remote ? entriesOf(remote) : null;
  const baseRev = Math.max(local.rev, remote?.rev ?? -1);
  // What THIS device changed since it last wrote the file.
  const mineEntries = withLocalEdits(localEntries, current, baseRev + 1, deviceId, now);
  const merged = remoteEntries ? mergeEntries(mineEntries, remoteEntries) : mineEntries;

  const decision: ReconcileDecision = {};
  const mergedValues = valuesOf(merged);
  if (!sameValues(mergedValues, current)) decision.applyToStore = mergedValues;
  // The local file is this device's memory of what it last saw, so it is
  // rewritten when the CONTENT moved — not when a merge merely re-stamped an
  // identical value with the other device's id. Rewriting on a stamp difference
  // would put a write in every single cycle of two converged devices.
  const contentMoved =
    !sameValues(mergedValues, valuesOf(localEntries))
    || Object.keys(merged).length !== Object.keys(localEntries).length;
  if (contentMoved) decision.writeLocal = fromEntries(merged, deviceId);
  // The upload, in contrast, compares histories: that is what makes both sides
  // converge on one winner per field instead of trading writes forever.
  if (!remoteEntries || !sameEntries(merged, remoteEntries)) {
    decision.upload = decision.writeLocal ?? fromEntries(merged, deviceId);
  }
  // "Adopted from" is about a value that arrived from elsewhere, not about the
  // merge itself: only report it when the store actually changes because of a
  // remote entry.
  if (decision.applyToStore && remote) {
    const fromRemote = Object.entries(merged).find(([key, entry]) => remoteEntries?.[key] === entry && mineEntries[key] !== entry);
    if (fromRemote) decision.adoptedFrom = fromRemote[1].deviceId;
  }
  return decision;
}

/** Stamps a whole value map as one generation (first publication of a device). */
function stampAll(values: Record<string, unknown>, rev: number, deviceId: string, now: string): Record<string, ProfileEntry> {
  const out: Record<string, ProfileEntry> = {};
  for (const [key, value] of Object.entries(values)) out[key] = { value, rev, updatedAt: now, deviceId };
  return out;
}

/**
 * Folds the live store into the known history: a differing value is a new
 * generation of that field, a value that disappeared becomes a tombstone.
 * Fields nobody touched keep their old stamp, which is what lets two devices
 * change different settings without either losing the other's.
 */
function withLocalEdits(
  known: Record<string, ProfileEntry>,
  current: Record<string, unknown>,
  rev: number,
  deviceId: string,
  now: string,
): Record<string, ProfileEntry> {
  const out: Record<string, ProfileEntry> = { ...known };
  for (const [key, value] of Object.entries(current)) {
    const entry = known[key];
    if (entry && !entry.deleted && stableStringify(entry.value) === stableStringify(value)) continue;
    out[key] = { value, rev, updatedAt: now, deviceId };
  }
  for (const [key, entry] of Object.entries(known)) {
    if (key in current || entry.deleted) continue;
    out[key] = { deleted: true, rev, updatedAt: now, deviceId };
  }
  return out;
}

function sameEntries(a: Record<string, ProfileEntry>, b: Record<string, ProfileEntry>): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Builds the document around a merged history (doc-level fields stay truthful
 *  for a version-1 reader: `rev`/`updatedAt` are the newest field's). */
function fromEntries(entries: Record<string, ProfileEntry>, deviceId: string): ProfileDoc {
  let rev = 0;
  let updatedAt = "";
  for (const entry of Object.values(entries)) {
    if (entry.rev > rev) rev = entry.rev;
    if (entry.updatedAt > updatedAt) updatedAt = entry.updatedAt;
  }
  return { format: "plainva-profile", version: 2, rev, updatedAt, deviceId, values: valuesOf(entries), entries };
}
