import { newPimCreateUid } from "../src/pim/createUid.ts";
import { describe, expect, it, vi } from "vitest";
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
  listedAt?: number;
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
  /** Puts every new object under an address of its own WITHOUT saying where. */
  relocateSilently?: boolean;
  /** The answer to the second PUT: an error status, or a connection that breaks. */
  failSecondPut?: 503 | 409 | "network";
  /** A UID query answered with every object (the filter ignored), with the collection listed too, or with an object outside the calendar. */
  report?: "ignoreFilter" | "collectionToo" | "outside" | "truncated";
  /** The UID the calendar's own entry, or the entry outside it, carries in its data. */
  carryUid?: string;
  /** Every GET answers with this status. */
  getStatus?: number;
  /** A sync lists objects before a read at their address finds them. */
  listEarly?: boolean;
  /** No calendar-query at all (405). */
  noReport?: boolean;
  /** A UID query lists a silently relocated object only this long after it was stored. */
  listLagMs?: number;
  /** Changes the object right after the first GET that shows it (another writer between a read and a write). */
  changeAfterGet?: (text: string) => string;
  /** The first PUT is stored, but its answer never arrives. */
  loseFirstAnswer?: boolean;
  /** A GET names no etag. */
  getWithoutEtag?: boolean;
}) {
  let now = 0;
  let revision = 0;
  let drops = options.dropFirstPuts ?? 0;
  let refuseFirst = options.refuseFirst ?? false;
  let puts = 0;
  let changed = false;
  let changeNext: ((text: string) => string) | null = null;
  const preconditions: string[] = [];
  const objects = new Map<string, Stored>();
  const requests: string[] = [];
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.slice(CAL.length)}`);
    const held = objects.get(url);
    if (method === "PUT") {
      puts += 1;
      preconditions.push(headerOf(init, "If-Match") ? `If-Match ${headerOf(init, "If-Match")}` : headerOf(init, "If-None-Match") ? "If-None-Match" : "none");
      if (puts === 2 && options.failSecondPut) {
        if (options.failSecondPut === "network") throw new TypeError("network connection was lost");
        return new Response("busy", { status: options.failSecondPut });
      }
      if (options.loseFirstAnswer && puts === 1) {
        revision += 1;
        objects.set(url, { text: String(init?.body), etag: `"r${revision}"`, visibleAt: now + options.lagMs });
        throw new TypeError("network connection was lost");
      }
      if (refuseFirst) {
        refuseFirst = false;
        return new Response(null, { status: 412 });
      }
      if (headerOf(init, "If-None-Match") === "*" && held && (!options.lateWrites || now >= held.visibleAt)) return new Response(null, { status: 412 });
      if (options.relocateSilently && headerOf(init, "If-None-Match") === "*") {
        revision += 1;
        objects.set(`${CAL}server-${revision}.ics`, { text: String(init?.body), etag: `"r${revision}"`, visibleAt: now, listedAt: now + (options.listLagMs ?? 0) });
        return new Response(null, { status: 201 });
      }
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
      if (options.getStatus) return new Response("no", { status: options.getStatus });
      if (!held || now < held.visibleAt) return new Response("Not Found", { status: 404 });
      const shownText = held.text;
      if (options.changeAfterGet && !changed) {
        changed = true;
        revision += 1;
        objects.set(url, { ...held, text: options.changeAfterGet(held.text), etag: `"r${revision}"` });
      }
      if (changeNext) {
        const change = changeNext;
        changeNext = null;
        revision += 1;
        objects.set(url, { ...held, text: change(held.text), etag: `"r${revision}"` });
      }
      return new Response(shownText, { status: 200, headers: options.getWithoutEtag ? {} : { ETag: held.etag } });
    }
    if (method === "DELETE") {
      if (!held || now < held.visibleAt) return new Response(null, { status: 404 });
      const ifMatch = headerOf(init, "If-Match");
      if (ifMatch && ifMatch !== held.etag) return new Response(null, { status: 412 });
      objects.delete(url);
      return new Response(null, { status: 204 });
    }
    if (method === "REPORT" && options.noReport) return new Response(null, { status: 405 });
    if (method === "REPORT") {
      // calendar-query on a UID: the shown objects that carry it.
      const uid = /<c:text-match[^>]*>([^<]*)</.exec(String(init?.body))?.[1] ?? "";
      const found = [...objects.entries()].filter(([, o]) => (options.listEarly || now >= Math.max(o.visibleAt, o.listedAt ?? 0)) && (options.report === "ignoreFilter" || o.text.includes(`UID:${uid}`)));
      const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const rows = found.map(
        ([href, o]) =>
          `<d:response><d:href>${new URL(href).pathname}</d:href><d:propstat><d:prop><d:getetag>${o.etag}</d:getetag><c:calendar-data>${xml(o.text)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
      const carried = options.carryUid ? `<c:calendar-data>${xml(["BEGIN:VCALENDAR", "BEGIN:VEVENT", `UID:${options.carryUid}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"))}</c:calendar-data>` : "";
      if (options.report === "collectionToo") rows.push(`<d:response><d:href>${new URL(CAL).pathname}</d:href><d:propstat><d:prop><d:getetag>"col"</d:getetag>${carried}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      if (options.report === "truncated") rows.push(`<d:response><d:href>${new URL(CAL).pathname}</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status><d:error><d:number-of-matches-within-limits/></d:error></d:response>`);
      if (options.report === "outside") rows.push(`<d:response><d:href>/cal/home/other/stray.ics</d:href><d:propstat><d:prop><d:getetag>"x"</d:getetag>${carried}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows.join("")}</d:multistatus>`, { status: 207 });
    }
    return new Response(null, { status: 405 });
  };
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
    now += ms;
  };
  const preload = (href: string, text: string) => objects.set(href, { text, etag: '"pre"', visibleAt: 0 });
  /** What an earlier try sent and the server kept (its answer lost): through a target of its own. */
  const preloadSent = async (kind: "event" | "task", uid: string, draft: object) => {
    const early = new CalDavPimTarget(creds, fetchFn, wait);
    const sent = kind === "event" ? early.createEvent(CAL, { ...(draft as PimEventDraft), createAs: uid }) : early.createTask(CAL, { ...(draft as PimTaskDraft), createAs: uid });
    await sent.catch(() => undefined);
  };
  const advance = (ms: number) => void (now += ms);
  /** Another writer changes the object right after the next GET that shows it - between a read and a write. */
  const changeAfterNextGet = (change: (text: string) => string) => void (changeNext = change);
  /** Another device or person changes the stored object. */
  const changeElsewhere = (href: string, change: (text: string) => string) => {
    revision += 1;
    const held = objects.get(href)!;
    objects.set(href, { ...held, text: change(held.text), etag: `"r${revision}"` });
  };
  return { objects, requests, preconditions, waits, fetchFn, preload, preloadSent, advance, changeAfterNextGet, changeElsewhere, target: new CalDavPimTarget(creds, fetchFn, wait) };
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

  it("a create the server accepted and did not keep is held - never sent again in the same call (the screen asks later)", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 0, dropFirstPuts: 1 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-try-1" });
    expect(created).toEqual({ uid: "plainva-try-1", href: `${CAL}plainva-try-1.ics` });
    expect(objects.size).toBe(0);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(1);
  });

  it("a create the server holds but shows later than the read-back waits is held - one send, one object", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 60_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-slow-1" });
    expect(created).toEqual({ uid: "plainva-slow-1", href: `${CAL}plainva-slow-1.ics` });
    expect(objects.size).toBe(1);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(1);
  });

  it("'Try again' after an accepted create the server did not keep: the later try finds nothing at the address and lands, once", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, dropFirstPuts: 1 });
    const draft = { ...weekly, createAs: "plainva-try-2" };
    await target.createEvent(CAL, draft);
    expect(objects.size).toBe(0);
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-try-2", href: `${CAL}plainva-try-2.ics` })).resolves.toBe(false);
    const again = await target.createEvent(CAL, { ...draft, createSent: [weekly] });
    expect(again.uid).toBe("plainva-try-2");
    expect(objects.size).toBe(1);
  });

  it("a server whose write side is as late as its read side: one send, one object, never 'not saved'", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 15_000, lateWrites: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-late-1" });
    expect(created).toEqual({ uid: "plainva-late-1", href: `${CAL}plainva-late-1.ics` });
    expect(objects.size).toBe(1);
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(1);
  });

  it("a server that stores under an address of its own and lists it only later: one object - an accepted send is never repeated", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, relocateSilently: true, listLagMs: 30_000 });
    await target.createEvent(CAL, { ...weekly, createAs: "plainva-b2" });
    expect(objects.size).toBe(1);
  });

  it("a server that puts the object under its own address is read there - one object per try, never sent twice", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 0, relocate: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-moved-1" });
    expect(created).toEqual({ uid: "plainva-moved-1", etag: '"r1"', href: `${CAL}server-1.ics` });
    expect(objects.size).toBe(1);
    expect(requests).toEqual(["PUT plainva-moved-1.ics", "GET server-1.ics"]);
  });

  it("a 412 to the first send of a first try is an error, as on main - a server that answers every create so and keeps nothing is never 'saved'", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, refuseFirst: true });
    await expect(target.createEvent(CAL, { ...weekly, createAs: "plainva-first-412" })).rejects.toThrow("caldav create event: 412");
    expect(objects.size).toBe(0);
  });

  it("a server that stores under an address of its own without saying so and cannot answer a UID query: one object, held - never a second send", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, relocateSilently: true, noReport: true });
    await expect(target.createEvent(CAL, { ...weekly, createAs: "plainva-p4" })).resolves.toEqual({ uid: "plainva-p4", href: `${CAL}plainva-p4.ics` });
    expect(objects.size).toBe(1);
  });

  // A later try (docs/engineering/Calendar_Create_Tries.md): it writes over the
  // object at its address only where that is provably one of its own versions;
  // anything else stays as it stands, and the create is made anew under a uid
  // of its own - as on main.

  it("later try - nothing at the address (the earlier try never landed): one send, lands", async () => {
    expect.hasAssertions();
    const { target, objects, requests } = laggingServer({ lagMs: 0 });
    const res = await target.createTask(CAL, { title: "Paint", due: "2026-12-09", completed: false, createAs: "plainva-t-none", createSent: [{ title: "Paint", due: "2026-12-01", completed: false }] });
    expect(res.uid).toBe("plainva-t-none");
    expect(objects.get(`${CAL}plainva-t-none.ics`)!.text).toContain("20261209");
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(1);
  });

  it("later try - this try's own draft stands: held as it is, nothing written", async () => {
    expect.hasAssertions();
    const { target, objects, requests, preloadSent } = laggingServer({ lagMs: 0 });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-same", first);
    const res = await target.createTask(CAL, { ...first, createAs: "plainva-t-same", createSent: [first] });
    expect(res).toEqual({ uid: "plainva-t-same", etag: '"r1"', href: `${CAL}plainva-t-same.ics` });
    expect(requests.filter((r) => r.startsWith("PUT"))).toHaveLength(2); // the preload and the 412
    expect(objects.size).toBe(1);
  });

  it("later try - an earlier version stands, draft changed: written with If-Match on the etag the read named", async () => {
    expect.hasAssertions();
    const { target, objects, preconditions, preloadSent } = laggingServer({ lagMs: 0 });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-ifmatch", first);
    const res = await target.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-ifmatch", createSent: [first] });
    expect(res.uid).toBe("plainva-t-ifmatch");
    expect(preconditions).toEqual(["If-None-Match", "If-None-Match", 'If-Match "r1"']);
    const text = objects.get(`${CAL}plainva-t-ifmatch.ics`)!.text;
    expect(text).toContain("20261209");
    expect(text).not.toContain("20261201");
    expect(objects.size).toBe(1);
  });

  it("later try - Monday landed, Tuesday never went out, Tuesday again: the provider ends with Tuesday, not 'saved' over Monday (P1)", async () => {
    expect.hasAssertions();
    const { target, objects, preloadSent } = laggingServer({ lagMs: 0 });
    const monday = { title: "Paint", due: "2026-11-30", completed: false };
    const tuesday = { ...monday, due: "2026-12-01" };
    await preloadSent("task", "plainva-p1", monday);
    const res = await target.createTask(CAL, { ...tuesday, createAs: "plainva-p1", createSent: [monday, tuesday] });
    expect(res.uid).toBe("plainva-p1");
    expect(objects.get(`${CAL}plainva-p1.ics`)!.text).toContain("20261201");
    expect(objects.size).toBe(1);
  });

  it("later try - Monday landed, Tuesday never went out, back to Monday: Monday is this try's own, held, nothing said (P2)", async () => {
    expect.hasAssertions();
    const { target, objects, preconditions, preloadSent } = laggingServer({ lagMs: 0 });
    const monday = { title: "Paint", due: "2026-11-30", completed: false };
    const tuesday = { ...monday, due: "2026-12-01" };
    await preloadSent("task", "plainva-p2", monday);
    const res = await target.createTask(CAL, { ...monday, createAs: "plainva-p2", createSent: [monday, tuesday] });
    expect(res.uid).toBe("plainva-p2");
    expect(preconditions).toEqual(["If-None-Match", "If-None-Match"]);
    expect(objects.size).toBe(1);
  });

  it("later try - an earlier version stands and the read names no etag: written without a precondition, as an ordinary change is", async () => {
    expect.hasAssertions();
    const { target, objects, preconditions, preloadSent } = laggingServer({ lagMs: 0, getWithoutEtag: true });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-noetag", first);
    const res = await target.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-noetag", createSent: [first] });
    expect(res.uid).toBe("plainva-t-noetag");
    expect(preconditions.at(-1)).toBe("none");
    expect(objects.get(`${CAL}plainva-t-noetag.ics`)!.text).toContain("20261209");
    expect(objects.size).toBe(1);
  });

  it("later try - changed elsewhere and the read names no etag: never written without the comparison, created anew", async () => {
    expect.hasAssertions();
    const { target, objects, preloadSent, changeElsewhere } = laggingServer({ lagMs: 0, getWithoutEtag: true });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-noetag-2", first);
    const at = `${CAL}plainva-t-noetag-2.ics`;
    changeElsewhere(at, (t) => t.replace("END:VTODO", "STATUS:COMPLETED\r\nEND:VTODO"));
    const elsewhere = objects.get(at)!.text;
    const res = await target.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-noetag-2", createSent: [first] });
    expect(res.uid).not.toBe("plainva-t-noetag-2");
    expect(objects.get(at)!.text).toBe(elsewhere);
    expect(objects.get(`${CAL}${res.uid}.ics`)!.text).toContain("20261209");
  });

  // Every line a person or another device may change, one at a time: none of
  // them is ever written over, with the draft unchanged or changed (R01-R09).
  const meeting: PimEventDraft = { ...weekly, attendees: ["sam@example.org"] };
  const eventChanges: Array<[string, (text: string) => string, PimEventDraft?]> = [
    ["title", (t) => t.replace("SUMMARY:Team sync", "SUMMARY:Team sync (room 2)")],
    ["a deleted occurrence", (t) => t.replace("END:VEVENT", "EXDATE:20261208T090000Z\r\nEND:VEVENT")],
    ["an attendee", (t) => t.replace("END:VEVENT", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:sam@example.org\r\nEND:VEVENT")],
    ["an attendee's answer only", (t) => t.replace("PARTSTAT=NEEDS-ACTION", "PARTSTAT=ACCEPTED"), meeting],
    ["an attendee's role only", (t) => t.replace("ROLE=REQ-PARTICIPANT", "ROLE=OPT-PARTICIPANT"), meeting],
    ["an attendee's name only", (t) => t.replace("CN=sam@example.org", "CN=Sam"), meeting],
    ["the status", (t) => t.replace("END:VEVENT", "STATUS:CANCELLED\r\nEND:VEVENT")],
    ["an alarm", (t) => t.replace("END:VEVENT", "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT")],
    ["the blockers another Plainva device keeps", (t) => t.replace("END:VEVENT", "X-PLAINVA-BLOCKS:acc cal busy-1\r\nEND:VEVENT")],
    ["a provider extra", (t) => t.replace("END:VEVENT", "X-APPLE-TRAVEL-DURATION:PT20M\r\nEND:VEVENT")],
    ["the sequence", (t) => t.replace("END:VEVENT", "SEQUENCE:2\r\nEND:VEVENT")],
    [
      "one moved occurrence (a second VEVENT)",
      (t) => t.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:plainva-ev\r\nRECURRENCE-ID:20261208T090000Z\r\nDTSTART:20261208T100000Z\r\nDTEND:20261208T103000Z\r\nSUMMARY:Team sync\r\nEND:VEVENT\r\nEND:VCALENDAR"),
    ],
  ];
  for (const [what, change, base = weekly] of eventChanges) {
    for (const changed of [false, true]) {
      it(`later try - an event changed elsewhere since (${what}), draft ${changed ? "changed" : "unchanged"}: left as it stands, the draft created anew`, async () => {
        expect.hasAssertions();
        const { target, objects, preloadSent, changeElsewhere } = laggingServer({ lagMs: 0 });
        await preloadSent("event", "plainva-ev", base);
        const at = `${CAL}plainva-ev.ics`;
        const sent = objects.get(at)!.text;
        changeElsewhere(at, change);
        const elsewhere = objects.get(at)!.text;
        // The probe is a change: what it changed is in the object.
        expect(elsewhere).not.toBe(sent);
        const draft = changed ? { ...base, title: "Team sync!" } : base;
        const res = await target.createEvent(CAL, { ...draft, createAs: "plainva-ev", createSent: [base] });
        expect(objects.get(at)!.text).toBe(elsewhere);
        expect(res.uid).not.toBe("plainva-ev");
        expect(objects.get(`${CAL}${res.uid}.ics`)!.text).toContain(`SUMMARY:${draft.title}`);
        expect(objects.size).toBe(2);
      });
    }
  }

  const taskChanges: Array<[string, (text: string) => string]> = [
    ["completed", (t) => t.replace("END:VTODO", "STATUS:COMPLETED\r\nEND:VTODO")],
    ["percent complete only", (t) => t.replace("END:VTODO", "PERCENT-COMPLETE:50\r\nEND:VTODO")],
    ["due moved", (t) => t.replace("DUE;VALUE=DATE:20261201", "DUE;VALUE=DATE:20261205")],
    ["a description", (t) => t.replace("END:VTODO", "DESCRIPTION:bring the blue one\r\nEND:VTODO")],
    ["a category", (t) => t.replace("END:VTODO", "CATEGORIES:home\r\nEND:VTODO")],
    ["a priority", (t) => t.replace("END:VTODO", "PRIORITY:1\r\nEND:VTODO")],
  ];
  for (const [what, change] of taskChanges) {
    for (const changed of [false, true]) {
      it(`later try - a task changed elsewhere since (${what}), draft ${changed ? "changed" : "unchanged"}: left as it stands, the draft created anew`, async () => {
        expect.hasAssertions();
        const { target, objects, preloadSent, changeElsewhere } = laggingServer({ lagMs: 0 });
        const first = { title: "Paint", due: "2026-12-01", completed: false };
        await preloadSent("task", "plainva-tk", first);
        const at = `${CAL}plainva-tk.ics`;
        const sent = objects.get(at)!.text;
        changeElsewhere(at, change);
        const elsewhere = objects.get(at)!.text;
        expect(elsewhere).not.toBe(sent);
        const draft = changed ? { ...first, due: "2026-12-09" } : first;
        const res = await target.createTask(CAL, { ...draft, createAs: "plainva-tk", createSent: [first] });
        expect(objects.get(at)!.text).toBe(elsewhere);
        expect(res.uid).not.toBe("plainva-tk");
        expect(objects.get(`${CAL}${res.uid}.ics`)!.text).toContain(changed ? "20261209" : "20261201");
      });
    }
  }

  it("later try - a server that rewrites only its own stamps (DTSTAMP, CREATED, LAST-MODIFIED, the calendar's PRODID): still this try's own, held", async () => {
    expect.hasAssertions();
    const { target, objects, preloadSent, changeElsewhere } = laggingServer({ lagMs: 0 });
    await preloadSent("event", "plainva-stamps", weekly);
    const at = `${CAL}plainva-stamps.ics`;
    changeElsewhere(at, (t) => t.replace(/DTSTAMP:[^\r\n]*/, "DTSTAMP:20200101T000000Z").replace("END:VEVENT", "CREATED:20200101T000000Z\r\nLAST-MODIFIED:20200101T000000Z\r\nSEQUENCE:0\r\nEND:VEVENT"));
    const res = await target.createEvent(CAL, { ...weekly, createAs: "plainva-stamps", createSent: [weekly] });
    expect(res.uid).toBe("plainva-stamps");
    expect(objects.size).toBe(1);
  });

  it("later try - not readable yet: not provably its own, so created anew; the new one counts as just created (H-G)", async () => {
    expect.hasAssertions();
    const { target, objects, preloadSent } = laggingServer({ lagMs: 60_000 });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-hidden", first);
    const res = await target.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-hidden", createSent: [first] });
    expect(res.uid).not.toBe("plainva-t-hidden");
    expect(objects.get(`${CAL}plainva-t-hidden.ics`)!.text).toContain("20261201");
    expect(objects.get(`${CAL}${res.uid}.ics`)!.text).toContain("20261209");
    // An edit of the new one inside the quarter of an hour says "not shown yet", not "read 404".
    await expect(target.updateTask({ listId: CAL, uid: res.uid, href: res.href }, { ...first, title: "Paint the door" })).rejects.toBeInstanceOf(PimNotShownYetError);
  });

  it("later try - changed by another writer between the read and the write: the If-Match write is refused, nothing is lost, the draft created anew", async () => {
    expect.hasAssertions();
    const { target, objects, preconditions, preloadSent, changeAfterNextGet } = laggingServer({ lagMs: 0 });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-race", first);
    changeAfterNextGet((t) => t.replace("END:VTODO", "STATUS:COMPLETED\r\nEND:VTODO"));
    const res = await target.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-race", createSent: [first] });
    // The read saw this create's own earlier version; the write named its etag and was refused.
    expect(preconditions.slice(1)).toEqual(["If-None-Match", 'If-Match "r1"', "If-None-Match"]);
    const text = objects.get(`${CAL}plainva-t-race.ics`)!.text;
    expect(text).toContain("STATUS:COMPLETED");
    expect(text).toContain("20261201");
    expect(res.uid).not.toBe("plainva-t-race");
    expect(objects.get(`${CAL}${res.uid}.ics`)!.text).toContain("20261209");
  });

  it("later try - a read that fails is no answer: the create fails, nothing is written", async () => {
    expect.hasAssertions();
    const { objects, preloadSent, fetchFn } = laggingServer({ lagMs: 0 });
    const first = { title: "Paint", due: "2026-12-01", completed: false };
    await preloadSent("task", "plainva-t-500", first);
    const failing = new CalDavPimTarget(creds, async (input, init) => ((init?.method ?? "GET") === "GET" ? new Response("busy", { status: 503 }) : fetchFn(input, init)), async () => {});
    await expect(failing.createTask(CAL, { ...first, due: "2026-12-09", createAs: "plainva-t-500", createSent: [first] })).rejects.toThrow("caldav create task: 503");
    expect(objects.size).toBe(1);
    expect(objects.get(`${CAL}plainva-t-500.ics`)!.text).toContain("20261201");
  });

  it("a server that stores under an address of its own without saying so: found by its UID before a second send - one object, held there", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, relocateSilently: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-silent-2" });
    expect(created).toEqual({ uid: "plainva-silent-2", href: `${CAL}server-1.ics` });
    expect(objects.size).toBe(1);
  });

  it("an edit of a new event the server still does not show says exactly that - not 'read 404 before update'", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 20_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-slow-3" });
    const edit = target.updateEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { ...weekly, title: "Moved" });
    await expect(edit).rejects.toBeInstanceOf(PimNotShownYetError);
    await expect(edit).rejects.toThrow("your provider does not show this new event yet - the change was not saved; try again in a moment");
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
    // "Try again" is a later try of the same create: it finds the earlier try's event, the same, and leaves it.
    await expect(flaky.createEvent(CAL, { ...draft, createSent: [weekly] })).resolves.toEqual({ uid: "plainva-lost-1", etag: '"r1"', href: `${CAL}plainva-lost-1.ics` });
    expect(objects.size).toBe(1);
  });

  it("an edit right after a create the server confirmed only by 412 waits for it as the read-back did", async () => {
    expect.hasAssertions();
    // Longer than the read-back (5.5 s); the second send is answered 412, held without a read.
    const { target, waits } = laggingServer({ lagMs: 9_000 });
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

  it("an accepted create is sent once: a 404 at the address and a 'not there' from the calendar never make a second send", async () => {
    expect.hasAssertions();
    const { target, requests } = laggingServer({ lagMs: 60_000 });
    await target.createEvent(CAL, { ...weekly, createAs: "plainva-once" });
    expect(requests.filter((r) => r.startsWith("PUT"))).toEqual(["PUT plainva-once.ics"]);
  });

  it("'Try again' after a lost answer, while the server holds the object but does not show it yet: not provably ours, so created anew - as on main", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 60_000, loseFirstAnswer: true });
    const draft = { ...weekly, createAs: "plainva-lost-answer" };
    await expect(target.createEvent(CAL, draft)).rejects.toThrow("network connection was lost");
    const again = await target.createEvent(CAL, { ...draft, createSent: [weekly] });
    expect(again.uid).not.toBe("plainva-lost-answer");
    expect(again.href).toBe(`${CAL}${again.uid}.ics`);
    expect(objects.size).toBe(2);
  });

  it("asked whether it has an event, a 404 at the address is followed by a UID query - a hit only where the object carries the UID", async () => {
    expect.hasAssertions();
    const { target, preload } = laggingServer({ lagMs: 0 });
    preload(`${CAL}server-7.ics`, ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:plainva-elsewhere", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-elsewhere", href: `${CAL}plainva-elsewhere.ics` })).resolves.toBe(true);
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-nowhere", href: `${CAL}plainva-nowhere.ics` })).resolves.toBe(false);
  });

  it("a server that ignores the UID filter and shows everything, ours not among it, says 'not there' - and a new event never takes another's address", async () => {
    expect.hasAssertions();
    const { target, objects, preload, advance } = laggingServer({ lagMs: 60_000, report: "ignoreFilter" });
    preload(`${CAL}other.ics`, ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:other-uid-1", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-gone", href: `${CAL}plainva-gone.ics` })).resolves.toBe(false);
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-k2" });
    expect(created.href).toBe(`${CAL}plainva-k2.ics`);
    advance(120_000);
    await target.deleteEvent({ calendarId: CAL, uid: created.uid, href: created.href });
    expect(objects.has(`${CAL}other.ics`)).toBe(true);
    expect(objects.has(`${CAL}plainva-k2.ics`)).toBe(false);
  });

  it("an entry without data, or with data that cannot be read, is no answer - thrown, neither yes nor no", async () => {
    expect.hasAssertions();
    const { target, preload } = laggingServer({ lagMs: 0, report: "ignoreFilter" });
    preload(`${CAL}broken.ics`, "NOT AN ICS");
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-x", href: `${CAL}plainva-x.ics` })).rejects.toThrow("cannot be read");
  });

  it("asked whether it has an event, any object the calendar answers with that carries our UID counts - the calendar itself never does", async () => {
    expect.hasAssertions();
    const collection = laggingServer({ lagMs: 0, report: "collectionToo", carryUid: "plainva-ours" });
    await expect(collection.target.eventExists({ calendarId: CAL, uid: "plainva-ours", href: `${CAL}plainva-ours.ics` })).resolves.toBe(false);
    const outside = laggingServer({ lagMs: 0, report: "outside", carryUid: "plainva-ours" });
    await expect(outside.target.eventExists({ calendarId: CAL, uid: "plainva-ours", href: `${CAL}plainva-ours.ics` })).resolves.toBe(true);
  });

  it("a hit that carries our UID outside the calendar is never the address a create is held at - it stays at its own", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 0, dropFirstPuts: 1, report: "outside", carryUid: "plainva-stray" });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-stray" });
    expect(created).toEqual({ uid: "plainva-stray", href: `${CAL}plainva-stray.ics` });
    expect(objects.size).toBe(0);
  });

  it("an answer the server says it cut short is no answer", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 0, report: "truncated" });
    await expect(target.eventExists({ calendarId: CAL, uid: "plainva-cut", href: `${CAL}plainva-cut.ics` })).rejects.toThrow("cut its answer");
  });

  it("a read that fails (sign-in, server error) is no answer, never 'not there'", async () => {
    expect.hasAssertions();
    for (const status of [401, 503]) {
      const { target } = laggingServer({ lagMs: 0, getStatus: status });
      await expect(target.eventExists({ calendarId: CAL, uid: "plainva-y", href: `${CAL}plainva-y.ics` })).rejects.toThrow(`caldav read ${status}`);
    }
  });

  it("deleting a new event the server does not show yet waits for it and deletes it - never 'done' while it lives on", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 9_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-del-1" });
    await target.deleteEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href });
    expect(objects.size).toBe(0);
  });

  it("deleting a new event the server still does not show says so - the event is not reported gone", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 60_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-del-2" });
    await expect(target.deleteEvent({ calendarId: CAL, uid: created.uid, href: created.href })).rejects.toBeInstanceOf(PimNotShownYetError);
    expect(objects.size).toBe(1);
  });

  it("the same for a task - and its reason names a task", async () => {
    expect.hasAssertions();
    const { target, objects } = laggingServer({ lagMs: 60_000 });
    const created = await target.createTask(CAL, { title: "Buy paint", completed: false, createAs: "plainva-task-del" });
    await expect(target.deleteTask({ listId: CAL, uid: created.uid, href: created.href })).rejects.toThrow("your provider does not show this new task yet - nothing was deleted; try again in a moment");
    await expect(target.updateTask({ listId: CAL, uid: created.uid, href: created.href }, { title: "Buy paint", completed: true })).rejects.toThrow("this new task yet - the change was not saved");
    expect(objects.size).toBe(1);
  });

  it("'not shown yet' holds for fifteen minutes at most - then a 404 means gone, as on main", async () => {
    expect.hasAssertions();
    const { target } = laggingServer({ lagMs: 3600_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-quarter" });
    // The mark is set on the clock of the create; read it against that clock.
    const t0 = Date.now();
    const later = (minutes: number) => vi.spyOn(Date, "now").mockReturnValue(t0 + minutes * 60_000);
    let clock = later(14);
    await expect(target.updateEvent({ calendarId: CAL, uid: created.uid, href: created.href }, weekly)).rejects.toBeInstanceOf(PimNotShownYetError);
    clock.mockRestore();
    clock = later(16);
    await expect(target.updateEvent({ calendarId: CAL, uid: created.uid, href: created.href }, weekly)).rejects.toThrow("caldav read 404 before update");
    clock.mockRestore();
  });

  it("an event the server showed at the create is not marked: deleted elsewhere, a delete here is done and an edit is a 404, as on main", async () => {
    expect.hasAssertions();
    for (const kind of ["event", "task"] as const) {
      const { target, objects } = laggingServer({ lagMs: 0 });
      const created = kind === "event" ? await target.createEvent(CAL, { ...weekly, createAs: `plainva-k5-${kind}` }) : await target.createTask(CAL, { title: "Paint", completed: false, createAs: `plainva-k4-${kind}` });
      expect(created.etag).toBeDefined();
      objects.delete(created.href!); // deleted on another device
      if (kind === "event") {
        await expect(target.updateEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href }, weekly)).rejects.toThrow("caldav read 404 before update");
        await expect(target.deleteEvent({ calendarId: CAL, uid: created.uid, etag: created.etag, href: created.href })).resolves.toBeUndefined();
      } else {
        await expect(target.deleteTask({ listId: CAL, uid: created.uid, etag: created.etag, href: created.href })).resolves.toBeUndefined();
        await expect(target.updateTask({ listId: CAL, uid: created.uid, etag: created.etag, href: created.href }, { title: "Paint", completed: true })).rejects.toThrow("caldav read 404 before update");
      }
    }
  });

  it("an event not shown at the create is let go once a read at its address finds it - then a 404 means gone", async () => {
    expect.hasAssertions();
    const { target, objects, advance } = laggingServer({ lagMs: 20_000 });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-seen-read" });
    expect(created.etag).toBeUndefined();
    advance(30_000);
    await target.eventExists({ calendarId: CAL, uid: created.uid, href: created.href });
    objects.delete(created.href!); // then deleted on another device
    await expect(target.deleteEvent({ calendarId: CAL, uid: created.uid, href: created.href })).resolves.toBeUndefined();
  });

  it("a sync that lists it does not end 'not shown yet': a server may list an object before a read at its address finds it", async () => {
    expect.hasAssertions();
    const { target, advance } = laggingServer({ lagMs: 600_000, listEarly: true });
    const created = await target.createEvent(CAL, { ...weekly, createAs: "plainva-listed-early" });
    // Listed by a sync while a read still answers 404.
    const pulled = await target.pullEvents(CAL, Date.parse("2026-11-01T00:00:00Z"), Date.parse("2027-01-01T00:00:00Z"));
    expect(pulled.events.some((row) => row.uid.startsWith(created.uid))).toBe(true);
    advance(1_000);
    await expect(target.updateEvent({ calendarId: CAL, uid: created.uid, href: created.href }, weekly)).rejects.toBeInstanceOf(PimNotShownYetError);
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
