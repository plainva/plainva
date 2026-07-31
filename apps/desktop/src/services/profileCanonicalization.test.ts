import { describe, expect, it } from "vitest";
import {
  PROFILE_DEFAULTS,
  canonicalizeProfileValues,
  profileDefault,
} from "@plainva/ui";

describe("shared profile canonicalization (S2)", () => {
  it("elides known defaults and keeps non-default and future values", () => {
    expect(canonicalizeProfileValues({
      dailyNotesFolder: PROFILE_DEFAULTS.dailyNotesFolder,
      syncIntervalSeconds: PROFILE_DEFAULTS.syncIntervalSeconds,
      mailRemoteImages: false,
      taskDatabase: "Tasks.base",
      somethingFromTheFuture: { z: 2, a: 1 },
    })).toEqual({
      somethingFromTheFuture: { a: 1, z: 2 },
      taskDatabase: "Tasks.base",
    });
  });

  it("sorts object keys recursively but preserves semantic array order", () => {
    const canonical = canonicalizeProfileValues({
      folderTemplates: [
        { template: "Second.md", folder: "B" },
        { template: "First.md", folder: "A" },
      ],
    });
    expect(canonical).toEqual({
      folderTemplates: [
        { folder: "B", template: "Second.md" },
        { folder: "A", template: "First.md" },
      ],
    });
  });

  it("sorts account sets and PIM selections by logical identity", () => {
    expect(canonicalizeProfileValues({
      bookmarks: ["Z.md", "A.md"],
      cloudAccounts: [
        { id: "logical-z", services: {}, label: "Z", family: "webdav" },
        { id: "logical-a", services: {}, label: "A", family: "google" },
      ],
      pimSelections: {
        taskLists: [
          { selected: true, id: "z", accountId: "logical-a" },
          { selected: false, id: "a", accountId: "logical-a" },
        ],
        calendars: [],
      },
    })).toEqual({
      bookmarks: ["Z.md", "A.md"],
      cloudAccounts: [
        { family: "google", id: "logical-a", label: "A", services: {} },
        { family: "webdav", id: "logical-z", label: "Z", services: {} },
      ],
      pimSelections: {
        calendars: [],
        taskLists: [
          { accountId: "logical-a", id: "a", selected: false },
          { accountId: "logical-a", id: "z", selected: true },
        ],
      },
    });
  });

  it("returns detached defaults rather than mutable shared arrays", () => {
    const first = profileDefault<Array<{ folder: string; template: string }>>("folderTemplates")!;
    const second = profileDefault<Array<{ folder: string; template: string }>>("folderTemplates")!;
    first.push({ folder: "A", template: "One.md" });
    expect(second).toEqual([]);
    expect(PROFILE_DEFAULTS.folderTemplates).toEqual([]);
  });
});
