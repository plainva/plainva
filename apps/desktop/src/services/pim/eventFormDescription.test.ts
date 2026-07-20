import { describe, it, expect } from "vitest";
import { emptyEventForm, eventFormToDraft, type EventFormValues } from "./calendarModel";

function form(overrides: Partial<EventFormValues>): EventFormValues {
  return { ...emptyEventForm("2026-08-01", "acc cal"), ...overrides };
}

// P3/P4: the description is canonical Markdown, only written when touched, and
// carries rendered HTML for providers that accept it.
describe("eventFormToDraft description touched-guard", () => {
  it("leaves description undefined when untouched (a drag / other-field edit preserves the remote body)", () => {
    const d = eventFormToDraft(form({ description: "loaded remote text", descriptionTouched: false }));
    expect(d.description).toBeUndefined();
    expect(d.descriptionHtml).toBeUndefined();
  });

  it("sends the Markdown source plus rendered HTML once the description is edited", () => {
    const d = eventFormToDraft(form({ description: "**bold** and a [link](https://x.io)", descriptionTouched: true }));
    expect(d.description).toBe("**bold** and a [link](https://x.io)");
    expect(d.descriptionHtml).toContain("<strong>bold</strong>");
    expect(d.descriptionHtml).toContain("x.io");
  });

  it("clears the description when the user empties it (touched-empty)", () => {
    const d = eventFormToDraft(form({ description: "   ", descriptionTouched: true }));
    expect(d.description).toBe("");
    expect(d.descriptionHtml).toBe("");
  });
});
