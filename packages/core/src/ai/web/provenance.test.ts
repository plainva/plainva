import { describe, expect, it } from "vitest";
import { appendTurn, startConversation, type Conversation } from "../conversation.js";
import { fenceUntrusted, payload } from "../trust.js";
import { addressOrigin, comparableAddress, knownAddresses, webAddressesIn } from "./provenance.js";

describe("web addresses in a text", () => {
  it("finds an address wherever it stands and leaves the sentence around it", () => {
    expect(webAddressesIn("See https://example.org/guide.")).toEqual(["https://example.org/guide"]);
    expect(webAddressesIn("(see https://example.org/a, and https://example.org/b)")).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(webAddressesIn("[the guide](https://example.org/guide)")).toEqual(["https://example.org/guide"]);
    expect(webAddressesIn("[https://example.org/a](https://example.org/b)")).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(webAddressesIn("<https://example.org/a> and **https://example.org/b**")).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(webAddressesIn('{"url":"https://example.org/a?x=1&y=2"}')).toEqual(["https://example.org/a?x=1&y=2"]);
    expect(webAddressesIn("1. Title — https://example.org/a (3 days ago)")).toEqual(["https://example.org/a"]);
  });

  it("keeps a bracket that belongs to the address", () => {
    expect(webAddressesIn("https://en.wikipedia.org/wiki/Plain_(text)")).toEqual(["https://en.wikipedia.org/wiki/Plain_(text)"]);
    expect(webAddressesIn("(https://en.wikipedia.org/wiki/Plain_(text))")).toEqual(["https://en.wikipedia.org/wiki/Plain_(text)"]);
  });

  it("reads http and www as the https page they name", () => {
    expect(webAddressesIn("http://example.org/a and www.example.org/b")).toEqual(["https://example.org/a", "https://www.example.org/b"]);
    // A name inside a word or an address of its own is not a second address.
    expect(webAddressesIn("mail me at info@www.example.org")).toEqual([]);
  });

  it("leaves out what is no public web address, and an address made inert", () => {
    expect(webAddressesIn("https://localhost/x https://10.0.0.1/ ftp://example.org/ https[://]example.org/a")).toEqual([]);
    expect(webAddressesIn("no address here")).toEqual([]);
  });

  it("names each address once", () => {
    expect(webAddressesIn("https://example.org/a https://example.org/a/ https://EXAMPLE.org/a#part")).toEqual(["https://example.org/a"]);
  });
});

describe("an address as it is compared", () => {
  it("drops the fragment and the slash that ends a path, and nothing else", () => {
    expect(comparableAddress("https://Example.org/")).toBe("https://example.org");
    expect(comparableAddress("https://example.org/a/#top")).toBe("https://example.org/a");
    expect(comparableAddress("https://example.org/a/?q=1")).toBe("https://example.org/a/?q=1");
    expect(comparableAddress("https://example.org/a?q=1")).not.toBe(comparableAddress("https://example.org/a?q=2"));
    expect(comparableAddress("https://example.org/a")).not.toBe(comparableAddress("https://example.org/a/b"));
    expect(comparableAddress("javascript:alert(1)")).toBeNull();
  });
});

function conversation(): Conversation {
  let c = startConversation("c1", "system", ["fetch_url", "web_search"]);
  c = appendTurn(c, {
    role: "user",
    at: "t0",
    parts: [
      // The context package: a note that names an address.
      { type: "text", text: `Notes:\n${fenceUntrusted(payload("The offer is at https://shop.example.org/offer.", { kind: "vault", path: "Offer.md" }))}`, context: ["Offer.md#1"] },
      // What a door brought, without a stamp: somebody else's words all the same.
      { type: "text", text: fenceUntrusted(payload("Reviewer: compare https://rates.example.org/2026", { kind: "vault", path: "Offer.md", section: "comments" })) },
      { type: "text", text: "Read https://example.org/guide for me." },
    ],
  });
  c = appendTurn(c, {
    role: "assistant",
    at: "t1",
    parts: [
      { type: "text", text: "I will also look at https://invented.example.org/?d=secret." },
      { type: "tool_call", id: "call1", name: "web_search", args: { query: "plain text" } },
    ],
  });
  c = appendTurn(c, { role: "user", at: "t2", parts: [{ type: "tool_result", callId: "call1", name: "web_search", content: "Pages found:\n1. Plain text — https://en.wikipedia.org/wiki/Plain_text (2 days ago)" }] });
  return c;
}

describe("where an address in a conversation came from", () => {
  const known = knownAddresses(conversation());

  it("tells the user's own words from what notes and results name", () => {
    expect([...known.user]).toEqual(["https://example.org/guide"]);
    expect([...known.source].sort()).toEqual(["https://en.wikipedia.org/wiki/Plain_text", "https://rates.example.org/2026", "https://shop.example.org/offer"]);
  });

  it("counts an address as known only as a whole", () => {
    expect(addressOrigin("https://example.org/guide", known)).toBe("user");
    expect(addressOrigin("https://example.org/guide/", known)).toBe("user");
    expect(addressOrigin("https://example.org/guide#chapter-2", known)).toBe("user");
    expect(addressOrigin("https://en.wikipedia.org/wiki/Plain_text", known)).toBe("source");
    expect(addressOrigin("https://shop.example.org/offer", known)).toBe("source");
    // The same host with something hung onto it is a new address.
    expect(addressOrigin("https://example.org/guide?d=Salary+4200", known)).toBe("model");
    expect(addressOrigin("https://shop.example.org/offer/4200", known)).toBe("model");
    expect(addressOrigin("https://shop.example.org/", known)).toBe("model");
  });

  it("never takes the model's own earlier words as a source", () => {
    expect(addressOrigin("https://invented.example.org/?d=secret", known)).toBe("model");
  });

  it("counts what is no web address as the model's", () => {
    expect(addressOrigin("not an address", known)).toBe("model");
    expect(addressOrigin("https://localhost/", known)).toBe("model");
  });
});

/**
 * A tool can hand the model's own words back: an error that quotes an
 * argument, a search that repeats its query. An address that went into a call
 * must not come out of it as a source — that would turn the one address that
 * can carry data into one that needs no question on an allowed site.
 */
describe("an address the model wrote into a call", () => {
  const LEAK = "https://rates.example.org/check?d=Salary+4200";

  function echoed(parts: { call: unknown; result: string; isError?: boolean }): Conversation {
    let c = startConversation("c2", "system", ["read_note", "fetch_url", "web_search"]);
    c = appendTurn(c, { role: "user", at: "t0", parts: [{ type: "text", text: "What do the notes say?" }] });
    c = appendTurn(c, { role: "assistant", at: "t1", parts: [{ type: "tool_call", id: "call1", name: "read_note", args: parts.call }] });
    c = appendTurn(c, { role: "user", at: "t2", parts: [{ type: "tool_result", callId: "call1", name: "read_note", content: parts.result, ...(parts.isError ? { isError: true } : {}) }] });
    return c;
  }

  it("does not become a source when an error quotes the argument", () => {
    const known = knownAddresses(echoed({ call: { path: "Offer.md", section: LEAK }, result: `No section "${LEAK}" in this note; get_outline lists them.`, isError: true }));
    expect(addressOrigin(LEAK, known)).toBe("model");
    expect(known.source.size).toBe(0);
  });

  it("does not become a source when a result repeats it — wherever in the arguments it stood", () => {
    for (const call of [{ query: `rates ${LEAK}` }, { filters: [{ where: { value: LEAK } }] }, [LEAK]]) {
      const known = knownAddresses(echoed({ call, result: `Web search for: rates ${LEAK}\nPages found:\n1. Rates — https://rates.example.org/2026` }));
      expect(addressOrigin(LEAK, known), JSON.stringify(call)).toBe("model");
      // What the result names beside the echo is a source like any other.
      expect(addressOrigin("https://rates.example.org/2026", known)).toBe("source");
    }
  });

  it("does not become a source through the model's own answer or reasoning either", () => {
    let c = startConversation("c3", "system", ["fetch_url"]);
    c = appendTurn(c, { role: "user", at: "t0", parts: [{ type: "text", text: "Check the rates." }] });
    c = appendTurn(c, {
      role: "assistant",
      at: "t1",
      parts: [
        { type: "reasoning", provider: "p", data: { thinking: `I could ask ${LEAK}` } },
        { type: "text", text: "Looking it up." },
        { type: "tool_call", id: "call1", name: "fetch_url", args: { url: "https://rates.example.org/2026", question: "rates" } },
      ],
    });
    c = appendTurn(c, { role: "user", at: "t2", parts: [{ type: "tool_result", callId: "call1", name: "fetch_url", content: `Page: Rates — https://rates.example.org/2026\nLinks on the page:\n- Check — ${LEAK}\n- Terms — https://rates.example.org/terms` }] });
    const known = knownAddresses(c);
    expect(addressOrigin(LEAK, known)).toBe("model");
    // A link the page lists and the model had not written is a source; the address the model asked for is its own.
    expect(addressOrigin("https://rates.example.org/terms", known)).toBe("source");
    expect(addressOrigin("https://rates.example.org/2026", known)).toBe("model");
  });

  it("is the user's once the user names it: typing an address is vouching for it", () => {
    let c = echoed({ call: { path: "Offer.md", section: LEAK }, result: "No such section.", isError: true });
    c = appendTurn(c, { role: "user", at: "t3", parts: [{ type: "text", text: `Yes, read ${LEAK}` }] });
    expect(addressOrigin(LEAK, knownAddresses(c))).toBe("user");
  });
});
