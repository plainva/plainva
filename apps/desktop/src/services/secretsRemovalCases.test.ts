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

const URLS = { a: "https://cloud.example.com/remote.php/dav", b: "https://dav.example.org/remote.php/dav", c: "https://cal.example.net/remote.php/dav" } as const;
const HOSTS = { a: "imap.example.com", b: "mail.example.org", c: "post.example.net" } as const;
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
  /** Every list comes back empty for a round, though the host calls it whole (a store read that failed quietly). */
  listsEmpty?: boolean;
  /** The calendar list is whole, but the host cannot say so yet (`accountsReady` false). */
  calendarUnsure?: boolean;
  /** The calendar list comes back empty while the host calls it whole (an index rebuilt, its accounts not back yet). */
  calendarGoneReady?: boolean;
  /** The calendar runtime comes up while the list is read: read empty, called whole right after. */
  calendarUpDuringRead?: boolean;
  /** The calendar runtime stops while the list is read: called whole before, read empty, not whole right after (until cleared). */
  calendarDownDuringRead?: boolean;
  calendarStopped?: boolean;
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
  if (d.listsEmpty) return [];
  if (d.calendarDownDuringRead) {
    d.calendarDownDuringRead = false;
    d.calendarStopped = true;
  }
  const calendarsOut = d.calendarHidden || d.calendarGoneReady || d.calendarUpDuringRead || d.calendarStopped;
  d.calendarUpDuringRead = false;
  return d.rows.filter((row) => !(calendarsOut && row.kind !== "mail")).map((row) => {
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
    accountsReady: async (service: string) => service === "mail" || !(d.calendarHidden || d.calendarUnsure || d.calendarUpDuringRead || d.calendarStopped),
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
  it("two passwords one device wrote in one round become one name by a repair onto the name of a removed account: the name begins anew under the repaired account, the fleet settles (eighth review round, S2)", async () => {
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
    // D1 never got the removal (its profile is off) and still lists e at b: b is a's name now, and a's
    // password goes out above all D0 knew there, as on main, which carries nothing.
    expect(slotOf(d1, "e")).toBe("a1");
    expect(slotOf(d0, "a"), "typed on D0: it keeps its own").toBe("a1");
  });
});

describe("the probes of the fourth review round, with the outcome the rules give", () => {
  for (const kind of [undefined, "mail" as const]) {
    for (const after of ["v090", "new"] as const) {
      it(`R4upd ${kind ?? "calendar"} -> ${after}: removed on 0.9.0, the app updated before its next secrets round; the password leaves the document`, async () => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
        const v = device("V", "v090", [X, K(kind)], 0, "on");
        const n = device("N", "new", [X, K(kind)], 0, "on");
        typeInto(v, "x", "P1"); typeInto(v, "k", "K");
        await rr([v, n], 3);
        expect(slotOf(n, "x")).toBe("P1");
        await removeOnPurpose(v, "x");
        await leftByProfile(n, "x");
        v.kind = after;
        await rr([v, n], 6);
        expect(docAt(X, "a").startsWith("val"), "statement 2: the removed account's password leaves the document").toBe(false);
      });
    }

    it(`R4upd counterpart ${kind ?? "calendar"}: an address repaired on 0.9.0, the app updated before its next round; the old address gets the tombstone 0.9.0 wrote, the password stays (rule U3, sixth review round)`, async () => {
      const outcome = async (update: boolean) => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
        const v = device("V", "v090", [X, K(kind)], 0, "on");
        const n = device("N", "new", [X, K(kind)], 0, "on");
        typeInto(v, "x", "P1"); typeInto(v, "k", "K");
        await rr([v, n], 3);
        repairAll([v, n], "x", "b");
        if (update) v.kind = "new";
        await rr([v, n], 6);
        return [docAt(X, "a"), docAt(X, "b"), slotOf(v, "x"), slotOf(n, "x")];
      };
      const stayed = await outcome(false);
      expect(stayed[0]).toMatch(/^TOMB r2 V/);
      expect(await outcome(true), "lists cannot tell a repair from a removal: as 0.9.0 in its next round").toEqual(stayed);
    });

    it(`R4upd counterpart ${kind ?? "calendar"}: a device updated with no record of a removal infers nothing more after its first round`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
      const v = device("V", "v090", [X, K(kind)], 0, "on");
      const n = device("N", "new", [X, K(kind)], 0, "on");
      typeInto(v, "x", "P1"); typeInto(v, "k", "K");
      await rr([v, n], 3);
      v.kind = "new";
      await rr([v, n], 2);
      // Gone from V's list afterwards, not removed (the profile is off on V): no tombstone.
      v.profile = "off";
      v.rows = v.rows.filter((row) => row.id !== "x");
      await rr([v, n], 4);
      expect(docAt(X, "a"), "after its first round, a list says nothing about a removal").toContain("val(P1)");
    });

    it(`R4upd received ${kind ?? "calendar"}: removed on 0.9.0 by a device that only received the password, typed on one that is off since; the password leaves the document`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
      const t = device("T", "new", [X, K(kind)], 0, "on");
      const v = device("V", "v090", [X, K(kind)], 0, "on");
      const n = device("N", "new", [X, K(kind)], 0, "on");
      typeInto(t, "x", "P1"); typeInto(t, "k", "K");
      await rr([t, v, n], 3);
      expect([slotOf(v, "x"), slotOf(n, "x")]).toEqual(["P1", "P1"]);
      await removeOnPurpose(v, "x");
      await leftByProfile(n, "x");
      v.kind = "new";
      await rr([v, n], 6);
      expect(docAt(X, "a").startsWith("val"), "as 0.9.0 would have written in its next round: a tombstone, whoever typed it").toBe(false);
    });
  }

  it("R4upd counterpart while the calendar list is not whole: an address repaired on 0.9.0 gets the tombstone 0.9.0 wrote once the list is whole, the password stays", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    const n = device("N", "new", [X, K("mail")], 0, "on");
    typeInto(v, "x", "P1"); typeInto(v, "k", "K");
    await rr([v, n], 3);
    repairAll([v, n], "x", "b");
    v.kind = "new";
    v.calendarHidden = true;
    await rr([v], 1);
    expect(docAt(X, "a"), "nothing concluded while the list is not whole").toBe("val(P1) r1 V");
    v.calendarHidden = false;
    await rr([v, n], 6);
    expect(docAt(X, "a")).toMatch(/^TOMB r2 V/);
    expect([slotOf(v, "x"), slotOf(n, "x")]).toEqual(["P1", "P1"]);
  });

  for (const variant of ["hidden", "signedOut+hidden", "emptied+hidden"] as const) {
    it(`R4hide ${variant}: a calendar list not whole for a round after a repair onto a tombstoned name keeps the floor; a sign-in there wins`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora@example.test", at: "a" };
      const Z: Row = { id: "z", user: "cora@example.test", at: "b" };
      const n1 = device("N1", "new", [X, Z, K()], 0, "on");
      const n2 = device("N2", "new", [X, Z, K()], 0, "on");
      typeInto(n2, "z", "Z1"); typeInto(n2, "k", "K");
      await rr([n2, n1], 2);
      await removeOnPurpose(n2, "z");
      await leftByProfile(n1, "z");
      await rr([n2, n1], 2);
      for (let i = 1; i <= 5; i++) {
        typeInto(n2, "x", `P${i}`);
        await rr([n2, n1], 1);
      }
      await rr([n2, n1], 2);
      if (variant.startsWith("signedOut")) n1.slots.set("x", { signedOut: true });
      else n1.slots.delete("x");
      // Emptied outside the port, the repair follows before N1's next round (the review's R4hide).
      if (variant !== "emptied+hidden") await rr([n1], 1);
      repairAll([n2, n1], "x", "b");
      await rr([n1], 1);
      n1.calendarHidden = true;
      await rr([n1], 1);
      n1.calendarHidden = false;
      await rr([n2], 1);
      typeInto(n1, "x", "NEW");
      await rr([n1, n2], 6);
      expect(slotOf(n1, "x"), "the password typed last, here, stays").toBe("NEW");
      expect(docAt(X, "b"), "and goes out above all N1 knew under both names").toContain("val(NEW)");
    });
  }

  it("R4hide import: a tombstone read while the calendar list is not whole takes nothing; the received password still follows a change", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const v = device("V", "v090", [X, K()], 0, "on");
    const n1 = device("N1", "new", [X, K()], 0, "on");
    const n2 = device("N2", "new", [X, K()], 0, "on");
    typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
    await rr([n2, n1, v], 3);
    // V repairs its own row a->b (its profile does not bring that further): 0.9.0 writes a tombstone for a.
    v.profile = "off";
    repairAll([v], "x", "b");
    await rr([v], 2);
    expect(docAt(X, "a")).toMatch(/^TOMB/);
    n1.calendarHidden = true;
    await rr([n1], 2);
    n1.calendarHidden = false;
    await rr([n1, n2], 3);
    typeInto(n2, "x", "P2");
    await rr([n2, n1], 4);
    expect(slotOf(n1, "x"), "statement 5: received, it follows the change made elsewhere").toBe("P2");
  });

  it("R4upd while the calendar list is not whole: the first round after the update waits for it, then infers nothing for an account still here", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    const n = device("N", "new", [X, K("mail")], 0, "on");
    typeInto(v, "x", "P1"); typeInto(v, "k", "K");
    await rr([v, n], 3);
    v.kind = "new";
    v.calendarHidden = true;
    await rr([v, n], 2);
    v.calendarHidden = false;
    await rr([v, n], 3);
    expect(docAt(X, "a"), "the calendar account was only left out of a list: no removal").toContain("val(P1)");
    expect(slotOf(n, "x")).toBe("P1");
  });

  it("a repair seen on a list the host cannot vouch for yet is carried at the next whole one: the received password still follows", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const n1 = device("N1", "new", [X, K()], 0, "on");
    const n2 = device("N2", "new", [X, K()], 0, "on");
    typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
    await rr([n2, n1], 3);
    repairAll([n2, n1], "x", "b");
    n1.calendarUnsure = true;
    await rr([n2, n1], 2);
    n1.calendarUnsure = false;
    await rr([n2, n1], 2);
    typeInto(n2, "x", "P2");
    await rr([n2, n1], 4);
    expect(slotOf(n1, "x"), "statement 5: received under a, it follows a change under b").toBe("P2");
  });

  for (const kind of [undefined, "mail" as const]) {
    it(`R4twin ${kind ?? "calendar"}: account A a->c while account B of the same user b->a, then both change; each follows its own`, async () => {
      remote = null; clock = 0;
      const A: Row = { id: "pa", user: "cora@example.test", kind, at: "a" };
      const B: Row = { id: "pb", user: "cora@example.test", kind, at: "b" };
      const n1 = device("N1", "new", [A, B], 0, "on");
      const n2 = device("N2", "new", [A, B], 0, "on");
      typeInto(n2, "pa", "A1"); typeInto(n2, "pb", "B1");
      await rr([n2, n1], 3);
      repairAll([n2, n1], "pa", "c");
      repairAll([n2, n1], "pb", "a");
      await rr([n2, n1], 3);
      typeInto(n2, "pa", "A2"); typeInto(n2, "pb", "B2");
      await rr([n2, n1], 4);
      expect([slotOf(n1, "pa"), slotOf(n1, "pb")], "statement 5 for both").toEqual(["A2", "B2"]);
      for (const d of [n1, n2]) d.pushes = 0;
      await rr([n2, n1], 3);
      expect([n1.pushes, n2.pushes], "the fleet settles").toEqual([0, 0]);
    });
  }

  for (const kind of [undefined, "mail" as const]) {
    for (const repaired of [true, false]) {
      it(`R4edit${repaired ? "" : "Ctl"} ${kind ?? "calendar"}: a device that lagged types NEW${repaired ? " in the save that repairs the address; it keeps NEW there, as on 0.9.0 (rule R)" : "; the higher revision P3 wins everywhere, as on 0.9.0 (M3, open decision)"}`, async () => {
        const outcome = async (fleetKind: "new" | "v090") => {
          remote = null; clock = 0;
          const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
          const n1 = device("N1", fleetKind, [X, K(kind)], 0, "on");
          const d2 = device("D2", fleetKind, [X, K(kind)], 0, "on");
          const n3 = device("N3", fleetKind, [X, K(kind)], 0, "on");
          typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
          await rr([n1, d2, n3], 3);
          typeInto(n1, "x", "P2");
          await rr([n1, n3], 2);
          typeInto(n1, "x", "P3");
          await rr([n1, n3], 2);
          if (repaired) repairAll([d2], "x", "b");
          typeInto(d2, "x", "NEW");
          await rr([d2], 1);
          if (repaired) repairAll([n1, n3], "x", "b");
          await rr([n1, n3, d2], 6);
          return [slotOf(n1, "x"), slotOf(d2, "x"), slotOf(n3, "x")];
        };
        const here = await outcome("new");
        expect(here, repaired ? "typed in the save that repaired it: typed here" : "a value goes out one revision above all this device knew: NEW at r2 yields to P3 at r3").toEqual(repaired ? ["P3", "NEW", "P3"] : ["P3", "P3", "P3"]);
        expect(here, "the outcome of 0.9.0").toEqual(await outcome("v090"));
      });
    }
  }
});

describe("the probes of the fifth review round, with the outcome the rules give", () => {
  // The first round after an update writes what 0.9.0 would have written in its next round, and nothing else (rule U2).
  for (const kind of [undefined, "mail" as const]) {
    for (const publisher of ["V", "T"] as const) {
      for (const after of ["v090", "new"] as const) {
        it(`U1 ${kind ?? "calendar"} typed on ${publisher}, V -> ${after}: two accounts of one user at two servers, one removed on 0.9.0; its password leaves the document`, async () => {
          remote = null; clock = 0;
          const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
          const Y: Row = { id: "y", user: "cora@example.test", kind, at: "b" };
          const v = device("V", "v090", [X, Y, K(kind)], 0, "on");
          const n = device("N", "new", [X, Y, K(kind)], 0, "on");
          const t = device("T", "new", [X, Y, K(kind)], 0, "on");
          typeInto(publisher === "V" ? v : t, "x", "P1"); typeInto(publisher === "V" ? v : t, "y", "Q1"); typeInto(v, "k", "K");
          await rr([v, n, t], 3);
          await removeOnPurpose(v, "x");
          await leftByProfile(n, "x");
          await leftByProfile(t, "x");
          v.kind = after;
          await rr([v, n, t], 6);
          expect(docAt(X, "a"), "statement 2").toMatch(/^TOMB/);
          expect([slotOf(v, "y"), slotOf(n, "y"), slotOf(t, "y")], "the other account of that user keeps its password").toEqual(["Q1", "Q1", "Q1"]);
        });
      }
    }

    it(`U2 ${kind ?? "calendar"}: the user of an account changed on 0.9.0, the app updated before its next round; the old name gets the tombstone 0.9.0 wrote, the password stays`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora", kind, at: "a" };
      const v = device("V", "v090", [X, K(kind)], 0, "on");
      const n = device("N", "new", [X, K(kind)], 0, "on");
      typeInto(v, "x", "P1"); typeInto(v, "k", "K");
      await rr([v, n], 3);
      for (const d of [v, n]) d.rows.find((row) => row.id === "x")!.user = "cora@example.test";
      v.kind = "new";
      await rr([v, n], 6);
      expect(show(docEntries()[idOf({ ...X, user: "cora" })])).toMatch(/^TOMB/);
      expect(show(docEntries()[idOf({ ...X, user: "cora@example.test" })])).toContain("val(P1)");
      expect([slotOf(v, "x"), slotOf(n, "x")]).toEqual(["P1", "P1"]);
      expect(v.meta?.removedIds, "a conclusion from lists is no removal of this device's").toBeUndefined();
    });
  }

  for (const start of ["v090", "new"] as const) {
    it(`U3 from ${start}: the calendar list not whole for rounds after the update; the mailboxes are compared once, a user changed meanwhile is a repair`, async () => {
      remote = null; clock = 0;
      const C: Row = { id: "c", user: "cora", at: "a" };
      const X: Row = { id: "x", user: "carl", kind: "mail", at: "a" };
      const v = device("V", start, [C, X, K("mail")], 0, "on");
      const n = device("N", "new", [C, X, K("mail")], 0, "on");
      typeInto(v, "c", "C1"); typeInto(v, "x", "P1"); typeInto(v, "k", "K");
      await rr([v, n], 3);
      v.kind = "new";
      v.calendarHidden = true;
      await rr([v, n], 2);
      for (const d of [v, n]) d.rows.find((row) => row.id === "x")!.user = "carl@example.test";
      await rr([v, n], 3);
      v.calendarHidden = false;
      await rr([v, n], 4);
      expect(show(docEntries()[idOf({ ...X, user: "carl" })]), "no comparison of lists after the first one of its kind").toContain("val(P1)");
      expect(show(docEntries()[idOf({ ...X, user: "carl@example.test" })])).toContain("val(P1)");
      expect(v.meta?.notesRemovals).toBe(true);
    });
  }

  it("U3c: a calendar list that is never whole after the update: the device settles, the calendar is never compared, nothing grows", async () => {
    remote = null; clock = 0;
    const C: Row = { id: "c", user: "cora", at: "a" };
    const X: Row = { id: "x", user: "carl", kind: "mail", at: "a" };
    const v = device("V", "v090", [C, X, K("mail")], 0, "on");
    const n = device("N", "new", [C, X, K("mail")], 0, "on");
    typeInto(v, "c", "C1"); typeInto(v, "x", "P1"); typeInto(v, "k", "K");
    await rr([v, n], 3);
    v.kind = "new";
    v.calendarHidden = true;
    await rr([v, n], 10);
    const pushes = [v.pushes, n.pushes];
    await rr([v, n], 10);
    expect([v.pushes, n.pushes], "settled").toEqual(pushes);
    expect([docAt(C, "a"), v.meta?.notesRemovals, v.meta?.comparedKinds]).toEqual(["val(C1) r1 V", undefined, ["mail"]]);
  });

  for (const start of ["v090", "new", "v090stay"] as const) {
    it(`U4b from ${start}: a calendar list read empty while the host calls it whole, in the first round after the update; the device still follows a password changed elsewhere`, async () => {
      remote = null; clock = 0;
      const C: Row = { id: "c", user: "cora", at: "a" };
      const v = device("V", start === "v090stay" ? "v090" : start, [C, K("mail")], 0, "on");
      const n = device("N", "new", [C, K("mail")], 0, "on");
      typeInto(n, "c", "C1"); typeInto(v, "k", "K");
      await rr([n, v], 3);
      if (start === "v090") v.kind = "new";
      v.calendarGoneReady = true;
      await rr([v], 1);
      v.calendarGoneReady = false;
      await rr([n, v], 4);
      expect(slotOf(v, "c")).toBe("C1");
      typeInto(n, "c", "C2");
      await rr([n, v], 4);
      expect([slotOf(n, "c"), slotOf(v, "c")], "received: it follows, as on 0.9.0").toEqual(["C2", "C2"]);
    });
  }

  it("U4b order: the calendar runtime comes up while the first round after the update reads the list; nothing is concluded from the empty read", async () => {
    remote = null; clock = 0;
    const C: Row = { id: "c", user: "cora", at: "a" };
    const v = device("V", "v090", [C, K("mail")], 0, "on");
    const n = device("N", "new", [C, K("mail")], 0, "on");
    typeInto(n, "c", "C1"); typeInto(v, "k", "K");
    await rr([n, v], 3);
    v.kind = "new";
    v.calendarUpDuringRead = true;
    await rr([v], 1);
    expect(docAt(C, "a"), "the list was read before the host could call it whole").toBe("val(C1) r1 N");
    await rr([n, v], 3);
    typeInto(n, "c", "C2");
    await rr([n, v], 4);
    expect([docAt(C, "a"), slotOf(v, "c")]).toEqual(["val(C2) r2 N", "C2"]);
  });

  it("U4b order, the other way: the calendar runtime stops while the first round after the update reads the list; nothing is concluded from the empty read", async () => {
    remote = null; clock = 0;
    const C: Row = { id: "c", user: "cora", at: "a" };
    const v = device("V", "v090", [C, K("mail")], 0, "on");
    const n = device("N", "new", [C, K("mail")], 0, "on");
    typeInto(n, "c", "C1"); typeInto(v, "k", "K");
    await rr([n, v], 3);
    v.kind = "new";
    v.calendarDownDuringRead = true;
    await rr([v], 1);
    expect(docAt(C, "a"), "the host called the list whole before the read only").toBe("val(C1) r1 N");
    v.calendarStopped = false;
    await rr([n, v], 3);
    typeInto(n, "c", "C2");
    await rr([n, v], 4);
    expect([docAt(C, "a"), slotOf(v, "c")]).toEqual(["val(C2) r2 N", "C2"]);
  });

  for (const between of [false, true]) {
    it(`U5 back to 0.9.0 and forward again${between ? ", a round on 0.9.0 between" : " with no round between (named limit)"}: a mailbox removed on 0.9.0`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
      const v = device("V", "new", [X, K("mail")], 0, "on");
      const n = device("N", "new", [X, K("mail")], 0, "on");
      typeInto(v, "x", "P1"); typeInto(v, "k", "K");
      await rr([v, n], 3);
      v.kind = "v090";
      await removeOnPurpose(v, "x");
      await leftByProfile(n, "x");
      if (between) await rr([v], 1);
      v.kind = "new";
      await rr([v, n], 6);
      // With no round on 0.9.0 the record keeps the mark of this version: nothing tells the removal there from a list (limit, Secrets_Removal_Rules.md).
      expect(docAt(X, "a").startsWith("TOMB")).toBe(between);
    });
  }

  for (const hidden of [false, true]) {
    it(`L1: the key of the marks lost${hidden ? " while the calendar list is not whole" : ""}; a password changed elsewhere afterwards reaches every device`, async () => {
      remote = null; clock = 0;
      const X: Row = { id: "x", user: "cora", at: "a" };
      const n1 = device("N1", "new", [X, K("mail")], 0, "on");
      const n2 = device("N2", "new", [X, K("mail")], 0, "on");
      typeInto(n2, "x", "P1"); typeInto(n2, "k", "K");
      await rr([n2, n1], 3);
      n1.keyring.delete(SECRETS_MARK_KEY_SLOT);
      n1.calendarHidden = hidden;
      await rr([n1], 1);
      n1.calendarHidden = false;
      typeInto(n2, "x", "P2");
      await rr([n2], 1);
      await rr([n1], 1);
      await rr([n2, n1], 4);
      expect([docAt(X, "a"), slotOf(n1, "x"), slotOf(n2, "x")]).toEqual(["val(P2) r2 N2", "P2", "P2"]);
    });
  }
});

describe("one case for each rule of the first round after an update a mutation survived (fifth review round)", () => {
  it("a calendar account the profile took away on 0.9.0 while the list is not whole at the update: compared once it is whole", async () => {
    remote = null; clock = 0;
    const C: Row = { id: "c", user: "cora", at: "a" };
    const t = device("T", "new", [C, K("mail")], 0, "on");
    const v = device("V", "v090", [C, K("mail")], 0, "on");
    const n = device("N", "new", [C, K("mail")], 0, "on");
    typeInto(t, "c", "C1"); typeInto(t, "k", "K");
    await rr([t, v, n], 3);
    // T removes it and is not seen again; the profile takes it from V (on 0.9.0) and N.
    await removeOnPurpose(t, "c");
    await leftByProfile(v, "c");
    await leftByProfile(n, "c");
    v.kind = "new";
    v.calendarHidden = true;
    await rr([v, n], 2);
    expect(docAt(C, "a"), "the calendar list may not be whole: nothing yet").toContain("val(C1)");
    v.calendarHidden = false;
    await rr([v, n], 3);
    expect(docAt(C, "a"), "what 0.9.0 would have written").toMatch(/^TOMB .* V$/);
  });

  it("an account listed with no password (signed out on 0.9.0) is no removal", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    const n = device("N", "new", [X, K("mail")], 0, "on");
    typeInto(n, "x", "P1"); typeInto(n, "k", "K");
    await rr([n, v], 3);
    v.slots.set("x", { signedOut: true });
    await rr([v], 1);
    v.kind = "new";
    await rr([v, n], 4);
    expect([docAt(X, "a"), slotOf(n, "x"), slotOf(v, "x")]).toEqual(["val(P1) r1 N", "P1", "SIGNED-OUT"]);
  });

  it("an account the profile takes away in the first round after the update is the profile's, not a conclusion from lists: no tombstone by this device", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
    const t = device("T", "new", [X, K("mail")], 0, "on");
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    typeInto(t, "x", "P1"); typeInto(t, "k", "K");
    await rr([t, v], 3);
    v.kind = "new";
    await leftByProfile(v, "x");
    await rr([v], 3);
    expect(docAt(X, "a"), "the remover writes it; the profile here writes none").toBe("val(P1) r1 T");
  });

  it("a tombstone known on 0.9.0 goes out again as it is: the first round after the update writes none above it", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
    const t = device("T", "new", [X, K("mail")], 0, "on");
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    typeInto(t, "x", "P1"); typeInto(t, "k", "K");
    await rr([t, v], 3);
    await removeOnPurpose(t, "x");
    await rr([t], 1);
    expect(docAt(X, "a")).toBe("TOMB r2 T");
    await leftByProfile(v, "x");
    await rr([v], 2);
    v.kind = "new";
    await rr([v, t], 3);
    expect(docAt(X, "a")).toMatch(/^TOMB r2 /);
  });
});

describe("one case for each rule a mutation of the port survived (fourth review round)", () => {
  it("the first round after an update waits while every list comes back empty though accounts were known; nothing is inferred for an account still here", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
    const v = device("V", "v090", [X, K("mail")], 0, "on");
    const n = device("N", "new", [X, K("mail")], 0, "on");
    typeInto(v, "x", "P1"); typeInto(v, "k", "K");
    await rr([v, n], 3);
    v.kind = "new";
    v.listsEmpty = true;
    await rr([v, n], 2);
    v.listsEmpty = false;
    await rr([v, n], 3);
    expect([docAt(X, "a"), slotOf(n, "x")], "no tombstone for accounts only missing from an empty list").toEqual(["val(P1) r1 V", "P1"]);
  });

  it("a removal the profile notes after \"Remove account\" noted it stays an act: the tombstone goes over a password this device only received", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    const d2 = device("D2", "new", [X, K()], 0, "on");
    typeInto(d2, "x", "P1"); typeInto(d2, "k", "K");
    await rr([d2, d1], 3);
    d2.profile = "off";
    // A profile import that read the row before D1 took it notes the same account as left with the profile, after the act.
    await retireSecret(retiredHost(d1), newBinding(X), async () => removedByProfile(d1, "x"), nowOf(d1)());
    await noteSecretLeftWithProfile(retiredHost(d1), newBinding(X));
    await secretsRound(d1);
    expect(docAt(X, "a"), "\"Remove account\" writes its tombstone, whatever the profile noted after it").toMatch(/^TOMB .* D1$/);
  });

  it("a removal of the only device that had the account is confirmed by its own next import; an account added again elsewhere later keeps its password", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const d1 = device("D1", "new", [X, K()], 0, "on");
    typeInto(d1, "x", "P1"); typeInto(d1, "k", "K");
    await rr([d1], 3);
    await removeOnPurpose(d1, "x");
    await rr([d1], 3);
    // Added again on a new device with a new password, above the tombstone.
    const n = device("N", "new", [X, K()], 0, "on");
    typeInto(n, "x", "P2");
    remote = { ...remote!, entries: Object.fromEntries(Object.entries(remote!.entries).filter(([id]) => id !== idOf(K()))) };
    await rr([n, d1], 4);
    expect([docAt(X, "a").startsWith("val(P2)"), slotOf(n, "x")], "a confirmed removal yields to what came after it").toEqual([true, "P2"]);
  });

  it("the tombstone of \"Remove account\" stands above the floor a repair left under the name", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", at: "a" };
    const Z: Row = { id: "z", user: "cora@example.test", at: "b" };
    const n1 = device("N1", "new", [X, Z, K()], 0, "on");
    const n2 = device("N2", "new", [X, Z, K()], 0, "on");
    typeInto(n2, "z", "Z1"); typeInto(n2, "k", "K");
    await rr([n2, n1], 2);
    await removeOnPurpose(n2, "z");
    await leftByProfile(n1, "z");
    await rr([n2, n1], 2);
    for (let i = 1; i <= 5; i++) {
      typeInto(n2, "x", `P${i}`);
      await rr([n2, n1], 1);
    }
    n2.profile = "off";
    // On N1: the account moves onto b (a tombstone of revision 2 there), its slot emptied, then removed at once.
    n1.slots.delete("x");
    repairAll([n1], "x", "b");
    await secretsRound(n1);
    await removeOnPurpose(n1, "x");
    await secretsRound(n1);
    expect(docAt(X, "b"), "above revision 5, known under a").toMatch(/^TOMB r6 N1/);
  });
});

describe("the probes of the sixth review round, with the outcome the rules give", () => {
  const addRow = (d: Device, row: Row) => {
    if (!d.rows.some((item) => item.id === row.id)) d.rows.push({ ...row });
  };

  for (const kind of [undefined, "mail" as const]) {
    for (const publisher of ["V", "T"] as const) {
      for (const yPass of ["typedOnV", "none", "typedOnT"] as const) {
        it(`S1b ${kind ?? "calendar"} typed on ${publisher}, the new account ${yPass}: removed on 0.9.0 and connected anew at another server, the app updated before its next round; as 0.9.0 in its next round (rule U3)`, async () => {
          const outcome = async (update: boolean) => {
            remote = null; clock = 0;
            const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
            const Y: Row = { id: "y", user: "cora@example.test", kind, at: "b" };
            const v = device("V", "v090", [X, K(kind)], 0, "on");
            const n = device("N", "new", [X, K(kind)], 0, "on");
            const t = device("T", "new", [X, K(kind)], 0, "on");
            typeInto(publisher === "V" ? v : t, "x", "P1"); typeInto(v, "k", "K");
            await rr([v, n, t], 3);
            await removeOnPurpose(v, "x");
            addRow(v, Y);
            if (yPass === "typedOnV") typeInto(v, "y", "Q1");
            await leftByProfile(n, "x"); await leftByProfile(t, "x");
            addRow(n, Y); addRow(t, Y);
            if (yPass === "typedOnT") typeInto(t, "y", "Q1");
            if (update) v.kind = "new";
            await rr([v, n, t], 8);
            return [docAt(X, "a"), docAt(Y, "b"), ...[v, n, t].map((d) => slotOf(d, "y"))];
          };
          const stayed = await outcome(false);
          expect(stayed[0]).toMatch(/^TOMB r2/);
          expect(await outcome(true)).toEqual(stayed);
        });
      }
    }

    for (const window of ["tombstone read", "a round more"] as const) {
      it(`Rtomb ${kind ?? "calendar"}, ${window}: a device on 0.9.0 repaired the address first, the tombstone of the old name read here; the repair and NEW in one save here keep NEW, as on main (rule R)`, async () => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
        const n1 = device("N1", "v090", [X, K(kind)], 0, "off");
        const d2 = device("D2", "new", [X, K(kind)], 0, "off");
        typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
        await rr([n1, d2], 3);
        repairAll([n1], "x", "b");
        await rr([n1], 1);
        for (const pass of ["P2", "P3", "P4"]) {
          typeInto(n1, "x", pass);
          await rr([n1], 1);
        }
        await rr([d2], window === "a round more" ? 2 : 1);
        const recA = d2.meta?.entries[idOf(X)];
        if (window === "tombstone read") expect(recA?.tombstone).toBe(true);
        repairAll([d2], "x", "b");
        typeInto(d2, "x", "NEW");
        await rr([n1, d2], 6);
        expect(slotOf(d2, "x"), "typed here, as main keeps it").toBe("NEW");
      });
    }

    for (const typed of [true, false]) {
      it(`Rloss ${kind ?? "calendar"}, ${typed ? "NEW typed" : "nothing typed"} in the save that repairs: the key of the marks lost, the device offline; ${typed ? "it keeps NEW, as on main" : "the document moved on under the old name, nothing proves it received: kept, as on main"} (rule R, eighth review round)`, async () => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
        const n1 = device("N1", "new", [X, K(kind)], 0, "off");
        const d2 = device("D2", "new", [X, K(kind)], 0, "off");
        const n3 = device("N3", "new", [X, K(kind)], 0, "off");
        typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
        await rr([n1, d2, n3], 3);
        d2.keyring.delete(SECRETS_MARK_KEY_SLOT);
        await portOf(d2).exportBundle();
        typeInto(n1, "x", "P2");
        await rr([n1, n3], 2);
        typeInto(n1, "x", "P3");
        await rr([n1, n3], 2);
        repairAll([d2], "x", "b");
        if (typed) typeInto(d2, "x", "NEW");
        await portOf(d2).exportBundle();
        repairAll([n1, n3], "x", "b");
        await rr([n1, n3, d2], 6);
        // The slot as it was when the loss was found is no proof; the document carries P3 under both names.
        expect(slotOf(d2, "x")).toBe(typed ? "NEW" : "P1");
      });
    }
  }

  for (const notWholeRounds of [0, 1, 3]) {
    for (const typedAtRepair of [false, true]) {
      it(`FlakyRepair ${notWholeRounds} round(s) listed but not whole, ${typedAtRepair ? "A2 typed" : "nothing typed"} in the repair the profile brings: the device follows the last password (rule L3)`, async () => {
        remote = null; clock = 0;
        const A: Row = { id: "a", user: "anna", at: "a" };
        const n = device("N", "new", [A, K("mail")], 0, "off");
        const d = device("D", "new", [A, K("mail")], 0, "off");
        typeInto(n, "a", "A1"); typeInto(n, "k", "K");
        await rr([n, d], 3);
        repairAll([n, d], "a", "b");
        if (typedAtRepair) typeInto(n, "a", "A2");
        await rr([n], 1);
        d.calendarUnsure = notWholeRounds > 0;
        for (let i = 0; i < notWholeRounds; i++) await rr([d, n], 1);
        d.calendarUnsure = false;
        await rr([n, d], 4);
        expect(slotOf(d, "a"), "received: it follows").toBe(typedAtRepair ? "A2" : "A1");
        typeInto(n, "a", "A3");
        await rr([n, d], 4);
        expect(slotOf(d, "a")).toBe("A3");
      });
    }
  }

  it("U2flaky: an address repaired on the updated device while its calendar list is listed but not whole in the first round after the update; as on 0.9.0", async () => {
    const outcome = async (mode: "notWhole" | "whole" | "v090") => {
      remote = null; clock = 0;
      const C: Row = { id: "c", user: "cora", at: "a" };
      const v = device("V", "v090", [C, K("mail")], 0, "off");
      const n = device("N", "new", [C, K("mail")], 0, "off");
      typeInto(n, "c", "C1"); typeInto(v, "k", "K");
      await rr([n, v], 3);
      if (mode !== "v090") v.kind = "new";
      repairAll([v], "c", "b");
      v.calendarUnsure = mode === "notWhole";
      await rr([v], 1);
      v.calendarUnsure = false;
      await rr([n, v], 8);
      return [docAt(C, "a"), docAt(C, "b"), slotOf(n, "c"), slotOf(v, "c")];
    };
    const stayed = await outcome("v090");
    expect(await outcome("notWhole")).toEqual(stayed);
    expect(await outcome("whole")).toEqual(stayed);
  });
});

describe("the first round after an update against the next round of 0.9.0, over random pending states (sixth review round, rule U3)", () => {
  it("the document after the first round of this version is the one 0.9.0 writes in its next round: removed, repaired, connected anew, one to three accounts of one user, typed anywhere", async () => {
    const servers: At[] = ["a", "b", "c"];
    const differ: string[] = [];
    let states = 0;
    for (let seed = 1; seed <= 160; seed++) {
      let r = (seed * 2654435761) % 2 ** 31;
      const pick = (n: number) => {
        r = (r * 1103515245 + 12345) % 2 ** 31;
        return Math.floor((r / 2 ** 31) * n);
      };
      remote = null; clock = 0;
      const kind = pick(2) ? ("mail" as const) : undefined;
      const count = 1 + pick(3);
      const rows: Row[] = servers.slice(0, count).map((at, i) => ({ id: `x${i}`, user: "cora@example.test", kind, at }));
      const v = device("V", "v090", [...rows, K(kind)], 0, "off");
      const n = device("N", "new", [...rows, K(kind)], 0, "off");
      typeInto(v, "k", "K");
      for (const row of rows) {
        const who = pick(3);
        if (who === 0) typeInto(v, row.id, `P${row.id}`);
        else if (who === 1) typeInto(n, row.id, `P${row.id}`);
      }
      await rr([v, n], 3);
      // Pending on V, no round between: each account kept, removed, repaired, or removed and connected anew at a free server.
      const free = servers.slice(count);
      const acts: string[] = [];
      for (const row of rows) {
        const act = pick(free.length > 0 ? 4 : 2);
        if (act === 1) await removeOnPurpose(v, row.id);
        if (act === 2) v.rows.find((item) => item.id === row.id)!.at = free.shift();
        if (act === 3) {
          await removeOnPurpose(v, row.id);
          const fresh: Row = { id: `y${row.id}`, user: row.user, kind, at: free.shift() };
          v.rows.push(fresh);
          if (pick(2)) typeInto(v, fresh.id, `Q${row.id}`);
        }
        acts.push(["keep", "remove", "repair", "anew"][act]!);
      }
      const at = { remote: structuredClone(remote), clock, v: structuredClone(v) };
      const documentAfter = async (update: boolean) => {
        remote = structuredClone(at.remote); clock = at.clock;
        const d: Device = structuredClone(at.v);
        if (update) d.kind = "new";
        await round(d);
        return Object.fromEntries(Object.entries(docEntries()).map(([id, entry]) => [id, show(entry)]));
      };
      const stayed = await documentAfter(false);
      const updated = await documentAfter(true);
      states++;
      const rowsApart = [...new Set([...Object.keys(stayed), ...Object.keys(updated)])].filter((id) => stayed[id] !== updated[id]);
      if (rowsApart.length > 0) differ.push(`seed ${seed} ${kind ?? "calendar"} ${acts.join(",")}: ${rowsApart.map((id) => `${id.split("@")[1]}: ${stayed[id] ?? "none"} / ${updated[id] ?? "none"}`).join("; ")}`);
    }
    expect(states).toBe(160);
    expect(differ, "no slot note of this version can prove a repair on a record of 0.9.0: no row departs").toEqual([]);
  });
});

describe("the probes of the seventh review round, with the outcome the rules give", () => {
  for (const kind of [undefined, "mail" as const]) {
    for (const peer of ["new", "v090"] as const) {
      for (const typed of [true, false]) {
        for (const later of ["P2P3", "P2", "none"] as const) {
          it(`RlossGap ${kind ?? "calendar"}, the repairer ${peer}, ${typed ? "NEW typed" : "nothing typed"}, later ${later}: the key of the marks lost and the address repaired before the next round (rule R: received needs proof)`, async () => {
            remote = null; clock = 0;
            const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
            const n1 = device("N1", peer, [X, K(kind)], 0, "off");
            const d2 = device("D2", "new", [X, K(kind)], 0, "off");
            const n3 = device("N3", "new", [X, K(kind)], 0, "off");
            typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
            await rr([n1, d2, n3], 3);
            repairAll([n1, n3], "x", "b");
            await rr([n1, n3], 1);
            if (later !== "none") { typeInto(n1, "x", "P2"); await rr([n1, n3], 2); }
            if (later === "P2P3") { typeInto(n1, "x", "P3"); await rr([n1, n3], 2); }
            d2.keyring.delete(SECRETS_MARK_KEY_SLOT);
            repairAll([d2], "x", "b");
            if (typed) typeInto(d2, "x", "NEW");
            await rr([n1, n3, d2], 8);
            const last = later === "P2P3" ? "P3" : later === "P2" ? "P2" : "P1";
            // A repairer on 0.9.0 left the tombstone of an absence under the old name: the document no longer
            // carries the value there, so nothing proves it received — kept as typed, as main keeps it (named limit).
            const proven = peer === "new";
            expect(slotOf(d2, "x"), typed ? "typed here: kept, as on main" : proven ? "received, proven by the document: it follows" : "no proof left: as on main").toBe(typed ? "NEW" : proven ? last : "P1");
            expect(d2.meta?.entries[idOf(X)]?.held, "the record under the old name is not held for good").toBeUndefined();
          });
        }
      }
    }

    for (const peer of ["new", "v090"] as const) {
      for (const window of ["the tombstone read first", "the repair first"] as const) {
        for (const extra of [0, 1]) {
          it(`StaleAbove ${kind ?? "calendar"}, the repairer ${peer}, ${window}, ${extra} more typed: a password only received never goes out above a newer one (M1)`, async () => {
            remote = null; clock = 0;
            const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
            const n1 = device("N1", peer, [X, K(kind)], 0, "off");
            const d2 = device("D2", "new", [X, K(kind)], 0, "off");
            const n3 = device("N3", "new", [X, K(kind)], 0, "off");
            typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
            await rr([n1, d2, n3], 3);
            repairAll([n1], "x", "b");
            typeInto(n1, "x", "P2");
            await rr([n1], 1);
            let last = "P2";
            for (let i = 0; i < extra; i++) { last = `P2x${i}`; typeInto(n1, "x", last); await rr([n1], 1); }
            if (window === "the tombstone read first") await rr([d2, n3], 1);
            repairAll([d2, n3], "x", "b");
            await rr([n1, d2, n3], 8);
            expect([slotOf(n1, "x"), slotOf(d2, "x"), slotOf(n3, "x"), docAt(X, "b").split(" ")[0]]).toEqual([last, last, last, `val(${last})`]);
          });
        }
      }
    }
  }

  for (const notWholeRounds of [1, 3]) {
    it(`LateCarry, ${notWholeRounds} round(s) listed but not whole: a carry that waits takes nothing the import found under the new name meanwhile (S2)`, async () => {
      remote = null; clock = 0;
      const C: Row = { id: "c", user: "cora@example.test", at: "a" };
      const n = device("N", "new", [C, K("mail")], 0, "off");
      const d = device("D", "new", [C, K("mail")], 0, "off");
      typeInto(n, "k", "K");
      await rr([n, d], 3);
      d.calendarUnsure = true;
      repairAll([n, d], "c", "b");
      typeInto(n, "c", "B1");
      await rr([n], 1);
      for (let i = 0; i < notWholeRounds; i++) await rr([d, n], 1);
      expect(slotOf(d, "c")).toBe("B1");
      d.calendarUnsure = false;
      await rr([n, d], 4);
      typeInto(n, "c", "LAST");
      await rr([n, d], 4);
      expect(slotOf(d, "c"), "received under the new name: it follows").toBe("LAST");
    });
  }

  it("H2: removed and added again with the same address before a round, the slot empty: it stays empty, as on 0.9.0; a newer password from elsewhere reaches it", async () => {
    remote = null; clock = 0;
    const X: Row = { id: "x", user: "cora@example.test", kind: "mail", at: "a" };
    const d = device("D", "new", [X, K("mail")], 0, "off");
    const n = device("N", "new", [X, K("mail")], 0, "off");
    typeInto(n, "x", "P1"); typeInto(n, "k", "K");
    await rr([n, d], 3);
    expect(slotOf(d, "x")).toBe("P1");
    await removeOnPurpose(d, "x");
    d.rows.push({ ...X });
    // The profile brings both to N: the removal, and the account added again.
    await leftByProfile(n, "x");
    n.rows.push({ ...X });
    await rr([d, n], 4);
    expect([slotOf(d, "x"), slotOf(n, "x")], "no removed account gets its password back").toEqual(["empty", "empty"]);
    typeInto(n, "x", "P2");
    await rr([n, d], 4);
    expect(slotOf(d, "x")).toBe("P2");
  });
});

describe("a name with a removal open begins anew; the slot is the identity (eighth review round, S2 and S3)", () => {
  type After = "added again, empty" | "added again, typed" | "another repaired onto it, typed" | "another repaired onto it, received";
  type When = "the same gap" | "the next round not whole" | "over the update from 0.9.0";
  const AFTERS: After[] = ["added again, empty", "added again, typed", "another repaired onto it, typed", "another repaired onto it, received"];
  const WHENS: When[] = ["the same gap", "the next round not whole", "over the update from 0.9.0"];
  for (const kind of [undefined, "mail" as const]) {
    for (const after of AFTERS) {
      for (const when of WHENS) {
        if (when === "the next round not whole" && kind === "mail") continue;
        it(`${kind ?? "calendar"}: X removed on D, then ${after}, ${when}: the removed account's password reaches no slot; every device ends as the rule says, never worse than main`, async () => {
          const outcome = async (onMain: boolean) => {
            remote = null; clock = 0;
            const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
            const Y: Row = { id: "y", user: "cora@example.test", kind, at: "c" };
            const branch = (start: Kind) => (onMain ? "v090" : start);
            const d = device("D", when === "over the update from 0.9.0" ? "v090" : branch("new"), [X, Y, K(kind)], 0, "off");
            const o = device("O", branch("new"), [X, Y, K(kind)], 0, "off");
            const t = device("T", branch("new"), [X, Y, K(kind)], 0, "off");
            typeInto(o, "x", "P1"); typeInto(o, "k", "K");
            if (after === "another repaired onto it, received") typeInto(o, "y", "Q");
            await rr([o, d, t], 3);
            // On D, before its next round: X removed, and then the act.
            await removeOnPurpose(d, "x");
            const slot = after.startsWith("added again") ? "x2" : "y";
            if (after.startsWith("added again")) d.rows.push({ id: "x2", user: X.user, kind, at: "a" });
            else d.rows.find((row) => row.id === "y")!.at = "a";
            if (after === "added again, typed" || after === "another repaired onto it, typed") typeInto(d, slot, "Q");
            // The profile brings both to O and T.
            for (const other of [o, t]) {
              await leftByProfile(other, "x");
              if (after.startsWith("added again")) other.rows.push({ id: "x2", user: X.user, kind, at: "a" });
              else other.rows.find((row) => row.id === "y")!.at = "a";
            }
            if (when === "over the update from 0.9.0" && !onMain) d.kind = "new";
            if (when === "the next round not whole") d.calendarUnsure = true;
            await rr([d], 1);
            d.calendarUnsure = false;
            await rr([d, o, t], 8);
            return [d, o, t].map((dev) => slotOf(dev, slot));
          };
          const expected = after === "added again, empty" ? ["empty", "empty", "empty"] : ["Q", "Q", "Q"];
          const here = await outcome(false);
          const onMainEnds = await outcome(true);
          expect(here, `main ends with ${onMainEnds.join("/")}`).toEqual(expected);
          expect(here.includes("P1"), "no removed account's password comes back").toBe(false);
        });
      }
    }
  }
});

describe("the probes of the eighth review round, with the outcome the rules give", () => {
  for (const kind of [undefined, "mail" as const]) {
    for (const repairer of ["N1", "D2"] as const) {
      for (const laterTyped of [false, true]) {
        it(`HeldThenRepair ${kind ?? "calendar"}, repaired on ${repairer}${laterTyped ? ", P2 typed later on N1" : ""}: a password typed after a lost key and held as a conflict stays when the address is repaired later (S1)`, async () => {
          remote = null; clock = 0;
          const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
          const n1 = device("N1", "new", [X, K(kind)], 0, "off");
          const d2 = device("D2", "new", [X, K(kind)], 0, "off");
          typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
          await rr([n1, d2], 3);
          d2.keyring.delete(SECRETS_MARK_KEY_SLOT);
          typeInto(d2, "x", "NEW");
          await rr([d2], 1);
          expect(d2.meta?.entries[idOf(X)]?.held, "held as a conflict").toBeDefined();
          repairAll([n1, d2], "x", "b");
          await rr([repairer === "N1" ? n1 : d2, repairer === "N1" ? d2 : n1], 4);
          if (laterTyped) {
            typeInto(n1, "x", "P2");
            await rr([n1, d2], 4);
          }
          expect(slotOf(d2, "x"), "typed here: never replaced from elsewhere").toBe("NEW");
        });
      }
    }

    for (const typed of [false, true]) {
      it(`M1loss ${kind ?? "calendar"}, ${typed ? "NEW typed" : "nothing typed"}: the key lost in the gap, the repair from a device on 0.9.0 with P2 typed there; the waiting export sends nothing, the slot goes out once the import decided`, async () => {
        remote = null; clock = 0;
        const X: Row = { id: "x", user: "cora@example.test", kind, at: "a" };
        const n1 = device("N1", "v090", [X, K(kind)], 0, "off");
        const d2 = device("D2", "new", [X, K(kind)], 0, "off");
        const n3 = device("N3", "new", [X, K(kind)], 0, "off");
        typeInto(n1, "x", "P1"); typeInto(n1, "k", "K");
        await rr([n1, d2, n3], 3);
        repairAll([n1], "x", "b");
        typeInto(n1, "x", "P2");
        await rr([n1], 1);
        repairAll([n3], "x", "b");
        await rr([n3], 2);
        d2.keyring.delete(SECRETS_MARK_KEY_SLOT);
        repairAll([d2], "x", "b");
        if (typed) typeInto(d2, "x", "NEW");
        const waiting = await portOf(d2).exportBundle();
        expect(waiting.entries[idOf({ ...X, at: "b" })], "the waiting export sends nothing for the slot").toBeUndefined();
        await rr([d2, n1, n3], 8);
        if (typed) {
          // Typed: above all D2 knew, so it reaches every device that only received; N1 typed P2 itself and keeps it.
          expect([slotOf(n1, "x"), slotOf(d2, "x"), slotOf(n3, "x")]).toEqual(["P2", "NEW", "NEW"]);
        } else {
          // No proof (the document under the old name holds the tombstone of 0.9.0, under the new one P2):
          // kept as typed, and it goes out as D2's own — as on main (named limit 5).
          expect(slotOf(d2, "x")).toBe("P1");
        }
      });
    }
  }
});
