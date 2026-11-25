/* global URL, URLSearchParams */
/**
 * The locale files by area (performance plan L5). The source stays ONE file per language
 * (`packages/ui/src/locales/<lang>.json`, the one place every session adds its strings and `localeParity.test.ts`
 * holds); what loads is split here. `<lang>.json?area=<name>` is the part of the file whose top-level keys belong to
 * the area (`packages/ui/src/localeAreas.json`); `?area=core` is everything no area claims. The start waits for the
 * core only (`i18n.ts`).
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const AREAS_FILE = fileURLToPath(new URL("../../packages/ui/src/localeAreas.json", import.meta.url));

/** @returns {Record<string, string[]>} */
export function readLocaleAreas() {
  return JSON.parse(fs.readFileSync(AREAS_FILE, "utf8"));
}

/** The part of a locale object that belongs to `area` (`core`: every top-level key no area claims). */
export function localeArea(messages, area, areas = readLocaleAreas()) {
  const claimed = new Set(Object.values(areas).flat());
  const own = area === "core" ? null : new Set(areas[area] ?? []);
  if (own === null && area !== "core") throw new Error(`unknown locale area "${area}"`);
  const out = {};
  for (const [key, value] of Object.entries(messages)) {
    if (area === "core" ? !claimed.has(key) : own.has(key)) out[key] = value;
  }
  return out;
}

export function localeAreas() {
  return {
    name: "plainva-locale-areas",
    enforce: "pre",
    load(id) {
      const [file, query] = id.split("?");
      if (!query || !/[\\/]locales[\\/][^\\/]+\.json$/.test(file)) return null;
      const area = new URLSearchParams(query).get("area");
      if (!area) return null;
      if (area !== "core" && !(area in readLocaleAreas())) throw new Error(`unknown locale area "${area}" in ${id}`);
      this.addWatchFile?.(file);
      this.addWatchFile?.(AREAS_FILE);
      // A module of its own (the query makes it no JSON file for the bundler): the part as a string the engine
      // parses at once, which is faster than an object literal of the same size.
      const part = JSON.stringify(localeArea(JSON.parse(fs.readFileSync(file, "utf8")), area));
      return { code: `export default JSON.parse(${JSON.stringify(part)});`, moduleType: "js", map: null };
    },
  };
}
