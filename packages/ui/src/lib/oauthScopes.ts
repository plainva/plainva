import { DRIVE_DEFAULT_SCOPE, GOOGLE_CALENDAR_SCOPES, GRAPH_CALENDAR_SCOPES, ONEDRIVE_DEFAULT_SCOPE } from "@plainva/core";

export type OAuthFamily = "google" | "microsoft";
export const GRAPH_MAIL_SCOPES = "User.Read Mail.ReadWrite Mail.Send offline_access";

/** Provider-documented spellings, without guessing wider permissions. */
export function normalizeOAuthScopes(scopes: string, family?: OAuthFamily): string[] {
  return [...new Set(scopes.split(/\s+/).filter(Boolean).map((scope) => {
    if (family === "google") {
      if (scope === "https://www.googleapis.com/auth/userinfo.email") return "email";
      if (scope === "https://www.googleapis.com/auth/userinfo.profile") return "profile";
    }
    if (family === "microsoft" && scope.startsWith("https://graph.microsoft.com/")) {
      return scope.slice("https://graph.microsoft.com/".length);
    }
    return scope;
  }))].sort();
}

/** Identity and offline consent are not permissions to a service's data. */
export function oauthScopesCover(granted: string | undefined, requested: string, family?: OAuthFamily): boolean {
  if (granted === undefined) return false;
  const actual = new Set(normalizeOAuthScopes(granted, family));
  const identity = new Set(["openid", "email", "profile", "offline_access"]);
  const required = normalizeOAuthScopes(requested, family).filter((scope) => !identity.has(scope));
  return required.length > 0 && required.every((scope) => actual.has(scope));
}

export function oauthScopeFor(family: OAuthFamily, audience: string): string | null {
  if (family === "google") {
    if (audience === "files") return DRIVE_DEFAULT_SCOPE;
    if (audience === "calendar") return GOOGLE_CALENDAR_SCOPES;
    return null;
  }
  if (audience === "files") return ONEDRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GRAPH_CALENDAR_SCOPES;
  if (audience === "mail") return GRAPH_MAIL_SCOPES;
  return null;
}
