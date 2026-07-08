import { parsePropertyFilter } from "./filterExpr";

/**
 * Pure config side of DELETING a `.base` property (plan Base-Neu P11), the
 * counterpart of renamePropertyInConfig: every place the in-memory config
 * references the bare name is cleaned — the columns schema, each view's
 * order/sort/widths and by-name layout fields (groupBy, dateField, endField,
 * coverImage, subItemsProperty), filter rules on the property (inside groups
 * too; a group emptied by this vanishes) and the raw `_obsidian.properties`
 * entry (a stale plainva block would resurrect the column on the next parse).
 * The optional frontmatter cleanup in the notes is the caller's job.
 */
export function deletePropertyFromConfig(config: any, name: string): any {
  const nc = config == null ? {} : JSON.parse(JSON.stringify(config));

  if (!nc.columns || Array.isArray(nc.columns)) nc.columns = {};
  delete nc.columns[name];

  const prefixed = `note.${name}`;
  if (Array.isArray(nc.views)) {
    nc.views = nc.views.map((v: any) => {
      if (!v || typeof v !== "object") return v;
      const nv = { ...v };
      if (Array.isArray(nv.order)) nv.order = nv.order.filter((c: any) => c !== name && c !== prefixed);
      if (Array.isArray(nv.sort)) {
        nv.sort = nv.sort.filter((s: any) => {
          const p = s && typeof s === "object" ? (s.property ?? s.field) : null;
          return p !== name && p !== prefixed;
        });
      }
      for (const key of ["groupBy", "dateField", "endField", "coverImage", "subItemsProperty"] as const) {
        if (nv[key] === name) delete nv[key];
      }
      if (nv.widths && typeof nv.widths === "object" && name in nv.widths) {
        const w = { ...nv.widths };
        delete w[name];
        nv.widths = w;
      }
      return nv;
    });
  }

  const refersTo = (f: any): boolean => {
    if (typeof f !== "string") return false;
    const rule = parsePropertyFilter(f);
    return !!rule && rule.column.replace(/^note\./, "") === name;
  };
  const cleanList = (list: any[]): any[] =>
    list
      .map((f: any) => {
        if (f && typeof f === "object" && !Array.isArray(f)) {
          const nf: any = { ...f };
          const groupKeys = (["and", "or", "not"] as const).filter((k) => Array.isArray(nf[k]));
          if (groupKeys.length === 0) return nf; // foreign shape — untouched
          for (const k of groupKeys) nf[k] = cleanList(nf[k]);
          if (groupKeys.every((k) => nf[k].length === 0)) return null;
          return nf;
        }
        return refersTo(f) ? null : f;
      })
      .filter((f: any) => f !== null);
  if (nc.filters && typeof nc.filters === "object" && !Array.isArray(nc.filters)) {
    for (const key of ["and", "or"] as const) {
      if (Array.isArray(nc.filters[key])) nc.filters[key] = cleanList(nc.filters[key]);
    }
  }

  const rawProps = nc._obsidian?.properties;
  if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
    delete rawProps[prefixed];
  }

  return nc;
}
