// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone's new pinboard entry (plan Befunde 2026-09-24, E14–E17): the
 * SHARED core over this shell's file paths. It replaces `captureBaseItem`,
 * whose tests stood here — their three cases (no folder asks, the answered
 * folder carries tag and view prefill, a persisted folder counts on) are
 * kept below against the new path, next to what that path had lost: the
 * board's ACTIVE labels, the default template, and asking when there are
 * several folder sources.
 */

const files = new Map<string, string>();
const log: string[] = [];
vi.mock("./vaultService", () => ({
  vaultOps: {
    save: async (_v: unknown, path: string, content: string) => {
      log.push(`save ${path}`);
      files.set(path, content);
    },
    read: async (_v: unknown, path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    rename: async (_v: unknown, path: string, stem: string) => {
      const next = `${path.slice(0, path.lastIndexOf("/") + 1)}${stem}.md`;
      files.set(next, files.get(path)!);
      files.delete(path);
      log.push(`rename ${path} -> ${next}`);
      return next;
    },
    remove: async (_v: unknown, path: string, confirmation?: { confirmed: true }) => {
      log.push(`remove ${path}${confirmation?.confirmed ? " (confirmed)" : ""}`);
      files.delete(path);
    },
  },
  noteSaver: {
    flush: async (path: string) => {
      log.push(`flush ${path}`);
    },
  },
}));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ defaultNoteType: "Note", attachmentFolder: "Attachments" }) }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ name: "Vault" }) }));
const answerTemplateFile = vi.fn();
const buildNewNoteFromTemplate = vi.fn();
const skeleton = async (o: { type: string; fallbackBody: string }) => ({ content: `---\ntype: ${o.type}\n---\n\n${o.fallbackBody}`, caret: null });
vi.mock("./templateInteractive", () => ({
  answerTemplateFile: (opts: unknown) => answerTemplateFile(opts),
  buildNewNoteFromTemplate: (opts: { type: string; fallbackBody: string }) => buildNewNoteFromTemplate(opts),
}));

import { createBaseItem, discardMobilePinboardEntry, finalizeMobilePinboardEntry, planMobilePinboardEntry } from "./baseOps";

const vault = { files: { exists: async (p: string) => files.has(p) } } as any;

const zettel = {
  filters: { and: ['file.hasTag("zettel")'] },
  views: [{ type: "table", name: "Pinnwand", filters: { and: ['status == "offen"'] } }],
};
const opts = { viewIndex: 0, activeLabels: [] as string[], labelProperty: null as string | null };

async function ready(config: any, extra: Partial<typeof opts> & { folder?: string } = {}) {
  const plan = await planMobilePinboardEntry(vault, config, { ...opts, ...extra });
  if (plan.status !== "ready") throw new Error(`not ready: ${plan.status}`);
  return plan.draft;
}

describe("planMobilePinboardEntry", () => {
  beforeEach(() => {
    files.clear();
    log.length = 0;
    answerTemplateFile.mockReset();
  });

  it("writes nothing and asks when the base has no folder", async () => {
    expect(await planMobilePinboardEntry(vault, zettel, opts)).toEqual({ status: "ask-folder", mode: "setup" });
    expect(files.size).toBe(0);
  });

  it("asks — never picks the first — when the base has several folder sources", async () => {
    const two = { filters: { or: ['file.folder == "A"', 'file.folder == "B"'] }, views: [{ type: "table" }] };
    expect(await planMobilePinboardEntry(vault, two, opts)).toEqual({ status: "ask-folder", mode: "choice" });
    expect(files.size).toBe(0);
  });

  it("with the answered folder it writes the draft there, with the tag and the view's prefill", async () => {
    const draft = await ready(zettel, { folder: "Zettel" });
    expect(draft.path).toMatch(/^Zettel\/\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.md$/);
    const content = files.get(draft.path)!;
    expect(content).toMatch(/tags:\n\s+- zettel/);
    expect(content).toMatch(/status: offen/);
    expect(content).toMatch(/type: Note/);
  });

  it("carries the board's ACTIVE labels — the phone used to drop them — as removable chips", async () => {
    const draft = await ready(zettel, { folder: "Zettel", activeLabels: ["einkauf"] });
    expect(files.get(draft.path)).toMatch(/tags:\n\s+- zettel\n\s+- einkauf/);
    expect(draft.chips.map((c) => c.id)).toContain("tag:tags:einkauf");
    const byProperty = await ready(
      { ...zettel, newItemFolder: "Zettel", views: [{ type: "table", name: "P" }] },
      { activeLabels: ["garten"], labelProperty: "themen" },
    );
    expect(files.get(byProperty.path)).toMatch(/themen:\n\s+- garten/);
  });

  it("a persisted newItemFolder answers the question for good; a draft of the same second counts on", async () => {
    const first = await ready({ ...zettel, newItemFolder: "Zettel" });
    const second = await ready({ ...zettel, newItemFolder: "Zettel" });
    expect(second.path).not.toBe(first.path);
    expect(first.path.startsWith("Zettel/")).toBe(true);
  });

  it("the base's default template fills the body; cancelling its questions creates nothing", async () => {
    answerTemplateFile.mockResolvedValueOnce({ text: "- [ ] {{nothing}}\n", cursor: 6 });
    const draft = await ready({ ...zettel, newItemFolder: "Zettel", newItemTemplate: "Templates/Zettel.md" });
    expect(files.get(draft.path)).toContain("- [ ] {{nothing}}");
    expect(answerTemplateFile).toHaveBeenCalledWith(expect.objectContaining({ template: "Templates/Zettel.md", folder: "Zettel" }));
    answerTemplateFile.mockResolvedValueOnce(null);
    const before = files.size;
    expect(await planMobilePinboardEntry(vault, { ...zettel, newItemFolder: "Zettel", newItemTemplate: "Templates/Zettel.md" }, opts)).toEqual({ status: "cancelled" });
    expect(files.size).toBe(before);
  });
});

describe("finalizeMobilePinboardEntry / discardMobilePinboardEntry", () => {
  beforeEach(() => {
    files.clear();
    log.length = 0;
  });

  it("lands the editor's keystrokes first, then makes the title heading and file name through the rename", async () => {
    const draft = await ready({ ...zettel, newItemFolder: "Zettel" });
    files.set(draft.path, files.get(draft.path)! + "Kaffee\n");
    log.length = 0;
    const result = await finalizeMobilePinboardEntry(vault, draft, { title: "Einkauf Samstag", removedChips: [], intent: "save" });
    expect(result).toEqual({ outcome: "kept", path: "Zettel/Einkauf Samstag.md" });
    expect(log[0]).toBe(`flush ${draft.path}`);
    expect(log).toContain(`rename ${draft.path} -> Zettel/Einkauf Samstag.md`);
    expect(files.get("Zettel/Einkauf Samstag.md")).toMatch(/# Einkauf Samstag\n\nKaffee\n$/);
  });

  it("closing an empty draft takes it back with a confirmed delete; closing one with text keeps it", async () => {
    const empty = await ready({ ...zettel, newItemFolder: "Zettel" });
    expect(await finalizeMobilePinboardEntry(vault, empty, { title: "", removedChips: [], intent: "close" })).toEqual({ outcome: "removed", path: null });
    expect(log).toContain(`remove ${empty.path} (confirmed)`);
    const typed = await ready({ ...zettel, newItemFolder: "Zettel" });
    files.set(typed.path, files.get(typed.path)! + "Text\n");
    expect(await finalizeMobilePinboardEntry(vault, typed, { title: "", removedChips: [], intent: "close" })).toEqual({ outcome: "kept", path: typed.path });
    expect(files.has(typed.path)).toBe(true);
  });

  it("discarding asks only when there is content", async () => {
    const draft = await ready({ ...zettel, newItemFolder: "Zettel" });
    files.set(draft.path, files.get(draft.path)! + "Text\n");
    let asked = 0;
    expect(await discardMobilePinboardEntry(vault, draft, { title: "", confirm: async () => { asked++; return false; } })).toBe("kept");
    expect(files.has(draft.path)).toBe(true);
    expect(await discardMobilePinboardEntry(vault, draft, { title: "", confirm: async () => { asked++; return true; } })).toBe("removed");
    expect(files.has(draft.path)).toBe(false);
    expect(asked).toBe(2);
  });
});

describe("createBaseItem", () => {
  beforeEach(() => {
    files.clear();
    log.length = 0;
    buildNewNoteFromTemplate.mockReset();
    buildNewNoteFromTemplate.mockImplementation(skeleton);
  });

  it("asks — never picks the first — when the base has several folder sources (E16)", async () => {
    const two = { filters: { or: ['file.folder == "A"', 'file.folder == "B"'] }, views: [{ type: "table" }] };
    expect(await createBaseItem(vault, "Two.base", two, 0)).toEqual({ status: "ask-folder" });
    expect(files.size).toBe(0);
    expect(await createBaseItem(vault, "Two.base", two, 0, 0, "B")).toEqual({ status: "created", path: "B/Two_1.md" });
  });

  it("takes over the view's tag rule as a tag, next to the source tags", async () => {
    const config = {
      filters: { and: ['file.hasTag("zettel")'] },
      newItemFolder: "Zettel",
      views: [{ type: "table", name: "T", filters: { and: ['file.tags.contains("idee")'] } }],
    };
    const made = await createBaseItem(vault, "Zettel.base", config, 0);
    expect(made.status === "created" && files.get(made.path)).toMatch(/tags:\n\s+- zettel\n\s+- idee/);
  });

  it("cancelled template questions create nothing — and are not a folder question", async () => {
    buildNewNoteFromTemplate.mockResolvedValueOnce(null);
    const config = { filters: { and: ['file.folder == "Zettel"'] }, newItemTemplate: "Templates/Z.md", views: [{ type: "table" }] };
    expect(await createBaseItem(vault, "Zettel.base", config, 0)).toEqual({ status: "cancelled" });
    expect(files.size).toBe(0);
  });

  it("inherits like the desktop: a template key wins over a filter, the template's tags stay", async () => {
    // The phone used to write the view's filter over the template's value and
    // replace the template's tags with the source tags.
    buildNewNoteFromTemplate.mockResolvedValueOnce({ content: "---\ntype: Note\nstatus: entwurf\ntags:\n  - vorlage\n---\n\n# Zettel_1\n", caret: null });
    const config = {
      filters: { and: ['file.hasTag("zettel")'] },
      newItemFolder: "Zettel",
      newItemTemplate: "Templates/Z.md",
      views: [{ type: "table", name: "T", filters: { and: ['status == "offen"', 'prio == "hoch"'] } }],
    };
    const made = await createBaseItem(vault, "Zettel.base", config, 0);
    const text = made.status === "created" ? files.get(made.path)! : "";
    expect(text).toMatch(/status: entwurf/);
    expect(text).not.toMatch(/status: offen/);
    expect(text).toMatch(/prio: hoch/);
    expect(text).toMatch(/tags:\n\s+- vorlage\n\s+- zettel/);
  });
});
