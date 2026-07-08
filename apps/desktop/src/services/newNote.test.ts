import { describe, it, expect, beforeEach, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import {
  buildNewNoteContent,
  withOkfDefaults,
  getConfiguredNoteType,
  getConfiguredDailyNoteType,
} from "./newNote";
import { defaultNoteTypeKey, dailyNoteTypeKey } from "../contexts/VaultContext";

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
});

describe("buildNewNoteContent", () => {
  it("produces OKF minimum frontmatter (type + okf_version)", () => {
    const content = buildNewNoteContent("Note");
    const fm = frontmatterOf(content);
    expect(fm.type).toBe("Note");
    expect(fm.okf_version).toBe("0.1");
  });

  it("adds an H1 with the note title after the frontmatter", () => {
    const content = buildNewNoteContent("Note", "Projekt Alpha");
    expect(frontmatterOf(content).type).toBe("Note");
    expect(content).toContain("# Projekt Alpha");
    expect(content.indexOf("# Projekt Alpha")).toBeGreaterThan(content.indexOf("---"));
  });

  it("trims the title and stays blank without one (template scaffolds)", () => {
    expect(buildNewNoteContent("Note", "  X  ")).toContain("# X");
    expect(buildNewNoteContent("Note")).not.toContain("# ");
    expect(buildNewNoteContent("Note", "   ")).not.toContain("# ");
  });
});

describe("withOkfDefaults", () => {
  it("keeps a template's own type and adds okf_version", () => {
    const template = "---\ntype: Meeting Note\ntitle: X\n---\n\n## Agenda\n";
    const result = withOkfDefaults(template, "Note");
    const fm = frontmatterOf(result);
    expect(fm.type).toBe("Meeting Note");
    expect(fm.okf_version).toBe("0.1");
    expect(result).toContain("## Agenda");
  });

  it("prepends frontmatter to a template without one", () => {
    const result = withOkfDefaults("## Tagesplan\n", "Daily Note");
    expect(frontmatterOf(result).type).toBe("Daily Note");
    expect(result.endsWith("## Tagesplan\n")).toBe(true);
  });

  it("returns content unchanged when the template frontmatter is broken", () => {
    const broken = "---\ntitle: [unclosed\n---\nBody\n";
    expect(withOkfDefaults(broken, "Note")).toBe(broken);
  });
});

describe("configured types", () => {
  it("falls back to defaults when nothing is configured", async () => {
    expect(await getConfiguredNoteType("/vault")).toBe("Note");
    expect(await getConfiguredDailyNoteType("/vault")).toBe("Daily Note");
  });

  it("uses the per-vault configured values, trimmed", async () => {
    storeValues[defaultNoteTypeKey("/vault")] = "  Zettel  ";
    storeValues[dailyNoteTypeKey("/vault")] = "Journal";
    expect(await getConfiguredNoteType("/vault")).toBe("Zettel");
    expect(await getConfiguredDailyNoteType("/vault")).toBe("Journal");
  });

  it("treats a blank configured value as unset", async () => {
    storeValues[defaultNoteTypeKey("/vault")] = "   ";
    expect(await getConfiguredNoteType("/vault")).toBe("Note");
  });
});
