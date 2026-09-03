import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isExternalVault, type VaultEntry } from "./vaultRegistry";

/**
 * THE hard line of the external vault folder plan (§ 3.2, P6): the delete
 * path knows only containers. For a vault in a folder the user picked, the
 * connection goes and the files stay — the same `rmdir` pointed at that
 * folder would be the deletion of the user's real notes.
 *
 * A source guard, like pendingSaveFlush.test: the branch has to be read to be
 * trusted, and a refactor that drops the `isExternalVault` check in front of
 * the rmdir must go red here. Red check: the assertion is phrased so that the
 * plain "rmdir first, guard later" order fails it.
 */
const src = readFileSync(fileURLToPath(new URL("./vaultService.ts", import.meta.url)), "utf8");

describe("the delete path knows only containers (external vault folder, P6)", () => {
  it("guards the container rmdir with the external check, in that order", () => {
    const fn = src.slice(src.indexOf("export async function deleteVault("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    const guard = body.indexOf("if (isExternalVault(entry))");
    const rmdir = body.indexOf("Filesystem.rmdir({ path: `vaults/${id}`");
    expect(guard, "the guard exists").toBeGreaterThan(-1);
    expect(rmdir, "the container rmdir exists").toBeGreaterThan(-1);
    expect(guard, "the guard comes BEFORE the rmdir").toBeLessThan(rmdir);
    // The external branch releases the grant and never reaches the rmdir.
    const externalBranch = body.slice(guard, body.indexOf("} else {", guard));
    expect(externalBranch).toContain("release({ handle: entry.external.handle })");
    expect(externalBranch).not.toContain("rmdir");
  });

  it("recognises an external vault by its handle alone", () => {
    const container: VaultEntry = { id: "a", name: "A" };
    const external: VaultEntry = { id: "b", name: "B", external: { handle: "content://tree", label: "Notes", platform: "android" } };
    expect(isExternalVault(container)).toBe(false);
    expect(isExternalVault(external)).toBe(true);
    expect(isExternalVault(null)).toBe(false);
    expect(isExternalVault({ id: "c", name: "C", external: { handle: "", label: "", platform: "ios" } })).toBe(false);
  });

  it("never seeds a picked folder, however empty it is", () => {
    // The seeding condition of boot() carries the external check.
    expect(src).toMatch(/if \(isLocal && !isExternalVault\(entry\) && \(await adapter\.listDir\(""\)\)\.length === 0\)/);
  });
});
