// Naming of freshly created .base items (plan Base-Neu P4; moved from the
// desktop newItemFlow in R4 so the mobile shell names items identically).

/** Display stem of a `.base` path ("DB/Projekte.base" -> "Projekte"). */
export function baseStemOf(path: string): string {
  return path.split("/").pop()?.replace(/\.base$/i, "") || path;
}

/**
 * "{Base-Stem}_{n}" naming (maintainer decision 2026-07-03, refined same day:
 * underscore separator, and any whitespace in the stem becomes "_" too — file
 * names created by the "Neu" button never contain spaces). n starts at count+1
 * and counts up past existing files. The stem is the base's file name, so the
 * item name needs no localization.
 */
export async function nextItemName(
  stem: string,
  count: number,
  exists: (name: string) => Promise<boolean>
): Promise<string> {
  const cleanStem = stem.replace(/\s+/g, "_");
  let n = Math.max(1, Math.floor(count) + 1);
  let name = `${cleanStem}_${n}`;
  while (await exists(name)) {
    n++;
    name = `${cleanStem}_${n}`;
  }
  return name;
}
