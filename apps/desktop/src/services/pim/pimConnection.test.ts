import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PimAccountRow } from "@plainva/core";
import type { PimRuntime } from "./pimRuntime";

const state = vi.hoisted(() => ({
  slots: new Map<string, unknown>(), rows: [] as PimAccountRow[],
  probe: async () => {}, afterWrite: async () => {}, afterRead: async () => {},
  started: vi.fn(), triggered: vi.fn(), active: true,
  /** What the fake server names as the principal of a sign-in; undefined = it names none. */
  principalOf: (() => undefined) as (creds: { url: string; user: string }) => string | undefined,
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
  CalDavPimTarget: class {
    constructor(private creds: { url: string; user: string }) {}
    async listCalendars() { await state.probe(); return [{ id: "calendar" }]; }
    async listTaskLists() { return []; }
    confirmedPrincipal() { return state.principalOf(this.creds); }
  },
}));

import { connectCalDavAccount } from "./pimAccounts";
const opts = { url: "https://calendar.example.invalid", user: "user", pass: "new-password" };
const runtime = {
  isActive: () => state.active,
  cache: {
    listAccounts: async () => { await state.afterRead(); return state.rows; },
    upsertAccount: async (row: PimAccountRow) => { state.rows = [...state.rows.filter((r) => r.id !== row.id), row]; },
    reassignAccountRows: async () => {},
    deleteAccount: async (id: string) => { state.rows = state.rows.filter((r) => r.id !== id); },
    setScopeState: async () => {},
    replaceCalendars: async () => {},
    replaceTaskLists: async () => {},
  },
  buildTarget: async () => null,
  worker: { start: state.started, triggerImmediate: state.triggered },
} as unknown as PimRuntime;
beforeEach(() => {
  state.slots.clear(); state.rows = []; state.active = true;
  state.probe = async () => {}; state.afterWrite = async () => {}; state.afterRead = async () => {};
  state.started.mockClear(); state.triggered.mockClear();
  state.principalOf = () => undefined;
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

/**
 * GitHub #174 (Fehlerliste C13): every further successful connect of one
 * Nextcloud added a calendar row beside the first, because a sign-in with a
 * password was never matched to a row — and each such row became a card of
 * its own. Server and user are the account (decided 2026-11-16).
 */
describe("connecting a CalDAV account that is already here", () => {
  const nextcloud = { url: "https://cloud.example.com/remote.php/dav", user: "anna", pass: "first" };

  it("keeps one row and gives it the new password", async () => {
    const first = await connectCalDavAccount(runtime, "/original", nextcloud);
    const again = await connectCalDavAccount(runtime, "/original", { url: "https://Cloud.Example.com:443/remote.php/dav/", user: " anna ", pass: "second" });
    expect(again.id).toBe(first.id);
    expect(state.rows.map((row) => row.id)).toEqual([first.id]);
    expect(state.slots.get(first.id)).toMatchObject({ kind: "caldav", pass: "second" });
    expect(state.slots.size).toBe(1);
  });

  it("adds a row for another user or another server", async () => {
    const first = await connectCalDavAccount(runtime, "/original", nextcloud);
    const otherUser = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "bert" });
    const otherScheme = await connectCalDavAccount(runtime, "/original", { ...nextcloud, url: "http://cloud.example.com/remote.php/dav" });
    const otherPath = await connectCalDavAccount(runtime, "/original", { ...nextcloud, url: "https://cloud.example.com/nextcloud/remote.php/dav" });
    expect(new Set([first.id, otherUser.id, otherScheme.id, otherPath.id]).size).toBe(4);
    expect(state.rows).toHaveLength(4);
  });

  it("keeps \"Anna\" and \"anna\" apart while no server said they are one (red before: adopted, the password overwritten)", async () => {
    const anna = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "Anna" });
    const other = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "anna", pass: "hers" });
    expect(other.id).not.toBe(anna.id);
    expect(state.slots.get(anna.id)).toMatchObject({ user: "Anna", pass: "first" });
  });

  it("lets the server decide: one principal is one account, two are two", async () => {
    // A Nextcloud signs in without regard to case: both names reach one principal.
    state.principalOf = () => "https://cloud.example.com/remote.php/dav/principals/users/anna/";
    const first = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "Anna" });
    const again = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "anna", pass: "second" });
    expect(again.id).toBe(first.id);
    expect(state.rows[0].config).toMatchObject({ confirmedPrincipal: "https://cloud.example.com/remote.php/dav/principals/users/anna/" });
    // Radicale tells them apart: two principals, two rows.
    state.rows = []; state.slots.clear();
    state.principalOf = (creds) => `https://dav.example.com/${creds.user}/`;
    const upper = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "Anna" });
    const lower = await connectCalDavAccount(runtime, "/original", { ...nextcloud, user: "anna" });
    expect(lower.id).not.toBe(upper.id);
  });

  it("lands in the row of the card it was started from (the phone's rule, adoptPreferenceForCard)", async () => {
    state.rows = [
      { id: "r1", provider: "caldav", label: "anna", config: { url: nextcloud.url, user: "anna" }, enabled: true },
      { id: "r3", provider: "caldav", label: "anna", config: { url: nextcloud.url, user: "anna" }, enabled: true },
    ];
    const again = await connectCalDavAccount(runtime, "/original", { ...nextcloud, prefer: "r3" });
    expect(again.id).toBe("r3");
    expect(state.rows.map((row) => row.id).sort()).toEqual(["r1", "r3"]);
  });
});
