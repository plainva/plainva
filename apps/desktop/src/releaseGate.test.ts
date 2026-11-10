import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { judgeChecks, onMain, releaseGate, REQUIRED_CHECKS } from "../scripts/release-gate.mjs";

/**
 * The gate at the start of a desktop release (Sammelplan § 3.149): the release
 * builds a commit main has taken, with the four required checks green on it,
 * instead of running the unit suite on every platform again.
 */

const sha = "b".repeat(40);
const run = (name: string, conclusion: string | null, completedAt: string | null, id = 1) => ({
  id,
  name,
  status: completedAt ? "completed" : "in_progress",
  conclusion,
  completed_at: completedAt,
});
const allGreen = REQUIRED_CHECKS.map((name, i) => run(name, "success", "2026-10-30T10:00:00Z", i + 1));

function fakeApi({ status = "ahead", runs = [allGreen] as unknown[][], commit = sha } = {}) {
  let round = 0;
  return vi.fn(async (path: string) => {
    if (path === "/commits/v0.8.7") return { sha: commit };
    if (path === `/compare/${commit}...main`) return { status };
    if (path.startsWith(`/commits/${commit}/check-runs?filter=all`)) return { check_runs: runs[Math.min(round++, runs.length - 1)] };
    throw new Error(`unexpected ${path}`);
  });
}
const quiet = { log: () => {}, sleep: async () => {}, pollMs: 1, maxWaitMs: 5 };

describe("the release gate", () => {
  it("names exactly the four checks branch protection requires, as ci.yml and codeql.yml name their jobs", () => {
    expect(REQUIRED_CHECKS).toEqual(["Checks", "WebKit editor regression", "Rust checks", "Analyze (JavaScript/TypeScript)"]);
    const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const codeql = readFileSync(new URL("../../../.github/workflows/codeql.yml", import.meta.url), "utf8");
    for (const name of ["Checks", "WebKit editor regression", "Rust checks"]) expect(ci).toContain(`name: ${name}\n`);
    expect(codeql).toContain("name: Analyze (JavaScript/TypeScript)\n");
  });

  it("reads 'on main' from the comparison: main is the commit or ahead of it", () => {
    expect(onMain("identical")).toBe(true);
    expect(onMain("ahead")).toBe(true);
    expect(onMain("behind")).toBe(false);
    expect(onMain("diverged")).toBe(false);
    expect(onMain(undefined)).toBe(false);
  });

  it("lets the run that finished last decide, so a red rerun is not hidden by an earlier green one", () => {
    const runs = [
      ...allGreen,
      run("Checks", "failure", "2026-10-30T11:00:00Z", 9),
      run("Rust checks", "failure", "2026-10-30T09:00:00Z", 8),
    ];
    expect(judgeChecks(runs)).toEqual({
      green: ["WebKit editor regression", "Rust checks", "Analyze (JavaScript/TypeScript)"],
      failed: ["Checks (failure)"],
      pending: [],
      missing: [],
    });
  });

  it("tells a check that is still running from one that never ran", () => {
    const runs = [run("Checks", null, null), run("Rust checks", "success", "2026-10-30T10:00:00Z")];
    const verdict = judgeChecks(runs);
    expect(verdict.pending).toEqual(["Checks"]);
    expect(verdict.missing).toEqual(["WebKit editor regression", "Analyze (JavaScript/TypeScript)"]);
    // A cancelled or skipped run is not a pass.
    expect(judgeChecks(REQUIRED_CHECKS.map((n) => run(n, "cancelled", "2026-10-30T10:00:00Z"))).failed).toHaveLength(4);
  });

  it("lets a skipped run decide nothing: the green run on the branch stands, a check only ever skipped never ran (E3)", () => {
    const skippedOnMain = REQUIRED_CHECKS.map((n) => run(n, "skipped", "2026-10-30T12:00:00Z", 20));
    expect(judgeChecks([...allGreen, ...skippedOnMain]).green).toEqual(REQUIRED_CHECKS);
    expect(judgeChecks(skippedOnMain).missing).toEqual(REQUIRED_CHECKS);
    // A red run is not hidden behind a later skip either.
    const red = allGreen.map((r) => (r.name === "Checks" ? { ...r, conclusion: "failure" } : r));
    expect(judgeChecks([...red, ...skippedOnMain]).failed).toEqual(["Checks (failure)"]);
  });

  it("lets the release through when the commit is on main and all four are green", async () => {
    const api = fakeApi();
    await expect(releaseGate({ api, ref: "v0.8.7", expectedSha: sha, ...quiet })).resolves.toBe(sha);
  });

  it("stops a tag that points somewhere main never was", async () => {
    await expect(releaseGate({ api: fakeApi({ status: "diverged" }), ref: "v0.8.7", ...quiet })).rejects.toThrow("not on main");
    await expect(releaseGate({ api: fakeApi({ status: "behind" }), ref: "v0.8.7", ...quiet })).rejects.toThrow("not on main");
  });

  it("stops a commit whose required checks are not green", async () => {
    const red = allGreen.map((r) => (r.name === "Rust checks" ? { ...r, conclusion: "failure" } : r));
    await expect(releaseGate({ api: fakeApi({ runs: [red] }), ref: "v0.8.7", ...quiet })).rejects.toThrow("Rust checks (failure)");
  });

  it("waits for checks still running, and passes once they are green", async () => {
    const running = allGreen.map((r) => (r.name === "Checks" ? run("Checks", null, null) : r));
    const sleep = vi.fn(async () => {});
    const api = fakeApi({ runs: [running, running, allGreen] });
    await expect(releaseGate({ api, ref: "v0.8.7", ...quiet, sleep, maxWaitMs: 10 })).resolves.toBe(sha);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up when they do not finish in time, and says which", async () => {
    const running = allGreen.filter((r) => r.name !== "Analyze (JavaScript/TypeScript)");
    await expect(releaseGate({ api: fakeApi({ runs: [running] }), ref: "v0.8.7", ...quiet, maxWaitMs: 2 })).rejects.toThrow(/never ran: Analyze/);
  });

  it("refuses a tag that is no coordinated release, and a run started for another commit", async () => {
    const api = fakeApi();
    await expect(releaseGate({ api, ref: "mobile-v0.8.7", ...quiet })).rejects.toThrow("coordinated release tag");
    expect(api).not.toHaveBeenCalled();
    await expect(releaseGate({ api: fakeApi(), ref: "v0.8.7", expectedSha: "c".repeat(40), ...quiet })).rejects.toThrow("was started for");
  });

  it("is the first job of the release: nothing is drafted or built before it, and a release runs no unit suite", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toMatch(/release-gate:\n\s+name: Release gate\n\s+if: github\.event_name != 'workflow_dispatch' \|\| inputs\.rebuild_windows_tag/);
    expect(workflow).toMatch(/permissions:\n\s+contents: read\n\s+checks: read/);
    expect(workflow).toContain("run: node apps/desktop/scripts/release-gate.mjs");
    expect(workflow).toMatch(/prepare:\n\s+if: [^\n]+\n\s+needs: release-gate/);
    expect(workflow).toMatch(/native-smoke:\n\s+needs: release-gate/);
    // The unit suite runs only in a manual dry run.
    expect(workflow).toMatch(/Build and Test Pre-flight \(manual dry run only\)[\s\S]*?if: github\.event_name == 'workflow_dispatch' && !inputs\.rebuild_windows_tag\n/);
    // What the macOS smoke brought stays: the smoke job and the binary check.
    expect(workflow).toContain("uses: ./.github/workflows/native-smoke.yml");
    expect(workflow).toContain("check-webdriver-server.sh");
  });
});
