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
  retireSecret,
  type LocalSecretCandidate,
  type SecretsPortMeta,
} from "@plainva/ui";
import * as v087 from "../../../../packages/core/test/fixtures/secretsV087";
import * as v090 from "../../../../packages/core/test/fixtures/secretsV090";

/**
 * Random fleets around what takes an account away, the yardstick of the
 * review of 2026-11-25 (its `zzReviewB5Fuzz.test.ts`, carried over step for
 * step with the same random sequence; all data invented). Updated devices run
 * today's port, devices on 0.9.0 and 0.8.7 their frozen code
 * (`secretsV090.ts`, `secretsV087.ts`). Clocks run up to ten minutes or three
 * hours apart; the profile reaches a device at once, after failing cycles, or
 * never; devices go away for a while, lose the key of their marks, run twice.
 *
 * How the settings cycle orders its steps (both shells,
 * `settingsSyncStepOrder.test.ts`): the profile step runs first, and when it
 * fails the cycle ends — the secrets step runs only after the profile step
 * succeeded in that cycle. A device whose profile fails ("lag") therefore
 * runs no secrets round in such a cycle either; the review's probe let it.
 * A device whose profile never brings the change ("off") is the accepted
 * price of "a tombstone never empties the slot of an account still here": it
 * keeps account and password.
 *
 * Held after every step and at the end:
 *  - Satz 1: the port of an updated device empties no slot of an account
 *    still on it; a password typed on an updated device whose profile works
 *    is in the document.
 *  - Satz 2: an account an updated device removed on purpose, which no
 *    device added again, has no password in the document under its name —
 *    unless a device whose profile never brings the removal still holds it
 *    with a password typed there (named limit).
 *  - Satz 3: a slot signed out on an updated device stays signed out.
 *  - Every mix settles: no upload once settled.
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
}

function device(name: string, kind: Kind, rows: Row[], skew: number, profile: Device["profile"]): Device {
  return { name, kind, rows: rows.map((row) => ({ ...row })), slots: new Map(), keyring: new Map(), meta: null, retired: null, pushes: 0, reports: 0, emptiedByPort: [], skew, profile, pending: [], awayUntil: -1, lagCycles: 0, typed: new Set() };
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
  return d.rows.map((row) => {
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
    removeSlot: async (slot: string) => {
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


interface Outcome {
  problems: string[];
  log: string[];
}

async function fuzz(seed: number, MODE: string, sameClocks = false): Promise<Outcome> {
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(r() * items.length)];
  remote = null;
  clock = 0;
  const allow = (what: string) => MODE === "all" || MODE.split(",").includes(what);
  const POOL: Row[] = [{ id: "a", user: "anna" }, { id: "b", user: "Bert" }, { id: "m", user: "carl@example.com", kind: "mail" }, { id: "n", user: "dora@example.com", kind: "mail" }];
  const kinds: Kind[] = ["new", "new", "new", "v090", "v087"];
  // `sameClocks`: the same choices (and so the same steps), every clock at 0.
  const skews = allow("skew") ? (sameClocks ? [0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 600_000, -600_000, 3 * 3600_000, -3 * 3600_000]) : [0];
  const profiles: Device["profile"][] = allow("profile") ? ["on", "on", "lag", "lag", "off"] : ["on"];
  const size = 2 + Math.floor(r() * 4);
  const shared = POOL.filter(() => r() < 0.8);
  const fleet: Device[] = [];
  for (let i = 0; i < size; i++) fleet.push(device(`D${i}`, i === 0 ? "new" : pick(kinds), shared, pick(skews), i === 0 ? "on" : pick(profiles)));
  let n = 0;
  for (const d of fleet) for (const row of d.rows) if (r() < 0.5) typeInto(d, row.id, `${row.id}${++n}`);
  const problems: string[] = [];
  const log: string[] = [`fleet ${fleet.map((d) => `${d.name}:${d.kind}/skew${d.skew / 60000}m/${d.profile}`).join(" ")} rows ${shared.map((x) => x.id).join("")}`];
  const signedOut = new Set<string>();
  /** rowId -> removal facts, while not re-added */
  const removed = new Map<string, { by: Kind; bindings: SecretBinding[]; typedAfter: boolean; keyLossAfter: boolean; step: number }>();
  const removedEver = new Set<string>();
  let step = 0;
  const order = () => [...fleet].sort(() => r() - 0.5);
  const profileTo = (src: Device, apply: (d: Device) => void) => {
    for (const d of fleet) if (d !== src && d.profile !== "off") d.pending.push(() => apply(d));
    for (const d of fleet) if (d !== src && d.profile === "off") d.pending.push(() => apply(d)); // never flushed
  };
  const flushProfile = (d: Device, all: boolean) => {
    if (d.profile === "off") return;
    while (d.pending.length && (all || d.profile === "on" || r() < 0.4)) d.pending.shift()!();
  };
  const check = (where: string) => {
    for (const d of fleet) {
      for (const slot of d.emptiedByPort) {
        const tag = removedEver.has(slot) ? "after-a-removal" : "never-removed";
        problems.push(`${where}: ${d.name}(${d.kind}) port emptied ${slot} [${tag}]`);
      }
      d.emptiedByPort.length = 0;
      for (const row of d.rows) if (signedOut.has(`${d.name}/${row.id}`) && typeof d.slots.get(row.id) !== "object") problems.push(`${where}: ${d.name} signed in ${row.id} again`);
    }
  };
  const roundsAll = async (times: number) => {
    for (let i = 0; i < times; i++) for (const d of order()) if (d.awayUntil < step) await round(d);
  };
  await roundsAll(3);
  for (let e = 0; e < 14; e++) {
    step = e;
    const d = pick(fleet);
    const k = r();
    const row = d.rows.length ? pick(d.rows) : null;
    if (row && k < 0.22) {
      const p = `${row.id}${++n}`;
      typeInto(d, row.id, p);
      signedOut.delete(`${d.name}/${row.id}`);
      const rem = removed.get(row.id);
      if (rem) rem.typedAfter = true;
      log.push(`${e}: ${d.name} types ${p} for ${row.id}`);
    } else if (row && k < 0.36) {
      const to: At = row.at === "b" ? "a" : "b";
      const typed = r() < 0.5 ? `${row.id}${++n}` : undefined;
      row.at = to;
      if (typed) {
        typeInto(d, row.id, typed);
        signedOut.delete(`${d.name}/${row.id}`);
      }
      // The profile carries the repaired address to every other device: same row, same slot.
      profileTo(d, (o) => {
        const mine = o.rows.find((x) => x.id === row.id);
        if (mine) mine.at = to;
      });
      log.push(`${e}: ${d.name}(${d.kind}) repairs ${row.id} -> ${to}${typed ? ` typing ${typed}` : ""}`);
    } else if (row && k < 0.48) {
      const bindings = [newBinding(row)];
      await removeOnPurpose(d, row.id);
      removedEver.add(row.id);
      if (d.kind === "new") removed.set(row.id, { by: d.kind, bindings, typedAfter: false, keyLossAfter: false, step: e });
      profileTo(d, (o) => {
        // The slot goes with the row, its sign-out mark too.
        if (o.rows.some((x) => x.id === row.id)) signedOut.delete(`${o.name}/${row.id}`);
        removedByProfile(o, row.id);
      });
      for (const other of fleet) signedOut.delete(`${other.name}/${row.id}`);
      log.push(`${e}: ${d.name}(${d.kind}) removes ${row.id}@${row.at ?? "a"} on purpose`);
    } else if (row && k < 0.56 && d.kind === "new") {
      d.slots.set(row.id, { signedOut: true });
      d.typed.delete(row.id);
      signedOut.add(`${d.name}/${row.id}`);
      log.push(`${e}: ${d.name} signs out ${row.id}`);
    } else if (k < 0.68) {
      const back = pick(POOL);
      if (!d.rows.some((item) => item.id === back.id)) {
        const at: At = r() < 0.5 ? "a" : "b";
        d.rows.push({ ...back, at });
        removed.delete(back.id);
        const typed = r() < 0.6 ? `${back.id}${++n}` : undefined;
        if (typed) typeInto(d, back.id, typed);
        profileTo(d, (o) => {
          if (!o.rows.some((x) => x.id === back.id)) o.rows.push({ ...back, at });
        });
        log.push(`${e}: ${d.name} adds ${back.id}@${at}${typed ? ` typing ${typed}` : ""}`);
      }
    } else if (k < 0.74 && allow("keyloss") && d.kind === "new") {
      d.keyring.delete(SECRETS_MARK_KEY_SLOT);
      for (const rem of removed.values()) rem.keyLossAfter = true;
      log.push(`${e}: ${d.name} loses its mark key`);
    } else if (k < 0.8 && allow("away")) {
      d.awayUntil = e + 1 + Math.floor(r() * 5);
      log.push(`${e}: ${d.name} goes away until ${d.awayUntil}`);
    } else if (k < 0.86) {
      await round(d);
      await round(d);
      log.push(`${e}: ${d.name} runs twice`);
    } else if (d.kind !== "new") {
      d.kind = "new";
      log.push(`${e}: ${d.name} updated`);
    }
    for (const x of fleet) flushProfile(x, false);
    for (const x of order()) if (x.awayUntil < e && r() < 0.7) await round(x);
    check(`event ${e}`);
  }
  step = 99;
  for (const x of fleet) x.awayUntil = -1;
  for (let i = 0; i < 3; i++) {
    for (const x of fleet) flushProfile(x, true);
    await roundsAll(3);
  }
  check("end");
  for (const d of fleet) {
    d.pushes = 0;
    d.reports = 0;
  }
  const settled = stableStringify(remote);
  await roundsAll(4);
  const uploads = fleet.reduce((sum, d) => sum + d.pushes, 0) + (stableStringify(remote) !== settled ? 1 : 0);
  if (uploads) problems.push(`end: ${uploads} uploads after settling`);
  // Satz 2: a removed account (on purpose, on an updated device, not added again) has no password in the document.
  for (const [rowId, rem] of removed) {
    const holders = fleet.filter((d) => d.rows.some((x) => x.id === rowId));
    // Named limit: a device whose profile never brings the removal keeps the
    // account and its password, and a password it holds as its own goes out
    // as every one typed there does (also when it signed out later).
    if (holders.some((h) => h.profile === "off")) continue;
    for (const b of rem.bindings) {
      // The current name. The old one a device up to 0.8.7 held it by is
      // tombstoned only where the remover knew it (named limit of the review;
      // the fleets in secretsRemovalFleet.test.ts hold that case).
      const ids = [canonicalSecretId(b)];
      for (const id of ids) {
        const entry = docEntries()[id];
        if (entry && !entry.tombstone) {
          problems.push(
            `end: removed ${rowId} still has a password under ${id.slice(0, 60)} [typedAfter=${rem.typedAfter} keyLossAfter=${rem.keyLossAfter} holders=${holders.map((h) => `${h.name}:${h.profile}`).join(",") || "none"} by=${entry.deviceId}]`,
          );
        }
      }
    }
  }
  // Satz 1 (sharing side): a password an updated, profile-flushed device holds for an account is in the document.
  for (const d of fleet) {
    if (d.kind !== "new" || d.profile === "off") continue;
    for (const row of d.rows) {
      const slot = d.slots.get(row.id);
      if (typeof slot !== "string" || !d.typed.has(row.id)) continue;
      const id = canonicalSecretId(newBinding(row));
      const entry = docEntries()[id];
      if (!entry || entry.tombstone) {
        const starving = fleet.filter((o) => o !== d && o.kind === "new" && o.rows.some((x) => x.id === row.id && (x.at ?? "a") === (row.at ?? "a")) && o.slots.get(row.id) === undefined).map((o) => o.name);
        problems.push(`end: ${d.name} holds ${row.id}@${row.at ?? "a"}=${slot} but the document has ${entry ? "a tombstone" : "nothing"} [removedEver=${removedEver.has(row.id)} starving=${starving.join(",") || "-"}]`);
      }
    }
  }
  return { problems, log };
}

async function rr(fleet: Device[], times: number) {
  for (let i = 0; i < times; i++) for (const d of fleet) await round(d);
}
function entryOf(row: Row) {
  return remote?.entries[canonicalSecretId(newBinding(row))];
}
const X: Row = { id: "x", user: "xena@example.com", kind: "mail" };
const C: Row = { id: "c", user: "cora", at: "a" };

describe("the review's probes (2026-11-25)", () => {
  for (const row of [X, C]) {
    it(`P1 ${row.id}: a device away changed the password before the removal, uploads it on return, then the profile takes the account`, async () => {
      remote = null;
      clock = 0;
      const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      n1.slots.set("x", "P1").set("c", "P1").set("k", "K");
      await rr([n1, n2], 3);
      // N2 away: the user changes the password there (no round runs).
      n2.slots.set(row.id, "P2");
      await removeOnPurpose(n1, row.id);
      await rr([n1], 2);
      // N2 comes back: its cycle applies the profile first (the removal), then
      // the secrets (`settingsSyncStepOrder.test.ts`) — the changed password
      // of an account that has left it is never published.
      removedByProfile(n2, row.id);
      await rr([n2], 1);
      await rr([n1, n2], 4);
      expect(entryOf(row)?.tombstone, "password of a removed account left in the document").toBe(true);
    });

    it(`P2 ${row.id}: a device with the profile off keeps a tombstoned account, then loses its mark key`, async () => {
      remote = null;
      clock = 0;
      const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "off");
      n1.slots.set(row.id, "P1").set("k", "K");
      await rr([n1, n2], 3);
      await removeOnPurpose(n1, row.id);
      await rr([n1, n2], 3);
      n2.keyring.delete(SECRETS_MARK_KEY_SLOT);
      await rr([n2, n1], 3);
      expect(entryOf(row)?.tombstone, "password of a removed account back in the document after a key loss").toBe(true);
    });

    it(`P5 ${row.id}: no skew — the remover's secrets round runs only after the account was added again elsewhere`, async () => {
      remote = null;
      clock = 0;
      const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      const n3 = device("N3", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      n1.slots.set(row.id, "P1").set("k", "K");
      await rr([n1, n2, n3], 3);
      // "Remove account" on N1; the profile carries the removal; N1's next secrets round has not run yet.
      await removeOnPurpose(n1, row.id);
      removedByProfile(n2, row.id);
      removedByProfile(n3, row.id);
      await rr([n2, n3], 2);
      // The user adds it again on N2 and types its password; the profile brings the row to N3.
      n2.rows.push({ ...row });
      n2.slots.set(row.id, "P9");
      n3.rows.push({ ...row });
      await rr([n2, n3], 2);
      expect(n3.slots.get(row.id)).toBe("P9");
      // Now N1's secrets round runs (its tombstone is stamped now), and the profile brings the row back to N1.
      await rr([n1], 1);
      n1.rows.push({ ...row });
      await rr([n1, n2, n3], 4);
      expect(entryOf(row)?.tombstone, "the password of the account added again left the document").toBeUndefined();
      expect([n1.slots.get(row.id), n2.slots.get(row.id), n3.slots.get(row.id)]).toEqual(["P9", "P9", "P9"]);
    });

    it(`P6 ${row.id}: no skew — "Remove account" on a device that never saw the entry (just got the account by the profile)`, async () => {
      remote = null;
      clock = 0;
      const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      n2.slots.set(row.id, "P1").set("k", "K");
      await rr([n2], 3);
      // N1 is set up: the profile brought both accounts, no secrets round has run yet; the user removes one at once.
      const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      await removeOnPurpose(n1, row.id);
      await rr([n1, n2], 2);
      removedByProfile(n2, row.id);
      await rr([n1, n2], 4);
      expect(entryOf(row)?.tombstone, "the password of a removed account left in the document").toBe(true);
    });

    it(`P7 ${row.id}: no skew — removed, added again elsewhere with a new password, removed again before that entry was seen`, async () => {
      remote = null;
      clock = 0;
      const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
      n1.slots.set(row.id, "P1").set("k", "K");
      await rr([n1, n2], 3);
      await removeOnPurpose(n2, row.id);
      removedByProfile(n1, row.id);
      await rr([n1, n2], 3);
      // Added again on N1 with a new password; the profile brings it to N2, which removes it again before its next secrets round.
      n1.rows.push({ ...row });
      n1.slots.set(row.id, "P2");
      await rr([n1], 2);
      n2.rows.push({ ...row });
      await removeOnPurpose(n2, row.id);
      await rr([n2, n1], 2);
      removedByProfile(n1, row.id);
      await rr([n1, n2], 4);
      expect(entryOf(row)?.tombstone, "the password of the account removed again left in the document").toBe(true);
    });

    for (const skew of [0, -3 * 3600_000]) {
      it(`P3 ${row.id} skew ${skew / 3600_000}h: an account added again on purpose on a device whose clock runs behind`, async () => {
        remote = null;
        clock = 0;
        const n1 = device("N1", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
        const n2 = device("N2", "new", [row, { id: "k", user: "keep", kind: row.kind }], skew, "on");
        const n3 = device("N3", "new", [row, { id: "k", user: "keep", kind: row.kind }], 0, "on");
        n1.slots.set(row.id, "P1").set("k", "K");
        await rr([n1, n2, n3], 3);
        await removeOnPurpose(n1, row.id);
        removedByProfile(n2, row.id);
        removedByProfile(n3, row.id);
        await rr([n1, n2, n3], 3);
        // Ten minutes later the user adds it again on N2 and types its password.
        clock += 600;
        n2.rows.push({ ...row });
        n2.slots.set(row.id, "P9");
        await rr([n2, n1], 2);
        // The profile brings it to N1 and N3.
        n1.rows.push({ ...row });
        n3.rows.push({ ...row });
        await rr([n1, n2, n3], 4);
        expect([n1.slots.get(row.id), n3.slots.get(row.id)]).toEqual(["P9", "P9"]);
      });
    }
  }
});

/** The seeds the review named, with the mode it ran them in; each must stay green. */
const NAMED: Array<[number, string, string]> = [
  [4617, "profile,away", "a device repairs an address and removes the account at once: no record under the new name"],
  [5083, "profile,away", "removed, added again with a new password, removed again before that entry was seen"],
  [2381, "profile,away", "a 0.9.0 tombstone wins the tie: a password typed here still goes out"],
  [84, "all", "the remover's clock three hours behind, a password typed elsewhere at the same time"],
  [1829, "all", "two 0.9.0 devices after a repair on an updated one (the loss is between the two 0.9.0 devices)"],
];
/**
 * Named limit: two acts that never saw each other — a password changed on
 * one device, the account removed on another that knew an older password of
 * it — are ordered by the clocks of the two devices, the last tie-breaker
 * (`RemovalState`). With clocks hours apart the later act can lose. Of
 * 13 000 seeds run for the review, 56 ended so, all with clocks apart; each
 * of these, run with the very same steps and the clocks together, holds.
 */
const CLOCK_ORDERED: Array<[number, string]> = [[305, "skew"], [312, "skew"], [380, "skew"]];
/** Seeds per mode in every CI run (about a minute on the CI runner). */
const RANGES: Array<[string, number]> = [["all", 120], ["profile,away", 60], ["profile,away,keyloss", 60]];

describe("random fleets around what takes an account away (review 2026-11-25)", () => {
  for (const [seed, mode, what] of NAMED) {
    it(`seed ${seed} (${mode}): ${what}`, async () => {
      const out = await fuzz(seed, mode);
      expect(out.problems, out.log.join("\n")).toEqual([]);
    });
  }
  for (const [seed, mode] of CLOCK_ORDERED) {
    it(`seed ${seed} (${mode}): only the order of two device clocks decides it (named limit)`, async () => {
      const apart = await fuzz(seed, mode);
      const together = await fuzz(seed, mode, true);
      expect(apart.problems.length).toBeGreaterThan(0);
      expect(apart.problems.every((line) => /still has a password|but the document has a tombstone/.test(line))).toBe(true);
      expect(together.log.slice(1)).toEqual(apart.log.slice(1));
      expect(together.problems).toEqual([]);
    });
  }
  for (const [mode, count] of RANGES) {
    it(`seeds 1–${count} (${mode})`, async () => {
      const found: string[] = [];
      for (let seed = 1; seed <= count; seed++) {
        const out = await fuzz(seed, mode);
        if (out.problems.length) found.push(`--- seed ${seed}\n${out.log.join("\n")}\n${out.problems.join("\n")}`);
      }
      expect(found).toEqual([]);
    }, 300_000);
  }
});
