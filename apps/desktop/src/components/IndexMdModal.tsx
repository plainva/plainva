import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVault } from "../contexts/VaultContext";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { SelectField } from "./ui/Field";
import { Checkbox } from "./ui/Checkbox";
import {
  collectFolderIndexInfos,
  generateIndexForFolder,
  adoptFileAsIndex,
  type FolderIndexInfo,
} from "../services/indexMd";

type FolderAction = { kind: "skip" } | { kind: "generate" } | { kind: "adopt"; candidatePath: string };

interface ResultLine {
  folder: string;
  text: string;
  error?: boolean;
}

/**
 * index.md manager (Gesamtplan W7): per folder the user chooses to skip,
 * generate a spec-shaped listing, or adopt a suggested overview note (MOC,
 * Übersicht, …) via rename with vault-wide link updates. Nothing is
 * preselected — renames only happen on explicit user choice.
 */
export const IndexMdModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { vaultPath, vaultAdapter, queryService, indexer, triggerFileTreeUpdate } = useVault();

  const [infos, setInfos] = useState<FolderIndexInfo[] | null>(null);
  const [actions, setActions] = useState<Record<string, FolderAction>>({});
  const [prepare, setPrepare] = useState(true);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ResultLine[] | null>(null);

  useEffect(() => {
    let alive = true;
    if (!vaultAdapter || !queryService) return;
    collectFolderIndexInfos({ queryService, adapter: vaultAdapter })
      .then((list) => { if (alive) setInfos(list); })
      .catch((e) => console.error("[IndexMdModal] collecting folders failed", e));
    return () => { alive = false; };
  }, [vaultAdapter, queryService, vaultPath]);

  const actionFor = (folder: string): FolderAction => actions[folder] ?? { kind: "skip" };
  const selectedCount = infos?.filter((i) => actionFor(i.folder).kind !== "skip").length ?? 0;

  const folderLabel = (folder: string) => (folder === "" ? t("indexMd.rootFolder") : folder);

  const run = async () => {
    if (!vaultAdapter || !queryService || !infos) return;
    setRunning(true);
    const lines: ResultLine[] = [];
    for (const info of infos) {
      const action = actionFor(info.folder);
      if (action.kind === "skip") continue;
      try {
        if (action.kind === "generate") {
          const heading = info.folder === ""
            ? (vaultPath?.split(/[/\\]/).pop() ?? "Vault")
            : info.folder.split("/").pop()!;
          const result = await generateIndexForFolder({
            adapter: vaultAdapter,
            queryService,
            folder: info.folder,
            heading,
            subfoldersHeading: t("indexMd.subfoldersHeading"),
          });
          lines.push({
            folder: info.folder,
            text: result.overwrote
              ? t("indexMd.resultUpdated", { entries: result.entries })
              : t("indexMd.resultCreated", { entries: result.entries }),
          });
        } else {
          const result = await adoptFileAsIndex({
            adapter: vaultAdapter,
            queryService,
            candidatePath: action.candidatePath,
            folder: info.folder,
            prepare,
          });
          const extras: string[] = [];
          if (result.renamedLinks > 0) extras.push(t("indexMd.resultLinks", { links: result.renamedLinks, files: result.changedFiles }));
          if (result.preparation && (result.preparation.embeds > 0 || result.preparation.unresolved > 0)) {
            extras.push(t("indexMd.resultPrepLeftovers", { embeds: result.preparation.embeds, unresolved: result.preparation.unresolved }));
          }
          lines.push({
            folder: info.folder,
            text: `${t("indexMd.resultAdopted", { file: action.candidatePath.split("/").pop() })}${extras.length ? ` (${extras.join("; ")})` : ""}`,
          });
        }
      } catch (e) {
        lines.push({ folder: info.folder, text: e instanceof Error ? e.message : String(e), error: true });
      }
    }
    try {
      await indexer?.indexVaultFull();
      triggerFileTreeUpdate();
    } catch (e) {
      console.warn("[IndexMdModal] re-index failed", e);
    }
    setResults(lines);
    setRunning(false);
  };

  const guardedClose = () => { if (!running) onClose(); };

  return (
    <Modal
      onClose={guardedClose}
      title={t("indexMd.title")}
      size="md"
      hideClose={running}
      closeOnOverlay={!running}
      footer={
        results === null ? (
          <>
            <Button onClick={guardedClose} disabled={running}>{t("okf.cancel")}</Button>
            <Button variant="primary" onClick={run} disabled={running || selectedCount === 0}>
              {running ? t("indexMd.running") : t("indexMd.runButton", { count: selectedCount })}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>{t("okf.close")}</Button>
        )
      }
    >
      {results === null && (
        <>
          <div style={{ fontSize: "var(--text-ui)", color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>
            {t("indexMd.intro")}
          </div>

          {infos === null ? (
            <div style={{ fontSize: "var(--text-md)" }}>{t("okf.scanning")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {infos.map((info) => {
                const action = actionFor(info.folder);
                const value =
                  action.kind === "skip" ? "skip" : action.kind === "generate" ? "generate" : `adopt:${action.candidatePath}`;
                return (
                  <div key={info.folder || "/"} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "var(--text-ui)", padding: "0.25rem 0", borderBottom: "1px solid var(--border-color-light, var(--border-color))" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folderLabel(info.folder)}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: info.indexIsConcept ? "var(--error-text)" : "var(--text-muted)" }}>
                        {info.indexIsConcept
                          ? t("indexMd.statusConcept")
                          : info.hasIndex
                            ? t("indexMd.statusPresent")
                            : t("indexMd.statusMissing")}
                        {" · "}
                        {t("indexMd.fileCount", { count: info.fileCount })}
                      </div>
                    </div>
                    <SelectField
                      value={value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setActions((prev) => ({
                          ...prev,
                          [info.folder]:
                            v === "skip"
                              ? { kind: "skip" }
                              : v === "generate"
                                ? { kind: "generate" }
                                : { kind: "adopt", candidatePath: v.slice("adopt:".length) },
                        }));
                      }}
                      style={{ width: "auto", maxWidth: "260px", fontSize: "var(--text-sm)" }}
                      aria-label={t("indexMd.actionFor", { folder: folderLabel(info.folder) })}
                    >
                      <option value="skip">{t("indexMd.actionSkip")}</option>
                      <option value="generate">
                        {info.hasIndex ? t("indexMd.actionRegenerate") : t("indexMd.actionGenerate")}
                      </option>
                      {info.candidates.map((c) => (
                        <option key={c.path} value={`adopt:${c.path}`}>
                          {t("indexMd.actionAdopt", { file: c.path.split("/").pop() })}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ margin: "0.7rem 0 0.2rem" }}>
            <Checkbox checked={prepare} onChange={(e) => setPrepare(e.target.checked)}>
              {t("indexMd.prepareOption")}
            </Checkbox>
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("indexMd.renameHint")}</div>
        </>
      )}

      {results !== null && (
        <ul style={{ margin: "0.3rem 0 0.6rem 1.1rem", padding: 0, fontSize: "var(--text-ui)" }}>
          {results.map((r, i) => (
            <li key={i} style={{ color: r.error ? "var(--error-text)" : undefined }}>
              <strong>{folderLabel(r.folder)}:</strong> {r.text}
            </li>
          ))}
          {results.length === 0 && <li>{t("indexMd.nothingDone")}</li>}
        </ul>
      )}
    </Modal>
  );
};
