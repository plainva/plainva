import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Replace, Search as SearchIcon } from "lucide-react";
import { App as CapApp } from "@capacitor/app";
import {
  Banner,
  Button,
  Checkbox,
  Chip,
  DockedToolbar,
  EmptyState,
  GroupCard,
  ICON,
  Row,
  RowList,
  SectionLabel,
  TextInput,
  previewLine,
  runVaultReplace,
  type PreviewSegment,
} from "@plainva/ui";
import type { FindReplaceOptions, VaultFindResult } from "@plainva/core";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * Vault-wide find & replace on the phone (P5).
 *
 * The core (`findInVault`, `replaceAllInText`) was platform-neutral all along;
 * what was missing was this surface, and it is deliberately not a port of the
 * desktop modal. On 375 px a flat list of every hit pushes the action off the
 * screen, so three things are fixed here: the count stays at the top, the
 * action sits in a docked bar at the bottom and names its own scope ("replace
 * in 2 notes"), and hits are grouped per note and collapsed — because when you
 * replace across a whole vault you judge the NOTE, not the individual line.
 *
 * Only one group is open at a time; opening another closes the previous one. A
 * note with forty hits would otherwise bury the bar under itself.
 *
 * Deselection is per note, never per line: `replaceAllInText` replaces all
 * matches in a note or none, so a per-line checkbox would promise a precision
 * the core does not deliver.
 */
export function FindReplaceScreen({
  vault,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [opts, setOpts] = useState<FindReplaceOptions>({});
  const [results, setResults] = useState<VaultFindResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; path: string } | null>(null);
  const [status, setStatus] = useState<{ text: string; warn: boolean } | null>(null);
  const stopRef = useRef(false);

  /**
   * Leaving the app stops the run at the next note boundary.
   *
   * Same question as the task deletion: what is the safe exit of an interrupted
   * operation? Here it is "stop" — notes already written stay written and are
   * named, and nothing keeps writing while nobody is watching.
   */
  useEffect(() => {
    const handle = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) stopRef.current = true;
    });
    return () => {
      void handle.then((l) => l.remove());
    };
  }, []);

  // The search without the status reset: the replace re-runs it to refresh
  // the list and must not wipe the report it just wrote (same fix as the
  // desktop dialog, P6 — "Replaced n matches" was cleared before anyone saw it).
  const search = async () => {
    if (!vault.queryService || !find) return;
    setBusy(true);
    try {
      const res = await vault.queryService.findInVault(find, opts);
      setResults(res);
      setSelected(new Set(res.map((r) => r.path)));
      setOpen(res.length === 1 ? res[0].path : null);
    } finally {
      setBusy(false);
    }
  };

  const runFind = async () => {
    setStatus(null);
    await search();
  };

  const runReplace = async () => {
    if (!find || !results) return;
    stopRef.current = false;
    setBusy(true);
    setStatus(null);
    const res = await runVaultReplace(
      {
        read: (path) => vaultOps.read(vault, path),
        write: (path, content) => vaultOps.save(vault, path, content),
      },
      {
        results,
        selected,
        query: find,
        replacement: replace,
        options: opts,
        onProgress: (done, total, path) => setProgress({ done, total, path }),
        shouldStop: () => stopRef.current,
      }
    );
    setProgress(null);
    setBusy(false);

    const parts = [
      t("findReplace.replaced", {
        defaultValue: "Replaced {{hits}} matches in {{notes}} notes",
        hits: res.hits,
        notes: res.notes,
      }),
    ];
    // A note skipped because it changed since the preview is the one case the
    // user has to hear about — the count alone would read as "nothing to do".
    if (res.skipped.length > 0) {
      parts.push(t("findReplace.skipped", { count: res.skipped.length }));
    }
    if (res.cancelled) {
      parts.push(t("findReplace.cancelled"));
    }
    setStatus({ text: parts.join(" "), warn: res.cancelled || res.skipped.length > 0 });
    await search();
  };

  const toggleNote = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const toggleOpt = (key: keyof FindReplaceOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  // Before and after, per hit (P6, shared with the desktop): with a regex and
  // `$1` in the replacement the after row is what makes the change checkable.
  const segments = (segs: PreviewSegment[]) =>
    segs.map((s, i) =>
      s.kind === "plain" ? (
        <span key={i}>{s.text}</span>
      ) : (
        <mark key={i} className={s.kind === "hit" ? "pv-fr-mark pv-fr-mark--hit" : "pv-fr-mark pv-fr-mark--new"}>
          {s.text}
        </mark>
      ),
    );

  const selectedNotes = results ? results.filter((r) => selected.has(r.path)).length : 0;
  const totalHits = results ? results.reduce((n, r) => n + r.matchCount, 0) : 0;
  const allSelected = results !== null && results.length > 0 && selectedNotes === results.length;

  return (
    <div className="m-screen">
      <AppBar onBack={onBack} title={t("findReplace.title")} />

      <div className="m-page m-page--wizard">
        <TextInput
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runFind();
          }}
          placeholder={t("findReplace.findPlaceholder")}
          aria-label={t("findReplace.findPlaceholder")}
          data-testid="fr-find-input"
        />
        <TextInput
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder={t("findReplace.replacePlaceholder")}
          aria-label={t("findReplace.replacePlaceholder")}
          data-testid="fr-replace-input"
        />

        <div className="m-chiprow">
          <Chip selected={!!opts.matchCase} onClick={() => toggleOpt("matchCase")}>
            {t("search.matchCase")}
          </Chip>
          <Chip selected={!!opts.wholeWord} onClick={() => toggleOpt("wholeWord")}>
            {t("search.byWord")}
          </Chip>
          <Chip selected={!!opts.regex} onClick={() => toggleOpt("regex")}>
            {t("search.regexp")}
          </Chip>
        </div>

        {status && (
          <div data-testid="fr-status">
            <Banner kind={status.warn ? "warning" : "info"} rounded>
              {status.text}
            </Banner>
          </div>
        )}

        {progress && (
          <div data-testid="fr-progress">
            <SectionLabel>
              {t("findReplace.progress", { done: progress.done, total: progress.total })} ·{" "}
              {progress.path.split("/").pop()}
            </SectionLabel>
            <div className="m-progress">
              <div
                className="m-progress-bar"
                style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {results !== null && results.length > 0 && (
          <>
            <SectionLabel
              end={
                <Button
                  variant="ghost"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(results.map((r) => r.path)))}
                  data-testid="fr-select-all"
                >
                  {allSelected ? t("findReplace.deselectAll") : t("findReplace.selectAll")}
                </Button>
              }
            >
              {t("findReplace.hitSummary", { hits: totalHits, notes: results.length })}
            </SectionLabel>

            {results.map((r) => {
              const on = selected.has(r.path);
              const isOpen = open === r.path;
              const shown = r.matches.slice(0, 8);
              return (
                <GroupCard key={r.path}>
                  <RowList>
                    <Row
                      controls
                      icon={
                        <Checkbox
                          checked={on}
                          onChange={() => toggleNote(r.path)}
                          aria-label={r.title}
                          data-testid={`fr-toggle-${r.path}`}
                        />
                      }
                      title={r.title}
                      end={
                        <>
                          <span className="pv-badge pv-badge--accent">{r.matchCount}</span>
                          {isOpen ? <ChevronDown size={ICON.meta} /> : <ChevronRight size={ICON.meta} />}
                        </>
                      }
                      onClick={() => setOpen(isOpen ? null : r.path)}
                      data-testid={`fr-group-${r.path}`}
                    />
                    {isOpen &&
                      shown.map((m, i) => (
                        <Row
                          key={`${m.start}-${i}`}
                          indent={1}
                          wrap
                          title={<span data-testid="fr-before">{segments(previewLine(m.lineText.trim(), find, replace, opts).before)}</span>}
                          subtitle={
                            <span data-testid="fr-after">
                              {t("findReplace.line", { n: m.line })} · {segments(previewLine(m.lineText.trim(), find, replace, opts).after)}
                            </span>
                          }
                          onClick={() => onOpenNote(r.path)}
                        />
                      ))}
                    {isOpen && r.matches.length > shown.length && (
                      <Row indent={1} title={t("findReplace.moreHits", { count: r.matches.length - shown.length })} />
                    )}
                  </RowList>
                </GroupCard>
              );
            })}
          </>
        )}

        {results !== null && results.length === 0 && (
          <EmptyState icon={<SearchIcon size={ICON.empty} />}>{t("findReplace.noMatches")}</EmptyState>
        )}

        {results === null && (
          <EmptyState icon={<Replace size={ICON.empty} />} title={t("findReplace.emptyTitle")}>
            {t("findReplace.emptyBody")}
          </EmptyState>
        )}
      </div>

      <DockedToolbar>
        {busy && progress ? (
          <Button
            variant="ghost"
            onClick={() => {
              stopRef.current = true;
            }}
            data-testid="fr-cancel"
          >
            {t("common.cancel")}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy || !find} onClick={() => void runFind()} data-testid="fr-find">
            {t("search.find")}
          </Button>
        )}
        <Button
          variant="primary"
          disabled={busy || !find || selectedNotes === 0}
          onClick={() => void runReplace()}
          data-testid="fr-replace"
        >
          {t("findReplace.replaceIn", { notes: selectedNotes })}
        </Button>
      </DockedToolbar>
    </div>
  );
}
