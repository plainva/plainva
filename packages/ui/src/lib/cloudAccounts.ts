/**
 * Cloud accounts (stage A): ONE per-vault grouping layer over the three
 * existing account subsystems — file sync (keychain provider slots), calendar
 * (pim_accounts rows) and mail (mailAccounts settings entries). The registry
 * stores REFERENCES plus per-account extras (identity label, own app id); the
 * subsystem stores remain the runtime truth and are never rewritten here.
 *
 * This module is pure and platform-neutral (shared with mobile): shells feed
 * it an observation of their subsystem state and persist the reconciled
 * records wherever their settings live.
 */

/** Services a cloud account can carry. */
export type CloudServiceId = "files" | "calendar" | "mail";

/**
 * Provider FAMILY of an account (the thing the user picks in the wizard).
 * "webdav" covers Nextcloud and generic WebDAV/CalDAV servers — same
 * technology, one family; the Nextcloud tile is a preset of it.
 */
export type CloudProviderFamily = "microsoft" | "google" | "webdav" | "dropbox" | "s3" | "imap";

/** Desktop file-sync provider ids (mirrors the keychain slot names). */
export type SyncProviderId = "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

export interface CloudAccountServices {
  /** File sync of THIS vault runs through this account (XOR: one per vault). */
  files?: { provider: SyncProviderId };
  /** Reference into the vault's pim_accounts table. */
  calendar?: { pimAccountId: string };
  /** Reference into the vault's mail account list. */
  mail?: { mailAccountId: string };
}

export interface CloudAccountRecord {
  id: string;
  family: CloudProviderFamily;
  /** Identity shown on the card: e-mail/UPN/user@host; empty = family fallback label. */
  label: string;
  /** Own OAuth app id (client id / app key), remembered ONCE per account. */
  byoClientId?: string;
  /** Wizard flavor for the webdav family ("nextcloud" preset vs generic server). */
  flavor?: "nextcloud";
  services: CloudAccountServices;
}

/** Which services each provider family can offer (the wizard's checkbox matrix). */
export const FAMILY_SERVICES: Record<CloudProviderFamily, readonly CloudServiceId[]> = {
  microsoft: ["files", "calendar", "mail"],
  google: ["files", "calendar", "mail"],
  webdav: ["files", "calendar"],
  dropbox: ["files"],
  s3: ["files"],
  imap: ["mail"],
};

export function familyOfSyncProvider(provider: SyncProviderId): CloudProviderFamily {
  switch (provider) {
    case "drive":
      return "google";
    case "onedrive":
      return "microsoft";
    default:
      return provider;
  }
}

export function familyOfPimProvider(provider: "caldav" | "google" | "microsoft"): CloudProviderFamily {
  return provider === "caldav" ? "webdav" : provider;
}

const GOOGLE_MAIL_HOSTS = /(^|\.)(gmail\.com|googlemail\.com)$/i;

/**
 * Family of a mail account. Graph mail is Microsoft; Gmail app-password IMAP
 * belongs to the google family (it IS the google account's mail path — the
 * deliberate CASA-free route), every other IMAP box is its own family.
 */
export function familyOfMailAccount(account: { kind: "imap" | "microsoft"; user: string; host: string }): CloudProviderFamily {
  if (account.kind === "microsoft") return "microsoft";
  const domain = account.user.includes("@") ? account.user.split("@").pop()! : account.host;
  return GOOGLE_MAIL_HOSTS.test(domain) ? "google" : "imap";
}

/** Nextcloud detection for migrated WebDAV/CalDAV entries (flavor is cosmetic only). */
export function looksLikeNextcloud(url: string): boolean {
  return /\/remote\.php\//i.test(url);
}

/**
 * Derives the two Nextcloud endpoints from ONE base URL + user (the wizard's
 * one-form promise): files = WebDAV file root, caldav = the DAV discovery
 * endpoint. A pasted URL that already contains /remote.php is trimmed back to
 * the instance base first. Returns null for an unparseable URL.
 */
export function nextcloudEndpoints(baseUrl: string, user: string): { files: string; caldav: string } | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  const basePath = parsed.pathname.replace(/\/remote\.php\/.*$/i, "").replace(/\/+$/, "");
  const base = `${parsed.origin}${basePath}`;
  return {
    files: `${base}/remote.php/dav/files/${encodeURIComponent(user.trim())}/`,
    caldav: `${base}/remote.php/dav`,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalized identity used for the conservative auto-merge (exact match only). */
export function identityKey(label: string | undefined): string | null {
  const trimmed = (label ?? "").trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

/** What a shell observed in its subsystem stores (the runtime truth). */
export interface ObservedCloudState {
  sync?: { provider: SyncProviderId; identity?: string; byoClientId?: string; flavor?: "nextcloud" };
  pim: { id: string; provider: "caldav" | "google" | "microsoft"; label: string; byoClientId?: string }[];
  mail: { id: string; kind: "imap" | "microsoft"; label: string; user: string; host: string; byoClientId?: string }[];
}

function defaultNewId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function betterLabel(current: string, candidate: string | undefined): string {
  const cand = (candidate ?? "").trim();
  if (!cand) return current;
  if (!current.trim()) return cand;
  // Prefer a real identity (e-mail-like) over a generic fallback label.
  if (!identityKey(current) && identityKey(cand)) return cand;
  return current;
}

/**
 * Reconciles the stored registry against the observed subsystem state.
 * Pure and deterministic (id generation injectable for tests). Guarantees:
 *  - stored account ids and order are stable; new accounts append,
 *  - references to vanished subsystem entries are dropped; accounts left
 *    without any service disappear,
 *  - unbound subsystem entries attach to an account ONLY on an exact
 *    identity match within the same family (conservative auto-merge),
 *    otherwise they become their own account — never a guess, never a re-auth.
 */
export function reconcileCloudAccounts(
  stored: readonly CloudAccountRecord[],
  observed: ObservedCloudState,
  newId: () => string = defaultNewId
): CloudAccountRecord[] {
  const pimById = new Map(observed.pim.map((p) => [p.id, p]));
  const mailById = new Map(observed.mail.map((m) => [m.id, m]));

  // 1) Keep stored accounts, dropping references whose subsystem entry is gone.
  const records: CloudAccountRecord[] = [];
  for (const rec of stored) {
    const services: CloudAccountServices = {};
    if (rec.services.files && observed.sync && observed.sync.provider === rec.services.files.provider) {
      services.files = { provider: observed.sync.provider };
    }
    if (rec.services.calendar && pimById.has(rec.services.calendar.pimAccountId)) {
      services.calendar = { pimAccountId: rec.services.calendar.pimAccountId };
    }
    if (rec.services.mail && mailById.has(rec.services.mail.mailAccountId)) {
      services.mail = { mailAccountId: rec.services.mail.mailAccountId };
    }
    records.push({ ...rec, services });
  }

  const boundPim = new Set(records.map((r) => r.services.calendar?.pimAccountId).filter(Boolean));
  const boundMail = new Set(records.map((r) => r.services.mail?.mailAccountId).filter(Boolean));
  const filesBound = records.some((r) => r.services.files);

  const attachTarget = (family: CloudProviderFamily, identity: string | undefined): CloudAccountRecord | undefined => {
    const key = identityKey(identity);
    if (!key) return undefined;
    return records.find((r) => r.family === family && identityKey(r.label) === key);
  };

  // 2) Unbound calendar accounts.
  for (const pim of observed.pim) {
    if (boundPim.has(pim.id)) continue;
    const family = familyOfPimProvider(pim.provider);
    const target = attachTarget(family, pim.label);
    if (target && !target.services.calendar) {
      target.services.calendar = { pimAccountId: pim.id };
      target.label = betterLabel(target.label, pim.label);
      if (!target.byoClientId && pim.byoClientId) target.byoClientId = pim.byoClientId;
    } else {
      records.push({
        id: newId(),
        family,
        label: pim.label ?? "",
        byoClientId: pim.byoClientId,
        services: { calendar: { pimAccountId: pim.id } },
      });
    }
  }

  // 3) Unbound mail accounts.
  for (const mail of observed.mail) {
    if (boundMail.has(mail.id)) continue;
    const family = familyOfMailAccount(mail);
    const identity = EMAIL_RE.test(mail.user.trim().toLowerCase()) ? mail.user : mail.label;
    const target = attachTarget(family, identity);
    if (target && !target.services.mail) {
      target.services.mail = { mailAccountId: mail.id };
      target.label = betterLabel(target.label, identity);
      if (!target.byoClientId && mail.byoClientId) target.byoClientId = mail.byoClientId;
    } else {
      records.push({
        id: newId(),
        family,
        label: identity ?? "",
        byoClientId: mail.byoClientId,
        services: { mail: { mailAccountId: mail.id } },
      });
    }
  }

  // 4) Unbound file sync of this vault.
  if (observed.sync && !filesBound) {
    const family = familyOfSyncProvider(observed.sync.provider);
    const target = attachTarget(family, observed.sync.identity);
    if (target && !target.services.files) {
      target.services.files = { provider: observed.sync.provider };
      target.label = betterLabel(target.label, observed.sync.identity);
      if (!target.byoClientId && observed.sync.byoClientId) target.byoClientId = observed.sync.byoClientId;
      if (!target.flavor && observed.sync.flavor) target.flavor = observed.sync.flavor;
    } else {
      records.push({
        id: newId(),
        family,
        label: observed.sync.identity ?? "",
        byoClientId: observed.sync.byoClientId,
        flavor: observed.sync.flavor,
        services: { files: { provider: observed.sync.provider } },
      });
    }
  }

  // 5) Refresh labels from live subsystem data + drop accounts without services.
  const result: CloudAccountRecord[] = [];
  for (const rec of records) {
    if (rec.services.calendar) {
      const pim = pimById.get(rec.services.calendar.pimAccountId);
      if (pim) rec.label = betterLabel(rec.label, pim.label);
    }
    if (rec.services.mail) {
      const mail = mailById.get(rec.services.mail.mailAccountId);
      if (mail) rec.label = betterLabel(rec.label, EMAIL_RE.test(mail.user.trim().toLowerCase()) ? mail.user : mail.label);
    }
    if (rec.services.files || rec.services.calendar || rec.services.mail) result.push(rec);
  }
  return result;
}

/** Pure response parsing for the sync-identity backfill (Drive `about.get`). */
export function parseDriveAboutIdentity(json: unknown): string | null {
  const email = (json as { user?: { emailAddress?: string } })?.user?.emailAddress;
  return typeof email === "string" && identityKey(email) ? email : null;
}

/** Pure response parsing for the sync-identity backfill (Dropbox `get_current_account`). */
export function parseDropboxAccountIdentity(json: unknown): string | null {
  const email = (json as { email?: string })?.email;
  return typeof email === "string" && identityKey(email) ? email : null;
}

/** Services an account actually carries, in display order. */
export function accountServices(record: CloudAccountRecord): CloudServiceId[] {
  const out: CloudServiceId[] = [];
  if (record.services.files) out.push("files");
  if (record.services.calendar) out.push("calendar");
  if (record.services.mail) out.push("mail");
  return out;
}

/** True when any account carries the given service (nav/ribbon gating). */
export function hasCloudService(records: readonly CloudAccountRecord[], service: CloudServiceId): boolean {
  return records.some((r) => accountServices(r).includes(service));
}
