import { afterEach, describe, expect, it } from "vitest";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore, type IDatabaseAdapter, type WorkspaceObjectStore, type WorkspaceStateStore } from "../src/index.js";
import { sha256Hex } from "../src/workspace/encoding.js";
import { chainPermissions, filesOf, MemoryVault, ownerSecondDevice, queued, synced } from "./helpers/workspaceReconcile.ts";
import { realSqlite } from "./helpers/realSqlite.js";

type Device = { state: WorkspaceStateStore; vault: MemoryVault; worker: { runCycle(): Promise<void> }; runtime: { device: { publicIdentity: { deviceId: string } } } };

/** Every text a device shows, and every text the workspace's history holds, of all devices. */
async function everyText(devices: Device[]): Promise<{ shown: Set<string>; history: Set<string> }> {
  const shown = new Set<string>();
  const history = new Set<string>();
  for (const device of devices) {
    for (const text of Object.values(filesOf(device.vault))) shown.add(text);
    for (const object of await device.state.listObjects(true)) for (const revision of await device.state.listRevisionsForObject(object.objectId)) if (revision.plaintextSha256) history.add(revision.plaintextSha256);
  }
  return { shown, history };
}
const sha = (text: string) => sha256Hex(new TextEncoder().encode(text));

/** Hides one device's operations and head from the shared store while `run` runs: the other device has not seen them yet. */
async function unseen<T>(store: WorkspaceObjectStore, deviceId: string, run: () => Promise<T>): Promise<T> {
  const list = store.list.bind(store);
  store.list = async (...args: Parameters<WorkspaceObjectStore["list"]>) => {
    const page = await list(...args);
    return { ...page, items: page.items.filter((item) => !(item.key.startsWith(".pvws/operations/") || item.key.startsWith(".pvws/heads/")) || !item.key.includes(deviceId)) };
  };
  try {
    return await run();
  } finally {
    store.list = list;
  }
}

/**
 * The worker touches a file only when it is the state it last recorded of
 * exactly that object (review of release 0.9.0). Anything else at the place —
 * new, changed, queued or not — stays, and what comes from elsewhere lands
 * beside it: no text that was ever written is nowhere afterwards.
 */
describe.each(["memory", "sql"] as const)("no text is lost to another device's change (%s state)", (kind) => {
  const databases: IDatabaseAdapter[] = [];
  afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
  const makeState = async () => {
    if (kind === "memory") return new MemoryWorkspaceStateStore();
    const db = await realSqlite();
    databases.push(db);
    return new SqlWorkspaceStateStore(db);
  };
  const settle = async (...devices: Device[]) => { for (let round = 0; round < 4; round += 1) for (const device of devices) await device.worker.runCycle(); };

  it.each([false, true])("a note deleted and made anew while another device renamed the old one (new note uploaded: %s)", { timeout: 60_000 }, async (uploadedNew) => {
    const owner = await synced(["a.md", "z.md"], makeState);
    const one = await ownerSecondDevice(owner, makeState);
    const two = await ownerSecondDevice(owner, makeState);
    await one.worker.runCycle();
    await two.vault.renameItem("a.md", "b.md");
    await two.state.enqueue("rename", "a.md", "b.md");
    await one.vault.deleteItem("a.md");
    await one.state.enqueue("delete", "a.md", null, { confirmed: true });
    await one.worker.runCycle();
    await one.vault.writeTextFile("a.md", "# a brand-new note on one\n");
    await one.state.enqueue("write", "a.md");
    if (uploadedNew) await one.worker.runCycle();
    await two.worker.runCycle();
    await settle(one, two, owner);
    for (const device of [one, two, owner]) expect(Object.values(filesOf(device.vault))).toContain("# a brand-new note on one\n");
    expect(Object.values(filesOf(one.vault))).toContain("# a.md\n");
    expect(await queued(one.state)).toEqual([]);
  });

  it("a folder deleted on one device while a note in it is edited on another: the edit stays, on both", { timeout: 60_000 }, async () => {
    const owner = await synced(["F/x.md", "F/y.md", "b.md"], makeState);
    const two = await ownerSecondDevice(owner, makeState);
    await owner.vault.deleteItem("F", true);
    await owner.state.enqueue("delete", "F", null, { confirmed: true });
    await two.vault.writeTextFile("F/x.md", "# x edited on two\n");
    await two.state.enqueue("write", "F/x.md");
    await owner.worker.runCycle();
    await two.worker.runCycle();
    await settle(owner, two);
    for (const device of [owner, two]) {
      expect(Object.values(filesOf(device.vault))).toContain("# x edited on two\n");
      expect(Object.values(filesOf(device.vault))).not.toContain("# F/y.md\n");
    }
    expect(await queued(two.state)).toEqual([]);
  });

  it("a queued edit of a note another object's note of the same name arrives for: it waits, and every device agrees", { timeout: 60_000 }, async () => {
    const owner = await synced(["b.md"], makeState);
    const x = await ownerSecondDevice(owner, makeState);
    const y = await ownerSecondDevice(owner, makeState);
    await x.worker.runCycle();
    await y.worker.runCycle();
    await x.vault.writeTextFile("c.md", "# c from x\n");
    await x.state.enqueue("write", "c.md");
    await x.worker.runCycle();
    await y.vault.writeTextFile("c.md", "# c from y\n");
    await y.state.enqueue("write", "c.md");
    await unseen(owner.store, x.runtime.device.publicIdentity.deviceId, () => y.worker.runCycle());
    await x.vault.writeTextFile("c.md", "# x's second edit, queued\n");
    await x.state.enqueue("write", "c.md");
    await settle(x, y, owner);
    const shown = filesOf(x.vault);
    expect(Object.values(shown).sort()).toEqual(["# b.md\n", "# c from y\n", "# x's second edit, queued\n"]);
    expect(filesOf(y.vault)).toEqual(shown);
    expect(filesOf(owner.vault)).toEqual(shown);
  });

  it("a conflict copy's name already taken: neither file is overwritten", { timeout: 60_000 }, async () => {
    const owner = await synced(["b.md"], makeState);
    const one = await ownerSecondDevice(owner, makeState);
    const two = await ownerSecondDevice(owner, makeState);
    await one.worker.runCycle();
    await one.vault.writeTextFile("c.md", "# c from one\n");
    await one.state.enqueue("write", "c.md");
    await two.vault.writeTextFile("c.md", "# c from two\n");
    await two.state.enqueue("write", "c.md");
    await one.worker.runCycle();
    await unseen(owner.store, one.runtime.device.publicIdentity.deviceId, () => two.worker.runCycle());
    // Whichever loses the name, its copy's place holds a file of the person's on every device.
    const ids = [(await one.state.getObjectByPath("c.md"))!.objectId, (await two.state.getObjectByPath("c.md"))!.objectId].sort();
    for (const device of [one, two, owner]) await device.vault.writeTextFile(`c.CONFLICT-${ids[1].slice(0, 8)}.md`, "# a file of the person's\n");
    await settle(one, two, owner);
    for (const device of [one, two, owner]) {
      const texts = Object.values(filesOf(device.vault));
      for (const text of ["# a file of the person's\n", "# c from one\n", "# c from two\n"]) expect(texts).toContain(text);
    }
  });

  it("two folders of one name made at once are one folder, with both notes in it", { timeout: 60_000 }, async () => {
    const owner = await synced(["b.md"], makeState);
    const one = await ownerSecondDevice(owner, makeState);
    const two = await ownerSecondDevice(owner, makeState);
    await one.worker.runCycle();
    for (const [device, name] of [[one, "D/one.md"], [two, "D/two.md"]] as const) {
      await device.vault.createDir("D");
      await device.state.enqueue("mkdir", "D");
      await device.vault.writeTextFile(name, `# ${name}\n`);
      await device.state.enqueue("write", name);
    }
    await one.worker.runCycle();
    await unseen(owner.store, one.runtime.device.publicIdentity.deviceId, () => two.worker.runCycle());
    await settle(one, two, owner);
    for (const device of [one, two, owner]) {
      expect(filesOf(device.vault)).toEqual({ "D/one.md": "# D/one.md\n", "D/two.md": "# D/two.md\n", "b.md": "# b.md\n" });
      expect([...device.vault.directories].filter((path) => path.includes("CONFLICT"))).toEqual([]);
      expect((await device.state.listObjects(false)).filter((object) => object.path === "D").length).toBe(1);
    }
  });
});

/**
 * A move is a change at its source and at its target (review of release
 * 0.9.0): a note moved into a folder whose deletion waits for an answer waits
 * with it, and a folder's deletion takes what the deleting device deleted —
 * what another device put, moved or changed in it stays. At the end every
 * device has the text.
 */
describe.each(["memory", "sql"] as const)("a move into a folder another device deletes (%s state)", (kind) => {
  const databases: IDatabaseAdapter[] = [];
  afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
  const makeState = async () => {
    if (kind === "memory") return new MemoryWorkspaceStateStore();
    const db = await realSqlite();
    databases.push(db);
    return new SqlWorkspaceStateStore(db);
  };
  const settle = async (...devices: Device[]) => { for (let round = 0; round < 4; round += 1) for (const device of devices) await device.worker.runCycle(); };

  it("moved in by the deleting device after its deletion, while the question is open here: after the answer, every device has it", { timeout: 120_000 }, async () => {
    const team = Array.from({ length: 30 }, (_, index) => `Team/n${String(index).padStart(2, "0")}.md`);
    const owner = await synced([...team, "r1.md", "r2.md"], makeState);
    const two = await ownerSecondDevice(owner, makeState);
    let asked = false;
    two.worker.onDeletionMirroringSuspended = () => { asked = true; };
    await owner.vault.deleteItem("Team", true);
    await owner.state.enqueue("delete", "Team", null, { confirmed: true });
    await owner.worker.runCycle();
    await two.worker.runCycle();
    expect(asked).toBe(true);
    await owner.vault.renameItem("r1.md", "Team/r1.md");
    await owner.state.enqueue("rename", "r1.md", "Team/r1.md");
    await owner.vault.writeTextFile("Team/new.md", "# new in Team\n");
    await owner.state.enqueue("write", "Team/new.md");
    await owner.vault.writeTextFile("r2.md", "# r2 edited\n");
    await owner.state.enqueue("write", "r2.md");
    await owner.worker.runCycle();
    await two.worker.runCycle();
    // While the question is open the move waits with the deletion; the unrelated edit arrives.
    expect(filesOf(two.vault)["r2.md"]).toBe("# r2 edited\n");
    expect(filesOf(two.vault)["r1.md"]).toBe("# r1.md\n");
    two.worker.approveSuspendedDeletions();
    await settle(two, owner);
    for (const device of [owner, two]) {
      const shown = filesOf(device.vault);
      expect(shown["Team/r1.md"]).toBe("# r1.md\n");
      expect(shown["Team/new.md"]).toBe("# new in Team\n");
      expect(Object.keys(shown).filter((path) => /^Team\/n\d\d\.md$/.test(path))).toEqual([]);
      expect(await queued(device.state)).toEqual([]);
    }
  });

  it.each([["the deleting device first", false], ["the deleting device first", true], ["the moving device first", false], ["the moving device first", true]] as const)("moved in by another device at the same time, %s (and edited: %s): every device has its text", { timeout: 120_000 }, async (order, edited) => {
    const owner = await synced(["T/a.md", "T/b.md", "r1.md", "z.md"], makeState);
    const x = await ownerSecondDevice(owner, makeState);
    const y = await ownerSecondDevice(owner, makeState);
    await x.worker.runCycle();
    await y.worker.runCycle();
    await owner.vault.deleteItem("T", true);
    await owner.state.enqueue("delete", "T", null, { confirmed: true });
    await x.vault.renameItem("r1.md", "T/r1.md");
    await x.state.enqueue("rename", "r1.md", "T/r1.md");
    const text = edited ? "# r1 moved and edited on x\n" : "# r1.md\n";
    if (edited) {
      await x.vault.writeTextFile("T/r1.md", text);
      await x.state.enqueue("write", "T/r1.md");
    }
    for (const device of order === "the deleting device first" ? [owner, x] : [x, owner]) await device.worker.runCycle();
    await settle(owner, x, y);
    for (const device of [owner, x, y]) {
      const shown = filesOf(device.vault);
      expect(shown["T/r1.md"]).toBe(text);
      expect(shown["T/a.md"]).toBeUndefined();
      expect(shown["T/b.md"]).toBeUndefined();
      expect(await queued(device.state)).toEqual([]);
    }
    expect(filesOf(x.vault)).toEqual(filesOf(owner.vault));
    expect(filesOf(y.vault)).toEqual(filesOf(owner.vault));
  });
});

/**
 * Two devices answer another device's mass deletion with "keep" (review of
 * release 0.9.0, F63): each uploads the kept files anew. A file whose text
 * is the same on both is one file afterwards, with no conflict copy, and
 * every device shows the same; where the texts differ, the copy stays.
 */
describe.each(["memory", "sql"] as const)("a mass deletion answered on two devices (%s state)", (kind) => {
  const databases: IDatabaseAdapter[] = [];
  afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
  const makeState = async () => {
    if (kind === "memory") return new MemoryWorkspaceStateStore();
    const db = await realSqlite();
    databases.push(db);
    return new SqlWorkspaceStateStore(db);
  };
  const team = Array.from({ length: 30 }, (_, index) => `T/n${String(index).padStart(2, "0")}.md`);
  async function deletedOnOwner() {
    const owner = await synced([...team, "z.md"], makeState);
    const two = await ownerSecondDevice(owner, makeState);
    const three = await ownerSecondDevice(owner, makeState);
    await two.worker.runCycle();
    await three.worker.runCycle();
    await owner.vault.deleteItem("T", true);
    await owner.state.enqueue("delete", "T", null, { confirmed: true });
    await owner.worker.runCycle();
    return { owner, two, three };
  }
  const settle = async (...devices: Device[]) => { for (let round = 0; round < 5; round += 1) for (const device of devices) await device.worker.runCycle(); };
  const copies = (device: Device) => Object.keys(filesOf(device.vault)).filter((path) => path.includes("CONFLICT"));

  it("both keep: every file once, no copy, every device alike", { timeout: 120_000 }, async () => {
    const { owner, two, three } = await deletedOnOwner();
    await two.worker.runCycle();
    await three.worker.runCycle();
    await two.worker.keepSuspendedDeletionsLocal();
    await three.worker.keepSuspendedDeletionsLocal();
    await settle(two, three, owner);
    for (const device of [owner, two, three]) {
      expect(copies(device)).toEqual([]);
      expect(Object.keys(filesOf(device.vault)).filter((path) => path.startsWith("T/")).length).toBe(30);
      expect(await queued(device.state)).toEqual([]);
    }
    expect(filesOf(two.vault)).toEqual(filesOf(owner.vault));
    expect(filesOf(three.vault)).toEqual(filesOf(owner.vault));
  });

  it("one keeps, one deletes: the kept files come back everywhere, no copy", { timeout: 120_000 }, async () => {
    const { owner, two, three } = await deletedOnOwner();
    await two.worker.runCycle();
    await three.worker.runCycle();
    await two.worker.keepSuspendedDeletionsLocal();
    three.worker.approveSuspendedDeletions();
    await settle(two, three, owner);
    for (const device of [owner, two, three]) {
      expect(copies(device)).toEqual([]);
      expect(Object.keys(filesOf(device.vault)).filter((path) => path.startsWith("T/")).length).toBe(30);
      expect(await queued(device.state)).toEqual([]);
    }
    expect(filesOf(two.vault)).toEqual(filesOf(owner.vault));
    expect(filesOf(three.vault)).toEqual(filesOf(owner.vault));
  });

  it("both keep, one of them had edited a file before: the edit is the note's text everywhere, its earlier text in the history, no copy", { timeout: 120_000 }, async () => {
    const { owner, two, three } = await deletedOnOwner();
    await two.worker.runCycle();
    await three.worker.runCycle();
    await two.vault.writeTextFile("T/n05.md", "# n05 edited on two\n");
    await two.state.enqueue("write", "T/n05.md");
    await two.worker.keepSuspendedDeletionsLocal();
    await three.worker.keepSuspendedDeletionsLocal();
    await settle(two, three, owner);
    for (const device of [owner, two, three]) {
      expect(filesOf(device.vault)["T/n05.md"]).toBe("# n05 edited on two\n");
      expect(copies(device)).toEqual([]);
      expect(await queued(device.state)).toEqual([]);
    }
    expect((await everyText([owner, two, three])).history.has(sha("# T/n05.md\n"))).toBe(true);
    expect(filesOf(two.vault)).toEqual(filesOf(owner.vault));
    expect(filesOf(three.vault)).toEqual(filesOf(owner.vault));
  });

  it("both keep, the kept texts of one file differ: that file keeps both texts as note and copy, the others are one file each", { timeout: 120_000 }, async () => {
    const { owner, two, three } = await deletedOnOwner();
    await two.worker.runCycle();
    await three.worker.runCycle();
    await two.worker.keepSuspendedDeletionsLocal();
    await three.worker.keepSuspendedDeletionsLocal();
    await three.vault.writeTextFile("T/n07.md", "# n07 edited on three\n");
    await three.state.enqueue("write", "T/n07.md");
    await settle(two, three, owner);
    for (const device of [owner, two, three]) {
      const shown = Object.values(filesOf(device.vault));
      expect(shown).toContain("# n07 edited on three\n");
      expect(shown).toContain("# T/n07.md\n");
      expect(copies(device).length).toBe(1);
      expect(copies(device)[0]).toMatch(/^T\/n07\.CONFLICT-/);
      expect(await queued(device.state)).toEqual([]);
    }
    expect(filesOf(two.vault)).toEqual(filesOf(owner.vault));
    expect(filesOf(three.vault)).toEqual(filesOf(owner.vault));
  });
});

/**
 * A device that moves one note around offline — a.md to c.md, back to a.md,
 * then to b.md — sends one move, and its queue goes up (review of release
 * 0.9.0: "workspace rename queue contains a cycle", and every later change of
 * that device, to any note, hung for good).
 */
describe("a chain of moves of one note", () => {
  it.each([false, true])("is one move, and the rest of the queue goes up (edited between: %s)", { timeout: 60_000 }, async (edited) => {
    const owner = await synced(["a.md", "z.md"]);
    const two = await ownerSecondDevice(owner);
    await owner.vault.renameItem("a.md", "c.md");
    await owner.state.enqueue("rename", "a.md", "c.md");
    await owner.vault.renameItem("c.md", "a.md");
    await owner.state.enqueue("rename", "c.md", "a.md");
    if (edited) {
      await owner.vault.writeTextFile("a.md", "# a edited\n");
      await owner.state.enqueue("write", "a.md");
    }
    await owner.vault.renameItem("a.md", "b.md");
    await owner.state.enqueue("rename", "a.md", "b.md");
    await owner.vault.writeTextFile("z.md", "# z edited\n");
    await owner.state.enqueue("write", "z.md");
    await owner.worker.runCycle();
    expect(await queued(owner.state)).toEqual([]);
    await two.worker.runCycle();
    expect(filesOf(two.vault)).toEqual({ "b.md": edited ? "# a edited\n" : "# a.md\n", "z.md": "# z edited\n" });
  });

  it("back to where it began is no move at all", { timeout: 60_000 }, async () => {
    const owner = await synced(["a.md"]);
    const two = await ownerSecondDevice(owner);
    await owner.vault.renameItem("a.md", "c.md");
    await owner.state.enqueue("rename", "a.md", "c.md");
    await owner.vault.renameItem("c.md", "a.md");
    await owner.state.enqueue("rename", "c.md", "a.md");
    await owner.worker.runCycle();
    expect(await queued(owner.state)).toEqual([]);
    await two.worker.runCycle();
    expect(filesOf(two.vault)).toEqual({ "a.md": "# a.md\n" });
  });
});

/** The bytes the worker keeps in its own maps and sets, by a walk of its fields (the vault, the store and the state are not its own). */
function bytesHeldBy(worker: object): { objects: number; bytes: number } {
  let objects = 0;
  let bytes = 0;
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 4) return;
    seen.add(value);
    if (value instanceof Uint8Array) { if (value.length >= 64 * 1024) { objects += 1; bytes += value.length; } return; }
    const items = value instanceof Map ? [...value.values()] : value instanceof Set || Array.isArray(value) ? [...value] : Object.values(value);
    for (const item of items) visit(item, depth + 1);
  };
  for (const field of Object.values(worker)) if (field instanceof Map || field instanceof Set) visit(field, 0);
  return { objects, bytes };
}

/**
 * A phone that pulls many new files while a note of its own waits (review of
 * release 0.9.0): the worker looks at where each new file goes, and keeps no
 * file's bytes for that — it holds at most the one it is applying, however
 * many come. Kept until the pull ended, thirty attachments of a megabyte
 * were sixty megabytes at once, the pattern of the phone's crash of 17.11.
 */
describe("the look at incoming new objects while a note of this device waits", () => {
  it("holds no object's bytes past its apply", { timeout: 120_000 }, async () => {
    const owner = await synced(["b.md"]);
    const phone = await ownerSecondDevice(owner);
    for (let index = 0; index < 30; index += 1) {
      const bytes = new Uint8Array(1024 * 1024);
      for (let offset = 0; offset < bytes.length; offset += 4096) bytes[offset] = (index * 7 + offset) & 255;
      bytes[0] = index;
      await owner.vault.writeBinaryFile(`img${index}.png`, bytes);
      await owner.state.enqueue("write", `img${index}.png`);
    }
    await owner.worker.runCycle();
    await phone.vault.writeTextFile("mine.md", "# waiting here\n");
    await phone.state.enqueue("write", "mine.md");
    const worker = phone.worker as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const verify = worker.verifyRemoteHeads.bind(phone.worker);
    let held = { objects: -1, bytes: -1 };
    worker.verifyRemoteHeads = async (...args: unknown[]) => { held = bytesHeldBy(phone.worker); return verify(...args); };
    await phone.worker.runCycle();
    expect(held).toEqual({ objects: 0, bytes: 0 });
    expect([...phone.vault.files.keys()].filter((path) => path.startsWith("img")).length).toBe(30);
  });
});

/**
 * Random changes on two and three devices of one workspace, one of them now
 * and then offline, with and without the app's watcher (review of release
 * 0.9.0). Whatever they do: no cycle throws, no text written is nowhere
 * afterwards — on no device and in no history — the conflict copies stay
 * few, and no queue is left hanging.
 */
describe("random concurrent changes", () => {
  const POOL = ["a.md", "b.md", "c.md", "F/x.md", "F/y.md"];
  function random(seed: number) {
    let x = (seed * 2654435761) >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  async function run(seed: number, deviceCount: number, offline: boolean, watch: boolean) {
    const next = random(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)];
    const owner = await synced(["a.md", "b.md", "F/x.md"]);
    const devices: Device[] = [owner];
    for (let index = 1; index < deviceCount; index += 1) devices.push(await ownerSecondDevice(owner));
    for (const device of devices) await device.worker.runCycle();
    // A cycle that throws is a failure: these are the owner's devices, nothing they do is refused.
    const errors: string[] = [];
    // The app's watcher: what the worker wrote comes back as a change from outside, judged by the chain.
    const changed = devices.map(() => [] as string[]);
    devices.forEach((device, index) => { (device.worker as { onFilesChanged?: (paths: string[]) => void }).onFilesChanged = (paths) => changed[index].push(...paths); });
    const permissions = devices.map((device) => chainPermissions(device.vault, device.state, (device as unknown as { runtime: Parameters<typeof chainPermissions>[2] }).runtime));
    const cycle = async (index: number) => {
      try {
        await devices[index].worker.runCycle();
      } catch (error) {
        errors.push(`seed ${seed} device ${index}: ${(error as Error).message}`);
      }
      const paths = [...new Set(changed[index].splice(0))];
      if (!watch) return;
      for (const path of paths) {
        if (devices[index].vault.directories.has(path)) continue;
        const exists = devices[index].vault.files.has(path);
        if (await permissions[index].authorizeExternalChange(path, exists)) await devices[index].state.enqueue(exists ? "write" : "delete", path);
      }
    };
    const written = new Map<string, boolean>([["# a.md\n", false], ["# b.md\n", false], ["# F/x.md\n", false]]);
    const replace = (device: Device, path: string) => { const bytes = device.vault.files.get(path); if (bytes) written.set(new TextDecoder().decode(bytes), true); };
    const away = offline ? 1 + Math.floor(next() * (deviceCount - 1)) : -1;
    const steps = 40;
    let made = 0;
    for (let step = 0; step < steps; step += 1) {
      const index = Math.floor(next() * deviceCount);
      const device = devices[index];
      const files = [...device.vault.files.keys()].filter((path) => POOL.includes(path));
      const roll = next();
      if (roll < 0.45) {
        if (index === away && step >= steps * 0.2 && step < steps * 0.6) continue;
        await cycle(index);
        continue;
      }
      const text = `# t${++made} by d${index}\n`;
      if (roll < 0.7 && files.length) {
        const path = pick(files);
        replace(device, path);
        await device.vault.writeTextFile(path, text);
        await device.state.enqueue("write", path);
        written.set(text, false);
      } else if (roll < 0.8) {
        const free = POOL.filter((path) => !device.vault.files.has(path));
        if (!free.length) continue;
        const path = pick(free);
        await device.vault.writeTextFile(path, text);
        await device.state.enqueue("write", path);
        written.set(text, false);
      } else if (roll < 0.9 && files.length) {
        const path = pick(files);
        replace(device, path);
        await device.vault.deleteItem(path);
        await device.state.enqueue("delete", path, null, { confirmed: true });
      } else if (files.length) {
        const path = pick(files);
        const free = POOL.filter((candidate) => !device.vault.files.has(candidate));
        if (!free.length) continue;
        const target = pick(free);
        await device.vault.renameItem(path, target);
        await device.state.enqueue("rename", path, target);
      }
    }
    for (let round = 0; round < 8; round += 1) for (let index = 0; index < devices.length; index += 1) await cycle(index);
    const { shown, history } = await everyText(devices);
    const nowhere = [...written].filter(([text, replaced]) => !replaced && !shown.has(text) && !history.has(sha(text))).map(([text]) => text.trim());
    const copies = Math.max(...devices.map((device) => Object.keys(filesOf(device.vault)).filter((path) => path.includes("CONFLICT")).length));
    const queues = await Promise.all(devices.map(async (device) => (await device.state.listQueue(1000)).length));
    return { nowhere, copies, queues, errors };
  }
  const SEEDS = [138, 1, 5, 12, 23, 29, 41, 57, 77, 99];
  // 314: a device moved a note around offline and its queue hung on "a cycle"; with the watcher and offline phases.
  const WATCHED = [314, 301, 303, 307, 309, 2, 17];
  it.each([[2, false, false, SEEDS], [3, false, false, SEEDS], [3, true, false, SEEDS], [3, true, true, WATCHED]] as const)("on %i devices (one offline at times: %s, the watcher on: %s): no cycle throws, nothing nowhere, few copies, no queue left", { timeout: 300_000 }, async (deviceCount, offline, watch, seeds) => {
    for (const seed of seeds) {
      const outcome = await run(seed, deviceCount, offline, watch);
      expect(outcome.errors).toEqual([]);
      expect({ seed, nowhere: outcome.nowhere }).toEqual({ seed, nowhere: [] });
      expect(outcome.copies, `seed ${seed}`).toBeLessThanOrEqual(12);
      expect(outcome.queues.every((length) => length === 0), `seed ${seed}`).toBe(true);
    }
  });
});
