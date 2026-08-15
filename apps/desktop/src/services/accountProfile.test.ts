import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_FIELD_SCOPE,
  cloudRegistryToLogical,
  emptyAccountMap,
  importAccountMetadata,
  mailAccountsForProfile,
  mergeCloudRegistry,
  pimAccountsForProfile,
  pimSelectionsForProfile,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  setPlatformServices,
  shouldReportOnce,
  shouldReportWaitingAccounts,
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
