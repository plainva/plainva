import { newPimCreateUid } from "../src/pim/CalDavPimTarget.ts";
import { describe, expect, it } from "vitest";
import { CalDavPimTarget } from "../src/pim/CalDavPimTarget.ts";
import { PimNotShownYetError } from "../src/pim/types.ts";
import type { PimEventDraft, PimTaskDraft } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/** Every create names its uid (issue 119): a fresh one per call here. */
const withUid = <T extends object>(draft: T): T & { createAs: string } => ({ ...draft, createAs: newPimCreateUid() });

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

function laggingServer(options: {
  lagMs: number;
  dropFirstPuts?: number;
  /** The write side as late as the read side: `If-None-Match: *` sees only shown objects, and a PUT over one not shown yet replaces it at its address. */
  lateWrites?: boolean;
  /** Puts every new object under an address of its own and names it in `Location`. */
  relocate?: boolean;
  /** Answers 412 to the very first create although nothing is stored. */
  refuseFirst?: boolean;
}) {
  let now = 0;
  let revision = 0;
  let drops = options.dropFirstPuts ?? 0;
  let refuseFirst = options.refuseFirst ?? false;
  const objects = new Map<string, Stored>();
  const requests: string[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.slice(CAL.length)}`);
    const held = objects.get(url);
    if (method === "PUT") {
      if (refuseFirst) {
        refuseFirst = false;
        return new Response(null, { status: 412 });
      }
      if (headerOf(init, "If-None-Match") === "*" && held && (!options.lateWrites || now >= held.visibleAt)) return new Response(null, { status: 412 });
      if (options.relocate) {
        revision += 1;
        const at = `${CAL}server-${revision}.ics`;
        objects.set(at, { text: String(init?.body), etag: `"r${revision}"`, visibleAt: now });
        return new Response(null, { status: 201, headers: { Location: at } });
      }
      const ifMatch = headerOf(init, "If-Match");
      if (ifMatch && (!held || now < held.visibleAt || held.etag !== ifMatch)) return new Response(null, { status: 412 });
      revision += 1;
      // Accepted, and - for the first `dropFirstPuts` creates - never kept.
      if (!held && drops > 0) {
        drops -= 1;
        return new Response(null, { status: 201 });
      }
      const text = String(init?.body).replace("PRODID:-//Plainva//Plainva//EN", "PRODID:-//Example//Server//EN");
      objects.set(url, { text, etag: `"r${revision}"`, visibleAt: held ? (options.lateWrites ? held.visibleAt : now) : now + options.lagMs });
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
    const created = await target.createEvent(CAL, withUid(weekly));
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

  it("a create the server accepted twice and still does not show counts as held - not refused", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, dropFirstPuts: 2 });
    const draft = { ...weekly, createAs: "plainva-try-2" };
    // Accepted twice: nothing the server accepted is refused. Whether it holds
    // it is asked later, by the screen (`watchCreatedEvents`).
    await expect(target.createEvent(CAL, draft)).resolves.toEqual({ uid: "plainva-try-2", href: `${CAL}plainva-try-2.ics` });
    expect(objects.size).toBe(0);
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-try-2", href: `${CAL}plainva-try-2.ics` })).resolves.toBe(false);
    // "Try again" is the same create, under the same uid: it lands now, once.
    const again = await target.createEvent(CAL, draft);
    expect(again.uid).toBe("plainva-try-2");
    expect(objects.size).toBe(1);
  });

  it("a server whose write side is as late as its read side: held after the second send, one object, never 'not saved'", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 15_000, lateWrites: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-late-1" });
    expect(created).toEqual({ uid: "plainva-late-1", href: `${CAL}plainva-late-1.ics` });
    expect(objects.size).toBe(1);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(2);
  });

  it("a server that puts the object under its own address is read there - one object per try, never sent twice", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 0, relocate: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-moved-1" });
    expect(created).toEqual({ uid: "plainva-moved-1", etag: '"r1"', href: `${CAL}server-1.ics` });
    expect(objects.size).toBe(1);
    expect(requests).toEqual(["PUT plainva-moved-1.ics", "GET server-1.ics"]);
  });

  it("412 on the first send of a fresh uid is somebody else's object - an error, never 'landed'", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, refuseFirst: true });
    await expect(target.createEvent(CAL, { ...weekly, createAs: "plainva-taken-1" })).rejects.toThrow("caldav create event: the address is taken");
    expect(objects.size).toBe(0);
  });

  it("an edit of a new event the server still does not show says exactly that - not 'read 404 before update'", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 20_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-slow-3" });
    const edit = target.updateEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { ...weekly, title: "Moved" });
    await expect(edit).rejects.toBeInstanceOf(PimNotShownYetError);
    await expect(edit).rejects.toThrow("your provider does not show this new event yet - try again in a moment");
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

  it("an edit right after a create the server confirmed only by 412 waits for it as the read-back did", async () => {
    expect.hasAssertions();
    // Longer than the read-back, the second send and its read-back together (11 s).
    const { target, waits } = laggingServer({ lagMs: 12_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-slow-2" });
    expect(created.etag).toBeUndefined();
    const before = waits.length;
    await expect(target.updateEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { ...weekly, title: "Moved" })).resolves.toEqual({ etag: '"r2"' });
    expect(waits.length).toBeGreaterThan(before);
  });

  it("an edit of any other object that is not there is refused at once, without waiting", async () => {
    expect.hasAssertions();
    const { target, waits, requests } = laggingServer({ lagMs: 0 });
    await expect(target.updateEvent({ calendarId: CAL, uid: "elsewhere", href: `${CAL}elsewhere.ics` }, weekly)).rejects.toThrow("caldav read 404 before update");
    expect(waits).toEqual([]);
    expect(requests).toEqual(["GET elsewhere.ics"]);
  });

  it("asks whether it holds an event: there, or not there", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 0 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-ask-1" });
    await expect(target.eventExists({ calendarId: CAL, uid: created.uid, href: created.href })).resolves.toBe(true);
    await expect(target.eventExists({ calendarId: CAL, uid: "x", href: `${CAL}x.ics` })).resolves.toBe(false);
  });

  it("a task follows the same rule", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 1_000 });
    const task: PimTaskDraft = { title: "Buy paint", completed: false };
    const created = await target.createTask(CAL, withUid(task));
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
    const created = await new CalDavPimTarget(creds, fetchFn, async () => {}).createEvent(CAL, withUid(weekly));
    expect(created.etag).toBe('"said"');
    expect(requests).toEqual(["PUT"]);
  });
});
