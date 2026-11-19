import { describe, expect, it } from "vitest";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { holdsTemplateToken } from "../src/templateTokens.js";
import { GraphService } from "../src/vault/GraphService.js";
import { resolveLinkTarget } from "../src/vault/LinkResolver.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * A template's title is the title of the notes made from it (Fehlerliste
 * 0.9.0, B26): `title: {{title}}` stood in the index as the template's title,
 * every list and the graph showed "{{title}}", and `[[{{title}}]]` led to the
 * template. The index takes the file's name for such a title — only for a
 * template, only where the title holds a placeholder the engine fills in.
 */
const FILES: Record<string, string> = {
  "Templates/Meeting.md": "---\ntitle: \"{{title}}\"\ntype: Meeting\n---\n# {{title}}\n",
  "Templates/Daily.md": "---\ntitle: Daily {{date:YYYY-MM-DD}}\n---\n",
  // A template with a title of its own keeps it.
  "Templates/Fixed.md": "---\ntitle: Weekly review\n---\n",
  // A template a setting names outside the templates folder.
  "Setup/Standup.md": "---\ntitle: \"{{title}}\"\n---\n",
  // Made from the meeting template: its title is a real one.
  "Notes/Plan.md": "---\ntitle: Project plan\ntype: Meeting\n---\n# Project plan\n",
  // Outside the templates, a placeholder in a title is the note's title, as at main.
  "Notes/Agenda.md": "---\ntitle: \"{{date}} Besprechung\"\n---\n",
  "Notes/Links.md": "[[{{title}}]] [[Project plan]] [[{{date}} Besprechung]] [[Weekly review]]\n",
};

const templateNotes = (path: string) => path.startsWith("Templates/") || path === "Setup/Standup.md";

/** `db`, counting what is written through it. */
function counting(db: IDatabaseAdapter): { db: IDatabaseAdapter; writes: () => number } {
  let writes = 0;
  const wrapped = new Proxy(db, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key === "execute" || key === "transaction" || key === "executeBatch") return (...args: unknown[]) => { writes++; return value.apply(target, args); };
      return value.bind(target);
    },
  });
  return { db: wrapped, writes: () => writes };
}

async function indexed(options: { templateNotes?: (path: string) => boolean } = { templateNotes }) {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(FILES)) await vault.writeTextFile(path, text);
  const indexer = new VaultIndexer(vault, db, options);
  await indexer.indexVaultFull();
  return { db, vault, indexer, query: new VaultQueryService(db) };
}

const titleOf = async (query: VaultQueryService, path: string) => (await query.linkTargets()).find((file) => file.path === path)?.title;

describe("a template's title in the index", () => {
  it("is its file's name where it holds a placeholder the engine fills in", async () => {
    const { query } = await indexed();
    expect(await titleOf(query, "Templates/Meeting.md")).toBe("Meeting");
    expect(await titleOf(query, "Templates/Daily.md")).toBe("Daily");
    expect(await titleOf(query, "Setup/Standup.md")).toBe("Standup");
    expect(await titleOf(query, "Templates/Fixed.md")).toBe("Weekly review");
  });

  it("no longer leads `[[{{title}}]]` to the template; a note made from it is found by its title", async () => {
    const { query } = await indexed();
    const files = await query.linkTargets();
    expect(resolveLinkTarget("Notes/Links.md", "{{title}}", files)).toBeNull();
    expect(resolveLinkTarget("Notes/Links.md", "Project plan", files)).toBe("Notes/Plan.md");
    expect(resolveLinkTarget("Notes/Links.md", "Weekly review", files)).toBe("Templates/Fixed.md");
    expect(await query.resolveNotePath("{{title}}", "Notes/Links.md")).toBeNull();
  });

  it("stands under its file's name in lists and in the graph", async () => {
    const { db, query } = await indexed();
    const listed = await query.listNotes();
    expect(listed.find((note) => note.path === "Templates/Meeting.md")?.title).toBe("Meeting");
    expect(listed.filter((note) => note.title === "{{title}}")).toEqual([]);
    const graph = await new GraphService(db).loadGraph();
    expect(graph.nodes.get("Templates/Meeting.md")?.title).toBe("Meeting");
  });

  it("leaves a note outside the templates as it was, placeholder and all", async () => {
    const { query } = await indexed();
    expect(await titleOf(query, "Notes/Agenda.md")).toBe("{{date}} Besprechung");
    expect(resolveLinkTarget("Notes/Links.md", "{{date}} Besprechung", await query.linkTargets())).toBe("Notes/Agenda.md");
  });

  it("heals an index built before: a full scan reads the stale templates again, and the next writes nothing", async () => {
    const { db, vault } = await indexed({});
    const query = new VaultQueryService(db);
    expect(await titleOf(query, "Templates/Meeting.md")).toBe("{{title}}");
    const count = counting(db);
    const indexer = new VaultIndexer(vault, count.db, { templateNotes });
    await indexer.indexVaultFull();
    expect(await titleOf(query, "Templates/Meeting.md")).toBe("Meeting");
    expect(await titleOf(query, "Setup/Standup.md")).toBe("Standup");
    // Nothing left to do: one query, no write.
    const before = count.writes();
    expect(await indexer.retitleTemplateNotes()).toBe(0);
    expect(count.writes()).toBe(before);
  });

  it("follows a change of the settings, at the old place and the new", async () => {
    const { indexer, query } = await indexed();
    // The templates folder is `Setup` from now on.
    expect(await indexer.setTemplateNotes((path) => path.startsWith("Setup/"))).toBe(2);
    expect(await titleOf(query, "Templates/Meeting.md")).toBe("{{title}}");
    expect(await titleOf(query, "Templates/Daily.md")).toBe("Daily {{date:YYYY-MM-DD}}");
    expect(await titleOf(query, "Setup/Standup.md")).toBe("Standup");
    expect(await indexer.setTemplateNotes(templateNotes)).toBe(2);
    expect(await titleOf(query, "Templates/Meeting.md")).toBe("Meeting");
  });
});

describe("a placeholder the engine fills in", () => {
  it("is one of its names, not an escaped one, nor one it leaves as it is", () => {
    for (const title of ["{{title}}", "Daily {{date:YYYY-MM-DD}}", "{{date+1}}", "{{prompt:Topic}}", "{{start:HH:mm}} {{organizer}}", "x {{cursor}}"]) expect(holdsTemplateToken(title), title).toBe(true);
    for (const title of ["The {{each}} helper", "Jinja {{ variable }} syntax", "\\{{title}}", "{{title", "plain"]) expect(holdsTemplateToken(title), title).toBe(false);
  });
});

describe("a note over the note's budget in the index (L14)", () => {
  it("keeps its title, a template its file's name, and the links of its blocks read as text", async () => {
    // The properties are never read as text; the title comes from them, and a template's from its file's name, as
    // `retitleTemplateNotes` reads it again after a full scan. The list read as text gives its links to the index.
    const list = Array.from({ length: 20_000 }, (_, i) => `- item ${i} [[Target]]`).join("\n");
    const db = await realSqlite();
    const vault = new MemoryVaultAdapter(1_000);
    await vault.writeTextFile("Templates/Big.md", `---\ntitle: "{{title}}"\n---\n# {{title}}\n\n${list}\n`);
    await vault.writeTextFile("Notes/Big.md", `---\ntitle: Big list\n---\n# Big\n\n${list}\n`);
    await vault.writeTextFile("Notes/Target.md", "# Target\n");
    const indexer = new VaultIndexer(vault, db, { templateNotes });
    await indexer.indexVaultFull();
    const query = new VaultQueryService(db);
    expect(await titleOf(query, "Templates/Big.md")).toBe("Big");
    expect(await titleOf(query, "Notes/Big.md")).toBe("Big list");
    expect(await indexer.retitleTemplateNotes()).toBe(0);
    const from = new Set((await query.getBacklinks("Notes/Target.md")).map((link) => link.source_path));
    expect(from).toEqual(new Set(["Templates/Big.md", "Notes/Big.md"]));
  }, 120_000);
});

