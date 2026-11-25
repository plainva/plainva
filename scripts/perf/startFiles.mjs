/**
 * The files a built `index.html` loads before anything else, in its order (the bundle budget,
 * `bundle-gate.mjs`): each module script — the entry —, each `modulepreload` and each style sheet the page names
 * by a path of its own (not an address of another host).
 *
 * HTML is read as HTML reads it: tag and attribute names in any case (`<SCRIPT>`, `TYPE="module"`), the keywords of
 * `type` and `rel` in any case, a value in double quotes, single quotes or none, and `rel` as a list of words.
 * Before, only `<script`/`<link` in lower case with double-quoted values counted (code scanning, js/bad-tag-filter).
 */

/** The attributes of a tag's inside (what stands between its name and `>`), names in lower case. */
function attributesOf(inside) {
  const attrs = new Map();
  for (const match of inside.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** @param {string} html */
export function startFiles(html) {
  const files = [];
  // A tag ends at the first `>` (the build writes no `>` inside a value): each stretch before one is read once, from
  // the first tag of the two it names.
  const stretches = html.split(">");
  stretches.pop(); // what follows the last `>` closes no tag
  for (const stretch of stretches) {
    const match = /<(script|link)(?=[\s/]|$)/i.exec(stretch);
    if (!match) continue;
    const tag = match[1].toLowerCase();
    const attrs = attributesOf(stretch.slice(match.index + match[0].length));
    const ref = attrs.get(tag === "script" ? "src" : "href");
    if (!ref || /^(?:[a-z]+:)?\/\//i.test(ref)) continue;
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const isModule = tag === "script" && (attrs.get("type") ?? "").trim().toLowerCase() === "module";
    const isPreload = tag === "link" && rel.includes("modulepreload");
    const isStyle = tag === "link" && rel.includes("stylesheet");
    if (isModule || isPreload || isStyle) files.push({ path: ref.replace(/^\//, ""), entry: isModule });
  }
  return files;
}
