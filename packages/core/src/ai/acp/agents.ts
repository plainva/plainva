import { capMcpText } from "../mcp/listing.js";
import { MCP_SERVER_ID_PATTERN, suggestMcpServerId } from "../mcp/names.js";
import type { AcpMcpServer } from "./protocol.js";

/**
 * Which agents Plainva knows by name, and what an agent is to the app once
 * the user added it (plan KI-Harness P4.6).
 *
 * Plainva ships no agent, fetches none and installs none. The list below is
 * only how an agent the user installed themselves is found and started: the
 * names its program goes by, and the arguments that make it speak the
 * protocol. Its name is written as its maker writes it, in plain text — no
 * logo, and nothing that reads as if Plainva were that maker's product or
 * partner. Whatever is not on the list is added with its command, like a
 * program that is an MCP server.
 */

export interface AcpKnownAgent {
  /** Plainva's own key for the entry; also the id an agent added from it gets first. */
  key: string;
  /** The agent's name as its maker writes it. */
  name: string;
  /** The names its program is installed under, the most likely first. Bare names: where it lies is the computer's own business. */
  programs: readonly string[];
  /** What makes the program speak the protocol on its input and output. */
  args: readonly string[];
}

/**
 * Checked against the public registry of the protocol on 2026-10-07 (names,
 * programs and arguments as the entries there start them). An agent installed
 * under another name is added with its own command.
 */
export const ACP_KNOWN_AGENTS: readonly AcpKnownAgent[] = [
  { key: "claude", name: "Claude Agent", programs: ["claude-agent-acp"], args: [] },
  { key: "codex", name: "Codex", programs: ["codex-acp"], args: [] },
  { key: "gemini", name: "Gemini CLI", programs: ["gemini"], args: ["--acp"] },
  { key: "copilot", name: "GitHub Copilot", programs: ["copilot"], args: ["--acp"] },
  { key: "opencode", name: "OpenCode", programs: ["opencode"], args: ["acp"] },
  { key: "goose", name: "goose", programs: ["goose"], args: ["acp"] },
  { key: "qwen", name: "Qwen Code", programs: ["qwen"], args: ["--acp"] },
  { key: "vibe", name: "Mistral Vibe", programs: ["vibe-acp"], args: [] },
  { key: "cursor", name: "Cursor", programs: ["cursor-agent"], args: ["acp"] },
  { key: "kimi", name: "Kimi CLI", programs: ["kimi"], args: ["acp"] },
  { key: "cline", name: "Cline", programs: ["cline"], args: ["--acp"] },
  { key: "junie", name: "Junie", programs: ["junie"], args: ["--acp=true"] },
];

/** An agent's id: short, lower case, a letter first — the shape of a server's id, and part of the author of what the agent proposes. */
export const ACP_AGENT_ID_PATTERN = MCP_SERVER_ID_PATTERN;

export function isAcpAgentId(id: string): boolean {
  return ACP_AGENT_ID_PATTERN.test(id);
}

/** An id for an agent the user names, one that is not taken yet. */
export function suggestAcpAgentId(label: string, taken: readonly string[] = []): string {
  return suggestMcpServerId(label, taken);
}

/** An agent as the native registry holds it: the file that is started and its arguments — exactly what the user confirmed. */
export interface AcpRegisteredAgent {
  id: string;
  program: string;
  args: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads what the native side lists. An entry that is not one is left out, never guessed at. */
export function readAcpRegisteredAgents(raw: unknown): AcpRegisteredAgent[] {
  const out: AcpRegisteredAgent[] = [];
  for (const entry of Array.isArray(raw) ? raw.slice(0, 64) : []) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !isAcpAgentId(entry.id) || typeof entry.program !== "string" || !entry.program) continue;
    const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string") : [];
    out.push({ id: entry.id, program: entry.program, args });
  }
  return out;
}

/** What was registered, as one string: a label and what was seen of an agent belong to exactly this command. */
export function acpAgentTarget(agent: Pick<AcpRegisteredAgent, "program" | "args">): string {
  return JSON.stringify([agent.program, ...agent.args]);
}

/** The known agent a registered one is, by the name of its program; null for a command of the user's own. */
export function acpKnownAgentOf(agent: Pick<AcpRegisteredAgent, "program" | "args">): AcpKnownAgent | null {
  const file = agent.program.slice(Math.max(agent.program.lastIndexOf("/"), agent.program.lastIndexOf("\\")) + 1).toLowerCase();
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 && /^\.(?:exe|cmd|bat|com|ps1)$/.test(file.slice(dot)) ? file.slice(0, dot) : file;
  return ACP_KNOWN_AGENTS.find((known) => known.programs.includes(stem) && known.args.length === agent.args.length && known.args.every((arg, index) => arg === agent.args[index])) ?? null;
}

/**
 * Who a proposal of an agent is by (ADR 0023): `acp:<id>`. The id is the one
 * the user gave the agent on this device — the name the agent gives itself is
 * its own claim and never part of an author.
 */
export function acpAuthorId(agentId: string): string {
  return `acp:${agentId}`;
}

/** Why an agent could not be started, in the native side's fixed words. */
export const ACP_START_PROBLEMS = ["not-registered", "already-running", "program-moved", "not-a-vault", "start-failed"] as const;
export type AcpStartProblem = (typeof ACP_START_PROBLEMS)[number];

export function acpStartProblem(error: unknown): AcpStartProblem {
  const word = error instanceof Error ? error.message : String(error);
  return (ACP_START_PROBLEMS as readonly string[]).includes(word) ? (word as AcpStartProblem) : "start-failed";
}

/**
 * The native side's word for the user's no in the system's dialog before a
 * start. It is not one of the problems: nothing was started and nothing went
 * wrong, so a session has nothing to show for it.
 */
export const ACP_START_DECLINED = "declined";

/** How a sign-in in the agent's own program ended, in the native side's fixed words. */
export const ACP_LOGIN_PROBLEMS = ["not-registered", "program-moved", "not-a-vault", "no-terminal", "busy", "cancelled", "start-failed"] as const;
export type AcpLoginProblem = (typeof ACP_LOGIN_PROBLEMS)[number];

export function acpLoginProblem(error: unknown): AcpLoginProblem {
  const word = error instanceof Error ? error.message : String(error);
  return (ACP_LOGIN_PROBLEMS as readonly string[]).includes(word) ? (word as AcpLoginProblem) : "start-failed";
}

/**
 * Plainva's own tools as the agent's toolbox: the helper every MCP client on
 * this computer starts (ADR 0022). The agent starts it itself, as a program
 * of its own; the helper reaches the running app over the private channel,
 * and the app asks the user which folders this client may read — the pairing
 * every client goes through. Nothing here grants anything.
 */
export function acpToolbox(helperPath: string, identifier: string): AcpMcpServer {
  return { name: "plainva", command: helperPath, args: ["--app", identifier], env: [] };
}

/** A command line as it is shown for copying: every part quoted where it has a blank or a quote. For a person's eyes — nothing runs it. */
export function acpCommandText(program: string, args: readonly string[]): string {
  const part = (value: string) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/(["\\])/g, "\\$1")}"`);
  return [program, ...args].map(part).join(" ");
}

/** A label the user gave an agent: one line, cleaned, short. */
export function acpAgentLabel(raw: unknown, fallback: string): string {
  return capMcpText(raw, 60).text.replace(/\s+/g, " ").trim() || fallback;
}
