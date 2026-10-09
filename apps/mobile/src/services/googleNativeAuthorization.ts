import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  chooseGoogleSignInFlow, GoogleAuthorizationError, googleAuthorizationDiagnostic, googleOrphanResultDiagnostic, googlePublicClient, googleServicesOfScope, logDiagnostic,
  oauthScopesCover, parseGoogleUserInfo, readGoogleAuthorizationFailure, verifiedProviderIdentityKey, withAccountCredentialLock,
  type GoogleAuthorizationFailure, type StoredAccountToken,
} from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";

interface GoogleAuthorizationPort {
  authorize(options: { scopes: string[]; email?: string; interactive: boolean }): Promise<{ accessToken: string; scopes: string[] }>;
  clearToken(options: { token: string }): Promise<void>;
  takeOrphanResult(): Promise<{ orphan?: unknown }>;
}
const native = registerPlugin<GoogleAuthorizationPort>("GoogleAuthorization");
const issued = new Set<string>();
const rejected = new Set<string>();

/** Whether this shell has Google's system sign-in at all: Android, as an app. */
export function hasGooglePlayServices(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Which way a Google sign-in goes on this device — the shared rule
 * (`chooseGoogleSignInFlow`) with this build's own client filled in.
 *
 * `nativeGrantClientIds` are the client IDs of the Play-services grants the
 * sign-in would replace (the account being signed in again); a new account has
 * none, so a client ID the user entered always goes through the browser.
 */
export function googleSignInFlow(clientId: string, nativeGrantClientIds: readonly (string | null | undefined)[] = []): "native" | "browser" {
  const playServices = hasGooglePlayServices();
  return chooseGoogleSignInFlow({
    playServices,
    clientId,
    builtInClientId: playServices ? googlePublicClient(import.meta.env, "android")?.clientId : null,
    nativeGrantClientIds,
  });
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
  if (!hasGooglePlayServices()) throw new Error("Native Google authorization requires Android");
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
