import { describe, expect, it } from "vitest";
import { canonicalSecretId, canonicalizeEndpoint, type SecretBinding, type SecretsBundle } from "@plainva/core";
import { calDavSecretBinding, createSecretsPort, imapSecretBinding, type LocalSecretCandidate, type SecretsPortMeta } from "@plainva/ui";

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

function device(name: string, rows: () => Row[], slots = new Map<string, { kind: string; url: string; user: string; pass: string }>()) {
  let meta: SecretsPortMeta | null = null;
  let tick = 0;
  const candidates = (): LocalSecretCandidate[] =>
    rows().map((row) => {
      const binding = calDavSecretBinding("webdav", URL_, row.user);
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
    now: () => `2026-11-17T00:00:${String(tick++).padStart(2, "0")}.000Z`,
  });
  return { port, slots, meta: () => meta };
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
});
