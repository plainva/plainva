import type { EgressRecipient } from "../egressGate.js";
import { withinFolders } from "../skills/narrowing.js";
import type { ToolDataClass } from "../tools.js";
import { mcpDeclaresReadOnly, type McpToolDescriptor } from "./listing.js";
import { withheldMcpTools, type McpNameIssue } from "./names.js";
import { mcpOffersTools, type McpServerReview } from "./pin.js";

/**
 * What the user allowed one server (plan §17.2: deny by default; scoping per
 * server and tool by capability, folder and domain).
 *
 * An approved listing says "these texts are what I saw". A grant says "and of
 * these tools, these may be called, with content from these folders". The two
 * are separate on purpose: re-approving a listing after a change does not
 * silently grant the tools that are new in it.
 */
export interface McpServerGrant {
  /** Tools the user allowed, by the server's own names. Empty: none. */
  tools: string[];
  /**
   * Vault folders whose content may be passed to this server as arguments.
   * Empty: none — the server only ever sees what the user typed. `""` is the
   * whole vault.
   */
  folders: string[];
  /** Data classes the server's results may bring into a conversation (the send overview's scope). */
  dataClasses: ToolDataClass[];
  /** Hosts a remote server may be reached at; a stdio server has none. */
  hosts: string[];
}

export const EMPTY_MCP_GRANT: McpServerGrant = { tools: [], folders: [], dataClasses: [], hosts: [] };

export type McpCallRefusal =
  /** The server was never approved on this device. */
  | "server-new"
  /** Its listing changed since the approval. */
  | "server-blocked"
  /** The tool's name is withheld (duplicate, unreadable, colliding). */
  | "tool-withheld"
  /** The user did not allow this tool. */
  | "tool-not-granted"
  /** The tool does not say it only reads, and writing through MCP is not open yet. */
  | "not-read-only"
  /** An argument carries a vault path outside the granted folders. */
  | "path-outside-grant";

export type McpCallDecision =
  /** Every call is shown before it goes out: server, tool, data (plan §17.2). */
  | { allowed: true; preview: true }
  | { allowed: false; reason: McpCallRefusal };

export interface McpCallRequest {
  serverId: string;
  review: McpServerReview;
  grant: McpServerGrant;
  tool: McpToolDescriptor;
  /** From `findMcpNameIssues` over all servers. */
  issues: readonly McpNameIssue[];
  /** Vault paths whose content the arguments carry. */
  vaultPaths: readonly string[];
  /** False until writing through MCP opens with the approval chain (P5). */
  writesOpen: boolean;
}

/**
 * May this call go out? The order is the order of trust: the server first,
 * then the name, then what the user allowed, then what the tool does, then
 * what it is given.
 *
 * `readOnlyHint` is the server's own claim. It is NECESSARY here — a tool that
 * does not even claim to only read is not offered before writes open — and
 * never SUFFICIENT: the call is previewed, its result is tier 3, and nothing a
 * foreign tool returns can change the vault.
 */
export function mcpCallDecision(request: McpCallRequest): McpCallDecision {
  const refuse = (reason: McpCallRefusal): McpCallDecision => ({ allowed: false, reason });
  if (!mcpOffersTools(request.review)) return refuse(request.review.status === "blocked" ? "server-blocked" : "server-new");
  if (withheldMcpTools(request.serverId, request.issues).has(request.tool.name)) return refuse("tool-withheld");
  if (!request.grant.tools.includes(request.tool.name)) return refuse("tool-not-granted");
  if (!request.writesOpen && !mcpDeclaresReadOnly(request.tool)) return refuse("not-read-only");
  if (request.vaultPaths.some((path) => !withinFolders(path, request.grant.folders))) return refuse("path-outside-grant");
  return { allowed: true, preview: true };
}

/**
 * A foreign server as the privacy gate sees it: a cloud recipient, always.
 * A stdio server runs on this computer, but it is someone else's program with
 * the user's network access — where its input ends up is not Plainva's to
 * know. `cloud: deny` on a note therefore keeps it from every MCP server.
 */
export function mcpRecipient(serverId: string): EgressRecipient {
  return { kind: "cloud", provider: `mcp:${serverId}`, model: "" };
}

/** True when a remote server's address is one the grant names (exact host, lower case). */
export function mcpHostAllowed(grant: McpServerGrant, url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    host = parsed.host.toLowerCase();
  } catch {
    return false;
  }
  return grant.hosts.some((allowed) => allowed.toLowerCase() === host);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const texts = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.length <= max))] : [];
const DATA_CLASSES: readonly ToolDataClass[] = ["notes", "structure", "tasks", "calendar", "mail", "web", "commands"];

/** Reads a stored grant. A damaged record grants nothing. */
export function readMcpServerGrant(raw: unknown): McpServerGrant {
  if (!isRecord(raw)) return EMPTY_MCP_GRANT;
  return {
    tools: texts(raw.tools, 128),
    folders: texts(raw.folders, 1024),
    dataClasses: texts(raw.dataClasses, 32).filter((c): c is ToolDataClass => (DATA_CLASSES as readonly string[]).includes(c)),
    hosts: texts(raw.hosts, 255),
  };
}
