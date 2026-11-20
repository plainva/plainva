import { describe, expect, it } from "vitest";
import { stableStringify } from "@plainva/core";
import {
  SECRETS_MARK_KEY_SLOT,
  isSecretsMark,
  mergeLegacySecretsMeta,
  sealSecretsMeta,
  sealSecretsMetaInStore,
  secretsMarker,
  type SecretsPortMeta,
} from "@plainva/ui";

/** The marks of the secrets sync (`packages/ui/src/lib/secretsMark.ts`, review 2026-11-18, rounds eight and nine, F67). */

const keychain = () => {
  const slots = new Map<string, unknown>();
  return { slots, readSlot: async (slot: string) => slots.get(slot) ?? null, writeSlot: async (slot: string, value: unknown) => void slots.set(slot, value) };
};
const binding = { family: "imap", service: "mail" as const, secretType: "imap-password-2" as const, user: "anna@example.com", endpoint: "imaps://imap.example.com:993" };
const plain = stableStringify({ binding, secret: { pass: "hunter22" } });
const meta = (hash: string): SecretsPortMeta => ({ entries: { e: { hash, entryRev: 3, updatedAt: "2026-08-01T00:00:00.000Z", deviceId: "d", binding } }, imported: { e: true }, quarantine: {} });
const MARK = /^m1:[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/;

describe("secrets marks", () => {
  it("are a keyed hash of the device with its key's id: the same pair gives the same mark here, another key another, and none names the password", async () => {
    const here = keychain();
    const mark = await secretsMarker(here, false);
    const again = await secretsMarker(here);
    const elsewhere = await secretsMarker(keychain(), false);
    const a = await mark(plain);
    expect(a).toMatch(MARK);
    expect(isSecretsMark(a)).toBe(true);
    expect(await again(plain)).toBe(a);
    expect(again.owns(a)).toBe(true);
    expect(await elsewhere(plain)).not.toBe(a);
    expect(elsewhere.owns(a)).toBe(false);
    expect(a).not.toContain("hunter");
    expect(here.slots.get(SECRETS_MARK_KEY_SLOT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("make one key, however many callers start at once on a fresh device", async () => {
    const here = keychain();
    const marks = await Promise.all([secretsMarker(here, false), secretsMarker(here, false), secretsMarker(here, false)]);
    const made = await Promise.all(marks.map((mark) => mark(plain)));
    expect(new Set(made).size).toBe(1);
  });

  it("never take a store that does not answer for one without a key while marks exist", async () => {
    const here = keychain();
    const refusing = { ...here, readSlot: async () => { throw new Error("keychain locked"); } };
    await expect(secretsMarker(refusing, true)).rejects.toThrow("keychain locked");
    expect(here.slots.has(SECRETS_MARK_KEY_SLOT)).toBe(false);
    // With marks in another vault of the device, no more than in this one.
    await expect(secretsMarker({ ...refusing, marksOnDevice: async () => true }, false)).rejects.toThrow("keychain locked");
    // A device that cannot say whether it holds marks is taken to hold some.
    await expect(secretsMarker({ ...refusing, marksOnDevice: async () => { throw new Error("store unreadable"); } }, false)).rejects.toThrow("keychain locked");
    expect(here.slots.has(SECRETS_MARK_KEY_SLOT)).toBe(false);
  });

  describe("a key the app process owns, for every window at once (round fourteen)", () => {
    // What the process does with it — one place, one note, one lock — is
    // tested in `src-tauri/src/secure_store.rs`; here: what a window asks and takes.
    const owned = (answer: (fresh: string, marksOnDevice: boolean) => Promise<string>) => {
      const asked: Array<[string, boolean]> = [];
      const slotCalls: string[] = [];
      const slots = {
        readSlot: async (slot: string) => void slotCalls.push(`read ${slot}`),
        writeSlot: async (slot: string) => void slotCalls.push(`write ${slot}`),
        ownedKey: async (fresh: string, marksOnDevice: boolean) => {
          asked.push([fresh, marksOnDevice]);
          return answer(fresh, marksOnDevice);
        },
      };
      return { asked, slotCalls, slots };
    };

    it("asks the process with a fresh key and whether marks exist, marks with what it answers, and never touches the slot", async () => {
      let held: string | null = null;
      const d = owned(async (fresh) => (held ??= fresh));
      const first = await secretsMarker(d.slots, false);
      const second = await secretsMarker({ ...d.slots, marksOnDevice: async () => true }, false);
      const third = await secretsMarker(d.slots, true);
      expect(second.owns(await first(plain)) && third.owns(await first(plain))).toBe(true);
      expect(d.asked.map(([fresh, marks]) => [/^[0-9a-f]{64}$/.test(fresh), marks])).toEqual([[true, false], [true, true], [true, true]]);
      expect(new Set(d.asked.map(([fresh]) => fresh)).size).toBe(3);
      expect(d.slotCalls).toEqual([]);
    });

    it("a device that cannot say whether it holds marks tells the process it holds some", async () => {
      const d = owned(async (fresh) => fresh);
      await secretsMarker({ ...d.slots, marksOnDevice: async () => { throw new Error("store unreadable"); } }, false);
      expect(d.asked[0][1]).toBe(true);
    });

    it("a process that does not answer, or answers nothing usable, is an error, never a key", async () => {
      await expect(secretsMarker(owned(async () => { throw new Error("keychain locked"); }).slots, true)).rejects.toThrow("keychain locked");
      await expect(secretsMarker(owned(async () => "not a key").slots, false)).rejects.toThrow("unreadable");
      await expect(secretsMarker(owned(async () => null as unknown as string).slots, false)).rejects.toThrow("could not be stored");
    });
  });

  it("refuse to work when the key cannot be stored, never falling back to the text", async () => {
    const broken = { readSlot: async () => null, writeSlot: async () => undefined };
    await expect(secretsMarker(broken, false)).rejects.toThrow();
  });

  it("turn an old plain mark into the mark of the same pair and leave the version alone; a mark of a lost key is left as lost", async () => {
    const mark = await secretsMarker(keychain(), false);
    const m = meta(plain);
    expect(await sealSecretsMeta(m, mark)).toBe(true);
    expect(m.entries.e).toMatchObject({ hash: await mark(plain), entryRev: 3, updatedAt: "2026-08-01T00:00:00.000Z", deviceId: "d" });
    expect(await sealSecretsMeta(m, mark)).toBe(false);
    const other = await secretsMarker(keychain(), false);
    expect(other.owns(m.entries.e.hash)).toBe(false);
    expect(await sealSecretsMeta(m, other)).toBe(false);
  });

  it("move every vault's record at start under the new name, sealed, with one save; a record of 0.8.7 written meanwhile is taken in", async () => {
    const values = new Map<string, unknown>([
      ["settingsSyncSecretMeta_a", meta(plain)],
      ["settingsSyncSecretMeta_b", meta(plain)],
      ["settingsSyncSecretMeta_c", { entries: {}, imported: {}, quarantine: {} }],
      ["other", { hash: plain }],
    ]);
    let saves = 0;
    const store = {
      get: async (key: string) => structuredClone(values.get(key) ?? null),
      set: async (key: string, value: unknown) => void values.set(key, structuredClone(value)),
      delete: async (key: string) => values.delete(key),
      keys: async () => [...values.keys()],
      save: async () => void saves++,
    };
    const storage = { current: (key: string) => key.replace("settingsSyncSecretMeta_", "settingsSyncSecretMarks_"), isLegacy: (key: string) => key.startsWith("settingsSyncSecretMeta_") };
    const here = keychain();
    expect(await sealSecretsMetaInStore(store as never, storage, here)).toBe(3);
    expect(saves).toBe(1);
    expect([...values.keys()].sort()).toEqual(["other", "settingsSyncSecretMarks_a", "settingsSyncSecretMarks_b", "settingsSyncSecretMarks_c"]);
    expect(JSON.stringify([values.get("settingsSyncSecretMarks_a"), values.get("settingsSyncSecretMarks_b")])).not.toContain("hunter");
    expect(await sealSecretsMetaInStore(store as never, storage, here)).toBe(0);
    expect(saves).toBe(1);
  });

  it("take in what 0.8.7 knew of the old types when both records are there, and keep the current types", () => {
    const oldBinding = { ...binding, secretType: "imap-password" as const };
    const current: SecretsPortMeta = {
      entries: { cur: { hash: "m1:a", entryRev: 2, updatedAt: "t2", deviceId: "d", binding }, old: { hash: "m1:b", entryRev: 1, updatedAt: "t1", deviceId: "d", binding: oldBinding } },
      imported: { cur: true },
      quarantine: {},
    };
    const legacy: SecretsPortMeta = { entries: { old: { hash: "x", entryRev: 4, updatedAt: "t4", deviceId: "o", binding: oldBinding } }, imported: { old: true }, quarantine: {} };
    const merged = mergeLegacySecretsMeta(current, legacy)!;
    expect(merged.entries.cur.entryRev).toBe(2);
    expect(merged.entries.old.entryRev).toBe(4);
    expect(merged.imported).toEqual({ cur: true, old: true });
  });
});
