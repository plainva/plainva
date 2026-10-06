import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { TOOL_MANIFESTS, TOOL_NAME_PATTERN } from "../tools.js";
import { MCP_NAME_LIMIT } from "./listing.js";

/**
 * Names (plan §17.2: "detection of name collisions — tool shadowing").
 *
 * A model picks a tool by its name and description. A foreign server that
 * calls a tool `read_note` is asking to be picked instead of Plainva's own.
 * Two measures:
 *
 * - **A namespace.** A server's tool reaches the model as
 *   `mcp_<server>_<tool>`, never under its bare name, in the alphabet every
 *   provider accepts (`TOOL_NAME_PATTERN`). The server id is chosen by the
 *   user when adding the server — not by the server. A foreign tool can
 *   therefore never BE a built-in tool, and two servers never share a name.
 * - **Lookalikes are reported.** What still looks like a built-in tool, or
 *   like a tool of another server, is shown at the review, and withheld where
 *   the name is not one a person can read with confidence.
 *
 * The mapping is deterministic, so the tool list of a conversation stays the
 * same from request to request.
 */

/** Short, lower case, starts with a letter: it becomes part of every tool name of the server. */
export const MCP_SERVER_ID_PATTERN = /^[a-z][a-z0-9]{0,15}$/;
const PREFIX = "mcp_";
const NAME_MAX = 64;

export type McpServerIdProblem = "pattern" | "taken";

export function mcpServerIdProblem(id: string, taken: readonly string[] = []): McpServerIdProblem | null {
  if (!MCP_SERVER_ID_PATTERN.test(id)) return "pattern";
  return taken.includes(id) ? "taken" : null;
}

/** A server id from what the user typed as its name ("GitHub Issues" -> "githubissues"); "" when nothing usable is left. */
export function suggestMcpServerId(label: string, taken: readonly string[] = []): string {
  const base = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 12);
  if (!base) return "";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(`${base}${n}`)) return `${base}${n}`;
  return "";
}

const PLAIN = /^[a-z0-9_]+$/;

function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "_") start++;
  while (end > start && value[end - 1] === "_") end--;
  return value.slice(start, end);
}

/**
 * The name a server's tool has for the model. A name that is already in the
 * provider alphabet keeps its letters; any other (upper case, dots, hyphens,
 * other scripts) is folded and gets six hex digits of its hash, so two names
 * that fold to the same letters stay two tools.
 */
export function mcpExposedToolName(serverId: string, toolName: string): string {
  const head = `${PREFIX}${serverId}_`;
  const plain = PLAIN.test(toolName);
  const folded = plain
    ? toolName
    : trimUnderscores(
        toolName
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_"),
      );
  if (plain && head.length + folded.length <= NAME_MAX) return head + folded;
  const suffix = `_${sha256Hex(utf8Encode(toolName)).slice(0, 6)}`;
  return head + folded.slice(0, Math.max(0, NAME_MAX - head.length - suffix.length)) + suffix;
}

/** Letters and digits only, lower case, compatibility forms unified — how lookalikes are compared. */
function lookalike(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const USUAL = /^[A-Za-z0-9_.-]+$/;

export type McpNameIssue =
  /** The same name twice in one listing: which one would a call mean? Withheld. */
  | { kind: "duplicate"; server: string; tool: string }
  /** Characters outside letters, digits, `_`, `-`, `.`, or longer than the limit: not a name a person can check. Withheld. */
  | { kind: "unusual-name"; server: string; tool: string }
  /** Two tools of one server end up under one name for the model. Both withheld. */
  | { kind: "same-exposed-name"; server: string; tools: [string, string]; exposed: string }
  /** Reads like one of Plainva's own tools. Shown at the review; allowed only tool by tool. */
  | { kind: "like-builtin"; server: string; tool: string; builtin: string }
  /** Two servers offer a tool of the same name. Shown at the review. */
  | { kind: "like-other-server"; servers: [string, string]; tool: string };

/** Issues that take a tool out of the offer, whatever the user allows. */
export function isWithholdingMcpIssue(issue: McpNameIssue): boolean {
  return issue.kind === "duplicate" || issue.kind === "unusual-name" || issue.kind === "same-exposed-name";
}

export function findMcpNameIssues(
  servers: readonly { id: string; tools: readonly string[] }[],
  builtin: readonly string[] = TOOL_MANIFESTS.map((tool) => tool.name),
): McpNameIssue[] {
  const issues: McpNameIssue[] = [];
  const builtinByLook = new Map(builtin.map((name) => [lookalike(name), name]));
  const firstServerByLook = new Map<string, string>();

  for (const server of servers) {
    const seen = new Set<string>();
    const reportedDuplicate = new Set<string>();
    const byExposed = new Map<string, string>();
    const looksHere = new Set<string>();
    for (const tool of server.tools) {
      if (seen.has(tool)) {
        if (!reportedDuplicate.has(tool)) issues.push({ kind: "duplicate", server: server.id, tool });
        reportedDuplicate.add(tool);
        continue;
      }
      seen.add(tool);
      if (!USUAL.test(tool) || tool.length > MCP_NAME_LIMIT) {
        issues.push({ kind: "unusual-name", server: server.id, tool });
        continue;
      }
      const exposed = mcpExposedToolName(server.id, tool);
      const other = byExposed.get(exposed);
      if (other !== undefined) issues.push({ kind: "same-exposed-name", server: server.id, tools: [other, tool], exposed });
      else byExposed.set(exposed, tool);

      const look = lookalike(tool);
      const own = builtinByLook.get(look);
      if (own !== undefined) issues.push({ kind: "like-builtin", server: server.id, tool, builtin: own });
      const first = firstServerByLook.get(look);
      if (first !== undefined && first !== server.id && !looksHere.has(look)) {
        issues.push({ kind: "like-other-server", servers: [first, server.id], tool });
      }
      looksHere.add(look);
    }
    for (const look of looksHere) if (!firstServerByLook.has(look)) firstServerByLook.set(look, server.id);
  }
  return issues;
}

/** The tools of one server that may not be offered because of their names. */
export function withheldMcpTools(serverId: string, issues: readonly McpNameIssue[]): Set<string> {
  const out = new Set<string>();
  for (const issue of issues) {
    if (issue.kind === "like-other-server" || issue.kind === "like-builtin" || issue.server !== serverId) continue;
    if (issue.kind === "same-exposed-name") issue.tools.forEach((tool) => out.add(tool));
    else out.add(issue.tool);
  }
  return out;
}

/** True for every name this module produces; a guard for the code that hands tools to a provider. */
export function isMcpExposedToolName(name: string): boolean {
  return name.startsWith(PREFIX) && TOOL_NAME_PATTERN.test(name);
}
