import { describe, expect, it } from "vitest";
import { stableStringify } from "@plainva/core";
import { SECRETS_MARK_KEY_SLOT, isSecretsMark, sealSecretsMeta, sealSecretsMetaInStore, secretsMarker, type SecretsPortMeta } from "@plainva/ui";

/** The marks of the secrets sync (`packages/ui/src/lib/secretsMark.ts`, review 2026-11-18, round eight, F67). */

const keychain = () => {
  const slots = new Map<string, unknown>();
  return { slots, readSlot: async (slot: string) => slots.get(slot) ?? null, writeSlot: async (slot: string, value: unknown) => void slots.set(slot, value) };
};
const binding = { family: "imap", service: "mail" as const, secretType: "imap-password-2" as const, user: "anna@example.com", endpoint: "imaps://imap.example.com:993" };
const plain = stableStringify({ binding, secret: { pass: "hunter22" } });
const meta = (hash: string): SecretsPortMeta => ({ entries: { e: { hash, entryRev: 3, updatedAt: "2026-08-01T00:00:00.000Z", deviceId: "d", binding } }, imported: { e: true }, quarantine: {} });

describe("secrets marks", () => {
  it("are a keyed hash of the device: the same pair gives the same mark here, another key another, and none names the password", async () => {
    const here = keychain();
    const mark = await secretsMarker(here);
    const again = await secretsMarker(here);
    const elsewhere = await secretsMarker(keychain());
    const a = await mark(plain);
    expect(isSecretsMark(a)).toBe(true);
    expect(await again(plain)).toBe(a);
    expect(await elsewhere(plain)).not.toBe(a);
    expect(a).not.toContain("hunter");
    expect(here.slots.get(SECRETS_MARK_KEY_SLOT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("make one key, however many callers start at once on a fresh device", async () => {
    const here = keychain();
    const marks = await Promise.all([secretsMarker(here), secretsMarker(here), secretsMarker(here)]);
    const made = await Promise.all(marks.map((mark) => mark(plain)));
    expect(new Set(made).size).toBe(1);
  });

  it("refuse to work without a key, never falling back to the text", async () => {
    const broken = { readSlot: async () => null, writeSlot: async () => undefined };
    await expect(secretsMarker(broken)).rejects.toThrow();
  });

  it("turn an old plain mark into the mark of the same pair, and leave the version alone", async () => {
    const here = keychain();
    const mark = await secretsMarker(here);
    const m = meta(plain);
    expect(await sealSecretsMeta(m, mark)).toBe(true);
    expect(m.entries.e).toMatchObject({ hash: await mark(plain), entryRev: 3, updatedAt: "2026-08-01T00:00:00.000Z", deviceId: "d" });
    expect(await sealSecretsMeta(m, mark)).toBe(false);
    // Without a marker the old text is dropped, never kept.
    const dropped = meta(plain);
    await sealSecretsMeta(dropped, null);
    expect(dropped.entries.e.hash).toBe("");
  });

  it("are sealed at start for every vault of the device, open or not, with one save", async () => {
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
    const here = keychain();
    expect(await sealSecretsMetaInStore(store as never, (key) => key.startsWith("settingsSyncSecretMeta_"), here)).toBe(2);
    expect(saves).toBe(1);
    expect(JSON.stringify([values.get("settingsSyncSecretMeta_a"), values.get("settingsSyncSecretMeta_b")])).not.toContain("hunter");
    expect(await sealSecretsMetaInStore(store as never, (key) => key.startsWith("settingsSyncSecretMeta_"), here)).toBe(0);
    expect(saves).toBe(1);
  });
});
