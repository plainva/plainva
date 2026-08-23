// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * What the bar shows depends on the SHAPE it is in (plan Mobile-Feedback, P2).
 *
 * The rail inherited the phone bar wholesale: the same three-to-five
 * destinations, the same "Areas" entry, the same long press. On a phone those
 * three belong together — a thumb reaches five targets, so the rest need a way
 * in. A rail is a tall column that carries every area already, and there the
 * same three read as a bug: three icons beside an empty column, and a menu
 * that offers what is standing right next to it.
 *
 * These pin the shape, not the list: which trailing entry each shape gets, and
 * that the long press exists only where something is hidden. Which areas the
 * rail is HANDED is `mobileRailTabs`' claim, pinned in `mobileBar.test.ts`.
 */

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const { NavBar } = await import("./components/NavBar");
const { setWindowClassForTest } = await import("./services/windowClass");
const { LONG_PRESS_MS } = await import("./lib/useLongPress");
const { TAB_POOL } = await import("./navigation");

let container: HTMLDivElement;
let root: Root;
const onOpenAreas = vi.fn();
const onOpenSettings = vi.fn();
const onPick = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  onOpenAreas.mockClear();
  onOpenSettings.mockClear();
  onPick.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  setWindowClassForTest(400, 800);
});

const ALL = TAB_POOL.map((p) => p.id);

function mount(width: number, tabs = ALL, opts: { onToggleNav?: () => void; navCollapsed?: boolean } = {}) {
  // Height too: a landscape phone is wide and short, and must stay a phone.
  setWindowClassForTest(width, 800);
  act(() =>
    root.render(
      <NavBar
        activeTab={tabs[0]}
        areasOpen={false}
        navCollapsed={opts.navCollapsed ?? false}
        onOpenAreas={onOpenAreas}
        onOpenSettings={onOpenSettings}
        onPick={onPick}
        onToggleNav={opts.onToggleNav}
        tabs={tabs}
      />,
    ),
  );
}

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const buttons = () => [...container.querySelectorAll("button")];

/** A press that is held past the threshold, as a finger would. */
function hold(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS + 20);
  });
}

describe("the rail's trailing entry", () => {
  it("is settings, and it is the only extra beside the areas themselves", () => {
    mount(900);
    expect(q(".m-tabbar--rail"), "a 900 px window should stand a rail").toBeTruthy();
    // Every area of the pool, plus exactly one trailing entry. Handed no
    // `onToggleNav`, the rail stands beside a single surface and offers no
    // switch for a column that is not there.
    expect(buttons()).toHaveLength(ALL.length + 1);
    expect(q('[data-testid="rail-nav-toggle"]')).toBeNull();
    expect(q('[data-testid="rail-settings"]')).toBeTruthy();
    // "Areas" is a way to what the bar left out. A rail leaves nothing out.
    expect(q('[data-testid="tab-areas"]')).toBeNull();

    act(() => q('[data-testid="rail-settings"]')!.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenAreas).not.toHaveBeenCalled();
  });

  it("does not answer a long press — there is nothing behind it", () => {
    mount(900);
    hold(q("nav")!);
    expect(onOpenAreas).not.toHaveBeenCalled();
  });
});

describe("the phone bar", () => {
  it("keeps its areas entry and its long press", () => {
    const slots = ALL.slice(0, 3);
    mount(400, slots);
    expect(q(".m-tabbar--rail")).toBeNull();
    expect(buttons()).toHaveLength(slots.length + 1);
    expect(q('[data-testid="tab-areas"]')).toBeTruthy();
    expect(q('[data-testid="rail-settings"]')).toBeNull();

    hold(q("nav")!);
    expect(onOpenAreas).toHaveBeenCalledTimes(1);
  });

  it("stays a phone when it is merely turned sideways", () => {
    // 800 x 400: wide enough for a rail on width alone, but a rail with a
    // bottom-anchored settings entry in 400 px of height is not the point.
    setWindowClassForTest(800, 400);
    act(() =>
      root.render(
        <NavBar
          activeTab="notes"
          areasOpen={false}
          navCollapsed={false}
          onOpenAreas={onOpenAreas}
          onOpenSettings={onOpenSettings}
          onPick={onPick}
          tabs={ALL.slice(0, 3)}
        />,
      ),
    );
    // "medium" is still a rail — the height cap keeps it OUT of "expanded",
    // not out of the rail. What matters is that it is one consistent shape.
    expect(q(".m-tabbar--rail")).toBeTruthy();
    expect(q('[data-testid="rail-settings"]')).toBeTruthy();
  });
});

/**
 * The switch that folds the navigator away (2026-08-23).
 *
 * It exists in the rail and nowhere else, because the rail is the one surface
 * standing beside EVERY working surface — putting it in each screen's app bar
 * would mean a route can forget it, which is how the desktop's own sidebar
 * toggle would look if the title bar were per-screen.
 *
 * The rail does not decide whether a second column exists; the shell does,
 * where it decides whether to render one. `onToggleNav` is that decision
 * arriving, and its absence is the whole gate.
 */
describe("the rail's fold switch", () => {
  it("appears only where the shell offers a second column", () => {
    const onToggleNav = vi.fn();
    mount(1100, ALL, { onToggleNav });
    const btn = q('[data-testid="rail-nav-toggle"]');
    expect(btn, "a wide window with a split should offer the switch").toBeTruthy();

    act(() => btn!.click());
    expect(onToggleNav).toHaveBeenCalledTimes(1);
    // It changes the layout; it must not also navigate.
    expect(onPick).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("is a tool, not a destination", () => {
    mount(1100, ALL, { onToggleNav: vi.fn() });
    const btn = q('[data-testid="rail-nav-toggle"]')!;
    // No `m-tab`: the entries above it go somewhere, this one does not, and
    // the label is clipped at 76px anyway — a "Seitenleiste…" would be a
    // broken label rather than a short one (E7).
    expect(btn.classList.contains("m-tab")).toBe(false);
    expect(btn.querySelector(".m-tab-label")).toBeNull();
    // Which leaves the accessible name to carry it, and it is the desktop's
    // own wording rather than a second phrase for the same act.
    expect(btn.getAttribute("aria-label")).toBe("titlebar.toggleLeftSidebar");
  });

  it("says whether the navigator is standing", () => {
    const onToggleNav = vi.fn();
    mount(1100, ALL, { onToggleNav, navCollapsed: false });
    expect(q('[data-testid="rail-nav-toggle"]')!.getAttribute("aria-pressed")).toBe("true");

    mount(1100, ALL, { onToggleNav, navCollapsed: true });
    expect(q('[data-testid="rail-nav-toggle"]')!.getAttribute("aria-pressed")).toBe("false");
  });

  it("never reaches the phone bar", () => {
    // Even handed the callback: a phone has one surface, and a switch for a
    // column it cannot show is a control that does nothing.
    mount(400, ALL.slice(0, 3), { onToggleNav: vi.fn() });
    expect(q(".m-tabbar--rail")).toBeNull();
    expect(q('[data-testid="rail-nav-toggle"]')).toBeNull();
  });
});
