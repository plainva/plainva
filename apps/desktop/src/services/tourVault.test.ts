import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ documentDir: vi.fn(), homeDir: vi.fn(), join: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: vi.fn() }));
vi.mock("./vaultTemplates", () => ({ isVaultFolderEmpty: vi.fn() }));

import { findTourFolder, tourFolderName, type TourFolderProbe } from "./tourVault";

/** A file system of folders: path -> "empty" (unknown, nothing in it) or "full". */
function probe(fs: Record<string, "empty" | "full">): TourFolderProbe {
  return {
    parent: async () => "/home/u/Documents",
    join: async (parent, name) => `${parent}/${name}`,
    exists: async (path) => path in fs,
    isEmptyUnknownFolder: async (path) => fs[path] === "empty",
  };
}

describe("tourFolderName", () => {
  it("uses the tour's name, then numbers it", () => {
    expect(tourFolderName("Plainva Tour", 1)).toBe("Plainva Tour");
    expect(tourFolderName("Plainva Tour", 2)).toBe("Plainva Tour 2");
  });

  it("removes what no file system takes in a name", () => {
    expect(tourFolderName('Tour: a/b\\c*?"<>|', 1)).toBe("Tour a b c");
    expect(tourFolderName("Tour.", 1)).toBe("Tour");
  });

  it("falls back to a plain name when nothing usable is left", () => {
    expect(tourFolderName("///", 1)).toBe("Plainva Tour");
  });
});

describe("findTourFolder", () => {
  it("takes the name when nothing is there", async () => {
    await expect(findTourFolder("Plainva Tour", probe({}))).resolves.toBe("/home/u/Documents/Plainva Tour");
  });

  it("takes an existing empty folder that no vault uses", async () => {
    await expect(findTourFolder("Plainva Tour", probe({ "/home/u/Documents/Plainva Tour": "empty" }))).resolves.toBe(
      "/home/u/Documents/Plainva Tour",
    );
  });

  it("never writes into a folder with content — it numbers the next one", async () => {
    const fs = { "/home/u/Documents/Plainva Tour": "full", "/home/u/Documents/Plainva Tour 2": "full" } as const;
    await expect(findTourFolder("Plainva Tour", probe(fs))).resolves.toBe("/home/u/Documents/Plainva Tour 3");
  });

  it("gives up instead of searching forever", async () => {
    const full: Record<string, "full"> = {};
    for (let i = 1; i <= 50; i++) full[`/home/u/Documents/${tourFolderName("Plainva Tour", i)}`] = "full";
    await expect(findTourFolder("Plainva Tour", probe(full))).resolves.toBeNull();
  });
});
