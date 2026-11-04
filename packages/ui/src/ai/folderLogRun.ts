import {
  FOLDER_LOG_NOTES_MAX,
  countsForLog,
  estimateTokens,
  folderLogPath,
  gateDecision,
  isCloudRecipient,
  logBullets,
  logDay,
  logItem,
  logItemSaysSomething,
  logRequest,
  readLogAnswer,
  sensitiveFindings,
  sensitiveKinds,
  withLogEntry,
  withholdDeniedLinks,
  withholdPlaces,
  type AiPolicyDimension,
  type ContextPolicyHost,
  type EgressManifest,
  type EgressRecipient,
  type LogItem,
  type LogWords,
} from "@plainva/core";
import { defuseNewAddresses } from "./aiWriteLint";

/**
 * A folder's log, the part with the vault in it (plan KI-Harness P8-2; ADR
 * 0033, addendum): what a run would bring along — the notes of one folder
 * that changed, each with what it gained, as far as the recipient and the
 * place of the log allow —, and the entry it leaves in `log.md`.
 *
 * Two rules decide what an entry may rest on. The recipient's: a note the
 * rules keep from a provider is not shown to one, like everywhere. And the
 * log's own place: `log.md` carries no rules of its own — it has no
 * properties —, so it holds exactly the rules of its folder. A note that
 * carries stricter rules than that is left out of the log altogether — not
 * named, not counted, not shown to any model —, or a log would say about a
 * note what the note's own rules keep back.
 */

/** What a shell gives a folder's log; absent where it cannot keep one. */
export interface FolderLogHost {
  /**
   * The notes in a folder and below it whose file changed after `since`,
   * newest first, at most `limit` — with when each was made on this device,
   * where the index knows it. A sync counts as a change.
   */
  changed(folder: string, since: number, limit: number): Promise<{ path: string; title: string; mtime: number; created: number | null }[]>;
  /** A note's text before its first change after `since`; null where the vault keeps no earlier state of it. */
  before(path: string, since: number): Promise<string | null>;
  /**
   * Changes the log file where it lies, through the chain's one entry for a change (Sammelplan 3.87): `change` is
   * handed the file as it is at that moment — null where there is none yet — and answers the log with the new entry.
   * What it replaces is kept in the vault's version history where there is one. Answers what was written.
   */
  update(path: string, change: (text: string | null) => string | null): Promise<string | null>;
}

/** How far the index is asked: more than an entry names, so that what is left out for its rules does not hide what counts. */
const SCAN = FOLDER_LOG_NOTES_MAX * 5;
const DIMENSIONS: readonly AiPolicyDimension[] = ["cloud", "web"];
const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const top = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : "");

export interface LogMaterial {
  /** The notes the entry will name, in the order it names them. */
  items: LogItem[];
  /** Notes that changed beyond what one entry names. */
  more: number;
  /** The request's own words: the notes with what they gained, and what to write. */
  request: string;
  /** Names in the send overview what the request carries. */
  disclose(manifest: EgressManifest): EgressManifest;
  /** What the request showed of the notes: an address in the answer that stands in none of it is the model's own. */
  shown: string[];
  /** The instant the index was asked: the next entry looks from here. */
  asOf: number;
}

/**
 * `nothing`: no note changed that the log may speak about. `rules`: the
 * folder itself is kept from this recipient — nothing of it may go there.
 */
export type LogMaterialOutcome = { kind: "material"; material: LogMaterial } | { kind: "nothing"; asOf: number } | { kind: "rules" };

export interface LogMaterialInput {
  folder: string;
  /** Changes after this instant count. */
  since: number;
  recipient: EgressRecipient;
  /** The app's language by its English name: what the sentences are written in. */
  language: string;
  now: number;
  /** USD per million input tokens, where the provider publishes prices. */
  price?: number;
  /** For a routine's confirmation: an overview is wanted also where nothing changed. */
  evenEmpty?: boolean;
}

export async function logMaterial(
  vault: { policy: ContextPolicyHost; readNote(path: string): Promise<{ path: string; title: string; text: string } | null>; log: FolderLogHost },
  input: LogMaterialInput,
): Promise<LogMaterialOutcome> {
  const { folder, since, recipient } = input;
  const run = { recipient, webTools: false };
  const cloud = isCloudRecipient(recipient);
  const place = await vault.policy.policyOf(folderLogPath(folder));
  if (!gateDecision(place, run).allowed) return { kind: "rules" };
  const asOf = input.now;
  const changed = (await vault.log.changed(folder, since, SCAN)).filter((note) => countsForLog(folder, note.path) && note.mtime > since);
  const allowed = async (path: string) => gateDecision(await vault.policy.policyOf(path), run).allowed;
  const items: LogItem[] = [];
  let more = 0;
  for (const note of changed) {
    const read = await vault.readNote(note.path).catch(() => null);
    if (!read) continue;
    const policy = await vault.policy.policyOf(note.path, read.text);
    // Stricter than the place of the log, or kept from this recipient: the log says nothing of it.
    if (DIMENSIONS.some((dimension) => policy.policy[dimension] === "deny" && place.policy[dimension] !== "deny") || !gateDecision(policy, run).allowed) continue;
    const fresh = note.created !== null && note.created > since;
    const before = fresh ? null : await vault.log.before(note.path, since).catch(() => null);
    const item = logItem({ path: note.path, title: note.title || titleOf(note.path), fresh, text: read.text, before });
    if (!logItemSaysSomething(item)) continue;
    if (items.length >= FOLDER_LOG_NOTES_MAX) {
      more += 1;
      continue;
    }
    // What a provider is shown: a place stays on the device, and a link to a note the rules keep back names nothing.
    const places = withholdPlaces(item.shown).text;
    items.push({ ...item, shown: cloud ? (await withholdDeniedLinks(places, note.path, vault.policy, allowed)).text : places });
  }
  if (items.length === 0 && !input.evenEmpty) return { kind: "nothing", asOf };
  // New notes first, then by title: an entry reads the same whatever order the index gave.
  items.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || (a.path < b.path ? -1 : 1) : a.kind === "new" ? -1 : 1));
  const request = logRequest(folder, items, input.language);
  const seen = items.map((item) => (cloud ? sensitiveKinds(sensitiveFindings(item.shown)) : []));
  const kinds = [...new Set(seen.flat())];
  const disclose = (manifest: EgressManifest): EgressManifest => {
    const estimatedTokens = manifest.estimatedTokens + estimateTokens(request);
    const sensitive = [...new Set([...(manifest.sensitive ?? []), ...kinds])];
    return {
      ...manifest,
      estimatedTokens,
      ...(input.price ? { estimatedCostUsd: (estimatedTokens / 1_000_000) * input.price } : {}),
      sources: [
        ...items.map((item, index) => ({ path: item.path, title: item.title, tier: "evidence" as const, chars: item.shown.length, reasons: ["edited" as const], ...(seen[index]!.length ? { sensitive: seen[index]! } : {}) })),
        ...manifest.sources,
      ],
      ...(sensitive.length ? { sensitive } : {}),
      dataClasses: manifest.dataClasses.includes("notes") ? manifest.dataClasses : [...manifest.dataClasses, "notes"],
      // The folder is named whether or not a note of it goes today: it is what the routine was set up for.
      folders: [...new Set([...manifest.folders, top(folderLogPath(folder)), ...items.map((item) => top(item.path))])].sort(),
    };
  };
  return { kind: "material", material: { items, more, request, disclose, shown: items.map((item) => item.shown), asOf } };
}

/**
 * The entry a run leaves: the model's sentences read out of its answer — one
 * per note, every other line dropped, an address it brought made inert — and
 * laid into the lines the app writes. Returns the file's whole new text.
 */
export function logEntryText(existing: string | null, input: { folder: string; material: Pick<LogMaterial, "items" | "more" | "shown">; answer: string; day: Date; title: string; words: LogWords }): string {
  const sentences = new Map<number, string>();
  for (const [number, sentence] of readLogAnswer(input.answer, input.material.items.length)) {
    const safe = defuseNewAddresses(sentence, input.material.shown).text.replace(/[\r\n]+/g, " ").trim();
    if (safe) sentences.set(number, safe);
  }
  return withLogEntry(existing, { title: input.title, day: logDay(input.day), bullets: logBullets(input.folder, input.material.items, sentences, input.words) });
}
