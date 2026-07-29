import { describe, it, expect } from "vitest";
import { interpolateScaffoldDates, scaffoldVaultTemplate } from "@plainva/ui";
import type { VaultTemplateDefinition } from "@plainva/ui";

/**
 * Scaffolder additions for the showcase template (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour", step P1.3): verbatim attachment
 * files and the scaffold-time `{{today±N}}` token.
 *
 * The token exists because the views that make a showcase worth looking at are
 * time-windowed: the timeline shows 21 days around today, the calendar is a
 * month, due dates age. Hard-coded sample dates would be invisible or stale
 * weeks after a release. It must NOT touch the note-template engine's tokens —
 * those belong to a later moment (creating a note) and have to survive
 * scaffolding verbatim.
 */

class FakeAdapter {
  files = new Map<string, string>();
  dirs = new Set<string>();
  async exists(path: string) { return this.files.has(path) || this.dirs.has(path); }
  async createDir(path: string) { this.dirs.add(path); }
  async writeTextFile(path: string, content: string) { this.files.set(path, content); }
}

const NOW = new Date(2026, 6, 29); // 2026-07-29, local time

const run = async (template: VaultTemplateDefinition, adapter = new FakeAdapter()) => {
  await scaffoldVaultTemplate({
    adapter,
    template,
    vaultName: "Vault",
    subfoldersHeading: "Unterordner",
    now: NOW,
  });
  return adapter;
};

describe("interpolateScaffoldDates", () => {
  it("resolves the token with and without an offset", () => {
    expect(interpolateScaffoldDates("{{today}}", NOW)).toBe("2026-07-29");
    expect(interpolateScaffoldDates("{{today-1}}", NOW)).toBe("2026-07-28");
    expect(interpolateScaffoldDates("{{today+3}}", NOW)).toBe("2026-08-01"); // crosses the month
  });

  it("leaves every note-template token untouched", () => {
    const src = "{{title}} {{date}} {{time}} {{cursor}} {{prompt:Was?}} {{daily+1}} {{weekday:next friday}}";
    expect(interpolateScaffoldDates(src, NOW)).toBe(src);
  });

  it("resolves several tokens in one string", () => {
    expect(interpolateScaffoldDates("von {{today}} bis {{today+2}}", NOW)).toBe("von 2026-07-29 bis 2026-07-31");
  });
});

describe("scaffolding with dates and attachments", () => {
  const template: VaultTemplateDefinition = {
    id: "plainva",
    name: "Tour",
    description: "d",
    folders: ["Journal", "Anhänge"],
    notes: [
      {
        path: "Journal/{{today}}.md",
        description: "Heute",
        body: "# {{today}}\n\nFällig: {{today+2}}\n",
        properties: { datum: "{{today}}", plainva: { header_color: "#378add" }, tags: ["{{today-1}}"] },
      },
      { path: "Vorlage.md", body: "# {{title}}\n\n{{date}}\n" },
    ],
    rawFiles: [{ path: "Anhänge/skizze.svg", content: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }],
  };

  it("resolves the token in the path, the body and nested properties", async () => {
    const a = await run(template);
    const note = a.files.get("Journal/2026-07-29.md");
    expect(note).toBeDefined();
    expect(note).toContain("# 2026-07-29");
    expect(note).toContain("Fällig: 2026-07-31");
    expect(note).toContain("datum: 2026-07-29");
    // Nested maps and arrays are walked, not just top-level strings.
    expect(note).toContain("header_color: \"#378add\"");
    expect(note).toContain("2026-07-28");
    expect(a.files.has("Journal/{{today}}.md")).toBe(false);
  });

  it("keeps note-template tokens verbatim in the shipped templates", async () => {
    const a = await run(template);
    const tpl = a.files.get("Vorlage.md")!;
    expect(tpl).toContain("{{title}}");
    expect(tpl).toContain("{{date}}");
  });

  it("lists the resolved path in the folder's index.md", async () => {
    const a = await run(template);
    const index = a.files.get("Journal/index.md")!;
    expect(index).toContain("2026-07-29.md");
    expect(index).not.toContain("{{today}}");
  });

  it("writes attachments verbatim and keeps them out of the listing", async () => {
    const a = await run(template);
    expect(a.files.get("Anhänge/skizze.svg")).toBe("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    // No frontmatter was added to a non-note file.
    expect(a.files.get("Anhänge/skizze.svg")).not.toContain("---");
    // The app's own index generator lists Markdown only — listing the SVG here
    // would be rewritten away by the first auto-update.
    expect(a.files.get("Anhänge/index.md")).not.toContain("skizze.svg");
  });

  it("never overwrites an existing attachment", async () => {
    const a = new FakeAdapter();
    await a.writeTextFile("Anhänge/skizze.svg", "MINE");
    await run(template, a);
    expect(a.files.get("Anhänge/skizze.svg")).toBe("MINE");
  });
});
