import { resolveTemplate, scanTemplate, type TemplateContext, type TemplateRequest } from "../base/templateEngine";
import { finalizeTemplate, type FinalizedTemplate } from "../base/templateFiles";
import { getWeekStartSetting, weekStartDayOf } from "../services/weekStart";
import { buildDailyNotePath } from "./dailyNotePath";
import { DEFAULT_DAILY_NOTE_FORMAT } from "./dailyNotes";

/**
 * What a template is resolved WITH, and the one place each piece of it comes
 * from (Sammelplan § 3.97).
 *
 * The engine reads its sources from a context object (`TemplateContext`). Who
 * filled it was each caller's business, and callers forgot: three ways of the
 * desktop never got the week start or the clipboard, its database and pinboard
 * entries never got `{{daily}}`, the phone's daily note never got `{{daily}}`,
 * a daily note made by a capture counted `{{weekday:…}}` from Monday on both
 * shells, and a note made in the background got its title and nothing else.
 *
 * Every way takes its context from here now, in two steps: the pieces of the
 * VAULT, which every template is owed whether anybody is asked or not
 * (`withVaultContext`), and the pieces only a PERSON at the device brings
 * (`withPersonContext`). A shell's pipeline with questions is
 * `runTemplateInteractive` — the shells hand it their vault, their selection,
 * their clipboard and their dialog, and nothing else. A piece the caller set
 * itself stays.
 */

/** What a vault contributes to a template: its name and where its daily notes live. */
export interface TemplateVault {
  /** `{{vault}}`. */
  name: string;
  /** Folder of the daily notes, "" for the vault's root — where `{{daily±N}}` points. */
  dailyFolder: string;
  /** Moment-style file-name format of the daily notes; empty means the default. */
  dailyFormat: string;
}

/**
 * `{{daily±N}}`: the vault-relative path (without `.md`) of the daily note N
 * days from the DAY of `now`. Built by the rule a daily note itself is created
 * by (`ensureDailyNote`), so a link and the note it names agree — the same
 * trimming, the same default format.
 */
export function dailyPathFrom(now: Date, vault: Pick<TemplateVault, "dailyFolder" | "dailyFormat">): (offset: number) => string {
  const format = vault.dailyFormat.trim() || DEFAULT_DAILY_NOTE_FORMAT;
  const folder = vault.dailyFolder.trim();
  return (offset) => {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    return buildDailyNotePath(day, format, folder).fullPath.replace(/\.md$/i, "");
  };
}

/**
 * The pieces every template is owed, asked or not: the vault's name, the daily
 * notes counted from the day of `ctx.now`, and the first day of the week as
 * this device is set (`{{weekday:…}}`). Whatever the caller set stays. Without
 * a vault (none is open) only the week start is added.
 *
 * `ctx.now` is the day a note is FOR — a daily note's day, a meeting's day —
 * so `{{daily}}` in such a note names that day's daily note, as `{{date}}`
 * names that day.
 */
export async function withVaultContext(ctx: TemplateContext, vault: TemplateVault | null): Promise<TemplateContext> {
  const next: TemplateContext = { ...ctx };
  if (vault) {
    if (next.vaultName === undefined) next.vaultName = vault.name;
    if (next.dailyPath === undefined) next.dailyPath = dailyPathFrom(next.now, vault);
  }
  // The shared setting reports Monday when it cannot be read; a template must
  // not fail over it.
  if (next.weekStart === undefined) next.weekStart = weekStartDayOf(await getWeekStartSetting());
  return next;
}

/** What only a person at the device brings to a template. */
export interface PersonTemplateSources {
  /** The text selected in the editor, or null. */
  selection(): string | null;
  /** The clipboard's text; asked for only when the template carries the token. */
  readClipboard(): Promise<string | null>;
  /** The translated word for the clipboard question, when the template names none. */
  clipboardLabel: string;
}

/**
 * The pieces a PERSON adds: the selected text, and the clipboard — read only
 * when the template carries `{{clipboard…}}`. Reading it on every new note
 * would be an overreach, and on iOS a permission prompt, for something almost
 * no template uses. The ways nobody is asked on never read it (decision E7).
 */
export async function withPersonContext(raw: string, ctx: TemplateContext, sources: PersonTemplateSources): Promise<TemplateContext> {
  const next: TemplateContext = { ...ctx };
  if (next.selection === undefined) next.selection = () => sources.selection();
  if (next.clipboardLabel === undefined) next.clipboardLabel = sources.clipboardLabel;
  // An escaped `\{{clipboard}}` writes the token as text; it reads nothing.
  if (next.clipboard === undefined && scanTemplate(raw).some((token) => token.name === "clipboard" && !token.escaped)) {
    let text: string | null = null;
    try {
      text = await sources.readClipboard();
    } catch {
      text = null; // denied or empty — the token reports itself unresolved
    }
    next.clipboard = () => text;
  }
  return next;
}

/** What a shell hands the pipeline with questions. */
export interface TemplateShell {
  /** The open vault; null when there is none. */
  vault: TemplateVault | null;
  person: PersonTemplateSources;
  /** Asks every question at once; null = cancelled. */
  ask(fields: TemplateRequest[]): Promise<Record<string, string> | null>;
}

/**
 * The pipeline a PERSON's template runs through, on both shells (plan
 * Vorlagen-Engine, P3/P6): the full context → resolve → ask once → finalize.
 * A template without questions opens no dialog (decision E3); cancelling
 * returns null, and the caller writes nothing.
 */
export async function runTemplateInteractive(raw: string, ctx: TemplateContext, shell: TemplateShell): Promise<FinalizedTemplate | null> {
  const full = await withPersonContext(raw, await withVaultContext(ctx, shell.vault), shell.person);
  const resolved = resolveTemplate(raw, full, "interactive");
  let answers: Record<string, string> = {};
  if (resolved.requests.length > 0) {
    const given = await shell.ask(resolved.requests);
    if (given === null) return null;
    answers = given;
  }
  return finalizeTemplate(resolved.text, answers);
}
