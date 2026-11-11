// What the updater trusts, held in place (stability plan R11, finding S12).
//
// The updater signature test (`wdio/updater-signature.e2e.ts`, job
// "updater signature" in native-smoke.yml) proves against the BUILT app that
// a changed file, a foreign key, the signature of another file, an older
// release announced as new and a signature without a version are refused. It
// builds that app with a test key and a plain-http local endpoint. These
// assertions keep the release side of the same promise: the release
// configuration carries the project's key and nothing that loosens the check,
// and the test's loosening never reaches a committed configuration.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(here, "../src-tauri");
const repo = resolve(here, "../../..");

/** The release signing key's id, as minisign prints it (the key itself lives in the repository secrets). */
const RELEASE_KEY_ID = "3237C82270934676";

type Json = Record<string, unknown>;
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Json;
const configs = readdirSync(tauriDir)
  .filter((name) => /^tauri(\..+)?\.conf\.json$/.test(name))
  .map((name) => ({ name, json: read(join(tauriDir, name)) }));
const updaterOf = (json: Json) => ((json.plugins as Json | undefined)?.updater as Json | undefined) ?? undefined;

function keysDeep(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Json).flatMap(([key, inner]) => [`${path}${key}`, ...keysDeep(inner, `${path}${key}.`)]);
}

describe("what the updater trusts (R11)", () => {
  it("reads every committed Tauri configuration (the list did not go blind)", () => {
    expect(configs.map((c) => c.name)).toContain("tauri.conf.json");
    expect(configs.length).toBeGreaterThanOrEqual(5);
  });

  it("trusts the project's release key, set in the release configuration only", () => {
    const updater = updaterOf(configs.find((c) => c.name === "tauri.conf.json")!.json)!;
    const decoded = Buffer.from(String(updater.pubkey), "base64").toString("utf8");
    expect(decoded).toContain(`minisign public key: ${RELEASE_KEY_ID}`);
    // An overlay that brought its own key would make a build trust someone else.
    for (const { name, json } of configs) {
      if (name === "tauri.conf.json") continue;
      expect(updaterOf(json)?.pubkey, `${name} sets an updater key`).toBeUndefined();
    }
  });

  it("requires every signature to name the version it was signed for, and allows no downgrade", () => {
    const updater = updaterOf(configs.find((c) => c.name === "tauri.conf.json")!.json)!;
    expect(updater.requireSignedVersion).toBe(true);
    for (const { name, json } of configs) {
      const u = updaterOf(json);
      if (!u) continue;
      expect(u.allowDowngrades, `${name} allows downgrades`).toBeUndefined();
      if (name !== "tauri.conf.json") expect(u.requireSignedVersion, `${name} changes requireSignedVersion`).toBeUndefined();
    }
  });

  it("carries no `dangerous…` switch in any committed configuration", () => {
    // dangerousInsecureTransportProtocol, dangerousAcceptInvalidCerts,
    // dangerousAcceptInvalidHostnames: a release build refuses a plain-http
    // endpoint only while none of them is set.
    for (const { name, json } of configs) {
      const dangerous = keysDeep(json).filter((key) => /(^|\.)dangerous/i.test(key));
      expect(dangerous, name).toEqual([]);
    }
  });

  it("asks only https addresses in every overlay that keeps endpoints", () => {
    for (const { name, json } of configs) {
      const endpoints = (updaterOf(json)?.endpoints as string[] | undefined) ?? [];
      for (const url of endpoints) expect(url.startsWith("https://"), `${name}: ${url}`).toBe(true);
    }
  });

  it("builds the plugin from the configuration alone — no key, comparator or address in code", () => {
    const lib = readFileSync(join(tauriDir, "src", "lib.rs"), "utf8");
    expect(lib).toContain(".plugin(tauri_plugin_updater::Builder::new().build())");
    const sources = readdirSync(join(tauriDir, "src"), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".rs"))
      .map((name) => ({ name, text: readFileSync(join(tauriDir, "src", name), "utf8") }));
    for (const { name, text } of sources) {
      for (const word of ["updater_builder", "UpdaterExt", "version_comparator", "default_version_comparator", "allow_downgrades"]) {
        expect(text.includes(word), `${name} uses ${word}`).toBe(false);
      }
    }
  });

  it("keeps the test's loosening in the test: the fixture overlay sets the key and the address, nothing else", () => {
    const fixtures = readFileSync(join(here, "../scripts/updater-signature-fixtures.mjs"), "utf8");
    expect(fixtures).toContain("plugins: { updater: { pubkey: trusted.pub, endpoints: [`${base}/latest.json`] } }");
    expect(fixtures).not.toMatch(/dangerous\w*\s*:/);
  });

  it("runs the signature test in the native smoke, which every release calls, and checks the release's signatures", () => {
    const smoke = readFileSync(join(repo, ".github/workflows/native-smoke.yml"), "utf8");
    expect(smoke).toContain("updater-signature:");
    expect(smoke).toContain("test:native:updater");
    expect(smoke).toContain("tauri.updater-test.conf.json");
    const release = readFileSync(join(repo, ".github/workflows/release.yml"), "utf8");
    expect(release).toContain("uses: ./.github/workflows/native-smoke.yml");
    // A manifest whose signatures do not name its version would strand every install (requireSignedVersion).
    const manifest = readFileSync(join(repo, ".github/workflows/updater-manifest.yml"), "utf8");
    expect(manifest).toContain('grep -qx "version:$version"');
  });
});
