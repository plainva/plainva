import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_FIELD_SCOPE,
  accountToAdoptInto,
  adoptAccountInto,
  VERIFIED_PROVIDER_IDENTITY_KEY,
  cloudRegistryToLogical,
  emptyAccountMap,
  importAccountMetadata,
  mailAccountsForProfile,
  mergeCloudRegistry,
  pimAccountsForProfile,
  pimSelectionsForProfile,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  forgetRemovedAccount,
  rememberRemovedAccount,
  removedAccountsForProfile,
  setPlatformServices,
  shouldReportOnce,
  shouldReportWaitingAccounts,
  remapCloudRegistry,
  shouldAnnounceProfileImport,
  defaultCalendarForProfile,
  defaultCalendarFromProfile,
  profileChangeAreaKeys,
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

function ports(initial: {
  pim?: PimAccountRow[];
  mail?: MailAccountConfig[];
  cloud?: CloudAccountRecord[];
  map?: ProfileAccountMap;
} = {}) {
  const state = {
    pim: [...(initial.pim ?? [])],
    mail: [...(initial.mail ?? [])],
    cloud: [...(initial.cloud ?? [])],
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
    deletePimAccount: async (accountId) => {
      state.pim = state.pim.filter((a) => a.id !== accountId);
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
    listCloudAccounts: async () => state.cloud,
    replaceCloudAccounts: async (accounts) => void (state.cloud = [...accounts]),
    pimSecretSlot: (accountId) => `pim-slot:${accountId}`,
    mailSecretSlot: (accountId) => `mail-slot:${accountId}`,
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
    expect(state.map.secretLocalToLogical).toEqual({
      "mail-slot:local-abc": "remote-2",
      "pim-slot:local-xyz": "remote-1",
    });
  });

  it("merges OAuth rows only by verified provider identity and preserves the local client", async () => {
    const verified = { issuer: "google", subject: "provider-user-1" };
    const local = pim({
      id: "local-google",
      provider: "google",
      label: "Old label",
      config: {
        clientId: "desktop-client",
        plainvaVerifiedProviderIdentity: verified,
      },
    });
    const { state, api } = ports({ pim: [local] });

    await importAccountMetadata({
      pimAccounts: [pim({
        id: "logical-google",
        provider: "google",
        label: "New label",
        config: {
          clientId: "foreign-client",
          plainvaVerifiedProviderIdentity: verified,
        },
      })],
    }, api);

    expect(state.pim).toHaveLength(1);
    expect(state.pim[0]).toMatchObject({
      id: "local-google",
      label: "New label",
      config: {
        clientId: "desktop-client",
        plainvaVerifiedProviderIdentity: verified,
      },
    });
    expect(pimAccountsForProfile(state.pim, state.map)[0].config).not.toHaveProperty("clientId");
  });

  it("keeps ambiguous unverified OAuth accounts separate despite equal labels", async () => {
    const local = pim({
      id: "local-google",
      provider: "google",
      label: "Same label",
      config: { clientId: "desktop-client" },
    });
    const { state, api } = ports({ pim: [local] });

    await importAccountMetadata({
      pimAccounts: [pim({
        id: "logical-google",
        provider: "google",
        label: "Same label",
        config: { clientId: "foreign-client" },
      })],
    }, api);

    expect(state.pim.map((account) => account.id)).toEqual([
      "local-google",
      "logical-google",
    ]);
    expect(state.pim[1].config).not.toHaveProperty("clientId");
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

describe("shared account DTO boundary", () => {
  it("classifies local authentication fields and removes them from every shared DTO", () => {
    const map = emptyAccountMap();
    const sharedPim = pimAccountsForProfile([
      pim({ provider: "google", config: { clientId: "local-google-client" } }),
    ], map);
    const sharedMail = mailAccountsForProfile([
      mail({ kind: "microsoft", clientId: "local-microsoft-client" }),
    ], map);
    const sharedCloud = cloudRegistryToLogical([{
      id: "cloud-local",
      family: "google",
      label: "person@example.com",
      byoClientId: "local-cloud-client",
      services: {},
    }], map);

    expect(ACCOUNT_FIELD_SCOPE.pim.clientId).toBe("deviceLocal");
    expect(ACCOUNT_FIELD_SCOPE.mail.clientId).toBe("deviceLocal");
    expect(ACCOUNT_FIELD_SCOPE.cloud.byoClientId).toBe("deviceLocal");
    expect(JSON.stringify({ sharedPim, sharedMail, sharedCloud })).not.toMatch(
      /local-(google|microsoft|cloud)-client/,
    );
    expect(sharedPim[0].config).not.toHaveProperty("clientId");
    expect(sharedMail[0]).not.toHaveProperty("clientId");
    expect(sharedCloud[0]).not.toHaveProperty("byoClientId");
  });

  it("accepts only provider responses that carry a stable subject", () => {
    expect(parseGoogleUserInfo({
      sub: "google-user-1",
      email: "person@example.com",
      email_verified: true,
    })).toEqual({
      identity: { issuer: "google", subject: "google-user-1" },
      label: "person@example.com",
    });
    expect(parseGoogleUserInfo({ email: "person@example.com", email_verified: true })).toBeNull();
    expect(parseMicrosoftMe({
      id: "graph-user-1",
      userPrincipalName: "person@example.com",
    })).toEqual({
      identity: { issuer: "microsoft", subject: "graph-user-1" },
      label: "person@example.com",
    });
    expect(parseMicrosoftMe({ displayName: "Same label" })).toBeNull();
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
    verifiedProviderIdentity: {
      issuer: "https://cloud.example.com",
      subject: "marco",
    },
    services: { calendar: { pimAccountId: "remote-1" }, mail: { mailAccountId: "remote-2" } },
  };

  it("re-points a registry at this device's ids and back again", () => {
    const idMap = { pim: new Map([["remote-1", "local-a"]]), mail: new Map([["remote-2", "local-b"]]) };
    const local = remapCloudRegistry([record], idMap);
    expect(local[0].services.calendar?.pimAccountId).toBe("local-a");
    expect(local[0].services.mail?.mailAccountId).toBe("local-b");

    const map: ProfileAccountMap = {
      pimLocalToLogical: { "local-a": "remote-1" },
      mailLocalToLogical: { "local-b": "remote-2" },
      cloudLocalToLogical: { "local-cloud": "c1" },
      secretLocalToLogical: {},
    };
    local[0].id = "local-cloud";
    const shared = cloudRegistryToLogical(local, map);
    expect(shared[0].id).toBe("c1");
    expect(shared[0].services.calendar?.pimAccountId).toBe("remote-1");
    expect(shared[0].services.mail?.mailAccountId).toBe("remote-2");
  });

  it("leaves an unmapped reference alone instead of dropping the service", () => {
    const local = remapCloudRegistry([record], { pim: new Map(), mail: new Map() });
    expect(local[0].services.calendar?.pimAccountId).toBe("remote-1");
  });

  it("keeps a local cloud id while mapping the shared card and its local services", async () => {
    const localPim = pim({ id: "pim-local" });
    const localMail = mail({ id: "mail-local" });
    const localCloud: CloudAccountRecord = {
      id: "cloud-local",
      family: "webdav",
      label: "marco@example.com",
      verifiedProviderIdentity: record.verifiedProviderIdentity,
      services: {
        calendar: { pimAccountId: localPim.id },
        mail: { mailAccountId: localMail.id },
      },
    };
    const { state, api } = ports({ pim: [localPim], mail: [localMail], cloud: [localCloud] });

    await importAccountMetadata({
      pimAccounts: [pim({ id: "pim-logical" })],
      mailAccounts: [mail({ id: "mail-logical" })],
      cloudAccounts: [{
        ...record,
        id: "cloud-logical",
        services: {
          calendar: { pimAccountId: "pim-logical" },
          mail: { mailAccountId: "mail-logical" },
        },
      }],
    }, api);

    expect(state.cloud).toHaveLength(1);
    expect(state.cloud[0]).toMatchObject({
      id: "cloud-local",
      services: {
        calendar: { pimAccountId: "pim-local" },
        mail: { mailAccountId: "mail-local" },
      },
    });
    expect(state.map.cloudLocalToLogical).toEqual({ "cloud-local": "cloud-logical" });
    expect(cloudRegistryToLogical(state.cloud, state.map)[0]).toMatchObject({
      id: "cloud-logical",
      services: {
        calendar: { pimAccountId: "pim-logical" },
        mail: { mailAccountId: "mail-logical" },
      },
    });
  });
});

/**
 * The registry used to be REPLACED by the document on every import. Both halves
 * of "I signed in again and nothing changed" come from that (finding
 * 2026-07-30): the local card id vanished under the account slot holding the
 * fresh refresh token, and a device that never connected a service stripped it
 * from the device that had it.
 */
describe("cloud registry merge", () => {
  const google = (id: string, services: CloudAccountRecord["services"]): CloudAccountRecord => ({
    id,
    family: "google",
    label: "marco@gmail.com",
    verifiedProviderIdentity: { issuer: "google", subject: "google-user-1" },
    services,
  });

  it("keeps the local id and the local services when both sides know the account", () => {
    const local = google("local-1", { calendar: { pimAccountId: "pim-local" }, files: { provider: "drive" } });
    const incoming = google("other-9", { files: { provider: "drive" } });

    const merged = mergeCloudRegistry([local], [incoming]);

    expect(merged).toHaveLength(1);
    // The id is what the keychain slot with the refresh token hangs off.
    expect(merged[0].id).toBe("local-1");
    // The other device simply has no calendar — that is not an instruction.
    expect(merged[0].services.calendar?.pimAccountId).toBe("pim-local");
  });

  it("adds a service this device does not carry, and records it has never seen", () => {
    const local = google("local-1", { files: { provider: "drive" } });
    const incoming = google("local-1", { mail: { mailAccountId: "mail-local" } });
    const stranger: CloudAccountRecord = {
      id: "ms-1",
      family: "microsoft",
      label: "marco@outlook.com",
      services: { calendar: { pimAccountId: "pim-ms" } },
    };

    const merged = mergeCloudRegistry([local], [incoming, stranger]);

    expect(merged[0].services.mail?.mailAccountId).toBe("mail-local");
    expect(merged.map((r) => r.id)).toEqual(["local-1", "ms-1"]);
  });

  it("never lets the union produce a second file-sync account", () => {
    const local = google("local-1", { files: { provider: "drive" } });
    const other: CloudAccountRecord = {
      id: "dbx-1",
      family: "dropbox",
      label: "marco@example.com",
      services: { files: { provider: "dropbox" } },
    };

    const merged = mergeCloudRegistry([local], [other]);

    expect(merged.filter((r) => r.services.files)).toHaveLength(1);
    expect(merged[0].services.files?.provider).toBe("drive");
  });

  it("does not let an unlabeled card swallow another one", () => {
    const blank: CloudAccountRecord = { id: "a", family: "webdav", label: "", services: {} };
    const incoming: CloudAccountRecord = { id: "b", family: "webdav", label: "", services: { files: { provider: "webdav" } } };

    const merged = mergeCloudRegistry([blank], [incoming]);

    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
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
  it("announces a change once - the same change never again, a different one is news (M5)", () => {
    // A storage stands in for localStorage, so the memory survives a "restart".
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    clearProfileAnnouncement("/vault", storage);
    expect(shouldAnnounceProfileImport("/vault", [], storage)).toBe(false); // nothing changed
    expect(shouldAnnounceProfileImport("/vault", ["dailyNotesFolder"], storage)).toBe(true);
    expect(shouldAnnounceProfileImport("/vault", ["dailyNotesFolder"], storage)).toBe(false); // said it already
    expect(shouldAnnounceProfileImport("/vault", ["mailAccounts"], storage)).toBe(true); // a different change
    expect(shouldAnnounceProfileImport("/other", ["mailAccounts"], storage)).toBe(true); // another vault
    // The phone restarts all day: the memory must outlive the module state.
    expect(shouldAnnounceProfileImport("/vault", ["mailAccounts"], storage)).toBe(false);
    clearProfileAnnouncement("/vault", storage);
    expect(shouldAnnounceProfileImport("/vault", ["mailAccounts"], storage)).toBe(true); // forgotten with the vault
  });

  it("tells the same state arriving again from a new value of the same field (2026-09-04)", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    clearProfileAnnouncement("/vault", storage);
    expect(shouldAnnounceProfileImport("/vault", ["defaultCalendar"], storage, { defaultCalendar: "p1 work" })).toBe(true);
    // The cycle cut the change differently but nothing the user set moved.
    expect(shouldAnnounceProfileImport("/vault", ["defaultCalendar"], storage, { defaultCalendar: "p1 work" })).toBe(false);
    // The same field with another value is news.
    expect(shouldAnnounceProfileImport("/vault", ["defaultCalendar"], storage, { defaultCalendar: "p1 private" })).toBe(true);
    // Key order inside a value does not count as a change.
    expect(shouldAnnounceProfileImport("/vault", ["barLayoutRibbon"], storage, { barLayoutRibbon: { a: 1, b: 2 } })).toBe(true);
    expect(shouldAnnounceProfileImport("/vault", ["barLayoutRibbon"], storage, { barLayoutRibbon: { b: 2, a: 1 } })).toBe(false);
  });

  it("names the areas a change touched, in catalog order, without repeats", () => {
    expect(profileChangeAreaKeys(["mailFolder", "dailyNotesFolder", "templateFolder", "bogus"])).toEqual([
      "settingsSync.area_content",
      "settingsSync.area_mail",
    ]);
    expect(profileChangeAreaKeys(["bogus"])).toEqual([]);
  });
});

describe("an account deleted on this device", () => {
  /**
   * The profile carries the account list as one field, so a device still on an
   * older version keeps publishing the account it has — and every cycle put it
   * back. The user deleted the same dead calendar account again and again
   * (device report 2026-08-15, point 3).
   */
  it("does not come back on the next import", async () => {
    const { state, api } = ports();
    // It arrived from the profile once, which is what gives it a shared id.
    await importAccountMetadata({ pimAccounts: [pim({ id: "logical-1" })] }, api);
    expect(state.pim).toHaveLength(1);

    // Deleted here, exactly as the shells now do it.
    state.pim = [];
    state.map = rememberRemovedAccount(state.map, "pim", "logical-1");

    await importAccountMetadata({ pimAccounts: [pim({ id: "logical-1" })] }, api);
    expect(state.pim).toEqual([]);
  });

  it("comes back once the user adds it again", async () => {
    const { state, api } = ports();
    await importAccountMetadata({ pimAccounts: [pim({ id: "logical-1" })] }, api);
    state.pim = [];
    state.map = rememberRemovedAccount(state.map, "pim", "logical-1");
    // A tombstone that cannot be lifted would make the account unaddable.
    state.map = forgetRemovedAccount(state.map, "logical-1");

    await importAccountMetadata({ pimAccounts: [pim({ id: "logical-1" })] }, api);
    expect(state.pim).toHaveLength(1);
  });

  it("remembers a deletion even for a row this device published itself", async () => {
    // Rewritten deliberately (2026-08-19). The old rule was "no map entry, no
    // tombstone", on the reasoning that a purely local account has nothing to
    // suppress. But a row this device CREATED has no map entry either, and it
    // is published under its local id — so deleting it here left every other
    // device holding it, and the next cycle handed it straight back. A
    // tombstone on an id that was never shared matches nothing and costs
    // nothing; a missing one costs the deletion.
    const { state } = ports({ pim: [pim({ id: "local-only" })] });
    const next = rememberRemovedAccount(state.map, "pim", "local-only");
    expect(next.removedLogical?.["local-only"]).toBeTruthy();
  });
});

describe("a notice that must survive a restart", () => {
  /**
   * The legacy-publisher finding needs a PERSON to clean it up, so a debounce
   * that lives in the process announces it again on every app start — many
   * times a day on a phone (device report 2026-08-15, point 1).
   */
  it("says a durable finding once, across a fresh process", async () => {
    const values: Record<string, unknown> = {};
    const register = (register: typeof setPlatformServices) =>
      register({
        loadSettings: () =>
          Promise.resolve({
            get: <T,>(k: string) => Promise.resolve(values[k] as T | undefined),
            set: async (k: string, v: unknown) => { values[k] = v; },
            delete: async (k: string) => { delete values[k]; return true; },
            keys: () => Promise.resolve(Object.keys(values)),
            save: () => Promise.resolve(),
          }),
        credentials: {
          readSecret: () => Promise.resolve(null),
          writeSecret: () => Promise.resolve(),
          removeSecret: () => Promise.resolve(),
        },
        openExternal: () => Promise.resolve(),
      });
    register(setPlatformServices);

    expect(await shouldReportOnce("legacyPublisher_v", "legacy-publisher")).toBe(true);
    expect(await shouldReportOnce("legacyPublisher_v", "legacy-publisher")).toBe(false);

    // A restart: the module memory is gone, the store is not.
    const restarted = await freshNoticeModule();
    register(restarted.setPlatformServices);
    expect(await restarted.shouldReportOnce("legacyPublisher_v", "legacy-publisher")).toBe(false);

    // Cleaning up re-arms it — the condition can come back.
    await restarted.forgetReportedOnce("legacyPublisher_v");
    expect(await restarted.shouldReportOnce("legacyPublisher_v", "legacy-publisher")).toBe(true);
  });

  it("lets two findings share a key only by forgetting each other", async () => {
    // Why the two legacy notices got their own keys (2026-08-19): the helper
    // remembers ONE fingerprint per key, so two conditions on one key push each
    // other out and both keep firing — cycle after cycle, for something the
    // user had long acted on.
    expect(await shouldReportOnce("shared_v", "finding-a")).toBe(true);
    expect(await shouldReportOnce("shared_v", "finding-b")).toBe(true);
    expect(await shouldReportOnce("shared_v", "finding-a")).toBe(true);

    // Separate keys: each condition is silenced on its own.
    expect(await shouldReportOnce("a_v", "finding-a")).toBe(true);
    expect(await shouldReportOnce("b_v", "finding-b")).toBe(true);
    expect(await shouldReportOnce("a_v", "finding-a")).toBe(false);
    expect(await shouldReportOnce("b_v", "finding-b")).toBe(false);
  });

  it("keeps a transient notice per session", async () => {
    // A network error is worth stating again after a restart, so it must NOT
    // be persisted: the two helpers are deliberately different.
    expect(shouldReportWaitingAccounts("vault", ["a"])).toBe(true);
    expect(shouldReportWaitingAccounts("vault", ["a"])).toBe(false);
    const restarted = await freshNoticeModule();
    expect(restarted.shouldReportWaitingAccounts("vault", ["a"])).toBe(true);
  });
});

/** A module with empty in-memory state — what a cold app start looks like. */
async function freshNoticeModule() {
  vi.resetModules();
  return (await import("@plainva/ui")) as typeof import("@plainva/ui");
}

/**
 * Deletions and identities across devices (P3, finding 2026-08-19).
 *
 * The three rules here are what stopped the phone from breeding calendar rows:
 * a deletion travels, an identity is never lost by absence, and a row this
 * device published is deletable at all.
 */
describe("account profile: deletions travel, identities survive", () => {
  it("removes a row the document says was deleted elsewhere", async () => {
    const { api, state } = ports({
      pim: [pim({ id: "local-1", label: "Google" })],
      map: { ...emptyAccountMap(), pimLocalToLogical: { "local-1": "logical-1" } },
    });

    await importAccountMetadata({ removedAccounts: { "logical-1": "2026-08-19T10:00:00.000Z" } }, api);

    expect(state.pim).toHaveLength(0);
    // And it stays gone: the tombstone is ours now, so the next document that
    // still carries the row does not put it back.
    await importAccountMetadata(
      { pimAccounts: [pim({ id: "logical-1" })], removedAccounts: { "logical-1": "2026-08-19T10:00:00.000Z" } },
      api,
    );
    expect(state.pim).toHaveLength(0);
  });

  it("publishes its own tombstones together with the ones it received", () => {
    const map = { ...emptyAccountMap(), removedLogical: { mine: "2026-08-19T10:00:00.000Z" } };
    const merged = removedAccountsForProfile(map, { theirs: "2026-08-18T10:00:00.000Z" }, new Date("2026-08-19T12:00:00.000Z"));
    // Publishing only our own would resurrect their rows: the field is
    // last-writer-wins as a whole.
    expect(Object.keys(merged).sort()).toEqual(["mine", "theirs"]);
  });

  it("drops tombstones past the retention window instead of carrying them forever", () => {
    const old = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const merged = removedAccountsForProfile(emptyAccountMap(), { ancient: old }, new Date("2026-08-19T12:00:00.000Z"));
    expect(merged).toEqual({});
  });

  it("keeps a verified identity the document does not carry", async () => {
    const identity = { issuer: "google", subject: "sub-1" };
    const { api, state } = ports({
      pim: [pim({ id: "a1", label: "Google", config: { plainvaVerifiedProviderIdentity: identity } })],
      map: { ...emptyAccountMap(), pimLocalToLogical: { a1: "a1" } },
    });

    // An older document from a device that has not seen the sign-in yet.
    await importAccountMetadata({ pimAccounts: [pim({ id: "a1", label: "Google" })] }, api);

    expect(state.pim[0].config.plainvaVerifiedProviderIdentity).toEqual(identity);
  });
});

describe("accountToAdoptInto", () => {
  const identity = { issuer: "https://accounts.google.com", subject: "sub-1" };
  const known = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    provider: "google",
    config: { [VERIFIED_PROVIDER_IDENTITY_KEY]: identity, ...over },
  });

  it("adopts the account the provider says is the same one", () => {
    expect(accountToAdoptInto([known("a1")], { id: "fresh", provider: "google", identity })?.id).toBe("a1");
  });

  it("never adopts without a verified identity — a label is not an identity", () => {
    // Two people at one company share a display name. The settings sync already
    // refuses to merge on a label alone, for exactly this reason.
    //
    // The guard is deliberately doubled: the early return here, and the filter
    // branch that rejects a CANDIDATE without an identity. Removing only the
    // early return leaves this assertion green — the second guard catches it —
    // so a counter-check has to remove both, and then it is the "no identity of
    // its own" case below that falls. Together they measure the behaviour
    // rather than one particular guard.
    expect(accountToAdoptInto([known("a1")], { id: "fresh", provider: "google", identity: null })).toBeNull();
  });

  it("never adopts across providers, even on an identical subject", () => {
    const sameSubjectElsewhere = { ...known("a1"), provider: "microsoft" };
    expect(accountToAdoptInto([sameSubjectElsewhere], { id: "fresh", provider: "google", identity })).toBeNull();
  });

  it("never adopts an account that has no identity of its own", () => {
    expect(
      accountToAdoptInto([{ id: "a1", provider: "google", config: {} }], { id: "fresh", provider: "google", identity })
    ).toBeNull();
  });

  it("never adopts itself", () => {
    expect(accountToAdoptInto([known("fresh")], { id: "fresh", provider: "google", identity })).toBeNull();
  });

  it("picks the same candidate on every device when several match", () => {
    // Two devices reading the same list have to reach the same answer, so the
    // choice is by id rather than by list order.
    const byId = accountToAdoptInto([known("b2"), known("a1")], { id: "fresh", provider: "google", identity });
    expect(byId?.id).toBe("a1");
  });

  it("treats a differently-cased issuer as the same account", () => {
    const upper = known("a1", {
      [VERIFIED_PROVIDER_IDENTITY_KEY]: { issuer: "HTTPS://ACCOUNTS.GOOGLE.COM", subject: "sub-1" },
    });
    expect(accountToAdoptInto([upper], { id: "fresh", provider: "google", identity })?.id).toBe("a1");
  });

  it("keeps a different subject apart — same issuer is not the same person", () => {
    const other = known("a1", {
      [VERIFIED_PROVIDER_IDENTITY_KEY]: { issuer: identity.issuer, subject: "someone-else" },
    });
    expect(accountToAdoptInto([other], { id: "fresh", provider: "google", identity })).toBeNull();
  });
});

describe("adoptAccountInto", () => {
  /** Records what happened and in which order — the order IS the contract. */
  function ports(stored: Record<string, unknown> = {}) {
    const log: string[] = [];
    const slots = new Map(Object.entries(stored));
    return {
      log,
      slots,
      api: {
        getCredentials: async (_v: string, id: string) => {
          log.push(`get:${id}`);
          return slots.get(id) ?? null;
        },
        saveCredentials: async (_v: string, id: string, c: unknown) => {
          log.push(`save:${id}`);
          slots.set(id, c);
        },
        clearCredentials: async (_v: string, id: string) => {
          log.push(`clear:${id}`);
          slots.delete(id);
        },
        reassignRows: async (from: string, to: string) => {
          log.push(`move:${from}->${to}`);
        },
        deleteAccount: async (id: string) => {
          log.push(`deleteAccount:${id}`);
        },
      },
    };
  }

  const OPTS = { vault: "/v", freshId: "fresh", targetId: "old", validatedCreds: { token: "as-validated" } };

  it("writes the ROTATED credential, not the one the caller validated with", async () => {
    // Validating the connection already refreshed the token, and Microsoft
    // rotates on every refresh — the auth provider persisted the new one under
    // the throwaway id. Using the caller's copy would leave the surviving
    // account holding a spent token.
    const p = ports({ fresh: { token: "rotated-during-validation" } });
    await adoptAccountInto(p.api, OPTS);
    expect(p.slots.get("old")).toEqual({ token: "rotated-during-validation" });
  });

  it("falls back to the validated credential when the slot holds nothing", async () => {
    const p = ports();
    await adoptAccountInto(p.api, OPTS);
    expect(p.slots.get("old")).toEqual({ token: "as-validated" });
  });

  it("moves the rows BEFORE deleting the account — calendars cascade on that delete", async () => {
    const p = ports({ fresh: { token: "x" } });
    await adoptAccountInto(p.api, OPTS);
    expect(p.log.indexOf("move:fresh->old")).toBeLessThan(p.log.indexOf("deleteAccount:fresh"));
  });

  it("saves to the target BEFORE clearing the throwaway slot", async () => {
    // A duplicate slot is a tidiness problem; a cleared slot with nothing
    // written yet locks the account out.
    const p = ports({ fresh: { token: "x" } });
    await adoptAccountInto(p.api, OPTS);
    expect(p.log.indexOf("save:old")).toBeLessThan(p.log.indexOf("clear:fresh"));
  });

  it("leaves the throwaway slot empty", async () => {
    const p = ports({ fresh: { token: "x" } });
    await adoptAccountInto(p.api, OPTS);
    expect(p.slots.has("fresh")).toBe(false);
  });

  it("still moves the rows when the credential slot cannot be read", async () => {
    // A keychain that will not answer must not cost the task anchors.
    const p = ports();
    p.api.getCredentials = async () => {
      throw new Error("keychain locked");
    };
    await adoptAccountInto(p.api, OPTS);
    expect(p.log).toContain("move:fresh->old");
    expect(p.slots.get("old")).toEqual({ token: "as-validated" });
  });
});

describe("both shells adopt through the SHARED sequence", () => {
  /**
   * A source-reading guard, because this is the kind of rule a comment cannot
   * hold: the tempting change is to inline "read the slot, save it, move the
   * rows" into one shell, and a second copy would drift silently — the phone
   * would keep a spent Microsoft token, or delete the account before its
   * calendars had moved, and nothing here would go red.
   *
   * What it can prove: both shells call the shared decision and the shared
   * sequence, each exactly once. What it cannot: that someone writes a third,
   * differently-named copy elsewhere. That part is carried by the parity rule
   * in CLAUDE.md — the same honesty the parity catalog states in its own header
   * about the asymmetries nobody entered.
   */
  const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
  const shells = [
    ["desktop", join(repoRoot, "apps", "desktop", "src", "services", "pim", "pimAccounts.ts")],
    ["mobile", join(repoRoot, "apps", "mobile", "src", "services", "pim", "pimService.ts")],
  ] as const;

  it.each(shells)("%s calls adoptAccountInto rather than re-implementing it", (_name, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("accountToAdoptInto(");
    expect(src).toContain("adoptAccountInto(");
    // Exactly once: a second call site would be a second sequence.
    expect(src.match(/adoptAccountInto\(/g)).toHaveLength(1);
  });
});

describe("default calendar across devices (2026-09-04)", () => {
  it("publishes the logical account id and stores the local one", () => {
    const map = { ...emptyAccountMap(), pimLocalToLogical: { "p-local-a": "p1" } };
    expect(defaultCalendarForProfile("p-local-a work", map)).toBe("p1 work");
    // A calendar id may itself contain spaces; only the first token is the account.
    expect(defaultCalendarForProfile("p-local-a Team Kalender", map)).toBe("p1 Team Kalender");
    // No mapping means the local id already IS the logical id (created here).
    expect(defaultCalendarForProfile("p1 work", map)).toBe("p1 work");
    expect(defaultCalendarForProfile("", map)).toBe("");
    expect(defaultCalendarForProfile(undefined, map)).toBeUndefined();

    const minted = new Map([["p1", "p-local-b"]]);
    expect(defaultCalendarFromProfile("p1 work", minted)).toBe("p-local-b work");
    // Unknown account: kept as is, resolved once the account arrives.
    expect(defaultCalendarFromProfile("p9 work", minted)).toBe("p9 work");
    expect(defaultCalendarFromProfile("", minted)).toBe("");
  });

  it("survives a merged account whose local ids differ on the two devices", async () => {
    // Device A created the account ("p1"); device B already had the same
    // account under its own id ("b-77") and merged it by identity on import.
    const { state, api } = ports({ pim: [pim({ id: "b-77" })] });
    const idMap = await importAccountMetadata({ pimAccounts: [pim({ id: "p1" })] }, api);
    expect(idMap.pim.get("p1")).toBe("b-77");

    const arrivedOnB = defaultCalendarFromProfile("p1 work", idMap.pim);
    expect(arrivedOnB).toBe("b-77 work");
    // B's export names the logical id again — byte-for-byte what A published,
    // so neither device sees a change on the next cycle.
    expect(defaultCalendarForProfile(arrivedOnB, state.map)).toBe("p1 work");
  });
});
