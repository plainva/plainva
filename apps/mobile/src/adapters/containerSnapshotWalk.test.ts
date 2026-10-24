import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapacitorVaultAdapter } from "./CapacitorVaultAdapter";

/**
 * The phone's own folder, asked for a folder as the tree shows it (review of
 * issue 125). The snapshot before a recursive delete asks so
 * (`BackupVaultAdapter`, phone only): it keeps the files the tree shows, and
 * the walk does not go into a dot-named folder for it. This adapter's
 * reporting walk lists such entries for the index; a folder there that
 * cannot be listed failed that walk, and with it the snapshot of every
 * visible file of the folder being deleted.
 */

const readdir = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" },
  Filesystem: { readdir },
}));
vi.mock("../platform/atomicFile", () => ({ atomicWriteText: vi.fn(), atomicWriteBase64: vi.fn() }));

const file = (name: string) => ({ name, type: "file", size: 1, mtime: 1, ctime: 1, uri: "" });
const dir = (name: string) => ({ name, type: "directory", size: 0, mtime: 1, ctime: 1, uri: "" });
const tree: Record<string, unknown[]> = {
  "vault/Projekte": [file("a.md"), dir("Sub"), dir(".git")],
  "vault/Projekte/Sub": [file("b.md"), file(".hidden.md")],
};

beforeEach(() => {
  readdir.mockReset();
  readdir.mockImplementation(async ({ path }: { path: string }) => {
    if (path === "vault/Projekte/.git") throw new Error("The folder cannot be read");
    return { files: tree[path] ?? [] };
  });
});

describe("the phone's own folder, as the tree shows it", () => {
  it("is listed without going into a dot-named folder, and without what lies in one", async () => {
    const listing = await new CapacitorVaultAdapter().listDirReport("Projekte", true, { followLinks: false, dotEntries: false });
    expect(listing.files.map((f) => f.path).sort()).toEqual(["Projekte/Sub", "Projekte/Sub/b.md", "Projekte/a.md"]);
    expect(listing.skipped).toEqual([]);
    expect(readdir.mock.calls.map(([args]) => (args as { path: string }).path)).not.toContain("vault/Projekte/.git");
  });

  it("…while the walk of the index lists dot-named entries as before", async () => {
    // What the index holds of them must not go missing from its walk: the
    // next full scan would report them gone, and the sync would delete them
    // remotely. Whether dot-named files belong in the index — the desktop's
    // walk lists them, a picked folder's does not — is a question of its own,
    // not this walk's to change in passing.
    readdir.mockImplementation(async ({ path }: { path: string }) => ({
      files: path === "vault/Projekte/.git" ? [file("config")] : tree[path] ?? [],
    }));
    const listing = await new CapacitorVaultAdapter().listDirReport("Projekte", true);
    expect(listing.files.map((f) => f.path).sort()).toEqual([
      "Projekte/.git", "Projekte/.git/config", "Projekte/Sub", "Projekte/Sub/.hidden.md", "Projekte/Sub/b.md", "Projekte/a.md",
    ]);
  });
});
