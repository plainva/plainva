import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { aiFailureText, failureSender } from "@plainva/ui/ai";

/**
 * A request the device does not send (F72 of release 0.9.0): said as what it is, from the device, with the truth that
 * nothing left it — not "could not reach the provider", not "this device is offline".
 */
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const t = i18n.t.bind(i18n);
const cloud = { label: "Anthropic" };

describe("a request too large to send", () => {
  it("says that it is too large and that nothing was sent, from this device", () => {
    expect(aiFailureText(t, { kind: "too_large" }, cloud)).toBe("The request is too large to send — nothing was sent. Usually an image is too big.");
    expect(failureSender({ kind: "too_large" }, cloud)).toBe("device");
  });
});

describe("a request Plainva could not put together", () => {
  it("names Plainva, and says nothing was sent", () => {
    expect(aiFailureText(t, { kind: "invalid_request", message: "x" }, cloud)).toBe("Plainva could not put this request together — nothing was sent. Please report this as a bug.");
    expect(failureSender({ kind: "invalid_request", message: "x" }, cloud)).toBe("plainva");
  });
});
