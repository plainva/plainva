import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("T15 mobile build version contract", () => {
  it("keeps the shared mobile package version strictly three-part", () => {
    const manifest = JSON.parse(read("apps/mobile/package.json")) as { version: string };
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts a fourth segment only as the Android versionName", () => {
    const workflow = read(".github/workflows/release-mobile.yml");
    const gradle = read("apps/mobile/android/app/build.gradle");

    expect(workflow).toContain("Android version name must be X.Y.Z or X.Y.Z.N");
    expect(workflow).toContain("VERSION_NAME: ${{ steps.mobile_version.outputs.version }}");
    expect(workflow).toContain("VERSION_CODE: ${{ github.run_number }}");
    expect(gradle).toContain('System.getenv("VERSION_NAME")');
    expect(gradle).toContain("versionName resolvedVersionName");
    expect(gradle).toContain(String.raw`^\d+\.\d+\.\d+(?:\.\d+)?$`);
  });

  it("keeps TestFlight on a three-part marketing version and a monotonic build", () => {
    const iosWorkflow = read(".github/workflows/ios.yml");
    const project = read("apps/mobile/ios/App/App.xcodeproj/project.pbxproj");

    expect(iosWorkflow).toContain("CURRENT_PROJECT_VERSION=${{ github.run_number }}");
    expect(project).toContain("MARKETING_VERSION = 1.0;");
    expect(project).not.toMatch(/MARKETING_VERSION = \d+\.\d+\.\d+\.\d+;/);
  });
});
