import { stripInvisible } from "../trust.js";

/**
 * What a foreign MCP server says about itself — the client side (ADR 0019,
 * threat T10). Plainva connects to servers the user added; everything a server
 * sends is untrusted: its instructions, the descriptions of its tools, its
 * prompts and what they expand to. These are the texts a model reads as if
 * they came from the app, so they are the place a server lies in.
 *
 * This module holds the shapes and the two reductions every such text goes
 * through before a person or a model sees it: invisible characters removed,
 * length capped. No transport and no SDK live here (they arrive with the
 * client itself); a listing is plain JSON as `tools/list`, `prompts/list`,
 * `prompts/get` and the server's `instructions` return it.
 */

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: McpToolAnnotations;
  [key: string]: unknown;
}

export interface McpPromptDescriptor {
  name: string;
  title?: string;
  description?: string;
  arguments?: unknown;
  [key: string]: unknown;
}

export interface McpListing {
  /** The server's own "how to use me" text; absent and empty are the same. */
  instructions: string;
  tools: McpToolDescriptor[];
  prompts: McpPromptDescriptor[];
  /**
   * What prompts expand to (`prompts/get`), by `mcpPromptKey`. Only the
   * expansions the client fetched: a prompt is a template the user starts, and
   * its text reaches the model like an instruction.
   */
  promptBodies: Record<string, unknown>;
}

/** Texts a server supplies are cut here before anyone reads them (a limit other harnesses use as well). */
export const MCP_TEXT_LIMIT = 2048;
/** The specification recommends 1–128 characters for a name. */
export const MCP_NAME_LIMIT = 128;
export const MCP_MAX_TOOLS = 200;
export const MCP_MAX_PROMPTS = 100;

export interface McpCappedText {
  text: string;
  truncated: boolean;
  /** Format characters removed (zero-width, bidi, the tag block): never shown, never sent. */
  invisible: number;
}

/**
 * A server-supplied text as a person and a model may read it: invisible
 * characters removed first (they could push the visible part past the cut, or
 * carry instructions nobody sees), then cut at `limit` characters — whole code
 * points, never half a surrogate pair.
 */
export function capMcpText(raw: unknown, limit: number = MCP_TEXT_LIMIT): McpCappedText {
  if (typeof raw !== "string" || raw === "") return { text: "", truncated: false, invisible: 0 };
  const { text, removed } = stripInvisible(raw);
  let end = 0;
  let count = 0;
  for (const character of text) {
    if (count === limit) return { text: text.slice(0, end), truncated: true, invisible: removed };
    end += character.length;
    count++;
  }
  return { text, truncated: false, invisible: removed };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MCP_NAME_LIMIT;

/** The identity of one prompt expansion: its name and the arguments it was asked with. */
export function mcpPromptKey(name: string, args: Readonly<Record<string, string>> = {}): string {
  const sorted = Object.keys(args)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(args[key])}`);
  return `${name}\u0000{${sorted.join(",")}}`;
}

/**
 * Reads what a server returned, defensively: entries without a usable name
 * are dropped, lists are bounded, anything that is not an object is ignored.
 * A server cannot make the client fail by sending a malformed list — and
 * cannot make it look at ten thousand tools either.
 */
export function readMcpListing(raw: {
  instructions?: unknown;
  tools?: unknown;
  prompts?: unknown;
  promptBodies?: unknown;
}): McpListing {
  const tools = (Array.isArray(raw.tools) ? raw.tools : [])
    .filter((tool): tool is McpToolDescriptor => isRecord(tool) && isName(tool.name))
    .slice(0, MCP_MAX_TOOLS);
  const prompts = (Array.isArray(raw.prompts) ? raw.prompts : [])
    .filter((prompt): prompt is McpPromptDescriptor => isRecord(prompt) && isName(prompt.name))
    .slice(0, MCP_MAX_PROMPTS);
  return {
    instructions: typeof raw.instructions === "string" ? raw.instructions : "",
    tools,
    prompts,
    promptBodies: isRecord(raw.promptBodies) ? { ...raw.promptBodies } : {},
  };
}

/** A tool says of itself that it only reads. The server's claim, not a fact (see `grants.ts`). */
export function mcpDeclaresReadOnly(tool: McpToolDescriptor): boolean {
  return isRecord(tool.annotations) && tool.annotations.readOnlyHint === true;
}
