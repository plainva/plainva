import { sameStoredValue } from "@plainva/core";
import { FAMILY_SERVICES, getPlatformServices, withAccountCredentialLock, withSkipped, type CloudProviderFamily, type CloudServiceId, type ServiceConnectionContext, type ServiceConnectionOutcome } from "@plainva/ui";
import { clearConnectSecrets } from "./connectSecrets";
import { getActiveVaultEntry } from "./vaultRegistry";

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];
const KEY = "mobileConnectQueue";
export const CONNECT_RUN_EVENT = "m-connect-run-changed";
export const QUEUE_TTL_MS = 30 * 60 * 1000;

/** Non-secret intent: only an exact, committed binding advances a step. */
export interface ConnectQueue {
  id: string;
  family: CloudProviderFamily;
  context: ServiceConnectionContext;
  pending: CloudServiceId[];
  done: CloudServiceId[];
  /** Left out by the person on the way ("Skip calendar"); absent in runs saved before skipping existed. */
  skipped?: CloudServiceId[];
  outcomes: Partial<Record<CloudServiceId, ServiceConnectionOutcome>>;
  /**
   * Whether the run's sign-in has happened (settings plan 2026-10-29, § 5.1).
   * Google and Microsoft start their run after it; Dropbox, the providers with
   * credentials and S3 start it before - the frame says "Signed in" only once
   * one took place. Absent in runs saved before = signed in.
   */
  signedIn?: boolean;
  /** Nextcloud is WebDAV with a name of its own: the frame and the card say it. */
  flavor?: "nextcloud";
  /** A new vault in the cloud (the "new vault" door): the files step scaffolds this template ("" = empty). */
  createTemplateId?: string;
  selectionConfirmed: boolean;
  createdAt: number;
  preparedVaultId?: string;
  preparedDestinationKey?: string;
  sourceVaultId?: string;
}

/** What a run knows from its start besides its services. */
export interface ConnectQueueOptions {
  signedIn?: boolean;
  flavor?: "nextcloud";
  createTemplateId?: string;
  /** Services the sign-in could not reach: the run leaves them out, as skipped. */
  skipped?: readonly CloudServiceId[];
}

export function buildQueue(family: CloudProviderFamily, services: readonly CloudServiceId[], now: number, context: ServiceConnectionContext = { vaultId: "" }, options: ConnectQueueOptions = {}): ConnectQueue | null {
  const offered = SERVICE_ORDER.filter(s => services.includes(s) && FAMILY_SERVICES[family].includes(s));
  const skipped = offered.filter(s => (options.skipped ?? []).includes(s));
  const pending = offered.filter(s => !skipped.includes(s));
  if (!pending.length) return null;
  const id = crypto.randomUUID();
  return {
    id, family, context: { ...context, runId: id }, pending, done: [], skipped, outcomes: {}, selectionConfirmed: false, createdAt: now, sourceVaultId: context.vaultId,
    ...(options.signedIn === false ? { signedIn: false } : {}),
    ...(options.flavor ? { flavor: options.flavor } : {}),
    ...(options.createTemplateId !== undefined ? { createTemplateId: options.createTemplateId } : {}),
  };
}
export function nextService(queue: ConnectQueue | null): CloudServiceId | null { return queue?.pending[0] ?? null; }
export function runServices(queue: ConnectQueue): CloudServiceId[] { return SERVICE_ORDER.filter(s => queue.done.includes(s) || queue.pending.includes(s) || (queue.skipped ?? []).includes(s)); }
/**
 * A run with a prepared destination waits for it; a FINISHED run does not -
 * its summary left without "Done" goes after the same limit, counted from
 * when its last step ended (second review 2026-10-28).
 */
export function isExpired(queue: ConnectQueue, now: number): boolean { return now < queue.createdAt || ((!queue.preparedVaultId || queue.pending.length === 0) && now - queue.createdAt >= QUEUE_TTL_MS); }
/** The last step done or skipped: the summary's time limit starts now. */
function stampFinished(queue: ConnectQueue): ConnectQueue { return queue.pending.length === 0 ? { ...queue, createdAt: Date.now() } : queue; }
export function withCompleted(queue: ConnectQueue | null, service: CloudServiceId): ConnectQueue | null {
  if (!queue || queue.pending[0] !== service) return queue;
  return { ...queue, pending: queue.pending.slice(1), done: [...queue.done, service], selectionConfirmed: false };
}
export function outcomeBelongsToRun(queue: ConnectQueue, context: ServiceConnectionContext, service: CloudServiceId): boolean {
  return queue.id === context.runId && queue.context.vaultId === context.vaultId && queue.context.cloudAccountId === context.cloudAccountId && queue.pending[0] === service;
}

let current: ConnectQueue | null = null;
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CONNECT_RUN_EVENT)); }
async function persist(queue: ConnectQueue | null): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  if (queue) await store.set(KEY, queue); else await store.delete(KEY);
  await store.save();
  const saved = await store.get<ConnectQueue>(KEY);
  if (!sameStoredValue(saved ?? null, queue)) throw new Error("Connection progress could not be saved");
  current = queue;
  if (!queue) clearConnectSecrets();
  changed();
}
export async function loadConnectQueue(): Promise<ConnectQueue | null> {
  const stored = current ?? await (await getPlatformServices().loadSettings()).get<ConnectQueue>(KEY);
  if (!stored) return null;
  if (!stored.id || !stored.context?.vaultId || !Array.isArray(stored.pending) || !Array.isArray(stored.done) || !stored.outcomes || isExpired(stored, Date.now())) {
    await persist(null);
    return null;
  }
  current = stored;
  return stored;
}
export async function startConnectQueue(family: CloudProviderFamily, services: readonly CloudServiceId[], context?: ServiceConnectionContext, options?: ConnectQueueOptions): Promise<CloudServiceId | null> {
  const target = context ?? { vaultId: (await getActiveVaultEntry()).id };
  const queue = buildQueue(family, services, Date.now(), target, options);
  await persist(queue);
  return nextService(queue);
}

/**
 * The run's sign-in took place (Dropbox's consent came back): "Signed in" and
 * the done step show from now on. Only the run the sign-in belongs to.
 */
export async function markConnectSignedIn(context: ServiceConnectionContext | undefined): Promise<void> {
  if (!context?.runId) return;
  await withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    if (!q || q.id !== context.runId || q.signedIn !== false) return;
    await persist({ ...q, signedIn: true });
  });
}
export async function connectionContextFor(service: CloudServiceId): Promise<ServiceConnectionContext | undefined> {
  const q = await loadConnectQueue();
  return q?.pending[0] === service ? { ...q.context } : undefined;
}
/** Whether the outcome was written: only into the run it belongs to. */
export async function recordConnectOutcome(context: ServiceConnectionContext | undefined, service: CloudServiceId, outcome: ServiceConnectionOutcome): Promise<boolean> {
  if (!context?.runId) return false;
  return withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    if (!q || !outcomeBelongsToRun(q, context, service)) return false;
    await persist({ ...q, outcomes: { ...q.outcomes, [service]: outcome } });
    return true;
  });
}
export async function confirmConnectSelection(): Promise<void> {
  await withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    if (q?.pending[0] === "calendar" && ["connected", "alreadyConnected"].includes(q.outcomes.calendar?.state ?? "")) await persist({ ...q, selectionConfirmed: true });
  });
}
/** Reads committed results; account-list counts never authorize progression. */
export async function advanceOnAccountsChanged(service: CloudServiceId): Promise<{ advanced: boolean; next: CloudServiceId | null; queue: ConnectQueue | null }> {
  return withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    if (!q || q.pending[0] !== service || !["connected", "alreadyConnected"].includes(q.outcomes[service]?.state ?? "") || (service === "calendar" && !q.selectionConfirmed)) return { advanced: false, next: null, queue: q };
    const next = withCompleted(q, service);
    await persist(next && stampFinished(next));
    return { advanced: true, next: nextService(next), queue: next };
  });
}
/** Record the files destination before copying; retry always reuses it. */
export async function prepareConnectVault(context: ServiceConnectionContext, targetVaultId: string, destinationKey?: string): Promise<void> {
  const q = await loadConnectQueue();
  if (!q || !outcomeBelongsToRun(q, context, "files")) throw new Error("Connection destination changed");
  if (q.preparedVaultId && q.preparedVaultId !== targetVaultId) throw new Error("Connection already has a destination");
  if (q.preparedDestinationKey && q.preparedDestinationKey !== destinationKey) throw new Error("transfer_destination_changed");
  await persist({ ...q, preparedVaultId: targetVaultId, preparedDestinationKey: destinationKey });
}
/**
 * The copy into a prepared destination was turned down - another folder, or
 * stop (review 2026-10-28): the run forgets the destination, so the next pick
 * prepares its own instead of failing as "destination changed", and a run
 * without one expires again like any other.
 */
export async function releaseConnectVault(context: ServiceConnectionContext, targetVaultId: string): Promise<void> {
  await withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    // The run's own, wherever it stands now (the host may answer for a run already past its files step).
    if (!q || q.id !== context.runId || q.preparedVaultId !== targetVaultId) return;
    // A copy that went through is never taken back (fourth review 2026-10-28).
    if (q.outcomes.files?.state === "connected") return;
    // Without a destination the 30-minute limit applies again - counted from
    // now, not from a start the person spent in the review. The files step's
    // old outcome is past too: the question is asked again.
    const next: ConnectQueue = { ...q, createdAt: Date.now(), outcomes: { ...q.outcomes } };
    delete next.preparedVaultId;
    delete next.preparedDestinationKey;
    delete next.outcomes.files;
    await persist(next);
  });
}
export async function finishConnectVault(context: ServiceConnectionContext, targetVaultId: string, cloudAccountId?: string): Promise<void> {
  const q = await loadConnectQueue();
  if (!q || !outcomeBelongsToRun(q, context, "files")) throw new Error("Connection destination changed");
  await persist({ ...q, context: { ...q.context, vaultId: targetVaultId, cloudAccountId: cloudAccountId ?? q.context.cloudAccountId }, outcomes: { ...q.outcomes, files: { state: "connected", bindingId: targetVaultId } } });
}
export async function clearConnectQueue(): Promise<void> { await persist(null); }
/**
 * "Skip calendar" (plan "Verbinden-Assistent", E6): the step leaves the run
 * without being done, and the run goes on with the next one - or to its
 * summary, which names it as skipped. Only the step on screen can be skipped.
 */
export async function skipConnectStep(service: CloudServiceId): Promise<void> {
  await withAccountCredentialLock(KEY, async () => {
    const q = await loadConnectQueue();
    if (!q || q.pending[0] !== service) return;
    await persist(stampFinished({ ...withSkipped(q, service), selectionConfirmed: false }));
  });
}
