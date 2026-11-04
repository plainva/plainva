// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BundleCommentStore,
  FileCommentOperationJournal,
  createCommentOperationService,
  createWorkspaceObjectId,
  planPropertyChange,
  readFrontmatterPath,
  type CommentOperationDeps,
  type CommentOperationFiles,
  type PropertyValue,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import {
  buildPropertyCommentCells,
  buildProposedCells,
  decideProposedCells,
  listProposedCells,
  proposalColumns,
  proposeSuggestionRound,
  proposedCellComments,
  withProposedValue,
  type ProposedCell,
  type RoundChunk,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../../packages/core/src/vault/LocalVaultAdapter";

/**
 * The values somebody proposes for the entries of a database (plan KI-Harness
 * P5-4), with the comment files a vault really has: proposed as the writing
 * tool proposes a property, read back as the store hands the suggestions to a
 * database, shown in the cell of the entry and the property — and decided from
 * there through the operation the note's own margin runs.
 */

const HAFEN = "---\ncity: Hamburg\n---\n# Studio Hafenkante\n\nFilms and videos.\n";
const VOGT = "---\ncity: Lübeck\nindustry: Health\nsince: 2019\n---\n# Praxis Vogt\n";
const WERFT = "# Werft 7\n\nBoats.\n";
const NOTES: Record<string, string> = { "Clients/Hafenkante.md": HAFEN, "Clients/Vogt.md": VOGT, "Clients/Werft.md": WERFT };
const COLUMNS = ["city", "industry", "since"];
const AUTHOR = { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" };

let roots: string[];
beforeEach(() => {
  roots = [];
});
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function vault() {
  const root = await mkdtemp(join(tmpdir(), "plainva-proposed-cells-"));
  roots.push(root);
  const adapter = new LocalVaultAdapter(root);
  await adapter.initialize();
  await adapter.createDir("Clients");
  for (const [path, text] of Object.entries(NOTES)) await adapter.writeTextFile(path, text);
  const dir = join(root, "local-journal");
  await mkdir(dir);
  const files: CommentOperationFiles = {
    read: async (file) => {
      try {
        return await readFile(join(dir, file), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    writeAtomic: async (file, content) => {
      const part = join(dir, `${file}.${createWorkspaceObjectId()}.part`);
      await writeFile(part, content);
      await rename(part, join(dir, file));
    },
    list: () => readdir(dir),
  };
  const store = () => new BundleCommentStore({ vault: adapter, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
  let tail = Promise.resolve();
  const deps: CommentOperationDeps = {
    contextKey: root,
    journal: new FileCommentOperationJournal(files),
    authorKey: async () => "bundle:desktop",
    withNoteLock: async (_path, work) => {
      const run = tail.catch(() => {}).then(work);
      tail = run;
      await run;
    },
    readText: (path) => adapter.readTextFile(path),
    writeText: (path, content) => adapter.writeTextFile(path, content),
    post: (marker) => store().post(marker),
  };
  const service = createCommentOperationService({ ...deps, resolvePath: async (operation) => operation.notePath });
  const text = (path: string) => adapter.readTextFile(path);
  /** A value as the writing tool proposes it on a note. */
  const propose = async (path: string, key: string, value: PropertyValue | null) => {
    const base = await text(path);
    const plan = planPropertyChange(base, key, value);
    if (!plan.ok || !plan.block) throw new Error("no block");
    const chunk: RoundChunk = { fromA: plan.block.from, toA: plan.block.to, replacement: plan.block.replacement, ...(plan.hinted ? { property: key } : {}) };
    await proposeSuggestionRound(service, { path, base, chunks: [chunk], note: "", author: AUTHOR });
  };
  /** The rows as a database has them: the notes' own properties, read from the files as they are now. */
  const rows = async () => {
    const out = new Map<string, Record<string, unknown>>();
    for (const path of Object.keys(NOTES)) {
      const now = await text(path).catch(() => null);
      if (now === null) continue;
      const row: Record<string, unknown> = { "file.path": path };
      for (const column of COLUMNS) {
        const value = readFrontmatterPath(now, [column]);
        if (value !== undefined) row[column] = value;
      }
      out.set(path, row);
    }
    return out;
  };
  const entries = async () => Promise.all(Object.keys(NOTES).map(async (path) => ({ path, comments: await store().list(path) })));
  const cells = async (columns: readonly string[] = COLUMNS) => {
    const byPath = await rows();
    return buildProposedCells(await entries(), (path) => byPath.get(path), columns);
  };
  /** What the cells say, as "path › column = value" — a removal as "= ∅". */
  const shown = async (columns: readonly string[] = COLUMNS) =>
    listProposedCells(await cells(columns), Object.keys(NOTES), columns).map((cell) => `${cell.path.slice(8, -3)} › ${cell.column} = ${cell.removed ? "∅" : JSON.stringify(cell.value)}`);
  const reads: string[] = [];
  const deciding = {
    service,
    current: async (path: string) => {
      reads.push(path);
      return text(path).catch(() => null);
    },
  };
  return { adapter, service, store, text, propose, rows, entries, cells, shown, deciding, reads };
}

describe("the values proposed for a database's entries", () => {
  it("stand in the cell of their entry and their property: a new value, a changed one, a removed one", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    await v.propose("Clients/Vogt.md", "since", null);
    // A note without any property yet: its first one is a whole block at the top.
    await v.propose("Clients/Werft.md", "city", "Kiel");
    expect(await v.shown()).toEqual(['Hafenkante › industry = "Film & Video"', 'Vogt › industry = "Medicine"', "Vogt › since = ∅", 'Werft › city = "Kiel"']);
    // Nothing was written: the notes are what they were.
    for (const [path, text] of Object.entries(NOTES)) expect(await v.text(path)).toBe(text);
    const cell = (await v.cells()).get("Clients/Hafenkante.md")!.get("industry")!;
    expect(cell).toMatchObject({ path: "Clients/Hafenkante.md", column: "industry", value: "Film & Video", removed: false });
    expect(cell.comment.authorMemberId).toBe(AUTHOR.id);
  });

  it("are not in a cell once they no longer fit what the row says — they stay at their note", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    await v.propose("Clients/Vogt.md", "since", null);
    // The user filled the empty cell, changed the value another proposal was made against, and cleared the third.
    await v.adapter.writeTextFile("Clients/Hafenkante.md", HAFEN.replace("city: Hamburg\n", "city: Hamburg\nindustry: Media\n"));
    await v.adapter.writeTextFile("Clients/Vogt.md", VOGT.replace("industry: Health\nsince: 2019\n", "industry: Care\n"));
    expect(await v.shown()).toEqual([]);
    // The suggestions are still there: the note's margin has them, and says that they no longer fit.
    expect((await v.entries()).flatMap((entry) => entry.comments).filter((comment) => comment.suggestion && !comment.resolvedAt)).toHaveLength(3);
  });

  it("show nothing the row says already, nothing decided and nothing that proposes a passage", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    const base = await v.text("Clients/Werft.md");
    const from = base.indexOf("Boats");
    await proposeSuggestionRound(v.service, { path: "Clients/Werft.md", base, chunks: [{ fromA: from, toA: from + 5, replacement: "Ships" }], note: "", author: AUTHOR });
    const all = (await v.cells()).get("Clients/Vogt.md")!.get("industry")!;
    await decideProposedCells(v.deciding, [all], "declined");
    // Somebody typed the proposed value in by hand: there is nothing left to decide in the cell.
    await v.adapter.writeTextFile("Clients/Hafenkante.md", HAFEN.replace("city: Hamburg\n", "city: Hamburg\nindustry: Film & Video\n"));
    expect(await v.shown()).toEqual([]);
  });

  it("go by the note's own key: the column of that name, or the one column that differs only in its letters' case", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    expect(await v.shown(["city", "Industry"])).toEqual(['Hafenkante › Industry = "Film & Video"']);
    // Two columns that fold to the same name: nobody can say which one is meant.
    expect(await v.shown(["Industry", "INDUSTRY"])).toEqual([]);
    // The exact name wins over a neighbour that differs in case.
    expect(await v.shown(["Industry", "industry"])).toEqual(['Hafenkante › industry = "Film & Video"']);
    // A view that does not show the property has no cell for it.
    expect(await v.shown(["city"])).toEqual([]);
    expect(await v.shown([])).toEqual([]);
  });

  it("put the newest of two proposals for one cell into it", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film");
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    const [entry] = (await v.entries()).filter((item) => item.path === "Clients/Hafenkante.md");
    const [first, second] = [...entry!.comments].sort((a, b) => a.suggestion!.replacement.length - b.suggestion!.replacement.length);
    const byPath = await v.rows();
    const at = (older: WorkspaceCommentRecord, newer: WorkspaceCommentRecord, olderFirst: boolean) => {
      const stamped = [{ ...older, createdAt: "2026-10-07T10:00:00.000Z" }, { ...newer, createdAt: "2026-10-07T10:05:00.000Z" }];
      return buildProposedCells([{ path: entry!.path, comments: olderFirst ? stamped : stamped.reverse() }], (path) => byPath.get(path), COLUMNS)
        .get(entry!.path)!
        .get("industry")!.value;
    };
    // Whichever order the files hand them back in.
    for (const olderFirst of [true, false]) {
      expect(at(first!, second!, olderFirst)).toBe("Film & Video");
      expect(at(second!, first!, olderFirst)).toBe("Film");
    }
  });

  it("stand only where a view shows a cell: what the line above the rows counts is what the reader sees", () => {
    const shown = ["file.name", "industry", "city", "cover", "formula.total", "okf_version", "sum", "back"];
    const schema = { sum: { rollup: { fn: "sum" } }, back: { reverseOf: { base: "Other.base", property: "client" } } };
    // Nothing of the file and nothing computed can be proposed: not a formula, a rollup or the other side of a relation.
    expect(proposalColumns("table", shown, schema)).toEqual(["industry", "city", "cover"]);
    expect(proposalColumns("list", shown, schema)).toEqual(["industry", "city", "cover"]);
    // A gallery does not draw the property its cover comes from.
    expect(proposalColumns("gallery", shown, schema, { cover: "cover" })).toEqual(["industry", "city"]);
    // A board also says what it groups its cards by, whether or not that is one of the view's columns — once.
    expect(proposalColumns("board", ["industry"], schema, { groupBy: "status", laneBy: "client" })).toEqual(["industry", "status", "client"]);
    expect(proposalColumns("board", ["status", "industry"], null, { groupBy: "status", laneBy: null })).toEqual(["status", "industry"]);
    expect(proposalColumns("board", ["industry"], schema, { groupBy: "back", laneBy: "file.folder" })).toEqual(["industry"]);
    // A calendar, a timeline, a pinboard and a graph show entries, not cells.
    for (const render of ["calendar", "timeline", "pinboard", "graph"]) expect(proposalColumns(render, shown, schema), render).toEqual([]);
  });

  it("are not counted among a cell's remarks as well: the cell shows the proposal, the pill counts what else is said", async () => {
    const v = await vault();
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    const entries = await v.entries();
    const cells = await v.cells();
    const inCells = proposedCellComments(cells);
    expect(inCells.size).toBe(1);
    const has = (key: string) => COLUMNS.includes(key);
    // A suggestion on a property's entry hangs on that property, so a database would count it as a remark too.
    expect(buildPropertyCommentCells(entries, has).get("Clients/Vogt.md")?.get("industry")).toBe(1);
    const without = entries.map((entry) => ({ path: entry.path, comments: entry.comments.filter((comment) => !inCells.has(comment.commentId)) }));
    expect(buildPropertyCommentCells(without, has).size).toBe(0);
  });
});

describe("deciding from the database", () => {
  const industryOf = (cells: Map<string, Map<string, ProposedCell>>, name: string) => cells.get(`Clients/${name}.md`)!.get("industry")!;

  it("accepts through the note's own operation: the value is in the note, and the suggestion is decided", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    const cell = industryOf(await v.cells(), "Hafenkante");
    const result = await decideProposedCells(v.deciding, [cell], "applied");
    expect(result).toEqual({ decided: [cell], failed: [], error: null });
    expect(await v.text("Clients/Hafenkante.md")).toBe(HAFEN.replace("city: Hamburg\n", "city: Hamburg\nindustry: Film & Video\n"));
    const [decided] = await v.store().list("Clients/Hafenkante.md");
    expect(decided!.suggestion!.appliedAt).not.toBeNull();
    expect(await v.shown()).toEqual([]);
    // What the cell shows until the index has caught up.
    expect(withProposedValue({ "file.path": cell.path, city: "Hamburg" }, cell)).toEqual({ "file.path": cell.path, city: "Hamburg", industry: "Film & Video" });
  });

  it("declines without reading the note, and without touching it", async () => {
    const v = await vault();
    await v.propose("Clients/Vogt.md", "since", null);
    const cell = (await v.cells()).get("Clients/Vogt.md")!.get("since")!;
    expect(withProposedValue({ since: 2019, city: "Lübeck" }, cell)).toEqual({ city: "Lübeck" });
    expect((await decideProposedCells(v.deciding, [cell], "declined")).decided).toEqual([cell]);
    expect(v.reads).toEqual([]);
    expect(await v.text("Clients/Vogt.md")).toBe(VOGT);
    expect((await v.store().list("Clients/Vogt.md"))[0]!.suggestion!.declinedAt).not.toBeNull();
  });

  it("decides a whole view note by note — several values of one note in one decision", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    await v.propose("Clients/Vogt.md", "since", 2020);
    await v.propose("Clients/Werft.md", "city", "Kiel");
    const all = listProposedCells(await v.cells(), Object.keys(NOTES), COLUMNS);
    expect(all).toHaveLength(4);
    const result = await decideProposedCells(v.deciding, all, "applied");
    expect([result.decided.length, result.failed.length]).toEqual([4, 0]);
    // Each note was read once: one decision per note.
    expect(v.reads).toEqual(["Clients/Hafenkante.md", "Clients/Vogt.md", "Clients/Werft.md"]);
    expect(await v.text("Clients/Hafenkante.md")).toBe(HAFEN.replace("city: Hamburg\n", "city: Hamburg\nindustry: Film & Video\n"));
    expect(await v.text("Clients/Vogt.md")).toBe(VOGT.replace("industry: Health\nsince: 2019", "industry: Medicine\nsince: 2020"));
    expect(await v.text("Clients/Werft.md")).toBe(`---\ncity: Kiel\n---\n${WERFT}`);
    expect(await v.shown()).toEqual([]);
  });

  it("does not hold back what fits: a proposal that no longer fits stays, the other one of its note is accepted", async () => {
    const v = await vault();
    await v.propose("Clients/Vogt.md", "industry", "Medicine");
    await v.propose("Clients/Vogt.md", "since", 2020);
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    const all = listProposedCells(await v.cells(), Object.keys(NOTES), COLUMNS);
    // Between the look at the cells and the click, the user changed the value one of them was proposed against.
    const changed = VOGT.replace("industry: Health", "industry: Care");
    await v.adapter.writeTextFile("Clients/Vogt.md", changed);
    const result = await decideProposedCells(v.deciding, all, "applied");
    expect(result.decided.map((cell) => `${cell.path} ${cell.column}`)).toEqual(["Clients/Hafenkante.md industry", "Clients/Vogt.md since"]);
    expect(result.failed.map((cell) => `${cell.path} ${cell.column}`)).toEqual(["Clients/Vogt.md industry"]);
    expect((result.error as Error).message).toBe("comment-suggestion-orphan");
    expect(await v.text("Clients/Vogt.md")).toBe(changed.replace("since: 2019", "since: 2020"));
    // The one that did not fit still waits at its note.
    expect((await v.store().list("Clients/Vogt.md")).filter((comment) => comment.suggestion && !comment.resolvedAt)).toHaveLength(1);
  });

  it("leaves a proposal where it is when its note is gone, and decides the others", async () => {
    const v = await vault();
    await v.propose("Clients/Hafenkante.md", "industry", "Film & Video");
    await v.propose("Clients/Werft.md", "city", "Kiel");
    const all = listProposedCells(await v.cells(), Object.keys(NOTES), COLUMNS);
    await v.adapter.deleteItem("Clients/Hafenkante.md");
    const result = await decideProposedCells(v.deciding, all, "applied");
    expect(result.decided.map((cell) => cell.path)).toEqual(["Clients/Werft.md"]);
    expect(result.failed.map((cell) => cell.path)).toEqual(["Clients/Hafenkante.md"]);
    expect(await v.text("Clients/Werft.md")).toBe(`---\ncity: Kiel\n---\n${WERFT}`);
    // Nothing to decide is nothing to do.
    expect(await decideProposedCells(v.deciding, [], "applied")).toEqual({ decided: [], failed: [], error: null });
  });
});
