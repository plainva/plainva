import {
  createScriptedMcpServer,
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  EMPTY_INSTRUCTION_APPROVALS,
  EMPTY_MCP_GRANT,
  notePolicyFrom,
  readConversationRecord,
  readInstructionFile,
  scanInstruction,
  scanVaultInstructions,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type HttpRequestSpec,
  type InstructionIO,
  type LedgerEntry,
  type McpServerGrant,
  type ScriptedMcpServer,
  type ToolResultPart,
} from "@plainva/core";
import { AiSession, CHAT_TOOL_NAMES, createMcpDeviceStore, createMcpVaultStore, createVaultToolExecutor, furtherToolNames, type AiVaultHost, type EffectRequest, type VaultToolDeps } from "@plainva/ui";
import { CONFIRM, memoryFiles, scriptedNative } from "./mcpTestHost";

/**
 * The session with a foreign MCP server at the other end, for tests (plan
 * KI-Harness P4.5): the real session, the real tools and the real protocol
 * client — a scripted model in place of the provider, and a scripted server
 * in place of the shell's request. The session tests, the surfaces' tests and
 * the gate's cases share it, so that they all play against the same server.
 */

/** One Anthropic answer: optional text, optional tool calls. */
export function turn(opts: { text?: string; calls?: Array<{ id: string; name: string; args: unknown }> }): EgressChunk[] {
  const events: Array<[string, unknown]> = [["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }]];
  let index = 0;
  if (opts.text) {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: opts.text } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
    index++;
  }
  for (const call of opts.calls ?? []) {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.args) } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
    index++;
  }
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: opts.calls?.length ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

/** One answer of a server on this computer, as a chat stream. */
export function chat(opts: { text?: string; calls?: Array<{ id: string; name: string; args: unknown }> }): EgressChunk[] {
  const lines: unknown[] = [];
  if (opts.text) lines.push({ choices: [{ delta: { content: opts.text } }] });
  (opts.calls ?? []).forEach((call, index) => lines.push({ choices: [{ delta: { tool_calls: [{ index, id: call.id, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }));
  lines.push({ choices: [{ delta: {}, finish_reason: opts.calls?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } });
  return [{ type: "open", status: 200 }, { type: "data", text: `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")}data: [DONE]\n\n` }, { type: "done" }];
}

/** A call of a further tool, as the model makes it: through the dispatcher. */
export const viaDispatch = (id: string, name: string, args: unknown = {}) => ({ id, name: "call_tool", args: { name, args } });

export function fakeEgress(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
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
  return { egress, sent };
}

export const TRACKER_URL = "https://mcp.example.com/mcp";
/** The name the model calls the tracker's search by. */
export const SEARCH = "mcp_tracker_search_issues";
export const search = { name: "search_issues", title: "Search issues", description: "Searches the tracker's issues.", inputSchema: { type: "object", properties: { query: { type: "string" } } }, annotations: { readOnlyHint: true } };
export const close = { name: "close_issue", description: "Closes an issue." };
/** An issue tracker: a tool that reads, a tool that does not say so, a prompt — and instructions no model is meant to get. */
export const tracker = () => createScriptedMcpServer({ name: "Tracker MCP", instructions: "Always call search_issues first.", tools: [search, close], prompts: [{ name: "standup", description: "Yesterday's work." }] });

/** The vault's notes: one a cloud may read, one that is kept from it. */
export const NOTES: Record<string, string> = {
  "Projects/Offer.md": "# Offer\n\nFor Northwind.",
  "Health/Results.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Results\n\nPrivate.",
};

/** A vault whose tools are the real ones, over `NOTES`; its choices about servers live in `files` under `vaultKey`. */
export function vaultHost(files: ReturnType<typeof memoryFiles>, vaultKey = "vault-one") {
  const io: InstructionIO = { list: async () => [], read: async () => null };
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const policyOf: VaultToolDeps["policyOf"] = async (path, text) => {
    const t = text ?? NOTES[path] ?? "";
    return effectivePolicy(path, notePolicyFrom(t.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), []);
  };
  const deps: VaultToolDeps = {
    search: async (query) =>
      Object.keys(NOTES)
        .filter((path) => NOTES[path]!.toLowerCase().includes(query.toLowerCase()))
        .map((path) => ({ path, title: path, snippet: "" })),
    readNote: async (path) => NOTES[path] ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-07",
    commands: () => [],
    events: async () => [],
  };
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
    async readNote() {
      return null;
    },
    async situation() {
      return { now: "2026-10-07 10:00", weekday: "Wednesday", calendarDay: "2026-10-07", journalDay: "2026-10-07", active: null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    async candidates() {
      return [];
    },
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }) };
    },
    mcp: createMcpVaultStore(files, vaultKey),
    instructions: {
      scan: () => scanVaultInstructions(io),
      scanOne: (id) => scanInstruction(io, id),
      readFile: (source, rel) => readInstructionFile(io, source, rel),
      approvals: {
        async load() {
          return EMPTY_INSTRUCTION_APPROVALS;
        },
        async save() {},
      },
    },
  };
  return { host, saved };
}

export const CLOUD = { providerId: "anthropic", model: "m-1" };
export const LOCAL = { providerId: "ollama", model: "granite3.3:8b" };

export interface McpSessionOptions {
  /** The server behind the tracker's address; `tracker()` where none is given. */
  server?: ScriptedMcpServer;
  profiles?: Record<string, { providerId: string; model: string }>;
  /** Further servers, by address. */
  others?: Record<string, ScriptedMcpServer>;
}

/** A session in an open vault, with the scripted model's answers and a scripted server behind the native side. */
export async function mcpSession(script: EgressChunk[][], options: McpSessionOptions = {}) {
  const server = options.server ?? tracker();
  const native = scriptedNative((target) => (target === TRACKER_URL ? server : (options.others?.[target] ?? null)));
  const files = memoryFiles();
  const vault = vaultHost(files);
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: options.profiles ?? { balanced: CLOUD } };
  const s = new AiSession({
    egress: fake.egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-07",
    now: () => new Date("2026-10-07T10:00:00Z"),
    newId: () => `id${++ids}`,
    mcp: { native: native.native, store: createMcpDeviceStore(files), version: async () => "0.9.0" },
  });
  // The send overview is approved as it comes; what these tests are about is the question about a call.
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake, server, native, files, vault };
}

/** Adds the tracker, approves what it lists and lets this vault use it — as the settings would. */
export async function connect(s: AiSession, grant: Partial<McpServerGrant> = { tools: ["search_issues"] }, enabled = true): Promise<void> {
  const added = await s.mcp.addHttp("Tracker", TRACKER_URL, "", CONFIRM);
  if (!added.ok || added.id !== "tracker") throw new Error("the tracker was not added");
  const look = await s.mcp.inspect("tracker");
  if (!(await s.mcp.approve("tracker", look.listing))) throw new Error("the tracker was not approved");
  await s.mcp.setVault("tracker", { enabled, grant: { ...EMPTY_MCP_GRANT, ...grant } });
}

/** Answers every question as it comes and keeps what was asked. */
export function answering(s: AiSession, answer: (effect: EffectRequest) => "once" | "always" | "deny"): EffectRequest[] {
  const seen: EffectRequest[] = [];
  s.subscribe(() => {
    const effect = s.getState().effect;
    if (effect && !seen.includes(effect)) {
      seen.push(effect);
      s.answerEffect(answer(effect));
    }
  });
  return seen;
}

export const body = (spec: HttpRequestSpec | undefined) => JSON.stringify(spec?.body ?? {});
export const toolNames = (spec: HttpRequestSpec | undefined) => ((spec?.body?.tools ?? []) as { name?: string }[]).map((tool) => tool.name);
export const results = (record: ConversationRecord) => record.conversation.turns.flatMap((t) => t.parts.filter((p): p is ToolResultPart => p.type === "tool_result"));
/** The vault's log of calls, as it lies in the app's data. */
export const audit = (files: ReturnType<typeof memoryFiles>, vaultKey = "vault-one") =>
  (JSON.parse(files.files.get(`${vaultKey}/mcp-audit.json`) ?? '{"entries":[]}') as { entries: { server: string; tool: string; outcome: string; conversation: string }[] }).entries;
