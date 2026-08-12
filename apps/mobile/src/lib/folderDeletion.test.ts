import { describe, expect, it } from "vitest";
import { countFolderFiles, countVaultFiles } from "./folderDeletion";

const entry = (path: string, isDirectory = false) =>
  ({ path, name: path.split("/").pop()!, isDirectory }) as never;

describe("countFolderFiles (S4)", () => {
  it("counts files at any depth, never the folders themselves", () => {
    expect(
      countFolderFiles([
        entry("Projekte", true),
        entry("Projekte/a.md"),
        entry("Projekte/Sub", true),
        entry("Projekte/Sub/b.md"),
        entry("Projekte/Sub/bild.png"),
      ]),
    ).toBe(3);
  });

  it("ignores Plainva's own directory", () => {
    // Snapshots and bookmarks are not the user's files; counting them would
    // inflate the number the dialog puts in front of the tap.
    expect(
      countFolderFiles([entry("Projekte/a.md"), entry(".plainva/backups/a.md.bak"), entry(".plainva")]),
    ).toBe(1);
  });

  it("is zero for an empty folder", () => {
    expect(countFolderFiles([entry("Leer", true)])).toBe(0);
    expect(countFolderFiles([])).toBe(0);
  });
});

/** Minimal stand-in for the query service's db handle. */
const fakeDb = (query: () => Promise<unknown[]>) =>
  ({ db: { query: query as <T>(sql: string) => Promise<T[]> } });

describe("countVaultFiles (S4)", () => {
  it("reads the count from the index", async () => {
    expect(await countVaultFiles(fakeDb(async () => [{ n: 512 }]))).toBe(512);
  });

  it("answers 0 without an index rather than guessing", async () => {
    // The plain-web build has no SQLite store. A share of an unknown total is
    // not a number — isLargeDeletion then falls back to its ">10 files" half.
    expect(await countVaultFiles(null)).toBe(0);
    expect(await countVaultFiles(undefined)).toBe(0);
  });

  it("answers 0 when the query fails instead of blocking the deletion", async () => {
    expect(
      await countVaultFiles(
        fakeDb(async () => {
          throw new Error("db closed");
        }),
      ),
    ).toBe(0);
  });
});
