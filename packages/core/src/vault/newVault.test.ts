import { describe, expect, it } from "vitest";
import { assertEmptyRemoteVault } from "./newVault.js";

describe("new cloud vault boundary", () => {
  it("accepts a complete empty inventory", async () => {
    await expect(assertEmptyRemoteVault({ pull: async () => ({ etagMap: new Map(), folders: [] }) })).resolves.toBeUndefined();
  });
  it.each([
    { etagMap: new Map([["index.md", "1"]]) },
    { etagMap: new Map([[".plainva/sync/settings.json", "1"]]) },
    { etagMap: new Map(), folders: ["Empty old folder"] },
    { etagMap: new Map(), needsFullListing: true },
    { etagMap: new Map(), deleted: ["Old.md"] },
  ])("rejects an existing or incomplete destination", async inventory => {
    await expect(assertEmptyRemoteVault({ pull: async () => inventory })).rejects.toThrow();
  });
  it("propagates unavailable inventories instead of treating them as empty", async () => {
    await expect(assertEmptyRemoteVault({ pull: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
  });
});
