import {
  normalizeAccountMap,
  normalizeVerifiedProviderIdentity,
  verifiedProviderIdentityKey,
  type ProfileAccountMap,
} from "./accountProfile.js";
import type {
  CloudAccountRecord,
  CloudAccountServices,
  CloudProviderFamily,
  CloudServiceId,
} from "./cloudAccounts.js";

/**
 * Account-card repair is deliberately narrower than subsystem cleanup.
 *
 * A card only groups references to the PIM, mail and file-sync runtimes. Exact
 * provider identity makes two cards safe to fold into one. The losing runtime
 * rows, caches and credential slots are intentionally left untouched so a
 * later, confirmed cleanup can remove them independently.
 */

export type AccountRepairBindingKind = "account" | "pim" | "mail" | "files";

export function accountRepairBindingKey(kind: AccountRepairBindingKind, id: string): string {
  return `${kind}:${id}`;
}

export interface AccountRepairMerge {
  targetId: string;
  sourceIds: string[];
  affectedServices: CloudServiceId[];
}

export interface AccountRepairNeed {
  reason: "unverified-identity";
  family: CloudProviderFamily;
  accountIds: string[];
  affectedServices: CloudServiceId[];
}

export interface AccountRepairPlan {
  accounts: CloudAccountRecord[];
  accountMap: ProfileAccountMap;
  merges: AccountRepairMerge[];
  needsReview: AccountRepairNeed[];
}

export interface AccountRepairSnapshot {
  accounts: CloudAccountRecord[];
  accountMap: ProfileAccountMap;
  needsReview: AccountRepairNeed[];
}

export interface AccountRepairJournal {
  version: 1;
  startedAt: string;
  snapshot: AccountRepairSnapshot;
  merges: AccountRepairMerge[];
}

export interface AccountRepairPorts {
  listAccounts(): Promise<CloudAccountRecord[]>;
  replaceAccounts(accounts: CloudAccountRecord[]): Promise<void>;
  loadAccountMap(): Promise<ProfileAccountMap>;
  saveAccountMap(map: ProfileAccountMap): Promise<void>;
  /** Presence/health only. Secret payloads must never cross this boundary. */
  usableBindings(): Promise<readonly string[]>;
  loadJournal(): Promise<AccountRepairJournal | null>;
  saveJournal(journal: AccountRepairJournal): Promise<void>;
  clearJournal(): Promise<void>;
  loadNeedsReview?(): Promise<AccountRepairNeed[]>;
  saveNeedsReview(needs: AccountRepairNeed[]): Promise<void>;
  now?(): string;
}

const SERVICE_ORDER: readonly CloudServiceId[] = ["calendar", "files", "mail"];

function serviceIds(record: CloudAccountRecord): CloudServiceId[] {
  return SERVICE_ORDER.filter((service) => !!record.services[service]);
}

function repairIdentity(record: CloudAccountRecord): string | null {
  const identity = normalizeVerifiedProviderIdentity(record.verifiedProviderIdentity);
  return identity
    ? `${record.family}\u0000${verifiedProviderIdentityKey(identity)}`
    : null;
}

function serviceBinding(service: CloudServiceId, services: CloudAccountServices): string | null {
  if (service === "calendar" && services.calendar) {
    return accountRepairBindingKey("pim", services.calendar.pimAccountId);
  }
  if (service === "mail" && services.mail) {
    return accountRepairBindingKey("mail", services.mail.mailAccountId);
  }
  if (service === "files" && services.files) {
    return accountRepairBindingKey("files", services.files.provider);
  }
  return null;
}

function score(record: CloudAccountRecord, usable: ReadonlySet<string>): number {
  let value = usable.has(accountRepairBindingKey("account", record.id)) ? 1_000 : 0;
  for (const service of serviceIds(record)) {
    const binding = serviceBinding(service, record.services);
    if (binding && usable.has(binding)) value += 100;
    value += 1;
  }
  return value;
}

function selectTarget(records: readonly CloudAccountRecord[], usable: ReadonlySet<string>): CloudAccountRecord {
  return [...records].sort((left, right) => {
    const scoreDiff = score(right, usable) - score(left, usable);
    return scoreDiff || left.id.localeCompare(right.id);
  })[0];
}

function mergeServices(
  target: CloudAccountRecord,
  records: readonly CloudAccountRecord[],
  usable: ReadonlySet<string>,
): CloudAccountServices {
  const services: CloudAccountServices = { ...target.services };
  for (const service of SERVICE_ORDER) {
    const candidates = records.filter((record) => !!record.services[service]);
    if (candidates.length === 0) continue;
    const currentBinding = serviceBinding(service, services);
    const selected = currentBinding && usable.has(currentBinding)
      ? target
      : candidates.find((record) => {
          const binding = serviceBinding(service, record.services);
          return !!binding && usable.has(binding);
        }) ?? candidates.find((record) => record.id === target.id) ?? candidates[0];
    if (service === "calendar" && selected.services.calendar) {
      services.calendar = { ...selected.services.calendar };
    } else if (service === "mail" && selected.services.mail) {
      services.mail = { ...selected.services.mail };
    } else if (service === "files" && selected.services.files) {
      services.files = { ...selected.services.files };
    }
  }
  return services;
}

function resolveAlias(aliases: Record<string, string> | undefined, logicalId: string): string {
  let current = logicalId;
  const visited = new Set<string>();
  while (aliases?.[current] && !visited.has(current)) {
    visited.add(current);
    current = aliases[current];
  }
  return current;
}

function repairedAccountMap(
  input: ProfileAccountMap,
  groups: readonly { target: CloudAccountRecord; records: CloudAccountRecord[] }[],
): ProfileAccountMap {
  const map = normalizeAccountMap(input);
  const aliases = { ...(map.cloudLogicalAliases ?? {}) };
  for (const { target, records } of groups) {
    const targetLogical = resolveAlias(aliases, map.cloudLocalToLogical[target.id] ?? target.id);
    for (const record of records) {
      const logical = resolveAlias(aliases, map.cloudLocalToLogical[record.id] ?? record.id);
      delete map.cloudLocalToLogical[record.id];
      if (logical !== targetLogical) aliases[logical] = targetLogical;
    }
    map.cloudLocalToLogical[target.id] = targetLogical;
  }
  for (const [source, target] of Object.entries(aliases)) {
    aliases[source] = resolveAlias(aliases, target);
    if (source === aliases[source]) delete aliases[source];
  }
  if (Object.keys(aliases).length > 0) map.cloudLogicalAliases = aliases;
  else delete map.cloudLogicalAliases;
  return map;
}

/**
 * Pure repair planner. It never guesses from a label: labels are used only to
 * surface review work after exact provider-identity groups have been folded.
 */
export function planAccountRepair(
  inputAccounts: readonly CloudAccountRecord[],
  inputMap: ProfileAccountMap,
  usableBindings: readonly string[],
): AccountRepairPlan {
  const usable = new Set(usableBindings);
  const byIdentity = new Map<string, CloudAccountRecord[]>();
  for (const account of inputAccounts) {
    const identity = repairIdentity(account);
    if (!identity) continue;
    const group = byIdentity.get(identity) ?? [];
    group.push(account);
    byIdentity.set(identity, group);
  }

  const repairGroups = [...byIdentity.values()]
    .filter((records) => records.length > 1)
    .map((records) => {
      const target = selectTarget(records, usable);
      return { target, records: [...records].sort((a, b) => a.id.localeCompare(b.id)) };
    })
    .sort((a, b) => a.target.id.localeCompare(b.target.id));
  const sourceIds = new Set(repairGroups.flatMap(({ target, records }) =>
    records.filter((record) => record.id !== target.id).map((record) => record.id)));
  const mergedByTarget = new Map(repairGroups.map(({ target, records }) => [
    target.id,
    {
      ...target,
      services: mergeServices(target, records, usable),
    },
  ]));
  const accounts = inputAccounts
    .filter((account) => !sourceIds.has(account.id))
    .map((account) => mergedByTarget.get(account.id) ?? { ...account, services: { ...account.services } });

  const merges = repairGroups.map(({ target, records }) => ({
    targetId: target.id,
    sourceIds: records.filter((record) => record.id !== target.id).map((record) => record.id),
    affectedServices: [...new Set(records.flatMap(serviceIds))].sort() as CloudServiceId[],
  }));

  const byLabel = new Map<string, CloudAccountRecord[]>();
  for (const account of accounts) {
    const label = account.label.trim().toLocaleLowerCase();
    if (!label) continue;
    const key = `${account.family}\u0000${label}`;
    const group = byLabel.get(key) ?? [];
    group.push(account);
    byLabel.set(key, group);
  }
  const needsReview: AccountRepairNeed[] = [...byLabel.values()]
    .filter((records) => records.length > 1)
    .map((records) => ({
      reason: "unverified-identity" as const,
      family: records[0].family,
      accountIds: records.map((record) => record.id).sort(),
      affectedServices: [...new Set(records.flatMap(serviceIds))].sort() as CloudServiceId[],
    }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.accountIds.join("\u0000").localeCompare(b.accountIds.join("\u0000")));

  return {
    accounts,
    accountMap: repairedAccountMap(inputMap, repairGroups),
    merges,
    needsReview,
  };
}

/** Restores a repair interrupted after the journal became durable. */
export async function recoverAccountRepair(ports: AccountRepairPorts): Promise<boolean> {
  const journal = await ports.loadJournal();
  if (!journal || journal.version !== 1) return false;
  await ports.replaceAccounts(journal.snapshot.accounts);
  await ports.saveAccountMap(journal.snapshot.accountMap);
  await ports.saveNeedsReview(journal.snapshot.needsReview);
  await ports.clearJournal();
  return true;
}

/**
 * Executes one repair transaction. The journal contains registry metadata and
 * mappings only; it never contains credential payloads or raw auth errors.
 */
export async function executeAccountRepair(ports: AccountRepairPorts): Promise<AccountRepairPlan> {
  await recoverAccountRepair(ports);
  const accounts = await ports.listAccounts();
  const accountMap = normalizeAccountMap(await ports.loadAccountMap());
  const previousNeeds = await ports.loadNeedsReview?.() ?? [];
  const plan = planAccountRepair(accounts, accountMap, await ports.usableBindings());

  if (plan.merges.length === 0) {
    await ports.saveNeedsReview(plan.needsReview);
    return plan;
  }

  const journal: AccountRepairJournal = {
    version: 1,
    startedAt: ports.now?.() ?? new Date().toISOString(),
    snapshot: {
      accounts,
      accountMap,
      needsReview: previousNeeds,
    },
    merges: plan.merges,
  };
  await ports.saveJournal(journal);
  try {
    await ports.replaceAccounts(plan.accounts);
    await ports.saveAccountMap(plan.accountMap);
    await ports.saveNeedsReview(plan.needsReview);
    await ports.clearJournal();
    return plan;
  } catch (error) {
    await ports.replaceAccounts(journal.snapshot.accounts);
    await ports.saveAccountMap(journal.snapshot.accountMap);
    await ports.saveNeedsReview(journal.snapshot.needsReview);
    await ports.clearJournal();
    throw error;
  }
}
