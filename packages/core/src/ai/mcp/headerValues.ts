import { toBase64, utf8Encode } from "../../workspace/encoding.js";

/**
 * Request headers of the stateless revision over HTTP (specification
 * 2026-07-28, "Request Metadata"): a tool's name travels in `Mcp-Name`, and a
 * server may mark arguments in a tool's schema (`x-mcp-header`) whose values
 * travel in `Mcp-Param-<Name>` — so that a gateway can route a call without
 * reading its body.
 *
 * Both are text a server and a model supply, placed into a header. So every
 * value is checked before it gets there: plain where a header can carry it
 * as it is, otherwise the Base64 form of the specification. A line break in
 * an argument never becomes a line break in a request.
 */

const SENTINEL_START = "=?base64?";
const SENTINEL_END = "?=";

/** Visible ASCII, with spaces and tabs only inside — what a header value may be as it is. */
function plainHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x20 || code === 0x09) {
      if (i === 0 || i === value.length - 1) return false;
      continue;
    }
    if (code < 0x21 || code > 0x7e) return false;
  }
  // A plain value that looks like the encoded form would be decoded by the server: it is encoded itself.
  return !(value.startsWith(SENTINEL_START) && value.endsWith(SENTINEL_END));
}

/** A value as a header carries it: as it is where that is safe, else `=?base64?…?=` over its UTF-8 bytes. */
export function mcpHeaderValue(value: string): string {
  return plainHeaderValue(value) ? value : `${SENTINEL_START}${toBase64(utf8Encode(value))}${SENTINEL_END}`;
}

export type McpHeaderAnnotationProblem =
  /** `x-mcp-header` is empty or not a string. */
  | "empty"
  /** Not a header name (RFC 9110 token). */
  | "not-a-token"
  /** Two arguments ask for the same header, upper and lower case aside. */
  | "duplicate"
  /** The argument is not a string, an integer or a boolean. */
  | "type"
  /** The annotation sits where no call's arguments can be read by a fixed path (in `items`, in `anyOf`, behind `$ref`), or the schema is too large to tell. */
  | "unreachable";

export interface McpHeaderParam {
  /** The name part of `Mcp-Param-<name>`, as the server spelled it. */
  header: string;
  /** The chain of property names from the root of the arguments. */
  path: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const ANNOTATION = "x-mcp-header";
/** Keywords whose value maps names to schemas: the names are an author's, not keywords. */
const NAME_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
/** Keywords whose value is an instance, not a schema: an `x-mcp-header` key in there annotates nothing. */
const INSTANCES = new Set(["default", "const", "enum", "examples"]);
const SCAN_LIMIT = 5000;

function isToken(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    const letter = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9");
    if (!letter && !"!#$%&'*+-.^_`|~".includes(c)) return false;
  }
  return true;
}

/** How often the annotation appears anywhere in a schema; `Infinity` where the schema is too large to walk. */
function countAnnotations(schema: unknown): number {
  let found = 0;
  let seen = 0;
  const walk = (node: unknown): void => {
    if (seen++ > SCAN_LIMIT) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === ANNOTATION) found++;
      else if (INSTANCES.has(key)) continue;
      else if (NAME_MAPS.has(key) && isRecord(value)) Object.values(value).forEach(walk);
      else walk(value);
    }
  };
  walk(schema);
  return seen > SCAN_LIMIT ? Number.POSITIVE_INFINITY : found;
}

/**
 * The arguments of a tool that travel as headers too — or why the tool cannot
 * be offered over HTTP. The specification leaves a client no room here: a tool
 * whose annotation breaks a rule is taken out of the list.
 *
 * An annotation counts only on a property reached from the root through
 * `properties` alone; every annotation anywhere else makes the tool invalid.
 */
export function readMcpHeaderParams(inputSchema: unknown): { ok: true; params: McpHeaderParam[] } | { ok: false; problem: McpHeaderAnnotationProblem } {
  const params: McpHeaderParam[] = [];
  let problem: McpHeaderAnnotationProblem | null = null;
  const names = new Set<string>();
  const collect = (schema: unknown, path: string[]): void => {
    if (problem || !isRecord(schema) || !isRecord(schema.properties) || path.length > 8) return;
    for (const [name, property] of Object.entries(schema.properties)) {
      if (problem) return;
      if (!isRecord(property)) continue;
      if (ANNOTATION in property) {
        const header = property[ANNOTATION];
        if (typeof header !== "string" || header === "") problem = "empty";
        else if (!isToken(header)) problem = "not-a-token";
        else if (property.type !== "string" && property.type !== "integer" && property.type !== "boolean") problem = "type";
        else if (names.has(header.toLowerCase())) problem = "duplicate";
        else {
          names.add(header.toLowerCase());
          params.push({ header, path: [...path, name] });
        }
      }
      collect(property, [...path, name]);
    }
  };
  collect(inputSchema, []);
  if (problem) return { ok: false, problem };
  // Every annotation must be one of those just read; one more means it sits where the rules forbid it.
  if (countAnnotations(inputSchema) !== params.length) return { ok: false, problem: "unreachable" };
  return { ok: true, params };
}

function headerText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

/** The `Mcp-Param-*` headers of one call: the value at each annotated path, where the arguments have one. */
export function mcpParamHeaders(params: readonly McpHeaderParam[], args: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const param of params) {
    let value: unknown = args;
    for (const step of param.path) value = isRecord(value) && Object.prototype.hasOwnProperty.call(value, step) ? value[step] : undefined;
    const text = headerText(value);
    if (text !== null) headers[`Mcp-Param-${param.header}`] = mcpHeaderValue(text);
  }
  return headers;
}
