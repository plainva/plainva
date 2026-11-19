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
    const refusing = { ...here, readMarkKey: async () => { throw new Error("keychain locked"); } };
    await expect(secretsMarker(refusing, true)).rejects.toThrow("keychain locked");
    expect(here.slots.has(SECRETS_MARK_KEY_SLOT)).toBe(false);
    // With no mark anywhere — a first run where the keychain is not reachable
    // at all and the passwords live in the credentials file — a key is made,
    // and used only when the store gives it back.
    await expect(secretsMarker(refusing, false)).rejects.toThrow();
    const fileOnly = { ...here, readMarkKey: async () => { if (!here.slots.has(SECRETS_MARK_KEY_SLOT)) throw new Error("keychain locked"); return here.slots.get(SECRETS_MARK_KEY_SLOT); } };
    expect(await (await secretsMarker(fileOnly, false))(plain)).toMatch(MARK);
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
