import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  GoogleAuthorizationError, googleAuthorizationDiagnostic, googleOrphanResultDiagnostic, googleServicesOfScope, logDiagnostic,
  oauthScopesCover, parseGoogleUserInfo, readGoogleAuthorizationFailure, verifiedProviderIdentityKey, withAccountCredentialLock,
  type GoogleAuthorizationFailure, type StoredAccountToken,
} from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";

interface GoogleAuthorizationPort {
  authorize(options: { scopes: string[]; email?: string; interactive: boolean }): Promise<{ accessToken: string; scopes: string[] }>;
  clearToken(options: { token: string }): Promise<void>;
  takeOrphanResult(): Promise<{ orphan?: unknown }>;
  appIdentity(): Promise<{ packageName?: unknown; sha1?: unknown }>;
}
const native = registerPlugin<GoogleAuthorizationPort>("GoogleAuthorization");
const issued = new Set<string>();
const rejected = new Set<string>();

/** Android signs in to Google through Play services; every other platform uses a browser. */
export function usesNativeGoogleAuthorization(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** Queued until the next request, which awaits clearing before obtaining a token. */
export function forgetNativeGoogleTokens(): void { for (const token of issued) rejected.add(token); issued.clear(); }

export async function authorizeNativeGoogle(scope: string, interactive: boolean, expected?: StoredAccountToken) {
  return withAccountCredentialLock("native-google-authorization", () => authorize(scope, interactive, expected));
}

/**
 * What a background renewal last failed with, per set of services. A renewal
 * runs every cycle; without this the same line would fill the log between
 * every other entry. A success clears it, so the next failure is news again.
 */
const backgroundFailures = new Map<string, string>();

function note(failure: GoogleAuthorizationFailure, services: string, interactive: boolean, account: "named" | "chooser"): void {
  const line = googleAuthorizationDiagnostic(failure, { services, interactive, account });
  if (!interactive) {
    if (backgroundFailures.get(services) === line) return;
    backgroundFailures.set(services, line);
  }
  logDiagnostic("google-signin", line);
}

/** A result that reached the plugin while nothing was waiting for it. */
async function noteOrphanResult(): Promise<void> {
  try {
    const line = googleOrphanResultDiagnostic((await native.takeOrphanResult()).orphan);
    if (line) logDiagnostic("google-signin", line);
  } catch { /* an older native shell has no such method */ }
}

async function authorize(scope: string, interactive: boolean, expected?: StoredAccountToken) {
  if (!usesNativeGoogleAuthorization()) throw new Error("Native Google authorization requires Android");
  for (const token of [...rejected]) { await native.clearToken({ token }); rejected.delete(token); }
  const scopes = scope.split(/\s+/).filter(Boolean);
  const services = googleServicesOfScope(scope);
  const email = expected?.nativeGoogle?.email;
  if (interactive) await noteOrphanResult();
  let response: { accessToken: string; scopes: string[] };
  try { response = await native.authorize({ scopes, email, interactive }); }
  catch (error) {
    const failure = readGoogleAuthorizationFailure(error);
    // The routine answer of a background renewal: the account wants its user.
    if (failure.code === "CONSENT_REQUIRED") throw new Error("invalid_grant: Google account needs sign-in", { cause: error });
    note(failure, services, interactive, email ? "named" : "chooser");
    // The address this sign-in names is not an account of this phone (it came
    // with the settings of another device, or was removed here). Asking for it
    // by name fails at once; Google's own chooser can add it. Which account
    // was chosen is still checked below, so another one is refused as before.
    if (!interactive || !email || (failure.code !== "INVALID_ACCOUNT" && failure.code !== "SIGN_IN_REQUIRED")) throw new GoogleAuthorizationError(failure, { cause: error });
    try { response = await native.authorize({ scopes, interactive }); }
    catch (second) {
      const again = readGoogleAuthorizationFailure(second);
      note(again, services, interactive, "chooser");
      throw new GoogleAuthorizationError(again, { cause: second });
    }
  }
  backgroundFailures.delete(services);
  if (!response.accessToken || !Array.isArray(response.scopes) || !oauthScopesCover(response.scopes.join(" "), scope, "google")) throw new Error("Google did not grant the requested permissions");
  const result = await webdavFetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${response.accessToken}` } });
  const profile = result.ok ? parseGoogleUserInfo(await result.json()) : null;
  if (!profile?.label?.includes("@") || (expected?.providerIdentity && verifiedProviderIdentityKey(expected.providerIdentity) !== verifiedProviderIdentityKey(profile.identity))
    || (expected?.nativeGoogle && expected.nativeGoogle.email.toLowerCase() !== profile.label.toLowerCase())) throw new Error("A different provider account was selected. Existing sign-ins were kept.");
  issued.add(response.accessToken);
  if (issued.size > 64) issued.delete(issued.values().next().value!);
  return { accessToken: response.accessToken, scope: response.scopes.join(" "), expiresIn: 300, profile };
}

/** What a Google project registers an Android client with. Public, not a secret. */
export interface NativeGoogleAppIdentity {
  packageName: string;
  /** SHA-1 of the certificate the INSTALLED build is signed with, `AB:CD:…`. */
  sha1: string[];
}

const SHA1_PATTERN = /^(?:[0-9A-F]{2}:){19}[0-9A-F]{2}$/;

/** Null off Android and whenever the system does not answer in the expected form. */
export async function nativeGoogleAppIdentity(): Promise<NativeGoogleAppIdentity | null> {
  if (!usesNativeGoogleAuthorization()) return null;
  try {
    const value = await native.appIdentity();
    if (typeof value.packageName !== "string" || !/^[A-Za-z0-9_.]{1,200}$/.test(value.packageName)) return null;
    const sha1 = Array.isArray(value.sha1) ? value.sha1.filter((entry): entry is string => typeof entry === "string" && SHA1_PATTERN.test(entry)) : [];
    return { packageName: value.packageName, sha1 };
  } catch {
    return null;
  }
}
