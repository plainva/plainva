import { describe, expect, it } from "vitest";
import { isSealedBlob, openSecretsBundle, parseProfile, serializeProfile } from "../src/index.js";
import {
  V060_FIXTURE_KEY,
  V060_LOGICAL_IDS,
  V060_PROFILE_DOC,
  createV060SecretsEncFixture,
} from "./fixtures/account-sync-v0.6.0.js";

describe("sanitized v0.6.0 account-sync fixtures", () => {
  it("uses the current profile schema and only reserved fixture identities", () => {
    const parsed = parseProfile(serializeProfile(V060_PROFILE_DOC));
    expect(parsed).toEqual(V060_PROFILE_DOC);
    expect(serializeProfile(parsed!)).toContain("example.invalid");
    expect(serializeProfile(parsed!)).not.toMatch(/@gmail\.com|@googlemail\.com|refreshToken|accessToken/);
  });

  it("builds a real encrypted secrets.enc fixture without token material", () => {
    const encrypted = createV060SecretsEncFixture();
    expect(isSealedBlob(encrypted)).toBe(true);
    const opened = openSecretsBundle(V060_FIXTURE_KEY, encrypted);
    expect(Object.keys(opened.entries).sort()).toEqual(
      [V060_LOGICAL_IDS.mail, V060_LOGICAL_IDS.pim].sort(),
    );
    expect(JSON.stringify(opened)).not.toMatch(/refreshToken|accessToken/);
  });
});

