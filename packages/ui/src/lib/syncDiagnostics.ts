import type {
  SecretImportReason,
  SecretsImportResult,
  SettingsExchangeInfo,
} from "@plainva/core";

/**
 * Durable, device-local facts about settings and secret sync. The record keeps
 * a successful check, a real remote document download, a local apply and a
 * completed target upload separate. In particular, reading the local
 * projection is never described as "sent".
 */

export type ProfileDeviceState = "running" | "off" | "locked" | "waiting";

export interface ProfileExchange {
  names?: string[];
  /** ISO timestamp. */
  at: string;
  fields: number;
  deviceId?: string;
}

export type SecretDiagnosticReason =
  | SecretImportReason
  | "invalid-or-unreadable-bundle"
  | "sync-failed";

export type LegacyClientDiagnosticReason =
  | "legacy-profile-capability"
  | "legacy-google-client-entry";

export interface SecretDiagnostics {
  at: string;
  imported: number;
  unchanged: number;
  rejected: number;
  stale: number;
  errors: number;
  waiting: number;
  legacy: number;
  /** Stable reason codes and counts only; never account ids or raw errors. */
  reasons: Array<{ reason: SecretDiagnosticReason; count: number }>;
}

export interface SyncDiagnostics {
  lastCheck?: ProfileExchange;
  lastDownload?: ProfileExchange;
  lastApply?: ProfileExchange;
  lastUpload?: ProfileExchange;
  lastSecrets?: SecretDiagnostics;
  legacyClient?: { at: string; reasons: LegacyClientDiagnosticReason[] };
  /**
   * An older Plainva version stored `lastExport` for every check and called it
   * "sent". We preserve that history below, but never promote it to a verified
   * upload. The UI explains the limitation once this marker is present.
   */
  previousClientActivity?: boolean;
  /** @deprecated Pre-S12 ambiguous history; retained for lossless migration. */
  lastExport?: ProfileExchange;
  /** @deprecated Pre-S12 apply history; retained for lossless migration. */
  lastImport?: ProfileExchange;
  /** The most recent refusal round: profile values that could not be used. */
  skipped?: { at: string; reasons: string[] };
  /** The last profile-sideband failure, cleared by the next successful check. */
  lastError?: { at: string; message: string };
}

const MAX_SKIPPED = 20;
const MAX_NAMES = 60;
const MAX_LEGACY_REASONS = 10;

function fieldNames(names?: readonly string[]): { names?: string[] } {
  if (!names || names.length === 0) return {};
  return { names: [...new Set(names)].sort().slice(0, MAX_NAMES) };
}

function exchange(at: string, value: { fields: number; names: readonly string[]; deviceId?: string }): ProfileExchange {
  return {
    at,
    fields: value.fields,
    ...fieldNames(value.names),
    ...(value.deviceId ? { deviceId: value.deviceId } : {}),
  };
}

export function emptyDiagnostics(): SyncDiagnostics {
  return {};
}

/**
 * Lossless read migration for the old ambiguous record. An old "export" proves
 * that the local projection was checked, but not that `target.push` succeeded.
 */
export function normalizeSyncDiagnostics(d: SyncDiagnostics | null | undefined): SyncDiagnostics {
  if (!d) return emptyDiagnostics();
  if (!d.lastExport && !d.lastImport) return d;
  return {
    ...d,
    lastCheck: d.lastCheck ?? d.lastExport,
    lastApply: d.lastApply ?? d.lastImport,
    previousClientActivity: true,
  };
}

/** Stores the four independently observable profile facts of one cycle. */
export function recordProfileExchange(
  d: SyncDiagnostics,
  at: string,
  info: SettingsExchangeInfo,
): SyncDiagnostics {
  const current = normalizeSyncDiagnostics(d);
  return {
    ...current,
    lastCheck: exchange(at, info.checked),
    ...(info.downloaded ? { lastDownload: exchange(at, info.downloaded) } : {}),
    ...(info.applied ? { lastApply: exchange(at, info.applied) } : {}),
    ...(info.uploaded ? { lastUpload: exchange(at, info.uploaded) } : {}),
    lastError: undefined,
  };
}

/**
 * Reduces a detailed keychain result to counts and stable reason codes. The
 * logical ids in `result` are intentionally never copied into the diagnostic.
 */
export function recordSecretsResult(
  d: SyncDiagnostics,
  at: string,
  result: SecretsImportResult,
): SyncDiagnostics {
  const counts = new Map<SecretDiagnosticReason, number>();
  for (const entry of result.entries) {
    if (!entry.reason) continue;
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  return {
    ...normalizeSyncDiagnostics(d),
    lastSecrets: {
      at,
      imported: result.imported.length,
      unchanged: result.unchanged.length,
      rejected: result.rejected.length,
      stale: result.stale.length,
      errors: result.errors.length,
      waiting: result.unknownAccounts.length,
      legacy: result.legacyEntries.length,
      reasons: [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => a.reason.localeCompare(b.reason)),
    },
  };
}

/** Persists only a coarse safe category when no structured import result exists. */
export function recordSecretsError(
  d: SyncDiagnostics,
  at: string,
  reason: Extract<SecretDiagnosticReason, "invalid-or-unreadable-bundle" | "sync-failed">,
): SyncDiagnostics {
  return {
    ...normalizeSyncDiagnostics(d),
    lastSecrets: {
      at,
      imported: 0,
      unchanged: 0,
      rejected: 0,
      stale: 0,
      errors: 1,
      waiting: 0,
      legacy: 0,
      reasons: [{ reason, count: 1 }],
    },
  };
}

export function recordLegacyClient(
  d: SyncDiagnostics,
  at: string,
  reason: LegacyClientDiagnosticReason,
): SyncDiagnostics {
  const current = normalizeSyncDiagnostics(d);
  const reasons = [...new Set([...(current.legacyClient?.reasons ?? []), reason])]
    .sort()
    .slice(0, MAX_LEGACY_REASONS);
  return { ...current, legacyClient: { at, reasons } };
}

/**
 * Compatibility reducers for pre-S12 callers and persisted-shape contracts.
 * They deliberately preserve the old ambiguous fields; current shells use
 * `recordProfileExchange`.
 */
export function recordExport(d: SyncDiagnostics, at: string, fields: number, names?: readonly string[]): SyncDiagnostics {
  return { ...d, lastExport: { at, fields, ...fieldNames(names) }, lastError: undefined };
}

export function recordImport(
  d: SyncDiagnostics,
  at: string,
  fields: number,
  deviceId?: string,
  names?: readonly string[],
): SyncDiagnostics {
  return {
    ...d,
    lastImport: { at, fields, ...(deviceId ? { deviceId } : {}), ...fieldNames(names) },
    lastError: undefined,
  };
}

export function recordSkipped(d: SyncDiagnostics, at: string, reasons: readonly string[]): SyncDiagnostics {
  const current = normalizeSyncDiagnostics(d);
  if (reasons.length === 0) {
    const { skipped: _dropped, ...rest } = current;
    return rest;
  }
  return { ...current, skipped: { at, reasons: reasons.slice(0, MAX_SKIPPED) } };
}

export function recordError(d: SyncDiagnostics, at: string, message: string): SyncDiagnostics {
  return { ...normalizeSyncDiagnostics(d), lastError: { at, message } };
}

export interface DeviceStateInputs {
  enabled: boolean;
  encrypted: boolean;
  unlocked: boolean;
  everRan: boolean;
}

export function profileDeviceState(i: DeviceStateInputs): ProfileDeviceState {
  if (!i.enabled) return "off";
  if (i.encrypted && !i.unlocked) return "locked";
  return i.everRan ? "running" : "waiting";
}

export function diagnosticsState(
  d: SyncDiagnostics,
  opts: { enabled: boolean; encrypted: boolean; unlocked: boolean },
): ProfileDeviceState {
  const current = normalizeSyncDiagnostics(d);
  return profileDeviceState({
    ...opts,
    everRan: !!(
      current.lastCheck
      || current.lastDownload
      || current.lastApply
      || current.lastUpload
      || current.lastExport
      || current.lastImport
    ),
  });
}

export function deviceStateKey(state: ProfileDeviceState): string {
  const suffix = state.charAt(0).toUpperCase() + state.slice(1);
  return `settingsSync.diag${suffix}`;
}
