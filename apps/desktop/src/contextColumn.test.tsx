// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computedFieldKind,
  computedFieldText,
  formatByteSize,
  isHiddenPropertyKey,
  isPropertyColumn,
  PropActionRow,
  propertyPanelModel,
  PropGroupHead,
  PropLine,
  PropRow,
  shownComputedFields,
  useKeptResolution,
  type NoteComputedField,
} from "@plainva/ui";
import { propertySectionCounts } from "./components/RightSidebar";

/**
 * The building blocks of the context column (plan Befunde 2026-10-06, Teil R):
 * the one row, the model that decides what the properties panel shows, the
 * classification of a database's computed columns, and the hook that keeps an
 * answer on screen while it is looked up again.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const css = (path: string) => readFileSync(join(REPO, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of the first rule whose selector list is exactly `selector`. */
const rule = (sheet: string, selector: string): string => {
  const at = sheet.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
};

describe("PropRow — icon · name · value · edge", () => {
  const html = (node: ReactElement) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(node);
    return host.firstElementChild as HTMLElement;
  };

  it("always renders the four cells, in order — an empty edge keeps its place", () => {
    const el = html(<PropRow name="Wörter">296</PropRow>);
    expect([...el.children].map((c) => c.className)).toEqual(["pv-prow-icon", "pv-prow-name", "pv-prow-value", "pv-prow-edge"]);
    expect(el.querySelector(".pv-prow-edge")!.children.length).toBe(0);
    expect(el.getAttribute("data-frame")).toBe("none");
  });

  it("puts the resting glyph and the actions INTO the edge, and nothing of them into the value", () => {
    const el = html(<PropRow name="tags" edge={<i data-x="rest" />} actions={<b data-x="act" />} actionsPinned frame="quiet">v</PropRow>);
    expect(el.querySelector(".pv-prow-edge > .pv-prow-rest > [data-x=rest]")).not.toBeNull();
    expect(el.querySelector(".pv-prow-edge > .pv-prow-actions[data-pinned=true] > [data-x=act]")).not.toBeNull();
    expect(el.querySelector(".pv-prow-value [data-x]")).toBeNull();
    expect(el.getAttribute("data-frame")).toBe("quiet");
  });

  it("group head, action row and membership line are the same column, not layouts of their own", () => {
    const group = html(<PropGroupHead trailing={<span className="pv-chip">Nicht geprüft</span>}>Vertrauen</PropGroupHead>);
    expect(group.className).toBe("pv-prow-group");
    expect(group.querySelector(".pv-prow-group-trailing .pv-chip")!.textContent).toBe("Nicht geprüft");
    const action = html(<PropActionRow onClick={() => {}} testId="x">Eigenschaft hinzufügen</PropActionRow>);
    expect(action.tagName).toBe("BUTTON");
    expect(action.className).toContain("pv-prow-action");
    expect(action.className).toContain("pv-btn--ghost");
    const line = html(<PropLine trailing={<span>1 / 3</span>}>Tagebuch</PropLine>);
    expect(line.className).toBe("pv-prow-line");
    expect(line.querySelector(".pv-prow-line-trailing")!.textContent).toBe("1 / 3");
  });
});

describe("the row's stylesheet (ui.css)", () => {
  const ui = css("packages/ui/src/styles/ui.css");

  it("four fixed positions: the value takes what is left, everything else has its own width", () => {
    expect(rule(ui, ".pv-prow")).toMatch(/grid-template-columns:\s*var\(--prow-icon\) var\(--prow-name\) minmax\(0, 1fr\) var\(--prow-edge\)/);
  });

  it("below the compact step the name moves above the value — keyed to the column's step, for every row", () => {
    const at = ui.indexOf('[data-side-step="compact"] .pv-prow,');
    expect(at).toBeGreaterThan(0);
    const block = ui.slice(at, ui.indexOf("}", at));
    expect(block).toContain('[data-side-step="minimal"] .pv-prow');
    expect(block).toMatch(/grid-template-columns:\s*var\(--prow-icon\) minmax\(0, 1fr\) var\(--prow-edge\)/);
  });

  it("the actions lay over the edge instead of taking room in the row", () => {
    expect(rule(ui, ".pv-prow-actions")).toMatch(/position:\s*absolute/);
    expect(rule(ui, ".pv-prow-edge")).toMatch(/width:\s*var\(--prow-edge\)/);
  });

  it("a chip's label is the part that gives way: it may shrink and draws the ellipsis", () => {
    // The rule used to be `.pv-chip > span`, which made the label an inline
    // flex container that could neither shrink nor draw an ellipsis.
    expect(ui).toContain(".pv-chip > span:not(.pv-chip-text),");
    expect(ui).not.toMatch(/\.pv-chip > span,/);
    const label = rule(ui, ".pv-chip-text");
    expect(label).toMatch(/min-width:\s*0/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/flex:\s*0 1 auto/);
  });

  it("the section head is a fixed grid with a count slot of its own", () => {
    const head = rule(ui, ".pv-side-section-header");
    expect(head).toMatch(/display:\s*grid/);
    expect(head).toMatch(/grid-template-columns:\s*var\(--pv-sec-glyph\) var\(--pv-sec-glyph\) minmax\(0, 1fr\) var\(--pv-sec-count\)/);
    // Head and body read the same inset.
    expect(head).toContain("var(--pv-side-pad)");
    expect(rule(ui, ".pv-side-section-body")).toContain("var(--pv-side-pad)");
  });

  it("LCARS and Win95 keep the grid: neither theme redefines the row's or the head's columns", () => {
    for (const theme of ["lcars", "win95"]) {
      const sheet = css(`packages/ui/src/themes/${theme}.css`);
      expect(sheet, theme).toContain(".pv-prow");
      const touched = [...sheet.matchAll(/\[data-theme-name="[a-z0-9]+"\] \.(pv-prow[\w-]*|pv-side-section-header)[^{]*\{([^}]*)\}/g)];
      expect(touched.length, theme).toBeGreaterThan(0);
      for (const [, selector, body] of touched) {
        expect(body, `${theme} .${selector}`).not.toMatch(/grid-template-columns|display\s*:/);
      }
    }
  });
});

describe("both section heads use the grid's markup", () => {
  it("title and count slot are their own elements on both sides of the window", () => {
    for (const file of ["RightSidebar.tsx", "LeftPinnedSections.tsx"]) {
      const source = readFileSync(join(HERE, "components", file), "utf8");
      expect(source, file).toContain('className="pv-side-section-title"');
      expect(source, file).toContain('className="pv-side-section-count"');
    }
  });
});

describe("propertyPanelModel — what the properties panel shows", () => {
  it("hides the plainva namespace, moves the provenance families to the trust group, pins the lifecycle rows", () => {
    const model = propertyPanelModel({
      type: "Note", tags: ["a"], status: "draft", stale_after: "2027-01-01",
      plainva: { icon: "x" }, generated: { by: "plainva-import/1", at: "2026-08-01T10:00:00Z" },
    });
    expect(model.genericKeys).toEqual(["type", "tags"]);
    expect(model.showStatusRow).toBe(true);
    expect(model.showStaleRow).toBe(true);
    expect(model.userKeys).toEqual(["type", "tags", "status", "stale_after", "generated"]);
    // type, tags + the two pinned rows.
    expect(model.shownCount).toBe(4);
  });

  it("a foreign status (a task database's word) and a malformed stale_after stay ordinary rows", () => {
    const model = propertyPanelModel({ status: "Offen", stale_after: "bald" });
    expect(model.showStatusRow).toBe(false);
    expect(model.showStaleRow).toBe(false);
    expect(model.genericKeys).toEqual(["status", "stale_after"]);
    expect(model.shownCount).toBe(2);
  });

  it("a provenance key that does not carry the spec shape is an ordinary row", () => {
    expect(propertyPanelModel({ sources: "irgendwas" }).genericKeys).toEqual(["sources"]);
  });

  it("is total: no frontmatter is no rows of the user's, only the pinned ones", () => {
    for (const nothing of [null, undefined, {}]) {
      const model = propertyPanelModel(nothing as never);
      expect(model.userKeys).toEqual([]);
      expect(model.shownCount).toBe(2);
    }
  });

  it("one rule for the hidden namespace on both shells", () => {
    expect(isHiddenPropertyKey("plainva")).toBe(true);
    expect(isHiddenPropertyKey("plainva.icon")).toBe(true);
    expect(isHiddenPropertyKey("plainva:icon")).toBe(true);
    expect(isHiddenPropertyKey("plainvanilla")).toBe(false);
  });
});

describe("the section head counts what the section shows", () => {
  const note = (frontmatter: string[]) => ["---", ...frontmatter, "---", "", "# T", ""].join("\n");

  it("counts rows, not keys: hidden keys are out, the pinned rows are in", () => {
    // Five keys. Shown: type, tags, the status row, the stale-after row.
    const counts = propertySectionCounts(note(["type: Note", "tags: [a]", "status: draft", "plainva:", "  icon: x", "generated:", "  by: x/1", "  at: 2026-08-01T10:00:00Z"]));
    expect(counts.shown).toBe(4);
    expect(counts.present).toBe(4);
  });

  it("a note without frontmatter of the user's keeps no section", () => {
    expect(propertySectionCounts("# Nur Text\n")).toEqual({ present: 0, shown: 0 });
    expect(propertySectionCounts(note(["plainva:", "  icon: x"])).present).toBe(0);
    expect(propertySectionCounts("---\n: : :\n---\n")).toEqual({ present: 0, shown: 0 });
    // A block without entries has none — and the text behind it is not read
    // for some, up to whatever rule it contains.
    expect(propertySectionCounts("---\n---\n# Nur Text\n")).toEqual({ present: 0, shown: 0 });
    expect(propertySectionCounts("---\n---\nstatus: draft\n\n---\n")).toEqual({ present: 0, shown: 0 });
  });

  it("a note that carries only a lifecycle key still has its section", () => {
    expect(propertySectionCounts(note(["status: draft"])).present).toBe(1);
  });
});

describe("computed columns of a database", () => {
  it("classifies by one question: does the note carry the value itself?", () => {
    expect(computedFieldKind("status", { input: "select" } as never)).toBeNull();
    expect(computedFieldKind("offen", { rollup: { fn: "countWhere" } })).toBe("rollup");
    expect(computedFieldKind("projekte", { reverseOf: { property: "kunde" } })).toBe("reverse");
    expect(computedFieldKind("file.mtime", undefined)).toBe("file");
    expect(computedFieldKind("file.day", undefined)).toBe("file");
    expect(computedFieldKind("formula.summe", undefined)).toBe("formula");
    expect(computedFieldKind("unbekannt", undefined)).toBeNull();
  });

  it("the note's own name and place are not a field: the note shows them itself", () => {
    for (const column of ["file.name", "file.path", "file.folder", "file.ext"]) {
      expect(computedFieldKind(column, undefined), column).toBeNull();
      expect(isPropertyColumn(column, undefined), column).toBe(false);
    }
    expect(isPropertyColumn("status", undefined)).toBe(true);
    expect(isPropertyColumn("offen", { rollup: { fn: "count" } })).toBe(false);
  });

  it("writes a value the way the table would", () => {
    const field = (over: Partial<NoteComputedField>): NoteComputedField => ({ column: "x", kind: "rollup", value: 1, ...over });
    expect(computedFieldText(field({ value: 75, rollupFn: "percentWhere" }), "de")).toBe("75 %");
    expect(computedFieldText(field({ value: "2026-09-24", rollupFn: "latest" }), "de")).toMatch(/24\. September 2026/);
    expect(computedFieldText(field({ value: 3 }), "de")).toBe("3");
    expect(computedFieldText(field({ kind: "file", column: "file.size", value: 1536 }), "de")).toBe("1.5 KB");
    expect(computedFieldText(field({ kind: "file", column: "file.day", value: "2026-09-24" }), "en")).toMatch(/September 24, 2026/);
    expect(computedFieldText(field({ kind: "reverse", value: ["[[Alpha]]", "[[Ordner/Beta|Beta]]"] }), "de")).toBe("Alpha, Beta");
    expect(computedFieldText(field({ kind: "reverse", value: [] }), "de")).toBe("");
    expect(formatByteSize(12)).toBe("12 B");
  });

  it("leaves out a formula that has no value — Plainva does not evaluate Obsidian formulas", () => {
    const fields: NoteComputedField[] = [
      { column: "formula.a", kind: "formula", value: undefined },
      { column: "formula.b", kind: "formula", value: 5 },
      { column: "offen", kind: "rollup", value: "" },
    ];
    expect(shownComputedFields(fields).map((f) => f.column)).toEqual(["formula.b", "offen"]);
  });
});

describe("useKeptResolution — never forget, then look up", () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function harness() {
    const seen: Array<string | null> = [];
    const waiting: Array<(value: { name: string } | null) => void> = [];
    const resolve = vi.fn((_key: string) => new Promise<{ name: string } | null>((done) => { waiting.push(done); }));
    const memory = new Map<string, { name: string } | null>();
    function Probe({ id, version }: { id: string | null; version: number }) {
      const value = useKeptResolution(id, version, resolve, memory);
      seen.push(value ? value.name : null);
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = async (id: string | null, version: number) => { await act(async () => { root.render(<Probe id={id} version={version} />); }); };
    const answer = async (value: { name: string } | null) => { await act(async () => { waiting.shift()!(value); await Promise.resolve(); }); };
    return { seen, resolve, memory, render, answer, unmount: () => act(() => root.unmount()) };
  }

  it("keeps the last answer while the next lookup runs, and replaces it only by a different one", async () => {
    const h = harness();
    await h.render("a", 0);
    await h.answer({ name: "Liste" });
    expect(h.seen.slice(-1)[0]).toBe("Liste");

    const before = h.seen.length;
    for (let version = 1; version <= 20; version++) {
      await h.render("a", version);
      await h.answer({ name: "Liste" });
    }
    // Twenty lookups ran, and not one render in between saw "nothing".
    expect(h.resolve).toHaveBeenCalledTimes(21);
    expect(new Set(h.seen.slice(before))).toEqual(new Set(["Liste"]));

    await h.render("a", 21);
    expect(h.seen.slice(-1)[0]).toBe("Liste");
    await h.answer({ name: "Tabelle" });
    expect(h.seen.slice(-1)[0]).toBe("Tabelle");
    h.unmount();
  });

  it("another key never shows the old key's answer; a remembered one applies at once", async () => {
    const h = harness();
    await h.render("a", 0);
    await h.answer({ name: "A" });
    await h.render("b", 0);
    expect(h.seen.slice(-1)[0]).toBeNull();
    await h.answer({ name: "B" });
    expect(h.seen.slice(-1)[0]).toBe("B");
    await h.render("a", 0);
    // Remembered from the first visit, before the new lookup answers.
    expect(h.seen.slice(-1)[0]).toBe("A");
    await h.answer({ name: "A" });
    h.unmount();
  });

  it("a failed lookup is not an answer: what stood there keeps standing", async () => {
    const seen: Array<string | null> = [];
    let fail = false;
    const resolve = async () => { if (fail) throw new Error("index busy"); return { name: "Liste" }; };
    function Probe({ version }: { version: number }) {
      const value = useKeptResolution("a", version, resolve);
      seen.push(value ? value.name : null);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(<Probe version={0} />); });
    await act(async () => { await Promise.resolve(); });
    expect(seen.slice(-1)[0]).toBe("Liste");
    fail = true;
    await act(async () => { root.render(<Probe version={1} />); });
    await act(async () => { await Promise.resolve(); });
    expect(seen.slice(-1)[0]).toBe("Liste");
    act(() => root.unmount());
  });

  it("an answer for a key the component has left is dropped", async () => {
    const h = harness();
    await h.render("a", 0);
    await h.render("b", 0);
    await h.answer({ name: "A-late" });
    expect(h.seen.slice(-1)[0]).toBeNull();
    await h.answer({ name: "B" });
    expect(h.seen.slice(-1)[0]).toBe("B");
    h.unmount();
  });
});
