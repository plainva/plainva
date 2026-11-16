import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extraBinaries, universalPlan } from "../scripts/universal-binaries.mjs";

// On `--target universal-apple-darwin` the Tauri CLI joins only the main
// program into the universal folder, while the bundler copies every program of
// the crate from there; without this hook the macOS bundle with the MCP helper
// failed on both the tag and the rehearsal path ("Failed to copy binary").
describe("universal macOS helper programs", () => {
  const binDir = new URL("../src-tauri/src/bin/", import.meta.url);

  it("joins every extra program of the crate, and only on the universal target", () => {
    const binaries = extraBinaries(readdirSync(binDir));
    expect(binaries).toContain("plainva-mcp");
    const plan = universalPlan({ triple: "universal-apple-darwin", debug: false, targetDir: "/t", binaries });
    expect(plan).toContainEqual({
      name: "plainva-mcp",
      output: join("/t", "universal-apple-darwin", "release", "plainva-mcp"),
      inputs: [join("/t", "aarch64-apple-darwin", "release", "plainva-mcp"), join("/t", "x86_64-apple-darwin", "release", "plainva-mcp")],
    });
    expect(universalPlan({ triple: "universal-apple-darwin", debug: true, targetDir: "/t", binaries })![0].output).toContain(join("debug", ""));
    for (const triple of ["aarch64-apple-darwin", "x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu", undefined]) {
      expect(universalPlan({ triple, debug: false, targetDir: "/t", binaries })).toBeNull();
    }
  });

  it("is the bundle hook of the base configuration, so the tag and the rehearsal both run it", () => {
    const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { build: { beforeBundleCommand?: string } };
    // tauri-action starts the CLI from the repository root, the rehearsal from
    // apps/desktop: the hook has to work from both, hence pnpm --filter.
    expect(config.build.beforeBundleCommand).toBe("pnpm --filter desktop run tauri:before-bundle");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["tauri:before-bundle"]).toBe("node scripts/universal-binaries.mjs");
  });
});
