/**
 * What the settings sync actually did, as plain state (sync-transparency plan
 * P1, step S10).
 *
 * The 2026-07-28 finding was not really "settings do not arrive" — it was that
 * nobody could tell whether they had. A device can sit in three states that look
 * exactly like a working one from the outside: the per-vault switch is off, the
 * vault is encrypted and this device has not been unlocked, or a cycle has
 * simply never completed. On top of that, the import silently drops values it
 * cannot use; today that report goes to `console.warn` and nowhere else.
 *
 * This module is pure: it only reduces facts into a record. Where the record is
 * kept, and how it is shown, belongs to the shells.
 */

/**
 * Whether this device takes part in the settings sync right now.
 *
 * - `running` — it exports and imports.
 * - `off` — the per-vault switch is off. Nothing is wrong; nothing travels.
 * - `locked` — the vault is encrypted and this device has no key yet. It
 *   deliberately does NOT write, so it cannot publish a second, conflicting
 *   truth over the sealed one.
 * - `waiting` — switched on, unlocked, but no cycle has completed yet.
 */
export type ProfileDeviceState = "running" | "off" | "locked" | "waiting";

/** One completed exchange with the profile document. */
export interface ProfileExchange {
  /** ISO timestamp. */
  at: string;
  /** How many logical fields the document carried. */
  fields: number;
  /** The device the values came from (import only, when the document names it). */
  deviceId?: string;
}

export interface SyncDiagnostics {
  lastExport?: ProfileExchange;
  lastImport?: ProfileExchange;
  /** The most recent refusal round: values that arrived but could not be used. */
  skipped?: { at: string; reasons: string[] };
  /** The last failure of the sideband step, cleared by the next success. */
  lastError?: { at: string; message: string };
}

/** A refusal list this long says "something is structurally wrong", not "one bad row". */
const MAX_SKIPPED = 20;

export function emptyDiagnostics(): SyncDiagnostics {
  return {};
}

export function recordExport(d: SyncDiagnostics, at: string, fields: number): SyncDiagnostics {
  return { ...d, lastExport: { at, fields }, lastError: undefined };
}

export function recordImport(d: SyncDiagnostics, at: string, fields: number, deviceId?: string): SyncDiagnostics {
  return { ...d, lastImport: { at, fields, ...(deviceId ? { deviceId } : {}) }, lastError: undefined };
}

/**
 * Records what an import refused. An empty list CLEARS the previous round —
 * a refusal that has been fixed must not keep accusing the user.
 */
export function recordSkipped(d: SyncDiagnostics, at: string, reasons: readonly string[]): SyncDiagnostics {
  if (reasons.length === 0) {
    const { skipped: _dropped, ...rest } = d;
    return rest;
  }
  return { ...d, skipped: { at, reasons: reasons.slice(0, MAX_SKIPPED) } };
}

export function recordError(d: SyncDiagnostics, at: string, message: string): SyncDiagnostics {
  return { ...d, lastError: { at, message } };
}

export interface DeviceStateInputs {
  /** The per-vault opt-in. */
  enabled: boolean;
  /** The connection is an encrypted workspace. */
  encrypted: boolean;
  /** This device holds the key for it. */
  unlocked: boolean;
  /** At least one exchange has completed. */
  everRan: boolean;
}

/**
 * The order matters: "off" wins over "locked", because a device that does not
 * take part has no lock problem to solve. Telling someone to enter a passphrase
 * for a sync they switched off would send them down the wrong path.
 */
export function profileDeviceState(i: DeviceStateInputs): ProfileDeviceState {
  if (!i.enabled) return "off";
  if (i.encrypted && !i.unlocked) return "locked";
  return i.everRan ? "running" : "waiting";
}

/** Derives the state from a record plus the two switches around it. */
export function diagnosticsState(
  d: SyncDiagnostics,
  opts: { enabled: boolean; encrypted: boolean; unlocked: boolean }
): ProfileDeviceState {
  return profileDeviceState({ ...opts, everRan: !!(d.lastExport || d.lastImport) });
}

/** i18n key for the one-line explanation of a state. */
export function deviceStateKey(state: ProfileDeviceState): string {
  return `syncDiagnostics.state_${state}`;
}
