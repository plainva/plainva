import { addDays, startOfWeek } from "date-fns";
import { formatMomentLocalized } from "../lib/momentFormat";

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
  /** Vault-relative path (without `.md`) of the daily note `offset` days from
   *  `now` — the engine wraps it into the wiki link for `{{daily+1}}`, so that
   *  `{{daily+1:tomorrow}}` can put a label into it. */
  dailyPath?: (offset: number) => string | null;
  /** First day of the week (0 = Sunday), for `{{weekday:…}}`. Follows the app
   *  setting; defaults to Monday, the ISO convention. */
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Label for the clipboard question when the template names none. The shell
   *  passes the translated word; the engine itself carries no i18n. */
  clipboardLabel?: string;
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
 * Label the clipboard question carries when the template does not name one.
 * It is a plain label, not a translated string: the engine is shell-free, and
 * the dialog shows whatever the template asked for.
 */
export const CLIPBOARD_LABEL = "Clipboard";

/** Weekday names the token accepts — full and the common short form, because
 *  a token that silently stays put on `mon` reads as a broken feature. */
const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Cleans the label of `{{daily±N:Label}}`.
 *
 * `[`, `]` and `|` are the characters a wiki link is BUILT from — leaving them
 * in would produce a link that silently points somewhere else or stops being a
 * link at all. Line breaks go too: the token grammar allows them inside the
 * argument, a wiki link does not survive them. A label that consisted only of
 * those characters ends up empty and the link is written without an alias,
 * which is the harmless outcome.
 */
function dailyLabel(arg: string | null): string {
  return (arg ?? "").replace(/[[\]|\r\n]/g, "").trim();
}

/**
 * `{{weekday:monday}}` — that day of the CURRENT week; `{{weekday:next friday}}`
 * — of the following one. An optional format follows a second colon:
 * `{{weekday:monday:dd.MM.}}`.
 *
 * Which week is "current" depends on where the week begins, so this follows the
 * app setting rather than assuming Monday: with a Sunday start, the Sunday
 * before today belongs to this week; with a Monday start, the one after it does.
 *
 * Its own token namespace on purpose — `{{date:monday}}` would collide with the
 * format suffix of `{{date:…}}`.
 */
function resolveWeekday(arg: string | null, now: Date, weekStart: number): string | null {
  if (!arg) return null;
  const colon = arg.indexOf(":");
  const spec = (colon === -1 ? arg : arg.slice(0, colon)).trim().toLowerCase();
  const format = colon === -1 ? "" : arg.slice(colon + 1).trim();

  let offsetWeeks = 0;
  let dayName = spec;
  const parts = spec.split(/\s+/);
  if (parts.length === 2 && (parts[0] === "next" || parts[0] === "last")) {
    offsetWeeks = parts[0] === "next" ? 1 : -1;
    dayName = parts[1];
  }

  const day = WEEKDAYS[dayName];
  if (day === undefined) return null;

  const weekStartsOn = (weekStart % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const start = startOfWeek(now, { weekStartsOn });
  const within = (day - weekStartsOn + 7) % 7;
  return formatMomentLocalized(addDays(start, offsetWeeks * 7 + within), format || "YYYY-MM-DD");
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
        return formatMomentLocalized(when, argument || "YYYY-MM-DD");
      case "time":
        return formatMomentLocalized(when, argument || "HH:mm");
      case "yesterday":
        return formatMomentLocalized(addDays(ctx.now, -1), argument || "YYYY-MM-DD");
      case "tomorrow":
        return formatMomentLocalized(addDays(ctx.now, 1), argument || "YYYY-MM-DD");
      case "folder":
        return ctx.folder ?? "";
      case "vault":
        return ctx.vaultName ?? "";
      case "daily": {
        const path = ctx.dailyPath?.(offset) ?? null;
        if (path === null) {
          unresolved.push(raw);
          return raw;
        }
        // `{{daily+1:Morgen}}` — everything after the colon is what the link
        // SHOWS, not a date format: the target of a daily link is a note, and
        // its file name is already decided by the vault's daily-note format.
        const label = dailyLabel(argument);
        return label ? `[[${path}|${label}]]` : `[[${path}]]`;
      }
      case "weekday": {
        const resolved = resolveWeekday(argument, ctx.now, ctx.weekStart ?? 1);
        if (!resolved) {
          unresolved.push(raw);
          return raw; // an unreadable weekday stays visible, like a typo
        }
        return resolved;
      }
      case "selection": {
        // The selected text is something the person marked themselves — no
        // reason to ask about it.
        const value = ctx.selection?.() ?? null;
        if (value === null) {
          unresolved.push(raw);
          return "";
        }
        return value;
      }
      case "clipboard": {
        // Deliberately NOT inserted silently (decision E7): a password manager
        // puts credentials on the clipboard, and a template carrying this token
        // would write them into a note that then syncs. In interactive mode the
        // content arrives PRE-FILLED in the collected dialog, where it is
        // visible and editable; headless it stays empty.
        const value = ctx.clipboard?.() ?? null;
        if (mode === "headless" || value === null) {
          if (value === null) unresolved.push(raw);
          return "";
        }
        // `}` and `|` would break the placeholder this hands to finalizeTemplate
        // (they delimit the token and its default), so a label carrying them
        // loses them rather than producing a token nobody can answer.
        const label = (argument?.trim().replace(/[}|]/g, "") || ctx.clipboardLabel || CLIPBOARD_LABEL);
        if (!seenRequest.has(label)) {
          seenRequest.add(label);
          requests.push({ label, kind: "text", defaultValue: value });
        }
        return `{{prompt:${label}}}`; // answered in finalizeTemplate
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
