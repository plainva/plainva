import {
  normalizeAccountMap,
  normalizeVerifiedProviderIdentity,
  VERIFIED_PROVIDER_IDENTITY_KEY,
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

export interface GuidedAccountRepairSelection {
  accountIds: string[];
  targetId: string;
}

export interface AccountRepairCleanup {
  targetAccountId: string;
  accountIds: string[];
  pimAccountIds: string[];
  mailAccountIds: string[];
}

export interface GuidedAccountRepairPlan extends AccountRepairPlan {
  cleanup: AccountRepairCleanup;
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

function reviewNeeds(accounts: readonly CloudAccountRecord[]): AccountRepairNeed[] {
  const byLabel = new Map<string, CloudAccountRecord[]>();
  for (const account of accounts) {
    const label = account.label.trim().toLocaleLowerCase();
    if (!label) continue;
    const key = `${account.family}\u0000${label}`;
    const group = byLabel.get(key) ?? [];
    group.push(account);
    byLabel.set(key, group);
  }
  return [...byLabel.values()]
    .filter((records) => records.length > 1)
    .map((records) => ({
      reason: "unverified-identity" as const,
      family: records[0].family,
      accountIds: records.map((record) => record.id).sort(),
      affectedServices: [...new Set(records.flatMap(serviceIds))].sort() as CloudServiceId[],
    }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.accountIds.join("\u0000").localeCompare(b.accountIds.join("\u0000")));
}

/** A pair of calendar rows that look like the same account. */
export interface PimDuplicateNeed {
  /**
   * `same-identity` means the provider itself says these are one account —
   * safe to act on. `same-label` is a suspicion: two rows carrying the same
   * name, with nothing to prove it.
   */
  reason: "same-identity" | "same-label";
  provider: string;
  label: string;
  accountIds: string[];
}

/**
 * Duplicate CALENDAR rows, as suggestions — never as an automatic fold.
 *
 * The card repair above folds cloud cards on verified identity and leaves the
 * runtime rows alone on purpose: a calendar row carries the calendar selection,
 * the cached events and the `plainva.pim` anchor of every mirrored task, so
 * merging one blind costs more than the duplicate does. What was missing is
 * that duplicated rows were not surfaced ANYWHERE — the phone kept adding them
 * and nothing ever said so (finding 2026-08-19).
 *
 * Two stages, mirroring the desktop's card rule (E2): a verified identity match
 * is a statement, a label match is a question.
 */
export function reviewDuplicatePimRows(
  rows: readonly { id: string; provider: string; label: string; config?: Record<string, unknown> }[],
): PimDuplicateNeed[] {
  const byIdentity = new Map<string, typeof rows[number][]>();
  const byLabel = new Map<string, typeof rows[number][]>();
  for (const row of rows) {
    const identity = normalizeVerifiedProviderIdentity(row.config?.[VERIFIED_PROVIDER_IDENTITY_KEY]);
    if (identity) {
      const key = `${row.provider}\u0000${verifiedProviderIdentityKey(identity)}`;
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), row]);
      continue;
    }
    const label = row.label.trim().toLocaleLowerCase();
    if (!label) continue;
    const key = `${row.provider}\u0000${label}`;
    byLabel.set(key, [...(byLabel.get(key) ?? []), row]);
  }
  const needs = (
    map: Map<string, typeof rows[number][]>,
    reason: PimDuplicateNeed["reason"],
  ): PimDuplicateNeed[] =>
    [...map.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({
        reason,
        provider: group[0].provider,
        label: group[0].label,
        accountIds: group.map((row) => row.id).sort(),
      }));
  return [...needs(byIdentity, "same-identity"), ...needs(byLabel, "same-label")]
    .sort((a, b) => a.reason.localeCompare(b.reason) || a.accountIds.join("\u0000").localeCompare(b.accountIds.join("\u0000")));
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

  return {
    accounts,
    accountMap: repairedAccountMap(inputMap, repairGroups),
    merges,
    needsReview: reviewNeeds(accounts),
  };
}

/**
 * Builds the explicit source/target plan shown by the guided repair UI. This
 * path may join unverified cards only because a person picked the survivor.
 */
export function planGuidedAccountRepair(
  inputAccounts: readonly CloudAccountRecord[],
  inputMap: ProfileAccountMap,
  selection: GuidedAccountRepairSelection,
  usableBindings: readonly string[],
): GuidedAccountRepairPlan {
  const ids = [...new Set(selection.accountIds)].sort();
  if (ids.length < 2 || !ids.includes(selection.targetId)) {
    throw new Error("invalid-account-repair-selection");
  }
  const records = ids.map((id) => inputAccounts.find((account) => account.id === id));
  if (records.some((record) => !record)) throw new Error("account-repair-card-missing");
  const selected = records as CloudAccountRecord[];
  if (selected.some((record) => record.family !== selected[0].family)) {
    throw new Error("account-repair-family-mismatch");
  }
  const target = selected.find((record) => record.id === selection.targetId)!;
  const usable = new Set(usableBindings);
  const sources = selected.filter((record) => record.id !== target.id);
  const mergedTarget: CloudAccountRecord = {
    ...target,
    services: mergeServices(target, selected, usable),
  };
  const sourceIds = new Set(sources.map((record) => record.id));
  const accounts = inputAccounts
    .filter((account) => !sourceIds.has(account.id))
    .map((account) => account.id === target.id ? mergedTarget : { ...account, services: { ...account.services } });
  const referencedPim = new Set(accounts.flatMap((account) =>
    account.services.calendar ? [account.services.calendar.pimAccountId] : []));
  const referencedMail = new Set(accounts.flatMap((account) =>
    account.services.mail ? [account.services.mail.mailAccountId] : []));
  const sourcePim = sources.flatMap((account) =>
    account.services.calendar ? [account.services.calendar.pimAccountId] : []);
  const sourceMail = sources.flatMap((account) =>
    account.services.mail ? [account.services.mail.mailAccountId] : []);
  const merge: AccountRepairMerge = {
    targetId: target.id,
    sourceIds: sources.map((record) => record.id).sort(),
    affectedServices: [...new Set(selected.flatMap(serviceIds))].sort() as CloudServiceId[],
  };
  return {
    accounts,
    accountMap: repairedAccountMap(inputMap, [{ target, records: selected }]),
    merges: [merge],
    needsReview: reviewNeeds(accounts),
    cleanup: {
      targetAccountId: target.id,
      accountIds: sources.map((record) => record.id).sort(),
      pimAccountIds: [...new Set(sourcePim.filter((id) => !referencedPim.has(id)))].sort(),
      mailAccountIds: [...new Set(sourceMail.filter((id) => !referencedMail.has(id)))].sort(),
    },
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

async function executeAccountRepairPlan<T extends AccountRepairPlan>(
  ports: AccountRepairPorts,
  plan: T,
  afterApply?: (plan: T) => Promise<void>,
): Promise<T> {
  const accounts = await ports.listAccounts();
  const accountMap = normalizeAccountMap(await ports.loadAccountMap());
  const previousNeeds = await ports.loadNeedsReview?.() ?? [];
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
    await afterApply?.(plan);
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

/**
 * Executes one repair transaction. The journal contains registry metadata and
 * mappings only; it never contains credential payloads or raw auth errors.
 */
export async function executeAccountRepair(ports: AccountRepairPorts): Promise<AccountRepairPlan> {
  await recoverAccountRepair(ports);
  const accounts = await ports.listAccounts();
  const accountMap = normalizeAccountMap(await ports.loadAccountMap());
  const plan = planAccountRepair(accounts, accountMap, await ports.usableBindings());
  return executeAccountRepairPlan(ports, plan);
}

export type GuidedAccountRepairResult =
  | { status: "cancelled"; plan: GuidedAccountRepairPlan }
  | { status: "repaired"; plan: GuidedAccountRepairPlan };

/** Confirmation is requested after the complete, non-secret preview exists. */
export async function executeGuidedAccountRepair(
  ports: AccountRepairPorts,
  selection: GuidedAccountRepairSelection,
  confirm: (plan: GuidedAccountRepairPlan) => Promise<boolean>,
  cleanup: (cleanup: AccountRepairCleanup) => Promise<void>,
): Promise<GuidedAccountRepairResult> {
  await recoverAccountRepair(ports);
  const plan = planGuidedAccountRepair(
    await ports.listAccounts(),
    normalizeAccountMap(await ports.loadAccountMap()),
    selection,
    await ports.usableBindings(),
  );
  if (!(await confirm(plan))) return { status: "cancelled", plan };
  await executeAccountRepairPlan(ports, plan, async (applied) => cleanup(applied.cleanup));
  return { status: "repaired", plan };
}
