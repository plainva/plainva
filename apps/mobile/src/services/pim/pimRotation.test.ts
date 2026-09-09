import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  raw: null as string | null,
  fail: false,
  refreshed: vi.fn(),
  beforeReply: async () => {},
}));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({
  get: async () => ({ value: state.raw }),
  compareAndSet: async (args: { expected: string | null; value: string | null }) => {
    if (state.fail) throw Error("native storage unavailable");
    if (state.raw !== args.expected) return { changed: false };
    state.raw = args.value; return { changed: true };
  },
}) }));
vi.mock("../../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("../accountBroker", () => ({ brokerTokenProvider: async () => undefined, describeBrokerLookup: async () => "missing" }));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  refreshOneDriveAccessToken: async () => {
    state.refreshed(); await state.beforeReply();
    return { accessToken: "access", refreshToken: "rotated", expiresIn: 3600 };
  },
}));

import { buildPimAuthProvider } from "./pimAuth";

const initial = { kind: "microsoft" as const, clientId: "client", refreshToken: "original", loginRevision: "login-1" };
beforeEach(() => {
  state.raw = JSON.stringify(initial); state.fail = false;
  state.refreshed.mockClear(); state.beforeReply = async () => {};
});

describe("PIM rotations through actual protected credential storage", () => {
  it("preserves the login revision and confirms storage before returning access", async () => {
    const auth = buildPimAuthProvider("vault", "calendar", initial);
    await expect(auth.getAccessToken()).resolves.toBe("access");
    expect(JSON.parse(state.raw!)).toEqual({ ...initial, refreshToken: "rotated" });
  });

  it("cannot overwrite a login completed while its response was pending", async () => {
    const fresh = { ...initial, refreshToken: "new-login", loginRevision: "login-2" };
    state.beforeReply = async () => { state.raw = JSON.stringify(fresh); };
    await expect(buildPimAuthProvider("vault", "calendar", initial).getAccessToken()).rejects.toThrow("Stored sign-in changed");
    expect(JSON.parse(state.raw!)).toEqual(fresh);
  });

  it("does not cache access after a failed rotation write", async () => {
    const auth = buildPimAuthProvider("vault", "calendar", initial);
    state.fail = true;
    await expect(auth.getAccessToken()).rejects.toThrow("native storage unavailable");
    expect(JSON.parse(state.raw!)).toEqual(initial);
    state.fail = false;
    await expect(auth.getAccessToken()).resolves.toBe("access");
    expect(state.refreshed).toHaveBeenCalledTimes(2);
  });

  it("a new connection probe can retain a rotation in memory before creating its slot", async () => {
    state.raw = null;
    const saved = vi.fn(async () => {});
    await expect(buildPimAuthProvider("vault", "new-calendar", initial, { onRotation: saved }).getAccessToken()).resolves.toBe("access");
    expect(saved).toHaveBeenCalledWith(initial, { ...initial, refreshToken: "rotated" });
    expect(state.raw).toBeNull();
  });
});
