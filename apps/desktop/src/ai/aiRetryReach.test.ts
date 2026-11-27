import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { DEFAULT_AI_APP_SETTINGS, effectivePolicy, notePolicyFrom, readConversationRecord, type AiEgress, type Candidate, type ConversationRecord, type EgressChunk, type HttpRequestSpec, type LedgerEntry, type WebSettings } from "@plainva/core/ai";
import { AiSession, type AiVaultHost } from "@plainva/ui/ai";
import { chat } from "./mcpSessionHarness";

/**
 * "Send again" is sent with no more reach than its content was put together for (review B7-6, M-R6-1): a turn put
 * together without the internet's tools — at a model that takes none — carries a note with `web: deny`, so its next try
 * has none of those tools either, whatever the model shown now could take. The gate's `web` dimension is the try's;
 * its `cloud` dimension is held by `keptOnDevice` (aiRetryRecipient.test.ts). W1 and W3 are the reviewer's cases.
 */
const noteTitle = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
const broke: EgressChunk[] = [{ type: "failed", code: "network", message: "error sending request: connection closed before message completed" }];

function vault(notes: Record<string, string>, candidates: Candidate[][]) {
  let web: WebSettings = { enabled: true, allow: [] };
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const host: AiVaultHost = {
    conversations: {
      async list() {
        return [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model }));
      },
      async load(id) {
        const r = saved.get(id);
        return r ? readConversationRecord(JSON.parse(JSON.stringify(r))) : null;
      },
      async save(record) {
        saved.set(record.id, JSON.parse(JSON.stringify(record)));
      },
      async remove(id) {
        saved.delete(id);
      },
      async removeAll() {
        saved.clear();
      },
    },
    ledger: {
      async load() {
        return ledger;
      },
      async save(entries) {
        ledger = [...entries];
      },
    },
    async activeNote() {
      return null;
    },
    async readNote(path) {
      return notes[path] === undefined ? null : { path, title: noteTitle(path), text: notes[path]! };
    },
    async situation() {
      return { now: "2026-11-27 10:00", weekday: "Friday", calendarDay: "2026-11-27", journalDay: "2026-11-27", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    async candidates() {
      return candidates;
    },
    policy: {
      async policyOf(path, text) {
        const plainva = readFrontmatterPath(text ?? notes[path] ?? "", ["plainva"]);
        return effectivePolicy(path, notePolicyFrom(plainva === undefined ? {} : { plainva }), []);
      },
      async resolveLink(target) {
        return Object.keys(notes).find((path) => noteTitle(path) === target) ?? null;
      },
    },
    tools() {
      return { names: ["search_vault", "read_note"], executor: { execute: async (tool) => ({ content: `${tool.name} done`, origin: { kind: "tool", tool: tool.name } }) } };
    },
    web: {
      async load() {
        return web;
      },
      async save(next) {
        web = next;
      },
    },
  };
  return host;
}

async function setup(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? broke) {
        await new Promise((r) => setTimeout(r, 0));
        onChunk(chunk);
      }
    },
    async cancel() {},
    async setKey() {},
    async hasKey() {
      return true;
    },
    async deleteKey() {},
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  let ids = 0;
  let stored: unknown = {
    ...DEFAULT_AI_APP_SETTINGS,
    enabled: true,
    providers: ["ollama"],
    profiles: { balanced: { providerId: "ollama", model: "small", tools: false }, strong: { providerId: "ollama", model: "big" } },
  };
  const s = new AiSession({
    egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-11-27",
    now: () => new Date("2026-11-27T10:00:00Z"),
    newId: () => `id${++ids}`,
    web: { fetch: async () => ({ kind: "failed", code: "offline" }) },
  });
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  const notes = { "Private.md": "---\nplainva:\n  ai:\n    web: deny\n---\n# Private\n\nthe salary is 4,200" };
  await s.load();
  await s.attachVault(vault(notes, [[{ path: "Private.md", title: "Private", signals: { lexical: 1 } }]]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, sent };
}

const body = (spec: HttpRequestSpec | undefined) => JSON.stringify(spec?.body ?? {});
const toolsOf = (spec: HttpRequestSpec | undefined) => ((spec?.body as { tools?: Array<{ function?: { name?: string }; name?: string }> })?.tools ?? []).map((t) => t.function?.name ?? t.name);

const WEB = ["fetch_url", "web_search"];
const lastRun = (s: AiSession) => {
  const runs = s.getState().active!.runs;
  return runs[runs.length - 1]!;
};

describe("'Send again' keeps the reach of its try (review B7-6, M-R6-1)", () => {
  it("W1: a turn put together at a model without tools, sent again at one with tools, carries the note and no internet tool", async () => {
    expect.hasAssertions();
    const { s, sent } = await setup([broke, chat({ text: "ok" })]);
    await s.setChoice({ providerId: "ollama", model: "small" });
    s.setDraftWeb(true);
    await s.send("What is the salary?");
    expect(body(sent[0])).toContain("4,200");
    await s.setChoice({ providerId: "ollama", model: "big" });
    await s.retryLast();
    expect(sent).toHaveLength(2);
    expect(toolsOf(sent[1]).filter((name) => WEB.includes(name!))).toEqual([]);
    const run = lastRun(s);
    expect(run.manifest).toMatchObject({ model: "big", web: false });
    expect(run.manifest!.tools.filter((name) => WEB.includes(name))).toEqual([]);
  });

  it("W3: begun with the internet at a model with tools, turn 2 at one without fails, sent again at the one with tools — no internet tool", async () => {
    expect.hasAssertions();
    const { s, sent } = await setup([chat({ text: "ok" }), broke, chat({ text: "ok3" })]);
    await s.setChoice({ providerId: "ollama", model: "big" });
    s.setDraftWeb(true);
    await s.send("What is the rate?");
    // Turn 1 had the internet: the note stayed out of it.
    expect(body(sent[0])).not.toContain("4,200");
    expect(toolsOf(sent[0])).toEqual(expect.arrayContaining(["fetch_url"]));
    await s.setChoice({ providerId: "ollama", model: "small" });
    await s.send("What is the salary?");
    expect(body(sent[1])).toContain("4,200");
    await s.setChoice({ providerId: "ollama", model: "big" });
    await s.retryLast();
    expect(sent).toHaveLength(3);
    expect(body(sent[2])).toContain("4,200");
    expect(toolsOf(sent[2]).filter((name) => WEB.includes(name!))).toEqual([]);
    expect(lastRun(s).manifest).toMatchObject({ model: "big", web: false });
    // The conversation keeps the tools it was begun with: the next message, put together anew, may have them again.
    expect(s.getState().active!.conversation.tools).toEqual(expect.arrayContaining(["fetch_url"]));
  });

  // The axis "the failed try ran without the internet / with it", against a model that takes tools and one that does not.
  const cells: Array<{ tried: "small" | "big"; to: "small" | "big" }> = [];
  for (const tried of ["small", "big"] as const) for (const to of ["small", "big"] as const) cells.push({ tried, to });
  it.each(cells)("a try put together at $tried, sent again at $to: internet tools only where both had them", async ({ tried, to }) => {
    expect.hasAssertions();
    const { s, sent } = await setup([broke, chat({ text: "ok" })]);
    await s.setChoice({ providerId: "ollama", model: tried });
    s.setDraftWeb(true);
    await s.send("What is the rate?");
    await s.setChoice({ providerId: "ollama", model: to });
    await s.retryLast();
    expect(sent).toHaveLength(2);
    const withWeb = tried === "big" && to === "big";
    expect(toolsOf(sent[1]).some((name) => WEB.includes(name!))).toBe(withWeb);
    expect(lastRun(s).manifest!.web).toBe(withWeb);
    // The note the gate keeps from a conversation with the internet goes only where the try was put together without it.
    expect(body(sent[1]).includes("4,200")).toBe(tried === "small");
  });
});
