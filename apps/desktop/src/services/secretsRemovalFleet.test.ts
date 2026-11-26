import { describe, expect, it } from "vitest";
import {
  assertSecretsBundleStructure,
  assertShareable,
  canonicalSecretId,
  canonicalizeEndpoint,
  mergeSecretsBundles,
  stableStringify,
  type SecretBinding,
  type SecretsBundle,
} from "@plainva/core";
import {
  SECRETS_MARK_KEY_SLOT,
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  mergeLegacySecretsMeta,
  migrateSecretsMetaToCanonicalIds,
  retireSecret,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";
import * as v090 from "../../../../packages/core/test/fixtures/secretsV090";

/**
 * Fleets of updated devices, devices on 0.9.0 and devices on 0.8.7, around
 * what takes an account away (review 2026-11-25). Devices on 0.8.7 and 0.9.0
 * run the frozen code of their tags (`secretsV087`, `secretsV090`); an updated
 * one runs today's. Both shells run the shared port with bindings from
 * `calDavSecretBinding` / `imapSecretBinding`, so this holds for both.
 *
 * Held here:
 *  - No updated device loses a password nobody removed: an address repaired
 *    on any device, an account the profile took away, a slot signed out here
 *    — in every mix with 0.9.0 and 0.8.7. The port of an updated device never
 *    empties the slot of an account that is still on it.
 *  - An account removed on purpose on an updated device ("Remove account", a
 *    mailbox left behind by a failed setup) stays removed: its password leaves
 *    the shared document under its current name and under the old name a
 *    device up to 0.8.7 knew it by, and no device keeps it in a slot.
 *  - "Sign out on this device" stays signed out when another device changes
 *    the password.
 *  - Every mix settles: no upload and nothing reported once it has.
 */

const URLS = { a: "https://cloud.example.com/remote.php/dav", b: "https://dav.example.org/remote.php/dav" } as const;
const HOSTS = { a: "imap.example.com", b: "mail.example.org" } as const;
type At = keyof typeof URLS;
type Row = { id: string; user: string; kind?: "mail"; at?: At };
type Kind = "new" | "v090" | "v087";
type Slot = string | { signedOut: true };

let clock = 0;
const tick = () => new Date(Date.parse("2026-11-25T00:00:00.000Z") + 1000 * clock++).toISOString();

const oldBinding = (row: Row): SecretBinding =>
  row.kind === "mail"
    ? { family: "imap", service: "mail", secretType: "imap-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(`imaps://${HOSTS[row.at ?? "a"]}:993`) }
    : { family: "webdav", service: "calendar", secretType: "caldav-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(URLS[row.at ?? "a"]) };
const newBinding = (row: Row): SecretBinding =>
  row.kind === "mail" ? imapSecretBinding("imap", HOSTS[row.at ?? "a"], 993, row.user) : calDavSecretBinding("webdav", URLS[row.at ?? "a"], row.user);

interface Device {
  name: string;
  kind: Kind;
  rows: Row[];
  slots: Map<string, Slot>;
  keyring: Map<string, unknown>;
  meta: SecretsPortMeta | null;
  /** What "Remove account" asked to be tombstoned, under its own name (as both shells keep it). */
  retired: SecretsPortMeta["retired"] | null;
  pushes: number;
  reports: number;
  /** Slots the port of an updated device emptied (it never may while the account is here). */
  emptiedByPort: string[];
}

function device(name: string, kind: Kind, rows: Row[], slots: Record<string, Slot> = {}): Device {
  return { name, kind, rows: rows.map((row) => ({ ...row })), slots: new Map(Object.entries(slots)), keyring: new Map(), meta: null, retired: null, pushes: 0, reports: 0, emptiedByPort: [] };
}

/** The record as the shells keep it: the marks under one name, the removals under another. */
function metaHost(d: Device) {
  return {
    readMeta: async (): Promise<SecretsPortMeta | null> => {
      const meta = d.meta ? (structuredClone(d.meta) as SecretsPortMeta) : d.retired ? { entries: {}, imported: {}, quarantine: {} } : null;
      if (meta && d.retired) meta.retired = { ...(meta.retired ?? {}), ...structuredClone(d.retired) };
      return d.kind === "v087" ? meta : migrateSecretsMetaToCanonicalIds(mergeLegacySecretsMeta(meta, null));
    },
    writeMeta: async (meta: SecretsPortMeta) => {
      const { retired, ...marks } = structuredClone(meta);
      d.meta = marks as SecretsPortMeta;
      d.retired = retired && Object.keys(retired).length > 0 ? retired : null;
    },
  };
}
const retiredHost = (d: Device) => ({
  readMeta: async (): Promise<SecretsPortMeta | null> => ({ entries: {}, imported: {}, quarantine: {}, retired: structuredClone(d.retired ?? {}) }),
  writeMeta: async (meta: SecretsPortMeta) => {
    d.retired = structuredClone(meta.retired ?? {});
  },
});

function candidates(d: Device): LocalSecretCandidate[] {
  return d.rows.map((row) => {
    const binding = d.kind === "v087" ? oldBinding(row) : newBinding(row);
    const slot = d.slots.get(row.id);
    const pass = typeof slot === "string" ? slot : undefined;
    return {
      logicalId: d.kind === "v087" ? v087.canonicalSecretId(binding as never) : canonicalSecretId(binding),
      slot: row.id,
      binding,
      secret: pass ? { pass } : null,
      ...(typeof slot === "object" ? { signedOutHere: true } : {}),
      apply: (secret: Record<string, string>) => secret.pass,
    } as LocalSecretCandidate;
  });
}

function portOf(d: Device) {
  const host = {
    deviceId: async () => d.name,
    ...metaHost(d),
    candidates: async () => candidates(d),
    readSlot: async (slot: string) => (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.get(slot) : d.slots.get(slot)) ?? null,
    writeSlot: async (slot: string, value: unknown) => void (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.set(slot, value) : d.slots.set(slot, value as string)),
    removeSlot: async (slot: string) => {
      if (d.kind === "new" && d.rows.some((row) => row.id === slot)) d.emptiedByPort.push(slot);
      d.slots.delete(slot);
    },
    now: tick,
  };
  if (d.kind === "v087") return v087.createSecretsPort(host as never);
  if (d.kind === "v090") return v090.createSecretsPort(host as never);
  return createSecretsPort(host);
}

let remote: SecretsBundle | null = null;
async function round(d: Device): Promise<void> {
  const port = portOf(d);
  if (d.kind === "v087") {
    const next = await v087.runV087Round(port as never, remote as never, tick());
    if (next.pushed) d.pushes++;
    remote = next.remote as SecretsBundle;
    return;
  }
  if (d.kind === "v090") {
    const next = await v090.runV090Round(port as never, remote as never, tick());
    if (next.pushed) d.pushes++;
    if (next.reported) d.reports++;
    remote = next.remote as SecretsBundle;
    return;
  }
  if (remote) assertSecretsBundleStructure(structuredClone(remote));
  const current = port as ReturnType<typeof createSecretsPort>;
  const local = await current.exportBundle();
  for (const entry of Object.values(local.entries)) if (!entry.tombstone) assertShareable(entry);
  const merged = mergeSecretsBundles(local, remote, tick());
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || current.awaitsDocument?.()) {
    if (!(await current.importBundle(merged)).settled) d.reports++;
  }
  if (!remote || stableStringify(merged.entries) !== stableStringify(remote.entries)) {
    d.pushes++;
    remote = merged;
  }
}
async function rounds(fleet: Device[], times: number): Promise<void> {
  for (let i = 0; i < times; i++) for (const d of fleet) await round(d);
}
function start(): void {
  remote = null;
  clock = 0;
}

/** "Remove account" on a device, as its version does it. */
async function removeOnPurpose(d: Device, rowId: string): Promise<void> {
  const row = d.rows.find((item) => item.id === rowId)!;
  const take = async () => {
    d.rows = d.rows.filter((item) => item.id !== rowId);
    d.slots.delete(rowId);
  };
  if (d.kind === "new") {
    await retireSecret(retiredHost(d), newBinding(row), take, tick());
    // A port that does not take the removal into its line leaves it to the caller, as the shells did.
    if (d.rows.some((item) => item.id === rowId)) await take();
    return;
  }
  // 0.9.0 retired only calendar accounts; a mailbox went by the absence alone.
  if (d.kind === "v090" && row.kind !== "mail") await v090.retireSecret(retiredHost(d) as never, newBinding(row) as never);
  await take();
}
/** The settings profile brought a removal made elsewhere: the row and its slot go (calendar on every version, a mailbox from this version on). */
function removedByProfile(d: Device, rowId: string): void {
  const row = d.rows.find((item) => item.id === rowId);
  d.rows = d.rows.filter((item) => item.id !== rowId);
  if (row?.kind !== "mail" || d.kind === "new") d.slots.delete(rowId);
}
/** The address of an account repaired on this device (same row, another server); every other device keeps its own. */
function repair(d: Device, rowId: string, at: At, pass?: string): void {
  const row = d.rows.find((item) => item.id === rowId)!;
  row.at = at;
  if (pass) d.slots.set(rowId, pass);
}
const signOut = (d: Device, rowId: string) => d.slots.set(rowId, { signedOut: true });

const pass = (d: Device, rowId: string) => d.slots.get(rowId);
/** Every entry of the document for this account, under its current name and its old one. */
function entriesFor(row: Row): Array<[string, SecretsBundle["entries"][string]]> {
  const ids = new Set([canonicalSecretId(newBinding(row)), v087.canonicalSecretId(oldBinding(row) as never)]);
  return Object.entries(remote?.entries ?? {}).filter(([id]) => ids.has(id));
}
async function settledFleet(fleet: Device[]): Promise<void> {
  await rounds(fleet, 4);
  for (const d of fleet) {
    d.pushes = 0;
    d.reports = 0;
  }
  const settled = stableStringify(remote);
  await rounds(fleet, 3);
  // Devices on 0.8.7 and 0.9.0 report as their version does (an entry for an address they do not have, every round).
  expect(Object.fromEntries(fleet.map((d) => [d.name, [d.pushes, d.kind === "new" ? d.reports : 0]]))).toEqual(Object.fromEntries(fleet.map((d) => [d.name, [0, 0]])));
  expect(stableStringify(remote)).toBe(settled);
}

const KINDS: Array<[string, Row["kind"]]> = [["a calendar", undefined], ["a mailbox", "mail"]];

describe("an address repaired on one device takes no password from another", () => {
  for (const [what, kind] of KINDS) {
    for (const repairer of ["new", "v090", "v087"] as const) {
      it(`${what}, repaired on a device on ${repairer}`, async () => {
        start();
        const row = (): Row[] => [{ id: "r", user: "anna@example.com", ...(kind ? { kind } : {}) }];
        const a = device("A", repairer, row(), { r: "P1" });
        const n1 = device("N1", "new", row());
        const n2 = device("N2", "new", row(), { r: "P1" });
        const o9 = device("O9", "v090", row());
        const o7 = device("O7", "v087", row(), { r: "P1" });
        const fleet = [a, n1, n2, o9, o7];
        await rounds(fleet, 3);
        expect(pass(n1, "r")).toBe("P1");
        repair(a, "r", "b", "P2");
        await rounds(fleet, 4);
        // Every updated device keeps the password of the address it still has.
        expect({ N1: pass(n1, "r"), N2: pass(n2, "r") }).toEqual({ N1: "P1", N2: "P1" });
        expect([...n1.emptiedByPort, ...n2.emptiedByPort]).toEqual([]);
        // The device on 0.8.7 typed its own: nothing takes it.
        expect(pass(o7, "r")).toBe("P1");
        // A repair on an updated device costs the device on 0.9.0 nothing either.
        if (repairer !== "v090") expect(pass(o9, "r")).toBe("P1");
        await settledFleet(fleet);
      });
    }
  }
});

describe("an account the profile took away writes no tombstone", () => {
  for (const [what, kind] of KINDS) {
    it(`${what}: a device that only received the removal publishes nothing new for it`, async () => {
      start();
      // A second account, so the list of the device is not empty (an empty one was never taken as a removal).
      const row = (): Row[] => [{ id: "r", user: "anna@example.com", ...(kind ? { kind } : {}) }, { id: "k", user: "bert@example.com", ...(kind ? { kind } : {}) }];
      const n1 = device("N1", "new", row(), { r: "P1", k: "K1" });
      const n2 = device("N2", "new", row());
      const o9 = device("O9", "v090", row());
      await rounds([n1, n2, o9], 3);
      // A repair on N1 that the profile carries as a removal elsewhere: N2 has the
      // row no more, N1 still has it (another device's view, not a removal).
      removedByProfile(n2, "r");
      await rounds([n2, n1, o9], 4);
      const tombstones = Object.values(remote!.entries).filter((entry) => entry.tombstone);
      expect(tombstones).toEqual([]);
      expect({ N1: pass(n1, "r"), O9: pass(o9, "r") }).toEqual({ N1: "P1", O9: "P1" });
      await settledFleet([n1, n2, o9]);
    });
  }
});

describe("an account removed on purpose stays removed everywhere", () => {
  for (const [what, kind] of KINDS) {
    for (const order of ["profile first", "secrets first"] as const) for (const withOld of [true, false]) {
      it(`${what}, ${order}, ${withOld ? "a device on 0.8.7 still there" : "every device updated"}: no slot keeps it and the document has it under no name`, async () => {
        start();
        const r: Row = { id: "r", user: "anna@example.com", ...(kind ? { kind } : {}) };
        const keep: Row = { id: "k", user: "bert@example.com", ...(kind ? { kind } : {}) };
        // U came from 0.8.7: it knows the old name of the account as its own.
        const u = device("U", "v087", [r, keep], { r: "P1", k: "K1" });
        const n2 = device("N2", "new", [r, keep]);
        const o9 = device("O9", "v090", [r, keep]);
        const o7 = device("O7", "v087", [r, keep]);
        const fleet = [u, n2, o9, o7];
        await rounds(fleet, 3);
        u.kind = "new";
        if (!withOld) o7.kind = "new";
        await rounds(fleet, 3);
        expect({ N2: pass(n2, "r"), O9: pass(o9, "r"), O7: pass(o7, "r") }).toEqual({ N2: "P1", O9: "P1", O7: "P1" });
        await removeOnPurpose(u, "r");
        if (order === "profile first") for (const d of [n2, o9, o7]) removedByProfile(d, "r");
        await rounds(fleet, 2);
        if (order === "secrets first") for (const d of [n2, o9, o7]) removedByProfile(d, "r");
        await rounds(fleet, 3);
        // Up to 0.9.0 the profile took a mailbox's row and left its slot, which no account reads any more (their version).
        // Secrets first, 0.9.0 keeps it too: N2 still has the account when the tombstone comes, so its password goes
        // out above it (a tombstone never empties the slot of an account still here) until the profile takes it there.
        for (const d of fleet) if (d.kind === "new" || kind !== "mail" || (order === "secrets first" && d.kind === "v087")) expect(d.slots.has("r"), d.name).toBe(false);
        for (const d of fleet) expect(d.rows.some((item) => item.id === "r"), d.name).toBe(false);
        expect(entriesFor(r).length).toBeGreaterThanOrEqual(2);
        for (const [id, entry] of entriesFor(r)) expect(entry.tombstone, id).toBe(true);
        // The other account is untouched.
        expect(Object.fromEntries(fleet.map((d) => [d.name, pass(d, "k")]))).toEqual({ U: "K1", N2: "K1", O9: "K1", O7: "K1" });
        await settledFleet(fleet);
      });
    }

    it(`${what}: a newer password the remover had not seen yet goes too`, async () => {
      start();
      const r: Row = { id: "r", user: "anna@example.com", ...(kind ? { kind } : {}) };
      const n1 = device("N1", "new", [r], { r: "P1" });
      const n2 = device("N2", "new", [r]);
      await rounds([n1, n2], 3);
      // N2 changes the password, twice, and N1 has not seen it when it removes the account.
      n2.slots.set("r", "P2");
      await round(n2);
      n2.slots.set("r", "P3");
      await round(n2);
      await removeOnPurpose(n1, "r");
      await rounds([n1, n2], 2);
      removedByProfile(n2, "r");
      await rounds([n2, n1], 3);
      for (const [id, entry] of entriesFor(r)) expect(entry.tombstone, id).toBe(true);
      await settledFleet([n1, n2]);
    });
  }

  it("the old name of a removed account is not written while a twin here may mean it", async () => {
    start();
    const twins = (): Row[] => [{ id: "rA", user: "Alice" }, { id: "ra", user: "alice" }];
    const u = device("U", "v087", [{ id: "ra", user: "alice" }], { ra: "pa" });
    await rounds([u], 2);
    u.kind = "new";
    u.rows = twins();
    u.slots.set("rA", "pA");
    await rounds([u], 2);
    await removeOnPurpose(u, "rA");
    await rounds([u], 2);
    const oldName = v087.canonicalSecretId(oldBinding({ id: "ra", user: "alice" }) as never);
    expect(remote!.entries[oldName]?.tombstone).toBeUndefined();
    expect(pass(u, "ra")).toBe("pa");
  });
});

describe("\"Sign out on this device\" stays signed out", () => {
  for (const [what, kind] of KINDS) {
    it(`${what}: a newer password from another device does not sign it in again`, async () => {
      start();
      const row = (): Row[] => [{ id: "r", user: "anna@example.com", ...(kind ? { kind } : {}) }];
      const n1 = device("N1", "new", row(), { r: "P1" });
      const n2 = device("N2", "new", row());
      await rounds([n1, n2], 3);
      expect(pass(n2, "r")).toBe("P1");
      signOut(n2, "r");
      await rounds([n2, n1], 2);
      n1.slots.set("r", "P2");
      await rounds([n1, n2], 3);
      expect(pass(n2, "r")).toEqual({ signedOut: true });
      // Its own sign-in later is an ordinary change: it goes out.
      n2.slots.set("r", "P3");
      await rounds([n2, n1], 3);
      expect(remote!.entries[canonicalSecretId(newBinding(row()[0]))]?.secret).toEqual({ pass: "P3" });
      await settledFleet([n1, n2]);
    });
  }
});

/**
 * Random fleets of updated devices, devices on 0.9.0 and devices on 0.8.7
 * (review 2026-11-25): passwords typed, addresses repaired, accounts removed
 * on purpose (and taken away by the profile on every other device), slots
 * signed out, devices updated on the way. Held after every step: the port of
 * an updated device empties no slot of an account still on it, and signs no
 * slot signed out here in again. Held at the end: every mix settles with no
 * upload and nothing reported, and an account an updated device removed on
 * purpose, which no device has again, has no password in the document.
 */
async function fuzz(seed: number): Promise<{ problems: string[]; uploads: number; paths: Set<string> }> {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(r() * items.length)];
  start();
  const POOL: Row[] = [{ id: "a", user: "anna" }, { id: "b", user: "Bert" }, { id: "m", user: "carl@example.com", kind: "mail" }, { id: "n", user: "dora@example.com", kind: "mail" }];
  const kinds: Kind[] = ["new", "new", "v090", "v087"];
  const fleet = kinds.slice(0, 2 + Math.floor(r() * 3)).map((kind, i) => device(`${kind}-${i}`, i === 0 ? "new" : pick(kinds), POOL.filter(() => r() < 0.8)));
  let n = 0;
  for (const d of fleet) for (const row of d.rows) if (r() < 0.5) d.slots.set(row.id, `${row.id}${++n}`);
  const problems: string[] = [];
  const paths = new Set<string>();
  const removedOnPurpose = new Set<string>();
  const signedOut = new Set<string>();
  const order = () => [...fleet].sort(() => r() - 0.5);
  const check = (where: string) => {
    for (const d of fleet) {
      for (const slot of d.emptiedByPort) problems.push(`${where}: ${d.name} emptied ${slot}`);
      d.emptiedByPort.length = 0;
      for (const row of d.rows) if (signedOut.has(`${d.name}/${row.id}`) && typeof d.slots.get(row.id) !== "object") problems.push(`${where}: ${d.name} signed in ${row.id} again`);
    }
  };
  await rounds(order(), 3);
  for (let e = 0; e < 8; e++) {
    const d = pick(fleet);
    const k = r();
    const row = d.rows.length ? pick(d.rows) : null;
    if (row && k < 0.3) {
      d.slots.set(row.id, `${row.id}${++n}`);
      signedOut.delete(`${d.name}/${row.id}`);
      paths.add("typed");
    } else if (row && k < 0.45) {
      const typed = r() < 0.5 ? `${row.id}${++n}` : undefined;
      repair(d, row.id, row.at === "b" ? "a" : "b", typed);
      if (typed) signedOut.delete(`${d.name}/${row.id}`);
      paths.add(`repaired on ${d.kind}`);
    } else if (row && k < 0.6) {
      if (d.kind === "new") removedOnPurpose.add(canonicalSecretId(newBinding(row)));
      await removeOnPurpose(d, row.id);
      for (const other of fleet) if (other !== d) removedByProfile(other, row.id);
      for (const other of fleet) signedOut.delete(`${other.name}/${row.id}`);
      paths.add(`removed on ${d.kind}`);
    } else if (row && k < 0.7 && d.kind === "new") {
      signOut(d, row.id);
      signedOut.add(`${d.name}/${row.id}`);
      paths.add("signed out");
    } else if (k < 0.85) {
      const back = pick(POOL);
      if (!d.rows.some((item) => item.id === back.id)) {
        d.rows.push({ ...back });
        removedOnPurpose.delete(canonicalSecretId(newBinding(back)));
        if (r() < 0.5) d.slots.set(back.id, `${back.id}${++n}`);
        paths.add("added");
      }
    } else if (d.kind !== "new") {
      d.kind = "new";
      paths.add("updated");
    }
    for (const x of order()) if (r() < 0.7) await round(x);
    check(`event ${e}`);
  }
  await rounds(order(), 6);
  check("end");
  for (const d of fleet) {
    d.pushes = 0;
    d.reports = 0;
  }
  const settled = stableStringify(remote);
  await rounds(order(), 4);
  // Uploads only: here the devices do not share their account lists through a
  // profile, and an entry for an account a device does not have waits there,
  // reported each round, as it always has.
  let uploads = fleet.reduce((sum, d) => sum + d.pushes, 0);
  if (stableStringify(remote) !== settled) uploads++;
  const stillHere = new Set(fleet.flatMap((d) => d.rows.map((row) => canonicalSecretId(newBinding(row)))));
  for (const id of removedOnPurpose) {
    const entry = remote?.entries[id];
    if (!stillHere.has(id) && entry && !entry.tombstone) problems.push(`end: ${id} removed on purpose still has a password`);
  }
  return { problems, uploads, paths };
}

describe("random fleets around what takes an account away", () => {
  it("lose no password nobody removed, keep a signed-out slot signed out, settle, and drop what was removed", async () => {
    const paths = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const result = await fuzz(seed);
      for (const path of result.paths) paths.add(path);
      expect(result.problems, `seed ${seed}`).toEqual([]);
      expect(result.uploads, `seed ${seed}`).toBe(0);
    }
    // The seeds take every path, on every version.
    expect([...paths].sort()).toEqual(
      ["added", "removed on new", "removed on v087", "removed on v090", "repaired on new", "repaired on v087", "repaired on v090", "signed out", "typed", "updated"].sort(),
    );
  });
});
