import { describe, expect, it } from "vitest";
import { CalDavPimTarget } from "../src/pim/CalDavPimTarget.ts";
import { PimRequestError } from "../src/pim/requestError.ts";
import type { PimEventDraft, PimTaskDraft } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/**
 * A new event the server accepted but does not show yet (issue 119).
 *
 * The report: a repeating event added on the desktop against iCloud "didn't
 * stick around at first", with "The event was not saved: caldav read 404
 * before update". iCloud rewrites what it is sent, so its answer to the PUT
 * names no etag (RFC 4791 5.3.4) and Plainva reads the object back - and a
 * server that shows its own writes late answers that read with 404. The 404
 * was taken for "etag unknown": the create counted as done, the event was laid
 * on screen without an etag, the next edit read it again, met the same 404 and
 * failed with exactly that sentence. A server that never kept the object left
 * an event on screen that vanished three minutes later without a word.
 *
 * The server below behaves the way such a server does: it stores the object
 * it is sent (rewritten, under a new etag), answers 201 without an etag, and
 * shows the object to a GET only `lagMs` after the PUT - on its own clock,
 * which moves only while the client waits. `If-None-Match: *` is honoured.
 */

const creds = { url: "https://dav.example.org/cal/home/", user: "u", pass: "p" };
const CAL = "https://dav.example.org/cal/home/personal/";

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

interface Stored {
  text: string;
  etag: string;
  visibleAt: number;
}

function laggingServer(options: { lagMs: number; dropFirstPuts?: number }) {
  let now = 0;
  let revision = 0;
  let drops = options.dropFirstPuts ?? 0;
  const objects = new Map<string, Stored>();
  const requests: string[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.slice(CAL.length)}`);
    const held = objects.get(url);
    if (method === "PUT") {
      if (headerOf(init, "If-None-Match") === "*" && held) return new Response(null, { status: 412 });
      const ifMatch = headerOf(init, "If-Match");
      if (ifMatch && (!held || now < held.visibleAt || held.etag !== ifMatch)) return new Response(null, { status: 412 });
      revision += 1;
      // Accepted, and - for the first `dropFirstPuts` creates - never kept.
      if (!held && drops > 0) {
        drops -= 1;
        return new Response(null, { status: 201 });
      }
      const text = String(init?.body).replace("PRODID:-//Plainva//Plainva//EN", "PRODID:-//Example//Server//EN");
      objects.set(url, { text, etag: `"r${revision}"`, visibleAt: held ? now : now + options.lagMs });
      return new Response(null, { status: held ? 204 : 201 });
    }
    if (method === "GET") {
      if (!held || now < held.visibleAt) return new Response("Not Found", { status: 404 });
      return new Response(held.text, { status: 200, headers: { ETag: held.etag } });
    }
    return new Response(null, { status: 405 });
  };
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
    now += ms;
  };
  return { objects, requests, waits, fetchFn, target: new CalDavPimTarget(creds, fetchFn, wait) };
}

const weekly: PimEventDraft = {
  title: "Team sync",
  start: { ts: Date.parse("2026-12-01T09:00:00Z") },
  end: { ts: Date.parse("2026-12-01T09:30:00Z") },
  allDay: false,
  recurrence: { freq: "weekly", interval: 1 },
};

describe("CalDAV: a new event the server shows late", () => {
  it("is read back until the server shows it, and the first edit after it goes through", async () => {
    expect.hasAssertions();
    const { target, waits } = laggingServer({ lagMs: 1_000 });
    const created = await target.createEvent(CAL, weekly);
    // The edit the report failed on, with the etag the create handed back.
    const edited = await target.updateEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { ...weekly, title: "Team sync (moved)" });
    expect(created.etag).toBe('"r1"');
    expect(edited.etag).toBe('"r2"');
    expect(waits.length).toBeGreaterThan(0);
  });

  it("a create the server dropped is sent once more - and lands once", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 0, dropFirstPuts: 1 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-try-1" });
    expect(created.etag).toBe('"r2"');
    expect(objects.size).toBe(1);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(2);
  });

  it("a create the server holds but shows later than the read-back waits is written - once", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 60_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-slow-1" });
    // The second send was refused with 412: the server holds it.
    expect(created).toEqual({ uid: "plainva-slow-1", etag: undefined, href: `${CAL}plainva-slow-1.ics` });
    expect(objects.size).toBe(1);
  });

  it("a create the server drops twice is refused with that reason - never counted as written", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, dropFirstPuts: 2 });
    const draft = { ...weekly, createAs: "plainva-try-2" };
    const refusal = await target.createEvent(CAL, draft).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(PimRequestError);
    expect((refusal as PimRequestError).status).toBe(404);
    expect((refusal as Error).message).toBe("caldav create event: the server accepted it but does not show it (404)");
    expect(objects.size).toBe(0);
    // "Try again" is the same create, under the same uid: it lands now.
    const again = await target.createEvent(CAL, draft);
    expect(again.uid).toBe("plainva-try-2");
    expect(objects.size).toBe(1);
  });

  it("'Try again' after an answer that never came finds the event it already left - no second one", async () => {
    expect.hasAssertions();
    const { objects, fetchFn } = laggingServer({ lagMs: 0 });
    let lose = true;
    const lossy: FetchFn = async (input, init) => {
      const res = await fetchFn(input, init);
      if (lose && init?.method === "PUT") {
        lose = false;
        throw new TypeError("network connection was lost");
      }
      return res;
    };
    const flaky = new CalDavPimTarget(creds, lossy, async () => {});
    const draft = { ...weekly, createAs: "plainva-lost-1" };
    await expect(flaky.createEvent(CAL, draft)).rejects.toThrow("network connection was lost");
    expect(objects.size).toBe(1);
    await expect(flaky.createEvent(CAL, draft)).resolves.toEqual({ uid: "plainva-lost-1", etag: '"r1"', href: `${CAL}plainva-lost-1.ics` });
    expect(objects.size).toBe(1);
  });

  it("a task follows the same rule", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 1_000 });
    const task: PimTaskDraft = { title: "Buy paint", completed: false };
    const created = await target.createTask(CAL, task);
    expect(created.etag).toBe('"r1"');
    await expect(target.updateTask({ listId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { ...task, completed: true })).resolves.toEqual({ etag: '"r2"' });
  });

  it("a server that names the etag in its answer is not read back at all", async () => {
    expect.hasAssertions();
    const requests: string[] = [];
    const fetchFn: FetchFn = async (_input, init) => {
      requests.push(init?.method ?? "GET");
      return new Response(null, { status: 201, headers: { ETag: '"said"' } });
    };
    const created = await new CalDavPimTarget(creds, fetchFn, async () => {}).createEvent(CAL, weekly);
    expect(created.etag).toBe('"said"');
    expect(requests).toEqual(["PUT"]);
  });
});
