import { describe, expect, it } from "vitest";
import { StructureNeedsIndexError, StructureRefusingVaultAdapter, isStructureNeedsIndexError } from "../src/vault/StructureRefusingVaultAdapter.ts";
import { MemoryVaultAdapter } from "./helpers/memoryVault.ts";

/** The chain's link for a vault whose index database is closed (stability plan R5). */

async function vault() {
  const inner = new MemoryVaultAdapter(1_000);
  await inner.writeTextFile("Note.md", "# Note\n");
  await inner.writeTextFile("Folder/Child.md", "# Child\n");
  return { inner, link: new StructureRefusingVaultAdapter(inner) };
}

describe("StructureRefusingVaultAdapter", () => {
  it("refuses a deletion, a rename and a folder move before anything touches the disk", async () => {
    const { inner, link } = await vault();
    await expect(link.deleteItem("Note.md", false, { confirmed: true })).rejects.toBeInstanceOf(StructureNeedsIndexError);
    await expect(link.deleteItem("Folder", true, { confirmed: true })).rejects.toBeInstanceOf(StructureNeedsIndexError);
    await expect(link.renameItem("Note.md", "Other.md")).rejects.toBeInstanceOf(StructureNeedsIndexError);
    await expect(link.renameItem("Folder", "Moved")).rejects.toBeInstanceOf(StructureNeedsIndexError);
    // A move out of a device-local place into the vault would go up as new content unannounced: refused too.
    await expect(link.renameItem(".plainva/x.md", "x.md")).rejects.toBeInstanceOf(StructureNeedsIndexError);
    expect(await inner.exists("Note.md")).toBe(true);
    expect(await inner.exists("Folder/Child.md")).toBe(true);
    expect(await inner.exists("Other.md")).toBe(false);
    expect(await inner.exists("Moved")).toBe(false);
  });

  it("lets writing, creating and reading through: the next start with a database carries them", async () => {
    const { inner, link } = await vault();
    await link.writeTextFile("Note.md", "# Note\n\nedited\n");
    await link.writeTextFile("New folder/New.md", "# New\n");
    await link.writeBinaryFile("photo.jpg", new Uint8Array([1, 2, 3]));
    await link.createDir("Journal");
    expect(await inner.readTextFile("Note.md")).toBe("# Note\n\nedited\n");
    expect(await link.readTextFile("New folder/New.md")).toBe("# New\n");
    expect(await inner.exists("Journal")).toBe(true);
  });

  it("lets device-local paths through, which the queue never carries either", async () => {
    const { inner, link } = await vault();
    await inner.writeTextFile(".plainva/bookmarks.json", "[]");
    await inner.writeTextFile("Note.CONFLICT-2026.md", "# copy\n");
    await link.deleteItem(".plainva/bookmarks.json");
    await link.renameItem("Note.CONFLICT-2026.md", ".plainva/kept.md");
    expect(await inner.exists(".plainva/bookmarks.json")).toBe(false);
    expect(await inner.exists(".plainva/kept.md")).toBe(true);
  });

  it("names its error for every surface, also across a structured clone that drops the prototype", () => {
    const error = new StructureNeedsIndexError("delete", "Note.md");
    expect(isStructureNeedsIndexError(error)).toBe(true);
    expect(isStructureNeedsIndexError(Object.assign(new Error("x"), { name: "StructureNeedsIndexError" }))).toBe(true);
    expect(isStructureNeedsIndexError(new Error("x"))).toBe(false);
    expect(error.code).toBe("STRUCTURE_NEEDS_INDEX");
  });
});
