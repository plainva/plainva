import { describe, expect, it, vi } from "vitest";
import { canonicalizeEndpoint, mergeSecretsBundles, stableStringify, type SecretsBundle } from "@plainva/core";
import { SECRETS_MARK_KEY_SLOT, type SecretsPortMeta } from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";

/**
 * No password in the settings file (review 2026-11-18, round eight, F67).
 *
 * The secrets sync keeps a mark of each password it published or took, to
 * tell "unchanged" from "changed". Since 0.5.0 that mark was the binding and
 * the secret as text, in `plainva-settings.json`: every synced password stood
 * there in plain text. These tests run the desktop port as it runs here, with
 * several devices, and read the whole settings store of each after every
 * round: no password, not even four characters of one, may be in it. The
 * phone holds the same in `apps/mobile/src/services/secretsStoreNoPassword.test.ts`.
 */

const VAULT = "/vaults/wiki";
const META_KEY = `settingsSyncSecretMeta_${btoa(unescape(encodeURIComponent(VAULT)))}`;
type MailRow = { id: string; label: string; host: string; port: number; user: string };
type Device = { name: string; store: Map<string, unknown>; slots: Map<string, unknown>; mail: MailRow[] };

const state = vi.hoisted(() => ({ current: null as null | { store: Map<string, unknown>; slots: Map<string, unknown>; mail: unknown[] } }));

vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => structuredClone(state.current!.store.get(key) ?? null),
    set: async (key: string, value: unknown) => void state.current!.store.set(key, structuredClone(value)),
    delete: async (key: string) => state.current!.store.delete(key),
    keys: async () => [...state.current!.store.keys()],
    save: async () => undefined,
  })),
}));
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => structuredClone(state.current!.slots.get(key) ?? null)),
    readSecretStrict: vi.fn(async (key: string) => structuredClone(state.current!.slots.get(key) ?? null)),
    writeSecret: vi.fn(async (key: string, value: unknown) => void state.current!.slots.set(key, structuredClone(value))),
    removeSecret: vi.fn(async (key: string) => void state.current!.slots.delete(key)),
  },
}));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: vi.fn(async () => []) }));
vi.mock("@plainva/ui/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui/mail")>();
  return { ...actual, listMailAccounts: vi.fn(async () => structuredClone(state.current!.mail)) };
});
vi.mock("./pim/pimCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pim/pimCredentials")>();
  return { ...actual, getPimCredentials: vi.fn(async () => null) };
});

import { createDesktopSecretsPort, sealSecretsMetaAtStart } from "./settingsSecrets";
import { mailSecretKey } from "@plainva/ui/mail";

const MAILBOXES: MailRow[] = [
  { id: "m1", label: "Work", host: "imap.example.com", port: 993, user: "Anna@Example.com" },
  { id: "m2", label: "Home", host: "imap.example.org", port: 993, user: "bert@example.org" },
];

/** Passwords of characters nothing else in the store is made of, so any four of them in a row are a leak. */
function passwordMaker(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const alphabet = "~äöü§¿";
  return () => Array.from({ length: 10 }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
}

function leaks(store: Map<string, unknown>, passwords: readonly string[]): string[] {
  const text = JSON.stringify([...store]);
  const found: string[] = [];
  for (const password of passwords) {
    for (let i = 0; i + 4 <= password.length; i++) {
      if (text.includes(password.slice(i, i + 4))) {
        found.push(password);
        break;
      }
    }
  }
  return found;
}

let tick = 0;
const now = () => new Date(Date.parse("2026-11-19T00:00:00.000Z") + 1000 * tick++).toISOString();

async function round(d: Device, remote: SecretsBundle | null): Promise<SecretsBundle> {
  state.current = d;
  const port = createDesktopSecretsPort(VAULT, null);
  const local = await port.exportBundle();
  const merged = mergeSecretsBundles(local, remote, now());
  if (stableStringify(merged.entries) !== stableStringify(local.entries)) await port.importBundle(merged);
  return merged;
}

describe("the secrets sync keeps no password in the desktop's settings store (F67)", () => {
  it("not after any round of a random fleet", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const password = passwordMaker(seed);
      const used: string[] = [];
      const fleet: Device[] = ["A", "B", "C"].map((name) => ({ name, store: new Map(), slots: new Map(), mail: MAILBOXES.map((row) => ({ ...row })) }));
      const first = fleet[0];
      for (const row of MAILBOXES) {
        const pass = password();
        used.push(pass);
        first.slots.set(mailSecretKey(VAULT, row.id), { pass });
      }
      let remote: SecretsBundle | null = null;
      let s = seed;
      const pick = (n: number) => ((s = (s * 48271) % 2147483647), s % n);
      for (let step = 0; step < 24; step++) {
        const d = fleet[pick(fleet.length)];
        if (pick(3) === 0) {
          const pass = password();
          used.push(pass);
          d.slots.set(mailSecretKey(VAULT, MAILBOXES[pick(MAILBOXES.length)].id), { pass });
        }
        remote = await round(d, remote);
        for (const device of fleet) expect(leaks(device.store, used), `seed ${seed}, step ${step}, ${device.name}`).toEqual([]);
      }
      // The passwords did travel: the check above is not trivially true.
      expect(fleet.every((device) => device.slots.size > 0)).toBe(true);
    }
  });

  it("a store written by 0.8.7 is cleaned at start, and the cleaning is no change", async () => {
    const d: Device = { name: "U", store: new Map(), slots: new Map(), mail: [MAILBOXES[1]] };
    const pass = passwordMaker(99)();
    const row = MAILBOXES[1];
    d.slots.set(mailSecretKey(VAULT, row.id), { pass });
    // What 0.8.7 wrote: its port, its bindings (the old type, the user lower-cased).
    const oldBinding = { family: "imap", service: "mail", secretType: "imap-password", user: row.user.toLowerCase(), endpoint: canonicalizeEndpoint(`imaps://${row.host}:${row.port}`) };
    state.current = d;
    const old = v087.createSecretsPort({
      deviceId: async () => "U",
      readMeta: async () => (d.store.get(META_KEY) as SecretsPortMeta | undefined) ?? null,
      writeMeta: async (meta: unknown) => void d.store.set(META_KEY, structuredClone(meta)),
      candidates: async () => [{ logicalId: v087.canonicalSecretId(oldBinding as never), slot: mailSecretKey(VAULT, row.id), binding: oldBinding as never, secret: { pass }, apply: (secret: { pass?: string }) => ({ pass: secret.pass }) }],
      readSlot: async () => null,
      writeSlot: async () => undefined,
      removeSlot: async () => undefined,
      now,
    } as never);
    const published = await old.exportBundle();
    const [oldEntry] = Object.values(published.entries);
    expect(leaks(d.store, [pass])).toEqual([pass]);

    expect(await sealSecretsMetaAtStart()).toBe(1);
    expect(leaks(d.store, [pass])).toEqual([]);

    // The next round moves the password into the current type with the
    // version it had: no new revision, no new time, no other device.
    const next = await round(d, published);
    const current = Object.values(next.entries).find((entry) => entry.binding.secretType === "imap-password-2");
    expect(current && [current.entryRev, current.updatedAt, current.deviceId]).toEqual([oldEntry.entryRev, oldEntry.updatedAt, oldEntry.deviceId]);
    expect(leaks(d.store, [pass])).toEqual([]);
    // The key of the marks is with the passwords, not in the settings store.
    expect(d.slots.has(SECRETS_MARK_KEY_SLOT)).toBe(true);
    expect([...d.store.keys()].some((key) => key.includes(SECRETS_MARK_KEY_SLOT))).toBe(false);
  });
});
