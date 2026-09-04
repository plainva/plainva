import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The platform requirements Google Play and Android put on the app, checked
 * against the files that carry them (plan 2026-09-04, P1). Each one is a
 * deadline that fails silently otherwise: an upload refused months later, an
 * app killed with no trace. The dates live in
 * docs/engineering/Android_Platform_Requirements.md; this test keeps the
 * guards that back them wired.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(repositoryRoot, rel), "utf8");

describe("Android platform guards", () => {
  it("checks 16 KB page alignment of every native library BEFORE the Play upload", () => {
    const workflow = read(".github/workflows/release-mobile.yml");
    const check = workflow.indexOf("Check 16 KB page alignment of native libraries");
    const upload = workflow.indexOf("Upload AAB to the Play internal test track");
    expect(check).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(check);
    // The substantive check: LOAD segments of every .so in the bundle.
    expect(workflow).toContain("readelf -lW");
    expect(workflow).toContain("16384");
  });

  it("targets at least API 36 (Play's floor for new builds since 2026-08-31)", () => {
    const gradle = read("apps/mobile/android/variables.gradle");
    const target = Number(/targetSdkVersion\s*=\s*(\d+)/.exec(gradle)?.[1]);
    const compile = Number(/compileSdkVersion\s*=\s*(\d+)/.exec(gradle)?.[1]);
    expect(target).toBeGreaterThanOrEqual(36);
    expect(compile).toBeGreaterThanOrEqual(target);
  });

  it("keeps the dates and the guards in one engineering note", () => {
    const note = read("docs/engineering/Android_Platform_Requirements.md");
    for (const must of ["2027-02-01", "16 KB", "targetSdk", "Memory Limiter", "ProcessExit", "Check 16 KB page alignment"]) {
      expect(note, must).toContain(must);
    }
  });

  it("registers the exit-reason plugin under the name the TypeScript side expects", () => {
    const java = read("apps/mobile/android/app/src/main/java/com/plainva/app/ProcessExitPlugin.java");
    const main = read("apps/mobile/android/app/src/main/java/com/plainva/app/MainActivity.java");
    const ts = read("apps/mobile/src/platform/processExit.ts");
    const jsName = /@CapacitorPlugin\(name = "([^"]+)"\)/.exec(java)?.[1];
    expect(jsName).toBe("ProcessExit");
    expect(ts).toContain(`registerPlugin<ProcessExitNative>("${jsName}")`);
    expect(main).toContain("registerPlugin(ProcessExitPlugin.class)");
    // Read-only and guarded: no permission, nothing below Android 11.
    expect(java).toContain("Build.VERSION_CODES.R");
  });
});
