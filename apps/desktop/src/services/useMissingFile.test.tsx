// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VaultFileNotFoundError, type MissingFileDeps } from "@plainva/core";
import { assertFileStillThere, isFileNotFound, useMissingFile, type MissingFile, type MissingFileSurface } from "@plainva/ui";

/**
 * Issue 110 (E9) for every surface that shows one vault file other than a
 * note — a database, an image — in both shells: the state around the shared
 * search. Runs over a small index that behaves like the real one where it
 * matters: rows follow the disk only when a reconcile passes, so a file moved
 * while nobody watched is found late, and one the watcher removed is known
 * only by what the surface remembered.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAMP = 1_727_000_000_000;
type Row = { sha256: string; mtime: number };
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function vault(files: Record<string, Row>) {
  const disk = new Map(Object.entries(files));
  const rows = new Map(Object.entries(files));
  const sync = (folder: string | null) => {
    const within = (p: string) => folder === null || parentOf(p) === folder;
    for (const p of [...rows.keys()]) if (within(p) && !disk.has(p)) rows.delete(p);
    for (const [p, r] of disk) if (within(p)) rows.set(p, r);
  };
  const deps = {
    exists: vi.fn(async (p: string) => disk.has(p)),
    db: {
      queryOne: async (_sql: string, params?: unknown[]) => {
        const r = rows.get(String(params?.[0]));
        return r ? { sha256: r.sha256, mtime_local: r.mtime } : null;
      },
      query: async (_sql: string, params?: unknown[]) =>
        [...rows]
          .filter(([p, r]) => r.sha256 === params?.[0] && p !== params?.[1])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([path, r]) => ({ path, mtime_local: r.mtime })),
    },
    indexer: {
      reconcileFolder: vi.fn(async (folder: string) => sync(folder)),
      indexVaultFull: vi.fn(async () => sync(null)),
    },
  };
  return {
    deps: deps as unknown as MissingFileDeps & typeof deps,
    rows,
    /** Outside Plainva: the disk changes, the index does not. */
    move(from: string, to: string) { disk.set(to, disk.get(from)!); disk.delete(from); },
    remove(path: string) { disk.delete(path); },
    /** The watcher saw a side of it. */
    index(path: string) { const r = disk.get(path); if (r) rows.set(path, r); else rows.delete(path); },
  };
}

let container: HTMLDivElement;
let root: Root;
let current: MissingFile;
function Probe({ path, surface }: { path: string; surface: MissingFileSurface }) {
  const missing = useMissingFile(path, surface);
  useEffect(() => {
    current = missing;
  });
  return null;
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
};
async function mount(path: string, surface: MissingFileSurface) {
  await act(async () => { root.render(<Probe path={path} surface={surface} />); });
}
function surfaceOf(deps: MissingFileDeps | null, extra: Partial<MissingFileSurface> = {}) {
  const log: string[] = [];
  const surface: MissingFileSurface = {
    deps,
    scope: "vault",
    adopt: vi.fn(async (from: string, to: string) => { log.push(`adopt ${from} -> ${to}`); }),
    follow: vi.fn((to: string) => { log.push(`follow ${to}`); }),
    onIndexChanged: vi.fn(),
    ...extra,
  };
  return { surface, log };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useMissingFile", () => {
  it("follows a proven move once, after the stored paths went along, without showing a card", async () => {
    const v = vault({ "db/Links.base": { sha256: "h-links", mtime: STAMP } });
    v.move("db/Links.base", "db/taken/Links.base");
    v.index("db/taken/Links.base");
    const { surface, log } = surfaceOf(v.deps);
    await mount("db/Links.base", surface);

    await act(async () => current.look());
    expect(current.lookup).toEqual({ kind: "checking" });
    await settle();

    expect(log).toEqual(["adopt db/Links.base -> db/taken/Links.base", "follow db/taken/Links.base"]);
    expect(current.lookup).toEqual({ kind: "checking" });
    expect(v.deps.indexer.indexVaultFull).not.toHaveBeenCalled();
    expect(surface.onIndexChanged).toHaveBeenCalled();
  });

  it("takes along what the surface holds before it follows", async () => {
    const v = vault({ "db/Carry.base": { sha256: "h-carry", mtime: STAMP } });
    v.move("db/Carry.base", "db/taken/Carry.base");
    v.index("db/taken/Carry.base");
    const log: string[] = [];
    const { surface } = surfaceOf(v.deps, {
      adopt: async () => { log.push("adopt"); },
      carry: async (to) => { log.push(`carry ${to}`); return true; },
      follow: (to) => { log.push(`follow ${to}`); },
    });
    await mount("db/Carry.base", surface);
    await act(async () => current.look());
    await settle();
    expect(log).toEqual(["adopt", "carry db/taken/Carry.base", "follow db/taken/Carry.base"]);
  });

  it("offers the file instead of following when the change could not go along", async () => {
    const v = vault({ "db/Stuck.base": { sha256: "h-stuck", mtime: STAMP } });
    v.move("db/Stuck.base", "db/taken/Stuck.base");
    v.index("db/taken/Stuck.base");
    const { surface, log } = surfaceOf(v.deps, { carry: async () => false });
    await mount("db/Stuck.base", surface);
    await act(async () => current.look());
    await settle();
    expect(log).toEqual(["adopt db/Stuck.base -> db/taken/Stuck.base"]);
    expect(current.lookup).toEqual({ kind: "ask", candidates: ["db/taken/Stuck.base"], searching: false });
  });

  it("asks when the content exists twice, and a pick takes the stored paths along and follows", async () => {
    const v = vault({
      "img/red.png": { sha256: "h-red", mtime: STAMP },
      "img/copy/red.png": { sha256: "h-red", mtime: STAMP - 86_400_000 },
    });
    v.move("img/red.png", "img/taken/red.png");
    v.index("img/taken/red.png");
    const { surface, log } = surfaceOf(v.deps);
    await mount("img/red.png", surface);
    await act(async () => current.look());
    await settle();

    expect(current.lookup).toEqual({ kind: "ask", candidates: ["img/copy/red.png", "img/taken/red.png"], searching: false });
    expect(log).toEqual([]);
    await act(async () => current.pick("img/taken/red.png"));
    await settle();
    expect(log).toEqual(["adopt img/red.png -> img/taken/red.png", "follow img/taken/red.png"]);
  });

  it("finds a move nobody watched in the vault-wide pass and follows it then", async () => {
    const v = vault({ "db/Late.base": { sha256: "h-late", mtime: STAMP } });
    v.move("db/Late.base", "elsewhere/Late.base");
    let release!: () => void;
    v.deps.indexer.indexVaultFull.mockImplementationOnce(async () => {
      await new Promise<void>((r) => { release = r; });
      v.index("elsewhere/Late.base");
    });
    const { surface, log } = surfaceOf(v.deps);
    await mount("db/Late.base", surface);
    await act(async () => current.look());
    await settle();

    expect(current.lookup).toEqual({ kind: "gone", searching: true });
    await act(async () => release());
    await settle();
    expect(log).toEqual(["adopt db/Late.base -> elsewhere/Late.base", "follow elsewhere/Late.base"]);
  });

  it("settles on the missing state for a file that is really gone, with its row removed", async () => {
    const v = vault({ "db/Gone.base": { sha256: "h-gone", mtime: STAMP }, "db/Other.base": { sha256: "h-other", mtime: STAMP } });
    v.remove("db/Gone.base");
    const { surface, log } = surfaceOf(v.deps);
    await mount("db/Gone.base", surface);
    await act(async () => current.look());
    await settle();
    expect(current.lookup).toEqual({ kind: "gone", searching: false });
    expect(log).toEqual([]);
    expect(v.rows.has("db/Gone.base")).toBe(false);
    expect(v.rows.has("db/Other.base")).toBe(true);
  });

  it("leaves the surface's own error for a file that is there after all", async () => {
    const v = vault({ "db/Here.base": { sha256: "h-here", mtime: STAMP } });
    const { surface, log } = surfaceOf(v.deps);
    await mount("db/Here.base", surface);
    await act(async () => current.look());
    await settle();
    expect(current.lookup).toBeNull();
    expect(log).toEqual([]);
  });

  it("finds a file whose row the watcher already removed by what the surface remembered", async () => {
    const v = vault({ "db/Open.base": { sha256: "h-open", mtime: STAMP } });
    const { surface, log } = surfaceOf(v.deps);
    await mount("db/Open.base", surface);
    await act(async () => current.remember());
    await settle();
    // Moved while open: the watcher removed the old row and indexed the new place.
    v.move("db/Open.base", "db/taken/Open.base");
    v.index("db/Open.base");
    v.index("db/taken/Open.base");
    await act(async () => current.look());
    await settle();
    expect(log).toEqual(["adopt db/Open.base -> db/taken/Open.base", "follow db/taken/Open.base"]);
  });

  it("offers the file where the surface cannot navigate", async () => {
    const v = vault({ "db/Peek.base": { sha256: "h-peek", mtime: STAMP } });
    v.move("db/Peek.base", "db/taken/Peek.base");
    v.index("db/taken/Peek.base");
    const { surface } = surfaceOf(v.deps, { follow: undefined });
    await mount("db/Peek.base", surface);
    await act(async () => current.look());
    await settle();
    expect(current.lookup).toEqual({ kind: "ask", candidates: ["db/taken/Peek.base"], searching: false });
  });

  it("does not navigate a surface the reader left while its change was on the way", async () => {
    const v = vault({ "db/Left.base": { sha256: "h-left", mtime: STAMP } });
    v.move("db/Left.base", "db/taken/Left.base");
    v.index("db/taken/Left.base");
    let release!: (ok: boolean) => void;
    const { surface, log } = surfaceOf(v.deps, { carry: () => new Promise<boolean>((r) => { release = r; }) });
    await mount("db/Left.base", surface);
    await act(async () => current.look());
    await settle();
    await act(async () => root.render(null));
    await act(async () => release(true));
    await settle();
    expect(log).toEqual(["adopt db/Left.base -> db/taken/Left.base"]);
  });

  it("does not look where there is no index to look in", async () => {
    const { surface } = surfaceOf(null);
    await mount("db/NoIndex.base", surface);
    await act(async () => current.look());
    await settle();
    expect(current.lookup).toBeNull();
  });
});

describe("assertFileStillThere", () => {
  it("lets a write through only over the file that is there", async () => {
    await expect(assertFileStillThere({ exists: async () => true }, "db/Links.base")).resolves.toBeUndefined();
    const refused = await assertFileStillThere({ exists: async () => false }, "db/Links.base").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(VaultFileNotFoundError);
    expect(isFileNotFound(refused)).toBe(true);
  });

  it("recognises the error across a window boundary by its code", () => {
    expect(isFileNotFound({ code: "FILE_NOT_FOUND", message: "gone" })).toBe(true);
    expect(isFileNotFound(new Error("disk full"))).toBe(false);
    expect(isFileNotFound(null)).toBe(false);
  });
});
