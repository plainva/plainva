import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { planAutoRefresh, RESUME_REFRESH_LIMITS, runVaultRefresh } from "@plainva/ui";
import { scanChangedNothing } from "@plainva/core";

/**
 * Issue 110 (E9): coming back to the app re-read the vault only when it lived
 * in an EXTERNAL folder. The app's own vault is visible in the iOS Files app —
 * a note moved there stayed at its old place until the next start. Every vault
 * is re-read now, at most once a minute, through the refresh the desktop's
 * window focus uses.
 *
 * Runs the real `rereadVaultOnResume` from vaultService.ts; only the booted
 * vault is handed in (the boot itself needs the native plugins).
 */
const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const parts: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "rereadVaultOnResume") parts.push(node.getText(file).replace(/^export /, ""));
  if (ts.isVariableStatement(node) && node.getText(file).includes("const resumeMarks")) parts.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
if (parts.length !== 2) throw new Error("rereadVaultOnResume or its marks are missing from vaultService.ts");
const compiled = ts.transpileModule(`${parts.join("\n")}\nreturn rereadVaultOnResume;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

/** The screen-level event bus the function announces on (no DOM in this suite). */
const bus = new EventTarget();
type Vault = { vaultId: string; external: unknown; indexer: { indexVaultFull: ReturnType<typeof vi.fn> } | null };
function load(vault: Vault | null): (now?: number) => Promise<boolean> {
  const bootPromise = vault ? Promise.resolve(vault) : null;
  return new Function("bootPromise", "planAutoRefresh", "RESUME_REFRESH_LIMITS", "runVaultRefresh", "scanChangedNothing", "window", compiled)(
    bootPromise, planAutoRefresh, RESUME_REFRESH_LIMITS, runVaultRefresh, scanChangedNothing, bus,
  );
}
const report = { added: 0, changed: 0, removed: 1, skipped: [], durationMs: 1, walked: 3, foldersChanged: false };
const vaultOf = (external: unknown, scan: () => Promise<unknown> = async () => report): Vault =>
  ({ vaultId: "v1", external, indexer: { indexVaultFull: vi.fn(scan) } });
/** How often the lists were told to reload by one return to the app. */
async function reloadsAfter(vault: Vault): Promise<number> {
  const changed = vi.fn();
  bus.addEventListener("m-vault-changed", changed);
  await load(vault)(100_000);
  bus.removeEventListener("m-vault-changed", changed);
  return changed.mock.calls.length;
}

describe("re-reading the vault on return to the app", () => {
  it("re-reads the app's own vault, not only an external folder", async () => {
    const vault = vaultOf(null);
    const changed = vi.fn();
    bus.addEventListener("m-vault-changed", changed);
    expect(await load(vault)(100_000)).toBe(true);
    bus.removeEventListener("m-vault-changed", changed);
    expect(vault.indexer!.indexVaultFull).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("leaves every list alone when the vault is as it was (issue 122)", async () => {
    // Each list reloads on the event; a re-read that changed nothing has nothing to show.
    const unchanged = { ...report, removed: 0 };
    const vault = vaultOf(null, async () => unchanged);
    expect(await reloadsAfter(vault)).toBe(0);
    expect(vault.indexer!.indexVaultFull).toHaveBeenCalledWith("return to the app");
  });

  it("reloads the lists for changed files, for a changed folder list, and when the re-read failed", async () => {
    expect(await reloadsAfter(vaultOf(null, async () => ({ ...report, removed: 0, changed: 1 })))).toBe(1);
    expect(await reloadsAfter(vaultOf(null, async () => ({ ...report, removed: 0, foldersChanged: true })))).toBe(1);
    expect(await reloadsAfter(vaultOf(null, async () => { throw new Error("disk went away"); }))).toBe(1);
  });

  it("re-reads an external folder the same way", async () => {
    const vault = vaultOf({ handle: "content://tree/x" });
    expect(await load(vault)(100_000)).toBe(true);
    expect(vault.indexer!.indexVaultFull).toHaveBeenCalledOnce();
  });

  it("at most once a minute", async () => {
    const vault = vaultOf(null);
    const reread = load(vault);
    expect(RESUME_REFRESH_LIMITS.localMs).toBeGreaterThanOrEqual(60_000);
    expect(await reread(100_000)).toBe(true);
    expect(await reread(100_000 + RESUME_REFRESH_LIMITS.localMs - 1)).toBe(false);
    expect(await reread(100_000 + RESUME_REFRESH_LIMITS.localMs)).toBe(true);
    expect(vault.indexer!.indexVaultFull).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a booted vault or an index", async () => {
    expect(await load(null)(100_000)).toBe(false);
    expect(await load({ vaultId: "v1", external: null, indexer: null })(100_000)).toBe(false);
  });
});

describe("the return to the app hands over to it", () => {
  it("calls the re-read for every vault, not the old external-only rescan", () => {
    const lifecycle = readFileSync(resolve("src/services/appLifecycle.ts"), "utf8");
    const foreground = lifecycle.slice(lifecycle.indexOf("export function onAppForeground"), lifecycle.indexOf("export function onAppBackground"));
    expect(foreground).toContain("rereadVaultOnResume()");
    expect(source).not.toContain("rescanExternalVaultOnResume");
  });
});
