import type { CloudServiceId } from "./cloudAccounts";
import { withAccountCredentialLock } from "./tokenRefreshCoordinator";

/** Kept only in the OS-protected journal. Snapshots contain passwords. */
export interface PasswordChangeJournal {
  version: 1;
  id: string;
  binding: string;
  targets: { service: CloudServiceId; previous: string; next: string; confirmed: boolean }[];
}

export interface PasswordChangeTarget {
  service: CloudServiceId;
  read(): Promise<string>;
  withPassword(previous: string, password: string): string;
  verify(password: string, previous: string): Promise<void>;
  /** Must compare the current source with expected before writing. */
  write(expected: string, next: string): Promise<void>;
}

export interface PasswordChangeStatus {
  phase: "verifying" | "saving" | "repair" | "complete";
  services: Partial<Record<CloudServiceId, "waiting" | "confirmed" | "failed">>;
}

export interface PasswordChangePorts {
  key: string;
  binding: string;
  readBinding(): Promise<string>;
  targets(): Promise<PasswordChangeTarget[]>;
  /** Strict storage: unavailable or corrupt is an error, never null. */
  journal: {
    read(): Promise<unknown | null>;
    write(value: PasswordChangeJournal, expected: PasswordChangeJournal | null): Promise<void>;
    clear(expected: PasswordChangeJournal): Promise<void>;
  };
  onStatus?(status: PasswordChangeStatus): void;
  /** Wake consumers only after all stored values are confirmed. Retryable. */
  activate?(): Promise<void>;
}

export class PasswordChangeError extends Error {
  constructor(readonly phase: "verification" | "storage" | "changed" | "pending" | "missing", readonly service?: CloudServiceId) {
    super(`Password change could not finish (${phase})`);
    this.name = "PasswordChangeError";
  }
}

export function parsePasswordChangeJournal(value: unknown): PasswordChangeJournal {
  if (!value || typeof value !== "object") throw new PasswordChangeError("storage");
  const j = value as PasswordChangeJournal;
  if (j.version !== 1 || typeof j.id !== "string" || !j.id || typeof j.binding !== "string" || !j.binding
    || !Array.isArray(j.targets) || j.targets.length < 1 || j.targets.length > 3
    || new Set(j.targets.map((t) => t?.service)).size !== j.targets.length
    || j.targets.some((t) => !t || !["files", "calendar", "mail"].includes(t.service)
      || typeof t.previous !== "string" || typeof t.next !== "string" || typeof t.confirmed !== "boolean")) {
    throw new PasswordChangeError("storage");
  }
  return structuredClone(j);
}

/** Public status contains no endpoint, user name, password or snapshot. */
export function passwordChangeStatus(journal: PasswordChangeJournal): PasswordChangeStatus {
  return { phase: "repair", services: Object.fromEntries(journal.targets.map((t) => [t.service, t.confirmed ? "confirmed" : "waiting"])) };
}

async function readJournal(ports: PasswordChangePorts): Promise<PasswordChangeJournal | null> {
  try {
    const value = await ports.journal.read();
    return value === null ? null : parsePasswordChangeJournal(value);
  } catch { throw new PasswordChangeError("storage"); }
}

async function sameBinding(ports: PasswordChangePorts): Promise<void> {
  if (await ports.readBinding() !== ports.binding) throw new PasswordChangeError("changed");
}

async function checkpoint(ports: PasswordChangePorts, value: PasswordChangeJournal, expected: PasswordChangeJournal | null): Promise<void> {
  try {
    await ports.journal.write(structuredClone(value), expected);
    if (JSON.stringify(await readJournal(ports)) !== JSON.stringify(value)) throw new Error("unconfirmed journal");
  } catch { throw new PasswordChangeError("storage"); }
}

function orderedTargets(journal: PasswordChangeJournal, targets: PasswordChangeTarget[]): PasswordChangeTarget[] {
  if (targets.length !== journal.targets.length || new Set(targets.map((t) => t.service)).size !== targets.length) {
    throw new PasswordChangeError("changed");
  }
  return journal.targets.map((stored) => {
    const target = targets.find((t) => t.service === stored.service);
    if (!target) throw new PasswordChangeError("changed", stored.service);
    return target;
  });
}

async function finish(ports: PasswordChangePorts, journal: PasswordChangeJournal, targets: PasswordChangeTarget[]): Promise<void> {
  if (journal.binding !== ports.binding) throw new PasswordChangeError("changed");
  const ordered = orderedTargets(journal, targets);
  const status = passwordChangeStatus(journal);
  status.phase = "saving";
  ports.onStatus?.(structuredClone(status));
  for (let i = 0; i < ordered.length; i++) {
    const target = ordered[i], stored = journal.targets[i];
    try {
      await sameBinding(ports);
      const current = await target.read();
      // The write may have succeeded just before the process or its journal
      // checkpoint failed. Confirm it without repeating it or rolling it back.
      if (current !== stored.next) {
        if (current !== stored.previous || stored.confirmed) throw new PasswordChangeError("changed", target.service);
        await target.write(stored.previous, stored.next);
        if (await target.read() !== stored.next) throw new PasswordChangeError("storage", target.service);
      }
      const previous = structuredClone(journal);
      stored.confirmed = true;
      await checkpoint(ports, journal, previous);
      status.services[target.service] = "confirmed";
      ports.onStatus?.(structuredClone(status));
    } catch (error) {
      status.phase = "repair";
      status.services[target.service] = "failed";
      ports.onStatus?.(structuredClone(status));
      throw error instanceof PasswordChangeError ? error : new PasswordChangeError("storage", target.service);
    }
  }
  await sameBinding(ports);
  for (let i = 0; i < ordered.length; i++) {
    if (await ordered[i].read() !== journal.targets[i].next) throw new PasswordChangeError("changed", ordered[i].service);
  }
  await ports.activate?.();
  try {
    await ports.journal.clear(journal);
    if (await ports.journal.read() !== null) throw new Error("unconfirmed cleanup");
  } catch { throw new PasswordChangeError("storage"); }
  ports.onStatus?.({ ...status, phase: "complete" });
}

export function beginPasswordChange(ports: PasswordChangePorts, password: string): Promise<void> {
  return withAccountCredentialLock(`password-change:${ports.key}`, async () => {
    if (await readJournal(ports)) throw new PasswordChangeError("pending");
    await sameBinding(ports);
    const targets = await ports.targets();
    if (!targets.length) throw new PasswordChangeError("missing");
    const journal: PasswordChangeJournal = { version: 1, id: crypto.randomUUID(), binding: ports.binding, targets: [] };
    const status: PasswordChangeStatus = { phase: "verifying", services: {} };
    for (const target of targets) {
      status.services[target.service] = "waiting";
      ports.onStatus?.(structuredClone(status));
      const previous = await target.read();
      try { await target.verify(password, previous); }
      catch {
        status.services[target.service] = "failed";
        ports.onStatus?.(structuredClone(status));
        throw new PasswordChangeError("verification", target.service);
      }
      journal.targets.push({ service: target.service, previous, next: target.withPassword(previous, password), confirmed: false });
    }
    await sameBinding(ports);
    for (let i = 0; i < targets.length; i++) {
      if (await targets[i].read() !== journal.targets[i].previous) throw new PasswordChangeError("changed", targets[i].service);
    }
    // A durable, read-back intent always precedes the first credential write.
    await checkpoint(ports, parsePasswordChangeJournal(journal), null);
    await finish(ports, journal, targets);
  });
}

export function resumePasswordChange(ports: PasswordChangePorts): Promise<void> {
  return withAccountCredentialLock(`password-change:${ports.key}`, async () => {
    const journal = await readJournal(ports);
    if (!journal) throw new PasswordChangeError("missing");
    await finish(ports, journal, await ports.targets());
  });
}

export async function readPasswordChangeStatus(ports: Pick<PasswordChangePorts, "journal" | "binding">): Promise<PasswordChangeStatus | null> {
  const raw = await ports.journal.read();
  if (raw === null) return null;
  const journal = parsePasswordChangeJournal(raw);
  if (journal.binding !== ports.binding) throw new PasswordChangeError("changed");
  return passwordChangeStatus(journal);
}
