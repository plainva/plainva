import type { MailAccountConfig } from "./mailAccounts";

/**
 * Pure folding of stored mailbox rows (finding 2026-11-06, M2). Its own module
 * so the settings-profile import can use it without pulling the keychain and
 * platform services along.
 */

function isUnset(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * One mailbox from two stored copies of it: `kept` wins every field it has set,
 * `other` fills what `kept` lacks (finding 2026-11-06, M2). Three fields are
 * joined rather than filled: `firstFetchAt` keeps the EARLIER stamp (it says
 * when the mailbox first worked, anywhere), the per-address signatures join by
 * address, and the sender addresses join in order. The id is `kept`'s. Pure.
 */
export function mergeMailAccountRows(kept: MailAccountConfig, other: MailAccountConfig): MailAccountConfig {
  const merged: Record<string, unknown> = { ...kept };
  for (const [key, value] of Object.entries(other)) {
    if (isUnset(merged[key]) && !isUnset(value)) merged[key] = value;
  }
  const out = merged as unknown as MailAccountConfig;
  out.id = kept.id;
  if (kept.firstFetchAt && other.firstFetchAt && other.firstFetchAt < kept.firstFetchAt) out.firstFetchAt = other.firstFetchAt;
  if (kept.signatures && other.signatures) out.signatures = { ...other.signatures, ...kept.signatures };
  if (kept.senders && other.senders) out.senders = [...new Set([...kept.senders, ...other.senders])];
  return out;
}

/**
 * The stored list with every id once (finding 2026-11-06, M2). A settings
 * import used to append one row per document row, so a document that carried
 * one mailbox seven times left seven rows with ONE id: "Remove" took all of
 * them, an edit changed one, the first fetch stamped one. Same-id rows are the
 * same mailbox by definition (the keychain slot hangs off the id), so they fold
 * silently, in the place of the first, keeping every field any of them set.
 * Returns the input itself when nothing repeats. Pure.
 */
export function collapseMailAccountRows(rows: readonly MailAccountConfig[]): MailAccountConfig[] {
  const seen = new Set<string>();
  let repeated = false;
  for (const row of rows) {
    if (seen.has(row.id)) { repeated = true; break; }
    seen.add(row.id);
  }
  if (!repeated) return rows as MailAccountConfig[];
  const byId = new Map<string, MailAccountConfig>();
  for (const row of rows) {
    const first = byId.get(row.id);
    byId.set(row.id, first ? mergeMailAccountRows(first, row) : row);
  }
  return [...byId.values()];
}
