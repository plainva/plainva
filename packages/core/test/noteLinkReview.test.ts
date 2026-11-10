import { describe, expect, it } from "vitest";
import {
  contentPathRefusal,
  contentReadPath,
  foldSegment,
  isInternalPath,
  isInternalSegment,
  isShortNameAlias,
  isWindowsDeviceSegment,
} from "../src/vault/internalPath.js";
import { planBlockLink, selectNoteFragment, type BlockLinkPlan } from "../src/noteSource.js";
import { readTasksMetadata, tasksDescription, withoutBlockId } from "../src/vault/taskMetadata.js";
import { scanTasks } from "../src/vault/taskScan.js";
import { setChecklistTaskDone } from "../src/vault/taskMutation.js";
import { parseJournal, replaceJournalEntry } from "../src/journal.js";
import { DEFAULT_IMPORT_LABELS, ImportWriter } from "../src/import/index.js";

/**
 * The F2 review (2026-11-10): what a note link and the paths content names
 * may reach, and what writing a block id must never break.
 */

describe("the app's own folders, in every spelling the file system takes for them", () => {
  it("folds case, trailing dots and spaces and NFC before every rule", () => {
    expect(foldSegment(".Plainva. ")).toBe(".plainva");
    for (const segment of [".plainva", ".Plainva", ".PLAINVA", ".plainva.", ".plainva ", ".plainva. .", ".Git", ".OBSIDIAN", ".Trash", "Node_Modules", ".Plainva-Tmp-1.tmp", ".MyPy_Cache"]) {
      expect(isInternalSegment(segment), JSON.stringify(segment)).toBe(true);
    }
    for (const segment of [".env-notes.md", "plainva", ".plainvatmp", "notes.plainva.png", "Plainva", ".plainvax", ".gitignore"]) {
      expect(isInternalSegment(segment), JSON.stringify(segment)).toBe(false);
    }
    expect(isInternalPath(".Plainva/sync/keyfile.json")).toBe(true);
    expect(isInternalPath("Notes/.GIT/hooks/x.sh")).toBe(true);
  });

  it("names device names, 8.3 aliases and data streams a path from content may not reach", () => {
    for (const s of ["NUL", "nul.md", "COM1.txt", "lpt9", "aux.txt", "CON", "NUL .md", "CONIN$", "conout$.txt"]) expect(isWindowsDeviceSegment(s), s).toBe(true);
    for (const s of ["Null.md", "COM10.md", "Console", "nulls", "aux_notes.md"]) expect(isWindowsDeviceSegment(s), s).toBe(false);
    for (const s of ["PLAINV~1", "PROGRA~1", "NOTES~12.MD", "a~1.md"]) expect(isShortNameAlias(s), s).toBe(true);
    for (const s of ["Plan.md", "~draft.md", "notes~.md", "LongerName~1.md"]) expect(isShortNameAlias(s), s).toBe(false);
    expect(contentPathRefusal(".Plainva/sync/keyfile.json")).toBe("internal");
    expect(contentPathRefusal("PLAINV~1/sync/keyfile.json")).toBe("alias");
    expect(contentPathRefusal("Notes/NUL.md")).toBe("device");
    expect(contentPathRefusal("Notes/a.md:secret")).toBe("stream");
    expect(contentPathRefusal("Notes/.drafts/a.md")).toBeNull();
    expect(contentPathRefusal("Projects/Plan.md")).toBeNull();
    expect(() => contentReadPath(".Obsidian/templates/x.md")).toThrow();
    expect(contentReadPath("Templates/Meeting.md")).toBe("Templates/Meeting.md");
  });

  it("an import never writes into them", async () => {
    const files = new Map<string, string>();
    const vaultAdapter = {
      async exists(path: string) { return files.has(path); },
      async writeTextFile(path: string, content: string) { files.set(path, content); },
      async createDir() { /* implicit */ },
    };
    const writer = new ImportWriter({ targetVaultPath: "/v", vaultAdapter } as never, DEFAULT_IMPORT_LABELS);
    for (const path of [".plainva/sync/settings.md", ".Plainva/x.md", ".git/hooks/x.md", "NUL.md"]) {
      await expect(writer.writeNote(path, "x"), path).rejects.toThrow(/refused import path/);
    }
    await writer.writeNote("Notes/fine.md", "ok");
    expect([...files.keys()]).toEqual(["Notes/fine.md"]);
  });
});

function apply(text: string, plan: BlockLinkPlan): string {
  if (plan.kind !== "block" || !plan.insert) return text;
  return text.slice(0, plan.insert.at) + plan.insert.text + text.slice(plan.insert.at);
}
const zeros = () => 0;

describe("where a block id goes (F2 review, point 6)", () => {
  it("a callout and a quote get theirs on a line of their own — never in the callout's title", () => {
    const callout = "> [!note] Title\n> Body text\n\nAfter";
    const written = apply(callout, planBlockLink(callout, 0, zeros));
    expect(written).toBe("> [!note] Title\n> Body text\n\n^aaaaaa\n\nAfter");
    expect(written.split("\n")[0]).toBe("> [!note] Title");
    expect(selectNoteFragment(written, "^aaaaaa")).toMatchObject({ status: "found", text: "> [!note] Title\n> Body text" });
    const titleOnly = "> [!tip] Only a title";
    expect(apply(titleOnly, planBlockLink(titleOnly, 0, zeros))).toBe("> [!tip] Only a title\n\n^aaaaaa");
    const quote = "> a quote\n> two lines";
    expect(apply(quote, planBlockLink(quote, quote.indexOf("two"), zeros))).toBe("> a quote\n> two lines\n\n^aaaaaa");
    const nested = "- item\n\n  > quoted in a list\n";
    expect(planBlockLink(nested, nested.indexOf(">"), zeros)).toEqual({ kind: "refused", reason: "unsupported" });
  });

  it("a heading line is a heading link; a footnote definition, a hard break, a list continuation get the id at their paragraph's end", () => {
    expect(planBlockLink("# Title\n", 0, zeros)).toEqual({ kind: "heading", text: "Title" });
    const footnote = "Text[^1]\n\n[^1]: The footnote.\n";
    const fn = apply(footnote, planBlockLink(footnote, footnote.indexOf("[^1]:"), zeros));
    expect(fn).toBe("Text[^1]\n\n[^1]: The footnote. ^aaaaaa\n");
    expect(selectNoteFragment(fn, "^aaaaaa").status).toBe("found");
    const hard = "first line  \nsecond line\n";
    expect(apply(hard, planBlockLink(hard, 0, zeros))).toBe("first line  \nsecond line ^aaaaaa\n");
    const cont = "- item\n  continued here\n- next\n";
    const c = apply(cont, planBlockLink(cont, cont.indexOf("continued"), zeros));
    expect(c).toBe("- item\n  continued here ^aaaaaa\n- next\n");
    expect(selectNoteFragment(c, "^aaaaaa")).toMatchObject({ status: "found", text: "- item\n  continued here ^aaaaaa" });
  });

  it("keeps the last line without a line end, CRLF, and reuses what already looks like an id", () => {
    expect(apply("last line", planBlockLink("last line", 0, zeros))).toBe("last line ^aaaaaa");
    const crlf = "one\r\ntwo\r\n\r\nthree\r\n";
    expect(apply(crlf, planBlockLink(crlf, 0, zeros))).toBe("one\r\ntwo ^aaaaaa\r\n\r\nthree\r\n");
    expect(planBlockLink("E = mc ^2", 0, zeros)).toEqual({ kind: "block", id: "2", insert: null });
  });
});

describe("a block id on a task line breaks nothing (F2 review, point 5)", () => {
  const today = { today: "2026-11-10", newId: () => "origin" };

  it("the trailing id is an address: recurrence, due date, time and priority still read; the name leaves it out", () => {
    const text = "Pay rent ⏫ 🔁 every month 📅 2026-12-01 09:30 ^k3x9qa";
    const meta = readTasksMetadata(text);
    expect(meta).toMatchObject({ recurrence: "every month", due: "2026-12-01", dueTime: "09:30", unsafeRecurrence: false });
    expect(meta.repeatRule).toEqual({ unit: "month", interval: 1, whenDone: false });
    expect(tasksDescription(text)).toBe("Pay rent ⏫");
    expect(withoutBlockId(text)).toBe("Pay rent ⏫ 🔁 every month 📅 2026-12-01 09:30");
    const task = scanTasks(`- [ ] ${text}`)[0];
    expect(task.recurrenceSupported).toBe(true);
  });

  it("checking it off writes the next occurrence without the id; the id stays on the line links point to", () => {
    const raw = "- [ ] Pay rent 🔁 every month 📅 2026-12-01 ^k3x9qa\n";
    const done = setChecklistTaskDone(raw, 0, true, today);
    const tasks = scanTasks(done.content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ done: false, due: "2027-01-01" });
    expect(tasks[0].text).not.toContain("^k3x9qa");
    expect(tasks[1]).toMatchObject({ done: true, completed: "2026-11-10" });
    expect(done.content.match(/\^k3x9qa/g)).toHaveLength(1);
    expect(done.content.split("\n")[1]).toMatch(/✅ 2026-11-10 \^k3x9qa$/);
    expect(selectNoteFragment(done.content, "^k3x9qa")).toMatchObject({ status: "found" });
    // The same without an id, as before.
    const plain = setChecklistTaskDone("- [ ] Pay rent 🔁 every month 📅 2026-12-01\n", 0, true, today);
    expect(scanTasks(plain.content)).toHaveLength(2);
  });

  it("a ^word inside the text is still not trusted", () => {
    expect(readTasksMetadata("Note ^tag here 🔁 every week 📅 2026-12-01").repeatRule).toBeNull();
  });
});

describe("a journal entry keeps its block id (F2 review, point 5)", () => {
  it("leaves it out of the text and writes it back after an edit", () => {
    const raw = "## Journal\n\n- 09:30 Called Anna ^call01\n- 10:00 Coffee\n";
    const [entry, other] = parseJournal(raw).entries;
    expect(entry).toMatchObject({ text: "Called Anna", blockId: "call01" });
    expect(other.blockId).toBeUndefined();
    const edited = replaceJournalEntry(raw, entry, { text: "Called Anna back" });
    expect(edited.ok && edited.content).toContain("- 09:30 Called Anna back ^call01\n");
  });
});
