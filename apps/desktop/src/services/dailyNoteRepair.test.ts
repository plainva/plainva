import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  inheritedMarkersOf,
  repairDailyNotes,
  scanInheritedTemplateMarkers,
  stripInheritedMarkers,
} from "./dailyNoteRepair";
import { dailyNotesFolderKey, dailyNotesFormatKey } from "../contexts/VaultContext";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

const FM = (body: string) => `---\ntype: Daily Note\nokf_version: "0.1"\n${body}---\n\n# Tag\n`;

describe("inheritedMarkersOf", () => {
  it("claims plainva.tasks only when it is false", () => {
    expect(inheritedMarkersOf(FM("plainva:\n  tasks: false\n"))).toEqual(["tasks"]);
    // `true` is nobody's template stamp — that is a deliberate choice.
    expect(inheritedMarkersOf(FM("plainva:\n  tasks: true\n"))).toEqual([]);
  });

  it("claims a non-empty templateFor", () => {
    expect(inheritedMarkersOf(FM('plainva:\n  templateFor:\n    - "[[Tasks.base]]"\n'))).toEqual(["templateFor"]);
    expect(inheritedMarkersOf(FM("plainva:\n  templateFor: []\n"))).toEqual([]);
    expect(inheritedMarkersOf(FM('plainva:\n  templateFor: ""\n'))).toEqual([]);
  });

  it("claims both when both are present", () => {
    expect(inheritedMarkersOf(FM('plainva:\n  tasks: false\n  templateFor:\n    - "[[A.base]]"\n'))).toEqual([
      "tasks",
      "templateFor",
    ]);
  });

  it("leaves untouched notes and unparseable frontmatter alone", () => {
    expect(inheritedMarkersOf(FM("plainva:\n  icon: 📓\n"))).toEqual([]);
    expect(inheritedMarkersOf("# no frontmatter at all\n")).toEqual([]);
    expect(inheritedMarkersOf("---\n: : broken\n---\n")).toEqual([]);
  });
});

describe("stripInheritedMarkers", () => {
  it("removes the claimed keys and keeps the rest of the note", () => {
    const before = FM("plainva:\n  tasks: false\n  icon: 📓\n");
    const after = stripInheritedMarkers(before, ["tasks"]);
    expect(after).not.toContain("tasks: false");
    expect(after).toContain("icon: 📓");
    expect(after).toContain("# Tag");
    expect(after).toContain("type: Daily Note");
  });

  it("returns the content untouched when the frontmatter cannot be parsed", () => {
    const broken = "---\n: : broken\n---\nbody\n";
    expect(stripInheritedMarkers(broken, ["tasks"])).toBe(broken);
  });
});

describe("scanInheritedTemplateMarkers", () => {
  const VAULT = "/vault";

  beforeEach(() => {
    for (const k of Object.keys(storeValues)) delete storeValues[k];
    storeValues[dailyNotesFolderKey(VAULT)] = "Journal";
    storeValues[dailyNotesFormatKey(VAULT)] = "YYYY-MM-DD";
  });

  function adapterOf(files: Record<string, string>) {
    const read: string[] = [];
    return {
      read,
      adapter: {
        listDir: async () => Object.keys(files).map((path) => ({ path, isDirectory: false })),
        readTextFile: async (p: string) => {
          read.push(p);
          return files[p];
        },
      },
    };
  }

  it("finds affected daily notes, newest first", async () => {
    const { adapter } = adapterOf({
      "Journal/2024-03-05.md": FM("plainva:\n  tasks: false\n"),
      "Journal/2024-03-07.md": FM('plainva:\n  templateFor:\n    - "[[A.base]]"\n'),
      "Journal/2024-03-06.md": FM("plainva:\n  icon: 📓\n"),
    });
    const found = await scanInheritedTemplateMarkers({ adapter, vaultPath: VAULT });
    expect(found.map((f) => f.path)).toEqual(["Journal/2024-03-07.md", "Journal/2024-03-05.md"]);
    expect(found[1].markers).toEqual(["tasks"]);
  });

  it("reads ONLY files the vault's format accepts as a daily note", async () => {
    const { adapter, read } = adapterOf({
      "Journal/2024-03-05.md": FM("plainva:\n  tasks: false\n"),
      // Same folder, but not this vault's daily-note format — never touched.
      "Journal/Notizen zum Tag.md": FM("plainva:\n  tasks: false\n"),
    });
    const found = await scanInheritedTemplateMarkers({ adapter, vaultPath: VAULT });
    expect(read).toEqual(["Journal/2024-03-05.md"]);
    expect(found).toHaveLength(1);
  });

  it("skips unreadable notes instead of failing the whole scan", async () => {
    const adapter = {
      listDir: async () => [
        { path: "Journal/2024-03-05.md", isDirectory: false },
        { path: "Journal/2024-03-06.md", isDirectory: false },
      ],
      readTextFile: async (p: string) => {
        if (p.endsWith("05.md")) throw new Error("locked");
        return FM("plainva:\n  tasks: false\n");
      },
    };
    const found = await scanInheritedTemplateMarkers({ adapter, vaultPath: VAULT });
    expect(found.map((f) => f.path)).toEqual(["Journal/2024-03-06.md"]);
  });

  it("returns nothing when the daily folder cannot be listed", async () => {
    const adapter = {
      listDir: async () => {
        throw new Error("gone");
      },
      readTextFile: async () => "",
    };
    expect(await scanInheritedTemplateMarkers({ adapter, vaultPath: VAULT })).toEqual([]);
  });
});

describe("repairDailyNotes", () => {
  it("writes the stripped note and reports what it repaired", async () => {
    const files: Record<string, string> = {
      "Journal/2024-03-05.md": FM("plainva:\n  tasks: false\n"),
    };
    const adapter = {
      listDir: async () => [],
      readTextFile: async (p: string) => files[p],
      writeTextFile: async (p: string, c: string) => {
        files[p] = c;
      },
    };
    const result = await repairDailyNotes({
      adapter,
      notes: [{ path: "Journal/2024-03-05.md", date: new Date(2024, 2, 5), markers: ["tasks"] }],
    });
    expect(result.repaired).toEqual(["Journal/2024-03-05.md"]);
    expect(result.failed).toEqual([]);
    expect(files["Journal/2024-03-05.md"]).not.toContain("tasks: false");
  });

  it("does not write when the marker vanished between scan and repair", async () => {
    const writes: string[] = [];
    const adapter = {
      listDir: async () => [],
      readTextFile: async () => FM("plainva:\n  icon: 📓\n"),
      writeTextFile: async (p: string) => {
        writes.push(p);
      },
    };
    const result = await repairDailyNotes({
      adapter,
      notes: [{ path: "Journal/2024-03-05.md", date: new Date(2024, 2, 5), markers: ["tasks"] }],
    });
    expect(writes).toEqual([]);
    expect(result.repaired).toEqual(["Journal/2024-03-05.md"]);
  });

  it("keeps going when one note fails and reports it", async () => {
    const adapter = {
      listDir: async () => [],
      readTextFile: async (p: string) => {
        if (p.endsWith("06.md")) throw new Error("locked");
        return FM("plainva:\n  tasks: false\n");
      },
      writeTextFile: async () => {},
    };
    const result = await repairDailyNotes({
      adapter,
      notes: [
        { path: "Journal/2024-03-05.md", date: new Date(2024, 2, 5), markers: ["tasks"] },
        { path: "Journal/2024-03-06.md", date: new Date(2024, 2, 6), markers: ["tasks"] },
        { path: "Journal/2024-03-07.md", date: new Date(2024, 2, 7), markers: ["tasks"] },
      ],
    });
    expect(result.repaired).toEqual(["Journal/2024-03-05.md", "Journal/2024-03-07.md"]);
    expect(result.failed).toEqual([{ path: "Journal/2024-03-06.md", error: "locked" }]);
  });
});
