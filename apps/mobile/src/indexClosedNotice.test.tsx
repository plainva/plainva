// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The strip on top of the vault without its index database (stability plan
 * R5): deleting, renaming and moving are refused by the chain, and this says
 * so up front, before anybody tries.
 */

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const dialogs = vi.hoisted(() => ({ asked: [] as string[], answer: true }));
vi.mock("./services/mobileDialogs", () => ({
  mConfirm: async (opts: { message?: string }) => { dialogs.asked.push(opts.message ?? ""); return dialogs.answer; },
}));

const { IndexBuildNotice } = await import("./components/IndexBuildNotice");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the strip of a vault without its index database", () => {
  // Under a mocked i18n: this pins which key the strip shows and that it is a warning, not the sentence's words.
  it("shows the key errors.indexClosedNotice, as a warning", () => {
    act(() => root.render(<IndexBuildNotice vaultId="v1" indexClosed />));
    const notice = container.querySelector('[data-testid="index-closed-notice"]');
    expect(notice?.textContent).toBe("errors.indexClosedNotice");
    expect(container.querySelector(".pv-banner--warning")).not.toBeNull();
  });

  it("is not there for a vault whose index is open (positive control: the same strip, open index)", () => {
    act(() => root.render(<IndexBuildNotice vaultId="v1" />));
    expect(container.querySelector('[data-testid="index-closed-notice"]')).toBeNull();
  });
});

describe("the strip of a vault whose index database is damaged", () => {
  const damaged = { kind: "damaged" as const, workspace: false, message: "the words" };

  it("says why, and offers to rebuild — asked first", async () => {
    dialogs.asked.length = 0;
    dialogs.answer = true;
    const onRebuild = vi.fn(async () => {});
    act(() => root.render(<IndexBuildNotice vaultId="v1" failure={damaged} onRebuild={onRebuild} />));
    expect(container.querySelector('[data-testid="index-failure-notice"]')?.textContent).toContain("the words");
    const button = container.querySelector<HTMLButtonElement>('[data-testid="index-rebuild"]');
    expect(button?.textContent).toBe("settings.rebuildIndexAction");
    await act(async () => { button!.click(); });
    expect(dialogs.asked).toEqual(["indexDatabase.rebuildConfirm"]);
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the question is answered no", async () => {
    dialogs.answer = false;
    const onRebuild = vi.fn(async () => {});
    act(() => root.render(<IndexBuildNotice vaultId="v1" failure={damaged} onRebuild={onRebuild} />));
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="index-rebuild"]')!.click(); });
    expect(onRebuild).not.toHaveBeenCalled();
  });

  it("offers nothing in an encrypted workspace, nor for a database that is only locked", () => {
    const onRebuild = vi.fn(async () => {});
    act(() => root.render(<IndexBuildNotice vaultId="v1" failure={{ ...damaged, workspace: true }} onRebuild={onRebuild} />));
    expect(container.querySelector('[data-testid="index-failure-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="index-rebuild"]')).toBeNull();
    act(() => root.render(<IndexBuildNotice vaultId="v1" failure={{ kind: "locked", workspace: false, message: "locked" }} onRebuild={onRebuild} />));
    expect(container.querySelector('[data-testid="index-rebuild"]')).toBeNull();
  });
});
