import { PLAINVA_ONEDRIVE_CLIENT_ID } from "../services/providerDefaults";
import type { OAuthFamily } from "./oauthScopes";

/**
 * Which OAuth client this DEVICE signs in with (account sign-in plan E3).
 *
 * The access belongs to the installation, not to an account: a Desktop-type
 * Google client cannot sign in on a phone and an iOS-type client cannot sign in
 * on a desktop, so "one app ID for the whole account" was never true (finding
 * 2026-10-23: the old "own app ID" field on the account page was a label that
 * re-signing in never read, and there was no place for the secret at all).
 *
 * Plainva's own access is the default whenever this build ships a client for
 * the platform; the user's own Google project stays available under
 * "Advanced". Client ids, secrets and grants never leave the device (ADR 0015).
 */

export type AccessPlatform = "desktop" | "ios" | "android";
export type AccessSource = "plainva" | "own";

/** What the device stores. Nothing here is shared through a vault. */
export interface StoredOAuthAccess {
  source: AccessSource;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthAccess {
  family: OAuthFamily;
  source: AccessSource;
  clientId: string;
  clientSecret?: string;
  /**
   * How this device asks for consent: the desktop opens the system browser and
   * listens on a loopback port, a phone opens the browser and comes back
   * through the app's scheme, Android with Plainva's own client uses the
   * system sheet of Play services.
   */
  flow: "loopback" | "browser" | "system";
  /** Whether mail can be part of the same consent with this access (E5). */
  mail: boolean;
}

export type AccessProblem = "noPlainvaClient" | "ownClientMissing" | "ownClientInvalid" | "ownSecretMissing";
export type AccessResolution = { ok: true; access: OAuthAccess } | { ok: false; problem: AccessProblem };

const GOOGLE_CLIENT_ID = /^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/;
const MICROSOFT_CLIENT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Gmail through Plainva's project needs the mail scope on that project's
 * consent screen. Until Google approves it (stage 2 of E4), a build says so. */
function googleMailOnPlainvaClient(env: Record<string, unknown>): boolean {
  const state = env.VITE_PLAINVA_GOOGLE_MAIL_STATE;
  return state === "testing" || state === "production";
}

/** The Google client this build ships for a platform, if any. */
export function plainvaGoogleClient(env: Record<string, unknown>, platform: AccessPlatform): { clientId: string; clientSecret?: string } | null {
  const clientId = env[`VITE_PLAINVA_GOOGLE_${platform.toUpperCase()}_CLIENT_ID`];
  if (typeof clientId !== "string" || !GOOGLE_CLIENT_ID.test(clientId)) return null;
  if (platform !== "desktop") return { clientId };
  const secret = env.VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_SECRET;
  if (typeof secret !== "string" || !secret.trim()) return null;
  return { clientId, clientSecret: secret.trim() };
}

/** What a user's own client of this family must carry on this platform. */
export function ownAccessRequirements(family: OAuthFamily, platform: AccessPlatform): { secret: boolean; clientType: "desktop" | "ios" | "microsoft" } {
  if (family === "microsoft") return { secret: false, clientType: "microsoft" };
  return platform === "desktop" ? { secret: true, clientType: "desktop" } : { secret: false, clientType: "ios" };
}

export function validClientId(family: OAuthFamily, clientId: string): boolean {
  return (family === "google" ? GOOGLE_CLIENT_ID : MICROSOFT_CLIENT_ID).test(clientId.trim());
}

/**
 * The access this device uses for a NEW sign-in of `family`.
 *
 * `stored` is the device's choice; absent means "Plainva's access". A choice of
 * Plainva's access on a build without a client for this platform is a problem
 * the surface states (and offers the own access for), never a silent fallback
 * to some other client.
 */
export function resolveOAuthAccess(
  family: OAuthFamily,
  platform: AccessPlatform,
  stored: StoredOAuthAccess | null,
  env: Record<string, unknown>,
): AccessResolution {
  const source: AccessSource = stored?.source === "own" ? "own" : "plainva";
  const browserFlow = platform === "desktop" ? "loopback" : "browser";
  if (source === "plainva") {
    if (family === "microsoft") {
      return { ok: true, access: { family, source, clientId: PLAINVA_ONEDRIVE_CLIENT_ID, flow: browserFlow, mail: true } };
    }
    const client = plainvaGoogleClient(env, platform);
    if (!client) return { ok: false, problem: "noPlainvaClient" };
    return {
      ok: true,
      access: {
        family, source, clientId: client.clientId,
        ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
        // Play services identifies the build by package and signing key, which
        // Google accepts in one project only - Plainva's (finding 2026-10-09).
        flow: platform === "android" ? "system" : browserFlow,
        mail: googleMailOnPlainvaClient(env),
      },
    };
  }
  const clientId = stored?.clientId?.trim() ?? "";
  if (!clientId) return { ok: false, problem: "ownClientMissing" };
  if (!validClientId(family, clientId)) return { ok: false, problem: "ownClientInvalid" };
  const needs = ownAccessRequirements(family, platform);
  const clientSecret = stored?.clientSecret?.trim() ?? "";
  if (needs.secret && !clientSecret) return { ok: false, problem: "ownSecretMissing" };
  return {
    ok: true,
    access: {
      family, source, clientId,
      ...(needs.secret ? { clientSecret } : {}),
      flow: browserFlow,
      // The user's own project decides which APIs it enables; a mail scope it
      // does not allow comes back as "not granted", never as a silent drop.
      mail: true,
    },
  };
}

/** Device-local storage key of the access choice (one per family). */
export function oauthAccessKey(family: OAuthFamily): string {
  return `oauth_access_${family}`;
}

export function readStoredOAuthAccess(value: unknown): StoredOAuthAccess | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.source !== "plainva" && raw.source !== "own") return null;
  return {
    source: raw.source,
    ...(typeof raw.clientId === "string" && raw.clientId.trim() ? { clientId: raw.clientId.trim() } : {}),
    ...(typeof raw.clientSecret === "string" && raw.clientSecret.trim() ? { clientSecret: raw.clientSecret.trim() } : {}),
  };
}

/** Whether a stored grant was made with the access of this device. */
export function grantUsesAccess(grant: { clientId: string; clientSecret?: string }, access: OAuthAccess): boolean {
  return grant.clientId === access.clientId && (access.clientSecret === undefined || grant.clientSecret === access.clientSecret);
}
