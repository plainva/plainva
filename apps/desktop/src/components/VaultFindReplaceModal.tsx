import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon } from "lucide-react";
import { replaceAllInText, type FindReplaceOptions, type VaultFindResult } from "@plainva/core";
import { Button, ICON, Modal } from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";

/**
 * Vault-wide find & replace (B6): search every note (from the FTS index),
 * preview the matches grouped by note with per-note opt-out, then replace —
 * each note is re-read fresh and written back through the adapter's atomic +
 * backup chain, so a stale preview can never clobber newer content. Literal by
 * default; optional match case / whole word / regex, like the editor's panel.
 */
export const VaultFindReplaceModal: React.FC<{ onClose: () => void; onOpenPath: (path: string) => void }> = ({
  onClose,
  onOpenPath,
}) => {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, triggerFileTreeUpdate } = useVault();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [opts, setOpts] = useState<FindReplaceOptions>({});
  const [results, setResults] = useState<VaultFindResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const runFind = async () => {
    if (!queryService || !find) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await queryService.findInVault(find, opts);
      setResults(res);
      setSelected(new Set(res.map((r) => r.path)));
    } finally {
      setBusy(false);
    }
  };

  const runReplace = async () => {
    if (!vaultAdapter || !find || !results) return;
    setBusy(true);
    let notes = 0;
    let hits = 0;
    for (const r of results) {
      if (!selected.has(r.path)) continue;
      try {
        const fresh = await vaultAdapter.readTextFile(r.path);
        const { content, count } = replaceAllInText(fresh, find, replace, opts);
        if (count > 0 && content !== fresh) {
          await vaultAdapter.writeTextFile(r.path, content);
          notes += 1;
          hits += count;
        }
      } catch {
        // Skip a note that cannot be read/written; the rest still apply.
      }
    }
    triggerFileTreeUpdate?.();
    setBusy(false);
    setStatus(t("findReplace.replaced", { defaultValue: "Replaced {{hits}} matches in {{notes}} notes", hits, notes }));
    await runFind();
  };

  const toggleNote = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const selectedNotes = results ? results.filter((r) => selected.has(r.path)).length : 0;
  const toggleOpt = (key: keyof FindReplaceOptions) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  const optChip = (key: keyof FindReplaceOptions, label: string) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-ui)", color: "var(--text-muted)", cursor: "pointer" }}>
      <input type="checkbox" checked={!!opts[key]} onChange={() => toggleOpt(key)} />
      {label}
    </label>
  );

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={t("findReplace.title", { defaultValue: "Im Vault suchen & ersetzen" })}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--text-md)", flex: 1 }}>{status}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close", { defaultValue: "Schließen" })}
          </Button>
          <Button variant="primary" disabled={busy || !find || selectedNotes === 0} onClick={runReplace}>
            {t("findReplace.replaceIn", { defaultValue: "In {{notes}} Notizen ersetzen", notes: selectedNotes })}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runFind()}
            placeholder={t("findReplace.findPlaceholder", { defaultValue: "Suchtext…" })}
            style={inputStyle}
          />
          <Button variant="secondary" disabled={busy || !find} onClick={runFind}>
            <SearchIcon size={ICON.ui} /> {t("search.find", { defaultValue: "Suchen" })}
          </Button>
        </div>
        <input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          placeholder={t("findReplace.replacePlaceholder", { defaultValue: "Ersetzen durch…" })}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 14, padding: "0.15rem 0" }}>
          {optChip("matchCase", t("search.matchCase", { defaultValue: "Groß/klein" }))}
          {optChip("wholeWord", t("search.byWord", { defaultValue: "ganzes Wort" }))}
          {optChip("regex", t("search.regexp", { defaultValue: "Regex" }))}
        </div>

        <div
          style={{
            maxHeight: "42vh",
            overflowY: "auto",
            borderTop: results !== null ? "1px solid var(--border-color)" : "none",
            paddingTop: results !== null ? 8 : 0,
            marginTop: results !== null ? 2 : 0,
          }}
        >
          {results === null ? null : results.length === 0 ? (
            <div style={{ color: "var(--text-muted)", padding: "1.2rem", textAlign: "center", fontSize: "var(--text-md)" }}>
              {t("findReplace.noMatches", { defaultValue: "Keine Treffer" })}
            </div>
          ) : (
            results.map((r) => (
              <div key={r.path} style={{ padding: "0.35rem 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={selected.has(r.path)} onChange={() => toggleNote(r.path)} />
                  <button
                    type="button"
                    onClick={() => onOpenPath(r.path)}
                    data-tip={r.path}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-main)", fontWeight: 500, padding: 0, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {r.title}
                  </button>
                  <span style={{ color: "var(--text-muted)", fontSize: "var(--text-ui)" }}>×{r.matchCount}</span>
                </div>
                <div style={{ paddingLeft: 22 }}>
                  {r.matches.slice(0, 3).map((mt, i) => (
                    <div key={i} style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-content)" }}>
                      <span style={{ opacity: 0.6 }}>{r.matches[i].line}: </span>
                      {mt.lineText.trim()}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  width: "100%",
  padding: "0.4rem 0.55rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-color)",
  background: "var(--bg-primary)",
  color: "var(--text-main)",
  fontSize: "var(--text-md)",
};
