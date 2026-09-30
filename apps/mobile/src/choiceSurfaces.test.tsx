// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { Row, setAreaVisible, type AreaOrder } from "@plainva/ui";
import { AreasSheet } from "./components/AreasSheet";
import { CHOICE_BEAT_MS } from "./components/ChoiceMark";
import { MobileDialogHost } from "./components/MobileDialogHost";
import { SortSheet } from "./components/SortSheet";
import { NavBarScreen } from "./screens/NavBarScreen";
import { currentMobileDialog, mActions, mMultiSelect, mSelect, mTargets } from "./services/mobileDialogs";

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

// jsdom hands `import.meta.url` an http URL, so the source scan below takes
// the project root Vitest runs in.
const SRC = join(process.cwd(), "src");

/**
 * The phone's choice surfaces (finding 2026-09-22).
 *
 * Four spellings for "this one is chosen" lived side by side — a tick, a slot
 * mark, a tinted row, a chip — and the sheets behaved differently for reasons
 * the form did not show. These pin the shape, not the pixels: the mark the app
 * uses, the row that answers a tap, and the order the user actually arranged.
 *
 * And the correction of 2026-09-24 (E20, E21): only a CHOICE wears a mark —
 * round for one, square for several. A list of places (areas, views, vaults,
 * "move to") marks where you are with Row's `current`; a list of actions
 * ("insert", "open image") marks nothing. The 22.09. plan had filed the areas
 * sheet as a choice, and this file held that mistake in place.
 */
async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(node); });
  // Awaited: an act() that is not awaited leaves React's queue open, and the
  // NEXT render in the file then never flushes.
  return { host, cleanup: async () => { await act(async () => { root.unmount(); }); host.remove(); } };
}

const byTestId = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const ORDER: AreaOrder = { order: ["notes", "today", "tasks", "calendar", "journal", "graph", "comments", "mail"], visibleCount: 4 };

describe("bars and areas: the row answers (issue #104)", () => {
  it("toggles an area from the row itself and from its eye", async () => {
    const onChange = vi.fn();
    const { host, cleanup } = await mount(<NavBarScreen value={ORDER} onChange={onChange} onBack={vi.fn()} />);
    try {
      // Every handler used to sit on the 24-px grip, so the card answered
      // neither tapping nor dragging on a phone.
      const row = host.querySelector<HTMLElement>('[data-tab-row][data-tab-visible]');
      expect(row).not.toBeNull();
      const eye = byTestId(host, "navbar-eye-journal");
      expect(eye).not.toBeNull();
      await act(async () => { eye!.click(); });
      expect(onChange).toHaveBeenCalledWith(setAreaVisible(ORDER, "journal", true, { known: ORDER.order, alwaysVisible: ["notes"], minVisible: 2, maxVisible: 4, defaultVisibleCount: 4 }));

      onChange.mockClear();
      const tasksRow = host.querySelector<HTMLElement>('[data-tab-row]:nth-of-type(3)') ?? byTestId(host, "navbar-eye-tasks")!.closest("[data-tab-row]") as HTMLElement;
      await act(async () => { tasksRow.click(); });
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("never offers to hide the one area that is the way back", async () => {
    const { host, cleanup } = await mount(<NavBarScreen value={ORDER} onChange={vi.fn()} onBack={vi.fn()} />);
    try {
      expect(byTestId(host, "navbar-eye-notes")).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe("areas sheet: a list of places, not a choice (finding 2026-09-24, E20)", () => {
  it("marks the area on screen as current — tint, check, aria-current — and wears no ring", async () => {
    const { host, cleanup } = await mount(
      <AreasSheet active="tasks" order={ORDER} onPick={vi.fn()} onArrange={vi.fn()} onClose={vi.fn()} />,
    );
    try {
      const current = byTestId(host, "areas-tasks")!;
      expect(current.getAttribute("aria-current")).toBe("page");
      expect(current.classList.contains("pv-grouprow--current")).toBe(true);
      expect(current.querySelector(".pv-grouprow-check svg")).not.toBeNull();
      // Exactly one row is where you are; the others carry nothing — the old
      // sheet had four empty rings under "not in the bar".
      expect(host.querySelectorAll("[aria-current]")).toHaveLength(1);
      expect(host.querySelectorAll(".pv-grouprow-check")).toHaveLength(1);
      expect(host.querySelector(".m-slotmark")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("carries a sheet title and a divider instead of a heading that names itself", async () => {
    const { host, cleanup } = await mount(
      <AreasSheet active="notes" order={ORDER} onPick={vi.fn()} onArrange={vi.fn()} onClose={vi.fn()} />,
    );
    try {
      expect(host.querySelector(".m-sheet-title")?.textContent).toBe("mobile.areas");
      expect(host.querySelector(".m-sheet-divider")?.textContent).toBe("mobile.areasOutside");
      // "Not in the bar — reachable via Areas", written inside Areas.
      expect(host.textContent).not.toContain("mobile.navBarOutside");
    } finally {
      await cleanup();
    }
  });
});

describe("areas sheet: the user's own arrangement (E10)", () => {
  it("lists the bar's areas first, then the rest, in the stored order", async () => {
    const arranged: AreaOrder = { order: ["notes", "journal", "tasks", "calendar", "today", "graph", "comments", "mail"], visibleCount: 4 };
    const { host, cleanup } = await mount(
      <AreasSheet active="notes" order={arranged} onPick={vi.fn()} onArrange={vi.fn()} onClose={vi.fn()} />,
    );
    try {
      const ids = [...host.querySelectorAll<HTMLElement>('[data-testid^="areas-"]')]
        .map((el) => el.getAttribute("data-testid")!.replace("areas-", ""))
        .filter((id) => id !== "arrange" && id !== "sheet");
      // It used to show the factory pool, so the same eight areas had two
      // orders — the one in the bar and the one here.
      expect(ids).toEqual(arranged.order);
      expect(ids.slice(0, 4)).toEqual(["notes", "journal", "tasks", "calendar"]);
    } finally {
      await cleanup();
    }
  });
});

describe("sort sheet: a choice plus a direction (E11)", () => {
  it("marks the active key the way every other single choice does, and holds until Done", async () => {
    const onClose = vi.fn();
    const onChoose = vi.fn();
    const { host, cleanup } = await mount(
      <SortSheet
        testId="probe-sort"
        title="Sort by"
        options={[{ key: "title", label: "Name" }, { key: "modified", label: "Changed" }]}
        active="modified"
        direction="Descending"
        ascending={false}
        onChoose={onChoose}
        onClose={onClose}
      />,
    );
    try {
      expect(byTestId(host, "probe-sort-modified")!.querySelector(".m-slotmark.is-on")).not.toBeNull();
      expect(byTestId(host, "probe-sort-title")!.querySelector(".m-slotmark.is-on")).toBeNull();
      await act(async () => { byTestId(host, "probe-sort-modified")!.click(); });
      expect(onChoose).toHaveBeenCalledWith("modified");
      // Flipping the direction is a second decision, so the sheet stays.
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => { byTestId(host, "probe-sort-done")!.click(); });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      await cleanup();
    }
  });

  it("is titled like every sheet, says what the second tap does and closes with Done (E21)", async () => {
    const probe = (direction?: string) => (
      <SortSheet
        testId="probe-sort"
        title="Sort by"
        options={[{ key: "relevance", label: "Relevance" }, { key: "title", label: "Name" }]}
        active={direction ? "title" : "relevance"}
        direction={direction}
        ascending
        onChoose={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const withDirection = await mount(probe("Ascending"));
    try {
      const { host } = withDirection;
      // The 22.09. mockup's case c: the sheet's own title, the card, one line
      // under it, and "Done" — not the generic "OK".
      expect(host.querySelector(".m-sheet-title")?.textContent).toBe("Sort by");
      expect(byTestId(host, "probe-sort-hint")?.textContent).toBe("browse.sortFlipHint");
      expect(byTestId(host, "probe-sort-done")?.textContent).toBe("common.done");
    } finally {
      await withDirection.cleanup();
    }
    // A key without a direction (relevance) has nothing to turn around.
    const without = await mount(probe(undefined));
    try {
      expect(byTestId(without.host, "probe-sort-hint")).toBeNull();
    } finally {
      await without.cleanup();
    }
  });
});

describe("the Row's current state (E20)", () => {
  it("is the tint, the check and aria-current — the one spelling of 'where you are'", async () => {
    const { host, cleanup } = await mount(
      <>
        <Row current title="Here" />
        <Row current aria-current="step" title="Step" />
        <Row title="Elsewhere" onClick={() => {}} />
      </>,
    );
    try {
      const [here, step, other] = [...host.querySelectorAll<HTMLElement>(".pv-grouprow")];
      expect(here.getAttribute("aria-current")).toBe("page");
      expect(here.querySelector(".pv-grouprow-check")).not.toBeNull();
      // A caller with a narrower meaning keeps it.
      expect(step.getAttribute("aria-current")).toBe("step");
      expect(other.hasAttribute("aria-current")).toBe(false);
      expect(other.querySelector(".pv-grouprow-check")).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe("the dialog sheet speaks three kinds of list (E20, E21)", () => {
  const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];
  const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".pv-grouprow")];

  afterEach(() => {
    vi.useRealTimers();
    expect(currentMobileDialog(), "a test left a dialog open").toBeNull();
  });

  it("a single choice moves its ring first and closes after the beat", async () => {
    vi.useFakeTimers();
    const { host, cleanup } = await mount(<MobileDialogHost />);
    try {
      let answer: string | null | undefined;
      await act(async () => { void mSelect({ title: "Pick", options: OPTIONS, value: "a" }).then((v) => { answer = v; }); });
      expect(rows(host)[0].querySelector(".m-slotmark.is-on")).not.toBeNull();
      await act(async () => { rows(host)[2].click(); });
      // The mark has moved, the sheet is still there: one sees what one picked.
      expect(rows(host)[2].querySelector(".m-slotmark.is-on")).not.toBeNull();
      expect(rows(host)[0].querySelector(".m-slotmark.is-on")).toBeNull();
      expect(answer).toBeUndefined();
      // A second tap in the beat changes nothing — the first one decided.
      await act(async () => { rows(host)[1].click(); });
      await act(async () => { vi.advanceTimersByTime(CHOICE_BEAT_MS); });
      expect(answer).toBe("c");
      expect(host.querySelector(".m-sheet")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("a multiple choice wears squares and holds until Done", async () => {
    const { host, cleanup } = await mount(<MobileDialogHost />);
    try {
      let answer: string[] | null | undefined;
      await act(async () => { void mMultiSelect({ title: "Several", options: OPTIONS, values: ["a"] }).then((v) => { answer = v; }); });
      expect(host.querySelectorAll(".m-slotmark--box")).toHaveLength(3);
      await act(async () => { rows(host)[1].click(); });
      expect(answer).toBeUndefined();
      const done = [...host.querySelectorAll("button")].find((b) => b.textContent === "common.done")!;
      expect(done).toBeTruthy();
      await act(async () => { done.click(); });
      expect(answer).toEqual(["a", "b"]);
    } finally {
      await cleanup();
    }
  });

  it("a target list marks where you are and where the object already lies — and no ring anywhere", async () => {
    const { host, cleanup } = await mount(<MobileDialogHost />);
    try {
      let answer: string | null | undefined;
      await act(async () => { void mTargets({ title: "Move to", options: OPTIONS, current: "b", here: "c" }).then((v) => { answer = v; }); });
      expect(host.querySelector(".m-slotmark")).toBeNull();
      const [alpha, beta, gamma] = rows(host);
      expect(beta.getAttribute("aria-current")).toBe("page");
      expect(alpha.hasAttribute("aria-current")).toBe(false);
      // Its own folder: listed, says "here", cannot be chosen.
      expect(gamma.textContent).toContain("common.here");
      expect((gamma as HTMLButtonElement).disabled).toBe(true);
      await act(async () => { gamma.click(); });
      expect(answer).toBeUndefined();
      // A target closes on the tap: nothing was set that one would need to see.
      await act(async () => { alpha.click(); });
      expect(answer).toBe("a");
    } finally {
      await cleanup();
    }
  });

  it("an action list preselects nothing and tints nothing", async () => {
    const { host, cleanup } = await mount(<MobileDialogHost />);
    try {
      let answer: string | null | undefined;
      const withIcons = OPTIONS.map((o) => ({ ...o, icon: <svg data-icon={o.value} /> }));
      await act(async () => { void mActions({ title: "Insert", options: withIcons }).then((v) => { answer = v; }); });
      expect(host.querySelector(".m-slotmark")).toBeNull();
      expect(host.querySelector("[aria-current]")).toBeNull();
      expect(host.querySelector(".pv-grouprow--current")).toBeNull();
      // An action wears its own sign in the leading slot (the mockup's camera,
      // library, file) — the slot a choice gives to its mark.
      expect(rows(host)[0].querySelector('.pv-grouprow-icon [data-icon="a"]')).not.toBeNull();
      await act(async () => { rows(host)[0].click(); });
      expect(answer).toBe("a");
    } finally {
      await cleanup();
    }
  });
});

/** Every non-test source file of the shell, relative to src/. */
function sources(): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push([p.slice(SRC.length + 1).replace(/\\/g, "/"), readFileSync(p, "utf8")] as const);
    }
  };
  walk(SRC);
  return out;
}

interface ListCall { file: string; fn: string; title: string; props: Set<string> }

/** Every call of the three list dialogs, with its title key and the options it passes. */
function listCalls(): ListCall[] {
  const calls: ListCall[] = [];
  for (const [file, src] of sources()) {
    if (!/\bm(Select|Targets|Actions)\(/.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["mSelect", "mTargets", "mActions"].includes(node.expression.text)) {
        const arg = node.arguments[0];
        const props = new Set<string>();
        let title = "";
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties) {
            const name = p.name?.getText(sf) ?? "";
            props.add(name);
            if (name === "title" && ts.isPropertyAssignment(p)) {
              const text = p.initializer.getText(sf);
              title = /^t\("([^"]+)"/.exec(text)?.[1] ?? text;
            }
          }
        }
        calls.push({ file, fn: node.expression.text, title, props });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return calls;
}

describe("one row grammar for the sheets of 2026-09-22", () => {
  /**
   * The surfaces converted to the shared row grammar. A hand-built list is a
   * dialect: the tick, the dot, the tinted row and the chip all meant "chosen"
   * on this phone, and each behaved differently. The areas sheet stays in this
   * list for its ROWS — what marks its current row is the target rule below
   * (E20), no longer the choice mark this block used to demand of it.
   */
  const converted = ["components/SortSheet.tsx", "components/AreasSheet.tsx", "screens/NavBarScreen.tsx"];

  it.each(converted)("%s builds its rows from Row/RowList, not by hand", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).toContain("<RowList>");
    expect(src).not.toMatch(/className=\{?["'`][^"'`]*\bm-row\b/);
  });

  it.each(converted)("%s draws no tick of its own — the shared Row draws the one of a current place", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).not.toMatch(/<Check\b/);
  });

  /** The choice surfaces among them: their chosen row wears the ChoiceMark. */
  const choices = ["components/SortSheet.tsx", "components/MobileDialogHost.tsx"];

  it.each(choices)("%s marks a choice with ChoiceMark", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).toMatch(/<ChoiceMark\b/);
  });
});

describe("one spelling for a choice", () => {
  it("spells the mark of a choice in ONE place", () => {
    // Round for one, square for several (E21): a file that writes the class by
    // hand can pick the wrong one — a multiple choice wore the ring, and a
    // relation that takes one note wore a tick.
    const offenders = sources()
      .filter(([file, src]) => file !== "components/ChoiceMark.tsx" && src.includes("m-slotmark"))
      .map(([file]) => file);
    expect(offenders, `use <ChoiceMark>: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("a place to go carries no mark (E20)", () => {
  /** Lists of places the user GOES to. They wear Row's `current`, never a mark. */
  const navigation = ["components/AreasSheet.tsx", "screens/VaultsScreen.tsx"];

  it.each(navigation)("%s shows where you are with current, not with a mark", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).toMatch(/\bcurrent=\{/);
    expect(src).not.toMatch(/m-slotmark|<ChoiceMark\b|<Check\b/);
  });

  it("the view list of the configure sheet is a target list", () => {
    const src = readFileSync(join(SRC, "screens/base/BaseConfigSheet.tsx"), "utf8");
    const at = src.indexOf('activeArea === "views" && (');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("activeArea ===", at + 30));
    expect(block).toMatch(/\bcurrent=\{i === viewIndex\}/);
    expect(block).not.toMatch(/m-slotmark|<ChoiceMark\b/);
  });

  it("the search sort sheet holds until Done (E21)", () => {
    // It closed on every tap — against SortSheet's own contract.
    const src = readFileSync(join(SRC, "screens/SearchScreen.tsx"), "utf8");
    const at = src.indexOf("const chooseSort");
    expect(src.slice(at, src.indexOf("};", at))).not.toContain("setSortSheet(false)");
  });

  it("backlinks are ordered in the sort sheet, not with chips (E21)", () => {
    const src = readFileSync(join(SRC, "components/NoteContextSheet.tsx"), "utf8");
    expect(src).toContain('testId="backlinks-sort-sheet"');
    expect(src).not.toMatch(/<Chip\b[^>]*chooseBacklinkSort/);
  });
});

describe("every list sheet says which kind it is (E20)", () => {
  const calls = listCalls();

  /** The kind a surface must use, by its title key. */
  const KIND: Array<[file: string, title: string, fn: string]> = [
    ["screens/base/BaseScreen.tsx", "database.views", "mTargets"],
    ["screens/MailListScreen.tsx", "mail.moveTo", "mTargets"],
    ["EditorHost.tsx", "mobile.insertSource", "mActions"],
    ["EditorHost.tsx", "contextMenu.openImage", "mActions"],
    // The fork at the start of "new vault" — the borderline case of the plan:
    // nothing is in force before the answer, and the desktop shows the same
    // answers as cards to click.
    ["services/vaultService.ts", "mobile.vaultCreate", "mActions"],
    ["App.tsx", "mobile.onboardingCloud", "mActions"],
    ["App.tsx", "mobile.templatePick", "mActions"],
  ];

  it.each(KIND)("%s: %s is %s", (file, title, fn) => {
    const hits = calls.filter((c) => c.file === file && c.title === title);
    expect(hits.length, `no call titled ${title} in ${file}`).toBeGreaterThan(0);
    expect(hits.map((c) => c.fn)).toEqual(hits.map(() => fn));
  });

  it("moving a mail lists its own folder as 'here' instead of dropping it", () => {
    const moves = calls.filter((c) => c.file === "screens/MailListScreen.tsx" && c.title === "mail.moveTo");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((c) => c.props.has("here"))).toBe(true);
  });

  it("the database views beyond the strip know which one is shown", () => {
    const views = calls.filter((c) => c.title === "database.views");
    expect(views.length).toBeGreaterThan(0);
    expect(views.every((c) => c.props.has("current"))).toBe(true);
  });

  /**
   * A single choice without `value` is a list of empty rings. Each one left
   * says why no single value is in force; everything else is a target, an
   * action, or a choice that now shows its value.
   */
  const NO_VALUE: Record<string, string> = {
    "screens/base/BaseScreen.tsx|columnLabel(col)":
      "bulk edit of several rows: they may disagree, so no one value is in force; the column pick before it says 'mixed'",
  };

  it("every mSelect without a value carries its reason", () => {
    const unvalued = calls.filter((c) => c.fn === "mSelect" && !c.props.has("value")).map((c) => `${c.file}|${c.title}`);
    const unexplained = unvalued.filter((key) => !NO_VALUE[key]);
    expect(unexplained, "a choice shows its value, or it is mTargets/mActions — or it gets a reason here").toEqual([]);
    const stale = Object.keys(NO_VALUE).filter((key) => !unvalued.includes(key));
    expect(stale, "remove stale entries").toEqual([]);
  });
});
