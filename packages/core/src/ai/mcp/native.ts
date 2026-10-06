import type { EndpointConfirmText } from "../egress.js";
import type { McpFailure, McpHttpPort, McpStdioPort } from "./wire.js";

/**
 * What a shell does natively for foreign MCP servers, and the few rules both
 * sides of that boundary keep (plan KI-Harness P4.5).
 *
 * The web view speaks the protocol, but it cannot be trusted with where a
 * request goes, what program is started, or a credential: a script that got
 * into it would have all three. So those live behind this interface. A server
 * is registered natively — its address or its full command line shown in a
 * native dialog first — and from then on the web view names it by its id.
 * Credentials go in and never come out.
 */

/** A server as the native registry holds it: exactly what the user confirmed. */
export interface McpRegisteredServer {
  id: string;
  kind: "http" | "program";
  /** A remote server: the address requests go to. */
  url?: string;
  /** A program: the file that is started. */
  program?: string;
  args: string[];
  /** The names of the values a program gets in its environment. */
  env: string[];
  sandbox: boolean;
  /** The names of the values that are stored; the empty name is a remote server's token. */
  stored: string[];
}

export interface McpProgramSpec {
  program: string;
  args: string[];
  env: string[];
  sandbox: boolean;
}

export interface McpSandboxInfo {
  kind: "none" | "seatbelt" | "bwrap";
  /** The sandbox passed its self-test on this computer; only then does Plainva say "in a sandbox". */
  works: boolean;
}

export interface McpProgramHost {
  /** Remembers a program after the shell showed its whole command line NATIVELY. False when declined. */
  add(serverId: string, spec: McpProgramSpec, text: EndpointConfirmText): Promise<boolean>;
  port(serverId: string): McpStdioPort;
  /** The end of what the program wrote to its error stream: text for a person, never for a model. */
  log(serverId: string): Promise<string>;
  sandbox(): Promise<McpSandboxInfo>;
}

export interface McpNativeHost {
  servers(): Promise<McpRegisteredServer[]>;
  /** Remembers a remote server after the shell showed its address NATIVELY. False when declined. */
  addHttp(serverId: string, url: string, text: EndpointConfirmText): Promise<boolean>;
  /** Forgets a server, its credentials with it, and ends its program. */
  remove(serverId: string): Promise<void>;
  /** Write-only: nothing reads a value back. `name` null is a remote server's token. */
  setSecret(serverId: string, name: string | null, value: string): Promise<void>;
  hasSecret(serverId: string, name: string | null): Promise<boolean>;
  deleteSecret(serverId: string, name: string | null): Promise<void>;
  httpPort(serverId: string): McpHttpPort;
  /** Programs on this computer; null where the platform starts none (a phone). */
  programs: McpProgramHost | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown, max: number): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max) : []);

/** Reads what the native side answered for its registry; an entry that is not one is left out. */
export function readMcpRegisteredServers(raw: unknown): McpRegisteredServer[] {
  const out: McpRegisteredServer[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const base = { id: entry.id, args: strings(entry.args, 64), env: strings(entry.env, 32), sandbox: entry.sandbox === true, stored: strings(entry.stored, 33) };
    if (entry.kind === "http" && typeof entry.url === "string") out.push({ ...base, kind: "http", url: entry.url });
    else if (entry.kind === "program" && typeof entry.program === "string") out.push({ ...base, kind: "program", program: entry.program });
  }
  return out;
}

/**
 * What a server is, as one line: the address of a remote one, the command
 * line of a program. An approval of a server's texts is bound to it — a
 * server that is registered anew under the same id, somewhere else, is a new
 * server.
 */
export function mcpServerTarget(server: McpRegisteredServer): string {
  return server.kind === "http" ? `http ${server.url ?? ""}` : `program ${JSON.stringify([server.program ?? "", ...server.args])}`;
}

export type McpAddressProblem = "empty" | "not-ascii" | "too-long" | "not-a-url" | "scheme" | "credentials";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The address of a remote server as the form checks it before the native
 * side does. The native rule decides; this one says the same, sooner and in
 * the user's language. An address is printable ASCII — a name in another
 * script is typed in its `xn--` form, so nothing that only looks like a host
 * is ever connected to —, https, or http to this device, and carries no
 * credentials.
 */
export function checkMcpAddress(raw: string): { ok: true; url: string; host: string } | { ok: false; problem: McpAddressProblem } {
  const text = raw.trim();
  if (!text) return { ok: false, problem: "empty" };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x20 || code > 0x7e) return { ok: false, problem: "not-ascii" };
  }
  if (text.length > 2048) return { ok: false, problem: "too-long" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: "not-a-url" };
  }
  if (!url.hostname) return { ok: false, problem: "not-a-url" };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) return { ok: false, problem: "scheme" };
  if (url.username || url.password) return { ok: false, problem: "credentials" };
  url.hash = "";
  return { ok: true, url: url.toString(), host: url.host };
}

/** Why a program did not start, as the native side names it. */
export const MCP_START_PROBLEMS = ["not-registered", "already-running", "program-moved", "sandbox-unavailable", "start-failed"] as const;
export type McpStartProblem = (typeof MCP_START_PROBLEMS)[number];

/** The native side's reason for a program that did not start, as a failure of the wire. */
export function mcpStartFailure(error: unknown): McpFailure {
  const text = error instanceof Error ? error.message : String(error);
  const problem = MCP_START_PROBLEMS.find((known) => text === known) ?? "start-failed";
  return problem === "not-registered" ? { kind: "refused", detail: problem } : { kind: "unreachable", detail: problem };
}
