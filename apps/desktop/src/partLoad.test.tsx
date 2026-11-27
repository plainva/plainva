// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { AreaBoundary, errorText, isPartLoadFailure, lazyPart, loadPart, PART_LOAD_TIMEOUT_MS, PartLoadError } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * Loading a part on demand has an end and the app's own words (package B1b, the rest of L5): a load that hangs fails
 * after `PART_LOAD_TIMEOUT_MS`, a load that fails is a `PartLoadError`, and wherever such a failure is shown —
 * `errorText`, the `AreaBoundary` — the person reads the app's sentence, never the browser's.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BROWSER = "Failed to fetch dynamically imported module: http://localhost/assets/Editor-abc.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("loadPart", () => {
  it("ends a load that never settles with a PartLoadError of reason timeout", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const pending = loadPart(() => new Promise<never>(() => undefined));
    const caught = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS - 1);
    let settled = false;
    void caught.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await caught;
    expect(error).toBeInstanceOf(PartLoadError);
    expect((error as PartLoadError).reason).toBe("timeout");
  });

  it("turns a failed load into a PartLoadError that keeps its cause", async () => {
    expect.hasAssertions();
    const cause = new TypeError(BROWSER);
    const error = await loadPart(() => Promise.reject(cause)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartLoadError);
    expect((error as PartLoadError).reason).toBe("failed");
    expect((error as PartLoadError).cause).toBe(cause);
  });

  it("hands on what it loaded and ignores the end afterwards", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const value = await loadPart(async () => 42);
    expect(value).toBe(42);
    await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS * 2);
  });
});

describe("the words for a part that could not be loaded", () => {
  it("errorText says the app's sentence for ours, for the browser's error and for its bare string", () => {
    expect.hasAssertions();
    const ours = i18n.t("errors.partLoad");
    expect(ours).not.toBe("errors.partLoad");
    for (const error of [new PartLoadError("timeout"), new PartLoadError("failed", new TypeError(BROWSER)), new TypeError(BROWSER), BROWSER, new TypeError("Importing a module script failed.")]) {
      expect(isPartLoadFailure(error)).toBe(true);
      expect(errorText(error)).toBe(ours);
      expect(errorText(error)).not.toContain("dynamically imported");
    }
  });

  it("leaves every other error as it was", () => {
    expect.hasAssertions();
    expect(isPartLoadFailure(new Error("disk full"))).toBe(false);
    expect(errorText(new Error("disk full"))).toBe("disk full");
  });
});

function mount(node: ReactNode) {
  const host = document.createElement("div");
  const root = createRoot(host);
  return { host, root, render: () => act(async () => root.render(node)) };
}

describe("a part that hangs or fails, in its boundary", () => {
  it("shows the boundary with the load's own title after the end, not a fallback for ever", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const Part = lazyPart(() => new Promise<never>(() => undefined));
    const view = mount(
      <AreaBoundary area="test:hangingPart" size="section">
        <Suspense fallback={<p data-testid="waiting">waiting</p>}>
          <Part />
        </Suspense>
      </AreaBoundary>,
    );
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await view.render();
    expect(view.host.querySelector("[data-testid=waiting]")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS + 10);
    });
    expect(view.host.querySelector("[data-testid=waiting]")).toBeNull();
    const fallback = view.host.querySelector("[data-testid=area-fallback]");
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain(i18n.t("errors.partLoadTitle"));
    expect(fallback!.textContent).toContain(i18n.t("errors.partLoad"));
    quiet.mockRestore();
    act(() => view.root.unmount());
  });

  it("shows the load's own words when the browser refuses the file", async () => {
    expect.hasAssertions();
    const Part = lazyPart(() => Promise.reject(new TypeError(BROWSER)));
    const view = mount(
      <AreaBoundary area="test:failedPart" size="section">
        <Suspense fallback={null}>
          <Part />
        </Suspense>
      </AreaBoundary>,
    );
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await view.render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const fallback = view.host.querySelector("[data-testid=area-fallback]");
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toContain(i18n.t("errors.partLoadTitle"));
    expect(fallback!.textContent).not.toContain("dynamically imported");
    quiet.mockRestore();
    act(() => view.root.unmount());
  });
});

/**
 * React's own `lazy` keeps a failed load for ever and has no end for one that hangs: every component of the shells
 * loaded on demand goes through `lazyPart` (`deferredPart` in each shell). Before package B1b the desktop had 40.
 */
describe("no component loads through React's bare lazy", () => {
  const ROOT = resolve(__dirname, "../../..");
  const DIRS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];
  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "node_modules") yield* sources(path);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) yield path;
    }
  }
  it("finds no call of lazy() or React.lazy() in the sources", () => {
    expect.hasAssertions();
    const found: string[] = [];
    for (const dir of DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
        if (/(?<![\w.])(?:React\.)?lazy\s*\(/.test(text) || /import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*["']react["']/.test(text)) found.push(relative(ROOT, file));
      }
    }
    expect(found).toEqual([]);
  });
});
