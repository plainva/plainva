// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { setAreaVisible, type AreaOrder } from "@plainva/ui";
import { AreasSheet } from "./components/AreasSheet";
import { SortSheet } from "./components/SortSheet";
import { NavBarScreen } from "./screens/NavBarScreen";

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
});

describe("one spelling for a choice", () => {
  /**
   * The surfaces converted to the shared row grammar. A hand-built choice list
   * is a dialect: the tick, the dot, the tinted row and the chip all meant
   * "chosen" on this phone, and each behaved differently.
   */
  const converted = ["components/SortSheet.tsx", "components/AreasSheet.tsx", "screens/NavBarScreen.tsx"];

  it.each(converted)("%s builds its choices from Row/RowList, not by hand", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).toContain("<RowList>");
    expect(src).not.toMatch(/className=\{?["'`][^"'`]*\bm-row\b/);
  });

  it.each(converted)("%s marks a choice with the app's slot mark, never a tick of its own", (rel) => {
    const src = readFileSync(join(SRC, rel), "utf8");
    expect(src).not.toMatch(/<Check\b/);
  });
});
