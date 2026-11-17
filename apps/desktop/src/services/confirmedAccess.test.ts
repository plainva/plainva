import { describe, expect, it } from "vitest";
import {
  CONFIRMED_ACCESS_KEY,
  confirmedAccessOf,
  mergeConfirmedAccess,
  withOwnConfirmedAccess,
  MAX_CONFIRMED_ACCESS,
  type ConfirmedAccess,
  type PimAccountRow,
} from "@plainva/core";
import { emptyAccountMap, importAccountMetadata, passwordRowToAdoptInto, pimAccountsForProfile, type AccountImportPorts } from "@plainva/ui";

/**
 * One Nextcloud, two devices, two addresses of it: the laptop signs in through
 * the public name, the phone (repaired through its form) through the LAN
 * address. The server resolves its principal against the address it is asked
 * through, so each device confirms a different one (GitHub issue 174, review
 * 2026-11-17).
 *
 * Before: the shared row held ONE address and ONE principal. The import took
 * the other device's, the next fetch wrote its own back — two writes per cycle
 * and device, forever — and in between a connect on the laptop did not find
 * its own row and added a second one.
 */

const PUB = "https://cloud.example.com/remote.php/dav";
const LAN = "http://192.168.1.5/remote.php/dav";
const principalAt = (base: string) => new URL("/remote.php/dav/principals/users/anna/", base + "/").toString();
const accessAt = (base: string): ConfirmedAccess => ({ url: base, user: "anna", principal: principalAt(base) });

function device(name: string, row: PimAccountRow, slotUrl: string) {
  let n = 0;
  let writes = 0;
  const state = {
    pim: [row],
    cards: [] as never[],
    map: { ...emptyAccountMap(), pimLocalToLogical: { [row.id]: "L1" } },
  };
  const ports: AccountImportPorts = {
    listPimAccounts: async () => state.pim,
    upsertPimAccount: async (next) => {
      const before = state.pim.find((p) => p.id === next.id);
      if (JSON.stringify(before) !== JSON.stringify(next)) writes++;
      state.pim = [...state.pim.filter((p) => p.id !== next.id), next];
    },
    deletePimAccount: async (id) => {
      state.pim = state.pim.filter((p) => p.id !== id);
    },
    listCalendars: async () => [],
    setCalendarSelected: async () => undefined,
    listTaskLists: async () => [],
    setTaskListSelected: async () => undefined,
    listMailAccounts: async () => [],
    replaceMailAccounts: async () => undefined,
    listCloudAccounts: async () => state.cards,
    replaceCloudAccounts: async (records) => {
      state.cards = [...records] as never[];
    },
    pimSecretSlot: (id) => `pim:${id}`,
    mailSecretSlot: (id) => `mail:${id}`,
    loadAccountMap: async () => state.map,
    saveAccountMap: async (map) => {
      state.map = map as typeof state.map;
    },
    newId: () => `${name}-new-${++n}`,
    deviceId: async () => name,
  };
  /** What PimWorker does after a successful fetch with this device's own sign-in. */
  const fetch = () => {
    state.pim = state.pim.map((r) => {
      const map = confirmedAccessOf(r.config);
      const next = withOwnConfirmedAccess(map, name, accessAt(slotUrl));
      if (JSON.stringify(map) === JSON.stringify(next)) return r;
      writes++;
      return { ...r, config: { ...r.config, [CONFIRMED_ACCESS_KEY]: next } };
    });
  };
  /** Whether a connect here, through this device's own address, finds the row. */
  const connectFindsOwnRow = () =>
    passwordRowToAdoptInto(state.pim, {
      id: "fresh",
      provider: "caldav",
      config: { url: slotUrl, user: "anna", [CONFIRMED_ACCESS_KEY]: { [name]: accessAt(slotUrl) } },
    })?.id === row.id;
  const publish = () => ({ pimAccounts: pimAccountsForProfile(state.pim, state.map), cloudAccounts: state.cards });
  return { state, ports, fetch, publish, connectFindsOwnRow, writes: () => writes };
}

describe("one password account reached through two addresses", () => {
  it("settles after two rounds: no value flips, each device keeps its address, and finds its own row at every moment", async () => {
    const laptop = device("laptop", {
      id: "pA", provider: "caldav", label: "anna", enabled: true,
      config: { url: PUB, user: "anna", [CONFIRMED_ACCESS_KEY]: { laptop: accessAt(PUB) } },
    }, PUB);
    const phone = device("phone", {
      id: "pB", provider: "caldav", label: "anna", enabled: true,
      config: { url: LAN, user: "anna", [CONFIRMED_ACCESS_KEY]: { phone: accessAt(LAN) } },
    }, LAN);

    const docs: string[] = [];
    const writesPerRound: number[] = [];
    for (let round = 1; round <= 5; round++) {
      const before = laptop.writes() + phone.writes();
      await importAccountMetadata(phone.publish(), laptop.ports);
      expect(laptop.connectFindsOwnRow()).toBe(true);
      laptop.fetch();
      expect(laptop.connectFindsOwnRow()).toBe(true);
      const docLaptop = JSON.stringify(laptop.publish().pimAccounts);
      await importAccountMetadata(laptop.publish(), phone.ports);
      expect(phone.connectFindsOwnRow()).toBe(true);
      phone.fetch();
      const docPhone = JSON.stringify(phone.publish().pimAccounts);
      docs.push(docLaptop + docPhone);
      writesPerRound.push(laptop.writes() + phone.writes() - before);

      // Each device signs in through, and names, only its own address.
      expect(laptop.state.pim).toHaveLength(1);
      expect(phone.state.pim).toHaveLength(1);
      expect(laptop.state.pim[0].config.url).toBe(PUB);
      expect(phone.state.pim[0].config.url).toBe(LAN);
    }
    // From the third round on nothing is written and both devices publish
    // the same document.
    expect(writesPerRound.slice(2)).toEqual([0, 0, 0]);
    expect(new Set(docs.slice(1)).size).toBe(1);
    expect(JSON.stringify(laptop.publish().pimAccounts)).toBe(JSON.stringify(phone.publish().pimAccounts));
    expect(confirmedAccessOf(laptop.state.pim[0].config)).toEqual({ laptop: accessAt(PUB), phone: accessAt(LAN) });
  });

  it("an import never overwrites this device's own entry, and takes every other device's as published", () => {
    const local = { laptop: accessAt(PUB), phone: accessAt("http://old-lan/remote.php/dav") };
    const imported = { laptop: accessAt("http://elsewhere/remote.php/dav"), phone: accessAt(LAN), tablet: accessAt(LAN) };
    expect(mergeConfirmedAccess(local, imported, "laptop")).toEqual({ laptop: accessAt(PUB), phone: accessAt(LAN), tablet: accessAt(LAN) });
    // A document without the key (a device on 0.8.7) removes nothing.
    expect(mergeConfirmedAccess(local, {}, "laptop")).toEqual(local);
  });

  it("is bounded the same way on every write, so a device beyond the bound does not keep adding itself", () => {
    const full = Object.fromEntries(Array.from({ length: MAX_CONFIRMED_ACCESS }, (_, i) => [`d${i}`, accessAt(PUB)]));
    expect(withOwnConfirmedAccess(full, "z-late", accessAt(LAN))).toEqual(full);
    expect(Object.keys(confirmedAccessOf({ [CONFIRMED_ACCESS_KEY]: { ...full, "z-late": accessAt(LAN) } }))).toHaveLength(MAX_CONFIRMED_ACCESS);
  });
});
