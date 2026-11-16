import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { prepareDesktopRelease } from "../scripts/prepare-release.mjs";

const sha = "a".repeat(40);
const options = { tag: "v0.8.2", sha, notes: "Release notes" };
const draft = { id: 42, tag_name: options.tag, target_commitish: sha, draft: true, prerelease: false };

describe("coordinated desktop release allocation", () => {
  it("creates one private draft and returns the ID shared by the build matrix", async () => {
    const api = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(draft);
    expect(await prepareDesktopRelease({ ...options, api })).toBe(42);
    expect(api).toHaveBeenLastCalledWith("/releases", "POST", expect.objectContaining({
      tag_name: options.tag, target_commitish: sha, body: options.notes,
      draft: true, prerelease: false, make_latest: "false",
    }));
  });

  it("reuses the exact draft on a rerun without creating another release", async () => {
    const api = vi.fn().mockResolvedValue([draft]);
    expect(await prepareDesktopRelease({ ...options, api })).toBe(42);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("recovers an existing draft only when its source and notes still match", async () => {
    const api = vi.fn().mockResolvedValue([{ ...draft, body: options.notes }]);
    expect(await prepareDesktopRelease({ ...options, requireExisting: true, api })).toBe(42);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("never allocates a new release when recovering missing platform artifacts", async () => {
    const api = vi.fn().mockResolvedValue([]);
    await expect(prepareDesktopRelease({ ...options, requireExisting: true, api })).rejects.toThrow("requires an existing unpublished draft");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite changed notes during platform recovery", async () => {
    const api = vi.fn().mockResolvedValue([{ ...draft, body: "Different notes" }]);
    await expect(prepareDesktopRelease({ ...options, requireExisting: true, api })).rejects.toThrow("notes differ");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not choose arbitrarily between platform-specific duplicate drafts", async () => {
    const api = vi.fn().mockResolvedValue([draft, { ...draft, id: 43 }]);
    await expect(prepareDesktopRelease({ ...options, api })).rejects.toThrow("Multiple releases");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...draft, draft: false },
    { ...draft, target_commitish: "b".repeat(40) },
    { ...draft, prerelease: true },
  ])("does not overwrite a published release or a different source: %j", async (release) => {
    const api = vi.fn().mockResolvedValue([release]);
    await expect(prepareDesktopRelease({ ...options, api })).rejects.toThrow("Existing release");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("finds an existing draft beyond the first inventory page", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ ...draft, id: i + 100, tag_name: `v0.1.${i}` }));
    const api = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([draft]);
    expect(await prepareDesktopRelease({ ...options, api })).toBe(42);
    expect(api).toHaveBeenLastCalledWith("/releases?per_page=100&page=2");
  });

  it("rejects invalid release identity before contacting GitHub", async () => {
    const api = vi.fn();
    await expect(prepareDesktopRelease({ ...options, tag: "mobile-v0.8.2", api })).rejects.toThrow("coordinated release");
    expect(api).not.toHaveBeenCalled();
  });

  it("pins platform builds to the prepared source and keeps ordinary manual runs build-only", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("needs: prepare");
    expect(workflow).toContain("releaseId: ${{ needs.prepare.outputs.release_id }}");
    expect(workflow).toContain("group: desktop-release-${{ inputs.rebuild_windows_tag && format('refs/tags/{0}', inputs.rebuild_windows_tag) || github.ref }}");
    expect(workflow).toContain("(github.event_name == 'workflow_dispatch' && !inputs.rebuild_windows_tag && !inputs.rehearsal) || needs.prepare.result == 'success'");
    expect(workflow).toContain("ref: ${{ needs.prepare.outputs.source_sha || github.sha }}");
    expect(workflow).toContain("tagName: ${{ needs.prepare.outputs.release_tag }}");
    expect(workflow).toMatch(/prepare:\s+if: \(github\.event_name != 'workflow_dispatch' \|\| inputs\.rebuild_windows_tag\) && !inputs\.rehearsal\n/);
  });

  // The rehearsal builds, signs and notarizes like a release and publishes
  // nothing. These hold the construction that makes it so, not the care.
  it("keeps the release rehearsal unable to publish anything", () => {
    type Step = { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
    type Job = { if?: string; needs?: unknown; permissions?: Record<string, string>; steps: Step[] };
    const text = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    const workflow = parse(text) as { on: { workflow_dispatch: { inputs: Record<string, { default: unknown }> } }; jobs: Record<string, Job> };
    expect(workflow.on.workflow_dispatch.inputs.rehearsal.default).toBe(false);
    const job = workflow.jobs.rehearsal;
    expect(job.if).toBe("github.event_name == 'workflow_dispatch' && inputs.rehearsal");
    expect(job.needs, "no draft is allocated before it").toBeUndefined();
    expect(job.permissions).toEqual({ contents: "read" });
    const steps = JSON.stringify(job.steps);
    expect(steps).not.toContain("tauri-action");
    expect(steps).not.toContain("GITHUB_TOKEN");
    expect(steps).not.toContain("github.token");
    expect(steps).not.toContain("upload-artifact");
    expect(steps).not.toContain("releaseId");
    expect(steps).not.toMatch(/\bgh (release|api)\b/);
    // The same guards as the release legs, on what the rehearsal built.
    expect(steps).toContain("check-webdriver-server.sh");
    expect(steps).toContain("./apps/desktop/scripts/verify-windows-signatures.ps1");
    expect(steps).toContain("fetch-onnxruntime.mjs");
    expect(steps).toContain("xcrun stapler validate");
    // The draft-making jobs stay skipped for any manual run without a rebuild
    // tag, and for every rehearsal, with or without one.
    for (const id of ["release-gate", "prepare"]) expect(workflow.jobs[id].if).toBe("(github.event_name != 'workflow_dispatch' || inputs.rebuild_windows_tag) && !inputs.rehearsal");
    expect(JSON.stringify(workflow.jobs.release.steps)).toContain("./apps/desktop/scripts/verify-windows-signatures.ps1");
  });

  // The job conditions, evaluated for every way the workflow can start. A
  // rehearsal with a rebuild tag on top must not reach a draft: before
  // 2026-11-16 only the rehearsal job failed, and release-gate, prepare
  // (contents: write) and release ran on for the rebuild tag.
  it("lets no rehearsal reach a draft, also together with a rebuild tag", () => {
    type Job = { if?: string };
    const text = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    const jobs = (parse(text) as { jobs: Record<string, Job> }).jobs;
    type Start = { event: string; rebuild: string; rehearsal: boolean };
    const evaluate = (condition: string, start: Start, prepare: string): boolean => {
      const js = condition
        .replace(/^\$\{\{|\}\}$/g, "")
        .replace(/!cancelled\(\)/g, "true")
        .replace(/github\.event_name/g, "c.event")
        .replace(/inputs\.rebuild_windows_tag/g, "c.rebuild")
        .replace(/inputs\.rehearsal/g, "c.rehearsal")
        .replace(/needs\.prepare\.result/g, "c.prepare");
      expect(js, `only known terms in: ${condition}`).toMatch(/^[\sc.a-z_!=&|()'-]+$/i);
      return Boolean(new Function("c", `return (${js});`)({ ...start, prepare }));
    };
    const runs = (start: Start) => {
      const gate = evaluate(jobs["release-gate"].if!, start, "skipped");
      const prepare = gate && evaluate(jobs.prepare.if!, start, "skipped");
      const release = evaluate(jobs.release.if!, start, prepare ? "success" : "skipped");
      const rehearsal = evaluate(jobs.rehearsal.if!, start, "skipped");
      return { gate, prepare, release, rehearsal };
    };
    const tag = { event: "push", rebuild: "", rehearsal: false };
    const manual = { event: "workflow_dispatch", rebuild: "", rehearsal: false };
    expect(runs(tag)).toEqual({ gate: true, prepare: true, release: true, rehearsal: false });
    expect(runs(manual)).toEqual({ gate: false, prepare: false, release: true, rehearsal: false });
    expect(runs({ ...manual, rebuild: "v0.9.0" })).toEqual({ gate: true, prepare: true, release: true, rehearsal: false });
    expect(runs({ ...manual, rehearsal: true })).toEqual({ gate: false, prepare: false, release: false, rehearsal: true });
    // The combination: nothing that can write runs; the rehearsal job itself
    // stops at its first step.
    expect(runs({ ...manual, rebuild: "v0.9.0", rehearsal: true })).toEqual({ gate: false, prepare: false, release: false, rehearsal: true });
    expect(text).toMatch(/A rehearsal is not a Windows rebuild\n\s+if: inputs\.rebuild_windows_tag\n\s+run: \|\n\s+echo "::error::[^\n]*"\n\s+exit 1/);
  });

  // The rehearsal meets a missing release note before the tag does, and a
  // branch without a version bump is not held to notes it never needed.
  it("fails a rehearsal whose version has no release notes, and only then", () => {
    type Step = { name?: string; run?: string };
    const text = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    const steps = (parse(text) as { jobs: Record<string, { steps: Step[] }> }).jobs.rehearsal.steps;
    const index = steps.findIndex((step) => step.name === "The versioned release notes exist");
    expect(index, "the check runs before anything is built").toBeGreaterThan(0);
    expect(index).toBeLessThan(steps.findIndex((step) => step.name === "Build, sign and notarize (nothing is uploaded)"));
    const script = /<<'NODE'\n([\s\S]*?)\nNODE/.exec(steps[index].run!)![1];
    const run = (version: string, notes: Record<string, string>) => {
      const dir = mkdtempSync(join(tmpdir(), "rehearsal-notes-"));
      try {
        const files: Record<string, string> = {
          "apps/desktop/package.json": JSON.stringify({ version }),
          "apps/mobile/package.json": JSON.stringify({ version }),
          "apps/desktop/src-tauri/tauri.conf.json": JSON.stringify({ version }),
          ...notes,
        };
        for (const [path, body] of Object.entries(files)) {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), body);
        }
        execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, stdio: "pipe" });
        return "green";
      } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? error);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    // No bump: the notes of the release already out are there.
    expect(run("0.8.7", { "docs/releases/v0.8.7.md": "Notes" })).toBe("green");
    // The bump without its notes, or with empty ones, is red.
    expect(run("0.9.0", { "docs/releases/v0.8.7.md": "Notes" })).toContain("docs/releases/v0.9.0.md are missing");
    expect(run("0.9.0", { "docs/releases/v0.9.0.md": "  \n" })).toContain("are empty");
    expect(run("0.9.0", { "docs/releases/v0.9.0.md": "Notes" })).toBe("green");
  });

  // Every gap in the Windows signature check fails the step: an installer that
  // cannot be unpacked, or that lacks the app or the MCP helper, cannot be
  // shown to be signed (review of the rehearsal, 2026-11-16).
  it("measures the app and the helper inside both Windows installers, with no gap left as a warning", () => {
    const script = readFileSync(new URL("../scripts/verify-windows-signatures.ps1", import.meta.url), "utf8");
    expect(script).not.toContain("::warning::");
    expect(script).toContain('$inside = @("plainva-desktop.exe", "plainva-mcp.exe")');
    expect(script).toContain("Add-Inside $msi.Name $extract");
    expect(script).toContain("Add-Inside $nsis.Name $extract");
    expect(script).toContain('$failed += "msiexec /a could not unpack');
    expect(script).toContain('$failed += "7-Zip could not unpack');
    expect(script).toContain('$failed += "7-Zip is not available');
    expect(script).toContain('$script:failed += "$name is missing from $installer"');
  });
});
