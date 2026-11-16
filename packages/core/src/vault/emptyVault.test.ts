import { describe, expect, it } from "vitest";
import { isEmptyVaultListing } from "./emptyVault.js";

const file = (name: string) => ({ name, isDirectory: false });
const dir = (name: string) => ({ name, isDirectory: true });

describe("isEmptyVaultListing", () => {
  it("is empty for a vault with nothing in it", () => {
    expect(isEmptyVaultListing([])).toBe(true);
  });

  it("is empty for a new vault that holds only its managed overview", () => {
    expect(isEmptyVaultListing([file("index.md")])).toBe(true);
    expect(isEmptyVaultListing([file("Index.MD"), file("log.md")])).toBe(true);
  });

  it("ignores hidden folders and operating-system bookkeeping", () => {
    expect(isEmptyVaultListing([dir(".plainva"), dir(".obsidian"), file(".DS_Store"), file("Thumbs.db"), file("index.md")])).toBe(true);
  });

  it("is not empty as soon as there is a note, a database or an attachment", () => {
    expect(isEmptyVaultListing([file("index.md"), file("First.md")])).toBe(false);
    expect(isEmptyVaultListing([file("Tasks.base")])).toBe(false);
    expect(isEmptyVaultListing([file("photo.jpg")])).toBe(false);
  });

  it("counts a folder as content, even an empty one", () => {
    expect(isEmptyVaultListing([file("index.md"), dir("Projects")])).toBe(false);
  });

  it("counts a FOLDER named index.md as content", () => {
    expect(isEmptyVaultListing([dir("index.md")])).toBe(false);
  });

  it("never calls a listing that could not be read empty", () => {
    expect(isEmptyVaultListing(null)).toBe(false);
  });
});
