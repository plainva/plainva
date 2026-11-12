import { describe, expect, it } from "vitest";
import type { VaultFileInfo } from "@plainva/core";
import { treeDiskEntries } from "./treeDiskEntries";

/**
 * While the first index is built, the tree draws the files of the folder
 * listing (performance plan L3). It takes the files the index takes and the
 * tree shows — nothing the app keeps for itself, nothing hidden, no sidecar.
 */
const file = (path: string, isDirectory = false): VaultFileInfo => ({ path, name: path.split("/").pop()!, isDirectory, size: 1, mtime: 1 });

describe("what the tree takes from a walk of the vault folder", () => {
  it("folders and files, a note by its file name", () => {
    const { folders, files } = treeDiskEntries([file("Projects", true), file("Projects/Plan.md"), file("Projects/photo.png"), file("Start.md")]);
    expect(folders).toEqual([{ path: "Projects", title: "Projects", isDir: true }]);
    expect(files).toEqual([
      { path: "Projects/Plan.md", title: "Plan" },
      { path: "Projects/photo.png", title: "photo.png" },
      { path: "Start.md", title: "Start" },
    ]);
  });

  it("never an internal path in any spelling, a dot file or folder, or an AppleDouble sidecar", () => {
    const { folders, files } = treeDiskEntries([
      file(".plainva", true),
      file(".plainva/index.db"),
      file(".Plainva/sync/keyfile.json"),
      file(".obsidian/app.json"),
      file("node_modules/pkg/README.md"),
      file(".attachments", true),
      file("Notes/.hidden.md"),
      file("Notes/._Plan.md"),
      file("Notes/Plan.md"),
    ]);
    expect(folders).toEqual([]);
    expect(files).toEqual([{ path: "Notes/Plan.md", title: "Plan" }]);
  });
});
