import type { RunMeta } from "@plainva/core";

/** How many notes the calm line under an answer names before it counts the rest (plan Oberfläche O7, M6). */
export const GROUNDS_NAMED = 2;

/**
 * The notes an answer rests on, by the names the reader knows them by (plan
 * Oberfläche O7, M6: "Grundlage: Website relaunch"): the notes that went with
 * it — a picture is none —, each once, in the order of the send overview; the
 * run's paths where it kept no overview.
 */
export function groundTitles(run: Pick<RunMeta, "sent" | "manifest">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sources = run.manifest ? run.manifest.sources.filter((s) => !s.image).map((s) => ({ path: s.path, title: s.title })) : run.sent.map((path) => ({ path, title: "" }));
  for (const { path, title } of sources) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(title || path.replace(/^.*\//, "").replace(/\.md$/i, ""));
  }
  return out;
}
