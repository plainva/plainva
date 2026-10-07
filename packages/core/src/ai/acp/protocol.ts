import { capMcpText } from "../mcp/listing.js";

/**
 * The Agent Client Protocol as Plainva reads it (plan KI-Harness P4.6): an
 * external agent — somebody else's program, started on this computer with its
 * own sign-in — talks to the app that hosts it in JSON-RPC, one message per
 * line on its standard input and output.
 *
 * Plainva is the host ("client" in the protocol's words). Everything an agent
 * sends is a stranger's text: it is read defensively, cut where it is long,
 * cleaned of characters nobody sees, and never the ground of a decision. What
 * a message is called and how it is shaped is here; what Plainva does about
 * it is `client.ts` and the session in packages/ui.
 */

/** The one revision Plainva speaks. An agent that answers with another is not talked to. */
export const ACP_PROTOCOL_VERSION = 1;

/** The longest message that is read, in characters. A whole note in a write fits; a megabyte of nothing does not need to. */
export const ACP_MESSAGE_LIMIT = 4 * 1024 * 1024;
/** One piece of streamed text. */
export const ACP_CHUNK_LIMIT = 200_000;
/** A title, a label, a name the agent chose: shown in one line. */
export const ACP_TITLE_LIMIT = 300;
export const ACP_NAME_LIMIT = 80;
export const ACP_ID_LIMIT = 200;
export const ACP_PATH_LIMIT = 4096;
export const ACP_MAX_OPTIONS = 8;
export const ACP_MAX_PLAN_ENTRIES = 100;
export const ACP_MAX_LOCATIONS = 20;
export const ACP_MAX_CONTENT = 20;
export const ACP_MAX_AUTH_METHODS = 10;
export const ACP_MAX_AUTH_ARGS = 16;
export const ACP_MAX_AUTH_ENV = 16;
/** A file an agent writes through the host: a note, not an archive. */
export const ACP_FILE_LIMIT = 2 * 1024 * 1024;
/** An agent's own error text is cut here: it is shown, and it is a stranger's words. */
export const ACP_ERROR_TEXT_LIMIT = 300;

export const ACP_ERROR_AUTH_REQUIRED = -32000;
export const ACP_ERROR_NOT_FOUND = -32002;
export const ACP_ERROR_METHOD_NOT_FOUND = -32601;
export const ACP_ERROR_INVALID_PARAMS = -32602;
export const ACP_ERROR_INTERNAL = -32603;

export type AcpFailure =
  /** The program could not be started. `detail` is the shell's word for why. */
  | { kind: "unreachable"; detail?: string }
  /** The program ended. */
  | { kind: "exited"; code: number | null }
  | { kind: "timeout" }
  | { kind: "cancelled" }
  /** An answer that is not the protocol. */
  | { kind: "protocol"; detail: string }
  /** The agent speaks another revision; `offered` is the one it named. */
  | { kind: "version"; offered: number | null }
  /** The agent wants a sign-in first. */
  | { kind: "auth" }
  /** The agent answered with an error of its own. `message` is its text: cut, and data like every other. */
  | { kind: "rpc"; code: number; message: string };

/** A failure in plain words, for a log line. The surfaces say each kind in the user's language. */
export function acpFailureText(failure: AcpFailure): string {
  switch (failure.kind) {
    case "unreachable":
      return "The agent could not be started.";
    case "exited":
      return "The agent's program ended.";
    case "timeout":
      return "The agent did not answer in time.";
    case "cancelled":
      return "The request was stopped.";
    case "protocol":
      return `The agent's answer could not be read (${failure.detail}).`;
    case "version":
      return "The agent speaks a revision of the protocol that Plainva does not know.";
    case "auth":
      return "The agent wants a sign-in.";
    case "rpc":
      return `The agent answered with an error (${failure.code}).`;
  }
}

export class AcpError extends Error {
  readonly failure: AcpFailure;
  constructor(failure: AcpFailure) {
    super(acpFailureText(failure));
    this.name = "AcpError";
    this.failure = failure;
  }
}

/** Whatever was thrown, as a failure: a port may throw an `AcpError` of its own, anything else is "unreachable". */
export function asAcpError(error: unknown): AcpError {
  if (error instanceof AcpError) return error;
  return new AcpError({ kind: "unreachable", detail: (error instanceof Error ? error.message : String(error)).slice(0, ACP_ERROR_TEXT_LIMIT) });
}

/**
 * What Plainva answers a request of the agent with when it does not do what
 * was asked: a JSON-RPC error whose text the agent's model reads. The text is
 * Plainva's own, fixed and in English — never a path the agent did not name,
 * never a system message.
 */
export class AcpRefusal extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "AcpRefusal";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A stranger's text for one line: cleaned, cut, without line breaks. */
function line(raw: unknown, limit: number): string {
  return capMcpText(raw, limit).text.replace(/\s+/g, " ").trim();
}

/** A stranger's text that may have lines: cleaned and cut. */
function text(raw: unknown, limit: number): string {
  return capMcpText(raw, limit).text;
}

/** An identifier the agent chose: kept as it is where it is short and has no control character, refused otherwise. */
function id(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ACP_ID_LIMIT) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return raw;
}

export interface AcpRpcError {
  code: number;
  message: string;
}

export type AcpMessage =
  /** `id` is null where the agent could not tell which request it answers. */
  | { kind: "response"; id: number | string | null; result?: Record<string, unknown>; error?: AcpRpcError }
  | { kind: "request"; id: number | string; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string; params: Record<string, unknown> };

/** One JSON-RPC message as the agent sent it; null for anything that is none. */
export function readAcpMessage(raw: unknown): AcpMessage | null {
  if (!isRecord(raw)) return null;
  const messageId = typeof raw.id === "number" || typeof raw.id === "string" ? raw.id : null;
  if (typeof raw.method === "string") {
    if (raw.method.length === 0 || raw.method.length > 100) return null;
    const params = isRecord(raw.params) ? raw.params : {};
    return messageId === null ? { kind: "notification", method: raw.method, params } : { kind: "request", id: messageId, method: raw.method, params };
  }
  if (isRecord(raw.error)) {
    const code = typeof raw.error.code === "number" && Number.isFinite(raw.error.code) ? raw.error.code : 0;
    return { kind: "response", id: messageId, error: { code, message: line(raw.error.message, ACP_ERROR_TEXT_LIMIT) } };
  }
  // A result is an object in this protocol; anything else is read as an empty one, never as a crash.
  if ("result" in raw) return { kind: "response", id: messageId, result: isRecord(raw.result) ? raw.result : {} };
  return null;
}

/** An agent's own error as a failure. "Sign in first" has a code of its own. */
export function acpRpcFailure(error: AcpRpcError): AcpFailure {
  if (error.code === ACP_ERROR_AUTH_REQUIRED) return { kind: "auth" };
  return { kind: "rpc", code: error.code, message: error.message };
}

/* ---- what an agent says about itself ------------------------------------------------------ */

export interface AcpAuthMethod {
  id: string;
  /** The agent's own name for it. For display. */
  name: string;
  description: string;
  /**
   * How it is done. "agent": the agent does it when it is asked to. "terminal":
   * its own program, started once more in a terminal with `args` and `env`
   * added — the person signs in there, and Plainva sees none of it.
   */
  kind: "agent" | "terminal";
  args: string[];
  env: Record<string, string>;
}

export interface AcpOpened {
  /** What the agent calls itself — for display, never the ground of a decision. */
  agent: { name: string; title: string; version: string } | null;
  /** What a message to it may carry beyond text and links. */
  prompt: { image: boolean; audio: boolean; embeddedContext: boolean };
  authMethods: AcpAuthMethod[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** An argument or a value for the agent's own program: one line of printable text. */
function printable(raw: unknown, limit: number): string | null {
  if (typeof raw !== "string" || raw.length > limit) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return raw;
}

function readAuthMethod(raw: unknown): AcpAuthMethod | null {
  if (!isRecord(raw)) return null;
  const methodId = id(raw.id);
  if (!methodId) return null;
  const name = line(raw.name, ACP_NAME_LIMIT) || methodId.slice(0, ACP_NAME_LIMIT);
  const description = line(raw.description, ACP_TITLE_LIMIT);
  if (raw.type === undefined || raw.type === null || raw.type === "agent") return { id: methodId, name, description, kind: "agent", args: [], env: {} };
  // Every other way to sign in — a key in a variable, a link — is one Plainva would have to carry out or hold a secret for: not offered.
  if (raw.type !== "terminal") return null;
  const args: string[] = [];
  for (const arg of Array.isArray(raw.args) ? raw.args : []) {
    const value = printable(arg, 1024);
    if (value === null || args.length === ACP_MAX_AUTH_ARGS) return null;
    args.push(value);
  }
  const env: Record<string, string> = {};
  const entries = isRecord(raw.env) ? Object.entries(raw.env) : [];
  if (entries.length > ACP_MAX_AUTH_ENV) return null;
  for (const [key, entry] of entries) {
    const value = printable(entry, 4096);
    if (!ENV_NAME.test(key) || value === null) return null;
    env[key] = value;
  }
  return { id: methodId, name, description, kind: "terminal", args, env };
}

/** Reads the answer to `initialize`. A revision other than Plainva's is a failure, not a guess. */
export function readAcpInitialize(result: Record<string, unknown>): AcpOpened {
  const version = typeof result.protocolVersion === "number" && Number.isFinite(result.protocolVersion) ? result.protocolVersion : null;
  if (version !== ACP_PROTOCOL_VERSION) throw new AcpError({ kind: "version", offered: version });
  const info = isRecord(result.agentInfo) ? result.agentInfo : null;
  const name = info ? line(info.name, ACP_NAME_LIMIT) : "";
  const capabilities = isRecord(result.agentCapabilities) ? result.agentCapabilities : {};
  const prompt = isRecord(capabilities.promptCapabilities) ? capabilities.promptCapabilities : {};
  const authMethods: AcpAuthMethod[] = [];
  for (const raw of Array.isArray(result.authMethods) ? result.authMethods.slice(0, ACP_MAX_AUTH_METHODS) : []) {
    const method = readAuthMethod(raw);
    if (method && !authMethods.some((known) => known.id === method.id)) authMethods.push(method);
  }
  return {
    agent: info && name ? { name, title: line(info.title, ACP_NAME_LIMIT), version: line(info.version, 40) } : null,
    prompt: { image: prompt.image === true, audio: prompt.audio === true, embeddedContext: prompt.embeddedContext === true },
    authMethods,
  };
}

/** Reads the answer to `session/new`: the id every later message of the session carries. */
export function readAcpNewSession(result: Record<string, unknown>): string {
  const sessionId = id(result.sessionId);
  if (!sessionId) throw new AcpError({ kind: "protocol", detail: "no session id" });
  return sessionId;
}

export const ACP_STOP_REASONS = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const;
export type AcpStopReason = (typeof ACP_STOP_REASONS)[number];

/** Why a turn ended. A reason Plainva does not know is an end like any other. */
export function readAcpStopReason(result: Record<string, unknown>): AcpStopReason {
  return (ACP_STOP_REASONS as readonly unknown[]).includes(result.stopReason) ? (result.stopReason as AcpStopReason) : "end_turn";
}

/* ---- what an agent reports while it works ------------------------------------------------- */

export const ACP_TOOL_KINDS = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"] as const;
export type AcpToolKind = (typeof ACP_TOOL_KINDS)[number];
export const ACP_TOOL_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;
export type AcpToolStatus = (typeof ACP_TOOL_STATUSES)[number];

export interface AcpToolLocation {
  /** As the agent wrote it: an absolute path on this computer. */
  path: string;
  line: number | null;
}

export type AcpToolContent =
  | { type: "text"; text: string }
  /** A change to a file as the agent describes it: where, and how many lines before and after — the texts themselves are not kept. */
  | { type: "diff"; path: string; oldLines: number | null; newLines: number }
  | { type: "terminal" };

/** One tool call of the agent: announced (`fresh`), or changed — then only what changed is named. */
export interface AcpToolUpdate {
  id: string;
  fresh: boolean;
  title?: string;
  toolKind?: AcpToolKind;
  status?: AcpToolStatus;
  locations?: AcpToolLocation[];
  content?: AcpToolContent[];
}

export interface AcpPlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

export type AcpUpdate =
  | { kind: "text"; role: "agent" | "thought" | "user"; text: string }
  | { kind: "tool"; tool: AcpToolUpdate }
  | { kind: "plan"; entries: AcpPlanEntry[] }
  /** Something Plainva shows nothing for: commands, modes, usage. */
  | { kind: "other"; name: string };

const countLines = (value: string): number => (value === "" ? 0 : value.split("\n").length);

/** A content block as text: what it says, or a word for what it is. Nothing is fetched, nothing is drawn. */
export function acpBlockText(raw: unknown, limit: number = ACP_CHUNK_LIMIT): string {
  if (!isRecord(raw)) return "";
  switch (raw.type) {
    case "text":
      return text(raw.text, limit);
    case "resource_link": {
      const name = line(raw.name, ACP_NAME_LIMIT) || line(raw.title, ACP_NAME_LIMIT);
      const uri = line(raw.uri, 2048);
      return name && uri ? `${name} (${uri})` : name || uri;
    }
    case "resource":
      return isRecord(raw.resource) ? text(raw.resource.text, limit) : "";
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    default:
      return "";
  }
}

function readLocations(raw: unknown): AcpToolLocation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AcpToolLocation[] = [];
  for (const entry of raw.slice(0, ACP_MAX_LOCATIONS)) {
    if (!isRecord(entry)) continue;
    const path = printable(entry.path, ACP_PATH_LIMIT);
    if (!path) continue;
    out.push({ path, line: typeof entry.line === "number" && Number.isInteger(entry.line) && entry.line >= 0 ? entry.line : null });
  }
  return out;
}

function readToolContent(raw: unknown): AcpToolContent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AcpToolContent[] = [];
  for (const entry of raw.slice(0, ACP_MAX_CONTENT)) {
    if (!isRecord(entry)) continue;
    if (entry.type === "content") {
      const said = acpBlockText(entry.content, 20_000);
      if (said) out.push({ type: "text", text: said });
    } else if (entry.type === "diff") {
      const path = printable(entry.path, ACP_PATH_LIMIT);
      if (path && typeof entry.newText === "string") out.push({ type: "diff", path, oldLines: typeof entry.oldText === "string" ? countLines(entry.oldText) : null, newLines: countLines(entry.newText) });
    } else if (entry.type === "terminal") {
      out.push({ type: "terminal" });
    }
  }
  return out;
}

/** A tool call as a message carries it; null where it names none. */
export function readAcpToolCall(raw: unknown, fresh: boolean): AcpToolUpdate | null {
  if (!isRecord(raw)) return null;
  const toolId = id(raw.toolCallId);
  if (!toolId) return null;
  const tool: AcpToolUpdate = { id: toolId, fresh };
  const title = line(raw.title, ACP_TITLE_LIMIT);
  if (title) tool.title = title;
  if ((ACP_TOOL_KINDS as readonly unknown[]).includes(raw.kind)) tool.toolKind = raw.kind as AcpToolKind;
  if ((ACP_TOOL_STATUSES as readonly unknown[]).includes(raw.status)) tool.status = raw.status as AcpToolStatus;
  const locations = readLocations(raw.locations);
  if (locations) tool.locations = locations;
  const content = readToolContent(raw.content);
  if (content) tool.content = content;
  return tool;
}

const PRIORITIES: readonly unknown[] = ["high", "medium", "low"];
const PLAN_STATUSES: readonly unknown[] = ["pending", "in_progress", "completed"];

/** Reads a `session/update` notification; null where it is none. */
export function readAcpUpdate(params: Record<string, unknown>): { sessionId: string; update: AcpUpdate } | null {
  const sessionId = id(params.sessionId);
  const raw = params.update;
  if (!sessionId || !isRecord(raw) || typeof raw.sessionUpdate !== "string") return null;
  const name = raw.sessionUpdate;
  const done = (update: AcpUpdate) => ({ sessionId, update });
  switch (name) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
    case "user_message_chunk": {
      const said = acpBlockText(raw.content);
      if (!said) return null;
      return done({ kind: "text", role: name === "agent_message_chunk" ? "agent" : name === "agent_thought_chunk" ? "thought" : "user", text: said });
    }
    case "tool_call":
    case "tool_call_update": {
      const tool = readAcpToolCall(raw, name === "tool_call");
      return tool ? done({ kind: "tool", tool }) : null;
    }
    case "plan": {
      const entries: AcpPlanEntry[] = [];
      for (const entry of Array.isArray(raw.entries) ? raw.entries.slice(0, ACP_MAX_PLAN_ENTRIES) : []) {
        if (!isRecord(entry)) continue;
        const content = line(entry.content, ACP_TITLE_LIMIT);
        if (!content) continue;
        entries.push({
          content,
          priority: PRIORITIES.includes(entry.priority) ? (entry.priority as AcpPlanEntry["priority"]) : "medium",
          status: PLAN_STATUSES.includes(entry.status) ? (entry.status as AcpPlanEntry["status"]) : "pending",
        });
      }
      return done({ kind: "plan", entries });
    }
    default:
      return done({ kind: "other", name: name.slice(0, 60) });
  }
}

/* ---- what an agent asks the host for ------------------------------------------------------ */

export const ACP_PERMISSION_KINDS = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;
export type AcpPermissionKind = (typeof ACP_PERMISSION_KINDS)[number];

export interface AcpPermissionOption {
  id: string;
  /** The agent's own words for the choice. */
  name: string;
  kind: AcpPermissionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  tool: AcpToolUpdate;
  options: AcpPermissionOption[];
}

/** Reads `session/request_permission`; null where there is nothing a person could choose from. */
export function readAcpPermissionRequest(params: Record<string, unknown>): AcpPermissionRequest | null {
  const sessionId = id(params.sessionId);
  const tool = readAcpToolCall(params.toolCall, false);
  if (!sessionId || !tool) return null;
  const options: AcpPermissionOption[] = [];
  for (const raw of Array.isArray(params.options) ? params.options.slice(0, ACP_MAX_OPTIONS) : []) {
    if (!isRecord(raw)) continue;
    const optionId = id(raw.optionId);
    // A choice of a kind Plainva does not know cannot be shown for what it is: left out.
    if (!optionId || !(ACP_PERMISSION_KINDS as readonly unknown[]).includes(raw.kind) || options.some((known) => known.id === optionId)) continue;
    options.push({ id: optionId, name: line(raw.name, ACP_NAME_LIMIT), kind: raw.kind as AcpPermissionKind });
  }
  return options.length ? { sessionId, tool, options } : null;
}

export interface AcpFileRead {
  sessionId: string;
  path: string;
  /** The first line that is wanted, counted from 1; null for the beginning. */
  line: number | null;
  /** How many lines; null for all. */
  limit: number | null;
}

const count = (raw: unknown): number | null => (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 10_000_000 ? raw : null);

/** Reads `fs/read_text_file`; throws the refusal the agent is answered with where it names no file. */
export function readAcpFileRead(params: Record<string, unknown>): AcpFileRead {
  const sessionId = id(params.sessionId);
  const path = printable(params.path, ACP_PATH_LIMIT);
  if (!sessionId || !path) throw new AcpRefusal(ACP_ERROR_INVALID_PARAMS, "A session and a path are needed.");
  return { sessionId, path, line: count(params.line), limit: count(params.limit) };
}

export interface AcpFileWrite {
  sessionId: string;
  path: string;
  content: string;
}

/** Reads `fs/write_text_file`; throws the refusal the agent is answered with where it is not a write Plainva takes. */
export function readAcpFileWrite(params: Record<string, unknown>): AcpFileWrite {
  const sessionId = id(params.sessionId);
  const path = printable(params.path, ACP_PATH_LIMIT);
  if (!sessionId || !path || typeof params.content !== "string") throw new AcpRefusal(ACP_ERROR_INVALID_PARAMS, "A session, a path and the text are needed.");
  if (params.content.length > ACP_FILE_LIMIT) throw new AcpRefusal(ACP_ERROR_INVALID_PARAMS, "The text is too long for a note.");
  return { sessionId, path, content: params.content };
}

/** The lines of a text an agent asked for: from `line` on, `limit` of them. */
export function acpLines(content: string, line: number | null, limit: number | null): string {
  if (line === null && limit === null) return content;
  const lines = content.split("\n");
  const from = (line ?? 1) - 1;
  return lines.slice(from, limit === null ? undefined : from + limit).join("\n");
}

/* ---- what Plainva sends ------------------------------------------------------------------- */

/** A server of tools the agent is handed for a session: a program it starts itself, spoken to over its input and output. */
export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

/** What a message to an agent is made of. Every agent takes text and links; Plainva sends nothing else. */
export type AcpPromptBlock = { type: "text"; text: string } | { type: "resource_link"; uri: string; name: string };

export interface AcpClientInfo {
  name: string;
  title: string;
  version: string;
}

/**
 * What Plainva tells an agent it can do for it. Files of the vault are read
 * and written through the app — a write becomes a suggestion —; a terminal is
 * not offered, so an agent cannot ask Plainva to run a command; and a sign-in
 * in the agent's own program can be shown.
 */
export function acpInitializeParams(client: AcpClientInfo): Record<string, unknown> {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true } },
    clientInfo: { name: client.name, title: client.title, version: client.version },
  };
}
