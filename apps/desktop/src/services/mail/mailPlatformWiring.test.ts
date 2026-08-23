// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Which window may talk to a mailbox, and which one may renew its token
 * (multi-window, maintainer finding 2026-08-23).
 *
 * P2 let the mail view move into a window of its own, but only the owner ever
 * registered the mail platform — so `mailTransport()` threw in an auxiliary
 * window and the message list stayed empty while the same mailbox worked in the
 * main window. Playwright drives one page and could not see it.
 *
 * The split asserted here is the one that keeps the fix safe: reading and
 * writing a mailbox is fine from any window, refreshing an OAuth token is not,
 * because Microsoft ROTATES the refresh token and two renewals at once leave
 * one window holding a dead one.
 */

let platform: { transport: unknown; http: { api: unknown; token: (...a: unknown[]) => Promise<unknown> } } | null = null;
let resolver: ((vaultPath: string, accountId: string) => Promise<((force: boolean) => Promise<string>) | undefined>) | null = null;
const requests: Array<{ kind: string; args: unknown }> = [];

vi.mock("@plainva/ui/mail", () => ({
  setMailPlatform: (p: never) => { platform = p; },
  setMailTokenResolver: (r: never) => { resolver = r; },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => undefined }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: async () => new Response("") }));
vi.mock("../authFetch", () => ({ microsoftAuthFetch: async () => new Response("") }));

vi.mock("../windowBus", () => ({
  getWindowBus: async () => ({
    request: async (kind: string, args: unknown) => {
      requests.push({ kind, args });
      return "fresh-token";
    },
  }),
}));

import { registerClientMailPlatform, registerDesktopMailPlatform } from "./tauriMailTransport";

beforeEach(() => {
  platform = null;
  resolver = null;
  requests.length = 0;
});

describe("the mail platform in an auxiliary window", () => {
  it("registers a transport, so the message list has somewhere to read from", () => {
    registerClientMailPlatform();

    // The whole bug in one assertion: without this call `mailTransport()` threw
    // and every mail screen in the window came up empty.
    expect(platform?.transport).toBeTruthy();
  });

  it("asks the owner for an access token instead of minting one", async () => {
    registerClientMailPlatform();

    const provider = await resolver?.("C:/vault", "acct-1");
    const token = await provider?.(true);

    expect(token).toBe("fresh-token");
    expect(requests).toEqual([
      { kind: "mail-token", args: { vaultPath: "C:/vault", accountId: "acct-1", force: true } },
    ]);
  });

  it("refuses to run a token refresh itself", async () => {
    registerClientMailPlatform();

    // Structural rather than by argument: if any path ever reaches the relay
    // from here, it says why instead of quietly rotating the account's token.
    await expect(platform?.http.token()).rejects.toThrow(/main window/);
  });

  it("leaves the owner minting its own tokens", () => {
    registerDesktopMailPlatform();

    // The owner keeps the Origin-free relay (AADSTS90023) and installs no bus
    // resolver — it is the one window that may renew.
    expect(platform?.http.token).toBeTruthy();
    expect(resolver).toBeNull();
  });
});
