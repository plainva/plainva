// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { stableStringify } from "@plainva/core";
import type { PimAccountRow } from "@plainva/core";
import { setPlatformServices, type ISettingsStore } from "@plainva/ui";
import { mailAccountsKey, type MailAccountConfig } from "@plainva/ui/mail";
import { exportProfileValues, applyProfileValues } from "./settingsProfile";
import { cloudAccountsRegistryKey } from "./cloudAccounts";
import { dailyNotesFolderKey, taskDatabaseKey } from "../contexts/VaultContext";

/**
 * Roundtrip stability of the settings profile: `export → apply → export` has to
 * come back byte-identical.
 *
 * This is the test the toast complaint asked for (report 2026-07-29: "settings
 * synced" every ~30 seconds on a device where nothing changed). A cycle exports
 * the local state, reconciles it with the document and applies the result; if
 * applying its OWN values produces a different export, the next cycle sees a
 * difference again — forever. So the loop is not a notification bug, it is an
 * export that does not round-trip, and this file names the field responsible.
 *
 * The comparison uses `stableStringify` on purpose: it sorts object KEYS, so a
 * different property order is not counted as a difference — but it keeps ARRAY
 * order, because order is data (a list of accounts a user arranged).
 *
 * Only the platform edge is mocked (the Tauri-backed store): the cloud registry
 * and the diagnostics record reach for the app-wide store directly rather than
 * through the injected one, and mocking the module they use keeps the code under
 * test untouched.
 */

vi.mock("./settingsStore", () => ({
  STORE_KEY: "test-settings.json",
  getSettingsStore: async () => platformStore,
}));

function fakeStore(): ISettingsStore & {
  map: Map<string, unknown>;
  writes: Array<{ key: string; value: unknown }>;
} {
  const map = new Map<string, unknown>();
  const writes: Array<{ key: string; value: unknown }> = [];
  return {
    map,
    writes,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
      writes.push({ key, value: structuredClone(value) });
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
    async save() {},
  };
}

/** Just enough PIM runtime for the account half of the profile. */
function fakePim(
  accounts: PimAccountRow[] = [],
  calendars: Array<{ accountId: string; id: string; selected: boolean }> = [],
  failUpsert = false,
) {
  const state = { accounts: [...accounts], calendars: [...calendars] };
  return {
    state,
    runtime: {
      cache: {
        listAccounts: async () => state.accounts,
        upsertAccount: async (row: PimAccountRow) => {
          if (failUpsert) throw new Error("injected import failure");
          const i = state.accounts.findIndex((a) => a.id === row.id);
          if (i >= 0) state.accounts[i] = row;
          else state.accounts.push(row);
        },
        deleteAccount: async (id: string) => void (state.accounts = state.accounts.filter((a) => a.id !== id)),
        listCalendars: async (accountId?: string) => (accountId ? state.calendars.filter((c) => c.accountId === accountId) : state.calendars),
        setCalendarSelected: async (accountId: string, id: string, selected: boolean) => {
          const c = state.calendars.find((x) => x.accountId === accountId && x.id === id);
          if (c) c.selected = selected;
        },
        listTaskLists: async () => [],
        setTaskListSelected: async () => {},
      },
    } as never,
  };
}

/** A raw vault adapter that only has to carry the bookmarks file. */
function fakeVault(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(".plainva/bookmarks.json", initial);
  return {
    files,
    adapter: {
      async readTextFile(path: string) {
        const text = files.get(path);
        if (text === undefined) throw new Error(`not found: ${path}`);
        return text;
      },
      async writeTextFile(path: string, text: string) {
        files.set(path, text);
      },
      async exists(path: string) {
        return files.has(path);
      },
      async deleteItem(path: string) {
        files.delete(path);
      },
    } as never,
  };
}

const V = "C:/Users/x/My Vault";

/** The mail half reads its accounts through the platform registry, so the same
 *  in-memory store has to answer there too — otherwise the import reads an
 *  empty account list and the roundtrip would look stable for the wrong reason. */
let platformStore = fakeStore();
function registerPlatformStore(store: ISettingsStore) {
  platformStore = store as ReturnType<typeof fakeStore>;
}
beforeEach(() => {
  setPlatformServices({
    loadSettings: async () => platformStore,
    credentials: {
      readSecret: async () => null,
      writeSecret: async () => {},
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
});

const pimAccount = (over: Partial<PimAccountRow> = {}): PimAccountRow => ({
  id: "p1",
  provider: "caldav",
  label: "Nextcloud",
  config: { url: "https://cloud.example.org/dav", user: "marco" },
  enabled: true,
  ...over,
});

const mailAccount = (over: Partial<MailAccountConfig> = {}): MailAccountConfig => ({
  id: "m1",
  label: "Work",
  host: "imap.example.org",
  port: 993,
  user: "marco@example.org",
  ...over,
});

/** Names the fields that differ, so a failure says WHICH setting is unstable. */
function unstableFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((n) => stableStringify(before[n]) !== stableStringify(after[n])).sort();
}

/** The failure message carries the two values — a name alone rarely explains why. */
function report(before: Record<string, unknown>, after: Record<string, unknown>): string {
  return unstableFields(before, after)
    .map((n) => [n, `  exported: ${stableStringify(before[n])}`, `  again:    ${stableStringify(after[n])}`].join("\n"))
    .join("\n");
}

describe("settings profile roundtrip", () => {
  /** Every field family at once — the state an ordinary vault is in. */
  async function seededStore() {
    const store = fakeStore();
    await store.set(dailyNotesFolderKey(V), "Journal");
    await store.set(taskDatabaseKey(V), "Tasks.base");
    await store.set(mailAccountsKey(V), [mailAccount()]);
    await store.set(cloudAccountsRegistryKey(V), [
      { id: "c1", family: "webdav", flavor: "nextcloud", label: "marco@example.org", services: { calendar: { pimAccountId: "p1" }, mail: { mailAccountId: "m1" } } },
    ]);
    registerPlatformStore(store);
    return store;
  }

  it("is stable for settings, the cloud registry and bookmarks", async () => {
    const store = await seededStore();
    const vault = fakeVault(JSON.stringify({ items: ["Notes/Alpha.md"] }));
    const context = { rawVault: vault.adapter };

    const first = await exportProfileValues(store, V, context);
    await applyProfileValues(store, V, first, context);
    const second = await exportProfileValues(store, V, context);

    expect(unstableFields(first, second), report(first, second)).toEqual([]);
  });

  /**
   * The P2.1 finding, fixed in P2.2: the import parked the calendar choice in
   * the account row as `config.plainvaPendingCalendarSelections` — right, since
   * the calendars only exist after that account's first sync — but the row was
   * then EXPORTED with it, so the document differed from what had just been
   * published, every cycle, on a device where nothing had changed. The parked
   * state now stays out of the export and is cleared once applied.
   */
  it("applying its own export changes nothing (accounts included)", async () => {
    const store = await seededStore();
    const pim = fakePim([pimAccount()], [{ accountId: "p1", id: "cal-1", selected: true }]);
    const vault = fakeVault(JSON.stringify({ items: ["Notes/Alpha.md"] }));
    const context = { pimRuntime: pim.runtime, rawVault: vault.adapter };

    const first = await exportProfileValues(store, V, context);
    await applyProfileValues(store, V, first, context);
    const second = await exportProfileValues(store, V, context);

    expect(unstableFields(first, second), report(first, second)).toEqual([]);
  });

  it("T13 keeps OAuth credentials out of the durable profile-import snapshot", async () => {
    const store = fakeStore();
    const localPim = pimAccount({
      provider: "google",
      config: {
        user: "person@example.invalid",
        clientId: "pim-client-marker",
        clientSecret: "pim-secret-marker",
        refreshToken: "pim-refresh-marker",
        accessToken: "pim-access-marker",
      },
    });
    const pim = fakePim([localPim], [], true);
    await store.set(mailAccountsKey(V), [
      mailAccount({ kind: "microsoft", clientId: "mail-client-marker" }),
    ]);
    await store.set(cloudAccountsRegistryKey(V), [{
      id: "cloud-local",
      family: "google",
      label: "person@example.invalid",
      byoClientId: "cloud-client-marker",
      services: {},
    }]);
    registerPlatformStore(store);

    await expect(applyProfileValues(store, V, {
      pimAccounts: [pimAccount({
        id: "logical-google",
        provider: "google",
        label: "person@example.invalid",
        config: { user: "person@example.invalid" },
      })],
    }, { pimRuntime: pim.runtime })).rejects.toThrow("injected import failure");

    const journalWrite = store.writes.find(({ key }) => key.startsWith("settingsSyncImportJournal_"));
    expect(journalWrite).toBeDefined();
    const serialized = JSON.stringify(journalWrite);
    for (const marker of [
      "pim-client-marker",
      "pim-secret-marker",
      "pim-refresh-marker",
      "pim-access-marker",
      "mail-client-marker",
      "cloud-client-marker",
    ]) {
      expect(serialized).not.toContain(marker);
    }
  });

  /**
   * The other half of the P2.1 finding: a device legitimately has a mailbox the
   * document does not carry, and the import KEEPS it (the profile is a shared
   * truth, not an authority over what only lives here) — but it used to put the
   * local-only account FIRST. So the order depended on which extra accounts a
   * device happened to have, two such devices kept overwriting each other's
   * order, and every cycle looked like a change.
   *
   * The first cycle after such a merge MUST differ (the local account joins the
   * document — that is the point). What has to hold is that it then stops: one
   * more cycle reaches a fixed point.
   */
  it("reaches a fixed point after adopting a document that lacked a local account", async () => {
    const store = await seededStore();
    // Local-only mailbox, listed AFTER the shared one.
    await store.set(mailAccountsKey(V), [mailAccount(), mailAccount({ id: "m2", label: "Private", host: "imap.other.org", user: "me@other.org" })]);
    const pim = fakePim([pimAccount()]);
    const context = { pimRuntime: pim.runtime, rawVault: fakeVault().adapter };

    const first = await exportProfileValues(store, V, context);
    // What the OTHER device publishes: only the shared mailbox.
    await applyProfileValues(store, V, { ...first, mailAccounts: [mailAccount()] }, context);
    const merged = await exportProfileValues(store, V, context);
    expect((merged.mailAccounts as MailAccountConfig[]).map((a) => a.id)).toEqual(["m1", "m2"]);

    // …and from here nothing moves any more.
    await applyProfileValues(store, V, merged, context);
    const again = await exportProfileValues(store, V, context);
    expect(unstableFields(merged, again), report(merged, again)).toEqual([]);
  });

  /**
   * Two devices, each with a mailbox the other does not have. This is the shape
   * behind the repeating toast: with a device-dependent order they traded writes
   * forever. Sorted by identity, both publish the same document — so the second
   * exchange has nothing left to carry.
   */
  it("converges between two devices with different extra accounts", async () => {
    const shared = mailAccount();
    const onlyA = mailAccount({ id: "a-only", label: "A", host: "imap.a.org", user: "me@a.org" });
    const onlyB = mailAccount({ id: "b-only", label: "B", host: "imap.b.org", user: "me@b.org" });

    const deviceA = await seededStore();
    await deviceA.set(mailAccountsKey(V), [shared, onlyA]);
    const contextA = { rawVault: fakeVault().adapter };
    const docFromA = await exportProfileValues(deviceA, V, contextA);

    const deviceB = fakeStore();
    await deviceB.set(mailAccountsKey(V), [onlyB, shared]); // other local order, on purpose
    registerPlatformStore(deviceB);
    const contextB = { rawVault: fakeVault().adapter };
    await applyProfileValues(deviceB, V, docFromA, contextB);
    const docFromB = await exportProfileValues(deviceB, V, contextB);

    registerPlatformStore(deviceA);
    await applyProfileValues(deviceA, V, docFromB, contextA);
    const docFromA2 = await exportProfileValues(deviceA, V, contextA);

    // Both devices now hold all three mailboxes, in the SAME order — so the next
    // cycle finds nothing to upload and nothing to announce.
    expect(unstableFields(docFromB, docFromA2), report(docFromB, docFromA2)).toEqual([]);
    expect((docFromA2.mailAccounts as MailAccountConfig[]).map((a) => a.id)).toEqual(["a-only", "b-only", "m1"]);
  });

  it("carries a per-address signature through unchanged (P8.2)", async () => {
    // The new structure rides along as account metadata, and P2.1 showed that the
    // ACCOUNT fields are exactly the ones that used to come back different — so
    // this asserts the whole map survives, not just that the field exists.
    const store = fakeStore();
    await store.set(mailAccountsKey(V), [
      mailAccount({
        signature: "Marco",
        senders: ["Sales <sales@example.org>"],
        signatures: { "sales@example.org": "Marco | Sales" },
      }),
    ]);
    registerPlatformStore(store);
    const vault = fakeVault(JSON.stringify({ items: [] }));
    const context = { rawVault: vault.adapter };

    const first = await exportProfileValues(store, V, context);
    await applyProfileValues(store, V, first, context);
    const again = await exportProfileValues(store, V, context);
    expect(unstableFields(first, again), report(first, again)).toEqual([]);

    const stored = (await store.get(mailAccountsKey(V))) as MailAccountConfig[];
    expect(stored[0].signatures).toEqual({ "sales@example.org": "Marco | Sales" });
    expect(stored[0].signature).toBe("Marco");
  });

  it("resets bookmarks when the complete profile omits their list", async () => {
    const store = fakeStore();
    registerPlatformStore(store);
    const vault = fakeVault(JSON.stringify({ items: ["Notes/Old.md"] }));

    await applyProfileValues(store, V, {}, { rawVault: vault.adapter });

    expect(vault.files.has(".plainva/bookmarks.json")).toBe(false);
    expect(await exportProfileValues(store, V, { rawVault: vault.adapter })).not.toHaveProperty("bookmarks");
  });
});
