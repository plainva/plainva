import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    // Both paths start the CLI from the repository root; pnpm --filter keeps
    // the hook working from apps/desktop too (a local `pnpm tauri build`).
    expect(config.build.beforeBundleCommand).toBe("pnpm --filter desktop run tauri:before-bundle");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["tauri:before-bundle"]).toBe("node scripts/universal-binaries-run.mjs");
  });

  // The hook as the CLI runs it: its entry point as a child process, with
  // stand-ins for `lipo` and `cargo` first on the PATH that record their
  // calls. POSIX shell stand-ins, so not on Windows, which never runs the
  // universal target.
  describe.skipIf(process.platform === "win32")("the hook as a process", () => {
    const entry = fileURLToPath(new URL("../scripts/universal-binaries-run.mjs", import.meta.url));
    const run = (options: { triple?: string; archs?: string; built?: string[]; viaCargo?: boolean }) => {
      const dir = mkdtempSync(join(tmpdir(), "universal-binaries-"));
      try {
        const bin = join(dir, "bin");
        const target = join(dir, "target");
        const calls = join(dir, "calls.log");
        mkdirSync(bin);
        writeFileSync(join(bin, "lipo"), `#!/bin/sh
echo "lipo $*" >> "${calls}"
if [ "$1" = "-create" ]; then : > "$3"; exit 0; fi
if [ "$1" = "-archs" ]; then echo "$FAKE_ARCHS"; exit 0; fi
exit 2
`);
        writeFileSync(join(bin, "cargo"), `#!/bin/sh
echo "cargo $*" >> "${calls}"
printf '{"target_directory":"%s"}' "${target}"
`);
        chmodSync(join(bin, "lipo"), 0o755);
        chmodSync(join(bin, "cargo"), 0o755);
        for (const part of options.built ?? ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
          mkdirSync(join(target, part, "release"), { recursive: true });
          writeFileSync(join(target, part, "release", "plainva-mcp"), "");
        }
        const env: NodeJS.ProcessEnv = { PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_ARCHS: options.archs ?? "x86_64 arm64", TAURI_ENV_DEBUG: "false" };
        if (options.triple) env.TAURI_ENV_TARGET_TRIPLE = options.triple;
        if (!options.viaCargo) env.CARGO_TARGET_DIR = target;
        let outcome: string;
        try {
          execFileSync(process.execPath, [entry], { env, stdio: "pipe" });
          outcome = "ok";
        } catch (error) {
          outcome = String((error as { stderr?: Buffer }).stderr ?? error);
        }
        const log = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : [];
        const joined = existsSync(join(target, "universal-apple-darwin", "release", "plainva-mcp"));
        return { outcome, log, joined, target };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it("joins plainva-mcp from both architectures and checks the result", () => {
      for (const viaCargo of [false, true]) {
        const { outcome, log, joined, target } = run({ triple: "universal-apple-darwin", viaCargo });
        expect(outcome).toBe("ok");
        expect(joined).toBe(true);
        const out = join(target, "universal-apple-darwin", "release", "plainva-mcp");
        expect(log.filter((line) => line.startsWith("lipo"))).toEqual([
          `lipo -create -output ${out} ${join(target, "aarch64-apple-darwin", "release", "plainva-mcp")} ${join(target, "x86_64-apple-darwin", "release", "plainva-mcp")}`,
          `lipo -archs ${out}`,
        ]);
        expect(log.some((line) => line.startsWith("cargo metadata"))).toBe(viaCargo);
      }
    });

    it("stops when an architecture was not built", () => {
      const { outcome, log } = run({ triple: "universal-apple-darwin", built: ["aarch64-apple-darwin"] });
      expect(outcome).toContain("plainva-mcp was not built for");
      expect(outcome).toContain("x86_64-apple-darwin");
      expect(log).toEqual([]);
    });

    it("stops when the joined program does not carry both architectures", () => {
      const { outcome } = run({ triple: "universal-apple-darwin", archs: "arm64" });
      expect(outcome).toContain("plainva-mcp carries arm64, expected arm64 and x86_64");
    });

    it("calls nothing on any other target", () => {
      for (const triple of ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu", undefined]) {
        const { outcome, log, joined } = run({ triple });
        expect(outcome).toBe("ok");
        expect(log).toEqual([]);
        expect(joined).toBe(false);
      }
    });
  });
});
