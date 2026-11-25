import { describe, expect, it } from "vitest";
import {
  SecretsSyncStep,
  openSecretsBundle,
  type ISyncTarget,
  type IVaultAdapter,
  assertShareable,
  canonicalSecretId,
  canonicalizeEndpoint,
  mergeSecretsBundles,
  stableStringify,
  type SecretBinding,
  type SecretEntry,
  type SecretsBundle,
} from "@plainva/core";
import { SECRETS_MARK_KEY_SLOT, mergeLegacySecretsMeta, secretsMarker, calDavSecretBinding, createSecretsPort, imapSecretBinding, retireSecret, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";

/**
 * Mixed fleets of updated devices and devices on 0.8.7 (review 2026-11-18,
 * round six). A device on 0.8.7 runs the code of that tag, frozen in
 * `secretsV087`; an updated one runs today's. Both shells build their bindings
 * with `calDavSecretBinding` / `imapSecretBinding` and run the shared port, so
 * this holds for both.
 *
 * The rules held here:
 *  1. Whether an entry is old or new is told by its place — its type — which a
 *     device on 0.8.7 keeps when it writes an entry back. An updated device
 *     never writes an old type.
 *  2. A device publishes an entry it did not make only as it found it.
 *  3. A round without a change uploads nothing, in every mix.
 *
 * And from round seven: the move into the current type is no change. What a
 * device knew about a password under its old name — revision, time, whether
 * it came in through the sync — holds under the new one, and a round that
 * changes nothing reports and writes nothing.
 */

const CAL = "https://cloud.example.com/remote.php/dav";
const IMAP = { host: "imap.example.com", port: 993 };
type Row = { id: string; user: string; kind?: "calendar" | "mail" };

let clock = 0;
const tick = () => new Date(Date.parse("2026-11-18T00:00:00.000Z") + 1000 * clock++).toISOString();

/** How a device up to 0.8.7 built its bindings: the old types, every user lower-cased. */
const oldBinding = (row: Row): SecretBinding =>
  row.kind === "mail"
    ? { family: "imap", service: "mail", secretType: "imap-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(`imaps://${IMAP.host}:${IMAP.port}`) }
    : { family: "webdav", service: "calendar", secretType: "caldav-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(CAL) };
const newBinding = (row: Row): SecretBinding =>
  row.kind === "mail" ? imapSecretBinding("imap", IMAP.host, IMAP.port, row.user) : calDavSecretBinding("webdav", CAL, row.user);

interface Device {
  name: string;
  legacy: boolean;
  rows: Row[];
  slots: Map<string, string>;
  /** The key of the marks (`secretsMark.ts`), kept beside the slots like a keychain entry. */
  keyring: Map<string, unknown>;
  /** The record under this version's name. */
  meta: SecretsPortMeta | null;
  /** The record under the name 0.8.7 reads and writes (`secretsMark.ts`): taken in and emptied by the updated code. */
  legacyMeta: SecretsPortMeta | null;
  pushes: number;
  /** Times this device wrote its secrets metadata. */
  metaWrites: number;
  /** Imports an updated device reported (`onImportResult` writes the diagnostics for each). */
  reports: number;
  /** Switches a device on 0.8.7 to today's code, keeping its slots and metadata (the update). */
  update(): void;
  host: { readMeta(): Promise<SecretsPortMeta | null>; writeMeta(meta: SecretsPortMeta): Promise<void> };
}

function device(name: string, legacy: boolean, rows: Row[], passwords: Record<string, string> = {}): Device {
  const d: Device = {
    name,
    legacy,
    rows,
    slots: new Map(Object.entries(passwords)),
    keyring: new Map(),
    meta: null,
    legacyMeta: null,
    pushes: 0,
    reports: 0,
    metaWrites: 0,
    update: () => {
      d.legacy = false;
    },
    host: {
      readMeta: async () => mergeLegacySecretsMeta(structuredClone(d.meta), structuredClone(d.legacyMeta)),
      writeMeta: async (meta) => {
        d.metaWrites++;
        d.meta = structuredClone(meta);
        d.legacyMeta = null;
      },
    },
  };
  return d;
}

function portOf(d: Device) {
  const candidates = (): LocalSecretCandidate[] =>
    d.rows.map((row) => {
      const binding = d.legacy ? oldBinding(row) : newBinding(row);
      const pass = d.slots.get(row.id);
      return { logicalId: canonicalSecretId(binding), slot: row.id, binding, secret: pass ? { pass } : null, apply: (secret) => secret.pass };
    });
  const make = d.legacy ? (v087.createSecretsPort as unknown as typeof createSecretsPort) : createSecretsPort;
  return make({
    deviceId: async () => d.name,
    ...(d.legacy
      ? { readMeta: async () => structuredClone(d.legacyMeta), writeMeta: async (meta: SecretsPortMeta) => void (d.legacyMeta = structuredClone(meta)) }
      : d.host),
    candidates: async () => candidates(),
    readSlot: async (slot) => (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.get(slot) : d.slots.get(slot)) ?? null,
    writeSlot: async (slot, value) => void (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.set(slot, value) : d.slots.set(slot, value as string)),
    removeSlot: async (slot) => void d.slots.delete(slot),
    now: tick,
  });
}

/** The shared document, and one settings round of a device against it — as each version's SecretsSyncStep runs it. */
let remote: SecretsBundle | null = null;
async function round(d: Device): Promise<void> {
  const port = portOf(d);
  if (d.legacy) {
    const next = await v087.runV087Round(port as never, remote as never, tick());
    if (next.pushed) d.pushes++;
    remote = next.remote as SecretsBundle;
    return;
  }
  const local = await port.exportBundle();
  for (const entry of Object.values(local.entries)) if (!entry.tombstone) assertShareable(entry);
  const merged = mergeSecretsBundles(local, remote, tick());
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || port.awaitsDocument?.()) {
    if (!(await port.importBundle(merged)).settled) d.reports++;
  }
  if (!remote || stableStringify(merged.entries) !== stableStringify(remote.entries)) {
    d.pushes++;
    remote = merged;
  }
}

async function rounds(fleet: Device[], times: number): Promise<void> {
  for (let i = 0; i < times; i++) for (const d of fleet) await round(d);
}

const oldEntries = () => Object.entries(remote?.entries ?? {}).filter(([, entry]) => entry.binding.secretType === "caldav-password" || entry.binding.secretType === "imap-password");

function start(): void {
  remote = null;
  clock = 0;
}

describe("a mixed fleet of updated devices and devices on 0.8.7", () => {
  const fleets: Array<[string, () => Device[]]> = [
    ["L1: a user in lower case, one updated device and one on 0.8.7", () => [device("N1", false, [{ id: "r", user: "anna" }], { r: "P1" }), device("O", true, [{ id: "r", user: "anna" }])]],
    ["L2: the same with two updated devices", () => [device("N1", false, [{ id: "r", user: "anna" }], { r: "P1" }), device("N2", false, [{ id: "r", user: "anna" }]), device("O", true, [{ id: "r", user: "anna" }])]],
    ["a user in capitals", () => [device("N1", false, [{ id: "r", user: "Anna" }], { r: "P1" }), device("N2", false, [{ id: "r", user: "Anna" }]), device("O", true, [{ id: "r", user: "Anna" }])]],
    ["the password held by the device on 0.8.7", () => [device("O", true, [{ id: "r", user: "Anna" }], { r: "P0" }), device("N1", false, [{ id: "r", user: "Anna" }]), device("N2", false, [{ id: "r", user: "Anna" }])]],
    ["both versions holding a password", () => [device("O", true, [{ id: "r", user: "anna" }], { r: "P0" }), device("N1", false, [{ id: "r", user: "anna" }], { r: "P1" }), device("O2", true, [{ id: "r", user: "anna" }])]],
    ["twins \"Alice\" and \"alice\" beside a device on 0.8.7", () => [
      device("N1", false, [{ id: "rA", user: "Alice" }, { id: "ra", user: "alice" }], { rA: "pA", ra: "pa" }),
      device("N2", false, [{ id: "rA", user: "Alice" }, { id: "ra", user: "alice" }]),
      device("O", true, [{ id: "rA", user: "Alice" }], { rA: "pO" }),
    ]],
    ["a mailbox", () => [device("N1", false, [{ id: "m", user: "Anna@Example.com", kind: "mail" }], { m: "M1" }), device("O", true, [{ id: "m", user: "anna@example.com", kind: "mail" }], { m: "M0" }), device("N2", false, [{ id: "m", user: "anna@example.com", kind: "mail" }])]],
  ];

  for (const [name, make] of fleets) {
    it(`uploads nothing once settled — ${name}`, async () => {
      start();
      const fleet = make();
      await rounds(fleet, 4);
      for (const d of fleet) d.pushes = 0;
      const settled = stableStringify(remote);
      await rounds(fleet, 4);
      expect(Object.fromEntries(fleet.map((d) => [d.name, d.pushes]))).toEqual(Object.fromEntries(fleet.map((d) => [d.name, 0])));
      expect(stableStringify(remote)).toBe(settled);
      // An updated device never writes an old type (rule 1).
      for (const [, entry] of oldEntries()) expect(fleet.find((d) => d.name === entry.deviceId)?.legacy).toBe(true);
    });
  }

  it("an updated device without the two accounts never makes a tombstone of 0.8.7 its own (forge case)", async () => {
    start();
    const twins = (): Row[] => [{ id: "rA", user: "Alice" }, { id: "ra", user: "alice" }];
    const n1 = device("N1", false, twins(), { rA: "pA", ra: "pa" });
    const n3 = device("N3", false, twins());
    const old = device("O-087", true, [{ id: "oA", user: "Alice" }, { id: "oc", user: "carl" }], { oc: "pc" });
    const n4 = device("zN4", false, [{ id: "rb", user: "bob" }], { rb: "pb" });
    await rounds([n1, n3], 2);
    expect(Object.fromEntries(n3.slots)).toEqual({ rA: "pA", ra: "pa" });
    await rounds([old], 2);
    // The device on 0.8.7 removes its "Alice": a tombstone under the old name.
    old.rows = [{ id: "oc", user: "carl" }];
    old.slots.delete("oA");
    await round(old);
    const written = new Map(oldEntries().map(([id, entry]) => [id, stableStringify(entry)]));
    await round(n3);
    await rounds([n4], 2);
    await rounds([n3, n1, n3], 1);
    await rounds([n1, n3, n4, old], 2);
    expect(Object.fromEntries(n3.slots)).toEqual({ rA: "pA", ra: "pa" });
    expect(Object.fromEntries(n1.slots)).toEqual({ rA: "pA", ra: "pa" });
    // Every old entry is as the device on 0.8.7 wrote it (rule 2).
    for (const [id, entry] of oldEntries()) {
      expect(entry.deviceId).toBe("O-087");
      if (written.has(id)) expect(stableStringify(entry)).toBe(written.get(id));
    }
  });

  it("a device updated from 0.8.7 publishes the passwords it holds in the current types, and leaves its old entries as they are", async () => {
    start();
    const rows: Row[] = [{ id: "r1", user: "anna" }, { id: "r2", user: "Bert" }, { id: "m", user: "carl@example.com", kind: "mail" }];
    const up = device("U", true, rows, { r1: "P1", r2: "P2", m: "M1" });
    const other = device("O", true, rows.map((row) => ({ ...row })));
    await rounds([up, other], 3);
    const before = stableStringify(oldEntries());
    expect(oldEntries()).toHaveLength(3);

    up.update();
    await round(up);
    expect(stableStringify(oldEntries())).toBe(before);
    for (const row of rows) {
      const entry = remote!.entries[canonicalSecretId(newBinding(row))];
      expect(entry?.deviceId).toBe("U");
      expect(entry?.secret).toEqual({ pass: up.slots.get(row.id) });
    }
    // ...without the user doing anything, and nothing moves after that.
    up.pushes = 0;
    other.pushes = 0;
    await rounds([up, other], 3);
    expect([up.pushes, other.pushes]).toEqual([0, 0]);
    expect(stableStringify(oldEntries())).toBe(before);
  });

  it("between the two places of one account the later password counts; on a tie the current place; an old tombstone never", async () => {
    const row: Row = { id: "r", user: "Anna" };
    const current = (pass: string, updatedAt: string): [string, SecretEntry] => [canonicalSecretId(newBinding(row)), { entryRev: 1, updatedAt, deviceId: "N", binding: newBinding(row), secret: { pass } }];
    const old = (updatedAt: string, pass?: string): [string, SecretEntry] => [
      canonicalSecretId(oldBinding(row)),
      { entryRev: 1, updatedAt, deviceId: "O", binding: oldBinding(row), ...(pass ? { secret: { pass } } : { tombstone: true }) },
    ];
    const bundle = (entries: Array<[string, SecretEntry]>): SecretsBundle => ({ format: "plainva-secrets", version: 1, bundleRev: 1, updatedAt: "t", entries: Object.fromEntries(entries) });
    const cases: Array<[string, Array<[string, SecretEntry]>, string | undefined]> = [
      ["the old place later", [current("new", "2026-11-18T00:00:01.000Z"), old("2026-11-18T00:00:02.000Z", "old")], "old"],
      ["the current place later", [old("2026-11-18T00:00:01.000Z", "old"), current("new", "2026-11-18T00:00:02.000Z")], "new"],
      ["a tie", [old("2026-11-18T00:00:01.000Z", "old"), current("new", "2026-11-18T00:00:01.000Z")], "new"],
      ["only the old place", [old("2026-11-18T00:00:01.000Z", "old")], "old"],
      ["an old tombstone, later", [current("new", "2026-11-18T00:00:01.000Z"), old("2026-11-18T00:00:02.000Z")], "new"],
    ];
    for (const [what, entries, expected] of cases) {
      for (const order of [entries, [...entries].reverse()]) {
        const d = device("B", false, [row]);
        await portOf(d).importBundle(bundle(order));
        expect(d.slots.get("r"), what).toBe(expected);
      }
    }
    // An old tombstone is remembered: a later value under the old name puts nothing back.
    const d = device("B", false, [row]);
    await portOf(d).importBundle(bundle([old("2026-11-18T00:00:03.000Z")]));
    await portOf(d).importBundle(bundle([old("2026-11-18T00:00:04.000Z", "late")]));
    expect(d.slots.has("r")).toBe(false);
  });

  it("\"Remove account\" of a user in lower case closes its old name here, so a later value of 0.8.7 reaches no other account", async () => {
    start();
    const n = device("N", false, [{ id: "ra", user: "alice" }, { id: "rA", user: "Alice" }], { ra: "pa", rA: "pA" });
    await round(n);
    await retireSecret(n.host, calDavSecretBinding("webdav", CAL, "alice"));
    n.rows = [{ id: "rA", user: "Alice" }];
    n.slots.delete("ra");
    await round(n);
    const old = device("O", true, [{ id: "o", user: "alice" }], { o: "late" });
    await rounds([old, n], 2);
    expect(Object.fromEntries(n.slots)).toEqual({ rA: "pA" });
  });

  describe("the move into the current place keeps what the device knew (round seven)", () => {
    const kinds: Array<[string, Row["kind"]]> = [["a calendar", undefined], ["a mailbox", "mail"]];
    for (const [what, kind] of kinds) {
      for (const changer of ["O2", "N1", "O1"]) {
        for (const both of [false, true]) {
          it(`${what}: a device that received its password follows a change made on ${changer}${both ? ", both old devices updated" : ""}`, async () => {
            start();
            const row = (): Row[] => [{ id: "r", user: "anna", ...(kind ? { kind } : {}) }];
            const o2 = device("O2", true, row(), { r: "P1" });
            const o1 = device("O1", true, row());
            const n1 = device("N1", false, row());
            const fleet = [o2, o1, n1];
            await rounds(fleet, 3);
            expect(o1.slots.get("r")).toBe("P1");
            o1.update();
            if (both) o2.update();
            await rounds(fleet, 3);
            const c = fleet.find((d) => d.name === changer)!;
            c.slots.set("r", "P3");
            await rounds([c, ...fleet.filter((d) => d !== c)], 4);
            // O1 and N1 received P1 and follow. O2 typed P1: a password typed
            // here is never replaced from elsewhere, before the update as after.
            expect(Object.fromEntries(fleet.map((d) => [d.name, d.slots.get("r")]))).toEqual({ O2: changer === "O2" ? "P3" : "P1", O1: "P3", N1: "P3" });
          });
        }
      }
    }

    it("a password changed on 0.8.7 while two devices were away beats the older one they bring to the current place", async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna" }];
      const o1 = device("O1", true, row(), { r: "P1" });
      const o2 = device("O2", true, row());
      const o3 = device("O3", true, row());
      await rounds([o1, o2, o3], 3);
      o3.slots.set("r", "P2");
      await round(o3);
      o1.update();
      await round(o1);
      o2.update();
      await rounds([o2, o1, o3], 4);
      // O1 typed P1 and never received P2: it keeps its own, as before the
      // update. O2 received P1 through the sync and follows P2.
      expect(Object.fromEntries([o1, o2, o3].map((d) => [d.name, d.slots.get("r")]))).toEqual({ O1: "P1", O2: "P2", O3: "P2" });
    });

    it("a fleet that came from 0.8.7 reports nothing once settled", async () => {
      start();
      const rows: Row[] = [{ id: "r", user: "anna" }, { id: "m", user: "bert@example.com", kind: "mail" }];
      const fleet = ["A", "B", "C"].map((name, i) => device(name, true, rows.map((row) => ({ ...row })), i === 0 ? { r: "P1", m: "M1" } : {}));
      await rounds(fleet, 3);
      for (const d of fleet) d.update();
      await rounds(fleet, 4);
      for (const d of fleet) {
        d.pushes = 0;
        d.reports = 0;
      }
      await rounds(fleet, 10);
      expect(fleet.map((d) => [d.name, d.pushes, d.reports])).toEqual([["A", 0, 0], ["B", 0, 0], ["C", 0, 0]]);
      expect(fleet.map((d) => d.slots.get("m"))).toEqual(["M1", "M1", "M1"]);
    });
  });

  it("an old name closed by \"Remove account\" opens again when the same account is back", async () => {
    start();
    const o = device("O", true, [{ id: "r", user: "anna" }], { r: "P1" });
    const n = device("N", false, [{ id: "r", user: "anna" }]);
    await rounds([o, n], 3);
    expect(n.slots.get("r")).toBe("P1");
    await retireSecret(n.host, calDavSecretBinding("webdav", CAL, "anna"));
    n.rows = [];
    n.slots.delete("r");
    await rounds([n, o], 2);
    n.rows = [{ id: "r2", user: "anna" }];
    await rounds([n, o], 2);
    o.slots.set("r", "P2");
    await rounds([o, n], 3);
    expect(n.slots.get("r2")).toBe("P2");
  });

  describe("no way makes an older password newer (round eight)", () => {
    for (const late of [false, true]) {
      it(`a password read under the old name keeps the version it came with${late ? "; the device that changed it later is updated too" : ""}`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna" }];
        const o1 = device("O1", true, row(), { r: "P1" });
        const o2 = device("O2", true, row());
        const n0 = device("N0", false, row());
        await rounds([o1, o2, n0], 3);
        o1.slots.set("r", "P4");
        await round(o1);
        await round(n0);
        expect(n0.slots.get("r")).toBe("P4");
        // A newer change on 0.8.7, then the next export of the updated device:
        // it publishes P4 with the version P4 came with, never as its own.
        o2.slots.set("r", "P6");
        await round(o2);
        await round(n0);
        if (late) o2.update();
        await rounds([o1, o2, n0], 4);
        expect(Object.fromEntries([o1, o2, n0].map((d) => [d.name, d.slots.get("r")]))).toEqual({ O1: "P4", O2: "P6", N0: "P6" });
      });
    }

    it("a device that slept with an older password read under the old name wakes into the newer one", async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna" }];
      const o1 = device("O1", true, row(), { r: "P1" });
      const o2 = device("O2", true, row());
      const n0 = device("N0", false, row());
      const n1 = device("N1", true, row());
      await rounds([o1, o2, n0, n1], 3);
      o1.slots.set("r", "P4");
      await round(o1);
      await round(n0);
      await rounds([o2, o1, n1], 2);
      o2.slots.set("r", "P6");
      await rounds([o2, o1, n1], 3);
      await rounds([n0, o1, o2, n1], 4);
      expect(Object.fromEntries([o1, o2, n0, n1].map((d) => [d.name, d.slots.get("r")]))).toEqual({ O1: "P4", O2: "P6", N0: "P6", N1: "P6" });
    });
  });

  describe("what a device knew about a removed account is no knowledge about another one (round eight, O1)", () => {
    for (const then of ["changes the password", "removes the account"]) {
      it(`"Anna" after "anna" was removed: the password typed here stays when another device ${then}`, async () => {
        start();
        const o = device("O", true, [{ id: "r", user: "anna" }], { r: "P1" });
        const d = device("D", true, [{ id: "r", user: "anna" }]);
        await rounds([o, d], 3);
        d.update();
        await rounds([d, o], 2);
        await retireSecret(d.host, calDavSecretBinding("webdav", CAL, "anna"));
        d.rows = [];
        d.slots.delete("r");
        await rounds([d, o], 2);
        d.rows.push({ id: "R", user: "Anna" });
        d.slots.set("R", "PA");
        await rounds([d, o], 2);
        const anna = canonicalSecretId(newBinding({ id: "R", user: "Anna" }));
        expect([d.meta?.entries[anna]?.entryRev, !!d.meta?.imported[anna]]).toEqual([1, false]);
        const n2 = device("N2", false, [{ id: "R", user: "Anna" }, { id: "x", user: "xaver" }], { x: "PX" });
        await rounds([n2, d, o], 3);
        expect(n2.slots.get("R")).toBe("PA");
        if (then === "removes the account") {
          await retireSecret(n2.host, calDavSecretBinding("webdav", CAL, "Anna"));
          n2.rows = n2.rows.filter((r) => r.id !== "R");
          n2.slots.delete("R");
        } else n2.slots.set("R", "PB");
        await rounds([n2, d, o], 4);
        expect(d.slots.get("R")).toBe("PA");
      });
    }
  });

  it("a round that changes nothing writes no metadata either, export included (round eight, F68)", async () => {
    start();
    const rows = (): Row[] => [{ id: "r", user: "anna" }, { id: "m", user: "bert@example.com", kind: "mail" }];
    const fleet = [device("N1", false, rows(), { r: "P1", m: "M1" }), device("N2", false, rows()), device("N3", false, rows())];
    await rounds(fleet, 4);
    for (const d of fleet) d.metaWrites = 0;
    await rounds(fleet, 5);
    expect(fleet.map((d) => d.metaWrites)).toEqual([0, 0, 0]);
  });

  describe("knowledge is never thrown away (round nine)", () => {
    for (const received of [false, true]) {
      it(`an account signed out here before the update: a password typed later is a change made here${received ? " (the password had come through the sync)" : ""}`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna" }];
        const d = device("D", true, row(), received ? {} : { r: "P1" });
        const o = device("O", true, row(), received ? { r: "P1" } : {});
        const n = device("N", false, row());
        await rounds(received ? [o, d, n] : [d, o, n], 3);
        d.slots.delete("r");
        await rounds([d, o, n], 2);
        d.update();
        await rounds([d, o, n], 2);
        d.slots.set("r", "P9");
        await rounds([d, o, n], 3);
        for (const x of [d, o, n]) x.pushes = 0;
        await rounds([d, o, n], 10);
        expect({ D: d.slots.get("r"), N: n.slots.get("r") }).toEqual({ D: "P9", N: "P9" });
        expect([d, o, n].map((x) => x.pushes)).toEqual([0, 0, 0]);
      });
    }

    for (const changed of [true, false]) {
      it(`a lost mark key makes nothing a change: the device restores what it knew from the shared document${changed ? ", or holds its own password apart" : ""}`, async () => {
        start();
        const rows = (): Row[] => [{ id: "r", user: "anna" }, { id: "m", user: "Carl@Example.com", kind: "mail" }];
        const n1 = device("N1", false, rows(), { r: "P1", m: "M1" });
        const n2 = device("N2", false, rows());
        await rounds([n1, n2], 3);
        if (changed) {
          n2.slots.set("r", "P2");
          await round(n2);
        }
        n1.keyring.clear();
        n1.pushes = 0;
        n2.pushes = 0;
        await rounds([n1, n2], 5);
        expect(Object.fromEntries(n2.slots)).toEqual({ r: changed ? "P2" : "P1", m: "M1" });
        // N1 typed P1 itself and took nothing through the sync: it keeps it,
        // as a local conflict, unpublished; nothing of N1 is uploaded.
        expect(Object.fromEntries(n1.slots)).toEqual({ r: "P1", m: "M1" });
        expect(n1.pushes).toBe(0);
        expect(remote!.entries[canonicalSecretId(newBinding({ id: "r", user: "anna" }))]?.secret).toEqual({ pass: changed ? "P2" : "P1" });
        // Typed again on N1: a change over all it saw, which N2 follows (it
        // took its first password from N1 through the sync).
        n1.slots.set("r", "P5");
        await rounds([n1, n2], 3);
        expect([n1.slots.get("r"), n2.slots.get("r")]).toEqual(["P5", "P5"]);
      });
    }

    it("a device that goes back to 0.8.7 starts like a new one and beats nothing newer", async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna" }];
      const o = device("O", true, row(), { r: "P1" });
      const d = device("D", true, row());
      const n = device("N", false, row());
      await rounds([o, d, n], 3);
      d.update();
      await rounds([d, o, n], 3);
      expect(d.legacyMeta).toBeNull();
      n.slots.set("r", "P2");
      await round(n);
      d.legacy = true;
      await rounds([d, o, n, d], 4);
      expect({ O: o.slots.get("r"), D: d.slots.get("r"), N: n.slots.get("r") }).toEqual({ O: "P1", D: "P1", N: "P2" });
      expect(remote!.entries[canonicalSecretId(newBinding({ id: "r", user: "anna" }))]?.secret).toEqual({ pass: "P2" });
    });

    it("a phone restored from the system backup (settings back, keychain not) takes the password of the version it knew (round twelve)", async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna" }];
      const n1 = device("N1", false, row(), { r: "P1" });
      const n2 = device("N2", false, row());
      await rounds([n1, n2], 3);
      n2.slots.clear();
      n2.keyring.clear();
      n1.pushes = 0;
      n2.pushes = 0;
      await rounds([n2, n1], 4);
      expect([n2.slots.get("r"), n1.pushes, n2.pushes]).toEqual(["P1", 0, 0]);
      n1.slots.set("r", "P3");
      await rounds([n1, n2], 3);
      expect(n2.slots.get("r")).toBe("P3");
    });
  });

  describe("no state without a way out (round eleven)", () => {
    for (const how of ["the document was reset", "the document carries only an older entry"]) {
      it(`a lost key when ${how}: the device holds what it knew, a password typed here after the first run arrives`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna" }];
        const n1 = device("N1", false, row(), { r: "P1" });
        const n2 = device("N2", false, row());
        await rounds([n1, n2], 3);
        let older: SecretsBundle | null = null;
        if (how.includes("older")) {
          older = structuredClone(remote);
          n1.slots.set("r", "P2");
          await round(n1);
        }
        n1.keyring.clear();
        remote = older;
        n2.slots.clear();
        await rounds([n1, n2], 4);
        // N1 publishes what it knew at that version; N2's slot, emptied
        // without a lost key, stays empty at a version it knows, as on main.
        expect(n2.slots.get("r")).toBe(how.includes("older") ? "P2" : undefined);
        n1.slots.set("r", "P3");
        await rounds([n1, n2], 4);
        expect(n2.slots.get("r")).toBe("P3");
        // Nothing waits any more: every record is made with the key N1 has now.
        const own = await secretsMarker({ readSlot: async (slot) => n1.keyring.get(slot) ?? null, writeSlot: async () => undefined });
        expect(Object.values(n1.meta!.entries).filter((e) => !e.tombstone && !own.owns(e.hash))).toEqual([]);
      });
    }

    it("a password typed here after the first run since the key was lost goes out", async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna" }];
      const n1 = device("N1", false, row(), { r: "P1" });
      const n2 = device("N2", false, row());
      await rounds([n1, n2], 3);
      n1.keyring.clear();
      await round(n1);
      n1.slots.set("r", "P3");
      await rounds([n1, n2], 6);
      expect([n1.slots.get("r"), n2.slots.get("r")]).toEqual(["P3", "P3"]);
    });

    for (const typed of ["the same password as the document", "a password changed meanwhile"]) {
      it(`moving an Android phone: the record comes with the backup, key and slots do not; typing ${typed}`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna" }];
        const n1 = device("N1", false, row(), { r: "P1" });
        const phone = device("Phone", false, row());
        await rounds([n1, phone], 3);
        expect(phone.slots.get("r")).toBe("P1");
        // The new phone: settings restored, keychain empty.
        phone.slots.clear();
        phone.keyring.clear();
        n1.pushes = 0;
        phone.pushes = 0;
        // Typed before the first run: the slot it finds; after it: a change.
        if (typed.startsWith("the same")) phone.slots.set("r", "P1");
        else {
          await round(phone);
          expect(phone.slots.get("r")).toBe("P1");
          phone.slots.set("r", "P7");
        }
        await rounds([phone, n1], 5);
        if (typed.startsWith("the same")) {
          expect([phone.slots.get("r"), n1.slots.get("r"), phone.pushes]).toEqual(["P1", "P1", 0]);
        } else {
          // Typed here: a change, which N1 follows (it typed P1 itself, so it
          // keeps its own — as before the move).
          expect(phone.slots.get("r")).toBe("P7");
          expect(remote!.entries[canonicalSecretId(newBinding({ id: "r", user: "anna" }))]?.secret).toEqual({ pass: "P7" });
        }
      });
    }
  });

  describe("an old name: the same password again is no news, a real change back to it is (round eleven)", () => {
    for (const seen of [false, true]) {
      it(`0.8.7 changes P1 to P2 and back to P1${seen ? ", the updated device sees P2 in between" : " while the updated device is away"}: P1 arrives`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna" }];
        const o = device("O", true, row(), { r: "P1" });
        const n = device("N", false, row());
        await rounds([o, n], 3);
        n.slots.set("r", "Q");
        await rounds([n, o], 2);
        o.slots.set("r", "P2");
        await round(o);
        if (seen) await round(n);
        o.slots.set("r", "P1");
        await round(o);
        await rounds([n, o], 4);
        expect({ O: o.slots.get("r"), N: n.slots.get("r") }).toEqual({ O: "P1", N: "P1" });
      });
    }
  });

  it("a round that changes nothing writes nothing, with a tombstone of another device and an account unknown here (round eleven, F68)", async () => {
    start();
    const all = (): Row[] => [{ id: "r", user: "anna" }, { id: "m", user: "carl@example.com", kind: "mail" }];
    const n1 = device("N1", false, all(), { r: "P1", m: "M1" });
    const n0 = device("N0", false, [{ id: "b", user: "Bert" }], { b: "B1" });
    await rounds([n1, n0], 3);
    await retireSecret(n1.host, imapSecretBinding("imap", IMAP.host, IMAP.port, "carl@example.com"));
    n1.rows = n1.rows.filter((r) => r.id !== "m");
    n1.slots.delete("m");
    await rounds([n1, n0], 4);
    for (const d of [n1, n0]) d.metaWrites = 0;
    await rounds([n1, n0], 6);
    expect([n1.metaWrites, n0.metaWrites]).toEqual([0, 0]);
  });
});

describe("what a device knew ends only with a document it read (round twelve)", () => {
  /** A run whose download fails after the export (offline, target unreachable, app ended): SecretsSyncStep exports first. */
  const offline = async (d: Device) => void (await portOf(d).exportBundle());
  const doc = (id = "r") => {
    const entry = Object.values(remote?.entries ?? {}).find((e) => e.binding.secretType === "caldav-password-2" && e.binding.user === (id === "r" ? "anna" : id));
    return entry && `r${entry.entryRev}:${(entry.secret as { pass?: string } | undefined)?.pass ?? "-"}/${entry.deviceId}`;
  };
  const lostOf = async (d: Device) => {
    const own = await secretsMarker({ readSlot: async (slot) => d.keyring.get(slot) ?? null, writeSlot: async () => undefined });
    return Object.values(d.meta?.entries ?? {}).filter((e) => !e.tombstone && !e.held && e.hash.startsWith("m1:") && !own.owns(e.hash)).length;
  };
  const row = (): Row[] => [{ id: "r", user: "anna" }];

  for (const off of [1, 3]) {
    it(`a password taken through the sync follows a change made meanwhile, after ${off} run(s) that ended after the export`, async () => {
      start();
      const n1 = device("N1", false, row());
      const n2 = device("N2", false, row());
      const f = device("F", false, row());
      n2.slots.set("r", "P1");
      await rounds([n2, n1, f], 2);
      n1.keyring.clear();
      n2.slots.set("r", "P2");
      await rounds([n2, f], 2);
      for (let i = 0; i < off; i++) await offline(n1);
      await rounds([n1, n2, f], 4);
      expect({ N1: n1.slots.get("r"), doc: doc() }).toEqual({ N1: "P2", doc: "r2:P2/N2" });
      expect(await lostOf(n1)).toBe(0);
    });

    it(`a password typed after the key was lost arrives above all it saw, after ${off} run(s) that ended after the export`, async () => {
      start();
      const n1 = device("N1", false, row());
      const n2 = device("N2", false, row());
      const f = device("F", false, row());
      for (const pass of ["P1", "P2", "P3"]) {
        n2.slots.set("r", pass);
        await rounds([n2, n1, f], 2);
      }
      n1.keyring.clear();
      await offline(n1);
      n1.slots.set("r", "NEW4");
      for (let i = 1; i < off; i++) await offline(n1);
      await rounds([n1, n2, f], 4);
      expect({ doc: doc(), F: f.slots.get("r") }).toEqual({ doc: "r4:NEW4/N1", F: "NEW4" });
    });

    it(`a local conflict held over a lost key never puts the older password over the newer, after ${off} run(s) that ended after the export`, async () => {
      start();
      const n1 = device("N1", false, row(), { r: "DDD1" });
      const n2 = device("N2", false, row());
      const f = device("F", false, row());
      await round(n1);
      n2.slots.set("r", "EEE1");
      await rounds([n2, f, n1], 3);
      n1.keyring.clear();
      for (let i = 0; i < off; i++) await offline(n1);
      await rounds([n1, n2, f], 4);
      expect({ doc: doc(), F: f.slots.get("r"), N1: n1.slots.get("r") }).toEqual({ doc: "r1:EEE1/N2", F: "EEE1", N1: "DDD1" });
    });
  }

  for (const how of ["the document was reset", "the document carries only an older entry"]) {
    it(`a device whose key was lost holds what it knew at the version it knew, never r1, never one above (${how})`, async () => {
      start();
      const n1 = device("N1", false, row());
      const n2 = device("N2", false, row());
      let older: SecretsBundle | null = null;
      for (const pass of ["P1", "P2", "P3"]) {
        n1.slots.set("r", pass);
        await rounds([n1, n2], 2);
        older ??= structuredClone(remote);
      }
      expect(doc()).toBe("r3:P3/N1");
      n1.keyring.clear();
      remote = how.includes("older") ? older : null;
      await rounds([n1], 3);
      expect(doc()).toBe("r3:P3/N1");
      await rounds([n1, n2], 2);
      expect([n2.slots.get("r"), await lostOf(n1)]).toEqual(["P3", 0]);
    });
  }

  it("a record whose account is gone here ends too, and nothing waits any more", async () => {
    start();
    const rows = (): Row[] => [{ id: "m", user: "carl@example.com", kind: "mail" }];
    const n = device("N", false, rows(), { m: "M1" });
    const o = device("O", false, rows());
    await rounds([n, o], 3);
    // The last account goes without "Remove account": a list that is empty is no removal, the record stays.
    n.rows = [];
    n.slots.delete("m");
    await rounds([n, o], 2);
    n.keyring.clear();
    await rounds([n, o], 3);
    expect(await lostOf(n)).toBe(0);
    const port = portOf(n);
    await port.exportBundle();
    expect(port.awaitsDocument?.()).toBe(false);
    n.metaWrites = 0;
    await rounds([n, o], 3);
    expect(n.metaWrites).toBe(0);
  });
});

describe("\"Remove account\" right after the update (round twelve)", () => {
  for (const order of ["before the first round of the new version", "after it"]) {
    it(`removes the account on the other updated devices, ${order}, as on main`, async () => {
      start();
      const rows = (): Row[] => [{ id: "r", user: "anna" }, { id: "b", user: "bert" }];
      const o = device("O", true, rows(), { r: "A1", b: "B1" });
      const l = device("L", true, rows());
      const n = device("N", false, rows());
      await rounds([o, l, n], 3);
      expect([l.slots.get("b"), n.slots.get("b")]).toEqual(["B1", "B1"]);
      l.update();
      const remove = async () => {
        await retireSecret(l.host, calDavSecretBinding("webdav", CAL, "bert"));
        l.rows = l.rows.filter((r) => r.id !== "b");
        l.slots.delete("b");
      };
      if (order.startsWith("before")) await remove();
      else await rounds([l], 1);
      if (!order.startsWith("before")) await remove();
      await rounds([l, o, n], 3);
      const current = Object.values(remote!.entries).find((e) => e.binding.secretType === "caldav-password-2" && e.binding.user === "bert");
      // The tombstone is written; the account leaves N with the settings
      // profile, which takes its slot — a tombstone alone never empties the
      // slot of an account still there (review 2026-11-25).
      expect([current?.tombstone, current?.deviceId, n.slots.get("b"), n.slots.get("r")]).toEqual([true, "L", "B1", "A1"]);
      n.rows = n.rows.filter((r) => r.id !== "b");
      n.slots.delete("b");
      await rounds([l, o, n], 3);
      const after = Object.values(remote!.entries).find((e) => e.binding.secretType === "caldav-password-2" && e.binding.user === "bert");
      expect([after?.tombstone, n.slots.get("r")]).toEqual([true, "A1"]);
    });
  }
});

describe("after a lost key: one baseline, never winning while it holds what it found (round thirteen)", () => {
  const row = (): Row[] => [{ id: "r", user: "anna" }];
  const entryOf = (user = "anna") => Object.values(remote?.entries ?? {}).find((e) => e.binding.secretType === "caldav-password-2" && e.binding.user === user);
  const docOf = () => {
    const e = entryOf();
    return e && `r${e.entryRev}:${(e.secret as { pass?: string } | undefined)?.pass ?? "-"}`;
  };

  it("the real sync step reads a document that changes nothing while the device waits, so the password reaches a new target", async () => {
    start();
    const n1 = device("N1", false, row(), { r: "P1" });
    await rounds([n1], 2);
    n1.keyring.clear();
    // A new sync target: nothing there; the merge alone changes nothing.
    let bytes: Uint8Array | null = null;
    const target = { download: async () => bytes, push: async (op: { content?: Uint8Array }) => void (bytes = op.content ?? null) } as unknown as ISyncTarget;
    const masterKey = { keyId: "aabbccddeeff0011", masterKey: new Uint8Array(32).fill(7) };
    for (let i = 0; i < 3; i++) await new SecretsSyncStep({ port: portOf(n1), masterKey, now: tick }).run(target, null as unknown as IVaultAdapter);
    const published = Object.values(openSecretsBundle(masterKey, bytes!).entries).map((e) => [e.entryRev, (e.secret as { pass?: string }).pass]);
    expect(published).toEqual([[1, "P1"]]);
  });

  it("a slot from an old backup is held against the version it knew and never goes out over the newer one, without uploads ever after", async () => {
    start();
    const n1 = device("N1", false, row());
    const n2 = device("N2", false, row());
    const f = device("F", false, row());
    for (const pass of ["P1", "P2", "P3"]) {
      n2.slots.set("r", pass);
      await rounds([n2, n1, f], 2);
    }
    for (const empty of [false, true]) {
      n1.slots.set("r", "P1");
      n1.keyring.clear();
      if (empty) remote = null;
      await rounds([n1, n2, f], 4);
      for (const d of [n1, n2, f]) d.pushes = 0;
      await rounds([n1, n2, f], 4);
      expect({ doc: docOf(), N1: n1.slots.get("r"), F: f.slots.get("r"), pushes: n1.pushes + n2.pushes + f.pushes }).toEqual({ doc: empty ? "r4:P3" : "r3:P3", N1: "P1", F: "P3", pushes: 0 });
      // Typing here leads out: the same password typed on N1 is published above everything seen (r4).
      n1.slots.set("r", "P3");
      await rounds([n1, n2, f], 2);
    }
  });

  const synced = async () => {
    start();
    const n1 = device("N1", false, row());
    const n2 = device("N2", false, row());
    const f = device("F", false, row());
    for (const pass of ["P1", "P2", "P3"]) {
      n2.slots.set("r", pass);
      await rounds([n2, n1, f], 2);
    }
    return { n1, n2, f };
  };
  const quiet = async (fleet: Device[]) => {
    for (const d of fleet) [d.pushes, d.reports, d.metaWrites] = [0, 0, 0];
    await rounds(fleet, 4);
    return fleet.map((d) => [d.name, d.pushes, d.reports, d.metaWrites]);
  };

  it("a slot from an old backup on a new, empty target is held and never goes out over the newer password", async () => {
    const { n1, n2, f } = await synced();
    n1.slots.set("r", "P1");
    n1.keyring.clear();
    remote = null;
    await rounds([n1, n2, f], 4);
    expect({ doc: docOf(), N1: n1.slots.get("r"), F: f.slots.get("r") }).toEqual({ doc: "r3:P3", N1: "P1", F: "P3" });
    expect(await quiet([n1, n2, f])).toEqual([["N1", 0, 0, 0], ["N2", 0, 0, 0], ["F", 0, 0, 0]]);
  });

  it("a moved phone without the password, on a new, empty target, gets it from the others", async () => {
    const { n1, n2, f } = await synced();
    n1.slots.delete("r");
    n1.keyring.clear();
    remote = null;
    await rounds([n1, n2, f], 4);
    expect({ doc: docOf(), N1: n1.slots.get("r") }).toEqual({ doc: "r3:P3", N1: "P3" });
  });

  it("a baseline the document confirms later is confirmed for good: no import, no write, no upload after", async () => {
    const { n1, n2, f } = await synced();
    n1.keyring.clear();
    const doc = remote;
    remote = null;
    // Alone on an empty target: nothing confirms what it found.
    await rounds([n1], 2);
    remote = doc;
    await rounds([n1, n2, f], 4);
    expect(Object.values(n1.meta!.entries).map((e) => [!!e.unconfirmed, !!e.sinceLoss, !!e.held])).toEqual([[false, false, false]]);
    expect(await quiet([n1, n2, f])).toEqual([["N1", 0, 0, 0], ["N2", 0, 0, 0], ["F", 0, 0, 0]]);
    expect(docOf()).toBe("r3:P3");
  });

  it("a device that kept its own password against two newer ones sends a password typed later above them (F73)", async () => {
    start();
    const n0 = device("N0", false, row());
    const n1 = device("N1", false, row());
    n0.slots.set("r", "OWN1");
    await rounds([n0, n1], 2);
    for (const pass of ["NEW2", "NEW3"]) {
      n1.slots.set("r", pass);
      await rounds([n1, n0], 2);
    }
    n0.slots.set("r", "TYP9");
    await rounds([n0, n1], 3);
    expect({ doc: docOf(), N0: n0.slots.get("r"), N1: n1.slots.get("r") }).toEqual({ doc: "r4:TYP9", N0: "TYP9", N1: "TYP9" });
  });

  it("a password typed after the first run since the loss goes out above every revision seen, also one this device refused", async () => {
    start();
    const n1 = device("N1", false, row(), { r: "P1" });
    const n2 = device("N2", false, row());
    await rounds([n1, n2], 2);
    for (const pass of ["P2", "P3"]) {
      n2.slots.set("r", pass);
      await rounds([n2, n1], 2);
    }
    // N1 typed P1 itself: it keeps its own, as on main.
    expect([n1.slots.get("r"), docOf()]).toEqual(["P1", "r3:P3"]);
    n1.keyring.clear();
    await round(n1);
    n1.slots.set("r", "NEW");
    await rounds([n1, n2], 3);
    // N2 typed P3 itself and keeps it, as on main; the document has NEW above all.
    expect(docOf()).toBe("r4:NEW");
  });

  it("a held slot whose key is lost again is held again with a new baseline, waits for nothing, and a password typed here gets out", async () => {
    start();
    const n1 = device("N1", false, row());
    const n2 = device("N2", false, row());
    n2.slots.set("r", "P2");
    await rounds([n2, n1], 2);
    n1.slots.set("r", "OLD");
    n1.keyring.clear();
    await rounds([n1, n2], 2);
    expect(Object.values(n1.meta!.entries).map((e) => !!e.held)).toEqual([true]);
    n1.keyring.clear();
    await rounds([n1, n2], 2);
    const own = await secretsMarker({ readSlot: async (slot) => n1.keyring.get(slot) ?? null, writeSlot: async () => undefined });
    const record = Object.values(n1.meta!.entries)[0];
    expect([own.owns(record.held!), own.owns(record.hash), record.sinceLoss, docOf(), n1.slots.get("r")]).toEqual([true, true, undefined, "r1:P2", "OLD"]);
    n1.slots.set("r", "NEW");
    await rounds([n1, n2], 2);
    expect(docOf()).toBe("r2:NEW");
  });

  it("\"Remove account\" right after the update writes no tombstone from an old name another account here still goes by", async () => {
    start();
    const rows = (): Row[] => [{ id: "a", user: "alice" }, { id: "b", user: "Alice" }];
    const o = device("O", true, [{ id: "a", user: "alice" }], { a: "A1" });
    const l = device("L", true, [{ id: "a", user: "alice" }]);
    await rounds([o, l], 3);
    l.update();
    l.rows = rows();
    l.slots.set("b", "B1");
    await retireSecret(l.host, calDavSecretBinding("webdav", CAL, "Alice"));
    l.rows = l.rows.filter((r) => r.id !== "b");
    l.slots.delete("b");
    await rounds([l, o], 2);
    // "Alice" was never published: no tombstone for it (review 2026-11-25,
    // a name this device knows nothing of is only noted), and none from what
    // the old name of "alice" knew.
    expect(entryOf("Alice")).toBeUndefined();
    expect([l.slots.get("a"), o.slots.get("a")]).toEqual(["A1", "A1"]);
  });
});
