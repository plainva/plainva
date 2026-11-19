import { describe, expect, it } from "vitest";
import {
  assertSecretsBundleStructure,
  assertShareable,
  canonicalSecretId,
  mergeSecretsBundles,
  stableStringify,
  type SecretsBundle,
} from "@plainva/core";
import {
  SECRETS_MARK_KEY_SLOT,
  calDavSecretBinding,
  createSecretsPort,
  imapSecretBinding,
  migrateSecretsMetaToCanonicalIds,
  retireSecret,
  type SecretsPortMeta,
} from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";

/**
 * Random mixed fleets of updated devices and devices on 0.8.7 (review
 * 2026-11-18, round eight: the review's `fuzz.mts`, carried over step for
 * step, with the same random sequence). A device on 0.8.7 runs the frozen code
 * of that tag; an updated one today's. Each round runs as the step of its
 * version runs it: export, merge, import when the merge changed the local
 * view, upload when it changed the shared one.
 *
 * Every password carries the account it was typed for (`<user>|<n>|O` on
 * 0.8.7, `|N` on an updated device). What is held here, besides "nothing is
 * uploaded once settled":
 *  - a password an updated device typed is never in the slot of another account;
 *  - a slot an updated device wrote holds the password of exactly its account,
 *    except a password typed on 0.8.7 for the twin of that account: a device
 *    up to 0.8.7 cannot tell "Alice" from "alice", and its value reaches the
 *    one account here its old name can mean (named limit since round four).
 *    Seeds 51 and 315 are the two in which an updated device, by stamping a
 *    password it read under the old name as a change of its own, spread such
 *    a value further (round eight, R1); they are pinned to what remains.
 */

const CAL = "https://cloud.example.com/remote.php/dav";
const IMAP = { host: "imap.example.com", port: 993 };
type Row = { id: string; user: string; kind?: "cal" | "mail" };

interface Dev {
  name: string;
  old: boolean;
  rows: Row[];
  slots: Record<string, string>;
  keyring: Map<string, unknown>;
  meta: SecretsPortMeta | null;
  pushes: number;
  byNew: Set<string>;
}

const W: { remote: SecretsBundle | null; t: number } = { remote: null, t: 0 };
const iso = (s: number) => new Date(Date.parse("2026-11-18T00:00:00.000Z") + 1000 * s).toISOString();

const dev = (name: string, old: boolean, rows: Row[], slots: Record<string, string> = {}): Dev => ({
  name, old, rows: rows.map((r) => ({ ...r })), slots: { ...slots }, keyring: new Map(), meta: null, pushes: 0, byNew: new Set(),
});
const oldBinding = (r: Row) =>
  r.kind === "mail"
    ? { family: "imap", service: "mail" as const, secretType: "imap-password" as const, user: r.user.trim().toLowerCase(), endpoint: v087.canonicalizeEndpoint(`imaps://${IMAP.host}:${IMAP.port}`) }
    : { family: "webdav", service: "calendar" as const, secretType: "caldav-password" as const, user: r.user.trim().toLowerCase(), endpoint: v087.canonicalizeEndpoint(CAL) };
const newBinding = (r: Row) => (r.kind === "mail" ? imapSecretBinding("imap", IMAP.host, IMAP.port, r.user) : calDavSecretBinding("webdav", CAL, r.user));

function host(d: Dev) {
  return {
    deviceId: async () => d.name,
    readMeta: async () => {
      const m = d.meta ? (JSON.parse(JSON.stringify(d.meta)) as SecretsPortMeta) : null;
      return d.old ? m : migrateSecretsMetaToCanonicalIds(m);
    },
    writeMeta: async (m: SecretsPortMeta) => {
      d.meta = JSON.parse(JSON.stringify(m));
    },
    candidates: async () =>
      d.rows.map((r) => {
        const b = d.old ? oldBinding(r) : newBinding(r);
        const p = d.slots[r.id];
        return { logicalId: d.old ? v087.canonicalSecretId(b as never) : canonicalSecretId(b as never), slot: r.id, binding: b, secret: p ? { pass: p } : null, apply: (s: { pass?: string }) => s.pass };
      }),
    readSlot: async (s: string) => (s === SECRETS_MARK_KEY_SLOT ? d.keyring.get(s) : d.slots[s]) ?? null,
    writeSlot: async (s: string, v: unknown) => {
      if (s === SECRETS_MARK_KEY_SLOT) return void d.keyring.set(s, v);
      d.slots[s] = v as string;
      if (d.old) d.byNew.delete(s);
      else d.byNew.add(s);
    },
    removeSlot: async (s: string) => {
      delete d.slots[s];
    },
    now: () => iso(W.t++),
  };
}

async function round(d: Dev): Promise<void> {
  if (d.old) {
    const p = v087.createSecretsPort(host(d) as never);
    if (W.remote) v087.assertSecretsBundleStructure(JSON.parse(JSON.stringify(W.remote)));
    const local = await p.exportBundle();
    for (const e of Object.values(local.entries)) if (!e.tombstone) v087.assertShareable(e);
    const merged = v087.mergeSecretsBundles(local, W.remote as never, iso(W.t++));
    if (v087.stableStringify(merged.entries) !== v087.stableStringify(local.entries)) await p.importBundle(merged);
    if (!W.remote || v087.stableStringify(merged.entries) !== v087.stableStringify(W.remote.entries)) {
      v087.assertSecretsBundleStructure(JSON.parse(JSON.stringify(merged)));
      W.remote = JSON.parse(JSON.stringify(merged));
      d.pushes++;
    }
    return;
  }
  const p = createSecretsPort(host(d) as never);
  if (W.remote) assertSecretsBundleStructure(JSON.parse(JSON.stringify(W.remote)));
  const local = await p.exportBundle();
  for (const e of Object.values(local.entries)) if (!e.tombstone) assertShareable(e);
  const merged = mergeSecretsBundles(local, W.remote, iso(W.t++));
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || p.awaitsDocument?.()) await p.importBundle(merged);
  if (!W.remote || stableStringify(merged.entries) !== stableStringify(W.remote.entries)) {
    assertSecretsBundleStructure(JSON.parse(JSON.stringify(merged)));
    W.remote = JSON.parse(JSON.stringify(merged));
    d.pushes++;
  }
}

async function retire(d: Dev, rowId: string) {
  const r = d.rows.find((x) => x.id === rowId)!;
  if (!d.old) await retireSecret({ readMeta: async () => d.meta, writeMeta: async (m) => void (d.meta = JSON.parse(JSON.stringify(m))) }, newBinding(r));
  d.rows = d.rows.filter((x) => x.id !== rowId);
  delete d.slots[rowId];
}
function remove(d: Dev, rowId: string) {
  d.rows = d.rows.filter((x) => x.id !== rowId);
  delete d.slots[rowId];
}

const POOL: Row[] = [
  { id: "a", user: "anna" }, { id: "B", user: "Bert" }, { id: "A1", user: "Alice" }, { id: "a1", user: "alice" },
  { id: "m", user: "Carl@Example.com", kind: "mail" },
];

/** One seed of the review's fuzz; returns uploads after settling and every slot that holds another account's password. */
async function fuzz(seed: number): Promise<{ uploads: number; wrong: string[] }> {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  W.remote = null;
  W.t = 0;
  const nNew = 1 + Math.floor(r() * 3), nOld = Math.floor(r() * 3);
  const fleet: Dev[] = [];
  let pwN = 0;
  const pw = (row: Row, old = false) => `${row.user}|${++pwN}|${old ? "O" : "N"}`;
  for (let i = 0; i < nNew + nOld; i++) {
    const old = i >= nNew;
    let rows = POOL.filter(() => r() < 0.7);
    if (old && rows.some((x) => x.id === "A1") && rows.some((x) => x.id === "a1")) {
      const drop = pick(["A1", "a1"]);
      rows = rows.filter((x) => x.id !== drop);
    }
    const slots: Record<string, string> = {};
    for (const row of rows) if (r() < 0.4) slots[row.id] = pw(row, old);
    fleet.push(dev(i < nNew ? `N${i}` : `O${i}`, old, rows, slots));
  }
  const order = () => [...fleet].sort(() => r() - 0.5);
  const wrong: string[] = [];
  const check = (where: string) => {
    for (const d of fleet) for (const row of d.rows) {
      const p = d.slots[row.id];
      if (!p) continue;
      const owner = p.split("|")[0];
      const ok = d.old || !d.byNew.has(row.id) ? owner.toLowerCase() === row.user.toLowerCase() : row.kind === "mail" ? owner.toLowerCase() === row.user.toLowerCase() : owner === row.user;
      if (!ok) wrong.push(`${where}: ${d.name}${d.old ? "(087)" : ""} slot ${row.id}(${row.user}) holds ${p}`);
    }
  };
  for (let i = 0; i < 3; i++) for (const d of order()) await round(d);
  for (let e = 0; e < 6; e++) {
    const d = pick(fleet);
    const k = r();
    if (k < 0.45 && d.rows.length) {
      const row = pick(d.rows);
      d.slots[row.id] = pw(row, d.old);
      d.byNew.delete(row.id);
    } else if (k < 0.55 && d.rows.length) remove(d, pick(d.rows).id);
    else if (k < 0.65 && d.rows.length && !d.old) await retire(d, pick(d.rows).id);
    else if (k < 0.8) {
      const row = pick(POOL);
      if (!d.rows.some((x) => x.id === row.id) && !(d.old && d.rows.some((x) => x.user.toLowerCase() === row.user.toLowerCase()))) {
        d.rows.push({ ...row });
        if (r() < 0.5) d.slots[row.id] = pw(row, d.old);
      }
    } else if (d.old) d.old = false;
    for (const x of order()) if (r() < 0.7) await round(x);
    check(`event ${e}`);
  }
  for (let i = 0; i < 8; i++) for (const d of order()) await round(d);
  for (const d of fleet) d.pushes = 0;
  const settled = JSON.stringify(W.remote);
  for (let i = 0; i < 12; i++) for (const d of order()) await round(d);
  let uploads = fleet.reduce((sum, d) => sum + d.pushes, 0);
  if (JSON.stringify(W.remote) !== settled) uploads++;
  check("end");
  return { uploads, wrong };
}

describe("random mixed fleets (round eight)", () => {
  it("settle with no upload, and no updated device's password reaches another account", async () => {
    for (const seed of [...Array.from({ length: 40 }, (_, i) => i + 1), 51, 315]) {
      const { uploads, wrong } = await fuzz(seed);
      expect(uploads, `seed ${seed}`).toBe(0);
      expect(wrong.filter((line) => line.endsWith("|N")), `seed ${seed}`).toEqual([]);
    }
  });

  it("seeds 51 and 315: only the named limit of the twins remains, and an updated device spreads nothing further", async () => {
    const remains = async (seed: number) => (await fuzz(seed)).wrong;
    const s51 = await remains(51);
    const s315 = await remains(315);
    // Every remaining one is a password typed on 0.8.7, at an updated device,
    // in the slot of the account its old name can mean.
    for (const line of [...s51, ...s315]) {
      expect(line).toMatch(/\|O$/);
      expect(line).not.toContain("(087)");
    }
    expect({ s51: s51.length, s315: s315.length }).toEqual({ s51: 4, s315: 14 });
  });
});
