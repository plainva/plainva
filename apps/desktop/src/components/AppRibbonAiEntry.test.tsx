// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";

/**
 * The desktop's AI button in the ribbon (F71 of release 0.9.0, mockup M10, review of a9fe33ac2): a number where
 * something stands in "To decide"; a dot where only what no number counts waits — a question of the running
 * conversation, a skill waiting for its approval — and then the button's label still says that something waits.
 */

vi.mock("../contexts/VaultContext", () => ({ useVault: () => ({ vaultPath: null }) }));

const { AppRibbon } = await import("./AppRibbon");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const noop = () => undefined;
async function ribbon(aiWaiting: number, aiAttention: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // Only the AI button is looked at: the other buttons render without their handlers, which run on a click alone.
  const handlers = {};
  await act(async () => {
    root!.render(<AppRibbon {...(handlers as ComponentProps<typeof AppRibbon>)} onOpenAi={noop} aiWaiting={aiWaiting} aiAttention={aiAttention} />);
  });
  await act(async () => {
    for (let turns = 0; turns < 6; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const button = host.querySelector('[data-testid="ribbon-ai"]');
  expect(button).not.toBeNull();
  return {
    dot: host.querySelector('[data-testid="ribbon-ai-dot"]') !== null,
    count: host.querySelector('[data-testid="ribbon-ai-count"]')?.textContent ?? null,
    label: button!.getAttribute("aria-label"),
  };
}

describe("the ribbon's AI button", () => {
  it("only what no number counts waits: a dot, no number, and the label says that something waits", async () => {
    const got = await ribbon(0, true);
    expect(got.dot).toBe(true);
    expect(got.count).toBeNull();
    expect(got.label).toBe(`${i18n.t("ai.ask")} · ${i18n.t("ai.waitingSomething")}`);
  });

  it("something stands in “To decide”: the number stays, whatever else waits", async () => {
    const got = await ribbon(1, true);
    expect(got.count).toBe("1");
    expect(got.dot).toBe(false);
    expect(got.label).toBe(`${i18n.t("ai.ask")} · ${i18n.t("ai.waitingCount", { count: 1 })}`);
  });

  it("nothing waits: the bare button", async () => {
    const got = await ribbon(0, false);
    expect(got).toEqual({ dot: false, count: null, label: i18n.t("ai.ask") });
  });
});
