import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A symlinked directory pointing back into the vault used to be walked as if it
 * were a second, independent folder: `visited` held PATHS, and two paths that
 * name the same directory look different to a string set. Every note under it
 * reached the index — and the sync queue — twice, under two paths. The walk now
 * keys `visited` on the directory's identity (dev+ino) where the platform
 * reports one, so whichever path arrives first wins and walk order stops
 * mattering.
 */

type Entry = { name: string; isDirectory: boolean };
type Node = { isDirectory: boolean; dev: number | null; ino: number | null; children?: Entry[] };

/** Absolute path -> node. Symlinks are modelled the way the filesystem reports
 *  them: readDir's isDirectory is false, stat() resolves and shares the target's
 *  identity. */
let fs = new Map<string, Node>();

const readDirMock = vi.fn(async (p: string) => {
  const node = fs.get(p);
  if (!node?.children) throw new Error(`ENOTDIR ${p}`);
  return node.children;
});
const statMock = vi.fn(async (p: string) => {
  const node = fs.get(p);
  if (!node) throw new Error(`ENOENT ${p}`);
  return {
    isDirectory: node.isDirectory,
    isFile: !node.isDirectory,
    size: 0,
    mtime: new Date(1),
    birthtime: new Date(1),
    dev: node.dev,
    ino: node.ino,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: (...a: unknown[]) => readDirMock(...(a as [string])),
  stat: (...a: unknown[]) => statMock(...(a as [string])),
  exists: async (p: string) => fs.has(p),
  readTextFile: async () => "",
  readFile: async () => new Uint8Array(),
  remove: async () => {},
  rename: async () => {},
  mkdir: async () => {},
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.filter(Boolean).join("/"),
  normalize: async (p: string) => p.replace(/\/+$/, ""),
  sep: () => "/",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "root-1" }));

import { TauriVaultAdapter } from "./TauriVaultAdapter";

const ROOT = "/vault";

/**
 * Tools/real is a real directory; Tools/alias is a symlink to it. Both hold the
 * same note. `identified` switches dev/ino on and off: Windows reports neither,
 * and the walk must still terminate there (via the path guard and the depth cap)
 * rather than break.
 */
function seed(identified: boolean) {
  const id = (dev: number, ino: number) =>
    identified ? { dev, ino } : { dev: null, ino: null };
  fs = new Map<string, Node>([
    ["/vault", { isDirectory: true, ...id(1, 1), children: [{ name: "Tools", isDirectory: true }] }],
    ["/vault/Tools", {
      isDirectory: true, ...id(1, 2),
      children: [{ name: "real", isDirectory: true }, { name: "alias", isDirectory: false }],
    }],
    // The symlink and its target are the same directory, so they share dev+ino.
    ["/vault/Tools/real", { isDirectory: true, ...id(1, 100), children: [{ name: "X.md", isDirectory: false }] }],
    ["/vault/Tools/alias", { isDirectory: true, ...id(1, 100), children: [{ name: "X.md", isDirectory: false }] }],
    ["/vault/Tools/real/X.md", { isDirectory: false, ...id(1, 101) }],
    ["/vault/Tools/alias/X.md", { isDirectory: false, ...id(1, 101) }],
  ]);
}

describe("walk identity guard", () => {
  beforeEach(() => {
    readDirMock.mockClear();
    statMock.mockClear();
  });

  it("walks a symlinked directory only once", async () => {
    seed(true);
    const report = await new TauriVaultAdapter(ROOT).listDirReport("", true);
    const notes = report.files.filter((f) => f.name === "X.md").map((f) => f.path);
    expect(notes).toEqual(["Tools/real/X.md"]);
    expect(report.skipped).toContainEqual({ path: "Tools/alias", reason: "cycle" });
  });

  it("still walks a symlinked directory where the platform reports no identity", async () => {
    seed(false);
    const report = await new TauriVaultAdapter(ROOT).listDirReport("", true);
    // Windows: dev/ino are null, so the duplicate is not detectable here. The
    // walk must still finish — the depth cap is what stops a true loop there.
    expect(report.files.filter((f) => f.name === "X.md")).toHaveLength(2);
  });

  it("costs no extra filesystem call per directory", async () => {
    seed(true);
    await new TauriVaultAdapter(ROOT).listDirReport("", true);
    // One stat per directory entered (3: root, Tools, real) plus one per
    // non-directory entry (alias, X.md). The identity comes from the stat that
    // replaced the exists() guard, not from an added call.
    expect(statMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
