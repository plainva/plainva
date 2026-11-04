import { isReservedPropertyName } from "@plainva/core";
import { baseInputToType, type PropertyType } from "./propertyModel";

export interface KnownProperty { name: string; type: string; count: number }
export interface ValueSuggestion { value: string; count: number }
export type ValueSuggestionLoader = (key: string, wholeVault?: boolean) => Promise<ValueSuggestion[]>;
export interface PropertySuggestionSource {
  getKnownProperties(query?: string, limit?: number): Promise<KnownProperty[]>;
  getDistinctPropertyValues(key: string, folder?: string, types?: readonly string[]): Promise<ValueSuggestion[]>;
}
/** The names nobody adds a property under — the core's one answer, which a value an assistant proposes asks too. */
export function reservedPropertyName(name: string): boolean {
  return isReservedPropertyName(name);
}
export function propertyFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "/" : path.slice(0, i + 1);
}
export function propertyIndexTypes(type: string): readonly string[] {
  if (type === "number") return ["number"];
  if (type === "checkbox") return ["boolean"];
  if (["list", "tags", "multiselect", "select", "status"].includes(type)) return ["string", "list"];
  return ["string"];
}
export function suggestedPropertyType(name: string, indexType: string | undefined,
  columns: Record<string, { input?: string }> | undefined, registry: Record<string, PropertyType>): PropertyType {
  return baseInputToType(columns?.[name]?.input)
    ?? ({ string: "text", number: "number", boolean: "checkbox", list: name === "tags" ? "tags" : "list" } as Record<string, PropertyType>)[indexType ?? ""]
    ?? registry[name] ?? "text";
}
export function propertyNames(known: KnownProperty[], columns: Record<string, { input?: string }> | undefined,
  registry: Record<string, PropertyType>, existing: string[], query: string): (KnownProperty & { input: PropertyType })[] {
  const fold = (s: string) => s.normalize("NFC").toLocaleLowerCase();
  const excluded = new Set(existing.map(fold));
  const all = new Map(known.map((p) => [p.name, p]));
  for (const name of [...Object.keys(columns ?? {}), ...Object.keys(registry)]) {
    if (!all.has(name)) all.set(name, { name, type: "", count: 0 });
  }
  return [...all.values()].filter((p) => !reservedPropertyName(p.name) && !excluded.has(fold(p.name)) && fold(p.name).includes(fold(query.trim())))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 30)
    .map((p) => ({ ...p, input: suggestedPropertyType(p.name, p.type, columns, registry) }));
}
