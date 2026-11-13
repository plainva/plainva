import { describe, expect, it } from "vitest";
import { buildLinkNameIndex, filesALinkCouldMean, mcpToolKind, toolByName, toolsFor, type EgressRecipient } from "@plainva/core";
import { CHAT_TOOL_NAMES, captureVocabularyOf, createVaultPolicy, createVaultToolExecutor, furtherToolNames, type ProposalRound, type ToolScope, type VaultToolDeps, type WriteRun } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { VaultIndexer } from "../../../../packages/core/src/vault/VaultIndexer";
import { VaultQueryService } from "../../../../packages/core/src/vault/VaultQueryService";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * The reader-view guard on the real search path (decision A of 2026-11-13, third review of R19, wave 2): a real
 * vault indexed for real, the query service the shells use, and the vault policy both shells build. A note
 * the reader may not see is linked from readable notes in every way a vault writes a link — in the text, in a
 * heading, in a property, in a table cell, as Markdown, as a reference, as an embed. Two vaults differ only in the
 * name of that note — one that sorts before every visible value, one after —; every read tool such a reader reaches
 * answers the same question in both alike, and no word of either name comes out. The tools that write answer a
 * change that names the hidden note alike too: whether the note holds such a link already, whether it exists, is
 * nothing the answer may tell.
 */
const readable = (name: string): Record<string, string> => ({
  "Projects/Pay.md": `---\nrelated: "[[Private/${name}]]"\nowner: "[[${name}|the owner]]"\n---\n# Pay\n\nThe rates of this year.\n\n## Talk with [[${name}]]\n\nSee [[Private/${name}|${name}]] for the numbers.\n\n| who | note |\n| --- | --- |\n| a | [[${name}\\|x]] |\n\nAlso [t](../Private/${encodeURIComponent(name)}.md), ![[${name}]] and [r][1].\n\n[1]: ../Private/${encodeURIComponent(name)}.md\n`,
  "Projects/Plan.md": "---\nowner: \"[[Projects/Mia]]\"\n---\n# Plan\n\nSee [[Projects/Pay]] for the rates.\n",
  "Projects/Mia.md": "# Mia\n",
  "Projects/Talk.md": `---\ntitle: "Talk with [[${name}]]"\n---\n# Talk\n\nSee [[Projects/Pay]] and [[Projects/Mia]].\n`,
  "Projects/Board.base": "filters:\n  and:\n    - file.folder == \"Projects\"\nviews:\n  - type: table\n    name: T\n    order: [owner, related]\n    sort:\n      - property: owner\n        direction: ASC\n",
  "Projects/Filtered.base": "filters:\n  and:\n    - 'contains(owner, \"Z\")'\nviews:\n  - type: table\n    name: T\n    order: [owner]\n",
  [`Private/${name}.md`]: `# ${name}\n\n${name} earns more.\n`,
});

async function vaultOf(name: string) {
  const vault = new MemoryVaultAdapter(1_000);
  await vault.writeTextFile(".agent/policy.yml", "folders:\n  Private/:\n    cloud: deny\n");
  for (const [path, text] of Object.entries(readable(name))) await vault.writeTextFile(path, text);
  const db = await realSqlite();
  await new VaultIndexer(vault, db).indexVaultFull();
  const query = new VaultQueryService(db as never);
  const read = (path: string) => vault.readTextFile(path).catch(() => null);
  const policy = createVaultPolicy({
    readFile: read,
    resolveLink: (target, from) => query.resolveNotePath(target, from),
    fileNames: () => query.linkTargets(),
    encrypted: () => false,
  });
  const proposed: ProposalRound[] = [];
  const deps: VaultToolDeps = {
    async search(q, limit, offset, within) {
      const hits = await query.searchFullText(q, limit, offset, true, null, within);
      return hits.map((hit) => ({ path: hit.path, title: hit.title || hit.path, snippet: hit.snippet ?? null, content: hit.sourceContent ?? null }));
    },
    readNote: read,
    resolveLink: (target, from) => query.resolveNotePath(target, from),
    linkCandidates: async (target, from) => filesALinkCouldMean(buildLinkNameIndex(await query.linkTargets()), target, from),
    policyOf: (path, text) => policy.policyOf(path, text),
    taskRows: async () => [],
    todayKey: () => "2026-11-13",
    commands: () => [],
    backlinks: (path, options) => query.getBacklinks(path, options),
    neighbors: (path, limit, options) => query.getLinkNeighbors(path, limit, options),
    recentlyOpened: async () => [{ path: "Projects/Pay.md", openedAt: 1 }],
    recentlyChanged: (limit, offset, within) => query.getRecentlyChangedNotes(limit, offset, within),
    queryDatabase: (config, options) => query.queryDatabaseFiles(config, options),
    events: async () => [],
    mail: { accounts: async () => [], folders: async () => [], newest: async () => ({ messages: [], offline: false }), search: async () => [], message: async () => null },
    writes: {
      sealed: () => false,
      current: read,
      propose: async (round: ProposalRound) => void proposed.push(round),
      folderExists: async () => true,
      taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
      draftPlace: async () => null,
      renamePlan: async () => ({ problem: "exists" }) as never,
      rename: async () => null,
      movePlan: async () => ({ problem: "exists" }) as never,
      move: async () => null,
      requestDelete: async () => false,
      setRule: async () => false,
      entryPlace: async () => null,
    },
    history: {
      changedIn: (folder, since, limit, offset, within) => query.getNotesChangedIn(folder, since, limit, offset, within),
      created: () => query.getNoteCreated("Projects/Pay.md"),
      versions: async () => [],
      readVersion: async () => null,
    },
  };
  return { deps, proposed, done: () => db.close() };
}

/** The two hidden names: one before every visible value of `owner`, one after it. */
const HIDDEN = ["Aaron Kowalski", "Zora Nowak"] as const;
const SECRETS = /Aaron|Kowalski|Zora|Nowak|Private\//;

function writer(): WriteRun {
  let drafts = 0;
  return {
    author: { id: "app", displayName: "App" },
    userTexts: () => [],
    inherited: async () => [],
    draft: async () => ({ ok: true, id: `d-${++drafts}` }),
    ask: async () => "nobody",
    writes: { rounds: [], drafts: [], plans: [] },
    today: () => "2026-11-13",
    clock: () => "10:30",
  };
}

const cloud: EgressRecipient = { kind: "cloud", provider: "mcp:app", model: "app" };
const app: ToolScope = { inside: (path) => path.startsWith("Projects/"), folders: ["Projects"], confirm: async () => true, linksInReach: true };
const readers: [string, boolean, ToolScope | undefined][] = [
  ["an app over MCP", true, app],
  ["a cloud model", false, undefined],
];

/** The questions a reader may ask, each with the hidden note's name as a guess. */
const QUESTIONS: [string, Record<string, unknown>][] = [
  ["search_vault", { query: "Kowalski", limit: 10 }],
  ["search_vault", { query: "Kowalskí", limit: 10 }],
  ["search_vault", { query: "Aaron", limit: 10 }],
  ["search_vault", { query: '"Aaron Kowalski"', limit: 10 }],
  ["search_vault", { query: "owner", limit: 10 }],
  ["search_vault", { query: "rates -Kowalski", limit: 10 }],
  ["search_vault", { query: "rates -Aaron", limit: 10 }],
  ["search_vault", { query: "rates", limit: 10 }],
  ["read_note", { path: "Projects/Pay.md", maxChars: 8000 }],
  ["read_note", { path: "Projects/Pay.md", section: "Talk with [[Aaron Kowalski]]" }],
  ["read_note", { path: "Projects/Plan.md", maxChars: 8000 }],
  ["get_outline", { path: "Projects/Pay.md" }],
  ["query_base", { base: "Projects/Board.base", limit: 20 }],
  ["query_base", { base: "Projects/Board.base", limit: 1 }],
  ["query_base", { base: "Projects/Filtered.base", limit: 20 }],
  ["get_tasks", { range: "all" }],
  ["get_backlinks", { path: "Projects/Pay.md", limit: 20 }],
  ["graph_neighborhood", { path: "Projects/Pay.md", limit: 20, depth: 2 }],
  ["get_recent", { kind: "edited", limit: 10 }],
  ["get_recent", { kind: "opened", limit: 10 }],
  ["get_changes", { since: "2000-01-01", limit: 10 }],
  ["get_note_history", { path: "Projects/Pay.md", since: "2026-11-01", until: "2026-11-13" }],
  ["get_calendar", { from: "2026-11-13", to: "2026-11-13" }],
  ["get_event", { id: "x" }],
  ["get_backlinks", { path: "Projects/Mia.md", limit: 20 }],
  ["graph_neighborhood", { path: "Projects/Mia.md", limit: 20, depth: 1 }],
  ["read_note", { path: "Projects/Talk.md" }],
  ["search_vault", { query: "talk", limit: 10 }],
  ["search_mail", { query: "Kowalski" }],
  ["read_mail", { id: "1" }],
  ["run_command", { id: "nothing" }],
  ["open_in_app", { path: "Projects/Pay.md" }],
  ["search_memory", { query: "Kowalski" }],
];

/** Changes that name the hidden note — by a guess the reader makes, so the same words in both vaults. */
const GUESS = HIDDEN[0];
const WRITES: [string, Record<string, unknown>][] = [
  ["propose_edit", { path: "Projects/Pay.md", append: `Ask [[Private/${GUESS}]].` }],
  ["propose_edit", { path: "Projects/Pay.md", append: `Ask [[${GUESS}]] and [[Projects/Mia]].` }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: GUESS, replace: "x" }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: `[[${GUESS}]]`, replace: "x" }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: "for the numbers.", replace: `for the numbers, see [[${GUESS}]].` }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: "The rates of this year.", replace: "The rates of 2026." }] }],
  ["set_property", { path: "Projects/Pay.md", key: "owner", value: "Mia" }],
  ["set_property", { path: "Projects/Plan.md", key: "owner", value: `[[${GUESS}]]` }],
  ["create_note", { title: "Talk", body: `With [[${GUESS}]] and [[Private/${GUESS}]].` }],
];

/** An answer without what the question itself said: a guess the reader made, said back to it, tells it nothing. */
function unasked(out: unknown, args: Record<string, unknown>): string {
  let text = JSON.stringify(out);
  for (const value of Object.values(args)) if (typeof value === "string" && value) text = text.split(JSON.stringify(value).slice(1, -1)).join("");
  return text;
}

describe("the reader-view guard on the real search path", () => {
  it("asks every read tool such a reader reaches: a new one needs its question here", async () => {
    const v = await vaultOf(HIDDEN[0]);
    const reached = new Set([...CHAT_TOOL_NAMES, ...toolsFor("mcp").filter((tool) => mcpToolKind(tool) === "read").map((tool) => tool.name), ...furtherToolNames(v.deps).filter((name) => toolByName(name)?.risk === "read")]);
    const asked = new Set(QUESTIONS.map(([name]) => name));
    expect([...reached].filter((name) => !asked.has(name))).toEqual([]);
    await v.done();
  });

  for (const [who, web, scope] of readers) {
    it(`${who}: two vaults that differ only in the hidden note's name answer every question alike, and name it nowhere`, async () => {
      const [a, z] = [await vaultOf(HIDDEN[0]), await vaultOf(HIDDEN[1])];
      for (const [name, args] of QUESTIONS) {
        const ask = (d: VaultToolDeps) => createVaultToolExecutor(d, { recipient: cloud, webTools: web }, scope).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        const [fromA, fromZ] = [await ask(a.deps), await ask(z.deps)];
        const label = `${name} ${JSON.stringify(args)}`;
        expect(unasked(fromA, args), label).not.toMatch(SECRETS);
        expect(unasked(fromZ, args), label).not.toMatch(SECRETS);
        expect(fromA, label).toEqual(fromZ);
      }
      await a.done();
      await z.done();
    });

    it(`${who}: a change that names the hidden note is answered alike in both vaults`, async () => {
      const [a, z] = [await vaultOf(HIDDEN[0]), await vaultOf(HIDDEN[1])];
      for (const [name, args] of WRITES) {
        const ask = (d: VaultToolDeps) => createVaultToolExecutor(d, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(d) }, writer()).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        const [fromA, fromZ] = [await ask(a.deps), await ask(z.deps)];
        expect(fromA, `${name} ${JSON.stringify(args)}`).toEqual(fromZ);
      }
      // What was laid down for the user is the user's to see, raw: the same changes in both.
      expect(a.proposed.length).toBe(z.proposed.length);
      await a.done();
      await z.done();
    });
  }
});
