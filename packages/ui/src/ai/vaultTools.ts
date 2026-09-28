import {
  gateDecision,
  isCloudRecipient,
  VaultQueryService,
  withholdDeniedLinks,
  type EffectivePolicy,
  type GateRun,
  type ToolExecutor,
  type ToolManifest,
  type ToolOutcome,
} from "@plainva/core";
import { buildPlanner, type PlannerRow } from "../lib/taskPlanner";
import { frontmatterBlockOf, stripFrontmatter } from "../services/docMeta";

/**
 * The vault tools of the first chat package (ADR 0018), one implementation
 * for both shells: search, read, outline, tasks and app navigation.
 *
 * Every result passes the hard gate first. A note the policy keeps from this
 * recipient is answered exactly like a note that does not exist — so not even
 * its existence leaks — and links to it inside allowed text are withheld.
 * Paths are checked before any adapter sees them: no `..`, no absolute path,
 * no backslash, and never Plainva's own folders.
 */

/** A navigation command: it may show something, never change data (risk class `ui`). */
export interface AiNavigationCommand {
  id: string;
  label: string;
  run(args?: Record<string, string | number | boolean>): boolean | Promise<boolean>;
}

export interface VaultToolDeps {
  search(query: string, limit: number, offset: number): Promise<{ path: string; title: string; snippet?: string | null }[]>;
  /** The note's text as the adapter chain reads it; null when there is none. */
  readNote(path: string): Promise<string | null>;
  resolveLink(target: string, fromPath: string): Promise<string | null>;
  policyOf(path: string, text?: string): Promise<EffectivePolicy>;
  taskRows(): Promise<PlannerRow[]>;
  todayKey(): string;
  commands(): AiNavigationCommand[];
}

/** The tools a conversation carries in this version; its list never changes afterwards. */
export const CHAT_TOOL_NAMES = ["search_vault", "read_note", "get_outline", "get_tasks", "run_command"] as const;

const NOT_FOUND = "No note is available at this path.";
/** Search snippets carry sentinel characters around the matches; the model gets plain text. */
const unmark = (snippet: string) => snippet.split(VaultQueryService.SNIPPET_MARK_START).join("").split(VaultQueryService.SNIPPET_MARK_END).join("");

/** A vault-relative path the model may name; anything else is refused up front. */
export function safeRelPath(path: string): string | null {
  const p = path.trim().replace(/^\.\//, "");
  if (!p || p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[a-z]:/i.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  // Plainva's own state and the policy files are never tool results (ADR 0021).
  if ([".plainva", ".agent", ".git", ".obsidian", ".trash"].includes(parts[0]!.toLowerCase())) return null;
  return p;
}

export interface OutlineHeading {
  level: number;
  text: string;
  /** The section handle: the heading chain, "Costs > 2026". */
  chain: string;
  line: number;
}

/** The ATX headings of a body, outside fenced code. */
export function outlineOf(body: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  const stack: { level: number; text: string }[] = [];
  let fence: string | null = null;
  body.split("\n").forEach((line, index) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]![0]!;
      else if (f[1]![0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const level = m[1]!.length;
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    stack.push({ level, text: m[2]! });
    out.push({ level, text: m[2]!, chain: stack.map((s) => s.text).join(" > "), line: index });
  });
  return out;
}

/** One section by its handle (the heading chain, or a unique heading text). */
export function sectionOf(body: string, handle: string): string | null {
  const headings = outlineOf(body);
  const wanted = handle.trim().toLowerCase();
  let found = headings.findIndex((h) => h.chain.toLowerCase() === wanted);
  if (found < 0) {
    const byText = headings.filter((h) => h.text.toLowerCase() === wanted);
    if (byText.length !== 1) return null;
    found = headings.indexOf(byText[0]!);
  }
  const head = headings[found]!;
  const end = headings.slice(found + 1).find((h) => h.level <= head.level);
  const lines = body.split("\n");
  return lines.slice(head.line, end ? end.line : lines.length).join("\n");
}

function offsetOf(cursor: unknown): number {
  return typeof cursor === "string" ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
}

const BOX: Record<PlannerRow["state"], string> = { open: "[ ]", progress: "[/]", done: "[x]", cancelled: "[-]" };
const PRIORITY = ["", "low", "medium", "high"];

export function createVaultToolExecutor(deps: VaultToolDeps, run: GateRun): ToolExecutor {
  const cloud = isCloudRecipient(run.recipient);
  const decisions = new Map<string, boolean>();
  const allowed = async (path: string, text?: string): Promise<boolean> => {
    let ok = decisions.get(path);
    if (ok === undefined) {
      ok = gateDecision(await deps.policyOf(path, text), run).allowed;
      decisions.set(path, ok);
    }
    return ok;
  };
  const withhold = async (text: string, fromPath: string): Promise<string> =>
    cloud ? (await withholdDeniedLinks(text, fromPath, deps.resolveLink, (path) => allowed(path))).text : text;
  const readAllowed = async (raw: unknown): Promise<{ path: string; text: string } | null> => {
    const path = typeof raw === "string" ? safeRelPath(raw) : null;
    if (!path) return null;
    const text = await deps.readNote(path);
    if (text === null || !(await allowed(path, text))) return null;
    return { path, text };
  };
  const result = (tool: string, content: string): ToolOutcome => ({ content, origin: { kind: "tool", tool } });

  return {
    async execute(tool: ToolManifest, args: unknown): Promise<ToolOutcome> {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (tool.name) {
        case "search_vault": {
          const limit = Number(a.limit) || 10;
          const offset = offsetOf(a.cursor);
          const folder = typeof a.folder === "string" && a.folder.trim() ? ` path:"${a.folder.trim().replace(/"/g, "")}"` : "";
          const hits = await deps.search(`${String(a.query)}${folder}`, limit, offset);
          const lines: string[] = [];
          for (const hit of hits) {
            if (!(await allowed(hit.path))) continue;
            const snippet = hit.snippet ? (await withhold(unmark(hit.snippet), hit.path)).replace(/\s+/g, " ").trim() : "";
            lines.push(`- [[${hit.title}]] (${hit.path})${snippet ? ` — ${snippet}` : ""}`);
          }
          const more = hits.length === limit ? `\n\nMore results: call search_vault again with cursor "${offset + limit}".` : "";
          return result(tool.name, lines.length ? `${lines.join("\n")}${more}` : `No matching notes.${more}`);
        }
        case "read_note": {
          const note = await readAllowed(a.path);
          if (!note) return { content: NOT_FOUND, isError: true };
          let text = stripFrontmatter(note.text);
          if (typeof a.section === "string" && a.section.trim()) {
            const section = sectionOf(text, a.section);
            if (section === null) return { content: `No section "${a.section}" in this note; get_outline lists them.`, isError: true };
            text = section;
          }
          text = await withhold(text, note.path);
          const maxChars = Number(a.maxChars) || 8000;
          const offset = offsetOf(a.cursor);
          const slice = text.slice(offset, offset + maxChars);
          const more = offset + maxChars < text.length ? `\n\n[The note continues: call read_note again with cursor "${offset + maxChars}".]` : "";
          return result(tool.name, `${note.path}\n\n${slice}${more}`);
        }
        case "get_outline": {
          const note = await readAllowed(a.path);
          if (!note) return { content: NOT_FOUND, isError: true };
          const block = frontmatterBlockOf(note.text);
          const headings = outlineOf(stripFrontmatter(note.text)).map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}  (section: "${h.chain}")`);
          const props = block ? `Properties:\n${await withhold(block.trim(), note.path)}\n\n` : "";
          // A heading can link too ("## See [[Salaries]]"): it goes through the same gate as the text.
          const sections = headings.length ? await withhold(`Sections:\n${headings.join("\n")}`, note.path) : "No headings.";
          return result(tool.name, `${note.path}\n\n${props}${sections}`);
        }
        case "get_tasks": {
          const range = typeof a.range === "string" ? a.range : "today";
          const limit = Number(a.limit) || 25;
          const offset = offsetOf(a.cursor);
          const today = deps.todayKey();
          const rows: PlannerRow[] = [];
          for (const row of await deps.taskRows()) if (await allowed(row.path)) rows.push(row);
          const planner = buildPlanner(rows, today);
          const listed =
            range === "all"
              ? rows
              : range === "overdue"
                ? planner.sections("today").filter((s) => s.kind === "overdue").flatMap((s) => s.rows)
                : planner.sections(range === "upcoming" || range === "inbox" || range === "done" ? range : "today").flatMap((s) => s.rows);
          const page = listed.slice(offset, offset + limit);
          const lines: string[] = [];
          for (const r of page) {
            const meta = [r.due ? `due ${r.due}` : "", r.priority ? `priority ${PRIORITY[r.priority]}` : ""].filter(Boolean).join(", ");
            const where = r.source === "note" ? ` — in [[${r.noteTitle ?? r.path.replace(/\.md$/i, "")}]]` : "";
            lines.push(`- ${BOX[r.state]} ${await withhold(r.title, r.path)}${meta ? ` (${meta})` : ""}${where}`);
          }
          const more = offset + limit < listed.length ? `\n\nMore: call get_tasks again with cursor "${offset + limit}".` : "";
          return result(tool.name, lines.length ? `${lines.join("\n")}${more}` : "No tasks in this list.");
        }
        case "run_command": {
          const commands = deps.commands();
          const command = commands.find((c) => c.id === a.id);
          if (!command) {
            return { content: `Unknown command. Available commands:\n${commands.map((c) => `- ${c.id}: ${c.label}`).join("\n")}`, isError: true };
          }
          const cannot: ToolOutcome = { content: `The command "${command.id}" could not run here.`, isError: true };
          let args = a.args as Record<string, string | number | boolean> | undefined;
          // A command that opens a note names it: the note passes the same gate
          // as a read, so a denied one fails exactly like one that does not exist.
          if (args && typeof args.path === "string") {
            const path = await deps.resolveLink(args.path, "");
            if (!path || !(await allowed(path))) return cannot;
            args = { ...args, path };
          }
          const ran = await command.run(args);
          return ran ? { content: `Done: ${command.label}.` } : cannot;
        }
        default:
          return { content: `The tool ${tool.name} is not available in this version of Plainva.`, isError: true };
      }
    },
  };
}
