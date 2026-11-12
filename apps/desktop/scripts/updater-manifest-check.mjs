#!/usr/bin/env node
/**
 * Checks a release's `latest.json` before it goes to the fixed address every
 * desktop install reads (`.github/workflows/updater-manifest.yml`; stability
 * plan R11). A manifest that passes here is one the installs will accept:
 *
 *  - it names the release's version;
 *  - it carries exactly the expected platforms (`EXPECTED_PLATFORMS_BY_RUNNER`,
 *    one group per leg of release.yml's build matrix — `updaterTrust.test.ts`
 *    holds the two together), so a draft published after a failed leg does
 *    not strand that leg's installs on a missing entry, and an unknown entry
 *    does not pass unseen;
 *  - every URL points at a release asset over https, never at the `latest` label;
 *  - every signature is made with the key in `src-tauri/tauri.conf.json`: its
 *    key id matches and its GLOBAL signature (over the signature bytes and the
 *    trusted comment) verifies — a manifest signed with a wrong or rotated key
 *    would be refused by every install;
 *  - every signature names this version in its trusted comment, which the app
 *    requires (`requireSignedVersion`).
 *
 * The signature is parsed the way the app's updater does (tauri-plugin-updater
 * 2.13 with minisign-verify 0.2): base64 text, lines split as Rust's
 * `str::lines` does (a trailing `\r` dropped), the trusted comment's
 * tab-separated fields searched for the first `version:` wherever it stands,
 * and versions compared as semver after a leading `v`, literally otherwise.
 * The file signature itself needs the artefact and is checked by the app; the
 * updater signature test proves that (`wdio/updater-signature.e2e.ts`).
 *
 * CLI: `node scripts/updater-manifest-check.mjs <latest.json> <version>`
 */
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The manifest's platform keys, by the leg of release.yml's build matrix that produces them. */
export const EXPECTED_PLATFORMS_BY_RUNNER = {
  "macos-latest": ["darwin-aarch64", "darwin-aarch64-app", "darwin-universal", "darwin-universal-app", "darwin-x86_64", "darwin-x86_64-app"],
  "ubuntu-22.04": ["linux-x86_64", "linux-x86_64-appimage", "linux-x86_64-deb", "linux-x86_64-rpm"],
  "windows-latest": ["windows-x86_64", "windows-x86_64-msi", "windows-x86_64-nsis"],
};
export const EXPECTED_PLATFORMS = Object.values(EXPECTED_PLATFORMS_BY_RUNNER).flat().sort();

/** Rust's `str::lines`: split at `\n`, drop one trailing `\r`, no final empty line. */
function rustLines(text) {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function decodeBase64Text(value, what) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.trim())) throw new Error(`${what} is no base64`);
  return Buffer.from(value.trim(), "base64").toString("utf8");
}

/** The public key of a `pubkey` value (base64 of a minisign `.pub` file): its key id and an Ed25519 key. */
export function decodePublicKey(pubkey) {
  const lines = rustLines(decodeBase64Text(pubkey, "the public key"));
  const bin = Buffer.from(lines[1] ?? "", "base64");
  if (bin.length !== 42 || bin.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("the public key is no minisign Ed25519 key");
  return {
    keyId: Buffer.from(bin.subarray(2, 10)),
    key: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: bin.subarray(10).toString("base64url") }, format: "jwk" }),
  };
}

/** A manifest `signature` value, parsed as minisign-verify's `Signature::decode` does. */
export function decodeSignature(signature) {
  const lines = rustLines(decodeBase64Text(signature, "the signature"));
  if (lines.length < 4) throw new Error("the signature has fewer than four lines");
  const bin = Buffer.from(lines[1], "base64");
  if (bin.length !== 74) throw new Error("the signature line has the wrong length");
  const algorithm = bin.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") throw new Error(`unknown signature algorithm ${JSON.stringify(algorithm)}`);
  if (!lines[2].startsWith("trusted comment: ")) throw new Error("the signature has no trusted comment");
  const globalSignature = Buffer.from(lines[3], "base64");
  if (globalSignature.length !== 64) throw new Error("the global signature has the wrong length");
  return { keyId: Buffer.from(bin.subarray(2, 10)), signature: Buffer.from(bin.subarray(10)), trustedComment: lines[2].slice("trusted comment: ".length), globalSignature };
}

/** The plugin's `signed_version`: the first tab-separated field that starts with `version:`. */
export function signedVersion(trustedComment) {
  const field = trustedComment.split("\t").find((part) => part.startsWith("version:"));
  return field === undefined ? null : field.slice("version:".length);
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** The plugin's comparison: semver after a leading `v` when both parse, else the literal strings. */
export function sameVersion(signed, announced) {
  const a = signed.replace(/^v/, "");
  const b = announced.replace(/^v/, "");
  return SEMVER.test(a) && SEMVER.test(b) ? a === b : signed === announced;
}

/**
 * Every problem of a manifest, as sentences; an empty list means it passes.
 * `pubkey` is the `plugins.updater.pubkey` value, `version` the release's.
 */
export function checkUpdaterManifest(manifest, { pubkey, version, expectedPlatforms = EXPECTED_PLATFORMS }) {
  const problems = [];
  const key = decodePublicKey(pubkey);
  if (!manifest || typeof manifest !== "object") return ["the manifest is no JSON object"];
  if (String(manifest.version ?? "").replace(/^v/, "") !== version.replace(/^v/, "")) problems.push(`the manifest says version ${manifest.version} but the release is ${version}`);
  const platforms = manifest.platforms && typeof manifest.platforms === "object" ? manifest.platforms : {};
  const present = Object.keys(platforms);
  for (const name of expectedPlatforms) if (!present.includes(name)) problems.push(`platform ${name} is missing`);
  for (const name of present) if (!expectedPlatforms.includes(name)) problems.push(`platform ${name} is not expected`);
  for (const [name, entry] of Object.entries(platforms)) {
    const url = typeof entry?.url === "string" ? entry.url : "";
    if (!url.startsWith("https://")) problems.push(`${name}: the URL is not https (${url || "none"})`);
    if (url.includes("/releases/latest/")) problems.push(`${name}: the URL depends on the 'latest' label`);
    let sig;
    try {
      sig = decodeSignature(entry?.signature);
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!sig.keyId.equals(key.keyId)) {
      problems.push(`${name}: signed with another key (key id ${Buffer.from(sig.keyId).reverse().toString("hex").toUpperCase()})`);
      continue;
    }
    if (!verify(null, Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, "utf8")]), key.key, sig.globalSignature)) {
      problems.push(`${name}: the trusted comment's signature does not verify against the app's key`);
      continue;
    }
    const signed = signedVersion(sig.trustedComment);
    if (signed === null) problems.push(`${name}: the signature names no version`);
    else if (!sameVersion(signed, version)) problems.push(`${name}: the signature is bound to version ${signed}, not ${version}`);
  }
  return problems;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, version] = process.argv.slice(2);
  if (!file || !version) {
    console.error("usage: node scripts/updater-manifest-check.mjs <latest.json> <version>");
    process.exit(2);
  }
  const pubkey = JSON.parse(readFileSync(resolve(here, "../src-tauri/tauri.conf.json"), "utf8")).plugins.updater.pubkey;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const problems = checkUpdaterManifest(manifest, { pubkey, version });
  if (problems.length) {
    for (const problem of problems) console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`Manifest for ${version}: ${EXPECTED_PLATFORMS.length} platforms, every signature made with the app's key and bound to ${version}.`);
}
