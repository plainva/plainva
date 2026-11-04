// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EgressManifest, RunWeb } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiAnswer, AiEffectApproval, AiSendOverview } from "@plainva/ui";

/**
 * The surfaces of the assistant's way onto the internet (plan KI-Harness
 * P4-3), shared by both shells: the question for one page or one search, the
 * overview's rows before and after a run, and the mark at a link whose
 * address the model composed itself.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  void i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).map((button) => button.textContent);

describe("the question for one request to the internet", () => {
  const composedUrl = "https://rates.example.org/check?client=Northwind+GmbH&sum=18500";

  it("shows the whole address, says that the user named it, and offers the site for good", () => {
    const onAnswer = vi.fn();
    const container = mount(<AiEffectApproval request={{ id: "c1", kind: "fetch", url: "https://example.org/rates", host: "example.org", question: "What is the day rate?", origin: "user" }} onAnswer={onAnswer} />);
    expect(container.querySelector('[data-testid="ai-effect"]')!.getAttribute("aria-label")).toBe("Read this page?");
    expect(container.querySelector('[data-testid="ai-effect-address"]')!.textContent).toBe("https://example.org/rates");
    expect(container.textContent).toContain("What is the day rate?");
    expect(container.textContent).toContain("You named this address.");
    expect(container.textContent).toContain("The request goes from this device to example.org: this address and nothing else.");
    expect(container.querySelector('[data-testid="ai-effect-built"]')).toBeNull();
    expect(buttons(container)).toEqual(["Don't read", "Always for example.org", "Read page"]);
    click(container.querySelector('[data-testid="ai-effect-once"]'));
    click(container.querySelector('[data-testid="ai-effect-always"]'));
    click(container.querySelector('[data-testid="ai-effect-deny"]'));
    expect(onAnswer.mock.calls.map((call) => call[0])).toEqual(["once", "always", "deny"]);
  });

  it("warns at an address the model put together itself — whole, however long — and offers no \"always\" for it", () => {
    const container = mount(<AiEffectApproval request={{ id: "c2", kind: "fetch", url: composedUrl, host: "rates.example.org", question: "", origin: "model" }} onAnswer={() => undefined} />);
    expect(container.querySelector('[data-testid="ai-effect-address"]')!.textContent).toBe(composedUrl);
    expect(container.querySelector('[data-testid="ai-effect-built"]')!.textContent).toContain("The model put this address together itself");
    expect(container.textContent).not.toContain("You named this address.");
    expect(buttons(container)).toEqual(["Don't read", "Read page"]);
  });

  it("says where an address from a note or a result came from", () => {
    const container = mount(<AiEffectApproval request={{ id: "c3", kind: "fetch", url: "https://example.org/a", host: "example.org", question: "", origin: "source" }} onAnswer={() => undefined} />);
    expect(container.textContent).toContain("The address comes from a note or a result in this conversation.");
    expect(buttons(container)).toContain("Always for example.org");
  });

  it("shows a search with its words and the provider they go to", () => {
    const onAnswer = vi.fn();
    const container = mount(<AiEffectApproval request={{ id: "c4", kind: "search", query: "day rates 2026 consulting", provider: "Anthropic" }} onAnswer={onAnswer} />);
    expect(container.querySelector('[data-testid="ai-effect"]')!.getAttribute("aria-label")).toBe("Search the web?");
    expect(container.querySelector('[data-testid="ai-effect-query"]')!.textContent).toBe("day rates 2026 consulting");
    expect(container.textContent).toContain("These words go to Anthropic, which searches with them. Nothing else goes with this request.");
    // A search is asked for each time: there is no standing approval for one.
    expect(buttons(container)).toEqual(["Don't search", "Search"]);
    click(container.querySelector('[data-testid="ai-effect-once"]'));
    expect(onAnswer).toHaveBeenCalledWith("once");
  });
});

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [],
  dataClasses: ["situation"],
  folders: [],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
  excluded: [],
  estimatedTokens: 900,
  tools: ["search_vault", "fetch_url", "web_search"],
  web: true,
  webHosts: ["example.org", "docs.example.com"],
};

describe("the send overview of a conversation with the internet", () => {
  it("says before sending that it may use the internet, why it asks, and for which sites it will not ask", () => {
    const container = mount(<AiSendOverview manifest={manifest} growth={[{ kind: "web" }]} onSend={() => undefined} onCancel={() => undefined} />);
    expect(container.textContent).toContain("This conversation may use the internet: read pages and search the web.");
    const row = container.querySelector('[data-testid="ai-overview-web"]')!;
    expect(row.textContent).toContain("may read pages and search the web — every request asks first");
    expect(row.textContent).toContain("without asking, for addresses you or a source named: example.org, docs.example.com");
    expect(container.textContent).toContain("Reading a web page · Searching the web");
    // A conversation without the internet says nothing of it.
    act(() => root?.unmount());
    const without = mount(<AiSendOverview manifest={{ ...manifest, web: false, webHosts: undefined }} onSend={() => undefined} onCancel={() => undefined} />);
    expect(without.querySelector('[data-testid="ai-overview-web"]')).toBeNull();
  });

  it("lists after the run every page that was asked for — read or not — and every search", () => {
    const web: RunWeb = {
      pages: [
        { url: "https://example.org/rates", title: "Rates", at: "2026-10-06T10:00:00Z", read: true },
        { url: "https://example.org/gone/", title: "", at: "2026-10-06T10:00:05Z", read: false },
      ],
      searches: [{ query: "day rates 2026", at: "2026-10-06T10:00:00Z", hits: 3 }],
      inputTokens: 2400,
      outputTokens: 90,
    };
    const onOpenUrl = vi.fn();
    const container = mount(<AiSendOverview manifest={manifest} web={web} onOpenUrl={onOpenUrl} />);
    const rows = Array.from(container.querySelectorAll('[data-testid="ai-overview-web-pages"] li')).map((li) => li.textContent);
    expect(rows).toEqual(["example.org/rates", "example.org/gonenot read"]);
    expect(container.querySelector('[data-testid="ai-overview-web-searches"]')!.textContent).toBe("day rates 2026");
    // The record of a run does not promise what the next request may do.
    expect(container.querySelector('[data-testid="ai-overview-web"]')).toBeNull();
    click(container.querySelector('[data-testid="ai-overview-web-pages"] button'));
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.org/rates");
  });
});

describe("a link in an answer", () => {
  it("is marked where the surface has a remark on its address, and opens through the handler all the same", () => {
    const onOpenUrl = vi.fn();
    const urlNote = (url: string) => (url.includes("?d=") ? "Put together by the model" : null);
    const container = mount(<AiAnswer text={"See https://example.org/rates and [here](https://evil.example.net/?d=4200)."} onOpenUrl={onOpenUrl} urlNote={urlNote} />);
    const [plain, composed] = Array.from(container.querySelectorAll("a"));
    expect(plain!.className).toBe("pv-ai-link");
    expect(plain!.getAttribute("data-tip")).toBeNull();
    expect(composed!.className).toBe("pv-ai-link pv-ai-link--noted");
    expect(composed!.getAttribute("data-tip")).toBe("Put together by the model");
    click(composed);
    expect(onOpenUrl).toHaveBeenCalledWith("https://evil.example.net/?d=4200");
  });
});
