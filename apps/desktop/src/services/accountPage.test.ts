import { describe, expect, it } from "vitest";
import {
  accountAccessOf,
  accountPageModel,
  accountStateKey,
  checkRowActionKey,
  checkRowActions,
  isGmailAccessRefused,
  removeAccountConfirm,
  type AccountPageInput,
} from "@plainva/ui";

/**
 * The account page as ONE model for both shells (plan "Verbinden", V1): five
 * sections in a fixed order, the same for every provider, and what a provider
 * cannot do is missing rather than placed elsewhere.
 */

const google: AccountPageInput = {
  family: "google",
  services: ["files", "calendar"],
  signIn: "active",
  canSignIn: true,
  signedInHere: true,
  summaries: { files: "Vault Projekte · 10:42" },
};

describe("accountPageModel", () => {
  it("shows one state and no button while the account is connected", () => {
    const model = accountPageModel(google);
    expect(model.head).toEqual({ state: "connected", action: null });
    expect(accountStateKey("connected")).toBe("connection.connected");
  });

  it("makes the state that needs a sign-in its own button, with the plan's two words", () => {
    expect(accountPageModel({ ...google, signIn: "signin" }).head).toEqual({ state: "signin", action: { kind: "signIn", labelKey: "deviceSignIn.submit" } });
    expect(accountPageModel({ ...google, signIn: "expired" }).head).toEqual({ state: "expired", action: { kind: "signInAgain", labelKey: "cloudAccounts.reconnect" } });
    expect(accountStateKey("signin")).toBe("deviceSignIn.needed");
    expect(accountStateKey("expired")).toBe("cloudAccounts.stateExpired");
  });

  it("lists every service the provider offers, in one order, with its state and its page", () => {
    const rows = accountPageModel(google).services;
    expect(rows.map((row) => row.service)).toEqual(["files", "calendar", "mail"]);
    expect(rows[0]).toEqual({ service: "files", on: true, stateKey: "connection.connected", summary: "Vault Projekte · 10:42", target: "files" });
    expect(rows[1]).toMatchObject({ on: true, target: "calendar" });
    // Not carried: off, and no page of its own until it is switched on.
    expect(rows[2]).toEqual({ service: "mail", on: false, stateKey: "cloudAccounts.serviceOff", target: null });
  });

  it("says a service waits for the sign-in instead of claiming a connection", () => {
    const rows = accountPageModel({ ...google, signIn: "signin" }).services;
    expect(rows[0]).toEqual({ service: "files", on: true, stateKey: "cloudAccounts.serviceWaiting", target: "files" });
  });

  it("keeps a switched-off service (E3) with its page, so it can be switched on again where it was", () => {
    const rows = accountPageModel({ ...google, off: ["calendar"] }).services;
    expect(rows[1]).toEqual({ service: "calendar", on: false, stateKey: "cloudAccounts.serviceOff", target: "calendar" });
  });

  it("leaves out what a provider cannot do instead of greying it", () => {
    expect(accountPageModel({ ...google, family: "imap", services: ["mail"] }).services.map((row) => row.service)).toEqual(["mail"]);
    expect(accountPageModel({ ...google, family: "webdav", services: ["files"] }).services.map((row) => row.service)).toEqual(["files", "calendar"]);
    expect(accountPageModel({ ...google, family: "device", services: ["calendar"] }).services.map((row) => row.service)).toEqual(["calendar"]);
  });

  it("names how each provider signs in on this device - always in the same section", () => {
    expect(accountAccessOf("google")).toEqual({ kind: "oauth", family: "google" });
    expect(accountAccessOf("microsoft")).toEqual({ kind: "oauth", family: "microsoft" });
    expect(accountAccessOf("dropbox")).toEqual({ kind: "appKey" });
    expect(accountAccessOf("s3")).toEqual({ kind: "keys" });
    expect(accountAccessOf("device")).toEqual({ kind: "permission" });
    expect(accountAccessOf("webdav")).toEqual({ kind: "password", appPassword: true, server: true });
    expect(accountAccessOf("imap")).toEqual({ kind: "password", appPassword: false, server: true });
    expect(accountAccessOf("apple")).toEqual({ kind: "password", appPassword: true, server: false });
  });

  it("offers signing out only where this device holds a sign-in, removing always", () => {
    expect(accountPageModel(google).end).toEqual({ signOut: true, remove: true });
    expect(accountPageModel({ ...google, signedInHere: false }).end).toEqual({ signOut: false, remove: true });
    expect(accountPageModel({ ...google, family: "device", services: ["calendar"] }).end).toEqual({ signOut: false, remove: true });
  });

  it("does not offer a button the shell cannot carry out", () => {
    expect(accountPageModel({ ...google, signIn: "signin", canSignIn: false }).head.action).toBeNull();
  });

  it("says before removing what goes and what stays", () => {
    expect(removeAccountConfirm(["files", "calendar"])).toEqual({
      goes: ["cloudAccounts.removeGoesServices", "cloudAccounts.removeGoesSignIns", "cloudAccounts.removeGoesCalendarCache"],
      stays: ["cloudAccounts.removeStaysNotes", "cloudAccounts.removeStaysProvider"],
    });
    expect(removeAccountConfirm(["mail"]).goes).not.toContain("cloudAccounts.removeGoesCalendarCache");
  });
});

describe("checkRowActions", () => {
  const ctx = { family: "google" as const, canSignIn: true };
  it("offers the action that helps, one per failed row", () => {
    expect(checkRowActions({ service: "files", state: "ok" }, ctx)).toEqual([]);
    expect(checkRowActions({ service: "files", state: "signin" }, ctx)).toEqual(["signIn"]);
    expect(checkRowActions({ service: "files", state: "expired" }, ctx)).toEqual(["signInAgain"]);
    expect(checkRowActions({ service: "calendar", state: "notGranted" }, ctx)).toEqual(["grant"]);
    expect(checkRowActions({ service: "files", state: "failed", detail: "x" }, { ...ctx, canSignIn: false })).toEqual(["openService"]);
    expect(checkRowActions({ service: "files", state: "failed", detailKey: "accountAccess.clientRejected", clientRejected: true }, { ...ctx, standardAvailable: true })).toEqual(["useStandard"]);
  });

  it("offers Gmail the app password where Google refuses it (E7)", () => {
    expect(checkRowActions({ service: "mail", state: "notGranted" }, ctx)).toEqual(["grant", "appPassword"]);
    expect(checkRowActions({ service: "mail", state: "failed", detail: "access_denied", refused: true }, ctx)).toEqual(["appPassword"]);
    // Microsoft mail is not Gmail.
    expect(checkRowActions({ service: "mail", state: "notGranted" }, { ...ctx, family: "microsoft" })).toEqual(["grant"]);
    expect(checkRowActionKey("appPassword")).toBe("cloudAccounts.connectAppPassword");
    expect(checkRowActionKey("grant")).toBe("cloudAccounts.grantAccess");
  });

  it("tells Google refusing Gmail from a sign-in that lapsed", () => {
    expect(isGmailAccessRefused("Error 403: access_denied - The app has not completed the Google verification process")).toBe(true);
    expect(isGmailAccessRefused("This app has reached its user cap")).toBe(true);
    expect(isGmailAccessRefused("invalid_grant: Token has been expired or revoked.")).toBe(false);
  });
});
