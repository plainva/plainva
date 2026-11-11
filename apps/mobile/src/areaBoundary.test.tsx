// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { clearDiagnosticsForTests, getDiagnostics } from "@plainva/ui";
import type { NavEntry, NavState } from "./navigation";
import type { RouteContext } from "./routes";

/**
 * A screen that fails takes its screen, never the app (stability plan
 * 2026-11-10, R3). The phone's one place where every screen mounts is the
 * work column of `AdaptiveLayout`; the route table is a stand-in here so a
 * screen can be made to fail, the layout around it is the real one.
 */

const failRoot = vi.hoisted(() => ({ on: false }));
vi.mock("./routes", () => ({
  renderRoute: (top: NavEntry | undefined) => {
    if (top?.kind === "base" || (!top && failRoot.on)) throw new Error("The view could not be drawn");
    return <p data-testid="screen">{top ? `${top.kind}:${top.path}` : "root"}</p>;
  },
  TAB_ROUTES: { notes: () => <p data-testid="navigator">navigator</p> },
}));
vi.mock("./components/BackNavigation", () => ({ BackNavigation: () => null }));
vi.mock("./services/besideNav", () => ({ besideContext: (ctx: RouteContext) => ctx }));

const { AdaptiveLayout } = await import("./components/AdaptiveLayout");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  clearDiagnosticsForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const nav = (stack: NavEntry[]): NavState => ({ activeTab: "notes", overlay: [], stacks: { notes: stack } } as unknown as NavState);
const q = (testId: string) => host.querySelector(`[data-testid="${testId}"]`);

describe("a phone screen that fails", () => {
  it("leaves the navigator beside it, says so, and its way back leaves the screen without asking", async () => {
    const done = vi.fn();
    const ctx = { done } as unknown as RouteContext;
    const top: NavEntry = { kind: "base", path: "Projects.base" } as NavEntry;
    await act(async () => root.render(<AdaptiveLayout activeTab="notes" ctx={ctx} nav={nav([top])} top={top} twoColumn />));
    expect(q("navigator")?.textContent).toBe("navigator");
    const fallback = q("area-fallback") as HTMLElement;
    expect(fallback.dataset.area).toBe("screen:base");
    expect(fallback.textContent).toContain("This area could not be shown");
    expect(getDiagnostics().map((e) => e.source)).toContain("area:screen:base");
    const back = q("area-fallback-exit") as HTMLElement;
    expect(back.textContent).toBe("Back");
    await act(async () => back.click());
    expect(done).toHaveBeenCalledWith(top);
  });

  it("is a failure of that screen only: the next screen on the stack draws", async () => {
    const ctx = { done: vi.fn() } as unknown as RouteContext;
    const failing: NavEntry = { kind: "base", path: "Projects.base" } as NavEntry;
    await act(async () => root.render(<AdaptiveLayout activeTab="notes" ctx={ctx} nav={nav([failing])} top={failing} twoColumn={false} />));
    expect(q("area-fallback")).not.toBeNull();
    const next: NavEntry = { kind: "note", path: "Welcome.md" } as NavEntry;
    await act(async () => root.render(<AdaptiveLayout activeTab="notes" ctx={ctx} nav={nav([next])} top={next} twoColumn={false} />));
    expect(q("area-fallback")).toBeNull();
    expect(q("screen")?.textContent).toBe("note:Welcome.md");
  });

  it("a tab root that fails offers no way back: the tab bar is the way out", async () => {
    failRoot.on = true;
    try {
      const ctx = { done: vi.fn() } as unknown as RouteContext;
      await act(async () => root.render(<AdaptiveLayout activeTab="notes" ctx={ctx} nav={nav([])} top={undefined} twoColumn={false} />));
      expect((q("area-fallback") as HTMLElement).dataset.area).toBe("screen:notes");
      expect(q("area-fallback-exit")).toBeNull();
      expect(q("area-fallback-reload")).not.toBeNull();
    } finally {
      failRoot.on = false;
    }
  });
});
