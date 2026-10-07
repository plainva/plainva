import type { EgressRecipient } from "../egressGate.js";
import { withinFolders } from "../skills/narrowing.js";
import type { ToolDataClass } from "../tools.js";
import { mcpToolEffect, type McpToolDescriptor, type McpToolEffect } from "./listing.js";
import { withheldMcpTools, type McpNameIssue } from "./names.js";
import { checkMcpAddress } from "./native.js";
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
   * What the user allowed a tool that does not only read to do at its
   * service, by its name: the effect the review showed when they ticked it
   * (plan P5-6). A tool is offered only up to that — one that was ticked while
   * it said it only reads, and says something else in a later listing, has to
   * be ticked again: a yes to reading is never a yes to changing.
   */
  effects?: Record<string, Exclude<McpToolEffect, "reads">>;
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
  /** The user did not allow this tool — or allowed it for less than it says it does now. */
  | "tool-not-granted"
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
}

const EFFECT_RANK: Record<McpToolEffect, number> = { reads: 0, changes: 1, destroys: 2 };

/**
 * Whether a grant covers a tool as it reads NOW: its name is ticked, and what
 * it says it can do at its service is no more than what the user allowed it
 * when they ticked it. A tool that only reads needs nothing beyond the tick.
 */
export function mcpGrantCovers(grant: McpServerGrant, tool: McpToolDescriptor): boolean {
  if (!grant.tools.includes(tool.name)) return false;
  const effect = mcpToolEffect(tool);
  if (effect === "reads") return true;
  const allowed = grant.effects?.[tool.name];
  return allowed !== undefined && EFFECT_RANK[allowed] >= EFFECT_RANK[effect];
}

/** A grant with one tool ticked or unticked — ticked for what the tool says it does now. */
export function withMcpToolGrant(grant: McpServerGrant, tool: McpToolDescriptor, on: boolean): McpServerGrant {
  const tools = on ? [...new Set([...grant.tools, tool.name])] : grant.tools.filter((name) => name !== tool.name);
  const effects = { ...grant.effects };
  delete effects[tool.name];
  const effect = mcpToolEffect(tool);
  if (on && effect !== "reads") effects[tool.name] = effect;
  const next: McpServerGrant = { ...grant, tools };
  if (Object.keys(effects).length) next.effects = effects;
  else delete next.effects;
  return next;
}

/**
 * May this call go out? The order is the order of trust: the server first,
 * then the name, then what the user allowed, then what it is given.
 *
 * What a tool says of itself — that it only reads, that it destroys nothing —
 * is the server's own claim. It decides what the user is ASKED with, and what
 * their tick covers; it is never a reason to ask less: every call is
 * previewed, its result is tier 3, and nothing a foreign tool returns can
 * change the vault. What it does at its own service, the user allowed tool by
 * tool, and allows call by call.
 */
export function mcpCallDecision(request: McpCallRequest): McpCallDecision {
  const refuse = (reason: McpCallRefusal): McpCallDecision => ({ allowed: false, reason });
  if (!mcpOffersTools(request.review)) return refuse(request.review.status === "blocked" ? "server-blocked" : "server-new");
  if (withheldMcpTools(request.serverId, request.issues).has(request.tool.name)) return refuse("tool-withheld");
  if (!mcpGrantCovers(request.grant, request.tool)) return refuse("tool-not-granted");
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

/**
 * True when a remote server's address is one the grant names (exact host,
 * lower case, a port that is not the usual one included). The address itself
 * must be one a server may have at all: https, or http to this device.
 */
export function mcpHostAllowed(grant: McpServerGrant, url: string): boolean {
  const address = checkMcpAddress(url);
  return address.ok && grant.hosts.some((allowed) => allowed.toLowerCase() === address.host);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const texts = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.length <= max))] : [];
const DATA_CLASSES: readonly ToolDataClass[] = ["notes", "structure", "tasks", "calendar", "mail", "web", "commands"];

/** Reads a stored grant. A damaged record grants nothing. */
export function readMcpServerGrant(raw: unknown): McpServerGrant {
  if (!isRecord(raw)) return EMPTY_MCP_GRANT;
  const tools = texts(raw.tools, 128);
  // Only for tools that are ticked, and only one of the two words: anything else allows nothing beyond reading.
  const effects: Record<string, Exclude<McpToolEffect, "reads">> = {};
  if (isRecord(raw.effects)) {
    for (const name of tools) {
      const effect = raw.effects[name];
      if (effect === "changes" || effect === "destroys") effects[name] = effect;
    }
  }
  return {
    tools,
    ...(Object.keys(effects).length ? { effects } : {}),
    folders: texts(raw.folders, 1024),
    dataClasses: texts(raw.dataClasses, 32).filter((c): c is ToolDataClass => (DATA_CLASSES as readonly string[]).includes(c)),
    hosts: texts(raw.hosts, 255),
  };
}
