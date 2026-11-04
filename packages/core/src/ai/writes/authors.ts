import { acpAuthorId } from "../acp/agents.js";

/**
 * Who a write that no person made is signed with (plan KI-Harness P5,
 * ADR 0023): Plainva's own assistant by its model, a program that reaches
 * the vault through Plainva's MCP server by the client the user paired, an
 * external agent by the id it has on this device, and a script the user
 * started by its name (plan P5.5). The same ids sign a suggestion round, the
 * stamp `generated.by` of a note that was created from a draft, and the line
 * a plan is confirmed under.
 *
 * None of them is a name. What the user reads is the name they know the
 * writer by — the model's, the paired client's, the one they gave an agent,
 * the script's own — and that is resolved where it is shown.
 */
export type MachineWriter =
  | { kind: "assistant"; model: string }
  | { kind: "mcp"; clientId: string }
  | { kind: "acp"; agentId: string }
  /** A script run from the workshop: its name is its folder, so it names one script of one vault. */
  | { kind: "script"; name: string };

export type MachineAuthorKind = MachineWriter["kind"];

const ASSISTANT_PREFIX = "plainva-ai/";
const MCP_PREFIX = "mcp:";
const ACP_PREFIX = "acp:";
const SCRIPT_PREFIX = "script:";

export function assistantAuthorId(model: string): string {
  return `${ASSISTANT_PREFIX}${model}`;
}

export function mcpAuthorId(clientId: string): string {
  return `${MCP_PREFIX}${clientId}`;
}

export function scriptAuthorId(name: string): string {
  return `${SCRIPT_PREFIX}${name}`;
}

export function machineAuthorId(writer: MachineWriter): string {
  switch (writer.kind) {
    case "assistant":
      return assistantAuthorId(writer.model);
    case "mcp":
      return mcpAuthorId(writer.clientId);
    case "acp":
      return acpAuthorId(writer.agentId);
    case "script":
      return scriptAuthorId(writer.name);
  }
}

const PREFIXES: readonly [MachineAuthorKind, string][] = [
  ["assistant", ASSISTANT_PREFIX],
  ["mcp", MCP_PREFIX],
  ["acp", ACP_PREFIX],
  ["script", SCRIPT_PREFIX],
];

/**
 * Which kind of writer an author id names, or null for a person's — a device
 * id, a member id. Every card asks this before it draws a face: what a
 * machine proposed must never look like a colleague's remark.
 */
export function machineAuthorKind(id: string | null | undefined): MachineAuthorKind | null {
  if (!id) return null;
  for (const [kind, prefix] of PREFIXES) if (id.startsWith(prefix) && id.length > prefix.length) return kind;
  return null;
}

/** The part of a machine's author id behind its kind: the model, the client's id, the agent's id, the script's name. */
export function machineAuthorSubject(id: string): string | null {
  const kind = machineAuthorKind(id);
  if (kind === null) return null;
  return id.slice(PREFIXES.find(([k]) => k === kind)![1].length);
}
