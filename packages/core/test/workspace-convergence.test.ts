import { afterEach, describe, expect, it } from "vitest";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore, type IDatabaseAdapter } from "../src/index.js";
import { chainPermissions, filesOf, ownerSecondDevice, queued, synced } from "./helpers/workspaceReconcile.ts";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * Two devices that changed the same thing at the same time end up showing the
 * same files (review of release 0.9.0). Until now each kept its own version
 * under the name and the other's as a conflict copy, for good: the next edit
 * on one device came to the other as yet another conflict copy. And when two
 * devices made the same new note — today's daily note on two devices — the
 * second one's text was overwritten by the first one's, without a copy.
 */
describe.each(["memory", "sql"] as const)("devices that changed the same thing at once agree (%s state)", (kind) => {
  const databases: IDatabaseAdapter[] = [];
  afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
  const makeState = async () => {
    if (kind === "memory") return new MemoryWorkspaceStateStore();
    const db = await realSqlite();
    databases.push(db);
    return new SqlWorkspaceStateStore(db);
  };
  async function threeDevices(names: string[]) {
    const owner = await synced(names, makeState);
    const one = await ownerSecondDevice(owner, makeState);
    const two = await ownerSecondDevice(owner, makeState);
    await one.worker.runCycle();
    return { owner, one, two };
  }
  const settle = async (...workers: Array<{ worker: { runCycle(): Promise<void> } }>) => {
    for (let round = 0; round < 3; round += 1) for (const device of workers) await device.worker.runCycle();
  };
  const texts = (files: Record<string, string>) => Object.values(files).sort();

  it("the same new note on two devices, the second pulling before it uploads: both texts stay, everywhere alike", { timeout: 60_000 }, async () => {
    const { owner, one, two } = await threeDevices(["b.md"]);
    await one.vault.writeTextFile("c.md", "# c from one\n");
    await one.state.enqueue("write", "c.md");
    await two.vault.writeTextFile("c.md", "# c from two\n");
    await two.state.enqueue("write", "c.md");
    await one.worker.runCycle();
    // Two pulls the first note while its own is still queued.
    await two.worker.runCycle();
    await settle(one, two, owner);
    expect(texts(filesOf(two.vault))).toEqual(["# b.md\n", "# c from one\n", "# c from two\n"]);
    expect(filesOf(one.vault)).toEqual(filesOf(two.vault));
    expect(filesOf(owner.vault)).toEqual(filesOf(two.vault));
    expect(await queued(two.state)).toEqual([]);
  });

  it("the same new note on two devices, both uploaded: one keeps the name on every device, the other is a copy, and editing the copy reaches everyone", { timeout: 60_000 }, async () => {
    const { owner, one, two } = await threeDevices(["b.md"]);
    await one.vault.writeTextFile("c.md", "# c from one\n");
    await one.state.enqueue("write", "c.md");
    await two.vault.writeTextFile("c.md", "# c from two\n");
    await two.state.enqueue("write", "c.md");
    // Both upload before either has seen the other's: two's listing does not show one's yet.
    await one.worker.runCycle();
    const store = owner.store;
    const list = store.list.bind(store);
    const deviceOne = one.runtime.device.publicIdentity.deviceId;
    store.list = async (...args: Parameters<typeof list>) => {
      const page = await list(...args);
      return { ...page, items: page.items.filter((item) => !(item.key.startsWith(".pvws/operations/") || item.key.startsWith(".pvws/heads/")) || !item.key.includes(deviceOne)) };
    };
    await two.worker.runCycle();
    store.list = list;
    await settle(one, two, owner);
    const shown = filesOf(one.vault);
    expect(texts(shown)).toEqual(["# b.md\n", "# c from one\n", "# c from two\n"]);
    expect(filesOf(two.vault)).toEqual(shown);
    expect(filesOf(owner.vault)).toEqual(shown);
    const copy = Object.keys(shown).find((path) => path.includes("CONFLICT"))!;
    await two.vault.writeTextFile(copy, "# the copy, edited\n");
    await two.state.enqueue("write", copy);
    const named = shown["c.md"] === "# c from one\n" ? "# c, edited on one\n" : "# c, edited on two\n";
    const editor = shown["c.md"] === "# c from one\n" ? one : two;
    await editor.vault.writeTextFile("c.md", named);
    await editor.state.enqueue("write", "c.md");
    await settle(one, two, owner);
    expect(filesOf(one.vault)).toEqual(filesOf(two.vault));
    expect(filesOf(owner.vault)).toEqual(filesOf(two.vault));
    expect(texts(filesOf(one.vault))).toEqual(["# b.md\n", "# the copy, edited\n", named].sort());
  });

  it("the same note edited on two devices: the same text under the name everywhere, and the next edit is no new copy", { timeout: 60_000 }, async () => {
    const { owner, one, two } = await threeDevices(["a.md"]);
    await one.vault.writeTextFile("a.md", "# one's edit\n");
    await one.state.enqueue("write", "a.md");
    await two.vault.writeTextFile("a.md", "# two's edit\n");
    await two.state.enqueue("write", "a.md");
    await one.worker.runCycle();
    await two.worker.runCycle();
    await settle(one, two, owner);
    const shown = filesOf(one.vault);
    expect(texts(shown)).toEqual(["# one's edit\n", "# two's edit\n"]);
    expect(filesOf(two.vault)).toEqual(shown);
    expect(filesOf(owner.vault)).toEqual(shown);
    // Whoever's text kept the name, the next edit of the note is just an edit.
    const editor = shown["a.md"] === "# one's edit\n" ? two : one;
    await editor.vault.writeTextFile("a.md", "# the next edit\n");
    await editor.state.enqueue("write", "a.md");
    await settle(one, two, owner);
    expect(Object.keys(filesOf(one.vault))).toEqual(Object.keys(shown));
    expect(filesOf(one.vault)["a.md"]).toBe("# the next edit\n");
    expect(filesOf(two.vault)).toEqual(filesOf(one.vault));
    expect(filesOf(owner.vault)).toEqual(filesOf(one.vault));
  });

  it("a note deleted and made again on one device while another edits it: nothing lost, every device alike, and the next edit is no new copy", { timeout: 60_000 }, async () => {
    const { owner, one, two } = await threeDevices(["a.md", "b.md"]);
    await two.vault.writeTextFile("a.md", "# a edited on two\n");
    await two.state.enqueue("write", "a.md");
    await one.vault.deleteItem("a.md");
    await one.state.enqueue("delete", "a.md", null, { confirmed: true });
    await one.vault.writeTextFile("a.md", "# a new on one\n");
    await one.state.enqueue("write", "a.md");
    await two.worker.runCycle();
    await one.worker.runCycle();
    await settle(two, one, owner);
    const shown = filesOf(one.vault);
    expect(texts(shown)).toEqual(["# a edited on two\n", "# a new on one\n", "# b.md\n"]);
    expect(filesOf(two.vault)).toEqual(shown);
    expect(filesOf(owner.vault)).toEqual(shown);
    for (const editor of [two, one]) {
      const path = Object.keys(filesOf(editor.vault)).find((candidate) => candidate.startsWith("a"))!;
      await editor.vault.writeTextFile(path, `# ${path} edited again\n`);
      await editor.state.enqueue("write", path);
      await settle(one, two, owner);
      expect(Object.keys(filesOf(one.vault))).toEqual(Object.keys(shown));
      expect(filesOf(two.vault)).toEqual(filesOf(one.vault));
      expect(filesOf(owner.vault)).toEqual(filesOf(one.vault));
    }
  });

  it("a conflict copy the workspace wrote is held: the app does not send it up again from every device", { timeout: 60_000 }, async () => {
    const { owner, one, two } = await threeDevices(["a.md"]);
    await one.vault.writeTextFile("a.md", "# one's edit\n");
    await one.state.enqueue("write", "a.md");
    await two.vault.writeTextFile("a.md", "# two's edit\n");
    await two.state.enqueue("write", "a.md");
    await one.worker.runCycle();
    await two.worker.runCycle();
    await settle(one, two, owner);
    const copy = Object.keys(filesOf(one.vault)).find((path) => path.includes("CONFLICT"))!;
    for (const device of [owner, one, two]) {
      const permissions = chainPermissions(device.vault, device.state, device.runtime);
      expect(await permissions.judgeExternalChange(copy, true)).toBe("held");
    }
    // Once the person edits it, it is a change like any other.
    await one.vault.writeTextFile(copy, "# the copy, edited\n");
    expect(await chainPermissions(one.vault, one.state, one.runtime).judgeExternalChange(copy, true)).toBe("allowed");
  });
});
