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

function fakeStore(): ISettingsStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
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
function fakePim(accounts: PimAccountRow[] = [], calendars: Array<{ accountId: string; id: string; selected: boolean }> = []) {
  const state = { accounts: [...accounts], calendars: [...calendars] };
  return {
    state,
    runtime: {
      cache: {
        listAccounts: async () => state.accounts,
        upsertAccount: async (row: PimAccountRow) => {
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
   * KNOWN UNSTABLE (P2.1 finding, fixed in P2.2 — flip this to `it` there).
   *
   * `pimAccounts` does not round-trip: the import parks the calendar choice in
   * the account row as `config.plainvaPendingCalendarSelections`, because the
   * calendars themselves only exist after that account's first sync. That parked
   * value is then EXPORTED with the row, so the document differs from what was
   * just published — every cycle, forever, on a device where nothing changed.
   * It is also device state that has no business travelling, and it is never
   * cleared after being applied.
   */
  it.fails("applying its own export changes nothing (accounts included)", async () => {
    const store = await seededStore();
    const pim = fakePim([pimAccount()], [{ accountId: "p1", id: "cal-1", selected: true }]);
    const vault = fakeVault(JSON.stringify({ items: ["Notes/Alpha.md"] }));
    const context = { pimRuntime: pim.runtime, rawVault: vault.adapter };

    const first = await exportProfileValues(store, V, context);
    await applyProfileValues(store, V, first, context);
    const second = await exportProfileValues(store, V, context);

    expect(unstableFields(first, second), report(first, second)).toEqual([]);
  });

  /**
   * KNOWN UNSTABLE (P2.1 finding, fixed in P2.2 — flip this to `it` there).
   *
   * The case a real second device is in: it has a mailbox of its own that the
   * document does not know. The import KEEPS it, which is right (the profile is
   * a shared truth, not an authority over what only lives here) — but it puts
   * the local-only account FIRST (`accountProfile.ts`, "existing not in the
   * document" ahead of the imported rows). So the order of `mailAccounts`
   * depends on which extra accounts each device happens to have, and two such
   * devices keep overwriting each other's order: a change every cycle, hence a
   * toast every cycle, with nothing actually changing.
   */
  it.fails("stays stable when this device has an account the document does not carry", async () => {
    const store = await seededStore();
    // Local-only mailbox, listed AFTER the shared one.
    await store.set(mailAccountsKey(V), [mailAccount(), mailAccount({ id: "m2", label: "Private", host: "imap.other.org", user: "me@other.org" })]);
    const pim = fakePim([pimAccount()]);
    const vault = fakeVault();
    const context = { pimRuntime: pim.runtime, rawVault: vault.adapter };

    const first = await exportProfileValues(store, V, context);
    // What the OTHER device publishes: only the shared mailbox.
    const fromPeer = { ...first, mailAccounts: [mailAccount()] };
    await applyProfileValues(store, V, fromPeer, context);
    const second = await exportProfileValues(store, V, context);

    expect(unstableFields(fromPeer, second), report(fromPeer, second)).toEqual([]);
  });
});
