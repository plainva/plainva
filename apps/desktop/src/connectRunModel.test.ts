import { describe, expect, it } from "vitest";
import { ServiceConnectionError, SignInNothingGrantedError, SignInWrongAccountError, connectRunEnding, connectRunSteps, connectStepLabelKey, serviceConnectionFailure, withSkipped } from "@plainva/ui";

/**
 * The account setup after the sign-in, as both shells count and name it, and
 * who a failure of one of its steps came from (plan "Verbinden-Assistent",
 * 2026-10-28; device finding 2026-10-28: a closed database on the iPhone said
 * "the provider's answer").
 */

const t = (key: string, options?: Record<string, unknown>) => (options?.provider ? `${key}(${String(options.provider)})` : key);

describe("the steps of an account setup", () => {
  it("counts the sign-in as done and names the files step after the folder", () => {
    const steps = connectRunSteps({ pending: ["files", "calendar"], done: [] });
    expect(steps).toEqual([
      { id: "signin", state: "done" },
      { id: "files", state: "active" },
      { id: "calendar", state: "pending" },
    ]);
    expect(steps.map((step) => connectStepLabelKey(step.id))).toEqual(["cloudAccounts.stepSignIn", "connectRun.stepFiles", "connectRun.stepCalendar"]);
  });

  it("keeps the fixed order and marks a skipped step, also in a run saved before skipping existed", () => {
    const skipped = withSkipped({ pending: ["calendar", "mail"] as const, done: ["files"] as const }, "calendar");
    expect(connectRunSteps(skipped).map((step) => `${step.id}:${step.state}`)).toEqual(["signin:done", "files:done", "calendar:skipped", "mail:active"]);
    expect(connectRunSteps({ pending: ["mail"], done: ["files", "calendar"] }).map((step) => step.state)).toEqual(["done", "done", "done", "active"]);
  });

  it("skips only the step on screen", () => {
    const run = { pending: ["files", "calendar"] as const, done: [] as const };
    expect(withSkipped(run, "calendar")).toBe(run);
  });

  it("says what stopping keeps and what stays not set up", () => {
    expect(connectRunEnding({ pending: ["mail"], done: ["files"], skipped: ["calendar"] })).toEqual({ kept: ["files"], notSetUp: ["calendar", "mail"] });
  });
});

describe("a failed step names its sender", () => {
  const view = (error: unknown) => serviceConnectionFailure(error, t, { provider: "Google" });

  it("a closed database on the phone is the device, with its words under the sentence", () => {
    expect(view(new Error("Query: Connection to plainva-45e9259f not available"))).toEqual({
      source: "device",
      title: "connectRun.failedOnDevice",
      text: "connectRun.deviceText",
      raw: "Query: Connection to plainva-45e9259f not available",
      signIn: false,
    });
    expect(view(new ServiceConnectionError("storageFailed")).source).toBe("device");
  });

  it("an answer nobody here knows is the provider's, said as such", () => {
    const failure = view(new Error("Rate limit exceeded for project 123"));
    expect(failure).toMatchObject({ source: "provider", title: "connectRun.providerRefused(Google)", text: "connectRun.providerText(Google)", raw: "Rate limit exceeded for project 123" });
  });

  it("a sign-in the provider no longer accepts asks for signing in again", () => {
    expect(view(new Error("invalid_grant"))).toMatchObject({ source: "provider", signIn: true });
  });

  it("Plainva's own checks of the sign-in are not the provider's refusal, and still offer signing in", () => {
    expect(view(new ServiceConnectionError("needsConsent"))).toMatchObject({ source: "plainva", title: "connectRun.notCompleted", signIn: true });
    expect(view(new Error("no_stored_sign_in"))).toMatchObject({ source: "plainva", signIn: true });
    expect(view(new SignInWrongAccountError("anna@example.com", "bob@example.com"))).toMatchObject({ source: "plainva", text: "cloudAccounts.wrongAccount", signIn: true });
    expect(view(new SignInNothingGrantedError(["files"]))).toMatchObject({ source: "plainva", text: "cloudAccounts.nothingGranted" });
  });

  it("only words that read as a provider's answer are the provider's; anything else is Plainva's step, its words kept", () => {
    expect(view(new Error("HTTP 403 Forbidden")).source).toBe("provider");
    expect(view(new TypeError("Cannot read properties of undefined (reading 'id')"))).toMatchObject({ source: "plainva", title: "connectRun.notCompleted", raw: "Cannot read properties of undefined (reading 'id')" });
    expect(view(new Error("Connection destination changed")).source).toBe("plainva");
  });

  it("the person's own cancel is no failure, no network is not a refusal, another account is Plainva's own check", () => {
    expect(view(new Error("google_authorization:CANCELLED"))).toMatchObject({ title: null });
    expect(view(new Error("google_authorization:NETWORK_ERROR")).source).toBe("network");
    expect(view(new Error("oauth loopback cancelled"))).toMatchObject({ title: null });
    expect(view(new ServiceConnectionError("wrongAccount"))).toMatchObject({ source: "plainva", signIn: true });
    expect(view(new Error("identityUnavailable"))).toMatchObject({ source: "plainva", signIn: true });
  });

  it("Plainva's own steps and a cancel are not the provider's", () => {
    expect(view(new Error("accountChanged")).source).toBe("plainva");
    expect(view(new Error("transfer_invalid_path")).source).toBe("plainva");
    expect(view("cancelled")).toMatchObject({ source: "plainva", title: null });
  });
});
