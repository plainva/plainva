import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  applyPinboardEntryTitle,
  discardPinboardEntry,
  finalizePinboardEntry,
  pinboardDraftState,
  pinboardLabelProperty,
  planPinboardEntry,
  viewPrefill,
  type PinboardDraft,
  type PinboardEntryFiles,
} from "@plainva/ui";

/**
 * The one core behind "New entry" on a pinboard (plan Befunde 2026-09-24,
 * E14–E16): the draft is a real file from the first moment, the board's
 * active labels and the view's filters come along, and ending the entry never
 * loses what was typed — nor leaves behind what was not.
 */

function memoryFiles(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const log: string[] = [];
  const files: PinboardEntryFiles = {
    exists: async (p) => store.has(p),
    read: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return v;
    },
    readBytes: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error(`missing ${p}`);
      return new TextEncoder().encode(v);
    },
    write: async (p, c) => {
      log.push(`write ${p}`);
      store.set(p, c);
    },
    rename: async (p, stem) => {
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
      const next = `${dir}${stem}.md`;
      if (store.has(next)) throw new Error("exists");
      log.push(`rename ${p} -> ${next}`);
      store.set(next, store.get(p)!);
      store.delete(p);
      return next;
    },
    remove: async (p) => {
      log.push(`remove ${p}`);
      store.delete(p);
    },
  };
  return { files, store, log };
}

const frontmatter = (content: string): Record<string, unknown> => {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? (parseYaml(m[1]) as Record<string, unknown>) : {};
};

const NOW = new Date(2026, 8, 24, 9, 12, 5);
const STAMP = "2026-09-24 09.12.05";

const zettel = {
  filters: { and: ['file.folder == "Zettel"'] },
  columns: { status: { input: "select" }, prio: { input: "number" }, themen: { input: "multiselect" } },
  views: [{ type: "table", name: "Pinnwand", filters: { and: ['status == "offen"', 'prio == "2"'] } }],
};

async function ready(files: PinboardEntryFiles, opts: Partial<Parameters<typeof planPinboardEntry>[1]> = {}): Promise<PinboardDraft> {
  const plan = await planPinboardEntry(files, {
    config: zettel,
    viewIndex: 0,
    activeLabels: [],
    labelProperty: null,
    noteType: "Note",
    now: NOW,
    ...opts,
  });
  if (plan.status !== "ready") throw new Error(`not ready: ${plan.status}`);
  return plan.draft;
}

describe("planPinboardEntry: the draft exists before a word is typed", () => {
  it("writes a timestamp-named file into the base's folder, with OKF and the view's filters typed", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    expect(draft.path).toBe(`Zettel/${STAMP}.md`);
    expect(draft.stem).toBe(STAMP);
    const fm = frontmatter(store.get(draft.path)!);
    expect(fm.type).toBe("Note");
    expect(fm.status).toBe("offen");
    expect(fm.prio).toBe(2);
    // An empty body: nothing is written that the person did not ask for.
    expect(store.get(draft.path)!.split("---").pop()!.trim()).toBe("");
  });

  it("counts past a draft of the same second", async () => {
    const { files } = memoryFiles({ [`Zettel/${STAMP}.md`]: "x" });
    const draft = await ready(files);
    expect(draft.path).toBe(`Zettel/${STAMP} 2.md`);
  });

  it("asks for the folder when there is none, and asks — never picks — when there are several", async () => {
    const { files, store } = memoryFiles();
    const none = await planPinboardEntry(files, { config: { views: [{ type: "table" }] }, viewIndex: 0, activeLabels: [], labelProperty: null, noteType: "Note", now: NOW });
    expect(none).toEqual({ status: "ask-folder", mode: "setup" });
    const several = await planPinboardEntry(files, {
      config: { filters: { or: ['file.folder == "A"', 'file.folder == "B"'] }, views: [{ type: "table" }] },
      viewIndex: 0,
      activeLabels: [],
      labelProperty: null,
      noteType: "Note",
      now: NOW,
    });
    expect(several).toEqual({ status: "ask-folder", mode: "choice" });
    expect(store.size).toBe(0);
    const answered = await planPinboardEntry(files, {
      config: { filters: { or: ['file.folder == "A"', 'file.folder == "B"'] }, views: [{ type: "table" }] },
      viewIndex: 0,
      activeLabels: [],
      labelProperty: null,
      folder: "B/",
      noteType: "Note",
      now: NOW,
    });
    expect(answered.status === "ready" && answered.draft.path).toBe(`B/${STAMP}.md`);
  });

  it("carries the ACTIVE labels in tags mode — the phone used to drop them — and offers them as chips", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files, { config: { ...zettel, filters: { and: ['file.hasTag("zettel")', 'file.folder == "Zettel"'] } }, activeLabels: ["einkauf"] });
    const fm = frontmatter(store.get(draft.path)!);
    expect(fm.tags).toEqual(["zettel", "einkauf"]);
    // The source tag is membership, not a choice: no chip for it.
    expect(draft.chips.map((c) => c.id)).toEqual(["tag:tags:einkauf", "value:status:offen", "value:prio:2"]);
    expect(draft.chips[0].from).toBe("label");
    expect(draft.chips[1].from).toBe("filter");
  });

  it("puts the labels into the label property in property mode, merged with a contains-filter on it", async () => {
    const { files, store } = memoryFiles();
    const config = { ...zettel, views: [{ type: "table", name: "P", filters: { and: ['contains(themen, "haus")'] } }] };
    const draft = await ready(files, { config, activeLabels: ["garten"], labelProperty: "themen" });
    expect(frontmatter(store.get(draft.path)!).themen).toEqual(["haus", "garten"]);
    expect(draft.chips.map((c) => `${c.id}/${c.from}`)).toEqual(["value:themen:haus/filter", "value:themen:garten/label"]);
  });

  it("the label property is read from the view the way the chip bar reads it", () => {
    expect(pinboardLabelProperty({})).toBeNull();
    expect(pinboardLabelProperty({ pinboardFilterBy: "tags" })).toBeNull();
    expect(pinboardLabelProperty({ pinboardFilterBy: "note.themen" })).toBe("themen");
  });

  it("a file.tags rule of the view becomes a tag", () => {
    const pre = viewPrefill({ views: [{ type: "table", filters: { and: ['file.tags.contains("idee")', 'file.folder == "X"'] } }] }, 0);
    expect(pre).toEqual({ props: {}, tags: ["idee"] });
  });

  it("the default template fills the body; its questions come first, and cancelling creates nothing", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files, {
      template: async ({ title, folder }) => ({ text: `# ${title}\n\n- [ ] ${folder}\n`, caret: `# ${title}\n\n- [ ] `.length }),
    });
    const text = store.get(draft.path)!;
    expect(text).toContain(`# ${STAMP}\n\n- [ ] Zettel`);
    expect(text.slice(draft.caret!, draft.caret! + 6)).toBe("Zettel");

    const cancelled = await planPinboardEntry(files, {
      config: zettel,
      viewIndex: 0,
      activeLabels: [],
      labelProperty: null,
      noteType: "Note",
      now: new Date(2026, 8, 24, 10, 0, 0),
      template: async () => null,
    });
    expect(cancelled).toEqual({ status: "cancelled" });
    expect(store.size).toBe(1);
  });

  it("the template's caret is found in the note, whatever was written in front of the body", async () => {
    // A template with its own frontmatter: the header is rewritten, the body
    // keeps its place relative to the END of the note.
    const withHeader = memoryFiles();
    const a = await ready(withHeader.files, { template: async () => ({ text: "---\nstatus: entwurf\n---\n\n- [ ] ", caret: "---\nstatus: entwurf\n---\n\n- [ ] ".length }) });
    const textA = withHeader.store.get(a.path)!;
    expect(a.caret).toBe(textA.length);
    expect(textA.slice(0, a.caret!).endsWith("\n\n- [ ] ")).toBe(true);
    // An empty header block (`---` on `---`) is a block like any other: the
    // OKF header and the view's filters go between its fences. It used to be
    // taken for no block at all, so a whole new block landed in front of it
    // and its two fences stood in the note as rules (finding 2026-10-07).
    const emptyHeader = memoryFiles();
    const b = await ready(emptyHeader.files, { template: async () => ({ text: "---\n---\n- [ ] ", caret: "---\n---\n- [ ] ".length }) });
    const textB = emptyHeader.store.get(b.path)!;
    expect(textB.split("\n").filter((line) => line === "---")).toHaveLength(2);
    expect(frontmatter(textB)).toMatchObject({ type: "Note", status: "offen" });
    expect(textB.endsWith("\n---\n- [ ] ")).toBe(true);
    expect(b.caret).toBe(textB.length);
    // A template that is only frontmatter: the caret goes to the end, never
    // into the header.
    const onlyHeader = memoryFiles();
    const c = await ready(onlyHeader.files, { template: async () => ({ text: "---\nstatus: entwurf\n---\n", caret: "---\nstatus: entwurf\n---\n".length }) });
    const textC = onlyHeader.store.get(c.path)!;
    expect(c.caret).toBe(textC.length);
  });

  it("a template key wins over a filter, and then no chip claims the filter's value", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files, { template: async () => ({ text: "---\nstatus: entwurf\n---\n\nText\n", caret: null }) });
    expect(frontmatter(store.get(draft.path)!).status).toBe("entwurf");
    expect(draft.chips.map((c) => c.key)).not.toContain("status");
  });
});

describe("finalizePinboardEntry: ending an entry", () => {
  it("a typed title becomes `# Title` and the file name, through the rename (a move, not a new file)", async () => {
    const { files, store, log } = memoryFiles();
    const draft = await ready(files);
    store.set(draft.path, store.get(draft.path)! + "Kaffee, Bohnen\n");
    const result = await finalizePinboardEntry(files, { draft, title: "Einkauf Samstag", intent: "save" });
    expect(result).toEqual({ outcome: "kept", path: "Zettel/Einkauf Samstag.md" });
    const text = store.get("Zettel/Einkauf Samstag.md")!;
    expect(text).toMatch(/---\n\n?# Einkauf Samstag\n\nKaffee, Bohnen\n$/);
    expect(log).toContain(`rename ${draft.path} -> Zettel/Einkauf Samstag.md`);
    expect(store.has(draft.path)).toBe(false);
  });

  it("the name is cleaned, the heading keeps what was typed, and a taken name counts on", async () => {
    const { files, store } = memoryFiles({ "Zettel/Einkauf Samstag.md": "old" });
    const draft = await ready(files);
    const result = await finalizePinboardEntry(files, { draft, title: "Einkauf: Samstag", intent: "save" });
    expect(result.path).toBe("Zettel/Einkauf Samstag 2.md");
    expect(store.get("Zettel/Einkauf Samstag 2.md")).toContain("# Einkauf: Samstag\n");
    expect(store.get("Zettel/Einkauf Samstag.md")).toBe("old");
  });

  it("never writes the title twice, and takes over a heading that mirrors the timestamp", () => {
    expect(applyPinboardEntryTitle("---\ntype: Note\n---\n\n# Einkauf\n\nText\n", "Einkauf", STAMP)).toBe("---\ntype: Note\n---\n\n# Einkauf\n\nText\n");
    expect(applyPinboardEntryTitle(`---\ntitle: ${STAMP}\n---\n\n# ${STAMP}\n\nText\n`, "Einkauf", STAMP)).toBe("---\ntitle: Einkauf\n---\n\n# Einkauf\n\nText\n");
    // A heading the person wrote stays; the title goes on top of it.
    expect(applyPinboardEntryTitle("---\ntype: Note\n---\n## Liste\n", "Einkauf", STAMP)).toBe("---\ntype: Note\n---\n# Einkauf\n\n## Liste\n");
    expect(applyPinboardEntryTitle("Nur Text\n", "", STAMP)).toBe("Nur Text\n");
  });

  it("without a title the timestamp name stays and nothing is renamed", async () => {
    const { files, store, log } = memoryFiles();
    const draft = await ready(files);
    store.set(draft.path, store.get(draft.path)! + "Nur Body\n");
    const result = await finalizePinboardEntry(files, { draft, title: "  ", intent: "close" });
    expect(result).toEqual({ outcome: "kept", path: draft.path });
    expect(log.some((l) => l.startsWith("rename"))).toBe(false);
    expect(store.get(draft.path)).not.toContain("# ");
  });

  it("closing an EMPTY entry removes the own draft — and so does saving one", async () => {
    for (const intent of ["close", "save"] as const) {
      const { files, store, log } = memoryFiles();
      const draft = await ready(files);
      const result = await finalizePinboardEntry(files, { draft, title: "", intent });
      expect(result).toEqual({ outcome: "removed", path: null });
      expect(store.size).toBe(0);
      expect(log).toContain(`remove ${draft.path}`);
    }
  });

  it("an untouched template goes when the window is closed, but stays when it is saved", async () => {
    const tpl = { template: async () => ({ text: "- [ ] \n", caret: null }) };
    const closed = memoryFiles();
    const a = await ready(closed.files, tpl);
    expect((await finalizePinboardEntry(closed.files, { draft: a, title: "", intent: "close" })).outcome).toBe("removed");
    const saved = memoryFiles();
    const b = await ready(saved.files, tpl);
    expect((await finalizePinboardEntry(saved.files, { draft: b, title: "", intent: "save" })).outcome).toBe("kept");
  });

  it("closing never discards content: typed text is kept, with the title applied", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    store.set(draft.path, store.get(draft.path)! + "Wichtig\n");
    const result = await finalizePinboardEntry(files, { draft, title: "Notiz", intent: "close" });
    expect(result.outcome).toBe("kept");
    expect(store.get("Zettel/Notiz.md")).toContain("Wichtig");
  });

  it("removed chips come off again; the rest of the frontmatter stays", async () => {
    const { files, store } = memoryFiles();
    const config = { ...zettel, filters: { and: ['file.hasTag("zettel")', 'file.folder == "Zettel"'] } };
    const draft = await ready(files, { config, activeLabels: ["einkauf", "haus"] });
    store.set(draft.path, store.get(draft.path)! + "x\n");
    const drop = draft.chips.filter((c) => c.value === "einkauf" || c.key === "prio");
    await finalizePinboardEntry(files, { draft, title: "", removedChips: drop, intent: "save" });
    const fm = frontmatter(store.get(draft.path)!);
    expect(fm.tags).toEqual(["zettel", "haus"]);
    expect(fm.prio).toBeUndefined();
    expect(fm.status).toBe("offen");
  });

  it("a name taken in the meantime keeps the timestamp name and says so", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    const racing: PinboardEntryFiles = { ...files, rename: async () => { throw new Error("already exists"); } };
    const result = await finalizePinboardEntry(racing, { draft, title: "Neu", intent: "save" });
    expect(result).toEqual({ outcome: "kept", path: draft.path, renameFailed: true });
    expect(store.get(draft.path)).toContain("# Neu");
  });

  it("text in the editor whose save has not landed yet is never read as empty", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    const live = store.get(draft.path)! + "Gerade getippt\n";
    const closed = await finalizePinboardEntry(files, { draft, title: "", intent: "close", live });
    expect(closed).toEqual({ outcome: "kept", path: draft.path });
    expect(store.has(draft.path)).toBe(true);
    let asked = 0;
    expect(await discardPinboardEntry(files, { draft, title: "", live, confirm: async () => { asked++; return false; } })).toBe("kept");
    expect(asked).toBe(1);
  });

  it("a draft that is already gone ends quietly", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    store.delete(draft.path);
    expect(await finalizePinboardEntry(files, { draft, title: "x", intent: "save" })).toEqual({ outcome: "removed", path: null });
  });
});

describe("discardPinboardEntry and the draft states", () => {
  it("an empty entry goes without a question; one with content only after the confirmation", async () => {
    const { files, store } = memoryFiles();
    const draft = await ready(files);
    let asked = 0;
    expect(await discardPinboardEntry(files, { draft, title: "", confirm: async () => { asked++; return false; } })).toBe("removed");
    expect(asked).toBe(0);

    const second = await ready(files);
    store.set(second.path, store.get(second.path)! + "Text\n");
    expect(await discardPinboardEntry(files, { draft: second, title: "", confirm: async () => { asked++; return false; } })).toBe("kept");
    expect(store.has(second.path)).toBe(true);
    expect(await discardPinboardEntry(files, { draft: second, title: "", confirm: async () => { asked++; return true; } })).toBe("removed");
    expect(store.has(second.path)).toBe(false);
    expect(asked).toBe(2);
  });

  it("a title alone is content", () => {
    expect(pinboardDraftState("---\ntype: Note\n---\n", "---\ntype: Note\n---\n", "Titel")).toBe("content");
    expect(pinboardDraftState("---\ntype: Note\n---\n\n  \n", "---\ntype: Note\n---\n", "")).toBe("blank");
    expect(pinboardDraftState("---\ntype: Note\n---\n- [ ] \n", "---\ntype: Note\n---\n- [ ] \n", "")).toBe("untouched");
    expect(pinboardDraftState("---\ntype: Note\n---\n- [ ] Milch\n", "---\ntype: Note\n---\n- [ ] \n", "")).toBe("content");
  });
});
