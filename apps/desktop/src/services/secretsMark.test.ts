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

  describe("one place for the key on a device with a keychain and a file (round twelve)", () => {
    const desktop = (keychainAnswers = true) => {
      const places = { keychain: new Map<string, string>(), file: new Map<string, string>() };
      const state = { noted: null as null | "keychain" | "file", answers: keychainAnswers, fileReads: 0, fileWrites: 0 };
      const markKeyHome = {
        read: async () => state.noted,
        note: async (place: "keychain" | "file") => void (state.noted = place),
        readAt: async (place: "keychain" | "file") => {
          if (place === "keychain" && !state.answers) throw new Error("keychain locked");
          if (place === "file") state.fileReads++;
          return places[place].get(SECRETS_MARK_KEY_SLOT) ?? null;
        },
        writeAt: async (place: "keychain" | "file", value: string) => {
          if (place === "keychain" && !state.answers) throw new Error("keychain locked");
          if (place === "file") state.fileWrites++;
          places[place].set(SECRETS_MARK_KEY_SLOT, value);
        },
      };
      return { places, state, slots: { readSlot: async () => null, writeSlot: async () => undefined, markKeyHome } };
    };

    it("is decided once and noted; a keychain silent later stops the run and the file is neither read nor written", async () => {
      const d = desktop();
      const first = await secretsMarker(d.slots, false);
      expect(d.state.noted).toBe("keychain");
      const key = d.places.keychain.get(SECRETS_MARK_KEY_SLOT);
      // No mark anywhere yet: still no second key in the file.
      d.state.answers = false;
      d.state.fileReads = 0;
      await expect(secretsMarker(d.slots, false)).rejects.toThrow("keychain locked");
      expect([d.places.file.size, d.state.fileReads, d.state.fileWrites]).toEqual([0, 0, 0]);
      d.state.answers = true;
      const again = await secretsMarker(d.slots, false);
      expect(again.owns(await first(plain))).toBe(true);
      expect(d.places.keychain.get(SECRETS_MARK_KEY_SLOT)).toBe(key);
    });

    it("a key in the file is the file's, whatever the keychain holds", async () => {
      const d = desktop(false);
      const first = await secretsMarker(d.slots, false);
      expect(d.state.noted).toBe("file");
      d.state.answers = true;
      d.places.keychain.set(SECRETS_MARK_KEY_SLOT, "a".repeat(64));
      expect((await secretsMarker(d.slots, true)).owns(await first(plain))).toBe(true);
    });

    it("a key made by an earlier build is found where it is and its place noted, the keychain first", async () => {
      const inKeychain = desktop();
      inKeychain.places.keychain.set(SECRETS_MARK_KEY_SLOT, "b".repeat(64));
      inKeychain.places.file.set(SECRETS_MARK_KEY_SLOT, "c".repeat(64));
      await secretsMarker(inKeychain.slots, true);
      expect(inKeychain.state.noted).toBe("keychain");
      const inFile = desktop(false);
      inFile.places.file.set(SECRETS_MARK_KEY_SLOT, "c".repeat(64));
      await secretsMarker(inFile.slots, true);
      expect(inFile.state.noted).toBe("file");
      // Not noted, the keychain silent, nothing in the file, marks exist: an error, no key.
      const silent = desktop(false);
      await expect(secretsMarker(silent.slots, true)).rejects.toThrow("keychain locked");
      expect([silent.state.noted, silent.places.file.size]).toEqual([null, 0]);
    });

    it("a key missing at its place is made there anew, never elsewhere", async () => {
      const d = desktop();
      await secretsMarker(d.slots, false);
      d.places.keychain.clear();
      await secretsMarker(d.slots, true);
      expect([d.state.noted, d.places.keychain.size, d.places.file.size]).toEqual(["keychain", 1, 0]);
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
