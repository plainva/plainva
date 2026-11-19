import { describe, expect, it } from "vitest";
import {
  assertShareable,
  canonicalSecretId,
  canonicalizeEndpoint,
  mergeSecretsBundles,
  stableStringify,
  type SecretBinding,
  type SecretEntry,
  type SecretsBundle,
} from "@plainva/core";
import { SECRETS_MARK_KEY_SLOT, calDavSecretBinding, createSecretsPort, imapSecretBinding, retireSecret, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";
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
  meta: SecretsPortMeta | null;
  pushes: number;
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
    pushes: 0,
    reports: 0,
    update: () => {
      d.legacy = false;
    },
    host: {
      readMeta: async () => d.meta,
      writeMeta: async (meta) => {
        d.meta = structuredClone(meta);
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
    ...d.host,
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
  if (stableStringify(merged.entries) !== stableStringify(local.entries)) {
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
});
