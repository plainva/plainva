import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon, SearchX } from "lucide-react";
import { type FindReplaceOptions, type VaultFindResult } from "@plainva/core";
import {
  Button,
  Checkbox,
  EmptyState,
  ICON,
  Modal,
  NotePath,
  TextInput,
  previewLine,
  regexProblem,
  runVaultReplace,
  type PreviewSegment,
} from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";

/**
 * Vault-wide find & replace (B6): search every note (from the FTS index),
 * preview the matches grouped by note with per-note opt-out, then replace —
 * each note is re-read fresh and written back through the adapter's atomic +
 * backup chain, so a stale preview can never clobber newer content. Literal by
 * default; optional match case / whole word / regex, like the editor's panel.
 *
 * Rebuilt on the primitives (finding 2026-09-01, D1 / P6): the dialog used to
 * hand-roll inputs, option chips, buttons and its empty state next to a
 * package that already had all of them — and it only showed WHERE a match sat.
 * Now every hit has a before and an after row, so a regex with `$1` is a
 * change one can check rather than guess; an invalid expression is named at
 * the field instead of answering with an empty list; and a running replace
 * says what it is doing and can be stopped at a note boundary — the same
 * contract the phone's screen has had since it was built.
 */
export const VaultFindReplaceModal: React.FC<{ onClose: () => void; onOpenPath: (path: string) => void }> = ({
  onClose,
  onOpenPath,
}) => {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, vaultPath, triggerFileTreeUpdate } = useVault();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [opts, setOpts] = useState<FindReplaceOptions>({});
  const [results, setResults] = useState<VaultFindResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; path: string } | null>(null);
  const [status, setStatus] = useState<{ text: string; warn: boolean } | null>(null);
  const stopRef = useRef(false);

  const regexError = regexProblem(find, opts);
  const canSearch = Boolean(find) && !regexError && !busy;

  // The search itself, without touching the status line: the replace re-runs
  // it to refresh the list and must NOT wipe the report it just wrote — which
  // is exactly what the old dialog did, so "Replaced n matches" was never seen.
  const search = async () => {
    if (!queryService || !find || regexError) return;
    setBusy(true);
    try {
      const res = await queryService.findInVault(find, opts);
      setResults(res);
      setSelected(new Set(res.map((r) => r.path)));
    } finally {
      setBusy(false);
    }
  };

  const runFind = async () => {
    setStatus(null);
    await search();
  };

  const runReplace = async () => {
    if (!vaultAdapter || !find || !results) return;
    stopRef.current = false;
    setBusy(true);
    setStatus(null);
    const res = await runVaultReplace(
      {
        read: (path) => vaultAdapter.readTextFile(path),
        write: (path, content) => vaultAdapter.writeTextFile(path, content),
      },
      {
        results,
        selected,
        query: find,
        replacement: replace,
        options: opts,
        onProgress: (done, total, path) => setProgress({ done, total, path }),
        shouldStop: () => stopRef.current,
      },
    );
    setProgress(null);
    triggerFileTreeUpdate?.();
    setBusy(false);
    // A note that changed since the preview is skipped rather than clobbered —
    // and said out loud, because a silent non-change is the one case the user
    // has to know about (the count alone would read as "nothing to do here").
    const parts = [t("findReplace.replaced", { hits: res.hits, notes: res.notes })];
    if (res.skipped.length > 0) parts.push(t("findReplace.skipped", { count: res.skipped.length }));
    if (res.cancelled) parts.push(t("findReplace.cancelled"));
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

  const totalHits = results ? results.reduce((n, r) => n + r.matchCount, 0) : 0;
  const selectedNotes = results ? results.filter((r) => selected.has(r.path)).length : 0;
  const allSelected = results !== null && results.length > 0 && selectedNotes === results.length;
  const toggleOpt = (key: keyof FindReplaceOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }));
  const vaultName = (vaultPath ?? "").split(/[/\\]/).filter(Boolean).pop() ?? "";

  const segments = (segs: PreviewSegment[]) =>
    segs.map((s, i) =>
      s.kind === "plain" ? (
        <React.Fragment key={i}>{s.text}</React.Fragment>
      ) : (
        <mark key={i} className={s.kind === "hit" ? "pv-fr-mark pv-fr-mark--hit" : "pv-fr-mark pv-fr-mark--new"}>
          {s.text}
        </mark>
      ),
    );

  const footer = progress ? (
    <div className="pv-fr-footer">
      <span className="pv-fr-status" data-testid="fr-progress">
        {t("findReplace.replacing", { notes: progress.total })} · {t("findReplace.progress", { done: progress.done, total: progress.total })} ·{" "}
        {progress.path.split("/").pop()} · {t("findReplace.backupHint")}
      </span>
      <Button variant="ghost" onClick={() => { stopRef.current = true; }} data-testid="fr-cancel">
        {t("common.cancel")}
      </Button>
    </div>
  ) : (
    <div className="pv-fr-footer">
      <span className={status?.warn ? "pv-fr-status pv-fr-status--warn" : "pv-fr-status"} data-testid="fr-status">
        {status?.text}
      </span>
      <Button variant="ghost" onClick={onClose}>
        {t("common.close")}
      </Button>
      <Button variant="danger" disabled={busy || !find || selectedNotes === 0} onClick={runReplace} data-testid="fr-replace">
        {t("findReplace.replaceIn", { notes: selectedNotes })}
      </Button>
    </div>
  );

  return (
    <Modal onClose={onClose} size="lg" title={t("findReplace.title")} footer={footer} testId="find-replace-modal">
      <div className="pv-fr">
        <p className="pv-fr-scope">{t("findReplace.scope", { vault: vaultName })}</p>
        <div className="pv-fr-fields">
          <label className="pv-fr-field">
            <span className="pv-fr-label">{t("findReplace.findLabel")}</span>
            <TextInput
              autoFocus
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runFind(); }}
              placeholder={t("findReplace.findPlaceholder")}
              aria-invalid={regexError ? true : undefined}
              data-testid="fr-find-input"
            />
          </label>
          <label className="pv-fr-field">
            <span className="pv-fr-label">{t("findReplace.replaceLabel")}</span>
            <TextInput
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runFind(); }}
              placeholder={t("findReplace.replacePlaceholder")}
              data-testid="fr-replace-input"
            />
          </label>
        </div>
        {regexError && (
          /* The engine's reason at the field, not an empty list: an invalid
             expression used to look exactly like a word that does not exist. */
          <p className="pv-fr-error" role="alert" data-testid="fr-regex-error">
            {t("findReplace.regexInvalid")} · {regexError}
          </p>
        )}
        <div className="pv-fr-options">
          <Checkbox checked={!!opts.matchCase} onChange={() => toggleOpt("matchCase")} data-testid="fr-opt-case">
            {t("findReplace.optCase")}
          </Checkbox>
          <Checkbox checked={!!opts.wholeWord} onChange={() => toggleOpt("wholeWord")} data-testid="fr-opt-word">
            {t("findReplace.optWord")}
          </Checkbox>
          <Checkbox checked={!!opts.regex} onChange={() => toggleOpt("regex")} data-testid="fr-opt-regex">
            {t("findReplace.optRegex")}
          </Checkbox>
          <span className="pv-fr-grow" />
          <Button variant="secondary" size="sm" icon={<SearchIcon size={ICON.ui} />} disabled={!canSearch} onClick={runFind} data-testid="fr-find">
            {t("search.find")}
          </Button>
        </div>

        {results === null ? null : results.length === 0 ? (
          <EmptyState icon={<SearchX size={ICON.empty} />} title={t("findReplace.noMatches")}>
            {t("findReplace.noMatchesHint", { query: find })}
            {opts.matchCase ? ` ${t("findReplace.noMatchesCaseHint")}` : ""}
          </EmptyState>
        ) : (
          <div className="pv-fr-results" data-testid="fr-results">
            <div className="pv-fr-results-head">
              <span data-testid="fr-summary">{t("findReplace.hitSummary", { hits: totalHits, notes: results.length })}</span>
              <span className="pv-fr-grow" />
              <span data-testid="fr-selected">{t("findReplace.selectedCount", { count: selectedNotes })}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(allSelected ? new Set() : new Set(results.map((r) => r.path)))}
                data-testid="fr-select-all"
              >
                {allSelected ? t("findReplace.deselectAll") : t("findReplace.selectAll")}
              </Button>
            </div>
            {results.map((r) => (
              <div key={r.path} className="pv-fr-group" data-testid="fr-group">
                <div className="pv-fr-group-head">
                  <Checkbox checked={selected.has(r.path)} onChange={() => toggleNote(r.path)} aria-label={r.title} />
                  <Button variant="ghost" size="sm" className="pv-fr-open" onClick={() => onOpenPath(r.path)} data-tip={r.path}>
                    <NotePath path={r.path} />
                  </Button>
                  <span className="pv-fr-count">{t("findReplace.hitsInNote", { count: r.matchCount })}</span>
                </div>
                {r.matches.map((m, i) => {
                  const p = previewLine(m.lineText, find, replace, opts);
                  return (
                    <div key={i} className="pv-fr-hit" data-testid="fr-hit">
                      <span className="pv-fr-ln">{m.line}</span>
                      <span className="pv-fr-lines">
                        <span className="pv-fr-row">
                          <span className="pv-fr-tag pv-fr-tag--before">{t("findReplace.before")}</span>
                          <span className="pv-fr-txt pv-fr-txt--dim" data-testid="fr-before">{segments(p.before)}</span>
                        </span>
                        <span className="pv-fr-row">
                          <span className="pv-fr-tag pv-fr-tag--after">{t("findReplace.after")}</span>
                          <span className="pv-fr-txt" data-testid="fr-after">{segments(p.after)}</span>
                        </span>
                      </span>
                    </div>
                  );
                })}
                {r.matchCount > r.matches.length && (
                  <div className="pv-fr-more">{t("findReplace.moreHits", { count: r.matchCount - r.matches.length })}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
