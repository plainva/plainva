import { acpAuthorId } from "../acp/agents.js";

/**
 * Who a write that no person made is signed with (plan KI-Harness P5,
 * ADR 0023): Plainva's own assistant by its model, a program that reaches
 * the vault through Plainva's MCP server by the client the user paired, an
 * external agent by the id it has on this device. The same three ids sign a
 * suggestion round, the stamp `generated.by` of a note that was created from
 * a draft, and the line a plan is confirmed under.
 *
 * None of them is a name. What the user reads is the name they know the
 * writer by — the model's, the paired client's, the one they gave an agent —
 * and that is resolved where it is shown.
 */
export type MachineWriter =
  | { kind: "assistant"; model: string }
  | { kind: "mcp"; clientId: string }
  | { kind: "acp"; agentId: string };

export type MachineAuthorKind = MachineWriter["kind"];

const ASSISTANT_PREFIX = "plainva-ai/";
const MCP_PREFIX = "mcp:";
const ACP_PREFIX = "acp:";

export function assistantAuthorId(model: string): string {
  return `${ASSISTANT_PREFIX}${model}`;
}

export function mcpAuthorId(clientId: string): string {
  return `${MCP_PREFIX}${clientId}`;
}

export function machineAuthorId(writer: MachineWriter): string {
  return writer.kind === "assistant" ? assistantAuthorId(writer.model) : writer.kind === "mcp" ? mcpAuthorId(writer.clientId) : acpAuthorId(writer.agentId);
}

/**
 * Which kind of writer an author id names, or null for a person's — a device
 * id, a member id. Every card asks this before it draws a face: what a
 * machine proposed must never look like a colleague's remark.
 */
export function machineAuthorKind(id: string | null | undefined): MachineAuthorKind | null {
  if (!id) return null;
  if (id.startsWith(ASSISTANT_PREFIX) && id.length > ASSISTANT_PREFIX.length) return "assistant";
  if (id.startsWith(MCP_PREFIX) && id.length > MCP_PREFIX.length) return "mcp";
  if (id.startsWith(ACP_PREFIX) && id.length > ACP_PREFIX.length) return "acp";
  return null;
}

/** The part of a machine's author id behind its kind: the model, the client's id, the agent's id. */
export function machineAuthorSubject(id: string): string | null {
  const kind = machineAuthorKind(id);
  if (kind === null) return null;
  return id.slice(kind === "assistant" ? ASSISTANT_PREFIX.length : kind === "mcp" ? MCP_PREFIX.length : ACP_PREFIX.length);
}
