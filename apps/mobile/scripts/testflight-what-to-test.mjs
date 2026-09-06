// "What to Test" for a TestFlight build, from the store notes.
//
// After `xcodebuild -exportArchive` has uploaded the build, App Store Connect
// processes it for a few minutes; only then does the build exist as an API
// object whose `betaBuildLocalizations` carry the "What to Test" text. This
// script waits for that, then writes one localisation per language from the
// files `store-whatsnew.mjs` produced — the same titles the app's What's New
// dialog shows, so testers read on the install screen what they will meet
// after the update.
//
//   BUILD_NUMBER=<CURRENT_PROJECT_VERSION> \
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=…/AuthKey_X.p8 \
//   node apps/mobile/scripts/testflight-what-to-test.mjs <whatsnew-dir> [--public-group]
//
// `--public-group` additionally adds the build to every beta group that has a
// public link enabled. That is deliberately opt-in: an interim build exists
// for the maintainer's devices, and the public group should see a build
// somebody chose to give it.
//
// Auth: App Store Connect API, ES256 JWT signed with the team's .p8 key — the
// same key `ios.yml` already holds for the upload. No dependency beyond node.

import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.appstoreconnect.apple.com/v1";
const BUNDLE_ID = "com.plainva.app";

/** Play locale (file suffix from store-whatsnew.mjs) -> App Store Connect locale. */
const ASC_LOCALES = {
  "en-US": "en-US",
  "de-DE": "de-DE",
  "es-ES": "es-ES",
  "fr-FR": "fr-FR",
  "it-IT": "it",
  "ja-JP": "ja",
  "nl-NL": "nl-NL",
  "pl-PL": "pl",
  "pt-BR": "pt-BR",
  "zh-CN": "zh-Hans",
};

/** The 20-minute JWT App Store Connect accepts (max is 20). */
function token({ keyId, issuerId, keyPath }) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
  const body = b64({ iss: issuerId, iat: now, exp: now + 19 * 60, aud: "appstoreconnect-v1" });
  const key = createPrivateKey(readFileSync(keyPath, "utf8"));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

async function call(jwt, method, path, body) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail}`).join("; ") ?? res.statusText;
    throw new Error(`${method} ${path} -> ${res.status} ${detail}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = process.argv[2];
  const publicGroup = process.argv.includes("--public-group");
  const buildNumber = process.env.BUILD_NUMBER;
  const auth = { keyId: process.env.ASC_KEY_ID, issuerId: process.env.ASC_ISSUER_ID, keyPath: process.env.ASC_KEY_PATH };
  if (!dir || !buildNumber || !auth.keyId || !auth.issuerId || !auth.keyPath) {
    console.error("usage: BUILD_NUMBER ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH node testflight-what-to-test.mjs <whatsnew-dir> [--public-group]");
    process.exit(2);
  }

  const notes = {};
  for (const file of readdirSync(dir)) {
    const m = /^whatsnew-(.+)$/.exec(file);
    const locale = m && ASC_LOCALES[m[1]];
    if (locale) notes[locale] = readFileSync(join(dir, file), "utf8").trim();
  }
  if (Object.keys(notes).length === 0) throw new Error(`${dir}: no whatsnew-* files`);

  let jwt = token(auth);
  const apps = await call(jwt, "GET", `/apps?filter[bundleId]=${BUNDLE_ID}`);
  const appId = apps?.data?.[0]?.id;
  if (!appId) throw new Error(`no app with bundle id ${BUNDLE_ID}`);

  // Processing usually takes 5–15 minutes; give it 40 and re-mint the token
  // on the way, since it is only good for 20.
  const deadline = Date.now() + 40 * 60 * 1000;
  let build = null;
  while (Date.now() < deadline) {
    jwt = token(auth);
    const res = await call(
      jwt,
      "GET",
      `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}&sort=-uploadedDate&limit=1`,
    );
    const b = res?.data?.[0];
    if (b && b.attributes?.processingState === "VALID") {
      build = b;
      break;
    }
    if (b && ["FAILED", "INVALID"].includes(b.attributes?.processingState)) {
      throw new Error(`build ${buildNumber} is ${b.attributes.processingState}`);
    }
    console.log(`build ${buildNumber}: ${b ? b.attributes?.processingState : "not visible yet"} — waiting`);
    await sleep(60 * 1000);
  }
  if (!build) throw new Error(`build ${buildNumber} was not processed within 40 minutes`);

  // One localisation per language: update the ones App Store Connect created
  // (it seeds the primary locale), create the rest.
  const existing = await call(jwt, "GET", `/builds/${build.id}/betaBuildLocalizations`);
  const byLocale = new Map((existing?.data ?? []).map((l) => [l.attributes.locale, l.id]));
  for (const [locale, whatsNew] of Object.entries(notes)) {
    const id = byLocale.get(locale);
    if (id) {
      await call(jwt, "PATCH", `/betaBuildLocalizations/${id}`, {
        data: { type: "betaBuildLocalizations", id, attributes: { whatsNew } },
      });
    } else {
      await call(jwt, "POST", `/betaBuildLocalizations`, {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale, whatsNew },
          relationships: { build: { data: { type: "builds", id: build.id } } },
        },
      });
    }
    console.log(`what to test: ${locale} (${[...whatsNew].length} chars)`);
  }

  if (publicGroup) {
    const groups = await call(jwt, "GET", `/betaGroups?filter[app]=${appId}&filter[isInternalGroup]=false`);
    const targets = (groups?.data ?? []).filter((g) => g.attributes?.publicLinkEnabled);
    for (const g of targets) {
      await call(jwt, "POST", `/betaGroups/${g.id}/relationships/builds`, {
        data: [{ type: "builds", id: build.id }],
      });
      console.log(`added build ${buildNumber} to the public group "${g.attributes.name}"`);
    }
    if (targets.length === 0) console.log("no beta group with a public link — nothing added");
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
