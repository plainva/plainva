import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EndpointNotConfirmedError, pimAccountFailure, syncProblemReason, unconfirmedEndpointInText } from "@plainva/ui";

/**
 * F57 on the phone's calendar (review of F57, rounds three and four, O-5, O-B):
 * an account whose CalDAV address this phone has not confirmed waits visibly.
 * The builder that refuses it with its address is `refusingUnconfirmed`
 * (pimTargetCredentials.test.ts); this pins that the phone's check, its event
 * writes and its invitation answers ask that builder, and that the shared
 * lines the phone shows read the refusal as Confirm address.
 */
describe("the phone's calendar asks the refusing builder", () => {
  const service = readFileSync(join(__dirname, "pimService.ts"), "utf8");

  it("Check connection", () => {
    expect(service).toMatch(/export async function checkPimAccount[\s\S]{0,900}const target = await syncTargetFor\(vaultId, row\);/);
  });

  it("event writes and invitation answers", () => {
    expect(service).toMatch(/const eventTargets: EventTargets = \{[\s\S]{0,400}return account \? runtime\.syncTarget\(account\) : null;/);
    expect(service).toMatch(/export async function respondToPimEvent[\s\S]{0,500}const target = await runtime\.syncTarget\(account\);/);
  });
});

describe("the lines the phone shows for a refused calendar", () => {
  const t = (key: string, opts?: Record<string, unknown>) => `${key}${opts?.address ? `:${String(opts.address)}` : ""}`;
  const refusal = new EndpointNotConfirmedError("http://192.168.1.6:80");

  it("read the address out of the refusal kept as text", () => {
    expect(unconfirmedEndpointInText(refusal.message)).toBe("http://192.168.1.6:80");
    expect(unconfirmedEndpointInText("HTTP 401")).toBeNull();
  });

  it("say Confirm address above the calendar and on the account's row, never a sign-in", () => {
    const problem = { accountId: "cal", accountLabel: "NAS", provider: "caldav" as const, since: null, error: refusal.message, signIn: true };
    expect(syncProblemReason(problem, t as never)).toBe("cloudAccounts.confirmAddress:http://192.168.1.6:80");
    expect(pimAccountFailure(refusal.message, "caldav", t as never)).toMatchObject({ title: "cloudAccounts.confirmAddress:http://192.168.1.6:80", signIn: false });
  });
});
