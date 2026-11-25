import { describe, expect, it } from "vitest";
import { failureClassOf, failureFromChunk } from "./egress.js";

/**
 * What the native egress of a shell says when it sends nothing (F72 of release 0.9.0). Every shell decides "too
 * large" and "invalid request" before it connects; they were read as "offline", and the advice — send it again once
 * there is a network — led round in a circle.
 */
describe("the native egress's own codes", () => {
  it("a request larger than the device sends is too large, never offline", () => {
    expect(failureFromChunk("too_large", "request too large")).toEqual({ kind: "too_large" });
  });

  it("a request of the wrong form is Plainva's fault, never offline", () => {
    expect(failureFromChunk("invalid_request", "a model call needs exactly one body")).toEqual({ kind: "invalid_request", message: "a model call needs exactly one body" });
  });

  it("a failure of the network itself is still offline", () => {
    expect(failureFromChunk("network", "connection refused")).toEqual({ kind: "offline", message: "connection refused" });
  });
});

/**
 * The two classes of a failed request (plan Umsetzung 0.9.x, B7). Only a failure the device decided before anything
 * left it may say "nothing was sent"; everything a provider, a clock or a broken connection decided may have arrived.
 */
describe("whether a failed request may have arrived", () => {
  it("a connection that never stood is its own code, never offline", () => {
    expect(failureFromChunk("unreachable", "dns error")).toEqual({ kind: "unreachable", message: "dns error" });
    expect(failureClassOf(failureFromChunk("unreachable", "dns error"))).toBe("never_sent");
  });

  it("the checks on the device are the first class", () => {
    for (const code of ["local_only", "unknown_endpoint", "url_not_allowed", "no_key", "invalid_request", "too_large"]) {
      expect(failureClassOf(failureFromChunk(code, "x"))).toBe("never_sent");
    }
    expect(failureClassOf({ kind: "kept_on_device" })).toBe("never_sent");
    expect(failureClassOf({ kind: "window_too_small", needed: 9, window: 4 })).toBe("never_sent");
  });

  it("whatever broke after the connection stood, or a provider said, may have arrived", () => {
    for (const code of ["network", "idle_timeout", "HTTP_TIMEOUT", "HTTP_NETWORK_ERROR", "TLS_HANDSHAKE_FAILED", "something new"]) {
      expect(failureClassOf(failureFromChunk(code, "x"))).toBe("maybe_sent");
    }
    expect(failureClassOf({ kind: "context_too_long", status: 413 })).toBe("maybe_sent");
    expect(failureClassOf({ kind: "rate_limited", status: 429 })).toBe("maybe_sent");
    expect(failureClassOf({ kind: "stream_broken", message: "x" })).toBe("maybe_sent");
  });

  it("the phone's time-out is a provider that did not answer, not a provider out of reach (F72)", () => {
    expect(failureFromChunk("HTTP_TIMEOUT", "timeout")).toEqual({ kind: "stream_broken", message: "timeout" });
  });
});

describe("a certificate the device did not accept (F72)", () => {
  it("is named by the phone's code, and by the desktop's message", () => {
    expect(failureFromChunk("TLS_CERTIFICATE_EXPIRED", "x")).toEqual({ kind: "certificate", code: "TLS_CERTIFICATE_EXPIRED", message: "x" });
    expect(failureFromChunk("network", "error sending request: invalid peer certificate: UnknownIssuer")).toMatchObject({ kind: "certificate", code: "TLS_CERTIFICATE_UNTRUSTED" });
    expect(failureClassOf(failureFromChunk("TLS_HOSTNAME_MISMATCH", "x"))).toBe("maybe_sent");
  });

  it("an ordinary network failure stays offline", () => {
    expect(failureFromChunk("HTTP_NETWORK_ERROR", "socket closed")).toEqual({ kind: "offline", message: "socket closed" });
  });
});
