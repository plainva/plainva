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
