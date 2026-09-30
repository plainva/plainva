import { z } from "zod";

/**
 * Tool manifests — the one contract of the harness and Plainva's MCP server
 * (ADR 0019, ADR 0022). The harness registry and the server's `tools/list`
 * are generated from these entries; a tool without a manifest does not exist.
 *
 * Names follow the lowest common denominator of the provider APIs
 * (`^[a-z][a-z0-9_]{0,63}$`), so the same name reaches every model.
 * Descriptions are for the model: what the tool returns and when to use it,
 * never how to treat other instructions.
 */

export type ToolRiskClass = "read" | "ui" | "write" | "critical" | "external" | "script";

/**
 * Data classes a result can carry. A run that starts using a class it did not
 * use before widens its scope, and the send overview appears again (ADR 0018).
 */
export type ToolDataClass = "notes" | "structure" | "tasks" | "calendar" | "mail" | "web" | "commands";

export type ToolSurface = "harness" | "mcp";

export interface ToolManifest {
  name: string;
  description: string;
  risk: ToolRiskClass;
  input: z.ZodType;
  dataClasses: readonly ToolDataClass[];
  /** Results carry vault or third-party content: tier 3, fenced as data. */
  untrustedResult: boolean;
  /** One of the always-loaded core tools; everything else is found by search. */
  core: boolean;
  surfaces: readonly ToolSurface[];
  /**
   * The native command that enforces the tool's scope, or null where the tool
   * only reads the index through the owner window and the native side checks
   * the caller (MCP) before it gets there.
   */
  native: string | null;
  /** Upper bound on items per result page — results are small by design. */
  pageLimit: number;
}

const path = z.string().min(1).max(1024).describe("Vault-relative path, forward slashes, e.g. Projects/Offer.md");
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);
const cursor = z.string().max(256).optional().describe("Opaque cursor from the previous page");

export const TOOL_MANIFESTS: readonly ToolManifest[] = [
  {
    name: "search_vault",
    description:
      "Full-text search over the notes of the vault. Returns matching notes with title, path, a short snippet and a section handle per hit, best first. Use it to find notes before reading them.",
    risk: "read",
    input: z.object({
      query: z.string().min(1).max(500).describe("Search terms; quotes for phrases, -word to exclude"),
      folder: z.string().max(1024).optional().describe("Only search inside this folder"),
      limit: limit(25, 10),
      cursor,
    }),
    dataClasses: ["notes"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 25,
  },
  {
    name: "read_note",
    description:
      "Reads one note, or one section of it when a section handle from search_vault or get_outline is given. Long notes come in pages; follow the cursor for more.",
    risk: "read",
    input: z.object({
      path,
      section: z.string().max(512).optional().describe("Section handle, e.g. the heading chain 'Costs > 2026'"),
      maxChars: z.number().int().min(200).max(20000).default(8000),
      cursor,
    }),
    dataClasses: ["notes"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "get_outline",
    description: "Returns the heading structure of a note with a section handle per heading, and its properties (frontmatter) without the body.",
    risk: "read",
    input: z.object({ path }),
    dataClasses: ["structure"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "query_base",
    description:
      "Queries a Plainva database (.base file): returns the rows of one of its views with their properties. Use it for questions about projects, lists and collections kept as databases.",
    risk: "read",
    input: z.object({
      base: path.describe("Path of the .base file"),
      view: z.string().max(200).optional().describe("Name of the view; the first view when omitted"),
      limit: limit(50, 20),
      cursor,
    }),
    dataClasses: ["notes", "structure"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 50,
  },
  {
    name: "get_tasks",
    description:
      "Lists tasks from the vault's notes and connected task lists: open tasks due today, upcoming, overdue, without a date, or done — with due date, priority and the note they live in.",
    risk: "read",
    input: z.object({
      range: z.enum(["today", "upcoming", "overdue", "inbox", "all", "done"]).default("today"),
      limit: limit(50, 25),
      cursor,
    }),
    dataClasses: ["tasks"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 50,
  },
  {
    name: "run_command",
    description:
      "Runs one of Plainva's app commands to navigate or show something: open a note, open a view, focus the graph, open today's note. Changes no data. find_tools with the query 'commands' lists the available command ids.",
    risk: "ui",
    input: z.object({
      id: z.string().min(1).max(128).describe("Command id from the command list"),
      args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
    dataClasses: ["commands"],
    untrustedResult: false,
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "find_tools",
    description: "Finds further tools by what they do (for example 'backlinks', 'calendar', 'recent', 'commands') and makes them available in this conversation.",
    risk: "read",
    input: z.object({ query: z.string().min(1).max(200) }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 10,
  },
  {
    name: "get_backlinks",
    description: "Lists the notes that link to a note, with the heading chain and line of each link.",
    risk: "read",
    input: z.object({ path, limit: limit(50, 20), cursor }),
    dataClasses: ["notes", "structure"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 50,
  },
  {
    name: "graph_neighborhood",
    description: "Returns the notes linked to and from a note, one or two steps away, with how they are connected.",
    risk: "read",
    input: z.object({ path, depth: z.number().int().min(1).max(2).default(1), limit: limit(50, 30) }),
    dataClasses: ["structure"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 50,
  },
  {
    name: "get_calendar",
    description: "Lists appointments in a date range (at most 31 days) from the connected calendars: day, time and title.",
    risk: "read",
    input: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("First day, YYYY-MM-DD"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Last day, YYYY-MM-DD"),
      limit: limit(100, 50),
    }),
    dataClasses: ["calendar"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 100,
  },
  {
    name: "get_recent",
    description: "Lists the notes the user opened or edited most recently on this device.",
    risk: "read",
    input: z.object({ kind: z.enum(["opened", "edited"]).default("opened"), limit: limit(20, 10) }),
    dataClasses: ["notes"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 20,
  },
  {
    name: "parse_task",
    description:
      "Turns a short task phrase ('call Anna tomorrow 3pm !high #work') into date, time, priority, tags and repetition, locally and without a model.",
    risk: "read",
    input: z.object({ text: z.string().min(1).max(500), language: z.string().max(10).optional() }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "open_in_app",
    description: "Opens a note (optionally at a section) in the running Plainva app, so the user sees what is being discussed.",
    risk: "ui",
    input: z.object({ path, section: z.string().max(512).optional() }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["mcp"],
    native: null,
    pageLimit: 1,
  },
];

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const TOOL_DESCRIPTION_LIMIT = 1024;

export function toolByName(name: string): ToolManifest | undefined {
  return TOOL_MANIFESTS.find((tool) => tool.name === name);
}

export function toolsFor(surface: ToolSurface): ToolManifest[] {
  return TOOL_MANIFESTS.filter((tool) => tool.surfaces.includes(surface));
}

/** The always-loaded core set of a surface (six for the harness). */
export function coreTools(surface: ToolSurface = "harness"): ToolManifest[] {
  return toolsFor(surface).filter((tool) => tool.core);
}

/**
 * Plainva's own tool search: non-core tools whose name or description share a
 * word with the query, best overlap first. Used where the provider has no tool
 * search of its own.
 */
export function findTools(query: string, surface: ToolSurface = "harness", max = 5): ToolManifest[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (words.length === 0) return [];
  return toolsFor(surface)
    .filter((tool) => !tool.core)
    .map((tool) => {
      const hay = `${tool.name.replace(/_/g, " ")} ${tool.description}`.toLowerCase();
      return { tool, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, max)
    .map((hit) => hit.tool);
}

/** JSON Schema of a tool's input, as the provider adapters and MCP send it. */
export function toolInputJsonSchema(tool: ToolManifest): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Validates and completes tool arguments (defaults applied); never throws. */
export function parseToolInput(tool: ToolManifest, args: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const result = tool.input.safeParse(args ?? {});
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") };
}
