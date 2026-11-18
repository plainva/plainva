import { describe, expect, it } from "vitest";
import { PROFILE_SYNC_PATH, parseProfile, type ProfileSettingsPort } from "../src/index.js";
import { CountingSyncTarget, profileHarnessDevice, runProfileCycle } from "./support/settingsSyncHarness.js";

/**
 * A device whose index database was rebuilt at the start (both shells) has
 * lost its calendar accounts with the database's rows: it exports
 * `pimAccounts: []`. That is no edit of its own. Published, the empty list was
 * the newest entry of the field and won on every device; with one device the
 * accounts were gone. Held back (`ProfileSettingsPort.heldBack`), the
 * document's value stands and is applied here instead.
 */

const ACCOUNTS = [{ id: "cal-1", provider: "caldav", label: "Nextcloud" }];

/** A port over an in-memory store; `held` names the fields it cannot speak for. */
function port(store: Record<string, unknown>, held: () => string[] = () => []) {
  const applied: Array<Record<string, unknown>> = [];
  const api: ProfileSettingsPort = {
    exportValues: async () => ({ ...store }),
    applyValues: async (values) => {
      applied.push(values);
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, values);
    },
    heldBack: async () => held(),
  };
  return { api, applied };
}

const remoteValues = (target: CountingSyncTarget) => {
  const bytes = target.remote.get(PROFILE_SYNC_PATH);
  return parseProfile(bytes ? new TextDecoder().decode(bytes) : null)?.values ?? null;
};

describe("a field held back after the index database was rebuilt", () => {
  it("two devices: the document never takes the empty list from the rebuilt one, and the rebuilt one gets the accounts back", async () => {
    const target = new CountingSyncTarget();
    const storeA: Record<string, unknown> = { theme: "dark", pimAccounts: ACCOUNTS };
    const storeB: Record<string, unknown> = {};
    let rebuilt = false;
    const a = profileHarnessDevice("device-a", port(storeA, () => (rebuilt ? ["pimAccounts", "pimSelections"] : [])).api);
    const b = profileHarnessDevice("device-b", port(storeB).api);
    await runProfileCycle(target, a, "2026-11-17T10:00:00.000Z");
    await runProfileCycle(target, b, "2026-11-17T10:01:00.000Z");
    expect(storeB.pimAccounts).toEqual(ACCOUNTS);

    // Here the index database is rebuilt: the accounts' rows are gone.
    storeA.pimAccounts = [];
    rebuilt = true;
    await runProfileCycle(target, a, "2026-11-17T10:02:00.000Z");
    expect(remoteValues(target)?.pimAccounts, "the document keeps the accounts").toEqual(ACCOUNTS);
    expect(storeA.pimAccounts, "and the rebuilt device takes them back").toEqual(ACCOUNTS);

    await runProfileCycle(target, b, "2026-11-17T10:03:00.000Z");
    expect(storeB.pimAccounts).toEqual(ACCOUNTS);
    expect(remoteValues(target)?.theme, "the fields it can speak for go on as ever").toBe("dark");
  });

  it("one device alone: its own copy of the document brings the accounts back", async () => {
    const target = new CountingSyncTarget();
    const store: Record<string, unknown> = { pimAccounts: ACCOUNTS };
    let rebuilt = false;
    const a = profileHarnessDevice("device-a", port(store, () => (rebuilt ? ["pimAccounts"] : [])).api);
    await runProfileCycle(target, a, "2026-11-17T10:00:00.000Z");
    store.pimAccounts = [];
    rebuilt = true;
    await runProfileCycle(target, a, "2026-11-17T10:02:00.000Z");
    expect(store.pimAccounts).toEqual(ACCOUNTS);
    expect(remoteValues(target)?.pimAccounts).toEqual(ACCOUNTS);
  });

  it("not held, the empty list is an edit like any other — the case the hold is for", async () => {
    const target = new CountingSyncTarget();
    const store: Record<string, unknown> = { pimAccounts: ACCOUNTS };
    const a = profileHarnessDevice("device-a", port(store).api);
    await runProfileCycle(target, a, "2026-11-17T10:00:00.000Z");
    store.pimAccounts = [];
    await runProfileCycle(target, a, "2026-11-17T10:02:00.000Z");
    expect(remoteValues(target)?.pimAccounts).toEqual([]);
  });
});
