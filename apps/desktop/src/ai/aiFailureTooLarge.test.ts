import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { aiFailureText, conversationFailureText, failureSender } from "@plainva/ui/ai";

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
    expect(aiFailureText(t, { kind: "too_large" }, cloud)).toBe("The request is too large to send. Nothing was sent. Usually an image is too big.");
    expect(failureSender({ kind: "too_large" }, cloud)).toBe("device");
  });
});

describe("a request Plainva could not put together", () => {
  it("names Plainva, and says nothing was sent", () => {
    expect(aiFailureText(t, { kind: "invalid_request", message: "x" }, cloud)).toBe("Plainva could not put this request together. Nothing was sent. Please report this as a bug.");
    expect(failureSender({ kind: "invalid_request", message: "x" }, cloud)).toBe("plainva");
  });
});

/** The conversation says a failure by its class (plan Umsetzung 0.9.x, B7): "nothing was sent" only where it holds. */
describe("a failure as the conversation says it", () => {
  it("says no connection, nothing sent and the question back in the field only where the question went back", () => {
    const failure = { kind: "unreachable" as const, message: "refused" };
    expect(conversationFailureText(t, failure, cloud, "m", { returned: true })).toBe("No connection to Anthropic — nothing was sent. Your question is back in the field.");
    // Not typed, so not back in the field: no promise about the field, and no "nothing was sent" in it either.
    expect(conversationFailureText(t, failure, cloud, "m")).toBe("Could not reach Anthropic.");
  });

  it("says that a request that broke off may have arrived", () => {
    expect(conversationFailureText(t, { kind: "offline", message: "x" }, cloud, "m")).toBe("Anthropic did not answer. The request may have arrived.");
    expect(conversationFailureText(t, { kind: "stream_broken", message: "x" }, cloud, "m")).toBe("Anthropic did not answer. The request may have arrived.");
    expect(conversationFailureText(t, { kind: "offline", message: "x" }, cloud, "m")).not.toContain("nothing was sent");
  });

  it("names a picture when a provider found a turn with one too large", () => {
    expect(conversationFailureText(t, { kind: "context_too_long", status: 413 }, cloud, "m", { images: 1 })).toBe(
      "This conversation is too long for the model. Start a new conversation. Usually an image is too big.",
    );
    expect(conversationFailureText(t, { kind: "context_too_long", status: 413 }, cloud, "m")).toBe("This conversation is too long for the model. Start a new conversation.");
  });

  it("says a certificate the device did not accept as the sync says it (F72)", () => {
    expect(aiFailureText(t, { kind: "certificate", code: "TLS_CERTIFICATE_EXPIRED", message: "x" }, cloud)).toBe("The server certificate has expired. Renew it on the server.");
  });
});
