// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AreaBoundary, areaCrashSeam, clearDiagnosticsForTests, describeAreaError, FloatingWindow, getDiagnostics, Modal, toast, toastStore } from "@plainva/ui";

/**
 * The one error boundary of both shells (stability plan 2026-11-10, R3).
 *
 * Before it, a render error anywhere took the whole window: the only
 * boundaries sat around the app in `main.tsx`. These tests hold what the
 * building block promises every area it wraps.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeAll(async () => { await i18n.changeLanguage("en"); });
beforeEach(() => {
  clearDiagnosticsForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // React reports a caught render error on the console as well; the tests read the diagnostics instead.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  areaCrashSeam?.clear();
  vi.restoreAllMocks();
});

const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const q = (testId: string) => document.querySelector(`[data-testid="${testId}"]`);
const click = async (testId: string) => {
  const el = q(testId) as HTMLElement | null;
  expect(el, `${testId} is there`).not.toBeNull();
  await act(async () => el!.click());
};

/** Fails while `broken.on` is set; counts its mounts. */
const broken = { on: true, mounts: 0 };
function Fragile({ secret = "Dear diary, line two" }: { secret?: string }) {
  const [mountId] = useState(() => ++broken.mounts);
  if (broken.on) throw new Error(`Cannot read the view\n${secret}`);
  return <p data-testid="fragile-ok">mounted {mountId}</p>;
}
beforeEach(() => { broken.on = true; broken.mounts = 0; });

describe("AreaBoundary", () => {
  it("keeps the failure in its area: the neighbour stays, the fallback says so and offers reload and the way out", async () => {
    const onExit = vi.fn();
    await render(
      <>
        <p data-testid="neighbour">still here</p>
        <AreaBoundary area="tab:base" exit={{ label: "Close tab", onExit }}><Fragile /></AreaBoundary>
      </>,
    );
    expect(q("neighbour")?.textContent).toBe("still here");
    const fallback = q("area-fallback") as HTMLElement;
    expect(fallback.getAttribute("role")).toBe("alert");
    expect(fallback.dataset.area).toBe("tab:base");
    expect(fallback.textContent).toContain("This area could not be shown");
    expect(fallback.textContent).toContain("About & diagnostics");
    expect(q("area-fallback-reload")?.textContent).toBe("Reload this area");
    await click("area-fallback-exit");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("writes the area, the error's kind and first line into the diagnostics — never the rest of the message", async () => {
    await render(<AreaBoundary area="mail:reader"><Fragile /></AreaBoundary>);
    const lines = getDiagnostics().filter((e) => e.source === "area:mail:reader");
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toMatch(/^Error: Cannot read the view \(in Fragile/);
    expect(lines[0].message).not.toContain("diary");
  });

  it("reloads the area as a new tree, which comes back once the cause is gone", async () => {
    await render(<AreaBoundary area="section:outline"><Fragile /></AreaBoundary>);
    const mountsBefore = broken.mounts;
    broken.on = false;
    await click("area-fallback-reload");
    expect(q("area-fallback")).toBeNull();
    expect(q("fragile-ok")?.textContent).toBe(`mounted ${mountsBefore + 1}`);
  });

  it("does not loop: a reload that fails again keeps the fallback, says so and offers no further reload", async () => {
    await render(<AreaBoundary area="tab:graph" exit={{ label: "Close tab", onExit: () => {} }}><Fragile /></AreaBoundary>);
    const mounts = broken.mounts;
    await click("area-fallback-reload");
    const fallback = q("area-fallback") as HTMLElement;
    expect(fallback.dataset.failedAgain).toBe("true");
    expect(fallback.textContent).toContain("It failed again after reloading");
    expect(q("area-fallback-reload")).toBeNull();
    expect(q("area-fallback-exit")).not.toBeNull();
    // One remount for the one reload, nothing on its own afterwards.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(broken.mounts - mounts).toBeLessThanOrEqual(2); // React may render a failing component twice
    expect(getDiagnostics().filter((e) => e.source === "area:tab:graph")).toHaveLength(1); // repeats collapse into one line
  });

  it("a new reset key lets a failed area try again, and does not remount a healthy one", async () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <button data-testid="counter" onClick={() => setN(n + 1)}>{n}</button>;
    }
    await render(<AreaBoundary area="section:backlinks" resetKey="A.md"><Counter /></AreaBoundary>);
    await click("counter");
    await render(<AreaBoundary area="section:backlinks" resetKey="B.md"><Counter /></AreaBoundary>);
    expect(q("counter")?.textContent).toBe("1");

    await render(<AreaBoundary area="section:backlinks" resetKey="A.md"><Fragile /></AreaBoundary>);
    expect(q("area-fallback")).not.toBeNull();
    broken.on = false;
    await render(<AreaBoundary area="section:backlinks" resetKey="B.md"><Fragile /></AreaBoundary>);
    expect(q("area-fallback")).toBeNull();
    expect(q("fragile-ok")).not.toBeNull();
  });

  it("catches what a parent builds inline when the area is passed as a function", async () => {
    const message = null as unknown as { subject: string };
    await render(
      <>
        <p data-testid="list">the list</p>
        <AreaBoundary area="mail:reader">{() => <h3>{message.subject}</h3>}</AreaBoundary>
      </>,
    );
    expect(q("list")).not.toBeNull();
    expect((q("area-fallback") as HTMLElement).dataset.area).toBe("mail:reader");
  });

  it("stands in for a failed dialog as a dialog: its X takes the way out", async () => {
    const onExit = vi.fn();
    await render(<AreaBoundary area="dialog:import" exit={{ label: "Close", onExit }} size="dialog"><Fragile /></AreaBoundary>);
    const dialog = q("area-fallback-dialog") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.textContent).toContain("This area could not be shown");
    await act(async () => (dialog.querySelector(".pv-modal-header button") as HTMLElement).click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("a host dialog without a way out closes by remounting, and stays away once that failed again", async () => {
    await render(<AreaBoundary area="dialog:cascadeDelete" size="dialog"><Fragile /></AreaBoundary>);
    const closeX = () => (q("area-fallback-dialog")!.querySelector(".pv-modal-header button") as HTMLElement);
    await act(async () => closeX().click());
    expect(q("area-fallback-dialog")).not.toBeNull(); // remounted, failed again
    expect(q("area-fallback")?.getAttribute("data-failed-again")).toBe("true");
    await act(async () => closeX().click());
    expect(q("area-fallback-dialog")).toBeNull();
  });

  it("a bar of the shell fails as one line that keeps the bar's height", async () => {
    await render(<AreaBoundary area="shell:statusbar" size="strip"><Fragile /></AreaBoundary>);
    const fallback = q("area-fallback") as HTMLElement;
    expect(fallback.className).toContain("pv-areafail--strip");
    expect(fallback.querySelector(".pv-empty")).toBeNull();
    expect(fallback.textContent).toBe("This area could not be shown");
    expect(q("area-fallback-reload")?.getAttribute("aria-label")).toBe("Reload this area");
    await click("area-fallback-reload");
    expect(q("area-fallback")?.textContent).toContain("It failed again after reloading");
  });

  it("a surface that appears on its own fails quietly: nothing drawn, one diagnostics line, one toast however often it mounts", async () => {
    for (const t of toastStore.get()) toast.dismiss(t.id);
    const before = toastStore.get().length;
    for (let i = 0; i < 3; i++) {
      // A selection toolbar mounts with every selection and goes with it.
      await render(<p data-testid="editor">text</p>);
      await render(<><p data-testid="editor">text</p><AreaBoundary area="test:quietToolbar" size="quiet"><Fragile /></AreaBoundary></>);
      expect(q("editor")).not.toBeNull();
      expect(q("area-fallback")).toBeNull();
      expect(q("area-fallback-dialog")).toBeNull();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      // Each failing mount writes its line once (a repeat right after the last collapses into it).
      const lines = getDiagnostics().filter((e) => e.source === "area:test:quietToolbar");
      if (i === 0) expect(lines).toHaveLength(1);
      expect(lines.length).toBeLessThanOrEqual(i + 1);
    }
    const toasts = toastStore.get().slice(before).filter((t) => t.message === "This area could not be shown");
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe("warning");
  });

  it("a vertical or icon-sized place fails as the glyph and the reload, without a line of text", async () => {
    await render(<AreaBoundary area="shell:ribbon" placeClassName="m-fab-float" size="icon"><Fragile /></AreaBoundary>);
    const fallback = q("area-fallback") as HTMLElement;
    expect(fallback.className).toContain("pv-areafail--icon");
    expect(fallback.className).toContain("m-fab-float");
    expect(fallback.textContent).toBe("");
    expect(fallback.getAttribute("aria-label")).toBe("This area could not be shown");
    expect(fallback.dataset.tip).toBe("This area could not be shown");
    expect(fallback.querySelector(".pv-areafail-line")).toBeNull();
    expect(q("area-fallback-reload")?.getAttribute("aria-label")).toBe("Reload this area");
  });

  it("a strip places itself with the shell's class", async () => {
    await render(<AreaBoundary area="shell:navbar" placeClassName="m-tabbar" size="strip"><Fragile /></AreaBoundary>);
    expect((q("area-fallback") as HTMLElement).className).toBe("pv-areafail pv-areafail--strip m-tabbar");
  });

  it("the test seam makes exactly the named area fail", async () => {
    await render(
      <>
        <AreaBoundary area="sidebar:files" size="section"><p data-testid="files">files</p></AreaBoundary>
        <AreaBoundary area="tab:note"><p data-testid="note">note</p></AreaBoundary>
      </>,
    );
    await act(async () => areaCrashSeam!.crash("tab:note"));
    expect(q("files")).not.toBeNull();
    expect(q("note")).toBeNull();
    await act(async () => areaCrashSeam!.clear("tab:note"));
    await click("area-fallback-reload");
    expect(q("note")).not.toBeNull();
  });
});

describe("the boundaries inside the primitives", () => {
  it("a dialog whose content fails keeps its frame and its close", async () => {
    const onClose = vi.fn();
    await render(<Modal onClose={onClose} testId="probe-dialog" title="Probe"><Fragile /></Modal>);
    const dialog = q("probe-dialog") as HTMLElement;
    expect(dialog.querySelector(".pv-modal-heading")?.textContent).toBe("Probe");
    expect((q("area-fallback") as HTMLElement).dataset.area).toBe("dialog:probe-dialog");
    await click("area-fallback-exit");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a floating window whose content fails keeps its head", async () => {
    await render(
      <FloatingWindow ariaLabel="Probe" defaultHeight={400} defaultWidth={500} head={<span data-testid="probe-head">head</span>} persistKey="probe" testId="probe-window">
        <Fragile />
      </FloatingWindow>,
    );
    expect(q("probe-head")).not.toBeNull();
    expect((q("area-fallback") as HTMLElement).dataset.area).toBe("window:probe-window");
  });
});

describe("describeAreaError", () => {
  it("keeps the kind, the first line and the component names, innermost first", () => {
    const stack = "\n    at Cell (http://localhost/src/Cell.tsx:3:1)\n    at Row (http://localhost/src/Row.tsx:9:2)\n    at div\n    at TableView (x)\n    at BaseViewer (y)\n    at AppShell (z)";
    expect(describeAreaError(new TypeError("x is undefined\nsecond line with text"), stack)).toBe("TypeError: x is undefined (in Cell < Row < TableView < BaseViewer)");
    expect(describeAreaError("plain", null)).toBe("string: plain");
    expect(describeAreaError(new Error("a".repeat(400))).length).toBeLessThan(200);
  });
});
