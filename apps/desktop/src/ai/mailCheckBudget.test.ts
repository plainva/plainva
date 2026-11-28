import { describe, expect, it } from "vitest";
import { checkedOnce, engineBudgetFor, ENGINE_BUDGET_MAX_MS, ENGINE_BUDGET_MS, forgetCheckedMail } from "@plainva/ui/mail";
import { mailTooLongSinceAsked, TOO_LONG_TO_CHECK_BODY } from "@plainva/ui/ai";
import type { ConversationRecord } from "@plainva/core/ai";

/**
 * The check of a mail ends when it is done, not when a clock runs out (B7, the maintainer's decision (a), 27.11.): the
 * budget grows with the mail up to a generous limit, the answer is kept per mail, and a mail past the limit is said to
 * the person where they asked.
 */
describe("the time the check of a mail may take", () => {
  it("grows with the mail, for every width it is measured at, up to its limit", () => {
    expect.hasAssertions();
    const kb = (n: number) => "x".repeat(n * 1024);
    expect(engineBudgetFor(kb(0), [343, 760])).toBe(ENGINE_BUDGET_MS);
    expect(engineBudgetFor(kb(20), [343, 760])).toBe(ENGINE_BUDGET_MS + 20 * 500);
    // Five widths at the desktop take their share, three at the phone theirs.
    expect(engineBudgetFor(kb(20), [343, 500, 760, 900, 1200])).toBe(((ENGINE_BUDGET_MS + 20 * 500) * 5) / 2);
    expect(engineBudgetFor(kb(20), [343, 500, 760])).toBe(((ENGINE_BUDGET_MS + 20 * 500) * 3) / 2);
    // A huge mail meets the limit: a pass that never ends is the only thing it guards against.
    expect(engineBudgetFor(kb(5000), [343, 760])).toBe(ENGINE_BUDGET_MAX_MS);
  });
});

describe("the answer of the check, kept per mail", () => {
  it("is asked once for the same mail at the same widths, again for other widths or another reader document", async () => {
    expect.hasAssertions();
    forgetCheckedMail();
    const a = checkedOnce("<p>one</p>", [343, 760]);
    expect(checkedOnce("<p>one</p>", [343, 760])).toBe(a);
    expect(checkedOnce("<p>one</p>", [343, 500, 760])).not.toBe(a);
    expect(checkedOnce("<p>two</p>", [343, 760])).not.toBe(a);
    await a;
    forgetCheckedMail();
    expect(checkedOnce("<p>one</p>", [343, 760])).not.toBe(a);
  });
});

describe("a mail too long to check, said where the person asked", () => {
  const record = (parts: ConversationRecord["conversation"]["turns"]) => ({ conversation: { turns: parts } }) as unknown as ConversationRecord;
  const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
  const tool = (content: string) => ({ role: "user", parts: [{ type: "tool_result", id: "t1", content }] });

  it("is said after the question whose run met it, and no more after the next question", () => {
    expect.hasAssertions();
    const met = [user("What does the mail say?"), { role: "assistant", parts: [{ type: "tool_call", id: "t1", name: "read_mail", args: {} }] }, tool(`Subject: x\n\n${TOO_LONG_TO_CHECK_BODY}`)];
    expect(mailTooLongSinceAsked(record(met as never))).toBe(true);
    expect(mailTooLongSinceAsked(record([...met, user("Thanks.")] as never))).toBe(false);
    expect(mailTooLongSinceAsked(record([user("Hi"), tool("Subject: x\n\nHello")] as never))).toBe(false);
    expect(mailTooLongSinceAsked(null)).toBe(false);
  });
});
