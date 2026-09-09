import { describe, expect, it } from "vitest";
import { exchangeCode } from "../../src/sync/DriveAuth.js";
import { exchangeOneDriveCode } from "../../src/sync/OneDriveAuth.js";

describe("provider consent field boundaries", () => {
  const options = { clientId: "client", clientSecret: "secret", code: "code", codeVerifier: "verifier", redirectUri: "http://localhost" };
  for (const [name, exchange] of [["Google", exchangeCode], ["Microsoft", exchangeOneDriveCode]] as const) {
    it(`${name} preserves explicitly empty permissions`, async () => {
      const result = await exchange(options, async () => new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", scope: "" })));
      expect(result.scope).toBe("");
    });
    it.each([{ scope: null }, { scope: 42 }, { access_token: {} }, { refresh_token: [] }])(`${name} rejects malformed consent fields %j`, async (bad) => {
      await expect(exchange(options, async () => new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", ...bad })))).rejects.toThrow();
    });
  }
});
