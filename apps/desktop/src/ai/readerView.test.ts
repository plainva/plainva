import { describe, expect, it } from "vitest";
import { effectivePolicy, mcpToolKind, notePolicyFrom, parsePolicyFile, toolByName, toolsFor, type EgressRecipient } from "@plainva/core";
import { CHAT_TOOL_NAMES, createVaultToolExecutor, furtherToolNames, type ToolScope, type VaultToolDeps } from "@plainva/ui";

/**
 * One view per reader (decision A of 2026-11-13, review of R19, wave 2): every tool that shows a note's text to a
 * reader with a narrower view, searches it or changes it, works on what that reader may see. The note below holds a
 * link the reader may not see — in a heading and in a line, with an alias — and nothing of it may come out: not as
 * text, not by a search that finds it, not by a section it names, not by an answer that tells it apart.
 */
const SECRET = "Kowalski";
const PAY = `# Pay\n\nThe rates of this year.\n\n## Pay talk with [[Private/Salary 2026]]\n\nSee [[Private/Salary 2026|${SECRET}]] for the numbers.\n`;
const files: Record<string, string> = {
  "Projects/Pay.md": PAY,
  "Projects/Plan.md": "# Plan\n\nSee [[Projects/Pay]].\n",
  "Private/Salary 2026.md": `# Salary\n\n${SECRET} earns more.\n`,
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;

/** The index as it answers: over the raw text, every word of the query in a note's title, path or text. */
function rawSearch(query: string) {
  const words = query.split(/\s+/).filter((w) => w && !w.startsWith("-") && !w.includes(":")).map((w) => w.replace(/^"|"$/g, "").toLowerCase());
  const excluded = query.split(/\s+/).filter((w) => w.startsWith("-") && !w.includes(":")).map((w) => w.slice(1).toLowerCase());
  return Object.entries(files)
    .filter(([path, text]) => {
      const all = `${path}\n${text}`.toLowerCase();
      return words.every((w) => all.includes(w)) && !excluded.some((w) => all.includes(w));
    })
    .map(([path, text]) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), snippet: text.slice(0, 120) }));
}

function deps(over: Partial<VaultToolDeps> = {}): VaultToolDeps {
  return {
    search: async (query, limit, offset) => rawSearch(query).slice(offset, offset + limit),
    readNote: async (path) => files[path] ?? null,
    resolveLink: async (target) => (files[`${target}.md`] !== undefined ? `${target}.md` : null),
    policyOf: async (path, text) => effectivePolicy(path, notePolicyFrom(text?.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), rules),
    taskRows: async () => [{ id: "1", source: "note", path: "Projects/Pay.md", noteTitle: "Pay", ordinal: 0, title: `Ask [[Private/Salary 2026|${SECRET}]]`, state: "open", due: "2026-09-24", dueMinutes: null, priority: 0, tags: [] }],
    todayKey: () => "2026-09-24",
    commands: () => [],
    backlinks: async (path) => (path === "Projects/Pay.md" ? [{ source_path: "Projects/Plan.md", source_title: "Plan", line_number: 3 }] : []),
    neighbors: async () => [{ path: "Projects/Plan.md", title: "Plan", incoming: 1, outgoing: 0 }],
    recentlyOpened: async () => [{ path: "Projects/Pay.md", openedAt: 1 }],
    recentlyChanged: async (limit, offset = 0) => [{ path: "Projects/Pay.md", title: "Pay", mtime: 1 }].slice(offset, offset + limit),
    queryDatabase: async () => [{ "file.name": "Pay", "file.path": "Projects/Pay.md", lead: `[[Private/Salary 2026|${SECRET}]]` }],
    events: async () => [],
    history: {
      changedIn: async (_folder, _since, limit, offset = 0) => [{ path: "Projects/Pay.md", title: "Pay", mtime: new Date(2026, 8, 22, 12).getTime(), created: 0 }].slice(offset, offset + limit),
      created: async () => null,
      versions: async () => [{ id: "v1", at: new Date(2026, 8, 20).getTime() }],
      readVersion: async () => PAY.replace(SECRET, "Nowak"),
    },
    ...over,
  };
}

const cloud: EgressRecipient = { kind: "cloud", provider: "mcp:app", model: "app" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };
/** An app over MCP: the folder Projects, links only to notes it may reach. */
const app: ToolScope = { inside: (path) => path.startsWith("Projects/"), folders: ["Projects"], confirm: async () => true, linksInReach: true };

const readers: [string, EgressRecipient, boolean, ToolScope | undefined][] = [
  ["an app over MCP", cloud, true, app],
  ["a cloud model", cloud, false, undefined],
];
const run = (name: string, args: unknown, recipient: EgressRecipient, web: boolean, scope?: ToolScope, d = deps()) =>
  createVaultToolExecutor(d, { recipient, webTools: web }, scope).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });

/** Every read tool a reader with a narrower view can reach, with arguments that put the note above in its way. */
const CASES: Record<string, Record<string, unknown>> = {
  search_vault: { query: "numbers", limit: 10 },
  read_note: { path: "Projects/Pay.md", maxChars: 8000 },
  get_outline: { path: "Projects/Pay.md" },
  query_base: { base: "Projects/Board.base", limit: 20 },
  get_tasks: { range: "all" },
  get_backlinks: { path: "Projects/Pay.md", limit: 20 },
  graph_neighborhood: { path: "Projects/Pay.md", limit: 20 },
  get_recent: { kind: "edited", limit: 10 },
  get_calendar: { from: "2026-09-24", to: "2026-09-24" },
  get_event: { id: "x" },
  get_changes: { since: "2026-09-21", until: "2026-09-24", limit: 10 },
  get_note_history: { path: "Projects/Pay.md", since: "2026-09-19", until: "2026-09-24" },
  run_command: { id: "nothing" },
  open_in_app: { path: "Projects/Pay.md" },
  search_memory: { query: SECRET },
  find_tools: { query: "note" },
};

describe("the reader-view guard: no tool gives a reader with a narrower view what its view withholds", () => {
  const readTools = [...new Set([...CHAT_TOOL_NAMES, ...toolsFor("mcp").filter((tool) => mcpToolKind(tool) === "read").map((tool) => tool.name), ...furtherToolNames(deps()).filter((name) => toolByName(name)?.risk === "read")])];

  it("knows every read tool such a reader reaches: a new one needs its case here", () => {
    expect(readTools.filter((name) => !(name in CASES))).toEqual([]);
  });

  for (const [who, recipient, web, scope] of readers) {
    it(`${who}: not a word of the withheld link in any tool's text or values`, async () => {
      const withBase = deps({ readNote: async (path) => (path === "Projects/Board.base" ? "views:\n  - type: table\n    name: T\n" : (files[path] ?? null)) });
      for (const name of readTools) {
        const out = await run(name, CASES[name], recipient, web, scope, withBase);
        expect(JSON.stringify(out), name).not.toMatch(/Kowalski|Salary 2026|Private\//);
      }
    });

    it(`${who}: a search finds nothing by the withheld words, and says so as for words that are nowhere`, async () => {
      const hidden = await run("search_vault", { query: SECRET, limit: 10 }, recipient, web, scope);
      const nowhere = await run("search_vault", { query: "Nowak", limit: 10 }, recipient, web, scope);
      expect(hidden).toEqual(nowhere);
      // A term it excludes is tested on the view, not the raw text: excluding the hidden word leaves the note in.
      const excluded = await run("search_vault", { query: `numbers -${SECRET}`, limit: 10 }, recipient, web, scope);
      expect(excluded.content).toContain("Projects/Pay.md");
      expect((await run("search_vault", { query: "numbers", limit: 10 }, recipient, web, scope)).content).toContain("⟦withheld note⟧ for the numbers");
    });

    it(`${who}: a section is named and found as the view has it, and the withheld text names none`, async () => {
      const outline = await run("get_outline", { path: "Projects/Pay.md" }, recipient, web, scope);
      expect(outline.content).toContain('(section: "Pay > Pay talk with ⟦withheld note⟧")');
      const named = await run("read_note", { path: "Projects/Pay.md", section: "Pay > Pay talk with ⟦withheld note⟧" }, recipient, web, scope);
      expect(named.isError).toBeFalsy();
      expect(named.content).toContain("for the numbers");
      const hidden = await run("read_note", { path: "Projects/Pay.md", section: "Pay talk with [[Private/Salary 2026]]" }, recipient, web, scope);
      const nowhere = await run("read_note", { path: "Projects/Pay.md", section: "Pay talk with [[Private/Salary 2025]]" }, recipient, web, scope);
      expect(hidden.isError).toBe(true);
      expect(hidden.content.replace("2026", "2025")).toBe(nowhere.content);
    });
  }

  it("a search through a view costs the same whatever its hits hold back: no note read again, a link decided once per folder, a bound per call (review of R19, wave 2)", async () => {
    const many: Record<string, string> = { "Private/Salary 2026.md": "# Salary\n" };
    for (let i = 0; i < 2_000; i++) many[`Projects/n${i}.md`] = `# n${i}\n\nbudget line ${i} with [[Private/Salary 2026]] and words.\n`;
    const counted = { reads: 0, candidates: 0, scanned: 0 };
    const d = deps({
      search: async (query, limit, offset) => {
        const words = query.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
        const hits = Object.entries(many)
          .filter(([path, text]) => words.every((w) => `${path}\n${text}`.toLowerCase().includes(w)))
          .slice(offset, offset + limit)
          .map(([path, text]) => ({ path, title: path, snippet: null, content: text }));
        counted.scanned += hits.length;
        return hits;
      },
      readNote: async (path) => {
        counted.reads++;
        return many[path] ?? null;
      },
      linkCandidates: async (target) => {
        counted.candidates++;
        return many[`${target}.md`] !== undefined ? [`${target}.md`] : [];
      },
    });
    for (const [who, recipient, web, scope] of readers) {
      for (const query of ["Kowalski", "Salary", "budget"]) {
        Object.assign(counted, { reads: 0, candidates: 0, scanned: 0 });
        await run("search_vault", { query, limit: 10 }, recipient, web, scope, d);
        // The text comes with the hit; the link to the kept note is decided once for the whole folder.
        expect(counted.reads, `${who} ${query}`).toBe(0);
        expect(counted.candidates, `${who} ${query}`).toBeLessThanOrEqual(1);
        // Hits that the view does not answer are looked at up to a fixed number per call, not through the whole vault.
        expect(counted.scanned, `${who} ${query}`).toBeLessThanOrEqual(500 + 25);
      }
    }
  });

  it("a model on this device with nothing kept from it reads, finds and names as before", async () => {
    const note = await run("read_note", { path: "Projects/Pay.md", maxChars: 8000 }, local, false);
    expect(note.content).toContain(`[[Private/Salary 2026|${SECRET}]]`);
    expect((await run("search_vault", { query: SECRET, limit: 10 }, local, false)).content).toContain("Projects/Pay.md");
    const section = await run("read_note", { path: "Projects/Pay.md", section: "Pay talk with [[Private/Salary 2026]]" }, local, false);
    expect(section.isError).toBeFalsy();
    expect((await run("get_outline", { path: "Projects/Pay.md" }, local, false)).content).toContain("Pay talk with [[Private/Salary 2026]]");
  });
});
