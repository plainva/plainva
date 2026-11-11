import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriVaultAdapter } from "./TauriVaultAdapter";

/**
 * The desktop reads many files for a pass of the index in one bridge call
 * (performance plan L2, `read_files_for_index` in `src-tauri/src/index_read.rs`).
 * What the adapter hands the index must be an answer it can trust, or a
 * `fallback` that sends the file down the ordinary read.
 */
const native = vi.hoisted(() => ({ many: vi.fn(), calls: [] as unknown[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: unknown) => {
  if (command === "register_write_root") return "root";
  if (command === "read_files_for_index") { native.calls.push(args); return native.many(args); }
  throw new Error("Unexpected filesystem command");
} }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn(), readFile: vi.fn(), stat: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/",
}));

const HASH = "a".repeat(64);

describe("reading many files for the index in one call", () => {
  const vault = new TauriVaultAdapter("/vault");
  beforeEach(() => { native.many.mockReset(); native.calls.length = 0; });

  it("sends every path once, with how it is read, under the vault's registered root", async () => {
    native.many.mockResolvedValue([{ kind: "text", text: "# A", sha256: HASH }, { kind: "bytes", sha256: HASH }]);
    const answers = await vault.readFilesForIndex([{ path: "a.md", text: true }, { path: "img/b.png", text: false }]);
    expect(native.calls).toEqual([{ rootId: "root", files: [{ relPath: "a.md", text: true }, { relPath: "img/b.png", text: false }] }]);
    expect(answers).toEqual([{ kind: "text", text: "# A", sha256: HASH }, { kind: "bytes", sha256: HASH }]);
  });

  it("asks nothing for no files", async () => {
    expect(await vault.readFilesForIndex([])).toEqual([]);
    expect(native.calls).toEqual([]);
  });

  it("takes no answer it cannot trust: each such file goes the ordinary way", async () => {
    native.many.mockResolvedValue([
      { kind: "text", text: "# A", sha256: "not a hash" },
      { kind: "text", text: 42, sha256: HASH },
      // The kind the file was not asked for.
      { kind: "bytes", sha256: HASH },
      { kind: "text", text: "x", sha256: HASH },
      { kind: "fallback" },
      null,
    ]);
    const answers = await vault.readFilesForIndex([
      { path: "1.md", text: true }, { path: "2.md", text: true }, { path: "3.md", text: true },
      { path: "4.png", text: false }, { path: "5.md", text: true }, { path: "6.md", text: true },
    ]);
    expect(answers).toEqual(Array.from({ length: 6 }, () => ({ kind: "fallback" })));
  });

  it("an answer for another number of files, or none (an older native side), sends the whole group the ordinary way", async () => {
    native.many.mockResolvedValue([{ kind: "fallback" }]);
    expect(await vault.readFilesForIndex([{ path: "a.md", text: true }, { path: "b.md", text: true }])).toEqual([{ kind: "fallback" }, { kind: "fallback" }]);
    native.many.mockResolvedValue(undefined);
    expect(await vault.readFilesForIndex([{ path: "a.md", text: true }])).toEqual([{ kind: "fallback" }]);
  });
});
