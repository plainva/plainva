import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A Dropbox app key the user brought must reach BOTH the handshake and the
 * stored credentials.
 *
 * The central Plainva registration hit Dropbox's user limit (#48), so a user
 * can now supply their own app key. The trap is that Dropbox refreshes tokens
 * against the app key: a key used only for the first authorization works once
 * and then locks the vault out on the next refresh, hours later, with an error
 * that points at the token rather than at the key.
 *
 * Reading the source is a blunt instrument, but it is the honest one here —
 * `finishOAuth` needs a persisted transaction, a browser redirect and the
 * platform bridge, and a test that mocked all three would be asserting against
 * its own mocks. What can go wrong is a literal constant left in one of the
 * three places, and that is exactly what this catches.
 */
describe("Dropbox: a user-supplied app key", () => {
  const source = readFileSync(join(__dirname, "oauthService.ts"), "utf-8");

  const dropboxBlock = (() => {
    const start = source.indexOf('if (flow.provider === "dropbox")');
    expect(start, "the dropbox branch of finishOAuth must exist").toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('} else if (flow.provider === "onedrive")', start));
  })();

  it("falls back to the central key only where a fallback belongs", () => {
    // Authorization URL and the exchange/storage block each resolve the key
    // once, with the central registration as the fallback.
    expect(source).toContain("appKey: extras.clientId || PLAINVA_DROPBOX_APP_KEY");
    expect(dropboxBlock).toContain("const appKey = flow.extras.clientId || PLAINVA_DROPBOX_APP_KEY");
  });

  it("never passes the central key straight to the exchange or the credentials", () => {
    // Both would compile, both would connect, and both would break the refresh.
    expect(dropboxBlock).not.toMatch(/appKey:\s*PLAINVA_DROPBOX_APP_KEY/);
  });

  it("stores the same key it authorized with", () => {
    expect(dropboxBlock).toMatch(/exchangeDropboxCode\(\s*\{\s*appKey,/);
    expect(dropboxBlock).toMatch(/creds:\s*\{\s*appKey,/);
  });
});
