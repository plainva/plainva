import { beforeEach, describe, expect, it } from "vitest";
import { SLIM_LISTING_BODY, WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import type { PullResult } from "../../src/sync/ISyncTarget.js";
import { byteExactDav, type ByteExactDav, type ByteExactDavOptions } from "../helpers/byteExactDav.js";
import { device, world } from "../helpers/davDevice.js";

/**
 * Plan L7a: a full listing asks for the properties the sync reads, by name,
 * instead of everything (`allprop`). What the sync reads from it must be the
 * same as from `allprop` on every server — one that answers by name, one
 * that ignores the body, one that refuses it, fails on it, or answers it in
 * part — and nothing is ever built from a half answer: a file missing from a
 * listing is what mirrors a deletion.
 */

beforeEach(() => {
  expect.hasAssertions();
});

const NAMES = [
  "Inbox.md",
  "Notes/one.md",
  "Notes/Deep/two.md",
  "Notes/Deep/Deeper/three.md",
  "Notes/Neutralität.md",
  "Notes/Draft #1 & more.md",
  "Notes/x.CONFLICT.md",
  ".plainva/state.json",
  "Attachments/image.png",
];

function seed(dav: ByteExactDav, timed: boolean) {
  let n = 0;
  for (const name of NAMES) {
    const segments = name.split("/");
    for (let i = 1; i < segments.length; i++) dav.folders.add(segments.slice(0, i).join("/"));
    n++;
    dav.files.set(name, { bytes: new TextEncoder().encode(`${name}\n`), etag: `t${n}`, ...(timed ? { modified: Date.UTC(2026, 10, 1, 12, n) } : {}) });
  }
  dav.folders.add("Empty");
  dav.folders.add("Empty/Inside");
}

/** What `pull` hands the worker, in a form `toEqual` compares exactly. */
const view = (r: PullResult) => ({
  etags: [...r.etagMap].sort(),
  times: [...(r.mtimeMap ?? new Map())].sort(),
  folders: [...(r.folders ?? [])].sort(),
});

function target(dav: ByteExactDav, slim: boolean) {
  const t = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, (input, init) => dav.fetch(input, init));
  t.slimListing = slim;
  return t;
}

/** The PROPFIND requests a pull made: whether each named its properties. */
function recording(dav: ByteExactDav, depths: readonly string[] = ["infinity", "1"]) {
  const asked: Array<"named" | "allprop"> = [];
  const fetch = dav.fetch;
  dav.fetch = async (input, init) => {
    const depth = new Headers(init?.headers as HeadersInit | undefined).get("Depth") ?? "infinity";
    if ((init?.method ?? "GET").toUpperCase() === "PROPFIND" && depths.includes(depth)) asked.push(init?.body === SLIM_LISTING_BODY ? "named" : "allprop");
    return fetch(input, init);
  };
  return asked;
}

type Kind = { name: string; options: ByteExactDavOptions; timed: boolean };
const KINDS: Kind[] = [
  { name: "plain, with times", options: {}, timed: true },
  { name: "plain, without times", options: {}, timed: false },
  { name: "Nextcloud's allprop", options: { nextcloudProps: true }, timed: true },
  { name: "weak tags", options: { weakEtags: true }, timed: true },
  { name: "no infinite depth (Depth: 1 walk)", options: { refuseInfinity: true }, timed: true },
  { name: "Nextcloud's allprop, no infinite depth", options: { nextcloudProps: true, refuseInfinity: true }, timed: false },
];

const MODES: Array<{ mode: NonNullable<ByteExactDavOptions["propRequests"]>; usable: boolean }> = [
  { mode: "honor", usable: true },
  { mode: "ignore", usable: true },
  { mode: "refuse", usable: false },
  { mode: "unsupported", usable: false },
  { mode: "fail", usable: false },
  { mode: "garbage", usable: false },
  { mode: "dropEtag", usable: false },
  { mode: "etagNotFound", usable: false },
  { mode: "dropResourcetype", usable: false },
  { mode: "dropModified", usable: false },
];

describe("a full listing by name reads what allprop reads", () => {
  for (const kind of KINDS) {
    for (const { mode, usable } of MODES) {
      // A server that ignores the body and lists no times says nothing of them,
      // which is what a half answer says too: asked again without a body.
      const expectUsable = usable && !(mode === "ignore" && !kind.timed);
      it(`${kind.name}, a server that ${mode === "honor" ? "answers by name" : mode === "ignore" ? "ignores the body" : `answers "${mode}"`}`, async () => {
        const dav = byteExactDav(undefined, { ...kind.options, propRequests: mode });
        seed(dav, kind.timed);
        const asAllprop = view(await target(dav, false).pull());
        const asked = recording(dav);
        const slim = target(dav, true);
        const first = view(await slim.pull());
        expect(first).toEqual(asAllprop);
        // Without the .CONFLICT file; the Depth: 1 walk does not enter .plainva either.
        expect(first.etags.length).toBe(NAMES.length - (kind.options.refuseInfinity ? 2 : 1));
        expect(slim.slimListing).toBe(expectUsable);
        if (expectUsable) expect(asked.every((a) => a === "named")).toBe(true);
        else expect(asked).toContain("allprop");
        // The next pull asks by name only where the first could use it.
        asked.length = 0;
        expect(view(await slim.pull())).toEqual(asAllprop);
        expect(asked.every((a) => a === (expectUsable ? "named" : "allprop"))).toBe(true);
      });
    }
  }

  it("a server that is down fails the pull as before, and the next pull asks by name again", async () => {
    const dav = byteExactDav();
    seed(dav, true);
    const fetch = dav.fetch;
    let down = true;
    dav.fetch = async (input, init) => (down ? new Response("", { status: 503 }) : fetch(input, init));
    const slim = target(dav, true);
    await expect(slim.pull()).rejects.toThrow(/503/);
    expect(slim.slimListing).toBe(true);
    down = false;
    const asked = recording(dav);
    expect(view(await slim.pull())).toEqual(view(await target(dav, false).pull()));
    expect(asked[0]).toBe("named");
  }, 60_000);

  it("a vault folder that is gone is reported as before, by name or not", async () => {
    const dav = byteExactDav();
    dav.folders.clear();
    const slim = target(dav, true);
    slim.allowRootCreation = false;
    const old = target(dav, false);
    old.allowRootCreation = false;
    await expect(old.pull()).rejects.toThrow();
    await expect(slim.pull()).rejects.toThrow(/WebDAV server/);
  });

  it("is smaller than allprop where the server lists more", async () => {
    const dav = byteExactDav(undefined, { nextcloudProps: true });
    seed(dav, true);
    const sizes: number[] = [];
    const fetch = dav.fetch;
    dav.fetch = async (input, init) => {
      const res = await fetch(input, init);
      const text = await res.clone().text();
      sizes.push(text.length);
      return res;
    };
    await target(dav, false).pull();
    await target(dav, true).pull();
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 0.6);
  });
});

describe("two devices against a server that answers a listing by name in part", () => {
  for (const mode of ["dropEtag", "etagNotFound", "dropResourcetype", "garbage", "refuse"] as const) {
    it(`"${mode}": nothing is deleted on a half answer, and a deletion still arrives in one cycle`, async () => {
      const { dav } = world({ propRequests: mode, clock: () => Date.UTC(2026, 10, 1) });
      const a = await device(dav);
      const b = await device(dav);
      await a.put("Notes/Deep/a.md", "a\n");
      await a.put("Notes/b.md", "b\n");
      await a.put("c.md", "c\n");
      await a.cycle();
      await b.cycle();
      expect(await b.files()).toEqual(["Notes/Deep/a.md", "Notes/b.md", "c.md"]);
      for (let i = 0; i < 3; i++) await b.cycle();
      expect(await b.files()).toEqual(["Notes/Deep/a.md", "Notes/b.md", "c.md"]);
      expect([...dav.files.keys()].sort()).toEqual(["Notes/Deep/a.md", "Notes/b.md", "c.md"]);
      await a.remove("Notes/b.md");
      await a.cycle();
      await b.cycle();
      expect(await b.files()).toEqual(["Notes/Deep/a.md", "c.md"]);
    });
  }

  it("on a server that answers by name, a foreign edit, creation and deletion arrive in one cycle, every listing by name", async () => {
    const { dav } = world({ clock: () => Date.UTC(2026, 10, 1) });
    // The full listings only (a stat or a folder check asks for no list).
    const asked = recording(dav, ["infinity"]);
    const a = await device(dav);
    const b = await device(dav);
    await a.put("Notes/Deep/a.md", "a\n");
    await a.put("Notes/b.md", "b\n");
    await a.cycle();
    await b.cycle();
    await a.put("Notes/Deep/a.md", "a, edited\n");
    await a.put("Notes/Deep/new.md", "new\n");
    await a.remove("Notes/b.md");
    await a.cycle();
    await b.cycle();
    expect(await b.files()).toEqual(["Notes/Deep/a.md", "Notes/Deep/new.md"]);
    expect(await b.text("Notes/Deep/a.md")).toBe("a, edited\n");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((a) => a === "named")).toBe(true);
  });
});
