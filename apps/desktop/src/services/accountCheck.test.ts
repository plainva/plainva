import { describe, expect, it } from "vitest";
import { accessLineText, accountCheckDiagnostic, checkAccountConnection, checkRowActions, isOwnClientRejected, serviceCheckKey, serviceCheckText, serviceConnectionMessage, ServiceCheckError, shortClientId, standardAccessAvailable, type CloudServiceId } from "@plainva/ui";

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

/**
 * Plan "Verbinden", V0: a card signed out here, a probe that knows its reason,
 * and an action on every row that does not work.
 */
describe("checkAccountConnection - sign-in on this device", () => {
  it("answers every service with 'not signed in' when the card has no sign-in here, without asking anyone", async () => {
    const { ports: p, probed } = ports({ covered: () => false });
    const rows = await checkAccountConnection({ ...p, cardSignedIn: async () => false });
    expect(rows.map((row) => row.state)).toEqual(["signin", "signin", "signin"]);
    expect(probed).toEqual([]);
  });

  it("checks as before when the card has no sign-in of its own", async () => {
    const { ports: p } = ports({});
    const rows = await checkAccountConnection({ ...p, cardSignedIn: async () => null });
    expect(rows.every((row) => row.state === "ok")).toBe(true);
  });

  it("takes the reason a probe already knows - no raw provider text", async () => {
    const { ports: p } = ports({
      probe: (service) => {
        if (service === "calendar") throw new ServiceCheckError("signin");
        if (service === "mail") throw new ServiceCheckError("failed", "connection.notConnected");
      },
    });
    const rows = await checkAccountConnection(p);
    expect(rows[1]).toEqual({ service: "calendar", state: "signin" });
    expect(rows[2]).toEqual({ service: "mail", state: "failed", detailKey: "connection.notConnected" });
    const t = (key: string) => `<${key}>`;
    expect(serviceCheckText(rows[1], t)).toBe("<deviceSignIn.notSignedIn>");
    expect(serviceCheckText(rows[2], t)).toBe("<connection.notConnected>");
    expect(serviceCheckText({ service: "files", state: "failed", detail: "said: x" }, t)).toBe("said: x");
  });

  it("names the state of a row without a sign-in here", () => {
    expect(serviceCheckKey("signin")).toBe("deviceSignIn.notSignedIn");
  });

  it("marks Gmail refused by Google itself, not by this sign-in (E7)", async () => {
    const { ports: p } = ports({ probe: (service) => { if (service === "mail") throw new Error("access_denied: the app has not completed the Google verification process"); } });
    const rows = await checkAccountConnection(p);
    expect(rows[2]).toMatchObject({ service: "mail", state: "failed", refused: true });
  });
});

/**
 * Finding 2026-10-26 (Android build 0.8.6.5): an own client Google had deleted
 * - "Error 401: deleted_client". The check names it and offers the standard
 * sign-in where the build has one; the page names the client in use.
 */
describe("a client the provider refuses", () => {
  it("is named as such and offers the standard sign-in", async () => {
    const { ports: p } = ports({ probe: (service) => { if (service === "files") throw new Error("deleted_client: The OAuth client was deleted."); } });
    const rows = await checkAccountConnection(p);
    expect(rows[0]).toEqual({ service: "files", state: "failed", detailKey: "accountAccess.clientRejected", clientRejected: true });
    expect(checkRowActions(rows[0], { family: "google", canSignIn: true, standardAvailable: true })).toEqual(["useStandard"]);
    // Without a standard client in this build, signing in again is what is left.
    expect(checkRowActions(rows[0], { family: "google", canSignIn: true, standardAvailable: false })).toEqual(["signInAgain"]);
  });

  it("is told apart from a changed account in the failure sentence", () => {
    const t = (key: string) => key;
    expect(isOwnClientRejected(new Error("unauthorized_client"))).toBe(true);
    expect(isOwnClientRejected(new Error("invalid_grant"))).toBe(false);
    expect(serviceConnectionMessage(new Error("Error 401: deleted_client"), t)).toBe("accountAccess.clientRejected");
  });

  it("shows which client signs in, with the tail of an own id", () => {
    const t = (key: string, options?: Record<string, unknown>) => (options?.id ? `${key}(${String(options.id)})` : key);
    const problem = (p: string) => `problem.${p}`;
    expect(accessLineText({ ok: true, access: { family: "google", source: "plainva", clientId: "x", flow: "browser", mail: true } }, t, problem)).toBe("accountAccess.plainva");
    expect(accessLineText({ ok: true, access: { family: "google", source: "own", clientId: "1234-abcdef987654.apps.googleusercontent.com", flow: "browser", mail: false } }, t, problem)).toBe("accountAccess.ownLine(…987654)");
    expect(shortClientId("8a1f3c2e-0000-4000-8000-1234567890ab")).toBe("…7890ab");
    expect(standardAccessAvailable("google", "android", { source: "own", clientId: "x" }, {})).toBe(false);
    expect(standardAccessAvailable("microsoft", "android", { source: "own", clientId: "x" }, {})).toBe(true);
    expect(standardAccessAvailable("microsoft", "android", { source: "plainva" }, {})).toBe(false);
  });
});
