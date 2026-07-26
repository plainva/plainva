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
  loadAccountMap(): Promise<ProfileAccountMap>;
  saveAccountMap(map: ProfileAccountMap): Promise<void>;
  /** Injectable so tests are deterministic. */
  newId?(): string;
}

export const emptyAccountMap = (): ProfileAccountMap => ({ pimLocalToLogical: {}, mailLocalToLogical: {} });

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
): Promise<{ pim: Map<string, string>; mail: Map<string, string> }> {
  const newId = ports.newId ?? defaultNewId;
  const previousMap = await ports.loadAccountMap();
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

      const calendarPending = Object.fromEntries((selections?.calendars ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));
      const taskPending = Object.fromEntries((selections?.taskLists ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));
      await ports.upsertPimAccount({
        ...imported,
        id: localId,
        config: {
          ...imported.config,
          // The calendars themselves only exist after the first sync of that
          // account, so the choice is parked in the row and applied then.
          ...(Object.keys(calendarPending).length ? { plainvaPendingCalendarSelections: calendarPending } : {}),
          ...(Object.keys(taskPending).length ? { plainvaPendingTaskListSelections: taskPending } : {}),
        },
      });
      for (const cal of await ports.listCalendars(localId)) {
        if (Object.prototype.hasOwnProperty.call(calendarPending, cal.id)) await ports.setCalendarSelected(localId, cal.id, !!calendarPending[cal.id]);
      }
      for (const list of await ports.listTaskLists(localId)) {
        if (Object.prototype.hasOwnProperty.call(taskPending, list.id)) await ports.setTaskListSelected(localId, list.id, !!taskPending[list.id]);
      }
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
      importedRows.push({ ...imported, id: localId });
    }
    const importedIds = new Set(importedRows.map((a) => a.id));
    // Accounts this device has and the document does not are KEPT: the profile
    // is a shared truth, not an authority over what only exists here.
    await ports.replaceMailAccounts([...existing.filter((a) => !importedIds.has(a.id)), ...importedRows]);
  }

  await ports.saveAccountMap({
    pimLocalToLogical: { ...previousMap.pimLocalToLogical, ...Object.fromEntries([...pimMap].map(([logical, local]) => [local, logical])) },
    mailLocalToLogical: { ...previousMap.mailLocalToLogical, ...Object.fromEntries([...mailMap].map(([logical, local]) => [local, logical])) },
  });
  return { pim: pimMap, mail: mailMap };
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

/** The reverse of remapCloudRegistry, for export (local ids → shared ids). */
export function cloudRegistryToLogical(records: readonly CloudAccountRecord[], map: ProfileAccountMap): CloudAccountRecord[] {
  return records.map((record) => ({
    ...record,
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
