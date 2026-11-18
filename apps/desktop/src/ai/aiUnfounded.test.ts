import { describe, expect, it, vi } from "vitest";
import * as links from "../../../../packages/ui/src/ai/answerLinks";
import { mcpSession, turn } from "./mcpSessionHarness";

// The reader of an answer's links, watched (review O7, fourth and fifth round): an answer that cannot hold a link is
// not read. The session imports it from its own module; the mock is keyed by that file.
vi.mock("../../../../packages/ui/src/ai/answerLinks", async (original) => {
  const actual = await original<typeof import("../../../../packages/ui/src/ai/answerLinks")>();
  return { ...actual, answerLinksShown: vi.fn(actual.answerLinksShown) };
});

/**
 * The warning under an answer (plan Oberfläche O7, E2; review O7, second round): which notes an answer names as its
 * source that the conversation never had is checked once, as the run ends — over every text the run gave, and against
 * the vault the shell lists — and kept with the run (`RunMeta.unfounded`). The conversation only shows it.
 */
const find = { id: "c1", name: "find_tools", args: { query: "notes" } };

describe("the notes an answer names without the conversation having had them", () => {
  it("are checked in every text of the run: a citation before a tool call counts as much as the last words", async () => {
    const { s } = await mcpSession([turn({ text: "The offer rests on [[Pricing 2026]].", calls: [find] }), turn({ text: "Done." })]);
    expect(await s.send("Check the offer.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toEqual(["Pricing 2026"]);
  });

  it("are read against the vault the shell lists: a file that is no note names no source, a name with a dot is a note", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[diagram.png]], [[Pricing 2026]] and [[Node.js]]." })]);
    const asked: string[][] = [];
    vault.host.linkFilesFor = async (targets) => {
      asked.push([...targets]);
      return [{ path: "Pricing 2026.md", title: "Pricing 2026" }, { path: "Node.js.md", title: "Node.js" }, { path: "diagram.png", title: "diagram.png", mode: "attachment" }];
    };
    expect(await s.send("What do the notes say?")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toEqual(["Pricing 2026", "Node.js"]);
    // The vault was asked once, for the answer's links — where each leads is the vault's to say first (review O7,
    // fourth round) —, never for its whole list.
    expect(asked).toEqual([["diagram.png", "Pricing 2026", "Node.js"]]);
  });

  it("an answer that cannot hold a link is not read, and the vault is not asked", async () => {
    // Brackets and a parenthesis, but no link: what only `answerMayLink` keeps from the parser.
    const { s, vault } = await mcpSession([turn({ text: "Three feature pages instead of six (see the [draft] plan), and https://example.com." })]);
    let asked = 0;
    vault.host.linkFilesFor = async () => {
      asked++;
      return [];
    };
    vi.mocked(links.answerLinksShown).mockClear();
    expect(await s.send("Summarize.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.runs[0]!.unfounded).toBeUndefined();
    expect(s.getState().active!.runs[0]!.unfoundedUnchecked).toBeUndefined();
    expect(vi.mocked(links.answerLinksShown)).not.toHaveBeenCalled();
    expect(asked).toBe(0);
  });

  it("the run is written before the check begins: a vault that never answers holds nothing up", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[Pricing 2026]]." })]);
    const saved: Array<string[] | undefined> = [];
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    vault.host.conversations.save = async (record) => {
      saved.push(record.runs[record.runs.length - 1]?.unfounded);
      await save(record);
    };
    let answer: (() => void) | null = null;
    vault.host.linkFilesFor = () =>
      new Promise((resolve) => {
        answer = () => resolve([]);
      });
    const sending = s.send("And the prices?");
    // The run is stored while the check still waits for the vault.
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toBeUndefined();
    answer!();
    expect(await sending).toEqual({ kind: "answered" });
    expect(saved[saved.length - 1]).toEqual(["Pricing 2026"]);
  });

  it("what the user chose while it was checked is in what lies on disk with the finding — the title, what goes redacted", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[Pricing 2026]]." })]);
    let answer: (() => void) | null = null;
    let asking = 0;
    vault.host.linkFilesFor = () =>
      new Promise((resolve) => {
        asking++;
        answer = () => resolve([]);
      });
    const sending = s.send("And the prices?");
    await expect.poll(() => asking).toBe(1);
    const id = s.getState().active!.id;
    // Chosen while the check waits for the vault: they go onto the stored conversation (`storeChoice`).
    await s.rename(id, "Prices, checked");
    await s.toggleRedact("Projects/Offer.md");
    answer!();
    expect(await sending).toEqual({ kind: "answered" });
    const stored = await vault.host.conversations.load(id);
    expect(stored!.title).toBe("Prices, checked");
    expect(stored!.redact).toEqual(["Projects/Offer.md"]);
    expect(stored!.runs[stored!.runs.length - 1]!.unfounded).toEqual(["Pricing 2026"]);
  });

  it("a vault whose files cannot be listed now leaves the run marked as not checked — never as nothing found", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[Pricing 2026]]." })]);
    vault.host.linkFilesFor = async () => {
      throw new Error("index closed");
    };
    expect(await s.send("And the prices?")).toEqual({ kind: "answered" });
    const run = s.getState().active!.runs[0]!;
    expect(run.unfounded).toBeUndefined();
    expect(run.unfoundedUnchecked).toBe(true);
    const stored = await vault.host.conversations.load(s.getState().active!.id);
    expect(stored!.runs[0]!.unfoundedUnchecked).toBe(true);
  });

  it("a vault that does not answer in time leaves the run marked as not checked, and the run ends", async () => {
    const { s, vault } = await mcpSession([turn({ text: "See [[Pricing 2026]]." })]);
    vault.host.linkFilesFor = () => new Promise(() => undefined);
    expect(await s.send("And the prices?")).toEqual({ kind: "answered" });
    const run = s.getState().active!.runs[0]!;
    expect(run.unfounded).toBeUndefined();
    expect(run.unfoundedUnchecked).toBe(true);
  }, 10_000);
});
