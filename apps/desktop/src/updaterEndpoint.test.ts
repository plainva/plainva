// Guards the one coupling that can break auto-update for every desktop
// install without a single visible error: where the updater fetches its
// manifest from.
//
// Until 0.8.0 the only endpoint was `releases/latest/download/latest.json`,
// i.e. whatever release GitHub happens to label "Latest". That label is moved
// by publishing a release without the `prerelease` flag — which the mobile
// release workflow does deliberately, and which one careless commit could
// undo. Since C35 the app reads a FIXED path first (a permanent pre-release
// named `updater`, rewritten by `.github/workflows/updater-manifest.yml` on
// every published desktop release) and keeps the label path only as a
// fallback. These assertions keep the order and the workflow in place; a
// commit that "tidies" either turns the fallback back into the only path.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const confPath = resolve(here, "../src-tauri/tauri.conf.json");
const workflowPath = resolve(here, "../../../.github/workflows/updater-manifest.yml");
const mobileWorkflowPath = resolve(here, "../../../.github/workflows/release-mobile.yml");

const FIXED = "https://github.com/plainva/plainva/releases/download/updater/latest.json";
const LABEL = "https://github.com/plainva/plainva/releases/latest/download/latest.json";

function updaterEndpoints(): string[] {
  const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
    plugins?: { updater?: { endpoints?: unknown } };
  };
  const endpoints = conf.plugins?.updater?.endpoints;
  expect(Array.isArray(endpoints)).toBe(true);
  return endpoints as string[];
}

describe("updater endpoint (C35)", () => {
  it("reads the manifest from the fixed `updater` release first", () => {
    expect(updaterEndpoints()[0]).toBe(FIXED);
  });

  it("keeps the label path only as a fallback, never as the only path", () => {
    const endpoints = updaterEndpoints();
    expect(endpoints).toContain(LABEL);
    expect(endpoints.indexOf(LABEL)).toBeGreaterThan(endpoints.indexOf(FIXED));
    // No third, unknown host: the pubkey only vouches for the manifest, not
    // for where it came from, and an extra endpoint is an extra place to
    // point installs at.
    for (const url of endpoints) {
      expect(url.startsWith("https://github.com/plainva/plainva/releases/")).toBe(true);
    }
  });

  it("has the workflow that rewrites the fixed manifest on every published desktop release", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toMatch(/types:\s*\[published\]/);
    expect(workflow).toContain("FIXED_TAG: updater");
    expect(workflow).toContain("gh release upload \"$FIXED_TAG\" latest.json --clobber");
    // Only vX.Y.Z feeds the fixed manifest — a mobile tag or the `updater`
    // release itself must be skipped, or the file would be copied onto itself.
    expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
    expect(workflow).toContain("--prerelease");
  });

  it("still keeps mobile releases off the `latest` label while old installs use the fallback", () => {
    // Installs up to 0.8.0 know only the label path. Until they have updated
    // once, a mobile release that became "Latest" would still strand them, so
    // the flag in release-mobile.yml remains a real protection, not decoration.
    const mobile = readFileSync(mobileWorkflowPath, "utf8");
    expect(mobile).toMatch(/prerelease:\s*\$\{\{ steps\.mobile_version\.outputs\.interim != 'true' \}\}/);
  });
});
