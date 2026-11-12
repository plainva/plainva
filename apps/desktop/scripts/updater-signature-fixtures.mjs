#!/usr/bin/env node
/**
 * Fixtures of the updater signature test (stability plan R11, finding S12;
 * docs/engineering/WebDriver_Smoke.md, "Updater signature test").
 *
 * Writes into one throwaway folder (argument 1, or PLAINVA_UPDATER_TEST_DIR):
 *
 *  - two minisign key pairs made for this run only — `trusted` (the app is
 *    built with its public key) and `foreign` (a key the app does not know).
 *    Neither is the release key, and the release key is never needed: this
 *    runs without any secret. The private keys stay in the folder and are
 *    never printed.
 *  - `tauri.updater-test.conf.json`, the build overlay: the trusted public key
 *    and ONE endpoint, `http://127.0.0.1:<port>/latest.json`. Nothing else —
 *    in particular no `dangerous…` flag: the test app is a debug build, where
 *    the plugin accepts a plain http endpoint with a warning; a release build
 *    refuses it (tauri-plugin-updater `validate_endpoints`), and the release
 *    configuration is held to https by `src/updaterTrust.test.ts`.
 *  - the update artefacts under `files/` and one manifest per case under
 *    `manifests/`, which `wdio.updater.conf.ts` serves.
 *
 * Signing goes through the Tauri CLI (`tauri signer sign`), the same signer a
 * release uses, with `--app-version` the way `tauri build` binds a signature
 * to its version.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const out = resolve(process.argv[2] || process.env.PLAINVA_UPDATER_TEST_DIR || "");
if (!process.argv[2] && !process.env.PLAINVA_UPDATER_TEST_DIR) {
  console.error("usage: node scripts/updater-signature-fixtures.mjs <folder>  (or PLAINVA_UPDATER_TEST_DIR)");
  process.exit(2);
}
const port = Number(process.env.PLAINVA_UPDATER_TEST_PORT || 1479);

/** The version the app under test runs as (the release config's). */
const current = JSON.parse(readFileSync(join(desktop, "src-tauri", "tauri.conf.json"), "utf8")).version;
const NEXT = "9.9.9";

// The folder is emptied before it is filled — only one this script made
// (it carries the marker) or an empty one, never a path that holds anything else.
const MARKER = ".plainva-updater-fixtures";
if (existsSync(out)) {
  const entries = readdirSync(out);
  if (entries.length && !entries.includes(MARKER)) {
    console.error(`refusing to empty ${out}: it is not empty and was not made by this script (no ${MARKER})`);
    process.exit(2);
  }
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(join(out, "files"), { recursive: true });
mkdirSync(join(out, "manifests"), { recursive: true });
writeFileSync(join(out, MARKER), "updater signature test fixtures; this folder is emptied on the next run\n");

const tauriCli = join(desktop, "node_modules", "@tauri-apps", "cli", "tauri.js");
/** The environment without any signing key a shell may carry: the test signs only with its own keys. */
function withoutReleaseKey(env) {
  const rest = { ...env };
  delete rest.TAURI_SIGNING_PRIVATE_KEY;
  delete rest.TAURI_SIGNING_PRIVATE_KEY_PATH;
  return rest;
}

/** The CLI, quiet: the generate command prints where the keys went, nothing of ours belongs in a log. */
function tauri(args) {
  execFileSync(process.execPath, [tauriCli, ...args], {
    cwd: desktop,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...withoutReleaseKey(process.env), CI: "true", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" },
  });
}

function keyPair(name) {
  const key = join(out, `${name}.key`);
  tauri(["signer", "generate", "--ci", "--password", "", "--write-keys", key]);
  return { key, pub: readFileSync(`${key}.pub`, "utf8").trim() };
}

/** Signs `file` and returns the value of a manifest's `signature` field. */
function sign(keyPairToUse, file, version) {
  tauri(["signer", "sign", "--private-key-path", keyPairToUse.key, ...(version ? ["--app-version", version] : []), file]);
  const signature = readFileSync(`${file}.sig`, "utf8").trim();
  rmSync(`${file}.sig`);
  return signature;
}

const trusted = keyPair("trusted");
const foreign = keyPair("foreign");
if (trusted.pub === foreign.pub) throw new Error("the two test keys came out the same");

// The artefact: bytes, nothing that could run. The updater checks bytes; what
// an installer would do with them comes after the check and is not reached.
const artefact = join(out, "files", "Plainva_update.bin");
const bytes = randomBytes(256 * 1024);
writeFileSync(artefact, bytes);
// The same file with one byte changed, in the middle.
const tampered = Buffer.from(bytes);
tampered[tampered.length >> 1] ^= 0x01;
writeFileSync(join(out, "files", "Plainva_update-tampered.bin"), tampered);
// A second, genuine file signed with the trusted key: its signature is valid — for another file.
const other = join(out, "files", "Plainva_other.bin");
writeFileSync(other, randomBytes(64 * 1024));

const signatures = {
  valid: sign(trusted, artefact, NEXT),
  foreign: sign(foreign, artefact, NEXT),
  otherFile: sign(trusted, other, NEXT),
  olderRelease: sign(trusted, artefact, "9.9.8"),
  unversioned: sign(trusted, artefact, null),
  downgrade: sign(trusted, artefact, "0.0.1"),
  same: sign(trusted, artefact, current),
};

const base = `http://127.0.0.1:${port}`;
/** Every platform key the updater may look up, all pointing at the same file. */
function platforms(file, signature) {
  const entry = { url: `${base}/files/${file}`, signature };
  const keys = {};
  for (const [os, suffixes] of [
    ["linux", ["", "-appimage", "-deb", "-rpm"]],
    ["windows", ["", "-nsis", "-msi"]],
    ["darwin", ["", "-app"]],
  ]) {
    for (const arch of ["x86_64", "aarch64", "i686", "armv7"]) {
      for (const suffix of suffixes) keys[`${os}-${arch}${suffix}`] = entry;
    }
  }
  return keys;
}
function manifest(name, version, file, signature) {
  writeFileSync(
    join(out, "manifests", `${name}.json`),
    JSON.stringify({ version, notes: `updater signature test: ${name}`, pub_date: "2026-11-11T00:00:00Z", platforms: platforms(file, signature) }, null, 2),
  );
}

manifest("a-valid", NEXT, "Plainva_update.bin", signatures.valid);
manifest("b-tampered", NEXT, "Plainva_update-tampered.bin", signatures.valid);
manifest("c-foreign-key", NEXT, "Plainva_update.bin", signatures.foreign);
manifest("d-other-file-signature", NEXT, "Plainva_update.bin", signatures.otherFile);
manifest("e-downgrade", "0.0.1", "Plainva_update.bin", signatures.downgrade);
manifest("e-same-version", current, "Plainva_update.bin", signatures.same);
manifest("f-older-release-as-new", NEXT, "Plainva_update.bin", signatures.olderRelease);
manifest("g-unversioned-signature", NEXT, "Plainva_update.bin", signatures.unversioned);

writeFileSync(
  join(out, "tauri.updater-test.conf.json"),
  JSON.stringify({ plugins: { updater: { pubkey: trusted.pub, endpoints: [`${base}/latest.json`] } } }, null, 2),
);
writeFileSync(join(out, "fixture.json"), JSON.stringify({ port, current, next: NEXT }, null, 2));

console.log(`updater test fixtures in ${out}: app version ${current}, offered ${NEXT}, endpoint ${base}/latest.json`);
