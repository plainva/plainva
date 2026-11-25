import { describe, expect, it } from "vitest";
import {
  accountFieldsHeldBack,
  emptyAccountMap,
  fillHeldAccountField,
  reconcileCloudAccounts,
  rememberRemovedAccount,
  restoreAccountsAfterRebuild,
  settleAccountsAfterRebuild,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";

/**
 * The calendar and task accounts of an index database rebuilt at the start
 * (packages/ui/src/lib/accountsAfterRebuild.ts, both shells): their rows went
 * with the damaged database, their sign-ins (keychain) and this device's
 * account map (settings store) did not. They come back from the vault's copy
 * of the profile, through the import a second device runs — under the id this
 * device knew them by, so the sign-in and the account's card stay.
 */

const pim = (over: Partial<PimAccountRow> = {}): PimAccountRow => ({
  id: "remote-1",
  provider: "caldav",
  label: "Nextcloud",
  config: { url: "https://cloud.example.com/dav", user: "me" },
  enabled: true,
  ...over,
});

/** The vault's copy of the profile, as the settings sync wrote it. */
const profileCopy = (values: Record<string, unknown>) =>
  JSON.stringify({ format: "plainva-profile", version: 2, rev: 3, updatedAt: "2026-11-17T09:00:00.000Z", deviceId: "device-a", values });

function scene(map: ProfileAccountMap = emptyAccountMap()) {
  const rows: PimAccountRow[] = [];
  const selected: Array<{ accountId: string; id: string; selected: boolean }> = [{ accountId: "local-xyz", id: "work", selected: true }];
  let rebuild: "held" | "settled" | null = null;
  const state = {
    accountsAfterRebuild: async () => rebuild,
    setAccountsAfterRebuild: async (next: "held" | "settled") => { rebuild = next; },
  };
  const ports: AccountImportPorts = {
    listPimAccounts: async () => rows,
    upsertPimAccount: async (row) => {
      const i = rows.findIndex((a) => a.id === row.id);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
    },
    deletePimAccount: async (id) => { rows.splice(rows.findIndex((a) => a.id === id), 1); },
    listCalendars: async (accountId) => selected.filter((c) => c.accountId === accountId),
    setCalendarSelected: async (accountId, id, value) => {
      const c = selected.find((x) => x.accountId === accountId && x.id === id);
      if (c) c.selected = value;
    },
    listTaskLists: async () => [],
    setTaskListSelected: async () => {},
    listMailAccounts: async () => [],
    replaceMailAccounts: async () => {},
    removeMailSecret: async () => undefined,
    listCloudAccounts: async () => [],
    replaceCloudAccounts: async () => {},
    pimSecretSlot: (id) => `pim-slot:${id}`,
    mailSecretSlot: (id) => `mail-slot:${id}`,
    loadAccountMap: async () => map,
    saveAccountMap: async (next) => { map = next; },
    newId: () => "generated",
  };
  return { rows, selected, state, ports, get rebuild() { return rebuild; } };
}

describe("the accounts of a rebuilt index database", () => {
  it("come back from the vault's copy of the profile, under the id this device knew them by, with their choices", async () => {
    const s = scene({ ...emptyAccountMap(), pimLocalToLogical: { "local-xyz": "remote-1" } });
    const outcome = await restoreAccountsAfterRebuild({ settingsSyncRuns: true,
      state: s.state,
      ports: s.ports,
      readProfileCopy: async () => profileCopy({ pimAccounts: [pim()], pimSelections: { calendars: [{ accountId: "remote-1", id: "work", selected: false }], taskLists: [] } }),
    });
    expect(outcome).toBe("restored");
    expect(s.rows.map((r) => r.id), "the sign-in hangs off this id").toEqual(["local-xyz"]);
    expect(s.selected.find((c) => c.id === "work")?.selected, "the calendar choice comes back too").toBe(false);
    expect(s.rebuild, "held until the settings sync has applied the document").toBe("held");
  });

  it("an account removed here on purpose stays removed", async () => {
    const map = rememberRemovedAccount({ ...emptyAccountMap(), pimLocalToLogical: { "local-xyz": "remote-1" } }, "pim", "local-xyz");
    const s = scene(map);
    await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => profileCopy({ pimAccounts: [pim()] }) });
    expect(s.rows).toEqual([]);
  });

  it.each([
    ["no copy", async () => null],
    ["a copy that is no profile", async () => "{ not json"],
    ["a profile without accounts", async () => profileCopy({ theme: "dark" })],
  ])("%s: nothing is restored, and nothing stops", async (_label, readProfileCopy) => {
    const s = scene();
    await expect(restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy })).resolves.toBe("nothing");
    expect(s.rows).toEqual([]);
    expect(s.rebuild, "still held: the settings sync may bring them").toBe("held");
  });

  it("runs once per rebuilt database: a later open leaves the accounts to the settings sync", async () => {
    const s = scene();
    await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => null });
    const again = await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => profileCopy({ pimAccounts: [pim()] }) });
    expect(again).toBe("already");
    expect(s.rows).toEqual([]);
  });

  it("held, the account fields are no edit of this device's; after the first settings-sync cycle they are again", async () => {
    const s = scene();
    expect(await accountFieldsHeldBack(s.state)).toEqual([]);
    await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => null });
    expect(await accountFieldsHeldBack(s.state)).toEqual(["pimAccounts", "pimSelections"]);
    await settleAccountsAfterRebuild(s.state);
    expect(await accountFieldsHeldBack(s.state)).toEqual([]);
    expect(await accountFieldsHeldBack(null)).toEqual([]);
  });

  it("the account's card stays the same one, and no second card appears", async () => {
    const s = scene({ ...emptyAccountMap(), pimLocalToLogical: { "local-xyz": "remote-1" } });
    const card: CloudAccountRecord = { id: "card-1", family: "webdav", label: "me@cloud.example.com", services: { calendar: { pimAccountId: "local-xyz" } } };
    await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => profileCopy({ pimAccounts: [pim()] }) });
    const next = reconcileCloudAccounts([card], { pim: s.rows.map((r) => ({ id: r.id, provider: "caldav" as const, label: r.label })), mail: [] });
    expect(next).toEqual([card]);
  });

  it("held, only what the rebuild took is filled in from the document; what this device says of an account it knows stands", () => {
    const doc = { calendars: [{ accountId: "remote-1", id: "home", selected: true }, { accountId: "remote-1", id: "work", selected: true }], taskLists: [] };
    expect(fillHeldAccountField("pimSelections", doc, { calendars: [], taskLists: [] }, new Set()), "nothing known here: the document's").toEqual(doc);
    expect(fillHeldAccountField("pimSelections", doc, { calendars: [{ accountId: "remote-1", id: "work", selected: false }], taskLists: [] }, new Set())).toEqual({
      calendars: [{ accountId: "remote-1", id: "home", selected: true }, { accountId: "remote-1", id: "work", selected: false }],
      taskLists: [],
    });
    expect(fillHeldAccountField("pimSelections", doc, { calendars: [], taskLists: [] }, new Set(["remote-1"])), "nothing of an account removed on purpose").toEqual({ calendars: [], taskLists: [] });
    const accounts = [pim({ id: "remote-1" }), pim({ id: "remote-2", label: "Other", config: { url: "https://other.example.com/dav", user: "x" } })];
    const here = [pim({ id: "remote-1", label: "Renamed here" })];
    const filled = fillHeldAccountField("pimAccounts", accounts, here, new Set()) as PimAccountRow[];
    expect(filled.map((a) => [a.id, a.label]).sort()).toEqual([["remote-1", "Renamed here"], ["remote-2", "Other"]]);
    expect(fillHeldAccountField("pimAccounts", accounts, here, new Set(["remote-2"]))).toEqual(here);
  });

  it("where no settings-sync cycle can come, nothing is held after the restore: an account that did not come back is gone here", async () => {
    const s = scene({ ...emptyAccountMap(), pimLocalToLogical: { "local-xyz": "remote-1" } });
    await restoreAccountsAfterRebuild({ settingsSyncRuns: false, state: s.state, ports: s.ports, readProfileCopy: async () => null });
    expect(s.rebuild).toBe("settled");
    // The card no longer names a calendar that is not here.
    const card: CloudAccountRecord = { id: "card-1", family: "webdav", label: "me@cloud.example.com", services: { calendar: { pimAccountId: "local-xyz" } } };
    expect(reconcileCloudAccounts([card], { pim: [], mail: [] })).toEqual([]);
  });

  it("held at an earlier open, and the settings sync is off since: the attempt is over at the next open", async () => {
    const s = scene();
    await restoreAccountsAfterRebuild({ settingsSyncRuns: true, state: s.state, ports: s.ports, readProfileCopy: async () => null });
    expect(s.rebuild).toBe("held");
    await restoreAccountsAfterRebuild({ settingsSyncRuns: false, state: s.state, ports: s.ports, readProfileCopy: async () => null });
    expect(s.rebuild).toBe("settled");
  });

  it("a copy that cannot be read now: nothing restored, still held — without a settings sync too, until a try that could read it", async () => {
    const s = scene();
    const unreadable = async (): Promise<string | null> => { throw new Error("the sealed settings profile cannot be opened without the key"); };
    expect(await restoreAccountsAfterRebuild({ settingsSyncRuns: false, state: s.state, ports: s.ports, readProfileCopy: unreadable })).toBe("unreadable");
    expect(s.rebuild, "the references stay: the next open tries again").toBe("held");
    expect(await restoreAccountsAfterRebuild({ settingsSyncRuns: false, state: s.state, ports: s.ports, readProfileCopy: async () => profileCopy({ pimAccounts: [pim()] }) })).toBe("restored");
    expect(s.rows.map((r) => r.id)).toEqual(["remote-1"]);
    expect(s.rebuild).toBe("settled");
  });
});
