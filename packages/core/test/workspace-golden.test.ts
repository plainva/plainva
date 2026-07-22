import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildWorkspaceGoldenVectors } from "./workspaceGoldenVectors.js";

describe("workspace v1 machine-readable golden vectors", () => {
  it("remain byte-for-byte stable", async () => {
    const path = new URL("./fixtures/workspace-v1-golden.json", import.meta.url);
    const checkedIn = JSON.parse(await readFile(path, "utf8")) as unknown;
    await expect(buildWorkspaceGoldenVectors()).resolves.toEqual(checkedIn);
  });
});
