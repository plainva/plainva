// TestFlight feedback, read from App Store Connect.
//
// Testers send feedback from the TestFlight app (a screenshot with a comment)
// or automatically when the app crashes. App Store Connect exposes both as
// `betaFeedbackScreenshotSubmissions` and `betaFeedbackCrashSubmissions`;
// this script lists them so feedback can be read and triaged from the
// terminal — without the App Store Connect website.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=…/AuthKey_X.p8 \
//   node apps/mobile/scripts/testflight-feedback.mjs [options]
//
//     --since <YYYY-MM-DD>   only feedback created on or after that day (UTC)
//     --build <version>      only feedback for that build number (CFBundleVersion)
//     --limit <n>            at most n items per kind (default 50, max 200)
//     --json                 print the raw items as JSON instead of the summary
//     --download <dir>       save screenshots and crash logs into <dir>
//
// Screenshot URLs App Store Connect hands out expire within minutes, so the
// script downloads them right away when `--download` is set; the listing
// itself never prints them.
//
// Auth: App Store Connect API, ES256 JWT signed with the team's .p8 key — the
// same key `ios.yml` and `testflight-what-to-test.mjs` use. Reads only.

import { createPrivateKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.appstoreconnect.apple.com/v1";
const BUNDLE_ID = "com.plainva.app";

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

async function get(jwt, path) {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail}`).join("; ") ?? res.statusText;
    throw new Error(`GET ${path} -> ${res.status} ${detail}`);
  }
  return json;
}

/** Follows `links.next` so a listing is complete up to `limit` items. */
async function list(jwt, path, limit) {
  const items = [];
  const included = [];
  let next = path;
  while (next && items.length < limit) {
    const page = await get(jwt, next);
    items.push(...(page.data ?? []));
    included.push(...(page.included ?? []));
    next = page.links?.next ?? null;
  }
  return { items: items.slice(0, limit), included };
}

function parseArgs(argv) {
  const opts = { since: null, build: null, limit: 50, json: false, download: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--since") opts.since = value();
    else if (a === "--build") opts.build = value();
    else if (a === "--limit") opts.limit = Math.min(200, Math.max(1, Number(value()) || 50));
    else if (a === "--json") opts.json = true;
    else if (a === "--download") opts.download = value();
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.since && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) throw new Error("--since expects YYYY-MM-DD");
  return opts;
}

function query(kind, appId, opts) {
  const p = new URLSearchParams();
  p.set("sort", "-createdDate");
  p.set("limit", String(Math.min(opts.limit, 200)));
  p.set("include", "build");
  p.set("fields[builds]", "version,uploadedDate");
  if (opts.build) {
    // filter[build] wants the build id; resolved by the caller into opts.buildId.
    p.set("filter[build]", opts.buildId);
  }
  return `/apps/${appId}/${kind}?${p.toString()}`;
}

/** build id -> build number, from the `included` documents of a listing. */
function buildIndex(included) {
  const idx = new Map();
  for (const doc of included) if (doc.type === "builds") idx.set(doc.id, doc.attributes?.version ?? "?");
  return idx;
}

function buildOf(item, idx) {
  const id = item.relationships?.build?.data?.id;
  return id ? (idx.get(id) ?? id) : "?";
}

function fmtDate(iso) {
  return iso ? iso.replace("T", " ").replace(/\.\d+Z$/, "Z") : "?";
}

function line(item, idx, kind) {
  const a = item.attributes ?? {};
  const head = `${fmtDate(a.createdDate)}  build ${buildOf(item, idx)}  ${a.deviceModel ?? "?"} / ${a.devicePlatform ?? "?"} ${a.osVersion ?? "?"}  ${a.locale ?? ""}`;
  const who = a.email ? `  from ${a.email}` : "";
  const extra =
    kind === "screenshots"
      ? `  screenshots: ${(a.screenshots ?? []).length}`
      : `  crash log: ${a.crashLog?.url || item.relationships?.crashLog ? "yes" : "no"}`;
  const comment = (a.comment ?? "").trim();
  return [`- [${item.id}] ${head}${who}${extra}`, comment ? `  > ${comment.replace(/\r?\n/g, "\n  > ")}` : "  > (no comment)"].join("\n");
}

async function download(url, target) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${target}: ${res.status}`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const auth = { keyId: process.env.ASC_KEY_ID, issuerId: process.env.ASC_ISSUER_ID, keyPath: process.env.ASC_KEY_PATH };
  if (!auth.keyId || !auth.issuerId || !auth.keyPath) {
    console.error("usage: ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH node testflight-feedback.mjs [--since YYYY-MM-DD] [--build N] [--limit N] [--json] [--download <dir>]");
    process.exit(2);
  }

  const jwt = token(auth);
  const apps = await get(jwt, `/apps?filter[bundleId]=${BUNDLE_ID}`);
  const appId = apps?.data?.[0]?.id;
  if (!appId) throw new Error(`no app with bundle id ${BUNDLE_ID}`);

  if (opts.build) {
    const res = await get(jwt, `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(opts.build)}&sort=-uploadedDate&limit=1`);
    const b = res?.data?.[0];
    if (!b) throw new Error(`no build with number ${opts.build}`);
    opts.buildId = b.id;
  }

  const sinceMs = opts.since ? Date.parse(`${opts.since}T00:00:00Z`) : null;
  const after = (item) => !sinceMs || Date.parse(item.attributes?.createdDate ?? 0) >= sinceMs;

  const shots = await list(jwt, query("betaFeedbackScreenshotSubmissions", appId, opts), opts.limit);
  const crashes = await list(jwt, query("betaFeedbackCrashSubmissions", appId, opts), opts.limit);
  const idx = buildIndex([...shots.included, ...crashes.included]);
  const screenshotItems = shots.items.filter(after);
  const crashItems = crashes.items.filter(after);

  if (opts.json) {
    const withBuild = (item) => ({ ...item, buildNumber: buildOf(item, idx) });
    console.log(JSON.stringify({ screenshots: screenshotItems.map(withBuild), crashes: crashItems.map(withBuild) }, null, 2));
  } else {
    const scope = [opts.since ? `since ${opts.since}` : null, opts.build ? `build ${opts.build}` : null].filter(Boolean).join(", ");
    console.log(`TestFlight feedback for ${BUNDLE_ID}${scope ? ` (${scope})` : ""}`);
    console.log(`\nScreenshot feedback: ${screenshotItems.length}${shots.items.length >= opts.limit ? ` (first ${opts.limit})` : ""}`);
    for (const item of screenshotItems) console.log(line(item, idx, "screenshots"));
    console.log(`\nCrash feedback: ${crashItems.length}${crashes.items.length >= opts.limit ? ` (first ${opts.limit})` : ""}`);
    for (const item of crashItems) console.log(line(item, idx, "crashes"));
  }

  if (opts.download) {
    mkdirSync(opts.download, { recursive: true });
    let n = 0;
    for (const item of screenshotItems) {
      const shotsOf = item.attributes?.screenshots ?? [];
      for (let i = 0; i < shotsOf.length; i++) {
        const s = shotsOf[i];
        if (!s?.url) continue;
        const ext = /\.(png|jpe?g|heic)(\?|$)/i.exec(s.url)?.[1]?.toLowerCase() ?? "png";
        const name = `${(item.attributes.createdDate ?? "").slice(0, 10)}_build${buildOf(item, idx)}_${item.id}_${i + 1}.${ext}`;
        await download(s.url, join(opts.download, name));
        n++;
      }
    }
    for (const item of crashItems) {
      // The crash log is a separate document with a short-lived URL.
      const log = await get(jwt, `/betaFeedbackCrashSubmissions/${item.id}/crashLog`).catch(() => null);
      const url = log?.data?.attributes?.url;
      if (!url) continue;
      const name = `${(item.attributes.createdDate ?? "").slice(0, 10)}_build${buildOf(item, idx)}_${item.id}.crash`;
      await download(url, join(opts.download, name));
      n++;
    }
    console.error(`\nsaved ${n} file(s) to ${opts.download}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
