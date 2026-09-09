import { describe, expect, it, vi } from "vitest";
import { accountLoginBinding, assertAccountGrantIdentity, completeAccountGrant, reviewAccountGrant, oauthScopeFor, resolveFileBrokerAccount, type CloudAccountRecord } from "@plainva/ui";

const record: CloudAccountRecord = { id: "account", family: "google", label: "Person", services: { files: { provider: "drive" }, calendar: { pimAccountId: "calendar" } } };
const token = { clientId: "client", refreshToken: "new" };
const union = `${oauthScopeFor("google", "files")} ${oauthScopeFor("google", "calendar")}`;

describe("a consent is complete before existing sources change", () => {
  it.each(["google", "microsoft"] as const)("verifies the known %s subject through the provider API", async (family) => {
    const card = { ...record, family, verifiedProviderIdentity: { issuer: family, subject: "known" } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(family === "google" ? { sub: "known" } : { id: "known" })));
    await assertAccountGrantIdentity(card, "access", fetch);
    expect(fetch).toHaveBeenCalledWith(family === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me", { headers: { Authorization: "Bearer access" } });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(family === "google" ? { sub: "different" } : { id: "different" })));
    await expect(assertAccountGrantIdentity(card, "access", fetch)).rejects.toThrow(/different provider account/);
    await expect(assertAccountGrantIdentity(card, undefined, fetch)).rejects.toThrow(/could not be verified/);
  });
  it.each([undefined, "", oauthScopeFor("google", "files")])("keeps every old source for incomplete Google grant %s", async (scope) => {
    const save = vi.fn(), bind = vi.fn();
    await expect(completeAccountGrant({ record, review: reviewAccountGrant("google", ["files", "calendar"], token, union, scope), readRecord: async () => record, save, bind })).rejects.toMatchObject({ name: "AccountGrantMissingPermissionsError" });
    expect(save).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
  });

  it("distinguishes an omitted Microsoft scope from an explicitly empty one", () => {
    const requested = oauthScopeFor("microsoft", "files")!;
    expect(reviewAccountGrant("microsoft", ["files"], token, requested, undefined).missing).toEqual([]);
    expect(reviewAccountGrant("microsoft", ["files"], token, requested, "").missing).toEqual(["files"]);
    expect(() => reviewAccountGrant("microsoft", ["files"], token, requested, null)).toThrow(/invalid permissions/);
  });

  it("stores actual granted aliases, then binds in order", async () => {
    const events: string[] = [];
    const actual = union.replace(/\bemail\b/g, "https://www.googleapis.com/auth/userinfo.email");
    await completeAccountGrant({ record, review: reviewAccountGrant("google", ["files", "calendar"], token, union, actual), readRecord: async () => record,
      save: async (next) => { expect(next.scopes).toBe(actual); events.push("saved"); }, bind: async (service) => { events.push(service); } });
    expect(events).toEqual(["saved", "files", "calendar"]);
  });

  it.each([undefined, { ...record, services: { files: { provider: "onedrive" as const } } }])("cannot replace a removed or rebound account", async (current) => {
    const save = vi.fn();
    await expect(completeAccountGrant({ record, review: reviewAccountGrant("google", ["files", "calendar"], token, union, union), readRecord: async () => current, save, bind: vi.fn() })).rejects.toThrow(/account changed/);
    expect(save).not.toHaveBeenCalled();
  });

  it("an unconfirmed save cannot clear a service credential", async () => {
    const bind = vi.fn();
    await expect(completeAccountGrant({ record, review: reviewAccountGrant("google", ["files", "calendar"], token, union, union), readRecord: async () => record, save: async () => { throw Error("secure storage failed"); }, bind })).rejects.toThrow("secure storage failed");
    expect(bind).not.toHaveBeenCalled();
  });

  it("checks account binding again between service writes", async () => {
    let current = record;
    const bind = vi.fn(async () => { current = { ...record, services: { calendar: { pimAccountId: "different" } } }; });
    await expect(completeAccountGrant({ record, review: reviewAccountGrant("google", ["files", "calendar"], token, union, union), readRecord: async () => current, save: async () => {}, bind })).rejects.toThrow(/account changed/);
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("ignores label changes and canonicalizes the provider identity", () => {
    expect(accountLoginBinding({ ...record, label: "before", verifiedProviderIdentity: { issuer: " GOOGLE ", subject: "1" } }))
      .toBe(accountLoginBinding({ ...record, label: "after", verifiedProviderIdentity: { subject: "1", issuer: "google" } }));
  });
});

describe("file workers resolve a concrete provider and client", () => {
  const microsoft: CloudAccountRecord = { id: "m", family: "microsoft", label: "Person", services: { files: { provider: "onedrive" } } };
  const read = async () => ({ ...token, scopes: union });
  it("cannot give OneDrive a Drive grant or an unrelated client", async () => {
    expect(await resolveFileBrokerAccount([record], { provider: "onedrive", clientId: "client" }, read)).toBeUndefined();
    expect(await resolveFileBrokerAccount([record], { provider: "drive", clientId: "other" }, read)).toBeUndefined();
    expect(await resolveFileBrokerAccount([record, microsoft], { provider: "drive", clientId: "client" }, read)).toBe(record);
  });
  it("rejects two usable accounts instead of picking the first", async () => {
    expect(await resolveFileBrokerAccount([record, { ...record, id: "other" }], { provider: "drive", clientId: "client" }, read)).toBeUndefined();
    expect(await resolveFileBrokerAccount([record, { ...record, id: "other" }], { provider: "drive", clientId: "client", accountId: "other" }, read)).toMatchObject({ id: "other" });
  });
});
