import i18n from "@plainva/ui/i18n";
import { setTrayNext } from "./background";

/**
 * The tray's "next up" line, across every open vault (stage D, E7).
 *
 * There is one tray and, since stage D, several reminder schedulers. Letting
 * each one write the line directly means the last vault to tick wins — the tray
 * would flip between two vaults' appointments every scheduler cycle and settle
 * on whichever happened to be later, which is not "the next one" by any reading.
 *
 * So the schedulers report, and the earliest report is what the tray shows. The
 * vault's name is appended only once a second vault is open: with one vault it
 * would be noise, and with two it is the difference between "at three" and
 * "at three, in which life".
 */
interface TrayEntry {
  /** Rendered line for this vault ("no appointment in sight" when empty). */
  text: string;
  /** Start of that appointment, or null when the vault has none. */
  at: number | null;
}

const byVault = new Map<string, TrayEntry>();

/**
 * Open threads that name you, per vault (Stufe F, F2).
 *
 * Counted as ADDRESSED threads rather than "unread remarks", deliberately:
 * Plainva has no read state for a comment, and inventing one for a tray line
 * would be a second truth that nothing else maintains. "Threads that name you
 * and are still open" is a fact the overview already computes and the badge
 * already shows, so the tray cannot disagree with the surface.
 */
const commentsByVault = new Map<string, number>();

/** Last segment of the path — the same name the vault switcher shows. */
function vaultName(vaultPath: string): string {
  return vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? vaultPath;
}

function nextLine(): string {
  const withNext = [...byVault.entries()].filter(([, e]) => e.at !== null);
  if (withNext.length === 0) return i18n.t("background.trayNoNext");
  withNext.sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
  const [path, entry] = withNext[0];
  // More than one vault OPEN, not more than one with an appointment: naming the
  // vault answers "which one" only when that question exists at all.
  if (byVault.size < 2) return entry.text;
  return i18n.t("background.trayNextInVault", { line: entry.text, vault: vaultName(path) });
}

/**
 * The whole line: what is next, and how many remarks are waiting on you.
 *
 * Summed across vaults rather than shown per vault. The tray has ONE line, and
 * a count that named its vault would push the appointment out of view for the
 * one thing the line exists for. A zero says nothing at all - a tray that
 * always claims "0 waiting" trains you to stop reading it.
 */
function render(): string {
  const line = nextLine();
  const waiting = [...commentsByVault.values()].reduce((sum, count) => sum + count, 0);
  if (waiting === 0) return line;
  return `${line} · ${i18n.t("background.trayComments", { count: waiting })}`;
}

/** A vault's scheduler reports what it sees next. */
export function reportTrayNext(vaultPath: string, text: string, at: number | null): void {
  const prev = byVault.get(vaultPath);
  if (prev && prev.text === text && prev.at === at) return;
  byVault.set(vaultPath, { text, at });
  void setTrayNext(render());
}

/** How many open threads in this vault name you (Stufe F). */
export function reportTrayComments(vaultPath: string, count: number): void {
  // Absent and zero are the same statement here, so they must compare equal -
  // otherwise every cycle of a vault with nothing waiting would redraw the tray.
  if ((commentsByVault.get(vaultPath) ?? 0) === count) return;
  if (count > 0) commentsByVault.set(vaultPath, count);
  else commentsByVault.delete(vaultPath);
  void setTrayNext(render());
}

/** A vault closed: what it announced is no longer true of anything. */
export function forgetTrayNext(vaultPath: string): void {
  const hadComments = commentsByVault.delete(vaultPath);
  if (!byVault.delete(vaultPath) && !hadComments) return;
  void setTrayNext(render());
}

/** Tests only. */
export function resetTrayNext(): void {
  byVault.clear();
  commentsByVault.clear();
}
