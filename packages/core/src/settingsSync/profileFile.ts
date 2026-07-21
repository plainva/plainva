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

export interface ProfileDoc {
  format: "plainva-profile";
  version: 1;
  /** Lamport-style counter: each write is max(seen revs)+1. */
  rev: number;
  updatedAt: string;
  /** Stable per-device id (LWW tiebreak, "adopted from" notice). */
  deviceId: string;
  /** Logical setting name -> value (re-keyed by the shell to native store keys). */
  values: Record<string, unknown>;
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
    doc.version !== 1 ||
    typeof doc.rev !== "number" ||
    typeof doc.updatedAt !== "string" ||
    typeof doc.deviceId !== "string" ||
    !doc.values ||
    typeof doc.values !== "object" ||
    Array.isArray(doc.values)
  ) {
    return null;
  }
  return doc;
}

function makeDoc(rev: number, deviceId: string, updatedAt: string, values: Record<string, unknown>): ProfileDoc {
  return { format: "plainva-profile", version: 1, rev, updatedAt, deviceId, values };
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
      const doc = makeDoc(0, deviceId, now, current);
      return { writeLocal: doc, upload: doc };
    }
    return {};
  }

  const localEdited = !sameValues(current, local.values);
  const baseRev = Math.max(local.rev, remote?.rev ?? -1);
  const mine = localEdited ? makeDoc(baseRev + 1, deviceId, now, current) : local;

  if (!remote) return { writeLocal: mine, upload: mine };

  const winner = pickWinner(mine, remote);
  if (winner === "remote") return { applyToStore: remote.values, writeLocal: remote, adoptedFrom: remote.deviceId };
  if (winner === "mine") return { writeLocal: mine, upload: mine };
  return {};
}
