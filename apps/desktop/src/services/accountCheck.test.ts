import { describe, expect, it } from "vitest";
import { accountCheckDiagnostic, checkAccountConnection, serviceCheckKey, type CloudServiceId } from "@plainva/ui";

/**
 * "Check connection" on an account card (account sign-in plan E6): each
 * service reads something small and says whether it works, or why not. The
 * shells only supply the probes; what a row says is decided here, once.
 */

function ports(over: {
  covered?: (service: CloudServiceId) => boolean | null;
  probe?: (service: CloudServiceId) => void;
}) {
  const probed: CloudServiceId[] = [];
  return {
    probed,
    ports: {
      services: ["files", "calendar", "mail"] as CloudServiceId[],
      covered: async (service: CloudServiceId) => (over.covered ? over.covered(service) : true),
      probe: async (service: CloudServiceId) => {
        probed.push(service);
        over.probe?.(service);
      },
      describe: (error: unknown) => `said: ${error instanceof Error ? error.message : String(error)}`,
    },
  };
}

describe("checkAccountConnection", () => {
  it("says every service works when each probe reads", async () => {
    const { ports: p } = ports({});
    expect(await checkAccountConnection(p)).toEqual([
      { service: "files", state: "ok" },
      { service: "calendar", state: "ok" },
      { service: "mail", state: "ok" },
    ]);
  });

  it("names a service the grant does not cover without asking the provider", async () => {
    const { ports: p, probed } = ports({ covered: (service) => service !== "calendar" });
    const rows = await checkAccountConnection(p);
    expect(rows[1]).toEqual({ service: "calendar", state: "notGranted" });
    expect(probed).toEqual(["files", "mail"]);
  });

  it("probes a service that signs in without OAuth (covered is null)", async () => {
    const { ports: p, probed } = ports({ covered: (service) => (service === "mail" ? null : true) });
    expect((await checkAccountConnection(p))[2]).toEqual({ service: "mail", state: "ok" });
    expect(probed).toContain("mail");
  });

  it("tells a lapsed sign-in from any other failure", async () => {
    const { ports: p } = ports({
      probe: (service) => {
        if (service === "files") throw new Error("invalid_grant: Token has been expired or revoked.");
        if (service === "mail") throw new Error("connection refused by imap.example");
      },
    });
    const rows = await checkAccountConnection(p);
    expect(rows[0]).toEqual({ service: "files", state: "expired" });
    expect(rows[1]).toEqual({ service: "calendar", state: "ok" });
    expect(rows[2]).toEqual({ service: "mail", state: "failed", detail: "said: connection refused by imap.example" });
  });
});

describe("accountCheckDiagnostic", () => {
  it("is one line of family and states - never an address or a token", () => {
    const line = accountCheckDiagnostic("google", [
      { service: "files", state: "ok" },
      { service: "mail", state: "failed", detail: "anna@example.com: token abc refused" },
    ]);
    expect(line).toBe("account check google: files=ok mail=failed");
    expect(accountCheckDiagnostic("microsoft", [])).toBe("account check microsoft: no services");
  });

  it("maps each state to its sentence", () => {
    expect(serviceCheckKey("ok")).toBe("cloudAccounts.checkOk");
    expect(serviceCheckKey("expired")).toBe("cloudAccounts.checkExpired");
    expect(serviceCheckKey("notGranted")).toBe("cloudAccounts.checkNotGranted");
    expect(serviceCheckKey("failed")).toBe("cloudAccounts.checkFailed");
  });
});
