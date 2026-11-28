// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { PART_LOAD_TIMEOUT_MS } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * A part loaded on demand brings the boundary for its load (review of B1b, round 1, S-1): when its chunk hangs or
 * fails, the part says so where it stands, in the app's words, and the window around it goes on — never the app-wide
 * crash screen. The mail composer stands beside the shell with no boundary of its own (`MailComposeHost`), as the
 * splash screen's index rebuild does (`SplashRebuildIndex`); both are `deferredPart`s, which is what holds them.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "/vault", vaultAdapter: null, isLoading: false }),
}));

// The composer's chunk: it hangs until `arrive`, then shows the draft it was handed.
let arrive: () => void = () => undefined;
const arrived = new Promise<void>((resolve) => (arrive = resolve));
vi.mock("./MailDraftModal", async () => {
  await arrived;
  return { MailDraftModal: ({ subject, markdown }: { subject: string; markdown: string }) => <div data-testid="the-draft">{`${subject}|${markdown}`}</div> };
});

import { MailComposeHost } from "./MailComposeHost";
import { ErrorBoundary } from "../ErrorBoundary";
import { deferredPart } from "../../lib/deferredParts";

afterEach(() => {
  vi.useRealTimers();
});

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return { host, root, render: () => act(async () => root.render(node)) };
}

describe("a part's load failure stays at the part", () => {
  it("the composer's chunk hangs: after the end the shell stays, the app's words show, and the reload brings the draft", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = mount(
      <ErrorBoundary>
        <p data-testid="the-shell">the shell with the open note</p>
        <MailComposeHost />
      </ErrorBoundary>,
    );
    await view.render();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail: { subject: "Re: x", markdown: "prefilled" } }));
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PART_LOAD_TIMEOUT_MS + 100);
    });
    expect(document.querySelector("[data-testid=the-shell]")).not.toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toContain(i18n.t("errors.partLoadTitle"));
    expect(text).not.toContain("Something went wrong");
    expect(text).not.toContain("PartLoadError");
    // The chunk arrives late; the reload loads again and draws the composer with the draft the host kept.
    arrive();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const reload = document.querySelector<HTMLButtonElement>("[data-testid=area-fallback-reload]");
    expect(reload).not.toBeNull();
    await act(async () => {
      reload!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(document.querySelector("[data-testid=the-draft]")?.textContent).toBe("Re: x|prefilled");
    expect(document.querySelector("[data-testid=the-shell]")).not.toBeNull();
    quiet.mockRestore();
    act(() => view.root.unmount());
    view.host.remove();
  });

  it("a part with no boundary around it whose chunk is refused leaves the window as it is", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Refused = deferredPart(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/x.js")));
    const view = mount(
      <ErrorBoundary>
        <p data-testid="the-shell">shell</p>
        <Suspense fallback={null}>
          <Refused />
        </Suspense>
      </ErrorBoundary>,
    );
    await view.render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.host.querySelector("[data-testid=the-shell]")).not.toBeNull();
    expect(view.host.querySelector("[data-testid=area-fallback]")?.textContent).toContain(i18n.t("errors.partLoadArea"));
    expect(view.host.textContent).not.toContain("dynamically imported");
    quiet.mockRestore();
    act(() => view.root.unmount());
    view.host.remove();
  });

  it("an error of the part itself goes on to the boundary above, as before", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Broken = () => {
      throw new Error("a bug in the part");
    };
    const Part = deferredPart(async () => Broken);
    const view = mount(
      <ErrorBoundary>
        <p data-testid="the-shell">shell</p>
        <Suspense fallback={null}>
          <Part />
        </Suspense>
      </ErrorBoundary>,
    );
    await view.render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.host.querySelector("[data-testid=area-fallback]")).toBeNull();
    expect(view.host.textContent).toContain("a bug in the part");
    quiet.mockRestore();
    act(() => view.root.unmount());
    view.host.remove();
  });

  it("the reload right after a failure loads again (a state, not a time)", async () => {
    expect.hasAssertions();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Shown = () => <p data-testid="shown">loaded</p>;
    const load = vi.fn<() => Promise<typeof Shown>>().mockRejectedValueOnce(new TypeError("Importing a module script failed.")).mockResolvedValueOnce(Shown);
    const Part = deferredPart(load);
    const view = mount(
      <Suspense fallback={null}>
        <Part />
      </Suspense>,
    );
    await view.render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const reload = view.host.querySelector<HTMLButtonElement>("[data-testid=area-fallback-reload]");
    expect(reload).not.toBeNull();
    await act(async () => {
      reload!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(view.host.querySelector("[data-testid=shown]")).not.toBeNull();
    quiet.mockRestore();
    act(() => view.root.unmount());
    view.host.remove();
  });
});
