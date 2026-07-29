import { addDays } from "date-fns";
import { formatMoment } from "../lib/momentFormat";

/**
 * The template engine (plan Vorlagen-Engine, P2).
 *
 * Templates are DATA, never code. Every placeholder is a named, finite token
 * with a defined resolution — there is no expression evaluation, no user
 * script, no network access. Obsidian's Templater is a JavaScript executor;
 * Plainva vaults travel through other people's clouds and get shared, so an
 * executable template would be code execution on every device that opens the
 * vault. That door stays shut (plan § 4.1).
 *
 * Resolution happens in three phases so that the interactive parts can be
 * asked ONCE, in one dialog, between phase two and three:
 *
 *   scanTemplate    — what is in here?
 *   resolveTemplate — fill everything that needs no user input
 *   finalizeTemplate— fill the answers, extract the caret
 *
 * The mode decides whether questions are asked at all. `headless` is not a
 * degraded `interactive`: the task reconciler, the checkbox promotion and the
 * mail capture create notes from database templates in the background, and a
 * modal dialog there either stalls a sync cycle or pops up without any context
 * for the person looking at it (plan § 4.3).
 */

/** Where the placeholder values come from. Platform-bound sources are
 *  injected, so this module stays free of Tauri/Capacitor (purity guard). */
export interface TemplateContext {
  /** Title of the note being created — `{{title}}`. */
  title: string;
  /** Reference instant: `{{date}}` and every offset count from here. */
  now: Date;
  /** Target folder of the note — `{{folder}}`. */
  folder?: string;
  /** Vault name — `{{vault}}`. */
  vaultName?: string;
  /** Note the template is inserted INTO, when it is an insert rather than a
   *  creation. Not a token of its own yet; carried so the insert path can pass
   *  its context in one object. */
  hostPath?: string;
  /** Clipboard text for `{{clipboard}}`; absent = token stays unresolved. */
  clipboard?: () => string | null;
  /** Selected editor text for `{{selection}}`. */
  selection?: () => string | null;
  /** Wiki link to the daily note `offset` days from `now` — `{{daily+1}}`. */
  dailyLink?: (offset: number) => string | null;
}

export type TemplateMode = "interactive" | "headless";

export type TemplateRequestKind = "text" | "select" | "date";

/** One question a template asks before it can be finished. */
export interface TemplateRequest {
  /** Label shown to the user AND the key its answer is stored under. */
  label: string;
  kind: TemplateRequestKind;
  /** Pre-filled value (`{{prompt:Label|Default}}`), if any. */
  defaultValue?: string;
  /** Choices for `kind: "select"`. */
  options?: string[];
}

export interface ResolvedTemplate {
  /** Text with everything non-interactive filled in. */
  text: string;
  /** Questions to ask; always empty in headless mode. */
  requests: TemplateRequest[];
  /** Tokens that could not be resolved because their source is missing.
   *  Reported rather than thrown — a template must never block a note. */
  unresolved: string[];
}

/**
 * One placeholder. `raw` is the exact text matched, so replacement never has to
 * reconstruct it. A leading backslash marks an escape: `\{{date}}` writes the
 * token itself into the note, which is how the handbook can document tokens.
 */
export interface TemplateToken {
  raw: string;
  escaped: boolean;
  name: string;
  /** Signed day offset from `{{date+7}}` / `{{daily-1}}`; 0 when absent. */
  offset: number;
  /** Everything after the colon — a format string or a prompt label. */
  arg: string | null;
  index: number;
}

/** `\?{{ name [±N] [:arg] }}` — one grammar for every placeholder. */
const TOKEN_RE = /(\\?)\{\{([a-zA-Z_][a-zA-Z_0-9]*)([+-]\d+)?(?::([^}]*))?\}\}/g;

export function scanTemplate(text: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push({
      raw: m[0],
      escaped: m[1] === "\\",
      name: m[2],
      offset: m[3] ? Number(m[3]) : 0,
      arg: m[4] ?? null,
      index: m.index ?? 0,
    });
  }
  return out;
}

/** Tokens resolved later, in finalizeTemplate — not here. */
const DEFERRED = new Set(["cursor"]);

/** Tokens that ask the user something. */
const INTERACTIVE: Record<string, TemplateRequestKind> = {
  prompt: "text",
  select: "select",
  date_prompt: "date",
};

/** Splits `Label|Default` / `Label|A,B,C` into label and the rest. */
function splitArg(arg: string | null): { label: string; rest: string | null } {
  if (arg === null) return { label: "", rest: null };
  const pipe = arg.indexOf("|");
  if (pipe === -1) return { label: arg.trim(), rest: null };
  return { label: arg.slice(0, pipe).trim(), rest: arg.slice(pipe + 1) };
}

/**
 * Fills everything that needs no user input and collects what does.
 *
 * Unknown tokens are left ALONE on purpose: a typo like `{{titel}}` stays
 * visible in the note instead of silently turning into nothing, which is the
 * difference between "I mistyped that" and "the feature is broken".
 */
export function resolveTemplate(
  text: string,
  ctx: TemplateContext,
  mode: TemplateMode = "headless"
): ResolvedTemplate {
  const requests: TemplateRequest[] = [];
  const seenRequest = new Set<string>();
  const unresolved: string[] = [];

  const out = text.replace(TOKEN_RE, (raw, esc: string, name: string, off: string, arg: string | undefined) => {
    if (esc === "\\") return raw.slice(1); // escaped: drop the backslash, keep the token
    const offset = off ? Number(off) : 0;
    const argument = arg ?? null;
    const when = offset ? addDays(ctx.now, offset) : ctx.now;

    switch (name) {
      case "title":
        return ctx.title;
      case "date":
        return formatMoment(when, argument || "YYYY-MM-DD");
      case "time":
        return formatMoment(when, argument || "HH:mm");
      case "yesterday":
        return formatMoment(addDays(ctx.now, -1), argument || "YYYY-MM-DD");
      case "tomorrow":
        return formatMoment(addDays(ctx.now, 1), argument || "YYYY-MM-DD");
      case "folder":
        return ctx.folder ?? "";
      case "vault":
        return ctx.vaultName ?? "";
      case "daily": {
        const link = ctx.dailyLink?.(offset) ?? null;
        if (link === null) {
          unresolved.push(raw);
          return raw;
        }
        return link;
      }
      case "clipboard":
      case "selection": {
        const value = (name === "clipboard" ? ctx.clipboard?.() : ctx.selection?.()) ?? null;
        if (value === null) {
          unresolved.push(raw);
          return "";
        }
        return value;
      }
      default:
        break;
    }

    if (DEFERRED.has(name)) return raw;

    const kind = INTERACTIVE[name];
    if (kind) {
      const { label, rest } = splitArg(argument);
      if (!label) return "";
      if (mode === "headless") {
        // Never ask in the background: take the default, else nothing.
        return kind === "text" ? (rest ?? "") : "";
      }
      if (!seenRequest.has(label)) {
        seenRequest.add(label);
        requests.push({
          label,
          kind,
          defaultValue: kind === "text" && rest !== null ? rest : undefined,
          options: kind === "select" && rest !== null
            ? rest.split(",").map((o) => o.trim()).filter(Boolean)
            : undefined,
        });
      }
      return raw; // filled by finalizeTemplate once answered
    }

    return raw; // unknown token — leave it visible
  });

  return { text: out, requests, unresolved };
}
