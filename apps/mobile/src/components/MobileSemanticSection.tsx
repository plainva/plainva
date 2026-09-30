import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { embeddingModel, type EmbeddingModelSpec } from "@plainva/core";
import { Banner, Button, GroupCard, packageInstalled, Row, RowList, SectionLabel, semanticModelRows, useLocalEmbeddings, type AiSession } from "@plainva/ui";
import { ChoiceMark } from "./ChoiceMark";
import { SemanticLoadSheet } from "./SemanticLoadSheet";
import { mConfirm } from "../services/mobileDialogs";
import { mobileLocalModels } from "../services/ai/localModels";

/**
 * Settings → AI & automation → "Semantic search" on the phone (plan
 * KI-Harness P2a-4): the desktop card's choice in rows — Off or one catalog
 * model, a single choice with the round mark — then the package's life:
 * loading with progress, the device check, pause and removal.
 */
export function MobileSemanticSection({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const settings = useSyncExternalStore(session.subscribe, session.getState).settings;
  const { controller, state } = useLocalEmbeddings();
  const [asking, setAsking] = useState<EmbeddingModelSpec | null>(null);
  const chosen = settings.semanticModel;
  const rows = semanticModelRows(t, i18n.language);

  const choose = async (spec: EmbeddingModelSpec | null) => {
    if (!spec) {
      await session.updateSettings((s) => ({ ...s, semanticModel: null }));
      return;
    }
    if (await packageInstalled(mobileLocalModels, spec)) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
    else setAsking(spec);
  };
  const load = async (spec: EmbeddingModelSpec) => {
    setAsking(null);
    if (controller && (await controller.install(spec))) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
  };
  const remove = async (spec: EmbeddingModelSpec) => {
    const ok = await mConfirm({ title: t("ai.semantic.remove"), message: t("ai.semantic.removeConfirm", { model: spec.name }), confirmLabel: t("ai.semantic.remove"), danger: true });
    if (!ok || !controller) return;
    if (chosen === spec.id) await session.updateSettings((s) => ({ ...s, semanticModel: null }));
    await controller.remove(spec);
  };

  const engine = state?.engine;
  const download = state?.download ?? null;
  const progress = state?.progress;
  const current = chosen ? embeddingModel(chosen) : undefined;
  const megabytes = (bytes: number) => new Intl.NumberFormat(i18n.language).format(Math.round(bytes / 1e6));

  return (
    <>
      <SectionLabel>{t("ai.semantic.title")}</SectionLabel>
      <p className="m-hint">{t("ai.semantic.description")}</p>
      <GroupCard>
        <RowList>
          <Row title={t("ai.semantic.off")} end={<ChoiceMark on={!chosen} />} onClick={() => void choose(null)} disabled={Boolean(download)} />
          {rows.map((row) => (
            <Row
              key={row.spec.id}
              wrap
              title={row.spec.name}
              subtitle={`${row.line} — ${row.hint}`}
              end={<ChoiceMark on={chosen === row.spec.id} />}
              onClick={() => void choose(row.spec)}
              disabled={Boolean(download)}
              data-testid={`semantic-model-${row.spec.id}`}
            />
          ))}
        </RowList>
      </GroupCard>
      {download && (
        <>
          <p className="m-hint" role="status">
            {t("ai.semantic.loading", { file: download.file, received: megabytes(download.received), total: megabytes(download.total) })}
          </p>
          <div className="pv-security-progress" aria-hidden="true">
            <div className="pv-security-progress-bar" style={{ width: `${download.total ? (download.received / download.total) * 100 : 0}%` }} />
          </div>
          <Button variant="ghost" onClick={() => void controller?.cancelInstall(embeddingModel(download.model)!)}>
            {t("ai.semantic.cancel")}
          </Button>
        </>
      )}
      {state?.downloadError && <Banner kind="warning">{t("ai.semantic.loadFailed", { reason: state.downloadError })}</Banner>}
      {engine?.kind === "checking" && <p className="m-hint">{t("ai.semantic.checking")}</p>}
      {engine?.kind === "failed" && (
        <Banner kind="warning">{engine.reason === "check" ? t("ai.semantic.checkFailed") : engine.reason === "runtime" ? t("ai.semantic.runtimeMissing") : t("ai.semantic.loadFailed", { reason: engine.detail })}</Banner>
      )}
      {engine?.kind === "ready" && current && progress && (
        <GroupCard>
          <RowList>
            <Row title={t("ai.semantic.ready", { model: current.name })} subtitle={t("ai.semantic.progress", { done: progress.current, total: progress.total })} wrap />
            <Row
              title={progress.state === "paused" ? t("ai.semantic.resume") : t("ai.semantic.pause")}
              onClick={() => (progress.state === "paused" ? controller?.resume() : controller?.pause())}
            />
            <Row title={t("ai.semantic.remove")} onClick={() => void remove(current)} />
          </RowList>
        </GroupCard>
      )}
      {asking && <SemanticLoadSheet spec={asking} onCancel={() => setAsking(null)} onLoad={() => void load(asking)} />}
    </>
  );
}
