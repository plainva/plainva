import { afterEach, describe, expect, it } from "vitest";
import { type IDatabaseAdapter } from "../src/index.js";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore } from "../src/workspace/index.js";
import { live, ownerSecondDevice, queued, synced } from "./helpers/workspaceReconcile.ts";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * A note deleted and made again under its name (release 0.9.0, review of A4).
 * The worker took the deleted object for its source and sent a "write"
 * without a revision parent; every reader refuses that, and the push failed
 * at it for good — with everything queued behind it. In the database the
 * path is one object's at a time, so the new note also has to take it over
 * from the deleted one, here and on the device that receives it.
 */
describe.each(["memory", "sql"] as const)("a note deleted and made again under its name (%s state)", (kind) => {
  const databases: IDatabaseAdapter[] = [];
  afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
  const makeState = async () => {
    if (kind === "memory") return new MemoryWorkspaceStateStore();
    const db = await realSqlite();
    databases.push(db);
    return new SqlWorkspaceStateStore(db);
  };

  it("goes up as a new note, with what is queued behind it, and reaches the other device", { timeout: 30_000 }, async () => {
    const owner = await synced(["a.md", "b.md"], makeState);
    const phone = await ownerSecondDevice(owner, makeState);
    await owner.vault.deleteItem("a.md");
    await owner.state.enqueue("delete", "a.md", null, { confirmed: true });
    await owner.worker.runCycle();
    await phone.worker.runCycle();
    expect(phone.vault.files.has("a.md")).toBe(false);

    await owner.vault.writeTextFile("a.md", "# a new note, same name\n");
    await owner.state.enqueue("write", "a.md");
    await owner.vault.writeTextFile("c.md", "# behind it\n");
    await owner.state.enqueue("write", "c.md");
    await owner.worker.runCycle();
    expect(await queued(owner.state)).toEqual([]);
    expect(await live(owner.state, "a.md")).toBe(true);
    expect(await live(owner.state, "c.md")).toBe(true);

    await phone.worker.runCycle();
    expect(await phone.vault.readTextFile("a.md")).toBe("# a new note, same name\n");
    expect(await phone.vault.readTextFile("c.md")).toBe("# behind it\n");
    expect(await live(phone.state, "a.md")).toBe(true);
  });

  it("made again while the app was closed, the start queues it and it goes up", { timeout: 30_000 }, async () => {
    const owner = await synced(["a.md", "b.md"], makeState);
    await owner.vault.deleteItem("a.md");
    await owner.state.enqueue("delete", "a.md", null, { confirmed: true });
    await owner.worker.runCycle();

    await owner.vault.writeTextFile("a.md", "# back again\n");
    await owner.reconcile();
    expect(await queued(owner.state)).toEqual(["write a.md"]);
    await owner.worker.runCycle();
    expect(await queued(owner.state)).toEqual([]);
    expect(await live(owner.state, "a.md")).toBe(true);
  });

  it("a folder deleted and made again goes up as a new folder", { timeout: 30_000 }, async () => {
    const owner = await synced(["Notes/a.md", "b.md"], makeState);
    await owner.vault.deleteItem("Notes", true);
    await owner.state.enqueue("delete", "Notes/a.md", null, { confirmed: true });
    await owner.state.enqueue("delete", "Notes", null, { confirmed: true });
    await owner.worker.runCycle();
    await owner.vault.createDir("Notes");
    await owner.state.enqueue("mkdir", "Notes");
    await owner.worker.runCycle();
    expect(await queued(owner.state)).toEqual([]);
    expect(await live(owner.state, "Notes")).toBe(true);
  });
});
