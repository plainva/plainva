import { prepareReaderSource, selectNoteFragment } from "@plainva/core";
import { splitLinkAnchor } from "./linkAnchor";

export type NoteEmbedTarget = { status: "found"; path: string; anchor: string | null } | { status: "missing" };

/**
 * Which file an embed shows: the one the same text opens as a link.
 *
 * `resolve` is the shell's own "where does this link lead" — the desktop asks
 * `VaultQueryService.resolveNotePath`, the phone `vaultOps.resolveWikiTarget` —
 * and both answer by the one link rule (`LinkResolver.ts` in the core). The
 * embed used to carry a lookup of its own (a path beside the note, then a
 * title or the end of a path in SQL), and where two notes shared a name it
 * showed "matches more than one note" while the link beside it opened one and
 * the graph drew an edge to one (finding 2026-10-08). The rule picks the same
 * note everywhere now, so an embed shows it.
 */
export async function resolveNoteEmbed(raw: string, hostPath: string | undefined, ports: {
  resolve(target: string, hostPath?: string): Promise<string | null>;
}): Promise<NoteEmbedTarget> {
  const { target, anchor } = splitLinkAnchor(raw.split("|")[0]);
  if (!target) return hostPath ? { status: "found", path: hostPath, anchor } : { status: "missing" };
  const path = await ports.resolve(target, hostPath);
  return path ? { status: "found", path, anchor } : { status: "missing" };
}

/** Mobile's text card expands the same fragments with a bounded amount of IO. */
export async function noteEmbedPreview(raw: string, hostPath: string, ports: Parameters<typeof resolveNoteEmbed>[2] & {
  read(path: string): Promise<string>;
  message(kind: "missing" | "ambiguous" | "depth" | "unreadable", target: string): string;
}): Promise<string> {
  let reads = 0, remaining = 256_000;
  const walk = async (text: string, path: string, depth: number, trail: Set<string>): Promise<string> => {
    if (text.length > remaining) return ports.message("depth", path);
    remaining -= text.length;
    const source = prepareReaderSource(text);
    const pieces: string[] = [];
    let cursor = 0;
    for (const embed of source.embeds) {
      pieces.push(source.text.slice(cursor, embed.from));
      cursor = embed.to;
      if (depth >= 3 || reads >= 20) { pieces.push(ports.message("depth", embed.target)); continue; }
      try {
        const target = await resolveNoteEmbed(embed.target, path, ports);
        if (target.status !== "found") { pieces.push(ports.message(target.status, embed.target)); continue; }
        const key = `${target.path}#${target.anchor ?? ""}`;
        if (trail.has(key)) { pieces.push(ports.message("depth", embed.target)); continue; }
        reads++;
        const fragment = selectNoteFragment(await ports.read(target.path), target.anchor);
        pieces.push(fragment.status === "found" ? await walk(fragment.text, target.path, depth + 1, new Set([...trail, key])) : ports.message(fragment.status, embed.target));
      } catch { pieces.push(ports.message("unreadable", embed.target)); }
    }
    pieces.push(source.text.slice(cursor));
    return pieces.join("");
  };
  return walk(raw, hostPath, 1, new Set());
}
