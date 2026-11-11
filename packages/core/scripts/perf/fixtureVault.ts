/**
 * The test vault every performance measurement runs on (Gesamtplan Leistung
 * L0): notes of realistic and varied size, with properties, tags, links of
 * every kind the index reads, tasks with dates, attachments and `.base`
 * databases, in a folder tree like a real vault's.
 *
 * Deterministic: the same options give the same files, byte for byte, on
 * every machine and every run (a seeded generator, no clock, no locale, no
 * randomness from the platform). `fixtureDigest` names a fixture by the hash
 * of all its paths and bytes; `fixtureVault.test.ts` pins it for 1 000 notes,
 * so a change to the generator is a decision, not an accident — every
 * baseline measured on the old fixture is void after one.
 *
 * Shape, for `count` notes:
 * - one long note with 80 tables over about 20 000 lines
 *   (`Resources/Long table note.md`) — the editor's worst realistic case;
 *   left out with `longTableNote: false`;
 * - about 6 % daily notes under `Journal/<year>/`;
 * - the rest spread over a PARA-like tree (Projects, Areas, Resources,
 *   Archive, Meetings, People, Inbox) with one or two levels of subfolders;
 * - sizes: 60 % short (0.3–1.5 KB), 30 % medium (1.5–5 KB), 9 % long
 *   (5–12 KB), 1 % very long (20–50 KB, with tables);
 * - 65 % with a property block, 40 % with tasks, 10 % with an embedded
 *   attachment, 2 % with text in a script written without spaces;
 * - attachments: `count / 40` (at least 10) images and a few PDFs;
 * - `.base` files: `count / 2000` (at least 3), table, board and list views.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface FixtureOptions {
  /** Notes, the long table note included. */
  count: number;
  /** Another seed gives another vault of the same shape. Default 1. */
  seed?: number;
  /**
   * The long note with 80 tables (default true). The core measurement leaves
   * it out: reading it is a measurement of its own (`many-tables.ts`, and
   * `gfm-table-parse.test.ts` bounds it; until GFM tables 2.1.2 it took
   * minutes — see Performance_Notes.md), and the recorded baselines were
   * measured without it.
   */
  longTableNote?: boolean;
}

export interface FixtureFile {
  path: string;
  data: string | Uint8Array;
}

export interface FixtureSummary {
  notes: number;
  attachments: number;
  bases: number;
  bytes: number;
  tasks: number;
  digest: string;
}

/** mulberry32: small, fast, and the same everywhere. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}
type Random = ReturnType<typeof generator>;

const WORDS = (
  "project plan review meeting notes draft idea source budget timeline release feature design research customer " +
  "decision risk summary context question answer follow-up sprint backlog milestone report data index search sync " +
  "vault garden reading writing outline chapter method result experiment server client network offline mobile desk " +
  "Müller Straße Größe Übersicht Bücher Prüfung Lösung Vorschlag Entwurf Gespräch Café naïve résumé"
).split(" ");
const SPACELESS = ["今日は会議の議事録を書いた。", "来週の打ち合わせの準備をする。", "我们在会议上讨论了全文搜索的问题。", "ภาษาไทยไม่มีช่องว่างระหว่างคำ"];
const AREAS = ["Projects", "Areas", "Resources", "Archive", "Meetings", "People", "Inbox"];
const SUB = ["Alpha", "Beta", "Gamma", "Delta", "Research", "Clients", "Team", "Ideas", "Reading", "Health", "Home", "Writing"];
const TAGS = ["work", "personal", "idea", "review", "project/internal", "project/client", "reading", "meeting", "todo", "archive"];
const STATUS = ["open", "doing", "waiting", "done"];
const TYPES = ["note", "project", "meeting", "person", "reference"];
const LONG_TABLE_NOTE = "Resources/Long table note.md";

/** Day `n` counted from 2020-01-01 in years of 365 days: no clock, no time zone, never the same day twice. */
function dayOf(n: number): string {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const year = 2020 + Math.floor(n / 365);
  let rest = n % 365;
  let month = 0;
  while (rest >= days[month]) rest -= days[month++];
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(rest + 1).padStart(2, "0")}`;
}

function sentence(r: Random, words: number): string {
  const parts = Array.from({ length: words }, () => r.pick(WORDS));
  parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
  return parts.join(" ") + ".";
}

function table(r: Random, rows: number, links: () => string): string {
  const lines = ["| Item | Owner | Status | Note |", "|---|---|---|---|"];
  for (let i = 0; i < rows; i++) lines.push(`| ${r.pick(WORDS)} ${i} | ${links()} | ${r.pick(STATUS)} | ${sentence(r, r.int(3, 9))} |`);
  return lines.join("\n");
}

interface NotePlan {
  path: string;
  name: string;
  kind: "daily" | "note";
  size: number;
}

/** Where each note goes and how long it gets — decided before any text, so links can name any note. */
function planNotes(options: Required<FixtureOptions>): NotePlan[] {
  const r = generator(options.seed * 7919 + 17);
  const plans: NotePlan[] = options.longTableNote ? [{ path: LONG_TABLE_NOTE, name: "Long table note", kind: "note", size: 0 }] : [];
  const dailies = Math.floor(options.count * 0.06);
  for (let d = 0; d < dailies && plans.length < options.count; d++) {
    const day = dayOf(d);
    plans.push({ path: `Journal/${day.slice(0, 4)}/${day}.md`, name: day, kind: "daily", size: r.int(200, 1500) });
  }
  const subfolders = Math.max(2, Math.min(SUB.length, Math.round(Math.sqrt(options.count) / 8)));
  for (let i = 0; plans.length < options.count; i++) {
    const area = r.pick(AREAS);
    const sub = SUB[r.int(0, subfolders - 1)];
    const deep = r.chance(0.3) ? `/${sub} ${r.int(1, 4)}` : "";
    const folder = area === "Inbox" ? "Inbox" : `${area}/${sub}${deep}`;
    const name = `${r.pick(WORDS)} ${r.pick(WORDS)} ${i + 1}`.replace(/^./, (c) => c.toUpperCase());
    const roll = r.next();
    const size = roll < 0.6 ? r.int(300, 1500) : roll < 0.9 ? r.int(1500, 5000) : roll < 0.99 ? r.int(5000, 12000) : r.int(20000, 50000);
    plans.push({ path: `${folder}/${name}.md`, name, kind: "note", size });
  }
  return plans;
}

function noteText(plan: NotePlan, index: number, plans: NotePlan[], attachments: string[], r: Random): { text: string; tasks: number } {
  const link = () => {
    const target = plans[r.int(1, plans.length - 1)];
    const roll = r.next();
    if (roll < 0.6) return `[[${target.name}]]`;
    if (roll < 0.75) return `[[${target.name}|${r.pick(WORDS)}]]`;
    if (roll < 0.85) return `[[${target.name}#Notes]]`;
    if (roll < 0.95) return `[${r.pick(WORDS)}](${encodeURI(target.path)})`;
    return `[[${target.path.replace(/\.md$/, "")}]]`;
  };
  const out: string[] = [];
  let tasks = 0;
  if (plan.kind === "note" && r.chance(0.65)) {
    out.push("---");
    if (r.chance(0.3)) out.push(`title: ${plan.name} (${r.pick(WORDS)})`);
    out.push(`type: ${r.pick(TYPES)}`, `status: ${r.pick(STATUS)}`, `created: ${dayOf(index % 2190)}`);
    out.push("tags:", ...Array.from({ length: r.int(1, 3) }, () => `  - ${r.pick(TAGS)}`));
    if (r.chance(0.2)) out.push(`rating: ${r.int(1, 5)}`);
    if (r.chance(0.1)) out.push(`related: "${link()}"`);
    out.push("---");
  }
  out.push(`# ${plan.name}`, "");
  let length = out.join("\n").length;
  let paragraph = 0;
  while (length < plan.size) {
    let block: string;
    const roll = r.next();
    if (paragraph > 0 && paragraph % 3 === 0) block = `## ${r.chance(0.3) ? "Notes" : sentence(r, r.int(2, 4)).slice(0, -1)}`;
    else if (roll < 0.12) {
      const n = r.int(1, 5);
      tasks += n;
      block = Array.from({ length: n }, () => `- [${r.chance(0.3) ? "x" : " "}] ${sentence(r, r.int(3, 8))}${r.chance(0.5) ? ` 📅 ${dayOf(r.int(1825, 2554))}` : ""}${r.chance(0.2) ? " #todo" : ""}`).join("\n");
    } else if (roll < 0.17) block = Array.from({ length: r.int(2, 5) }, () => `- ${sentence(r, r.int(3, 10))} ${r.chance(0.4) ? link() : ""}`.trimEnd()).join("\n");
    else if (roll < 0.19) block = "```ts\n" + Array.from({ length: r.int(2, 8) }, (_, k) => `const value${k} = "${r.pick(WORDS)}";`).join("\n") + "\n```";
    else if (roll < 0.21) block = `> [!note] ${r.pick(WORDS)}\n> ${sentence(r, r.int(6, 14))}`;
    else if (roll < 0.23 && plan.size >= 20000) block = table(r, r.int(10, 40), link);
    else {
      const sentences = Array.from({ length: r.int(2, 6) }, () => sentence(r, r.int(6, 18)));
      if (r.chance(0.5)) sentences.splice(r.int(0, sentences.length), 0, `See ${link()}.`);
      if (r.chance(0.2)) sentences.push(`#${r.pick(TAGS)}`);
      block = sentences.join(" ");
    }
    out.push(block, "");
    length += block.length + 2;
    paragraph++;
  }
  if (plan.kind === "note" && r.chance(0.4) && tasks === 0) {
    const n = r.int(1, 4);
    tasks += n;
    out.push(...Array.from({ length: n }, () => `- [ ] ${sentence(r, r.int(3, 7))}${r.chance(0.5) ? ` 📅 ${dayOf(r.int(1825, 2554))}` : ""}`), "");
  }
  if (r.chance(0.1)) out.push(`![[${r.pick(attachments)}]]`, "");
  if (r.chance(0.02)) out.push(r.pick(SPACELESS), "");
  return { text: out.join("\n"), tasks };
}

function longTableNote(plans: NotePlan[], r: Random): string {
  const out = ["# Long table note", ""];
  const link = () => `[[${plans[r.int(1, plans.length - 1)].name}]]`;
  for (let t = 0; t < 80; t++) {
    out.push(`## Section ${t + 1}`, "");
    for (let p = 0; p < 20; p++) out.push(sentence(r, r.int(8, 20)), "");
    out.push(table(r, 200, link), "");
  }
  return out.join("\n");
}

/** A small valid PNG, padded after its end chunk to the given size. */
function image(bytes: number, salt: number): Uint8Array {
  const pixel = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const out = new Uint8Array(Math.max(bytes, pixel.length));
  out.set(pixel);
  for (let i = pixel.length; i < out.length; i++) out[i] = (i * 31 + salt) & 0xff;
  return out;
}

function baseFile(index: number, r: Random): string {
  const area = AREAS[index % AREAS.length];
  const view = ["table", "board", "list"][index % 3];
  return [
    "filters:",
    "  and:",
    `    - file.inFolder("${area}")`,
    "properties:",
    "  note.status:",
    "    displayName: Status",
    "views:",
    `  - type: ${view}`,
    `    name: ${area} ${view}`,
    ...(view === "board" ? ["    groupBy: note.status"] : []),
    "    order:",
    "      - file.name",
    "      - note.status",
    "      - file.tasks",
    `    limit: ${r.int(50, 500)}`,
    "",
  ].join("\n");
}

/** Every file of the fixture, in a fixed order. */
export function* fixtureFiles(options: FixtureOptions): Generator<FixtureFile> {
  const opts: Required<FixtureOptions> = { seed: 1, longTableNote: true, ...options };
  if (!Number.isInteger(opts.count) || opts.count < 1) throw new Error(`count must be a positive integer, got ${opts.count}`);
  const plans = planNotes(opts);
  const attachmentCount = Math.max(10, Math.floor(opts.count / 40));
  const attachments = Array.from({ length: attachmentCount }, (_, i) => (i % 10 === 9 ? `Attachments/scan-${i + 1}.pdf` : `Attachments/image-${i + 1}.png`));
  const r = generator(opts.seed * 104729 + 3);
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    yield { path: plan.path, data: plan.path === LONG_TABLE_NOTE ? longTableNote(plans, r) : noteText(plan, i, plans, attachments, r).text };
  }
  for (let i = 0; i < attachments.length; i++) {
    const name = attachments[i];
    const size = r.int(800, 40_000);
    yield { path: name, data: name.endsWith(".pdf") ? new TextEncoder().encode(`%PDF-1.4\n% fixture ${i}\n${"0".repeat(size)}\n%%EOF\n`) : image(size, i) };
  }
  const bases = Math.max(3, Math.floor(opts.count / 2000));
  for (let b = 0; b < bases; b++) yield { path: `Databases/${AREAS[b % AREAS.length]} ${b + 1}.base`, data: baseFile(b, r) };
}

/** What the fixture holds, and the hash that names it. */
export function summarizeFixture(options: FixtureOptions): FixtureSummary {
  const hash = createHash("sha256");
  const summary: FixtureSummary = { notes: 0, attachments: 0, bases: 0, bytes: 0, tasks: 0, digest: "" };
  for (const file of fixtureFiles(options)) {
    const bytes = typeof file.data === "string" ? new TextEncoder().encode(file.data) : file.data;
    hash.update(file.path).update("\0").update(bytes).update("\0");
    summary.bytes += bytes.length;
    if (file.path.endsWith(".md")) {
      summary.notes++;
      summary.tasks += (String(file.data).match(/^- \[[ x]\] /gm) ?? []).length;
    } else if (file.path.endsWith(".base")) summary.bases++;
    else summary.attachments++;
  }
  summary.digest = hash.digest("hex");
  return summary;
}

/** Writes the fixture into `dir`, which must be empty or missing. */
export async function writeFixtureVault(dir: string, options: FixtureOptions): Promise<FixtureSummary> {
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.readdir(dir)).length > 0) throw new Error(`refusing to write into a folder that is not empty: ${dir}`);
  const made = new Set<string>();
  for (const file of fixtureFiles(options)) {
    const target = path.join(dir, ...file.path.split("/"));
    const folder = path.dirname(target);
    if (!made.has(folder)) {
      await fs.mkdir(folder, { recursive: true });
      made.add(folder);
    }
    await fs.writeFile(target, file.data);
  }
  return summarizeFixture(options);
}
