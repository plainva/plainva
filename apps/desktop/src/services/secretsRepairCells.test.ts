import { describe, expect, it } from "vitest";
import { canonicalSecretId, mergeSecretsBundles, stableStringify, type SecretBinding, type SecretEntry, type SecretsBundle } from "@plainva/core";
import {
  SECRETS_MARK_KEY_SLOT,
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  retireSecret,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import * as v090 from "../../../../packages/core/test/fixtures/secretsV090";

/**
 * "A repair changes the name, not the history", cell by cell — the table of
 * that name in `docs/engineering/Secrets_Removal_Rules.md` (review 2026-11-26,
 * fourth round). One device runs the real port against a document built here;
 * its account X is repaired from address a to address b. Before the repair,
 * the device's record under a is in one of six states, its record under b in
 * one of six; every pair is a case, for a calendar account and a mailbox.
 *
 * In each case three things are checked, by what the device does, never by
 * reading its record:
 *  - received or typed: a newer password another device puts under b reaches
 *    the slot exactly when its password had come in through the sync;
 *  - the version: what the first export after the repair publishes under b
 *    for the unchanged password (its old version, the one the record under b
 *    holds, or a change above everything known);
 *  - the floor: a password typed after the repair goes out above every
 *    revision the device knew under either name.
 *
 * All data invented.
 */

const URLS = { a: "https://cloud.example.com/remote.php/dav", b: "https://dav.example.org/remote.php/dav", c: "https://cal.example.net/remote.php/dav" } as const;
const HOSTS = { a: "imap.example.com", b: "mail.example.org", c: "post.example.net" } as const;
type At = keyof typeof URLS;
type Kind = "calendar" | "mail";
interface Row {
  id: string;
  user: string;
  at: At;
}
interface Device {
  kind: Kind;
  rows: Row[];
  slots: Map<string, string>;
  keyring: Map<string, unknown>;
  meta: SecretsPortMeta | null;
  /** The host cannot vouch for the list of this kind (`accountsReady`); the rows in `hidden` are left out of it. */
  unsure?: boolean;
  hidden?: Set<string>;
}

let clock = 0;
const now = () => new Date(Date.parse("2026-11-26T00:00:00.000Z") + 1000 * clock++).toISOString();
const bindingOf = (kind: Kind, row: Row): SecretBinding =>
  kind === "mail" ? imapSecretBinding("imap", HOSTS[row.at], 993, row.user) : calDavSecretBinding("webdav", URLS[row.at], row.user);
const idOf = (kind: Kind, row: Row) => canonicalSecretId(bindingOf(kind, row));

function host(d: Device) {
  return {
    deviceId: async () => "D",
    readMeta: async () => (d.meta ? (structuredClone(d.meta) as SecretsPortMeta) : null),
    writeMeta: async (meta: SecretsPortMeta) => {
      d.meta = structuredClone(meta);
    },
    accountsReady: async (service: SecretBinding["service"]) => !d.unsure || service !== (d.kind === "mail" ? "mail" : "calendar"),
    candidates: async (): Promise<LocalSecretCandidate[]> =>
      d.rows.filter((row) => !d.hidden?.has(row.id)).map((row) => {
        const pass = d.slots.get(row.id);
        return {
          logicalId: idOf(d.kind, row),
          slot: row.id,
          binding: bindingOf(d.kind, row),
          secret: pass ? { pass } : null,
          apply: (secret: Record<string, string>) => secret.pass,
        };
      }),
    readSlot: async (slot: string) => (slot === SECRETS_MARK_KEY_SLOT ? d.keyring.get(slot) : d.slots.get(slot)) ?? null,
    writeSlot: async (slot: string, value: unknown) => {
      if (slot === SECRETS_MARK_KEY_SLOT) d.keyring.set(slot, value);
      else d.slots.set(slot, value as string);
    },
    removeSlot: async (slot: string) => void d.slots.delete(slot),
    now,
  };
}

/**
 * The port the helpers run: this branch, or the one of `main` (89abe6ced
 * carries the port of v0.9.0 unchanged, frozen in `secretsV090.ts`), so a cell
 * says what `main` does in it from that code, not from a table.
 */
let onMain = false;
const portFor = (d: Device) => (onMain ? (v090.createSecretsPort(host(d) as never) as unknown as ReturnType<typeof createSecretsPort>) : createSecretsPort(host(d)));
const retireFor = (d: Device, binding: SecretBinding, take: () => Promise<void>) =>
  onMain ? (d.kind === "calendar" ? v090.retireSecret(host(d) as never, binding as never).then(take) : take()) : retireSecret(host(d), binding, take, now());

let doc: SecretsBundle = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
/** Another device's entry, put straight into the document. */
function put(kind: Kind, row: Row, entry: { rev: number; device: string; pass?: string }): void {
  const value: SecretEntry = {
    entryRev: entry.rev,
    updatedAt: now(),
    deviceId: entry.device,
    binding: bindingOf(kind, row),
    ...(entry.pass === undefined ? { tombstone: true } : { secret: { pass: entry.pass } }),
  };
  doc = { ...doc, bundleRev: doc.bundleRev + 1, entries: { ...doc.entries, [idOf(kind, row)]: value } };
}
async function exportOnly(d: Device): Promise<SecretsBundle> {
  return portFor(d).exportBundle();
}
/** Reads one name of the document, so an open removal under another name stays open. */
async function importOnly(d: Device, id: string): Promise<void> {
  await portFor(d).importBundle({ ...doc, entries: { [id]: doc.entries[id] } });
}
async function round(d: Device): Promise<SecretsBundle> {
  const port = portFor(d);
  const local = await port.exportBundle();
  const merged = mergeSecretsBundles(local, doc, now());
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || port.awaitsDocument?.()) await port.importBundle(merged);
  doc = merged;
  return local;
}

const OLD = ["none", "received", "typed", "typed, saw a newer one", "lost key", "held", "unconfirmed", "foreign tombstone", "own removal"] as const;
const NEW = ["none", "same password", "other password", "foreign tombstone", "own removal, open", "own removal, confirmed"] as const;
type Old = (typeof OLD)[number];
type New = (typeof NEW)[number];

/** The device, its account X at a in the state `old`, and the name b in the state `fresh`; returns the revisions it knew under each name. */
async function setUp(kind: Kind, old: Old, fresh: New): Promise<{ d: Device; x: Row; known: number }> {
  clock = 0;
  doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
  const x: Row = { id: "x", user: "cora@example.com", at: "a" };
  // Z: an account of the same user that was at b on this device and left it (the record under b stays).
  const z: Row = { id: "z", user: "cora@example.com", at: "b" };
  const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
  let known = 0;

  if (fresh !== "none") {
    d.rows.push({ ...z });
    put(kind, z, { rev: 5, device: "N3", pass: fresh === "other password" ? "Q" : "P1" });
    await round(d);
    known = 5;
    if (fresh === "foreign tombstone") {
      d.rows = d.rows.filter((row) => row.id !== "z");
      d.slots.delete("z");
      put(kind, z, { rev: 6, device: "N3" });
      await round(d);
      known = 6;
    } else if (fresh === "own removal, open" || fresh === "own removal, confirmed") {
      await retireFor(d, bindingOf(kind, z), async () => {
        d.rows = d.rows.filter((row) => row.id !== "z");
        d.slots.delete("z");
      });
      if (fresh === "own removal, confirmed") await round(d);
      known = 6;
    } else {
      // Gone from this device without an act (the profile took it, or it was folded): no tombstone.
      d.rows = d.rows.filter((row) => row.id !== "z");
      d.slots.delete("z");
      await round(d);
    }
  }
  const open = fresh === "own removal, open";
  // The removal is written and goes out, and no round has read it back yet.
  if (open) await exportOnly(d);
  const roundOrExport = (dev: Device) => (open ? exportOnly(dev) : round(dev));

  switch (old) {
    case "none":
      // Listed under a in a round with nothing for it; the password is typed afterwards.
      await roundOrExport(d);
      d.slots.set("x", "P1");
      break;
    case "received":
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await roundOrExport(d);
      if (open) await importOnly(d, idOf(kind, x));
      known = Math.max(known, 3);
      break;
    case "typed":
      d.slots.set("x", "P1");
      await roundOrExport(d);
      known = Math.max(known, 1);
      break;
    case "typed, saw a newer one":
      // Typed here, then a newer password from elsewhere seen and not taken (`heldRev` 9).
      d.slots.set("x", "P1");
      await roundOrExport(d);
      put(kind, x, { rev: 9, device: "N2", pass: "P5" });
      await importOnly(d, idOf(kind, x));
      known = Math.max(known, 9);
      break;
    case "lost key":
    case "held":
    case "unconfirmed":
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      if (open) await importOnly(d, idOf(kind, x));
      else await round(d);
      d.keyring.clear();
      await exportOnly(d);
      if (old === "held") {
        // The document has that very version with another password: held here (a local conflict).
        doc = { ...doc, entries: { ...doc.entries, [idOf(kind, x)]: { ...doc.entries[idOf(kind, x)]!, secret: { pass: "P7" } } } };
        await importOnly(d, idOf(kind, x));
      } else if (old === "unconfirmed") {
        // An import that finds nothing for it: the baseline waits to be confirmed.
        await portFor(d).importBundle({ ...doc, entries: {} });
      }
      known = Math.max(known, 3);
      break;
    case "foreign tombstone":
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      if (open) await importOnly(d, idOf(kind, x));
      else await round(d);
      // A device on 0.9.0 repaired away from a and left its tombstone there; X is still at a here.
      put(kind, x, { rev: 4, device: "V" });
      await importOnly(d, idOf(kind, x));
      known = Math.max(known, 4);
      break;
    case "own removal":
      d.slots.set("x", "P0");
      await roundOrExport(d);
      await retireFor(d, bindingOf(kind, x), async () => {
        d.rows = d.rows.filter((row) => row.id !== "x");
        d.slots.delete("x");
      });
      await exportOnly(d);
      // The account came back (added again, or brought back by the profile), its password typed again.
      d.rows.unshift({ ...x });
      d.slots.set("x", "P1");
      known = Math.max(known, 2);
      break;
  }
  // The repair: X's address a -> b.
  d.rows = d.rows.map((row) => (row.id === "x" ? { ...row, at: "b" as At } : row));
  return { d, x, known };
}

/** What the table says the first export after the repair publishes for the unchanged password under b. */
function expectedVersion(old: Old, fresh: New, known: number): { rev: number; device: string } {
  const settledValue = old === "received" || old === "typed" || old === "typed, saw a newer one";
  const tombAtB = fresh === "foreign tombstone" || fresh.startsWith("own removal");
  const afterLoss = old === "lost key" || old === "held" || old === "unconfirmed";
  const sameAtB = fresh === "same password" && !afterLoss;
  if (sameAtB) return { rev: 5, device: "N3" };
  if (settledValue && !tombAtB) return old === "received" ? { rev: 3, device: "N2" } : { rev: 1, device: "D" };
  return { rev: known + 1, device: "D" };
}
/**
 * A password only received whose version the device cannot carry (a tombstone,
 * or a record after a lost key, under the old name) and no tombstone under the
 * new one: it waits for the document instead of going out as a new value
 * (review 2026-11-27, seventh round, M1).
 */
const waitsForDocument = (old: Old, fresh: New) =>
  (old === "lost key" || old === "held" || old === "unconfirmed" || (old === "foreign tombstone" && fresh !== "same password")) &&
  (fresh === "none" || fresh === "same password" || fresh === "other password");
/**
 * Nothing typed in the save that repairs: whether the slot follows a newer
 * password under the new name. Received, and provably so: by a mark of a key
 * the device still has, or — the key lost in the gap — by the document under
 * the old name at the record's revision (seventh round, S1). A held conflict
 * after a lost key is no proof (the document had another password at that
 * version), nor is the mark a tombstone of another device found with a key
 * lost since.
 */
const expectedToFollow = (old: Old, _fresh: New, gap: "key kept" | "key lost, export first" | "key lost, a round") =>
  receivedIn(old) && (gap === "key kept" || (old !== "held" && old !== "foreign tombstone"));
const receivedIn = (old: Old) => old === "received" || old === "lost key" || old === "held" || old === "unconfirmed" || old === "foreign tombstone";

for (const kind of ["calendar", "mail"] as const) {
  describe(`a repair changes the name, not the history (${kind})`, () => {
    for (const old of OLD) {
      for (const fresh of NEW) {
        it(`old name: ${old}; new name: ${fresh}`, async () => {
          const { d, x, known } = await setUp(kind, old, fresh);
          const b = { ...x, at: "b" as At };
          const first = await round(d);
          const published = first.entries[idOf(kind, b)];
          if (waitsForDocument(old, fresh)) {
            expect(published, "only received, its version unknown: it waits for the document").toBeUndefined();
            // The import of that round read it: what the document holds under b, or with nothing there, the slot as it is.
            expect(d.slots.get("x")).toBe(fresh === "other password" ? "Q" : "P1");
            if (fresh === "none") expect((await exportOnly(d)).entries[idOf(kind, b)], "below every entry").toMatchObject({ secret: { pass: "P1" }, entryRev: 0 });
          } else {
            const version = expectedVersion(old, fresh, known);
            expect(published?.secret, "the slot's password goes out under the new name").toEqual({ pass: "P1" });
            expect({ rev: published?.entryRev, device: published?.deviceId }, "the version it goes out with").toEqual(version);
          }
          // Received or typed: a newer password from another device under b.
          put(kind, b, { rev: 50, device: "N4", pass: "P9" });
          await round(d);
          expect(d.slots.get("x"), receivedIn(old) ? "received: it follows a change made elsewhere" : "typed here: not replaced from elsewhere").toBe(receivedIn(old) ? "P9" : "P1");
        });

        it(`old name: ${old}; new name: ${fresh} — a password typed after the repair goes out above all it knew`, async () => {
          const { d, x, known } = await setUp(kind, old, fresh);
          const b = { ...x, at: "b" as At };
          d.slots.set("x", "P8");
          const out = await exportOnly(d);
          const entry = out.entries[idOf(kind, b)];
          expect(entry?.secret).toEqual({ pass: "P8" });
          expect(entry?.entryRev, `above revision ${known}`).toBe(known + 1);
          expect(entry?.deviceId).toBe("D");
        });

        // Typed in the save that repairs, or nothing typed; with the key of the
        // marks kept, or lost in the gap before that round (the export alone
        // first, or a whole round). The branch holds a fixed expectation; what
        // `main` does in the same cell is run beside it, from its port, and no
        // cell ends worse on the branch (review 2026-11-27, seventh round).
        for (const typed of [true, false]) {
          for (const gap of ["key kept", "key lost, export first", "key lost, a round"] as const) {
            it(`old name: ${old}; new name: ${fresh} — ${typed ? "NEW typed" : "nothing typed"} in the save that repairs, ${gap}: ${typed ? "it stays here" : "only a received password follows"}, never worse than main`, async () => {
              const outcome = async (main: boolean) => {
                onMain = main;
                try {
                  const { d, x } = await setUp(kind, old, fresh);
                  const b = { ...x, at: "b" as At };
                  if (gap !== "key kept") d.keyring.clear();
                  if (typed) d.slots.set("x", "NEW");
                  if (gap === "key lost, export first") await exportOnly(d);
                  await round(d);
                  put(kind, b, { rev: 50, device: "N4", pass: "P9" });
                  await round(d);
                  await round(d);
                  return d.slots.get("x");
                } finally {
                  onMain = false;
                }
              };
              const onMainEnds = await outcome(true);
              const here = await outcome(false);
              const follows = !typed && expectedToFollow(old, fresh, gap);
              expect(here, typed ? "typed here: not replaced from elsewhere" : follows ? "received: it follows" : "not provably received: kept as typed").toBe(typed ? "NEW" : follows ? "P9" : "P1");
              // Where the rule keeps what is typed or lets what is received follow, main ends no better.
              // Elsewhere main may follow: it overwrites a password typed earlier, or — with no proof left
              // after a lost key — has applied the tombstone or taken the held version (named limit).
              if (typed || follows) expect(here, `main ends with ${onMainEnds}`).toBe(typed || onMainEnds === "P9" ? (typed ? "NEW" : "P9") : here);
            });
          }
        }
      }
    }

    it("without a note of its slot (a record of 0.9.0): nothing is carried, the password goes out as a new value", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      delete d.meta!.slotNames;
      const b = { ...x, at: "b" as At };
      const first = await round(d);
      expect({ rev: first.entries[idOf(kind, b)]?.entryRev, device: first.entries[idOf(kind, b)]?.deviceId }).toEqual({ rev: 1, device: "D" });
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      expect(d.slots.get("x"), "as on 0.9.0: after a repair a received password counts as typed here").toBe("P1");
    });

    for (const fresh of ["none", "foreign tombstone"] as const) {
      it(`a chain of repairs c -> a -> b, the slot empty at a, b: ${fresh} — the floor of the first repair holds under the last`, async () => {
        clock = 0;
        doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
        const x: Row = { id: "x", user: "cora@example.com", at: "c" };
        const z: Row = { id: "z", user: "cora@example.com", at: "b" };
        const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
        put(kind, x, { rev: 9, device: "N2", pass: "P1" });
        // Tombstones another device left at a (and at b): remembered here, no account of this device there.
        put(kind, { ...x, at: "a" }, { rev: 2, device: "V" });
        if (fresh === "foreign tombstone") put(kind, z, { rev: 2, device: "V" });
        await round(d);
        expect(d.slots.get("x")).toBe("P1");
        // Repaired c -> a; the slot is emptied before any export at a (the keychain entry deleted).
        d.rows = [{ ...x, at: "a" }];
        d.slots.delete("x");
        await round(d);
        // Repaired a -> b; a password typed there.
        d.rows = [{ ...x, at: "b" }];
        d.slots.set("x", "P8");
        const out = await exportOnly(d);
        expect(out.entries[idOf(kind, { ...x, at: "b" })]?.entryRev, "above revision 9, known under c two repairs ago").toBe(10);
      });
    }

    it("from a name another account here still has, nothing is carried", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      // A second row of the same account at a (two rows, one name) stays there.
      d.rows.push({ id: "y", user: "cora@example.com", at: "a" });
      d.slots.set("y", "P1");
      const b = { ...x, at: "b" as At };
      const first = await round(d);
      expect({ rev: first.entries[idOf(kind, b)]?.entryRev, device: first.entries[idOf(kind, b)]?.deviceId }, "a new value under b, not a's version").toEqual({ rev: 1, device: "D" });
    });

    // One case for each rule a mutation of the port survived (fourth review round, rerun of mut4.py).
    it("from a name another account here still has, nothing is carried — not either on a list that is not whole and leaves that account out", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      d.rows.push({ id: "y", user: "cora@example.com", at: "a" });
      d.slots.set("y", "P1");
      d.unsure = true;
      d.hidden = new Set(["y"]);
      const b = { ...x, at: "b" as At };
      const first = await round(d);
      expect({ rev: first.entries[idOf(kind, b)]?.entryRev, device: first.entries[idOf(kind, b)]?.deviceId }, "a new value under b: the list may leave out who still holds a").toEqual({ rev: 1, device: "D" });
      d.unsure = false;
      d.hidden = undefined;
      const next = await round(d);
      expect({ rev: next.entries[idOf(kind, b)]?.entryRev, device: next.entries[idOf(kind, b)]?.deviceId }, "and the whole list sees y at a: still nothing carried").toEqual({ rev: 1, device: "D" });
    });

    it("the note of a slot a list that is not whole leaves out stays: the repair after it changes the name, not the history", async () => {
      const { d, x } = await setUp(kind, "none", "other password");
      const b = { ...x, at: "b" as At };
      d.unsure = true;
      d.hidden = new Set(["x"]);
      await round(d);
      d.unsure = false;
      d.hidden = undefined;
      await round(d);
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      expect(d.slots.get("x"), "typed here, as under a: not replaced from elsewhere").toBe("P1");
    });

    it("two accounts of one user shift, B listed before A (A a -> c, B b -> a): A carries what it knew under a, not what B brings there", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const a: Row = { id: "x", user: "cora@example.com", at: "a" };
      const bb: Row = { id: "w", user: "cora@example.com", at: "b" };
      const d: Device = { kind, rows: [{ ...bb }, { ...a }], slots: new Map([["w", "PB"]]), keyring: new Map(), meta: null };
      put(kind, a, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      await round(d);
      expect(d.slots.get("x")).toBe("P1");
      d.rows = [{ ...bb, at: "a" }, { ...a, at: "c" }];
      const first = await round(d);
      const c = { ...a, at: "c" as At };
      expect({ rev: first.entries[idOf(kind, c)]?.entryRev, device: first.entries[idOf(kind, c)]?.deviceId }, "A's version from a").toEqual({ rev: 3, device: "N2" });
      put(kind, c, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      expect([d.slots.get("x"), d.slots.get("w")], "A received its password and follows; B typed its own and keeps it").toEqual(["P9", "PB"]);
    });

    it("a repair from a name with a foreign tombstone carries the floor only: the empty slot takes the password under the new name", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 2, device: "V" });
      await round(d);
      put(kind, { ...x, at: "b" }, { rev: 1, device: "N3", pass: "P5" });
      d.rows = [{ ...x, at: "b" }];
      await round(d);
      await round(d);
      expect(d.slots.get("x"), "nothing under a is a version of b").toBe("P5");
    });

    it("a repair an import sees first (the address changed between the two halves of a round) is carried there", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      const b = { ...x, at: "b" as At };
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.slots.get("x"), "received under a: it follows a change made elsewhere under b").toBe("P9");
    });

    it("an import on a list that is not whole settles nothing: once whole, the same document reports the account it does not know", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [], slots: new Map(), keyring: new Map(), meta: null, unsure: true };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      const port = createSecretsPort(host(d));
      expect((await port.importBundle(doc)).settled, "the list may not be whole").not.toBe(true);
      d.unsure = false;
      const whole = await createSecretsPort(host(d)).importBundle(doc);
      expect(whole.unknownAccounts, "an account in the document not set up here").toEqual([idOf(kind, x)]);
    });

    if (kind === "calendar") it("an entry of 0.8.7 for one of two accounts that differ only in case waits while the list is not whole and leaves the other out (sixth review round, M4)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const upper: Row = { id: "u", user: "Alice@example.com", at: "a" };
      const lower: Row = { id: "l", user: "alice@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...upper }, { ...lower }], slots: new Map([["l", "L1"]]), keyring: new Map(), meta: null };
      put(kind, upper, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      await round(d);
      expect(d.slots.get("u")).toBe("P1");
      // A device on 0.8.7 writes under the name it gives both: the user lower-cased, the old type.
      const old: SecretBinding = { ...bindingOf(kind, lower), secretType: "caldav-password" };
      doc = { ...doc, bundleRev: doc.bundleRev + 1, entries: { ...doc.entries, [canonicalSecretId(old)]: { entryRev: 1, updatedAt: now(), deviceId: "O", binding: old, secret: { pass: "OLD" } } } };
      d.unsure = true;
      d.hidden = new Set(["l"]);
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.slots.get("u"), "which of the two it means is read from the whole list").toBe("P1");
    });

    // A mailbox's user has one spelling only (`bindingUserKey`); a calendar's keeps its case.
    if (kind === "calendar") it("a record of 0.9.0 under another spelling of the same user (folded) is no removal in the first round after the update (fifth review round)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      // As 0.9.0 left it: no marks of this version, and the same credential under the other spelling.
      const spelled = { ...x, user: "Cora@example.com" };
      const meta = d.meta!;
      delete meta.notesRemovals;
      delete meta.comparedKinds;
      delete meta.slotNames;
      meta.entries[idOf(kind, spelled)] = { ...meta.entries[idOf(kind, x)]!, binding: bindingOf(kind, spelled) };
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, spelled)], "the same credential is still listed").toBeUndefined();
      expect(d.meta?.notesRemovals).toBe(true);
    });

    it("a repair this version saw itself (its slot noted under the old name by an import before the kind was compared) is no removal in the first round after the update (rule U3)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      const meta = d.meta!;
      delete meta.notesRemovals;
      delete meta.comparedKinds;
      delete meta.slotNames;
      // The export of the round reads a list that is not whole; the import a whole one, which notes the slot under a.
      d.unsure = true;
      await exportOnly(d);
      d.unsure = false;
      // The document changed elsewhere meanwhile: the import reads it.
      put(kind, x, { rev: 4, device: "N2", pass: "P2" });
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.meta?.slotNames?.x).toBe(idOf(kind, x));
      d.rows = d.rows.map((row) => ({ ...row, at: "b" as At }));
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, x)]?.tombstone, "the note proves the repair").not.toBe(true);
      expect(d.meta?.notesRemovals).toBe(true);
    });

    it("the key of the marks lost in the save that repairs, nothing typed: the received password still follows (rule R, the slot noted under the old name)", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      const b = { ...x, at: "b" as At };
      d.keyring.clear();
      await round(d);
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      await round(d);
      expect(d.slots.get("x"), "received: it follows").toBe("P9");
    });

    it("a tombstone of the old name remembered by a build before rule R (no mark of its slot): nothing to compare, the device does as main did in that cell — typed here (sixth review round)", async () => {
      const { d, x } = await setUp(kind, "foreign tombstone", "none");
      const b = { ...x, at: "b" as At };
      const record = d.meta!.entries[idOf(kind, x)]!;
      expect(record.slotMark).toBeDefined();
      delete record.slotMark;
      await round(d);
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      await round(d);
      expect(d.slots.get("x")).toBe("P1");
    });

    it("an import on a whole list in which a repair is carried settles: nothing waits (rule L3)", async () => {
      const { d } = await setUp(kind, "received", "none");
      await createSecretsPort(host(d)).importBundle(doc);
      expect((await createSecretsPort(host(d)).importBundle(doc)).settled, "the same document again is settled").toBe(true);
    });

    it("an import on a list that is not whole settles when nothing waits for it: an account listed with no note of its slot yet (rule L3)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null, unsure: true };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.slots.get("x")).toBe("P1");
      expect((await createSecretsPort(host(d)).importBundle(doc)).settled, "the same document again is settled").toBe(true);
    });

    it("the current entry of an account whose old name the document holds waits while the list is not whole: whether another account means that old name is read from the whole list (sixth review round, M4)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      put(kind, x, { rev: 4, device: "N2", pass: "P4" });
      const old: SecretBinding = { ...bindingOf(kind, x), secretType: kind === "mail" ? "imap-password" : "caldav-password" };
      doc = { ...doc, bundleRev: doc.bundleRev + 1, entries: { ...doc.entries, [canonicalSecretId(old)]: { entryRev: 1, updatedAt: now(), deviceId: "O", binding: old, secret: { pass: "OLD" } } } };
      d.unsure = true;
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.slots.get("x"), "nothing decided from it yet").toBe("P1");
      expect((await createSecretsPort(host(d)).importBundle(doc)).settled, "the import stays open").not.toBe(true);
    });

    if (kind === "calendar") it("a record of 0.8.7 under an old name two accounts that differ only in case share is carried to neither while the list is not whole and leaves one out (sixth review round, M4)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const upper: Row = { id: "u", user: "Alice@example.com", at: "a" };
      const lower: Row = { id: "l", user: "alice@example.com", at: "a" };
      const old: SecretBinding = { ...bindingOf(kind, lower), secretType: "caldav-password" };
      const d: Device = {
        kind,
        rows: [{ ...upper }, { ...lower }],
        slots: new Map([["u", "P1"], ["l", "L1"]]),
        keyring: new Map(),
        meta: { entries: { [canonicalSecretId(old)]: { hash: "as 0.8.7 kept it", entryRev: 7, updatedAt: now(), deviceId: "O", binding: old } }, imported: {}, quarantine: {} },
        unsure: true,
        hidden: new Set(["l"]),
      };
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, upper)]?.entryRev, "what 0.8.7 knew under that name is no knowledge about Alice: a new value").toBe(1);
    });

    it("a tombstone of another device under another family of the same server: the mark of the slot is taken under the tombstone's binding, so a received password still follows after the repair (seventh review round, H3)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      // A device that labels the server otherwise (the family is a catalog label) repaired away and left its tombstone.
      const other: SecretBinding = { ...bindingOf(kind, x), family: "nextcloud" };
      doc = { ...doc, bundleRev: doc.bundleRev + 1, entries: { ...doc.entries, [idOf(kind, x)]: { entryRev: 4, updatedAt: now(), deviceId: "V", binding: other, tombstone: true } } };
      await importOnly(d, idOf(kind, x));
      expect(d.meta?.entries[idOf(kind, x)]?.binding.family).toBe("nextcloud");
      d.rows = d.rows.map((row) => ({ ...row, at: "b" as At }));
      await round(d);
      put(kind, { ...x, at: "b" }, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      await round(d);
      expect(d.slots.get("x"), "received: it follows").toBe("P9");
    });

    it("the key of the marks lost in the gap, nothing typed, the document carrying the slot's value under the old name at another revision: no proof, kept as typed (seventh review round, named limit)", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      const b = { ...x, at: "b" as At };
      // Sent again under the old name by another device, at a revision this device never had.
      put(kind, x, { rev: 5, device: "N5", pass: "P1" });
      d.keyring.clear();
      await round(d);
      put(kind, b, { rev: 50, device: "N4", pass: "P9" });
      await round(d);
      await round(d);
      expect(d.slots.get("x"), "the value at the record's revision is the proof, not the value alone").toBe("P1");
    });

    it("a carry that waits, its slot written under the new name by an import meanwhile: the floor of the old name still goes along (seventh review round, S2)", async () => {
      const { d, x } = await setUp(kind, "received", "none");
      const b = { ...x, at: "b" as At };
      // The slot empty here; the list of its kind not whole while the document brings a password under b.
      d.slots.delete("x");
      d.unsure = true;
      put(kind, b, { rev: 1, device: "N4", pass: "P5" });
      await createSecretsPort(host(d)).importBundle(doc);
      expect(d.slots.get("x")).toBe("P5");
      d.unsure = false;
      d.slots.set("x", "P8");
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, b)], "above revision 3, known under a").toMatchObject({ secret: { pass: "P8" }, entryRev: 4 });
    });

    it("the tombstone of an absence in the first round after the update goes out one revision above the record, from this device, and closes the old name (sixth review round, M3)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const k: Row = { id: "k", user: "keep@example.com", at: "c" };
      const d: Device = { kind, rows: [{ ...x }, { ...k }], slots: new Map([["k", "K"]]), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      // As 0.9.0 left it; the account removed there before its next round.
      const meta = d.meta!;
      delete meta.notesRemovals;
      delete meta.comparedKinds;
      delete meta.slotNames;
      delete meta.closedOldNames;
      d.rows = d.rows.filter((row) => row.id !== "x");
      d.slots.delete("x");
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, x)], "as that version wrote it").toMatchObject({ tombstone: true, entryRev: 4, deviceId: "D" });
      expect(Object.keys(d.meta?.closedOldNames ?? {}), "a value of 0.8.7 under the old name reaches no other account").toHaveLength(1);
    });

    it("a record of 0.9.0 whose endpoint is spelled another way than its name normalizes is no removal in the first round after the update, its slot empty here: the name says the account is listed (sixth review round)", async () => {
      clock = 0;
      doc = { format: "plainva-secrets", version: 1, bundleRev: 0, updatedAt: now(), entries: {} };
      const x: Row = { id: "x", user: "cora@example.com", at: "a" };
      const d: Device = { kind, rows: [{ ...x }], slots: new Map(), keyring: new Map(), meta: null };
      put(kind, x, { rev: 3, device: "N2", pass: "P1" });
      await round(d);
      // As 0.9.0 left it, with the endpoint as a document of another writer may carry it.
      const meta = d.meta!;
      delete meta.notesRemovals;
      delete meta.comparedKinds;
      delete meta.slotNames;
      const record = meta.entries[idOf(kind, x)]!;
      meta.entries[idOf(kind, x)] = { ...record, binding: { ...record.binding, endpoint: `${record.binding.endpoint}/` } };
      // With a password in the slot, the round writes the record anew from the account; empty, it does not.
      d.slots.delete("x");
      const out = await exportOnly(d);
      expect(out.entries[idOf(kind, x)]?.tombstone, "the account is still on the list").not.toBe(true);
      expect(d.meta?.notesRemovals).toBe(true);
    });
  });
}
