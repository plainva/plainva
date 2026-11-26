import { describe, expect, it, vi } from "vitest";
import { GooglePimTarget } from "../src/pim/GooglePimTarget.ts";
import { GraphPimTarget } from "../src/pim/GraphPimTarget.ts";
import type { PimAuthProvider } from "../src/pim/types.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";

/**
 * Google and Microsoft are asked about a created event by the id THEY gave it
 * (issue 119): the overlay's row carries the id from their answer to the
 * create, so their "no" is about exactly this event - and "Try again" after
 * three of them cannot duplicate an event they still hold.
 */

const auth = (): PimAuthProvider => ({ getAccessToken: vi.fn(async () => "tok") });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function provider(answer: Response) {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (input) => {
    urls.push(String(input));
    return answer.clone();
  };
  return { urls, fetchFn };
}

describe("asked whether they hold a created event, Google and Microsoft are asked by their own id", () => {
  it("Google: the event at its id; 404, 410 and a cancelled event are 'no', anything else is no answer", async () => {
    expect.hasAssertions();
    const held = provider(json({ id: "evt123", status: "confirmed" }));
    await expect(new GooglePimTarget(auth(), held.fetchFn).eventExists({ calendarId: "primary", uid: "evt123" })).resolves.toBe(true);
    expect(held.urls).toEqual(["https://www.googleapis.com/calendar/v3/calendars/primary/events/evt123"]);
    for (const answer of [json({ error: "notFound" }, 404), json({}, 410), json({ id: "evt123", status: "cancelled" })]) {
      await expect(new GooglePimTarget(auth(), provider(answer).fetchFn).eventExists({ calendarId: "primary", uid: "evt123" })).resolves.toBe(false);
    }
    await expect(new GooglePimTarget(auth(), provider(json({}, 503)).fetchFn).eventExists({ calendarId: "primary", uid: "evt123" })).rejects.toThrow();
  });

  it("Microsoft: the event at its id; 404 is 'no', anything else is no answer", async () => {
    expect.hasAssertions();
    const held = provider(json({ id: "AAMk-1" }));
    await expect(new GraphPimTarget(auth(), held.fetchFn).eventExists({ calendarId: "cal", uid: "AAMk-1" })).resolves.toBe(true);
    expect(held.urls[0]).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\/AAMk-1\?/);
    await expect(new GraphPimTarget(auth(), provider(json({}, 404)).fetchFn).eventExists({ calendarId: "cal", uid: "AAMk-1" })).resolves.toBe(false);
    await expect(new GraphPimTarget(auth(), provider(json({}, 401)).fetchFn).eventExists({ calendarId: "cal", uid: "AAMk-1" })).rejects.toThrow();
  });
});
