import { describe, expect, it } from "vitest";
import { canonicalSecretId, canonicalizeEndpoint, mergeSecretsBundles, stableStringify, type SecretBinding, type SecretsBundle } from "@plainva/core";
import { calDavSecretBinding, imapSecretBinding, retireSecret, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";
import { createSecretsPort } from "./test-secretsPort";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";

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
  // A device on 0.8.7 runs the code of that tag (`secretsV087`), not today's.
  const port = (legacy ? (v087.createSecretsPort as unknown as typeof createSecretsPort) : createSecretsPort)({
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
  return { port, slots, meta: () => meta, host, legacy };
}

/** One settings round of a device against the shared bundle, as SecretsSyncStep runs it. */
let remote: SecretsBundle | null = null;
async function round(d: ReturnType<typeof device>): Promise<void> {
  const at = new Date(Date.parse("2026-11-17T01:00:00.000Z") + 1000 * clock++).toISOString();
  if (d.legacy) {
    remote = (await v087.runV087Round(d.port as never, remote as never, at)).remote as SecretsBundle;
    return;
  }
  const local = await d.port.exportBundle();
  const merged = mergeSecretsBundles(local, remote, at);
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || d.port.awaitsDocument?.()) await d.port.importBundle(merged);
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
  it("each has its own secret name in the current type; the old name of an account is the lower-cased one of 0.8.7", () => {
    const lower = calDavSecretBinding("webdav", URL_, " alice ");
    const upper = calDavSecretBinding("webdav", URL_, "Alice");
    expect(lower.user).toBe("alice");
    expect(upper.user).toBe("Alice");
    expect(canonicalSecretId(lower)).toBe(`s1:calendar:caldav-password-2:alice@${encodeURIComponent(ENDPOINT)}`);
    expect(canonicalSecretId(upper)).toBe(`s1:calendar:caldav-password-2:Alice@${encodeURIComponent(ENDPOINT)}`);
    expect(canonicalSecretId(legacyBinding("Alice"))).toBe(v087.canonicalSecretId(legacyBinding("Alice") as never));
    expect(canonicalSecretId(legacyBinding("Alice"))).toBe(`s1:calendar:caldav-password:alice@${encodeURIComponent(ENDPOINT)}`);
    // A mailbox is one account in any case of its address.
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

  it("a password changed on a device on 0.8.7 reaches the new device; one changed on the new device waits for the update and is never undone (review 2026-11-18, s2n)", async () => {
    remote = null;
    const old = device("A-087", () => [{ id: "a-Alice", user: "Alice" }], new Map([["a-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw1" }]]), true);
    const fresh = device("B-new", () => [{ id: "b-Alice", user: "Alice" }]);
    await round(old);
    await round(fresh);
    await round(fresh);
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw1" });

    old.slots.set("a-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw2" });
    await round(old);
    await round(fresh);
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw2" });

    // Changed on the updated device: the old name is never exported, so the
    // device on 0.8.7 keeps its password until it is updated (F36) — and its
    // unchanged old-name entry never puts pw2 back over pw3 anywhere.
    fresh.slots.set("b-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw3" });
    await round(fresh);
    await round(old);
    expect(passOf(old.slots)).toEqual({ "a-Alice": "Alice:pw2" });
    const legacyId = canonicalSecretId(legacyBinding("Alice"));
    const exactId = canonicalSecretId(calDavSecretBinding("webdav", URL_, "Alice"));
    for (let i = 0; i < 2; i++) {
      await round(fresh);
      await round(old);
    }
    const settled = JSON.stringify(remote!.entries);
    for (let i = 0; i < 3; i++) {
      await round(fresh);
      await round(old);
    }
    expect(JSON.stringify(remote!.entries)).toBe(settled);
    expect(passOf(fresh.slots)).toEqual({ "b-Alice": "Alice:pw3" });
    expect(remote!.entries[exactId]?.secret).toEqual({ pass: "pw3" });
    expect(remote!.entries[legacyId]?.secret).toEqual({ pass: "pw2" });
    expect(remote!.entries[legacyId]?.deviceId).toBe("A-087");
  });

  it("after \"alice\" is removed, its old entries never reach \"Alice\" (review 2026-11-18, t2)", async () => {
    let rows: Row[] = [{ id: "r-alice", user: "alice" }, { id: "r-Alice", user: "Alice" }];
    const d = device("B", () => rows, new Map([["r-alice", { kind: "caldav", url: URL_, user: "alice", pass: "alice-pw" }]]));
    // "Alice" got its password from another device, as on a second phone.
    const AliceBinding = calDavSecretBinding("webdav", URL_, "Alice");
    await d.port.importBundle(bundleOf([[canonicalSecretId(AliceBinding), { entryRev: 1, updatedAt: "2026-11-17T00:00:00.000Z", deviceId: "laptop", binding: AliceBinding, secret: { pass: "Alice-pw" } }]]));
    expect(passOf(d.slots)).toEqual({ "r-alice": "alice:alice-pw", "r-Alice": "Alice:Alice-pw" });
    await d.port.exportBundle();
    await retireSecret(d.host, calDavSecretBinding("webdav", URL_, "alice"));
    rows = [{ id: "r-Alice", user: "Alice" }];
    d.slots.delete("r-alice");
    const after = await d.port.exportBundle();
    const aliceId = canonicalSecretId(calDavSecretBinding("webdav", URL_, "alice"));
    expect(after.entries[aliceId]?.tombstone).toBe(true);
    // A device on 0.8.7 that still has "alice" changes its password later.
    const [, late] = legacyEntry("alice-new-pw", "alice");
    const result = await d.port.importBundle(bundleOf([[canonicalSecretId(late.binding), { ...late, entryRev: 9, updatedAt: "2026-11-30T00:00:00.000Z" }]]));
    expect(result.imported).toEqual([]);
    expect(passOf(d.slots)).toEqual({ "r-Alice": "Alice:Alice-pw" });
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

  // Review 2026-11-25 (X1): "Remove account" also writes a tombstone under the
  // old name this device read the password by, so it leaves the old place
  // too. That name carries never a value, and a tombstone only from that act.
  it("the name a device on 0.8.7 knows a password by is never exported as a value, and as a tombstone only from \"Remove account\"", async () => {
    let rows: Row[] = [{ id: "r-Alice", user: "Alice" }];
    const d = device("A", () => rows, new Map([["r-Alice", { kind: "caldav", url: URL_, user: "Alice", pass: "pw" }]]));
    // It was read once from a device on 0.8.7.
    await d.port.importBundle(bundleOf([legacyEntry("pw")]));
    const legacyId = canonicalSecretId(legacyBinding("Alice"));
    const first = await d.port.exportBundle();
    expect(first.entries).not.toHaveProperty(legacyId);
    await retireSecret(d.host, calDavSecretBinding("webdav", URL_, "Alice"));
    rows = [];
    d.slots.clear();
    const after = await d.port.exportBundle();
    expect(after.entries[legacyId]).toMatchObject({ tombstone: true, deviceId: "A", binding: legacyBinding("Alice") });
    expect(after.entries[legacyId]?.secret).toBeUndefined();
    expect(after.entries[canonicalSecretId(calDavSecretBinding("webdav", URL_, "Alice"))]?.tombstone).toBe(true);
  });

  // Review 2026-11-18, O1 and round six: whether an entry is an account's old
  // name is said by its type — its place in the document, which a device on
  // 0.8.7 keeps when it writes an entry back — never by the spelling of its
  // user. Every password ends in its own slot or none.
  const twinRows = (): Row[] => [{ id: "rA", user: "Alice" }, { id: "ra", user: "alice" }];
  const caldav = (user: string, pass: string) => ({ kind: "caldav", url: URL_, user, pass });

  it("F5: \"alice\" removed while another device changes it: its password never lands in \"Alice\"'s slot", async () => {
    remote = null;
    let n3Rows = twinRows();
    let n1Rows = twinRows();
    const n1 = device("N1", () => n1Rows, new Map([["rA", caldav("Alice", "pA")], ["ra", caldav("alice", "pa")]]));
    const n2 = device("N2", twinRows);
    const n3 = device("N3", () => n3Rows);
    for (const d of [n1, n2, n3, n1, n2, n3]) await round(d);
    await retireSecret(n1.host, calDavSecretBinding("webdav", URL_, "alice"));
    n1Rows = [{ id: "rA", user: "Alice" }];
    n1.slots.delete("ra");
    n3Rows = [{ id: "rA", user: "Alice" }];
    for (const d of [n1, n3]) await round(d);
    n2.slots.set("ra", caldav("alice", "pa2"));
    for (const d of [n2, n3, n1, n2, n3, n1]) await round(d);
    expect(n3.slots.get("rA")?.pass).toBe("pA");
    expect(n1.slots.get("rA")?.pass).toBe("pA");
    expect(n2.slots.get("rA")?.pass).toBe("pA");
  });

  it("F6: a device on 0.8.7 that knows only \"Alice\" changes its password: it never lands in \"alice\"'s slot", async () => {
    remote = null;
    const n1 = device("N1", twinRows, new Map([["rA", caldav("Alice", "pA")], ["ra", caldav("alice", "pa")]]));
    const n2 = device("N2", twinRows);
    const old = device("O", () => [{ id: "rA", user: "Alice" }], new Map(), true);
    for (const d of [n1, n2, old, n1, n2, old]) await round(d);
    old.slots.set("rA", caldav("Alice", "pO"));
    for (const d of [old, n1, n2, old, n1, n2]) await round(d);
    for (const d of [n1, n2]) expect(d.slots.get("ra")?.pass).not.toBe("pO");
    expect(n1.slots.get("ra")?.pass).toBe("pa");
  });

  it("F7: \"alice\" gone from one device while another changes it: \"Alice\" keeps its own password there", async () => {
    remote = null;
    let n2Rows = twinRows();
    const n1 = device("N1", twinRows, new Map([["rA", caldav("Alice", "pA")], ["ra", caldav("alice", "pa")]]));
    const n2 = device("N2", () => n2Rows);
    for (const d of [n1, n2, n1, n2]) await round(d);
    n2Rows = [{ id: "rA", user: "Alice" }];
    n1.slots.set("ra", caldav("alice", "pa2"));
    for (const d of [n1, n2, n1, n2]) await round(d);
    expect(n2.slots.get("rA")?.pass).toBe("pA");
    expect(n1.slots.get("rA")?.pass).toBe("pA");
  });

  it("a tombstone under the old name is remembered, not applied: a later value under it revives nothing", async () => {
    const d = device("B", () => [{ id: "r-Alice", user: "Alice" }], new Map([["r-Alice", caldav("Alice", "Alice-pw")]]));
    const [id, entry] = legacyEntry("x");
    await d.port.importBundle(bundleOf([[id, { entryRev: 4, updatedAt: "2026-11-02T00:00:00.000Z", deviceId: "old-phone", binding: entry.binding, tombstone: true }]]));
    expect(passOf(d.slots)).toEqual({ "r-Alice": "Alice:Alice-pw" });
    expect(d.meta()?.oldNameTombstones?.[id]).toBe("2026-11-02T00:00:00.000Z");
    await d.port.importBundle(bundleOf([[id, { ...entry, entryRev: 5, updatedAt: "2026-11-03T00:00:00.000Z", secret: { pass: "late" } }]]));
    expect(passOf(d.slots)).toEqual({ "r-Alice": "Alice:Alice-pw" });
  });
});
