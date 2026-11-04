import { z } from "zod";
import type { ToolManifest } from "../tools.js";
import { mcpGrantCovers, type McpServerGrant } from "./grants.js";
import { readMcpHeaderParams } from "./headerValues.js";
import { capMcpText, mcpToolEffect, type McpListing, type McpToolDescriptor, type McpToolEffect } from "./listing.js";
import { findMcpNameIssues, mcpExposedToolName, withheldMcpTools, type McpNameIssue } from "./names.js";
import { mcpOffersTools, type McpServerReview } from "./pin.js";
import { mcpSchemaView } from "./schemaView.js";

/**
 * What a conversation gets of the foreign servers (plan KI-Harness P4.5).
 *
 * One place decides it, from four things that were each decided elsewhere:
 * what is registered on this device, what the user approved of a server's
 * texts, whether this vault uses the server, and which tools it granted. A
 * tool that passes all four is offered — under a name of Plainva's own, with
 * the description and the arguments of the APPROVED listing, never of what the
 * server happens to send today.
 *
 * The same function tells the settings why a tool is not offered, so that the
 * review shows exactly what a conversation will see.
 */

export interface McpServerState {
  id: string;
  /** The user's name for the server. */
  label: string;
  transport: "http" | "stdio";
  /** What is registered natively now (`mcpServerTarget`); null when nothing is. */
  target: string | null;
  /** What was registered when the listing was approved. */
  reviewedTarget: string;
  review: McpServerReview;
  /** The listing the user approved: the only source of what a model reads of the server. */
  snapshot: McpListing | null;
  /** This vault uses the server. */
  enabled: boolean;
  grant: McpServerGrant;
}

export type McpServerStanding =
  /** Offered: approved, registered as it was approved, switched on in this vault. */
  | "ready"
  /** Not switched on in this vault. */
  | "off"
  /** Never approved, or registered anew since. */
  | "new"
  /** Its listing changed after the approval. */
  | "blocked"
  /** Nothing is registered under its id on this device any more. */
  | "gone";

/** Where a server stands for this vault. A server registered anew — another address, another command — is a new server. */
export function mcpServerStanding(server: McpServerState): McpServerStanding {
  if (server.target === null) return "gone";
  // An approval — and a block — belong to what was registered then.
  if (server.target !== server.reviewedTarget) return "new";
  if (server.review.status === "blocked") return "blocked";
  if (!mcpOffersTools(server.review) || server.snapshot === null) return "new";
  return server.enabled ? "ready" : "off";
}

export type McpToolStanding =
  | "offered"
  /** Its name cannot be offered (twice in the listing, characters a person cannot check, two tools under one name). */
  | "name"
  /** Its arguments are marked to travel as headers in a way the specification forbids. */
  | "header-marks"
  /** The user did not allow it for this vault. */
  | "not-granted";

/**
 * Why one tool of a server is or is not offered, the user's own choice last:
 * what the review says of each tool. A tool that does not say it only reads
 * is offered like any other once the user ticked it (plan P5-6) — the review
 * and every call say what it may do at its service (`mcpToolEffect`).
 */
export function mcpToolStanding(server: McpServerState, tool: McpToolDescriptor, issues: readonly McpNameIssue[]): McpToolStanding {
  if (withheldMcpTools(server.id, issues).has(tool.name)) return "name";
  if (server.transport === "http" && !readMcpHeaderParams(tool.inputSchema).ok) return "header-marks";
  // Ticked — and ticked for what it says it does now: a yes to a tool that only read is no yes to one that changes.
  return mcpGrantCovers(server.grant, tool) ? "offered" : "not-granted";
}

export interface McpOfferedTool {
  /** The name the model calls it by: `mcp_<server>_<tool>`. */
  exposed: string;
  serverId: string;
  serverLabel: string;
  /** The server's own name of the tool. */
  name: string;
  /** For a person: the server's title of the tool, cleaned and cut; its name where it has none. */
  title: string;
  /** For the model: the approved description, cleaned and cut. Data, not an instruction. */
  description: string;
  /** The reading copy of its arguments. */
  schema: Record<string, unknown>;
  /** What a call can do at the service, as the APPROVED listing says it. */
  effect: McpToolEffect;
  /** The tool as it was approved: what a call is decided on. */
  descriptor: McpToolDescriptor;
}

/** The name issues of all servers a vault could be offered: lookalikes across servers are found over all of them. */
export function mcpIssuesOf(servers: readonly McpServerState[]): McpNameIssue[] {
  return findMcpNameIssues(servers.filter((server) => server.snapshot).map((server) => ({ id: server.id, tools: server.snapshot!.tools.map((tool) => tool.name) })));
}

/** Every foreign tool a conversation in this vault is offered, in a stable order. */
export function mcpOfferedTools(servers: readonly McpServerState[]): McpOfferedTool[] {
  const issues = mcpIssuesOf(servers);
  const offered: McpOfferedTool[] = [];
  for (const server of [...servers].sort((a, b) => a.id.localeCompare(b.id))) {
    if (mcpServerStanding(server) !== "ready" || !server.snapshot) continue;
    for (const tool of server.snapshot.tools) {
      if (mcpToolStanding(server, tool, issues) !== "offered") continue;
      offered.push({
        exposed: mcpExposedToolName(server.id, tool.name),
        serverId: server.id,
        serverLabel: server.label,
        name: tool.name,
        title: capMcpText(tool.title, 80).text || tool.name,
        description: capMcpText(tool.description).text,
        schema: mcpSchemaView(tool.inputSchema).schema,
        effect: mcpToolEffect(tool),
        descriptor: tool,
      });
    }
  }
  return offered;
}

/** Arguments of a foreign tool: an object. What it must hold is the server's to check — and the user sees it before it goes. */
const FOREIGN_INPUT = z.record(z.string(), z.unknown());

/**
 * A foreign tool as the run loop knows it. It reaches a conversation only
 * through the tool search, never in a provider's own tool list; its result is
 * a stranger's text; and calling it sends something out — the Rule of Two
 * counts it as a way out, and the user is asked before every call. One that
 * does not say it only reads is an outside effect in its own right
 * (`external`): what it does at its service, Plainva cannot take back.
 */
export function mcpForeignManifest(tool: McpOfferedTool, grant: McpServerGrant): ToolManifest {
  return {
    name: tool.exposed,
    description: tool.description,
    risk: tool.effect === "reads" ? "read" : "external",
    input: FOREIGN_INPUT,
    dataClasses: grant.dataClasses.length ? grant.dataClasses : ["web"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
    outward: true,
    foreign: { server: tool.serverId, label: tool.serverLabel, tool: tool.name, schema: tool.schema },
  };
}
