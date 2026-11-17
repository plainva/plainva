import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// A green rehearsal stands for the tag only if both build with the same Tauri
// CLI, from the same directory, with the same arguments and environment
// (review of the rehearsal, 2026-11-16: the tag path installed the newest
// 2.x globally and ran from the repository root, the rehearsal used the
// locked 2.12.0 from apps/desktop).
type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, string>; "working-directory"?: string };
type Job = { steps: Step[]; defaults?: unknown };

const root = new URL("../../../", import.meta.url);
const workflow = parse(readFileSync(new URL(".github/workflows/release.yml", root), "utf8")) as { jobs: Record<string, Job> };
const CLI = "node apps/desktop/node_modules/@tauri-apps/cli/tauri.js";

const step = (job: string, name: string) => {
  const found = workflow.jobs[job].steps.find((s) => s.name === name);
  expect(found, `${job}: step "${name}"`).toBeDefined();
  return found!;
};

describe("one Tauri CLI for the tag and the rehearsal", () => {
  it("runs the tag build with the locked CLI from the repository root", () => {
    const build = step("release", "Build Tauri App");
    expect(build.uses).toBe("tauri-apps/tauri-action@v1");
    expect(build.with!.tauriScript).toBe(CLI);
    // projectPath stays the default "." (the root): it is where the action
    // runs the CLI, and the config paths in `args` are relative to it.
    expect(build.with!.projectPath).toBeUndefined();
    expect(build["working-directory"]).toBeUndefined();
  });

  it("runs the same command, arguments and environment in the rehearsal", () => {
    const tag = step("release", "Build Tauri App");
    const rehearsal = step("rehearsal", "Build, sign and notarize (nothing is uploaded)");
    expect(rehearsal["working-directory"]).toBeUndefined();
    expect(workflow.jobs.rehearsal.defaults).toBeUndefined();
    // The argument expression is the same text, so every platform gets the
    // same words.
    expect(rehearsal.env!.TAURI_ARGS.trim()).toBe(tag.with!.args.trim());
    expect(tag.with!.args).toContain("matrix.platform == 'macos-latest' && '--target universal-apple-darwin");
    expect(tag.with!.args).toContain("matrix.platform == 'windows-latest' && '--config apps/desktop/src-tauri/tauri.signing.conf.json");
    expect(rehearsal.run).toContain(`${CLI} build $TAURI_ARGS`);
    expect(rehearsal.run).not.toMatch(/pnpm[^\n]*tauri build/);
    // What tauri-action adds: FORCE_COLOR=0 always, and on macOS
    // TAURI_BUNDLER_DMG_IGNORE_CI unless it is set already.
    expect(rehearsal.env!.FORCE_COLOR).toBe("0");
    expect(rehearsal.run).toContain('export TAURI_BUNDLER_DMG_IGNORE_CI="${TAURI_BUNDLER_DMG_IGNORE_CI:-true}"');
    // The environment of the tag build, key and expression, minus the token
    // the rehearsal never gets and the two it adds for the action's part.
    const own = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([key]) => !["GITHUB_TOKEN", "TAURI_ARGS", "FORCE_COLOR"].includes(key)));
    expect(own(rehearsal.env!)).toEqual(own(tag.env!));
    expect(Object.keys(own(tag.env!)).length).toBeGreaterThan(10);
  });

  it("logs the CLI version on both paths and names it in the rehearsal record", () => {
    for (const job of ["release", "rehearsal"]) {
      const version = step(job, "Tauri CLI version");
      expect(version.run).toContain(`${CLI} --version`);
      const steps = workflow.jobs[job].steps.map((s) => s.name);
      expect(steps.indexOf("Tauri CLI version")).toBeGreaterThan(steps.indexOf("Install frontend dependencies"));
    }
    expect(step("rehearsal", "List what a release would have uploaded").run).toContain("${TAURI_CLI_VERSION}");
  });

  // The CLI that bundles the release is pinned exactly, in three places
  // that move together: the package, the lockfile and the line in
  // Dependency_Updates.md that says it is raised only through a rehearsal.
  // Raising it in one place alone turns this red.
  it("pins the CLI exactly, the same in the package, the lockfile and the update guide", () => {
    const pkg = JSON.parse(readFileSync(new URL("apps/desktop/package.json", root), "utf8")) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    const pinned = pkg.devDependencies?.["@tauri-apps/cli"] ?? pkg.dependencies?.["@tauri-apps/cli"];
    expect(pinned, "an exact version, no range").toMatch(/^\d+\.\d+\.\d+$/);
    const lock = readFileSync(new URL("pnpm-lock.yaml", root), "utf8");
    const importer = /\n {6}'@tauri-apps\/cli':\n {8}specifier: (\S+)\n {8}version: (\S+)\n/.exec(lock);
    expect(importer, "apps/desktop's entry for the CLI in pnpm-lock.yaml").not.toBeNull();
    expect([importer![1], importer![2]]).toEqual([pinned, pinned]);
    const versions = [...new Set([...lock.matchAll(/^ {2}'@tauri-apps\/cli@(\d+\.\d+\.\d+)':$/gm)].map((m) => m[1]))];
    expect(versions, "one locked @tauri-apps/cli").toEqual([pinned]);
    const guide = readFileSync(new URL("docs/engineering/Dependency_Updates.md", root), "utf8");
    expect(guide).toContain(`Pinned CLI: \`${pinned}\``);
  });
});
