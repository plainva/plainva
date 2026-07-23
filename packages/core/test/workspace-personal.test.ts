import { describe, expect, it, vi } from "vitest";
import {
  createPersonalWorkspaceBootstrap,
  createWorkspaceDeviceIdentity,
  createWorkspaceRecoveryPackage,
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  initializePersonalWorkspaceMigration,
  MemoryWorkspaceStateStore,
  openWorkspaceRecoveryPackage,
  personalWorkspaceRuntime,
  WorkspaceQueueingVaultAdapter,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type PutImmutableResult,
  type VaultFileInfo,
  type WorkspaceListPage,
  type WorkspaceObjectInfo,
  type WorkspaceObjectStore,
  type WorkspaceRequestOptions,
} from "../src/index.js";

class MemoryVault implements IVaultAdapter {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>();
  async initialize() {}
  async dispose() {}
  async acknowledgeExternalUpdate() {}
  async readTextFile(path: string) { return new TextDecoder().decode(await this.readBinaryFile(path)); }
  async readBinaryFile(path: string) {
    const value = this.files.get(path);
    if (!value) throw new Error(`missing file: ${path}`);
    return new Uint8Array(value);
  }
  async writeTextFile(path: string, content: string) { await this.writeBinaryFile(path, new TextEncoder().encode(content)); }
  async writeBinaryFile(path: string, content: Uint8Array) {
    this.addParents(path);
    this.files.set(path, new Uint8Array(content));
  }
  async deleteItem(path: string, recursive = false) {
    if (this.files.delete(path)) return;
    if (!this.directories.has(path)) throw new Error(`missing item: ${path}`);
    const prefix = `${path}/`;
    const children = [...this.files.keys(), ...this.directories].filter((entry) => entry.startsWith(prefix));
    if (children.length && !recursive) throw new Error("directory is not empty");
    for (const file of [...this.files.keys()]) if (file.startsWith(prefix)) this.files.delete(file);
    for (const directory of [...this.directories]) if (directory === path || directory.startsWith(prefix)) this.directories.delete(directory);
  }
  async renameItem(oldPath: string, newPath: string) {
    if (this.files.has(oldPath)) {
      const bytes = this.files.get(oldPath)!;
      this.files.delete(oldPath);
      await this.writeBinaryFile(newPath, bytes);
      return;
    }
    if (!this.directories.has(oldPath)) throw new Error(`missing item: ${oldPath}`);
    const prefix = `${oldPath}/`;
    const fileMoves = [...this.files.entries()].filter(([path]) => path.startsWith(prefix));
    const dirMoves = [...this.directories].filter((path) => path === oldPath || path.startsWith(prefix));
    for (const [path] of fileMoves) this.files.delete(path);
    for (const path of dirMoves) this.directories.delete(path);
    for (const directory of dirMoves) this.directories.add(`${newPath}${directory.slice(oldPath.length)}`);
    for (const [path, bytes] of fileMoves) this.files.set(`${newPath}${path.slice(oldPath.length)}`, bytes);
  }
  async exists(path: string) { return this.files.has(path) || this.directories.has(path); }
  async getFileInfo(path: string): Promise<VaultFileInfo> {
    if (this.files.has(path)) return { path, name: path.split("/").pop()!, isDirectory: false, size: this.files.get(path)!.length, mtime: 1, ctime: 1 };
    if (this.directories.has(path)) return { path, name: path.split("/").pop()!, isDirectory: true, size: 0, mtime: 1, ctime: 1 };
    throw new Error(`missing item: ${path}`);
  }
  async listDir(path = "", recursive = false): Promise<VaultFileInfo[]> {
    const prefix = path ? `${path}/` : "";
    const direct = (candidate: string) => recursive || !candidate.slice(prefix.length).includes("/");
    const result: VaultFileInfo[] = [];
    for (const directory of this.directories) if (directory.startsWith(prefix) && directory !== path && direct(directory)) result.push(await this.getFileInfo(directory));
    for (const file of this.files.keys()) if (file.startsWith(prefix) && direct(file)) result.push(await this.getFileInfo(file));
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }
  async createDir(path: string) { if (path) { this.addParents(`${path}/x`); this.directories.add(path); } }
  private addParents(path: string) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) this.directories.add(parts.slice(0, index).join("/"));
  }
}

class InterruptingStore implements WorkspaceObjectStore {
  private interrupted = false;
  constructor(
    private readonly inner: WorkspaceObjectStore,
    private readonly shouldInterrupt: (operation: "put" | "cas", key: string) => boolean,
    private readonly interruptAfterPut = false
  ) {}
  list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> { return this.inner.list(prefix, cursor, options); }
  get(key: string, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> { return this.inner.get(key, options); }
  getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> { return this.inner.getRange(key, start, endExclusive, options); }
  head(key: string, options?: WorkspaceRequestOptions): Promise<WorkspaceObjectInfo | null> { return this.inner.head(key, options); }
  async putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions): Promise<PutImmutableResult> {
    const shouldInterrupt = !this.interrupted && this.shouldInterrupt("put", key);
    if (shouldInterrupt && !this.interruptAfterPut) { this.interrupted = true; throw new Error("simulated process kill"); }
    const result = await this.inner.putImmutable(key, bytes, expectedSha256, options);
    if (shouldInterrupt) { this.interrupted = true; throw new Error("simulated process kill after put"); }
    return result;
  }
  async compareAndSwapPointer(key: string, bytes: Uint8Array, previousEtag: string | null, options?: WorkspaceRequestOptions) {
    const result = await this.inner.compareAndSwapPointer(key, bytes, previousEtag, options);
    if (!this.interrupted && this.shouldInterrupt("cas", key)) { this.interrupted = true; throw new Error("simulated process kill after CAS"); }
    return result;
  }
}

async function setupRuntime(additionalDevice = false) {
  const memberId = "11".repeat(16);
  const second = additionalDevice ? await createWorkspaceDeviceIdentity({
    memberId,
    deviceId: "22".repeat(16),
    displayName: "Second device",
    platform: "desktop",
    signingSeed: new Uint8Array(32).fill(2),
    hpkeSeed: new Uint8Array(32).fill(3),
  }) : null;
  const bootstrap = await createPersonalWorkspaceBootstrap({
    workspaceId: "01".repeat(16),
    ownerMemberId: memberId,
    ownerGroupId: "33".repeat(16),
    assignmentId: "44".repeat(16),
    ownerDisplayName: "Owner",
    deviceDisplayName: "First device",
    platform: "desktop",
    minimumClientVersion: "0.5.0",
    now: "2026-07-22T12:00:00.000Z",
    additionalDevices: second ? [second] : [],
  });
  const first = personalWorkspaceRuntime(bootstrap);
  const secondRuntime: PersonalWorkspaceRuntime | null = second ? { ...first, device: second } : null;
  return { bootstrap, first, second: secondRuntime };
}

async function initialise(vault: MemoryVault, state: MemoryWorkspaceStateStore, store: WorkspaceObjectStore, runtime: PersonalWorkspaceRuntime) {
  return initializePersonalWorkspaceMigration({
    store,
    state,
    vault,
    runtime,
    recoveryConfirmedAt: "2026-07-22T12:01:00.000Z",
  });
}

describe("personal encrypted workspace P3", () => {
  it("routes local writes, recursive renames, and deletes only to the workspace queue", async () => {
    const raw = new MemoryVault();
    const state = new MemoryWorkspaceStateStore();
    const vault = new WorkspaceQueueingVaultAdapter(raw, state);
    await vault.writeTextFile(".plainva/local.json", "local");
    await vault.writeTextFile("draft.CONFLICT-deadbeef.md", "conflict");
    expect(await state.listQueue()).toEqual([]);

    await vault.createDir("Projects");
    await vault.writeTextFile("Projects/note.md", "hello");
    expect((await state.listQueue()).map((entry) => [entry.operation, entry.path])).toEqual([
      ["mkdir", "Projects"],
      ["write", "Projects/note.md"],
    ]);
    for (const entry of await state.listQueue()) await state.discardQueue(entry.id);

    await vault.renameItem("Projects", "Archive");
    expect((await state.listQueue()).map((entry) => [entry.operation, entry.path, entry.newPath])).toEqual([
      ["rename", "Projects", "Archive"],
      ["rename", "Projects/note.md", "Archive/note.md"],
    ]);
    for (const entry of await state.listQueue()) await state.discardQueue(entry.id);

    await vault.deleteItem("Archive", true);
    expect((await state.listQueue()).map((entry) => [entry.operation, entry.path])).toEqual([
      ["delete", "Archive/note.md"],
      ["delete", "Archive"],
    ]);
  });

  it("creates a dual-signed one-member bootstrap and a tamper-evident recovery package", async () => {
    const { bootstrap } = await setupRuntime();
    const packageKey = new Uint8Array(32).fill(7);
    const recovery = createWorkspaceRecoveryPackage(bootstrap, {
      packageKey,
      nonce: new Uint8Array(24).fill(8),
      now: "2026-07-22T12:01:00.000Z",
    });
    const opened = openWorkspaceRecoveryPackage(recovery.bytes, recovery.recoveryCode);
    expect(bootstrap.genesis.signatures.map((entry) => entry.signerKind)).toEqual(["device", "recovery"]);
    expect(bootstrap.policy.signatures.map((entry) => entry.signerKind)).toEqual(["device", "recovery"]);
    expect(opened).toMatchObject({ workspaceId: bootstrap.workspaceId, groupId: bootstrap.ownerGroup.groupId, recoveryId: bootstrap.recovery.publicIdentity.recoveryId });
    const tampered = new Uint8Array(recovery.bytes);
    tampered[tampered.length - 3] ^= 1;
    expect(() => openWorkspaceRecoveryPackage(tampered, recovery.recoveryCode)).toThrow();
    const wrongCode = `${recovery.recoveryCode.slice(0, 6)}${recovery.recoveryCode[6] === "A" ? "B" : "A"}${recovery.recoveryCode.slice(7)}`;
    expect(() => openWorkspaceRecoveryPackage(recovery.bytes, wrongCode)).toThrow();
  });

  it("migrates plaintext locally while exposing only opaque .pvws objects remotely", async () => {
    const { first } = await setupRuntime();
    const vault = new MemoryVault();
    await vault.writeTextFile("Projects/Secret name.md", "# Plaintext stays local\n");
    await vault.writeBinaryFile("image.png", new Uint8Array([1, 2, 3, 4]));
    await vault.writeTextFile(".plainva/device-only.json", "local");
    const state = new MemoryWorkspaceStateStore();
    const store = new FakeWorkspaceObjectStore();
    const migration = await initialise(vault, state, store, first);
    expect(migration.total).toBe(3); // Projects directory + two user files
    await new EncryptedWorkspaceWorker(store, state, vault, first).runCycle();

    const namespaces = ["genesis", "policies/", "grants/", "objects/", "operations/", "catalogs/", "checkpoints/", "heads/"];
    const items = (await Promise.all(namespaces.map(async (namespace) => (await store.list(`.pvws/${namespace}`, undefined, { pageSize: 1000 })).items))).flat();
    expect(items.length).toBeGreaterThan(8);
    expect(items.every((entry) => entry.key.startsWith(".pvws/"))).toBe(true);
    expect(items.some((entry) => entry.key.includes("Secret name"))).toBe(false);
    const objectInfo = items.find((entry) => entry.key.endsWith(".pvobj"))!;
    const objectBytes = await store.get(objectInfo.key);
    expect(new TextDecoder().decode(objectBytes!)).not.toContain("Secret name.md");
    expect(await vault.readTextFile("Projects/Secret name.md")).toContain("Plaintext stays local");
    expect((await state.loadMeta())?.phase).toBe("active");
    expect((await state.listQueue()).length).toBe(0);
  });

  it("reports queue-building progress over the vault inventory so setup can show a bar (2026-07-22)", async () => {
    const { first } = await setupRuntime();
    const vault = new MemoryVault();
    for (let i = 0; i < 12; i++) await vault.writeTextFile(`Notes/n${i}.md`, `# note ${i}\n`);
    const state = new MemoryWorkspaceStateStore();
    const store = new FakeWorkspaceObjectStore();
    const calls: Array<[number, number]> = [];
    const migration = await initializePersonalWorkspaceMigration({
      store, state, vault, runtime: first,
      recoveryConfirmedAt: "2026-07-22T12:01:00.000Z",
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls.length).toBeGreaterThan(1);
    // Every report carries the counted inventory total.
    expect(calls.every(([, total]) => total === migration.total)).toBe(true);
    // `done` is non-decreasing and the final report reaches the total.
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    expect(calls.at(-1)?.[0]).toBe(migration.total);
  });

  it("resumes with the same staged revision after a kill between payload and operation upload", async () => {
    const { first } = await setupRuntime();
    const vault = new MemoryVault();
    await vault.writeTextFile("note.md", "before kill");
    const state = new MemoryWorkspaceStateStore();
    const backing = new FakeWorkspaceObjectStore();
    await initialise(vault, state, backing, first);
    const interrupted = new InterruptingStore(backing, (operation, key) => operation === "put" && key.includes("/operations/"));
    await expect(new EncryptedWorkspaceWorker(interrupted, state, vault, first).runCycle()).rejects.toThrow("simulated process kill");
    const prepared = (await state.listQueue())[0].prepared;
    expect(prepared?.operationHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await state.loadMeta())?.sequence).toBe(1);

    await new EncryptedWorkspaceWorker(backing, state, vault, first).runCycle();
    expect((await state.loadMeta())?.sequence).toBe(1);
    expect((await backing.list(".pvws/operations/", undefined, { pageSize: 100 })).items).toHaveLength(1);
    expect((await state.loadMeta())?.phase).toBe("active");
  });

  it("adopts an already-written identical head after a kill immediately after CAS", async () => {
    const { first } = await setupRuntime();
    const vault = new MemoryVault();
    await vault.writeTextFile("note.md", "head crash");
    const state = new MemoryWorkspaceStateStore();
    const backing = new FakeWorkspaceObjectStore();
    await initialise(vault, state, backing, first);
    const interrupted = new InterruptingStore(backing, (operation, key) => operation === "cas" && key.includes("/heads/"));
    await expect(new EncryptedWorkspaceWorker(interrupted, state, vault, first).runCycle()).rejects.toThrow("after CAS");
    expect((await state.loadMeta())?.pendingPublication).not.toBeNull();
    await new EncryptedWorkspaceWorker(backing, state, vault, first).runCycle();
    expect((await state.loadMeta())?.pendingPublication).toBeNull();
    expect((await state.loadMeta())?.phase).toBe("active");
  });

  it("adopts its signed operation without a false conflict after a kill immediately after upload", async () => {
    const { first } = await setupRuntime();
    const vault = new MemoryVault();
    await vault.writeTextFile("note.md", "operation crash");
    const state = new MemoryWorkspaceStateStore();
    const backing = new FakeWorkspaceObjectStore();
    await initialise(vault, state, backing, first);
    const interrupted = new InterruptingStore(
      backing,
      (operation, key) => operation === "put" && key.includes("/operations/"),
      true
    );
    await expect(new EncryptedWorkspaceWorker(interrupted, state, vault, first).runCycle()).rejects.toThrow("after put");

    await new EncryptedWorkspaceWorker(backing, state, vault, first).runCycle();
    expect((await state.loadMeta())?.sequence).toBe(1);
    expect((await state.listQueue()).length).toBe(0);
    expect((await vault.listDir("", true)).filter((entry) => entry.path.includes(".CONFLICT-"))).toHaveLength(0);
    expect(await vault.readTextFile("note.md")).toBe("operation crash");
  });

  it("collapses rapid offline rename chains without leaving the original remote object live", async () => {
    const { first, second } = await setupRuntime(true);
    const store = new FakeWorkspaceObjectStore();
    const vault1 = new MemoryVault();
    const state1 = new MemoryWorkspaceStateStore();
    await vault1.writeTextFile("A.md", "renamed twice");
    await initialise(vault1, state1, store, first);
    await new EncryptedWorkspaceWorker(store, state1, vault1, first).runCycle();

    const queuedVault = new WorkspaceQueueingVaultAdapter(vault1, state1);
    await queuedVault.renameItem("A.md", "B.md");
    await queuedVault.renameItem("B.md", "C.md");
    await new EncryptedWorkspaceWorker(store, state1, vault1, first).runCycle();

    const vault2 = new MemoryVault();
    const state2 = new MemoryWorkspaceStateStore();
    await initialise(vault2, state2, store, second!);
    await new EncryptedWorkspaceWorker(store, state2, vault2, second!).runCycle();
    expect(await vault2.exists("A.md")).toBe(false);
    expect(await vault2.exists("B.md")).toBe(false);
    expect(await vault2.readTextFile("C.md")).toBe("renamed twice");
  });

  it("queues edits and deletions made while Plainva was closed", async () => {
    const { first, second } = await setupRuntime(true);
    const store = new FakeWorkspaceObjectStore();
    const vault1 = new MemoryVault();
    const state1 = new MemoryWorkspaceStateStore();
    await vault1.writeTextFile("changed.md", "before");
    await vault1.writeTextFile("deleted.md", "remove me");
    await initialise(vault1, state1, store, first);
    await new EncryptedWorkspaceWorker(store, state1, vault1, first).runCycle();

    await vault1.writeTextFile("changed.md", "after restart");
    await vault1.deleteItem("deleted.md");
    await initialise(vault1, state1, store, first);
    expect((await state1.listQueue()).map((entry) => [entry.operation, entry.path])).toEqual([
      ["write", "changed.md"],
      ["delete", "deleted.md"],
    ]);
    await new EncryptedWorkspaceWorker(store, state1, vault1, first).runCycle();

    const vault2 = new MemoryVault();
    const state2 = new MemoryWorkspaceStateStore();
    await initialise(vault2, state2, store, second!);
    await new EncryptedWorkspaceWorker(store, state2, vault2, second!).runCycle();
    expect(await vault2.readTextFile("changed.md")).toBe("after restart");
    expect(await vault2.exists("deleted.md")).toBe(false);
  });

  it("preserves both branches when two provisioned devices edit offline", async () => {
    const { first, second } = await setupRuntime(true);
    const store = new FakeWorkspaceObjectStore();
    const vault1 = new MemoryVault();
    const state1 = new MemoryWorkspaceStateStore();
    await vault1.writeTextFile("note.md", "base");
    await initialise(vault1, state1, store, first);
    const worker1 = new EncryptedWorkspaceWorker(store, state1, vault1, first);
    await worker1.runCycle();

    const vault2 = new MemoryVault();
    const state2 = new MemoryWorkspaceStateStore();
    await initialise(vault2, state2, store, second!);
    const worker2 = new EncryptedWorkspaceWorker(store, state2, vault2, second!);
    await worker2.runCycle();
    expect(await vault2.readTextFile("note.md")).toBe("base");

    await vault1.writeTextFile("note.md", "device one");
    await state1.enqueue("write", "note.md");
    await vault2.writeTextFile("note.md", "device two");
    await state2.enqueue("write", "note.md");
    await worker1.runCycle();
    await worker2.runCycle();
    await worker1.runCycle();

    expect(await vault1.readTextFile("note.md")).toBe("device one");
    expect(await vault2.readTextFile("note.md")).toBe("device two");
    const conflicts1 = (await vault1.listDir("", true)).filter((entry) => entry.path.includes(".CONFLICT-"));
    const conflicts2 = (await vault2.listDir("", true)).filter((entry) => entry.path.includes(".CONFLICT-"));
    expect(conflicts1).toHaveLength(1);
    expect(conflicts2).toHaveLength(1);
    expect(await vault1.readTextFile(conflicts1[0].path)).toBe("device two");
    expect(await vault2.readTextFile(conflicts2[0].path)).toBe("device one");
  });

  it("skips re-reading unchanged files on the open-time reconcile via the mtime probe cache (A1 2026-07-22)", async () => {
    const { first } = await setupRuntime();
    const store = new FakeWorkspaceObjectStore();
    const vault = new MemoryVault();
    const state = new MemoryWorkspaceStateStore();
    await vault.writeTextFile("keep.md", "unchanged forever");
    await initialise(vault, state, store, first);
    await new EncryptedWorkspaceWorker(store, state, vault, first).runCycle();

    // Second sweep: the object now exists but no probe was recorded yet, so the
    // file is hashed exactly once and a probe is written for it.
    const readSpy = vi.spyOn(vault, "readBinaryFile");
    const second = await initialise(vault, state, store, first);
    expect(second.queued).toBe(0);
    expect(second.alreadyCompleted).toBe(1);
    expect(readSpy.mock.calls.filter(([p]) => p === "keep.md")).toHaveLength(1);
    expect((await state.listLocalProbes()).map((probe) => probe.path)).toContain("keep.md");

    // Third sweep: the probe matches the (unchanged) stat, so the file is NOT read.
    readSpy.mockClear();
    const third = await initialise(vault, state, store, first);
    expect(third.alreadyCompleted).toBe(1);
    expect(readSpy.mock.calls.filter(([p]) => p === "keep.md")).toHaveLength(0);

    readSpy.mockRestore();
  });

  it("drops stale probes for files that disappeared while closed", async () => {
    const { first } = await setupRuntime();
    const store = new FakeWorkspaceObjectStore();
    const vault = new MemoryVault();
    const state = new MemoryWorkspaceStateStore();
    await vault.writeTextFile("gone.md", "here for now");
    await initialise(vault, state, store, first);
    await new EncryptedWorkspaceWorker(store, state, vault, first).runCycle();
    await initialise(vault, state, store, first); // records the probe
    expect((await state.listLocalProbes()).map((probe) => probe.path)).toContain("gone.md");

    await vault.deleteItem("gone.md");
    await initialise(vault, state, store, first);
    expect((await state.listLocalProbes()).map((probe) => probe.path)).not.toContain("gone.md");
  });
});
