/**
 * Deterministic canonical JSON (RFC 8785 / JCS style) for authenticated control
 * documents (v3 §3.5). Object keys are sorted, no insignificant whitespace,
 * `undefined`-valued keys are omitted (like JSON). Restricted to the value types
 * the manifest uses (strings, finite integers, booleans, null, objects, arrays);
 * non-finite numbers are rejected so a NaN can never change a MAC input.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalize value of type ${t}`);
}
