import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PimAccountRow } from "@plainva/core";
import type { PimRuntime } from "./pimRuntime";

const state = vi.hoisted(() => ({
  slots: new Map<string, unknown>(), rows: [] as PimAccountRow[],
  probe: async () => {}, afterWrite: async () => {}, afterRead: async () => {},
  started: vi.fn(), triggered: vi.fn(), active: true,
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../settingsProfile", () => ({ noteAccountRemovedLocally: vi.fn() }));
vi.mock("./pimAuth", () => ({ authorizeGooglePim: vi.fn(), authorizeMicrosoftPim: vi.fn(), buildPimAuthProvider: vi.fn() }));
vi.mock("./pimCredentials", () => ({
  getPimCredentials: async (_v: string, id: string) => state.slots.get(id) ?? null,
  savePimCredentials: async (v: string, id: string, c: unknown) => { expect(v).toBe("/original"); state.slots.set(id, c); await state.afterWrite(); },
  clearPimCredentials: async (_v: string, id: string) => { state.slots.delete(id); },
}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  CalDavPimTarget: class { async listCalendars() { await state.probe(); return [{ id: "calendar" }]; } },
}));

import { connectCalDavAccount } from "./pimAccounts";
const opts = { url: "https://calendar.example.invalid", user: "user", pass: "new-password" };
const runtime = {
  isActive: () => state.active,
  cache: {
    listAccounts: async () => { await state.afterRead(); return state.rows; },
    upsertAccount: async (row: PimAccountRow) => { state.rows.push(row); },
    setScopeState: async () => {},
  },
  buildTarget: async () => null,
  worker: { start: state.started, triggerImmediate: state.triggered },
} as unknown as PimRuntime;
beforeEach(() => {
  state.slots.clear(); state.rows = []; state.active = true;
  state.probe = async () => {}; state.afterWrite = async () => {}; state.afterRead = async () => {};
  state.started.mockClear(); state.triggered.mockClear();
});

describe("desktop calendar connection lifetime", () => {
  it("does not persist a probe completed after the owning runtime closed", async () => {
    state.probe = async () => { state.active = false; };
    await expect(connectCalDavAccount(runtime, "/original", opts)).rejects.toThrow("runtime changed");
    expect(state.slots.size).toBe(0); expect(state.rows).toEqual([]);
    expect(state.triggered).not.toHaveBeenCalled();
  });
  it("does not adopt after the owner closed while listing accounts", async () => {
    state.afterRead = async () => { state.active = false; };
    await expect(connectCalDavAccount(runtime, "/original", opts)).rejects.toThrow("runtime changed");
    expect(state.slots.size).toBe(0); expect(state.rows).toEqual([]);
  });
  it("a late credential acknowledgement never restarts a disposed runtime", async () => {
    state.afterWrite = async () => { state.active = false; };
    await expect(connectCalDavAccount(runtime, "/original", opts)).rejects.toThrow("runtime changed");
    expect(state.slots.size).toBe(1); expect(state.rows).toEqual([]);
    expect(state.started).not.toHaveBeenCalled(); expect(state.triggered).not.toHaveBeenCalled();
  });
  it("a confirmed connection records a fresh login and wakes its own worker", async () => {
    const account = await connectCalDavAccount(runtime, "/original", opts);
    expect(state.slots.get(account.id)).toMatchObject({ ...opts, kind: "caldav", loginRevision: expect.any(String) });
    expect(state.rows).toEqual([account]); expect(state.started).toHaveBeenCalledTimes(1);
    expect(state.triggered).toHaveBeenCalledTimes(1);
  });
});
