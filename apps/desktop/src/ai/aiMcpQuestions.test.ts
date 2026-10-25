import { describe, expect, it } from "vitest";
import { scriptedAnswers, scriptedCapabilities, scriptedQuestions, type McpElicitResult } from "@plainva/core";
import { SEARCH, answering, audit, body, connect, mcpSession, questioning, results, turn, viaDispatch } from "./mcpSessionHarness";

/**
 * A foreign server's questions to the user (plan KI-Harness P9-4a, MCP
 * 2026-07-28 elicitation in multi round-trip requests), from the model's call
 * to the server and back: the real session, the real tools, the real
 * protocol client — and a scripted server that asks.
 *
 * What these tests hold: a server asks only where the vault lets it, and
 * then only through Plainva's card; the answer goes to that server and to no
 * model; a question for a secret is not shown as a question, and its answer
 * is a no; a page opens on the user's click and is answered yes only on
 * "Continue"; the record of a run counts how the questions went, never what
 * was asked or answered.
 */

const PROJECT = "proj-hafenkante-7";
const project = { mode: "form", message: "Which project should I search?", requestedSchema: { type: "object", properties: { project: { type: "string", enum: [PROJECT, "proj-werkstatt-2"] } }, required: ["project"] } };

describe("a server that may ask", () => {
  it("asks through Plainva's card during the call, and the answer goes to the server — never to the model", async () => {
    const { s, fake, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "mixing" })] }), turn({ text: "Two issues are open." })]);
    const seen: Record<string, unknown>[] = [];
    server.onCall = (_name, _args, _count, params) => {
      seen.push(params);
      return scriptedAnswers(params) ? { content: [{ type: "text", text: "Found 2 open issues." }] } : scriptedQuestions({ p: project }, "state-1");
    };
    await connect(s, { tools: ["search_issues"], questions: true });
    answering(s, () => "once");
    const cards = questioning(s, () => ({ action: "accept", content: { project: PROJECT } }));
    expect(await s.send("Which mixing issues are open?")).toEqual({ kind: "answered" });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ serverId: "tracker", server: "Tracker", during: { kind: "tool", tool: "search_issues", title: "Search issues" }, question: { kind: "form", message: "Which project should I search?" }, opened: false });
    // Offered in the call only — a form, since this shell opens no page — and answered under the server's key, with its state.
    expect(seen.map(scriptedCapabilities)).toEqual([{ elicitation: { form: {} } }, { elicitation: { form: {} } }]);
    expect(seen[1]).toMatchObject({ requestState: "state-1", inputResponses: { p: { action: "accept", content: { project: PROJECT } } } });
    // The model saw the call's result, not the question, not the answer.
    const toModel = fake.sent.map(body).join("\n");
    expect(toModel).toContain("Found 2 open issues.");
    expect(toModel).not.toContain(PROJECT);
    expect(toModel).not.toContain("Which project should I search?");
    const record = s.getState().active!;
    expect(record.runs[0]!.mcp).toEqual({ calls: [{ server: "tracker", tool: "search_issues", outcome: "answered", questions: { answered: 1, declined: 0, cancelled: 0, refused: 0 } }] });
    expect(JSON.stringify(record)).not.toContain(PROJECT);
    expect(s.getState().question).toBeNull();
  });

  it("is offered nothing where the vault does not let it ask; one that asks anyway gets no answer, and the model hears where the user can allow it", async () => {
    const { s, files, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "mixing" })] }), turn({ text: "I could not search." })]);
    const seen: Record<string, unknown>[] = [];
    server.onCall = (_name, _args, _count, params) => {
      seen.push(params);
      return scriptedQuestions({ p: project }, "state-1");
    };
    await connect(s);
    answering(s, () => "once");
    const cards = questioning(s, () => ({ action: "accept", content: { project: PROJECT } }));
    expect(await s.send("Which mixing issues are open?")).toEqual({ kind: "answered" });
    expect(cards).toEqual([]);
    expect(seen.map(scriptedCapabilities)).toEqual([{}]);
    const record = s.getState().active!;
    expect(results(record)[0]).toMatchObject({ isError: true });
    expect(String(results(record)[0]!.content)).toContain("this server may not ask questions in this vault");
    expect(record.runs[0]!.mcp).toEqual({ calls: [{ server: "tracker", tool: "search_issues", outcome: "questions-off" }] });
    expect(audit(files).map((entry) => entry.outcome)).toEqual(["questions-off"]);
  });

  it("does not show a question for a password: the card says so, the server gets a no, and the call goes on", async () => {
    const { s, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "mixing" })] }), turn({ text: "Done." })]);
    const answers: unknown[] = [];
    server.onCall = (_name, _args, _count, params) => {
      answers.push(scriptedAnswers(params));
      return answers.length === 1
        ? scriptedQuestions({ login: { mode: "form", message: "Sign in to GitHub", requestedSchema: { type: "object", properties: { token: { type: "string", title: "API-Schlüssel für GitHub" } } } } })
        : { content: [{ type: "text", text: "Searched without GitHub." }] };
    };
    await connect(s, { tools: ["search_issues"], questions: true });
    answering(s, () => "once");
    // "Close" on the card is the only answer it has.
    const cards = questioning(s, () => ({ action: "decline" }));
    expect(await s.send("Which mixing issues are open?")).toEqual({ kind: "answered" });
    expect(cards.map((card) => card.question)).toEqual([{ kind: "refused", reason: "secret", message: "Sign in to GitHub", field: "API-Schlüssel für GitHub" }]);
    expect(answers[1]).toEqual({ login: { action: "decline" } });
    expect(s.getState().active!.runs[0]!.mcp!.calls[0]!.questions).toEqual({ answered: 0, declined: 0, cancelled: 0, refused: 1 });
  });

  it("opens a page only on the user's click, in the system's browser, and says yes to the server only on Continue", async () => {
    const opened: string[] = [];
    const { s, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "mixing" })] }), turn({ text: "Connected." })], {
      openPage: async (url) => {
        opened.push(url);
      },
    });
    const seen: Record<string, unknown>[] = [];
    server.onCall = (_name, _args, _count, params) => {
      seen.push(params);
      return scriptedAnswers(params) ? { content: [{ type: "text", text: "Connected to GitHub." }] } : scriptedQuestions({ gh: { mode: "url", message: "Connect your GitHub account.", url: "https://tracker.example.com/connect/github?state=7f3a", elicitationId: "e-1" } });
    };
    await connect(s, { tools: ["search_issues"], questions: true });
    answering(s, () => "once");
    const cards = questioning(s, (card) => {
      // Nothing is opened before the click.
      if (!card.opened) {
        expect(opened).toEqual([]);
        return "open";
      }
      return { action: "accept" };
    });
    expect(await s.send("Connect GitHub and search.")).toEqual({ kind: "answered" });
    expect(seen.map(scriptedCapabilities)[0]).toEqual({ elicitation: { form: {}, url: {} } });
    // Shown, being opened (the button rests), opened.
    expect(cards.map((card) => [card.opened, card.opening === true])).toEqual([
      [false, false],
      [false, true],
      [true, false],
    ]);
    expect(cards[0]!.question).toMatchObject({ kind: "url", host: "tracker.example.com", prefix: "https://", rest: "/connect/github?state=7f3a", punycode: false });
    expect(opened).toEqual(["https://tracker.example.com/connect/github?state=7f3a"]);
    expect(seen[1]).toMatchObject({ inputResponses: { gh: { action: "accept" } } });
  });

  it("ends the question and the call with STOP: the server is asked nothing more", async () => {
    const { s, server } = await mcpSession([turn({ calls: [viaDispatch("c1", SEARCH, { query: "mixing" })] })]);
    server.onCall = () => scriptedQuestions({ p: project });
    await connect(s, { tools: ["search_issues"], questions: true });
    answering(s, () => "once");
    const cards = questioning(s, () => {
      queueMicrotask(() => s.stop());
      return null;
    });
    const stop = await s.send("Which mixing issues are open?");
    expect(stop?.kind).toBe("cancelled");
    expect(cards).toHaveLength(1);
    expect(server.calls).toHaveLength(1);
    expect(s.getState().question).toBeNull();
  });
});

describe("a prompt of a server that may ask", () => {
  it("asks before it expands; the same answer expands to the approved text, another one is shown first instead of blocking the server", async () => {
    const { s, fake, server } = await mcpSession([turn({ text: "Standup noted." }), turn({ text: "Again." }), turn({ text: "Other project." })]);
    server.onPrompt = (_name, _args, _count, params) => {
      const answers = scriptedAnswers(params);
      return answers ? { messages: [{ role: "user", content: { type: "text", text: `Standup for ${String(answers.p?.content?.project)}` } }] } : scriptedQuestions({ p: project });
    };
    await connect(s, { tools: ["search_issues"], questions: true });
    let pick = PROJECT;
    const cards = questioning(s, () => ({ action: "accept", content: { project: pick } }));

    const first = await s.startMcpPrompt("tracker", "standup", {});
    expect(cards[0]).toMatchObject({ during: { kind: "prompt", name: "standup" }, question: { kind: "form" } });
    if (first.kind !== "review") throw new Error(`unexpected ${first.kind}`);
    expect(first.review.text).toBe(`Standup for ${PROJECT}`);
    // What the user answered is pinned as a hash, never as itself.
    expect(first.review.key).not.toContain(PROJECT);
    await s.sendMcpPrompt(first.review);
    s.newConversation();
    expect(await s.startMcpPrompt("tracker", "standup", {})).toEqual({ kind: "sent" });
    s.newConversation();
    pick = "proj-werkstatt-2";
    const other = await s.startMcpPrompt("tracker", "standup", {});
    expect(other).toMatchObject({ kind: "review", review: { text: "Standup for proj-werkstatt-2" } });
    expect(s.getState().mcp.servers[0]!.review.status).toBe("approved");
    expect(fake.sent).toHaveLength(2);
  });

  /** A prompt whose server asks first, and answers with a text once it was answered. */
  async function askingPrompt() {
    const h = await mcpSession([turn({ text: "Noted." })]);
    h.server.onPrompt = (_name, _args, _count, params) => {
      const answers = scriptedAnswers(params);
      return answers ? { messages: [{ role: "user", content: { type: "text", text: `Standup (${String(answers.p?.action)})` } }] } : scriptedQuestions({ p: project });
    };
    await connect(h.s, { tools: ["search_issues"], questions: true });
    return h;
  }

  it("ends with STOP while its question stands: nothing is sent, and no card is left behind", async () => {
    const { s, fake, server } = await askingPrompt();
    const cards = questioning(s, () => {
      queueMicrotask(() => s.stop());
      return null;
    });
    expect(await s.startMcpPrompt("tracker", "standup", {})).toEqual({ kind: "cancelled" });
    expect(cards).toHaveLength(1);
    expect(s.getState().question).toBeNull();
    expect(fake.sent).toHaveLength(0);
    // The prompt was not asked again after the stop.
    expect(server.methods.filter((method) => method === "prompts/get")).toHaveLength(1);
  });

  it("can be stopped from its first step — while the listing is looked at again, before anything is asked", async () => {
    const { s, fake, server } = await askingPrompt();
    const pending = s.startMcpPrompt("tracker", "standup", {});
    s.stop();
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(server.methods).not.toContain("prompts/get");
    expect(fake.sent).toHaveLength(0);
  });

  it("belongs to its conversation: leaving it while the question stands sends nothing anywhere", async () => {
    const { s, fake } = await askingPrompt();
    questioning(s, () => {
      queueMicrotask(() => s.newConversation());
      return null;
    });
    expect(await s.startMcpPrompt("tracker", "standup", {})).toEqual({ kind: "cancelled" });
    expect(fake.sent).toHaveLength(0);
  });

  it("is stopped by Cancel on its question, and after a no its text is read before it goes — even a text approved before", async () => {
    const { s, fake } = await askingPrompt();
    let answer: McpElicitResult = { action: "cancel" };
    questioning(s, () => answer);
    expect(await s.startMcpPrompt("tracker", "standup", {})).toEqual({ kind: "cancelled" });
    answer = { action: "decline" };
    const first = await s.startMcpPrompt("tracker", "standup", {});
    expect(first).toMatchObject({ kind: "review", review: { text: "Standup (decline)" } });
    if (first.kind !== "review") throw new Error("unexpected");
    await s.sendMcpPrompt(first.review);
    s.newConversation();
    // Approved under the same answer, it would go at once; after a no it is shown first all the same.
    expect(await s.startMcpPrompt("tracker", "standup", {})).toMatchObject({ kind: "review" });
    expect(fake.sent).toHaveLength(1);
  });
});

describe("one question at a time", () => {
  it("lets a second question wait for the first instead of taking its place, and answers only the card it was given on", async () => {
    const { s } = await mcpSession([]);
    const ask = (s as unknown as { askQuestion(request: unknown, signal?: AbortSignal): Promise<McpElicitResult> }).askQuestion.bind(s);
    const question = (id: string) => ({ id, serverId: "tracker", server: "Tracker", during: { kind: "tool", tool: "search_issues", title: "Search issues" }, question: { kind: "form", message: id, fields: [] } });
    const first = ask(question("q1"));
    const second = ask(question("q2"));
    await Promise.resolve();
    expect(s.getState().question?.id).toBe("q1");
    // An answer for a card that is not on screen goes nowhere.
    s.answerQuestion("q2", { action: "accept", content: {} });
    expect(s.getState().question?.id).toBe("q1");
    s.answerQuestion("q1", { action: "decline" });
    expect(await first).toEqual({ action: "decline" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().question?.id).toBe("q2");
    s.answerQuestion("q2", { action: "accept", content: {} });
    expect(await second).toEqual({ action: "accept", content: {} });
  });

  it("says yes to a page only once it was opened", async () => {
    const opened: string[] = [];
    const { s } = await mcpSession([], {
      openPage: async (url) => {
        opened.push(url);
      },
    });
    const ask = (s as unknown as { askQuestion(request: unknown, signal?: AbortSignal): Promise<McpElicitResult> }).askQuestion.bind(s);
    const page = { kind: "url", message: "", url: "https://tracker.example.com/connect", prefix: "https://", host: "tracker.example.com", rest: "/connect", punycode: false, ip: false };
    const waiting = ask({ id: "p1", serverId: "tracker", server: "Tracker", during: { kind: "tool", tool: "search_issues", title: "Search issues" }, question: page });
    await Promise.resolve();
    s.answerQuestion("p1", { action: "accept" });
    expect(s.getState().question?.id).toBe("p1");
    await Promise.all([s.openQuestionPage("p1"), s.openQuestionPage("p1")]);
    expect(opened).toEqual(["https://tracker.example.com/connect"]);
    s.answerQuestion("p1", { action: "accept" });
    expect(await waiting).toEqual({ action: "accept" });
  });
});
