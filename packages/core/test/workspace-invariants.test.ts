import { afterEach, describe, expect, it } from "vitest";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore, type IDatabaseAdapter, type WorkspaceObjectStore, type WorkspaceStateStore } from "../src/index.js";
import { sha256Hex } from "../src/workspace/encoding.js";
import { filesOf, MemoryVault, ownerSecondDevice, queued, synced } from "./helpers/workspaceReconcile.ts";
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
 * A new note waiting here makes the worker read the path of every incoming
 * new object before applying it (`waitingForOwnChanges`). Each is fetched
 * once per cycle, not once for the look and once more for the apply.
 */
describe("the look at incoming new objects while a note of this device waits", () => {
  it("fetches each object once", { timeout: 60_000 }, async () => {
    const owner = await synced(["b.md"]);
    const phone = await ownerSecondDevice(owner);
    for (let index = 0; index < 20; index += 1) {
      await owner.vault.writeTextFile(`new${index}.md`, `# new ${index}\n`);
      await owner.state.enqueue("write", `new${index}.md`);
    }
    await owner.worker.runCycle();
    await phone.vault.writeTextFile("mine.md", "# waiting here\n");
    await phone.state.enqueue("write", "mine.md");
    const fetched = new Map<string, number>();
    const get = owner.store.get.bind(owner.store);
    owner.store.get = async (key, options) => {
      if (key.endsWith(".pvobj")) fetched.set(key, (fetched.get(key) ?? 0) + 1);
      return get(key, options);
    };
    await phone.worker.runCycle();
    owner.store.get = get;
    expect(fetched.size).toBeGreaterThanOrEqual(20);
    expect(Math.max(...fetched.values())).toBe(1);
  });
});

/**
 * Random changes on two and three devices of one workspace, one of them now
 * and then offline (review of release 0.9.0). Whatever they do: no text
 * written is nowhere afterwards — on no device and in no history — the
 * conflict copies stay few, and no queue is left hanging.
 */
describe("random concurrent changes", () => {
  const POOL = ["a.md", "b.md", "c.md", "F/x.md", "F/y.md"];
  function random(seed: number) {
    let x = (seed * 2654435761) >>> 0 || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  async function run(seed: number, deviceCount: number, offline: boolean) {
    const next = random(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)];
    const owner = await synced(["a.md", "b.md", "F/x.md"]);
    const devices: Device[] = [owner];
    for (let index = 1; index < deviceCount; index += 1) devices.push(await ownerSecondDevice(owner));
    for (const device of devices) await device.worker.runCycle();
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
        await device.worker.runCycle().catch(() => {});
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
    for (let round = 0; round < 8; round += 1) for (const device of devices) await device.worker.runCycle().catch(() => {});
    const { shown, history } = await everyText(devices);
    const nowhere = [...written].filter(([text, replaced]) => !replaced && !shown.has(text) && !history.has(sha(text))).map(([text]) => text.trim());
    const copies = Math.max(...devices.map((device) => Object.keys(filesOf(device.vault)).filter((path) => path.includes("CONFLICT")).length));
    const queues = await Promise.all(devices.map(async (device) => (await device.state.listQueue(1000)).length));
    return { nowhere, copies, queues };
  }
  const SEEDS = [138, 1, 5, 12, 23, 29, 41, 57, 77, 99];
  it.each([[2, false], [3, false], [3, true]] as const)("on %i devices (one offline at times: %s): nothing nowhere, few copies, no queue left", { timeout: 300_000 }, async (deviceCount, offline) => {
    for (const seed of SEEDS) {
      const outcome = await run(seed, deviceCount, offline);
      expect({ seed, nowhere: outcome.nowhere }).toEqual({ seed, nowhere: [] });
      expect(outcome.copies, `seed ${seed}`).toBeLessThanOrEqual(12);
      expect(outcome.queues.every((length) => length === 0), `seed ${seed}`).toBe(true);
    }
  });
});
