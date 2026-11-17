import { describe, expect, it, vi } from "vitest";
import { CapacitorVaultAdapter } from "./CapacitorVaultAdapter";
import { ExternalVaultAdapter } from "./ExternalVaultAdapter";
import { fakeAppStorage } from "./fakeAppStorage";
import { fakeVaultFolder } from "./fakeVaultFolder";

vi.mock("@capacitor/filesystem", async () => (await import("./fakeAppStorage")).capacitorFilesystem);
vi.mock("@capacitor/core", async () => (await import("./fakeAppStorage")).capacitorCore);

/**
 * `removeEmptyDir` on the phone (F44, third review): the sync takes a folder
 * another device deleted away here only while it holds nothing at all. The
 * phone's listings leave every dot-named entry out, so "empty" is asked of
 * the storage itself — a `.git` folder or a dot file keeps the folder, and
 * nothing goes recursively. The desktop's twin: apps/desktop/src/adapters/emptyFolderRemoval.test.ts.
 */
for (const system of ["ios", "android"] as const) {
  describe(`the app's own storage on ${system === "ios" ? "an iPhone" : "an Android phone"}`, () => {
    it("keeps a folder that holds only what its listings hide, and removes one that holds nothing", async () => {
      const { files } = fakeAppStorage(system);
      files.set("vault/Projekt/.git/config", "[core]\n");
      files.set("vault/Notizen/.notiz.md", "# hidden\n");
      const adapter = new CapacitorVaultAdapter("vault");
      await adapter.createDir("Leer");
      await adapter.createDir("Leer/Unter");

      await expect(adapter.removeEmptyDir("Projekt")).resolves.toBe(false);
      await expect(adapter.removeEmptyDir("Notizen")).resolves.toBe(false);
      expect(files.has("vault/Projekt/.git/config")).toBe(true);
      expect(files.has("vault/Notizen/.notiz.md")).toBe(true);

      await expect(adapter.removeEmptyDir("Leer")).resolves.toBe(false);
      await expect(adapter.removeEmptyDir("Leer/Unter")).resolves.toBe(true);
      await expect(adapter.removeEmptyDir("Leer")).resolves.toBe(true);
      await expect(adapter.exists("Leer")).resolves.toBe(false);
      await expect(adapter.removeEmptyDir("Fehlt")).resolves.toBe(true);
    });
  });
}

describe("a folder the user picked", () => {
  it("keeps a folder that holds only what its listings hide, and removes one that holds nothing", async () => {
    const files = new Map<string, string | Uint8Array>([
      ["Projekt/.git/config", "[core]\n"],
      ["Notizen/.notiz.md", "# hidden\n"],
    ]);
    const { plugin, dirs } = fakeVaultFolder(files);
    dirs.add("Leer");
    const adapter = new ExternalVaultAdapter(plugin, "h1");
    await adapter.initialize();

    await expect(adapter.removeEmptyDir("Projekt")).resolves.toBe(false);
    await expect(adapter.removeEmptyDir("Notizen")).resolves.toBe(false);
    expect(files.has("Projekt/.git/config")).toBe(true);
    expect(files.has("Notizen/.notiz.md")).toBe(true);
    await expect(adapter.removeEmptyDir("Leer")).resolves.toBe(true);
    expect(dirs.has("Leer")).toBe(false);
    await expect(adapter.removeEmptyDir("Fehlt")).resolves.toBe(true);
  });
});
