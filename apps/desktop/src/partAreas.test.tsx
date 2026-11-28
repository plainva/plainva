// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, Suspense, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AreaBoundary, PART_LOAD_TIMEOUT_MS, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { deferredPart } from "./lib/deferredParts";

/**
 * A part's load failure does not change a surface that has a boundary of its own (review of B1b, round 2): below an
 * `AreaBoundary` the failure goes to that boundary, with its size and way out — as on `main`, where the bare
 * `React.lazy` threw to it. A dialog closes with Escape and opens anew, a quiet host only toasts, a tab offers its
 * way out.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
const dialogShown = () => !!document.querySelector("[data-testid=area-fallback-dialog]");
const refused = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/SettingsModal-x.js"));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const host = { reopen: () => undefined as void, open: false };
const reopen = () => host.reopen();
const isOpen = () => host.open;
function DialogHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    host.reopen = () => setOpen(true);
    host.open = open;
  }, [open]);
  return (
    <div>
      <p data-testid="shell">shell</p>
      <Suspense fallback={null}>
        {open && (
          <AreaBoundary area="dialog:test" size="dialog" exit={{ label: "Close", onExit: () => setOpen(false) }}>
            {children}
          </AreaBoundary>
        )}
      </Suspense>
    </div>
  );
}

function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return { root, render: () => act(async () => root.render(node)) };
}

describe("a dialog part whose load fails", () => {
  it("draws as the dialog's boundary; Escape closes it, and opened anew it loads again", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Shown = () => <p data-testid="settings">settings</p>;
    let calls = 0;
    const Dialog = deferredPart<object>(() => (++calls === 1 ? refused() : Promise.resolve(Shown)));
    const view = mount(<DialogHost><Dialog /></DialogHost>);
    await view.render();
    await act(tick);
    expect(dialogShown()).toBe(true);
    expect(document.body.textContent).toContain(i18n.t("errors.partLoadTitle"));
    await act(async () => {
      escape();
      await tick();
    });
    expect(isOpen()).toBe(false);
    await act(async () => {
      reopen();
      await tick();
    });
    expect(calls).toBe(2);
    expect(document.querySelector("[data-testid=settings]")).not.toBeNull();
    quiet.mockRestore();
    act(() => view.root.unmount());
  });

  it("a load that hangs ends as the dialog's boundary after the part load's end, and Escape closes it", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Dialog = deferredPart<object>(() => new Promise(() => undefined));
    const view = mount(<DialogHost><Dialog /></DialogHost>);
    await view.render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS + 50);
    });
    expect(dialogShown()).toBe(true);
    await act(async () => {
      escape();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(isOpen()).toBe(false);
    quiet.mockRestore();
    act(() => view.root.unmount());
  });

  it("failing twice, the second failure is the dialog's 'failed again', and Escape still closes it", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const Dialog = deferredPart<object>(() => {
      calls++;
      return refused();
    });
    const view = mount(<DialogHost><Dialog /></DialogHost>);
    await view.render();
    await act(tick);
    const reload = document.querySelector<HTMLButtonElement>("[data-testid=area-fallback-reload]");
    expect(reload).not.toBeNull();
    await act(async () => {
      reload!.click();
      await tick();
    });
    expect(calls).toBe(2);
    expect(document.querySelector("[data-testid=area-fallback]")?.getAttribute("data-failed-again")).toBe("true");
    await act(async () => {
      escape();
      await tick();
    });
    expect(isOpen()).toBe(false);
    quiet.mockRestore();
    act(() => view.root.unmount());
  });
});

describe("a quiet host whose part does not load", () => {
  it("draws nothing in the shell and says so once in a toast, as on main", async () => {
    expect.hasAssertions();
    const warning = vi.spyOn(toast, "warning");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Host = deferredPart<object>(refused);
    const view = mount(
      <div>
        <p data-testid="shell">shell</p>
        <AreaBoundary area="host:quietTest" size="quiet">
          <Suspense fallback={null}>
            <Host />
          </Suspense>
        </AreaBoundary>
      </div>,
    );
    await view.render();
    await act(tick);
    expect(document.querySelector("[data-testid=area-fallback]")).toBeNull();
    expect(warning).toHaveBeenCalledWith(i18n.t("errors.partLoadTitle"));
    warning.mockRestore();
    quiet.mockRestore();
    act(() => view.root.unmount());
  });
});

describe("a tab whose part does not load", () => {
  it("draws the tab's boundary with its way out", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const closed = vi.fn();
    const Tab = deferredPart<object>(refused);
    const view = mount(
      <AreaBoundary area="tab:test" size="pane" exit={{ label: "Close tab", onExit: closed }}>
        <Suspense fallback={null}>
          <Tab />
        </Suspense>
      </AreaBoundary>,
    );
    await view.render();
    await act(tick);
    const exit = document.querySelector<HTMLButtonElement>("[data-testid=area-fallback-exit]");
    expect(exit?.textContent).toBe("Close tab");
    act(() => exit!.click());
    expect(closed).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
    act(() => view.root.unmount());
  });
});
