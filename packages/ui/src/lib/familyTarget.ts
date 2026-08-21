import { FAMILY_SERVICES, type CloudProviderFamily } from "./cloudAccounts";
import { suiteProvider } from "./providerCatalog";

/**
 * Which form a picked provider family lands in, and what that form already
 * knows (S0a).
 *
 * The bug this exists for: `CloudConnectScreen` asks for the provider first and
 * hands `(service, family)` to the router — but the router took only
 * `(service)` and dropped the family. Every destination then picked its own
 * provider from a hardcoded default, so choosing Google and tapping "Dateien"
 * landed on a WebDAV form. For the calendar it was quieter and worse: the form
 * defaults to "google", so arriving from the MICROSOFT tile pre-selected the
 * wrong provider and nothing looked wrong.
 *
 * Passing the family through is necessary but not sufficient, because there is
 * no one-to-one mapping. The mobile file-sync picker knows FIVE providers; the
 * family list has SIXTEEN. Three cases:
 *
 *  - google / microsoft / dropbox  → their own provider
 *  - webdav / s3 / imap           → identity: the family IS the provider
 *  - the ten suites               → webdav (files) or caldav (calendar) or imap
 *                                   (mail), but WITH the family's endpoints
 *
 * That third case is the one that decides whether the fix is real: arriving
 * from the Fastmail tile must show a Fastmail form, not an empty WebDAV one.
 * The endpoints are not invented here — `suiteProvider()` in the shared catalog
 * has carried them since Cloud accounts stage A; the desktop wizard asks it,
 * mobile never did.
 *
 * A `null` return means "this family cannot carry this service" — derived from
 * the shared `FAMILY_SERVICES` matrix, never from a second list. Dropbox and S3
 * are files-only, IMAP is mail-only, and Apple has no files at all because
 * iCloud Drive has no third-party API.
 */

/** The five providers the mobile file-sync form can bind. */
export type MobileFilesProvider = "webdav" | "s3" | "drive" | "onedrive" | "dropbox";
/** The three the calendar accounts screen can bind. */
export type MobileCalendarProvider = "google" | "microsoft" | "caldav";
/** The two mail backends. */
export type MobileMailBackend = "microsoft" | "imap";

export interface FilesTarget {
  provider: MobileFilesProvider;
  /** Suite families: the catalog's WebDAV endpoint, prefilled into the form. */
  webdavUrl?: string;
}

export interface CalendarTarget {
  provider: MobileCalendarProvider;
  /** Suite families (and Apple/Yahoo/…): the catalog's CalDAV endpoint. */
  caldavUrl?: string;
}

export interface MailTarget {
  backend: MobileMailBackend;
  /** Mail preset id, so hosts stay single-sourced in the catalog. */
  presetId?: string;
}

/** Direct provider for the three families that own their file API. */
const DIRECT_FILES: Partial<Record<CloudProviderFamily, MobileFilesProvider>> = {
  google: "drive",
  microsoft: "onedrive",
  dropbox: "dropbox",
  s3: "s3",
  webdav: "webdav",
};

function carries(family: CloudProviderFamily, service: "files" | "calendar" | "mail"): boolean {
  return FAMILY_SERVICES[family].includes(service);
}

/**
 * Where "Dateien" goes for this family — `null` when the family has no file
 * service at all (Apple, IMAP, and the mail-only suites).
 */
export function filesTargetForFamily(family: CloudProviderFamily): FilesTarget | null {
  if (!carries(family, "files")) return null;
  const direct = DIRECT_FILES[family];
  if (direct) return { provider: direct };
  // Everything left is a suite whose files ride on WebDAV. The catalog is the
  // only place that knows the endpoint; a suite listed with "files" but without
  // a webdavUrl would be a catalog bug, so surface it as "cannot" rather than
  // sending the user to an empty form pretending to be their provider.
  const url = suiteProvider(family)?.endpoints.webdavUrl;
  return url ? { provider: "webdav", webdavUrl: url } : null;
}

/**
 * Where "Kalender" goes — `null` when the family carries no calendar
 * (Dropbox, S3, IMAP, Koofr, pCloud).
 */
export function calendarTargetForFamily(family: CloudProviderFamily): CalendarTarget | null {
  if (!carries(family, "calendar")) return null;
  if (family === "google") return { provider: "google" };
  if (family === "microsoft") return { provider: "microsoft" };
  // Plain WebDAV has no preset URL — the user types their server. Suites do.
  const url = suiteProvider(family)?.endpoints.caldavUrl;
  return url ? { provider: "caldav", caldavUrl: url } : { provider: "caldav" };
}

/**
 * Where "E-Mail" goes — `null` when the family carries no mail (WebDAV,
 * Dropbox, S3, Koofr, pCloud).
 *
 * Google deliberately lands on IMAP with an app password rather than OAuth:
 * Gmail's OAuth scopes are "restricted" and would drag the project into a CASA
 * security assessment. That decision predates this file (see the user guide).
 */
export function mailTargetForFamily(family: CloudProviderFamily): MailTarget | null {
  if (!carries(family, "mail")) return null;
  if (family === "microsoft") return { backend: "microsoft" };
  if (family === "google") return { backend: "imap", presetId: "gmail" };
  const preset = suiteProvider(family)?.mailPresetId;
  return preset ? { backend: "imap", presetId: preset } : { backend: "imap" };
}
