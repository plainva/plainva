// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalDavPimTarget, type FetchFn } from "@plainva/core";
import { createProviderTask, toast } from "@plainva/ui";

/**
 * "Send to list" tried three times (issue 119): the first try lands and its
 * answer is lost, the second never goes out (offline), the third goes out.
 * What stands at the provider can only be what a try sent - so the memory of
 * a create keeps every version, never only the last (P1, P2), and a later try
 * that cannot read what stands at its address leaves it and creates anew (P3).
 * The person is told nothing that the provider then contradicts. Invented
 * data only.
 */

const LIST = "https://dav.example.org/cal/home/tasks/";

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

function dav(getLagMs = 0) {
  const objects = new Map<string, { text: string; etag: string; at: number }>();
  let rev = 0;
  let lose = true;
  let offline = false;
  let now = 0;
  const puts: string[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    if (offline) {
      offline = false;
      throw new TypeError("Failed to fetch (offline)");
    }
    const url = String(input);
    const method = init?.method ?? "GET";
    const held = objects.get(url);
    const visible = !!held && now >= held.at + getLagMs;
    if (method === "PUT") {
      const tag = headerOf(init, "If-Match") ? "If-Match" : headerOf(init, "If-None-Match") ? "If-None-Match" : "none";
      if (headerOf(init, "If-None-Match") === "*" && held) return puts.push(`${tag} 412`), new Response(null, { status: 412 });
      const im = headerOf(init, "If-Match");
      if (im && (!visible || held!.etag !== im)) return puts.push(`${tag} 412`), new Response(null, { status: 412 });
      rev += 1;
      objects.set(url, { text: String(init?.body), etag: `"r${rev}"`, at: held?.at ?? now });
      if (lose) {
        lose = false;
        puts.push(`${tag} stored, answer lost`);
        throw new TypeError("network connection was lost");
      }
      puts.push(`${tag} ${held ? 204 : 201}`);
      return new Response(null, { status: held ? 204 : 201 });
    }
    if (method === "GET") return visible ? new Response(held!.text, { status: 200, headers: { ETag: held!.etag } }) : new Response("Not Found", { status: 404 });
    if (method === "REPORT") return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`, { status: 207 });
    return new Response(null, { status: 405 });
  };
  return {
    objects,
    puts,
    goOffline: () => void (offline = true),
    advance: (ms: number) => void (now += ms),
    target: new CalDavPimTarget({ url: "https://dav.example.org/cal/home/", user: "u", pass: "p" }, fetchFn, async (ms) => void (now += ms)),
  };
}

function vault() {
  const files = new Map<string, string>([["T/paint.md", "---\ntitle: paint\n---\n"]]);
  return {
    readFile: async (p: string) => files.get(p) ?? "",
    writeFile: async (p: string, t: string) => void files.set(p, t),
    readTextFile: async (p: string) => files.get(p) ?? "",
    writeTextFile: async (p: string, t: string) => void files.set(p, t),
    exists: async (p: string) => files.has(p),
    stat: async () => ({ mtime: 1, size: 1 }),
  };
}

afterEach(() => vi.restoreAllMocks());

let run = 0;

async function threeTries(dues: [string, string, string], getLagMs = 0) {
  run += 1;
  const s = dav(getLagMs);
  const said = [vi.spyOn(toast, "warning"), vi.spyOn(toast, "error"), vi.spyOn(toast, "info")];
  const title = `Paint the door ${run}`;
  const base = { adapter: vault() as never, notePath: "T/paint.md", accountId: "a1", listId: LIST, createTask: (l: string, d: never) => s.target.createTask(l, d) };
  const r1 = await createProviderTask({ ...base, draft: { title, due: dues[0] } });
  s.goOffline();
  const r2 = await createProviderTask({ ...base, draft: { title, due: dues[1] } });
  s.advance(1);
  const r3 = await createProviderTask({ ...base, draft: { title, due: dues[2] } });
  const dueAt = new Map([...s.objects.entries()].map(([href, o]) => [href, /DUE;VALUE=DATE:(\d+)/.exec(o.text)?.[1]]));
  return { r1, r2, r3, s, dueAt, said: said.flatMap((spy) => spy.mock.calls) };
}

describe("a create's memory knows every version it sent (issue 119)", () => {
  it("P1 - Monday landed, Tuesday never went out, Tuesday again: Tuesday stands at the provider, in the one task", async () => {
    expect.hasAssertions();
    const out = await threeTries(["2026-11-30", "2026-12-01", "2026-12-01"]);
    expect([out.r1.ok, out.r2.ok, out.r3.ok]).toEqual([false, false, true]);
    expect([...out.dueAt.values()]).toEqual(["20261201"]);
    expect(out.s.puts).toEqual(["If-None-Match stored, answer lost", "If-None-Match 412", "If-Match 204"]);
    expect(out.said).toEqual([]);
  });

  it("P2 - Monday landed, Tuesday never went out, back to Monday: Monday is the third try's own, nothing written, nothing said", async () => {
    expect.hasAssertions();
    const out = await threeTries(["2026-11-30", "2026-12-01", "2026-11-30"]);
    expect(out.r3.ok).toBe(true);
    expect([...out.dueAt.values()]).toEqual(["20261130"]);
    expect(out.s.puts).toEqual(["If-None-Match stored, answer lost", "If-None-Match 412"]);
    expect(out.said).toEqual([]);
  });

  it("P3 - Monday landed, Tuesday sent while the provider does not show Monday yet: Monday is left, Tuesday created anew, nothing said", async () => {
    expect.hasAssertions();
    const s = dav(3_600_000);
    const said = [vi.spyOn(toast, "warning"), vi.spyOn(toast, "error"), vi.spyOn(toast, "info")];
    const base = { adapter: vault() as never, notePath: "T/paint.md", accountId: "a1", listId: LIST, createTask: (l: string, d: never) => s.target.createTask(l, d) };
    const r1 = await createProviderTask({ ...base, draft: { title: "Paint the gate", due: "2026-11-30" } });
    const r2 = await createProviderTask({ ...base, draft: { title: "Paint the gate", due: "2026-12-01" } });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    const dues = [...s.objects.values()].map((o) => /DUE;VALUE=DATE:(\d+)/.exec(o.text)?.[1]).sort();
    expect(dues).toEqual(["20261130", "20261201"]);
    // The note hangs on the task that is its draft.
    expect(r2.ok && s.objects.get(`${LIST}${r2.uid}.ics`)!.text).toContain("20261201");
    expect(said.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});
