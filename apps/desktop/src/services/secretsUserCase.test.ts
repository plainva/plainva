import { describe, expect, it } from "vitest";
import { canonicalSecretId, canonicalizeEndpoint, mergeSecretsBundles, stableStringify, type SecretBinding, type SecretsBundle } from "@plainva/core";
import { calDavSecretBinding, createSecretsPort, imapSecretBinding, retireSecret, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";

/**
 * Two calendar rows the account rule keeps apart — "alice" and "Alice" on a
 * server that tells them apart — never share a place in the secrets sync
 * (GitHub issue 174, review 2026-11-17). Both shells build their bindings with
 * `calDavSecretBinding`, so these tests hold for both.
 *
 * Before: one secret name for both rows. Export wrote the second password over
 * the first in the same entry and raised its revision by two on every cycle;
 * the import put "Alice"'s password into "alice"'s slot and left "Alice"
 * without one.
 */

const URL_ = "https://dav.example.com/";
const ENDPOINT = canonicalizeEndpoint(URL_);
type Row = { id: string; user: string };

let clock = 0;
/** A device up to 0.8.7 lower-cased the user and named the secret after that. */
const legacyBinding = (user: string): SecretBinding => ({ family: "webdav", service: "calendar", secretType: "caldav-password", user: user.trim().toLowerCase(), endpoint: ENDPOINT });

function device(name: string, rows: () => Row[], slots = new Map<string, { kind: string; url: string; user: string; pass: string }>(), legacy = false) {
  let meta: SecretsPortMeta | null = null;
  const candidates = (): LocalSecretCandidate[] =>
    rows().map((row) => {
      const binding = legacy ? legacyBinding(row.user) : calDavSecretBinding("webdav", URL_, row.user);
      const stored = slots.get(row.id);
      return {
        logicalId: canonicalSecretId(binding),
        slot: row.id,
        binding,
        secret: stored?.pass ? { pass: stored.pass } : null,
        apply: (secret) => ({ kind: "caldav", url: URL_, user: row.user, pass: secret.pass ?? "" }),
      };
    });
  const port = createSecretsPort({
    deviceId: async () => name,
    readMeta: async () => meta,
    writeMeta: async (m) => {
      meta = structuredClone(m);
    },
    candidates: async () => candidates(),
    readSlot: async (slot) => slots.get(slot) ?? null,
    writeSlot: async (slot, value) => void slots.set(slot, value as never),
    removeSlot: async (slot) => void slots.delete(slot),
    now: () => new Date(Date.parse("2026-11-17T00:00:00.000Z") + 1000 * clock++).toISOString(),
  });
  const host = { readMeta: async () => meta, writeMeta: async (m: SecretsPortMeta) => { meta = structuredClone(m); } };
  return { port, slots, meta: () => meta, host };
}

/** One settings round of a device against the shared bundle, as SecretsSyncStep runs it. */
let remote: SecretsBundle | null = null;
async function round(d: ReturnType<typeof device>): Promise<void> {
  const local = await d.port.exportBundle();
  const merged = mergeSecretsBundles(local, remote, new Date(Date.parse("2026-11-17T01:00:00.000Z") + 1000 * clock++).toISOString());
  if (stableStringify(merged.entries) !== stableStringify(local.entries)) await d.port.importBundle(merged);
  remote = merged;
}

const passOf = (slots: Map<string, { user: string; pass: string }>) =>
  Object.fromEntries([...slots].map(([slot, value]) => [slot, `${value.user}:${value.pass}`]));

/** An entry as a device up to 0.8.7 wrote it: the user lower-cased, the name without a suffix. */
function legacyEntry(pass: string, user = "alice"): [string, SecretsBundle["entries"][string]] {
  const binding: SecretBinding = { family: "webdav", service: "calendar", secretType: "caldav-password", user: user.toLowerCase(), endpoint: ENDPOINT };
  return [canonicalSecretId(binding), { entryRev: 3, updatedAt: "2026-11-01T00:00:00.000Z", deviceId: "old-phone", binding, secret: { pass } }];
}

const bundleOf = (entries: Array<[string, SecretsBundle["entries"][string]]>): SecretsBundle => ({
  format: "plainva-secrets",
  version: 1,
  bundleRev: 1,
  updatedAt: "2026-11-01T00:00:00.000Z",
  entries: Object.fromEntries(entries),
});

describe("two password accounts that differ only in the case of the user", () => {
  it("each has its own secret name; a user in lower case keeps the name it always had", () => {
    const lower = calDavSecretBinding("webdav", URL_, " alice ");
    const upper = calDavSecretBinding("webdav", URL_, "Alice");
    expect(lower.user).toBe("alice");
    expect(upper.user).toBe("Alice");
    expect(canonicalSecretId(lower)).toBe(`s1:calendar:caldav-password:alice@${encodeURIComponent(ENDPOINT)}`);
    expect(canonicalSecretId(upper)).not.toBe(canonicalSecretId(lower));
    // A mailbox is one account in any case of its address: its name is unchanged.
    expect(imapSecretBinding("imap", "imap.example.com", 993, "Marco@Example.com").user).toBe("marco@example.com");
  });

  it("are exported row by row and stay stable, and arrive each in its own slot", async () => {
    const a = device("A", () => [{ id: "r-alice", user: "alice" }, { id: "r-Alice", user: "Alice" }], new Map([
      ["r-alice", { kind: "caldav", url: URL_, user: "alice", pass: "alice-pw" }],
      ["r-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "Alice-pw" }],
    ]));
    // The other device got both rows through the settings, in another order, without passwords.
    const b = device("B", () => [{ id: "s-Alice", user: "Alice" }, { id: "s-alice", user: "alice" }]);

    const revisions: number[][] = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      const bundle = await a.port.exportBundle();
      expect(Object.keys(bundle.entries)).toHaveLength(2);
      revisions.push(Object.values(bundle.entries).map((entry) => entry.entryRev));
      await b.port.importBundle(bundle);
      expect(passOf(b.slots)).toEqual({ "s-Alice": "Alice:Alice-pw", "s-alice": "alice:alice-pw" });
    }
    // Nothing changed, so no revision moved.
    expect(revisions).toEqual([[1, 1], [1, 1], [1, 1]]);
  });

  it("an entry from a device on 0.8.7 still reaches the single account it can mean", async () => {
    const only = device("B", () => [{ id: "s-Alice", user: "Alice" }]);
    const result = await only.port.importBundle(bundleOf([legacyEntry("old-pw")]));
    expect(result.imported).toHaveLength(1);
    expect(passOf(only.slots)).toEqual({ "s-Alice": "Alice:old-pw" });

    // ...and the next export does not retire it: a device on 0.8.7 that still
    // names the password so would apply that by deleting a working one.
    const bundle = await only.port.exportBundle();
    expect(Object.values(bundle.entries).some((entry) => entry.tombstone)).toBe(false);
  });

  it("an entry from a device on 0.8.7 reaches none of two accounts it could mean", async () => {
    const two = device("B", () => [{ id: "s-Alice", user: "Alice" }, { id: "s-ALICE", user: "ALICE" }]);
    const result = await two.port.importBundle(bundleOf([legacyEntry("old-pw")]));
    expect(result.imported).toEqual([]);
    expect(two.slots.size).toBe(0);
  });

  it("an entry from a device on 0.8.7 never puts an older password over the exact entry of the same account", async () => {
    const exactBinding = calDavSecretBinding("webdav", URL_, "Alice");
    const exact: [string, SecretsBundle["entries"][string]] = [
      canonicalSecretId(exactBinding),
      { entryRev: 1, updatedAt: "2026-11-17T00:00:00.000Z", deviceId: "laptop", binding: exactBinding, secret: { pass: "new-pw" } },
    ];
    for (const order of [[legacyEntry("old-pw"), exact], [exact, legacyEntry("old-pw")]]) {
      const b = device("B", () => [{ id: "s-Alice", user: "Alice" }]);
      await b.port.importBundle(bundleOf(order));
      expect(passOf(b.slots)).toEqual({ "s-Alice": "Alice:new-pw" });
    }
  });

  it("a password changed on a device on 0.8.7 reaches the new device, and the other way round, for the one account its name can mean (review 2026-11-18)", async () => {
    remote = null;
    // The password was typed on a third device; both of these got it through
    // the sync (a password a device typed itself is never overwritten by
    // another device's, on any version — that rule is not this one).
    const origin = device("C-new", () => [{ id: "c-Alice", user: "Alice" }], new Map([["c-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw1" }]]));
    const old = device("A-087", () => [{ id: "a-Alice", user: "Alice" }], undefined, true);
    const fresh = device("B-new", () => [{ id: "b-Alice", user: "Alice" }]);
    await round(origin);
    await round(old);
    await round(fresh);
    await round(fresh);
    expect(passOf(old.slots)).toEqual({ "a-Alice": "Alice:pw1" });
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw1" });

    old.slots.set("a-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw2" });
    await round(old);
    await round(fresh);
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw2" });

    fresh.slots.set("b-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw3" });
    await round(fresh);
    await round(old);
    expect(passOf(old.slots)).toEqual({ "a-Alice": "Alice:pw3" });

    // Settled: three more rounds move no revision.
    await round(fresh);
    await round(old);
    const settled = JSON.stringify(remote!.entries);
    for (let i = 0; i < 3; i++) {
      await round(fresh);
      await round(old);
    }
    expect(JSON.stringify(remote!.entries)).toBe(settled);
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw3" });
  });

  it("\"Remove account\" tombstones exactly that account, also beside \"alice\" and when it was the last one", async () => {
    let rows: Row[] = [{ id: "r-alice", user: "alice" }, { id: "r-Alice", user: "Alice" }];
    const d = device("A", () => rows, new Map([
      ["r-alice", { kind: "caldav", url: URL_, user: "alice", pass: "alice-pw" }],
      ["r-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "Alice-pw" }],
    ]));
    await d.port.exportBundle();
    const alice = canonicalSecretId(calDavSecretBinding("webdav", URL_, "alice"));
    const Alice = canonicalSecretId(calDavSecretBinding("webdav", URL_, "Alice"));

    await retireSecret(d.host, calDavSecretBinding("webdav", URL_, "Alice"));
    rows = [{ id: "r-alice", user: "alice" }];
    d.slots.delete("r-Alice");
    const beside = await d.port.exportBundle();
    expect(beside.entries[Alice]?.tombstone).toBe(true);
    expect(beside.entries[alice]?.tombstone).toBeFalsy();
    expect(beside.entries[alice]?.secret).toEqual({ pass: "alice-pw" });

    await retireSecret(d.host, calDavSecretBinding("webdav", URL_, "alice"));
    rows = [];
    d.slots.clear();
    const last = await d.port.exportBundle();
    expect(last.entries[alice]?.tombstone).toBe(true);
  });

  it("\"Remove account\" of the only \"Alice\" tombstones the name a device on 0.8.7 knows it by too", async () => {
    let rows: Row[] = [{ id: "r-Alice", user: "Alice" }];
    const d = device("A", () => rows, new Map([["r-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw" }]]));
    const first = await d.port.exportBundle();
    const legacyId = canonicalSecretId(legacyBinding("Alice"));
    expect(first.entries[legacyId]?.secret).toEqual({ pass: "pw" });
    await retireSecret(d.host, calDavSecretBinding("webdav", URL_, "Alice"));
    rows = [];
    d.slots.clear();
    const after = await d.port.exportBundle();
    expect(after.entries[legacyId]?.tombstone).toBe(true);
    expect(after.entries[canonicalSecretId(calDavSecretBinding("webdav", URL_, "Alice"))]?.tombstone).toBe(true);
  });
});
