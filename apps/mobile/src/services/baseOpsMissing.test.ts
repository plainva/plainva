import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue 110 (E9): a database open on the phone while its file is moved or
 * deleted in the Files app. Its config save must not recreate the file at the
 * old place — a duplicate of the moved database, or a deletion undone, which
 * sync would carry to every device. The screen keeps the change and looks for
 * the file; only the reader's "Save here again" writes there.
 */

vi.mock("./vaultService", () => ({ vaultOps: {}, noteSaver: {} }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({}) }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ name: "Vault" }) }));
vi.mock("./templateInteractive", () => ({ answerTemplateFile: vi.fn(), buildNewNoteFromTemplate: vi.fn() }));

import { saveBaseConfig } from "./baseOps";

const files = new Map<string, string>();
const vault = {
  files: {
    exists: async (p: string) => files.has(p),
    writeTextFile: vi.fn(async (p: string, text: string) => { files.set(p, text); }),
  },
  indexer: null,
} as any;
const config = { views: [{ type: "table", name: "Links" }] };

beforeEach(() => {
  files.clear();
  vault.files.writeTextFile.mockClear();
});

describe("saveBaseConfig", () => {
  it("never recreates a database whose file left its place", async () => {
    await expect(saveBaseConfig(vault, "4 blog/Links.base", config)).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(vault.files.writeTextFile).not.toHaveBeenCalled();
    expect(files.has("4 blog/Links.base")).toBe(false);
  });

  it("writes over the file that is there", async () => {
    files.set("4 blog/Links.base", "views: []\n");
    await saveBaseConfig(vault, "4 blog/Links.base", config);
    expect(files.get("4 blog/Links.base")).toContain("name: Links");
  });

  it("brings the file back only when the reader says so", async () => {
    await saveBaseConfig(vault, "4 blog/Links.base", config, { recreate: true });
    expect(files.get("4 blog/Links.base")).toContain("name: Links");
  });
});
