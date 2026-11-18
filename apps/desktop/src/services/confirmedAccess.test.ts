import { describe, expect, it } from "vitest";
import {
  CONFIRMED_ACCESS_KEY,
  confirmedAccessOf,
  mergeConfirmedAccess,
  withOwnConfirmedAccess,
  withoutOwnConfirmedAccess,
  latestConfirmedAccess,
  MAX_CONFIRMED_ACCESS,
  type ConfirmedAccess,
  type PimAccountRow,
} from "@plainva/core";
import { emptyAccountMap, importAccountMetadata, passwordAccessMove, passwordRowToAdoptInto, pimAccountsForProfile, SIGNED_OUT_MARK, type AccountImportPorts } from "@plainva/ui";

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
const NEW = "https://cloud.new-domain.example/remote.php/dav";
const principalAt = (base: string) => new URL("/remote.php/dav/principals/users/anna/", base + "/").toString();
const accessAt = (base: string): ConfirmedAccess => ({ url: base, user: "anna", principal: principalAt(base) });

function device(name: string, row: PimAccountRow | null, slotUrl: string | null) {
  let n = 0;
  let writes = 0;
  const state = {
    pim: row ? [row] : [],
    cards: [] as never[],
    map: { ...emptyAccountMap(), pimLocalToLogical: row ? { [row.id]: "L1" } : {} },
    slotUrl,
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
    const url = state.slotUrl;
    if (!url) return;
    state.pim = state.pim.map((r) => {
      const map = confirmedAccessOf(r.config);
      const next = withOwnConfirmedAccess(map, name, accessAt(url));
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
      config: { url: state.slotUrl, user: "anna", [CONFIRMED_ACCESS_KEY]: { [name]: accessAt(state.slotUrl!) } },
    })?.id === row?.id;
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
    expect(confirmedAccessOf(laptop.state.pim[0].config)).toMatchObject({ laptop: accessAt(PUB), phone: accessAt(LAN) });
  });

  it("an import never overwrites this device's own entry, and takes every other device's as published", () => {
    const local = { laptop: accessAt(PUB), phone: accessAt("http://old-lan/remote.php/dav") };
    const imported = { laptop: accessAt("http://elsewhere/remote.php/dav"), phone: accessAt(LAN), tablet: accessAt(LAN) };
    expect(mergeConfirmedAccess(local, imported, "laptop")).toEqual({ laptop: accessAt(PUB), phone: accessAt(LAN), tablet: accessAt(LAN) });
    // A document without the key (a device on 0.8.7) removes nothing...
    expect(mergeConfirmedAccess(local, {}, "laptop", false)).toEqual(local);
    // ...one that carries it is complete: an entry it lacks was taken out by its device.
    expect(mergeConfirmedAccess(local, { laptop: accessAt(PUB) }, "laptop", true)).toEqual({ laptop: accessAt(PUB) });
    // This device's own entry never comes from the document, not even when it has none.
    expect(mergeConfirmedAccess({}, { laptop: accessAt(PUB), phone: accessAt(LAN) }, "laptop", true)).toEqual({ phone: accessAt(LAN) });
  });

  it("is bounded the same way on every read", () => {
    const full = Object.fromEntries(Array.from({ length: MAX_CONFIRMED_ACCESS + 1 }, (_, i) => [`d${i}`, { ...accessAt(PUB), since: `2026-11-${String(10 + i)}T00:00:00.000Z` }]));
    expect(Object.keys(confirmedAccessOf({ [CONFIRMED_ACCESS_KEY]: full }))).toHaveLength(MAX_CONFIRMED_ACCESS);
    expect(confirmedAccessOf({ [CONFIRMED_ACCESS_KEY]: full })).not.toHaveProperty("d0");
  });

  it("a server move repaired on one device reaches a device that joins later, while another still names the old address (review 2026-11-18)", async () => {
    const laptop = device("a-laptop", {
      id: "pA", provider: "caldav", label: "anna", enabled: true,
      config: { url: PUB, user: "anna", [CONFIRMED_ACCESS_KEY]: { "a-laptop": accessAt(PUB) } },
    }, PUB);
    const phone = device("b-phone", {
      id: "pB", provider: "caldav", label: "anna", enabled: true,
      config: { url: PUB, user: "anna", [CONFIRMED_ACCESS_KEY]: { "b-phone": accessAt(PUB) } },
    }, PUB);
    for (let round = 0; round < 2; round++) {
      await importAccountMetadata(phone.publish(), laptop.ports);
      laptop.fetch();
      await importAccountMetadata(laptop.publish(), phone.ports);
      phone.fetch();
    }
    // The server moves. The phone is repaired to the new address; the laptop's
    // address no longer answers, so the laptop confirms nothing any more.
    phone.state.slotUrl = NEW;
    phone.state.pim = phone.state.pim.map((r) => ({ ...r, config: { ...r.config, url: NEW } }));
    phone.fetch();
    laptop.state.slotUrl = null;
    for (let round = 0; round < 3; round++) {
      await importAccountMetadata(phone.publish(), laptop.ports);
      laptop.fetch();
      await importAccountMetadata(laptop.publish(), phone.ports);
      phone.fetch();
    }
    // The device id of the laptop is the smaller one: before, the document
    // named its dead address and a new device signed in there.
    expect(laptop.publish().pimAccounts[0].config.url).toBe(NEW);
    expect(phone.publish().pimAccounts[0].config.url).toBe(NEW);
    const joined = device("0-new", null, null);
    await importAccountMetadata(laptop.publish(), joined.ports);
    expect(joined.state.pim).toHaveLength(1);
    expect(joined.state.pim[0].config.url).toBe(NEW);
  });

  it("the bound keeps the latest confirmed, so an active device with a large id is never the one left out", () => {
    let map = {};
    for (let i = 1; i <= MAX_CONFIRMED_ACCESS; i++) map = withOwnConfirmedAccess(map, `0000-dead-${i}`, accessAt(LAN), `2026-01-0${i}T00:00:00.000Z`);
    const after = withOwnConfirmedAccess(map, "ffff-active", accessAt(PUB), "2026-11-18T00:00:00.000Z");
    expect(Object.keys(after)).toHaveLength(MAX_CONFIRMED_ACCESS);
    expect(after).toHaveProperty("ffff-active");
    expect(after).not.toHaveProperty("0000-dead-1");
    // Confirming the same access again does not move its moment.
    const again = withOwnConfirmedAccess(after, "ffff-active", accessAt(PUB), "2026-12-01T00:00:00.000Z");
    expect(again["ffff-active"].since).toBe("2026-11-18T00:00:00.000Z");
    expect(latestConfirmedAccess(again)?.[0]).toBe("ffff-active");
  });

  it("an entry its device took out (signed out there) leaves every other device, and the own entry never comes back from the document", async () => {
    const laptop = device("laptop", {
      id: "pA", provider: "caldav", label: "anna", enabled: true,
      config: { url: PUB, user: "anna", [CONFIRMED_ACCESS_KEY]: { laptop: accessAt(PUB) } },
    }, PUB);
    const phone = device("phone", {
      id: "pB", provider: "caldav", label: "anna", enabled: true,
      config: { url: LAN, user: "anna", [CONFIRMED_ACCESS_KEY]: { phone: accessAt(LAN) } },
    }, LAN);
    await importAccountMetadata(phone.publish(), laptop.ports);
    await importAccountMetadata(laptop.publish(), phone.ports);
    expect(Object.keys(confirmedAccessOf(phone.state.pim[0].config))).toEqual(["laptop", "phone"]);

    // "Sign out on this device" on the laptop.
    laptop.state.slotUrl = null;
    laptop.state.pim = laptop.state.pim.map((r) => ({ ...r, config: { ...r.config, [CONFIRMED_ACCESS_KEY]: withoutOwnConfirmedAccess(confirmedAccessOf(r.config), "laptop") } }));
    await importAccountMetadata(phone.publish(), laptop.ports);
    expect(Object.keys(confirmedAccessOf(laptop.state.pim[0].config))).toEqual(["phone"]);
    await importAccountMetadata(laptop.publish(), phone.ports);
    expect(Object.keys(confirmedAccessOf(phone.state.pim[0].config))).toEqual(["phone"]);
  });

  it("following a moved server signs in with this device's own password, for its own user only, and moves sign-in and row together", async () => {
    let signIn: Record<string, unknown> = { kind: "caldav", url: PUB, user: "anna", pass: "own-pw" };
    const rowUrls: string[] = [];
    const built: Array<{ url: string; user: string; pass: string }> = [];
    const move = passwordAccessMove({
      readSignIn: async () => signIn,
      rotateSignIn: async (_id, previous, next) => {
        expect(previous).toEqual(signIn);
        signIn = next;
      },
      setRowAddress: async (_id, url) => void rowUrls.push(url),
      caldavTarget: (creds) => {
        built.push(creds);
        return {} as never;
      },
    });
    const row = { id: "pA", provider: "caldav" as const, label: "anna", enabled: true, config: { url: PUB, user: "anna" } };
    expect(await move.target(row, accessAt(NEW))).not.toBeNull();
    expect(built).toEqual([{ url: NEW, user: "anna", pass: "own-pw" }]);
    expect(await move.target(row, { ...accessAt(NEW), user: "Anna" })).toBeNull();
    await move.adopt(row, accessAt(NEW));
    expect(signIn).toEqual({ kind: "caldav", url: NEW, user: "anna", pass: "own-pw" });
    expect(rowUrls).toEqual([NEW]);
    signIn = { ...signIn, [SIGNED_OUT_MARK]: true, pass: "" };
    expect(await move.target(row, accessAt(LAN))).toBeNull();
  });
});
