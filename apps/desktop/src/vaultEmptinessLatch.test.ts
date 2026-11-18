import { describe, expect, it } from "vitest";
import { VaultEmptinessLatch } from "@plainva/ui";

describe("VaultEmptinessLatch", () => {
  it("reads a vault until it was seen holding content, then never again", () => {
    const latch = new VaultEmptinessLatch<object>();
    const vault = {};
    expect(latch.needsRead(vault)).toBe(true);
    latch.record(vault, "empty");
    expect(latch.needsRead(vault)).toBe(true);
    latch.record(vault, "fetching");
    expect(latch.needsRead(vault)).toBe(true);
    latch.record(vault, "content");
    expect(latch.needsRead(vault)).toBe(false);
  });

  it("another vault is read afresh", () => {
    const latch = new VaultEmptinessLatch<object>();
    const first = {};
    latch.record(first, "content");
    expect(latch.needsRead({})).toBe(true);
  });
});
