import { describe, expect, it } from "vitest";
import { createServiceGrantProbe, type CloudAccountRecord, type StoredAccountToken } from "@plainva/ui";

/**
 * The probe a calendar binding validates its grant with, before the card's
 * record exists (finding 2026-10-27): a new Google account connected with
 * files and calendar in one consent ended with the calendar row saying "the
 * target account or vault changed" - the probe read the identity of a record
 * the sign-in only writes once every service is bound.
 */

const CLIENT = { clientId: "client.apps.googleusercontent.com", clientSecret: "secret" };
const ANNA = { issuer: "google" as const, subject: "sub-anna" };
const BOB = { issuer: "google" as const, subject: "sub-bob" };
const SCOPES = "openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks";

function grant(identity = ANNA): StoredAccountToken {
  return { ...CLIENT, refreshToken: "refresh", scopes: SCOPES, providerIdentity: identity };
}

function probe(records: CloudAccountRecord[], token: StoredAccountToken | null, expectedIdentity = ANNA) {
  return createServiceGrantProbe(
    { accountId: "card-new", family: "google", service: "calendar", ...CLIENT, allowUnbound: true, expectedIdentity },
    { records: async () => records, token: async () => token, accessToken: async () => "access" },
  );
}

describe("service grant probe for a card the sign-in is creating", () => {
  it("takes the identity its grant proved while the card has no record yet", async () => {
    const auth = await probe([], grant());
    await expect(auth.getAccessToken()).resolves.toBe("access");
  });

  it("still refuses a grant of another account", async () => {
    await expect(probe([], grant(BOB))).rejects.toMatchObject({ reason: "accountChanged" });
  });

  it("still refuses an unbound card whose grant proved no identity", async () => {
    const token = grant();
    delete token.providerIdentity;
    await expect(probe([], token)).rejects.toMatchObject({ reason: "accountChanged" });
  });

  it("reads the record's identity once the card is written, not the grant's", async () => {
    const record: CloudAccountRecord = { id: "card-new", family: "google", label: "anna@example.com", verifiedProviderIdentity: BOB, services: {} };
    await expect(probe([record], grant(ANNA))).rejects.toMatchObject({ reason: "accountChanged" });
  });
});
