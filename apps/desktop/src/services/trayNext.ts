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

/** Last segment of the path — the same name the vault switcher shows. */
function vaultName(vaultPath: string): string {
  return vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? vaultPath;
}

function render(): string {
  const withNext = [...byVault.entries()].filter(([, e]) => e.at !== null);
  if (withNext.length === 0) return i18n.t("background.trayNoNext");
  withNext.sort((a, b) => (a[1].at ?? 0) - (b[1].at ?? 0));
  const [path, entry] = withNext[0];
  // More than one vault OPEN, not more than one with an appointment: naming the
  // vault answers "which one" only when that question exists at all.
  if (byVault.size < 2) return entry.text;
  return i18n.t("background.trayNextInVault", { line: entry.text, vault: vaultName(path) });
}

/** A vault's scheduler reports what it sees next. */
export function reportTrayNext(vaultPath: string, text: string, at: number | null): void {
  const prev = byVault.get(vaultPath);
  if (prev && prev.text === text && prev.at === at) return;
  byVault.set(vaultPath, { text, at });
  void setTrayNext(render());
}

/** A vault closed: what it announced is no longer true of anything. */
export function forgetTrayNext(vaultPath: string): void {
  if (!byVault.delete(vaultPath)) return;
  void setTrayNext(render());
}

/** Tests only. */
export function resetTrayNext(): void {
  byVault.clear();
}
