import { describe, expect, it } from "vitest";
import { writeNewVault, type NewVaultFolderPorts, type TrackWrites } from "@plainva/ui";

const ROOT = "/Docs/Plainva Tour";

/**
 * A disk of paths, folders and files, with the semantics of the real calls:
 * a mkdir fails at anything that is there, a folder delete fails at a folder
 * with anything in it. `removed` lists every delete that went through.
 */
function disk(present: Record<string, "dir" | "file"> = {}) {
  const entries = new Map<string, "dir" | "file">(Object.entries(present));
  const removed: string[] = [];
  const forgotten: string[] = [];
  const hasChildren = (p: string) => [...entries.keys()].some((k) => k.startsWith(p + "/"));
  const ports: NewVaultFolderPorts = {
    makeDir: async (p) => {
      if (entries.has(p)) throw new Error(`exists: ${p}`);
      entries.set(p, "dir");
    },
    removeFile: async (p) => {
      if (entries.get(p) !== "file") throw new Error(`no file: ${p}`);
      entries.delete(p);
      removed.push(p);
    },
    removeEmptyDir: async (p) => {
      if (entries.get(p) !== "dir") throw new Error(`no folder: ${p}`);
      if (hasChildren(p)) throw new Error(`not empty: ${p}`);
      entries.delete(p);
      removed.push(p);
    },
    forget: async (p) => { forgotten.push(p); },
  };
  /** A vault adapter over the disk, as the scaffolder sees one (the real one makes parents itself). */
  const adapter = {
    listDir: async (dir = "") => {
      const base = dir ? `${ROOT}/${dir}` : ROOT;
      return [...entries.keys()].filter((k) => k.startsWith(base + "/") && !k.slice(base.length + 1).includes("/")).map((k) => ({ name: k.slice(base.length + 1) }));
    },
    writeTextFile: async (path: string, _content: string) => {
      const full = `${ROOT}/${path}`;
      for (let i = full.indexOf("/", ROOT.length + 1); i > 0; i = full.indexOf("/", i + 1)) entries.set(full.slice(0, i), "dir");
      entries.set(full, "file");
    },
    createDir: async (path: string) => { entries.set(`${ROOT}/${path}`, "dir"); },
  };
  return { entries, removed, forgotten, ports, adapter, paths: () => [...entries.keys()].sort() };
}

/** What the scaffolder does: refuse a folder with anything in it, then write. */
async function scaffold(track: TrackWrites, a: ReturnType<typeof disk>["adapter"], steps: (t: typeof a) => Promise<void>) {
  const tracked = track(a);
  if ((await tracked.listDir("")).length > 0) throw new Error("Vault templates can only be used when creating a new, empty vault.");
  await steps(tracked);
}

describe("writeNewVault — takes back only what the failed attempt wrote (second and third review of O8)", () => {
  it("a tour that fails halfway leaves nothing: its files, its folders, its app data go", async () => {
    const d = disk();
    await expect(writeNewVault(ROOT, d.ports, (track) => scaffold(track, d.adapter, async (a) => {
      await a.createDir("Projects");
      await a.writeTextFile("Projects/Plan.md", "x");
      await a.writeTextFile(".plainva/starter.json", "{}");
      throw new Error("disk full");
    }), { makeFolder: true })).rejects.toThrow("disk full");
    expect(d.paths()).toEqual([]);
    expect(d.forgotten).toEqual([ROOT]);
  });

  it("a folder of the person's that appears before the attempt makes it is never touched (a cloud client restoring Documents)", async () => {
    // The look for a free name found nothing; before the making, OneDrive puts the folder back.
    const d = disk({ [ROOT]: "dir", [`${ROOT}/My thesis.md`]: "file" });
    await expect(writeNewVault(ROOT, d.ports, (track) => scaffold(track, d.adapter, async () => {}), { makeFolder: true }))
      .rejects.toThrow("only be used when creating a new, empty vault");
    expect(d.removed).toEqual([]);
    expect(d.paths()).toContain(`${ROOT}/My thesis.md`);
    expect(d.forgotten).toEqual([]);
  });

  it("a folder of the person's that is there — whatever a look before said — keeps all but the attempt's own files", async () => {
    // The folder exists (an `exists` that erred would have called it absent); the write goes in, then fails.
    const d = disk({ [ROOT]: "dir", [`${ROOT}/My thesis.md`]: "file" });
    await expect(writeNewVault(ROOT, d.ports, async (track) => {
      const a = track(d.adapter);
      await a.writeTextFile("index.md", "x");
      throw new Error("EIO");
    }, { makeFolder: true })).rejects.toThrow("EIO");
    expect(d.removed).toEqual([`${ROOT}/index.md`]);
    expect(d.paths()).toEqual([ROOT, `${ROOT}/My thesis.md`]);
    expect(d.forgotten).toEqual([]);
  });

  it("a file that comes in while the attempt writes stays, and with it every folder it is in", async () => {
    const d = disk();
    await expect(writeNewVault(ROOT, d.ports, (track) => scaffold(track, d.adapter, async (a) => {
      await a.writeTextFile("Projects/Plan.md", "x");
      d.entries.set(`${ROOT}/Projects/theirs.md`, "file");
      await a.writeTextFile("Inbox/Note.md", "x");
      throw new Error("disk full");
    }), { makeFolder: true })).rejects.toThrow("disk full");
    expect(d.paths()).toEqual([ROOT, `${ROOT}/Projects`, `${ROOT}/Projects/theirs.md`]);
    // The folder stays, so its app data does too.
    expect(d.forgotten).toEqual([]);
  });

  it("the scaffolder's refusal of a folder that is not empty removes nothing, not even a folder this attempt made", async () => {
    const d = disk();
    await expect(writeNewVault(ROOT, d.ports, async (track) => {
      d.entries.set(`${ROOT}/arrived.md`, "file");
      await scaffold(track, d.adapter, async () => {});
    }, { makeFolder: true })).rejects.toThrow("only be used");
    expect(d.removed).toEqual([]);
    expect(d.paths()).toEqual([ROOT, `${ROOT}/arrived.md`]);
  });

  it("a folder picked in the dialog stays; what the attempt wrote into it goes, so a retry finds it empty", async () => {
    const d = disk({ "/Docs/Picked": "dir" });
    const PICKED = "/Docs/Picked";
    const adapter = {
      writeTextFile: async (path: string, _content: string) => { d.entries.set(`${PICKED}/${path}`, "file"); },
      createDir: async (path: string) => { d.entries.set(`${PICKED}/${path}`, "dir"); },
    };
    await expect(writeNewVault(PICKED, d.ports, async (track) => {
      const a = track(adapter);
      await a.createDir("Projects");
      await a.writeTextFile("Projects/Plan.md", "x");
      await a.writeTextFile("index.md", "x");
      throw new Error("denied");
    })).rejects.toThrow("denied");
    expect(d.paths()).toEqual([PICKED]);
    expect(d.forgotten).toEqual([]);
  });

  it("a write that succeeds leaves everything as written", async () => {
    const d = disk();
    await writeNewVault(ROOT, d.ports, (track) => scaffold(track, d.adapter, async (a) => {
      await a.writeTextFile("Projects/Plan.md", "x");
    }), { makeFolder: true });
    expect(d.removed).toEqual([]);
    expect(d.paths()).toEqual([ROOT, `${ROOT}/Projects`, `${ROOT}/Projects/Plan.md`]);
  });

  it("a take-back that fails as well does not hide the first error", async () => {
    const d = disk();
    d.ports.removeFile = async () => { throw new Error("busy"); };
    await expect(writeNewVault(ROOT, d.ports, (track) => scaffold(track, d.adapter, async (a) => {
      await a.writeTextFile("index.md", "x");
      throw new Error("disk full");
    }), { makeFolder: true })).rejects.toThrow("disk full");
    // The file could not go, so neither can its folder.
    expect(d.paths()).toEqual([ROOT, `${ROOT}/index.md`]);
  });
});
