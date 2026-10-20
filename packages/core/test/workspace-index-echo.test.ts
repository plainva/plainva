import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  PermissionedVaultAdapter,
  SqlWorkspaceStateStore,
  VaultIndexer,
  WorkspaceQueueingVaultAdapter,
  acceptWorkspacePairing,
  approveWorkspacePairing,
  createPersonalWorkspaceBootstrap,
  createWorkspaceObjectId,
  createWorkspacePairingRequest,
  evaluateWorkspaceAccess,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  publishWorkspaceGovernanceUpdate,
  workspaceDocumentHash,
  workspaceSliceIdsForObject,
  type IDatabaseAdapter,
  type PersonalWorkspaceRuntime,
  type WorkspaceMutationAuthorizationRequest,
  type WorkspacePolicyPayload,
} from "../src/index.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * What the worker of an encrypted workspace brings from another device is
 * not a change of this one (finding 2026-10-12).
 *
 * The worker writes what it pulls to the disk itself, and the index, looking
 * at the file next, reports a change like any other — it sees files, not who
 * wrote them. Both shells hand such a report to the workspace: the member's
 * rights are asked (`PermissionedVaultAdapter.authorizeExternalChange`), and
 * what may go is queued. The desktop kept a list of the paths the worker had
 * just written and dropped the next report for each; the phone had nothing.
 * So on the phone every note another device changed was queued again and
 * went back up as a revision of the same text. When that device changed the
 * note once more before the phone's revision arrived, the phone kept the
 * older text and put the newer one into a conflict copy, and the other device
 * got a conflict copy of the older one: two devices that disagree over an
 * edit made once. A member who may only read got a "permission-denied" copy
 * of every note somebody else changed, and a record for every one somebody
 * deleted.
 *
 * Both shells build the adapter as these devices do: on the vault below the
 * index, with the workspace's state, the policy's answer and a copy kept for
 * a change the member may not make. The index of each device is told of
 * every path its worker wrote, as both shells tell theirs, and its reports go
 * where both shells send them.
 */

const AT = "2026-10-12T08:00:00.000Z";

/** A vault that says when a file was written — to put the index between the worker's write and its record. */
class WatchedVault extends MemoryVaultAdapter {
  onWrite?: (path: string) => void;
  override async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await super.writeBinaryFile(path, content);
    this.onWrite?.(path);
  }
}

interface Device {
  vault: WatchedVault;
  state: SqlWorkspaceStateStore;
  /** One sync cycle, and the index told of every path the worker wrote. */
  cycle(): Promise<void>;
  /** One sync cycle whose report to the index is lost — the app closed before it got there. */
  cycleUnheard(): Promise<void>;
  /** The app's own save: queued by the workspace's write link, as in both shells. */
  edit(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** A change made outside Plainva, and the index finding it. */
  editOutside(path: string, text: string): Promise<void>;
  deleteOutside(path: string): Promise<void>;
  /** The index's full scan, as at the next start of the app. */
  rescan(): Promise<void>;
  /** The index reporting a change of `path` this moment, as a pass that meets the file does. */
  reportNow(path: string): void;
  queued(): Promise<string[]>;
  /** How many operations this device has signed itself. */
  sequence(): Promise<number>;
  /** The copies kept because the member may not make a change. */
  forks(): Promise<string[]>;
  text(path: string): Promise<string | null>;
  conflictCopies(): Promise<string[]>;
}

/** A member who may only read: the same policy with every assignment a Reader's. */
function readingPolicy(payload: WorkspacePolicyPayload): WorkspacePolicyPayload {
  const policy = structuredClone(payload);
  for (const assignment of policy.assignments) {
    assignment.role = "Reader";
    assignment.capabilities = ["comment.read", "content.read", "history.read"];
  }
  return policy;
}

const isInternal = (path: string) => path.startsWith(".plainva") || path.includes(".CONFLICT");

async function device(
  runtime: PersonalWorkspaceRuntime,
  store: FakeWorkspaceObjectStore,
  files: Record<string, string>,
  closing: Array<() => Promise<void>>,
  options: { reads?: boolean } = {},
): Promise<Device> {
  const db: IDatabaseAdapter = await realSqlite();
  closing.push(() => db.close());
  const state = new SqlWorkspaceStateStore(db);
  const vault = new WatchedVault();
  for (const [path, text] of Object.entries(files)) await vault.writeTextFile(path, text);
  await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: AT });
  const worker = new EncryptedWorkspaceWorker(store, state, vault, runtime);

  const policy = () => (options.reads ? readingPolicy(runtime.policy.payload) : runtime.policy.payload);
  const authorize = async (request: WorkspaceMutationAuthorizationRequest) => {
    const existing = await state.getObjectByPath(request.path);
    const objectId = existing?.objectId ?? createWorkspaceObjectId();
    const object = { objectId, path: request.path, contentKind: existing?.contentKind };
    return evaluateWorkspaceAccess(policy(), {
      memberId: runtime.memberId,
      deviceId: runtime.device.publicIdentity.deviceId,
      capability: request.capability,
      objectId,
      sliceIds: workspaceSliceIdsForObject(policy(), object),
      object,
      objectAuthorMemberId: existing?.authorMemberId ?? null,
    });
  };
  const keepCopy = async (request: WorkspaceMutationAuthorizationRequest) => {
    const forkId = createWorkspaceObjectId();
    const forkPath = `.plainva/workspace/forks/${forkId}-${request.path.split("/").pop()}`;
    if (await vault.exists(request.path)) await vault.writeBinaryFile(forkPath, await vault.readBinaryFile(request.path));
    await state.saveLocalFork({ forkId, originalPath: request.path, forkPath, reason: "permission-denied", createdAt: AT });
  };
  const permissioned = new PermissionedVaultAdapter(vault, state, authorize, keepCopy);
  const writes = new WorkspaceQueueingVaultAdapter(permissioned, state);

  // Where both shells send what the index reports.
  let reporting = false;
  const pending: Promise<unknown>[] = [];
  const report = (path: string, exists: boolean) => {
    if (!reporting || isInternal(path)) return;
    pending.push(permissioned.authorizeExternalChange(path, exists).then((allowed) =>
      allowed ? state.enqueue(exists ? "write" : "delete", path) : undefined));
  };
  const indexer = new VaultIndexer(vault, db, {
    onExternalModification: (path) => report(path, true),
    onNewLocalFile: (path) => report(path, true),
    onLocalFileDeleted: (path) => report(path, false),
  });
  // The index learns of every path the worker wrote, one at a time, the way
  // the phone's door does it (MobileVault.reindexPaths).
  const tell = async (paths: readonly string[]) => {
    for (const path of paths) {
      if (await vault.exists(path)) await indexer.indexFile(await vault.getFileInfo(path));
      else await indexer.indexPath(path);
    }
  };
  let heard = true;
  worker.onFilesChanged = (paths) => { if (heard) pending.push(tell(paths)); };
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };

  await indexer.indexVaultFull("open, empty index");
  await worker.runCycle();
  await settle();
  // Both shells report what the index finds only once the first index pass
  // and the first sync are through.
  reporting = true;

  return {
    vault,
    state,
    cycle: async () => { await worker.runCycle(); await settle(); },
    cycleUnheard: async () => { heard = false; try { await worker.runCycle(); } finally { heard = true; } await settle(); },
    edit: async (path, text) => { await writes.writeTextFile(path, text); },
    remove: async (path) => { await writes.deleteItem(path); },
    editOutside: async (path, text) => { await vault.writeTextFile(path, text); await tell([path]); await settle(); },
    deleteOutside: async (path) => { await vault.deleteItem(path); await tell([path]); await settle(); },
    rescan: async () => { await indexer.indexVaultFull("open"); await settle(); },
    reportNow: (path) => report(path, true),
    queued: async () => (await state.listQueue()).map((item) => `${item.operation} ${item.path}`),
    sequence: async () => (await state.loadMeta())?.sequence ?? 0,
    forks: async () => (await state.listLocalForks()).map((fork) => fork.originalPath).sort(),
    text: async (path) => ((await vault.exists(path)) ? vault.readTextFile(path) : null),
    conflictCopies: async () => (await vault.listDir("", true)).map((entry) => entry.path).filter((path) => path.includes(".CONFLICT")).sort(),
  };
}

/** A second device of the same member — "my phone on my vault". */
async function pairPhone(runtime: PersonalWorkspaceRuntime, store: FakeWorkspaceObjectStore): Promise<PersonalWorkspaceRuntime> {
  const created = await createWorkspacePairingRequest({ workspaceId: runtime.workspaceId, workspaceFingerprint: workspaceDocumentHash(runtime.genesis), memberId: runtime.memberId, deviceDisplayName: "Phone", platform: "android", now: AT });
  const previousPolicy = runtime.policy;
  const approval = await approveWorkspacePairing({ token: created.token, runtime, now: AT });
  await publishWorkspaceGovernanceUpdate(store, approval);
  runtime.policy = approval.policy;
  runtime.grants = [...runtime.grants, ...approval.grants];
  return await acceptWorkspacePairing({ created, genesis: runtime.genesis, previousPolicy, approval, now: AT }) as PersonalWorkspaceRuntime;
}

async function twoDevices(files: Record<string, string>, options: { phoneReads?: boolean } = {}) {
  const closing: Array<() => Promise<void>> = [];
  const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.8.0", now: AT }));
  const store = new FakeWorkspaceObjectStore();
  const desktop = await device(runtime, store, files, closing);
  const phoneRuntime = await pairPhone(runtime, store);
  const phone = await device(phoneRuntime, store, {}, closing, { reads: options.phoneReads });
  return { desktop, phone, close: async () => { for (const done of closing) await done(); } };
}

describe("what the worker brings from another device is not a change of this one", () => {
  // Pairing, sealing and the signed chain cost a few seconds on a loaded machine.
  const SLOW = { timeout: 30_000 };

  it("a note another device wrote or changed is queued on neither, and no revision of it goes back", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one" });
    try {
      // A revision can leave in the cycle that brought the note, so the count
      // of what the phone signed is the measure, not only its queue.
      expect(await phone.text("note.md")).toBe("one");
      expect(await phone.queued()).toEqual([]);
      expect(await phone.sequence()).toBe(0);

      await desktop.edit("note.md", "two");
      await desktop.cycle();
      await phone.cycle();
      expect(await phone.text("note.md")).toBe("two");
      expect(await phone.queued()).toEqual([]);
      await phone.cycle();
      expect(await phone.sequence()).toBe(0);

      // And the way back: what the phone writes is no change of the desktop's.
      const signed = await desktop.sequence();
      await phone.edit("note.md", "three");
      await phone.cycle();
      await desktop.cycle();
      expect(await desktop.text("note.md")).toBe("three");
      expect(await desktop.queued()).toEqual([]);
      await desktop.cycle();
      expect(await desktop.sequence()).toBe(signed);
    } finally {
      await close();
    }
  });

  it("a note changed twice in a row on one device stays one note on both, without a conflict copy", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one" });
    try {
      await desktop.edit("note.md", "two");
      await desktop.cycle();
      await phone.cycle();
      // The desktop goes on writing before the phone has had another cycle.
      await desktop.edit("note.md", "three");
      await desktop.cycle();
      await phone.cycle();
      await desktop.cycle();

      expect(await phone.text("note.md")).toBe("three");
      expect(await desktop.text("note.md")).toBe("three");
      expect(await phone.conflictCopies()).toEqual([]);
      expect(await desktop.conflictCopies()).toEqual([]);
    } finally {
      await close();
    }
  });

  it("a member who may only read keeps no copy of what somebody else changed or deleted — and one of a change of its own", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one", "plan.md": "plan" }, { phoneReads: true });
    try {
      await desktop.edit("note.md", "two");
      await desktop.cycle();
      await phone.cycle();
      expect(await phone.text("note.md")).toBe("two");
      expect(await phone.forks()).toEqual([]);

      await desktop.remove("note.md");
      await desktop.cycle();
      await phone.cycle();
      expect(await phone.text("note.md")).toBeNull();
      expect(await phone.forks()).toEqual([]);

      // The protection itself is untouched: a change this member may not make
      // is kept as a copy and goes nowhere.
      await phone.editOutside("plan.md", "the reader's own idea");
      expect(await phone.forks()).toEqual(["plan.md"]);
      expect(await phone.queued()).toEqual([]);
    } finally {
      await close();
    }
  });

  it("what this device changes or deletes outside the app still goes up", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one", "plan.md": "plan" });
    try {
      await phone.editOutside("note.md", "edited in another app");
      expect(await phone.queued()).toEqual(["write note.md"]);
      await phone.deleteOutside("plan.md");
      expect(await phone.queued()).toEqual(["write note.md", "delete plan.md"]);
      await phone.cycle();
      await desktop.cycle();
      expect(await desktop.text("note.md")).toBe("edited in another app");
      expect(await desktop.text("plan.md")).toBeNull();
    } finally {
      await close();
    }
  });

  it("a pass that meets a file the worker has written but not yet recorded waits for the record", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one" });
    try {
      await desktop.edit("note.md", "two");
      await desktop.cycle();
      // The phone's index looks at the note the moment the worker has
      // written it, before the worker has recorded the revision: a full scan
      // under way when a pull arrives.
      phone.vault.onWrite = (path) => { if (path === "note.md") phone.reportNow(path); };
      const signed = await phone.sequence();
      await phone.cycle();
      phone.vault.onWrite = undefined;
      await phone.cycle();
      expect(await phone.text("note.md")).toBe("two");
      // Nothing queued, and nothing that went out of the queue in the same cycle either.
      expect(await phone.queued()).toEqual([]);
      expect(await phone.sequence()).toBe(signed);
    } finally {
      await close();
    }
  });

  it("a report that comes late — at the next start, from the full scan — is answered the same way", SLOW, async () => {
    const { desktop, phone, close } = await twoDevices({ "note.md": "one", "plan.md": "plan" }, { phoneReads: true });
    try {
      await desktop.edit("plan.md", "a new plan");
      await desktop.remove("note.md");
      await desktop.edit("later.md", "later");
      await desktop.cycle();
      // The phone's worker writes, and its index hears nothing of it until
      // the app opens again: what the worker reported is lost with the app.
      await phone.cycleUnheard();
      await phone.rescan();
      expect(await phone.text("plan.md")).toBe("a new plan");
      expect(await phone.text("note.md")).toBeNull();
      expect(await phone.text("later.md")).toBe("later");
      expect(await phone.queued()).toEqual([]);
      expect(await phone.forks()).toEqual([]);
    } finally {
      await close();
    }
  });
});
