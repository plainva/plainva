// What the updater trusts, held in place (stability plan R11, finding S12).
//
// The updater signature test (`wdio/updater-signature.e2e.ts`, job
// "updater signature" in native-smoke.yml) proves against a debug build that
// a changed file, a foreign key, the signature of another file, an older
// release announced as new and a signature without a version are refused. It
// builds that app with a test key and a plain-http local endpoint. These
// assertions keep the release side of the same promise: whatever configures a
// build — a file in src-tauri, a `--config` named by a workflow, a script or a
// package script — carries the project's key and nothing that loosens the
// check, and the test's loosening never reaches anything committed.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_PLATFORMS_BY_RUNNER } from "../scripts/updater-manifest-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const tauriDir = join(desktop, "src-tauri");
const repo = resolve(desktop, "../..");

/** The release signing key, as committed (the private half lives in the repository secrets). */
const RELEASE_PUBKEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMyMzdDODIyNzA5MzQ2NzYKUldSMlJwTndJc2czTWpuQkxvclZrb0JHZXJLT3k1bUMrazVZRVJlOExISkg3WXloc1pDSVJld1IK";
/** The first plugin release that knows `requireSignedVersion` and the refusal wording `appUpdate.ts` reads. */
const PLUGIN_FLOOR = [2, 13, 0];

type Json = Record<string, unknown>;
const read = (file: string) => readFileSync(file, "utf8");
/** A key as the plugin reads it: camelCase or its kebab-case alias (tauri-plugin-updater config.rs), any case. */
const norm = (key: string) => key.toLowerCase().replace(/[-_]/g, "");
const last = (path: string[]) => path[path.length - 1];

function entriesDeep(value: unknown, path: string[] = []): Array<{ path: string[]; value: unknown }> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Json).flatMap(([key, inner]) => [{ path: [...path, norm(key)], value: inner }, ...entriesDeep(inner, [...path, norm(key)])]);
}

const configFiles = readdirSync(tauriDir).filter((name) => /^tauri.*\.(json5?|toml)$/i.test(name));
const configs = configFiles.filter((name) => name.endsWith(".json")).map((name) => ({ name, json: JSON.parse(read(join(tauriDir, name))) as Json }));

/** The sources that can hand a build its configuration: workflows, package scripts, the desktop's scripts. */
const sources = [
  ...readdirSync(join(repo, ".github/workflows")).filter((n) => /\.ya?ml$/.test(n)).map((n) => join(repo, ".github/workflows", n)),
  join(repo, "package.json"),
  join(desktop, "package.json"),
  ...readdirSync(join(desktop, "scripts")).filter((n) => /\.(mjs|js|sh|ps1)$/.test(n)).map((n) => join(desktop, "scripts", n)),
].map((file) => ({ file, text: read(file) }));

/** The one place a `--config` may name something that is not a committed file: the signature test's own overlay. */
const TEST_OVERLAY = '"$PLAINVA_UPDATER_TEST_DIR/tauri.updater-test.conf.json"';

describe("what the updater trusts (R11)", () => {
  it("reads every Tauri configuration of the app, and only JSON ones", () => {
    expect(configs.map((c) => c.name)).toContain("tauri.conf.json");
    expect(configs.length).toBeGreaterThanOrEqual(5);
    // A JSON5 or TOML configuration would be read by Tauri and not by this guard.
    expect(configFiles.filter((name) => !name.endsWith(".json"))).toEqual([]);
  });

  it("trusts the project's release key, set in the release configuration and nowhere else", () => {
    const keys = configs.flatMap(({ name, json }) => entriesDeep(json).filter((e) => last(e.path) === "pubkey").map((e) => ({ name, path: e.path.join("."), value: e.value })));
    expect(keys).toEqual([{ name: "tauri.conf.json", path: "plugins.updater.pubkey", value: RELEASE_PUBKEY }]);
  });

  it("requires signed versions in the release configuration and allows no downgrade anywhere", () => {
    const flags = configs.flatMap(({ name, json }) =>
      entriesDeep(json)
        .filter((e) => ["requiresignedversion", "allowdowngrades"].includes(last(e.path)))
        .map((e) => ({ name, path: e.path.join("."), value: e.value })),
    );
    expect(flags).toEqual([{ name: "tauri.conf.json", path: "plugins.updater.requiresignedversion", value: true }]);
  });

  it("carries no `dangerous…` switch in any configuration, in any spelling", () => {
    // dangerousInsecureTransportProtocol, dangerousAcceptInvalidCerts,
    // dangerousAcceptInvalidHostnames: a release build refuses a plain-http
    // endpoint only while none of them is set.
    for (const { name, json } of configs) {
      expect(entriesDeep(json).filter((e) => last(e.path).startsWith("dangerous")).map((e) => e.path.join(".")), name).toEqual([]);
    }
  });

  it("asks only https addresses in every configuration that keeps endpoints", () => {
    for (const { name, json } of configs) {
      for (const e of entriesDeep(json).filter((x) => last(x.path) === "endpoints")) {
        for (const url of e.value as string[]) expect(url.startsWith("https://"), `${name}: ${url}`).toBe(true);
      }
    }
  });

  it("builds only with configurations this guard reads: no inline JSON, no TAURI_CONFIG, no unknown path", () => {
    const named: string[] = [];
    for (const { file, text } of sources) {
      expect(text.includes("TAURI_CONFIG"), `${file} sets TAURI_CONFIG`).toBe(false);
      for (const line of text.split("\n")) {
        // `-c` is Tauri's short form; on a line that runs tauri it is refused outright.
        if (/\btauri\b/.test(line)) expect(/\stauri\b[^#]*\s-c[\s=]/.test(line), `${file}: ${line.trim()}`).toBe(false);
        for (const match of line.matchAll(/--config[\s=]+("[^"]*"|'[^']*'|[^\s'"]+)/g)) {
          const arg = match[1];
          const bare = arg.replace(/^["']|["']$/g, "");
          if (/\.(ts|js|mjs|cjs|ya?ml)$/.test(bare)) continue; // another tool's configuration (playwright, wdio)
          if (arg === TEST_OVERLAY) {
            expect(file.endsWith("native-smoke.yml"), `${file} names the test overlay`).toBe(true);
            continue;
          }
          expect(bare.startsWith("{"), `${file}: inline configuration ${arg}`).toBe(false);
          expect(bare.includes("$"), `${file}: a configuration from a variable, ${arg}`).toBe(false);
          named.push(`${file}: ${bare}`);
          const path = bare.startsWith("apps/desktop/") ? join(repo, bare) : join(desktop, bare);
          expect(dirname(path), `${file}: ${bare} lies outside src-tauri`).toBe(tauriDir);
          expect(configFiles, `${file}: ${bare}`).toContain(path.slice(tauriDir.length + 1));
        }
      }
    }
    // The extraction did not go blind: the release legs and the isolated dev build are among them.
    expect(named.some((n) => n.includes("release.yml") && n.endsWith("tauri.signing.conf.json"))).toBe(true);
    expect(named.some((n) => n.includes("package.json") && n.endsWith("tauri.dev.conf.json"))).toBe(true);
  });

  it("builds the plugin from the configuration alone: one registration, no key, comparator or builder in code", () => {
    const rust: Array<{ name: string; text: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== "target" && entry.name !== "gen") walk(join(dir, entry.name));
        } else if (entry.name.endsWith(".rs")) rust.push({ name: join(dir, entry.name).slice(tauriDir.length + 1), text: read(join(dir, entry.name)) });
      }
    };
    walk(tauriDir);
    expect(rust.some((r) => r.name.replace(/\\/g, "/") === "src/lib.rs")).toBe(true);
    const mentions = rust.flatMap((r) => (r.text.match(/tauri_plugin_updater/g) ?? []).map(() => r.name.replace(/\\/g, "/")));
    expect(mentions).toEqual(["src/lib.rs"]);
    expect(read(join(tauriDir, "src/lib.rs"))).toContain(".plugin(tauri_plugin_updater::Builder::new().build())");
    for (const { name, text } of rust) {
      for (const word of [".pubkey(", "updater_builder", "UpdaterExt", "version_comparator", "allow_downgrades", ".endpoints("]) {
        expect(text.includes(word), `${name} uses ${word}`).toBe(false);
      }
    }
  });

  it("requires and locks a plugin that knows `requireSignedVersion`", () => {
    const atLeastFloor = (version: string) => {
      const parts = version.split(".").map(Number);
      for (let i = 0; i < 3; i += 1) if (parts[i] !== PLUGIN_FLOOR[i]) return parts[i] > PLUGIN_FLOOR[i];
      return true;
    };
    const required = /^tauri-plugin-updater\s*=\s*\{\s*version\s*=\s*"=?\^?([\d.]+)"/m.exec(read(join(tauriDir, "Cargo.toml")))?.[1];
    expect(required, "Cargo.toml names tauri-plugin-updater").toBeDefined();
    expect(atLeastFloor(required!), `Cargo.toml requires ${required}`).toBe(true);
    const locked = /name = "tauri-plugin-updater"\r?\nversion = "([\d.]+)"/.exec(read(join(tauriDir, "Cargo.lock")))?.[1];
    expect(locked, "Cargo.lock locks tauri-plugin-updater").toBeDefined();
    expect(atLeastFloor(locked!), `Cargo.lock locks ${locked}`).toBe(true);
  });

  it("keeps the test's loosening in the test: the fixture overlay sets the key and the address, nothing else", () => {
    const fixtures = read(join(desktop, "scripts/updater-signature-fixtures.mjs"));
    expect(fixtures).toContain("plugins: { updater: { pubkey: trusted.pub, endpoints: [`${base}/latest.json`] } }");
    expect(fixtures).not.toMatch(/dangerous[\w-]*["']?\s*:/i);
  });

  it("keeps the manifest check's platform list in step with release.yml's build matrix", () => {
    const release = read(join(repo, ".github/workflows/release.yml"));
    const matrix = /fromJSON\('(\["macos[^']*\])'\)/.exec(release)?.[1];
    expect(matrix, "release.yml names its full build matrix").toBeDefined();
    expect((JSON.parse(matrix!) as string[]).sort()).toEqual(Object.keys(EXPECTED_PLATFORMS_BY_RUNNER).sort());
  });

  it("runs the signature test in the native smoke and the manifest check before the fixed address moves", () => {
    const smoke = read(join(repo, ".github/workflows/native-smoke.yml"));
    expect(smoke).toContain("updater-signature:");
    expect(smoke).toContain("test:native:updater");
    expect(smoke).toContain(`--config ${TEST_OVERLAY}`);
    const manifest = read(join(repo, ".github/workflows/updater-manifest.yml"));
    const check = manifest.indexOf('node apps/desktop/scripts/updater-manifest-check.mjs latest.json "$expected"');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(manifest.indexOf('gh release upload "$FIXED_TAG" latest.json --clobber'));
  });
});
