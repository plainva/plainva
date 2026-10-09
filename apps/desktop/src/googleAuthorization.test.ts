import { describe, expect, it } from "vitest";
import {
  chooseGoogleSignInFlow,
  GOOGLE_AUTHORIZATION_CODES,
  GoogleAuthorizationError,
  googleAuthorizationDiagnostic,
  googleAuthorizationMarker,
  googleAuthorizationMessage,
  googleOrphanResultDiagnostic,
  googleServicesOfScope,
  isGoogleAuthorizationCancelled,
  readGoogleAuthorizationFailure,
  serviceConnectionMessage,
} from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

const key = (k: string, options?: Record<string, unknown>) => (options?.code === undefined ? k : `${k}(${String(options.code)})`);

/**
 * An Android Google sign-in used to fail with one sentence, whatever happened:
 * "Provider response: Google authorization cancelled". These pin the mapping
 * from what Play services answers to what the user reads.
 */
describe("a failed Android Google sign-in names its cause", () => {
  it("reads the plugin's rejection, and an unknown code is a failure, never a cancel", () => {
    expect(readGoogleAuthorizationFailure({ code: "DEVELOPER_ERROR", data: { stage: "result", resultCode: 0, hadIntent: true, status: 10, statusName: "DEVELOPER_ERROR" } }))
      .toEqual({ code: "DEVELOPER_ERROR", stage: "result", resultCode: 0, hadIntent: true, status: 10, statusName: "DEVELOPER_ERROR" });
    expect(readGoogleAuthorizationFailure({ code: "SOMETHING_NEW" })).toEqual({ code: "AUTH_FAILED" });
    expect(readGoogleAuthorizationFailure(new Error("plugin missing"))).toEqual({ code: "AUTH_FAILED" });
    expect(readGoogleAuthorizationFailure(null)).toEqual({ code: "AUTH_FAILED" });
  });

  it("gives every code its sentence", () => {
    const sentence = (code: (typeof GOOGLE_AUTHORIZATION_CODES)[number], status?: number) =>
      serviceConnectionMessage(new GoogleAuthorizationError({ code, status }), key);
    expect(sentence("DEVELOPER_ERROR", 10)).toBe("connection.googleSystemSignInUnavailable");
    expect(sentence("NETWORK_ERROR", 7)).toBe("connection.googleUnreachable");
    expect(sentence("TIMEOUT", 15)).toBe("connection.googleUnreachable");
    expect(sentence("SIGN_IN_REQUIRED", 4)).toBe("connection.googleAccountNotOnDevice");
    expect(sentence("INVALID_ACCOUNT", 5)).toBe("connection.googleAccountNotOnDevice");
    expect(sentence("INTERNAL_ERROR", 8)).toBe("connection.googlePlayServicesFailed(8)");
    expect(sentence("PLAY_SERVICES_UNAVAILABLE", 17)).toBe("connection.googlePlayServicesFailed(17)");
    expect(sentence("AUTH_FAILED")).toBe("connection.googlePlayServicesFailed(AUTH_FAILED)");
    expect(sentence("CANCELLED")).toBe("settings.oauthCancelled");
    expect(sentence("INTERRUPTED")).toBe("connection.loginFailed");
    expect(sentence("BUSY")).toBe("connection.loginFailed");
    expect(sentence("CONSENT_REQUIRED")).toBe("connection.needsConsent");
    // No code is left to the provider-response frame, which is what printed "cancelled".
    for (const code of GOOGLE_AUTHORIZATION_CODES) expect(sentence(code)).not.toContain("providerResponse");
  });

  it("survives being kept as a string by a screen and by a connect run", () => {
    const error = new GoogleAuthorizationError({ code: "DEVELOPER_ERROR", status: 10 });
    expect(error.message).toBe("google_authorization:DEVELOPER_ERROR:10");
    expect(googleAuthorizationMarker(error.message)).toEqual({ code: "DEVELOPER_ERROR", status: 10 });
    expect(serviceConnectionMessage(new Error(error.message), key)).toBe("connection.googleSystemSignInUnavailable");
    expect(serviceConnectionMessage(error.message, key)).toBe("connection.googleSystemSignInUnavailable");
    expect(googleAuthorizationMessage(new Error("access_denied"), key)).toBeNull();
    expect(googleAuthorizationMarker("google_authorization:NOT_A_CODE")).toBeNull();
  });

  it("knows a cancel from everything else", () => {
    expect(isGoogleAuthorizationCancelled(new GoogleAuthorizationError({ code: "CANCELLED" }))).toBe(true);
    expect(isGoogleAuthorizationCancelled("google_authorization:CANCELLED")).toBe(true);
    expect(isGoogleAuthorizationCancelled(new GoogleAuthorizationError({ code: "DEVELOPER_ERROR", status: 10 }))).toBe(false);
    expect(isGoogleAuthorizationCancelled(new Error("Google authorization cancelled"))).toBe(false);
  });

  it("points a refused system sign-in to the browser sign-in, and asks nobody to register the build", () => {
    const text = (en as { connection: Record<string, string> }).connection.googleSystemSignInUnavailable;
    expect(text).toMatch(/browser/);
    expect(text).toMatch(/your own client ID/);
    // Google accepts package + fingerprint in one project only; telling users to register them was the dead end.
    expect(text).not.toMatch(/SHA-1|fingerprint|package name|register/i);
    expect(text).not.toMatch(/cancel/i);
  });

  it("sends a client ID the user entered through the browser, and keeps Play services where it can work", () => {
    const builtIn = "plainva-android.apps.googleusercontent.com";
    const own = "users-own.apps.googleusercontent.com";
    // A user's own client: the browser, with or without a shipped client.
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: own })).toBe("browser");
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: own, builtInClientId: builtIn })).toBe("browser");
    // The entry the build ships.
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: builtIn, builtInClientId: builtIn })).toBe("native");
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: ` ${builtIn} `, builtInClientId: builtIn })).toBe("native");
    // An account that already works through Play services stays there - with the same client only.
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: own, nativeGrantClientIds: [null, own] })).toBe("native");
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: "typed-anew.apps.googleusercontent.com", nativeGrantClientIds: [own] })).toBe("browser");
    // iOS, the desktop, the browser preview: there is no Play services to choose.
    expect(chooseGoogleSignInFlow({ playServices: false, clientId: builtIn, builtInClientId: builtIn, nativeGrantClientIds: [builtIn] })).toBe("browser");
    expect(chooseGoogleSignInFlow({ playServices: true, clientId: "", builtInClientId: "", nativeGrantClientIds: [""] })).toBe("browser");
  });

  it("writes a line that tells the cases apart and carries nothing personal", () => {
    const attempt = { services: "calendar", interactive: true, account: "chooser" as const };
    // A closed sheet: no intent at all.
    expect(googleAuthorizationDiagnostic(readGoogleAuthorizationFailure({ code: "CANCELLED", data: { stage: "result", resultCode: 0, hadIntent: false } }), attempt))
      .toBe("calendar sign-in failed: CANCELLED, interactive, account chooser, stage result, resultCode 0, intent missing");
    // A refusal after the account was picked: "cancelled" with a status.
    expect(googleAuthorizationDiagnostic(readGoogleAuthorizationFailure({ code: "DEVELOPER_ERROR", data: { stage: "result", resultCode: 0, hadIntent: true, status: 10, statusName: "DEVELOPER_ERROR" } }), attempt))
      .toBe("calendar sign-in failed: DEVELOPER_ERROR, interactive, account chooser, stage result, status 10 DEVELOPER_ERROR, resultCode 0, intent present");
    // Before any dialog.
    expect(googleAuthorizationDiagnostic(readGoogleAuthorizationFailure({ code: "NETWORK_ERROR", data: { stage: "request", status: 7, statusName: "NETWORK_ERROR" } }), { services: "files", interactive: false, account: "named" }))
      .toBe("files sign-in failed: NETWORK_ERROR, background, account named, stage request, status 7 NETWORK_ERROR");
    const dirty = googleAuthorizationDiagnostic(readGoogleAuthorizationFailure({ code: "AUTH_FAILED", data: { stage: "result", statusName: "x y<z>", exception: "java.lang.IllegalStateException: a@b.c",
      detail: "Account person@example.test lacks https://www.googleapis.com/auth/calendar " + "x".repeat(400) } }), attempt);
    expect(dirty).not.toMatch(/person@|googleapis|a@b/);
    expect(dirty.length).toBeLessThan(400);
  });

  it("names the services of a scope without repeating the scope", () => {
    expect(googleServicesOfScope("https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks openid email")).toBe("calendar");
    expect(googleServicesOfScope("https://www.googleapis.com/auth/drive openid email")).toBe("files");
    expect(googleServicesOfScope("openid email https://mail.google.com/")).toBe("mail");
    expect(googleServicesOfScope("https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar https://mail.google.com/")).toBe("files+calendar+mail");
    expect(googleServicesOfScope("openid email")).toBe("identity");
  });

  it("reports a result nobody was waiting for", () => {
    expect(googleOrphanResultDiagnostic({ stage: "result", resultCode: -1, hadIntent: true })).toBe("a sign-in result arrived with no call waiting, resultCode -1, intent present");
    expect(googleOrphanResultDiagnostic(undefined)).toBeNull();
  });
});
