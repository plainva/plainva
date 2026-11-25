import { describe, expect, it, vi } from "vitest";
import { canonicalizeEndpoint, mergeSecretsBundles, stableStringify, type SecretBinding, type SecretsBundle } from "@plainva/core";
import { SECRETS_MARK_KEY_SLOT, setPlatformServices, type SecretsPortMeta } from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";

/**
 * No password in the settings file (review 2026-11-18, rounds eight and nine,
 * F67).
 *
 * The secrets sync keeps a mark of each password it published or took, to
 * tell "unchanged" from "changed". Since 0.5.0 that mark was the binding and
 * the secret as text, in the app's settings — which the system backup copies:
 * every synced password stood there in plain text. These tests run the
 * phone's port as it runs there, in
 * random fleets of updated devices and devices on 0.8.7 (some updated on the
 * way, sealed at their start as the app does), with calendars and mailboxes,
 * passwords typed, signed out, removed, and a mark key lost. After every step
 * each updated device's whole settings store is read: every value made from a
 * password is a mark (`m1:<key id>.<HMAC>`), and no password is in it, not
 * even four characters of one. The desktop holds the same in
 * `apps/desktop/src/services/secretsStoreNoPassword.test.ts`.
 */

const VAULT = "vault-1";
const LEGACY_KEY = `settingsSyncSecretMetaMobile_${VAULT}`;
const CURRENT_KEY = `settingsSyncSecretMarksMobile_${VAULT}`;
const CAL = "https://cloud.example.com/remote.php/dav";
type Account = { id: string; kind: "calendar" | "mail"; user: string };
type Device = { name: string; legacy: boolean; store: Map<string, unknown>; slots: Map<string, unknown>; accounts: Account[] };

const state = vi.hoisted(() => ({ current: null as null | { store: Map<string, unknown>; slots: Map<string, unknown>; accounts: Array<{ id: string; kind: string; user: string }> } }));

const keychain = vi.hoisted(() => ({ refuse: 0, readOnly: false }));
setPlatformServices({
  loadSettings: async () => ({
    get: async (key: string) => structuredClone(state.current!.store.get(key) ?? null),
    set: async (key: string, value: unknown) => void state.current!.store.set(key, structuredClone(value)),
    delete: async (key: string) => state.current!.store.delete(key),
    keys: async () => [...state.current!.store.keys()],
    save: async () => undefined,
  }),
  credentials: {
    // The keychain throws when it does not answer, as the native store does.
    readSecret: async (key: string) => {
      if (key === SECRETS_MARK_KEY_SLOT && keychain.refuse > 0) {
        keychain.refuse--;
        throw new Error("keychain locked");
      }
      return structuredClone(state.current!.slots.get(key) ?? null);
    },
    writeSecret: async (key: string, value: unknown) => {
      if (key === SECRETS_MARK_KEY_SLOT && keychain.readOnly) throw new Error("keychain is read-only");
      state.current!.slots.set(key, structuredClone(value));
    },
    removeSecret: async (key: string) => void state.current!.slots.delete(key),
  },
} as never);
vi.mock("./pim/pimService", () => ({
  listPimAccounts: vi.fn(async () => state.current!.accounts.filter((a) => a.kind === "calendar").map((a) => ({ id: a.id, provider: "caldav", config: { url: "https://cloud.example.com/remote.php/dav", user: a.user } }))),
  isPimRuntimeReady: vi.fn(() => true),
}));
vi.mock("@plainva/ui/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui/mail")>();
  return {
    ...actual,
    listMailAccounts: vi.fn(async () =>
      state.current!.accounts.filter((a) => a.kind === "mail").map((a) => ({ id: a.id, label: a.user, host: "imap.example.com", port: 993, user: a.user })),
    ),
  };
});
vi.mock("./pim/pimCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pim/pimCredentials")>();
  return { ...actual, getPimCredentials: vi.fn(async (vault: string, id: string) => structuredClone(state.current!.slots.get(actual.pimSecretKey(vault, id)) ?? null)) };
});

import { createMobileSecretsPort, retireCalDavSecret, sealSecretsMetaAtStart } from "./mobileSecretsPort";
import { mailSecretKey } from "@plainva/ui/mail";
import { pimSecretKey } from "./pim/pimCredentials";

const slotOf = (a: Account) => (a.kind === "mail" ? mailSecretKey(VAULT, a.id) : pimSecretKey(VAULT, a.id));
const secretOf = (a: Account, pass: string) => (a.kind === "mail" ? { pass } : { kind: "caldav", url: CAL, user: a.user, pass });
const passOf = (value: unknown) => (value as { pass?: string } | null)?.pass;

/** How 0.8.7 named a password: the old type, the user lower-cased. */
const oldBinding = (a: Account): SecretBinding =>
  (a.kind === "mail"
    ? { family: "imap", service: "mail", secretType: "imap-password", user: a.user.toLowerCase(), endpoint: canonicalizeEndpoint("imaps://imap.example.com:993") }
    : { family: "webdav", service: "calendar", secretType: "caldav-password", user: a.user.toLowerCase(), endpoint: canonicalizeEndpoint(CAL) }) as never;

let tick = 0;
const now = () => new Date(Date.parse("2026-11-19T00:00:00.000Z") + 1000 * tick++).toISOString();

function legacyPort(d: Device) {
  return v087.createSecretsPort({
    deviceId: async () => d.name,
    readMeta: async () => structuredClone((d.store.get(LEGACY_KEY) as SecretsPortMeta | undefined) ?? null),
    writeMeta: async (meta: unknown) => void d.store.set(LEGACY_KEY, structuredClone(meta)),
    candidates: async () =>
      d.accounts.map((a) => ({
        logicalId: v087.canonicalSecretId(oldBinding(a) as never),
        slot: slotOf(a),
        binding: oldBinding(a) as never,
        secret: passOf(d.slots.get(slotOf(a))) ? { pass: passOf(d.slots.get(slotOf(a))) } : null,
        apply: (secret: { pass?: string }) => secretOf(a, secret.pass ?? ""),
      })),
    readSlot: async (slot: string) => structuredClone(d.slots.get(slot) ?? null),
    writeSlot: async (slot: string, value: unknown) => void d.slots.set(slot, structuredClone(value)),
    removeSlot: async (slot: string) => void d.slots.delete(slot),
    now,
  } as never);
}

/**
 * Looks at the store after each half of a round: a value written in plain
 * text by one half would otherwise be sealed by the next read before anyone
 * looked.
 */
let watch: ((d: Device) => void) | null = null;

async function round(d: Device, remote: SecretsBundle | null): Promise<SecretsBundle> {
  if (d.legacy) return (await v087.runV087Round(legacyPort(d) as never, remote as never, now())).remote as SecretsBundle;
  state.current = d;
  const port = createMobileSecretsPort(VAULT);
  const local = await port.exportBundle();
  watch?.(d);
  const merged = mergeSecretsBundles(local, remote, now());
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || port.awaitsDocument?.()) {
    await port.importBundle(merged);
    watch?.(d);
  }
  return merged;
}

/** The start of an updated app on this device: the marks are sealed first. */
async function start(d: Device): Promise<void> {
  d.legacy = false;
  state.current = d;
  await sealSecretsMetaAtStart();
}

/** Passwords of characters nothing else in the store is made of, so any four of them in a row are a leak. */
function maker(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return { next, password: () => Array.from({ length: 10 }, () => "~äöü§¿"[Math.floor(next() * 6)]).join("") };
}

const MARK = /^m1:[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/;

/** What is wrong in a device's settings store: a value made from a password that is no mark, or a password in it. */
function problems(d: Device, passwords: readonly string[]): string[] {
  const out: string[] = [];
  const text = JSON.stringify([...d.store]);
  for (const password of passwords) {
    for (let i = 0; i + 4 <= password.length; i++) {
      if (text.includes(password.slice(i, i + 4))) {
        out.push(`${d.name}: holds ${password}`);
        break;
      }
    }
  }
  if (d.store.has(LEGACY_KEY)) out.push(`${d.name}: a record under the name 0.8.7 reads`);
  const meta = d.store.get(CURRENT_KEY) as SecretsPortMeta | undefined;
  for (const [id, entry] of Object.entries(meta?.entries ?? {})) {
    if (entry.tombstone ? entry.hash !== "" : !MARK.test(entry.hash)) out.push(`${d.name}: ${id} hash ${entry.hash}`);
    if (entry.held !== undefined && !MARK.test(entry.held)) out.push(`${d.name}: ${id} held ${entry.held}`);
  }
  if (meta?.settled !== undefined && !MARK.test(meta.settled)) out.push(`${d.name}: settled ${meta.settled}`);
  return out;
}

const POOL: Account[] = [
  { id: "c1", kind: "calendar", user: "anna" },
  { id: "c2", kind: "calendar", user: "Bert" },
  { id: "m1", kind: "mail", user: "Carl@Example.com" },
];

/** One random fleet; the paths it took, and every problem found on the way. */
async function fleet(seed: number): Promise<{ problems: string[]; paths: Set<string> }> {
  const { next, password } = maker(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(next() * a.length)];
  const used: string[] = [];
  const paths = new Set<string>();
  const devices: Device[] = ["N1", "N2", "O1", "O2"].map((name) => ({
    name,
    legacy: name.startsWith("O"),
    store: new Map(),
    slots: new Map(),
    accounts: POOL.map((a) => ({ ...a })),
  }));
  for (const a of POOL) {
    const pass = password();
    used.push(pass);
    pick(devices).slots.set(slotOf(a), secretOf(a, pass));
  }
  let remote: SecretsBundle | null = null;
  const found: string[] = [];
  const check = (where: string) => {
    for (const d of devices) if (!d.legacy) for (const p of problems(d, used)) found.push(`seed ${seed} ${where}: ${p}`);
  };
  watch = (d) => {
    for (const p of problems(d, used)) found.push(`seed ${seed} in a round: ${p}`);
  };
  for (let i = 0; i < 2; i++) for (const d of devices) remote = await round(d, remote);
  for (let step = 0; step < 14; step++) {
    const d = pick(devices);
    const k = next();
    const a = pick(d.accounts.length ? d.accounts : POOL);
    if (k < 0.4) {
      const pass = password();
      used.push(pass);
      d.slots.set(slotOf(a), secretOf(a, pass));
      paths.add("typed");
    } else if (k < 0.5) {
      d.slots.delete(slotOf(a));
      paths.add("signed out");
    } else if (k < 0.6 && !d.legacy && a.kind === "calendar" && d.accounts.includes(a)) {
      state.current = d;
      await retireCalDavSecret(VAULT, CAL, a.user, async () => {
        d.accounts = d.accounts.filter((x) => x !== a);
        d.slots.delete(slotOf(a));
      });
      paths.add("removed");
    } else if (k < 0.7 && !d.legacy) {
      d.slots.delete(SECRETS_MARK_KEY_SLOT);
      paths.add("key lost");
    } else if (k < 0.8 && d.legacy) {
      // Sometimes a password typed on 0.8.7 right before the update, with no
      // round between: the update finds it changed against its record.
      if (next() < 0.5) {
        const pass = password();
        used.push(pass);
        d.slots.set(slotOf(a), secretOf(a, pass));
        paths.add("typed before the update");
      }
      await start(d);
      paths.add("updated");
    } else {
      const missing = POOL.filter((x) => !d.accounts.some((y) => y.id === x.id));
      if (missing.length) {
        d.accounts.push({ ...pick(missing) });
        paths.add("added again");
      }
    }
    for (const x of devices) if (next() < 0.8) remote = await round(x, remote);
    check(`step ${step}`);
  }
  for (let i = 0; i < 4; i++) for (const d of devices) remote = await round(d, remote);
  check("end");
  watch = null;
  return { problems: found, paths };
}

describe("the secrets sync keeps no password in the phone's settings store (F67)", () => {
  it("not after any step of random mixed fleets, and every value made from a password is a mark", async () => {
    const paths = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const result = await fleet(seed);
      expect(result.problems).toEqual([]);
      for (const p of result.paths) paths.add(p);
    }
    // The fleets took every way a mark is written.
    expect([...paths].sort()).toEqual(["added again", "key lost", "removed", "signed out", "typed", "typed before the update", "updated"]);
  });

  it("not on the ways the fleets seldom take: an empty slot or a fresh password at the update, an empty slot when the key is lost", async () => {
    const mail = POOL[2];
    const run = async (steps: (d: Device, other: Device, remote: { at: SecretsBundle | null }) => Promise<void>) => {
      const d: Device = { name: "D", legacy: true, store: new Map(), slots: new Map(), accounts: [{ ...mail }] };
      const other: Device = { name: "N", legacy: false, store: new Map(), slots: new Map(), accounts: [{ ...mail }] };
      const remote = { at: null as SecretsBundle | null };
      const between: string[] = [];
      watch = (x) => void between.push(...problems(x, ["pw-first-1", "pw-again-2"]));
      await steps(d, other, remote);
      watch = null;
      return [...between, ...problems(d, ["pw-first-1", "pw-again-2"]), ...problems(other, ["pw-first-1", "pw-again-2"])];
    };
    // Signed out on 0.8.7, then updated: the moved record is the mark of no secret.
    expect(await run(async (d, other, remote) => {
      d.slots.set(slotOf(mail), secretOf(mail, "pw-first-1"));
      remote.at = await round(d, remote.at);
      d.slots.delete(slotOf(mail));
      remote.at = await round(d, remote.at);
      await start(d);
      remote.at = await round(d, remote.at);
      remote.at = await round(other, remote.at);
    })).toEqual([]);
    // A password typed on 0.8.7 right before the update: the moved record says "changed here".
    expect(await run(async (d, other, remote) => {
      d.slots.set(slotOf(mail), secretOf(mail, "pw-first-1"));
      remote.at = await round(d, remote.at);
      d.slots.set(slotOf(mail), secretOf(mail, "pw-again-2"));
      await start(d);
      remote.at = await round(d, remote.at);
      remote.at = await round(other, remote.at);
    })).toEqual([]);
    // The key lost while the slot is empty: the record is restored as the mark of no secret.
    expect(await run(async (d, other, remote) => {
      d.legacy = false;
      d.slots.set(slotOf(mail), secretOf(mail, "pw-first-1"));
      remote.at = await round(d, remote.at);
      remote.at = await round(other, remote.at);
      d.slots.delete(slotOf(mail));
      d.slots.delete(SECRETS_MARK_KEY_SLOT);
      remote.at = await round(d, remote.at);
      remote.at = await round(d, remote.at);
    })).toEqual([]);
    // The key lost and a password typed right after: the record says "changed here".
    expect(await run(async (d, other, remote) => {
      d.legacy = false;
      d.slots.set(slotOf(mail), secretOf(mail, "pw-first-1"));
      remote.at = await round(d, remote.at);
      remote.at = await round(other, remote.at);
      d.slots.delete(SECRETS_MARK_KEY_SLOT);
      d.slots.set(slotOf(mail), secretOf(mail, "pw-again-2"));
      remote.at = await round(d, remote.at);
      remote.at = await round(d, remote.at);
      remote.at = await round(other, remote.at);
    })).toEqual([]);
  });

  it("a store written by 0.8.7 is cleaned at start, and the cleaning is no change", async () => {
    const d: Device = { name: "U", legacy: true, store: new Map(), slots: new Map(), accounts: [POOL[2]] };
    const pass = maker(99).password();
    d.slots.set(slotOf(POOL[2]), secretOf(POOL[2], pass));
    const published = await round(d, null);
    const [oldEntry] = Object.values(published.entries);
    expect(JSON.stringify([...d.store])).toContain(pass);

    await start(d);
    expect(problems(d, [pass])).toEqual([]);
    expect(d.store.has(CURRENT_KEY)).toBe(true);

    // The next round moves the password into the current type with the
    // version it had: no new revision, no new time, no other device.
    const next = await round(d, published);
    const current = Object.values(next.entries).find((entry) => entry.binding.secretType === "imap-password-2");
    expect(current && [current.entryRev, current.updatedAt, current.deviceId]).toEqual([oldEntry.entryRev, oldEntry.updatedAt, oldEntry.deviceId]);
    expect(problems(d, [pass])).toEqual([]);
    // The key of the marks is with the passwords, not in the settings store.
    expect(d.slots.has(SECRETS_MARK_KEY_SLOT)).toBe(true);
  });

  it("a keychain that does not answer while marks of its key exist: nothing runs, nothing is written, the key is not made anew", async () => {
    const d: Device = { name: "U", legacy: false, store: new Map(), slots: new Map(), accounts: [POOL[2]] };
    d.slots.set(slotOf(POOL[2]), secretOf(POOL[2], "pw-locked"));
    await round(d, null);
    const key = d.slots.get(SECRETS_MARK_KEY_SLOT);
    // The records only: the device id of the port is another key of the store.
    const records = () => stableStringify([...d.store].filter(([name]) => name === LEGACY_KEY || name === CURRENT_KEY));
    const before = records();
    keychain.refuse = 2;
    state.current = d;
    await expect(createMobileSecretsPort(VAULT).exportBundle()).rejects.toThrow("keychain locked");
    await expect(createMobileSecretsPort(VAULT).importBundle({ format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: "t", entries: {} })).rejects.toThrow("keychain locked");
    expect(records()).toBe(before);
    expect(d.slots.get(SECRETS_MARK_KEY_SLOT)).toBe(key);
    // Answering again: the same key, the marks hold.
    await round(d, null);
    expect(d.slots.get(SECRETS_MARK_KEY_SLOT)).toBe(key);
    expect(problems(d, ["pw-locked"])).toEqual([]);
  });

  for (const v2 of ["a new vault", "a vault with a record of 0.8.7"]) {
    it(`one key for the phone: a keychain silent once while ${v2} syncs makes no second key beside the first vault's (round twelve)`, async () => {
      const VAULT2 = "vault-2";
      const mailbox = POOL.find((a) => a.kind === "mail")!;
      const d: Device = { name: "U", legacy: false, store: new Map(), slots: new Map(), accounts: [mailbox] };
      d.slots.set(slotOf(mailbox), secretOf(mailbox, "pw-first"));
      d.slots.set(mailSecretKey(VAULT2, mailbox.id), secretOf(mailbox, "pw-second"));
      await round(d, null);
      const key = d.slots.get(SECRETS_MARK_KEY_SLOT);
      if (v2.includes("0.8.7")) {
        const id = v087.canonicalSecretId(oldBinding(mailbox) as never);
        d.store.set(`settingsSyncSecretMetaMobile_${VAULT2}`, {
          entries: { [id]: { hash: stableStringify({ binding: oldBinding(mailbox), secret: { pass: "pw-second" } }), entryRev: 1, updatedAt: now(), deviceId: "U", binding: oldBinding(mailbox) } },
          imported: {},
          quarantine: {},
        });
      }
      keychain.refuse = 1;
      state.current = d;
      await expect(createMobileSecretsPort(VAULT2).exportBundle()).rejects.toThrow("keychain locked");
      expect(d.slots.get(SECRETS_MARK_KEY_SLOT)).toBe(key);
      // Answering again: both vaults go on with the one key, nothing of the first is lost.
      const second = createMobileSecretsPort(VAULT2);
      await second.importBundle(mergeSecretsBundles(await second.exportBundle(), null, now()));
      await round(d, null);
      expect(d.slots.get(SECRETS_MARK_KEY_SLOT)).toBe(key);
      const own = `m1:${String(Object.values((d.store.get(CURRENT_KEY) as SecretsPortMeta).entries)[0].hash).slice(3, 11)}.`;
      const hashes = [CURRENT_KEY, `settingsSyncSecretMarksMobile_${VAULT2}`].flatMap((name) => Object.values((d.store.get(name) as SecretsPortMeta).entries).map((e) => e.hash));
      expect(hashes.length).toBeGreaterThanOrEqual(2);
      expect(hashes.every((hash) => hash.startsWith(own))).toBe(true);
      expect(problems(d, ["pw-first", "pw-second"])).toEqual([]);
    });
  }

  it("\"Remove account\" before the marks can be sealed writes no password under the new name (round eleven)", async () => {
    const o: Device = { name: "O", legacy: true, store: new Map(), slots: new Map(), accounts: POOL.map((a) => ({ ...a })) };
    const l: Device = { name: "L", legacy: true, store: new Map(), slots: new Map(), accounts: POOL.map((a) => ({ ...a })) };
    o.slots.set(slotOf(POOL[0]), secretOf(POOL[0], "pw-first-1"));
    o.slots.set(slotOf(POOL[1]), secretOf(POOL[1], "pw-again-2"));
    let remote: SecretsBundle | null = null;
    for (let i = 0; i < 3; i++) for (const d of [o, l]) remote = await round(d, remote);
    keychain.readOnly = true;
    try {
      l.legacy = false;
      state.current = l;
      await expect(sealSecretsMetaAtStart()).rejects.toThrow();
      await retireCalDavSecret(VAULT, CAL, POOL[1].user, async () => undefined);
      await expect(round(l, remote)).rejects.toThrow();
      const others = JSON.stringify([...l.store].filter(([key]) => key !== LEGACY_KEY));
      expect(others).not.toContain("pw-first-1");
      expect(others).not.toContain("pw-again-2");
      expect(l.store.has(CURRENT_KEY)).toBe(false);
    } finally {
      keychain.readOnly = false;
    }
  });
});
