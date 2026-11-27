/**
 * What a full WebDAV listing costs, asked with `allprop` and asked by name
 * (plan L7a), against the in-memory stand-in: bytes of the answer and the
 * time `pull` takes on this machine (request, parse, map), for 1 000,
 * 10 000 and 50 000 files. The stand-in's Nextcloud mode lists what a
 * Nextcloud `allprop` answer carries besides (content type, ids,
 * permissions, sizes, a folder's quota); a real server's answer differs in
 * detail and its own time is not measured here.
 *
 *   pnpm exec tsx scripts/perf/webdav-listing-bytes.ts
 */
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { byteExactDav } from "../../test/helpers/byteExactDav.js";

console.log = () => undefined;
const out = (line: string) => process.stdout.write(line + "\n");

function vault(files: number, nextcloudProps: boolean) {
  const dav = byteExactDav(undefined, { nextcloudProps });
  const perFolder = 20;
  for (let i = 0; i < files; i++) {
    const folder = `Area ${Math.floor(i / (perFolder * 10))}/Topic ${Math.floor(i / perFolder)}`;
    dav.folders.add(folder.split("/")[0]!);
    dav.folders.add(folder);
    dav.files.set(`${folder}/Note number ${i}.md`, { bytes: new TextEncoder().encode(`note ${i}\n`), etag: `e${i}x${(i * 2654435761) >>> 0}`, modified: Date.UTC(2026, 10, 1) + i * 1000 });
  }
  return dav;
}

async function measure(files: number, nextcloudProps: boolean, slim: boolean) {
  const dav = vault(files, nextcloudProps);
  let bytes = 0;
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, async (input, init) => {
    const res = await dav.fetch(input, init);
    const text = await res.text();
    bytes += new TextEncoder().encode(text).length;
    return new Response(text, { status: res.status });
  });
  target.slimListing = slim;
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    bytes = 0;
    const t0 = performance.now();
    await target.pull();
    times.push(performance.now() - t0);
  }
  return { bytes, ms: Math.min(...times) };
}

out("files | stand-in | allprop bytes | by name bytes | saved | allprop pull ms | by name pull ms");
for (const files of [1_000, 10_000, 50_000]) {
  for (const nextcloudProps of [false, true]) {
    const all = await measure(files, nextcloudProps, false);
    const named = await measure(files, nextcloudProps, true);
    const saved = Math.round((1 - named.bytes / all.bytes) * 100);
    out(`${files} | ${nextcloudProps ? "Nextcloud" : "plain"} | ${all.bytes} | ${named.bytes} | ${saved} % | ${all.ms.toFixed(1)} | ${named.ms.toFixed(1)}`);
  }
}

/**
 * Plan L7b: an idle vault on a server whose folder tags follow every change
 * (the stand-in's "subtree" tags, as Nextcloud and ownCloud have them). The
 * target first earns the trust from its own listings (edits, creations,
 * deletions and a folder, two levels down and at the deepest level), then
 * runs twelve idle cycles as the worker runs them: a probe of the vault
 * folder's tag each cycle, and a full listing after three cycles on the tag
 * alone. Requests and bytes per cycle, against a full listing every cycle.
 */
async function idleCycles(files: number) {
  const dav = byteExactDav(undefined, { nextcloudProps: true, folderTags: "subtree" });
  const seeded = vault(files, true);
  for (const f of seeded.folders) dav.folders.add(f);
  for (const [p, f] of seeded.files) dav.files.set(p, f);
  let bytes = 0;
  let requests = 0;
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, async (input, init) => {
    const res = await dav.fetch(input, init);
    const text = await res.text();
    requests++;
    bytes += new TextEncoder().encode(text).length;
    return new Response(text, { status: res.status });
  });
  const store = new Map<string, string>();
  target.useSyncMeta({ get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } });
  const deep = "Area 0/Topic 0";
  const steps: Array<() => void> = [
    () => dav.files.set(`${deep}/Note number 0.md`, { bytes: new Uint8Array([1]), etag: "w1", modified: 1 }),
    () => dav.files.set(`${deep}/fresh.md`, { bytes: new Uint8Array([2]), etag: "w2", modified: 2 }),
    () => dav.files.delete(`${deep}/fresh.md`),
    () => dav.folders.add(`${deep}/New`),
    () => dav.files.set(`${deep}/Note number 1.md`, { bytes: new Uint8Array([3]), etag: "w3", modified: 3 }),
  ];
  await target.pull();
  for (const step of steps) { step(); await target.pull(); }
  if ((await target.getStartCursor()) === "") throw new Error("the stand-in did not earn the shortcut");
  let cursorPulls = 0;
  bytes = 0;
  requests = 0;
  const CYCLES = 12;
  for (let i = 0; i < CYCLES; i++) {
    const wantsFull = await target.shouldListFully();
    if (wantsFull || cursorPulls >= target.fullListingCadence.cursorPullsBetween) {
      await target.pull();
      cursorPulls = 0;
    } else {
      await target.pull("webdav-root-tag");
      cursorPulls++;
    }
  }
  return { requests: requests / CYCLES, bytes: bytes / CYCLES };
}

out("");
out("L7b idle cycle | requests per cycle | bytes per cycle | a full listing every cycle (bytes)");
for (const files of [1_000, 10_000, 50_000]) {
  const idle = await idleCycles(files);
  const every = await measure(files, true, true);
  out(`${files} | ${idle.requests.toFixed(2)} | ${Math.round(idle.bytes)} | ${every.bytes}`);
}
