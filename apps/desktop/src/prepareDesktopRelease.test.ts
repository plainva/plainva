import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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

  it("passes the allocated ID to every platform and keeps manual runs build-only", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(workflow).toContain("needs: prepare");
    expect(workflow).toContain("releaseId: ${{ needs.prepare.outputs.release_id }}");
    expect(workflow).toContain("group: desktop-release-${{ github.ref }}");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch' || needs.prepare.result == 'success'");
    expect(workflow).toMatch(/prepare:\s+if: github\.event_name != 'workflow_dispatch'/);
  });
});
