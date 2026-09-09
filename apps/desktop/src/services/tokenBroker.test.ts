import { describe, it, expect, vi } from "vitest";
import {
  createTokenBroker,
  replaceOAuthClientRegistration,
  type StoredAccountToken,
} from "@plainva/ui";

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
  it.each([{ scope: null }, { scope: 42 }, { scope: {} }, { accessToken: 42 }, { refreshToken: null }])(
    "does not interpret malformed response fields as omitted permission data: %j", async (invalid) => {
      const write = vi.fn();
      const broker = createTokenBroker({
        family: "microsoft",
        store: { read: async () => ({ clientId: "client", refreshToken: "stored" }), write },
        scopeFor: () => "Files.ReadWrite",
        refresh: async () => ({ accessToken: "access", ...invalid }) as never,
      });
      await expect(broker.getAccessToken("files")).rejects.toThrow(/invalid grant|no access token/);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("serializes different audiences through confirmed rotation and returns distinct scoped tokens", async () => {
    let stored: StoredAccountToken = { clientId: "client", refreshToken: "first" };
    const requests: string[] = [];
    const broker = createTokenBroker({
      store: { read: async () => stored, write: async (next) => { stored = next; } },
      scopeFor: (audience) => audience,
      refresh: async ({ refreshToken, scope }) => {
        requests.push(`${scope}:${refreshToken}`);
        return { accessToken: `access-${scope}`, refreshToken: `refresh-${scope}`, scope };
      },
    });
    await expect(Promise.all(["files", "calendar", "mail"].map((audience) => broker.getAccessToken(audience))))
      .resolves.toEqual(["access-files", "access-calendar", "access-mail"]);
    expect(requests).toEqual(["files:first", "calendar:refresh-files", "mail:refresh-calendar"]);
  });

  it("does not use or cache an explicitly narrowed access token but retains its rotation", async () => {
    let stored: StoredAccountToken = { clientId: "client", refreshToken: "first" };
    const refresh = vi.fn().mockResolvedValueOnce({ accessToken: "wrong", refreshToken: "rotated", scope: "files" })
      .mockResolvedValue({ accessToken: "correct", scope: "calendar" });
    const broker = createTokenBroker({
      store: { read: async () => stored, write: async (next) => { stored = next; } },
      scopeFor: (audience) => audience, refresh,
    });
    await expect(broker.getAccessToken("calendar")).rejects.toThrow(/required permissions/);
    expect(stored.refreshToken).toBe("rotated");
    await expect(broker.getAccessToken("calendar")).resolves.toBe("correct");
    expect(refresh).toHaveBeenLastCalledWith(expect.objectContaining({ refreshToken: "rotated" }));
  });

  it("forget prevents an old response from caching or persisting and lets the new attempt finish", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let stored: StoredAccountToken = { clientId: "client", refreshToken: "first" };
    const writes = vi.fn(async (next: StoredAccountToken) => { stored = next; });
    const refresh = vi.fn().mockImplementationOnce(async () => { await waiting; return { accessToken: "old", refreshToken: "old-rotation" }; })
      .mockResolvedValue({ accessToken: "new", refreshToken: "new-rotation" });
    const broker = createTokenBroker({ store: { read: async () => stored, write: writes }, scopeFor: () => "files", refresh });
    const first = broker.getAccessToken("files");
    const failure = expect(first).rejects.toThrow(/sign-in changed/);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    broker.forget();
    const second = broker.getAccessToken("files");
    release(); await failure;
    await expect(second).resolves.toBe("new");
    await expect(broker.getAccessToken("files")).resolves.toBe("new");
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(stored.refreshToken).toBe("new-rotation");
  });

  it("a new stored consent cannot be overwritten by an old in-flight rotation", async () => {
    let stored: StoredAccountToken = { clientId: "client", refreshToken: "first" };
    const write = vi.fn();
    const broker = createTokenBroker({
      store: { read: async () => stored, write }, scopeFor: () => "files",
      refresh: async () => {
        stored = { clientId: "client", refreshToken: "new-consent" };
        return { accessToken: "old", refreshToken: "old-rotation" };
      },
    });
    await expect(broker.getAccessToken("files")).rejects.toThrow(/sign-in changed/);
    expect(write).not.toHaveBeenCalled();
    expect(stored.refreshToken).toBe("new-consent");
  });

  it("never converts a repeated storage failure into a cached success", async () => {
    let fail = true;
    let stored: StoredAccountToken = { clientId: "client", refreshToken: "first" };
    const broker = createTokenBroker({
      store: { read: async () => stored, write: async (next) => {
        if (fail) throw new Error("secure storage unavailable");
        stored = next;
      } }, scopeFor: () => "files",
      refresh: async () => ({ accessToken: "access", refreshToken: "rotated" }),
    });
    await expect(broker.getAccessToken("files")).rejects.toThrow(/secure storage/);
    await expect(broker.getAccessToken("files")).rejects.toThrow(/secure storage/);
    expect(stored.refreshToken).toBe("first");
    fail = false;
    await expect(broker.getAccessToken("files")).resolves.toBe("access");
    expect(stored.refreshToken).toBe("rotated");
  });

  it("T6 invalidates the old grant when either half of the local client changes", () => {
    const current: StoredAccountToken = {
      clientId: "desktop-client",
      clientSecret: "desktop-secret",
      refreshToken: "desktop-refresh",
      scopes: "files calendar",
    };

    expect(replaceOAuthClientRegistration(current, {
      clientId: "android-client",
      clientSecret: "android-secret",
    })).toEqual({
      clientId: "android-client",
      clientSecret: "android-secret",
      refreshToken: "",
    });
    expect(replaceOAuthClientRegistration(current, {
      clientId: "desktop-client",
      clientSecret: "changed-secret",
    }).refreshToken).toBe("");
    expect(replaceOAuthClientRegistration(current, {
      clientId: "desktop-client",
      clientSecret: "desktop-secret",
    })).toBe(current);
  });

  it("T5 keeps three installations of one account on independent client/token units", async () => {
    const units: StoredAccountToken[] = [
      { clientId: "desktop-client", clientSecret: "desktop-secret", refreshToken: "desktop-refresh" },
      { clientId: "android-client", refreshToken: "android-refresh" },
      { clientId: "ios-client", refreshToken: "ios-refresh" },
    ];
    const seen: Array<{ clientId: string; refreshToken: string }> = [];

    await Promise.all(units.map(async (stored) => {
      const broker = createTokenBroker({
        store: { read: async () => stored, write: async () => undefined },
        refresh: async ({ clientId, refreshToken }) => {
          seen.push({ clientId, refreshToken });
          return { accessToken: `access-${clientId}` };
        },
        scopeFor: () => "calendar",
      });
      await broker.getAccessToken("calendar");
    }));

    expect(seen).toEqual(expect.arrayContaining(units.map(({ clientId, refreshToken }) => ({ clientId, refreshToken }))));
  });

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

  // "Bearer undefined" is what a 200-without-a-token turns into two layers
  // later, and Google answers it with a 401 that blames the sign-in. Cached, it
  // repeats for the token's whole supposed lifetime — which is what "I signed
  // in again and nothing changed" looks like (finding 2026-07-30).
  it("refuses an empty access token instead of caching it", async () => {
    let calls = 0;
    const broker = createTokenBroker({
      store: { read: async () => ({ clientId: "c", refreshToken: "RT" }), write: async () => undefined },
      refresh: async () => {
        calls += 1;
        return calls === 1 ? { accessToken: undefined as unknown as string, expiresIn: 3600 } : { accessToken: "AT", expiresIn: 3600 };
      },
      scopeFor: () => "s",
    });

    await expect(broker.getAccessToken("calendar")).rejects.toThrow(/no access token/);
    // Nothing was cached, so the next attempt is a real one.
    await expect(broker.getAccessToken("calendar")).resolves.toBe("AT");
  });
});
