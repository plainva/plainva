import { describe, expect, it } from "vitest";
import { createAttempt } from "./attempt";

/** One action of a person across its tries (A15): what makes a press the same one, and what a new one. */
describe("an attempt", () => {
  it("stays the same while what is sent is unchanged and nothing succeeded", () => {
    const press = createAttempt();
    expect(press.for("Call Anna")).toBe(press.for("Call Anna"));
  });

  it("is a new one once what is sent changed", () => {
    const press = createAttempt();
    const first = press.for("Call Ana");
    expect(press.for("Call Anna")).not.toBe(first);
  });

  it("is a new one after a try succeeded", () => {
    const press = createAttempt();
    const first = press.for("Water");
    press.succeeded();
    expect(press.for("Water")).not.toBe(first);
  });

  it("is never shared between two surfaces", () => {
    expect(createAttempt().for("Water")).not.toBe(createAttempt().for("Water"));
  });
});
