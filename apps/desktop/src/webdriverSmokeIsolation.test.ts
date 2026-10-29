import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The embedded WebDriver server stays in the smoke build (docs/engineering/WebDriver_Smoke.md).
 *
 * The native smoke on macOS drives the app through `tauri-plugin-wdio-webdriver`:
 * a W3C WebDriver server INSIDE the app, on a local port, with which any local
 * process controls the app completely — reads every note, types, clicks. It is
 * compiled in only with the cargo feature `webdriver-smoke`, and only the smoke
 * build of `.github/workflows/native-smoke.yml` asks for that feature. This test
 * reads the sources that decide what a build contains and turns the commit red
 * that would let the server into any other build: a default feature, a
 * registration without the feature gate (or behind `debug_assertions`, which
 * every developer build has), a permission in the capabilities every build
 * loads, a configuration or a release workflow that names it.
 *
 * The second lock reads what was built: scripts/check-webdriver-server.sh in
 * release.yml, on every binary a release ships.
 */

const DESKTOP = resolve(__dirname, "..");
const REPO = resolve(DESKTOP, "../..");
const TAURI = join(DESKTOP, "src-tauri");
const CRATE = "tauri-plugin-wdio-webdriver";
const CRATE_IDENT = "tauri_plugin_wdio_webdriver";
const FEATURE = "webdriver-smoke";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

/** The lines of one `[section]` of a TOML file, without the header. */
function tomlSection(toml: string, header: string): string[] {
  const lines = toml.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${header}]`);
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim() && !line.trim().startsWith("#"));
}

/** Every `.rs` file under a directory. */
function rustFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustFiles(path));
    else if (entry.name.endsWith(".rs")) out.push(path);
  }
  return out;
}

describe("the embedded WebDriver server stays in the smoke build", () => {
  const cargo = read(join(TAURI, "Cargo.toml"));

  it("is an optional dependency with an exact version, pulled in by the smoke feature alone", () => {
    const declarations = cargo.split("\n").filter((line) => line.trim().startsWith(`${CRATE} `) || line.trim().startsWith(`${CRATE}=`));
    expect(declarations, `${CRATE} is declared exactly once in Cargo.toml`).toHaveLength(1);
    const declaration = declarations[0]!;
    expect(declaration, "the crate is optional — without the feature it is not compiled at all").toMatch(/optional\s*=\s*true/);
    expect(declaration, "the version is pinned exactly; the npm half has the same one (tauriVersionPairs.test.ts)").toMatch(/version\s*=\s*"=\d+\.\d+\.\d+"/);
    // Not a dev-dependency, not a build-dependency, no target table that would
    // make it unconditional on one system.
    expect(tomlSection(cargo, "dependencies").some((line) => line.trim().startsWith(`${CRATE} `))).toBe(true);

    const features = tomlSection(cargo, "features");
    const pulling = features.filter((line) => line.includes(CRATE));
    expect(pulling.map((line) => line.trim())).toEqual([`${FEATURE} = ["dep:${CRATE}"]`]);
    // Nothing turns the feature on by default, and no other feature includes it.
    const enabling = features.filter((line) => line.includes(`"${FEATURE}"`));
    expect(enabling, `no feature (and no default) enables ${FEATURE}`).toEqual([]);
  });

  it("is registered only under the smoke feature, never under debug_assertions", () => {
    const uses: string[] = [];
    for (const file of rustFiles(join(TAURI, "src"))) {
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        if (!line.includes(CRATE_IDENT) || line.trim().startsWith("//")) return;
        const gate = lines[i - 1]?.trim();
        uses.push(`${file.slice(TAURI.length + 1)}:${i + 1}`);
        expect(gate, `${file}:${i + 1} — the line above every use is the feature gate`).toBe(`#[cfg(feature = "${FEATURE}")]`);
      });
      const text = lines.join("\n");
      expect(text.includes(CRATE_IDENT) && /debug_assertions[\s\S]{0,200}wdio|wdio[\s\S]{0,200}debug_assertions/.test(text), `${file}: no debug_assertions near the WebDriver server — a developer build must open no port`).toBe(false);
    }
    // The registration exists — a guard over zero uses would pass anything.
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/lib\.rs:\d+$/);
  });

  it("asks for no permission in the capabilities every build loads", () => {
    for (const name of readdirSync(join(TAURI, "capabilities"))) {
      expect(read(join(TAURI, "capabilities", name)), `capabilities/${name}`).not.toMatch(/wdio/i);
    }
  });

  it("is named by no Tauri configuration but the macOS smoke overlay, and that one keeps the release identity", () => {
    const configs = readdirSync(TAURI).filter((name) => /^tauri.*\.conf\.json$/.test(name));
    expect(configs).toEqual(expect.arrayContaining(["tauri.conf.json", "tauri.smoke.macos.conf.json"]));
    for (const name of configs) {
      const text = read(join(TAURI, name));
      if (name === "tauri.smoke.macos.conf.json") continue;
      expect(text, name).not.toMatch(/wdio|webdriver/i);
    }
    // The overlay changes what a smoke build needs and nothing else: no own
    // identifier (the defaults domain of issue #135 is the release one), no
    // update source, no updater artefacts (they would need the release key).
    const overlay = JSON.parse(read(join(TAURI, "tauri.smoke.macos.conf.json"))) as Record<string, unknown>;
    expect(overlay).not.toHaveProperty("identifier");
    expect(overlay).toMatchObject({ plugins: { updater: { endpoints: [] } }, bundle: { createUpdaterArtifacts: false } });
  });

  it("is built by the native smoke workflow alone, and the release checks every binary for it", () => {
    const workflows = join(REPO, ".github", "workflows");
    const naming = readdirSync(workflows).filter((name) => read(join(workflows, name)).includes(FEATURE));
    expect(naming, `only native-smoke.yml builds with --features ${FEATURE}`).toEqual(["native-smoke.yml"]);
    const release = read(join(workflows, "release.yml"));
    expect(release).not.toMatch(/--features|--all-features/);
    expect(release, "release.yml runs the binary check on what it ships").toContain("check-webdriver-server.sh");
    // The CI's Rust jobs lint and test the default build; none of them turns the feature on.
    expect(read(join(workflows, "ci.yml"))).not.toMatch(/--all-features/);
  });
});
