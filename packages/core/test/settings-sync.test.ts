import { describe, it, expect } from "vitest";
import {
  PROFILE_SYNC_PATH,
  parseProfile,
  reconcileProfile,
  serializeProfile,
  SettingsSyncStep,
  stableStringify,
  canonicalJson,
  signManifest,
  verifyManifest,
  parseManifest,
  isEncryptedState,
  allowsMixed,
  isStrict,
  ManifestError,
  type ManifestBody,
  canonicalizeEndpoint,
  bindingMatches,
  mergeSecretEntries,
  mergeSecretsBundles,
  sealSecretsBundle,
  openSecretsBundle,
  assertShareable,
  SecretPolicyError,
  type SecretEntry,
  type SecretsBundle,
  EncryptingSyncTarget,
  FatalSyncProtocolError,
  isSealedBlob,
  readBlobKeyId,
  sealBlob,
  openBlob,
  SecretsSyncStep,
  SETTINGS_ENC_PATH,
  SECRETS_SYNC_PATH,
  KEYFILE_SYNC_PATH,
  KeyfileSyncStep,
  evaluateManifestGuard,
  connectionFingerprint,
  type SecretsPort,
  type ProfileCrypto,
  type MasterKeyBundle,
  type ProfileDoc,
  type ProfileSettingsPort,
} from "../src/index.js";
import type { ISyncTarget, SyncOperation, PushResult, PullResult } from "../src/index.js";
import type { IVaultAdapter } from "../src/index.js";

function mk(fill = 7, keyId = "aabbccddeeff0011"): MasterKeyBundle {
  return { keyId, masterKey: new Uint8Array(32).fill(fill) };
}

function doc(rev: number, deviceId: string, updatedAt: string, values: Record<string, unknown>): ProfileDoc {
  return { format: "plainva-profile", version: 1, rev, updatedAt, deviceId, values };
}

describe("profileFile", () => {
  it("stableStringify is order-independent", () => {
    expect(stableStringify({ a: 1, b: [3, { y: 2, x: 1 }] })).toBe(stableStringify({ b: [3, { x: 1, y: 2 }], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("serialize/parse round-trips and rejects malformed", () => {
    const d = doc(2, "dev1", "2026-07-21T00:00:00Z", { theme: "dark" });
    expect(parseProfile(serializeProfile(d))).toEqual(d);
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile("{not json")).toBeNull();
    expect(parseProfile(JSON.stringify({ format: "other" }))).toBeNull();
    expect(parseProfile(JSON.stringify({ format: "plainva-profile", version: 1 }))).toBeNull();
  });
});

describe("reconcileProfile", () => {
  const now = "2026-07-21T12:00:00Z";

  it("first participation with a remote adopts the shared settings (no clobber)", () => {
    const remote = doc(5, "phone", "2026-07-20T00:00:00Z", { dailyFolder: "Journal" });
    const d = reconcileProfile({ current: { dailyFolder: "Daily" }, local: null, remote, deviceId: "laptop", now });
    expect(d.applyToStore).toEqual({ dailyFolder: "Journal" });
    expect(d.writeLocal).toEqual(remote);
    expect(d.adoptedFrom).toBe("phone");
    expect(d.upload).toBeUndefined();
  });

  it("first participation without a remote publishes the local values as rev 0", () => {
    const d = reconcileProfile({ current: { theme: "nord" }, local: null, remote: null, deviceId: "laptop", now });
    expect(d.upload?.rev).toBe(0);
    expect(d.upload?.values).toEqual({ theme: "nord" });
    expect(d.applyToStore).toBeUndefined();
  });

  it("does nothing on first participation with empty current + no remote", () => {
    expect(reconcileProfile({ current: {}, local: null, remote: null, deviceId: "l", now })).toEqual({});
  });

  it("a local edit bumps rev above both and uploads", () => {
    const local = doc(3, "laptop", "old", { theme: "dark" });
    const remote = doc(4, "phone", "old", { theme: "dark" });
    const d = reconcileProfile({ current: { theme: "light" }, local, remote, deviceId: "laptop", now });
    expect(d.upload?.rev).toBe(5); // max(3,4)+1
    expect(d.upload?.values).toEqual({ theme: "light" });
    expect(d.writeLocal?.rev).toBe(5);
    expect(d.applyToStore).toBeUndefined();
  });

  it("a strictly newer remote (higher rev) is applied", () => {
    const local = doc(3, "laptop", "old", { theme: "dark" });
    const remote = doc(7, "phone", "new", { theme: "light" });
    const d = reconcileProfile({ current: { theme: "dark" }, local, remote, deviceId: "laptop", now });
    expect(d.applyToStore).toEqual({ theme: "light" });
    expect(d.writeLocal).toEqual(remote);
    expect(d.upload).toBeUndefined();
  });

  it("converged (equal rev + equal values) is a no-op", () => {
    const local = doc(3, "laptop", "t", { theme: "dark" });
    const remote = doc(3, "phone", "t", { theme: "dark" });
    expect(reconcileProfile({ current: { theme: "dark" }, local, remote, deviceId: "laptop", now })).toEqual({});
  });

  it("same rev + different values: updatedAt decides", () => {
    const local = doc(3, "laptop", "2026-07-21T09:00:00Z", { theme: "dark" });
    const remoteNewer = doc(3, "phone", "2026-07-21T10:00:00Z", { theme: "light" });
    const applied = reconcileProfile({ current: { theme: "dark" }, local, remote: remoteNewer, deviceId: "laptop", now });
    expect(applied.applyToStore).toEqual({ theme: "light" });

    const remoteOlder = doc(3, "phone", "2026-07-21T08:00:00Z", { theme: "light" });
    const kept = reconcileProfile({ current: { theme: "dark" }, local, remote: remoteOlder, deviceId: "laptop", now });
    expect(kept.upload?.values).toEqual({ theme: "dark" });
  });

  it("same rev + same updatedAt: deterministic deviceId tiebreak (both devices agree)", () => {
    const l = doc(3, "aaa", "t", { theme: "dark" });
    const r = doc(3, "zzz", "t", { theme: "light" });
    // From aaa's view: remote zzz has the higher deviceId -> remote wins.
    const fromA = reconcileProfile({ current: { theme: "dark" }, local: l, remote: r, deviceId: "aaa", now });
    expect(fromA.applyToStore).toEqual({ theme: "light" });
    // From zzz's view: mine (zzz) wins -> upload zzz's values. Same winner on both sides.
    const fromZ = reconcileProfile({ current: { theme: "light" }, local: doc(3, "zzz", "t", { theme: "light" }), remote: doc(3, "aaa", "t", { theme: "dark" }), deviceId: "zzz", now });
    expect(fromZ.upload?.values).toEqual({ theme: "light" });
  });
});

// --- SettingsSyncStep against in-memory fakes ---

class FakeVault implements Partial<IVaultAdapter> {
  files = new Map<string, string>();
  bins = new Map<string, Uint8Array>();
  async exists(path: string) {
    return this.files.has(path) || this.bins.has(path);
  }
  async readTextFile(path: string) {
    const v = this.files.get(path);
    if (v === undefined) throw new Error("not found");
    return v;
  }
  async writeTextFile(path: string, content: string) {
    this.files.set(path, content);
  }
  async readBinaryFile(path: string) {
    const v = this.bins.get(path);
    if (v === undefined) throw new Error("not found");
    return v;
  }
  async writeBinaryFile(path: string, content: Uint8Array) {
    this.bins.set(path, content);
  }
  async deleteItem(path: string) {
    this.files.delete(path);
    this.bins.delete(path);
  }
}

class FakeTarget implements Partial<ISyncTarget> {
  remote = new Map<string, Uint8Array>();
  async download(path: string): Promise<Uint8Array | null> {
    return this.remote.get(path) ?? null;
  }
  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation === "write" && op.content) this.remote.set(op.file_path, op.content);
    else if (op.operation === "delete") this.remote.delete(op.file_path);
  }
  async pull(): Promise<PullResult> {
    return { etagMap: new Map() };
  }
}

function makePort(store: { values: Record<string, unknown>; applied: Record<string, unknown>[] }): ProfileSettingsPort {
  return {
    async exportValues() {
      return { ...store.values };
    },
    async applyValues(values) {
      store.values = { ...values };
      store.applied.push({ ...values });
    },
  };
}

describe("SettingsSyncStep.run", () => {
  const dev = { deviceId: "laptop", now: () => "2026-07-21T12:00:00Z" };

  it("publishes local settings to an empty remote", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const store = { values: { theme: "nord" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const uploaded = parseProfile(new TextDecoder().decode(target.remote.get(PROFILE_SYNC_PATH)!));
    expect(uploaded?.values).toEqual({ theme: "nord" });
    expect(parseProfile(vault.files.get(PROFILE_SYNC_PATH)!)?.rev).toBe(0);
    expect(store.applied).toHaveLength(0);
  });

  it("imports settings from a newer remote on a fresh device", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    target.remote.set(PROFILE_SYNC_PATH, new TextEncoder().encode(serializeProfile(doc(9, "phone", "2026-07-20", { dailyFolder: "Journal" }))));
    const store = { values: { dailyFolder: "Daily" }, applied: [] as Record<string, unknown>[] };
    const adopted: string[] = [];
    const step = new SettingsSyncStep({ port: makePort(store), ...dev, onAdopted: (d) => adopted.push(d) });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    expect(store.values).toEqual({ dailyFolder: "Journal" });
    expect(adopted).toEqual(["phone"]);
    // Local file adopts the remote doc; a second run is a converged no-op.
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(store.applied).toHaveLength(1);
  });

  it("uploads a local edit and does not re-apply its own upload next cycle", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const store = { values: { theme: "dark" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter); // publish rev 0

    store.values = { theme: "light" }; // user edits
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(parseProfile(new TextDecoder().decode(target.remote.get(PROFILE_SYNC_PATH)!))?.values).toEqual({ theme: "light" });

    // No further change -> no apply, no rev churn.
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(store.applied).toHaveLength(0);
    expect(parseProfile(vault.files.get(PROFILE_SYNC_PATH)!)?.rev).toBe(1);
  });
});

// --- v3 canonical JSON ---

describe("canonicalJson", () => {
  it("sorts object keys deterministically and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [3, 2] })).toBe('{"a":[3,2],"z":{"x":2,"y":1}}');
  });

  it("is stable across key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2, c: 3 })).toBe(canonicalJson({ c: 3, a: 1, b: 2 }));
  });

  it("rejects non-finite numbers so a NaN can never change a MAC input", () => {
    expect(() => canonicalJson({ n: NaN })).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
  });
});

// --- v3 encryption manifest ---

describe("manifest", () => {
  const body: ManifestBody = {
    formatVersion: 1,
    minGuardVersion: 1,
    connectionId: "drive:root",
    keyId: "aabbccddeeff0011",
    state: "strict",
    ownerDeviceId: "",
    ownerLeaseUntil: 0,
    generation: 3,
    createdAt: "2026-07-21T00:00:00Z",
    updatedAt: "2026-07-21T00:00:00Z",
  };

  it("sign/verify round-trips and yields the original body", () => {
    const signed = signManifest(mk(), body);
    expect(typeof signed.mac).toBe("string");
    expect(verifyManifest(mk(), signed)).toEqual(body);
  });

  it("rejects signing when the manifest keyId does not match the signing key", () => {
    expect(() => signManifest(mk(7, "0000000000000000"), body)).toThrow(ManifestError);
  });

  it("a tampered field fails verification (fail-closed)", () => {
    const signed = signManifest(mk(), body);
    expect(() => verifyManifest(mk(), { ...signed, state: "plain" })).toThrow(ManifestError);
    expect(() => verifyManifest(mk(), { ...signed, generation: 99 })).toThrow(ManifestError);
  });

  it("a different master key does not verify", () => {
    const signed = signManifest(mk(), body);
    expect(() => verifyManifest(mk(9), signed)).toThrow(ManifestError);
  });

  it("survives a JSON round-trip and an omitted optional field", () => {
    const signed = signManifest(mk(), body);
    const roundtripped = JSON.parse(JSON.stringify(signed));
    expect(verifyManifest(mk(), roundtripped)).toEqual(body);
    // newKeyId set during rotation must be part of the authenticated body.
    const rotating = signManifest(mk(), { ...body, state: "rotating", newKeyId: "1122334455667788" });
    expect(() => verifyManifest(mk(), { ...rotating, newKeyId: "ffffffffffffffff" })).toThrow(ManifestError);
  });

  it("parseManifest is a key-free shape check", () => {
    const signed = signManifest(mk(), body);
    expect(parseManifest(JSON.parse(JSON.stringify(signed)))).not.toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ formatVersion: 2 })).toBeNull();
    expect(parseManifest({ ...signed, state: "bogus" })).toBeNull();
    expect(parseManifest({ ...signed, mac: 42 })).toBeNull();
  });

  it("state predicates classify the lifecycle correctly", () => {
    expect(isEncryptedState("preparing")).toBe(true);
    expect(isEncryptedState("migrating")).toBe(true);
    expect(isEncryptedState("strict")).toBe(true);
    expect(isEncryptedState("rotating")).toBe(true);
    expect(isEncryptedState("decrypting")).toBe(false);
    expect(isEncryptedState("plain")).toBe(false);
    expect(allowsMixed("migrating")).toBe(true);
    expect(allowsMixed("decrypting")).toBe(true);
    expect(allowsMixed("strict")).toBe(false);
    expect(isStrict("strict")).toBe(true);
    expect(isStrict("migrating")).toBe(false);
  });
});

// --- v3 secrets bundle ---

describe("secretsBundle", () => {
  it("canonicalizes endpoints and refuses credentials/fragments", () => {
    expect(canonicalizeEndpoint("HTTPS://Mail.Example.COM:443/")).toBe("https://mail.example.com");
    expect(canonicalizeEndpoint("https://dav.example.com:8443/caldav/")).toBe("https://dav.example.com:8443/caldav");
    expect(() => canonicalizeEndpoint("https://user:pw@example.com")).toThrow(SecretPolicyError);
    expect(() => canonicalizeEndpoint("https://example.com/#frag")).toThrow(SecretPolicyError);
    expect(() => canonicalizeEndpoint("not a url")).toThrow(SecretPolicyError);
  });

  it("bindingMatches requires family + service + user + endpoint", () => {
    const binding = {
      family: "fastmail",
      service: "mail" as const,
      secretType: "imap-password" as const,
      user: "a@b.com",
      endpoint: "imaps://imap.fastmail.com:993",
    };
    expect(
      bindingMatches(binding, { family: "fastmail", service: "mail", user: "A@B.com", endpoint: "imaps://imap.fastmail.com:993/" })
    ).toBe(true);
    expect(bindingMatches(binding, { family: "gmail", service: "mail", user: "a@b.com", endpoint: "imaps://imap.fastmail.com:993" })).toBe(false);
    expect(bindingMatches(binding, { family: "fastmail", service: "mail", user: "a@b.com", endpoint: "imaps://imap.fastmail.com:1993" })).toBe(false);
  });

  it("mergeSecretEntries is per-entry LWW with a deterministic tiebreak", () => {
    const base = (rev: number, at: string, dev: string): SecretEntry => ({
      entryRev: rev,
      updatedAt: at,
      deviceId: dev,
      binding: { family: "fastmail", service: "mail", secretType: "imap-password", user: "a@b.com", endpoint: "imaps://x:993" },
      secret: { pass: `${rev}-${dev}` },
    });
    expect(mergeSecretEntries(base(2, "t", "a"), base(1, "t", "b")).secret).toEqual({ pass: "2-a" });
    expect(mergeSecretEntries(base(1, "2026-07-21T09:00Z", "a"), base(1, "2026-07-21T10:00Z", "b")).secret).toEqual({ pass: "1-b" });
    expect(mergeSecretEntries(base(1, "t", "aaa"), base(1, "t", "zzz")).deviceId).toBe("zzz");
  });

  it("mergeSecretsBundles unions entries without bundle-LWW", () => {
    const local: SecretsBundle = {
      format: "plainva-secrets",
      version: 1,
      bundleRev: 1,
      updatedAt: "t",
      entries: {
        e1: { entryRev: 2, updatedAt: "t", deviceId: "a", binding: { family: "f", service: "mail", secretType: "imap-password", user: "u", endpoint: "e" }, secret: { pass: "L" } },
      },
    };
    const remote: SecretsBundle = {
      format: "plainva-secrets",
      version: 1,
      bundleRev: 5,
      updatedAt: "t",
      entries: {
        e2: { entryRev: 1, updatedAt: "t", deviceId: "b", binding: { family: "f", service: "mail", secretType: "imap-password", user: "v", endpoint: "e2" }, secret: { pass: "R" } },
      },
    };
    const merged = mergeSecretsBundles(local, remote, "now");
    expect(Object.keys(merged.entries).sort()).toEqual(["e1", "e2"]);
    expect(merged.bundleRev).toBe(6); // max(1,5)+1 (both present)
  });

  it("seal/open round-trips and refuses non-shareable entries", () => {
    const bundle: SecretsBundle = {
      format: "plainva-secrets",
      version: 1,
      bundleRev: 1,
      updatedAt: "t",
      entries: {
        cal: { entryRev: 1, updatedAt: "t", deviceId: "a", binding: { family: "fastmail", service: "calendar", secretType: "caldav-password", user: "u", endpoint: "https://dav" }, secret: { pass: "s3cr3t" } },
      },
    };
    const sealed = sealSecretsBundle(mk(), bundle);
    expect(isSealedBlob(sealed)).toBe(true);
    expect(readBlobKeyId(sealed)).toBe("aabbccddeeff0011");
    expect(openSecretsBundle(mk(), sealed)).toEqual(bundle);

    const bad = { ...bundle.entries.cal, binding: { ...bundle.entries.cal.binding, secretType: "oauth-refresh" as unknown as SecretEntry["binding"]["secretType"] } };
    expect(() => assertShareable(bad)).toThrow(SecretPolicyError);
    const badBundle: SecretsBundle = { ...bundle, entries: { x: bad } };
    expect(() => sealSecretsBundle(mk(), badBundle)).toThrow(SecretPolicyError);
  });

  it("a settings blob cannot be opened as a secrets bundle (purpose separation)", () => {
    const sealed = sealSecretsBundle(mk(), { format: "plainva-secrets", version: 1, bundleRev: 1, updatedAt: "t", entries: {} });
    // Same key, wrong purpose -> content decode fails.
    expect(() => openSecretsBundle(mk(9), sealed)).toThrow();
  });
});

// --- v3 EncryptingSyncTarget decorator ---

describe("EncryptingSyncTarget", () => {
  const options = { contentKey: mk(), isStrict: () => false };
  const op = (partial: Partial<SyncOperation> & Pick<SyncOperation, "operation" | "file_path">): SyncOperation => ({
    id: 1,
    retry_count: 0,
    next_retry_at: 0,
    queued_at: 0,
    ...partial,
  });

  it("seals write content on push without mutating the op; original stays plaintext", async () => {
    const target = new FakeTarget();
    const enc = new EncryptingSyncTarget(target as unknown as ISyncTarget, options);
    const content = new TextEncoder().encode("# hello");
    const writeOp = op({ operation: "write", file_path: "note.md", content });
    await enc.push(writeOp);
    // The op the caller holds is untouched (plaintext survives for base_sha256).
    expect(writeOp.content).toBe(content);
    const remote = target.remote.get("note.md")!;
    expect(isSealedBlob(remote)).toBe(true);
    // Decrypting the remote returns the plaintext.
    expect(await enc.download("note.md")).toEqual(content);
  });

  it("passes through sideband, rename and delete ops unencrypted", async () => {
    const target = new FakeTarget();
    const enc = new EncryptingSyncTarget(target as unknown as ISyncTarget, options);
    const sideband = new TextEncoder().encode('{"format":"plainva-profile"}');
    await enc.push(op({ operation: "write", file_path: ".plainva/sync/settings.json", content: sideband }));
    expect(isSealedBlob(target.remote.get(".plainva/sync/settings.json")!)).toBe(false);
    // rename/delete carry no content -> straight passthrough (no throw).
    await enc.push(op({ operation: "delete", file_path: "note.md" }));
    await enc.push(op({ operation: "rename", file_path: "b.md", new_path: "a.md" }));
  });

  it("download passes plaintext through in mixed mode but throws in strict mode", async () => {
    const target = new FakeTarget();
    target.remote.set("plain.md", new TextEncoder().encode("still markdown"));
    const mixed = new EncryptingSyncTarget(target as unknown as ISyncTarget, { contentKey: mk(), isStrict: () => false });
    expect(new TextDecoder().decode((await mixed.download("plain.md"))!)).toBe("still markdown");

    const strict = new EncryptingSyncTarget(target as unknown as ISyncTarget, { contentKey: mk(), isStrict: () => true });
    await expect(strict.download("plain.md")).rejects.toBeInstanceOf(FatalSyncProtocolError);
    // Sideband is exempt from the strict check.
    target.remote.set(".plainva/sync/keyfile.json", new TextEncoder().encode("{}"));
    expect(await strict.download(".plainva/sync/keyfile.json")).not.toBeNull();
  });

  it("passes a null download through", async () => {
    const target = new FakeTarget();
    const enc = new EncryptingSyncTarget(target as unknown as ISyncTarget, { contentKey: mk(), isStrict: () => true });
    expect(await enc.download("missing.md")).toBeNull();
  });
});

// --- v3 sealed profile mode (settings.enc) ---

describe("SettingsSyncStep sealed mode", () => {
  const dev = { deviceId: "laptop", now: () => "2026-07-21T12:00:00Z" };
  const profileCrypto: ProfileCrypto = {
    seal: (b) => sealBlob(mk(), b, "settings"),
    open: (b) => openBlob(mk(), b, "settings"),
  };

  it("publishes and imports the profile as sealed settings.enc (never plaintext)", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    const store = { values: { theme: "nord" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev, profileCrypto });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const remote = target.remote.get(SETTINGS_ENC_PATH)!;
    expect(isSealedBlob(remote)).toBe(true);
    expect(target.remote.has(PROFILE_SYNC_PATH)).toBe(false);
    // Decrypting the sealed remote yields the profile JSON.
    const doc = parseProfile(new TextDecoder().decode(openBlob(mk(), remote, "settings")));
    expect(doc?.values).toEqual({ theme: "nord" });
    // The local copy is the ciphertext blob, not readable plaintext.
    expect(vault.bins.has(SETTINGS_ENC_PATH)).toBe(true);

    // A second fresh device imports the sealed remote.
    const target2Vault = new FakeVault();
    const store2 = { values: { theme: "dark" }, applied: [] as Record<string, unknown>[] };
    const step2 = new SettingsSyncStep({ port: makePort(store2), deviceId: "phone", now: dev.now, profileCrypto });
    await step2.run(target as unknown as ISyncTarget, target2Vault as unknown as IVaultAdapter);
    expect(store2.values).toEqual({ theme: "nord" });
  });

  it("removes a stale plaintext settings.json when it first goes sealed", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    // Pretend a previous plaintext session existed both remotely and locally.
    target.remote.set(PROFILE_SYNC_PATH, new TextEncoder().encode(serializeProfile(doc(0, "laptop", "old", { theme: "nord" }))));
    vault.files.set(PROFILE_SYNC_PATH, serializeProfile(doc(0, "laptop", "old", { theme: "nord" })));
    const store = { values: { theme: "light" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev, profileCrypto });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    expect(target.remote.has(PROFILE_SYNC_PATH)).toBe(false); // stale plaintext dropped remotely
    expect(vault.files.has(PROFILE_SYNC_PATH)).toBe(false); // and locally
    expect(isSealedBlob(target.remote.get(SETTINGS_ENC_PATH)!)).toBe(true);
  });
});

// --- v3 secrets sideband step ---

describe("SecretsSyncStep", () => {
  const entry = (id: string, rev: number, pass: string): SecretEntry => ({
    entryRev: rev,
    updatedAt: "2026-07-21T00:00:00Z",
    deviceId: "laptop",
    binding: { family: "fastmail", service: "mail", secretType: "imap-password", user: id, endpoint: "imaps://imap.fastmail.com:993" },
    secret: { pass },
  });
  const bundle = (entries: Record<string, SecretEntry>, bundleRev = 1): SecretsBundle => ({
    format: "plainva-secrets",
    version: 1,
    bundleRev,
    updatedAt: "2026-07-21T00:00:00Z",
    entries,
  });
  function makeSecretsPort(store: { bundle: SecretsBundle; imported: SecretsBundle[] }): SecretsPort {
    return {
      async exportBundle() {
        return store.bundle;
      },
      async importBundle(b) {
        store.bundle = b;
        store.imported.push(b);
      },
    };
  }

  it("publishes local secrets sealed under K_secrets", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    const store = { bundle: bundle({ a: entry("a@x", 1, "s1") }), imported: [] as SecretsBundle[] };
    const step = new SecretsSyncStep({ port: makeSecretsPort(store), masterKey: mk(), now: () => "t" });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const sealed = target.remote.get(SECRETS_SYNC_PATH)!;
    expect(isSealedBlob(sealed)).toBe(true);
    expect(openSecretsBundle(mk(), sealed).entries.a.secret).toEqual({ pass: "s1" });
  });

  it("merges a remote entry per-entry and imports it into the keychain", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    // Device 2 already published account b; device 1 has account a.
    target.remote.set(SECRETS_SYNC_PATH, sealSecretsBundle(mk(), bundle({ b: entry("b@x", 1, "sB") })));
    const store = { bundle: bundle({ a: entry("a@x", 1, "sA") }), imported: [] as SecretsBundle[] };
    const step = new SecretsSyncStep({ port: makeSecretsPort(store), masterKey: mk(), now: () => "t" });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    // Both accounts present locally (imported) and remotely (uploaded).
    expect(Object.keys(store.bundle.entries).sort()).toEqual(["a", "b"]);
    expect(store.imported).toHaveLength(1);
    expect(Object.keys(openSecretsBundle(mk(), target.remote.get(SECRETS_SYNC_PATH)!).entries).sort()).toEqual(["a", "b"]);
  });

  it("is a no-op import when local and remote already agree", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    const shared = bundle({ a: entry("a@x", 3, "sA") });
    target.remote.set(SECRETS_SYNC_PATH, sealSecretsBundle(mk(), shared));
    const store = { bundle: shared, imported: [] as SecretsBundle[] };
    const step = new SecretsSyncStep({ port: makeSecretsPort(store), masterKey: mk(), now: () => "t" });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(store.imported).toHaveLength(0);
  });
});

// --- v3 keyfile sideband step ---

describe("KeyfileSyncStep", () => {
  const kf = (updatedAt: string) => JSON.stringify({ format: "plainva-keyfile", version: 1, updatedAt });

  it("publishes the local keyfile when the remote has none", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    vault.files.set(KEYFILE_SYNC_PATH, kf("2026-07-21T10:00:00Z"));
    await new KeyfileSyncStep().run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(target.remote.has(KEYFILE_SYNC_PATH)).toBe(true);
  });

  it("adopts a strictly newer remote keyfile and fires the re-unlock hint", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    vault.files.set(KEYFILE_SYNC_PATH, kf("2026-07-21T10:00:00Z"));
    target.remote.set(KEYFILE_SYNC_PATH, new TextEncoder().encode(kf("2026-07-21T12:00:00Z")));
    const adopted: number[] = [];
    await new KeyfileSyncStep({ onRemoteKeyfileAdopted: () => adopted.push(1) }).run(
      target as unknown as ISyncTarget,
      vault as unknown as IVaultAdapter
    );
    expect(JSON.parse(vault.files.get(KEYFILE_SYNC_PATH)!).updatedAt).toBe("2026-07-21T12:00:00Z");
    expect(adopted).toHaveLength(1);
  });

  it("keeps and re-publishes the local keyfile when it is newer", async () => {
    const target = new FakeTarget();
    const vault = new FakeVault();
    vault.files.set(KEYFILE_SYNC_PATH, kf("2026-07-21T14:00:00Z"));
    target.remote.set(KEYFILE_SYNC_PATH, new TextEncoder().encode(kf("2026-07-21T12:00:00Z")));
    await new KeyfileSyncStep().run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(JSON.parse(new TextDecoder().decode(target.remote.get(KEYFILE_SYNC_PATH)!)).updatedAt).toBe("2026-07-21T14:00:00Z");
  });
});

// --- v3 connection fingerprint ---

describe("connectionFingerprint", () => {
  it("is deterministic and normalizes the remote root", () => {
    expect(connectionFingerprint("drive", "Plainva")).toBe("drive:plainva");
    expect(connectionFingerprint("Drive", "/Plainva/")).toBe("drive:plainva");
    expect(connectionFingerprint("onedrive", "Apps/Plainva")).toBe("onedrive:apps/plainva");
    expect(connectionFingerprint("webdav", "  root  ")).toBe("webdav:root");
  });
});

// --- v3 fail-closed content-E2E guard evaluation ---

describe("evaluateManifestGuard", () => {
  const CONN = "drive:plainva";
  const known = (over: Partial<{ knownEncrypted: boolean; expectedKeyId: string }> = {}) => ({
    connectionId: CONN,
    knownEncrypted: over.knownEncrypted ?? false,
    expectedKeyId: over.expectedKeyId,
  });
  const body = (over: Partial<ManifestBody> = {}): ManifestBody => ({
    formatVersion: 1,
    minGuardVersion: 1,
    connectionId: CONN,
    keyId: "aabbccddeeff0011",
    state: "strict",
    ownerDeviceId: "",
    ownerLeaseUntil: 0,
    generation: 1,
    createdAt: "t",
    updatedAt: "t",
    ...over,
  });
  const manifestText = (over: Partial<ManifestBody> = {}) => JSON.stringify(signManifest(mk(), body(over)));

  it("TOFU: no manifest + never-encrypted connection -> plain", () => {
    expect(evaluateManifestGuard({ manifestText: null, known: known(), masterKey: null, guardVersion: 1 })).toEqual({ mode: "plain" });
  });

  it("no manifest on a KNOWN-encrypted connection -> fatal", () => {
    expect(() => evaluateManifestGuard({ manifestText: null, known: known({ knownEncrypted: true }), masterKey: null, guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });

  it("a valid strict manifest with the key -> strict + pins the connection", () => {
    const d = evaluateManifestGuard({ manifestText: manifestText(), known: known(), masterKey: mk(), guardVersion: 1 });
    expect(d.mode).toBe("strict");
    expect(d.state).toBe("strict");
    expect(d.pinEncrypted).toBe(true);
  });

  it("a migrating manifest -> mixed", () => {
    const d = evaluateManifestGuard({ manifestText: manifestText({ state: "migrating" }), known: known(), masterKey: mk(), guardVersion: 1 });
    expect(d.mode).toBe("mixed");
  });

  it("an encrypting manifest but the vault is locked -> fatal (encrypted-without-key)", () => {
    expect(() => evaluateManifestGuard({ manifestText: manifestText(), known: known(), masterKey: null, guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });

  it("a foreign connectionId -> fatal", () => {
    expect(() => evaluateManifestGuard({ manifestText: manifestText({ connectionId: "drive:other" }), known: known(), masterKey: mk(), guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });

  it("app guard older than the manifest minimum -> fatal (guard-too-old)", () => {
    expect(() => evaluateManifestGuard({ manifestText: manifestText({ minGuardVersion: 5 }), known: known(), masterKey: mk(), guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });

  it("a tampered manifest MAC -> fatal", () => {
    const tampered = JSON.stringify({ ...signManifest(mk(), body()), generation: 99 });
    expect(() => evaluateManifestGuard({ manifestText: tampered, known: known(), masterKey: mk(), guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });

  it("an authenticated plain tombstone with the key -> plain", () => {
    const d = evaluateManifestGuard({ manifestText: manifestText({ state: "plain" }), known: known({ knownEncrypted: true }), masterKey: mk(), guardVersion: 1 });
    expect(d.mode).toBe("plain");
    expect(d.state).toBe("plain");
  });

  it("a key this device does not hold -> fatal (key-mismatch)", () => {
    // Manifest signed+keyed for a different MK; our device holds mk().
    const other = { keyId: "1111111111111111", masterKey: new Uint8Array(32).fill(9) };
    const foreign = JSON.stringify(signManifest(other, { ...body(), keyId: other.keyId }));
    expect(() => evaluateManifestGuard({ manifestText: foreign, known: known(), masterKey: mk(), guardVersion: 1 })).toThrow(FatalSyncProtocolError);
  });
});
