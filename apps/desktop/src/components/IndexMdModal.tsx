import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVault } from "../contexts/VaultContext";
import { retargetDesktopBookmarks } from "../services/bookmarks";
import { announcePathRenamed } from "../services/fileMoved";
import { requestSaveFlush } from "../services/saveFlush";
import { toast } from "@plainva/ui";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { SelectField } from "@plainva/ui";
import { Checkbox, errorText } from "@plainva/ui";
import {
  collectFolderIndexInfos,
  generateIndexForFolder,
  adoptFileAsIndex,
  adoptionSummary,
  foldersMissingIndex,
  pinOverviewLinks,
  planOverviewLinkPins,
  type FolderIndexInfo,
} from "../services/indexMd";

type FolderAction = { kind: "skip" } | { kind: "generate" } | { kind: "adopt"; candidatePath: string };

interface ResultLine {
  folder: string;
  text: string;
  error?: boolean;
  /** About the whole run, not one folder: said without a folder in front. */
  plain?: boolean;
}

/** Where an adopted note lands: the folder's `index.md`. */
const indexPathOf = (folder: string) => (folder ? `${folder}/index.md` : "index.md");

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
  // Links to other overviews the chosen adoptions would take over, offered to
  // be written with their folder (Sammelplan § 3.135 Nr. 6) — as on the phone.
  const [pinLinks, setPinLinks] = useState(true);
  const [pinCount, setPinCount] = useState<{ key: string; links: number } | null>(null);
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
  const adoptions = (infos ?? []).flatMap((info) => {
    const action = actions[info.folder];
    return action?.kind === "adopt" ? [{ candidatePath: action.candidatePath, indexPath: indexPathOf(info.folder) }] : [];
  });
  const adoptionKey = JSON.stringify(adoptions);
  useEffect(() => {
    const wanted = JSON.parse(adoptionKey) as { candidatePath: string; indexPath: string }[];
    if (!queryService || wanted.length === 0) return;
    let alive = true;
    planOverviewLinkPins(queryService, wanted)
      .then((pins) => { if (alive) setPinCount({ key: adoptionKey, links: pins.links }); })
      .catch((e) => console.warn("[IndexMdModal] counting the links to other overviews failed", e));
    return () => { alive = false; };
  }, [queryService, adoptionKey]);
  const offeredPins = pinCount && pinCount.key === adoptionKey && adoptions.length > 0 ? pinCount.links : 0;
  const selectedCount = infos?.filter((i) => actionFor(i.folder).kind !== "skip").length ?? 0;
  const missingFolders = infos ? foldersMissingIndex(infos) : [];
  const missingCount = missingFolders.length;

  const folderLabel = (folder: string) => (folder === "" ? t("indexMd.rootFolder") : folder);

  // Bulk action (WP4): preselect "generate" for every folder that has no
  // index.md yet — the requested "create an index.md in all folders without
  // one". Folders that already have one are untouched.
  const selectAllMissing = () => {
    setActions((prev) => {
      const next = { ...prev };
      for (const folder of missingFolders) next[folder] = { kind: "generate" };
      return next;
    });
  };

  const run = async () => {
    if (!vaultAdapter || !queryService || !infos) return;
    setRunning(true);
    const lines: ResultLine[] = [];
    // Before any note moves: a link written with its folder leads there
    // whatever the run does afterwards (`planOverviewLinkPins`). Read again
    // here — what was counted for the offer may be older than the vault.
    if (pinLinks && offeredPins > 0) {
      try {
        const done = await pinOverviewLinks(vaultAdapter, await planOverviewLinkPins(queryService, adoptions));
        for (const path of done.changedPaths) window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
        if (done.pinned > 0) lines.push({ folder: "", plain: true, text: t("indexMd.resultPinned", { links: done.pinned }) });
        if (done.failed) lines.push({ folder: "", plain: true, error: true, text: t("indexMd.pinFailed") });
      } catch (e) {
        console.warn("[IndexMdModal] writing the links to other overviews failed", e);
        lines.push({ folder: "", plain: true, error: true, text: t("indexMd.pinFailed") });
      }
    }
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
          // What the editor has not written yet goes to the note before it moves.
          await requestSaveFlush(action.candidatePath, vaultPath ?? undefined);
          const result = await adoptFileAsIndex({
            adapter: vaultAdapter,
            queryService,
            candidatePath: action.candidatePath,
            folder: info.folder,
            prepare,
            // What a rename in the file tree carries along (Sammelplan § 3.135 Nr. 1).
            afterMove: async (from, to) => {
              await retargetDesktopBookmarks(vaultAdapter, from, to).catch(() => toast.error(t("sidebar.bookmarkSaveFailed")));
              announcePathRenamed({ from, to, vaultPath: vaultPath ?? "" });
            },
          });
          // One line, the words the phone's notice uses (`adoptionSummary`).
          lines.push({ folder: info.folder, text: adoptionSummary(t, action.candidatePath.split("/").pop() ?? action.candidatePath, result) });
          // Said as after any rename: a link that could not be followed still names the old file.
          if (result.linkUpdateFailed) lines.push({ folder: info.folder, text: t("dialogs.renameLinksFailed"), error: true });
        }
      } catch (e) {
        // In words, with the file it was about (Sammelplan § 3.135 no. 3): the
        // raw English of the vault stood here ("File or directory already exists: …").
        const reason = errorText(e);
        lines.push({
          folder: info.folder,
          text: action.kind === "adopt"
            ? t("writeFailed.adopt", { file: action.candidatePath.split("/").pop() ?? action.candidatePath, reason })
            : t("writeFailed.overview", { reason }),
          error: true,
        });
      }
    }
    try {
      await indexer?.indexVaultFull("index.md generation");
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

          {infos !== null && missingCount > 0 && (
            <div style={{ marginBottom: "var(--space-2)" }}>
              <Button onClick={selectAllMissing}>
                {t("indexMd.generateAllMissing", { count: missingCount })}
              </Button>
            </div>
          )}

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
                      {/* A folder that has an index.md takes no other note as its overview: the
                          adoption is refused, so it is not offered (Sammelplan § 3.135 no. 3) —
                          as on the phone. */}
                      {!info.hasIndex && info.candidates.map((c) => (
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
          {offeredPins > 0 && (
            <div style={{ margin: "var(--space-1) 0 var(--space-1)" }}>
              <Checkbox checked={pinLinks} onChange={(e) => setPinLinks(e.target.checked)} data-testid="indexmd-pin-links">
                {t("indexMd.pinOption", { links: offeredPins })}
              </Checkbox>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("indexMd.pinHint")}</div>
            </div>
          )}
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("indexMd.renameHint")}</div>
        </>
      )}

      {results !== null && (
        <ul style={{ margin: "0.3rem 0 0.6rem 1.1rem", padding: 0, fontSize: "var(--text-ui)" }}>
          {results.map((r, i) => (
            <li key={i} style={{ color: r.error ? "var(--error-text)" : undefined }}>
              {!r.plain && <><strong>{folderLabel(r.folder)}:</strong>{" "}</>}{r.text}
            </li>
          ))}
          {results.length === 0 && <li>{t("indexMd.nothingDone")}</li>}
        </ul>
      )}
    </Modal>
  );
};
