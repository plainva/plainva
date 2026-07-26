import { describe, expect, it } from "vitest";
import { SecretPolicyError, canonicalizeEndpoint, type SecretBinding, type SecretsBundle } from "@plainva/core";
import { createSecretsPort, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";

/**
 * The shared keychain port (H2c) — the one place that decides when a credential
 * from another device may replace one on this device. Both shells run this
 * code, so these tests are the guarantee for both.
 *
 * Everything runs against an IN-MEMORY keychain: the point is the judgement,
 * not the platform, and a test that needed a real keychain would not run at
 * all.
 */

const binding = (over: Partial<SecretBinding> = {}): SecretBinding => ({
  family: "webdav",
  service: "calendar",
  secretType: "caldav-password",
  user: "marco@example.com",
  endpoint: canonicalizeEndpoint("https://cloud.example.com/remote.php/dav"),
  ...over,
});

/** A device: its keychain, its meta record, its accounts. */
function makeDevice(id: string, candidates: () => LocalSecretCandidate[]) {
  const keychain = new Map<string, unknown>();
  let meta: SecretsPortMeta | null = null;
  let clock = 0;
  const port = createSecretsPort({
    deviceId: async () => id,
    readMeta: async () => meta,
    writeMeta: async (m) => {
      meta = structuredClone(m);
    },
    candidates: async () => candidates(),
    readSlot: async (slot) => keychain.get(slot) ?? null,
    writeSlot: async (slot, value) => void keychain.set(slot, value),
    removeSlot: async (slot) => void keychain.delete(slot),
    now: () => `2026-07-26T00:00:${String(clock++).padStart(2, "0")}.000Z`,
  });
  return { port, keychain, meta: () => meta };
}

const candidate = (over: Partial<LocalSecretCandidate> = {}): LocalSecretCandidate => ({
  logicalId: "acc-1",
  slot: "pim_acc-1",
  binding: binding(),
  secret: { pass: "hunter2" },
  apply: (secret) => ({ kind: "caldav", pass: secret.pass }),
  ...over,
});

describe("shared secrets port (H2c)", () => {
  it("carries a password to a device that has the account but no secret", async () => {
    const source = makeDevice("phone", () => [candidate()]);
    const bundle = await source.port.exportBundle();

    const target = makeDevice("desktop", () => [candidate({ secret: null })]);
    await target.port.importBundle(bundle);

    expect(target.keychain.get("pim_acc-1")).toEqual({ kind: "caldav", pass: "hunter2" });
  });

  it("refuses to overwrite a credential this device owns", async () => {
    const source = makeDevice("phone", () => [candidate()]);
    const bundle = await source.port.exportBundle();

    // The other device has its OWN, different password for the same account.
    const target = makeDevice("desktop", () => [candidate({ secret: { pass: "different" } })]);
    await expect(target.port.importBundle(bundle)).rejects.toBeInstanceOf(SecretPolicyError);
    expect(target.keychain.has("pim_acc-1")).toBe(false);
  });

  it("never applies an entry whose binding points somewhere else", async () => {
    const source = makeDevice("phone", () => [candidate()]);
    const bundle = await source.port.exportBundle();

    // Same account id, DIFFERENT server: a password must not land there.
    const elsewhere = makeDevice("desktop", () => [
      candidate({ secret: null, binding: binding({ endpoint: canonicalizeEndpoint("https://other.example.com/dav") }) }),
    ]);
    await expect(elsewhere.port.importBundle(bundle)).rejects.toBeInstanceOf(SecretPolicyError);
    expect(elsewhere.keychain.size).toBe(0);
  });

  it("applies nothing at all when one entry of several is invalid", async () => {
    const source = makeDevice("phone", () => [
      candidate(),
      candidate({ logicalId: "acc-2", slot: "mail_acc-2", binding: binding({ service: "mail", secretType: "imap-password" }), secret: { pass: "second" } }),
    ]);
    const bundle = await source.port.exportBundle();
    // The target knows acc-1 but not acc-2 — the bundle is refused whole.
    const target = makeDevice("desktop", () => [candidate({ secret: null })]);
    await expect(target.port.importBundle(bundle)).rejects.toBeInstanceOf(SecretPolicyError);
    expect(target.keychain.size).toBe(0);
  });

  it("rolls back what it already wrote when a later write fails", async () => {
    const source = makeDevice("phone", () => [
      candidate(),
      candidate({ logicalId: "acc-2", slot: "slot-2", secret: { pass: "second" } }),
    ]);
    const bundle = await source.port.exportBundle();

    const keychain = new Map<string, unknown>([["slot-2", { kind: "caldav", pass: "previous" }]]);
    let meta: SecretsPortMeta | null = null;
    const port = createSecretsPort({
      deviceId: async () => "desktop",
      readMeta: async () => meta,
      writeMeta: async (m) => void (meta = m),
      candidates: async () => [
        candidate({ secret: null }),
        candidate({ logicalId: "acc-2", slot: "slot-2", secret: null }),
      ],
      readSlot: async (slot) => keychain.get(slot) ?? null,
      writeSlot: async (slot, value) => {
        if (slot === "slot-2") throw new Error("keychain refused");
        keychain.set(slot, value);
      },
      removeSlot: async (slot) => void keychain.delete(slot),
    });

    await expect(port.importBundle(bundle)).rejects.toThrow("keychain refused");
    // The first slot was written and then undone; the second keeps its old value.
    expect(keychain.has("pim_acc-1")).toBe(false);
    expect(keychain.get("slot-2")).toEqual({ kind: "caldav", pass: "previous" });
  });

  it("removes an imported secret on a tombstone, but never one of its own", async () => {
    // Device A publishes, device B imports.
    const source = makeDevice("phone", () => [candidate()]);
    let bundle = await source.port.exportBundle();
    let targetSecret: Record<string, string> | null = null;
    const target = makeDevice("desktop", () => [candidate({ secret: targetSecret })]);
    await target.port.importBundle(bundle);
    expect(target.keychain.has("pim_acc-1")).toBe(true);

    // The account disappears on A → tombstone.
    const gone = makeDevice("phone", () => []);
    // Reuse A's meta so the tombstone carries the previous revision.
    const withMeta: SecretsBundle = { ...bundle, entries: { "acc-1": { ...bundle.entries["acc-1"], entryRev: 2, tombstone: true, secret: undefined } } };
    await target.port.importBundle(withMeta);
    expect(target.keychain.has("pim_acc-1")).toBe(false);
    expect(gone).toBeTruthy();

    // A device's OWN, never-imported secret survives someone else's tombstone.
    targetSecret = { pass: "mine" };
    const owner = makeDevice("desktop-2", () => [candidate({ secret: { pass: "mine" } })]);
    owner.keychain.set("pim_acc-1", { kind: "caldav", pass: "mine" });
    bundle = { ...withMeta };
    await owner.port.importBundle(bundle);
    expect(owner.keychain.get("pim_acc-1")).toEqual({ kind: "caldav", pass: "mine" });
  });

  it("only bumps a revision when the secret actually changed", async () => {
    let secret: Record<string, string> = { pass: "hunter2" };
    const device = makeDevice("phone", () => [candidate({ secret })]);

    const first = await device.port.exportBundle();
    const again = await device.port.exportBundle();
    expect(again.entries["acc-1"].entryRev).toBe(first.entries["acc-1"].entryRev);
    expect(again.entries["acc-1"].updatedAt).toBe(first.entries["acc-1"].updatedAt);

    secret = { pass: "changed" };
    const third = await device.port.exportBundle();
    expect(third.entries["acc-1"].entryRev).toBe(first.entries["acc-1"].entryRev + 1);
  });

  it("keeps device-local fields such as an OAuth refresh token", async () => {
    const source = makeDevice("phone", () => [
      candidate({ binding: binding({ family: "google", secretType: "google-pim-client" }), secret: { clientId: "id", clientSecret: "shh" } }),
    ]);
    const bundle = await source.port.exportBundle();

    const target = makeDevice("desktop", () => [
      candidate({
        binding: binding({ family: "google", secretType: "google-pim-client" }),
        secret: null,
        // The local refresh token must survive the import — it is device-bound.
        apply: (s) => ({ kind: "google", clientId: s.clientId, clientSecret: s.clientSecret, refreshToken: "local-only" }),
      }),
    ]);
    await target.port.importBundle(bundle);

    expect(target.keychain.get("pim_acc-1")).toEqual({
      kind: "google",
      clientId: "id",
      clientSecret: "shh",
      refreshToken: "local-only",
    });
  });
});
