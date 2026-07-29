import { describe, expect, it } from "vitest";
import { classifyAuthError, needsReauthorisation } from "@plainva/ui";
import { formatOAuthError, parseOAuthErrorBody } from "@plainva/core";

/**
 * The chain this covers: a provider rejects a token request, the core keeps the
 * machine-readable code in the message, the message survives as a plain string
 * in the PIM cache, and the settings turn it back into an instruction.
 *
 * The case that started it (2026-07-28): a Google calendar reporting
 * `400 Bad Request` next to a "Try again" button, while the actual answer was
 * `invalid_grant` — a retry could never have helped.
 */
describe("OAuth error body", () => {
  it("keeps the code and the first line of the description", () => {
    const detail = parseOAuthErrorBody({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.\nsecond line",
    });
    expect(detail).toEqual({ code: "invalid_grant", description: "Token has been expired or revoked." });
  });

  it("survives a body that is not the expected shape", () => {
    expect(parseOAuthErrorBody(null)).toEqual({});
    expect(parseOAuthErrorBody("nope")).toEqual({});
    expect(parseOAuthErrorBody({ error: 42 })).toEqual({});
  });

  it("puts the code into the message so it can be classified later", () => {
    const message = formatOAuthError("Google token refresh failed", 400, "Bad Request", {
      code: "invalid_grant",
      description: "Token has been expired or revoked.",
    });
    expect(message).toBe(
      "Google token refresh failed: 400 Bad Request — invalid_grant: Token has been expired or revoked."
    );
    expect(classifyAuthError(message)).toBe("expired");
  });

  it("still reads as before when the provider sent no body", () => {
    expect(formatOAuthError("Google token refresh failed", 400, "Bad Request", {})).toBe(
      "Google token refresh failed: 400 Bad Request"
    );
  });
});

describe("classifyAuthError", () => {
  it("treats a lost authorisation as expired, whoever reported it", () => {
    expect(classifyAuthError("Google token refresh failed: 400 Bad Request — invalid_grant")).toBe("expired");
    expect(classifyAuthError("Microsoft token request failed: 400 Bad Request — AADSTS700082: expired")).toBe("expired");
    expect(needsReauthorisation("… invalid_grant …")).toBe(true);
  });

  it("separates a misconfigured client from an expired sign-in", () => {
    expect(classifyAuthError("Microsoft token request failed: 400 — AADSTS7000218: public client flows")).toBe("config");
    expect(classifyAuthError("… invalid_client: The OAuth client was not found.")).toBe("config");
    expect(needsReauthorisation("… invalid_client …")).toBe(false);
  });

  it("recognises the case where retrying IS the answer", () => {
    expect(classifyAuthError("Failed to fetch")).toBe("network");
    expect(classifyAuthError("request timed out after 30s")).toBe("network");
  });

  it("says unknown rather than guessing", () => {
    expect(classifyAuthError("something went sideways")).toBe("unknown");
    expect(classifyAuthError(undefined)).toBe("unknown");
    expect(classifyAuthError("")).toBe("unknown");
  });
});
