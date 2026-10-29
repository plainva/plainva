import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sign-in to an MCP server on the phone (plan KI-Harness P4.5) takes the
 * road of every account sign-in there (main, 2026-10-28): the page opens
 * through `openSignInPage` - the system's sign-in window on the iPhone -, and
 * the way back is compared through `redirectAddress`.
 */
const state = vi.hoisted(() => ({
  opened: [] as string[],
  onClosed: undefined as undefined | (() => void),
  finished: undefined as undefined | (() => void),
  closedBrowser: 0,
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: async () => undefined,
    close: async () => { state.closedBrowser += 1; },
    addListener: async (_event: string, listener: () => void) => {
      state.finished = listener;
      return { remove: async () => undefined };
    },
  },
}));
vi.mock("../../platform/webAuth", () => ({
  openSignInPage: async (url: string, options?: { onClosed?: () => void }) => {
    state.opened.push(url);
    state.onClosed = options?.onClosed;
  },
}));
vi.mock("@plainva/ui", () => ({ toast: { info: () => undefined, error: () => undefined } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("./mobileAi", () => ({ getMobileAiSession: () => ({ mcp: { finishSignIn: async () => null } }) }));

import { createMobileMcpBrowser, handleMcpOAuthRedirect, MCP_OAUTH_REDIRECT } from "./mobileMcpBrowser";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the phone's browser for a sign-in to an MCP server", () => {
  beforeEach(() => {
    state.opened = [];
    state.onClosed = undefined;
    state.finished = undefined;
    state.closedBrowser = 0;
  });

  it("opens the page on the road every sign-in of the phone takes, and only a web address", async () => {
    const browser = createMobileMcpBrowser();
    await expect(browser.open("javascript:alert(1)")).rejects.toThrow("oauth-address");
    await browser.open("https://auth.example.test/authorize?state=s");
    expect(state.opened).toEqual(["https://auth.example.test/authorize?state=s"]);
  });

  it("takes the way back with a slash at its end as the answer it waits for, and nothing else of the app's address", async () => {
    const browser = createMobileMcpBrowser();
    await browser.open("https://auth.example.test/authorize");
    const answer = browser.wait();
    expect(await handleMcpOAuthRedirect("com.plainva.app://mcp/other?code=x&state=s")).toBe(false);
    expect(MCP_OAUTH_REDIRECT).toBe("com.plainva.app://mcp/oauth");
    expect(await handleMcpOAuthRedirect("com.plainva.app://mcp/oauth/?code=c&state=s&iss=https%3A%2F%2Fauth.example.test")).toBe(true);
    await expect(answer).resolves.toEqual({ state: "s", code: "c", iss: "https://auth.example.test" });
  });

  it("stops waiting when the sign-in window closes without an answer, also before the wait began", async () => {
    const browser = createMobileMcpBrowser();
    await browser.open("https://auth.example.test/authorize");
    const waiting = browser.wait();
    state.onClosed?.();
    await expect(waiting).rejects.toThrow("cancelled");

    await browser.open("https://auth.example.test/authorize?again");
    state.onClosed?.();
    await expect(browser.wait()).rejects.toThrow("cancelled");
  });

  it("gives the browser a moment after it closed on Android, where the way back may still be on its way", async () => {
    vi.useFakeTimers();
    try {
      const browser = createMobileMcpBrowser();
      await browser.open("https://auth.example.test/authorize");
      const waiting = browser.wait();
      await vi.advanceTimersByTimeAsync(0);
      state.finished?.();
      expect(await handleMcpOAuthRedirect("com.plainva.app://mcp/oauth?code=late&state=s")).toBe(true);
      await expect(waiting).resolves.toEqual({ state: "s", code: "late" });
    } finally {
      vi.useRealTimers();
    }
    await settle();
  });
});
