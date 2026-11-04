import { capMcpText } from "./listing.js";

/**
 * The arguments of a foreign tool as a model gets to read them.
 *
 * A tool's input schema is the fourth place a server writes text a model
 * reads: every argument can carry a description, and a schema can be as
 * large and as deep as its author likes. The pin covers the schema as the
 * server sent it; this is the reading copy — only keywords that say what an
 * argument is, every text cleaned and cut, depth and width bounded, and the
 * whole within a size that fits a tool search answer.
 *
 * It is a description for the model, not a validator: the server checks the
 * arguments it gets. Nothing is resolved (`$ref` stays a name, and only one
 * that points into the schema itself), and nothing is fetched.
 */

/** Characters of JSON one tool's arguments may take where tools are listed. */
export const MCP_SCHEMA_VIEW_LIMIT = 4000;

const TEXT_LIMIT = 300;
const NAME_LIMIT = 64;
const MAX_PROPERTIES = 40;
const MAX_CHOICES = 40;
const MAX_ALTERNATIVES = 8;

/** Keywords copied as they are, where their value is of the given kind. */
const NUMBERS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "multipleOf"];
const FLAGS = ["uniqueItems", "nullable", "readOnly", "deprecated"];
const SUBSCHEMAS = ["items", "additionalProperties", "not"];
const ALTERNATIVES = ["anyOf", "oneOf", "allOf", "prefixItems"];
const NAMED = ["properties", "$defs", "definitions"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, limit: number): string => capMcpText(value, limit).text;

/** A value a model may see as an example of an argument: a short text, a number, a truth value, null. */
function primitive(value: unknown): { ok: true; value: string | number | boolean | null } | { ok: false } {
  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value === "string") return { ok: true, value: text(value, 120) };
  return { ok: false };
}

function view(schema: unknown, depth: number, describe: boolean): Record<string, unknown> | boolean | null {
  if (typeof schema === "boolean") return schema;
  if (!isRecord(schema)) return null;
  const out: Record<string, unknown> = {};

  if (typeof schema.type === "string") out.type = schema.type.slice(0, 16);
  else if (Array.isArray(schema.type)) out.type = schema.type.filter((t): t is string => typeof t === "string").slice(0, 7).map((t) => t.slice(0, 16));

  if (describe) {
    for (const key of ["title", "description"]) {
      const value = text(schema[key], TEXT_LIMIT);
      if (value) out[key] = value;
    }
  }
  if (typeof schema.format === "string") out.format = text(schema.format, 40);
  if (typeof schema.pattern === "string") out.pattern = text(schema.pattern, 120);
  // Only a pointer into this schema: nothing is ever fetched for a tool's arguments.
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/")) out.$ref = text(schema.$ref, 120);
  for (const key of NUMBERS) if (typeof schema[key] === "number" && Number.isFinite(schema[key])) out[key] = schema[key];
  for (const key of FLAGS) if (typeof schema[key] === "boolean") out[key] = schema[key];
  for (const key of ["default", "const"]) {
    const value = primitive(schema[key]);
    if (key in schema && value.ok) out[key] = value.value;
  }
  if (Array.isArray(schema.enum)) {
    const choices = schema.enum.map(primitive).flatMap((choice) => (choice.ok ? [choice.value] : []));
    if (choices.length) out.enum = choices.slice(0, MAX_CHOICES);
  }
  if (Array.isArray(schema.required)) {
    const required = schema.required.filter((name): name is string => typeof name === "string" && name !== "" && text(name, NAME_LIMIT) === name);
    if (required.length) out.required = required.slice(0, MAX_PROPERTIES);
  }

  // Below the depth limit an argument is still named; what it holds is left to the server's own check.
  if (depth <= 0) return out;
  for (const key of NAMED) {
    if (!isRecord(schema[key])) continue;
    const named: Record<string, unknown> = {};
    for (const [rawName, inner] of Object.entries(schema[key]).slice(0, MAX_PROPERTIES)) {
      // An argument is called by its exact name: one that cleaning would change cannot be offered under another.
      if (!rawName || text(rawName, NAME_LIMIT) !== rawName) continue;
      const child = view(inner, depth - 1, describe);
      if (child !== null) named[rawName] = child;
    }
    if (Object.keys(named).length) out[key] = named;
  }
  for (const key of SUBSCHEMAS) {
    const child = view(schema[key], depth - 1, describe);
    if (child !== null) out[key] = child;
  }
  for (const key of ALTERNATIVES) {
    if (!Array.isArray(schema[key])) continue;
    const children = schema[key].slice(0, MAX_ALTERNATIVES).map((inner) => view(inner, depth - 1, describe)).filter((child) => child !== null);
    if (children.length) out[key] = children;
  }
  return out;
}

export interface McpSchemaView {
  schema: Record<string, unknown>;
  /** Detail was left out to stay within the limit: the model sees less than the server described. */
  reduced: boolean;
}

/** The reading copy of a tool's input schema: at most `limit` characters of JSON, always an object schema. */
export function mcpSchemaView(inputSchema: unknown, limit: number = MCP_SCHEMA_VIEW_LIMIT): McpSchemaView {
  // Full detail first, then shallower, then without the descriptions of the arguments.
  const attempts: [depth: number, describe: boolean][] = [
    [5, true],
    [3, true],
    [2, true],
    [2, false],
    [1, false],
  ];
  for (const [index, [depth, describe]] of attempts.entries()) {
    const copy = view(inputSchema, depth, describe);
    const schema: Record<string, unknown> = isRecord(copy) ? { ...copy, type: "object" } : { type: "object" };
    if (JSON.stringify(schema).length <= limit) return { schema, reduced: index > 0 };
  }
  return { schema: { type: "object" }, reduced: true };
}
