import type { PimAccountRow } from "@plainva/core";
import type { CloudAccountRecord } from "./cloudAccounts.js";
import type { MailAccountConfig } from "../mail/mailAccounts.js";

/**
 * The account half of the settings profile, written ONCE for both shells.
 *
 * This is the part that decides whether an account arriving from another device
 * is the SAME account you already have, or a new one — and getting that wrong
 * either duplicates a mailbox on every sync or silently rebinds a calendar to
 * the wrong server. The desktop had a careful implementation of it and mobile
 * had none at all, which is why a phone kept asking the user to create every
 * account by hand. Porting a second copy would have meant maintaining that
 * judgement twice; instead it lives here and each shell only says where it
 * keeps its accounts.
 *
 * Identity, not id, decides: ids are device-local (they end up in keychain slot
 * names), so the same account legitimately carries different ids on different
 * devices. The map of local id ↔ shared id is what keeps them tied together.
 */

/** Device-local id ↔ the id used in the shared document. */
export interface ProfileAccountMap {
  pimLocalToLogical: Record<string, string>;
  mailLocalToLogical: Record<string, string>;
  cloudLocalToLogical: Record<string, string>;
  /** Physical keychain slot on this installation → shared secret entry id. */
  secretLocalToLogical: Record<string, string>;
}

export interface ProfilePimSelections {
  calendars: Array<{ accountId: string; id: string; selected: boolean }>;
  taskLists: Array<{ accountId: string; id: string; selected: boolean }>;
}

/** What a shell must provide to receive accounts. Everything else is decided here. */
export interface AccountImportPorts {
  listPimAccounts(): Promise<PimAccountRow[]>;
  upsertPimAccount(row: PimAccountRow): Promise<void>;
  listCalendars(accountId: string): Promise<Array<{ id: string }>>;
  setCalendarSelected(accountId: string, id: string, selected: boolean): Promise<void>;
  listTaskLists(accountId: string): Promise<Array<{ id: string }>>;
  setTaskListSelected(accountId: string, id: string, selected: boolean): Promise<void>;
  listMailAccounts(): Promise<MailAccountConfig[]>;
  replaceMailAccounts(accounts: MailAccountConfig[]): Promise<void>;
  listCloudAccounts(): Promise<CloudAccountRecord[]>;
  replaceCloudAccounts(accounts: CloudAccountRecord[]): Promise<void>;
  pimSecretSlot(accountId: string): string;
  mailSecretSlot(accountId: string): string;
  loadAccountMap(): Promise<ProfileAccountMap>;
  saveAccountMap(map: ProfileAccountMap): Promise<void>;
  /** Injectable so tests are deterministic. */
  newId?(): string;
}

export const emptyAccountMap = (): ProfileAccountMap => ({
  pimLocalToLogical: {},
  mailLocalToLogical: {},
  cloudLocalToLogical: {},
  secretLocalToLogical: {},
});

/** Backward-compatible reader for maps written before cloud/secret addressing. */
export function normalizeAccountMap(map: Partial<ProfileAccountMap> | null | undefined): ProfileAccountMap {
  return {
    pimLocalToLogical: { ...(map?.pimLocalToLogical ?? {}) },
    mailLocalToLogical: { ...(map?.mailLocalToLogical ?? {}) },
    cloudLocalToLogical: { ...(map?.cloudLocalToLogical ?? {}) },
    secretLocalToLogical: { ...(map?.secretLocalToLogical ?? {}) },
  };
}

/**
 * What makes two PIM accounts "the same account on another device": the server,
 * the user and the BYO client — never the id.
 */
export function pimIdentity(a: Pick<PimAccountRow, "provider" | "label" | "config">): string {
  const url = typeof a.config.url === "string" ? a.config.url.trim().replace(/\/+$/, "").toLowerCase() : "";
  const user = typeof a.config.user === "string" ? a.config.user.trim().toLowerCase() : "";
  const client = typeof a.config.clientId === "string" ? a.config.clientId.trim().toLowerCase() : "";
  return [a.provider, url, user, client, a.label.trim().toLowerCase()].join("|");
}

export function mailIdentity(a: MailAccountConfig): string {
  return [a.kind ?? "imap", a.host.trim().toLowerCase(), a.port, a.user.trim().toLowerCase()].join("|");
}

export function validPimAccount(value: unknown): value is PimAccountRow {
  const a = value as PimAccountRow;
  return (
    !!a &&
    typeof a.id === "string" &&
    ["caldav", "google", "microsoft"].includes(a.provider) &&
    typeof a.label === "string" &&
    !!a.config &&
    typeof a.config === "object" &&
    !Array.isArray(a.config)
  );
}

/** Backend selector duplicated from mailAccounts to keep this module import-light. */
const kindOf = (a: MailAccountConfig): "imap" | "microsoft" => a.kind ?? "imap";

export function validMailAccount(value: unknown): value is MailAccountConfig {
  const a = value as MailAccountConfig;
  if (!a || typeof a.id !== "string" || typeof a.label !== "string" || typeof a.host !== "string" || typeof a.user !== "string") return false;
  if (a.kind !== undefined && a.kind !== "imap" && a.kind !== "microsoft") return false;
  // A Microsoft (Graph) mailbox speaks no IMAP: host "" and port 0 are correct
  // for it. Demanding a real port rejected the account — and a rejected account
  // used to abort the whole import, so one such mailbox disabled the entire
  // settings sync on every device, silently.
  if (kindOf(a) === "microsoft") return true;
  return Number.isInteger(a.port) && a.port > 0 && a.port <= 65535;
}

export function validCloudAccount(value: unknown): value is CloudAccountRecord {
  const a = value as CloudAccountRecord;
  return !!a && typeof a.id === "string" && typeof a.family === "string" && typeof a.label === "string" && !!a.services && typeof a.services === "object" && !Array.isArray(a.services);
}

/**
 * Device state that rides in an account row but must never be PUBLISHED: the
 * calendar choice is parked here until that account's first sync creates the
 * calendars. Exporting it made the document differ from what was just
 * published, so every cycle saw a change and announced an import — on a device
 * where nothing had changed (report 2026-07-29).
 */
const PARKED_KEYS = ["plainvaPendingCalendarSelections", "plainvaPendingTaskListSelections"] as const;

function withoutParkedState(config: Record<string, unknown>): Record<string, unknown> {
  if (!PARKED_KEYS.some((k) => k in config)) return config;
  const out = { ...config };
  for (const key of PARKED_KEYS) delete out[key];
  return out;
}

/**
 * The account half of an export, in a form that round-trips.
 *
 * Two properties matter and neither is cosmetic. Order is DETERMINISTIC (by
 * identity, which is the same on every device) because the import legitimately
 * keeps an account the document does not carry and puts it first — so the order
 * used to depend on which extra accounts each device happened to have, and two
 * such devices kept overwriting each other's order forever. And parked device
 * state is stripped, see PARKED_KEYS.
 */
export function pimAccountsForProfile(rows: readonly PimAccountRow[], map: ProfileAccountMap): PimAccountRow[] {
  return rows
    .map((a) => ({ ...a, id: map.pimLocalToLogical[a.id] ?? a.id, config: withoutParkedState(a.config) }))
    .sort((a, b) => pimIdentity(a).localeCompare(pimIdentity(b)));
}

export function mailAccountsForProfile(rows: readonly MailAccountConfig[], map: ProfileAccountMap): MailAccountConfig[] {
  return rows
    .map((a) => ({ ...a, id: map.mailLocalToLogical[a.id] ?? a.id }))
    .sort((a, b) => mailIdentity(a).localeCompare(mailIdentity(b)));
}

/** Same reasoning for the selections: their order comes from a per-device table. */
export function pimSelectionsForProfile(
  calendars: readonly { accountId: string; id: string; selected: boolean }[],
  taskLists: readonly { accountId: string; id: string; selected: boolean }[],
  map: ProfileAccountMap
): ProfilePimSelections {
  const shared = (rows: readonly { accountId: string; id: string; selected: boolean }[]) =>
    rows
      .map((r) => ({ accountId: map.pimLocalToLogical[r.accountId] ?? r.accountId, id: r.id, selected: r.selected }))
      .sort((a, b) => (a.accountId === b.accountId ? a.id.localeCompare(b.id) : a.accountId.localeCompare(b.accountId)));
  return { calendars: shared(calendars), taskLists: shared(taskLists) };
}

function nextLocalId(preferred: string, used: Set<string>, newId: () => string): string {
  if (preferred && !used.has(preferred)) return preferred;
  let id: string;
  do id = newId(); while (used.has(id));
  return id;
}

const defaultNewId = () => globalThis.crypto.randomUUID().slice(0, 12);

/**
 * Applies the account metadata from a profile document.
 *
 * Returns the logical → local id maps, which the caller needs to re-point the
 * cloud registry and the default-calendar setting at the ids this device
 * actually uses.
 */
export async function importAccountMetadata(
  values: Record<string, unknown>,
  ports: AccountImportPorts
): Promise<{ pim: Map<string, string>; mail: Map<string, string>; cloud: Map<string, string> }> {
  const newId = ports.newId ?? defaultNewId;
  const previousMap = normalizeAccountMap(await ports.loadAccountMap());
  const pimMap = new Map<string, string>();
  const mailMap = new Map<string, string>();

  if (Array.isArray(values.pimAccounts)) {
    const existing = await ports.listPimAccounts();
    const used = new Set(existing.map((a) => a.id));
    const selections = values.pimSelections as Partial<ProfilePimSelections> | undefined;
    for (const importedValue of values.pimAccounts) {
      if (!validPimAccount(importedValue)) continue; // sanitize already reported it
      const imported = importedValue;
      const same = existing.find((a) => pimIdentity(a) === pimIdentity(imported));
      const idCollision = existing.find((a) => a.id === imported.id);
      // Same account → keep OUR id (keychain slots hang off it). A foreign
      // account that happens to share an id gets a fresh one instead of
      // overwriting a local account that is not it.
      const localId = same?.id ?? (idCollision && pimIdentity(idCollision) !== pimIdentity(imported) ? nextLocalId(imported.id, used, newId) : imported.id);
      used.add(localId);
      pimMap.set(imported.id, localId);
      previousMap.secretLocalToLogical[ports.pimSecretSlot(localId)] = imported.id;

      const calendarPending = Object.fromEntries((selections?.calendars ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));
      const taskPending = Object.fromEntries((selections?.taskLists ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));

      // Apply what can be applied NOW; only what cannot stays parked. The
      // calendars of an account only exist after its first sync, which is what
      // the parking is for — but a choice that has already been applied has to
      // leave the row, or it sits there forever and travels on every export.
      const calendars = await ports.listCalendars(localId);
      const taskLists = await ports.listTaskLists(localId);
      const applied = new Set<string>();
      for (const cal of calendars) {
        if (Object.prototype.hasOwnProperty.call(calendarPending, cal.id)) {
          await ports.setCalendarSelected(localId, cal.id, !!calendarPending[cal.id]);
          applied.add(`c:${cal.id}`);
        }
      }
      for (const list of taskLists) {
        if (Object.prototype.hasOwnProperty.call(taskPending, list.id)) {
          await ports.setTaskListSelected(localId, list.id, !!taskPending[list.id]);
          applied.add(`t:${list.id}`);
        }
      }
      const calendarLeft = Object.fromEntries(Object.entries(calendarPending).filter(([id]) => !applied.has(`c:${id}`)));
      const taskLeft = Object.fromEntries(Object.entries(taskPending).filter(([id]) => !applied.has(`t:${id}`)));
      await ports.upsertPimAccount({
        ...imported,
        id: localId,
        config: {
          ...withoutParkedState(imported.config),
          ...(Object.keys(calendarLeft).length ? { plainvaPendingCalendarSelections: calendarLeft } : {}),
          ...(Object.keys(taskLeft).length ? { plainvaPendingTaskListSelections: taskLeft } : {}),
        },
      });
    }
  }

  if (Array.isArray(values.mailAccounts)) {
    const existing = await ports.listMailAccounts();
    const used = new Set(existing.map((a) => a.id));
    const importedRows: MailAccountConfig[] = [];
    for (const importedValue of values.mailAccounts) {
      if (!validMailAccount(importedValue)) continue;
      const imported = importedValue;
      const same = existing.find((a) => mailIdentity(a) === mailIdentity(imported));
      const idCollision = existing.find((a) => a.id === imported.id);
      const localId = same?.id ?? (idCollision && mailIdentity(idCollision) !== mailIdentity(imported) ? nextLocalId(imported.id, used, newId) : imported.id);
      used.add(localId);
      mailMap.set(imported.id, localId);
      previousMap.secretLocalToLogical[ports.mailSecretSlot(localId)] = imported.id;
      importedRows.push({ ...imported, id: localId });
    }
    const importedIds = new Set(importedRows.map((a) => a.id));
    // Accounts this device has and the document does not are KEPT: the profile
    // is a shared truth, not an authority over what only exists here.
    await ports.replaceMailAccounts([...existing.filter((a) => !importedIds.has(a.id)), ...importedRows]);
  }

  const nextMap: ProfileAccountMap = {
    pimLocalToLogical: { ...previousMap.pimLocalToLogical, ...Object.fromEntries([...pimMap].map(([logical, local]) => [local, logical])) },
    mailLocalToLogical: { ...previousMap.mailLocalToLogical, ...Object.fromEntries([...mailMap].map(([logical, local]) => [local, logical])) },
    cloudLocalToLogical: { ...previousMap.cloudLocalToLogical },
    secretLocalToLogical: { ...previousMap.secretLocalToLogical },
  };

  const cloudMap = new Map<string, string>();
  if (Array.isArray(values.cloudAccounts)) {
    const remapped = remapCloudRegistry(values.cloudAccounts.filter(validCloudAccount), { pim: pimMap, mail: mailMap });
    const merged = mergeCloudRegistryMapped(await ports.listCloudAccounts(), remapped, nextMap, newId);
    await ports.replaceCloudAccounts(merged.records);
    for (const [logical, local] of merged.logicalToLocal) {
      cloudMap.set(logical, local);
      nextMap.cloudLocalToLogical[local] = logical;
    }
  }

  await ports.saveAccountMap(nextMap);
  return { pim: pimMap, mail: mailMap, cloud: cloudMap };
}

/** Re-points a cloud registry record set at this device's local account ids. */
export function remapCloudRegistry(
  records: readonly CloudAccountRecord[],
  idMap: { pim: Map<string, string>; mail: Map<string, string> }
): CloudAccountRecord[] {
  return records.map((record) => ({
    ...record,
    services: {
      ...record.services,
      ...(record.services.calendar
        ? { calendar: { pimAccountId: idMap.pim.get(record.services.calendar.pimAccountId) ?? record.services.calendar.pimAccountId } }
        : {}),
      ...(record.services.mail
        ? { mail: { mailAccountId: idMap.mail.get(record.services.mail.mailAccountId) ?? record.services.mail.mailAccountId } }
        : {}),
    },
  }));
}

/** Written as an escape: a raw NUL in a source file makes git treat it as binary. */
const SEP = "\u0000";

/** family + identity of a card, for matching the same account across devices. */
function cloudIdentity(record: CloudAccountRecord): string {
  return [record.family, record.label.trim().toLowerCase()].join(SEP);
}

/**
 * Folds an imported registry into the local one.
 *
 * The profile is a shared truth, not an authority over what only exists here —
 * the same rule the mail accounts already follow. Replacing the registry
 * wholesale (as the import used to do) had two consequences that both look like
 * "I signed in again and it changed nothing" (finding 2026-07-30):
 *
 *  - The card's id came from the other device. The account slot holding the
 *    shared refresh token hangs off THAT id, so a sync could rename the card out
 *    from under a token that had just been written — orphaning it again, on
 *    every cycle, no matter how often the user re-authorised.
 *  - A device that never connected a service (a phone without the calendar)
 *    exported a card without it, and the import stripped that service from the
 *    device that HAD it. The calendars simply disappear.
 *
 * So a record present on both sides keeps its local id and its local service
 * references; the document only adds services this device does not carry, and
 * records it has never seen.
 */
export function mergeCloudRegistry(
  local: readonly CloudAccountRecord[],
  imported: readonly CloudAccountRecord[]
): CloudAccountRecord[] {
  return mergeCloudRegistryMapped(local, imported, emptyAccountMap()).records;
}

export interface CloudRegistryMergeResult {
  records: CloudAccountRecord[];
  /** Shared document id → id retained on this installation. */
  logicalToLocal: Map<string, string>;
}

/**
 * Registry union plus the id translation it established. A previous mapping
 * wins over labels, then the existing conservative identity match is used.
 */
export function mergeCloudRegistryMapped(
  local: readonly CloudAccountRecord[],
  imported: readonly CloudAccountRecord[],
  accountMap: ProfileAccountMap,
  newId: () => string = defaultNewId,
): CloudRegistryMergeResult {
  const merged = local.map((record) => ({ ...record, services: { ...record.services } }));
  const byId = new Map(merged.map((record) => [record.id, record]));
  const byIdentity = new Map<string, CloudAccountRecord>();
  // An unlabeled card carries no identity: it must never swallow another one.
  for (const record of merged) if (record.label.trim()) byIdentity.set(cloudIdentity(record), record);
  // File sync is one account per vault; the union must not produce a second.
  let filesTaken = merged.some((record) => record.services.files);
  const used = new Set(merged.map((record) => record.id));
  const localByLogical = new Map(
    Object.entries(accountMap.cloudLocalToLogical).map(([localId, logicalId]) => [logicalId, localId]),
  );
  const logicalToLocal = new Map<string, string>();

  for (const incoming of imported) {
    const mapped = localByLogical.get(incoming.id);
    const direct = byId.get(incoming.id);
    const directMatches = direct
      && direct.family === incoming.family
      && direct.label.trim().toLowerCase() === incoming.label.trim().toLowerCase();
    const match = (mapped ? byId.get(mapped) : undefined)
      ?? (directMatches ? direct : undefined)
      ?? (incoming.label.trim() ? byIdentity.get(cloudIdentity(incoming)) : undefined);
    if (!match) {
      const services = { ...incoming.services };
      if (services.files && filesTaken) delete services.files;
      filesTaken = filesTaken || !!services.files;
      const localId = nextLocalId(incoming.id, used, newId);
      used.add(localId);
      const record = { ...incoming, id: localId, services };
      merged.push(record);
      byId.set(record.id, record);
      if (record.label.trim()) byIdentity.set(cloudIdentity(record), record);
      logicalToLocal.set(incoming.id, localId);
      continue;
    }
    logicalToLocal.set(incoming.id, match.id);
    // Assign only what exists: writing `byoClientId: undefined` would put the
    // key into the exported document and make the profile differ from what was
    // just published — the repeating "settings synced" toast all over again.
    if (!match.label) match.label = incoming.label;
    if (match.byoClientId === undefined && incoming.byoClientId !== undefined) match.byoClientId = incoming.byoClientId;
    if (match.flavor === undefined && incoming.flavor !== undefined) match.flavor = incoming.flavor;
    // Local references win: they point at subsystem accounts that exist HERE.
    if (!match.services.calendar && incoming.services.calendar) match.services.calendar = incoming.services.calendar;
    if (!match.services.mail && incoming.services.mail) match.services.mail = incoming.services.mail;
    if (!match.services.files && incoming.services.files && !filesTaken) {
      match.services.files = incoming.services.files;
      filesTaken = true;
    }
  }
  return { records: merged, logicalToLocal };
}

/**
 * Per-vault memory of the "waiting for its account" set, so the notice appears
 * once per CHANGED set instead of once per sync cycle.
 *
 * The condition behind it does not clear itself: an entry whose account is
 * unknown here is skipped, never stored, so the next cycle sees exactly the same
 * situation and would report it again — every ~30 seconds, on both shells
 * (device report 2026-07-27).
 */
const reportedWaitingAccounts = new Map<string, string>();

/** True when this set of waiting account ids has not been reported yet. */
export function shouldReportWaitingAccounts(vaultKey: string, ids: readonly string[]): boolean {
  const fingerprint = [...ids].sort().join(" ");
  if (reportedWaitingAccounts.get(vaultKey) === fingerprint) return false;
  reportedWaitingAccounts.set(vaultKey, fingerprint);
  return true;
}

/** Forgets the notice state (the accounts arrived, or the vault was closed). */
export function clearWaitingAccountsNotice(vaultKey: string): void {
  reportedWaitingAccounts.delete(vaultKey);
}

/** The reverse of remapCloudRegistry, for export (local ids → shared ids). */
export function cloudRegistryToLogical(records: readonly CloudAccountRecord[], map: ProfileAccountMap): CloudAccountRecord[] {
  return records.map((record) => ({
    ...record,
    id: map.cloudLocalToLogical[record.id] ?? record.id,
    services: {
      ...record.services,
      ...(record.services.calendar
        ? { calendar: { pimAccountId: map.pimLocalToLogical[record.services.calendar.pimAccountId] ?? record.services.calendar.pimAccountId } }
        : {}),
      ...(record.services.mail
        ? { mail: { mailAccountId: map.mailLocalToLogical[record.services.mail.mailAccountId] ?? record.services.mail.mailAccountId } }
        : {}),
    },
  }));
}
