import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { judgeSignatureJobs, SIGNATURE_JOBS, updaterSignatureGate } from "../scripts/updater-signature-gate.mjs";

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
  it("names the two jobs as the release run names them", () => {
    expect(SIGNATURE_JOBS).toEqual(["native-smoke / updater signature (ubuntu-latest)", "native-smoke / updater signature (windows-latest)"]);
    const smoke = parse(read(".github/workflows/native-smoke.yml")) as { jobs: Record<string, { name?: string; strategy?: { matrix?: { os?: string[] } } }> };
    expect(smoke.jobs["updater-signature"].name).toBe("updater signature (${{ matrix.os }})");
    expect(smoke.jobs["updater-signature"].strategy!.matrix!.os).toEqual(["ubuntu-latest", "windows-latest"]);
    const release = parse(read(".github/workflows/release.yml")) as { jobs: Record<string, { uses?: string }> };
    expect(release.jobs["native-smoke"].uses).toBe("./.github/workflows/native-smoke.yml");
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

  it("runs only for a published release or a manual run — nothing a rehearsal does reaches it", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["release", "workflow_dispatch"]);
    expect(workflow.on.release).toEqual({ types: ["published"] });
    // A rehearsal creates no release, no draft and no tag (release.yml), so it
    // can neither publish one nor be the run the gate accepts.
    const release = parse(read(".github/workflows/release.yml")) as { jobs: Record<string, { if?: string }> };
    for (const job of ["release-gate", "prepare"]) expect(release.jobs[job].if).toContain("!inputs.rehearsal");
  });
});
