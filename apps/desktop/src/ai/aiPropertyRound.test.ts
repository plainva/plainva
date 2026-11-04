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
  planCommentDecision,
  planPropertyChange,
  type CommentOperationDeps,
  type CommentOperationFiles,
  type PropertyValue,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import { buildCommentThreads, groupSuggestionRounds, proposeSuggestionRound, suggestedProperties, type RoundChunk } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";

/**
 * A proposed value of a property from the round to the accepted note (plan
 * KI-Harness P5-3), with the comment files a vault really has: the round is
 * written through the shell's comment service, read back as the store hands
 * it to the cards, shown as a property, and accepted as the suggestion it is.
 *
 * Nothing here knows about an assistant but the author of the round — which is
 * the point: a proposed property is stored, synced and decided as every
 * suggestion is.
 */

const NOTE = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nThe stage: open of this brief is also a sentence.\n";
const AUTHOR = { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" };

let roots: string[];
beforeEach(() => {
  roots = [];
});
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function vaultWith(note: string) {
  const root = await mkdtemp(join(tmpdir(), "plainva-property-round-"));
  roots.push(root);
  const vault = new LocalVaultAdapter(root);
  await vault.initialize();
  await vault.writeTextFile("Brief.md", note);
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
  const store = () => new BundleCommentStore({ vault, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
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
    readText: (path) => vault.readTextFile(path),
    writeText: (path, content) => vault.writeTextFile(path, content),
    post: (marker) => store().post(marker),
  };
  const service = createCommentOperationService({ ...deps, resolvePath: async () => "Brief.md" });
  const text = () => vault.readTextFile("Brief.md");
  /** A value as the writing tool proposes it: the property's entry as one block, with the hint where an anchor can quote it. */
  const propose = async (key: string, value: PropertyValue | null, note = "", batch?: { id: string; index: number }) => {
    const base = await text();
    const plan = planPropertyChange(base, key, value);
    if (!plan.ok || !plan.block) throw new Error("no block");
    const chunk: RoundChunk = { fromA: plan.block.from, toA: plan.block.to, replacement: plan.block.replacement, ...(plan.hinted ? { property: key } : {}) };
    await proposeSuggestionRound(service, { path: "Brief.md", base, chunks: [chunk], note, author: AUTHOR, ...(batch ? { batch } : {}) });
  };
  /** A passage, as the writing tool proposes one. */
  const proposePassage = async (find: string, replace: string, note: string, batch: { id: string; index: number }) => {
    const base = await text();
    const from = base.lastIndexOf(find);
    await proposeSuggestionRound(service, { path: "Brief.md", base, chunks: [{ fromA: from, toA: from + find.length, replacement: replace }], note, author: AUTHOR, batch });
  };
  const comments = () => store().list("Brief.md");
  const open = async () => (await comments()).filter((comment) => comment.suggestion && !comment.resolvedAt);
  const decide = async (records: WorkspaceCommentRecord[], outcome: "applied" | "declined") => {
    await service.run(await service.prepare(planCommentDecision("Brief.md", await text(), records, outcome)));
  };
  return { vault, propose, proposePassage, comments, open, decide, text };
}

describe("a proposed value of a property, from the round to the note", () => {
  it("waits as a suggestion that says which property — and the note is what it was", async () => {
    const v = await vaultWith(NOTE);
    await v.propose("stage", "sent", "Sent on Monday");
    expect(await v.text()).toBe(NOTE);
    const [stored] = await v.comments();
    // The property's entry as it stands, quoted in full; the hint is what makes a card and a property row read it as a property.
    expect(stored!.anchor).toMatchObject({ quote: "stage: open", display: { kind: "property", key: "stage" } });
    expect(stored!.suggestion).toMatchObject({ replacement: "stage: sent", appliedAt: null, declinedAt: null });
    expect(stored!.authorMemberId).toBe(AUTHOR.id);
    expect(stored!.batchNote).toBe("Sent on Monday");
    expect(suggestedProperties(NOTE, await v.comments())).toEqual(new Map([[stored!.commentId, { key: "stage", before: "open", after: "sent", removed: false, added: false, stale: false }]]));
  });

  it("is accepted as the suggestion it is: the value changes, and no other line of the note", async () => {
    const v = await vaultWith(NOTE);
    await v.propose("stage", "sent");
    await v.decide(await v.open(), "applied");
    expect(await v.text()).toBe(NOTE.replace("---\nstage: open", "---\nstage: sent"));
    const [decided] = await v.comments();
    expect(decided!.suggestion!.appliedAt).not.toBeNull();
    expect(await v.open()).toEqual([]);
    // Still a property on its card once it is decided, with what it said and what it says.
    expect(suggestedProperties(await v.text(), await v.comments()).get(decided!.commentId)).toMatchObject({ key: "stage", before: "open", after: "sent" });
  });

  it("changes nothing when it is declined", async () => {
    const v = await vaultWith(NOTE);
    await v.propose("owner", null);
    const [waiting] = await v.open();
    expect(suggestedProperties(NOTE, [waiting!]).get(waiting!.commentId)).toEqual({ key: "owner", before: "Anna", after: "", removed: true, added: false, stale: false });
    await v.decide([waiting!], "declined");
    expect(await v.text()).toBe(NOTE);
    expect((await v.comments())[0]!.suggestion!.declinedAt).not.toBeNull();
  });

  it("adds two new properties one after the other, whichever is accepted first", async () => {
    const v = await vaultWith(NOTE);
    await v.propose("effort", 3);
    await v.propose("tags", ["roof", "house"]);
    const waiting = await v.open();
    const views = suggestedProperties(NOTE, waiting);
    expect(waiting.map((comment) => views.get(comment.commentId))).toEqual([
      { key: "effort", before: "", after: "3", removed: false, added: true, stale: false },
      { key: "tags", before: "", after: "roof, house", removed: false, added: true, stale: false },
    ]);
    // The second one first: the place the first was proposed at has an entry in front of it by then.
    await v.decide([waiting[1]!], "applied");
    await v.decide([waiting[0]!], "applied");
    expect(await v.text()).toBe(NOTE.replace("owner: Anna\n---", "owner: Anna\ntags:\n  - roof\n  - house\neffort: 3\n---"));
  });

  it("is one round with what the same run proposed in other steps — and “accept all” writes the passage, the value and the new property at once", async () => {
    const v = await vaultWith(NOTE);
    const round = createWorkspaceObjectId();
    // Three steps of one run, as the writing tools lay them: each continues the round behind the blocks that are in it.
    await v.proposePassage("is also a sentence", "was a sentence once", "Tighter", { id: round, index: 0 });
    await v.propose("stage", "sent", "Sent on Monday", { id: round, index: 1 });
    await v.propose("effort", 3, "", { id: round, index: 2 });
    expect(await v.text()).toBe(NOTE);
    const { rounds } = groupSuggestionRounds(buildCommentThreads(await v.comments(), null, new Map()));
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ batchId: round, open: 3, note: "Tighter · Sent on Monday" });
    // In the order they were laid down, whatever order the files hand them back in.
    const blocks = rounds[0]!.blocks.map((block) => block.root);
    expect(blocks.map((block) => block.suggestion!.replacement)).toEqual(["was a sentence once", "stage: sent", "effort: 3\n"]);
    const views = suggestedProperties(NOTE, blocks);
    expect(blocks.map((block) => views.get(block.commentId)?.key ?? null)).toEqual([null, "stage", "effort"]);
    // One decision for the round, as “accept all” makes it.
    await v.decide(blocks, "applied");
    expect(await v.text()).toBe("---\nstage: sent\nowner: Anna\neffort: 3\n---\n# Brief\n\nThe stage: open of this brief was a sentence once.\n");
    expect(await v.open()).toEqual([]);
  });

  it("says that it no longer fits once the property says something else — and accepting writes nothing", async () => {
    const v = await vaultWith(NOTE);
    await v.propose("stage", "sent");
    const [waiting] = await v.open();
    // The user set the value in the meantime. The sentence in the text still reads "stage: open".
    const changed = NOTE.replace("---\nstage: open", "---\nstage: closed");
    await v.vault.writeTextFile("Brief.md", changed);
    expect(suggestedProperties(changed, [waiting!]).get(waiting!.commentId)).toMatchObject({ key: "stage", stale: true });
    await expect(v.decide([waiting!], "applied")).rejects.toThrow("comment-suggestion-orphan");
    expect(await v.text()).toBe(changed);
    // Declining it is still possible: that writes nothing.
    await v.decide([waiting!], "declined");
    expect(await v.text()).toBe(changed);
  });

  it("gives a note without properties its block once, however many first properties were proposed", async () => {
    const bare = "# Brief\n\nShort.\n";
    const v = await vaultWith(bare);
    await v.propose("stage", "open");
    await v.propose("owner", "Anna");
    const waiting = await v.open();
    expect([...suggestedProperties(bare, waiting).values()].map((view) => [view.key, view.added, view.stale])).toEqual([["stage", true, false], ["owner", true, false]]);
    await v.decide([waiting[0]!], "applied");
    // The second was proposed as a block of its own; with the first accepted it is one more entry — and its card still fits.
    expect(suggestedProperties(await v.text(), [waiting[1]!]).get(waiting[1]!.commentId)).toMatchObject({ key: "owner", stale: false });
    await v.decide([waiting[1]!], "applied");
    expect(await v.text()).toBe("---\nstage: open\nowner: Anna\n---\n# Brief\n\nShort.\n");
  });
});
