import { readFileSync } from "node:fs";
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
    expect(workflow).toMatch(/prepare:\s+if: github\.event_name != 'workflow_dispatch'/);
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
    // The draft-making jobs stay skipped for any manual run without a rebuild tag.
    for (const id of ["release-gate", "prepare"]) expect(workflow.jobs[id].if).toBe("github.event_name != 'workflow_dispatch' || inputs.rebuild_windows_tag");
    expect(JSON.stringify(workflow.jobs.release.steps)).toContain("./apps/desktop/scripts/verify-windows-signatures.ps1");
  });
});
