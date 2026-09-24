import { describe, expect, it } from "vitest";
import { connectionFailureCode, CONNECTION_FAILURE_CODES } from "../src/sync/connectionFailure.js";
import { classifySyncError, isRequestSendFailure } from "../src/sync/errorKind.js";

describe("connection failures across native bridges", () => {
  it.each(CONNECTION_FAILURE_CODES)("preserves %s after bridge serialization and worker wrapping", code => {
    expect(connectionFailureCode({ code, message: "private transport context" })).toBe(code);
    expect(connectionFailureCode(new Error(`pull failed: ${code}`))).toBe(code);
  });
  it.each([
    ["connection failed: invalid peer certificate: UnknownIssuer", "TLS_CERTIFICATE_UNTRUSTED"],
    ["connection failed: invalid peer certificate: NotValidForName", "TLS_HOSTNAME_MISMATCH"],
    ["SSL certificate problem: certificate has expired", "TLS_CERTIFICATE_EXPIRED"],
    ["connection: certificate is not yet valid", "TLS_CERTIFICATE_NOT_YET_VALID"],
    ["TLS handshake failed", "TLS_HANDSHAKE_FAILED"],
  ])("classifies desktop cause %s without retrying invalid TLS", (message, expected) => {
    expect(connectionFailureCode(message)).toBe(expected);
    expect(classifySyncError(new Error(message))).toBe("fatal");
  });
  it("does not suggest installing a CA for an indeterminate failure", () => {
    expect(connectionFailureCode(new Error("request failed"))).toBeNull();
    expect(classifySyncError("HTTP_NETWORK_ERROR")).toBe("transient");
    expect(classifySyncError("HTTP_TIMEOUT")).toBe("transient");
    expect(classifySyncError("HTTP_ORIGIN_BLOCKED")).toBe("fatal");
    expect(classifySyncError("HTTP_REQUEST_FAILED")).toBe("fatal");
  });

  /**
   * reqwest's wording for a request that never got an answer. It parked a
   * Google account for days as "fatal" (finding 2026-09-24); a number in the
   * URL is not an HTTP status, and a certificate problem in the same wrapper
   * stays an answer.
   */
  it.each([
    "error sending request for url (https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250)",
    "error sending request for url (https://graph.microsoft.com/v1.0/me/calendars/404/events)",
    "Calendar pull failed: error sending request for url (https://example.invalid/dav/): client error (Connect)",
    "client error (SendRequest): connection closed before message completed",
  ])("waits out a request that was sent and never answered: %s", (message) => {
    expect(isRequestSendFailure(new Error(message))).toBe(true);
    expect(classifySyncError(new Error(message))).toBe("transient");
    expect(classifySyncError(message)).toBe("transient");
  });

  it("keeps a certificate problem behind the same wrapper fatal", () => {
    const tls = "error sending request for url (https://dav.example.invalid/): invalid peer certificate: UnknownIssuer";
    expect(classifySyncError(new Error(tls))).toBe("fatal");
  });
});
