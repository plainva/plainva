import { describe, it, expect, vi } from "vitest";
import { createTokenBroker, type StoredAccountToken } from "@plainva/ui";

/**
 * The broker replaces three independent refresh implementations (file sync,
 * calendar, mail) that each held their own copy of a ROTATING Microsoft
 * refresh token. These tests pin the two properties that made that shape
 * dangerous: exactly one refresh per burst, and a rotated token persisted
 * before any caller continues.
 */

function setup(opts: { expiresIn?: number; rotate?: boolean } = {}) {
  let stored: StoredAccountToken | null = { clientId: "cid", refreshToken: "RT-1" };
  const writes: string[] = [];
  let issued = 0;
  let resolveGate: (() => void) | null = null;
  const gate = new Promise<void>((r) => {
    resolveGate = r;
  });
  let gated = false;
  let clock = 0;

  const refresh = vi.fn(async (o: { refreshToken: string; scope: string }) => {
    if (gated) await gate;
    issued += 1;
    return {
      accessToken: `AT-${issued}-${o.scope}`,
      refreshToken: opts.rotate === false ? undefined : `RT-${issued + 1}`,
      expiresIn: opts.expiresIn,
    };
  });

  const broker = createTokenBroker({
    store: {
      read: async () => stored,
      write: async (next) => {
        // Records the ORDER of persistence relative to token hand-out.
        writes.push(next.refreshToken);
        stored = next;
      },
    },
    refresh,
    scopeFor: (a) => `scope:${a}`,
    now: () => clock,
  });

  return {
    broker,
    refresh,
    writes,
    openGate: () => resolveGate?.(),
    closeGate: () => {
      gated = true;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    current: () => stored,
  };
}

describe("createTokenBroker", () => {
  it("serves a cached access token instead of refreshing again", async () => {
    const s = setup({ expiresIn: 3600 });
    const a = await s.broker.getAccessToken("files");
    const b = await s.broker.getAccessToken("files");
    expect(a).toBe(b);
    expect(s.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes ONCE for concurrent callers of the same audience", async () => {
    const s = setup({ expiresIn: 3600 });
    s.closeGate();
    const pending = [s.broker.getAccessToken("mail"), s.broker.getAccessToken("mail"), s.broker.getAccessToken("mail")];
    s.openGate();
    const tokens = await Promise.all(pending);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it("persists a rotated refresh token before handing the access token out", async () => {
    const s = setup({ expiresIn: 3600 });
    const token = await s.broker.getAccessToken("calendar");
    expect(token).toBeTruthy();
    // The write happened during the call, not after it.
    expect(s.writes).toEqual(["RT-2"]);
    expect(s.current()?.refreshToken).toBe("RT-2");
  });

  it("scopes the access token to the requested audience", async () => {
    const s = setup({ expiresIn: 3600 });
    expect(await s.broker.getAccessToken("files")).toContain("scope:files");
    expect(await s.broker.getAccessToken("calendar")).toContain("scope:calendar");
    // Two audiences, two tokens — one shared refresh token behind them.
    expect(s.refresh).toHaveBeenCalledTimes(2);
    expect(s.current()?.refreshToken).toBe("RT-3");
  });

  it("refreshes again once the cached token is close to expiry", async () => {
    const s = setup({ expiresIn: 120 });
    await s.broker.getAccessToken("files");
    s.advance(61_000); // inside the 60s safety margin
    await s.broker.getAccessToken("files");
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves the stored token alone when the provider does not rotate", async () => {
    const s = setup({ expiresIn: 3600, rotate: false });
    await s.broker.getAccessToken("files");
    expect(s.writes).toEqual([]);
    expect(s.current()?.refreshToken).toBe("RT-1");
  });

  it("reports a disconnected account instead of returning an empty token", async () => {
    const broker = createTokenBroker({
      store: { read: async () => null, write: async () => undefined },
      refresh: vi.fn(),
      scopeFor: () => "s",
    });
    await expect(broker.getAccessToken("files")).rejects.toThrow(/not connected/);
  });

  it("retries after a failed refresh instead of caching the failure", async () => {
    let calls = 0;
    const broker = createTokenBroker({
      store: { read: async () => ({ clientId: "c", refreshToken: "RT" }), write: async () => undefined },
      refresh: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return { accessToken: "AT", expiresIn: 3600 };
      },
      scopeFor: () => "s",
    });
    await expect(broker.getAccessToken("files")).rejects.toThrow(/network down/);
    await expect(broker.getAccessToken("files")).resolves.toBe("AT");
  });
});
