import { describe, expect, it } from "vitest";
import { normalizeOAuthScopes, oauthScopeFor, oauthScopesCover, tokenCoversService } from "@plainva/ui";

describe("provider grant permissions", () => {
  it("accepts Google's documented identity aliases without turning identity into data access", () => {
    const granted = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive";
    expect(normalizeOAuthScopes(granted, "google")).toContain("email");
    expect(tokenCoversService({ clientId: "client", refreshToken: "test", scopes: granted }, "files", "google")).toBe(true);
    expect(tokenCoversService({ clientId: "client", refreshToken: "test", scopes: "openid email profile" }, "files", "google")).toBe(false);
    expect(tokenCoversService({ clientId: "client", refreshToken: "test", scopes: granted }, "calendar", "google")).toBe(false);
    expect(tokenCoversService({ clientId: "client", refreshToken: "test", scopes: granted }, "mail", "google")).toBe(false);
  });

  it("accepts qualified Graph scopes but never another resource's same-named permission", () => {
    const needed = oauthScopeFor("microsoft", "files")!;
    expect(oauthScopesCover("https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read", needed, "microsoft")).toBe(true);
    expect(oauthScopesCover("https://other.example.invalid/Files.ReadWrite User.Read", needed, "microsoft")).toBe(false);
    expect(oauthScopesCover("Files.ReadWrite User.Read", oauthScopeFor("microsoft", "mail")!, "microsoft")).toBe(false);
  });

  it("distinguishes an old unrecorded Microsoft grant from an explicitly insufficient answer", () => {
    const stored = { clientId: "client", refreshToken: "test" };
    expect(tokenCoversService(stored, "calendar", "microsoft")).toBe(true);
    expect(tokenCoversService({ ...stored, scopes: "" }, "calendar", "microsoft")).toBe(false);
    expect(tokenCoversService({ ...stored, scopes: "Files.ReadWrite User.Read" }, "calendar", "microsoft")).toBe(false);
    expect(tokenCoversService(stored, "files", "google")).toBe(false);
  });
});
