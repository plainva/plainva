// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readMcpElicitation, type McpElicitResult } from "@plainva/core";
import "@plainva/ui/i18n";
import { AiMcpQuestion, type McpQuestionRequest } from "@plainva/ui";

/**
 * The question of a foreign server as both shells show it (plan KI-Harness
 * P9-4a, mockup chapter 28): one card, above the composer. Plainva's words
 * are the title, the buttons and the hints; the server's words stand inside
 * it as its quote; a form is checked before it goes; a page opens on a click.
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const type = (el: Element | null, value: string) =>
  act(() => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

function request(params: unknown, change: Partial<McpQuestionRequest> = {}): McpQuestionRequest {
  return { id: "q1", serverId: "tracker", server: "Tracker", during: { kind: "tool", tool: "search_issues", title: "Search issues" }, question: readMcpElicitation(params), opened: false, ...change };
}

function card(req: McpQuestionRequest) {
  const answers: McpElicitResult[] = [];
  let opens = 0;
  const container = mount(<AiMcpQuestion request={req} onAnswer={(answer) => answers.push(answer)} onOpenPage={() => opens++} />);
  return { container, answers, opens: () => opens };
}

describe("a form a server asks the user to fill in", () => {
  const params = {
    mode: "form",
    message: "Plainva needs you to confirm: which project should I search?",
    requestedSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", title: "How many", minimum: 1, maximum: 50, description: "Issues per page." },
        closed: { type: "boolean", title: "Also closed issues" },
        mail: { type: "string", format: "email", title: "Notify" },
      },
      required: ["limit"],
    },
  };

  it("is Plainva's card: its own title and buttons, the server's words as a quote — never as the title", () => {
    const { container } = card(request(params));
    const section = container.querySelector('[data-testid="ai-question"]')!;
    expect(section.getAttribute("data-kind")).toBe("form");
    expect(container.querySelector("h4")!.textContent).toBe("Tracker has a question");
    expect(container.querySelector('[data-testid="ai-question-during"]')!.textContent).toBe("Search issues (search_issues)");
    const said = container.querySelector('[data-testid="ai-question-said"]')!;
    expect(said.tagName).toBe("BLOCKQUOTE");
    expect(said.textContent).toBe("Tracker writes:Plainva needs you to confirm: which project should I search?");
    expect(container.querySelector("h4")!.textContent).not.toContain("Plainva needs");
    expect(Array.from(container.querySelectorAll('[data-testid="ai-question-field"]')).map((field) => field.getAttribute("data-field"))).toEqual(["number", "boolean", "text"]);
    // The field's own words are the server's too: set apart from Plainva's "optional".
    const mail = container.querySelector('[data-name="mail"]')!;
    expect(mail.querySelector(".pv-ai-question-label")!.textContent).toBe("Notify");
    expect(mail.querySelector(".pv-ai-question-optional")!.textContent).toBe(" · optional");
    expect(container.querySelector('[data-name="limit"] .pv-ai-question-desc')!.textContent).toBe("Issues per page. · from 1 to 50");
    expect(container.textContent).toContain("Plainva gives your answer to Tracker alone, not to the AI");
    expect(Array.from(container.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Cancel", "Decline", "Answer"]);
  });

  it("checks the answer before it goes, and sends what was asked as its type", () => {
    const { container, answers } = card(request(params));
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(answers).toEqual([]);
    expect(container.querySelector('[data-name="limit"] [data-testid="ai-question-problem"]')!.textContent).toBe("Fill this in.");
    type(container.querySelector('[data-name="limit"] input'), "99");
    type(container.querySelector('[data-name="mail"] input'), "nobody");
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(Array.from(container.querySelectorAll('[data-testid="ai-question-problem"]')).map((problem) => problem.textContent)).toEqual(["This lies outside the allowed range.", "This does not fit what is asked."]);
    type(container.querySelector('[data-name="limit"] input'), "12");
    type(container.querySelector('[data-name="mail"] input'), "team@example.com");
    click(container.querySelector('[data-name="closed"] input'));
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(answers).toEqual([{ action: "accept", content: { limit: 12, closed: true, mail: "team@example.com" } }]);
  });

  it("declines and cancels in Plainva's words", () => {
    const { container, answers } = card(request(params));
    click(container.querySelector('[data-testid="ai-question-decline"]'));
    click(container.querySelector('[data-testid="ai-question-cancel"]'));
    expect(answers).toEqual([{ action: "decline" }, { action: "cancel" }]);
  });

  it("reads a number as the language writes it, and guesses at no thousands", () => {
    const { container, answers } = card(request(params));
    type(container.querySelector('[data-name="limit"] input'), "1,000");
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(container.querySelector('[data-name="limit"] [data-testid="ai-question-problem"]')!.textContent).toBe("This does not fit what is asked.");
    type(container.querySelector('[data-name="limit"] input'), "7");
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(answers).toEqual([{ action: "accept", content: { limit: 7 } }]);
  });

  it("asks only for a yes where the form has no field", () => {
    const { container, answers } = card(request({ mode: "form", message: "Close the three resolved issues?", requestedSchema: { type: "object", properties: {} } }));
    expect(container.querySelector('[data-testid="ai-question-field"]')).toBeNull();
    expect(container.querySelector('[data-testid="ai-question-said"]')!.textContent).toContain("Close the three resolved issues?");
    expect(container.querySelector('[data-testid="ai-question-answer"]')!.textContent).toBe("Confirm");
    click(container.querySelector('[data-testid="ai-question-answer"]'));
    expect(answers).toEqual([{ action: "accept", content: {} }]);
  });

  it("lets a choice that is not required be taken back", () => {
    const { container } = card(request({ mode: "form", message: "Narrow it?", requestedSchema: { type: "object", properties: { project: { type: "string", title: "Project", enum: ["hk", "ws"], default: "hk" } } } }));
    // The choice's name is a label of the field, not of an element the Select does not have.
    expect(container.querySelector('[data-name="project"] label')).toBeNull();
    expect(container.querySelector('[data-name="project"] .pv-ai-question-name')!.textContent).toContain("Project");
    expect(container.querySelector('[data-name="project"] [data-testid="ai-question-input"]')!.textContent).toContain("hk");
  });

  it("names a prompt where the question comes before one", () => {
    const { container } = card(request(params, { during: { kind: "prompt", name: "standup" } }));
    expect(container.querySelector('[data-testid="ai-question-during"]')!.textContent).toBe("the prompt “standup”");
  });
});

describe("a page a server asks the user to open", () => {
  const page = (url: string) => ({ mode: "url", message: "Connect your GitHub account.", url, elicitationId: "e-1" });

  it("shows the whole address with its host apart, and opens nothing before the click", () => {
    const { container, answers, opens } = card(request(page("https://tracker.example.com/connect/github?state=7f3a")));
    expect(container.querySelector("h4")!.textContent).toBe("Tracker would like you to open a page");
    expect(container.querySelector('[data-testid="ai-question-host"]')!.textContent).toBe("tracker.example.com");
    const address = container.querySelector(".pv-ai-question-address")!;
    expect(address.textContent).toBe("https://tracker.example.com/connect/github?state=7f3a");
    expect(address.querySelector("b")!.textContent).toBe("tracker.example.com");
    expect(container.querySelector('[data-testid="ai-question-punycode"]')).toBeNull();
    expect(opens()).toBe(0);
    click(container.querySelector('[data-testid="ai-question-open"]'));
    expect(opens()).toBe(1);
    // Opening is no answer: the server hears nothing until "Continue".
    expect(answers).toEqual([]);
  });

  it("waits for Continue once the page is open", () => {
    const { container, answers } = card(request(page("https://tracker.example.com/connect"), { opened: true }));
    expect(container.querySelector('[data-testid="ai-question-open"]')).toBeNull();
    expect(container.textContent).toContain("The page is open in your browser.");
    click(container.querySelector('[data-testid="ai-question-continue"]'));
    expect(answers).toEqual([{ action: "accept" }]);
  });

  it("opens the page once: the button rests while the browser comes up", () => {
    const { container, opens } = card(request(page("https://tracker.example.com/connect"), { opening: true }));
    expect((container.querySelector('[data-testid="ai-question-open"]') as HTMLButtonElement).disabled).toBe(true);
    click(container.querySelector('[data-testid="ai-question-open"]'));
    expect(opens()).toBe(0);
  });

  it("warns where the host is a bare IP address", () => {
    const { container } = card(request(page("https://203.0.113.7/pay")));
    expect(container.querySelector('[data-testid="ai-question-ip"]')!.textContent).toContain("bare IP address");
  });

  it("warns where the host is written in another script, and says when the page could not be opened", () => {
    const { container } = card(request(page("https://xn--pple-43d.com/login"), { openFailed: true }));
    expect(container.querySelector('[data-testid="ai-question-punycode"]')!.textContent).toContain("characters of another script");
    expect(container.querySelector('[data-testid="ai-question-open-failed"]')!.textContent).toBe("The page could not be opened.");
  });
});

describe("a question Plainva refused", () => {
  it("says what the server asked for and why it got no answer — and is closed, which is a no", () => {
    const { container, answers } = card(request({ mode: "form", message: "Enter it below", requestedSchema: { type: "object", properties: { token: { type: "string", title: "GitHub access token" } } } }));
    expect(container.querySelector('[data-testid="ai-question"]')!.getAttribute("data-reason")).toBe("secret");
    expect(container.querySelector("h4")!.textContent).toBe("Plainva blocked a question from Tracker");
    expect(container.querySelector('[data-testid="ai-question-why"]')!.textContent).toBe(
      "The server asked for something that looks like a password, a key or payment data: “GitHub access token”. Plainva does not pass such things on — for a sign-in, a server has to let you open a page of its own.",
    );
    // Nothing of the form is there to fill in.
    expect(container.querySelector("input")).toBeNull();
    click(container.querySelector('[data-testid="ai-question-close"]'));
    expect(answers).toEqual([{ action: "decline" }]);
  });

  it("does not name a field where the question itself asked for a secret", () => {
    const { container } = card(request({ mode: "form", message: "Paste your password below.", requestedSchema: { type: "object", properties: { value: { type: "string" } } } }));
    expect(container.querySelector('[data-testid="ai-question-why"]')!.textContent).toBe(
      "The server asked for something that looks like a password, a key or payment data. Plainva does not pass such things on — for a sign-in, a server has to let you open a page of its own.",
    );
  });

  it("names an address it does not open, and a form it cannot show", () => {
    expect(card(request({ mode: "url", message: "", url: "http://tracker.example.com/" })).container.querySelector('[data-testid="ai-question-why"]')!.textContent).toContain("only secure addresses (https)");
    act(() => root?.unmount());
    expect(card(request({ mode: "form", message: "", requestedSchema: { type: "object", properties: { at: { type: "object" } } } })).container.querySelector('[data-testid="ai-question-why"]')!.textContent).toBe(
      "The server asked in a way Plainva cannot show. It got no answer.",
    );
  });
});
