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
  /**
   * Loaded in every conversation whose vault can serve it. A tool that is not
   * is either chosen when a conversation starts (the internet, the skills) or
   * found with `find_tools` and called through `call_tool`.
   */
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
  /**
   * The call itself sends something to a third party: an address, a search
   * query. Reading the web changes nothing, so the risk stays `read` — but a
   * request is a way out, and the Rule of Two counts it as one (plan §13.4):
   * in a run that also holds private data and untrusted text, each such call
   * needs the user's approval.
   */
  outward?: boolean;
  /**
   * A tool of a foreign MCP server (plan KI-Harness P4.5). Such a manifest is
   * not in the list below: it is built for one run from the listing the user
   * approved (`mcpForeignManifest`), is reached only through the tool search,
   * and never goes to a provider as a tool definition. `schema` is the
   * reading copy of its arguments; `label` is the user's name for the server.
   */
  foreign?: { server: string; label: string; tool: string; schema: Record<string, unknown> };
}

/** The tools that reach the internet. A conversation carries them only while its vault allows the internet. */
export const WEB_TOOL_NAMES: readonly string[] = ["fetch_url", "web_search"];

/** Whether a list of tool names — a conversation's — reaches the internet. */
export function hasWebTools(names: readonly string[]): boolean {
  return names.some((name) => WEB_TOOL_NAMES.includes(name));
}

/**
 * The two tools behind which further tools wait (ADR 0019): `find_tools`
 * lists them with their arguments, `call_tool` calls one. A conversation's
 * own tool list never changes (ADR 0018), so a tool that is rarely needed —
 * or that reaches another kind of data, like mail — is not part of it; the
 * conversation carries its name in `more` instead.
 */
export const FIND_TOOL = "find_tools";
export const DISPATCH_TOOL = "call_tool";
export const META_TOOL_NAMES: readonly string[] = [FIND_TOOL, DISPATCH_TOOL];

/** The tools that read the user's mail; found with `find_tools` where a mail account is connected. */
export const MAIL_TOOL_NAMES: readonly string[] = ["search_mail", "read_mail"];

/**
 * The tools that write (plan KI-Harness P5, ADR 0019 §2) — none of them
 * changes the vault. A proposal lays something down that waits for the user:
 * a suggestion on a note that is there, a draft of something that is not.
 * Accepting it is the approval, so the tool itself asks nothing. A plan is
 * what cannot be reviewed block by block — a rename, a move, a deletion: the
 * run waits for the user's yes, and the app's own operation carries it out.
 * All of them are found with `find_tools`, like every tool that is not read
 * in every conversation.
 */
export const PROPOSAL_TOOL_NAMES: readonly string[] = ["propose_edit", "set_property", "create_note", "create_task", "add_journal_entry", "create_entry"];
export const PLAN_TOOL_NAMES: readonly string[] = ["rename_note", "move_note", "delete_note"];
export const WRITE_TOOL_NAMES: readonly string[] = [...PROPOSAL_TOOL_NAMES, ...PLAN_TOOL_NAMES];

/**
 * The tool a call runs, by name: for a call through the dispatcher the tool
 * it names, otherwise the call's own. What a transcript, a ledger and a
 * skill's scenario say was used.
 */
export function calledToolName(call: { name: string; args?: unknown }): string {
  if (call.name !== DISPATCH_TOOL) return call.name;
  const target = (call.args as { name?: unknown } | null | undefined)?.name;
  return typeof target === "string" && TOOL_NAME_PATTERN.test(target.trim()) ? target.trim() : call.name;
}

/** The arguments a dispatched call hands to its tool: an object, or JSON text of one. */
export function dispatchedArgs(args: unknown): unknown {
  const inner = (args as { args?: unknown } | null | undefined)?.args;
  if (typeof inner !== "string") return inner ?? {};
  try {
    return JSON.parse(inner) as unknown;
  } catch {
    return inner;
  }
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
      "Runs one of Plainva's app commands to show or arrange something: open a note (at a section) or a database, open a view (graph, tasks, calendar, journal, mail), show a note in the graph, show or hide a sidebar. Changes no data. An unknown id returns the commands this device offers.",
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
    description:
      "Lists further tools and the app's commands by what they do (for example 'mail', 'commands'), each with its arguments. A tool it lists is called through call_tool, a command through run_command.",
    risk: "read",
    input: z.object({ query: z.string().min(1).max(200).describe("What you want to do, in a few words") }),
    dataClasses: [],
    untrustedResult: false,
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 10,
  },
  {
    name: "call_tool",
    description: "Calls a tool that find_tools listed, with the arguments find_tools described for it. The tools of this list are called directly, never through call_tool.",
    risk: "read",
    input: z.object({
      name: z.string().min(1).max(64).describe("The tool's name as find_tools wrote it"),
      args: z.union([z.record(z.string(), z.unknown()), z.string().max(8000)]).optional().describe("The tool's arguments, as an object"),
    }),
    dataClasses: [],
    untrustedResult: false,
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "get_backlinks",
    description: "Lists the notes that link to a note, with the heading chain and line of each link.",
    risk: "read",
    input: z.object({ path, limit: limit(50, 20), cursor }),
    dataClasses: ["notes", "structure"],
    untrustedResult: true,
    core: true,
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
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 50,
  },
  {
    name: "get_calendar",
    description:
      "Lists appointments in a date range (at most 31 days) from the connected calendars: day, time, title and a handle per appointment; with details also the place and who takes part.",
    risk: "read",
    input: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("First day, YYYY-MM-DD"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Last day, YYYY-MM-DD"),
      details: z.boolean().default(false).describe("Also the place and the attendees"),
      limit: limit(100, 50),
    }),
    dataClasses: ["calendar"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 100,
  },
  {
    name: "get_event",
    description:
      "Returns one appointment in detail: time, place, organiser, the attendees with their answers and the user's own — and, where it has a description, a report of what the description says about your question.",
    risk: "read",
    input: z.object({
      event: z.string().min(3).max(64).describe("The appointment's handle from get_calendar"),
      question: z.string().max(500).optional().describe("What you want to know from the description"),
    }),
    dataClasses: ["calendar"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "get_recent",
    description: "Lists the notes the user opened or edited most recently on this device.",
    risk: "read",
    input: z.object({ kind: z.enum(["opened", "edited"]).default("opened"), limit: limit(20, 10) }),
    dataClasses: ["notes"],
    untrustedResult: true,
    core: true,
    surfaces: ["harness", "mcp"],
    native: null,
    pageLimit: 20,
  },
  {
    name: "search_mail",
    description:
      "Lists messages from the user's connected mail accounts: the newest of a folder, or those that match search terms. Returns date, sender, subject and a handle per message — never a message's text. Read one with read_mail.",
    risk: "read",
    input: z.object({
      query: z.string().max(200).optional().describe("Search terms; omit for the newest messages"),
      folder: z.string().max(200).optional().describe("Folder name as the account writes it; the inbox when omitted"),
      account: z.string().max(200).optional().describe("Only this account, by its name or address; every account when omitted"),
      limit: limit(25, 10),
    }),
    dataClasses: ["mail"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 25,
  },
  {
    name: "read_mail",
    description:
      "Reads one message and reports what it says about your question: a short summary, facts with quotes from the message, and links it contains. You receive a report, not the message's text. The message stays unread and unchanged in the mailbox.",
    risk: "read",
    input: z.object({
      message: z.string().min(3).max(1024).describe("The message's handle from search_mail"),
      question: z.string().min(1).max(500).describe("What you want to know from the message"),
    }),
    dataClasses: ["mail"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "parse_task",
    description:
      "Turns a short task phrase ('call Anna tomorrow 3pm !!! #work') into date, time, priority, tags and repetition, locally and without a model. One to three exclamation marks standing alone set the priority: ! low, !! medium, !!! high.",
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
    name: "use_skill",
    description:
      "Loads the instructions of one of the listed skills, to follow them for the current request. With `file`, loads one file of that skill instead (a path from the list the instructions end with).",
    risk: "read",
    input: z.object({
      name: z.string().min(1).max(80).describe("The skill's name as the list writes it"),
      file: z.string().min(1).max(256).optional().describe("A file of the skill, e.g. references/terms.md"),
    }),
    dataClasses: [],
    // Approved instructions, not data: the result is tier 1 (plan KI-Harness P3).
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "fetch_url",
    description:
      "Reads one public web page (https) and reports what it says about your question: a short summary, facts with quotes from the page, and links that lead further. You receive a report, not the page's text. Use it for an address the user gave, or one that a search or an earlier report returned.",
    risk: "read",
    outward: true,
    input: z.object({
      url: z.string().min(8).max(2048).describe("The page's address, starting with https://"),
      question: z.string().min(1).max(500).describe("What you want to know from the page"),
    }),
    dataClasses: ["web"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: "ai_web_fetch",
    pageLimit: 1,
  },
  {
    name: "web_search",
    description:
      "Searches the web through the model provider's own search. Returns pages with title and address, best first, and a short note on what they say. Read a page with fetch_url. The query goes to the provider: it holds search terms, never passages from the user's notes.",
    risk: "read",
    outward: true,
    input: z.object({ query: z.string().min(2).max(200).describe("Search terms, as typed into a search engine") }),
    dataClasses: ["web"],
    untrustedResult: true,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 8,
  },
  // Writing (plan KI-Harness P5, ADR 0019 §2). None of these changes the vault: a proposal waits on its note, a draft
  // waits in the list of drafts, a plan waits for the user's yes. All are found through the tool search.
  {
    name: "propose_edit",
    description:
      "Proposes changes to the text of one note. Nothing changes until the user accepts the proposal in Plainva, part by part. With `edits`: each passage exactly as read_note returned it — it has to be in the note once — and what should stand in its place. With `append`: a paragraph to add at the end of the note, or of the section named in `section`. A note's properties are changed with set_property.",
    risk: "write",
    input: z.object({
      path,
      edits: z
        .array(
          z.object({
            find: z.string().min(1).max(4000).describe("The passage exactly as the note has it"),
            replace: z.string().max(20000).describe("What should stand there instead; empty removes the passage"),
          }),
        )
        .max(40)
        .optional(),
      append: z.string().max(20000).optional().describe("A paragraph to add"),
      section: z.string().max(512).optional().describe("With append: the section to add it to, as get_outline names it"),
      note: z.string().max(300).optional().describe("One sentence for the user: what this proposal is for"),
    }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "set_property",
    description:
      "Proposes a value for one property of a note (its frontmatter), or with `value: null` that the property is removed. The user accepts or declines the proposal in Plainva. A value is text, a number, true/false or a list of those; a date is text like 2026-10-07.",
    risk: "write",
    input: z.object({
      path,
      key: z.string().min(1).max(120).describe("The property's name as the note or its database writes it"),
      value: z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.union([z.string().max(2000), z.number(), z.boolean()])).max(50), z.null()]),
      note: z.string().max(300).optional().describe("One sentence for the user: why this value"),
    }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "create_note",
    description:
      "Drafts a new note. It does not exist until the user creates it from the draft in Plainva. Give its title and its text in Markdown; `folder` only where the user named one — otherwise it goes to the vault's inbox.",
    risk: "write",
    input: z.object({
      title: z.string().min(1).max(200),
      content: z.string().max(100000).describe("The note's text in Markdown, without a title heading and without frontmatter"),
      folder: z.string().max(1024).optional().describe("Vault-relative folder"),
    }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "create_task",
    description:
      "Drafts a new task in the user's own words, for example 'Call the roofer tomorrow 9:00 !!! #house'. Plainva reads date, time, priority (one to three exclamation marks standing alone: ! low, !! medium, !!! high), tags and repetition from the words, as it does when the user captures a task; the task is created when the user says so.",
    risk: "write",
    input: z.object({ text: z.string().min(1).max(500).describe("The task as one line") }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "add_journal_entry",
    description: "Drafts a line for today's journal, the daily note; `task: true` gives it an open checkbox. It is written when the user says so.",
    risk: "write",
    input: z.object({ text: z.string().min(1).max(2000), task: z.boolean().optional() }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "create_entry",
    description:
      "Drafts a new entry of a database (a .base file): a note in the database's folder with the given properties. It is created when the user says so. query_base shows which properties the database has.",
    risk: "write",
    input: z.object({
      base: z.string().min(1).max(1024).describe("Vault-relative path of the .base file"),
      title: z.string().min(1).max(200),
      properties: z.record(z.string().min(1).max(120), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.union([z.string().max(2000), z.number(), z.boolean()])).max(50)])).optional(),
      content: z.string().max(100000).optional().describe("The entry's text in Markdown"),
    }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "rename_note",
    description:
      "Lays out a plan to rename a note; the links that point to it are updated with it. The user sees the plan — the new name and every note whose links change — and confirms it before anything happens.",
    risk: "critical",
    input: z.object({ path, title: z.string().min(1).max(200).describe("The new name, without folder and without .md") }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "move_note",
    description: "Lays out a plan to move a note into another folder of the vault. The user sees the plan and confirms it before anything happens.",
    risk: "critical",
    input: z.object({ path, folder: z.string().max(1024).describe("Vault-relative target folder; empty for the vault itself") }),
    dataClasses: [],
    untrustedResult: false,
    core: false,
    surfaces: ["harness"],
    native: null,
    pageLimit: 1,
  },
  {
    name: "delete_note",
    description:
      "Asks the user to delete a note. Plainva opens its own delete dialog, which shows everything that would go with it; nothing is deleted unless the user confirms there.",
    risk: "critical",
    input: z.object({ path }),
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

/** The tools of a surface that every conversation loads, where its vault can serve them. */
export function coreTools(surface: ToolSurface = "harness"): ToolManifest[] {
  return toolsFor(surface).filter((tool) => tool.core);
}

/** Words that say nothing about what is looked for: every description holds them. */
const FILLER_WORDS = new Set(["the", "and", "for", "with", "from", "that", "this", "what", "how", "are", "you", "can", "any", "all", "its", "into", "about", "one", "tool", "tools"]);

/** The words a search compares: lower case, three letters or more, without the fillers. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !FILLER_WORDS.has(w));
}

/** How many of the words a text holds. */
export function wordScore(words: readonly string[], text: string): number {
  const hay = text.toLowerCase();
  return words.filter((w) => hay.includes(w)).length;
}

/**
 * Plainva's own tool search (ADR 0019): the tools of `pool` — a
 * conversation's further tools — whose name or description share a word with
 * the query, best overlap first. Used where the provider has no tool search
 * of its own.
 */
export function findTools(query: string, pool: readonly ToolManifest[], max = 5): ToolManifest[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  return pool
    .map((tool) => ({ tool, score: wordScore(words, `${tool.name.replace(/_/g, " ")} ${tool.description}`) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, max)
    .map((hit) => hit.tool);
}

/** JSON Schema of a tool's input, as the provider adapters and MCP send it. A foreign tool's is the reading copy of what its server listed. */
export function toolInputJsonSchema(tool: ToolManifest): Record<string, unknown> {
  if (tool.foreign) return tool.foreign.schema;
  const schema = z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** An app command as the tool search lists it: its id for `run_command`, and what it does. */
export interface ListedCommand {
  id: string;
  label: string;
}

const COMMAND_WORDS = /\b(commands?|app|navigat\w*|views?)\b/i;

/**
 * What `find_tools` answers (ADR 0019): the further tools and the app
 * commands that match the query, each with what it takes — a tool with the
 * schema of its arguments, exactly as a tool of the conversation's own list
 * would have it. A query that matches nothing gets everything: the catalog is
 * small, and a model that asked in another language still finds its way.
 */
export function findToolsText(query: string, pool: readonly ToolManifest[], commands: readonly ListedCommand[]): string {
  const words = searchWords(query);
  let tools = findTools(query, pool, 6);
  let listed = COMMAND_WORDS.test(query) ? [...commands] : commands.filter((command) => wordScore(words, `${command.id.replace(/-/g, " ")} ${command.label}`) > 0);
  const nothing = tools.length === 0 && listed.length === 0;
  if (nothing) {
    tools = [...pool];
    listed = [...commands];
  }
  if (tools.length === 0 && listed.length === 0) return "There are no further tools and no app commands in this conversation.";
  const lines: string[] = [];
  if (nothing) lines.push(`Nothing matches "${query.trim().slice(0, 80)}" by name. Everything there is:`, "");
  if (tools.length) {
    lines.push(`Tools — call one through ${DISPATCH_TOOL}, with its name and its arguments:`);
    for (const tool of tools) lines.push(`- ${tool.name} — ${tool.description}`, `  arguments: ${JSON.stringify(toolInputJsonSchema(tool))}`);
  }
  if (listed.length) {
    if (tools.length) lines.push("");
    lines.push("App commands — run one through run_command, with its id:");
    for (const command of listed) lines.push(`- ${command.id} — ${command.label}`);
  }
  return lines.join("\n");
}

/**
 * The tools of foreign servers that `find_tools` lists for a query, as lines
 * (plan KI-Harness P4.5): the matching ones, or all where nothing matches —
 * like the app's own. Every word of a line but the name is a server's: the
 * caller puts the text into the data fence, where a description is
 * information about a tool and never an instruction.
 */
export function foreignToolsText(query: string, pool: readonly ToolManifest[], max = 8): string {
  if (pool.length === 0) return "";
  const hits = findTools(query, pool, max);
  const tools = hits.length ? hits : pool.slice(0, max);
  return tools.map((tool) => `- ${tool.name} (${tool.foreign?.label ?? ""}) — ${tool.description}\n  arguments: ${JSON.stringify(toolInputJsonSchema(tool))}`).join("\n");
}

/** Validates and completes tool arguments (defaults applied); never throws. */
export function parseToolInput(tool: ToolManifest, args: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const result = tool.input.safeParse(args ?? {});
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") };
}
