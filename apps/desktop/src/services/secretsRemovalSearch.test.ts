import { describe, expect, it } from "vitest";
import { canonicalSecretId, canonicalizeEndpoint, mergeSecretsBundles, stableStringify, type SecretBinding, type SecretsBundle } from "@plainva/core";
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
 * A complete search in a small frame (review 2026-11-25, second round): with
 * the real port, every sequence of steps up to a fixed depth, for two or three
 * devices (updated, on 0.9.0, on 0.8.7) and one account (a calendar or a
 * mailbox). The rules it holds: `docs/engineering/Secrets_Removal_Rules.md`.
 *
 * Steps: a password typed, the account removed on purpose, added again,
 * signed out here, its address repaired (to the other of two addresses, so
 * twice is back to the old one, or to a third) — and a settings cycle of a device
 * with each outcome its code allows (`settingsSyncStepOrder.test.ts`, both
 * shells): profile and secrets both go through; the profile goes through and
 * the secrets step fails (caught, the cycle goes on); the profile is read in
 * and its upload fails (the error ends the cycle, no secrets); nothing goes
 * through; the profile goes out only with the next cycle (the act came after
 * this cycle's profile step: this cycle reads the profile and runs the
 * secrets, its own change waits). A failing profile step never lets the
 * secrets step run.
 *
 * After every step: (1) the port empties no slot of an account still on a
 * device unless that account was removed on purpose; (3) a slot signed out
 * on an updated device stays signed out. After every step, once every device
 * has run its cycles until nothing changes: (2) an account an updated device
 * removed on purpose, and nobody added again, has no password in the
 * document under its name — nor under the old name a device up to 0.8.7
 * holds it by, where the remover knew that name; (4) every password an
 * updated device holds for an account on it is in the document; (5) a
 * password in the document reaches every device that has the account and is
 * not signed out there, except one typed there and never received; and no
 * device uploads anything more, nor reads the document in full. Each exception is named below, with its
 * reason, and checked to be what it says.
 */

const URLS = { a: "https://cloud.example.com/remote.php/dav", b: "https://dav.example.org/remote.php/dav", c: "https://cal.example.net/dav" } as const;
const HOSTS = { a: "imap.example.com", b: "mail.example.org", c: "imap.example.net" } as const;
type At = keyof typeof URLS;
type Row = { id: string; user: string; kind?: "mail"; at?: At };
type Kind = "new" | "v090" | "v087";
type Slot = string | { signedOut: true };
type Outcome = "full" | "profileOnly" | "pullOnly" | "nothing" | "late";
/**
 * The account's state in the settings profile: the latest act on it wins (a
 * counter, then the device — as the profile orders acts that never saw each
 * other, `laterAccountAct`). The profile knows two acts, "removed" and
 * "revived" (added again); an edit of the account — its address repaired —
 * is no act and revives nothing: it travels with the account's row, the last
 * one pushed wins (`Address`).
 */
type ProfileAct = { seq: number; by: string; present: boolean; row: Row };
type Address = { at: At | undefined; t: number };
const later = (a: ProfileAct | null, b: ProfileAct | null) => !!a && (!b || a.seq > b.seq || (a.seq === b.seq && a.by > b.by));

const oldBinding = (row: Row): SecretBinding =>
  row.kind === "mail"
    ? { family: "imap", service: "mail", secretType: "imap-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(`imaps://${HOSTS[row.at ?? "a"]}:993`) }
    : { family: "webdav", service: "calendar", secretType: "caldav-password", user: row.user.trim().toLowerCase(), endpoint: canonicalizeEndpoint(URLS[row.at ?? "a"]) };
const newBinding = (row: Row): SecretBinding =>
  row.kind === "mail" ? imapSecretBinding("imap", HOSTS[row.at ?? "a"], 993, row.user) : calDavSecretBinding("webdav", URLS[row.at ?? "a"], row.user);
const newId = (row: Row) => canonicalSecretId(newBinding(row));
const oldId = (row: Row) => v087.canonicalSecretId(oldBinding(row) as never);

interface Dev {
  name: string;
  kind: Kind;
  rows: Row[];
  slots: Record<string, Slot>;
  keyring: Record<string, unknown>;
  meta: SecretsPortMeta | null;
  retired: SecretsPortMeta["retired"] | null;
  /** Its own acts not pushed yet, by account. */
  pending: Record<string, ProfileAct>;
  /** The act this device's account list reflects, by account. */
  known: Record<string, ProfileAct>;
  /** Its own address edits not pushed yet, and the edit its rows reflect, by account. */
  pendingAt: Record<string, Address>;
  knownAt: Record<string, number>;
  signedOut: string[];
  /** Slots the port wrote (a password received through the sync) since the account came to this device. */
  taken: Record<string, true>;
  /**
   * On 0.9.0 and 0.8.7: a slot whose password came through the sync, its
   * address repaired since. Those versions know "received" by name, so under
   * the new name the slot counts as typed there (their rule).
   */
  renamed: Record<string, true>;
  /** On 0.9.0 and 0.8.7: an account this device removed itself, its slot empty since. */
  selfRemoved: Record<string, true>;
  /**
   * On an updated device, since its last secrets round: a password typed, an
   * address repaired. Both together are a password typed in the save that
   * repaired the account: typed here from that round on (rule R, review
   * 2026-11-26, fifth round).
   */
  typedSince: Record<string, true>;
  movedSince: Record<string, true>;
  /** The calendar runtime is not up: calendar rows are missing from the list, and the list is not whole. */
  calendarDown?: boolean;
}
interface World {
  devs: Dev[];
  remote: SecretsBundle | null;
  /** The accounts in the profile document: the latest act on each, and the address of its row. */
  profile: Record<string, ProfileAct>;
  profileAt: Record<string, Address>;
  /** The order of address edits (the profile's last push wins). */
  edits: number;
  clock: number;
  n: number;
  /** Each removal on purpose by an updated device, by its act: the name the remover had, and whether it knew the old one. */
  removals: Record<string, { by: string; row: Row; knewOld: boolean }>;
  /** Removals on purpose on 0.9.0, with their act: they count as removals of the device once it updates (rule U2). */
  oldRemovals: Array<{ by: string; row: Row; act: ProfileAct }>;
  /** Accounts removed on purpose by any device and not added again. */
  removedAny: Record<string, true>;
  /** Accounts removed on purpose at any point. */
  everRemoved: Record<string, true>;
  pushes: number;
  /** Imports of an updated device that ran in full (not settled). */
  fullImports: number;
  /** Devices that left the fleet (the vault forgotten, the device never used again): they run no more cycles. */
  gone: string[];
  /** Devices whose profile step never brings anything (the profile off there): their secrets still run. */
  profileOff: string[];
  problems: string[];
  trace: string[];
}

let w: World;
const time = () => new Date(Date.parse("2026-11-25T00:00:00.000Z") + 1000 * w.clock++).toISOString();
const dev = (name: string) => w.devs.find((d) => d.name === name)!;

function metaHost(d: Dev) {
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
const retiredHost = (d: Dev) => ({
  readMeta: async (): Promise<SecretsPortMeta | null> => ({ entries: {}, imported: {}, quarantine: {}, retired: structuredClone(d.retired ?? {}) }),
  writeMeta: async (meta: SecretsPortMeta) => {
    d.retired = structuredClone(meta.retired ?? {});
  },
});

function portOf(d: Dev) {
  const listed = () => d.rows.filter((row) => !(d.calendarDown && row.kind !== "mail"));
  const host = {
    deviceId: async () => d.name,
    ...metaHost(d),
    candidates: async () =>
      listed().map((row) => {
        const binding = d.kind === "v087" ? oldBinding(row) : newBinding(row);
        const slot = d.slots[row.id];
        return {
          logicalId: d.kind === "v087" ? v087.canonicalSecretId(binding as never) : canonicalSecretId(binding),
          slot: row.id,
          binding,
          secret: typeof slot === "string" ? { pass: slot } : null,
          ...(typeof slot === "object" ? { signedOutHere: true } : {}),
          apply: (secret: Record<string, string>) => secret.pass,
        } as LocalSecretCandidate;
      }),
    accountsReady: async (service: string) => service === "mail" || !d.calendarDown,
    readSlot: async (slot: string) => (slot === SECRETS_MARK_KEY_SLOT ? d.keyring[slot] : d.slots[slot]) ?? null,
    writeSlot: async (slot: string, value: unknown) => {
      if (slot === SECRETS_MARK_KEY_SLOT) d.keyring[slot] = value;
      else {
        d.slots[slot] = value as string;
        if (d.rows.some((row) => row.id === slot)) d.taken[slot] = true;
        delete d.renamed[slot];
        delete d.selfRemoved[slot];
      }
    },
    removeSlot: async (slot: string) => {
      const row = d.rows.find((item) => item.id === slot);
      if (row && typeof d.slots[slot] === "string" && !w.removedAny[row.id]) {
        const by = w.remote?.entries[newId(row)]?.deviceId;
        // Named exception (frozen versions, `EXCEPTIONS`): a device on 0.9.0
        // applies a removal tombstone to an account added again meanwhile, by
        // its stale mark of an import.
        const raceOnOld = d.kind !== "new" && !!w.everRemoved[row.id] && !!by && dev(by).kind === "new";
        if (!raceOnOld) w.problems.push(`(1) ${d.name}(${d.kind}) port emptied ${row.id} [${w.trace.join(" / ")}]`);
      }
      delete d.slots[slot];
    },
    now: time,
  };
  if (d.kind === "v087") return { kind: "v087" as const, port: v087.createSecretsPort(host as never) };
  if (d.kind === "v090") return { kind: "v090" as const, port: v090.createSecretsPort(host as never) };
  return { kind: "new" as const, port: createSecretsPort(host) };
}

async function secretsRound(d: Dev): Promise<void> {
  const { kind, port } = portOf(d);
  const t = time();
  if (kind === "v087") {
    const next = await v087.runV087Round(port as never, w.remote as never, t);
    if (next.pushed) w.pushes++;
    w.remote = next.remote as SecretsBundle;
    return;
  }
  if (kind === "v090") {
    const next = await v090.runV090Round(port as never, w.remote as never, t);
    if (next.pushed) w.pushes++;
    w.remote = next.remote as SecretsBundle;
    return;
  }
  const current = port as ReturnType<typeof createSecretsPort>;
  // Rule R: the repair carries "received" only for the password the device knew under the old name.
  for (const row of d.rows) {
    if (row.kind !== "mail" && d.calendarDown) continue;
    if (d.movedSince[row.id] && d.typedSince[row.id]) delete d.taken[row.id];
    delete d.movedSince[row.id];
    delete d.typedSince[row.id];
  }
  const local = await current.exportBundle();
  const merged = mergeSecretsBundles(local, w.remote, t);
  if (stableStringify(merged.entries) !== stableStringify(local.entries) || current.awaitsDocument?.()) {
    if (!(await current.importBundle(merged)).settled) w.fullImports++;
  }
  if (!w.remote || stableStringify(merged.entries) !== stableStringify(w.remote.entries)) {
    w.pushes++;
    w.remote = merged;
  }
}

/** The profile step's upload: this device's act, when it is the latest. */
function pushProfile(d: Dev): void {
  for (const [id, mine] of Object.entries(d.pending)) if (later(mine, w.profile[id] ?? null)) w.profile[id] = mine;
  d.pending = {};
  for (const [id, mine] of Object.entries(d.pendingAt)) w.profileAt[id] = mine;
  d.pendingAt = {};
}

/** An address repaired on a device of an older version: "received" was by name there. */
function moved(d: Dev, id: string): void {
  if (d.kind !== "new" && d.taken[id]) d.renamed[id] = true;
  if (d.kind === "new") d.movedSince[id] = true;
}

/** The profile import of a device: the account as the latest act left it. */
async function pullProfile(d: Dev): Promise<void> {
  for (const [id, act] of Object.entries(w.profile)) {
    if (!later(act, d.known[id] ?? null) || (d.pending[id] && later(d.pending[id], act))) continue;
    d.known[id] = act;
    const mine = d.rows.find((item) => item.id === id);
    if (!act.present && mine) {
      d.rows = d.rows.filter((item) => item.id !== id);
      // A calendar's slot goes with its row on every version; a mailbox's from this version on.
      if (mine.kind !== "mail" || d.kind === "new") delete d.slots[id];
      d.signedOut = d.signedOut.filter((item) => item !== id);
      delete d.taken[id];
      if (d.kind === "new") await noteSecretLeftWithProfile(retiredHost(d), newBinding(mine));
    } else if (act.present && !mine) {
      d.rows.push({ ...act.row, at: w.profileAt[id]?.at ?? act.row.at });
      if (w.profileAt[id]) d.knownAt[id] = w.profileAt[id].t;
    }
  }
  // An address repaired elsewhere reaches a device that has the account.
  for (const [id, address] of Object.entries(w.profileAt)) {
    const mine = d.rows.find((item) => item.id === id);
    if (!mine || (d.knownAt[id] ?? -1) >= address.t || d.pendingAt[id]) continue;
    d.knownAt[id] = address.t;
    if (mine.at !== address.at) moved(d, id);
    mine.at = address.at;
  }
}

/** An address repaired on this device: no act, an edit of the row its next push carries. */
function edit(d: Dev, row: Row): void {
  const address = { at: row.at, t: ++w.edits };
  d.pendingAt[row.id] = address;
  d.knownAt[row.id] = address.t;
}

async function cycle(d: Dev, outcome: Outcome): Promise<void> {
  if (outcome === "nothing") return;
  if (w.profileOff.includes(d.name)) return void (outcome === "full" || outcome === "late" ? await secretsRound(d) : undefined);
  if (outcome !== "late" && outcome !== "pullOnly") pushProfile(d);
  await pullProfile(d);
  if (outcome === "full" || outcome === "late") await secretsRound(d);
}

/** A local act on the account: the device's account list changes at once, the profile with its next push. */
function act(d: Dev, present: boolean, row: Row): ProfileAct {
  const seq = Math.max(d.known[row.id]?.seq ?? 0, d.pending[row.id]?.seq ?? 0, 0) + 1;
  const mine = { seq, by: d.name, present, row: { ...row } };
  d.pending[row.id] = mine;
  d.known[row.id] = mine;
  return mine;
}
const removalKey = (act: ProfileAct) => `${act.row.id}:${act.seq}:${act.by}`;

const password = (row: Row) => `${row.id}${++w.n}`;
type Step = { label: string; run: () => Promise<void> };

async function removeOnPurpose(d: Dev, row: Row): Promise<void> {
  const take = async () => {
    d.rows = d.rows.filter((item) => item.id !== row.id);
    delete d.slots[row.id];
    delete d.taken[row.id];
    if (d.kind !== "new") d.selfRemoved[row.id] = true;
    d.signedOut = d.signedOut.filter((id) => id !== row.id);
  };
  const knew = d.meta?.entries[oldId(row)];
  const removal = act(d, false, row);
  if (d.kind === "new") {
    w.removals[removalKey(removal)] = { by: d.name, row: { ...row }, knewOld: !!knew && !knew.tombstone };
    await retireSecret(retiredHost(d), newBinding(row), take, time());
  } else {
    if (d.kind === "v090" && row.kind !== "mail") await v090.retireSecret(retiredHost(d) as never, newBinding(row) as never);
    if (d.kind === "v090") w.oldRemovals.push({ by: d.name, row: { ...row }, act: removal });
    await take();
  }
  w.removedAny[row.id] = true;
  w.everRemoved[row.id] = true;
}

/** Every step possible in this world. */
function steps(accts: Row[], withRuntime: boolean, anew = false): Step[] {
  const out: Step[] = [];
  for (const [index, acct] of accts.entries()) {
    // The first account's steps carry no suffix; another account's carry its id.
    const of = index === 0 ? "" : ` ${acct.id}`;
    for (const d of w.devs) {
      const name = d.name;
      const row = () => dev(name).rows.find((item) => item.id === acct.id);
      // An address another account of that user holds is that account's name
      // (two accounts, one name: a named limit, not searched).
      const othersAt = (at: At) => w.devs.some((other) => other.rows.some((item) => item.id !== acct.id && item.user === acct.user && (item.kind ?? "") === (acct.kind ?? "") && (item.at ?? "a") === at));
      if (row()) {
        out.push({ label: `${name} types${of}`, run: async () => {
          const me = dev(name);
          me.slots[acct.id] = password(acct);
          me.typedSince[acct.id] = true;
          delete me.selfRemoved[acct.id];
          me.signedOut = me.signedOut.filter((id) => id !== acct.id);
        } });
        out.push({ label: `${name} removes${of}`, run: () => removeOnPurpose(dev(name), row()!) });
        // A repair to the other of two addresses (twice: back to the old one),
        // and to a third one.
        if (!othersAt(row()!.at === "b" ? "a" : "b")) out.push({ label: `${name} repairs${of}`, run: async () => {
          const mine = row()!;
          mine.at = mine.at === "b" ? "a" : "b";
          moved(dev(name), acct.id);
          edit(dev(name), mine);
        } });
        if (row()!.at !== "c" && !othersAt("c")) {
          out.push({ label: `${name} repairs to c${of}`, run: async () => {
            const mine = row()!;
            mine.at = "c";
            moved(dev(name), acct.id);
            edit(dev(name), mine);
          } });
        }
        // Removed, and another account of that user connected at another
        // server in its place (the way 0.9.0 on the desktop changes a
        // mailbox's servers; review 2026-11-27, sixth round, S1).
        const freeAt = (mine: Row) => (["a", "b", "c"] as At[]).find((at) => at !== (mine.at ?? "a") && !w.devs.some((other) => other.rows.some((item) => item.user === mine.user && (item.at ?? "a") === at)));
        if (anew && freeAt(row()!) && !w.devs.some((other) => other.rows.some((item) => item.id === `${acct.id}n`))) {
          out.push({ label: `${name} connects anew${of}`, run: async () => {
            const me = dev(name);
            const mine = row()!;
            const target = freeAt(mine)!;
            await removeOnPurpose(me, mine);
            const fresh: Row = { id: `${acct.id}n`, user: acct.user, kind: acct.kind, at: target };
            me.rows.push(fresh);
            me.slots[fresh.id] = password(fresh);
            me.typedSince[fresh.id] = true;
            act(me, true, fresh);
            edit(me, fresh);
          } });
        }
        if (d.kind === "new" && typeof d.slots[acct.id] === "string") {
          out.push({ label: `${name} signs out${of}`, run: async () => {
            const me = dev(name);
            me.slots[acct.id] = { signedOut: true };
            me.signedOut.push(acct.id);
          } });
        }
      } else if (!othersAt(acct.at ?? "a")) {
        out.push({ label: `${name} adds it again${of}`, run: async () => {
          const me = dev(name);
          const back = { ...acct, at: acct.at ?? ("a" as At) };
          me.rows.push(back);
          me.slots[acct.id] = password(acct);
          me.typedSince[acct.id] = true;
          delete me.selfRemoved[acct.id];
          delete w.removedAny[acct.id];
          act(me, true, back);
          edit(me, back);
        } });
      }
    }
  }
  for (const d of w.devs) {
    const name = d.name;
    for (const outcome of ["full", "profileOnly", "pullOnly", "nothing", "late"] as Outcome[]) {
      if (outcome === "nothing") continue; // a cycle that does nothing changes nothing
      out.push({ label: `${name} cycle:${outcome}`, run: () => cycle(dev(name), outcome) });
    }
    // The app on 0.9.0 updated, before or after its next round.
    if (anew && d.kind === "v090") {
      out.push({ label: `${name} updates`, run: async () => {
        const me = dev(name);
        me.kind = "new";
        // A removal there is the device's from now on; as the last account of
        // the device it stays as 0.9.0 left it (named limit), so only one
        // beside another account counts.
        for (const old of w.oldRemovals.filter((item) => item.by === name)) {
          if (me.rows.length > 0) w.removals[removalKey(old.act)] = { by: name, row: old.row, knewOld: false };
        }
        w.oldRemovals = w.oldRemovals.filter((item) => item.by !== name);
      } });
    }
    if (withRuntime && d.kind === "new" && accts.some((acct) => acct.kind !== "mail")) {
      out.push({ label: `${name} runtime ${d.calendarDown ? "up" : "down"}`, run: async () => void (dev(name).calendarDown = !dev(name).calendarDown) });
    }
  }
  return out;
}

const state = () => stableStringify({ devs: w.devs, remote: w.remote, profile: w.profile, profileAt: w.profileAt });
const accountsOf = (frame: Frame) => [frame.acct, ...(frame.others ?? []).map((other) => other.row)];

/** Statement (3), after every step. */
function checkStep(): void {
  for (const d of w.devs) {
    if (d.kind !== "new") continue;
    for (const id of d.signedOut) if (typeof d.slots[id] !== "object" && d.rows.some((row) => row.id === id)) w.problems.push(`(3) ${d.name} signed in ${id} again [${w.trace.join(" / ")}]`);
  }
}

/** Every device runs its cycles until nothing changes; then (2), (4), (5) and no further upload. */
async function checkRest(accts: Row[]): Promise<void> {
  for (const d of w.devs) d.calendarDown = false;
  let before = "";
  const active = w.devs.filter((d) => !w.gone.includes(d.name));
  for (let i = 0; i < 10 && before !== state(); i++) {
    before = state();
    for (const d of active) await cycle(d, "full");
    checkStep();
  }
  w.pushes = 0;
  w.fullImports = 0;
  for (let i = 0; i < 2; i++) for (const d of active) await cycle(d, "full");
  const where = `[${w.trace.join(" / ")}]`;
  if (w.pushes) w.problems.push(`rest: ${w.pushes} uploads after settling ${where}`);
  // …and no import in full any more: a round that changes nothing reads nothing in full.
  if (w.fullImports) w.problems.push(`rest: ${w.fullImports} full imports after settling ${where}`);
  // (2): the profile ended with a removal on purpose by an updated device —
  // the account is on no device; under the name the remover had, no password.
  for (const acct of accts) {
    const final = w.profile[acct.id];
    const last = final && !final.present ? w.removals[removalKey(final)] : undefined;
    if (last) {
      const holders = w.devs.filter((d) => d.rows.some((row) => row.id === acct.id));
      // Named exception (frozen versions, `OLD_DEVICE_EXCEPTIONS`): a device
      // on 0.9.0 or 0.8.7 that held the account as its only one, with a
      // password typed there, publishes it again above the tombstone before its
      // profile takes the account — and its empty list then writes no
      // tombstone (their guard against a list still loading).
      const onlyAccountOfOld = (entry: { deviceId: string } | undefined) => !!entry && dev(entry.deviceId)?.kind !== "new" && dev(entry.deviceId).rows.length === 0;
      // Every address of the account, not only the remover's: an address
      // repaired on another device meanwhile, and the one before a repair.
      // The address of another account of that user, connected anew there, is that account's name.
      const otherAccountAt = (at: At) => w.devs.some((d) => d.rows.some((row) => row.id !== acct.id && row.user === acct.user && (row.kind ?? "") === (acct.kind ?? "") && (row.at ?? "a") === at));
      for (const at of ["a", "b", "c"] as At[]) {
        const current = w.remote?.entries[newId({ ...last.row, at })];
        if (!current || current.tombstone || onlyAccountOfOld(current) || otherAccountAt(at)) continue;
        w.problems.push(`(2) removed ${acct.id}@${at}: a password under its name [holders ${holders.map((h) => h.name).join(",") || "none"}] ${where}`);
      }
      const old = w.remote?.entries[oldId(last.row)];
      // Named exception: the old place stays where the remover did not know the old name.
      if (last.knewOld && old && !old.tombstone && !onlyAccountOfOld(old)) w.problems.push(`(2) removed ${acct.id}@${last.row.at ?? "a"}: a password under its old name ${where}`);
    }
  }
  for (const d of active) {
    if (d.kind !== "new") continue;
    for (const row of d.rows) {
      if (typeof d.slots[row.id] !== "string") continue;
      const entry = w.remote?.entries[newId(row)];
      if (!entry || entry.tombstone) w.problems.push(`(4) ${d.name} holds ${row.id}@${row.at ?? "a"} but the document has ${entry ? "a tombstone" : "nothing"} ${where}`);
    }
  }
  // (5): a password in the document reaches every device that has the
  // account and is not signed out there — on 0.9.0 and 0.8.7 by their rules,
  // under the name they read. The one slot it does not replace is the rule of
  // every version: a password typed on a device and never received there
  // through the sync is not replaced from elsewhere (`secretsFleet.test.ts`).
  // An updated device reads the old name too: a change made on 0.8.7 there
  // is taken (round eight) — and the current name may then still hold
  // another value (a finding, its case below).
  const value = (id: string) => {
    const entry = w.remote?.entries[id];
    return entry && !entry.tombstone ? (entry.secret as { pass?: string } | undefined)?.pass : undefined;
  };
  for (const d of active) {
    for (const row of d.rows) {
      if (d.signedOut.includes(row.id)) continue;
      const wants = d.kind === "v087" ? [value(oldId(row))] : d.kind === "v090" ? [value(newId(row))] : [value(newId(row)), value(oldId(row))];
      if (wants.every((want) => want === undefined)) continue;
      const have = d.slots[row.id];
      if (wants.includes(have as string | undefined)) continue;
      if (typeof have === "string" && !d.taken[row.id]) continue;
      // Named exceptions of the older versions (their rules): "received" by
      // name, lost with a repair on 0.9.0 and 0.8.7; there, an
      // account removed on the device itself and brought back by the profile
      // stays without its password until one is typed.
      if (typeof have === "string" && d.renamed[row.id]) continue;
      if (have === undefined && d.kind !== "new" && d.selfRemoved[row.id]) continue;
      w.problems.push(`(5) ${d.name}(${d.kind}) holds ${typeof have === "string" ? have : "nothing"} for ${row.id}@${row.at ?? "a"}, the document ${wants.filter(Boolean).join("/")} ${where}`);
    }
  }
}

interface Frame {
  name: string;
  kinds: Kind[];
  acct: Row;
  /** Further accounts, on the devices listed with each (none typed at the start). */
  others?: Array<{ row: Row; on: number[] }>;
  depth: number;
  /** Who typed the first password (settled before the search starts). */
  typer: number;
  /** The calendar runtime may stop and start on updated devices. */
  runtime?: boolean;
  /** Devices that got the account through the profile and have run no secrets round yet. */
  fresh?: number[];
  /** The steps "connects anew" and, for a device on 0.9.0, "updates". */
  anew?: boolean;
}

async function setup(frame: Frame): Promise<void> {
  w = { devs: frame.kinds.map((kind, i) => ({ name: `D${i}`, kind, rows: [{ ...frame.acct }, ...(frame.others ?? []).filter((other) => other.on.includes(i)).map((other) => ({ ...other.row }))], slots: {}, keyring: {}, meta: null, retired: null, pending: {}, known: {}, pendingAt: {}, knownAt: {}, signedOut: [], taken: {}, renamed: {}, selfRemoved: {}, typedSince: {}, movedSince: {} })), remote: null, profile: {}, profileAt: {}, edits: 0, clock: 0, n: 0, removals: {}, oldRemovals: [], removedAny: {}, everRemoved: {}, pushes: 0, fullImports: 0, gone: [], profileOff: [], problems: [], trace: [] };
  w.devs[frame.typer].slots[frame.acct.id] = password(frame.acct);
  for (let i = 0; i < 3; i++) for (const [index, d] of w.devs.entries()) if (!frame.fresh?.includes(index)) await cycle(d, "full");
  w.clock += 10;
}

async function search(frame: Frame): Promise<{ nodes: number; problems: string[] }> {
  await setup(frame);
  const root = structuredClone(w);
  let nodes = 0;
  const problems = new Set<string>();
  const walk = async (at: World, depth: number) => {
    w = structuredClone(at);
    for (const step of steps(accountsOf(frame), !!frame.runtime, !!frame.anew)) {
      w = structuredClone(at);
      const before = state();
      w.trace.push(step.label);
      await step.run();
      checkStep();
      if (state() === before) continue;
      nodes++;
      const after = structuredClone(w);
      await checkRest(accountsOf(frame));
      for (const problem of w.problems) problems.add(problem);
      if (depth > 1) await walk(after, depth - 1);
    }
  };
  await walk(root, frame.depth);
  return { nodes, problems: [...problems] };
}

const CAL: Row = { id: "c", user: "cora" };
const MAIL: Row = { id: "m", user: "mira@example.com", kind: "mail" };

const FRAMES: Frame[] = [
  { name: "two updated devices, a calendar", kinds: ["new", "new"], acct: CAL, depth: 4, typer: 0, runtime: true },
  { name: "two updated devices, a mailbox", kinds: ["new", "new"], acct: MAIL, depth: 4, typer: 1 },
  { name: "an updated device and one on 0.9.0, a calendar", kinds: ["new", "v090"], acct: CAL, depth: 4, typer: 1 },
  { name: "an updated device and one on 0.9.0, a mailbox", kinds: ["new", "v090"], acct: MAIL, depth: 4, typer: 0 },
  { name: "an updated device and one on 0.8.7, a mailbox", kinds: ["new", "v087"], acct: MAIL, depth: 4, typer: 1 },
  { name: "three devices (two updated, one on 0.9.0), a calendar", kinds: ["new", "new", "v090"], acct: CAL, depth: 3, typer: 2 },
  { name: "a device on 0.9.0 that updates and an updated one, a mailbox connected anew (sixth round)", kinds: ["v090", "new"], acct: MAIL, depth: 3, typer: 0, anew: true },
  { name: "a device on 0.9.0 that updates and an updated one, a calendar connected anew (sixth round)", kinds: ["v090", "new"], acct: CAL, depth: 3, typer: 0, anew: true },
];

describe("every sequence of steps up to a depth, with the real port (review 2026-11-25, second round)", () => {
  for (const frame of FRAMES) {
    it(`${frame.name}, depth ${frame.depth}`, async () => {
      const { nodes, problems } = await search(frame);
      expect(nodes).toBeGreaterThan(50);
      expect(problems.slice(0, 20)).toEqual([]);
    }, 600_000);
  }
});

/** The probes of both review rounds, in the steps of this search; each must hold. */
const PROBES: Array<{ name: string; frame: Frame; steps: string[] }> = [
  // Q6: B changes the password offline; A removes the account; B's cycle runs before A's next one.
  { name: "Q6 (a password changed offline goes out between the removal and the remover's cycle)", frame: { name: "", kinds: ["new", "new"], acct: MAIL, depth: 0, typer: 0 }, steps: ["D1 types", "D0 removes", "D1 cycle:full", "D0 cycle:full", "D1 cycle:full"] },
  { name: "Q6, calendar, typed after the act", frame: { name: "", kinds: ["new", "new"], acct: CAL, depth: 0, typer: 0 }, steps: ["D0 removes", "D1 types", "D1 cycle:full", "D0 cycle:full"] },
  // Q1: added again after a failed secrets step, on a device that had imported the old password.
  { name: "Q1 (added again after a failed secrets step)", frame: { name: "", kinds: ["new", "new", "new"], acct: MAIL, depth: 0, typer: 2 }, steps: ["D2 types", "D2 cycle:full", "D0 cycle:full", "D0 removes", "D0 cycle:full", "D2 cycle:full", "D1 cycle:profileOnly", "D1 adds it again", "D1 cycle:full"] },
  // Q3: a password put above a tombstone while the calendar runtime is not up.
  { name: "Q3 (the runtime not up)", frame: { name: "", kinds: ["new", "new", "v090"], acct: CAL, depth: 0, typer: 1 }, steps: ["D1 types", "D0 removes", "D0 cycle:late", "D1 cycle:full", "D1 runtime down", "D1 cycle:full", "D1 cycle:full", "D2 cycle:full"] },
  // Q4: only a device on 0.8.7 published; an updated device removes before its first secrets round.
  { name: "Q4 (only 0.8.7 published)", frame: { name: "", kinds: ["v087", "new"], acct: MAIL, depth: 0, typer: 0, fresh: [1] }, steps: ["D1 removes", "D1 cycle:full", "D1 cycle:full", "D1 cycle:full"] },
  // P5: the remover's secrets run only after the account was added again elsewhere.
  { name: "P5 (added again while the remover's secrets wait)", frame: { name: "", kinds: ["new", "new"], acct: CAL, depth: 0, typer: 0 }, steps: ["D0 removes", "D0 cycle:profileOnly", "D1 cycle:full", "D1 adds it again", "D1 cycle:full", "D0 cycle:full"] },
  // P6: removed on a device that got the account through the profile, before any secrets round.
  { name: "P6 (removed before the remover ever saw the entry)", frame: { name: "", kinds: ["new", "new"], acct: MAIL, depth: 0, typer: 1, fresh: [0] }, steps: ["D0 removes", "D0 cycle:full", "D1 cycle:full", "D0 cycle:full"] },
  // P7: removed, added again with a new password, removed again before that entry was seen.
  { name: "P7 (removed again before the new password was seen)", frame: { name: "", kinds: ["new", "new"], acct: CAL, depth: 0, typer: 0 }, steps: ["D1 removes", "D1 cycle:full", "D0 cycle:full", "D0 adds it again", "D0 cycle:full", "D1 cycle:profileOnly", "D1 removes", "D1 cycle:full"] },
  // P1: a device away changes the password before the removal.
  { name: "P1 (changed while away, before the removal)", frame: { name: "", kinds: ["new", "new"], acct: CAL, depth: 0, typer: 0 }, steps: ["D1 types", "D0 removes", "D0 cycle:full", "D1 cycle:full"] },
  // P3: an account added again on purpose after the removal was confirmed.
  { name: "P3 (added again after the removal was seen)", frame: { name: "", kinds: ["new", "new"], acct: MAIL, depth: 0, typer: 0 }, steps: ["D0 removes", "D0 cycle:full", "D1 cycle:full", "D1 adds it again", "D1 cycle:full", "D0 cycle:full"] },
];

async function runCase(frame: Frame, labels: string[], gone: string[] = [], profileOff: string[] = []): Promise<World> {
  await setup(frame);
  w.profileOff = profileOff;
  for (const label of labels) {
    const step = steps(accountsOf(frame), true).find((item) => item.label === label);
    expect(step, label).toBeDefined();
    w.trace.push(label);
    await step!.run();
    checkStep();
  }
  w.gone = gone;
  await checkRest(accountsOf(frame));
  return w;
}

describe("the probes of both review rounds, as steps of the search", () => {
  for (const probe of PROBES) {
    it(probe.name, async () => {
      const world = await runCase(probe.frame, probe.steps);
      expect(world.problems).toEqual([]);
    });
  }
});

/**
 * Statement (5) where a password arrives before its account, or comes back
 * to a device that may not wait for it (review 2026-11-25, third round): two
 * accounts of one user and service at two addresses; the password of the
 * second goes out in a cycle whose profile step ran before the act, so it
 * reaches the other device one cycle before the account. Each case ends with
 * the password on every device that has the account, and quiet.
 */
describe("a password that arrives before its account", () => {
  const ANNA: Row = { id: "m", user: "anna@example.com", kind: "mail" };
  const SECOND: Row = { id: "n", user: "anna@example.com", kind: "mail", at: "b" };
  const placed = (world: World) => world.devs.map((d) => [d.name, d.slots[SECOND.id]]);
  const doc = (world: World) => (world.remote?.entries[newId(SECOND)]?.secret as { pass?: string } | undefined)?.pass;

  it("a second account of the same user, its password one cycle ahead", async () => {
    const world = await runCase({ name: "", kinds: ["new", "new"], acct: ANNA, others: [{ row: SECOND, on: [] }], depth: 0, typer: 0 }, ["D0 adds it again n", "D0 cycle:late", "D1 cycle:full", "D0 cycle:full", "D1 cycle:full"]);
    expect(world.problems).toEqual([]);
    expect(placed(world)).toEqual([["D0", doc(world)], ["D1", doc(world)]]);
  });

  it("…on a device that knew the name (the profile had taken the account from it)", async () => {
    const world = await runCase({ name: "", kinds: ["new", "new"], acct: ANNA, others: [{ row: SECOND, on: [0, 1] }], depth: 0, typer: 0 }, [
      "D0 types n", "D0 cycle:full", "D1 cycle:full",
      "D0 removes n", "D0 cycle:full", "D1 cycle:full", "D0 cycle:full",
      "D0 adds it again n", "D0 cycle:late", "D1 cycle:full", "D0 cycle:full", "D1 cycle:full",
    ]);
    expect(world.problems).toEqual([]);
    expect(placed(world)).toEqual([["D0", doc(world)], ["D1", doc(world)]]);
  });

  it("…on a device that removed that account itself", async () => {
    const world = await runCase({ name: "", kinds: ["new", "new"], acct: ANNA, others: [{ row: SECOND, on: [0, 1] }], depth: 0, typer: 0 }, [
      "D0 types n", "D0 cycle:full", "D1 cycle:full",
      "D1 removes n", "D1 cycle:full", "D0 cycle:full", "D1 cycle:full",
      "D0 adds it again n", "D0 cycle:late", "D1 cycle:full", "D0 cycle:full", "D1 cycle:full",
    ]);
    expect(world.problems).toEqual([]);
    expect(placed(world)).toEqual([["D0", doc(world)], ["D1", doc(world)]]);
  });

  it("the single account, added again after the removal was confirmed, reaches the remover", async () => {
    const world = await runCase({ name: "", kinds: ["new", "new"], acct: ANNA, depth: 0, typer: 0 }, ["D0 removes", "D0 cycle:full", "D1 cycle:full", "D0 cycle:full", "D1 adds it again", "D1 cycle:late", "D0 cycle:full", "D1 cycle:full", "D0 cycle:full"]);
    expect(world.problems).toEqual([]);
    expect(typeof dev("D1").slots[ANNA.id]).toBe("string");
    expect(world.devs.map((d) => d.slots[ANNA.id])).toEqual([dev("D1").slots[ANNA.id], dev("D1").slots[ANNA.id]]);
  });
});

/**
 * What is accepted, each with its steps (`docs/engineering/Secrets_Removal_Rules.md`,
 * "Named exceptions"): the case runs, and it ends exactly so.
 */
describe("named exceptions", () => {
  const frame = (kinds: Kind[], acct: Row, typer: number, fresh?: number[]): Frame => ({ name: "", kinds, acct, depth: 0, typer, ...(fresh ? { fresh } : {}) });
  const live = (row: Row, old = false) => {
    const entry = w.remote?.entries[old ? oldId(row) : newId(row)];
    return entry && !entry.tombstone ? entry : undefined;
  };

  it("a device on 0.9.0 or 0.8.7 holding the account as its only one publishes its own password again above the removal, and its empty list writes no tombstone", async () => {
    for (const [kind, acct] of [["v090", CAL], ["v087", MAIL]] as const) {
      const world = await runCase(frame(["new", kind], acct, 1), ["D0 removes", "D0 cycle:late", "D1 cycle:full", "D1 cycle:full"]);
      expect(world.problems).toEqual([]);
      const left = kind === "v087" ? live(acct, true) : live(acct);
      expect([left?.deviceId, dev("D1").rows.length]).toEqual(["D1", 0]);
    }
  });

  it("a device on 0.9.0 applies a removal to an account added again meanwhile (its stale mark of an import)", async () => {
    const world = await runCase(frame(["new", "v090"], MAIL, 0), ["D0 removes", "D1 removes", "D1 adds it again", "D1 cycle:late"]);
    expect(world.problems).toEqual([]);
    expect([dev("D1").rows.length, dev("D1").slots[MAIL.id]]).toEqual([1, undefined]);
  });

  it("the old place stays where the remover did not know the old name", async () => {
    const world = await runCase(frame(["v087", "new", "v087"], MAIL, 0, [1]), ["D1 removes", "D1 cycle:full"]);
    expect(world.problems).toEqual([]);
    expect(live(MAIL, true)).toBeDefined();
  });

  // Closed: the profile's removal takes back what the device published for
  // the account under every address it no longer has.
  it("a password put above a tombstone goes when the address was repaired before the profile took the account", async () => {
    const world = await runCase(frame(["new", "new"], MAIL, 0), ["D1 removes", "D1 cycle:late", "D0 cycle:full", "D0 cycle:full", "D0 repairs"]);
    expect(world.problems).toEqual([]);
    expect([live(MAIL), live({ ...MAIL, at: "b" })]).toEqual([undefined, undefined]);
  });

  it("the address a device repaired the account away from loses its password with the removal", async () => {
    const world = await runCase(frame(["new", "new"], CAL, 0), ["D0 repairs", "D0 cycle:full", "D1 cycle:full", "D1 removes"]);
    expect(world.problems).toEqual([]);
    expect([live(CAL), live({ ...CAL, at: "b" })]).toEqual([undefined, undefined]);
  });

  it("…the vault forgotten or the device never used again", async () => {
    const world = await runCase(frame(["new", "new"], CAL, 0), ["D1 removes", "D1 cycle:late", "D0 cycle:full", "D0 cycle:full"], ["D0"]);
    expect(world.problems.map((line) => line.replace(/ \[.*$/, ""))).toEqual(["(2) removed c@a: a password under its name"]);
    expect(live(CAL)?.deviceId).toBe("D0");
  });
});

/** The named exceptions and findings of the third round (`docs/engineering/Secrets_Removal_Rules.md`), each with its steps. */
describe("named exceptions, third round", () => {
  const frame = (kinds: Kind[], acct: Row, typer: number): Frame => ({ name: "", kinds, acct, depth: 0, typer });
  const valueOf = (id: string) => {
    const entry = w.remote?.entries[id];
    return entry ? ((entry.secret as { pass?: string } | undefined)?.pass ?? "tombstone") : undefined;
  };
  const strip = (world: World) => world.problems.map((line) => line.replace(/ \[.*$/, ""));

  it("two devices on 0.9.0 lose a password to each other's tombstone after a repair, and an updated device gives it back", async () => {
    const world = await runCase(frame(["new", "v090", "v090"], CAL, 0), ["D2 repairs", "D2 cycle:late"]);
    expect(strip(world)).toEqual(["(1) D1(v090) port emptied c"]);
    expect(world.devs.map((d) => d.slots[CAL.id])).toEqual(["c1", "c1", "c1"]);
  });

  it("on 0.9.0 \"received\" is known by name: after a repair there the password counts as typed there", async () => {
    const world = await runCase(frame(["new", "v090"], MAIL, 0), ["D1 repairs", "D1 cycle:full", "D0 cycle:full", "D0 cycle:full", "D0 types"]);
    expect(world.problems).toEqual([]);
    expect([dev("D0").slots[MAIL.id], dev("D1").slots[MAIL.id], valueOf(newId({ ...MAIL, at: "b" }))]).toEqual(["m2", "m1", "m2"]);
  });

  for (const [kind, acct, labels] of [
    ["v087", MAIL, ["D0 removes", "D0 adds it again", "D1 removes"]],
    ["v090", CAL, ["D0 removes", "D0 adds it again", "D0 signs out", "D1 removes"]],
  ] as const) {
    it(`a device on ${kind === "v087" ? "0.8.7" : "0.9.0"} that removed the account itself and gets it back through the profile has it without its password`, async () => {
      const world = await runCase(frame(["new", kind], acct, kind === "v087" ? 1 : 0), [...labels]);
      expect(world.problems).toEqual([]);
      expect([dev("D1").rows.length, dev("D1").slots[acct.id]]).toEqual([1, undefined]);
    });
  }

  it("a device whose profile never brings the removal keeps account and password, and publishes it", async () => {
    const world = await runCase(frame(["new", "new"], CAL, 0), ["D0 removes", "D0 cycle:full"], [], ["D1"]);
    expect(strip(world)).toEqual(["(2) removed c@a: a password under its name"]);
    expect([dev("D1").rows.length, dev("D1").slots[CAL.id], w.remote?.entries[newId(CAL)]?.deviceId]).toEqual([1, "c1", "D1"]);
  });

  // Finding outside these rules: a change made on 0.8.7, taken by an updated device under the old name.
  it("a change made on 0.8.7 taken under the old name: today's outcome", async () => {
    const world = await runCase(frame(["new", "v087", "v090"], MAIL, 1), ["D0 types", "D1 types", "D0 cycle:full", "D0 types"]);
    expect(strip(world)).toEqual(["(5) D2(v090) holds m3 for m@a, the document m4"]);
    expect([...world.devs.map((d) => d.slots[MAIL.id]), valueOf(newId(MAIL)), valueOf(oldId(MAIL))]).toEqual(["m3", "m3", "m3", "m4", "m3"]);
  });

  // The marks of a repair live only as long as what they say.
  it("`moved` goes once the device takes a newer password under the name, or one is typed there", async () => {
    // D1 typed c1, D0 received it: D0 follows a newer password.
    const world = await runCase(frame(["new", "new"], CAL, 1), ["D0 repairs", "D0 cycle:full", "D1 cycle:full", "D1 cycle:full", "D0 cycle:full"]);
    const b = newId({ ...CAL, at: "b" });
    expect([dev("D0").meta?.entries[b]?.moved, dev("D1").meta?.entries[b]?.moved]).toEqual([true, true]);
    for (const label of ["D1 types", "D1 cycle:full", "D0 cycle:full"]) await steps([CAL], false).find((step) => step.label === label)!.run();
    expect(world.problems).toEqual([]);
    expect([dev("D0").slots[CAL.id], dev("D0").meta?.entries[b]?.moved, dev("D1").meta?.entries[b]?.moved]).toEqual(["c2", undefined, undefined]);
  });
});

