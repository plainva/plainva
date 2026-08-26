/**
 * `@Name` mentions inside a comment (Stufe D, D8).
 *
 * A mention is NOT stored. The record carries the body and nothing else, and
 * this module derives the mentions from that text against the member list every
 * time it renders. That is the whole design decision: a stored id list would be
 * a second truth the visible text can contradict the moment somebody renames
 * themselves - and it would mean a protocol change (a new field in the sealed
 * payload, the local bundle and the SQL row) for something the text already
 * says.
 *
 * The consequence is honest and worth naming: a mention resolves against the
 * names this device knows TODAY. Rename a member and old comments follow the
 * new name; remove them from the policy and the highlight falls away while the
 * typed text stays exactly as written. The file keeps what the person typed.
 *
 * Names are claims, not identities (see the plan, "Namen sind Behauptungen"):
 * two members may share one. Rendering has to pick one of them, but
 * `mentionedMemberIds` returns EVERY member the name could mean - so an
 * ambiguous mention reaches everyone it might have been meant for instead of
 * silently reaching one.
 */

export type CommentTextSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; memberId: string };

interface KnownName {
  memberId: string;
  name: string;
  lower: string;
}

/** A hit in the body: where it sits, how long it is, and who it could mean. */
interface MentionHit {
  start: number;
  end: number;
  memberIds: string[];
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * Longest name first, then by member id.
 *
 * Length decides so that "Anna Beispiel" wins over "Anna" when both exist -
 * otherwise the longer name could never be mentioned. The id is the tiebreak
 * that keeps two members with the SAME name rendering deterministically.
 */
function knownNames(names: ReadonlyMap<string, string>): KnownName[] {
  const list: KnownName[] = [];
  for (const [memberId, raw] of names) {
    const name = raw.trim();
    // A name carrying a line break or an @ of its own could never be typed back
    // as one mention, so it is never offered as one.
    if (!name || /[\n\r@]/.test(name)) continue;
    list.push({ memberId, name, lower: name.toLowerCase() });
  }
  list.sort((a, b) => b.name.length - a.name.length || a.memberId.localeCompare(b.memberId));
  return list;
}

/** An `@` only starts a mention at a word boundary - never inside an address. */
function startsMention(body: string, at: number): boolean {
  return at === 0 || !WORD.test(body[at - 1]);
}

function scanMentions(body: string, names: ReadonlyMap<string, string>): MentionHit[] {
  const known = knownNames(names);
  if (known.length === 0) return [];
  const hits: MentionHit[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "@" || !startsMention(body, i)) continue;
    const rest = body.slice(i + 1);
    const lower = rest.toLowerCase();
    let length = 0;
    const memberIds: string[] = [];
    for (const candidate of known) {
      if (length && candidate.name.length !== length) continue;
      if (!lower.startsWith(candidate.lower)) continue;
      // The match has to end the word: "@Anna" must not light up inside
      // "@Annabelle" when only "Anna" is a member.
      const after = rest[candidate.name.length];
      if (after !== undefined && WORD.test(after)) continue;
      length = candidate.name.length;
      memberIds.push(candidate.memberId);
    }
    if (!length) continue;
    const end = i + 1 + length;
    hits.push({ start: i, end, memberIds });
    i = end - 1;
  }
  return hits;
}

/**
 * Splits a comment body into plain text and mention runs.
 *
 * The mention keeps the text as TYPED, not the member's current spelling: the
 * column shows what is in the file, and a difference in case is not an error
 * worth correcting behind somebody's back.
 */
export function parseCommentMentions(body: string, names: ReadonlyMap<string, string>): CommentTextSegment[] {
  const hits = scanMentions(body, names);
  if (hits.length === 0) return body ? [{ kind: "text", text: body }] : [];
  const segments: CommentTextSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) segments.push({ kind: "text", text: body.slice(cursor, hit.start) });
    segments.push({ kind: "mention", text: body.slice(hit.start, hit.end), memberId: hit.memberIds[0] });
    cursor = hit.end;
  }
  if (cursor < body.length) segments.push({ kind: "text", text: body.slice(cursor) });
  return segments;
}

/** Every member a body could be addressing. An ambiguous name yields all of them. */
export function mentionedMemberIds(body: string, names: ReadonlyMap<string, string>): Set<string> {
  const ids = new Set<string>();
  for (const hit of scanMentions(body, names)) {
    for (const memberId of hit.memberIds) ids.add(memberId);
  }
  return ids;
}

/**
 * Does any of these bodies address `memberId`?
 *
 * Takes the bodies rather than a thread type so both shells can hand in their
 * own shape - the desktop column and the phone sheet build the same threads,
 * but each declares them locally.
 */
export function mentionsMember(
  bodies: readonly string[],
  memberId: string | null,
  names: ReadonlyMap<string, string>,
): boolean {
  if (!memberId) return false;
  return bodies.some((body) => mentionedMemberIds(body, names).has(memberId));
}

export interface MentionQuery {
  /** Offset of the `@` - replaced when a name is picked. */
  from: number;
  /** Caret offset the query was taken at. */
  to: number;
  query: string;
  matches: Array<{ memberId: string; name: string }>;
}

const MAX_SUGGESTIONS = 8;
/** Past this, a run of text is prose that happens to follow an `@`, not a name. */
const MAX_QUERY = 48;

/**
 * What the picker should offer at the caret - or null for "nothing".
 *
 * Display names contain spaces, so the query cannot stop at the first one. It
 * stops at as many words as the longest known name has: past that no member
 * could match anyway, and the picker gets out of the way instead of hanging on
 * over a whole sentence.
 */
export function mentionQuery(body: string, caret: number, names: ReadonlyMap<string, string>): MentionQuery | null {
  const known = knownNames(names);
  if (known.length === 0) return null;
  const start = Math.max(0, caret - MAX_QUERY - 1);
  let at = -1;
  for (let i = caret - 1; i >= start; i--) {
    const ch = body[i];
    if (ch === "\n" || ch === "\r") break;
    if (ch === "@") {
      if (startsMention(body, i)) at = i;
      break;
    }
  }
  if (at < 0) return null;
  const query = body.slice(at + 1, caret);
  if (query.includes("@")) return null;
  const maxWords = known.reduce((max, name) => Math.max(max, name.name.split(/\s+/).length), 1);
  if (query.split(/\s+/).length > maxWords) return null;

  const lower = query.toLowerCase();
  const byName = [...known].sort((a, b) => a.name.localeCompare(b.name));
  const full: KnownName[] = [];
  const word: KnownName[] = [];
  for (const candidate of byName) {
    if (!lower || candidate.lower.startsWith(lower)) full.push(candidate);
    else if (candidate.lower.split(/\s+/).some((part) => part.startsWith(lower))) word.push(candidate);
  }
  const matches = [...full, ...word].slice(0, MAX_SUGGESTIONS).map(({ memberId, name }) => ({ memberId, name }));
  return matches.length ? { from: at, to: caret, query, matches } : null;
}

/**
 * Writes the picked name into the body and says where the caret goes.
 *
 * A trailing space follows the name so typing can continue - unless one is
 * already there, because two spaces after a mention are a small mess nobody
 * asked for.
 */
export function applyMention(
  body: string,
  range: { from: number; to: number },
  name: string,
): { body: string; caret: number } {
  const tail = body.slice(range.to);
  const inserted = `@${name}${tail.startsWith(" ") ? "" : " "}`;
  return {
    body: body.slice(0, range.from) + inserted + tail,
    caret: range.from + inserted.length,
  };
}
