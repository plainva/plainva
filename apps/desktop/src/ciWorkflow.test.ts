import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { alreadyVerified, mayAsk } from "../scripts/ci-verified.mjs";
import { REQUIRED_CHECKS } from "../scripts/release-gate.mjs";

/**
 * The CI workflow after the split (stability plan R10): parallel jobs, one gate
 * named "Checks", and no second full run on `main` for a commit that already
 * passed (decision E3). Branch protection reads job NAMES, so these hold them.
 */

type Job = { name?: string; needs?: string | string[]; if?: string; steps?: Array<Record<string, unknown>>; strategy?: unknown };
const ci = parse(readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8")) as { jobs: Record<string, Job> };
const jobs = ci.jobs;
const needsOf = (job: Job) => (Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : []);

const run = (name: string, conclusion: string | null, completedAt: string | null, id = 1) => ({
  id, name, status: completedAt ? "completed" : "in_progress", conclusion, completed_at: completedAt,
});

describe("the CI workflow", () => {
  it("keeps the three required check names of this file, each on exactly one job", () => {
    const names = Object.values(jobs).map((j) => j.name);
    for (const required of ["Checks", "WebKit editor regression", "Rust checks"]) {
      expect(names.filter((n) => n === required), required).toHaveLength(1);
    }
  });

  it("makes \"Checks\" a gate over every job that used to be part of it, failing unless each one succeeded", () => {
    const gate = Object.entries(jobs).find(([, j]) => j.name === "Checks")!;
    const [gateId, gateJob] = gate;
    const split = Object.keys(jobs).filter((id) => !["verified", gateId, "webkit", "rust", "core-macos", "rust-macos"].includes(id));
    expect(split.length).toBeGreaterThanOrEqual(5);
    expect(needsOf(gateJob).sort()).toEqual(["verified", ...split].sort());
    // A needed job that failed, was cancelled or skipped must not count as green:
    // the gate runs always() and checks each result itself.
    expect(gateJob.if).toContain("always()");
    const script = JSON.stringify(gateJob.steps);
    expect(script).toContain("toJSON(needs)");
    expect(script).toContain('job.result !== \\"success\\"');
  });

  it("lets every job but the question itself wait for it, and skip only when the commit is already verified", () => {
    for (const [id, job] of Object.entries(jobs)) {
      if (id === "verified") continue;
      expect(needsOf(job), id).toContain("verified");
      expect(job.if, id).toContain("needs.verified.outputs.verified != 'true'");
    }
  });

  it("runs the desktop E2E suite against the built bundle, in four shards, and the probe pages against the dev server", () => {
    const e2e = jobs.e2e;
    expect(JSON.stringify(e2e.strategy)).toContain("[1,2,3,4]");
    const steps = JSON.stringify(e2e.steps);
    expect(steps).toContain("build:e2e");
    expect(steps).toContain('"E2E_BUNDLE":"1"');
    expect(steps).toContain("--shard=${{ matrix.shard }}/4");
    expect(JSON.stringify(jobs["e2e-probes"].steps)).toContain('"E2E_PROBES":"1"');
  });
});

describe("whether a run on main may skip (E3)", () => {
  const green = REQUIRED_CHECKS.map((n, i) => run(n, "success", "2026-11-10T10:00:00Z", i + 1));

  it("asks only on a push to main", () => {
    expect(mayAsk({ event: "push", ref: "refs/heads/main" })).toBe(true);
    expect(mayAsk({ event: "push", ref: "refs/heads/feature/w1-testci" })).toBe(false);
    expect(mayAsk({ event: "pull_request", ref: "refs/heads/main" })).toBe(false);
  });

  it("skips when all four required checks already passed on the commit, while this run's own are still queued", () => {
    const ownQueued = REQUIRED_CHECKS.map((n, i) => run(n, null, null, 50 + i));
    expect(alreadyVerified([...green, ...ownQueued]).verified).toBe(true);
  });

  it("runs in full for a commit that did not pass before: one check red, missing or still running", () => {
    expect(alreadyVerified([]).verified).toBe(false);
    expect(alreadyVerified(green.filter((r) => r.name !== "Analyze (JavaScript/TypeScript)")).verified).toBe(false);
    expect(alreadyVerified(green.map((r) => (r.name === "Rust checks" ? { ...r, conclusion: "failure" } : r))).verified).toBe(false);
    expect(alreadyVerified(green.map((r) => (r.name === "Checks" ? run("Checks", null, null) : r))).verified).toBe(false);
    // An earlier skip proves nothing.
    expect(alreadyVerified(REQUIRED_CHECKS.map((n) => run(n, "skipped", "2026-11-10T10:00:00Z"))).verified).toBe(false);
  });
});

describe("the e2e bundle stays a test build", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  it("adds entries, a manifest and the source-path redirects in the e2e mode only", async () => {
    const { e2eBundleBuild, e2eBundlePlugins, exportedNames, TEST_HOOK_MODULES, E2E_BUNDLE_OUT_DIR } = await import("../scripts/e2e-bundle.mjs");
    for (const mode of ["production", "development", "test", "labs"]) {
      expect(e2eBundleBuild(mode)).toEqual({});
      expect(e2eBundlePlugins(mode, root)).toEqual([]);
    }
    // The e2e build is the production build in its own folder: no entry, no chunk of its own.
    expect(e2eBundleBuild("e2e")).toEqual({ outDir: E2E_BUNDLE_OUT_DIR });
    // Each module a test drives has the exports the test reads.
    expect(TEST_HOOK_MODULES.length).toBeGreaterThan(0);
    for (const rel of TEST_HOOK_MODULES) expect(exportedNames(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")).length, rel).toBeGreaterThan(0);
    expect(exportedNames("export const a = 1;\nexport function b() {}\nexport { c, d as e, type F };\nconst x = 2;")).toEqual(["a", "b", "c", "e"]);
  });

  it("names every spec built on a probe page, so the bundle run leaves exactly those out", async () => {
    const { PROBE_SPECS } = await import("../scripts/e2e-bundle.mjs");
    const dir = new URL("../e2e/", import.meta.url);
    const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.ts"));
    const probing = specs.filter((f) => /import\(['"]\/e2e\/fixtures\//.test(readFileSync(new URL(f, dir), "utf8")));
    expect(probing.length).toBeGreaterThan(0);
    expect([...PROBE_SPECS].sort()).toEqual(probing.sort());
  });

  it("is built by CI's E2E jobs alone, never by a release or the app's own build", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).not.toContain("e2e");
    const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { build: { beforeBuildCommand: string } };
    expect(tauri.build.beforeBuildCommand).toBe("pnpm build");
    for (const name of ["release.yml", "release-mobile.yml", "ios.yml", "native-smoke.yml", "labs-mobile.yml"]) {
      const text = readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");
      expect(text, name).not.toContain("build:e2e");
    }
  });
});
