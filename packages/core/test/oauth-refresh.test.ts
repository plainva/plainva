import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  refreshOAuthToken,
  refreshTokenBody,
  readRefreshResponse,
} from "../src/sync/oauthRefresh.js";
import { refreshDriveAccessToken } from "../src/sync/DriveAuth.js";
import { refreshOneDriveAccessToken } from "../src/sync/OneDriveAuth.js";
import { refreshDropboxAccessToken } from "../src/sync/DropboxAuth.js";

function res(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), { status: ok ? status : status });
}

describe("the one refresh grant (C6/S19)", () => {
  it("fails a 200 that carries no access token, instead of handing undefined on", async () => {
    // The rule that had reached two of the four grants. Passing `undefined` on
    // turns every later call into `Bearer undefined`, which the provider
    // answers with an auth error for something that never authenticated —
    // cached for the token's supposed lifetime (finding 2026-07-30).
    await expect(readRefreshResponse("X failed", res({ expires_in: 3600 }))).rejects.toThrow(
      /returned no access token/
    );
  });

  it("keeps the provider's error code verbatim so the UI can classify it", async () => {
    // `invalid_grant` is what tells the UI to offer "sign in again" rather than
    // "check your configuration"; it survives the PIM cache as a plain string.
    await expect(
      readRefreshResponse(
        "Google token refresh failed",
        res({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, false, 400)
      )
    ).rejects.toThrow(/invalid_grant: Token has been expired or revoked/);
  });

  it("reads Dropbox's error_summary, which is not an OAuth 2.0 field", async () => {
    // Dropbox is why one of the four grants had a hand-copied error formatter.
    // Losing this detail would have been the price of merging them.
    await expect(
      readRefreshResponse("Dropbox token request failed", res({ error_summary: "invalid_grant/..." }, false, 400))
    ).rejects.toThrow(/invalid_grant/);
  });

  it("passes a rotated refresh token back — losing it locks the next start out", async () => {
    const r = await readRefreshResponse("X failed", res({ access_token: "a", refresh_token: "rotated" }));
    expect(r.refreshToken).toBe("rotated");
  });

  it("omits an absent secret and scope rather than sending them empty", () => {
    // A public client that sends `client_secret=` is not the same request.
    const pub = refreshTokenBody({ clientId: "c", refreshToken: "r" });
    expect(pub.has("client_secret")).toBe(false);
    expect(pub.has("scope")).toBe(false);
    expect(pub.get("grant_type")).toBe("refresh_token");
    const conf = refreshTokenBody({ clientId: "c", refreshToken: "r", clientSecret: "s", scope: "files" });
    expect(conf.get("client_secret")).toBe("s");
    expect(conf.get("scope")).toBe("files");
  });

  it("reports the scope the provider GRANTED, not the one that was asked for", async () => {
    // Google ignores a requested scope on refresh and answers with the
    // consent's own set (finding 2026-07-30).
    const r = await readRefreshResponse("X failed", res({ access_token: "a", scope: "drive.file" }));
    expect(r.scope).toBe("drive.file");
  });

  it("posts form-encoded to the given endpoint", async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const fetchFn = vi.fn(async (u: unknown, i?: RequestInit) => {
      seen.push([String(u), i]);
      return res({ access_token: "a" });
    });
    await refreshOAuthToken(
      { label: "X failed", endpoint: "https://example.org/token", clientId: "c", refreshToken: "r" },
      fetchFn as never
    );
    expect(seen[0][0]).toBe("https://example.org/token");
    expect(seen[0][1]?.method).toBe("POST");
    expect(String(seen[0][1]?.body)).toContain("grant_type=refresh_token");
  });
});

describe("every provider renews through it", () => {
  const cases: Array<[string, (f: unknown) => Promise<{ accessToken: string }>]> = [
    ["Google", (f) => refreshDriveAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "r" }, f as never)],
    ["Microsoft", (f) => refreshOneDriveAccessToken({ clientId: "c", refreshToken: "r" }, f as never)],
    ["Dropbox", (f) => refreshDropboxAccessToken({ appKey: "k", refreshToken: "r" }, f as never)],
  ];

  for (const [name, call] of cases) {
    it(`${name}: a 200 without a token fails rather than returning one`, async () => {
      const fetchFn = vi.fn(async () => res({ expires_in: 3600 }));
      await expect(call(fetchFn)).rejects.toThrow(/no access token/);
    });

    it(`${name}: the reason survives into the message`, async () => {
      const fetchFn = vi.fn(async () => res({ error: "invalid_grant" }, false, 400));
      await expect(call(fetchFn)).rejects.toThrow(/invalid_grant/);
    });
  }
});

describe("no fifth grant", () => {
  it("is written in exactly one file", () => {
    // A source-reading guard on purpose: a test with mocks would prove the
    // mocks agree. What matters is that nobody writes a fifth grant — which is
    // how the four drifted apart in the first place.
    const roots = ["packages/core/src", "apps/desktop/src", "apps/mobile/src", "packages/ui/src"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return; // a package that does not exist in this checkout
      }
      for (const e of entries) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
        const src = readFileSync(p, "utf8");
        // Only actual grant construction counts, not the word in prose.
        if (/grant_type["']?\s*[:=]\s*["']refresh_token["']/.test(src)) hits.push(p);
      }
    };
    for (const r of roots) walk(join(process.cwd(), "..", "..", r));
    expect(hits.map((h) => h.replace(/\\/g, "/").split("/").pop())).toEqual(["oauthRefresh.ts"]);
  });
});
