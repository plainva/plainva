import { classifyAuthError } from "./authErrors";
import type { CloudServiceId } from "./cloudAccounts";
import { isOwnClientRejected } from "./serviceConnection";

/**
 * "Check connection" on an account card (account sign-in plan E6, mockup
 * view 5): each service reads something small with what this device holds,
 * and says whether it works - or why not, with the action that helps.
 *
 * Until now a sign-in that had lapsed showed up as an empty calendar or a
 * sync that did nothing, and the person was the only test against a real
 * provider. The check turns that into one tap per account, and each result is
 * one line in the diagnostics - service and state, never an address or token.
 */

/**
 * `signin` (plan "Verbinden", V0): this device holds no sign-in for the
 * service at all - the card was never signed in here, or was signed out here.
 * Before, that read as "not granted" (the card's grant was missing, so it
 * covered nothing) or as a raw "not connected" from the probe, and neither
 * offered the one step that helps.
 */
export type ServiceCheckState = "ok" | "expired" | "notGranted" | "signin" | "failed";

export interface ServiceCheck {
  service: CloudServiceId;
  state: ServiceCheckState;
  /** For "failed": the sentence of the error, already readable. */
  detail?: string;
  /** For "failed": an i18n key the row says instead of `detail`. */
  detailKey?: string;
  /** The provider refused this device's own client (deleted, not allowed). */
  clientRejected?: boolean;
}

/**
 * Thrown by a probe that knows the reason without asking the provider: no
 * sign-in on this device (`signin`), or a reason with words of its own
 * (`failed` + key). The shells' probes threw a bare English "not connected"
 * here, which reached the row as "provider response: not connected".
 */
export class ServiceCheckError extends Error {
  constructor(readonly state: "signin" | "failed", readonly key?: string) {
    super(key ?? state);
    this.name = "ServiceCheckError";
  }
}

export interface AccountCheckPorts {
  /** The services the card carries, in files → calendar → mail order. */
  services: readonly CloudServiceId[];
  /**
   * Whether the card's own sign-in is on this device (Google/Microsoft).
   * `false` answers every service with `signin` without asking anyone;
   * `null` or absent means the card has no sign-in of its own.
   */
  cardSignedIn?(): Promise<boolean | null>;
  /**
   * Whether a grant of the card covers this service (OAuth services only).
   * `null` means the service does not sign in with OAuth (a password, an app key).
   */
  covered(service: CloudServiceId): Promise<boolean | null>;
  /** Reads something small with the service; throws when that fails. */
  probe(service: CloudServiceId): Promise<void>;
  /** Turns an error into a sentence for the row. */
  describe(error: unknown): string;
}

export async function checkAccountConnection(ports: AccountCheckPorts): Promise<ServiceCheck[]> {
  const results: ServiceCheck[] = [];
  if ((await ports.cardSignedIn?.()) === false) return ports.services.map((service) => ({ service, state: "signin" }));
  for (const service of ports.services) {
    if ((await ports.covered(service)) === false) {
      results.push({ service, state: "notGranted" });
      continue;
    }
    try {
      await ports.probe(service);
      results.push({ service, state: "ok" });
    } catch (error) {
      if (error instanceof ServiceCheckError) {
        results.push(error.state === "signin" ? { service, state: "signin" } : { service, state: "failed", ...(error.key ? { detailKey: error.key } : { detail: ports.describe(error) }) });
        continue;
      }
      if (isOwnClientRejected(error)) {
        results.push({ service, state: "failed", detailKey: "accountAccess.clientRejected", clientRejected: true });
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      results.push(classifyAuthError(message) === "expired" ? { service, state: "expired" } : { service, state: "failed", detail: ports.describe(error) });
    }
  }
  return results;
}

/** One diagnostics line: provider family and the state of each service. */
export function accountCheckDiagnostic(family: string, results: readonly ServiceCheck[]): string {
  return `account check ${family}: ${results.map((r) => `${r.service}=${r.state}`).join(" ") || "no services"}`;
}

/** The i18n key of a row's state. */
export function serviceCheckKey(state: ServiceCheckState): string {
  return state === "ok" ? "cloudAccounts.checkOk"
    : state === "expired" ? "cloudAccounts.checkExpired"
      : state === "notGranted" ? "cloudAccounts.checkNotGranted"
        : state === "signin" ? "deviceSignIn.notSignedIn"
          : "cloudAccounts.checkFailed";
}

/** What a row of the check says, in both shells. */
export function serviceCheckText(row: ServiceCheck, t: (key: string) => string): string {
  if (row.state === "failed") return row.detailKey ? t(row.detailKey) : row.detail || t(serviceCheckKey("failed"));
  return t(serviceCheckKey(row.state));
}

/**
 * The one action a row of the check offers (plan "Verbinden", V0): every
 * service that does not work gets one - before, only a lapsed or ungranted
 * one did, and a row that simply failed was a dead end.
 *
 * `canSignIn` says whether this shell can sign the card in again from here;
 * where it cannot (a password account on the phone), the row leads to the
 * service's own settings instead.
 */
export type ServiceCheckAction = "signIn" | "signInAgain" | "openService" | "useStandard";

/**
 * `standardAvailable`: this device signs in with an own client and the build
 * carries the standard one - a refused client is then switched, not retried.
 */
export function serviceCheckAction(row: ServiceCheck, canSignIn: boolean, standardAvailable = false): ServiceCheckAction | null {
  if (row.state === "ok") return null;
  if (row.clientRejected && standardAvailable) return "useStandard";
  if (!canSignIn) return "openService";
  return row.state === "signin" ? "signIn" : "signInAgain";
}
