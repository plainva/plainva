import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import type { IVaultAdapter } from "../src/vault/IVaultAdapter.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";

/**
 * The memory vault answers like the disk (helpers/memoryVault.ts).
 *
 * Tests that only care what a vault contains run on it instead of on real
 * files; they stay honest only while it answers every call they make the way
 * LocalVaultAdapter does. So one script runs against both, and every answer —
 * contents, listings, folders created on the way, and the kind of error — must
 * match. Times are left out: the disk's clock is not the test's.
 */

type Step = [string, (vault: IVaultAdapter) => Promise<unknown>];

const bytes = (data: Uint8Array) => [...data];
const listing = (entries: Array<{ path: string; name: string; isDirectory: boolean; size: number }>) =>
  entries.map(({ path, name, isDirectory, size }) => ({ path, name, isDirectory, size })).sort((a, b) => (a.path < b.path ? -1 : 1));

const SCRIPT: Step[] = [
  ["write with parents", (v) => v.writeTextFile("a/b/note.md", "hello")],
  ["exists", async (v) => [await v.exists("a"), await v.exists("a/b"), await v.exists("a/b/note.md"), await v.exists("nope.md")]],
  ["read", (v) => v.readTextFile("a/b/note.md")],
  ["read missing", (v) => v.readTextFile("nope.md")],
  ["read a folder", (v) => v.readTextFile("a")],
  ["read outside", (v) => v.readTextFile("../outside.md")],
  ["read absolute", (v) => v.readTextFile("/etc/hosts")],
  ["file info", async (v) => { const i = await v.getFileInfo("a/b/note.md"); return [i.path, i.name, i.isDirectory, i.size]; }],
  ["folder info", async (v) => { const i = await v.getFileInfo("a"); return [i.path, i.name, i.isDirectory, i.size]; }],
  ["info missing", (v) => v.getFileInfo("nope.md")],
  ["binary", async (v) => { await v.writeBinaryFile("img/x.png", new Uint8Array([1, 2, 3])); return bytes(await v.readBinaryFile("img/x.png")); }],
  ["rewrite", async (v) => { await v.writeTextFile("a/b/note.md", "hello again"); return v.readTextFile("a/b/note.md"); }],
  ["list all", async (v) => listing(await v.listDir("", true))],
  ["list one level", async (v) => listing(await v.listDir("a"))],
  ["list a file", (v) => v.listDir("a/b/note.md")],
  ["list missing", (v) => v.listDir("nope")],
  ["create folders", async (v) => { await v.createDir("c/d"); return [await v.exists("c"), await v.exists("c/d")]; }],
  ["create over a file", (v) => v.createDir("a/b/note.md")],
  ["rename a file", async (v) => { await v.renameItem("a/b/note.md", "e/f/moved.md"); return [await v.exists("a/b/note.md"), await v.readTextFile("e/f/moved.md")]; }],
  ["rename missing", async (v) => { const error = await v.renameItem("nope.md", "x/y.md").catch((e) => e); return [error?.name, await v.exists("x")]; }],
  ["rename onto a file", async (v) => { await v.writeTextFile("g.md", "1"); return v.renameItem("e/f/moved.md", "g.md"); }],
  ["rename a folder", async (v) => { await v.writeTextFile("c/d/inner.md", "in"); await v.renameItem("c", "c2"); return listing(await v.listDir("c2", true)); }],
  ["delete missing", (v) => v.deleteItem("nope.md")],
  ["delete a folder without recursive", (v) => v.deleteItem("c2")],
  ["delete a folder", async (v) => { await v.deleteItem("c2", true); return v.exists("c2"); }],
  ["delete a file", async (v) => { await v.deleteItem("g.md"); return v.exists("g.md"); }],
  ["backup listing", async (v) => { await v.writeTextFile(".plainva/state.json", "{}"); return listing(await v.listDirForBackup!([".plainva"])); }],
  ["final tree", async (v) => listing(await v.listDir("", true))],
];

/** Each step's answer, or the kind of error it ended in. */
async function run(vault: IVaultAdapter): Promise<Array<[string, unknown]>> {
  await vault.initialize();
  const answers: Array<[string, unknown]> = [];
  for (const [name, step] of SCRIPT) {
    try {
      answers.push([name, (await step(vault)) ?? "done"]);
    } catch (error) {
      const e = error as { name?: string; code?: string };
      answers.push([name, { error: e.name, code: e.code }]);
    }
  }
  return answers;
}

const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await rm(folder, { recursive: true, force: true }); });

describe("the memory vault", () => {
  it("answers the script exactly as the disk does", async () => {
    const folder = await mkdtemp(join(tmpdir(), "plainva-memory-vault-"));
    folders.push(folder);
    const disk = await run(new LocalVaultAdapter(folder));
    const memory = await run(new MemoryVaultAdapter());
    expect(memory).toEqual(disk);
    // The script reached the interesting cases rather than failing early.
    expect(disk.find(([name]) => name === "read missing")?.[1]).toEqual({ error: "VaultFileNotFoundError", code: "FILE_NOT_FOUND" });
    expect(disk.find(([name]) => name === "rename onto a file")?.[1]).toEqual({ error: "VaultFileExistsError", code: "FILE_EXISTS" });
  });

  it("moves a file's modification time forward on every write", async () => {
    const vault = new MemoryVaultAdapter(1_000);
    await vault.writeTextFile("n.md", "1");
    const first = (await vault.getFileInfo("n.md")).mtime;
    await vault.writeTextFile("n.md", "1");
    expect((await vault.getFileInfo("n.md")).mtime).toBeGreaterThan(first);
  });
});
