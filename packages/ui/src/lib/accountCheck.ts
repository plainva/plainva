import { classifyAuthError } from "./authErrors";
import type { CloudServiceId } from "./cloudAccounts";

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

export type ServiceCheckState = "ok" | "expired" | "notGranted" | "failed";

export interface ServiceCheck {
  service: CloudServiceId;
  state: ServiceCheckState;
  /** For "failed": the sentence of the error, already readable. */
  detail?: string;
}

export interface AccountCheckPorts {
  /** The services the card carries, in files → calendar → mail order. */
  services: readonly CloudServiceId[];
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
  for (const service of ports.services) {
    if ((await ports.covered(service)) === false) {
      results.push({ service, state: "notGranted" });
      continue;
    }
    try {
      await ports.probe(service);
      results.push({ service, state: "ok" });
    } catch (error) {
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
        : "cloudAccounts.checkFailed";
}
