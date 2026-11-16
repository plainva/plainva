import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { LEGS, appVersion, expectedBundles } from "../scripts/expected-bundles.mjs";

// What a release uploads, per leg, checked after the build on the tag and in
// the rehearsal. tauri-action v1.0.0 counts a build that a signal ended as a
// success and uploads what is already there (review of the rehearsal,
// 2026-11-16).
describe("every release file was built", () => {
  // The assets of the published 0.8.7 release, latest.json aside (the action
  // writes it). The action renames only the macOS updater archive
  // (Plainva.app.tar.gz → Plainva_<v>_universal.app.tar.gz).
  const assets087 = [
    "Plainva-0.8.7-1.x86_64.rpm", "Plainva-0.8.7-1.x86_64.rpm.sig",
    "Plainva_0.8.7_amd64.AppImage", "Plainva_0.8.7_amd64.AppImage.sig",
    "Plainva_0.8.7_amd64.deb", "Plainva_0.8.7_amd64.deb.sig",
    "Plainva_0.8.7_universal.app.tar.gz", "Plainva_0.8.7_universal.app.tar.gz.sig",
    "Plainva_0.8.7_universal.dmg",
    "Plainva_0.8.7_x64-setup.exe", "Plainva_0.8.7_x64-setup.exe.sig",
    "Plainva_0.8.7_x64_en-US.msi", "Plainva_0.8.7_x64_en-US.msi.sig",
  ];

  it("lists exactly the files 0.8.7 shipped", () => {
    const uploaded = LEGS.flatMap((leg) => expectedBundles(leg, "0.8.7"))
      .map((file) => basename(file).replace(/^Plainva\.app\.tar\.gz/, "Plainva_0.8.7_universal.app.tar.gz"));
    expect(uploaded.sort()).toEqual([...assets087].sort());
    expect(() => expectedBundles("windows-arm", "0.8.7")).toThrow("unknown build leg");
  });

  it("fails the leg when a file is missing or empty, and only then", () => {
    const entry = fileURLToPath(new URL("../scripts/expected-bundles-check.mjs", import.meta.url));
    const version = appVersion(fileURLToPath(new URL("../src-tauri/", import.meta.url)));
    const run = (leg: string, skip: (file: string) => "missing" | "empty" | null) => {
      const dir = mkdtempSync(join(tmpdir(), "expected-bundles-"));
      try {
        for (const file of expectedBundles(leg, version)) {
          const what = skip(file);
          if (what === "missing") continue;
          mkdirSync(dirname(join(dir, file)), { recursive: true });
          writeFileSync(join(dir, file), what === "empty" ? "" : "x");
        }
        execFileSync(process.execPath, [entry, leg, "--target", dir], { stdio: "pipe" });
        return "green";
      } catch (error) {
        return String((error as { stderr?: Buffer }).stderr ?? error);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    for (const leg of LEGS) expect(run(leg, () => null)).toBe("green");
    expect(run("macos-latest", (f) => (f.endsWith(".tar.gz.sig") ? "missing" : null))).toContain("missing or empty after the build: universal-apple-darwin/release/bundle/macos/Plainva.app.tar.gz.sig");
    expect(run("windows-latest", (f) => (f.endsWith("-setup.exe.sig") ? "empty" : null))).toContain("-setup.exe.sig");
    expect(run("ubuntu-22.04", (f) => (f.endsWith(".AppImage") ? "missing" : null))).toContain(".AppImage");
  });

  it("runs right after the build on the tag and in the rehearsal, and the record lists the same files", () => {
    type Step = { name?: string; uses?: string; run?: string; if?: string };
    const workflow = parse(readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
    const check = "node apps/desktop/scripts/expected-bundles-check.mjs ${{ matrix.platform }}";
    for (const [job, build] of [["release", "Build Tauri App"], ["rehearsal", "Build, sign and notarize (nothing is uploaded)"]]) {
      const steps = workflow.jobs[job].steps;
      const at = steps.findIndex((s) => s.name === build);
      expect(steps[at + 1].name, `${job}: the step after the build`).toBe("Every release file was built");
      expect(steps[at + 1].run).toBe(check);
      expect(steps[at + 1].if).toBe(steps[at].if);
    }
    const record = workflow.jobs.rehearsal.steps.find((s) => s.name === "List what a release would have uploaded")!;
    expect(record.run).toContain('expected-bundles-check.mjs "${{ matrix.platform }}" --list');
    expect(record.run).not.toContain("find ");
  });
});
