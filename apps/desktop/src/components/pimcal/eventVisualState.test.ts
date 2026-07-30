import { describe, expect, it } from "vitest";
import { eventStateClass, eventStateLabelKey, eventVisualState } from "@plainva/ui";

/**
 * The four calendar states (report 2026-07-29, F7/F8). The model carried
 * `status` and `selfResponse` from the start and no view read either, so a
 * cancelled appointment looked exactly like one that is going ahead. These tests
 * pin the precedence, because it is the one part that is a judgement call.
 */
describe("eventVisualState", () => {
  it("treats a plain event as confirmed", () => {
    expect(eventVisualState({})).toBe("confirmed");
    expect(eventVisualState({ status: "confirmed", selfResponse: "accepted" })).toBe("confirmed");
  });

  it("lets a cancellation win over everything else", () => {
    // The appointment is off; whether you had accepted it no longer matters.
    expect(eventVisualState({ status: "cancelled", selfResponse: "accepted" })).toBe("cancelled");
    expect(eventVisualState({ status: "cancelled", selfResponse: "needsAction" })).toBe("cancelled");
    expect(eventVisualState({ status: "cancelled", selfResponse: "tentative" })).toBe("cancelled");
  });

  it("marks an unanswered invitation, even on a confirmed event", () => {
    // The organiser is sure, you have not replied — it is not yet YOUR
    // appointment, which is why it gets an outline instead of a fill (E8).
    expect(eventVisualState({ status: "confirmed", selfResponse: "needsAction" })).toBe("unanswered");
    expect(eventVisualState({ selfResponse: "needsAction" })).toBe("unanswered");
  });

  it("reads a maybe from either side as tentative", () => {
    expect(eventVisualState({ status: "tentative" })).toBe("tentative");
    expect(eventVisualState({ selfResponse: "tentative" })).toBe("tentative");
    expect(eventVisualState({ status: "tentative", selfResponse: "accepted" })).toBe("tentative");
  });

  it("shows a declined invitation as declined, not as an ordinary event", () => {
    // This assertion used to say "confirmed", on the reasoning that the event
    // still happens for everyone else. The maintainer's own calendar settled it
    // (finding 2026-07-30): whoever looks at the week is asking what THEY are
    // doing, and an accepted and a declined invitation looked identical.
    expect(eventVisualState({ selfResponse: "declined" })).toBe("declined");
  });

  it("lets a cancellation outrank your own decline", () => {
    // The organiser called it off; that is the stronger statement, and it is the
    // one everyone else sees too.
    expect(eventVisualState({ status: "cancelled", selfResponse: "declined" })).toBe("cancelled");
  });

  it("gives the declined state its own class and word", () => {
    expect(eventStateClass("pv-evt", "declined")).toBe("pv-evt pv-evt--declined");
    expect(eventStateClass("m-evt", "declined")).toBe("m-evt m-evt--declined");
    expect(eventStateLabelKey("declined")).toBe("pim.stateDeclined");
    // Distinguishable from a cancellation in words as well as in paint.
    expect(eventStateLabelKey("declined")).not.toBe(eventStateLabelKey("cancelled"));
  });
});

describe("eventStateClass", () => {
  it("adds no modifier for the ordinary case", () => {
    expect(eventStateClass("pv-evt", "confirmed")).toBe("pv-evt");
    expect(eventStateClass("m-evt", "confirmed")).toBe("m-evt");
  });

  it("carries base plus modifier per shell", () => {
    expect(eventStateClass("pv-evt", "cancelled")).toBe("pv-evt pv-evt--cancelled");
    expect(eventStateClass("m-evt", "unanswered")).toBe("m-evt m-evt--unanswered");
    expect(eventStateClass("pv-evt", "tentative")).toBe("pv-evt pv-evt--tentative");
  });
});

describe("eventStateLabelKey", () => {
  it("names the three states that carry a word and stays silent otherwise", () => {
    expect(eventStateLabelKey("cancelled")).toBe("pim.stateCancelled");
    expect(eventStateLabelKey("unanswered")).toBe("pim.stateUnanswered");
    expect(eventStateLabelKey("tentative")).toBe("pim.stateTentative");
    expect(eventStateLabelKey("confirmed")).toBeNull();
  });
});
