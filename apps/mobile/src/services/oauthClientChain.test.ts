import { describe, expect, it } from "vitest";

import { pickOAuthClient } from "./oauthClientChain";

/**
 * The chain that answers "what can this device sign the account in WITH".
 *
 * The rule it encodes is the finding of 2026-08-19: a row that arrived through
 * the settings sync carries NO client id locally — they are stripped from the
 * profile on purpose — so looking only in its own slot produced "Google needs
 * its own client id" for an id the device was already holding twice over.
 */
describe("pickOAuthClient", () => {
  it("prefers the account's own slot over everything else", () => {
    const found = pickOAuthClient("google", {
      own: { kind: "google", clientId: "own", clientSecret: "s", refreshToken: "r" },
      accountToken: { clientId: "token" },
      syncProvider: { provider: "drive", creds: { clientId: "sync" } },
    });
    expect(found).toEqual({ clientId: "own", clientSecret: "s" });
  });

  it("falls back to the shared account token", () => {
    const found = pickOAuthClient("google", {
      own: null,
      accountToken: { clientId: "token", clientSecret: "ts" },
    });
    expect(found).toEqual({ clientId: "token", clientSecret: "ts" });
  });

  it("uses the file-sync provider of the matching family", () => {
    const found = pickOAuthClient("google", {
      syncProvider: { provider: "drive", creds: { clientId: "sync", clientSecret: "ss" } },
    });
    expect(found).toEqual({ clientId: "sync", clientSecret: "ss" });
  });

  it("never takes a client id from the wrong family", () => {
    expect(
      pickOAuthClient("microsoft", { syncProvider: { provider: "drive", creds: { clientId: "sync" } } }),
    ).toBeNull();
  });

  it("ignores a sync provider that has no client id at all", () => {
    expect(
      pickOAuthClient("google", { syncProvider: { provider: "webdav", creds: { user: "u", pass: "p" } } }),
    ).toBeNull();
  });

  it("borrows from a sibling account of the same family as a last resort", () => {
    const found = pickOAuthClient("google", {
      siblings: [
        { kind: "caldav", url: "https://x", user: "u", pass: "p" },
        { kind: "google", clientId: "sib", clientSecret: "ss", refreshToken: "r" },
      ],
    });
    expect(found).toEqual({ clientId: "sib", clientSecret: "ss" });
  });

  it("returns null when the device holds nothing — that is what the form is for", () => {
    expect(pickOAuthClient("google", {})).toBeNull();
  });
});
