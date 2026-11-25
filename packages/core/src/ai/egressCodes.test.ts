import { describe, expect, it } from "vitest";
import { failureFromChunk } from "./egress.js";

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
