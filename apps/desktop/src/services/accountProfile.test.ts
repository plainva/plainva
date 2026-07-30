import { describe, expect, it } from "vitest";
import {
  cloudRegistryToLogical,
  emptyAccountMap,
  importAccountMetadata,
  mailAccountsForProfile,
  pimAccountsForProfile,
  pimSelectionsForProfile,
  remapCloudRegistry,
  shouldAnnounceProfileImport,
  clearProfileAnnouncement,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ProfileAccountMap,
} from "@plainva/ui";
import type { PimAccountRow } from "@plainva/core";
import type { MailAccountConfig } from "@plainva/ui/mail";

/**
 * The shared account import — the piece that was missing on mobile entirely,
 * which is why a phone kept asking the user to create every calendar and
 * mailbox by hand. Both shells run this code now, so these tests cover both.
 *
 * The hard part is identity: ids are device-local (they end up in keychain slot
 * names), so the SAME account legitimately has different ids on two devices.
 * Matching on id alone would duplicate accounts forever; matching too loosely
 * would rebind a calendar to the wrong server.
 */

function ports(initial: { pim?: PimAccountRow[]; mail?: MailAccountConfig[]; map?: ProfileAccountMap } = {}) {
  const state = {
    pim: [...(initial.pim ?? [])],
    mail: [...(initial.mail ?? [])],
    map: initial.map ?? emptyAccountMap(),
    calendars: [] as Array<{ accountId: string; id: string; selected: boolean }>,
  };
  let counter = 0;
  const api: AccountImportPorts = {
    listPimAccounts: async () => state.pim,
    upsertPimAccount: async (row) => {
      const i = state.pim.findIndex((a) => a.id === row.id);
      if (i >= 0) state.pim[i] = row;
      else state.pim.push(row);
    },
    listCalendars: async (accountId) => state.calendars.filter((c) => c.accountId === accountId),
    setCalendarSelected: async (accountId, id, selected) => {
      const c = state.calendars.find((x) => x.accountId === accountId && x.id === id);
      if (c) c.selected = selected;
    },
    listTaskLists: async () => [],
    setTaskListSelected: async () => {},
    listMailAccounts: async () => state.mail,
    replaceMailAccounts: async (accounts) => void (state.mail = [...accounts]),
    loadAccountMap: async () => state.map,
    saveAccountMap: async (map) => void (state.map = map),
    newId: () => `gen-${++counter}`,
  };
  return { state, api };
}

const pim = (over: Partial<PimAccountRow> = {}): PimAccountRow => ({
  id: "p1",
  provider: "caldav",
  label: "Nextcloud",
  config: { url: "https://cloud.example.com/dav", user: "marco" },
  enabled: true,
  ...over,
});

const mail = (over: Partial<MailAccountConfig> = {}): MailAccountConfig => ({
  id: "m1",
  label: "Mailbox",
  host: "imap.example.com",
  port: 993,
  user: "marco@example.com",
  ...over,
});

describe("shared account import", () => {
  it("creates accounts a device does not have yet", async () => {
    const { state, api } = ports();
    await importAccountMetadata({ pimAccounts: [pim()], mailAccounts: [mail()] }, api);
    expect(state.pim.map((a) => a.label)).toEqual(["Nextcloud"]);
    expect(state.mail.map((a) => a.user)).toEqual(["marco@example.com"]);
  });

  it("recognises the same account under a different id and keeps the local one", async () => {
    // The keychain slot hangs off the local id, so adopting the foreign id
    // would orphan the password that is already stored here.
    const { state, api } = ports({ pim: [pim({ id: "local-xyz" })], mail: [mail({ id: "local-abc" })] });
    const idMap = await importAccountMetadata({ pimAccounts: [pim({ id: "remote-1" })], mailAccounts: [mail({ id: "remote-2" })] }, api);

    expect(state.pim).toHaveLength(1);
    expect(state.pim[0].id).toBe("local-xyz");
    expect(state.mail).toHaveLength(1);
    expect(state.mail[0].id).toBe("local-abc");
    expect(idMap.pim.get("remote-1")).toBe("local-xyz");
    expect(idMap.mail.get("remote-2")).toBe("local-abc");
  });

  it("gives a foreign account a fresh id when an unrelated local account already uses it", async () => {
    const { state, api } = ports({ pim: [pim({ id: "p1", label: "Something else", config: { url: "https://other.example.com/dav", user: "x" } })] });
    const idMap = await importAccountMetadata({ pimAccounts: [pim({ id: "p1" })] }, api);

    expect(state.pim).toHaveLength(2); // the local one was not overwritten
    expect(idMap.pim.get("p1")).toBe("gen-1");
  });

  it("keeps a mailbox that only exists on this device", async () => {
    // The profile is a shared truth, not an authority over what only lives here.
    const { state, api } = ports({ mail: [mail({ id: "local-only", user: "private@example.com" })] });
    await importAccountMetadata({ mailAccounts: [mail()] }, api);
    expect(state.mail.map((a) => a.user).sort()).toEqual(["marco@example.com", "private@example.com"]);
  });

  it("carries the calendar selection, parking it until the calendars exist", async () => {
    const { state, api } = ports();
    await importAccountMetadata(
      { pimAccounts: [pim()], pimSelections: { calendars: [{ accountId: "p1", id: "cal-1", selected: true }], taskLists: [] } },
      api
    );
    // The calendars themselves only appear after that account's first sync, so
    // the choice rides along in the row until then.
    expect(state.pim[0].config.plainvaPendingCalendarSelections).toEqual({ "cal-1": true });
  });

  it("clears a parked selection once it could be applied", async () => {
    // Parking is right while the calendars do not exist yet — but a choice that
    // HAS been applied must leave the row: it used to sit there forever and ride
    // along on every export, so the document differed from what was just
    // published, every cycle (report 2026-07-29).
    const { state, api } = ports();
    state.calendars.push({ accountId: "p1", id: "cal-1", selected: false });
    await importAccountMetadata(
      { pimAccounts: [pim()], pimSelections: { calendars: [{ accountId: "p1", id: "cal-1", selected: true }], taskLists: [] } },
      api
    );
    expect(state.calendars[0].selected).toBe(true);
    expect(state.pim[0].config.plainvaPendingCalendarSelections).toBeUndefined();
  });

  it("keeps parking the part that could NOT be applied", async () => {
    const { state, api } = ports();
    state.calendars.push({ accountId: "p1", id: "cal-1", selected: false });
    await importAccountMetadata(
      {
        pimAccounts: [pim()],
        pimSelections: { calendars: [{ accountId: "p1", id: "cal-1", selected: true }, { accountId: "p1", id: "cal-2", selected: true }], taskLists: [] },
      },
      api
    );
    expect(state.pim[0].config.plainvaPendingCalendarSelections).toEqual({ "cal-2": true });
  });

  it("accepts a Microsoft mailbox, which carries no host or port", async () => {
    const { state, api } = ports();
    await importAccountMetadata({ mailAccounts: [mail({ id: "ms", host: "", port: 0, kind: "microsoft", user: "me@outlook.com" })] }, api);
    expect(state.mail).toHaveLength(1);
  });

  it("ignores a malformed row rather than failing the whole import", async () => {
    const { state, api } = ports();
    await importAccountMetadata({ pimAccounts: [pim(), { id: 5 }], mailAccounts: [mail(), null] }, api);
    expect(state.pim).toHaveLength(1);
    expect(state.mail).toHaveLength(1);
  });
});

describe("cloud registry id mapping", () => {
  const record: CloudAccountRecord = {
    // Nextcloud is a WebDAV flavor, not a family of its own — which is exactly
    // the distinction the phone could not make while it derived its registry.
    id: "c1",
    family: "webdav",
    flavor: "nextcloud",
    label: "marco@example.com",
    services: { calendar: { pimAccountId: "remote-1" }, mail: { mailAccountId: "remote-2" } },
  };

  it("re-points a registry at this device's ids and back again", () => {
    const idMap = { pim: new Map([["remote-1", "local-a"]]), mail: new Map([["remote-2", "local-b"]]) };
    const local = remapCloudRegistry([record], idMap);
    expect(local[0].services.calendar?.pimAccountId).toBe("local-a");
    expect(local[0].services.mail?.mailAccountId).toBe("local-b");

    const map: ProfileAccountMap = { pimLocalToLogical: { "local-a": "remote-1" }, mailLocalToLogical: { "local-b": "remote-2" } };
    const shared = cloudRegistryToLogical(local, map);
    expect(shared[0].services.calendar?.pimAccountId).toBe("remote-1");
    expect(shared[0].services.mail?.mailAccountId).toBe("remote-2");
  });

  it("leaves an unmapped reference alone instead of dropping the service", () => {
    const local = remapCloudRegistry([record], { pim: new Map(), mail: new Map() });
    expect(local[0].services.calendar?.pimAccountId).toBe("remote-1");
  });
});

/**
 * The export SHAPE is what makes the profile round-trip: order must not depend
 * on the device, and device state must not travel (report 2026-07-29 — the
 * repeating "settings synced" toast).
 */
describe("export shape", () => {
  const map = emptyAccountMap();

  it("orders mail accounts by identity, not by local order", () => {
    const a = mail({ id: "x", host: "imap.zeta.org", user: "z@zeta.org" });
    const b = mail({ id: "y", host: "imap.alpha.org", user: "a@alpha.org" });
    expect(mailAccountsForProfile([a, b], map).map((r) => r.id)).toEqual(["y", "x"]);
    // The reverse local order produces the SAME document — that is the point.
    expect(mailAccountsForProfile([b, a], map).map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("strips parked device state from an exported account row", () => {
    const row = pim({ config: { url: "https://cloud.example.com/dav", user: "marco", plainvaPendingCalendarSelections: { "cal-1": true } } });
    const out = pimAccountsForProfile([row], map);
    expect(out[0].config.plainvaPendingCalendarSelections).toBeUndefined();
    expect(out[0].config.url).toBe("https://cloud.example.com/dav");
    // …and the local row is untouched: parking still works.
    expect(row.config.plainvaPendingCalendarSelections).toEqual({ "cal-1": true });
  });

  it("orders selections deterministically", () => {
    const rows = [
      { accountId: "p2", id: "b", selected: true },
      { accountId: "p1", id: "z", selected: false },
      { accountId: "p1", id: "a", selected: true },
    ];
    expect(pimSelectionsForProfile(rows, [], map).calendars.map((r) => `${r.accountId}/${r.id}`)).toEqual(["p1/a", "p1/z", "p2/b"]);
  });
});

describe("adoption notice policy", () => {
  it("announces once per session and vault, and only for a real change", () => {
    clearProfileAnnouncement("/vault");
    expect(shouldAnnounceProfileImport("/vault", [])).toBe(false); // nothing changed
    expect(shouldAnnounceProfileImport("/vault", ["dailyNotesFolder"])).toBe(true);
    expect(shouldAnnounceProfileImport("/vault", ["mailAccounts"])).toBe(false); // said it already
    expect(shouldAnnounceProfileImport("/other", ["mailAccounts"])).toBe(true); // another vault
    clearProfileAnnouncement("/vault");
    expect(shouldAnnounceProfileImport("/vault", ["mailAccounts"])).toBe(true); // reopened
  });
});
