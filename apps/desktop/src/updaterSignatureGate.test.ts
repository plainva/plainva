import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { ApiError, githubApi, judgeSignatureJobs, SIGNATURE_JOBS, transient, updaterSignatureGate } from "../scripts/updater-signature-gate.mjs";

/**
 * The fixed update manifest moves only when the signature counter-check of the
 * release is green (Welle 2 § 4 Nr. 1): both "updater signature" jobs in the
 * release run started by the push of exactly this tag. Until then nothing
 * waited for them — the manifest went out with the check red or not yet run.
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const sha = "c".repeat(40);
const tag = "v0.9.0";
const releaseRun = (over: Record<string, unknown> = {}) => ({ id: 7, run_number: 60, event: "push", head_branch: tag, head_sha: sha, status: "in_progress", ...over });
const job = (name: string, status: string, conclusion: string | null = null) => ({ name, status, conclusion });
const green = SIGNATURE_JOBS.map((name) => job(name, "completed", "success"));

function fakeApi({ runs = [[releaseRun({ status: "completed" })]] as unknown[][], jobs = [green] as unknown[][], commit = sha } = {}) {
  let r = 0;
  let j = 0;
  return vi.fn(async (path: string) => {
    if (path === `/commits/${tag}`) return { sha: commit };
    if (path.startsWith(`/actions/workflows/release.yml/runs?event=push&head_sha=${commit}`)) return { workflow_runs: runs[Math.min(r++, runs.length - 1)] };
    if (path.startsWith("/actions/runs/") && path.includes("/jobs?filter=latest")) return { jobs: jobs[Math.min(j++, jobs.length - 1)] };
    throw new Error(`unexpected ${path}`);
  });
}
const quiet = { log: () => {}, sleep: async () => {}, pollMs: 1, maxWaitMs: 5 };

describe("the updater signature gate", () => {
  it("names the two jobs as the release run names them, both halves read from the workflow files", () => {
    // A job of a called workflow is shown as "<caller> / <called>": the caller
    // is the job of release.yml that uses native-smoke.yml, by its `name:` or,
    // without one, its id; the called one is native-smoke.yml's job name per os.
    const release = parse(read(".github/workflows/release.yml")) as { jobs: Record<string, { name?: string; uses?: string }> };
    const callers = Object.entries(release.jobs).filter(([, job]) => job.uses === "./.github/workflows/native-smoke.yml");
    expect(callers.map(([id]) => id)).toEqual(["native-smoke"]);
    const [[callerId, callerJob]] = callers;
    const caller = callerJob.name ?? callerId;
    const smoke = parse(read(".github/workflows/native-smoke.yml")) as { jobs: Record<string, { name?: string; strategy?: { matrix?: { os?: string[] } } }> };
    const called = smoke.jobs["updater-signature"];
    expect(called.name).toMatch(/\$\{\{ matrix\.os \}\}/);
    expect(SIGNATURE_JOBS).toEqual(called.strategy!.matrix!.os!.map((os) => `${caller} / ${called.name!.replace("${{ matrix.os }}", os)}`));
    expect(SIGNATURE_JOBS).toEqual(["native-smoke / updater signature (ubuntu-latest)", "native-smoke / updater signature (windows-latest)"]);
  });

  it("passes when both jobs are green in the tag's release run", async () => {
    await expect(updaterSignatureGate({ api: fakeApi(), tag, ...quiet })).resolves.toEqual({ sha, runId: 7 });
  });

  it("waits while the jobs run or have not started yet, and passes once they are green", async () => {
    const api = fakeApi({
      runs: [[releaseRun()], [releaseRun()], [releaseRun({ status: "completed" })]],
      jobs: [[], [job(SIGNATURE_JOBS[0], "in_progress"), job(SIGNATURE_JOBS[1], "queued")], green],
    });
    await expect(updaterSignatureGate({ api, tag, ...quiet, maxWaitMs: 100 })).resolves.toEqual({ sha, runId: 7 });
  });

  it("never passes an unfinished job: it fails when the wait is over", async () => {
    const api = fakeApi({ runs: [[releaseRun()]], jobs: [[job(SIGNATURE_JOBS[0], "completed", "success"), job(SIGNATURE_JOBS[1], "in_progress")]] });
    await expect(updaterSignatureGate({ api, tag, ...quiet })).rejects.toThrow(/did not finish in time .*windows-latest/);
  });

  it("fails on a red or cancelled job", async () => {
    for (const conclusion of ["failure", "cancelled", "skipped"]) {
      const api = fakeApi({ jobs: [[green[0], job(SIGNATURE_JOBS[1], "completed", conclusion)]] });
      await expect(updaterSignatureGate({ api, tag, ...quiet })).rejects.toThrow(`(${conclusion})`);
    }
  });

  it("fails when the run is over without the jobs (the smoke was skipped, or the tag predates the check)", async () => {
    const api = fakeApi({ jobs: [[job("Release gate", "completed", "success")]] });
    await expect(updaterSignatureGate({ api, tag, ...quiet })).rejects.toThrow(/ended without native-smoke \/ updater signature \(ubuntu-latest\), native-smoke \/ updater signature \(windows-latest\)/);
  });

  it("counts only the run a push of this tag started for this commit: never a rehearsal, a rebuild or another tag", async () => {
    for (const other of [releaseRun({ event: "workflow_dispatch" }), releaseRun({ head_branch: "feature/release" }), releaseRun({ head_branch: "v0.8.9" }), releaseRun({ head_sha: "d".repeat(40) })]) {
      const api = fakeApi({ runs: [[{ ...other, status: "completed" }]] });
      await expect(updaterSignatureGate({ api, tag, ...quiet })).rejects.toThrow(/No release run started by the push of v0\.9\.0/);
    }
  });

  it("takes the newest push run of the tag when there are several", async () => {
    const api = fakeApi({ runs: [[releaseRun({ id: 5, run_number: 58, status: "completed" }), releaseRun({ id: 9, run_number: 61, status: "completed" })]] });
    await expect(updaterSignatureGate({ api, tag, ...quiet })).resolves.toEqual({ sha, runId: 9 });
    expect(api).toHaveBeenCalledWith("/actions/runs/9/jobs?filter=latest&per_page=100&page=1");
  });

  it("refuses anything but a release tag", async () => {
    for (const bad of ["mobile-v0.9.0", "updater", "v0.9.0-rc1", "main"]) {
      await expect(updaterSignatureGate({ api: fakeApi(), tag: bad, ...quiet })).rejects.toThrow(/Expected a coordinated release tag/);
    }
  });

  it("asks again after a passing API failure, at growing intervals, and stays green", async () => {
    const waits: number[] = [];
    let calls = 0;
    const base = fakeApi();
    const api = vi.fn(async (path: string) => {
      calls++;
      if (calls === 2) throw new ApiError("HTTP 502", { status: 502 });
      if (calls === 3) throw new ApiError("network: fetch failed");
      if (calls === 4) throw new ApiError("HTTP 429", { status: 429, retryAfterMs: 7 });
      if (calls === 5) throw new ApiError("HTTP 403", { status: 403, retryAfterMs: 9 });
      return base(path);
    });
    await expect(updaterSignatureGate({ api, tag, ...quiet, sleep: async (ms: number) => void waits.push(ms), pollMs: 2, maxWaitMs: 1000 })).resolves.toEqual({ sha, runId: 7 });
    // 2, then 4 (doubled), then what the API asked for (Retry-After, the rate limit's reset).
    expect(waits).toEqual([2, 4, 7, 9]);
  });

  it("goes red on a passing failure only when the wait is over", async () => {
    const api = vi.fn(async () => {
      throw new ApiError("HTTP 503", { status: 503 });
    });
    await expect(updaterSignatureGate({ api, tag, ...quiet, pollMs: 1, maxWaitMs: 5 })).rejects.toThrow(/kept failing .* HTTP 503/);
  });

  it("goes red at once on a lasting failure, and names the missing right", async () => {
    const failing = (status: number) => async () => {
      throw new ApiError(`HTTP ${status}`, { status });
    };
    await expect(updaterSignatureGate({ api: failing(403), tag, ...quiet })).rejects.toThrow(/403.*actions: read/);
    await expect(updaterSignatureGate({ api: failing(401), tag, ...quiet })).rejects.toThrow(/refused the workflow token \(401\)/);
    await expect(updaterSignatureGate({ api: failing(404), tag, ...quiet })).rejects.toThrow(/found nothing \(404\)/);
    await expect(updaterSignatureGate({ api: failing(422), tag, ...quiet })).rejects.toThrow("HTTP 422");
    // A malformed answer or a bug is not asked again either.
    expect(transient(new TypeError("x is undefined"))).toBe(false);
  });

  it("turns fetch failures, Retry-After and an exhausted rate limit into the gate's errors", async () => {
    const answer = (status: number, headers: Record<string, string> = {}) => async () => ({
      ok: status < 300,
      status,
      headers: { get: (name: string) => headers[name] ?? null },
      json: async () => ({ sha }),
    });
    const call = (fetchImpl: Parameters<typeof githubApi>[0]["fetchImpl"]) => githubApi({ repo: "o/r", token: "t", fetchImpl, now: () => 1_000_000 })("/x");
    await expect(call(answer(200))).resolves.toEqual({ sha });
    await expect(call(answer(503))).rejects.toMatchObject({ status: 503, retryAfterMs: undefined });
    await expect(call(answer(429, { "retry-after": "30" }))).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 });
    await expect(call(answer(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1060" }))).rejects.toMatchObject({ status: 403, retryAfterMs: 61_000 });
    await expect(call(answer(403))).rejects.toMatchObject({ status: 403, retryAfterMs: undefined });
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    const error = await call(offline).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(transient(error)).toBe(true);
  });

  it("judges a missing job as pending while the run goes on", () => {
    expect(judgeSignatureJobs({ status: "in_progress" }, [])).toEqual({ green: [], failed: [], pending: SIGNATURE_JOBS, missing: [] });
    expect(judgeSignatureJobs({ status: "completed" }, [])).toEqual({ green: [], failed: [], pending: [], missing: SIGNATURE_JOBS });
  });
});

describe("in the Updater manifest workflow", () => {
  type Step = { name?: string; uses?: string; if?: string; run?: string; env?: Record<string, string> };
  const workflow = parse(read(".github/workflows/updater-manifest.yml")) as {
    on: Record<string, { inputs?: Record<string, { type?: string; default?: unknown }> } | null>;
    permissions: Record<string, string>;
    jobs: { "copy-manifest": { "timeout-minutes": number; steps: Step[] } };
  };
  const steps = workflow.jobs["copy-manifest"].steps;
  const names = steps.map((s) => s.name ?? s.uses);
  const gate = steps.find((s) => s.name === "The updater signature check of this release is green")!;

  it("checks the signature before anything is downloaded or moved", () => {
    expect(gate).toBeDefined();
    expect(gate.if).toBe("steps.src.outputs.skip == 'false'");
    expect(gate.run).toContain("node apps/desktop/scripts/updater-signature-gate.mjs");
    expect(gate.env!.RELEASE_TAG).toBe("${{ steps.src.outputs.tag }}");
    const at = names.indexOf(gate.name);
    expect(at).toBeGreaterThan(names.indexOf("actions/checkout@v7"));
    for (const later of ["Download the manifest of that release", "Ensure the fixed release exists", "Upload the manifest to the fixed location"]) {
      expect(names.indexOf(later), later).toBeGreaterThan(at);
    }
  });

  it("has the time and the right to wait for the jobs", () => {
    expect(workflow.permissions.actions).toBe("read");
    expect(workflow.jobs["copy-manifest"]["timeout-minutes"]).toBeGreaterThan(90);
  });

  it("lets only a manual repair run go without the check, with a reason, and says so", () => {
    const inputs = workflow.on.workflow_dispatch!.inputs!;
    expect(inputs.without_signature_check).toMatchObject({ type: "boolean", default: false });
    expect(gate.env!.WITHOUT_CHECK).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.without_signature_check }}");
    expect(gate.run).toContain("without_signature_check needs a reason");
    expect(gate.run).toMatch(/::warning::.*WITHOUT a green updater signature check/);
    expect(gate.run).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it("runs one at a time and never cancels a run in progress", () => {
    expect((workflow as unknown as { concurrency: unknown }).concurrency).toEqual({ group: "updater-manifest", "cancel-in-progress": false });
  });

  it.skipIf(process.platform === "win32")("keeps a typed reason on one line, so it can never start a workflow command", () => {
    const summary = join(mkdtempSync(join(tmpdir(), "gate-")), "summary.md");
    const out = execFileSync("bash", ["-c", gate.run!], {
      encoding: "utf8",
      env: { ...process.env, WITHOUT_CHECK: "true", RELEASE_TAG: "v0.8.7", GITHUB_ACTOR: "someone", GITHUB_STEP_SUMMARY: summary, REASON: "tag before 0.9.0, 50%\n::stop-commands::x\r\n::error::fake" },
    });
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning::v0\.8\.7: the manifest is copied WITHOUT .*Reason: tag before 0\.9\.0, 50%25 ::stop-commands::x {2}::error::fake$/);
    expect(readFileSync(summary, "utf8").trim().split("\n")).toHaveLength(1);
    expect(() => execFileSync("bash", ["-c", gate.run!], { env: { ...process.env, WITHOUT_CHECK: "true", RELEASE_TAG: "v0.8.7", REASON: " \n " }, stdio: "pipe" })).toThrow();
  });

  it("runs only for a published release or a manual run — nothing a rehearsal does reaches it", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["release", "workflow_dispatch"]);
    expect(workflow.on.release).toEqual({ types: ["published"] });
    // A rehearsal creates no release, no draft and no tag (release.yml), so it
    // can neither publish one nor be the run the gate accepts.
    const release = parse(read(".github/workflows/release.yml")) as { jobs: Record<string, { if?: string }> };
    for (const job of ["release-gate", "prepare"]) expect(release.jobs[job].if).toContain("!inputs.rehearsal");
  });
});
