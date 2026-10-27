// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The connect run's banner (device finding 2026-10-27): a step that ends
 * without going on says why - a failure with its reason, a cancelled copy as
 * such - and the step label and that message stack instead of sharing a line,
 * where a long message squeezed the label until it broke letter by letter.
 */

const queue = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("../hooks/useConnectionRun", () => ({ useConnectionRun: () => queue.value }));
vi.mock("../services/connectQueue", () => ({ clearConnectQueue: vi.fn(async () => {}), confirmConnectSelection: vi.fn(async () => {}) }));
vi.mock("../services/pim/pimOAuth", () => ({ hasReceivedPimOAuthResult: async () => false, resumePimOAuthResult: async () => {} }));

import { ConnectRunBanner } from "./ConnectRunBanner";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const run = (outcomes: Record<string, unknown>) => ({ id: "run", family: "google", context: { vaultId: "v" }, pending: ["files", "calendar"], done: [], outcomes });

describe("the connect run's banner", () => {
  it("says a cancelled copy was cancelled, and that nothing changed", async () => {
    queue.value = run({ files: { state: "cancelled" } });
    await act(async () => { root.render(<ConnectRunBanner service="files" />); });
    expect(container.querySelector('[data-testid="connectrun-outcome"]')?.textContent).toMatch(/Copying was cancelled/);
  });

  it("puts the step label and its message in one column, the buttons apart", async () => {
    queue.value = run({ files: { state: "failed", message: "identityUnavailable" } });
    await act(async () => { root.render(<ConnectRunBanner service="files" />); });
    const text = container.querySelector(".m-connectrun-text");
    expect(text?.querySelector('[data-testid="connectrun-step"]')?.textContent).toBe("Step 1 of 2: Files");
    expect(text?.querySelector('[data-testid="connectrun-outcome"]')).not.toBeNull();
    expect(container.querySelector(".m-connectrun-actions [data-testid=\"connectrun-cancel\"]")).not.toBeNull();
  });
});
