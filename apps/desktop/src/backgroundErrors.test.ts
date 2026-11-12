// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearDiagnosticsForTests,
  describeBackgroundError,
  getDiagnostics,
  logDiagnostic,
  reportBackground,
  reportingTo,
  reportVisible,
  toast,
  toastStore,
} from "@plainva/ui";

/** The failures nobody watches (stability plan R4): one helper, into the diagnostics. */
afterEach(() => {
  clearDiagnosticsForTests();
  toast.clearAll();
});

describe("reportBackground", () => {
  it("writes the area, the kind and the first line of the message, never the rest", () => {
    reportBackground("index:rename", new TypeError("cannot read 'x'\n    at secret (note text here)"));
    expect(getDiagnostics()).toEqual([{ ts: expect.any(Number), source: "index:rename", message: "TypeError: cannot read 'x'" }]);
  });

  it("cuts a long message and takes strings and plugin objects as they come", () => {
    expect(describeBackgroundError("x".repeat(400))).toBe(`string: ${"x".repeat(160)}…`);
    expect(describeBackgroundError({ message: "Filesystem: no space left" })).toBe("object: Filesystem: no space left");
    expect(describeBackgroundError(undefined)).toBe("undefined");
    expect(describeBackgroundError(null)).toBe("object");
  });

  it("never throws, whatever it is handed", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", { get() { throw new Error("getter"); } });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => reportBackground("a", hostile)).not.toThrow();
    expect(() => reportBackground("a", revoked.proxy)).not.toThrow();
    expect(() => reportBackground("a", Object.create(null))).not.toThrow();
    // What is left of each: the kind (a message that throws on reading is no message).
    expect(getDiagnostics().map((e) => `${e.source} ${e.message}`)).toEqual(["a Error", "a object (2×)"]);
  });

  it("counts a repeat on its first line instead of a line each, with other lines between", () => {
    const fail = reportingTo("index:pass");
    for (let i = 0; i < 1000; i++) {
      fail(new Error("database is locked"));
      if (i === 10) logDiagnostic("sync", "something else");
    }
    reportBackground("index:pass", new Error("another reason"));
    expect(getDiagnostics().map((e) => `${e.source} ${e.message}`)).toEqual([
      "index:pass Error: database is locked (1000×)",
      "sync something else",
      "index:pass Error: another reason",
    ]);
  });

  it("keeps secrets out, as every diagnostics line does", () => {
    reportBackground("mail:send", new Error("401 for https://me:hunter2@example.com token=abc"));
    expect(getDiagnostics()[0]!.message).not.toMatch(/hunter2|abc/);
  });

  it("keeps out what provider errors echo: an API key, an OAuth code, a bare bearer token, a mailbox's address", () => {
    const shapes = [
      "Request failed https://www.googleapis.com/drive/v3/files?key=AIzaSyA-EXAMPLEKEY123&q=x",
      "token exchange failed: https://example.com/cb?code=4/0AbCdEfSECRETCODE&state=xyz",
      "Bearer eyJhbGciOiJSUzI1NiJ9.SECRETJWT rejected",
      "IMAP NO [AUTHENTICATIONFAILED] Invalid credentials for jane.doe@example.org",
    ];
    for (const shape of shapes) reportBackground("provider", new Error(shape));
    const lines = getDiagnostics().map((e) => e.message).join("\n");
    expect(lines).not.toMatch(/AIzaSyA|SECRETCODE|SECRETJWT|jane\.doe|example\.org/);
    expect(lines).toContain("key=[REDACTED]");
    expect(lines).toContain("code=[REDACTED]");
    expect(lines).toContain("Bearer [REDACTED]");
    expect(lines).toContain("for [email]");
  });

  it("keeps out what storage and mail services echo as well, and leaves a status code in prose alone", () => {
    const shapes = [
      "PUT https://acct.blob.core.windows.net/c/n.md?sv=2022&sig=AZURESECRETSIG%3D&se=x failed",
      "GET https://b.s3.amazonaws.com/n.md?X-Amz-Credential=AKIAEXAMPLE%2F2026&X-Amz-Signature=S3SECRETSIG refused",
      "request headers: x-goog-api-key: AIzaHEADERKEY123",
      "token sl.BxXDROPBOXSECRETTOKEN0123456789abcdef rejected",
      "A1 LOGIN jane hunter2secret",
      "AUTH PLAIN AGphbmUAaHVudGVyMg==",
      "From: jane.doe=40example.org",
      "request failed with status code=403",
    ];
    for (const shape of shapes) reportBackground("provider", new Error(shape));
    const lines = getDiagnostics().map((e) => e.message).join("\n");
    expect(lines).not.toMatch(/AZURESECRETSIG|AKIAEXAMPLE|S3SECRETSIG|AIzaHEADERKEY|DROPBOXSECRET|hunter2secret|AGphbmUA|jane\.doe/);
    expect(lines).toContain("status code=403");
  });
});

describe("reportVisible", () => {
  it("writes the line and says it on screen", () => {
    reportVisible("bookmarks:save", new Error("disk full"), "The bookmarks could not be saved: disk full");
    expect(toastStore.get().map((t) => [t.kind, t.message])).toEqual([["error", "The bookmarks could not be saved: disk full"]]);
    expect(getDiagnostics().map((e) => e.source)).toEqual(["bookmarks:save", "toast.error"]);
  });
});
