// The manifest check of updater-manifest.yml (stability plan R11): what it
// lets through to the fixed address is what every install will accept.
// The live manifest of 0.8.7 (public data, recorded 2026-11-11) must pass;
// the other cases are built with a key made here and read the way the app's
// updater reads them (tauri-plugin-updater 2.13, minisign-verify 0.2).
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_PLATFORMS, checkUpdaterManifest, sameVersion, signedVersion } from "../scripts/updater-manifest-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const releasePubkey = (JSON.parse(readFileSync(resolve(here, "../src-tauri/tauri.conf.json"), "utf8")) as { plugins: { updater: { pubkey: string } } }).plugins.updater.pubkey;
const live = JSON.parse(readFileSync(resolve(here, "../scripts/testdata/updater-latest-0.8.7.json"), "utf8")) as { version: string; platforms: Record<string, { url: string; signature: string }> };

/** A minisign key pair in the shape Tauri stores: the pubkey value, and a signer for manifest entries. */
function testKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  const pubFile = `untrusted comment: minisign public key: ${Buffer.from(keyId).reverse().toString("hex").toUpperCase()}\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`;
  const entry = (trustedComment: string, { eol = "\n", keyIdOverride, tamper }: { eol?: string; keyIdOverride?: Buffer; tamper?: boolean } = {}) => {
    const fileSignature = sign(null, randomBytes(32), privateKey);
    const global = sign(null, Buffer.concat([fileSignature, Buffer.from(trustedComment)]), privateKey);
    const shown = tamper ? trustedComment.replace("9.9.9", "9.9.8") : trustedComment;
    const text = [`untrusted comment: signature from tauri secret key`, Buffer.concat([Buffer.from("ED"), keyIdOverride ?? keyId, fileSignature]).toString("base64"), `trusted comment: ${shown}`, global.toString("base64"), ""].join(eol);
    return Buffer.from(text).toString("base64");
  };
  return { pubkey: Buffer.from(pubFile).toString("base64"), entry };
}

function manifestFor(version: string, signature: (platform: string) => string, platforms = EXPECTED_PLATFORMS) {
  return {
    version,
    platforms: Object.fromEntries(platforms.map((p) => [p, { url: `https://api.github.com/repos/plainva/plainva/releases/assets/${p}`, signature: signature(p) }])),
  };
}

const comment = (version: string) => `timestamp:1793787876\tfile:Plainva_${version}_x64-setup.exe\tversion:${version}`;

describe("the updater manifest check (R11)", () => {
  it("passes the live manifest of 0.8.7 against the app's key", () => {
    expect(checkUpdaterManifest(live, { pubkey: releasePubkey, version: "0.8.7" })).toEqual([]);
    expect(Object.keys(live.platforms).sort()).toEqual(EXPECTED_PLATFORMS);
  });

  it("refuses the live manifest for another release, and against another key", () => {
    expect(checkUpdaterManifest(live, { pubkey: releasePubkey, version: "0.8.8" })).toContain("the manifest says version 0.8.7 but the release is 0.8.8");
    const other = testKey();
    const problems = checkUpdaterManifest(live, { pubkey: other.pubkey, version: "0.8.7" });
    expect(problems).toHaveLength(EXPECTED_PLATFORMS.length);
    expect(problems.every((p) => p.includes("signed with another key"))).toBe(true);
  });

  it("passes a manifest whose every entry is signed with the key and bound to the version", () => {
    const key = testKey();
    expect(checkUpdaterManifest(manifestFor("9.9.9", () => key.entry(comment("9.9.9"))), { pubkey: key.pubkey, version: "9.9.9" })).toEqual([]);
  });

  it("refuses one entry signed with another key", () => {
    const key = testKey();
    const foreign = testKey();
    const m = manifestFor("9.9.9", (p) => (p === "windows-x86_64-nsis" ? foreign.entry(comment("9.9.9")) : key.entry(comment("9.9.9"))));
    expect(checkUpdaterManifest(m, { pubkey: key.pubkey, version: "9.9.9" })).toEqual([expect.stringMatching(/^windows-x86_64-nsis: signed with another key/)]);
  });

  it("refuses an entry whose key id is ours but whose comment was not signed by us", () => {
    const key = testKey();
    const m = manifestFor("9.9.9", (p) => key.entry(comment("9.9.9"), { tamper: p === "linux-x86_64" }));
    expect(checkUpdaterManifest(m, { pubkey: key.pubkey, version: "9.9.9" })).toEqual(["linux-x86_64: the trusted comment's signature does not verify against the app's key"]);
  });

  it("refuses an entry without a version and one bound to another version", () => {
    const key = testKey();
    const m = manifestFor("9.9.9", (p) =>
      p === "darwin-aarch64" ? key.entry("timestamp:1\tfile:Plainva.app.tar.gz") : p === "darwin-x86_64" ? key.entry(comment("9.9.8")) : key.entry(comment("9.9.9")),
    );
    expect(checkUpdaterManifest(m, { pubkey: key.pubkey, version: "9.9.9" }).sort()).toEqual([
      "darwin-aarch64: the signature names no version",
      "darwin-x86_64: the signature is bound to version 9.9.8, not 9.9.9",
    ]);
  });

  it("reads CRLF lines and a version in the first field as the app does", () => {
    const key = testKey();
    const m = manifestFor("9.9.9", (p) => (p === "linux-x86_64" ? key.entry(comment("9.9.9"), { eol: "\r\n" }) : key.entry(`version:9.9.9\ttimestamp:1\tfile:x`)));
    expect(checkUpdaterManifest(m, { pubkey: key.pubkey, version: "9.9.9" })).toEqual([]);
    expect(signedVersion("version:1.2.3\tfile:x")).toBe("1.2.3");
    expect(signedVersion("file:x\tversion:1.2.3\tversion:9")).toBe("1.2.3");
    expect(sameVersion("v1.2.3", "1.2.3")).toBe(true);
    expect(sameVersion("1.2", "v1.2")).toBe(false);
  });

  it("refuses a missing, an empty and an unexpected platform map", () => {
    const key = testKey();
    const partial = manifestFor("9.9.9", () => key.entry(comment("9.9.9")), EXPECTED_PLATFORMS.filter((p) => !p.startsWith("windows")));
    expect(checkUpdaterManifest(partial, { pubkey: key.pubkey, version: "9.9.9" })).toEqual(["platform windows-x86_64 is missing", "platform windows-x86_64-msi is missing", "platform windows-x86_64-nsis is missing"]);
    expect(checkUpdaterManifest({ version: "9.9.9", platforms: {} }, { pubkey: key.pubkey, version: "9.9.9" })).toHaveLength(EXPECTED_PLATFORMS.length);
    expect(checkUpdaterManifest({ version: "9.9.9" }, { pubkey: key.pubkey, version: "9.9.9" })).toHaveLength(EXPECTED_PLATFORMS.length);
    const extra = manifestFor("9.9.9", () => key.entry(comment("9.9.9")), [...EXPECTED_PLATFORMS, "linux-aarch64"]);
    expect(checkUpdaterManifest(extra, { pubkey: key.pubkey, version: "9.9.9" })).toEqual(["platform linux-aarch64 is not expected"]);
  });

  it("refuses a URL on the `latest` label or without https, and a signature that is no base64", () => {
    const key = testKey();
    const m = manifestFor("9.9.9", () => key.entry(comment("9.9.9")));
    m.platforms["linux-x86_64"].url = "https://github.com/plainva/plainva/releases/latest/download/x.AppImage";
    m.platforms["linux-x86_64-deb"].url = "http://example.org/x.deb";
    m.platforms["linux-x86_64-rpm"].signature = "not base64!";
    expect(checkUpdaterManifest(m, { pubkey: key.pubkey, version: "9.9.9" })).toEqual([
      "linux-x86_64: the URL depends on the 'latest' label",
      "linux-x86_64-deb: the URL is not https (http://example.org/x.deb)",
      "linux-x86_64-rpm: the signature is no base64",
    ]);
  });
});
