import { describe, expect, it } from "vitest";
import { awaitComposeDone, composeDone } from "./composeDone";

/**
 * A composer opened for somebody tells them that the mail was sent or saved
 * (AI harness P5-6) — once, and never by merely being left.
 */
describe("what a composer tells the one who opened it", () => {
  it("is told once, under the token the draft carried", () => {
    const heard: string[] = [];
    const token = awaitComposeDone((how) => heard.push(how));
    expect(token).toMatch(/^compose-\d+$/);
    composeDone(token, "sent");
    // Saved first and sent afterwards, or told twice by a hurried tap: the first counts.
    composeDone(token, "saved");
    expect(heard).toEqual(["sent"]);
  });

  it("keeps two composers apart, and is silent for a mail nobody waits for", () => {
    const heard: string[] = [];
    const first = awaitComposeDone((how) => heard.push(`first ${how}`));
    const second = awaitComposeDone((how) => heard.push(`second ${how}`));
    expect(second).not.toBe(first);
    composeDone(second, "saved");
    // An ordinary mail carries no token; a token from an older run of the app names nobody.
    composeDone(undefined, "sent");
    composeDone("compose-0", "sent");
    expect(heard).toEqual(["second saved"]);
    composeDone(first, "sent");
    expect(heard).toEqual(["second saved", "first sent"]);
  });

  it("does not grow with composers that were left without sending: the oldest waiters go", () => {
    const heard: string[] = [];
    const oldest = awaitComposeDone(() => heard.push("oldest"));
    const tokens = Array.from({ length: 20 }, (_, index) => awaitComposeDone(() => heard.push(`later ${index}`)));
    composeDone(oldest, "sent");
    expect(heard).toEqual([]);
    composeDone(tokens[0], "sent");
    composeDone(tokens[19], "saved");
    expect(heard).toEqual(["later 0", "later 19"]);
  });
});
