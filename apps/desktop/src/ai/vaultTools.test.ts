import { describe, expect, it } from "vitest";
import { effectivePolicy, notePolicyFrom, parsePolicyFile, toolByName, type EgressRecipient } from "@plainva/core";
import { createVaultToolExecutor, outlineOf, safeRelPath, sectionOf, type PlannerRow, type VaultToolDeps } from "@plainva/ui";

const files: Record<string, string> = {
  "Projects/Offer.md": "---\nstatus: draft\nclient: \"[[Private/Client]]\"\n---\n# Offer\n\nIntro\n\n## Costs\n\n### 2026\n\nRates as in [[Private/Client]].\n\n## Notes\n\nlater",
  "Private/Client.md": "# Client\n\nsecret",
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;

function deps(overrides: Partial<VaultToolDeps> = {}): VaultToolDeps {
  return {
    async search() {
      return [
        { path: "Private/Client.md", title: "Client", snippet: "\u0001secret\u0002" },
        { path: "Projects/Offer.md", title: "Offer", snippet: "Rates as in \u0001[[Private/Client]]\u0002" },
      ];
    },
    async readNote(path) {
      return files[path] ?? null;
    },
    async resolveLink(target) {
      return files[`${target}.md`] !== undefined ? `${target}.md` : null;
    },
    async policyOf(path, text) {
      return effectivePolicy(path, notePolicyFrom(text?.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), rules);
    },
    async taskRows(): Promise<PlannerRow[]> {
      return [
        { id: "1", source: "note", path: "Projects/Offer.md", noteTitle: "Offer", ordinal: 0, title: "Send offer", state: "open", due: "2026-09-20", dueMinutes: null, priority: 3, tags: [] },
        { id: "2", source: "note", path: "Private/Client.md", noteTitle: "Client", ordinal: 0, title: "Call the client", state: "open", due: "2026-09-24", dueMinutes: null, priority: 0, tags: [] },
        { id: "3", source: "database", path: "Tasks/Plan.md", title: "Plan week", state: "open", due: null, dueMinutes: null, priority: 0, tags: [] },
      ];
    },
    todayKey: () => "2026-09-24",
    commands: () => [{ id: "open-graph", label: "Open graph", run: () => true }],
    ...overrides,
  };
}

const cloud: EgressRecipient = { kind: "cloud", provider: "anthropic", model: "m" };
const run = (name: string, args: unknown, recipient: EgressRecipient = cloud, d = deps()) => createVaultToolExecutor(d, { recipient, webTools: false }).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });

describe("vault tools behind the hard gate", () => {
  it("search leaves denied notes out entirely and withholds links to them", async () => {
    const out = await run("search_vault", { query: "rates", limit: 10 });
    expect(out.content).toBe("- [[Offer]] (Projects/Offer.md) — Rates as in ⟦withheld note⟧");
    expect(out.origin).toEqual({ kind: "tool", tool: "search_vault" });
  });

  it("a denied note reads exactly like one that does not exist", async () => {
    const denied = await run("read_note", { path: "Private/Client.md", maxChars: 8000 });
    const missing = await run("read_note", { path: "Nowhere.md", maxChars: 8000 });
    expect(denied).toEqual(missing);
    expect(denied.isError).toBe(true);
    const local = await run("read_note", { path: "Private/Client.md", maxChars: 8000 }, { kind: "local", provider: "ollama", model: "m" });
    expect(local.content).toContain("secret");
  });

  it("reads sections by heading chain, pages long notes, strips the frontmatter", async () => {
    const section = await run("read_note", { path: "Projects/Offer.md", section: "Offer > Costs", maxChars: 8000 });
    expect(section.content).toBe("Projects/Offer.md\n\n## Costs\n\n### 2026\n\nRates as in ⟦withheld note⟧.\n");
    const paged = await run("read_note", { path: "Projects/Offer.md", maxChars: 200, cursor: "0" });
    expect(paged.content).not.toContain("status: draft");
    const outline = await run("get_outline", { path: "Projects/Offer.md" });
    expect(outline.content).toContain('- Costs  (section: "Offer > Costs")');
    expect(outline.content).toContain("status: draft");
    expect(outline.content).not.toContain("Private/Client");
  });

  it("withholds a denied link inside a heading of the outline", async () => {
    const d = deps({
      async readNote(path) {
        return path === "Notes/Links.md" ? "# See [[Private/Client]]\n\ntext" : (files[path] ?? null);
      },
    });
    const outline = await run("get_outline", { path: "Notes/Links.md" }, cloud, d);
    expect(outline.content).toContain("- See ⟦withheld note⟧");
    expect(outline.content).not.toContain("Client");
  });

  it("lists tasks without those of denied notes", async () => {
    const today = await run("get_tasks", { range: "today", limit: 25 });
    expect(today.content).toContain("- [ ] Send offer (due 2026-09-20, priority high) — in [[Offer]]");
    expect(today.content).not.toContain("Call the client");
    const overdue = await run("get_tasks", { range: "overdue", limit: 25 });
    expect(overdue.content).toContain("Send offer");
    const inbox = await run("get_tasks", { range: "inbox", limit: 25 });
    expect(inbox.content).toBe("- [ ] Plan week");
  });

  it("navigates only through the listed commands", async () => {
    expect(await run("run_command", { id: "open-graph" })).toEqual({ content: "Done: Open graph." });
    const unknown = await run("run_command", { id: "delete-everything" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain("- open-graph: Open graph");
  });

  it("opens a note only through the gate: a denied one fails like a missing one", async () => {
    const opened: string[] = [];
    const d = deps({
      commands: () => [
        {
          id: "open-note",
          label: "Open a note",
          run: (args) => {
            opened.push(String(args?.path));
            return true;
          },
        },
      ],
    });
    const denied = await run("run_command", { id: "open-note", args: { path: "Private/Client" } }, cloud, d);
    const missing = await run("run_command", { id: "open-note", args: { path: "Nowhere" } }, cloud, d);
    expect(denied).toEqual(missing);
    expect(denied.isError).toBe(true);
    const allowedNote = await run("run_command", { id: "open-note", args: { path: "Projects/Offer" } }, cloud, d);
    expect(allowedNote.content).toBe("Done: Open a note.");
    expect(opened).toEqual(["Projects/Offer.md"]);
  });

  it("refuses paths that leave the vault or reach Plainva's own folders", () => {
    for (const bad of ["../x.md", "/etc/passwd", "C:/Windows", "a\\b.md", "a//b.md", "./../x", ".plainva/state.db", ".agent/policy.yml", "x\0.md", ""]) expect(safeRelPath(bad)).toBeNull();
    expect(safeRelPath("./Projects/Offer.md")).toBe("Projects/Offer.md");
  });

  it("outlines ignore headings inside code fences", () => {
    expect(outlineOf("# A\n```\n# not\n```\n## B").map((h) => h.chain)).toEqual(["A", "A > B"]);
    expect(sectionOf("# A\n## B\nx\n## C", "b")).toBe("## B\nx");
    expect(sectionOf("# A\n## B\n# D\n## B", "B")).toBeNull();
  });
});
