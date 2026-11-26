import { describe, expect, it } from "vitest";
import {
  assertSecretsBundleStructure,
  canonicalSecretId,
  canonicalizeEndpoint,
  mergeSecretsBundles,
  stableStringify,
  type SecretBinding,
  type SecretsBundle,
} from "@plainva/core";
import {
  SECRETS_MARK_KEY_SLOT,
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  mergeLegacySecretsMeta,
  migrateSecretsMetaToCanonicalIds,
  noteSecretLeftWithProfile,
  retireSecret,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";
import * as v090 from "../../../../packages/core/test/fixtures/secretsV090";

/**
 * Fixed cases of the fourth round of the review of the secrets removal rules
 * (2026-11-26; `docs/engineering/Secrets_Removal_Rules.md`): the review's
 * probes R3a–R3f and Q5 with the outcome the rules give, the named exceptions
 * they found, and one case for each rule a mutation of the port survived in
 * the third round. Updated devices run today's port, devices on 0.9.0 and
 * 0.8.7 their frozen code (`secretsV090.ts`, `secretsV087.ts`); a settings
 * cycle runs the profile step first and the secrets step only after it. All
 * data invented.
 */

const URLS = { a: "https://cloud.example.com/remote.php/dav", b: "https://dav.example.org/remote.php/dav" } as const;
const HOSTS = { a: "imap.example.com", b: "mail.example.org" } as const;
type At = keyof typeof URLS;
type Row = { id: string; user: string; kind?: "mail"; at?: At };
type Kind = "new" | "v090" | "v087";
type Slot = string | { signedOut: true };

let clock = 0;
const BASE = Date.parse("2026-11-25T00:00:00.000Z");
const tickRaw = () => BASE + 1000 * clock++;

const oldBinding = (row: Row): SecretBinding =>
  row.kind === "mail"
    ? { family: "imap", service: "mail", secretType: "imap-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(`imaps://${HOSTS[row.at ?? "a"]}:993`) }
    : { family: "webdav", service: "calendar", secretType: "caldav-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(URLS[row.at ?? "a"]) };
const newBinding = (row: Row): SecretBinding =>
  row.kind === "mail" ? imapSecretBinding("imap", HOSTS[row.at ?? "a"], 993, row.user) : calDavSecretBinding("webdav", URLS[row.at ?? "a"], row.user);

interface Device {
  name: string;
  kind: Kind;
  rows: Row[];
  slots: Map<string, Slot>;
  keyring: Map<string, unknown>;
  meta: SecretsPortMeta | null;
  retired: SecretsPortMeta["retired"] | null;
  pushes: number;
  reports: number;
  emptiedByPort: string[];
  skew: number;
  profile: "on" | "lag" | "off";
  pending: Array<() => void>;
  awayUntil: number;
  /** Cycles a device with a failing profile step ran: every other one fails, profile and secrets both. */
  lagCycles: number;
  /** Slots a password was typed into on this device (not written by its port). */
  typed: Set<string>;
  calendarHidden?: boolean;
  emptiedAny: string[];
}

function device(name: string, kind: Kind, rows: Row[], skew: number, profile: Device["profile"]): Device {
  return { name, kind, rows: rows.map((row) => ({ ...row })), slots: new Map(), keyring: new Map(), meta: null, retired: null, pushes: 0, reports: 0, emptiedByPort: [], skew, profile, pending: [], awayUntil: -1, lagCycles: 0, typed: new Set(), emptiedAny: [] };
}
const nowOf = (d: Device) => () => new Date(tickRaw() + d.skew).toISOString();

function metaHost(d: Device) {
  return {
    readMeta: async (): Promise<SecretsPortMeta | null> => {
      const meta = d.meta ? (structuredClone(d.meta) as SecretsPortMeta) : d.retired ? { entries: {}, imported: {}, quarantine: {} } : null;
      if (meta && d.retired) meta.retired = { ...(meta.retired ?? {}), ...structuredClone(d.retired) };
      return d.kind === "v087" ? meta : migrateSecretsMetaToCanonicalIds(mergeLegacySecretsMeta(meta, null));
    },
    writeMeta: async (meta: SecretsPortMeta) => {
      const { retired, ...marks } = structuredClone(meta);
      d.meta = marks as SecretsPortMeta;
      d.retired = retired && Object.keys(retired).length > 0 ? retired : null;
    },
  };
}
const retiredHost = (d: Device) => ({
  readMeta: async (): Promise<SecretsPortMeta | null> => ({ entries: {}, imported: {}, quarantine: {}, retired: structuredClone(d.retired ?? {}) }),
  writeMeta: async (meta: SecretsPortMeta) => {
    d.retired = structuredClone(meta.retired ?? {});
  },
});

function candidates(d: Device): LocalSecretCandidate[] {
  return d.rows.filter((row) => !(d.calendarHidden && row.kind !== "mail")).map((row) => {
    const binding = d.kind === "v087" ? oldBinding(row) : newBinding(row);
    const slot = d.slots.get(row.id);
    const pass = typeof slot === "string" ? slot : undefined;
    return {
      logicalId: d.kind === "v087" ? v087.canonicalSecretId(binding as never) : canonicalSecretId(binding),
      slot: row.id,
      binding,
      secret: pass ? { pass } : null,
      ...(typeof slot === "object" ? { signedOutHere: true } : {}),
      apply: (secret: Record<string, string>) => secret.pass,
    } as LocalSecretCandidate;
  });
}

function portOf(d: Device) {
  const host = {
    deviceId: async () => d.name,
    ...metaHost(d),
    candidates: async () => candidates(d),
    readSlot: async (slot: string) => (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.get(slot) : d.slots.get(slot)) ?? null,
    writeSlot: async (slot: string, value: unknown) => {
      if (slot === SECRETS_MARK_KEY_SLOT) return void d.keyring.set(slot, value);
      d.slots.set(slot, value as string);
      d.typed.delete(slot);
    },
    accountsReady: async (service: string) => service === "mail" || !d.calendarHidden,
    removeSlot: async (slot: string) => {
      if (d.rows.some((row) => row.id === slot) && typeof d.slots.get(slot) === "string") d.emptiedAny.push(`${d.name}:${slot}`);
      if (d.kind === "new" && d.rows.some((row) => row.id === slot) && typeof d.slots.get(slot) === "string") d.emptiedByPort.push(slot);
      d.slots.delete(slot);
    },
    now: nowOf(d),
  };
  if (d.kind === "v087") return v087.createSecretsPort(host as never);
  if (d.kind === "v090") return v090.createSecretsPort(host as never);
  return createSecretsPort(host);
}

let remote: SecretsBundle | null = null;
/** The shared document's entries, read where a round may have changed it. */
const docEntries = (): SecretsBundle["entries"] => remote?.entries ?? {};
/** One settings cycle of a device: the profile step first; the secrets step only after it succeeded. */
async function round(d: Device): Promise<void> {
  if (d.profile === "lag" && d.lagCycles++ % 2 === 1) return;
  if (d.profile !== "off") while (d.pending.length) d.pending.shift()!();
  await secretsRound(d);
}
async function secretsRound(d: Device): Promise<void> {
  const port = portOf(d);
  const t = nowOf(d)();
  if (d.kind === "v087") {
    const next = await v087.runV087Round(port as never, remote as never, t);
    if (next.pushed) d.pushes++;
    remote = next.remote as SecretsBundle;
    return;
  }
  if (d.kind === "v090") {
    const next = await v090.runV090Round(port as never, remote as never, t);
    if (next.pushed) d.pushes++;
    if (next.reported) d.reports++;
    remote = next.remote as SecretsBundle;
    return;
  }
  if (remote) assertSecretsBundleStructure(structuredClone(remote));
  const current = port as ReturnType<typeof createSecretsPort>;
  const local = await current.exportBundle();
  const merged = mergeSecretsBundles(local, remote, t);
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || current.awaitsDocument?.()) {
    if (!(await current.importBundle(merged)).settled) d.reports++;
  }
  if (!remote || stableStringify(merged.entries) !== stableStringify(remote.entries)) {
    d.pushes++;
    remote = merged;
  }
}

async function removeOnPurpose(d: Device, rowId: string): Promise<void> {
  const row = d.rows.find((item) => item.id === rowId)!;
  const take = async () => {
    d.rows = d.rows.filter((item) => item.id !== rowId);
    d.slots.delete(rowId);
  };
  if (d.kind === "new") {
    await retireSecret(retiredHost(d), newBinding(row), take, nowOf(d)());
    if (d.rows.some((item) => item.id === rowId)) await take();
    return;
  }
  if (d.kind === "v090" && row.kind !== "mail") await v090.retireSecret(retiredHost(d) as never, newBinding(row) as never);
  await take();
}
const typeInto = (d: Device, rowId: string, pass: string) => {
  d.slots.set(rowId, pass);
  d.typed.add(rowId);
};
function removedByProfile(d: Device, rowId: string): void {
  const row = d.rows.find((item) => item.id === rowId);
  d.rows = d.rows.filter((item) => item.id !== rowId);
  if (row?.kind !== "mail" || d.kind === "new") d.slots.delete(rowId);
  d.typed.delete(rowId);
}

/** The profile takes the account away on an updated device: the shells tell the secrets sync first (`noteSecretLeftWithProfile`). */
async function leftByProfile(d: Device, rowId: string): Promise<void> {
  const row = d.rows.find((item) => item.id === rowId);
  if (row && d.kind === "new") await noteSecretLeftWithProfile(retiredHost(d), newBinding(row));
  removedByProfile(d, rowId);
}
async function rr(fleet: Device[], times: number) {
  for (let i = 0; i < times; i++) for (const d of fleet) await round(d);
}
const idOf = (row: Row) => canonicalSecretId(newBinding(row));
const show = (e: SecretsBundle["entries"][string] | undefined) => (e ? `${e.tombstone ? "TOMB" : `val(${(e.secret as { pass?: string } | undefined)?.pass})`} r${e.entryRev} ${e.deviceId}` : "none");
const at = (row: Row, where: At): Row => ({ ...row, at: where });
const docAt = (row: Row, where: At) => show(remote?.entries[idOf(at(row, where))]);
const slotOf = (d: Device, id: string) => { const s = d.slots.get(id); return typeof s === "string" ? s : s ? "SIGNED-OUT" : "empty"; };
function repairAll(fleet: Device[], rowId: string, to: At) {
  for (const d of fleet) { const r = d.rows.find((x) => x.id === rowId); if (r) r.at = to; }
}
const K = (kind?: "mail"): Row => ({ id: "k", user: "keep", kind });


describe("the probes of the third review round, with the outcome the rules give", () => {
  for (const kind of [undefined, "mail" as const]) {
    it(`R3a1 ${kind ?? "calendar"}: repaired onto the address of an account removed before; a received password still follows`, async () => {
      remote = null; clock = 0;
      const B0: Row = { id: "b0", user: "cora@example.com", kind, at: "b" };
      const A0: Row = { id: "a0", user: "cora@example.com", kind, at: "a" };
      const n1 = device("N1", "new", [B0, K(kind)], 0, "on");
      const n2 = device("N2", "new", [B0, K(kind)], 0, "on");
      typeInto(n2, "b0", "Pb"); typeInto(n2, "k", "K");
      await rr([n2, n1], 3);
      await removeOnPurpose(n2, "b0");
      await leftByProfile(n1, "b0");
      await rr([n2, n1], 3);
      n2.rows.push({ ...A0 }); typeInto(n2, "a0", "P1");
      n1.rows.push({ ...A0 });
      await rr([n2, n1], 3);
      repairAll([n1, n2], "a0", "b");
      await rr([n2, n1], 3);
      typeInto(n2, "a0", "P2");
      await rr([n2, n1], 4);
      expect(slotOf(n1, "a0"), "statement 5: N1 received its password and follows the change").toBe("P2");
    });

    it(`R3a2 ${kind ?? "calendar"}: a device on 0.9.0 repairs a->b, the address goes back b->a; a received password still follows`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora@example.com", kind, at: "a" };
      const n1 = device("N1", "new", [X, K(kind)], 0, "on");
      const n2 = device("N2", "new", [X, K(kind)], 0, "on");
      const v = device("V", "v090", [X, K(kind)], 0, "on");
      typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
      await rr([n2, n1, v], 3);
      repairAll([v, n1, n2], "x", "b");
      await rr([v, n2, n1], 3);
      repairAll([n2, n1, v], "x", "a");
      await rr([n2, n1, v], 3);
      typeInto(n2, "x", "P2");
      await rr([n2, n1, v], 4);
      expect(slotOf(n1, "x"), "statement 5: N1 received its password and follows the change").toBe("P2");
      expect(docAt(X, "a")).toContain("val(P2)");
    });

    it(`R3c ${kind ?? "calendar"}: two accounts of one user swap their addresses; nothing lands in the wrong slot`, async () => {
      remote = null; clock = 0;
      const P: Row = { id: "p", user: "cora@example.com", kind, at: "a" };
      const Q: Row = { id: "q", user: "cora@example.com", kind, at: "b" };
      const n1 = device("N1", "new", [P, Q], 0, "on");
      const n2 = device("N2", "new", [P, Q], 0, "on");
      const v = device("V", "v090", [P, Q], 0, "on");
      typeInto(n2, "p", "Pp"); typeInto(n2, "q", "Pq");
      await rr([n2, n1, v], 3);
      for (const d of [n1, n2, v]) { d.rows.find((x) => x.id === "p")!.at = "b"; d.rows.find((x) => x.id === "q")!.at = "a"; }
      await rr([n2, n1, v], 4);
      typeInto(n2, "p", "Pp2");
      await rr([n2, n1, v], 4);
      expect([slotOf(n1, "p"), slotOf(n1, "q")]).toEqual(["Pp2", "Pq"]);
    });
  }

  it("R3d: signed out on N1, then a repair and a change elsewhere: N1 stays signed out; a sign-in there goes out", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const n1 = device("N1", "new", [X, K()], 0, "on");
    const n2 = device("N2", "new", [X, K()], 0, "on");
    const n3 = device("N3", "new", [X, K()], 0, "on");
    typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
    await rr([n2, n1, n3], 3);
    n1.slots.set("x", { signedOut: true });
    await rr([n1, n2, n3], 2);
    repairAll([n1, n2, n3], "x", "b");
    typeInto(n2, "x", "P2");
    await rr([n2, n3, n1], 4);
    expect(slotOf(n1, "x")).toBe("SIGNED-OUT");
    typeInto(n1, "x", "P3");
    await rr([n1, n2, n3], 4);
    expect(docAt(X, "b")).toContain("val(P3)");
    // N3 received its password and follows; N2 typed P2 there and keeps it (statement 5's one exception).
    expect([slotOf(n2, "x"), slotOf(n3, "x")]).toEqual(["P2", "P3"]);
  });

  it("R3e: a device long offline types a new password while the account is removed; the profile takes it first", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const r = device("R", "new", [X, K()], 0, "on");
    const o = device("O", "new", [X, K()], 0, "on");
    const v = device("V", "v090", [X, K()], 0, "on");
    typeInto(r, "x", "P1"); typeInto(r, "k", "K");
    await rr([r, o, v], 3);
    typeInto(o, "x", "P2");
    await removeOnPurpose(r, "x");
    await rr([r], 2);
    await leftByProfile(v, "x");
    await rr([v, r], 3);
    await leftByProfile(o, "x");
    await rr([o, r, v], 4);
    expect(docAt(X, "a").startsWith("val"), "the removed account's password leaves the document").toBe(false);
  });

  it("R3f (H1): a slot emptied outside the port — Stored access of a vault no longer listed, opened again — is filled from the document", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const n1 = device("N1", "new", [X, K()], 0, "on");
    const n2 = device("N2", "new", [X, K()], 0, "on");
    typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
    await rr([n2, n1], 3);
    n1.slots.delete("x");
    await rr([n1, n2], 4);
    expect(slotOf(n1, "x"), "statement 5").toBe("P1");
    // A slot signed out here stays empty of it.
    n1.slots.set("x", { signedOut: true });
    await rr([n1, n2], 3);
    expect(slotOf(n1, "x")).toBe("SIGNED-OUT");
  });

  for (const kind of [undefined, "mail" as const]) {
    for (const withV of [true, false]) {
      it(`R3q5 ${kind ?? "calendar"}${withV ? " with a device on 0.9.0" : ""}: two devices remove and add again in turn`, async () => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "xena@example.com", kind, at: "a" };
        const a = device("A", "new", [X, K(kind)], 0, "on");
        const b = device("B", "new", [X, K(kind)], 0, "on");
        const v = device("V", withV ? "v090" : "new", [X, K(kind)], 0, "on");
        const all = [a, b, v];
        typeInto(a, "x", "P0"); typeInto(a, "k", "K");
        await rr(all, 3);
        for (let i = 1; i <= 4; i++) {
          const [rem, add] = i % 2 ? [a, b] : [b, a];
          await removeOnPurpose(rem, "x");
          for (const o of all) if (o !== rem && o.rows.some((r) => r.id === "x")) await leftByProfile(o, "x");
          await rr([rem, v, add], 1);
          for (const o of all) if (!o.rows.some((r) => r.id === "x")) o.rows.push({ ...X });
          typeInto(add, "x", `P${i}`);
          await rr([add, v, rem], 2);
        }
        await rr(all, 5);
        const outcome = [slotOf(a, "x"), slotOf(b, "x"), slotOf(v, "x")];
        if (withV && kind === "mail") {
          // Named exception (M3): a device on 0.9.0 keeps the slot of a mailbox the
          // profile took away, gets the row back with the account added again,
          // and publishes its old password above the tombstone at the revision
          // the new password went out with; the later time wins that tie.
          expect(outcome).toEqual(["P4", "P0", "P0"]);
          expect(docAt(X, "a")).toContain("val(P0)");
        } else {
          expect(outcome).toEqual(["P4", "P4", "P4"]);
        }
      });
    }
  }
});

describe("the one comparison of two times: an entry of 0.8.7 against the current one (named exception, M1)", () => {
  for (const skewMin of [0, -60]) {
    it(`a change made on 0.8.7 whose clock runs ${skewMin === 0 ? "with the others" : "an hour behind"}`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora", at: "a" };
      const o = device("O", "v087", [X, K()], skewMin * 60_000, "on");
      const n = device("N", "new", [X, K()], 0, "on");
      const m = device("M", "new", [X, K()], 0, "on");
      typeInto(o, "x", "P1"); typeInto(o, "k", "K");
      await rr([o, n, m], 3);
      clock += 120;
      typeInto(n, "x", "PN");
      await rr([n, m, o], 3);
      clock += 120;
      typeInto(o, "x", "P2");
      await rr([o, n, m], 4);
      // The old name and the current one count their revisions apart, so only
      // the times can order them: a clock of 0.8.7 that runs behind loses its
      // later change on updated devices that received their password.
      expect(slotOf(m, "x")).toBe(skewMin === 0 ? "P2" : "PN");
    });
  }
});

describe("one case for each rule a mutation of the port survived (third review round)", () => {
  it("the account leaving with the profile takes back what a repair carried here (`moved`), though another device wrote its version", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    const d3 = device("D3", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2, d1, d3], 3);
    // D2 leaves the fleet. D1 repairs the address; D3 has not seen the repair yet when it removes the account at a.
    repairAll([d1], "x", "b");
    await rr([d1], 2);
    expect(docAt(X, "b"), "the repaired account's password goes out under b with D2's version").toContain("val(P1) r1 D2");
    await removeOnPurpose(d3, "x");
    await rr([d3], 2);
    await leftByProfile(d1, "x");
    await rr([d1, d3], 3);
    expect(docAt(X, "b").startsWith("val"), "statement 2: the password D1 carried to b leaves the document").toBe(false);
  });

  it("what a device only received stays its publisher's: the profile taking the account away takes back nothing of it", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const v = device("V", "v090", [X, K()], 0, "on");
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(v, "x", "P1"); typeInto(v, "k", "K");
    await rr([v, d1, d2], 3);
    // V's profile never brings what follows: it keeps the account at a (named exception "profile off").
    v.profile = "off";
    repairAll([d1, d2], "x", "b");
    await rr([d2, d1, v], 3);
    await removeOnPurpose(d2, "x");
    await leftByProfile(d1, "x");
    await rr([d2, d1, v], 4);
    expect(docAt(X, "b").startsWith("val"), "the removal took the password under b").toBe(false);
    expect(docAt(X, "a"), "V's own entry under a is V's to take back").toContain("val(P1)");
    expect(slotOf(v, "x"), "the device on 0.9.0 keeps its password").toBe("P1");
  });

  it("a password taken from another device under the repaired name is no longer this device's to take back (Z1)", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const v = device("V", "v090", [X, K()], 0, "on");
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2, d1, v], 3);
    repairAll([d1, d2, v], "x", "b");
    await rr([d1, d2, v], 3);
    // V types a newer password under b; D1 takes it.
    typeInto(v, "x", "P3");
    await rr([v, d1, d2], 3);
    expect(slotOf(d1, "x")).toBe("P3");
    // V's profile stops; the account is removed on D2 and leaves D1 with the profile.
    v.profile = "off";
    await removeOnPurpose(d2, "x");
    await rr([d2], 1);
    // V puts its password above D2's tombstone again (0.9.0 publishes what it holds), as its own.
    await rr([v], 1);
    await leftByProfile(d1, "x");
    await round(d1);
    expect(docAt(X, "b"), "D1 writes no tombstone over V's password: it took it, it did not carry it").not.toMatch(/^TOMB .*D1/);
    await rr([d1, v], 3);
    expect(slotOf(v, "x"), "D1 takes back nothing of V's: the device on 0.9.0 keeps its password").toBe("P3");
  });

  it("a removal only noted (the device knew nothing of the name) answers the first value it finds under it", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2], 2);
    // D2 leaves the fleet. D1 got the account through the profile and removes it before its first secrets round.
    const d1 = device("D1", "new", [X, K()], 0, "on");
    await removeOnPurpose(d1, "x");
    await rr([d1], 3);
    expect(docAt(X, "a").startsWith("val"), "statement 2").toBe(false);
  });

  it("a removal goes out above a password this device saw and did not take, in the round of the act", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2, d1], 3);
    d1.slots.set("x", { signedOut: true });
    await rr([d1], 1);
    typeInto(d2, "x", "P2");
    await rr([d2, d1], 1);
    typeInto(d2, "x", "P3");
    await rr([d2, d1], 1);
    // D1 saw P3 (revision 3) and did not take it; D2 leaves the fleet.
    await removeOnPurpose(d1, "x");
    await round(d1);
    expect(docAt(X, "a"), "the tombstone of the act stands above revision 3").toMatch(/^TOMB r4 D1/);
  });

  it("an entry of the same user under an address this device only has a record of is quiet: no full import after rest", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2, d1], 3);
    // The account leaves D1 with the profile; D2, whose profile never brings that, repairs it to b.
    d2.profile = "off";
    await leftByProfile(d1, "x");
    repairAll([d2], "x", "b");
    await rr([d1, d2], 4);
    expect(docAt(X, "b")).toContain("val(P1)");
    d1.reports = 0;
    await rr([d1, d2], 3);
    expect(d1.reports, "D1 knew that user at another address: nothing to report").toBe(0);
  });

  it("the account leaving with the profile takes back what this device published under an earlier address of the same user", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d1, "x", "P1"); typeInto(d1, "k", "K");
    await rr([d1, d2], 3);
    // Both repair the address; nothing is written under a any more, D1's entry there stays.
    repairAll([d1, d2], "x", "b");
    await rr([d1, d2], 3);
    expect(docAt(X, "a"), "D1's password is still under the earlier address").toContain("val(P1) r1 D1");
    await removeOnPurpose(d2, "x");
    await leftByProfile(d1, "x");
    await rr([d2, d1], 4);
    expect(docAt(X, "b").startsWith("val"), "the removal took the password under b").toBe(false);
    expect(docAt(X, "a").startsWith("val"), "statement 2: D1's own entry under the earlier address a leaves too").toBe(false);
  });

  it("an entry of the same user under an address of an account removed here, only noted, is quiet: no full import after rest", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora", at: "a" };
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2], 2);
    // D2 leaves the fleet. D1 got the account at b through the profile (no password there) and removes it at once: only noted, no record.
    const d1 = device("D1", "new", [{ ...X, at: "b" }, K()], 0, "on");
    await removeOnPurpose(d1, "x");
    await rr([d1], 3);
    expect(docAt(X, "a"), "the password under a is no account D1 has to receive").toContain("val(P1)");
    d1.reports = 0;
    await rr([d1], 3);
    expect(d1.reports, "D1 removed that user at another address: nothing to report").toBe(0);
  });
});

describe("found by the random run of the fourth round", () => {
  it("two passwords one device wrote in one round become one name by a repair: the carried version yields, the fleet settles", async () => {
    remote = null; clock = 0;
    const A: Row = { id: "a", user: "anna", at: "a" };
    const E: Row = { id: "e", user: "anna", at: "b" };
    const d0 = device("D0", "new", [A, E, K()], 0, "on");
    const d1 = device("D1", "new", [A, E, K()], 0, "on");
    // Typed on D0 before one round: both entries carry the same revision, time and device.
    typeInto(d0, "a", "a1"); typeInto(d0, "e", "e2"); typeInto(d0, "k", "K");
    await rr([d0, d1], 3);
    expect([docEntries()[idOf(A)]?.updatedAt, docEntries()[idOf(A)]?.entryRev]).toEqual([docEntries()[idOf(E)]?.updatedAt, docEntries()[idOf(E)]?.entryRev]);
    // D1's profile stops (it keeps e at b); on D0 e is removed and a repaired onto b.
    d1.profile = "off";
    await removeOnPurpose(d0, "e");
    repairAll([d0], "a", "b");
    await rr([d0, d1], 4);
    for (const d of [d0, d1]) d.pushes = 0;
    await rr([d0, d1], 4);
    expect([d0.pushes, d1.pushes], "no device keeps sending its own").toEqual([0, 0]);
    expect(slotOf(d1, "e")).toBe("e2");
    expect(slotOf(d0, "a"), "typed on D0: it keeps its own").toBe("a1");
  });
});
