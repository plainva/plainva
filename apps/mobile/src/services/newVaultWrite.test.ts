import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeNewVault } from "@plainva/ui";

/** The sandbox, with the plugin's own rules for mkdir and rmdir without `recursive`. */
const sandbox = vi.hoisted(() => ({ entries: new Map<string, "dir" | "file">(), calls: [] as string[], answers: [] as boolean[], asked: [] as string[] }));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    mkdir: async ({ path, recursive }: { path: string; recursive?: boolean }) => {
      sandbox.calls.push(`mkdir ${path}${recursive ? " -r" : ""}`);
      if (sandbox.entries.has(path)) throw new Error("Directory exists");
      sandbox.entries.set(path, "dir");
    },
    deleteFile: async ({ path }: { path: string }) => {
      sandbox.calls.push(`delete ${path}`);
      sandbox.entries.delete(path);
    },
    rmdir: async ({ path, recursive }: { path: string; recursive?: boolean }) => {
      sandbox.calls.push(`rmdir ${path}${recursive ? " -r" : ""}`);
      if ([...sandbox.entries.keys()].some((k) => k.startsWith(path + "/"))) throw new Error("Folder is not empty");
      sandbox.entries.delete(path);
    },
  },
}));
vi.mock("./mobileDialogs", () => ({
  mConfirm: async (opts: { title: string }) => {
    sandbox.asked.push(opts.title);
    return sandbox.answers.shift() ?? false;
  },
}));

const { sandboxNewVaultPorts, writeWithRetry } = await import("./newVaultWrite");

/** What the scaffolder writes, through the tracked adapter, into the container `vaults/v`. */
const adapter = {
  writeTextFile: async (path: string, _content: string) => { sandbox.entries.set(`vaults/v/${path}`, "file"); },
  createDir: async (path: string) => { sandbox.entries.set(`vaults/v/${path}`, "dir"); },
};

beforeEach(() => {
  sandbox.entries.clear();
  sandbox.calls.length = 0;
  sandbox.answers.length = 0;
  sandbox.asked.length = 0;
});

describe("a new vault's structure on the phone (third review of O8, as on the desktop)", () => {
  it("a failed attempt takes back its own files and folders, says so, and a second try writes the whole structure", async () => {
    sandbox.entries.set("vaults", "dir");
    let attempt = 0;
    sandbox.answers.push(true);
    const made = await writeWithRetry(() => writeNewVault("vaults/v", sandboxNewVaultPorts, async (track) => {
      const a = track(adapter);
      attempt += 1;
      await a.createDir("Projects");
      await a.writeTextFile("Projects/Plan.md", "x");
      if (attempt === 1) throw new Error("No space left on device");
      await a.writeTextFile("index.md", "x");
    }, { makeFolder: true }));
    expect(made).toBe(true);
    expect(sandbox.asked).toHaveLength(1);
    expect([...sandbox.entries.keys()].sort()).toEqual(["vaults", "vaults/v", "vaults/v/Projects", "vaults/v/Projects/Plan.md", "vaults/v/index.md"]);
    // Never recursive: neither a mkdir that could make what is there, nor an rmdir that could take what is not ours.
    expect(sandbox.calls.filter((c) => c.endsWith(" -r"))).toEqual([]);
  });

  it("a file that is not the attempt's keeps its folder, and the person may stop", async () => {
    sandbox.entries.set("vaults/v", "dir");
    sandbox.entries.set("vaults/v/theirs.md", "file");
    const made = await writeWithRetry(() => writeNewVault("vaults/v", sandboxNewVaultPorts, async (track) => {
      await track(adapter).writeTextFile("index.md", "x");
      throw new Error("EIO");
    }, { makeFolder: true }));
    expect(made).toBe(false);
    expect([...sandbox.entries.keys()].sort()).toEqual(["vaults/v", "vaults/v/theirs.md"]);
  });
});
