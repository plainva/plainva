import type { CloudAccountRecord, CloudProviderFamily, CloudServiceId } from "./cloudAccounts";
import { FAMILY_SERVICES } from "./cloudAccounts";
import type { DeviceSignInState } from "./deviceSignIn";
import { signInActionKey } from "./deviceSignIn";
import { suiteProvider } from "./providerCatalog";
import type { ServiceCheck } from "./accountCheck";

/**
 * The account page, as one model for both shells (plan "Verbinden", V1).
 *
 * Every account - Google, Microsoft, Dropbox, iCloud, WebDAV/Nextcloud, S3,
 * an IMAP mailbox, the device's own calendars - shows the same five sections
 * in the same order: the head with ONE state and at most one button, the
 * services, how this device signs in, "Check connection", and the end with
 * "Sign out on this device" and "Remove account". What a provider cannot do
 * is missing; it never moves somewhere else.
 *
 * Before, each shell decided this per surface, and the result was five names
 * for signing in again, four for switching off, and service menus on three
 * different levels. The shells now only draw what this model says - the way
 * `rowActions` decides what a row can do.
 */

/** The ONE state an account shows, in the list and in its head. */
export type AccountState = "connected" | "signin" | "expired";

export function accountStateOf(signIn: DeviceSignInState | undefined): AccountState | null {
  if (!signIn) return null;
  return signIn === "active" ? "connected" : signIn;
}

/** The plan's three words: "Verbunden", "Anmeldung nötig", "Abgelaufen". */
export function accountStateKey(state: AccountState): string {
  return state === "connected" ? "connection.connected" : state === "signin" ? "deviceSignIn.needed" : "cloudAccounts.stateExpired";
}

/** How this device signs in to the account - section 3, always at that place. */
export type AccountAccess =
  /** Google, Microsoft: the standard sign-in or an own client ID, per device. */
  | { kind: "oauth"; family: "google" | "microsoft" }
  /** Dropbox: the standard app or an own app key. */
  | { kind: "appKey" }
  /** WebDAV/Nextcloud, IMAP/CalDAV, the app-password suites: user and (app) password, IMAP with its servers. */
  | { kind: "password"; appPassword: boolean; server: boolean }
  /** S3: access key and secret key. */
  | { kind: "keys" }
  /** The device's own calendars: the system's permission is the sign-in. */
  | { kind: "permission" };

export function accountAccessOf(family: CloudProviderFamily): AccountAccess {
  if (family === "google" || family === "microsoft") return { kind: "oauth", family };
  if (family === "dropbox") return { kind: "appKey" };
  if (family === "s3") return { kind: "keys" };
  if (family === "device") return { kind: "permission" };
  const suite = suiteProvider(family);
  if (suite) return { kind: "password", appPassword: suite.authMode === "app-password", server: false };
  return { kind: "password", appPassword: family === "webdav", server: family === "imap" || family === "webdav" };
}

/** Whether the account has a sign-in this device can drop ("Sign out on this device"). */
export function accountCanSignOut(family: CloudProviderFamily): boolean {
  return family !== "device";
}

/** One row of section 2. */
export interface AccountServiceRow {
  service: CloudServiceId;
  /** The service runs for this account in this vault (E3: the switch is the vault's). */
  on: boolean;
  /** The line under the name, when the shell has nothing better to say. */
  stateKey: string;
  /** The live line the shell measured ("3 calendars · 10:42"), if any. */
  summary?: string;
  /** The service page of THIS account (level 3); null while the service is off. */
  target: CloudServiceId | null;
}

export interface AccountPageInput {
  family: CloudProviderFamily;
  /** The services the account carries in this vault. */
  services: readonly CloudServiceId[];
  /** Services switched off for the vault (E3); carried but not running. */
  off?: readonly CloudServiceId[];
  /** The account's state on this device (`cardSignInState`). */
  signIn: DeviceSignInState | undefined;
  /** This shell can sign the account in from its page. */
  canSignIn: boolean;
  /** This device holds a sign-in for the account it could drop. */
  signedInHere: boolean;
  /** What each service says live, measured by the shell. */
  summaries?: Partial<Record<CloudServiceId, string>>;
  /**
   * Each service's own sign-in state on this device, where the shell knows it
   * (the calendar's and the mailbox's slots). A card can be signed in while
   * one of its services is not (device finding 2026-10-27): the row says so,
   * from the same fact the check reads, instead of "connected".
   */
  serviceStates?: Partial<Record<CloudServiceId, DeviceSignInState | undefined>>;
}

export interface AccountPageModel {
  head: {
    state: AccountState | null;
    /** The one button of the head - present exactly when the state needs a sign-in. */
    action: { kind: "signIn" | "signInAgain"; labelKey: string } | null;
  };
  services: AccountServiceRow[];
  access: AccountAccess;
  /** "Check connection" - for every account that carries a service. */
  check: boolean;
  end: {
    /** "Sign out on this device": only where this device holds a sign-in to drop. */
    signOut: boolean;
    /** "Remove account": always. */
    remove: true;
  };
}

const ORDER: readonly CloudServiceId[] = ["files", "calendar", "mail"];

export function accountPageModel(input: AccountPageInput): AccountPageModel {
  const state = accountStateOf(input.signIn);
  const needsSignIn = state === "signin" || state === "expired";
  const offered = ORDER.filter((service) => FAMILY_SERVICES[input.family].includes(service));
  const services = offered.map((service): AccountServiceRow => {
    const carried = input.services.includes(service);
    const on = carried && !input.off?.includes(service);
    const summary = on ? input.summaries?.[service] : undefined;
    const own = input.serviceStates?.[service];
    const ownNeedsSignIn = own === "signin" || own === "expired";
    return {
      service,
      on,
      stateKey: !on ? "cloudAccounts.serviceOff"
        : needsSignIn ? "cloudAccounts.serviceWaiting"
          : ownNeedsSignIn ? (own === "expired" ? "deviceSignIn.expired" : "deviceSignIn.notSignedIn")
            : "connection.connected",
      ...(summary && !needsSignIn && !ownNeedsSignIn ? { summary } : {}),
      target: carried ? service : null,
    };
  });
  return {
    head: {
      state,
      action: needsSignIn && input.canSignIn
        ? { kind: state === "signin" ? "signIn" : "signInAgain", labelKey: signInActionKey(input.signIn!) }
        : null,
    },
    services,
    access: accountAccessOf(input.family),
    check: input.services.length > 0,
    end: { signOut: accountCanSignOut(input.family) && input.signedInHere, remove: true },
  };
}

/**
 * What "Sign out on this device" and "Remove account" say before they act
 * (E2): what goes and what stays. Signing out asks nothing - signing in again
 * undoes it -, removing always asks.
 */
export function removeAccountConfirm(services: readonly CloudServiceId[]): { goes: string[]; stays: string[] } {
  const goes = ["cloudAccounts.removeGoesServices", "cloudAccounts.removeGoesSignIns"];
  if (services.includes("calendar")) goes.push("cloudAccounts.removeGoesCalendarCache");
  return { goes, stays: ["cloudAccounts.removeStaysNotes", "cloudAccounts.removeStaysProvider"] };
}

/**
 * The actions a row of "Check connection" offers (section 4): the one that
 * helps, and for Gmail the way around Google (E7).
 *
 * E7: when Google refuses Gmail - the permission was not granted, the app is
 * not verified, the project reached its 100 users - the mail row offers
 * "Connect with app password" right there; the app password itself lives
 * under "Other sign-in" in the wizard.
 */
export type CheckRowAction = "signIn" | "signInAgain" | "grant" | "appPassword" | "useStandard" | "openService";

export function checkRowActions(
  row: ServiceCheck,
  ctx: { family: CloudProviderFamily; canSignIn: boolean; standardAvailable?: boolean },
): CheckRowAction[] {
  if (row.state === "ok") return [];
  if (row.clientRejected && ctx.standardAvailable) return ["useStandard"];
  const gmail = ctx.family === "google" && row.service === "mail";
  if (gmail && (row.state === "notGranted" || row.refused)) {
    return row.state === "notGranted" && ctx.canSignIn ? ["grant", "appPassword"] : ["appPassword"];
  }
  if (!ctx.canSignIn) return ["openService"];
  if (row.state === "signin") return ["signIn"];
  if (row.state === "notGranted") return ["grant"];
  return ["signInAgain"];
}

/** The words of each check action. */
export function checkRowActionKey(action: CheckRowAction): string {
  switch (action) {
    case "signIn": return "deviceSignIn.submit";
    case "signInAgain": return "cloudAccounts.reconnect";
    case "grant": return "cloudAccounts.grantAccess";
    case "appPassword": return "cloudAccounts.connectAppPassword";
    case "useStandard": return "accountAccess.useStandard";
    case "openService": return "settings.title";
  }
}

/** The services a record carries, in page order. */
export function recordServices(record: Pick<CloudAccountRecord, "services">): CloudServiceId[] {
  return ORDER.filter((service) => !!record.services[service]);
}

/**
 * What the task-list part of an account's calendar page says (plan "Verbinden",
 * V3; it moved there from the Calendar area). A failed list fetch says why
 * (issue #34: an empty list looked like no error at all); an account that could
 * not be reached knows nothing about its lists, so it does not claim it has
 * none (finding 2026-07-28); only a reachable account without lists is empty.
 */
export type TaskListState = "failed" | "unknown" | "empty" | "lists";

export function taskListState(input: { count: number; listsError?: string | null; accountError?: string | null }): TaskListState {
  if (input.listsError) return "failed";
  if (input.accountError && input.count === 0) return "unknown";
  return input.count === 0 ? "empty" : "lists";
}

/** The hint under an empty list: CalDAV servers often keep tasks in a calendar of their own. */
export function emptyTaskListHintKey(provider: string): string {
  return provider === "caldav" ? "pim.noTaskListsCalDavHint" : "pim.noTaskListsHint";
}

/**
 * The cards the person may declare "the same account" as this one (E3's
 * fallback, E6 on both shells): the other cards of the same provider. The
 * automatic fold needs a provider-confirmed identity on both sides; a card
 * that never got one has no other way out, and the statement is the
 * person's, never a guess from a label.
 */
export function manualMergeCandidates<T extends Pick<CloudAccountRecord, "id" | "family">>(records: readonly T[], target: Pick<CloudAccountRecord, "id" | "family">): T[] {
  return records.filter((record) => record.id !== target.id && record.family === target.family);
}

/**
 * How a vault's file sync runs on this device, one rule for both shells
 * (second review of plan "Verbinden", B3):
 * - `stopped`: the person paused it here ("Pause sync"), or this device is
 *   signed out - nothing runs, settings included, because that stop is meant;
 * - `settingsOnly`: files are switched off for the vault (E3) - no file moves,
 *   but the settings profile keeps travelling on the interval, so "off", "on"
 *   and the switches made meanwhile reach every device;
 * - `running`: everything syncs.
 */
export type FilesRunState = "running" | "settingsOnly" | "stopped";

export function filesRunState(input: { filesOff: boolean; pausedHere: boolean; signedOut: boolean }): FilesRunState {
  if (input.pausedHere || input.signedOut) return "stopped";
  return input.filesOff ? "settingsOnly" : "running";
}

/**
 * What the sync status says for a vault whose files are `stopped`, one answer
 * for both shells (third review of plan "Verbinden", finding 3). The person's
 * own pause is a decision and reads as off; a vault signed out on this device
 * is not - it needs a sign-in, and the status says so and leads to it. The
 * desktop showed such a vault as idle, the phone as "Sign-in needed".
 */
export type FilesStoppedStatus =
  | { status: "off"; messageKey: null; signInNeeded: false }
  | { status: "error"; messageKey: "deviceSignIn.needed"; signInNeeded: true };

export function filesStoppedStatus(input: { pausedHere: boolean; signedOut: boolean }): FilesStoppedStatus {
  if (!input.pausedHere && input.signedOut) return { status: "error", messageKey: "deviceSignIn.needed", signInNeeded: true };
  return { status: "off", messageKey: null, signInNeeded: false };
}
